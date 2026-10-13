// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import session from 'express-session'
import { createIdeaServer } from '../backend/app.ts'
import { hashPassword } from '../backend/auth/password.ts'
import type { Mailer } from '../backend/auth/mail.ts'
import { createSecurityRepositories } from './security-fixtures.ts'

const origin = 'http://127.0.0.1:5174'
const password = 'Independent password phrase 2026!'
let fixture: ReturnType<typeof createSecurityRepositories>
let server: http.Server
let base: string
let store: session.MemoryStore
let mailer: Mailer

beforeEach(async () => {
  fixture = createSecurityRepositories()
  store = new session.MemoryStore()
  mailer = { configured: true, send: vi.fn<Mailer['send']>().mockResolvedValue(undefined) }
  server = createIdeaServer(fixture.ideaRepository, { authRepository: fixture.authRepository,
    mailer, sessionStore: store, sessionSecret: 'independent-security-test-secret-32-characters', appOrigin: origin })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  store.clear(() => undefined)
})

function client() {
  let cookie = ''
  return {
    get cookie() { return cookie },
    async request(path: string, method = 'GET', input?: unknown, requestOrigin: string | null = origin) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cookie) headers.Cookie = cookie
      if (requestOrigin !== null) headers.Origin = requestOrigin
      const init: RequestInit = { method, headers }
      if (input !== undefined && method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(input)
      const response = await fetch(`${base}${path}`, init)
      const setCookie = response.headers.getSetCookie()[0]
      if (setCookie) cookie = setCookie.split(';')[0]!
      return response
    },
  }
}
async function register(username: string, email?: string, extras = {}) {
  const account = client()
  const response = await account.request('/auth/register', 'POST', { username, password, email, ...extras })
  expect(response.status).toBe(201)
  return { account, response, result: await response.json() }
}
async function administrator() {
  await fixture.authRepository.create({ username: 'administrator', email: null, passwordHash: await hashPassword(password), role: 'admin' })
  const account = client()
  expect((await account.request('/auth/login', 'POST', { username: 'administrator', password })).status).toBe(200)
  return account
}
function mailedToken(purpose: string) {
  const call = vi.mocked(mailer.send).mock.calls.findLast(args => args[1] === purpose)
  expect(call).toBeDefined()
  return new URL(call![2]).searchParams.get('token')!
}

describe('独立鉴权与用户隔离 HTTP 验收', () => {
  it('匿名及伪造会话无法读取或创建想法', async () => {
    const account = client()
    for (const path of ['/auth/session', '/ideas', '/ideas/1', '/admin/users']) {
      expect((await account.request(path)).status).toBe(401)
    }
    expect((await account.request('/idea', 'POST', { ideaContent: '不能保存' })).status).toBe(401)
    expect(fixture.ideas.size).toBe(0)
    expect((await fetch(`${base}/ideas`, { headers: { Cookie: 'idea_purify.sid=s%3Aforged.signature' } })).status).toBe(401)
  })

  it('公共注册忽略管理员角色，规范用户名，可不填写邮箱且不返回密码字段', async () => {
    const { account, response, result } = await register('USER_A', undefined, { role: 'admin', userId: 'forged' })
    expect(result.user).toMatchObject({ username: 'user_a', email: null, role: 'user' })
    expect(result.user.userId).not.toBe('forged')
    expect(result.emailDelivery).toBe('none')
    expect(result.user.passwordHash).toBeUndefined()
    expect(result.user.authVersion).toBeUndefined()
    const cookie = response.headers.getSetCookie()[0]!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect((await account.request('/admin/users')).status).toBe(403)
    expect((await account.request('/auth/session')).status).toBe(200)
    expect(mailer.send).not.toHaveBeenCalled()
  })

  it('不存在的账号不会自动创建，重复账号及错误输入受控拒绝', async () => {
    const account = client()
    expect((await account.request('/auth/login', 'POST', { username: 'unknown', password })).status).toBe(401)
    expect(fixture.users.size).toBe(0)
    for (const input of [{ username: "x' OR 1=1", password }, { username: 'valid', password: 'short' },
      { username: 'valid', password, email: '<img>@bad.com' }, { username: 'valid', password, email: 42 }, null]) {
      expect((await account.request('/auth/register', 'POST', input)).status).toBe(400)
    }
    await register('valid')
    expect((await account.request('/auth/register', 'POST', { username: 'VALID', password })).status).toBe(409)
    expect(fixture.users.size).toBe(1)
  })

  it('用户与管理员只能读取自己的列表和详情，创建不能伪造归属', async () => {
    const a = await register('user_a')
    const b = await register('user_b')
    const admin = await administrator()
    const content = "<img src=x onerror=alert(1)> '); DROP TABLE idea; -- ?"
    const response = await a.account.request('/idea', 'POST', { ideaContent: content, userId: b.result.user.userId, ideaId: 'client' })
    expect(response.status).toBe(201)
    const idea = await response.json()
    expect(idea.ideaContent).toBe(content)
    expect(await (await a.account.request('/ideas')).json()).toEqual([idea])
    expect(await (await a.account.request(`/ideas/${idea.ideaId}`)).json()).toEqual(idea)
    for (const viewer of [b.account, admin]) {
      expect(await (await viewer.request('/ideas')).json()).toEqual([])
      expect((await viewer.request(`/ideas/${idea.ideaId}`)).status).toBe(404)
    }
    expect((await a.account.request('/ideas/1%20OR%201=1')).status).toBe(404)
  })

  it('5173、其他开发来源和缺少 Origin 的请求都能登录，错误凭据仍被拒绝', async () => {
    await register('user_a')
    for (const requestOrigin of ['http://127.0.0.1:5173', 'http://localhost:5173', origin, null]) {
      const account = client()
      const response = await account.request('/auth/login', 'POST', { username: 'user_a', password }, requestOrigin)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ username: 'user_a', role: 'user' })
      expect((await account.request('/auth/session')).status).toBe(200)
      expect((await account.request('/auth/logout', 'POST', {}, requestOrigin)).status).toBe(200)
    }
    const response = await client().request('/auth/login', 'POST', { username: 'user_a', password: 'Incorrect password phrase!' }, 'http://127.0.0.1:5173')
    expect(response.status).toBe(401)
    expect((await response.json()).message).not.toContain('请求来源不受信任')
  })

  it('浏览器表单和文本写请求仍被拒绝，不开放跨站 JSON 请求的 CORS 预检', async () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const response = await fetch(`${base}/auth/register`, { method: 'POST',
        headers: { Origin: 'https://attacker.example', 'Content-Type': contentType },
        body: JSON.stringify({ username: 'victim', password }) })
      expect(response.status).toBe(415)
    }
    expect(fixture.users.size).toBe(0)
    const preflight = await fetch(`${base}/auth/register`, { method: 'OPTIONS', headers: {
      Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
    } })
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('退出登录撤销原始会话，管理员禁用立即使旧会话与密码登录失效', async () => {
    const a = await register('user_a')
    const oldCookie = a.account.cookie
    expect((await a.account.request('/auth/logout', 'POST', {})).status).toBe(200)
    expect((await fetch(`${base}/ideas`, { headers: { Cookie: oldCookie } })).status).toBe(401)
    expect((await a.account.request('/auth/login', 'POST', { username: 'user_a', password })).status).toBe(200)
    const admin = await administrator()
    expect((await admin.request(`/admin/users/${a.result.user.userId}/status`, 'PATCH', { disabled: true })).status).toBe(200)
    expect((await a.account.request('/ideas')).status).toBe(401)
    expect((await client().request('/auth/login', 'POST', { username: 'user_a', password })).status).toBe(401)
    const adminId = (await (await admin.request('/auth/session')).json()).userId
    expect((await admin.request(`/admin/users/${adminId}/status`, 'PATCH', { disabled: true })).status).toBe(403)
  })

  it('过期会话受控返回 401，不是内部错误', async () => {
    const a = await register('user_a')
    const all = await new Promise<Record<string, session.SessionData>>((resolve, reject) => store.all((error, sessions) => error ? reject(error) : resolve(sessions as Record<string, session.SessionData>)))
    const [id, data] = Object.entries(all)[0]!
    data.authenticatedAt = Date.now() - 9 * 60 * 60 * 1000
    await new Promise<void>((resolve, reject) => store.set(id, data, error => error ? reject(error) : resolve()))
    expect((await a.account.request('/ideas')).status).toBe(401)
    expect((await a.account.request('/auth/session')).status).toBe(401)
  })

  it('邮箱验证与密码重设凭据一次有效，重设后旧密码和会话均失效', async () => {
    const a = await register('user_a', 'owner@example.com')
    const verification = mailedToken('verify-email')
    expect((await a.account.request('/auth/verify-email', 'POST', { token: verification })).status).toBe(200)
    expect((await a.account.request('/auth/verify-email', 'POST', { token: verification })).status).toBe(400)
    expect((await a.account.request('/auth/forgot-password', 'POST', { email: 'owner@example.com' })).status).toBe(200)
    const reset = mailedToken('reset-password')
    const newPassword = 'New independent password phrase 2026!'
    expect((await a.account.request('/auth/reset-password', 'POST', { token: reset, password: newPassword })).status).toBe(200)
    expect((await a.account.request('/ideas')).status).toBe(401)
    expect((await client().request('/auth/reset-password', 'POST', { token: reset, password: newPassword })).status).toBe(400)
    expect((await client().request('/auth/login', 'POST', { username: 'user_a', password })).status).toBe(401)
    expect((await client().request('/auth/login', 'POST', { username: 'user_a', password: newPassword })).status).toBe(200)
  })

  it('不存在或未验证邮箱不发找回邮件，SMTP 未配置对所有邮箱一致报错', async () => {
    const a = await register('user_a', 'owner@example.com')
    const baselineCalls = vi.mocked(mailer.send).mock.calls.length
    const responses = []
    for (const email of ['owner@example.com', 'unknown@example.com']) responses.push(await (await a.account.request('/auth/forgot-password', 'POST', { email })).json())
    expect(responses[0]).toEqual(responses[1])
    expect(vi.mocked(mailer.send).mock.calls.length).toBe(baselineCalls)
    mailer.configured = false
    for (const email of ['owner@example.com', 'unknown@example.com']) {
      expect((await a.account.request('/auth/forgot-password', 'POST', { email })).status).toBe(503)
    }
  })

  it('数据库错误不泄露内部 SQL 或凭据，登录限流受控返回 429', async () => {
    const a = await register('user_a')
    fixture.ideaRepository.list = vi.fn<typeof fixture.ideaRepository.list>().mockRejectedValue(new Error('secret SQL password'))
    const response = await a.account.request('/ideas')
    expect(response.status).toBe(503)
    expect(await response.text()).not.toMatch(/secret|SQL|password/)
    const anonymous = client()
    let last = 0
    for (let index = 0; index < 21; index++) last = (await anonymous.request('/auth/login', 'POST', { username: 'unknown', password })).status
    expect(last).toBe(429)
  })
})

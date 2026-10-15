// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import session from 'express-session'
import { createIdeaServer } from '../backend/app.ts'
import { hashPassword } from '../backend/auth/password.ts'
import { createSecurityRepositories } from './security-fixtures.ts'

let server: http.Server | undefined
let releaseOldDestroy: (() => void) | undefined
let pendingOldRead: Promise<Response> | undefined

afterEach(async () => {
  // 即使断言失败，也释放阻塞请求并关闭随机端口。
  releaseOldDestroy?.()
  await pendingOldRead?.catch(() => undefined)
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
  vi.restoreAllMocks()
})

describe('过期响应与新登录的会话竞态', () => {
  it.each(['disabled', 'version'] as const)('Passport %s 失效身份晚到时不得重新下发旧 SID', async invalidation => {
    const fixtures = createSecurityRepositories()
    const store = new session.MemoryStore()
    const password = 'Revoked session race password 2026!'
    const passwordHash = await hashPassword(password)
    const oldUser = await fixtures.authRepository.create({ username: 'revoked_account', email: null, passwordHash })
    const newUser = await fixtures.authRepository.create({ username: 'fresh_account', email: null, passwordHash })
    server = createIdeaServer(fixtures.ideaRepository, { authRepository: fixtures.authRepository, sessionStore: store,
      sessionSecret: 'revoked-session-race-secret-at-least-32', appOrigin: 'http://127.0.0.1:5173', mailer: { async send() {} } })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const login = (username: string, cookie = '', inputPassword = password) => fetch(`${base}/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ username, password: inputPassword }) })
    const oldCookie = (await login(oldUser.username)).headers.getSetCookie()[0]!.split(';')[0]!
    if (invalidation === 'disabled') oldUser.disabled = true
    else oldUser.authVersion++
    let findStarted!: () => void
    const waiting = new Promise<void>(resolve => { findStarted = resolve })
    const block = new Promise<void>(resolve => { releaseOldDestroy = resolve })
    const originalFind = fixtures.authRepository.findById.bind(fixtures.authRepository)
    let first = true
    vi.spyOn(fixtures.authRepository, 'findById').mockImplementation(async id => {
      if (id === oldUser.userId && first) { first = false; findStarted(); await block }
      return originalFind(id)
    })
    pendingOldRead = fetch(`${base}/ideas`, { headers: { Cookie: oldCookie } })
    await waiting
    const fresh = await login(newUser.username)
    expect(fresh.status).toBe(200)
    const freshCookie = fresh.headers.getSetCookie()[0]!.split(';')[0]!
    releaseOldDestroy!()
    const stale = await pendingOldRead
    expect(stale.status).toBe(401)
    expect(stale.headers.getSetCookie()).toEqual([])
    const current = await fetch(`${base}/auth/session`, { headers: { Cookie: freshCookie } })
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ userId: newUser.userId })
    expect((await fetch(`${base}/ideas`, { headers: { Cookie: oldCookie } })).status).toBe(401)
  })

  it('撤销 Cookie 可直接登录其他账号；无效凭据不设置匿名 Cookie', async () => {
    const fixtures = createSecurityRepositories()
    const store = new session.MemoryStore()
    const password = 'Revoked cookie login password 2026!'
    const passwordHash = await hashPassword(password)
    const oldUser = await fixtures.authRepository.create({ username: 'original_account', email: null, passwordHash })
    await fixtures.authRepository.create({ username: 'next_account', email: null, passwordHash })
    server = createIdeaServer(fixtures.ideaRepository, { authRepository: fixtures.authRepository, sessionStore: store,
      sessionSecret: 'revoked-cookie-login-secret-at-least-32', appOrigin: 'http://127.0.0.1:5173', mailer: { async send() {} } })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const login = (username: string, cookie = '', inputPassword = password) => fetch(`${base}/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ username, password: inputPassword }) })
    for (const invalid of [true, false]) {
      const oldCookie = (await login(oldUser.username)).headers.getSetCookie()[0]!.split(';')[0]!
      oldUser.authVersion++
      const response = await login('next_account', oldCookie, invalid ? 'Incorrect revoked cookie password' : password)
      expect(response.status).toBe(invalid ? 401 : 200)
      if (invalid) assert.deepEqual(response.headers.getSetCookie(), [])
      else {
        const freshCookie = response.headers.getSetCookie()[0]!.split(';')[0]!
        assert.notEqual(freshCookie, oldCookie)
        assert.equal((await fetch(`${base}/auth/session`, { headers: { Cookie: freshCookie } })).status, 200)
      }
      expect((await fetch(`${base}/ideas`, { headers: { Cookie: oldCookie } })).status).toBe(401)
    }
  })

  it('延迟到达的旧 401 不清理或替换新 SID，而旧会话确实撤销', async () => {
    const fixtures = createSecurityRepositories()
    const store = new session.MemoryStore()
    const password = 'Independent session race password 2026!'
    const passwordHash = await hashPassword(password)
    const oldUser = await fixtures.authRepository.create({ username: 'old_account', email: null, passwordHash })
    const newUser = await fixtures.authRepository.create({ username: 'new_account', email: null, passwordHash })
    await fixtures.ideaRepository.create(oldUser.userId, { ideaContent: '旧账号的私有想法' })
    server = createIdeaServer(fixtures.ideaRepository, { authRepository: fixtures.authRepository, sessionStore: store,
      sessionSecret: 'independent-session-race-secret-at-least-32', appOrigin: 'http://127.0.0.1:5173',
      mailer: { async send() {} } })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const login = (username: string) => fetch(`${base}/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
    const oldLogin = await login(oldUser.username)
    expect(oldLogin.status).toBe(200)
    const oldCookie = oldLogin.headers.getSetCookie()[0]!.split(';')[0]!
    const sessions = await new Promise<Record<string, session.SessionData>>((resolve, reject) => {
      store.all((error, values) => error ? reject(error) : resolve(values as Record<string, session.SessionData>))
    })
    const [oldSid, oldData] = Object.entries(sessions)[0]!
    // 保持 Cookie 的存储有效期，单独触发应用的绝对会话期限。
    oldData.authenticatedAt = Date.now() - 9 * 60 * 60 * 1000
    await new Promise<void>((resolve, reject) => store.set(oldSid, oldData, error => error ? reject(error) : resolve()))

    const originalDestroy = store.destroy.bind(store)
    let destroyStarted!: () => void
    const destroyingOld = new Promise<void>(resolve => { destroyStarted = resolve })
    vi.spyOn(store, 'destroy').mockImplementation((sid, callback) => {
      if (sid === oldSid) {
        releaseOldDestroy = () => { releaseOldDestroy = undefined; originalDestroy(sid, callback) }
        destroyStarted()
      } else originalDestroy(sid, callback)
    })
    pendingOldRead = fetch(`${base}/ideas`, { headers: { Cookie: oldCookie } })
    await destroyingOld

    // 新登录完成后才让旧请求返回；HTTP 客户端显式携带各自 Cookie。
    const newLogin = await login(newUser.username)
    expect(newLogin.status).toBe(200)
    const newSetCookie = newLogin.headers.getSetCookie()[0]!
    expect(newSetCookie).toContain('HttpOnly')
    const newCookie = newSetCookie.split(';')[0]!
    expect(newCookie).not.toBe(oldCookie)
    expect(await newLogin.json()).toMatchObject({ userId: newUser.userId })
    releaseOldDestroy!()
    const oldResponse = await pendingOldRead
    expect(oldResponse.status).toBe(401)
    expect(oldResponse.headers.getSetCookie()).toEqual([])
    const destroyed = await new Promise<session.SessionData | null | undefined>((resolve, reject) => {
      store.get(oldSid, (error, value) => error ? reject(error) : resolve(value))
    })
    expect(destroyed).toBeUndefined()
    const current = await fetch(`${base}/auth/session`, { headers: { Cookie: newCookie } })
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ userId: newUser.userId })
    expect((await fetch(`${base}/ideas`, { headers: { Cookie: oldCookie } })).status).toBe(401)
    expect(await (await fetch(`${base}/ideas`, { headers: { Cookie: newCookie } })).json()).toEqual([])

    const logout = await fetch(`${base}/auth/logout`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newCookie }, body: '{}' })
    expect(logout.status).toBe(200)
    expect(logout.headers.getSetCookie()[0]).toContain('idea_purify.sid=;')
    expect((await fetch(`${base}/auth/session`, { headers: { Cookie: newCookie } })).status).toBe(401)
  })

  it('带过期 Cookie 可直接重新登录，错误凭据和非法输入不下发匿名 SID', async () => {
    const fixtures = createSecurityRepositories()
    const store = new session.MemoryStore()
    const password = 'Expired cookie reauthentication password 2026!'
    await fixtures.authRepository.create({ username: 'reauth_account', email: null, passwordHash: await hashPassword(password) })
    server = createIdeaServer(fixtures.ideaRepository, { authRepository: fixtures.authRepository, sessionStore: store,
      sessionSecret: 'independent-expired-login-secret-at-least-32', appOrigin: 'http://127.0.0.1:5173', mailer: { async send() {} } })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const login = (cookie = '', inputPassword = password) => fetch(`${base}/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ username: 'reauth_account', password: inputPassword }) })
    async function expire(cookie: string) {
      const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
      const sid = signed.slice(2, signed.lastIndexOf('.'))
      const data = await new Promise<session.SessionData>((resolve, reject) => store.get(sid, (error, value) => {
        if (error || !value) reject(error ?? new Error('测试会话不存在'))
        else resolve(value)
      }))
      data.authenticatedAt = Date.now() - 9 * 60 * 60 * 1000
      await new Promise<void>((resolve, reject) => store.set(sid, data, error => error ? reject(error) : resolve()))
    }
    let cookie = (await login()).headers.getSetCookie()[0]!.split(';')[0]!
    await expire(cookie)
    const renewed = await login(cookie)
    expect(renewed.status).toBe(200)
    const renewedCookie = renewed.headers.getSetCookie()[0]!.split(';')[0]!
    expect(renewedCookie).not.toBe(cookie)
    expect((await fetch(`${base}/auth/session`, { headers: { Cookie: renewedCookie } })).status).toBe(200)
    cookie = renewedCookie
    for (const [inputPassword, status] of [['Incorrect independent password phrase', 401], ['short', 400]] as const) {
      await expire(cookie)
      const rejected = await login(cookie, inputPassword)
      expect(rejected.status).toBe(status)
      expect(rejected.headers.getSetCookie()).toEqual([])
      expect((await fetch(`${base}/ideas`, { headers: { Cookie: cookie } })).status).toBe(401)
      const fresh = await login()
      expect(fresh.status).toBe(200)
      cookie = fresh.headers.getSetCookie()[0]!.split(';')[0]!
    }
  })
})

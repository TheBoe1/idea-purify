// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import session from 'express-session'
import { createIdeaServer } from '../backend/app.ts'
import { hashPassword } from '../backend/auth/password.ts'
import { getNicknameError } from '../shared/contracts/auth.ts'
import { createSecurityRepositories } from './security-fixtures.ts'

const password = 'Independent profile acceptance password 2026!'
const hashed = hashPassword(password)
let fixtures: ReturnType<typeof createSecurityRepositories>
let server: http.Server
let base: string
let cookie: string
let ownerId: string
let otherId: string

beforeEach(async () => {
  fixtures = createSecurityRepositories()
  const passwordHash = await hashed
  ownerId = (await fixtures.authRepository.create({ username: 'profile_owner', passwordHash, email: null })).userId
  otherId = (await fixtures.authRepository.create({ username: 'other_owner', passwordHash, email: null })).userId
  server = createIdeaServer(fixtures.ideaRepository, { authRepository: fixtures.authRepository,
    sessionStore: new session.MemoryStore(), sessionSecret: 'profile-test-secret-at-least-32-characters',
    appOrigin: 'http://127.0.0.1:5173', mailer: { async send() {} } })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'profile_owner', password }) })
  assert.equal(response.status, 200)
  cookie = response.headers.getSetCookie()[0]!.split(';')[0]!
})
afterEach(async () => {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  vi.restoreAllMocks()
})
const patch = (input: unknown, requestCookie = cookie) => fetch(`${base}/auth/profile`, { method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Cookie: requestCookie }, body: JSON.stringify(input) })

describe('仅本人昵称编辑', () => {
  it('匿名不能修改资料', async () => {
    expect((await patch({ nickname: '未登录' }, '')).status).toBe(401)
  })
  it('Unicode 昵称规范化后保存，登录名、角色、会话和想法归属保持稳定', async () => {
    const idea = await fixtures.ideaRepository.create(ownerId, { ideaContent: '用户的已有想法' })
    const update = vi.spyOn(fixtures.authRepository, 'updateNickname')
    const response = await patch({ nickname: '  小康🌱  ' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ userId: ownerId, nickname: '小康🌱', username: 'profile_owner', role: 'user' })
    expect(update).toHaveBeenCalledWith(ownerId, '小康🌱')
    expect(fixtures.users.get(otherId)?.nickname).toBeUndefined()
    const current = await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } })
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ userId: ownerId, nickname: '小康🌱', username: 'profile_owner' })
    expect(await (await fetch(`${base}/ideas`, { headers: { Cookie: cookie } })).json()).toEqual([idea])
    expect(fixtures.users.get(ownerId)?.authVersion).toBe(1)
    expect(getNicknameError('🌱'.repeat(40))).toBeUndefined()
    expect(getNicknameError('🌱'.repeat(41))).toBeDefined()
  })
  it('非法昵称、其他账户以及敏感字段不能写入', async () => {
    const update = vi.spyOn(fixtures.authRepository, 'updateNickname')
    for (const input of [null, {}, { nickname: 1 }, { nickname: ' ' }, { nickname: '字'.repeat(41) },
      { nickname: '名字\u0000' }, { nickname: '伪装\u202e' }, { nickname: '正常', userId: otherId },
      { nickname: '正常', username: 'new_account' }, { nickname: '正常', role: 'admin' },
      { nickname: '正常', email: 'changed@example.com' }, JSON.parse('{"nickname":"正常","__proto__":{}}')]) {
      expect((await patch(input)).status).toBe(400)
    }
    expect(update).not.toHaveBeenCalled()
    expect(fixtures.users.get(ownerId)?.username).toBe('profile_owner')
  })
  it('数据库失败安全返回错误，不伪造资料保存成功', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(fixtures.authRepository, 'updateNickname').mockRejectedValue(new Error('private SQL password'))
    const response = await patch({ nickname: '新昵称' })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ message: '服务暂时不可用，请稍后重试' })
  })
})

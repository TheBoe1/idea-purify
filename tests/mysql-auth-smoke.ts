import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RowDataPacket } from 'mysql2/promise'
import { createIdeaServer } from '../backend/app.ts'
import { authRepository } from '../backend/db/auth.ts'
import { ideaRepository } from '../backend/db/ideas.ts'
import { db } from '../backend/db/index.ts'
import { createSessionStore } from '../backend/auth/session-store.ts'
import { hashPassword } from '../backend/auth/password.ts'
import type { Mailer } from '../backend/auth/mail.ts'
import type { AuthUser, RegisterResult } from '../shared/contracts/auth.ts'
import type { Idea } from '../shared/contracts/idea.ts'

// Explicitly invoked integration test. Uses real MySQL; mail never leaves this process.
const prefix = `smoke_${randomBytes(6).toString('hex')}`
const names = [`${prefix}_a`, `${prefix}_b`, `${prefix}_admin`]
const password = randomBytes(24).toString('base64url')
const origin = 'http://127.0.0.1:5174'
const ttl = 60 * 60 * 1000
const secret = randomBytes(32).toString('hex')
const userIds = new Set<string>()
const sessionIds = new Set<string>()
const mail: { to: string; purpose: string; link: string }[] = []
const mailer: Mailer = { configured: true, async send(to, purpose, link) { mail.push({ to, purpose, link }) } }
let server: http.Server | undefined
let sessionStore: ReturnType<typeof createSessionStore> | undefined
let base = ''
let completed = false

async function start() {
  sessionStore = createSessionStore(ttl)
  server = createIdeaServer(ideaRepository, { authRepository, mailer, sessionStore, sessionSecret: secret,
    appOrigin: origin, sessionTtlMs: ttl })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
async function stop() {
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
  await sessionStore?.close()
  server = undefined
  sessionStore = undefined
}
function client() {
  let cookie = ''
  let sessionId = ''
  return {
    get cookie() { return cookie },
    get sessionId() { return sessionId },
    async request(path: string, method = 'GET', input?: unknown, requestOrigin = origin) {
      const headers: Record<string, string> = { Origin: requestOrigin, 'Content-Type': 'application/json' }
      if (cookie) headers.Cookie = cookie
      const init: RequestInit = { method, headers }
      if (input !== undefined && method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(input)
      const response = await fetch(`${base}${path}`, init)
      const setCookie = response.headers.getSetCookie()[0]
      if (setCookie) {
        cookie = setCookie.split(';')[0]!
        const value = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
        if (value.startsWith('s:')) {
          sessionId = value.slice(2, value.lastIndexOf('.'))
          sessionIds.add(sessionId)
        }
      }
      return response
    },
  }
}
function mailedToken(purpose: string) {
  const message = mail.findLast(item => item.purpose === purpose)
  assert(message, `No stub mail for ${purpose}`)
  return new URL(message.link).searchParams.get('token')!
}
async function register(username: string, email?: string) {
  const account = client()
  const response = await account.request('/auth/register', 'POST', { username, password, email, role: 'admin' })
  assert.equal(response.status, 201)
  const result = await response.json() as RegisterResult
  userIds.add(result.user.userId)
  assert.equal(result.user.role, 'user')
  return { account, user: result.user, result }
}
async function create(account: ReturnType<typeof client>, content: string, userId?: string) {
  const response = await account.request('/idea', 'POST', { ideaContent: content, userId })
  assert.equal(response.status, 201)
  return await response.json() as Idea
}

try {
  const [legacy] = await db.query<RowDataPacket[]>('SELECT id, idea_content, create_time FROM idea WHERE user_id IS NULL ORDER BY id')
  await start()
  const anonymous = client()
  assert.equal((await anonymous.request('/ideas')).status, 401)
  assert.equal((await anonymous.request('/auth/register', 'POST', { username: names[0], password }, 'https://attacker.invalid')).status, 403)
  const a = await register(names[0]!, `${names[0]}@example.invalid`)
  const b = await register(names[1]!)
  assert.equal(b.result.emailDelivery, 'none')
  assert.equal(mail.length, 1)
  assert.equal((await a.account.request('/admin/users')).status, 403)
  const recordA = await authRepository.findById(a.user.userId)
  const recordB = await authRepository.findById(b.user.userId)
  assert(recordA && recordB)
  assert(recordA.passwordHash.startsWith('$argon2id$'))
  assert.notEqual(recordA.passwordHash, recordB.passwordHash)
  assert(!recordA.passwordHash.includes(password))

  const sqlXss = "<img src=x onerror=alert(1)> '); DROP TABLE idea; -- ?"
  const injection = await create(a.account, sqlXss, b.user.userId)
  const dated = await create(a.account, 'dated earlier')
  const missingZ = await create(a.account, 'zz no time')
  const missingA = await create(a.account, 'Aa no time')
  await db.execute('UPDATE idea SET create_time = ? WHERE user_id = ? AND id = ?', ['2026-01-02 00:00:00', a.user.userId, injection.ideaId])
  await db.execute('UPDATE idea SET create_time = ? WHERE user_id = ? AND id = ?', ['2026-01-01 00:00:00', a.user.userId, dated.ideaId])
  for (const item of [missingZ, missingA]) await db.execute('UPDATE idea SET create_time = NULL WHERE user_id = ? AND id = ?', [a.user.userId, item.ideaId])
  const list = await (await a.account.request('/ideas')).json() as Idea[]
  assert.deepEqual(list.map(idea => idea.ideaId), [injection.ideaId, dated.ideaId, missingA.ideaId, missingZ.ideaId])
  assert.equal(list[0]!.ideaContent, sqlXss)
  assert.equal(list[2]!.createdTime, '')
  assert.deepEqual(await (await b.account.request('/ideas')).json(), [])
  assert.equal((await b.account.request(`/ideas/${injection.ideaId}`)).status, 404)
  assert.equal((await a.account.request(`/ideas/${injection.ideaId}`)).status, 200)
  if (legacy.length) assert.equal((await a.account.request(`/ideas/${String(legacy[0]!.id)}`)).status, 404)
  console.log('PASS: real MySQL password hashing, parameterized content, ownership and sorting')

  // New server and store instances reuse the same MySQL-backed session without logging in again.
  const aCookie = a.account.cookie
  await stop()
  await start()
  assert.equal((await a.account.request('/auth/session')).status, 200)
  assert.equal(a.account.cookie, aCookie)
  assert.equal((await a.account.request('/ideas')).status, 200)
  console.log('PASS: MySQL session survives HTTP server/store restart')

  const verification = mailedToken('verify-email')
  assert.equal((await a.account.request('/auth/verify-email', 'POST', { token: verification })).status, 200)
  assert.equal((await a.account.request('/auth/verify-email', 'POST', { token: verification })).status, 400)
  assert.equal((await a.account.request('/auth/forgot-password', 'POST', { email: a.user.email })).status, 200)
  const resetToken = mailedToken('reset-password')
  const resetHash = createHash('sha256').update(resetToken).digest()
  const [storedTokens] = await db.execute<RowDataPacket[]>('SELECT token_hash FROM auth_email_token WHERE user_id = ? AND purpose = ?', [a.user.userId, 'reset-password'])
  assert.equal(storedTokens.length, 1)
  assert(Buffer.from(storedTokens[0]!.token_hash).equals(resetHash))
  const newPassword = randomBytes(24).toString('base64url')
  const resetResponses = await Promise.all([0, 1].map(() => anonymous.request('/auth/reset-password', 'POST', { token: resetToken, password: newPassword })))
  assert.deepEqual(resetResponses.map(response => response.status).sort(), [200, 400])
  assert.equal((await a.account.request('/ideas')).status, 401)
  assert.equal((await anonymous.request('/auth/login', 'POST', { username: names[0], password })).status, 401)
  assert.equal((await a.account.request('/auth/login', 'POST', { username: names[0], password: newPassword })).status, 200)
  const expiredToken = randomBytes(32).toString('base64url')
  await authRepository.issueEmailToken(a.user.userId, 'reset-password', createHash('sha256').update(expiredToken).digest(), new Date(Date.now() - 60_000))
  assert.equal((await anonymous.request('/auth/reset-password', 'POST', { token: expiredToken, password: newPassword })).status, 400)
  console.log('PASS: real token transaction is one-time even under concurrent reset; passwords and sessions revoked')

  const admin = await authRepository.create({ username: names[2]!, email: null, passwordHash: await hashPassword(password), role: 'admin' })
  userIds.add(admin.userId)
  const adminClient = client()
  assert.equal((await adminClient.request('/auth/login', 'POST', { username: names[2], password })).status, 200)
  const users = await (await adminClient.request('/admin/users')).json() as AuthUser[]
  assert(users.some(user => user.userId === a.user.userId))
  assert(users.every(user => !('passwordHash' in user)))
  assert.deepEqual(await (await adminClient.request('/ideas')).json(), [])
  assert.equal((await adminClient.request(`/ideas/${injection.ideaId}`)).status, 404)
  assert.equal((await adminClient.request(`/admin/users/${admin.userId}/status`, 'PATCH', { disabled: true })).status, 403)
  assert.equal((await adminClient.request(`/admin/users/${b.user.userId}/status`, 'PATCH', { disabled: true })).status, 200)
  assert.equal((await b.account.request('/ideas')).status, 401)
  assert.equal((await anonymous.request('/auth/login', 'POST', { username: names[1], password })).status, 401)
  console.log('PASS: admin can disable test user, cannot read user ideas or disable itself')

  const [sessions] = await db.execute<RowDataPacket[]>('SELECT data FROM auth_session WHERE session_id = ?', [a.account.sessionId])
  assert.equal(sessions.length, 1)
  const stored = JSON.parse(sessions[0]!.data as string)
  stored.authenticatedAt = Date.now() - ttl - 1000
  await db.execute('UPDATE auth_session SET data = ? WHERE session_id = ?', [JSON.stringify(stored), a.account.sessionId])
  assert.equal((await a.account.request('/ideas')).status, 401)
  const [legacyAfter] = await db.query<RowDataPacket[]>('SELECT id, idea_content, create_time FROM idea WHERE user_id IS NULL ORDER BY id')
  assert.deepEqual(legacyAfter, legacy)
  completed = true
  console.log('PASS: absolute expiry returns 401; unowned legacy ideas preserved')
} catch (error) {
  console.error('FAIL: MySQL integration assertion failed:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
} finally {
  try {
    await stop()
    // Exact random names recover IDs if a response was interrupted after registration.
    for (const name of names) {
      const user = await authRepository.findByUsername(name)
      if (user) userIds.add(user.userId)
    }
    for (const id of sessionIds) await db.execute('DELETE FROM auth_session WHERE session_id = ?', [id])
    for (const id of userIds) {
      await db.execute('DELETE FROM auth_email_token WHERE user_id = ?', [id])
      await db.execute('DELETE FROM idea WHERE user_id = ?', [id])
      await db.execute('DELETE FROM app_user WHERE id = ?', [id])
    }
    console.log(`Cleanup: ${userIds.size} test accounts and only their data/sessions removed. SMTP was an in-process stub.`)
  } catch {
    console.error('Cleanup failed; inspect only the exact test prefix:', prefix)
    process.exitCode = 1
  } finally { await db.end() }
  if (completed && !process.exitCode) console.log('Real MySQL/HTTP integration smoke passed. Real SMTP delivery is not verified.')
}

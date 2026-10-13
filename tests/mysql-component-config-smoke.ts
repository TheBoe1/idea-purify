import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RowDataPacket } from 'mysql2/promise'
import { createIdeaServer } from '../backend/app.ts'
import { authRepository } from '../backend/db/auth.ts'
import { componentConfigRepository } from '../backend/db/component-configs.ts'
import { ideaRepository } from '../backend/db/ideas.ts'
import { db } from '../backend/db/index.ts'
import { createSessionStore } from '../backend/auth/session-store.ts'
import { hashPassword } from '../backend/auth/password.ts'
import { COMPONENT_DEFINITIONS, isComponentConfig } from '../shared/contracts/component-config.ts'
import type { ComponentConfig, ComponentSchema } from '../shared/contracts/component-config.ts'

// Explicit invocation only: random test accounts/configs, exact cleanup, no external mail.
const prefix = `cfg_smoke_${randomBytes(5).toString('hex')}`
const names = [`${prefix}_admin`, `${prefix}_user`]
const password = randomBytes(24).toString('base64url')
const userIds = new Set<string>()
const sessionIds = new Set<string>()
const configIds = new Set<string>()
const sessionStore = createSessionStore(3_600_000)
let server: http.Server | undefined
let base = ''
let completed = false

function snapshotHash(rows: RowDataPacket[]): string { return createHash('sha256').update(JSON.stringify(rows)).digest('hex') }
async function ideaSnapshot(): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, idea_content, create_time, user_id FROM idea ORDER BY id')
  return snapshotHash(rows)
}
async function definitionSnapshot(): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT component_key, library_key, schema_version, metadata_json FROM component_definition ORDER BY component_key')
  return snapshotHash(rows)
}
function client() {
  let cookie = ''
  return {
    async request(path: string, method = 'GET', input?: unknown) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
      const setCookie = response.headers.getSetCookie()[0]
      if (setCookie) {
        cookie = setCookie.split(';')[0]!
        const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
        if (signed.startsWith('s:')) sessionIds.add(signed.slice(2, signed.lastIndexOf('.')))
      }
      return response
    },
  }
}
async function readConfig(response: Response, expectedStatus: number): Promise<ComponentConfig> {
  assert.equal(response.status, expectedStatus, 'Unexpected configuration HTTP status')
  const value: unknown = await response.json()
  assert(isComponentConfig(value), 'Configuration response must satisfy shared contract')
  return value
}

try {
  const ideasBefore = await ideaSnapshot()
  const definitionsBefore = await definitionSnapshot()
  const passwordHash = await hashPassword(password)
  for (const [index, username] of names.entries()) {
    const user = await authRepository.create({ username, email: null, passwordHash, role: index === 0 ? 'admin' : 'user' })
    userIds.add(user.userId)
  }
  const [adminId, normalId] = [...userIds]
  assert(adminId && normalId)
  server = createIdeaServer(ideaRepository, { authRepository, componentConfigRepository, sessionStore,
    sessionSecret: randomBytes(32).toString('hex'), appOrigin: 'http://127.0.0.1:5173',
    mailer: { configured: false, async send() { throw new Error('Smoke test must not send external email') } } })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const anonymous = client()
  const admin = client()
  const normal = client()
  assert.equal((await anonymous.request('/component-configs')).status, 401, 'Anonymous config read must be protected')
  assert.equal((await admin.request('/auth/login', 'POST', { username: names[0], password })).status, 200)
  assert.equal((await normal.request('/auth/login', 'POST', { username: names[1], password })).status, 200)
  const definitions = await (await normal.request('/component-definitions')).json() as { componentKey: string }[]
  assert.deepEqual(definitions.map(item => item.componentKey).sort(), COMPONENT_DEFINITIONS.map(item => item.componentKey).sort())

  const schema: ComponentSchema = { schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'input',
    name: `<img src=x onerror=alert(1)> '); DROP TABLE idea; --`,
    props: { placeholder: "' OR 1=1 --", clearable: true, maxlength: 120 }, field: 'title',
    validation: { minLength: 2, maxLength: 120 }, children: [], actions: [] }
  assert.equal((await normal.request('/admin/component-configs', 'POST', { schema })).status, 403, 'Normal user must not create shared config')
  const saved = await readConfig(await admin.request('/admin/component-configs', 'POST', { schema }), 201)
  configIds.add(saved.configId)
  assert.deepEqual(saved.schema, schema, 'Prepared SQL must preserve text without executing it')
  const again = await readConfig(await normal.request(`/component-configs/${saved.configId}`), 200)
  assert.deepEqual(again, saved, 'Saved config must reload from real MySQL for another logged-in user')
  const second = await readConfig(await admin.request('/admin/component-configs', 'POST', { schema: { ...schema, name: `${prefix}_second` } }), 201)
  configIds.add(second.configId)
  assert.notEqual(second.configId, saved.configId, 'One component definition must support multiple instances')

  const updatedSchema: ComponentSchema = { ...schema, name: `${prefix}_updated`, props: { placeholder: '新的持久化提示', maxlength: 120 } }
  const updated = await readConfig(await admin.request(`/admin/component-configs/${saved.configId}`, 'PUT', { schema: updatedSchema }), 200)
  assert.equal(updated.configId, saved.configId)
  assert.equal(updated.createdTime, saved.createdTime)
  assert.deepEqual((await readConfig(await normal.request(`/component-configs/${saved.configId}`), 200)).schema, updatedSchema)
  assert.equal((await normal.request(`/admin/component-configs/${saved.configId}`, 'PUT', { schema })).status, 403)
  const [owners] = await db.execute<RowDataPacket[]>('SELECT created_by, updated_by FROM component_config WHERE id = ?', [saved.configId])
  assert.equal(owners[0]?.created_by, adminId, 'Create audit identity must come from administrator session')
  assert.equal(owners[0]?.updated_by, adminId)

  const button: ComponentSchema = { schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'button',
    name: `${prefix}_button`, props: { text: '<script>alert(1)</script>', type: 'primary' }, children: [],
    actions: [{ event: 'click', actionKey: 'show-message', message: '固定提示，仅文本' }] }
  const savedButton = await readConfig(await admin.request('/admin/component-configs', 'POST', { schema: button }), 201)
  configIds.add(savedButton.configId)
  assert.deepEqual((await readConfig(await normal.request(`/component-configs/${savedButton.configId}`), 200)).schema, button)
  assert.equal((await admin.request('/admin/component-configs', 'POST', { schema: { ...schema, props: { onInput: 'alert(1)' } } })).status, 400)
  assert.equal((await admin.request('/admin/component-configs', 'POST', { schema, createdBy: normalId })).status, 400)
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM component_config WHERE created_by = ?', [adminId])
  assert.equal(rows.length, 3, 'Rejected writes must not add a config row')

  // Corrupt only this test's instance to confirm persistence validation is enforced on reads.
  await db.execute('UPDATE component_config SET schema_json = ? WHERE id = ? AND created_by = ?',
    [JSON.stringify({ ...updatedSchema, schemaVersion: 99 }), saved.configId, adminId])
  const corrupt = await normal.request(`/component-configs/${saved.configId}`)
  assert.equal(corrupt.status, 503, 'Invalid stored schema must return safe error')
  assert.deepEqual(await corrupt.json(), { message: '服务暂时不可用，请稍后重试' })
  await db.execute('UPDATE component_config SET schema_json = ? WHERE id = ? AND created_by = ?', [JSON.stringify(updatedSchema), saved.configId, adminId])
  assert.equal((await normal.request(`/component-configs/${saved.configId}`)).status, 200)
  assert.equal(await definitionSnapshot(), definitionsBefore, 'Instance writes must not mutate component definitions')
  assert.equal(await ideaSnapshot(), ideasBefore, 'Configuration flows must not mutate existing idea rows')
  completed = true
  console.log('PASS: real MySQL config create/update/reload, shared read/admin write, parameterized text, separate definitions/instances, stored-schema safety and all existing Idea rows preserved')
} catch (error) {
  const code = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'UNKNOWN'
  console.error('FAIL: MySQL component config smoke:', code)
  if (error instanceof assert.AssertionError) {
    const locations = error.stack?.split('\n').filter(line => line.includes('mysql-component-config-smoke.ts:'))
    const location = locations?.[locations.length - 1]?.trim()
    const scalar = (value: unknown) => typeof value === 'number' || typeof value === 'boolean' ? value : '[non-scalar omitted]'
    console.error('Assertion:', error.message.split('\n')[0], location ?? 'location unavailable',
      { actual: scalar(error.actual), expected: scalar(error.expected) })
  }
  process.exitCode = 1
} finally {
  try {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    await sessionStore.close()
    // Recover only the exact random test usernames if a HTTP response was interrupted.
    for (const username of names) {
      const user = await authRepository.findByUsername(username)
      if (user) userIds.add(user.userId)
    }
    for (const id of configIds) await db.execute('DELETE FROM component_config WHERE id = ? AND created_by IN (?, ?)', [id, ...userIds])
    for (const id of sessionIds) await db.execute('DELETE FROM auth_session WHERE session_id = ?', [id])
    for (const id of userIds) {
      await db.execute('DELETE FROM component_config WHERE created_by = ?', [id])
      await db.execute('DELETE FROM auth_email_token WHERE user_id = ?', [id])
      await db.execute('DELETE FROM app_user WHERE id = ?', [id])
    }
    console.log('Cleanup: only exact random test accounts, config instances and sessions removed; no external mail sent.')
  } catch {
    console.error('Cleanup failed; inspect only the exact test prefix:', prefix)
    process.exitCode = 1
  } finally { await db.end() }
  if (completed && !process.exitCode) console.log('Real MySQL component config smoke passed.')
}

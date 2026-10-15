import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RowDataPacket } from 'mysql2/promise'
import { createIdeaServer } from '../backend/app.ts'
import { authRepository } from '../backend/db/auth.ts'
import { componentConfigRepository } from '../backend/db/component-configs.ts'
import { workbenchRepository } from '../backend/db/workbench.ts'
import { ideaRepository } from '../backend/db/ideas.ts'
import { db } from '../backend/db/index.ts'
import { createSessionStore } from '../backend/auth/session-store.ts'
import { hashPassword } from '../backend/auth/password.ts'
import { createDefaultSchemaV2, isPageConfig, isPublishedPage, isWorkbenchTemplate } from '../shared/contracts/workbench.ts'
import type { PageConfig, PageTarget, SchemaV2, WorkbenchTemplate } from '../shared/contracts/workbench.ts'

// Explicit invocation only. Every mutation is limited to random test-owned rows.
// Existing Ideas, accounts, definitions and published pages are only fingerprinted.
const prefix = `wb_smoke_${randomBytes(5).toString('hex')}`
const names = [`${prefix}_admin`, `${prefix}_user`]
const password = randomBytes(24).toString('base64url')
const users = new Set<string>()
const sessions = new Set<string>()
const templates = new Set<string>()
const pages = new Set<string>()
const store = createSessionStore(3_600_000)
const servers: http.Server[] = []
let base = ''
let completed = false
let before = ''
const hash = (rows: unknown) => createHash('sha256').update(JSON.stringify(rows)).digest('hex')
async function existingSnapshot(): Promise<string> {
  const snapshots = []
  for (const sql of [
    'SELECT id, idea_content, create_time, user_id FROM idea ORDER BY id',
    'SELECT component_key, library_key, library_version, schema_version, metadata_json FROM component_definition ORDER BY component_key',
    'SELECT id, component_key, schema_version, schema_json, revision, created_by, updated_by, created_time, updated_time FROM component_config ORDER BY id',
    'SELECT * FROM ui_page_config ORDER BY id',
    'SELECT id, username, nickname, email, email_verified, password_hash, role, disabled, auth_version, created_time FROM app_user ORDER BY id',
  ]) { const [rows] = await db.query<RowDataPacket[]>(sql); snapshots.push(rows) }
  return hash(snapshots)
}
function client() {
  let cookie = ''
  return {
    async request(path: string, method = 'GET', input?: unknown) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
      const header = response.headers.getSetCookie()[0]
      if (header) {
        cookie = header.split(';')[0]!
        const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
        if (signed.startsWith('s:')) sessions.add(signed.slice(2, signed.lastIndexOf('.')))
      }
      return response
    },
  }
}
async function read<T>(response: Response, status: number, guard: (input: unknown) => input is T): Promise<T> {
  assert.equal(response.status, status, 'Unexpected workbench HTTP status')
  const value: unknown = await response.json()
  assert(guard(value), 'Workbench response must satisfy shared contract')
  return value
}
async function template(response: Response, status: number): Promise<WorkbenchTemplate> { return read(response, status, isWorkbenchTemplate) }
async function page(response: Response, status: number): Promise<PageConfig> { return read(response, status, isPageConfig) }
async function published(response: Response) { return read(response, 200, isPublishedPage) }
async function listen(server: http.Server) {
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

try {
  before = await existingSnapshot()
  const passwordHash = await hashPassword(password)
  for (const [index, username] of names.entries()) users.add((await authRepository.create({ username, email: null, passwordHash, role: index ? 'user' : 'admin' })).userId)
  const [adminId, normalId] = [...users]
  assert(adminId && normalId)
  const options = { authRepository, componentConfigRepository, workbenchRepository, sessionStore: store,
    sessionSecret: randomBytes(32).toString('hex'), appOrigin: 'http://127.0.0.1:5175',
    mailer: { configured: false, async send() { throw new Error('Smoke tests must not send external email') } } }
  await listen(createIdeaServer(ideaRepository, options))
  const anon = client(); const admin = client(); const normal = client()
  assert.equal((await anon.request('/admin/catalog')).status, 401)
  assert.equal((await admin.request('/auth/login', 'POST', { username: names[0], password })).status, 200)
  assert.equal((await normal.request('/auth/login', 'POST', { username: names[1], password })).status, 200)
  for (const path of ['/admin/catalog', '/admin/templates', '/admin/page-configs', '/component-definitions', '/component-configs']) {
    assert.equal((await normal.request(path)).status, 403, 'Ordinary accounts must not read management drafts')
  }
  const catalog = await admin.request('/admin/catalog')
  assert.equal(catalog.status, 200); assert.equal((await catalog.json() as unknown[]).length, 82)

  const schema: SchemaV2 = createDefaultSchemaV2(`${prefix}_template`)
  schema.root = [{ nodeId: 'notice', kind: 'component', apiKey: 'alert', props: {
    title: { kind: 'literal', value: "' OR 1=1 -- <script>alert(1)</script>" }, type: { kind: 'literal', value: 'success' },
  } }]
  assert.equal((await normal.request('/admin/templates', 'POST', { schema })).status, 403)
  const saved = await template(await admin.request('/admin/templates', 'POST', { schema }), 201)
  templates.add(saved.configId)
  assert.deepEqual((await template(await admin.request(`/admin/templates/${saved.configId}`), 200)).schema, schema)
  const edited = await template(await admin.request(`/admin/templates/${saved.configId}`, 'PUT', { schema: { ...schema, name: '新方案' }, expectedRevision: saved.revision }), 200)
  assert.equal(edited.revision, saved.revision + 1)
  assert.equal((await admin.request(`/admin/templates/${saved.configId}`, 'PUT', { schema, expectedRevision: saved.revision })).status, 409)
  const [audit] = await db.execute<RowDataPacket[]>('SELECT created_by, updated_by FROM component_config WHERE id = ?', [saved.configId])
  assert.equal(audit[0]?.created_by, adminId); assert.equal(audit[0]?.updated_by, adminId)

  // The legacy editor and V2 workbench use the same revision counter.
  const legacySchema = { schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'input', name: `${prefix}_legacy`, props: {}, children: [] }
  const legacyResponse = await admin.request('/admin/component-configs', 'POST', { schema: legacySchema })
  assert.equal(legacyResponse.status, 201)
  const legacy = await legacyResponse.json() as { configId: string }; templates.add(legacy.configId)
  const legacyBefore = await template(await admin.request(`/admin/templates/${legacy.configId}`), 200)
  assert.equal(legacyBefore.schema.schemaVersion, 1)
  assert.equal((await admin.request(`/admin/component-configs/${legacy.configId}`, 'PUT', { schema: { ...legacySchema, name: 'Legacy 修改' } })).status, 200)
  const legacyAfter = await template(await admin.request(`/admin/templates/${legacy.configId}`), 200)
  assert.equal(legacyAfter.revision, legacyBefore.revision + 1)
  assert.equal((await admin.request(`/admin/templates/${legacy.configId}`, 'PUT', { schema, expectedRevision: legacyBefore.revision })).status, 409)
  assert.equal((await template(await admin.request(`/admin/templates/${legacy.configId}`), 200)).schema.name, 'Legacy 修改')

  // Use a unique dynamic page and one unused registered region; never alter an existing page.
  const targets: PageTarget[] = [{ kind: 'dynamic', pageKey: prefix.replaceAll('_', '-'), regionKey: 'root' }]
  const [existing] = await db.query<RowDataPacket[]>('SELECT page_key AS pageKey, region_key AS regionKey FROM ui_page_config WHERE target_kind = ?', ['existing'])
  const possible: PageTarget[] = [{ kind: 'existing', pageKey: 'home', regionKey: 'after-entry' },
    { kind: 'existing', pageKey: 'archive', regionKey: 'before-list' }, { kind: 'existing', pageKey: 'archive', regionKey: 'after-list' },
    { kind: 'existing', pageKey: 'ideas', regionKey: 'before-grid' }, { kind: 'existing', pageKey: 'ideas', regionKey: 'after-grid' },
    { kind: 'existing', pageKey: 'idea-detail', regionKey: 'after-detail' }]
  const available = possible.find(value => !existing.some(row => row.pageKey === value.pageKey && row.regionKey === value.regionKey))
  assert(available, 'An unused registered region is required; existing configurations must never be changed by this test')
  targets.push(available)
  for (const target of targets) {
    const path = target.kind === 'dynamic' ? `/ui/pages/${target.pageKey}` : `/ui/regions/${target.pageKey}/${target.regionKey}`
    const draft = await page(await admin.request('/admin/page-configs', 'POST', { name: `${prefix}_page`, target, schema }), 201)
    pages.add(draft.pageConfigId)
    assert.equal((await anon.request(path)).status, 401)
    assert.equal((await normal.request(path)).status, 404, 'Draft must not become readable before publication')
    assert.equal((await normal.request(`/admin/page-configs/${draft.pageConfigId}/publish`, 'POST', { expectedRevision: 1 })).status, 403)
    await page(await admin.request(`/admin/page-configs/${draft.pageConfigId}/publish`, 'POST', { expectedRevision: draft.draftRevision }), 200)
    const live = await published(await normal.request(path))
    assert.deepEqual(live.schema, schema); assert.equal(live.publishedRevision, 1)
    assert(!('draftRevision' in live), 'Runtime responses must not contain draft state')
    const changedSchema = { ...schema, name: '仅草稿修改' }
    const changed = await page(await admin.request(`/admin/page-configs/${draft.pageConfigId}`, 'PUT', { name: '未发布名称', schema: changedSchema, expectedRevision: 1 }), 200)
    assert.equal(changed.status, 'changed'); assert.equal(changed.draftRevision, 2)
    assert.deepEqual(await published(await normal.request(path)), live, 'Draft modification must not mutate the frozen published snapshot')
    assert.equal((await admin.request(`/admin/page-configs/${draft.pageConfigId}/publish`, 'POST', { expectedRevision: 1 })).status, 409)
    await page(await admin.request(`/admin/page-configs/${draft.pageConfigId}/publish`, 'POST', { expectedRevision: 2 }), 200)
    const republished = await published(await normal.request(path))
    assert.equal(republished.name, '未发布名称'); assert.equal(republished.publishedRevision, 2)
    assert.deepEqual(republished.schema, changedSchema)
  }
  assert.equal((await admin.request('/admin/page-configs', 'POST', { name: '非法路由', target: { kind: 'existing', pageKey: 'admin', regionKey: 'root' }, schema })).status, 400)
  for (const invalid of [{ ...schema, libraryVersion: 'unknown' }, { ...schema, state: { malicious: { kind: 'javascript', value: 'eval()' } } },
    { ...schema, root: [{ nodeId: 'bad', kind: 'component', apiKey: 'image', props: { src: { kind: 'literal', value: 'javascript:alert(1)' } } }] }]) {
    assert.equal((await admin.request('/admin/templates', 'POST', { schema: invalid })).status, 400)
  }
  // Corrupt only the exact random test-owned template; reads must reject stored tampering.
  await db.execute('UPDATE component_config SET schema_json = ? WHERE id = ? AND created_by = ?', [JSON.stringify({ ...schema, libraryVersion: 'unknown' }), saved.configId, adminId])
  const corrupt = await admin.request(`/admin/templates/${saved.configId}`)
  assert.equal(corrupt.status, 503); assert.deepEqual(await corrupt.json(), { message: '服务暂时不可用，请稍后重试' })

  // A read-only invalid-column query proves real DB failures produce the same safe HTTP error.
  await listen(createIdeaServer(ideaRepository, { ...options, workbenchRepository: { ...workbenchRepository,
    async listPages() { await db.query('SELECT workbench_smoke_nonexistent_column FROM ui_page_config LIMIT 0'); return [] } } }))
  const failed = await admin.request('/admin/page-configs')
  assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { message: '服务暂时不可用，请稍后重试' })
  completed = true
  console.log('PASS: real MySQL V2 templates, legacy revision conflict, both mounts, private drafts, immutable publication, safe stored-schema / SQL failures, session audit identities.')
} catch (error) {
  console.error('FAIL: MySQL workbench smoke:', error instanceof assert.AssertionError ? 'AssertionError' : error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'UNKNOWN')
  if (error instanceof assert.AssertionError) {
    const location = error.stack?.split('\n').find(line => line.includes('mysql-workbench-smoke.ts:'))?.trim()
    console.error('Assertion:', error.message.split('\n')[0], location ?? 'location unavailable')
  }
  process.exitCode = 1
} finally {
  try {
    for (const server of servers) if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await store.close()
    // Recover test-owned rows if an HTTP response was interrupted before its ID was captured.
    for (const username of names) { const user = await authRepository.findByUsername(username); if (user) users.add(user.userId) }
    for (const userId of users) {
      await db.execute('DELETE FROM ui_page_config WHERE created_by = ?', [userId])
      await db.execute('DELETE FROM component_config WHERE created_by = ?', [userId])
      await db.execute('DELETE FROM auth_email_token WHERE user_id = ?', [userId])
    }
    for (const sessionId of sessions) await db.execute('DELETE FROM auth_session WHERE session_id = ?', [sessionId])
    for (const userId of users) await db.execute('DELETE FROM app_user WHERE id = ?', [userId])
    assert.equal(await existingSnapshot(), before, 'All pre-existing data and definitions must retain the exact fingerprint after cleanup')
    console.log('Cleanup: exact random test accounts, drafts, pages and sessions removed; pre-existing data fingerprints unchanged; no mail sent.')
  } catch { console.error('Cleanup or preservation check failed; inspect only this random test prefix:', prefix); process.exitCode = 1 }
  finally { await db.end() }
  if (completed && !process.exitCode) console.log('Real MySQL workbench smoke passed.')
}

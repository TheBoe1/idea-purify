// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import session from 'express-session'
import { createIdeaServer } from '../backend/app.ts'
import { hashPassword } from '../backend/auth/password.ts'
import { WorkbenchConflictError } from '../backend/component-config/errors.ts'
import type { WorkbenchRepository } from '../backend/db/workbench.ts'
import { ELEMENT_PLUS_CATALOG } from '../shared/catalog/element-plus.ts'
import { createDefaultSchemaV2, isPublishedPage } from '../shared/contracts/workbench.ts'
import type { PageConfig, PublishedPage, WorkbenchTemplate } from '../shared/contracts/workbench.ts'
import { createSecurityRepositories } from './security-fixtures.ts'

const id = '9a531641-f828-4cb9-b2b3-ea34c8ef11dd'
const schema = createDefaultSchemaV2('HTTP 验收方案')
const time = '2026-10-15T00:00:00.000Z'
const target = { kind: 'dynamic' as const, pageKey: 'acceptance', regionKey: 'root' as const }
const template: WorkbenchTemplate = { configId: id, schema, revision: 1, createdTime: time, updatedTime: time }
const page: PageConfig = { pageConfigId: id, name: '独立页面', target, schema, draftRevision: 1, publishedRevision: null,
  publishedTime: null, status: 'draft', createdTime: time, updatedTime: time }
const published: PublishedPage = { pageConfigId: id, name: '独立页面', target, schema, publishedRevision: 1, publishedTime: time }
const repository = {
  listCatalog: vi.fn<WorkbenchRepository['listCatalog']>(),
  listTemplates: vi.fn<WorkbenchRepository['listTemplates']>(),
  findTemplate: vi.fn<WorkbenchRepository['findTemplate']>(),
  createTemplate: vi.fn<WorkbenchRepository['createTemplate']>(),
  updateTemplate: vi.fn<WorkbenchRepository['updateTemplate']>(),
  listPages: vi.fn<WorkbenchRepository['listPages']>(),
  findPage: vi.fn<WorkbenchRepository['findPage']>(),
  createPage: vi.fn<WorkbenchRepository['createPage']>(),
  updatePage: vi.fn<WorkbenchRepository['updatePage']>(),
  publishPage: vi.fn<WorkbenchRepository['publishPage']>(),
  findPublished: vi.fn<WorkbenchRepository['findPublished']>(),
}
let server: http.Server
let base: string
let adminCookie: string
let userCookie: string
let adminId: string
const password = 'Workbench acceptance password 2026!'

async function request(path: string, cookie = adminCookie, method = 'GET', body?: unknown) {
  return fetch(`${base}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
beforeAll(async () => {
  const fixtures = createSecurityRepositories()
  const passwordHash = await hashPassword(password)
  adminId = (await fixtures.authRepository.create({ username: 'workbench_admin', role: 'admin', email: null, passwordHash })).userId
  await fixtures.authRepository.create({ username: 'workbench_user', email: null, passwordHash })
  server = createIdeaServer(fixtures.ideaRepository, { authRepository: fixtures.authRepository, workbenchRepository: repository,
    sessionStore: new session.MemoryStore(), sessionSecret: 'workbench-http-test-secret-at-least-32-characters', appOrigin: 'http://127.0.0.1:5175', mailer: { async send() {} } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  for (const username of ['workbench_admin', 'workbench_user']) {
    const response = await request('/auth/login', '', 'POST', { username, password })
    assert.equal(response.status, 200)
    const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!
    if (username === 'workbench_admin') adminCookie = cookie; else userCookie = cookie
  }
})
beforeEach(() => {
  Object.values(repository).forEach(mock => mock.mockReset())
  repository.listCatalog.mockResolvedValue(ELEMENT_PLUS_CATALOG)
  repository.listTemplates.mockResolvedValue([template]); repository.findTemplate.mockResolvedValue(template)
  repository.createTemplate.mockResolvedValue(template); repository.updateTemplate.mockResolvedValue({ ...template, revision: 2 })
  repository.listPages.mockResolvedValue([page]); repository.findPage.mockResolvedValue(page)
  repository.createPage.mockResolvedValue(page); repository.updatePage.mockResolvedValue({ ...page, draftRevision: 2 })
  repository.publishPage.mockResolvedValue({ ...page, status: 'published', publishedRevision: 1, publishedTime: time })
  repository.findPublished.mockResolvedValue(published)
})
afterAll(async () => { if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

describe('工作台管理员配置与已发布 runtime HTTP', () => {
  it('目录和所有管理草稿读写都从真实会话检查管理员权限', async () => {
    const routes = [['/admin/catalog', 'GET'], ['/admin/templates', 'GET'], [`/admin/templates/${id}`, 'GET'],
      ['/admin/templates', 'POST'], [`/admin/templates/${id}`, 'PUT'], ['/admin/page-configs', 'GET'],
      [`/admin/page-configs/${id}`, 'GET'], ['/admin/page-configs', 'POST'], [`/admin/page-configs/${id}`, 'PUT'], [`/admin/page-configs/${id}/publish`, 'POST']] as const
    for (const [path, method] of routes) {
      expect((await request(path, '', method, method === 'GET' ? undefined : {})).status).toBe(401)
      expect((await request(path, userCookie, method, method === 'GET' ? undefined : {})).status).toBe(403)
    }
    expect(Object.values(repository).every(mock => mock.mock.calls.length === 0)).toBe(true)
    const response = await request('/admin/catalog')
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(82)
  })

  it('创建、更新和发布使用管理员身份和版本，客户端不能指定 owner / router / import', async () => {
    expect((await request('/admin/templates', adminCookie, 'POST', { schema })).status).toBe(201)
    expect(repository.createTemplate).toHaveBeenCalledWith(adminId, schema)
    expect((await request(`/admin/templates/${id}`, adminCookie, 'PUT', { schema, expectedRevision: 1 })).status).toBe(200)
    expect(repository.updateTemplate).toHaveBeenCalledWith(adminId, id, schema, 1)
    expect((await request('/admin/page-configs', adminCookie, 'POST', { name: page.name, target, schema })).status).toBe(201)
    expect(repository.createPage).toHaveBeenCalledWith(adminId, { name: page.name, target, schema })
    expect((await request(`/admin/page-configs/${id}`, adminCookie, 'PUT', { name: page.name, schema, expectedRevision: 1 })).status).toBe(200)
    expect((await request(`/admin/page-configs/${id}/publish`, adminCookie, 'POST', { expectedRevision: 1 })).status).toBe(200)
    expect(repository.publishPage).toHaveBeenCalledWith(adminId, id, 1)
    for (const input of [{ schema, owner: 'other' }, { schema, import: '/etc/passwd' }, { schema, routerPath: '/auth/login' },
      { schema: { ...schema, libraryVersion: 'unknown' } }, { schema: { ...schema, root: [{ nodeId: 'unsafe', kind: 'script', apiKey: 'eval', props: {} }] } }]) {
      expect((await request('/admin/templates', adminCookie, 'POST', input)).status).toBe(400)
    }
    expect((await request(`/admin/page-configs/${id}`, adminCookie, 'PUT', { name: page.name, schema, expectedRevision: 1, target })).status).toBe(400)
    expect((await request(`/admin/page-configs/${id}/publish`, adminCookie, 'POST', { expectedRevision: 1, schema })).status).toBe(400)
  })

  it('runtime 只允许已登录用户读白名单目标的已发布快照，草稿未发布返回 404', async () => {
    expect((await request('/ui/pages/acceptance', '')).status).toBe(401)
    const response = await request('/ui/pages/acceptance', userCookie)
    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(isPublishedPage(body)).toBe(true)
    expect(body).not.toHaveProperty('draftRevision')
    expect(repository.findPublished).toHaveBeenCalledWith(target)
    repository.findPublished.mockResolvedValue(null)
    expect((await request('/ui/pages/unpublished', userCookie)).status).toBe(404)
    expect((await request('/ui/regions/home/after-entry', userCookie)).status).toBe(404)
    repository.findPublished.mockClear()
    for (const path of ['/ui/regions/home/unregistered', '/ui/regions/admin/after-entry', '/ui/pages/Invalid_Key']) {
      expect((await request(path, userCookie)).status).toBe(404)
    }
    expect(repository.findPublished).not.toHaveBeenCalled()
  })

  it('冲突为 409，非法 ID 不传入 repository，受控数据库错误不泄漏参数', async () => {
    repository.updateTemplate.mockRejectedValue(new WorkbenchConflictError('配置已被更新，请重新加载后再保存'))
    expect((await request(`/admin/templates/${id}`, adminCookie, 'PUT', { schema, expectedRevision: 1 })).status).toBe(409)
    expect((await request('/admin/templates/not-a-uuid')).status).toBe(404)
    expect(repository.findTemplate).not.toHaveBeenCalled()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      repository.findPublished.mockRejectedValue(Object.assign(new Error('SELECT private; password=private'), { code: 'ECONNREFUSED', sql: 'private query' }))
      const response = await request('/ui/pages/acceptance?password=private', userCookie)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ message: '服务暂时不可用，请稍后重试' })
      expect(log.mock.calls).toEqual([[JSON.stringify({ event: 'request_failed', method: 'GET', route: '/ui/pages/:pageKey', errorCode: 'ECONNREFUSED', errorType: 'Error' })]])
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|SELECT|acceptance/)
    } finally { log.mockRestore() }
  })

  it('管理方案可超过 16 KiB，Schema 上限 128 KiB、HTTP 上限 256 KiB，认证和 Idea 仍限制 16 KiB', async () => {
    const medium = createDefaultSchemaV2()
    medium.state.text = { kind: 'literal', value: '中'.repeat(9000) }
    expect((await request('/admin/templates', adminCookie, 'POST', { schema: medium })).status).toBe(201)
    const tooMuchSchema = createDefaultSchemaV2()
    for (let index = 0; index < 10; index++) tooMuchSchema.state[`part${index}`] = { kind: 'literal', value: 'a'.repeat(14000) }
    const invalid = await request('/admin/templates', adminCookie, 'POST', { schema: tooMuchSchema })
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).message).toContain('128 KiB')
    expect((await request('/admin/templates', adminCookie, 'POST', { padding: 'a'.repeat(256 * 1024) })).status).toBe(413)
    expect((await request('/auth/login', '', 'POST', { username: 'x', password: 'a'.repeat(17000) })).status).toBe(413)
    expect((await request('/idea', userCookie, 'POST', { ideaContent: 'a'.repeat(17000) })).status).toBe(413)
  })
})

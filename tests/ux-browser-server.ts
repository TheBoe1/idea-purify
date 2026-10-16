/**
 * Browser UX fixture, MEMORY ONLY. It never imports the database or real auth service,
 * reads no credentials, and creates no real accounts. Stop the process to discard data.
 * Start explicitly: node tests/ux-browser-server.ts (127.0.0.1:5186 only).
 * Point a separate Vite instance at it: PORT=5186 vite --host 127.0.0.1 --port 5185.
 * The test identity is deliberately fixed; this is not a replacement production server.
 */
import express from 'express'
import type { ErrorRequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import { createWorkbenchRouter } from '../backend/component-config/workbench-routes.ts'
import { WorkbenchConflictError } from '../backend/component-config/errors.ts'
import type { WorkbenchRepository } from '../backend/db/workbench.ts'
import { ELEMENT_PLUS_CATALOG } from '../shared/catalog/element-plus.ts'
import type { AuthUser } from '../shared/contracts/auth.ts'
import { getIdeaContentError, isCreateIdeaRequest, type Idea } from '../shared/contracts/idea.ts'
import type { PageConfig, PublishedPage, SchemaV2, TypedValue, WorkbenchNode, WorkbenchTemplate } from '../shared/contracts/workbench.ts'

const fixtureUser: AuthUser = {
  userId: '00000000-0000-4000-8000-000000005186',
  username: 'ux_fixture_admin',
  nickname: 'UX 内存测试管理员',
  email: null,
  emailVerified: true,
  role: 'admin',
  disabled: false,
  createdTime: '2026-10-15T00:00:00Z',
}
const templates = new Map<string, WorkbenchTemplate>()
const pages = new Map<string, PageConfig>()
const published = new Map<string, PublishedPage>()
const ideas: Idea[] = [{ ideaId: 'fixture-idea-1', ideaContent: '仅用于 UX 验收的模拟想法，不是真实用户数据', createdTime: '2026-10-15T00:00:00Z' }]
const requests: { method: string; path: string; status: number; time: string }[] = []
let nextPublishFailure: 503 | 409 | undefined
const copy = <T>(value: T): T => structuredClone(value)
const now = () => new Date().toISOString()
const targetKey = (value: PageConfig['target']) => `${value.kind}:${value.pageKey}:${value.regionKey}`
const conflict = (actual: number, expected: number) => {
  if (actual !== expected) throw new WorkbenchConflictError('配置已被更新，请重新加载后再保存')
}

// Match the production guard without treating ordinary JSON objects as rendered nodes.
function homeGuard(page: PageConfig) {
  if (page.target.kind !== 'existing' || page.target.pageKey !== 'home' || page.schema.schemaVersion !== 2) return
  function value(item: TypedValue): boolean {
    if (item.kind === 'node') return node(item.node)
    if (item.kind === 'array') return item.items.some(value)
    if (item.kind === 'object') return Object.values(item.entries).some(value)
    if (item.kind === 'callback') return Object.values(item.reference.params).some(value) || Boolean(item.reference.gate && value(item.reference.gate))
    return false
  }
  function node(item: WorkbenchNode): boolean {
    if (item.kind === 'business') return true
    if (item.kind === 'text') return value(item.value)
    if (item.kind === 'for') return value(item.items) || item.children.some(node)
    if (item.kind === 'if') return value(item.test) || item.children.some(node) || Boolean(item.elseChildren?.some(node))
    return Object.values(item.props).some(value)
      || Object.values(item.callbacks ?? {}).some(callback => Object.values(callback.params).some(value) || Boolean(callback.gate && value(callback.gate)))
      || Object.values(item.events ?? {}).some(actions => actions.some(action => Object.values(action.params).some(value)))
      || Object.values(item.slots ?? {}).some(nodes => nodes.some(node))
      || Boolean(item.children?.some(node))
  }
  if (page.schema.root.some(node) || Object.values(page.schema.state).some(value) || page.schema.resources.some(resource => Boolean(resource.data && value(resource.data)) || Object.values(resource.params ?? {}).some(value)))
    throw new WorkbenchConflictError('首页已提供想法录入，扩展区域不能重复放置录入组件')
}

const repository: WorkbenchRepository = {
  async listCatalog() { return copy(ELEMENT_PLUS_CATALOG) },
  async listTemplates() { return copy([...templates.values()].sort((a, b) => b.updatedTime.localeCompare(a.updatedTime))) },
  async findTemplate(id) { return copy(templates.get(id) ?? null) },
  async createTemplate(_userId, schema: SchemaV2) {
    const time = now()
    const item = { configId: randomUUID(), schema: copy(schema), revision: 1, createdTime: time, updatedTime: time }
    templates.set(item.configId, item)
    return copy(item)
  },
  async updateTemplate(_userId, id, schema, expectedRevision) {
    const current = templates.get(id)
    if (!current) return null
    conflict(current.revision, expectedRevision)
    const item = { ...current, schema: copy(schema), revision: current.revision + 1, updatedTime: now() }
    templates.set(id, item)
    return copy(item)
  },
  async listPages() { return copy([...pages.values()].sort((a, b) => b.updatedTime.localeCompare(a.updatedTime))) },
  async findPage(id) { return copy(pages.get(id) ?? null) },
  async createPage(_userId, input) {
    if ([...pages.values()].some(page => targetKey(page.target) === targetKey(input.target)))
      throw new WorkbenchConflictError('该页面区域已有方案，请修改已有配置')
    const time = now()
    const item: PageConfig = { pageConfigId: randomUUID(), name: input.name.trim(), target: copy(input.target), schema: copy(input.schema), draftRevision: 1, publishedRevision: null, publishedTime: null, status: 'draft', createdTime: time, updatedTime: time }
    homeGuard(item)
    pages.set(item.pageConfigId, item)
    return copy(item)
  },
  async updatePage(_userId, id, input) {
    const current = pages.get(id)
    if (!current) return null
    conflict(current.draftRevision, input.expectedRevision)
    const item: PageConfig = { ...current, name: input.name.trim(), schema: copy(input.schema), draftRevision: current.draftRevision + 1, status: current.publishedRevision ? 'changed' : 'draft', updatedTime: now() }
    homeGuard(item)
    pages.set(id, item)
    return copy(item)
  },
  async publishPage(_userId, id, expectedRevision) {
    const current = pages.get(id)
    if (!current) return null
    conflict(current.draftRevision, expectedRevision)
    homeGuard(current)
    const time = now()
    const item: PageConfig = { ...current, publishedRevision: current.draftRevision, publishedTime: time, status: 'published', updatedTime: time }
    const snapshot: PublishedPage = { pageConfigId: id, name: item.name, target: copy(item.target), schema: copy(item.schema), publishedRevision: item.draftRevision, publishedTime: time }
    published.set(targetKey(item.target), snapshot)
    pages.set(id, item)
    return copy(item)
  },
  async findPublished(target) { return copy(published.get(targetKey(target)) ?? null) },
}

const app = express()
app.disable('x-powered-by')
app.use((_req, res, next) => { res.set('X-Idea-Purify-Fixture', 'memory-only'); next() })
app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path.startsWith('/__test/requests')) return
    const record = { method: req.method, path: req.path, status: res.statusCode, time: now() }
    requests.push(record)
    if (requests.length > 1000) requests.shift()
    console.log(JSON.stringify(record))
  })
  next()
})
app.use(express.json({ limit: '256kb', strict: true }))
app.get('/auth/session', (_req, res) => res.json(fixtureUser))
app.get('/admin/users', (_req, res) => res.json([fixtureUser]))
app.post('/auth/logout', (_req, res) => res.json({ message: '仅测试 fixture；刷新将恢复固定模拟账号' }))
app.get('/ideas', (_req, res) => res.json(copy(ideas)))
app.get('/ideas/:id', (req, res) => {
  const item = ideas.find(idea => idea.ideaId === req.params.id)
  res.status(item ? 200 : 404).json(item ? copy(item) : { message: '模拟想法不存在' })
})
app.post('/idea', (req, res) => {
  if (!isCreateIdeaRequest(req.body)) { res.status(400).json({ message: '模拟请求格式无效' }); return }
  const error = getIdeaContentError(req.body.ideaContent)
  if (error) { res.status(400).json({ message: error }); return }
  const item = { ideaId: randomUUID(), ideaContent: req.body.ideaContent.trim(), createdTime: now() }
  ideas.unshift(item)
  res.status(201).json(copy(item))
})
app.get('/__test/requests', (_req, res) => res.json(copy(requests)))
app.get('/__test/state', (_req, res) => res.json({ fixture: 'memory-only', templates: templates.size, pages: [...pages.values()].map(page => ({ id: page.pageConfigId, draftRevision: page.draftRevision, publishedRevision: page.publishedRevision })), published: published.size, ideas: ideas.length, nextPublishFailure: nextPublishFailure ?? null }))
app.post('/__test/fail-next-publish', (req, res) => {
  if (req.body?.status !== 503 && req.body?.status !== 409) { res.status(400).json({ message: '测试状态只能为 503 或 409' }); return }
  nextPublishFailure = req.body.status
  res.json({ fixture: 'memory-only', nextPublishFailure })
})
app.post('/__test/reset', (_req, res) => {
  templates.clear(); pages.clear(); published.clear(); nextPublishFailure = undefined
  res.json({ fixture: 'memory-only', message: '测试方案与页面已清空；未访问真实数据库' })
})
app.use((req, res, next) => {
  if (req.method === 'POST' && /^\/admin\/page-configs\/[^/]+\/publish$/.test(req.path) && nextPublishFailure) {
    const status = nextPublishFailure
    nextPublishFailure = undefined
    res.status(status).json({ message: status === 409 ? '模拟版本冲突；当前编辑已保留，请重新加载或另存' : '模拟发布服务暂时不可用，请保留草稿后重试' })
    return
  }
  next()
})
app.use(createWorkbenchRouter({
  repository,
  authenticated: (req, _res, next) => { req.user = fixtureUser as Express.User; next() },
  administrator: (_req, _res, next) => next(),
  error: (status, message) => Object.assign(new Error(message), { status }),
}))
app.use((_req, res) => res.status(404).json({ message: '内存测试未实现此接口' }))
const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 500
  res.status(status).json({ message: error instanceof Error ? error.message : '内存测试服务器错误' })
}
app.use(errors)
app.listen(5186, '127.0.0.1', () => console.log('UX FIXTURE ONLY: http://127.0.0.1:5186 — memory only; no database, credentials or real accounts.'))

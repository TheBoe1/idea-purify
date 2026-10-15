// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { componentConfigRepository } from '../backend/db/component-configs.ts'
import { workbenchRepository } from '../backend/db/workbench.ts'
import { WorkbenchConflictError } from '../backend/component-config/errors.ts'
import { createDefaultSchemaV2 } from '../shared/contracts/workbench.ts'
import type { SchemaV2, CreatePageConfigRequest } from '../shared/contracts/workbench.ts'
import type { ComponentSchema } from '../shared/contracts/component-config.ts'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(sql: string, params: unknown[]) => Promise<unknown>>(),
  getConnection: vi.fn<() => Promise<object>>(),
  beginTransaction: vi.fn<() => Promise<void>>(),
  commit: vi.fn<() => Promise<void>>(),
  rollback: vi.fn<() => Promise<void>>(),
  release: vi.fn<() => void>(),
}))
vi.mock('../backend/db/index.ts', () => ({ db: { getConnection: mocks.getConnection, execute: mocks.execute } }))
const id = '9a531641-f828-4cb9-b2b3-ea34c8ef11dd'
const now = new Date('2026-10-15T00:00:00Z')
const v1: ComponentSchema = { schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'input', name: '原始输入', props: {}, children: [] }

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset())
  mocks.getConnection.mockResolvedValue({ ...mocks })
})

describe('跨版本配置持久化与发布快照', () => {
  it('Legacy 更新也递增版本，旧 workbench expectedRevision 无法覆盖新修改', async () => {
    const row = { configId: id, componentKey: 'input', schemaVersion: 1, configSchema: v1, revision: 1, createdTime: now, updatedTime: now }
    mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT id FROM')) return [[{ id }]]
      if (sql.startsWith('UPDATE component_config')) {
        row.configSchema = JSON.parse(params[2] as string)
        row.revision++
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('SELECT')) return [[structuredClone(row)]]
      throw new Error('Unexpected query')
    })
    const saved = await componentConfigRepository.update('owner', id, { ...v1, name: 'Legacy 新修改' })
    expect(saved?.schema.name).toBe('Legacy 新修改')
    expect((await workbenchRepository.findTemplate(id))?.revision).toBe(2)
    await expect(workbenchRepository.updateTemplate('owner', id, createDefaultSchemaV2(), 1)).rejects.toBeInstanceOf(WorkbenchConflictError)
    expect(row.configSchema.name).toBe('Legacy 新修改')
    expect(mocks.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'))).toHaveLength(1)
    expect(mocks.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))![0]).toContain('revision = revision + 1')
    expect(mocks.rollback).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledTimes(2)
  })

  it('发布复制 schema / 名称；之后编辑草稿不改变 runtime JSON 与版本', async () => {
    const original = createDefaultSchemaV2('已发布文档')
    const row = { pageConfigId: id, name: '已发布名称', targetKind: 'dynamic', pageKey: 'acceptance-page', regionKey: 'root',
      draftSchema: original, draftRevision: 1, publishedRevision: null as number | null, publishedTime: null as Date | null, createdTime: now, updatedTime: now,
      publishedSchema: null as SchemaV2 | null, publishedName: '' }
    mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('UPDATE ui_page_config SET published')) {
        row.publishedName = params[0] as string; row.publishedSchema = JSON.parse(params[1] as string)
        row.publishedRevision = row.draftRevision; row.publishedTime = params[2] as Date
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('UPDATE ui_page_config SET name')) {
        row.name = params[0] as string; row.draftSchema = JSON.parse(params[1] as string); row.draftRevision++
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('published_name AS name')) return [[{ ...row, name: row.publishedName }]]
      if (sql.startsWith('SELECT')) return [[structuredClone(row)]]
      throw new Error('Unexpected query')
    })
    expect((await workbenchRepository.publishPage('admin', id, 1))?.status).toBe('published')
    await workbenchRepository.updatePage('admin', id, { name: '未发布改名', schema: createDefaultSchemaV2('草稿更新'), expectedRevision: 1 })
    const published = await workbenchRepository.findPublished({ kind: 'dynamic', pageKey: 'acceptance-page', regionKey: 'root' })
    expect(published).toMatchObject({ name: '已发布名称', schema: original, publishedRevision: 1 })
    expect(published).not.toHaveProperty('draftSchema')
    expect(published).not.toHaveProperty('draftRevision')
    expect(row.draftRevision).toBe(2)
    expect(row.publishedSchema).not.toBe(row.draftSchema)
    await expect(workbenchRepository.publishPage('admin', id, 1)).rejects.toBeInstanceOf(WorkbenchConflictError)
  })

  it.each(['state', 'resource', 'root'] as const)('首页区域不能从 %s 间接重复创建 Idea 录入组件', async location => {
    const schema = createDefaultSchemaV2()
    const idea = { kind: 'node' as const, node: { nodeId: 'duplicateEntry', kind: 'business' as const, apiKey: 'business:idea-entry' as const } }
    if (location === 'state') schema.state.item = idea
    else if (location === 'resource') schema.resources.push({ resourceId: 'items', sourceKey: 'static', data: idea })
    else schema.root.push(idea.node)
    const row = { pageConfigId: id, name: '首页扩展', targetKind: 'existing', pageKey: 'home', regionKey: 'after-entry', draftSchema: schema,
      draftRevision: 1, publishedRevision: null, publishedTime: null, createdTime: now, updatedTime: now }
    mocks.execute.mockResolvedValue([[row]])
    const input: CreatePageConfigRequest = { name: row.name, target: { kind: 'existing', pageKey: 'home', regionKey: 'after-entry' }, schema }
    await expect(workbenchRepository.updatePage('admin', id, { name: input.name, schema, expectedRevision: 1 })).rejects.toBeInstanceOf(WorkbenchConflictError)
    expect(mocks.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
  })

  it('长得像 business 节点的普通 literal JSON 不会被当成可渲染节点', async () => {
    const schema = createDefaultSchemaV2()
    schema.state.data = { kind: 'literal', value: { kind: 'business', apiKey: 'business:idea-entry', nodeId: 'plainData' } }
    const row = { pageConfigId: id, name: '普通数据', targetKind: 'existing', pageKey: 'home', regionKey: 'after-entry', draftSchema: schema,
      draftRevision: 1, publishedRevision: null, publishedTime: null, createdTime: now, updatedTime: now }
    mocks.execute.mockResolvedValue([[row]])
    await expect(workbenchRepository.updatePage('admin', id, { name: row.name, schema, expectedRevision: 1 })).resolves.toMatchObject({ schema })
    expect(mocks.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(true)
  })
})

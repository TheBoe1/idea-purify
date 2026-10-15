// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPONENT_DEFINITIONS } from '../shared/contracts/component-config.ts'
import { componentConfigRepository } from '../backend/db/component-configs.ts'

const { query } = vi.hoisted(() => ({ query: vi.fn<(sql: string) => Promise<[unknown[]]>>() }))
vi.mock('../backend/db/index.ts', () => ({ db: { query } }))

const installed = COMPONENT_DEFINITIONS[0]!
const row = () => ({ componentKey: installed.componentKey, libraryKey: installed.libraryKey,
  schemaVersion: installed.schemaVersion, metadata: structuredClone(installed) })

beforeEach(() => query.mockReset())

describe('已安装组件定义的持久化校验', () => {
  it('SQL 标识、库、版本与可信元数据一致才提供代码注册的定义', async () => {
    query.mockResolvedValue([[row()]])
    const definitions = await componentConfigRepository.listDefinitions()
    expect(definitions).toEqual([installed])
    expect(definitions[0]).toBe(installed)
  })

  it.each([
    ['库列错配', { libraryKey: 'uninstalled-library' }],
    ['版本列错配', { schemaVersion: 2 }],
    ['未知组件列', { componentKey: 'unregistered-component' }],
    ['数据库元数据损坏', { metadata: { ...installed, schemaVersion: 99 } }],
  ])('%s 时拒绝提供整个定义列表', async (_name, changed) => {
    query.mockResolvedValue([[row(), { ...row(), ...changed }]])
    await expect(componentConfigRepository.listDefinitions()).rejects.toThrow('数据库组件定义无效')
  })
})

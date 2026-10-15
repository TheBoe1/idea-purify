import { randomUUID } from 'node:crypto'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { COMPONENT_DEFINITIONS, getComponentSchemaError, isComponentSchema, isComponentDefinition } from '../../shared/contracts/component-config.ts'
import type { ComponentConfig, ComponentDefinition, ComponentSchema } from '../../shared/contracts/component-config.ts'
import { db } from './index.ts'

export interface ComponentConfigRepository {
  listDefinitions(): Promise<ComponentDefinition[]>
  create(userId: string, schema: ComponentSchema): Promise<ComponentConfig>
  update(userId: string, configId: string, schema: ComponentSchema): Promise<ComponentConfig | null>
  list(): Promise<ComponentConfig[]>
  find(configId: string): Promise<ComponentConfig | null>
}
interface ConfigRow extends RowDataPacket {
  configId: string
  componentKey: string
  schemaVersion: number
  configSchema: unknown
  createdTime: Date
  updatedTime: Date
}
interface DefinitionRow extends RowDataPacket {
  componentKey: string
  libraryKey: string
  schemaVersion: number
  metadata: unknown
}
const columns = 'id AS configId, component_key AS componentKey, schema_version AS schemaVersion, schema_json AS configSchema, created_time AS createdTime, updated_time AS updatedTime'

function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value }
function toConfig(row: ConfigRow): ComponentConfig {
  const schema = json(row.configSchema)
  // 数据库配置同样需要校验；损坏记录不能绕过前端注册白名单。
  if (!isComponentSchema(schema) || schema.componentKey !== row.componentKey || schema.schemaVersion !== row.schemaVersion) throw new Error('数据库组件配置无效')
  return { configId: row.configId, schema, createdTime: row.createdTime.toISOString(), updatedTime: row.updatedTime.toISOString() }
}
function checkSchema(schema: ComponentSchema): void {
  const error = getComponentSchemaError(schema)
  if (error) throw new Error(error)
}
async function find(connection: PoolConnection, configId: string): Promise<ComponentConfig | null> {
  const [rows] = await connection.execute<ConfigRow[]>(`SELECT ${columns} FROM component_config WHERE id = ?`, [configId])
  return rows[0] ? toConfig(rows[0]) : null
}

export async function seedComponentDefinitions(): Promise<void> {
  for (const definition of COMPONENT_DEFINITIONS) {
    await db.execute(
      'INSERT INTO component_definition (component_key, library_key, schema_version, metadata_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE library_key = ?, schema_version = ?, metadata_json = ?',
      [definition.componentKey, definition.libraryKey, definition.schemaVersion, JSON.stringify(definition),
        definition.libraryKey, definition.schemaVersion, JSON.stringify(definition)],
    )
  }
}

export const componentConfigRepository: ComponentConfigRepository = {
  async listDefinitions() {
    const [rows] = await db.query<DefinitionRow[]>('SELECT component_key AS componentKey, library_key AS libraryKey, schema_version AS schemaVersion, metadata_json AS metadata FROM component_definition WHERE schema_version = 1 ORDER BY component_key ASC')
    return rows.map(row => {
      const definition = COMPONENT_DEFINITIONS.find(item => item.componentKey === row.componentKey)
      const stored = json(row.metadata)
      if (!definition || !isComponentDefinition(stored) || stored.componentKey !== row.componentKey
        || row.libraryKey !== definition.libraryKey || row.schemaVersion !== definition.schemaVersion
        || stored.libraryKey !== row.libraryKey || stored.schemaVersion !== row.schemaVersion) throw new Error('数据库组件定义无效')
      // 返回代码安装的定义，数据库元数据从不决定可执行实现。
      return definition
    })
  },
  async create(userId, schema) {
    checkSchema(schema)
    const connection = await db.getConnection()
    const configId = randomUUID()
    const now = new Date()
    try {
      await connection.beginTransaction()
      const [result] = await connection.execute<ResultSetHeader>(
        'INSERT INTO component_config (id, component_key, schema_version, schema_json, created_by, updated_by, created_time, updated_time) SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM component_definition WHERE component_key = ? AND library_key = ? AND schema_version = ?',
        [configId, schema.componentKey, schema.schemaVersion, JSON.stringify(schema), userId, userId, now, now,
          schema.componentKey, schema.libraryKey, schema.schemaVersion],
      )
      if (result.affectedRows !== 1) throw new Error('组件定义尚未安装')
      const saved = await find(connection, configId)
      if (!saved) throw new Error('无法读取刚保存的组件配置')
      await connection.commit()
      return saved
    } catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
  },
  async update(userId, configId, schema) {
    checkSchema(schema)
    const connection = await db.getConnection()
    try {
      await connection.beginTransaction()
      const [existing] = await connection.execute<RowDataPacket[]>('SELECT id FROM component_config WHERE id = ? AND schema_version = 1 FOR UPDATE', [configId])
      if (!existing.length) { await connection.rollback(); return null }
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE component_config SET component_key = ?, schema_version = ?, schema_json = ?, revision = revision + 1, updated_by = ?, updated_time = ? WHERE id = ? AND EXISTS (SELECT 1 FROM component_definition WHERE component_key = ? AND library_key = ? AND schema_version = ?)',
        [schema.componentKey, schema.schemaVersion, JSON.stringify(schema), userId, new Date(), configId,
          schema.componentKey, schema.libraryKey, schema.schemaVersion],
      )
      if (result.affectedRows !== 1) throw new Error('组件定义尚未安装')
      const saved = await find(connection, configId)
      if (!saved) throw new Error('无法读取更新后的组件配置')
      await connection.commit()
      return saved
    } catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
  },
  async list() {
    const [rows] = await db.query<ConfigRow[]>(`SELECT ${columns} FROM component_config WHERE schema_version = 1 ORDER BY updated_time DESC, id ASC`)
    return rows.map(toConfig)
  },
  async find(configId) {
    const [rows] = await db.execute<ConfigRow[]>(`SELECT ${columns} FROM component_config WHERE id = ? AND schema_version = 1`, [configId])
    return rows[0] ? toConfig(rows[0]) : null
  },
}

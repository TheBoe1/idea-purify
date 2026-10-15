import { randomUUID } from 'node:crypto'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ELEMENT_PLUS_CATALOG, ELEMENT_PLUS_VERSION } from '../../shared/catalog/element-plus.ts'
import type { CatalogEntry } from '../../shared/catalog/element-plus.ts'
import {
  isRuntimeSchema,
  isSchemaV2,
  isPageTarget,
  isWorkbenchTemplate,
  isPageConfig,
  isPublishedPage,
  getCreatePageConfigError,
  getUpdatePageConfigError,
} from '../../shared/contracts/workbench.ts'
import type {
  SchemaV2,
  RuntimeSchema,
  WorkbenchTemplate,
  PageConfig,
  PublishedPage,
  PageTarget,
  CreatePageConfigRequest,
  UpdatePageConfigRequest,
  TypedValue,
  WorkbenchNode,
  CallbackReference,
  ActionReference,
} from '../../shared/contracts/workbench.ts'
import { db } from './index.ts'
import { WorkbenchConflictError } from '../component-config/errors.ts'

export interface WorkbenchRepository {
  listCatalog(): Promise<CatalogEntry[]>
  listTemplates(): Promise<WorkbenchTemplate[]>
  findTemplate(configId: string): Promise<WorkbenchTemplate | null>
  createTemplate(userId: string, schema: SchemaV2): Promise<WorkbenchTemplate>
  updateTemplate(
    userId: string,
    configId: string,
    schema: SchemaV2,
    expectedRevision: number,
  ): Promise<WorkbenchTemplate | null>
  listPages(): Promise<PageConfig[]>
  findPage(pageConfigId: string): Promise<PageConfig | null>
  createPage(userId: string, input: CreatePageConfigRequest): Promise<PageConfig>
  updatePage(
    userId: string,
    pageConfigId: string,
    input: UpdatePageConfigRequest,
  ): Promise<PageConfig | null>
  publishPage(
    userId: string,
    pageConfigId: string,
    expectedRevision: number,
  ): Promise<PageConfig | null>
  findPublished(target: PageTarget): Promise<PublishedPage | null>
}
interface TemplateRow extends RowDataPacket {
  configId: string
  componentKey: string
  schemaVersion: number
  configSchema: unknown
  revision: number
  createdTime: Date
  updatedTime: Date
}
interface PageRow extends RowDataPacket {
  pageConfigId: string
  name: string
  targetKind: string
  pageKey: string
  regionKey: string
  draftSchema: unknown
  draftRevision: number
  publishedRevision: number | null
  publishedTime: Date | null
  createdTime: Date
  updatedTime: Date
}
interface PublishedRow extends RowDataPacket {
  pageConfigId: string
  name: string
  targetKind: string
  pageKey: string
  regionKey: string
  publishedSchema: unknown
  publishedRevision: number
  publishedTime: Date
}
interface CatalogRow extends RowDataPacket {
  componentKey: string
  libraryKey: string
  libraryVersion: string
  schemaVersion: number
  metadata: unknown
}
const documentKey = `v2:${ELEMENT_PLUS_VERSION}:document`
const templateColumns =
  'id AS configId, component_key AS componentKey, schema_version AS schemaVersion, schema_json AS configSchema, revision, created_time AS createdTime, updated_time AS updatedTime'
const pageColumns =
  'id AS pageConfigId, name, target_kind AS targetKind, page_key AS pageKey, region_key AS regionKey, draft_schema AS draftSchema, draft_revision AS draftRevision, published_revision AS publishedRevision, published_time AS publishedTime, created_time AS createdTime, updated_time AS updatedTime'
const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value)

function schema(value: unknown): RuntimeSchema {
  const result = json(value)
  if (!isRuntimeSchema(result)) throw new Error('数据库方案无效')
  return result
}
function target(row: { targetKind: string; pageKey: string; regionKey: string }): PageTarget {
  const value = { kind: row.targetKind, pageKey: row.pageKey, regionKey: row.regionKey }
  if (!isPageTarget(value)) throw new Error('数据库页面目标无效')
  return value
}
function toTemplate(row: TemplateRow): WorkbenchTemplate {
  const document = schema(row.configSchema)
  if (
    document.schemaVersion !== row.schemaVersion ||
    (document.schemaVersion === 1
      ? document.componentKey !== row.componentKey
      : row.componentKey !== documentKey)
  )
    throw new Error('数据库方案定义与版本不一致')
  const result = {
    configId: row.configId,
    schema: document,
    revision: row.revision,
    createdTime: row.createdTime.toISOString(),
    updatedTime: row.updatedTime.toISOString(),
  }
  if (!isWorkbenchTemplate(result)) throw new Error('数据库方案版本或标识无效')
  return result
}
function toPage(row: PageRow): PageConfig {
  const result = {
    pageConfigId: row.pageConfigId,
    name: row.name,
    target: target(row),
    schema: schema(row.draftSchema),
    draftRevision: row.draftRevision,
    publishedRevision: row.publishedRevision,
    publishedTime: row.publishedTime?.toISOString() ?? null,
    status:
      row.publishedRevision === null
        ? 'draft'
        : row.publishedRevision === row.draftRevision
          ? 'published'
          : 'changed',
    createdTime: row.createdTime.toISOString(),
    updatedTime: row.updatedTime.toISOString(),
  }
  if (!isPageConfig(result)) throw new Error('数据库页面发布状态无效')
  return result
}
async function transaction<T>(task: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const result = await task(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
async function findTemplate(
  connection: PoolConnection,
  id: string,
  locked = false,
): Promise<WorkbenchTemplate | null> {
  const [rows] = await connection.execute<TemplateRow[]>(
    `SELECT ${templateColumns} FROM component_config WHERE id = ?${locked ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return rows[0] ? toTemplate(rows[0]) : null
}
async function findPage(
  connection: PoolConnection,
  id: string,
  locked = false,
): Promise<PageConfig | null> {
  const [rows] = await connection.execute<PageRow[]>(
    `SELECT ${pageColumns} FROM ui_page_config WHERE id = ?${locked ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return rows[0] ? toPage(rows[0]) : null
}
function compareRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new WorkbenchConflictError('配置已被更新，请重新加载后再保存')
}
function validateScene(input: CreatePageConfigRequest | UpdatePageConfigRequest): void {
  const error =
    'target' in input ? getCreatePageConfigError(input) : getUpdatePageConfigError(input)
  if (error) throw new Error(error)
}
function checkHomeTarget(page: PageConfig): void {
  if (
    page.target.kind !== 'existing' ||
    page.target.pageKey !== 'home' ||
    page.schema.schemaVersion !== 2
  )
    return
  function callback(reference: CallbackReference): boolean {
    return (
      Object.values(reference.params).some(value) || (!!reference.gate && value(reference.gate))
    )
  }
  function action(reference: ActionReference): boolean {
    return Object.values(reference.params).some(value)
  }
  function value(item: TypedValue): boolean {
    switch (item.kind) {
      case 'node':
        return node(item.node)
      case 'array':
        return item.items.some(value)
      case 'object':
        return Object.values(item.entries).some(value)
      case 'callback':
        return callback(item.reference)
      // Ordinary JSON data cannot create a runtime node, even if its keys resemble one.
      default:
        return false
    }
  }
  function node(item: WorkbenchNode): boolean {
    if (item.kind === 'business') return item.apiKey === 'business:idea-entry'
    if (item.kind === 'text') return value(item.value)
    if (item.kind === 'for') return value(item.items) || item.children.some(node)
    if (item.kind === 'if')
      return value(item.test) || item.children.some(node) || !!item.elseChildren?.some(node)
    return (
      Object.values(item.props).some(value) ||
      Object.values(item.callbacks ?? {}).some(callback) ||
      Object.values(item.events ?? {}).some((actions) => actions.some(action)) ||
      Object.values(item.slots ?? {}).some((nodes) => nodes.some(node)) ||
      !!item.children?.some(node)
    )
  }
  const document = page.schema
  if (
    document.root.some(node) ||
    Object.values(document.state).some(value) ||
    document.resources.some(
      (resource) =>
        (!!resource.data && value(resource.data)) ||
        Object.values(resource.params ?? {}).some(value),
    )
  ) {
    throw new WorkbenchConflictError('首页已提供想法录入，扩展区域不能重复放置录入组件')
  }
}
export async function seedWorkbenchDefinitions(): Promise<void> {
  const definitions = [
    {
      key: documentKey,
      metadata: { schemaVersion: 2, libraryVersion: ELEMENT_PLUS_VERSION, kind: 'document' },
    },
    ...ELEMENT_PLUS_CATALOG.map((entry) => ({
      key: `v2:${ELEMENT_PLUS_VERSION}:${entry.key}`,
      metadata: { schemaVersion: 2, libraryVersion: ELEMENT_PLUS_VERSION, entry },
    })),
  ]
  for (const definition of definitions)
    await db.execute(
      'INSERT INTO component_definition (component_key, library_key, library_version, schema_version, metadata_json) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE library_key = ?, library_version = ?, schema_version = ?, metadata_json = ?',
      [
        definition.key,
        'element-plus',
        ELEMENT_PLUS_VERSION,
        2,
        JSON.stringify(definition.metadata),
        'element-plus',
        ELEMENT_PLUS_VERSION,
        2,
        JSON.stringify(definition.metadata),
      ],
    )
}

export const workbenchRepository: WorkbenchRepository = {
  async listCatalog() {
    const [rows] = await db.execute<CatalogRow[]>(
      'SELECT component_key AS componentKey, library_key AS libraryKey, library_version AS libraryVersion, schema_version AS schemaVersion, metadata_json AS metadata FROM component_definition WHERE schema_version = ? AND library_version = ?',
      [2, ELEMENT_PLUS_VERSION],
    )
    const installed = new Map(rows.map((row) => [row.componentKey, row]))
    return ELEMENT_PLUS_CATALOG.map((entry) => {
      const row = installed.get(`v2:${ELEMENT_PLUS_VERSION}:${entry.key}`)
      const metadata = row
        ? (json(row.metadata) as {
            schemaVersion?: unknown
            libraryVersion?: unknown
            entry?: { key?: unknown; version?: unknown }
          })
        : undefined
      if (
        !row ||
        row.libraryKey !== 'element-plus' ||
        row.schemaVersion !== 2 ||
        row.libraryVersion !== ELEMENT_PLUS_VERSION ||
        metadata?.schemaVersion !== 2 ||
        metadata.libraryVersion !== ELEMENT_PLUS_VERSION ||
        metadata.entry?.key !== entry.key ||
        metadata.entry.version !== ELEMENT_PLUS_VERSION
      )
        throw new Error('组件目录尚未安装或版本不一致')
      return entry
    })
  },
  async listTemplates() {
    const [rows] = await db.query<TemplateRow[]>(
      `SELECT ${templateColumns} FROM component_config ORDER BY updated_time DESC, id ASC`,
    )
    return rows.map(toTemplate)
  },
  async findTemplate(configId) {
    const [rows] = await db.execute<TemplateRow[]>(
      `SELECT ${templateColumns} FROM component_config WHERE id = ?`,
      [configId],
    )
    return rows[0] ? toTemplate(rows[0]) : null
  },
  async createTemplate(userId, document) {
    if (!isSchemaV2(document)) throw new Error('方案无效')
    return transaction(async (connection) => {
      const id = randomUUID()
      const now = new Date()
      const [result] = await connection.execute<ResultSetHeader>(
        'INSERT INTO component_config (id, component_key, schema_version, schema_json, created_by, updated_by, created_time, updated_time) SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM component_definition WHERE component_key = ? AND library_key = ? AND library_version = ? AND schema_version = ?',
        [
          id,
          documentKey,
          2,
          JSON.stringify(document),
          userId,
          userId,
          now,
          now,
          documentKey,
          'element-plus',
          ELEMENT_PLUS_VERSION,
          2,
        ],
      )
      if (result.affectedRows !== 1) throw new Error('工作台定义尚未安装')
      const saved = await findTemplate(connection, id)
      if (!saved) throw new Error('无法读取已保存方案')
      return saved
    })
  },
  async updateTemplate(userId, configId, document, expectedRevision) {
    if (!isSchemaV2(document)) throw new Error('方案无效')
    return transaction(async (connection) => {
      const current = await findTemplate(connection, configId, true)
      if (!current) return null
      compareRevision(current.revision, expectedRevision)
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE component_config SET component_key = ?, schema_version = ?, schema_json = ?, revision = revision + 1, updated_by = ?, updated_time = ? WHERE id = ? AND EXISTS (SELECT 1 FROM component_definition WHERE component_key = ? AND library_key = ? AND library_version = ? AND schema_version = ?)',
        [
          documentKey,
          2,
          JSON.stringify(document),
          userId,
          new Date(),
          configId,
          documentKey,
          'element-plus',
          ELEMENT_PLUS_VERSION,
          2,
        ],
      )
      if (result.affectedRows !== 1) throw new Error('工作台定义尚未安装')
      const saved = await findTemplate(connection, configId)
      if (!saved) throw new Error('无法读取更新后的方案')
      return saved
    })
  },
  async listPages() {
    const [rows] = await db.query<PageRow[]>(
      `SELECT ${pageColumns} FROM ui_page_config ORDER BY updated_time DESC, id ASC`,
    )
    return rows.map(toPage)
  },
  async findPage(pageConfigId) {
    const [rows] = await db.execute<PageRow[]>(
      `SELECT ${pageColumns} FROM ui_page_config WHERE id = ?`,
      [pageConfigId],
    )
    return rows[0] ? toPage(rows[0]) : null
  },
  async createPage(userId, input) {
    validateScene(input)
    try {
      return await transaction(async (connection) => {
        const id = randomUUID()
        const now = new Date()
        await connection.execute(
          'INSERT INTO ui_page_config (id, name, target_kind, page_key, region_key, draft_schema, created_by, updated_by, created_time, updated_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            input.name.trim(),
            input.target.kind,
            input.target.pageKey,
            input.target.regionKey,
            JSON.stringify(input.schema),
            userId,
            userId,
            now,
            now,
          ],
        )
        const saved = await findPage(connection, id)
        if (!saved) throw new Error('无法读取页面草稿')
        checkHomeTarget(saved)
        return saved
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY')
        throw new WorkbenchConflictError('该页面区域已有方案，请修改已有配置')
      throw error
    }
  },
  async updatePage(userId, pageConfigId, input) {
    validateScene(input)
    return transaction(async (connection) => {
      const current = await findPage(connection, pageConfigId, true)
      if (!current) return null
      compareRevision(current.draftRevision, input.expectedRevision)
      checkHomeTarget({ ...current, schema: input.schema })
      await connection.execute(
        'UPDATE ui_page_config SET name = ?, draft_schema = ?, draft_revision = draft_revision + 1, updated_by = ?, updated_time = ? WHERE id = ?',
        [input.name.trim(), JSON.stringify(input.schema), userId, new Date(), pageConfigId],
      )
      return findPage(connection, pageConfigId)
    })
  },
  async publishPage(userId, pageConfigId, expectedRevision) {
    return transaction(async (connection) => {
      const current = await findPage(connection, pageConfigId, true)
      if (!current) return null
      compareRevision(current.draftRevision, expectedRevision)
      checkHomeTarget(current)
      // 发布存独立 JSON 快照；后续草稿修改不会改变运行时已发布版本。
      await connection.execute(
        'UPDATE ui_page_config SET published_name = ?, published_schema = ?, published_revision = draft_revision, published_time = ?, updated_by = ?, updated_time = ? WHERE id = ?',
        [
          current.name,
          JSON.stringify(current.schema),
          new Date(),
          userId,
          new Date(),
          pageConfigId,
        ],
      )
      return findPage(connection, pageConfigId)
    })
  },
  async findPublished(value) {
    if (!isPageTarget(value)) throw new Error('页面目标无效')
    const [rows] = await db.execute<PublishedRow[]>(
      'SELECT id AS pageConfigId, published_name AS name, target_kind AS targetKind, page_key AS pageKey, region_key AS regionKey, published_schema AS publishedSchema, published_revision AS publishedRevision, published_time AS publishedTime FROM ui_page_config WHERE target_kind = ? AND page_key = ? AND region_key = ? AND published_schema IS NOT NULL',
      [value.kind, value.pageKey, value.regionKey],
    )
    const row = rows[0]
    if (!row) return null
    const result = {
      pageConfigId: row.pageConfigId,
      name: row.name,
      target: target(row),
      schema: schema(row.publishedSchema),
      publishedRevision: row.publishedRevision,
      publishedTime: row.publishedTime.toISOString(),
    }
    if (!isPublishedPage(result)) throw new Error('数据库已发布页面无效')
    return result
  },
}

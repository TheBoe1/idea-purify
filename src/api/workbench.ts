import { requestJson } from './http'
import {
  isWorkbenchTemplate,
  isPageConfig,
  isPublishedPage,
  type SchemaV2,
  type WorkbenchTemplate,
  type PageConfig,
  type PageTarget,
  type RuntimeSchema,
  type PublishedPage,
} from '../../shared/contracts/workbench.ts'
function checked<T>(value: unknown, guard: (value: unknown) => value is T, label: string): T {
  if (!guard(value)) throw new Error(`${label}数据格式不正确`)
  return value
}
export async function loadTemplates(): Promise<WorkbenchTemplate[]> {
  const data = await requestJson('/admin/templates')
  if (!Array.isArray(data) || !data.every(isWorkbenchTemplate))
    throw new Error('方案列表数据格式不正确')
  return data
}
export async function loadTemplate(id: string) {
  return checked(
    await requestJson(`/admin/templates/${encodeURIComponent(id)}`),
    isWorkbenchTemplate,
    '方案',
  )
}
export async function saveTemplate(schema: SchemaV2, current?: WorkbenchTemplate) {
  return checked(
    await requestJson(
      current ? `/admin/templates/${encodeURIComponent(current.configId)}` : '/admin/templates',
      {
        method: current ? 'PUT' : 'POST',
        body: JSON.stringify(current ? { schema, expectedRevision: current.revision } : { schema }),
      },
    ),
    isWorkbenchTemplate,
    '保存后的方案',
  )
}
export async function loadPageConfigs(): Promise<PageConfig[]> {
  const data = await requestJson('/admin/page-configs')
  if (!Array.isArray(data) || !data.every(isPageConfig))
    throw new Error('页面配置列表数据格式不正确')
  return data
}
export async function loadPageConfig(id: string) {
  return checked(
    await requestJson(`/admin/page-configs/${encodeURIComponent(id)}`),
    isPageConfig,
    '页面配置',
  )
}
export async function savePageConfig(
  name: string,
  target: PageTarget,
  schema: RuntimeSchema,
  current?: PageConfig,
) {
  return checked(
    await requestJson(
      current
        ? `/admin/page-configs/${encodeURIComponent(current.pageConfigId)}`
        : '/admin/page-configs',
      {
        method: current ? 'PUT' : 'POST',
        body: JSON.stringify(
          current
            ? { name, schema, expectedRevision: current.draftRevision }
            : { name, target, schema },
        ),
      },
    ),
    isPageConfig,
    '保存后的页面配置',
  )
}
export async function publishPageConfig(current: PageConfig) {
  return checked(
    await requestJson(`/admin/page-configs/${encodeURIComponent(current.pageConfigId)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: current.draftRevision }),
    }),
    isPageConfig,
    '发布后的页面配置',
  )
}
export async function loadPublishedPage(
  pageKey: string,
  regionKey?: string,
): Promise<PublishedPage> {
  const path = regionKey
    ? `/ui/regions/${encodeURIComponent(pageKey)}/${encodeURIComponent(regionKey)}`
    : `/ui/pages/${encodeURIComponent(pageKey)}`
  return checked(await requestJson(path), isPublishedPage, '发布页面')
}

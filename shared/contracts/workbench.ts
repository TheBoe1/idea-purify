import {
  ELEMENT_PLUS_VERSION,
  ELEMENT_PLUS_ICON_KEYS,
  ELEMENT_PLUS_RUNTIME_EXPORTS,
  findElementPlusApi,
} from '../catalog/element-plus.ts'
import type { ApiEntry, ApiProp, ApiValueKind, CatalogKind } from '../catalog/element-plus.ts'
import { isComponentSchema } from './component-config.ts'
import type { ComponentSchema } from './component-config.ts'

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export interface DataBinding {
  kind: 'binding'
  source: 'state' | 'data' | 'scope' | 'event' | 'auth'
  path: (string | number)[]
}
export const CALLBACK_KEYS = [
  'return-binding',
  'format',
  'filter',
  'compare',
  'validate',
  'lazy-load',
  'preview-upload',
  'date-disable',
] as const
export const ACTION_KEYS = [
  'set-state',
  'reset-state',
  'show-message',
  'method',
  'service',
  'load-data',
] as const
export const DATA_SOURCE_KEYS = [
  'static',
  'current-user-ideas',
  'preview-search',
  'preview-tree',
  'preview-upload',
] as const
export interface CallbackReference {
  callbackKey: (typeof CALLBACK_KEYS)[number]
  params: Record<string, TypedValue>
  mode?: 'sync' | 'promise' | 'resolve'
  resolveIndex?: number
  rejectIndex?: number
  gate?: TypedValue
  result?: DataBinding
}
export interface ActionReference {
  actionKey: (typeof ACTION_KEYS)[number]
  params: Record<string, TypedValue>
}
export type TypedValue =
  | { kind: 'literal'; value: JsonValue }
  | DataBinding
  | { kind: 'array'; items: TypedValue[] }
  | { kind: 'object'; entries: Record<string, TypedValue>; apiKey?: string }
  | { kind: 'date'; value: string }
  | { kind: 'regexp'; source: string; flags: string }
  | { kind: 'icon'; name: string }
  | { kind: 'component'; apiKey: string }
  | { kind: 'node'; node: WorkbenchNode }
  | { kind: 'callback'; reference: CallbackReference }
  | { kind: 'dom'; nodeId: string }
  | { kind: 'ref'; nodeId: string; apiKey?: string; path?: string[]; expose?: string }
  | { kind: 'html'; value: string }
  | { kind: 'style'; value: Record<string, string | number> }
export interface ApiNode {
  nodeId: string
  kind: CatalogKind
  apiKey: string
  props: Record<string, TypedValue>
  models?: Record<string, DataBinding>
  slots?: Record<string, WorkbenchNode[]>
  events?: Record<string, ActionReference[]>
  callbacks?: Record<string, CallbackReference>
  children?: WorkbenchNode[]
  target?: string
  trigger?: 'manual' | 'mount'
}
export type WorkbenchNode =
  | ApiNode
  | { nodeId: string; kind: 'text'; value: TypedValue }
  | {
      nodeId: string
      kind: 'for'
      items: TypedValue
      itemName: string
      indexName?: string
      children: WorkbenchNode[]
    }
  | {
      nodeId: string
      kind: 'if'
      test: TypedValue
      children: WorkbenchNode[]
      elseChildren?: WorkbenchNode[]
    }
  | { nodeId: string; kind: 'business'; apiKey: 'business:idea-entry' }
export interface DataResource {
  resourceId: string
  sourceKey: (typeof DATA_SOURCE_KEYS)[number]
  data?: TypedValue
  params?: Record<string, TypedValue>
}
export interface SchemaV2 {
  schemaVersion: 2
  libraryKey: 'element-plus'
  libraryVersion: string
  name: string
  root: WorkbenchNode[]
  state: Record<string, TypedValue>
  resources: DataResource[]
}
export type RuntimeSchema = ComponentSchema | SchemaV2
export interface WorkbenchTemplate {
  configId: string
  schema: RuntimeSchema
  revision: number
  createdTime: string
  updatedTime: string
}
export const EXISTING_PAGE_REGIONS = {
  home: ['after-entry'],
  archive: ['before-list', 'after-list'],
  ideas: ['before-grid', 'after-grid'],
  'idea-detail': ['after-detail'],
} as const
export type PageTarget =
  | { kind: 'dynamic'; pageKey: string; regionKey: 'root' }
  | { kind: 'existing'; pageKey: keyof typeof EXISTING_PAGE_REGIONS; regionKey: string }
export interface PageConfig {
  pageConfigId: string
  name: string
  target: PageTarget
  schema: RuntimeSchema
  draftRevision: number
  publishedRevision: number | null
  publishedTime: string | null
  status: 'draft' | 'published' | 'changed'
  createdTime: string
  updatedTime: string
}
export interface PublishedPage {
  pageConfigId: string
  name: string
  target: PageTarget
  schema: RuntimeSchema
  publishedRevision: number
  publishedTime: string
}
export interface CreatePageConfigRequest {
  name: string
  target: PageTarget
  schema: RuntimeSchema
}
export interface UpdatePageConfigRequest {
  name: string
  schema: RuntimeSchema
  expectedRevision: number
}
export interface SaveTemplateRequest {
  schema: SchemaV2
}
export interface UpdateTemplateRequest extends SaveTemplateRequest {
  expectedRevision: number
}

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
const identifier = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function fail(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === 'string' && !forbiddenKeys.has(key) && keys.includes(key),
  )
}
function safeName(value: unknown): value is string {
  return typeof value === 'string' && identifier.test(value) && !forbiddenKeys.has(value)
}
function dictionary(value: unknown): asserts value is Record<string, unknown> {
  fail(
    record(value) &&
      Object.keys(value).length <= 200 &&
      Reflect.ownKeys(value).every((key) => typeof key === 'string' && !forbiddenKeys.has(key)),
    '字段字典无效或超出上限',
  )
}
function title(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    Array.from(value).length <= 64 &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  )
}
export function createDefaultSchemaV2(name = '新方案'): SchemaV2 {
  return {
    schemaVersion: 2,
    libraryKey: 'element-plus',
    libraryVersion: ELEMENT_PLUS_VERSION,
    name,
    root: [],
    state: {},
    resources: [],
  }
}
export function getPageTargetError(value: unknown): string | undefined {
  if (!record(value) || !only(value, ['kind', 'pageKey', 'regionKey'])) return '页面目标结构无效'
  if (value.kind === 'dynamic') {
    if (
      typeof value.pageKey !== 'string' ||
      !/^[a-z][a-z0-9-]{1,63}$/.test(value.pageKey) ||
      value.regionKey !== 'root'
    )
      return '独立页面需使用合法 pageKey 和 root 区域'
  } else if (value.kind === 'existing') {
    if (typeof value.pageKey !== 'string' || !Object.hasOwn(EXISTING_PAGE_REGIONS, value.pageKey))
      return '既有页面未注册'
    const regions: readonly string[] =
      EXISTING_PAGE_REGIONS[value.pageKey as keyof typeof EXISTING_PAGE_REGIONS]
    if (typeof value.regionKey !== 'string' || !regions.includes(value.regionKey))
      return '页面区域未注册'
  } else return '页面目标类型无效'
}
export function isPageTarget(value: unknown): value is PageTarget {
  return getPageTargetError(value) === undefined
}

export function isSafeURL(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(value))
    return false
  const text = value.trim()
  if (!text || text.startsWith('//') || /^(?:javascript|vbscript|file|blob):/i.test(text))
    return false
  if (/^data:/i.test(text))
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(text)
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    try {
      const url = new URL(text)
      return (
        ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  }
  return !/[<>"\\]/.test(text)
}
export function getSafeHtmlError(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8000) return 'HTML 文本无效或过长'
  // HTML 只允许无属性的排版标签；链接与图片使用经过验证的组件 URL 属性。
  const text = value.replace(/<\/?(?:p|br|b|strong|i|em|span|ul|ol|li)\s*\/?>/gi, '')
  if (/[<>]/.test(text)) return 'HTML 仅支持无属性的安全排版标签'
}
export function getSafeStyleError(value: unknown): string | undefined {
  if (!record(value) || Object.keys(value).length > 80) return '样式必须是受控 CSS 对象'
  for (const [key, content] of Object.entries(value)) {
    if (forbiddenKeys.has(key) || !/^(?:[a-zA-Z][a-zA-Z0-9-]{0,63}|--el-[a-z0-9-]+)$/.test(key))
      return '样式属性无效'
    if (typeof content === 'number') {
      if (!Number.isFinite(content) || Math.abs(content) > 10000) return '样式数值超出范围'
    } else if (
      typeof content !== 'string' ||
      content.length > 200 ||
      /[;{}<>@\\]|url\s*\(|expression\s*\(|javascript|behavior/i.test(content)
    )
      return '样式包含不允许的内容'
  }
}
export function getSafeStyleValueError(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return '样式嵌套超出上限'
  if (Array.isArray(value)) {
    if (value.length > 20) return '样式列表超出上限'
    for (const item of value) {
      const error = getSafeStyleValueError(item, depth + 1)
      if (error) return error
    }
    return
  }
  if (typeof value === 'string') {
    if (value.length > 4000) return '样式声明过长'
    const declarations: Record<string, string> = {}
    for (const declaration of value.split(';')) {
      if (!declaration.trim()) continue
      const colon = declaration.indexOf(':')
      if (colon < 1) return '样式需使用明确的 CSS 声明'
      const key = declaration.slice(0, colon).trim()
      if (forbiddenKeys.has(key) || Object.hasOwn(declarations, key)) return '样式字段无效或重复'
      declarations[key] = declaration.slice(colon + 1).trim()
    }
    return getSafeStyleError(declarations)
  }
  return getSafeStyleError(value)
}
export function getSafeSvgError(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8000) return 'SVG 内容无效或过长'
  if (!value.trim()) return
  // Loading 的图形片段只接受几何标签及静态属性；DOMPurify 在浏览器再次处理。
  const tags = new Set([
    'svg',
    'g',
    'path',
    'circle',
    'ellipse',
    'rect',
    'line',
    'polyline',
    'polygon',
  ])
  const attributes = new Set([
    'viewBox',
    'xmlns',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'd',
    'points',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'fill-rule',
    'clip-rule',
    'class',
    'transform',
    'opacity',
  ])
  let cursor = 0
  const stack: string[] = []
  for (const match of value.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>/g)) {
    if (value.slice(cursor, match.index).trim()) return 'SVG 不允许文本或脚本'
    const tag = match[1]!
    if (!tags.has(tag)) return 'SVG 标签未在安全集合中'
    const closing = match[0].startsWith('</')
    const tail = match[2]!
    if (closing) {
      if (tail.trim() || stack.pop() !== tag) return 'SVG 标签结构无效'
    } else {
      const text = tail.replace(/\/\s*$/, '')
      let consumed = 0
      for (const attribute of text.matchAll(
        /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g,
      )) {
        if (text.slice(consumed, attribute.index).trim() || !attributes.has(attribute[1]!))
          return 'SVG 属性未在安全集合中'
        const content = attribute[2] ?? attribute[3] ?? ''
        if (
          /[&<>\\;{}@]/.test(content) ||
          /url\s*\(|javascript|expression/i.test(content) ||
          !/^[a-zA-Z0-9\s.,#%+()/_:-]*$/.test(content)
        )
          return 'SVG 属性包含危险内容'
        if (attribute[1] === 'xmlns' && content !== 'http://www.w3.org/2000/svg')
          return 'SVG 命名空间无效'
        consumed = attribute.index! + attribute[0].length
      }
      if (text.slice(consumed).trim()) return 'SVG 属性结构无效'
      if (!/\/\s*>$/.test(match[0])) stack.push(tag)
    }
    cursor = match.index! + match[0].length
  }
  if (value.slice(cursor).trim() || stack.length || cursor === 0) return 'SVG 标签结构无效'
}
export function getSafeRegexpError(source: unknown, flags: unknown): string | undefined {
  if (
    typeof source !== 'string' ||
    source.length > 160 ||
    typeof flags !== 'string' ||
    !/^(?:i?u?|u?i?)$/.test(flags)
  )
    return '正则表达式或 flags 无效'
  // 仅接受非分组、非回溯引用的规则，避免以配置引入灾难性回溯。
  if (
    /[()|]/.test(source) ||
    /\\[1-9]|\{\d{4,}/.test(source) ||
    (source.replace(/\[[^\]]*\]/g, '').match(/[+*]/g)?.length ?? 0) > 1
  )
    return '正则仅支持有界、无分组和无回溯引用的安全规则'
  try {
    new RegExp(source, flags)
  } catch {
    return '正则表达式语法无效'
  }
}

interface ValidationContext {
  schema: SchemaV2
  nodes: Map<string, WorkbenchNode>
  refs: { nodeId: string; kind: 'dom' | 'ref'; expose?: string; apiKey?: string; path?: string[] }[]
  budget: { values: number }
  scopeRoots: Set<string>
  eventArity: number
}
function nested(
  context: ValidationContext,
  changes: Partial<Pick<ValidationContext, 'scopeRoots' | 'eventArity'>>,
): ValidationContext {
  // 计数沿同一文档共享，防止深度/数量绕过。
  return { ...context, ...changes }
}
function checkJson(value: unknown, depth: number): void {
  fail(depth <= 24, '数据嵌套超出上限')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    fail(typeof value !== 'string' || value.length <= 16000, '文字数据过长')
    return
  }
  if (typeof value === 'number') {
    fail(Number.isFinite(value), '数值必须有限')
    return
  }
  if (Array.isArray(value)) {
    fail(value.length <= 2000, '数据列表超出上限')
    value.forEach((item) => checkJson(item, depth + 1))
    return
  }
  dictionary(value)
  Object.values(value).forEach((item) => checkJson(item, depth + 1))
}
function checkBinding(
  value: unknown,
  context: ValidationContext,
  writable = false,
): asserts value is DataBinding {
  fail(
    record(value) && only(value, ['kind', 'source', 'path']) && value.kind === 'binding',
    '数据绑定结构无效',
  )
  fail(['state', 'data', 'scope', 'event', 'auth'].includes(String(value.source)), '绑定来源未注册')
  fail(
    Array.isArray(value.path) &&
      value.path.length > 0 &&
      value.path.length <= 12 &&
      value.path.every((part) =>
        typeof part === 'number'
          ? Number.isInteger(part) && part >= 0 && part <= 2000
          : typeof part === 'string' &&
            /^[a-zA-Z_$][a-zA-Z0-9_$-]{0,63}$/.test(part) &&
            !forbiddenKeys.has(part),
      ),
    '绑定路径必须是安全字段数组',
  )
  const key = value.path[0]
  if (writable)
    fail(value.source === 'state' || value.source === 'scope', '仅实例状态或当前作用域可写')
  if (value.source === 'state')
    fail(typeof key === 'string' && Object.hasOwn(context.schema.state, key), '绑定状态未声明')
  if (value.source === 'data')
    fail(
      context.schema.resources.some((resource) => resource.resourceId === key),
      '绑定数据源未声明',
    )
  if (value.source === 'scope')
    fail(typeof key === 'string' && context.scopeRoots.has(key), '当前作用域未声明该字段')
  if (value.source === 'event')
    fail(typeof key === 'number' && key < context.eventArity, '事件参数索引超出公开签名')
  if (value.source === 'auth')
    fail(
      ['userId', 'username', 'nickname', 'email', 'emailVerified', 'role'].includes(String(key)) &&
        value.path.length === 1,
      '仅允许公开的本人身份字段',
    )
}
export const CALLBACK_PARAM_KEYS: Record<CallbackReference['callbackKey'], readonly string[]> = {
  'return-binding': ['value'],
  format: ['value', 'template', 'node'],
  filter: ['query', 'options', 'labelKey', 'resultMode'],
  compare: ['left', 'right', 'key', 'direction'],
  validate: ['value', 'required', 'minLength', 'maxLength', 'pattern', 'message', 'resultMode'],
  'lazy-load': ['data', 'resourceId', 'childrenKey'],
  'preview-upload': ['data', 'delay', 'success', 'url'],
  'date-disable': ['date', 'before', 'after', 'mode'],
}
export const ACTION_PARAM_KEYS: Record<ActionReference['actionKey'], readonly string[]> = {
  'set-state': ['target', 'value'],
  'reset-state': ['target'],
  'show-message': ['message', 'type'],
  method: ['target', 'args'],
  service: ['apiKey', 'options'],
  'load-data': ['resourceId', 'target', 'params'],
}
function parameters(
  value: unknown,
  keys: readonly string[],
  context: ValidationContext,
  depth: number,
  skip: readonly string[] = [],
): asserts value is Record<string, TypedValue> {
  dictionary(value)
  fail(only(value, keys), '策略参数未注册')
  Object.entries(value).forEach(([key, item]) => {
    if (!skip.includes(key)) checkValue(item, context, depth + 1)
  })
}
function signatureArity(signature: string, fallback: number): number {
  const named = signature
    .match(/\b(one|two|three|four|five|six|seven|eight|\d+) parameters?\b/i)?.[1]
    ?.toLowerCase()
  if (named)
    return Math.min(
      16,
      Number(named) ||
        ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].indexOf(named) + 1,
    )
  const start = signature.indexOf('(')
  if (start < 0) return fallback
  let depth = 0
  let commas = 0
  let end = -1
  for (let index = start; index < signature.length; index++) {
    const character = signature[index]
    if (character === '(' || character === '[' || character === '{' || character === '<') depth++
    else if (character === ')' || character === ']' || character === '}' || character === '>') {
      depth--
      if (depth === 0) {
        end = index
        break
      }
    } else if (character === ',' && depth === 1) commas++
  }
  return end < 0 ? fallback : signature.slice(start + 1, end).trim() ? Math.min(16, commas + 1) : 0
}
function callbackArity(prop?: ApiProp): number {
  return prop?.parameterCount ?? signatureArity(prop?.typeText ?? '', 16)
}
function checkCallback(
  value: unknown,
  context: ValidationContext,
  depth: number,
  prop?: ApiProp,
): void {
  fail(
    record(value) &&
      only(value, [
        'callbackKey',
        'params',
        'mode',
        'result',
        'resolveIndex',
        'rejectIndex',
        'gate',
      ]) &&
      CALLBACK_KEYS.includes(value.callbackKey as CallbackReference['callbackKey']),
    '回调策略未注册',
  )
  if ('mode' in value)
    fail(['sync', 'promise', 'resolve'].includes(String(value.mode)), '回调执行模式无效')
  const arity = callbackArity(prop)
  const callbackContext = nested(context, { eventArity: arity })
  parameters(
    value.params,
    CALLBACK_PARAM_KEYS[value.callbackKey as CallbackReference['callbackKey']],
    callbackContext,
    depth,
  )
  const callbackParameters = value.params
  const staticParameter = (key: string): JsonValue | undefined =>
    callbackParameters[key]?.kind === 'literal' ? callbackParameters[key].value : undefined
  for (const key of ['minLength', 'maxLength', 'delay']) {
    const configured = staticParameter(key)
    if (configured !== undefined)
      fail(
        typeof configured === 'number' &&
          Number.isInteger(configured) &&
          configured >= 0 &&
          configured <= (key === 'delay' ? 5000 : 16000),
        '策略长度或延迟参数必须是范围内整数',
      )
  }
  const minimum = staticParameter('minLength')
  const maximum = staticParameter('maxLength')
  if (typeof minimum === 'number' && typeof maximum === 'number')
    fail(minimum <= maximum, '最小长度不能大于最大长度')
  for (const key of ['required', 'success'])
    if (staticParameter(key) !== undefined)
      fail(typeof staticParameter(key) === 'boolean', '策略开关参数必须是 boolean')
  for (const key of ['labelKey', 'childrenKey'])
    if (staticParameter(key) !== undefined)
      fail(safeName(staticParameter(key)), '策略字段参数必须是安全字段名')
  const compareKey = staticParameter('key')
  if (compareKey !== undefined)
    fail(
      typeof compareKey === 'string' &&
        compareKey.split('.').length <= 12 &&
        compareKey.split('.').every(safeName),
      '排序字段路径无效',
    )
  for (const key of ['template', 'message', 'url'])
    if (staticParameter(key) !== undefined)
      fail(typeof staticParameter(key) === 'string', '策略文字参数必须是 string')
  if (staticParameter('url') !== undefined)
    fail(isSafeURL(staticParameter('url')), '策略 URL 不安全')
  if (staticParameter('direction') !== undefined)
    fail(
      ['asc', 'desc'].includes(String(staticParameter('direction'))),
      '排序方向必须是 asc 或 desc',
    )
  if (staticParameter('mode') !== undefined)
    fail(['range', 'weekends'].includes(String(staticParameter('mode'))), '日期比较模式无效')
  if ('pattern' in value.params)
    fail(['regexp', 'binding'].includes(value.params.pattern.kind), '校验模式需使用安全正则或绑定')
  if ('resourceId' in value.params) {
    const resourceId = staticParameter('resourceId')
    fail(
      typeof resourceId === 'string' &&
        context.schema.resources.some((resource) => resource.resourceId === resourceId),
      '回调数据源未声明',
    )
  }
  for (const key of ['resolveIndex', 'rejectIndex'])
    if (key in value)
      fail(
        value.mode === 'resolve' &&
          typeof value[key] === 'number' &&
          Number.isInteger(value[key]) &&
          value[key] >= 0 &&
          value[key] < arity,
        '回调索引超出公开签名',
      )
  if (value.mode === 'resolve')
    fail(
      typeof value.resolveIndex === 'number' && value.resolveIndex !== value.rejectIndex,
      'resolve 模式需明确不同的 resolve/reject 参数索引',
    )
  if ('gate' in value) checkValue(value.gate, callbackContext, depth + 1)
  const resultMode = value.params.resultMode
  if (resultMode) {
    fail(resultMode.kind === 'literal', '回调结果模式必须是静态选择')
    const allowed =
      value.callbackKey === 'filter'
        ? ['list', 'match']
        : value.callbackKey === 'validate'
          ? ['error', 'message', 'boolean']
          : []
    fail(allowed.includes(String(resultMode.value)), '回调结果模式无效')
    if (prop?.runtimeName === 'inputValidator')
      fail(resultMode.value !== 'error', 'inputValidator 需要 boolean 或提示文字结果')
    if (
      prop &&
      ['filterMethod', 'filterNodeMethod'].includes(prop.runtimeName) &&
      value.callbackKey === 'filter'
    )
      fail(resultMode.value === 'match', '筛选谓词需要 boolean 结果')
  }
  if ('result' in value) checkBinding(value.result, context, true)
}
function checkAction(value: unknown, context: ValidationContext, depth: number): void {
  fail(
    record(value) &&
      only(value, ['actionKey', 'params']) &&
      ACTION_KEYS.includes(value.actionKey as ActionReference['actionKey']),
    '动作未注册',
  )
  const key = value.actionKey as ActionReference['actionKey']
  parameters(
    value.params,
    ACTION_PARAM_KEYS[key],
    context,
    depth,
    key === 'service' ? ['options'] : [],
  )
  if (key === 'set-state') {
    checkBinding(value.params.target, context, true)
    fail('value' in value.params, '更新状态需要 value')
  }
  if (key === 'reset-state' && value.params.target) checkBinding(value.params.target, context, true)
  if (key === 'show-message') fail('message' in value.params, '提示动作需要 message')
  if (key === 'method')
    fail(
      value.params.target?.kind === 'ref' && !!value.params.target.expose,
      '方法调用必须指向公开方法引用',
    )
  if (key === 'service') {
    const apiKey = value.params.apiKey
    fail(
      apiKey?.kind === 'literal' && typeof apiKey.value === 'string',
      '服务动作需要已注册 apiKey',
    )
    const api = findElementPlusApi(apiKey.value)
    fail(api?.kind === 'service', '仅允许调用已注册服务')
    if ('options' in value.params) {
      fail(
        record(value.params.options) && value.params.options.kind === 'object',
        '服务选项必须是类型化对象',
      )
      checkProp(
        value.params.options,
        {
          name: 'options',
          runtimeName: 'options',
          typeText: 'object',
          valueKinds: ['object'],
          enumValues: [],
          defaultText: '',
          members: api.props,
        },
        context,
        depth,
      )
    }
  }
  if (key === 'load-data') {
    const resource = value.params.resourceId
    fail(
      resource?.kind === 'literal' &&
        context.schema.resources.some((item) => item.resourceId === resource.value),
      '数据动作仅可调用已声明数据源',
    )
    if (value.params.target) checkBinding(value.params.target, context, true)
  }
}
function checkValue(
  value: unknown,
  context: ValidationContext,
  depth: number,
  callbackProp?: ApiProp,
): asserts value is TypedValue {
  context.budget.values++
  fail(depth <= 24 && context.budget.values <= 16000, '配置值深度或数量超出上限')
  fail(record(value) && typeof value.kind === 'string', '属性需使用类型化值')
  switch (value.kind) {
    case 'literal':
      fail(only(value, ['kind', 'value']) && 'value' in value, 'literal 结构无效')
      checkJson(value.value, depth)
      break
    case 'binding':
      checkBinding(value, context)
      break
    case 'array': {
      fail(
        only(value, ['kind', 'items']) && Array.isArray(value.items) && value.items.length <= 2000,
        '类型化数组无效',
      )
      value.items.forEach((item) =>
        callbackProp?.members?.length
          ? checkProp(item, { ...callbackProp, valueKinds: ['object'] }, context, depth + 1)
          : checkValue(item, context, depth + 1),
      )
      break
    }
    case 'object': {
      fail(only(value, ['kind', 'entries', 'apiKey']), '类型化对象无效')
      dictionary(value.entries)
      if ('apiKey' in value) {
        const api = typeof value.apiKey === 'string' ? findElementPlusApi(value.apiKey) : undefined
        fail(api?.parentApiKey && api.propPath, '对象接口未注册')
        if (!callbackProp?.members?.length) checkProps(value.entries, api, context, depth + 1)
      }
      if (callbackProp?.members?.length)
        checkMembers(value.entries, callbackProp.members, context, depth + 1)
      else if (!('apiKey' in value))
        Object.values(value.entries).forEach((item) => checkValue(item, context, depth + 1))
      break
    }
    case 'date':
      fail(
        only(value, ['kind', 'value']) &&
          typeof value.value === 'string' &&
          value.value.length <= 32 &&
          Number.isFinite(Date.parse(value.value)),
        '日期值无效',
      )
      break
    case 'regexp':
      fail(
        only(value, ['kind', 'source', 'flags']) && !getSafeRegexpError(value.source, value.flags),
        '正则规则无效或不安全',
      )
      break
    case 'icon':
      fail(
        only(value, ['kind', 'name']) &&
          typeof value.name === 'string' &&
          ELEMENT_PLUS_ICON_KEYS.includes(value.name),
        '图标引用未注册',
      )
      break
    case 'component': {
      const api = typeof value.apiKey === 'string' ? findElementPlusApi(value.apiKey) : undefined
      fail(only(value, ['kind', 'apiKey']) && api && isRenderableApi(api), '组件引用未注册')
      break
    }
    case 'node':
      fail(only(value, ['kind', 'node']), '安全渲染节点引用无效')
      checkNode(value.node, context, depth + 1)
      break
    case 'callback':
      fail(only(value, ['kind', 'reference']), '回调引用无效')
      checkCallback(value.reference, context, depth + 1, callbackProp)
      break
    case 'dom':
    case 'ref':
      fail(
        only(
          value,
          value.kind === 'dom'
            ? ['kind', 'nodeId']
            : ['kind', 'nodeId', 'apiKey', 'path', 'expose'],
        ) && safeName(value.nodeId),
        '实例引用无效',
      )
      if ('expose' in value) fail(safeName(value.expose), '公开方法名无效')
      if ('apiKey' in value)
        fail(
          typeof value.apiKey === 'string' && !!findElementPlusApi(value.apiKey),
          '实例接口未注册',
        )
      if ('path' in value)
        fail(
          Array.isArray(value.path) && value.path.length <= 8 && value.path.every(safeName),
          '实例路径无效',
        )
      context.refs.push({
        kind: value.kind,
        nodeId: value.nodeId,
        ...(typeof value.expose === 'string' ? { expose: value.expose } : {}),
        ...(typeof value.apiKey === 'string' ? { apiKey: value.apiKey } : {}),
        ...(Array.isArray(value.path) ? { path: value.path as string[] } : {}),
      })
      break
    case 'html':
      fail(only(value, ['kind', 'value']) && !getSafeHtmlError(value.value), 'HTML 内容不安全')
      break
    case 'style':
      fail(only(value, ['kind', 'value']) && !getSafeStyleError(value.value), '样式值不安全')
      break
    default:
      throw new Error('属性值类型未注册')
  }
}
export function findApiProp(api: ApiEntry, name: string): ApiProp | undefined {
  return api.props.find((prop) => prop.name === name || prop.runtimeName === name)
}
export function isRenderableApi(api: ApiEntry): boolean {
  return (
    ['component', 'composite'].includes(api.kind) &&
    !api.parentApiKey &&
    ELEMENT_PLUS_RUNTIME_EXPORTS.includes(api.runtimeExport)
  )
}
function valueKind(value: TypedValue): ApiValueKind | undefined {
  if (value.kind === 'literal')
    return value.value === null
      ? 'null'
      : Array.isArray(value.value)
        ? 'array'
        : (typeof value.value as ApiValueKind)
  if (value.kind === 'binding' || value.kind === 'ref') return undefined
  return (
    {
      array: 'array',
      object: 'object',
      date: 'date',
      regexp: 'regexp',
      icon: 'component',
      component: 'component',
      node: 'vnode',
      callback: 'function',
      dom: 'element',
      html: 'string',
      style: 'object',
    } as const
  )[value.kind]
}
function checkProp(value: unknown, prop: ApiProp, context: ValidationContext, depth: number): void {
  checkValue(value, context, depth, prop)
  const kind = valueKind(value)
  fail(
    !kind || prop.valueKinds.includes('unknown') || prop.valueKinds.includes(kind),
    '属性值与公开 API 类型不符',
  )
  if (
    value.kind === 'literal' &&
    prop.enumValues.length &&
    !prop.allowCustom &&
    ['string', 'number', 'boolean'].includes(typeof value.value)
  )
    fail(prop.enumValues.includes(value.value as string | number | boolean), '属性值不在公开枚举中')
  if (
    ['src', 'href', 'url', 'action', 'poster'].includes(prop.runtimeName) &&
    value.kind === 'literal'
  )
    fail(value.value === '' || isSafeURL(value.value), '属性 URL 不安全')
  if (['target', 'appendTo'].includes(prop.runtimeName) && prop.valueKinds.includes('element'))
    fail(['dom', 'ref'].includes(value.kind), 'DOM 目标必须通过当前方案节点引用')
  if (/style$/i.test(prop.runtimeName)) checkStyleValue(value)
  if (/svg$/i.test(prop.runtimeName) && value.kind === 'literal')
    fail(!getSafeSvgError(value.value), 'SVG 内容不安全')
  if (prop.runtimeName.startsWith('--el-') && value.kind === 'literal')
    fail(!getSafeStyleError({ [prop.runtimeName]: value.value }), '设计样式值不安全')
  if (
    prop.members?.length &&
    value.kind === 'literal' &&
    value.value &&
    typeof value.value === 'object'
  ) {
    const values = Array.isArray(value.value) ? value.value : [value.value]
    for (const item of values) {
      dictionary(item)
      for (const member of prop.members)
        if (member.required)
          fail(
            Object.keys(item).some((key) => member.name === key || member.runtimeName === key),
            '对象缺少必填属性',
          )
      for (const [key, memberValue] of Object.entries(item)) {
        const member = prop.members.find(
          (candidate) => candidate.name === key || candidate.runtimeName === key,
        )
        fail(member, '对象子属性未在 API 中注册')
        checkProp({ kind: 'literal', value: memberValue }, member, context, depth + 1)
      }
    }
  }
}
function checkMembers(
  value: Record<string, unknown>,
  members: ApiProp[],
  context: ValidationContext,
  depth: number,
): void {
  const names = new Set<string>()
  for (const [key, item] of Object.entries(value)) {
    const member = members.find(
      (candidate) => candidate.name === key || candidate.runtimeName === key,
    )
    fail(member && !names.has(member.runtimeName), '对象子属性未在 API 中注册或重复配置')
    names.add(member.runtimeName)
    checkProp(item, member, context, depth + 1)
  }
  for (const member of members)
    if (member.required) fail(names.has(member.runtimeName), '对象缺少必填属性')
}
function checkStyleValue(value: TypedValue): void {
  if (value.kind === 'literal') fail(!getSafeStyleValueError(value.value), '样式属性不安全')
  else if (value.kind === 'array') value.items.forEach(checkStyleValue)
  else if (value.kind === 'object') {
    for (const [key, item] of Object.entries(value.entries)) {
      fail(!getSafeStyleError({ [key]: 0 }), '样式字段不安全')
      if (item.kind === 'literal') fail(!getSafeStyleError({ [key]: item.value }), '样式属性不安全')
      else fail(item.kind === 'binding', '样式值需为静态数据或绑定')
    }
  } else fail(['binding', 'callback', 'style'].includes(value.kind), '样式值类型无效')
}
function checkProps(
  value: unknown,
  api: ApiEntry,
  context: ValidationContext,
  depth: number,
  alternativeProps: string[] = [],
): void {
  dictionary(value)
  const names = new Set<string>()
  for (const [key, item] of Object.entries(value)) {
    const prop = findApiProp(api, key)
    fail(prop && !names.has(prop.runtimeName), '属性未注册或重复配置')
    names.add(prop.runtimeName)
    checkProp(item, prop, context, depth + 1)
  }
  for (const prop of api.props)
    if (prop.required)
      fail(
        names.has(prop.runtimeName) ||
          alternativeProps.some((key) => findApiProp(api, key)?.runtimeName === prop.runtimeName),
        '缺少公开 API 必填属性',
      )
  const htmlFlag = Object.entries(value).find(
    ([key]) => findApiProp(api, key)?.runtimeName === 'dangerouslyUseHTMLString',
  )?.[1]
  if (record(htmlFlag) && htmlFlag.kind === 'literal' && htmlFlag.value === true) {
    const content = value.message ?? value.content
    fail(
      record(content) && ['html', 'node'].includes(String(content.kind)),
      'HTML 模式必须使用安全 HTML 或节点引用',
    )
  }
}
function checkNodes(value: unknown, context: ValidationContext, depth: number): void {
  fail(Array.isArray(value) && value.length <= 200, '节点列表无效或超出上限')
  value.forEach((item) => checkNode(item, context, depth + 1))
}
function checkNode(value: unknown, context: ValidationContext, depth: number): void {
  fail(
    depth <= 24 &&
      record(value) &&
      safeName(value.nodeId) &&
      value.nodeId !== 'root' &&
      !context.nodes.has(value.nodeId) &&
      context.nodes.size < 200,
    '节点标识无效、重复或超出嵌套上限',
  )
  context.nodes.set(value.nodeId, value as unknown as WorkbenchNode)
  if (value.kind === 'text') {
    fail(only(value, ['nodeId', 'kind', 'value']), '文本节点结构无效')
    checkValue(value.value, context, depth + 1)
    return
  }
  if (value.kind === 'for') {
    fail(
      only(value, ['nodeId', 'kind', 'items', 'itemName', 'indexName', 'children']) &&
        safeName(value.itemName) &&
        (value.indexName === undefined || safeName(value.indexName)),
      '列表节点结构无效',
    )
    checkValue(value.items, context, depth + 1)
    checkNodes(
      value.children,
      nested(context, {
        scopeRoots: new Set([
          ...context.scopeRoots,
          value.itemName,
          ...(typeof value.indexName === 'string' ? [value.indexName] : []),
        ]),
      }),
      depth,
    )
    return
  }
  if (value.kind === 'if') {
    fail(only(value, ['nodeId', 'kind', 'test', 'children', 'elseChildren']), '条件节点结构无效')
    checkValue(value.test, context, depth + 1)
    checkNodes(value.children, context, depth)
    if ('elseChildren' in value) checkNodes(value.elseChildren, context, depth)
    return
  }
  if (value.kind === 'business') {
    fail(
      only(value, ['nodeId', 'kind', 'apiKey']) && value.apiKey === 'business:idea-entry',
      '业务组件未注册',
    )
    return
  }
  fail(
    only(value, [
      'nodeId',
      'kind',
      'apiKey',
      'props',
      'models',
      'slots',
      'events',
      'callbacks',
      'children',
      'target',
      'trigger',
    ]) && typeof value.apiKey === 'string',
    '组件节点结构无效',
  )
  const api = findElementPlusApi(value.apiKey)
  fail(api && api.kind === value.kind, '节点 API 未注册或 kind 不符')
  if (['component', 'composite'].includes(api.kind))
    fail(isRenderableApi(api), '内部对象或实例接口不能作为独立组件渲染')
  checkProps(value.props, api, context, depth + 1, [
    ...Object.keys(record(value.models) ? value.models : {}),
    ...Object.keys(record(value.callbacks) ? value.callbacks : {}),
  ])
  const channels = new Set(
    Object.keys(value.props as object).map((key) => findApiProp(api, key)!.runtimeName),
  )
  if ('models' in value) {
    dictionary(value.models)
    for (const [key, binding] of Object.entries(value.models)) {
      const prop = findApiProp(api, key)
      fail(prop && !channels.has(prop.runtimeName), '双向属性未注册或与其他属性重复')
      fail(
        api.events.some(
          (event) =>
            event.name.startsWith('update:') &&
            event.name
              .slice(7)
              .replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase()) ===
              prop.runtimeName,
        ),
        '双向属性没有公开 update 事件',
      )
      channels.add(prop.runtimeName)
      checkBinding(binding, context, true)
    }
  }
  if ('callbacks' in value) {
    dictionary(value.callbacks)
    for (const [key, callback] of Object.entries(value.callbacks)) {
      const prop = findApiProp(api, key)
      fail(
        prop &&
          (prop.valueKinds.includes('function') || prop.valueKinds.includes('unknown')) &&
          !channels.has(prop.runtimeName),
        '回调属性未注册或重复',
      )
      channels.add(prop.runtimeName)
      checkCallback(callback, context, depth + 1, prop)
    }
  }
  if ('slots' in value) {
    dictionary(value.slots)
    for (const [key, nodes] of Object.entries(value.slots)) {
      const slot = api.slots.find((item) => item.name === key)
      fail(slot, '槽位未注册')
      checkNodes(
        nodes,
        nested(context, {
          scopeRoots: new Set([...context.scopeRoots, ...(slot.scopeFields ?? [])]),
        }),
        depth,
      )
    }
  }
  if ('events' in value) {
    dictionary(value.events)
    for (const [key, actions] of Object.entries(value.events)) {
      const event = api.events.find((item) => item.name === key)
      fail(event && Array.isArray(actions) && actions.length <= 20, '事件未注册或动作数量过多')
      actions.forEach((action) =>
        checkAction(
          action,
          nested(context, {
            eventArity: event.parameterCount ?? signatureArity(event.signature, 1),
          }),
          depth + 1,
        ),
      )
    }
  }
  if ('children' in value) {
    fail(['directive', 'design'].includes(api.kind), '组件子节点需使用其已注册槽位')
    checkNodes(value.children, context, depth)
  }
  if ('target' in value) {
    fail(api.kind === 'directive' && safeName(value.target), '指令目标引用无效')
    context.refs.push({ kind: 'dom', nodeId: value.target })
  }
  if ('trigger' in value)
    fail(
      api.kind === 'service' && ['manual', 'mount'].includes(String(value.trigger)),
      '服务触发方式无效',
    )
}
function validateSchema(value: unknown): asserts value is SchemaV2 {
  fail(
    record(value) &&
      only(value, [
        'schemaVersion',
        'libraryKey',
        'libraryVersion',
        'name',
        'root',
        'state',
        'resources',
      ]),
    '方案结构包含不允许的字段',
  )
  fail(
    value.schemaVersion === 2 &&
      value.libraryKey === 'element-plus' &&
      value.libraryVersion === ELEMENT_PLUS_VERSION &&
      title(value.name),
    '方案版本、组件库或名称无效',
  )
  dictionary(value.state)
  Object.keys(value.state).forEach((key) => fail(safeName(key), '实例状态字段无效'))
  fail(Array.isArray(value.resources) && value.resources.length <= 20, '资源列表无效或过多')
  const resources = new Set<string>()
  for (const resource of value.resources) {
    fail(
      record(resource) &&
        only(resource, ['resourceId', 'sourceKey', 'data', 'params']) &&
        safeName(resource.resourceId) &&
        !resources.has(resource.resourceId) &&
        DATA_SOURCE_KEYS.includes(resource.sourceKey as DataResource['sourceKey']),
      '资源未注册或重复',
    )
    resources.add(resource.resourceId)
  }
  const context: ValidationContext = {
    schema: value as unknown as SchemaV2,
    nodes: new Map(),
    refs: [],
    budget: { values: 0 },
    scopeRoots: new Set(),
    eventArity: 0,
  }
  Object.values(value.state).forEach((item) => checkValue(item, context, 0))
  for (const resource of value.resources) {
    if (resource.data !== undefined) checkValue(resource.data, context, 0)
    if (resource.params !== undefined) {
      dictionary(resource.params)
      if (resource.sourceKey === 'current-user-ideas')
        fail(Object.keys(resource.params).length === 0, '本人想法数据源不接受用户归属参数')
      Object.values(resource.params).forEach((item) => checkValue(item, context, 0))
    }
  }
  checkNodes(value.root, context, 0)
  for (const ref of context.refs) {
    if (ref.kind === 'dom' && ref.nodeId === 'root') continue
    const node = context.nodes.get(ref.nodeId)
    fail(node, '实例引用目标不存在')
    const nodeApi = 'apiKey' in node ? findElementPlusApi(node.apiKey) : undefined
    if (ref.kind === 'dom')
      fail(nodeApi && isRenderableApi(nodeApi), 'DOM 引用必须指向有元素实例的组件节点')
    const api = ref.apiKey ? findElementPlusApi(ref.apiKey) : nodeApi
    fail(
      !ref.apiKey ||
        api === nodeApi ||
        (api && api.parentApiKey === nodeApi?.apiKey && !!api.propPath),
      '实例接口不属于目标节点',
    )
    if (api?.parentApiKey) {
      const paths = api.propPath!.split('|').map((path) => path.split('.'))
      fail(
        paths.some((path) => JSON.stringify(path) === JSON.stringify(ref.path ?? [])),
        '内部实例路径未公开',
      )
    } else fail(!ref.path?.length, '实例路径未公开')
    if (ref.expose)
      fail(
        api?.exposes.some((expose) => expose.name === ref.expose),
        '实例方法未公开',
      )
  }
  fail(
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= 128 * 1024,
    '方案超过 128 KiB 配置上限',
  )
}
export function getSchemaV2Error(value: unknown): string | undefined {
  try {
    validateSchema(value)
  } catch (error) {
    return error instanceof Error ? error.message : '方案无效'
  }
}
export function isSchemaV2(value: unknown): value is SchemaV2 {
  return getSchemaV2Error(value) === undefined
}
export function isRuntimeSchema(value: unknown): value is RuntimeSchema {
  return isComponentSchema(value) || isSchemaV2(value)
}
export function getRuntimeSchemaError(value: unknown): string | undefined {
  return isRuntimeSchema(value) ? undefined : (getSchemaV2Error(value) ?? '不支持的方案')
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const revision = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
export function isWorkbenchTemplate(value: unknown): value is WorkbenchTemplate {
  return (
    record(value) &&
    only(value, ['configId', 'schema', 'revision', 'createdTime', 'updatedTime']) &&
    typeof value.configId === 'string' &&
    uuid.test(value.configId) &&
    isRuntimeSchema(value.schema) &&
    revision(value.revision) &&
    time(value.createdTime) &&
    time(value.updatedTime)
  )
}
export function isPageConfig(value: unknown): value is PageConfig {
  return (
    record(value) &&
    only(value, [
      'pageConfigId',
      'name',
      'target',
      'schema',
      'draftRevision',
      'publishedRevision',
      'publishedTime',
      'status',
      'createdTime',
      'updatedTime',
    ]) &&
    typeof value.pageConfigId === 'string' &&
    uuid.test(value.pageConfigId) &&
    title(value.name) &&
    isPageTarget(value.target) &&
    isRuntimeSchema(value.schema) &&
    revision(value.draftRevision) &&
    (value.publishedRevision === null || revision(value.publishedRevision)) &&
    (value.publishedTime === null || time(value.publishedTime)) &&
    (value.publishedRevision === null
      ? value.publishedTime === null && value.status === 'draft'
      : value.publishedTime !== null &&
        (value.publishedRevision as number) <= (value.draftRevision as number) &&
        value.status ===
          (value.publishedRevision === value.draftRevision ? 'published' : 'changed')) &&
    time(value.createdTime) &&
    time(value.updatedTime)
  )
}
export function isPublishedPage(value: unknown): value is PublishedPage {
  return (
    record(value) &&
    only(value, [
      'pageConfigId',
      'name',
      'target',
      'schema',
      'publishedRevision',
      'publishedTime',
    ]) &&
    typeof value.pageConfigId === 'string' &&
    uuid.test(value.pageConfigId) &&
    title(value.name) &&
    isPageTarget(value.target) &&
    isRuntimeSchema(value.schema) &&
    revision(value.publishedRevision) &&
    time(value.publishedTime)
  )
}
export function getCreatePageConfigError(value: unknown): string | undefined {
  if (!record(value) || !only(value, ['name', 'target', 'schema']) || !title(value.name))
    return '页面名称或字段无效'
  return getPageTargetError(value.target) ?? getRuntimeSchemaError(value.schema)
}
export function getUpdatePageConfigError(value: unknown): string | undefined {
  if (
    !record(value) ||
    !only(value, ['name', 'schema', 'expectedRevision']) ||
    !title(value.name) ||
    !revision(value.expectedRevision)
  )
    return '页面名称、版本或字段无效'
  return getRuntimeSchemaError(value.schema)
}
export function isCreatePageConfigRequest(value: unknown): value is CreatePageConfigRequest {
  return getCreatePageConfigError(value) === undefined
}
export function isUpdatePageConfigRequest(value: unknown): value is UpdatePageConfigRequest {
  return getUpdatePageConfigError(value) === undefined
}
export function getSaveTemplateError(value: unknown, update = false): string | undefined {
  if (
    !record(value) ||
    !only(value, update ? ['schema', 'expectedRevision'] : ['schema']) ||
    (update && !revision(value.expectedRevision))
  )
    return '方案请求字段或版本无效'
  return getSchemaV2Error(value.schema)
}
export function isSaveTemplateRequest(value: unknown): value is SaveTemplateRequest {
  return getSaveTemplateError(value) === undefined
}
export function isUpdateTemplateRequest(value: unknown): value is UpdateTemplateRequest {
  return getSaveTemplateError(value, true) === undefined
}

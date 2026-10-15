import {
  ELEMENT_PLUS_APIS,
  findElementPlusApi,
  type ApiProp,
} from '../../../shared/catalog/element-plus.ts'
import {
  type ApiNode,
  type TypedValue,
  type WorkbenchNode,
  type JsonValue,
} from '../../../shared/contracts/workbench.ts'
import type { InjectionKey } from 'vue'
export const declareStateKey: InjectionKey<(key: string, value: TypedValue) => void> =
  Symbol('workbench-declare-state')
let nextId = 0
export function nodeId(prefix = 'node') {
  return `${prefix}-${Date.now().toString(36)}-${++nextId}`
}
export const renderableApis = ELEMENT_PLUS_APIS.filter((api) => !api.parentApiKey && !api.propPath)
export function allApiNodes(nodes: WorkbenchNode[]): ApiNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'text' || node.kind === 'business') return []
    if (node.kind === 'for') return allApiNodes(node.children)
    if (node.kind === 'if')
      return [...allApiNodes(node.children), ...allApiNodes(node.elseChildren ?? [])]
    return [
      node,
      ...allApiNodes(node.children ?? []),
      ...Object.values(node.slots ?? {}).flatMap(allApiNodes),
    ]
  })
}
export function typedJson(value: JsonValue): TypedValue {
  if (Array.isArray(value)) return { kind: 'array', items: value.map(typedJson) }
  if (value && typeof value === 'object')
    return {
      kind: 'object',
      entries: Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, typedJson(entry)]),
      ),
    }
  return { kind: 'literal', value }
}
export function defaultTypedValue(prop?: ApiProp): TypedValue {
  if (prop?.defaultText) {
    const text = prop.defaultText.trim()
    try {
      const value = JSON.parse(text) as JsonValue
      return typedJson(value)
    } catch {
      /* Type declarations also contain non-JSON defaults. */
    }
    if (/^['"].*['"]$/.test(text)) return { kind: 'literal', value: text.slice(1, -1) }
  }
  const kind = prop?.valueKinds[0]
  if (kind === 'boolean') return { kind: 'literal', value: false }
  if (kind === 'number') return { kind: 'literal', value: 0 }
  if (kind === 'array') return { kind: 'array', items: [] }
  if (kind === 'object') return { kind: 'object', entries: {} }
  if (kind === 'date') return { kind: 'date', value: new Date().toISOString() }
  if (kind === 'function')
    return { kind: 'callback', reference: { callbackKey: 'return-binding', params: {} } }
  if (kind === 'component') return { kind: 'component', apiKey: 'input' }
  if (kind === 'vnode')
    return {
      kind: 'node',
      node: { kind: 'text', nodeId: nodeId('text'), value: { kind: 'literal', value: '内容' } },
    }
  if (kind === 'element') return { kind: 'dom', nodeId: 'root' }
  if (kind === 'regexp') return { kind: 'regexp', source: '', flags: '' }
  return { kind: 'literal', value: prop?.enumValues[0] ?? '' }
}
export function makeApiNode(
  apiKey: string,
  declareState?: (key: string, value: TypedValue) => void,
): ApiNode {
  const api = findElementPlusApi(apiKey)
  if (!api || api.parentApiKey || api.propPath)
    throw new Error('请选择可渲染的公开 API，内部对象 API 在父属性中配置')
  const node: ApiNode = { kind: api.kind, apiKey, nodeId: nodeId(apiKey), props: {} }
  for (const prop of api.props.filter((item) => item.required))
    node.props[prop.name] = defaultTypedValue(prop)
  const model = api.props.find((prop) => prop.runtimeName === 'modelValue')
  if (model && declareState) {
    const key = `value-${node.nodeId}`
    declareState(key, defaultTypedValue(model))
    node.models = { [model.name]: { kind: 'binding', source: 'state', path: [key] } }
    delete node.props[model.name]
  }
  if (
    api.slots.some((slot) => slot.name === 'default') &&
    ['button', 'link', 'text', 'tag', 'card'].includes(apiKey)
  )
    node.slots = {
      default: [
        { kind: 'text', nodeId: nodeId('text'), value: { kind: 'literal', value: '示例内容' } },
      ],
    }
  return node
}
export function parsePath(text: string): (string | number)[] {
  return text
    .split('.')
    .filter(Boolean)
    .map((key) => (/^\d+$/.test(key) ? Number(key) : key))
}

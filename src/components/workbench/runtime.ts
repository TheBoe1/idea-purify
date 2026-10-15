import {
  h,
  reactive,
  shallowReactive,
  withDirectives,
  type Component,
  type Directive,
  type DirectiveBinding,
  type VNode,
} from 'vue'
import * as Element from 'element-plus'
import * as Icons from '@element-plus/icons-vue'
import DOMPurify from 'dompurify'
import { findElementPlusApi, type ApiProp } from '../../../shared/catalog/element-plus.ts'
import type {
  ActionReference,
  ApiNode,
  CallbackReference,
  DataBinding,
  DataResource,
  SchemaV2,
  TypedValue,
  WorkbenchNode,
} from '../../../shared/contracts/workbench.ts'
import {
  getSafeRegexpError,
  getSafeStyleError,
  getSafeStyleValueError,
  getSafeSvgError,
  isSafeURL,
} from '../../../shared/contracts/workbench.ts'
import { authState } from '@/stores/auth'
import { getSessionGeneration } from '@/api/http'
import { loadIdeas } from '@/api/ideas'
import IdeaEntryForm from '@/components/ideas/IdeaEntryForm.vue'
import IdeaEntryPanel from '@/components/ideas/IdeaEntryPanel.vue'
import { readPath, runCallbackStrategy } from './callback-strategies'

const installed: Record<string, unknown> = { ...Element }
const icons: Record<string, unknown> = { ...Icons }
export const registeredIconNames = Object.keys(icons).sort()
export interface RenderContext {
  scope: Record<string, unknown>
  event: unknown[]
  instancePath: string
}
const emptyContext = (): RenderContext => ({ scope: {}, event: [], instancePath: 'root' })
let activeMessageBox: Promise<unknown> | undefined
function component(value: unknown): Component | undefined {
  return value && (typeof value === 'object' || typeof value === 'function')
    ? (value as Component)
    : undefined
}
function mergeScope(
  parent: Record<string, unknown>,
  own: Record<string, unknown>,
): Record<string, unknown> {
  const scope = Object.create(parent) as Record<string, unknown>
  for (const key of Object.keys(own))
    if (!['constructor', '__proto__', 'prototype'].includes(key))
      Object.defineProperty(scope, key, {
        enumerable: true,
        configurable: true,
        get: () => own[key],
        set: (value) => {
          own[key] = value
        },
      })
  return scope
}
function safeUrl(value: string) {
  if (!isSafeURL(value)) throw new Error('只允许安全的资源地址')
  return value
}
function safeStyle(value: Record<string, string | number>) {
  const message = getSafeStyleError(value)
  if (message) throw new Error(message)
  return value
}
function clone(value: unknown): unknown {
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]))
  return value
}
function listenerName(event: string) {
  return `on${event.replace(/(^|-)(\w)/g, (_match, _dash, letter: string) => letter.toUpperCase())}`
}

export function createWorkbenchRuntime(schema: SchemaV2, mode: 'preview' | 'published') {
  const state = reactive<Record<string, unknown>>({})
  const data = reactive<Record<string, unknown>>({})
  const errors = reactive<Record<string, string>>({})
  const instances = shallowReactive(new Map<string, unknown>())
  const targets = shallowReactive(new Map<string, HTMLElement>())
  const nodes = new Map<string, ApiNode>()
  const disposers = new Set<() => void>()
  const mountedServices = new Set<string>()
  const initialScopes = new Map<string, unknown>()
  const literalCache = new WeakMap<object, unknown>()
  const collectionCache = new WeakMap<
    object,
    Map<
      string,
      { source: Record<string, unknown> | unknown[]; result: Record<string, unknown> | unknown[] }
    >
  >()
  const directiveAdapters = new Map<
    string,
    {
      directive: Directive
      config: {
        implementation: Directive
        target?: HTMLElement
        attributes: Record<string, unknown>
      }
    }
  >()
  const callbackCache = new WeakMap<
    CallbackReference,
    Map<string, { context: RenderContext; callback: (...args: unknown[]) => unknown }>
  >()
  let serviceCounter = 0
  let disposed = false
  const resolveRecord = (record: Record<string, TypedValue>, context: RenderContext) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, resolve(value, context)]))
  function protectProperty(value: unknown, prop?: ApiProp) {
    if (!prop) return value
    if (
      ['href', 'src', 'action', 'url', 'poster'].includes(prop.runtimeName) &&
      typeof value === 'string' &&
      value
    )
      return safeUrl(value)
    if (/style$/i.test(prop.runtimeName) && value !== undefined && value !== null) {
      const error = getSafeStyleValueError(value)
      if (error) throw new Error(error)
    }
    if (prop.runtimeName.startsWith('--el-'))
      safeStyle({ [prop.runtimeName]: value as string | number })
    if (['svg', 'elementLoadingSvg'].includes(prop.runtimeName) && typeof value === 'string') {
      const error = getSafeSvgError(value)
      if (error) throw new Error(error)
      return DOMPurify.sanitize(value, { USE_PROFILES: { svg: true, svgFilters: true } })
    }
    return value
  }
  function registerElement(id: string, element: unknown) {
    if (element instanceof HTMLElement) targets.set(id, element)
    else targets.delete(id)
  }
  function collection(
    value: TypedValue,
    source: Record<string, unknown> | unknown[],
    context: RenderContext,
  ) {
    const cache = collectionCache.get(value) ?? new Map()
    collectionCache.set(value, cache)
    const current = cache.get(context.instancePath)
    if (
      current &&
      Object.keys(source).length === Object.keys(current.source).length &&
      Object.entries(source).every(([key, item]) =>
        Object.is(item, Reflect.get(current.source, key)),
      )
    )
      return current.result
    const result = reactive(source)
    cache.set(context.instancePath, {
      source: Array.isArray(source) ? [...source] : { ...source },
      result,
    })
    return result
  }
  function contextualInstance(map: Map<string, unknown>, nodeId: string, context: RenderContext) {
    let path = context.instancePath
    while (path) {
      const instance = map.get(`${path}/${nodeId}`)
      if (instance !== undefined) return instance
      const separator = path.lastIndexOf('/')
      path = separator < 0 ? '' : path.slice(0, separator)
    }
    return map.get(nodeId)
  }
  function binding(value: DataBinding, context: RenderContext) {
    if (value.source === 'scope' && value.path.length && !(value.path[0]! in context.scope))
      throw new Error('绑定引用不在当前作用域中')
    const sources = {
      state,
      data,
      scope: context.scope,
      event: context.event,
      auth: authState.user,
    }
    return readPath(sources[value.source], value.path)
  }
  function write(binding: DataBinding, value: unknown, context = emptyContext()) {
    if (
      !['state', 'scope'].includes(binding.source) ||
      !binding.path.length ||
      binding.path.some((key) => ['__proto__', 'prototype', 'constructor'].includes(String(key)))
    )
      throw new Error('只能更新已登记的实例状态或当前作用域')
    if (binding.source === 'scope' && !(binding.path[0]! in context.scope))
      throw new Error('可写绑定不在当前作用域中')
    const snapshotKey = `${context.instancePath}/${binding.path.join('.')}`
    if (binding.source === 'scope' && !initialScopes.has(snapshotKey))
      initialScopes.set(snapshotKey, clone(readPath(context.scope, binding.path)))
    let target: Record<string | number, unknown> =
      binding.source === 'state' ? state : context.scope
    for (const key of binding.path.slice(0, -1)) {
      const child = target[key]
      if (!child || typeof child !== 'object') target[key] = {}
      target = target[key] as Record<string | number, unknown>
    }
    target[binding.path[binding.path.length - 1]!] = value
  }
  function callable(
    reference: CallbackReference,
    context: RenderContext,
    prop?: ApiProp,
  ): (...args: unknown[]) => unknown {
    const cache = callbackCache.get(reference) ?? new Map()
    callbackCache.set(reference, cache)
    const cacheKey = `${context.instancePath}/${prop?.runtimeName ?? ''}`
    const existing = cache.get(cacheKey)
    if (existing) {
      existing.context = context
      return existing.callback
    }
    const entry = {
      context,
      callback: (...args: unknown[]) => {
        const generation = getSessionGeneration()
        const invocation = { ...entry.context, event: args }
        if (reference.gate && !resolve(reference.gate, invocation)) return undefined
        const params = resolveRecord(reference.params, invocation)
        if (
          !params.resultMode &&
          reference.callbackKey === 'validate' &&
          prop?.runtimeName === 'inputValidator'
        )
          params.resultMode = 'message'
        if (
          !params.resultMode &&
          reference.callbackKey === 'filter' &&
          ['filterMethod', 'filterNodeMethod'].includes(prop?.runtimeName ?? '')
        )
          params.resultMode = 'match'
        const resource =
          reference.callbackKey === 'lazy-load' && typeof params.resourceId === 'string'
            ? schema.resources.find((item) => item.resourceId === params.resourceId)
            : undefined
        const result = resource
          ? loadResource(resource, invocation).then((value) =>
              runCallbackStrategy(reference.callbackKey, args, { ...params, data: value }),
            )
          : runCallbackStrategy(reference.callbackKey, args, params)
        const publishResult = (value: unknown) => {
          const safe = protectProperty(value, prop)
          if (reference.result && !disposed && generation === getSessionGeneration())
            write(reference.result, safe, invocation)
          return safe
        }
        if (reference.mode === 'resolve') {
          const callback =
            reference.resolveIndex === undefined ? undefined : args[reference.resolveIndex]
          const reject =
            reference.rejectIndex === undefined ? undefined : args[reference.rejectIndex]
          if (
            typeof callback !== 'function' ||
            (reference.rejectIndex !== undefined && typeof reject !== 'function')
          )
            throw new Error('回调参数与公开 resolve/reject 索引不匹配')
          const complete = (value: unknown) => {
            if (disposed || generation !== getSessionGeneration()) return undefined
            publishResult(value)
            if (
              prop?.runtimeName === 'beforeClose' &&
              (value instanceof Error ||
                value === false ||
                (typeof value === 'string' && value.length > 0))
            )
              return undefined
            if (value instanceof Error && typeof reject === 'function') reject(value)
            else if (prop?.runtimeName === 'beforeClose') callback()
            else callback(value)
            return undefined
          }
          const failure = (error: unknown) => {
            if (disposed || generation !== getSessionGeneration()) return undefined
            if (typeof reject === 'function') return reject(error)
            if (prop?.runtimeName !== 'beforeClose') callback(error)
            return undefined
          }
          if (result instanceof Promise) return result.then(complete, failure)
          return complete(result)
        }
        if (reference.mode === 'promise')
          return result instanceof Error
            ? Promise.reject(result)
            : Promise.resolve(result).then(publishResult)
        return result instanceof Promise ? result.then(publishResult) : publishResult(result)
      },
    }
    cache.set(cacheKey, entry)
    return entry.callback
  }
  function resolve(
    value: TypedValue,
    context: RenderContext = emptyContext(),
    prop?: ApiProp,
  ): unknown {
    switch (value.kind) {
      case 'literal': {
        if (!literalCache.has(value)) {
          const copy = clone(value.value)
          literalCache.set(value, copy && typeof copy === 'object' ? reactive(copy) : copy)
        }
        return literalCache.get(value)
      }
      case 'binding':
        return binding(value, context)
      case 'array':
        return collection(
          value,
          value.items.map((item) => resolve(item, context)),
          context,
        )
      case 'object': {
        const api = value.apiKey ? findElementPlusApi(value.apiKey) : undefined
        return collection(
          value,
          Object.fromEntries(
            Object.entries(value.entries).map(([key, item]) => {
              const metadata = api?.props.find(
                (prop) => prop.name === key || prop.runtimeName === key,
              )
              return [metadata?.runtimeName ?? key, resolve(item, context, metadata)]
            }),
          ),
          context,
        )
      }
      case 'date':
        return new Date(value.value)
      case 'regexp': {
        const error = getSafeRegexpError(value.source, value.flags)
        if (error) throw new Error(error)
        return new RegExp(value.source, value.flags)
      }
      case 'icon': {
        const icon = component(icons[value.name])
        if (!icon) throw new Error('图标未注册')
        return icon
      }
      case 'component': {
        const api = findElementPlusApi(value.apiKey)
        const implementation = api && component(installed[api.runtimeExport])
        if (!implementation) throw new Error('组件引用未注册')
        return implementation
      }
      case 'node':
        return renderNode(value.node, context)
      case 'callback':
        return callable(value.reference, context, prop)
      case 'dom':
        return contextualInstance(targets, value.nodeId, context)
      case 'ref': {
        const target = readPath(
          contextualInstance(instances, value.nodeId, context),
          value.path ?? [],
        )
        const node = nodes.get(value.nodeId)
        const facade = node?.kind === 'service' ? serviceFacade(node.apiKey) : undefined
        const implementation = value.expose
          ? (readPath(target, [value.expose]) ?? readPath(facade, [value.expose]))
          : target
        return typeof implementation === 'function'
          ? implementation.bind(target ?? facade)
          : implementation
      }
      case 'html':
        return DOMPurify.sanitize(value.value, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
        })
      case 'style':
        return safeStyle(value.value)
    }
  }
  for (const [key, value] of Object.entries(schema.state)) state[key] = resolve(value)
  const initial = Object.fromEntries(
    Object.entries(state).map(([key, value]) => [key, clone(value)]),
  )
  async function loadResource(resource: DataResource, context = emptyContext()) {
    const generation = getSessionGeneration()
    const params = resolveRecord(resource.params ?? {}, context)
    let result: unknown
    if (resource.sourceKey === 'static')
      result = resource.data ? resolve(resource.data, context) : []
    else if (resource.sourceKey === 'current-user-ideas')
      result =
        mode === 'preview'
          ? [{ ideaId: 'preview-idea', ideaContent: '预览想法', createdTime: '' }]
          : await loadIdeas()
    else if (resource.sourceKey === 'preview-search') {
      const items = Array.isArray(params.items)
        ? params.items
        : [
            { label: '示例选项一', value: 'one' },
            { label: '示例选项二', value: 'two' },
          ]
      result = runCallbackStrategy('filter', [params.query ?? ''], { ...params, options: items })
    } else if (resource.sourceKey === 'preview-tree')
      result = resource.data
        ? resolve(resource.data, context)
        : [{ id: 'parent', label: '父节点', children: [{ id: 'child', label: '子节点' }] }]
    else result = { status: 'success', name: 'preview-file' }
    if (!disposed && generation === getSessionGeneration()) data[resource.resourceId] = result
    return result
  }
  async function execute(actions: ActionReference[], context = emptyContext()) {
    for (const action of actions) {
      if (disposed) return
      const params = resolveRecord(
        Object.fromEntries(Object.entries(action.params).filter(([key]) => key !== 'target')),
        context,
      )
      const writable = action.params.target?.kind === 'binding' ? action.params.target : undefined
      if (action.actionKey === 'set-state') {
        if (!writable) throw new Error('状态目标必须使用绑定')
        write(writable, params.value, context)
      }
      if (action.actionKey === 'reset-state') {
        if (writable)
          write(
            writable,
            clone(
              writable.source === 'state'
                ? readPath(initial, writable.path)
                : initialScopes.get(`${context.instancePath}/${writable.path.join('.')}`),
            ),
            context,
          )
        else {
          Object.keys(state).forEach((key) => delete state[key])
          Object.assign(state, clone(initial))
        }
      }
      if (action.actionKey === 'show-message')
        Element.ElMessage({
          message: String(params.message ?? ''),
          type: ['success', 'warning', 'info', 'error'].includes(String(params.type))
            ? (params.type as 'success' | 'warning' | 'info' | 'error')
            : 'info',
          dangerouslyUseHTMLString: false,
        })
      if (action.actionKey === 'load-data') {
        const resource = schema.resources.find((item) => item.resourceId === params.resourceId)
        if (!resource) throw new Error('数据源未登记')
        const result = await loadResource(
          {
            ...resource,
            params: {
              ...resource.params,
              ...(action.params.params?.kind === 'object' ? action.params.params.entries : {}),
            },
          },
          context,
        )
        if (writable) write(writable, result, context)
      }
      if (action.actionKey === 'method') {
        const reference = action.params.target
        if (reference?.kind !== 'ref' || !reference.expose)
          throw new Error('方法目标必须是公开方法引用')
        const node = nodes.get(reference.nodeId)
        const api = findElementPlusApi(reference.apiKey ?? node?.apiKey ?? '')
        if (!api?.exposes.some((item) => item.name === reference.expose))
          throw new Error('实例方法未注册')
        const implementation = resolve(reference, context)
        if (typeof implementation !== 'function') throw new Error('实例尚未准备好')
        const result: unknown = implementation(...(Array.isArray(params.args) ? params.args : []))
        if (node?.kind === 'service') await rememberServiceResult(node, result, context)
        else await result
      }
      if (action.actionKey === 'service') {
        const api = findElementPlusApi(String(params.apiKey ?? ''))
        if (!api || api.kind !== 'service') throw new Error('服务 API 未登记')
        const node: ApiNode = {
          kind: 'service',
          apiKey: api.apiKey,
          nodeId: `service-action-${serviceCounter++}`,
          props: action.params.options?.kind === 'object' ? action.params.options.entries : {},
        }
        await invokeService(node, context)
      }
    }
  }
  function properties(node: ApiNode, context: RenderContext) {
    const api = findElementPlusApi(node.apiKey)
    if (!api) throw new Error('API 未注册')
    const result: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(node.props)) {
      const metadata = api.props.find((item) => item.name === name || item.runtimeName === name)
      if (!metadata) throw new Error(`属性未注册：${name}`)
      const resolved = protectProperty(resolve(value, context, metadata), metadata)
      result[metadata.runtimeName] = resolved
    }
    if (result.dangerouslyUseHTMLString || result.rawContent)
      for (const key of ['message', 'content'])
        if (typeof result[key] === 'string') result[key] = DOMPurify.sanitize(result[key])
    for (const [name, reference] of Object.entries(node.callbacks ?? {})) {
      const metadata = api.props.find((item) => item.name === name || item.runtimeName === name)
      if (!metadata) throw new Error(`回调未注册：${name}`)
      result[metadata.runtimeName] = callable(reference, context, metadata)
    }
    if (node.apiKey === 'upload') {
      const configured = result.httpRequest
      // 保留所配置回调与返回结果，默认上传也经登记策略处理，预览不发任意 XHR。
      result.httpRequest =
        typeof configured === 'function'
          ? (...args: unknown[]) => Promise.resolve(configured(...args))
          : callable({ callbackKey: 'preview-upload', params: {}, mode: 'promise' }, context)
    }
    for (const [name, model] of Object.entries(node.models ?? {})) {
      const runtimeName =
        api.props.find((item) => item.name === name || item.runtimeName === name)?.runtimeName ??
        name
      result[runtimeName] = binding(model, context)
      result[listenerName(`update:${runtimeName}`)] = (value: unknown) =>
        write(model, value, context)
    }
    for (const [name, actions] of Object.entries(node.events ?? {})) {
      const eventName = listenerName(name)
      const previous = result[eventName]
      result[eventName] = (...args: unknown[]) => {
        if (typeof previous === 'function') previous(...args)
        void execute(actions, { ...context, event: args }).catch((error) => {
          errors[node.nodeId] = error instanceof Error ? error.message : '动作失败'
        })
      }
    }
    return result
  }
  function serviceFacade(apiKey: string): unknown {
    const runtimeExport = findElementPlusApi(apiKey)?.runtimeExport
    if (runtimeExport === 'ElLoadingService') return Element.ElLoading.service
    return runtimeExport ? installed[runtimeExport] : undefined
  }
  function directiveAdapter(
    id: string,
    implementation: Directive,
    target: HTMLElement | undefined,
    attributes: Record<string, unknown>,
  ) {
    const existing = directiveAdapters.get(id)
    if (existing) {
      existing.config = { implementation, target, attributes }
      return existing.directive
    }
    let current: HTMLElement | undefined
    const previousAttributes = new Map<string, string | null>()
    const entry = { config: { implementation, target, attributes }, directive: {} as Directive }
    const invoke = (
      name: 'mounted' | 'updated' | 'unmounted',
      element: HTMLElement,
      binding: DirectiveBinding,
      vnode: VNode,
      previous: VNode | null,
    ) => {
      const hook =
        typeof entry.config.implementation === 'function'
          ? name === 'unmounted'
            ? undefined
            : entry.config.implementation
          : entry.config.implementation[name]
      if (typeof hook === 'function')
        Reflect.apply(hook, undefined, [element, binding, vnode, previous])
    }
    const restore = () => {
      if (current)
        for (const [key, value] of previousAttributes) {
          if (value === null) current.removeAttribute(key)
          else current.setAttribute(key, value)
        }
      previousAttributes.clear()
    }
    const update = (
      element: HTMLElement,
      binding: DirectiveBinding,
      vnode: VNode,
      previous: VNode | null,
    ) => {
      const next = entry.config.target ?? element
      if (current && current !== next) {
        invoke('unmounted', current, binding, vnode, previous)
        restore()
        current = undefined
      }
      const first = !current
      current = next
      for (const [key, value] of Object.entries(entry.config.attributes)) {
        if (!previousAttributes.has(key)) previousAttributes.set(key, next.getAttribute(key))
        if (value !== undefined && value !== null) next.setAttribute(key, String(value))
        else next.removeAttribute(key)
      }
      invoke(first ? 'mounted' : 'updated', next, binding, vnode, previous)
    }
    entry.directive = {
      mounted: update,
      updated: update,
      unmounted: (element, binding, vnode, previous) => {
        invoke('unmounted', current ?? element, binding, vnode, previous)
        restore()
      },
    }
    directiveAdapters.set(id, entry)
    return entry.directive
  }
  async function invokeService(node: ApiNode, context: RenderContext) {
    const options = properties(node, context)
    let result: unknown
    if (node.apiKey === 'message') result = Element.ElMessage(options)
    else if (node.apiKey === 'notification') result = Element.ElNotification(options)
    else if (node.apiKey.startsWith('message-box')) result = Element.ElMessageBox(options)
    else if (node.apiKey === 'loading-service') {
      const target = Object.hasOwn(node.props, 'target') ? options.target : targets.get('root')
      if (!(target instanceof HTMLElement))
        throw new Error('加载目标尚未挂载，请引用已登记的 DOM 节点')
      result = Element.ElLoading.service({ ...options, target })
    } else throw new Error('服务实现未注册')
    await rememberServiceResult(node, result, context)
  }
  async function rememberServiceResult(node: ApiNode, result: unknown, context: RenderContext) {
    instances.set(`${context.instancePath}/${node.nodeId}`, result)
    const close = readPath(result, ['close'])
    if (typeof close === 'function') disposers.add(() => close.call(result))
    if (result instanceof Promise) {
      if (node.apiKey.startsWith('message-box')) {
        activeMessageBox = result
        const owned = result
        disposers.add(() => {
          if (activeMessageBox === owned) {
            Element.ElMessageBox.close()
            activeMessageBox = undefined
          }
        })
      }
      try {
        await result
      } catch {
        /* 确认框取消是正常用户行为。 */
      } finally {
        if (activeMessageBox === result) activeMessageBox = undefined
      }
    }
  }
  function renderNode(
    node: WorkbenchNode,
    context: RenderContext,
  ): VNode | (VNode | string)[] | string {
    const instanceId = `${context.instancePath}/${node.nodeId}`
    try {
      if (node.kind === 'text') {
        const value = resolve(node.value, context)
        return value == null ? '' : String(value)
      }
      if (node.kind === 'for') {
        const items = resolve(node.items, context)
        if (!Array.isArray(items)) throw new Error('循环数据必须为数组')
        const seen = new Set<string>()
        return items.slice(0, 1000).flatMap((item, index) => {
          const id = String(
            readPath(item, ['id']) ??
              readPath(item, ['key']) ??
              readPath(item, ['ideaId']) ??
              index,
          )
          const uniqueId = seen.has(id) ? `${id}-${index}` : id
          seen.add(id)
          const itemScope = Object.create(context.scope) as Record<string, unknown>
          Object.defineProperty(itemScope, node.itemName, {
            enumerable: true,
            get: () => items[index],
            set: (value) => {
              items[index] = value
            },
          })
          if (node.indexName) itemScope[node.indexName] = index
          return renderNodes(node.children, {
            ...context,
            instancePath: `${instanceId}/${encodeURIComponent(uniqueId)}`,
            scope: itemScope,
          })
        })
      }
      if (node.kind === 'if')
        return renderNodes(
          resolve(node.test, context) ? node.children : (node.elseChildren ?? []),
          context,
        )
      if (node.kind === 'business') {
        if (mode === 'published')
          return h(IdeaEntryPanel, { key: instanceId, draftKey: instanceId })
        return h(IdeaEntryForm, {
          key: instanceId,
          modelValue: String(state[`preview-${instanceId}`] ?? ''),
          submitting: false,
          saved: Boolean(state[`saved-${instanceId}`]),
          'onUpdate:modelValue': (value: string) => {
            state[`preview-${instanceId}`] = value
            state[`saved-${instanceId}`] = false
          },
          onSubmit: () => {
            state[`saved-${instanceId}`] = true
          },
        })
      }
      nodes.set(node.nodeId, node)
      const api = findElementPlusApi(node.apiKey)
      if (!api) throw new Error('组件 API 未注册')
      const attributes = properties(node, context)
      if (node.kind === 'service') {
        const run = () => {
          void invokeService(node, context).catch((error) => {
            errors[node.nodeId] = error instanceof Error ? error.message : '服务失败'
          })
        }
        if (node.trigger === 'mount' && !mountedServices.has(instanceId)) {
          mountedServices.add(instanceId)
          queueMicrotask(() => {
            if (!disposed) run()
          })
        }
        const labels: Record<string, string> = {
          ElMessage: '显示消息',
          ElMessageBox: '打开确认框',
          ElNotification: '显示通知',
          ElLoadingService: '显示加载',
        }
        return h('div', { key: instanceId }, [
          h(Element.ElButton, { onClick: run }, () => labels[api.runtimeExport] ?? '执行'),
          errors[node.nodeId]
            ? h(Element.ElAlert, { title: errors[node.nodeId], type: 'error', closable: false })
            : null,
        ])
      }
      if (node.kind === 'design') {
        const samples =
          node.apiKey === 'border'
            ? [
                h(
                  'div',
                  {
                    style: {
                      border: 'var(--el-border)',
                      borderRadius: 'var(--el-border-radius-base)',
                      padding: 'var(--el-border-radius-round)',
                    },
                  },
                  '边框与圆角',
                ),
              ]
            : node.apiKey === 'color'
              ? ['primary', 'success', 'warning', 'danger', 'info'].map((color) =>
                  h(
                    'span',
                    {
                      style: {
                        display: 'inline-block',
                        padding: '12px',
                        margin: '4px',
                        backgroundColor: `var(--el-color-${color})`,
                        color: 'white',
                      },
                    },
                    color,
                  ),
                )
              : [
                  h(
                    'h3',
                    {
                      style: {
                        fontSize: 'var(--el-font-size-extra-large)',
                        fontFamily: 'var(--el-font-family)',
                        fontWeight: 'var(--el-font-weight-primary)',
                      },
                    },
                    '标题 Typography',
                  ),
                  h(
                    'p',
                    {
                      style: {
                        fontSize: 'var(--el-font-size-base)',
                        lineHeight: 'var(--el-font-line-height-primary)',
                        color: 'var(--el-text-color-primary)',
                      },
                    },
                    '正文排版：想法成为下一步行动。',
                  ),
                ]
        return h(
          'div',
          {
            key: instanceId,
            ref: (element: unknown) => registerElement(instanceId, element),
            class: 'design-preview',
            style: safeStyle(attributes as Record<string, string | number>),
          },
          [...samples, ...renderNodes(node.children ?? [], context)],
        )
      }
      if (node.kind === 'directive') {
        const implementation =
          node.apiKey === 'loading-directive'
            ? Element.ElLoading.directive
            : installed[api.runtimeExport]
        const value =
          node.apiKey === 'loading-directive'
            ? attributes.vLoading
            : node.apiKey === 'popover-directive'
              ? attributes.value
              : attributes.vInfiniteScroll
        const directiveAttributes = Object.fromEntries(
          api.props
            .filter((prop) => !prop.name.startsWith('v-') && prop.name !== 'value')
            .map((prop) => [prop.name, attributes[prop.runtimeName]]),
        )
        const target = node.target ? contextualInstance(targets, node.target, context) : undefined
        if (node.target && !(target instanceof HTMLElement)) throw new Error('指令目标尚未挂载')
        const child = h(
          'div',
          {
            key: instanceId,
            ref: (element: unknown) => registerElement(instanceId, element),
            style: { maxHeight: '240px', overflow: 'auto', minHeight: '80px' },
          },
          renderNodes(node.children ?? [], context),
        )
        return withDirectives(child, [
          [
            directiveAdapter(
              instanceId,
              implementation as Directive,
              target as HTMLElement | undefined,
              directiveAttributes,
            ),
            value,
          ],
        ])
      }
      const implementation = component(installed[api.runtimeExport])
      if (!implementation) throw new Error('组件实现未安装')
      const slots = Object.fromEntries(
        Object.entries(node.slots ?? {}).map(([name, children]) => [
          name,
          (slotScope: unknown) => {
            const rowIdentity =
              readPath(slotScope, ['row', 'id']) ??
              readPath(slotScope, ['row', 'key']) ??
              readPath(slotScope, ['$index']) ??
              'single'
            return renderNodes(children, {
              ...context,
              instancePath: `${instanceId}/slot-${name}/${encodeURIComponent(String(rowIdentity))}`,
              scope: mergeScope(
                context.scope,
                slotScope && typeof slotScope === 'object'
                  ? (slotScope as Record<string, unknown>)
                  : {},
              ),
            })
          },
        ]),
      )
      if (!slots.default && node.children?.length)
        slots.default = () => renderNodes(node.children!, context)
      return h(
        implementation,
        {
          ...attributes,
          key: instanceId,
          ref: (instance: unknown) => {
            if (instance) {
              instances.set(instanceId, instance)
              const element = readPath(instance, ['$el']) ?? readPath(instance, ['el'])
              if (element instanceof HTMLElement) targets.set(instanceId, element)
            } else {
              instances.delete(instanceId)
              targets.delete(instanceId)
            }
          },
        },
        slots,
      )
    } catch (error) {
      return h(Element.ElAlert, {
        key: instanceId,
        title: error instanceof Error ? error.message : '节点渲染失败',
        type: 'error',
        closable: false,
      })
    }
  }
  function renderNodes(nodes: WorkbenchNode[], context = emptyContext()): (VNode | string)[] {
    return nodes.flatMap((node) => renderNode(node, context))
  }
  return {
    state,
    data,
    errors,
    resolve,
    write,
    execute,
    callable,
    renderNodes,
    setTarget: (id: string, target: HTMLElement) => {
      targets.set(id, target)
    },
    initialize: () => Promise.all(schema.resources.map((resource) => loadResource(resource))),
    dispose: () => {
      disposed = true
      disposers.forEach((dispose) => dispose())
      instances.clear()
      targets.clear()
    },
  }
}

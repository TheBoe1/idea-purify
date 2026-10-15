// @vitest-environment node
import { describe, expect, it } from 'vitest'
import assert from 'node:assert/strict'
import { ELEMENT_PLUS_APIS, ELEMENT_PLUS_VERSION, findElementPlusApi } from '../shared/catalog/element-plus.ts'
import { createDefaultSchemaV2, getSchemaV2Error, isSchemaV2, isRenderableApi, getSafeStyleValueError, getSafeSvgError } from '../shared/contracts/workbench.ts'
import type { ApiNode, SchemaV2, TypedValue } from '../shared/contracts/workbench.ts'

const literal = (value: string | number | boolean | null): TypedValue => ({ kind: 'literal', value })
function component(apiKey: string, props: ApiNode['props'] = {}): ApiNode {
  const required: Record<string, ApiNode['props']> = {
    'select-v2': { options: { kind: 'literal', value: [] } }, upload: { action: literal('') },
    'table-v2': { width: literal(400), height: literal(200) }, 'sub-menu': { index: literal('one') }, 'menu-item': { index: literal('one') },
  }
  return { nodeId: 'subject', kind: findElementPlusApi(apiKey)!.kind, apiKey, props: { ...required[apiKey], ...props } }
}
function document(node?: ApiNode): SchemaV2 { return { ...createDefaultSchemaV2('验收方案'), root: node ? [node] : [] } }
function rejected(value: unknown, fragment?: string) {
  const error = getSchemaV2Error(value)
  expect(error).toBeDefined()
  if (fragment) assert.ok(error?.includes(fragment), `Expected validation error containing ${fragment}, received ${error}`)
}

describe('V2 工作台持久化边界', () => {
  it('使用当前完整安装目录，所有公开根 API 与各 kind 均可表达，内部接口不能冒充组件', () => {
    const roots = ELEMENT_PLUS_APIS.filter(api => !api.parentApiKey)
    expect(new Set(roots.map(api => api.kind))).toEqual(new Set(['component', 'service', 'directive', 'design']))
    for (const api of roots) {
      const schema = document(component(api.apiKey))
      assert.equal(getSchemaV2Error(schema), undefined, api.apiKey)
    }
    const internal = ELEMENT_PLUS_APIS.filter(api => api.parentApiKey)
    expect(internal.length).toBeGreaterThan(0)
    for (const api of internal) {
      expect(isRenderableApi(api)).toBe(false)
      rejected(document(component(api.apiKey)), '内部对象')
      rejected({ ...document(), state: { item: { kind: 'component', apiKey: api.apiKey } } }, '组件引用')
    }
    rejected({ ...document(), libraryVersion: `${ELEMENT_PLUS_VERSION}-unknown` }, '版本')
  })

  it('属性枚举、函数、未知字段、原型字段和嵌套对象均按 API 校验', () => {
    expect(isSchemaV2(document(component('input', { type: literal('custom-input-type') })))).toBe(true)
    rejected(document(component('button', { type: literal('unregistered') })), '枚举')
    rejected(document(component('input', { imaginary: literal('value') })), '属性未注册')
    rejected(document(component('input', { formatter: literal('value => alert(value)') })), 'API 类型')
    rejected({ ...document(), state: JSON.parse('{"__proto__":{"kind":"literal","value":1}}') }, '字典')
    rejected(document(component('cascader', { props: { kind: 'literal', value: { nonexistent: 'x' } } })), '对象子属性')
    rejected(document(component('watermark', { font: { kind: 'object', entries: { imaginary: literal('x') } } })), '对象子属性')
    rejected(document(component('form-item', { rules: { kind: 'array', items: [{ kind: 'object', entries: { rawJavaScript: literal('run()') } }] } })), '对象子属性')
  })

  it('列表、槽和回调使用真实词法作用域，事件参数不得越过公开签名', () => {
    const schema = document()
    schema.state.rows = { kind: 'literal', value: ['a'] }
    schema.root = [{ nodeId: 'loop', kind: 'for', itemName: 'row', indexName: 'index', items: { kind: 'binding', source: 'state', path: ['rows'] },
      children: [{ nodeId: 'label', kind: 'text', value: { kind: 'binding', source: 'scope', path: ['row'] } }] }]
    expect(getSchemaV2Error(schema)).toBeUndefined()
    const badScope = structuredClone(schema)
    const loop = badScope.root[0]!
    if (loop.kind === 'for') loop.children = [{ nodeId: 'wrong', kind: 'text', value: { kind: 'binding', source: 'scope', path: ['missing'] } }]
    rejected(badScope, '作用域未声明')
    const table = component('table-v2', {})
    table.slots = { cell: [{ nodeId: 'cellValue', kind: 'text', value: { kind: 'binding', source: 'scope', path: ['rowData', 'name'] } }] }
    expect(getSchemaV2Error(document(table))).toBeUndefined()
    table.slots.cell![0] = { nodeId: 'cellValue', kind: 'text', value: { kind: 'binding', source: 'scope', path: ['nonexistent'] } }
    rejected(document(table), '作用域未声明')
    const button = component('button')
    button.events = { click: [{ actionKey: 'show-message', params: { message: { kind: 'binding', source: 'event', path: [0] } } }] }
    expect(getSchemaV2Error(document(button))).toBeUndefined()
    button.events.click![0]!.params.message = { kind: 'binding', source: 'event', path: [20] }
    rejected(document(button), '事件参数索引')
  })

  it('回调遵循签名和结果模式，resolve 显式区分成功与失败参数', () => {
    const tree = component('tree')
    tree.callbacks = { load: { callbackKey: 'lazy-load', params: { data: { kind: 'literal', value: [] } }, mode: 'resolve', resolveIndex: 1, rejectIndex: 2 } }
    expect(getSchemaV2Error(document(tree))).toBeUndefined()
    tree.callbacks.load!.resolveIndex = 2
    rejected(document(tree), '不同')
    tree.callbacks.load!.resolveIndex = 20
    rejected(document(tree), '索引')
    const transfer = component('transfer')
    transfer.callbacks = { 'filter-method': { callbackKey: 'filter', params: { query: literal('a'), options: { kind: 'literal', value: [] }, resultMode: literal('list') } } }
    rejected(document(transfer), 'boolean')
    transfer.callbacks['filter-method']!.params.resultMode = literal('match')
    expect(getSchemaV2Error(document(transfer))).toBeUndefined()
    const box = component('message-box')
    box.callbacks = { inputValidator: { callbackKey: 'validate', params: { value: literal('x'), resultMode: literal('error') } } }
    rejected(document(box), 'inputValidator')
    box.callbacks.inputValidator!.params.resultMode = literal('message')
    expect(getSchemaV2Error(document(box))).toBeUndefined()
  })

  it('拒绝越权数据源、未公开方法、危险 URL / HTML / style 和可执行脚本', () => {
    rejected({ ...document(), resources: [{ resourceId: 'mine', sourceKey: 'current-user-ideas', params: { userId: literal('other') } }] }, '归属')
    rejected(document(component('image', { src: literal('javascript:alert(1)') })), 'URL')
    rejected({ ...document(), state: { html: { kind: 'html', value: '<img src=x onerror=alert(1)>' } } }, 'HTML')
    rejected({ ...document(), state: { style: { kind: 'style', value: { background: 'url(https://example.com)' } } } }, '样式')
    rejected({ ...document(), state: { executable: { kind: 'javascript', value: 'alert(1)' } } }, '类型未注册')
    const input = component('input')
    input.events = { change: [{ actionKey: 'method', params: { target: { kind: 'ref', nodeId: 'subject', expose: 'dropDatabase' } } }] }
    rejected(document(input), '实例方法未公开')
    input.events.change![0]!.params.target = { kind: 'ref', nodeId: 'subject', expose: 'focus' }
    expect(getSchemaV2Error(document(input))).toBeUndefined()
  })

  it('配置上限按 UTF-8 字节计算，嵌套节点使用同一个预算', () => {
    const schema = document()
    for (let index = 0; index < 6; index++) schema.state[`part${index}`] = literal('中'.repeat(7000))
    expect(getSchemaV2Error(schema)).toBeUndefined()
    schema.state.part6 = literal('中'.repeat(7000))
    rejected(schema, '128 KiB')
    const oversized = document()
    oversized.root = Array.from({ length: 201 }, (_, index) => ({ nodeId: `text${index}`, kind: 'text', value: literal('x') }))
    rejected(oversized, '上限')
  })

  it('嵌套服务选项和 callback 里的 VNode 只遍历一次，合法节点不会误报重复 ID', () => {
    const button = component('button')
    button.events = { click: [{ actionKey: 'service', params: { apiKey: literal('message'), options: { kind: 'object', entries: {
      message: { kind: 'node', node: { nodeId: 'noticeText', kind: 'text', value: literal('合法内容') } },
    } } } }] }
    expect(getSchemaV2Error(document(button))).toBeUndefined()
    const box = component('message-box', { message: { kind: 'callback', reference: { callbackKey: 'format', params: {
      node: { kind: 'node', node: { nodeId: 'callbackText', kind: 'text', value: literal('回调内容') } },
    } } } })
    expect(getSchemaV2Error(document(box))).toBeUndefined()
    button.events.click![0]!.params.options = null as unknown as TypedValue
    rejected(document(button), '服务选项')
  })

  it('所有公开样式属性复用 CSS 安全边界，SVG 只允许几何标签和静态属性', () => {
    expect(getSafeStyleValueError(['color: red; margin-top: 4px', { fontSize: 14 }])).toBeUndefined()
    expect(getSafeStyleValueError('color:red;background:url(https://example.com)')).toBeDefined()
    expect(getSafeStyleValueError('width: expression(alert(1))')).toBeDefined()
    const tooltip = component('tooltip', { 'popper-style': literal('color: red; padding: 4px') })
    expect(getSchemaV2Error(document(tooltip))).toBeUndefined()
    tooltip.props['popper-style'] = { kind: 'object', entries: { 'background;position': { kind: 'binding', source: 'auth', path: ['nickname'] } } }
    rejected(document(tooltip), '样式字段')
    const geometry = '<svg viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20" fill="none" /></svg>'
    expect(getSafeSvgError(geometry)).toBeUndefined()
    expect(getSafeSvgError('<path d="M 0 0 L 10 10"/>')).toBeUndefined()
    for (const svg of ['<svg onload="alert(1)"></svg>', '<script>alert(1)</script>', '<image href="javascript:alert(1)"/>', '<path d="M 0" style="fill:url(x)"/>']) {
      expect(getSafeSvgError(svg)).toBeDefined()
      rejected(document(component('loading-service', { svg: literal(svg) })), 'SVG')
    }
  })
})

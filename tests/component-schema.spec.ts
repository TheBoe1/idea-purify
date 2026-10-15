import { describe, expect, it } from 'vitest'
import {
  COMPONENT_DEFINITIONS, getComponentSchemaError, getSaveComponentConfigError,
  isComponentConfig, isComponentDefinition, isComponentSchema,
} from '../shared/contracts/component-config.ts'
import type { ComponentSchema } from '../shared/contracts/component-config.ts'

const input = (): ComponentSchema => ({ schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'input',
  name: 'Idea 标题', props: { placeholder: '请输入标题', clearable: true, maxlength: 64 },
  field: 'ideaTitle', validation: { required: true, minLength: 2, maxLength: 64 }, children: [], actions: [] })
const button = (): ComponentSchema => ({ schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'button',
  name: '提示按钮', props: { text: '查看提示', type: 'primary' }, children: [],
  actions: [{ event: 'click', actionKey: 'show-message', message: '配置不会提交预览输入。' }] })

describe('配置合同：可保存的数据与执行能力边界', () => {
  it('接受字段校验输入、多行输入和固定消息动作，HTML 只作为文本数据', () => {
    expect(getComponentSchemaError(input())).toBeUndefined()
    expect(getComponentSchemaError({ ...input(), componentKey: 'textarea', props: { rows: 4, placeholder: '多行内容' } })).toBeUndefined()
    expect(getComponentSchemaError(button())).toBeUndefined()
    expect(isComponentSchema({ ...button(), props: { text: '<script>alert(1)</script>' } })).toBe(true)
    expect(getSaveComponentConfigError({ schema: input() })).toBeUndefined()
  })

  it.each([
    ['未知版本', () => ({ ...input(), schemaVersion: 2 })],
    ['未知组件库', () => ({ ...input(), libraryKey: 'external' })],
    ['未注册模块路径', () => ({ ...input(), componentKey: '../../admin/execute' })],
    ['可执行属性', () => ({ ...input(), props: { onInput: 'fetch("/api/idea")' } })],
    ['HTML 属性', () => ({ ...input(), props: { innerHTML: '<script>alert(1)</script>' } })],
    ['原型污染字段', () => ({ ...input(), props: JSON.parse('{"__proto__":{"polluted":true}}') })],
    ['实例原型', () => ({ ...input(), props: new Date() })],
    ['动态输入事件', () => ({ ...input(), actions: [{ event: 'input', actionKey: 'show-message', message: 'test' }] })],
    ['任意请求动作', () => ({ ...button(), actions: [{ event: 'click', actionKey: 'request', message: 'test' }] })],
    ['多条动作', () => ({ ...button(), actions: [button().actions![0], button().actions![0]] })],
    ['动作隐藏源码', () => ({ ...button(), actions: [{ event: 'click', actionKey: 'show-message', message: 'test', code: 'alert(1)' }] })],
    ['未知子节点', () => ({ ...input(), children: [input()] })],
    ['保留字段名', () => ({ ...input(), field: 'constructor' })],
    ['字段路径', () => ({ ...input(), field: 'user.password' })],
    ['长度校验矛盾', () => ({ ...input(), validation: { minLength: 65, maxLength: 64 } })],
    ['超过输入能力的校验', () => ({ ...input(), validation: { maxLength: 255 } })],
    ['自定义正则源码', () => ({ ...input(), validation: { pattern: '(a+)+$' } })],
    ['非布尔状态', () => ({ ...input(), props: { disabled: 'false' } })],
    ['小数行数', () => ({ ...input(), componentKey: 'textarea', props: { rows: 2.5 } })],
    ['按钮挂表单字段', () => ({ ...button(), field: 'password' })],
  ])('拒绝 %s，而不是把数据交给动态执行入口', (_name, value) => {
    expect(getComponentSchemaError(value())).toBeTypeOf('string')
    expect(isComponentSchema(value())).toBe(false)
  })

  it('控制名称、字段、占位符、消息和输入长度边界', () => {
    expect(isComponentSchema({ ...input(), name: 'n'.repeat(64), field: 'f'.repeat(32), props: { placeholder: 'p'.repeat(120), maxlength: 255 }, validation: { minLength: 0, maxLength: 255 } })).toBe(true)
    for (const value of [
      { ...input(), name: 'n'.repeat(65) }, { ...input(), name: ' ' },
      { ...input(), field: 'f'.repeat(33) }, { ...input(), props: { placeholder: 'p'.repeat(121) } },
      { ...input(), props: { maxlength: 0 } }, { ...input(), props: { maxlength: 256 } },
      { ...button(), actions: [{ event: 'click', actionKey: 'show-message', message: 'm'.repeat(201) }] },
    ]) expect(isComponentSchema(value)).toBe(false)
    expect(isComponentSchema({ ...button(), actions: [{ event: 'click', actionKey: 'show-message', message: 'm'.repeat(200) }] })).toBe(true)
  })

  it('请求不接收用户归属、可执行额外字段或预览值', () => {
    for (const value of [null, [], {}, { schema: input(), createdBy: 'forged' }, { schema: input(), value: '私密预览内容' }, { schema: input(), code: 'alert(1)' }]) {
      expect(getSaveComponentConfigError(value)).toBeTypeOf('string')
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('响应区分定义和实例；数据库元数据不能注册新能力', () => {
    expect(COMPONENT_DEFINITIONS.every(isComponentDefinition)).toBe(true)
    expect(isComponentDefinition({ ...COMPONENT_DEFINITIONS[0], componentKey: 'dynamic-script' })).toBe(false)
    expect(isComponentDefinition({ ...COMPONENT_DEFINITIONS[0], configurableProps: ['onClick'] })).toBe(false)
    const result = { configId: 'dd6e6e84-7656-45d6-a0b4-53412dc48a32', schema: input(), createdTime: '2026-10-13T00:00:00Z', updatedTime: '2026-10-13T00:00:00Z' }
    expect(isComponentConfig(result)).toBe(true)
    expect(isComponentConfig({ ...result, updatedTime: 'invalid' })).toBe(false)
    expect(isComponentConfig({ ...result, schema: { ...input(), schemaVersion: 99 } })).toBe(false)
    expect(isComponentConfig({ ...result, configId: "1' OR 1=1" })).toBe(false)
  })
})

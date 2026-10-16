import { afterEach, describe, expect, it } from 'vitest'
import assert from 'node:assert/strict'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref, shallowRef, type Ref } from 'vue'
import ElementPlus from 'element-plus'
import {
  createDefaultSchemaV2,
  getSchemaV2Error,
  type ApiNode,
  type SchemaV2,
  type TypedValue,
} from '../../shared/contracts/workbench.ts'
import { findElementPlusApi } from '../../shared/catalog/element-plus.ts'
import TypedValueEditor from '../components/workbench/TypedValueEditor.vue'
import ApiPropertyEditor from '../components/workbench/ApiPropertyEditor.vue'
import NodeListEditor from '../components/workbench/NodeListEditor.vue'
import NodeEditor from '../components/workbench/NodeEditor.vue'
import { makeApiNode } from '../components/workbench/editor-model'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
async function click(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  assert.ok(button, `找不到按钮：${text}`)
  await button.trigger('click')
  await flushPromises()
}
function editTyped(initial: TypedValue) {
  const value = shallowRef<TypedValue>(initial)
  const schema = createDefaultSchemaV2()
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(TypedValueEditor, {
          modelValue: value.value,
          schema,
          'onUpdate:modelValue': (next) => {
            value.value = next
          },
        }),
    }),
    { global: { plugins: [ElementPlus] } },
  )
  wrappers.push(wrapper)
  return { value, wrapper }
}

describe('工作台编辑器的真实编辑边界', () => {
  it('重复添加对象字段会保留原值，并指出如何恢复操作', async () => {
    const { value, wrapper } = editTyped({
      kind: 'object',
      entries: { name: { kind: 'literal', value: '不能丢失的已有内容' } },
    })
    await wrapper.get('input[aria-label="对象字段"]').setValue('name')
    await click(wrapper, '添加字段')
    expect(value.value).toEqual({
      kind: 'object',
      entries: { name: { kind: 'literal', value: '不能丢失的已有内容' } },
    })
    expect(wrapper.get('[role="alert"]').text()).toContain('字段已存在，原值已保留')
    await wrapper.get('input[aria-label="对象字段"]').setValue('other')
    await click(wrapper, '添加字段')
    expect(value.value.kind === 'object' && value.value.entries.other).toEqual({
      kind: 'literal',
      value: '',
    })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('16001 字符输入不截断，转为可完整编辑的多行并立即报错，缩短后恢复', async () => {
    const { value, wrapper } = editTyped({ kind: 'literal', value: '' })
    const long = '超'.repeat(16001)
    await wrapper.get('input[aria-label="参数值 属性值"]').setValue(long)
    await flushPromises()
    expect(wrapper.get('input[aria-label="参数值 属性值"]').element).toHaveProperty('value', long)
    await wrapper.get('input[aria-label="参数值 属性值"]').trigger('blur')
    const editor = wrapper.get('textarea[aria-label="参数值 属性值"]')
    expect(editor.attributes('maxlength')).toBeUndefined()
    expect(editor.element).toHaveProperty('value', long)
    expect(value.value).toEqual({ kind: 'literal', value: long })
    expect(wrapper.get('[role="alert"]').text()).toContain('最多 16000')
    await editor.setValue(long.slice(0, 16000))
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('URL 按实际合同 2048 字符校验，完整保留长 URL 以供纠正', async () => {
    const metadata = findElementPlusApi('link')!.props.find((prop) => prop.runtimeName === 'href')!
    const url = `https://example.com/${'a'.repeat(2048)}`
    const wrapper = mount(ApiPropertyEditor, {
      props: { metadata, modelValue: url, valueKind: 'string' },
      global: { plugins: [ElementPlus] },
    })
    wrappers.push(wrapper)
    expect(wrapper.get('textarea').element).toHaveProperty('value', url)
    expect(wrapper.get('[role="alert"]').text()).toContain('最多 2048')
  })

  it('长 JSON 字段名保留完整 title 与全部值，不错误套用状态字段的 64 字符上限', async () => {
    const key = 'long-field-'.repeat(120)
    const { value, wrapper } = editTyped({
      kind: 'object',
      entries: { [key]: { kind: 'literal', value: '保留' } },
    })
    expect(wrapper.findAll('[title]').some((item) => item.attributes('title') === key)).toBe(true)
    expect(value.value.kind === 'object' && value.value.entries[key]).toEqual({
      kind: 'literal',
      value: '保留',
    })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('绑定路径可逐字输入点号，空路径段会报错而不会吞字符', async () => {
    const { value, wrapper } = editTyped({ kind: 'binding', source: 'scope', path: ['row'] })
    const input = wrapper.get('input[aria-label="绑定字段路径"]')
    await input.setValue('row.')
    await flushPromises()
    expect(input.element).toHaveProperty('value', 'row.')
    expect(wrapper.get('[role="alert"]').text()).toContain('每层字段最多 64')
    await input.setValue('row.label')
    expect(value.value).toEqual({ kind: 'binding', source: 'scope', path: ['row', 'label'] })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('节点列表一次只展开一个，添加后直接进入新组件常用属性并保留旧节点内容', async () => {
    const schema = ref() as Ref<SchemaV2>
    schema.value = createDefaultSchemaV2('选择组件')
    schema.value.root = [makeApiNode('input'), makeApiNode('button')]
    const original = JSON.stringify(schema.value.root)
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(NodeListEditor, {
            modelValue: schema.value.root,
            schema: schema.value,
            'onUpdate:modelValue': (next) => {
              schema.value.root = next
            },
          }),
      }),
      { global: { plugins: [ElementPlus] } },
    )
    wrappers.push(wrapper)
    expect(wrapper.findAllComponents(NodeEditor)).toHaveLength(1)
    expect(wrapper.text()).toContain('占位文字')
    await click(wrapper, '添加节点')
    expect(schema.value.root).toHaveLength(3)
    expect(JSON.stringify(schema.value.root.slice(0, 2))).toBe(original)
    expect(wrapper.findAllComponents(NodeEditor)).toHaveLength(1)
    await wrapper.get('input[aria-label="占位文字 属性值"]').setValue('无需搜索 API 即可修改')
    const node = schema.value.root[2] as ApiNode
    expect(node.props.placeholder).toEqual({ kind: 'literal', value: '无需搜索 API 即可修改' })
    expect(getSchemaV2Error(schema.value)).toBeUndefined()
    await click(wrapper, `完整属性与数据绑定（${findElementPlusApi('input')!.props.length}）`)
    expect(wrapper.find('input[aria-label="搜索公开属性"]').exists()).toBe(true)
  })

  it('常用组件默认配置均通过真实 Schema 校验，自动模型状态不会覆盖已有数据', () => {
    for (const apiKey of ['input', 'button', 'form', 'form-item', 'select']) {
      const schema = createDefaultSchemaV2(apiKey)
      schema.root = [
        makeApiNode(apiKey, (key, value) => {
          schema.state[key] = value
        }),
      ]
      expect({ apiKey, error: getSchemaV2Error(schema) }).toEqual({ apiKey, error: undefined })
    }
  })

  it('未配置尺寸使用组件原生默认，不把枚举第一项误显示为已配置值', () => {
    const schema = createDefaultSchemaV2('默认尺寸')
    const node = makeApiNode('input')
    schema.root = [node]
    const wrapper = mount(NodeEditor, {
      props: { modelValue: node, schema },
      global: { plugins: [ElementPlus] },
    })
    wrappers.push(wrapper)
    const sizeEditor = wrapper
      .findAllComponents(ApiPropertyEditor)
      .find((editor) => editor.props('metadata').runtimeName === 'size')
    assert.ok(sizeEditor, '常用设置必须展示尺寸选择')
    expect(sizeEditor.props('modelValue')).toBeNull()
    expect(sizeEditor.get('.el-select__placeholder').text()).toBe('使用组件默认值')
    expect(Object.hasOwn(node.props, 'size')).toBe(false)
    const typeEditor = wrapper
      .findAllComponents(ApiPropertyEditor)
      .find((editor) => editor.props('metadata').runtimeName === 'type')
    assert.ok(typeEditor, '常用设置必须展示输入类型')
    expect(typeEditor.props('modelValue')).toBe('text')
  })
})

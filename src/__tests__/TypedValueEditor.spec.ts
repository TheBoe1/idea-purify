import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref, shallowRef, type Ref } from 'vue'
import ElementPlus from 'element-plus'
import { findElementPlusApi } from '../../shared/catalog/element-plus.ts'
import {
  createDefaultSchemaV2,
  getSchemaV2Error,
  type SchemaV2,
  type TypedValue,
} from '../../shared/contracts/workbench.ts'
import TypedValueEditor from '../components/workbench/TypedValueEditor.vue'
import WorkbenchRenderer from '../components/workbench/WorkbenchRenderer.vue'
import { defaultTypedValue } from '../components/workbench/editor-model'
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})
async function click(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((button) => button.text() === text)
  expect(button).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
async function choose(wrapper: ReturnType<typeof mount>, label: string, value: string) {
  const input = wrapper.get(`input[aria-label="${label}"]`)
  await input.trigger('click')
  await flushPromises()
  const popup = document.getElementById(input.attributes('aria-controls') ?? '')
  expect(popup, `下拉框${label}`).toBeDefined()
  const option = [...(popup ?? document).querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) =>
      option.textContent?.trim() === value || option.textContent?.trim().startsWith(`${value} ·`),
  )
  expect(option, `选项${value}`).toBeDefined()
  option!.click()
  await flushPromises()
}
describe('类型化复合属性编辑', () => {
  it('Table.data 默认是数组，可通过真实树编辑添加对象记录并在真实Table预览中展示', async () => {
    const dataProp = findElementPlusApi('table')!.props.find((prop) => prop.name === 'data')!
    const document = ref() as Ref<SchemaV2>
    document.value = createDefaultSchemaV2('表格数据')
    document.value.root = [
      {
        nodeId: 'table',
        kind: 'component',
        apiKey: 'table',
        props: { data: defaultTypedValue(dataProp) },
        slots: {
          default: [
            {
              nodeId: 'name-column',
              kind: 'component',
              apiKey: 'table-column',
              props: {
                prop: { kind: 'literal', value: 'name' },
                label: { kind: 'literal', value: '姓名' },
              },
            },
          ],
        },
      },
    ]
    const table = document.value.root[0]!
    if (!('props' in table)) throw Error('fixture')
    expect(table.props.data).toEqual({ kind: 'array', items: [] })
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h('div', [
            h(TypedValueEditor, {
              modelValue: table.props.data!,
              schema: document.value,
              metadata: dataProp,
              label: 'data',
              'onUpdate:modelValue': (value) => {
                table.props.data = value
              },
            }),
            h(WorkbenchRenderer, { schema: document.value }),
          ]),
      }),
      { attachTo: globalThis.document.body, global: { plugins: [ElementPlus] } },
    )
    wrappers.push(wrapper)
    await flushPromises()
    await click(wrapper, '添加数组项')
    await choose(wrapper, '第 1 项 值来源', '对象')
    await wrapper.get('input[aria-label="对象字段"]').setValue('name')
    await click(wrapper, '添加字段')
    await wrapper.get('input[aria-label="name 属性值"]').setValue('Alice')
    await flushPromises()
    expect(table.props.data).toEqual({
      kind: 'array',
      items: [{ kind: 'object', entries: { name: { kind: 'literal', value: 'Alice' } } }],
    })
    expect(getSchemaV2Error(document.value)).toBeUndefined()
    expect(wrapper.findComponent(WorkbenchRenderer).text()).toContain('Alice')
  })
  it('已有literal复合值自动保持内容并转为可编辑结构，不降成空字符串', async () => {
    const value = shallowRef<TypedValue>({
      kind: 'literal',
      value: [{ name: '保留记录', enabled: true }],
    })
    const schema = createDefaultSchemaV2()
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(TypedValueEditor, {
            modelValue: value.value,
            schema,
            label: '旧数组',
            'onUpdate:modelValue': (next) => {
              value.value = next
            },
          }),
      }),
      { global: { plugins: [ElementPlus] } },
    )
    wrappers.push(wrapper)
    await flushPromises()
    expect(value.value).toEqual({
      kind: 'array',
      items: [
        {
          kind: 'object',
          entries: {
            name: { kind: 'literal', value: '保留记录' },
            enabled: { kind: 'literal', value: true },
          },
        },
      ],
    })
    expect(wrapper.get('input[aria-label="name 属性值"]').element).toHaveProperty(
      'value',
      '保留记录',
    )
  })
  it('TableV2列对象可选全部公开字段并保留cellRenderer函数策略，而不是插入重复父组件', async () => {
    const value = shallowRef<TypedValue>({
      kind: 'array',
      items: [
        {
          kind: 'object',
          apiKey: 'table-v2-column',
          entries: {
            key: { kind: 'literal', value: 'name' },
            dataKey: { kind: 'literal', value: 'name' },
            width: { kind: 'literal', value: 180 },
          },
        },
      ],
    })
    const schema = createDefaultSchemaV2('虚拟列')
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(TypedValueEditor, {
            modelValue: value.value,
            schema,
            objectApiKey: 'table-v2-column',
            label: 'columns',
            'onUpdate:modelValue': (next) => {
              value.value = next
            },
          }),
      }),
      { attachTo: document.body, global: { plugins: [ElementPlus] } },
    )
    wrappers.push(wrapper)
    await flushPromises()
    await choose(wrapper, '对象字段', 'cellRenderer')
    await click(wrapper, '添加字段')
    await choose(wrapper, 'cellRenderer 值来源', '函数策略')
    expect(value.value.kind).toBe('array')
    if (value.value.kind !== 'array' || value.value.items[0]?.kind !== 'object')
      throw Error('fixture')
    expect(value.value.items[0].apiKey).toBe('table-v2-column')
    expect(value.value.items[0].entries.cellRenderer?.kind).toBe('callback')
    expect(wrapper.text()).toContain('回调')
  })
})

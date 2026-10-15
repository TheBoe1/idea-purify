import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElForm, ElFormItem, ElInput, ElMessageBox } from 'element-plus'
import {
  createDefaultSchemaV2,
  getSchemaV2Error,
  type DataBinding,
  type JsonValue,
  type SchemaV2,
  type TypedValue,
  type WorkbenchNode,
} from '../../shared/contracts/workbench.ts'
import { createWorkbenchRuntime } from '../components/workbench/runtime'
import { acceptSession, authState } from '../stores/auth'
const wrappers: VueWrapper[] = [],
  engines: ReturnType<typeof createWorkbenchRuntime>[] = []
const literal = (value: JsonValue): TypedValue => ({ kind: 'literal', value })
const state = (...path: (string | number)[]): DataBinding => ({
  kind: 'binding',
  source: 'state',
  path,
})
function render(root: WorkbenchNode[], values: Record<string, TypedValue> = {}) {
  const document: SchemaV2 = { ...createDefaultSchemaV2('回调语义'), root, state: values }
  expect(getSchemaV2Error(document)).toBeUndefined()
  const engine = createWorkbenchRuntime(document, 'preview')
  engines.push(engine)
  const wrapper = mount(
    defineComponent({ setup: () => () => h('div', engine.renderNodes(document.root)) }),
    { attachTo: globalThis.document.body, global: { plugins: [ElementPlus] } },
  )
  wrappers.push(wrapper)
  return { engine, wrapper }
}
beforeEach(() => {
  authState.user = null
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  engines.splice(0).forEach((engine) => engine.dispose())
  ElMessageBox.close()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})
function confirm() {
  const button = document.querySelector<HTMLButtonElement>('.el-message-box .el-button--primary')
  expect(button).toBeDefined()
  button!.click()
}
describe('公开函数 API 的真实语义', () => {
  it('原生Element Form通过同一ESM校验器拒绝非法输入，合法后成功', async () => {
    const model = reactive({ title: '' })
    const rules = {
      title: [
        {
          validator: (_rule: unknown, value: unknown, done: (error?: Error) => void) =>
            done(value ? undefined : new Error('原生必填规则')),
        },
      ],
    }
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            ElForm,
            { model, rules },
            {
              default: () =>
                h(ElFormItem, { prop: 'title' }, () =>
                  h(ElInput, {
                    modelValue: model.title,
                    'onUpdate:modelValue': (value: string) => {
                      model.title = value
                    },
                  }),
                ),
            },
          ),
      }),
      { global: { plugins: [ElementPlus] } },
    )
    wrappers.push(wrapper)
    await flushPromises()
    await expect(wrapper.findComponent(ElForm).vm.validate()).rejects.toHaveProperty('title')
    await wrapper.get('input').setValue('合法')
    await expect(wrapper.findComponent(ElForm).vm.validate()).resolves.toBe(true)
  })

  it('MessageBox.inputValidator 显示错误并阻止确认，合法值才完成', async () => {
    const { wrapper } = render([
      {
        kind: 'service',
        apiKey: 'message-box',
        nodeId: 'prompt',
        props: {
          showInput: literal(true),
          'box-type': literal('prompt'),
          title: literal('验证输入'),
        },
        callbacks: {
          inputValidator: { callbackKey: 'validate', params: { required: literal(true) } },
        },
      },
    ])
    await wrapper.get('button').trigger('click')
    await flushPromises()
    confirm()
    await flushPromises()
    expect(document.querySelector('.el-message-box__errormsg')?.textContent).toContain('必填')
    const input = document.querySelector<HTMLInputElement>('.el-message-box input')!
    input.value = '有效内容'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    confirm()
    await vi.waitFor(() =>
      expect(document.querySelector('.el-overlay')?.getAttribute('style') ?? '').toContain(
        'display: none',
      ),
    )
  })
  it('Form 规则的 resolve(错误)使用公开第三参数，合法输入可再次验证成功', async () => {
    const { engine, wrapper } = render(
      [
        {
          kind: 'component',
          apiKey: 'form',
          nodeId: 'form',
          props: {
            model: state('form'),
            rules: {
              kind: 'object',
              entries: {
                title: {
                  kind: 'array',
                  items: [
                    {
                      kind: 'object',
                      entries: {
                        validator: {
                          kind: 'callback',
                          reference: {
                            callbackKey: 'validate',
                            params: { required: literal(true) },
                            mode: 'resolve',
                            resolveIndex: 2,
                          },
                        },
                        trigger: literal('change'),
                      },
                    },
                  ],
                },
              },
            },
          },
          slots: {
            default: [
              {
                kind: 'component',
                apiKey: 'form-item',
                nodeId: 'item',
                props: { prop: literal('title'), label: literal('标题') },
                slots: {
                  default: [
                    {
                      kind: 'component',
                      apiKey: 'input',
                      nodeId: 'input',
                      props: {},
                      models: { modelValue: state('form', 'title') },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      { form: literal({ title: '' }) },
    )
    await flushPromises()
    const validate = engine.resolve({
      kind: 'ref',
      nodeId: 'form',
      expose: 'validate',
    }) as () => Promise<boolean>
    await expect(validate()).rejects.toBeTruthy()
    await vi.waitFor(() => expect(wrapper.text()).toContain('必填'))
    await wrapper.get('input').setValue('正确标题')
    await expect(validate()).resolves.toBe(true)
  })
  it('Transfer 筛选策略返回匹配布尔值，实际列表仅保留匹配行', async () => {
    const { wrapper } = render([
      {
        kind: 'component',
        apiKey: 'transfer',
        nodeId: 'transfer',
        props: {
          data: literal([
            { key: 1, label: 'Alpha' },
            { key: 2, label: 'Beta' },
          ]),
          filterable: literal(true),
        },
        callbacks: { 'filter-method': { callbackKey: 'filter', params: {} } },
      },
    ])
    await wrapper
      .findAll('input')
      .find((input) => (input.element as HTMLInputElement).type !== 'checkbox')!
      .setValue('Alpha')
    await flushPromises()
    const left = wrapper.get('.el-transfer-panel')
    expect(left.text()).toContain('Alpha')
    expect(left.findAll('.el-transfer-panel__item').map((item) => item.text())).not.toContain(
      'Beta',
    )
  })
  it('Dialog.beforeClose 遇到非法结果不调用done，输入合法后才关闭', async () => {
    const { engine } = render(
      [
        {
          kind: 'component',
          apiKey: 'dialog',
          nodeId: 'dialog',
          props: { title: literal('关闭验证') },
          models: { modelValue: state('visible') },
          callbacks: {
            'before-close': {
              callbackKey: 'validate',
              params: { value: state('title'), required: literal(true) },
              mode: 'resolve',
              resolveIndex: 0,
            },
          },
        },
      ],
      { visible: literal(true), title: literal('') },
    )
    await flushPromises()
    document.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
    await flushPromises()
    expect(engine.state.visible).toBe(true)
    engine.state.title = '允许关闭'
    document.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
    await flushPromises()
    expect(document.querySelector('.el-overlay')?.getAttribute('style') ?? '').toContain(
      'display: none',
    )
  })
  it('lazy-load明确使用resolve索引，后置reject函数不会被误当成resolve；false gate不执行', async () => {
    const { engine } = render([])
    const resolve = vi.fn<(value?: unknown) => void>(),
      reject = vi.fn<(reason?: unknown) => void>()
    const callback = engine.callable(
      {
        callbackKey: 'lazy-load',
        params: { data: literal([{ label: '子节点' }]) },
        mode: 'resolve',
        resolveIndex: 1,
        rejectIndex: 2,
      },
      { scope: {}, event: [], instancePath: 'root' },
    )
    callback({}, resolve, reject)
    expect(resolve).toHaveBeenCalledWith([{ label: '子节点' }])
    expect(reject).not.toHaveBeenCalled()
    engine.callable(
      {
        callbackKey: 'return-binding',
        params: { value: literal('禁止') },
        gate: literal(false),
        mode: 'resolve',
        resolveIndex: 0,
      },
      { scope: {}, event: [], instancePath: 'root' },
    )(resolve)
    expect(resolve).toHaveBeenCalledTimes(1)
  })
  it('旧会话的异步callback结果不会写入新身份的实例状态', async () => {
    const { engine } = render([], { result: literal('原值') })
    const callback = engine.callable(
      {
        callbackKey: 'preview-upload',
        params: { data: literal('旧响应'), delay: literal(10) },
        mode: 'promise',
        result: state('result'),
      },
      { scope: {}, event: [], instancePath: 'root' },
    )
    const pending = callback({ file: { name: 'file' } })
    acceptSession({
      userId: 'new-user',
      username: 'newuser',
      role: 'user',
      email: null,
      emailVerified: false,
      disabled: false,
      createdTime: '',
    })
    await pending
    expect(engine.state.result).toBe('原值')
  })
  it('TableV2列的cellRenderer收到真实单元格参数并执行已登记格式策略', async () => {
    const { wrapper } = render([
      {
        kind: 'component',
        apiKey: 'table-v2',
        nodeId: 'table',
        props: {
          width: literal(500),
          height: literal(300),
          columns: {
            kind: 'array',
            items: [
              {
                kind: 'object',
                apiKey: 'table-v2-column',
                entries: {
                  key: literal('name'),
                  dataKey: literal('name'),
                  title: literal('姓名'),
                  width: literal(180),
                  cellRenderer: {
                    kind: 'callback',
                    reference: {
                      callbackKey: 'format',
                      params: {
                        value: { kind: 'binding', source: 'event', path: [0, 'cellData'] },
                        template: literal('{{value}}!'),
                      },
                    },
                  },
                },
              },
            ],
          },
          data: literal([{ id: 'row1', name: '虚拟表格' }]),
        },
      },
    ])
    await flushPromises()
    expect(wrapper.text()).toContain('虚拟表格!')
  })
})

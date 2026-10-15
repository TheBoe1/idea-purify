import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
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

const { readIdeas } = vi.hoisted(() => ({
  readIdeas: vi.fn<typeof import('../api/ideas').loadIdeas>(),
}))
vi.mock('@/api/ideas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/ideas')>()),
  loadIdeas: readIdeas,
}))

const wrappers: VueWrapper[] = []
const engines: ReturnType<typeof createWorkbenchRuntime>[] = []
const literal = (value: JsonValue): TypedValue => ({ kind: 'literal', value })
const state = (...path: (string | number)[]): DataBinding => ({
  kind: 'binding',
  source: 'state',
  path,
})
const scope = (...path: (string | number)[]): DataBinding => ({
  kind: 'binding',
  source: 'scope',
  path,
})
const text = (nodeId: string, value: TypedValue): WorkbenchNode => ({ kind: 'text', nodeId, value })
function schema(root: WorkbenchNode[], values: Record<string, TypedValue> = {}): SchemaV2 {
  return { ...createDefaultSchemaV2('运行时验收'), state: values, root }
}
function render(document: SchemaV2, valid = true, mode: 'preview' | 'published' = 'preview') {
  if (valid) assert.equal(getSchemaV2Error(document), undefined)
  const engine = createWorkbenchRuntime(document, mode)
  engines.push(engine)
  const wrapper = mount(
    defineComponent({ setup: () => () => h('section', engine.renderNodes(document.root)) }),
    { attachTo: globalThis.document.body, global: { plugins: [ElementPlus] } },
  )
  wrappers.push(wrapper)
  return { engine, wrapper }
}
beforeEach(() => {
  readIdeas.mockReset()
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
  ElMessage.closeAll()
  ElNotification.closeAll()
  ElMessageBox.close()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('真实 Element Plus V2 runtime behavior', () => {
  it('updates a real Input with model aliases and keeps two mounted instances and persisted schema isolated', async () => {
    const document = schema(
      [
        {
          kind: 'component',
          apiKey: 'input',
          nodeId: 'entry',
          props: { placeholder: literal('输入想法') },
          models: { 'model-value': state('title') },
        },
      ],
      { title: literal('初稿') },
    )
    const persisted = JSON.stringify(document)
    const first = render(document)
    const second = render(document)
    expect((first.wrapper.get('input').element as HTMLInputElement).value).toBe('初稿')
    await first.wrapper.get('input').setValue('第一份修改')
    expect(first.engine.state.title).toBe('第一份修改')
    expect((second.wrapper.get('input').element as HTMLInputElement).value).toBe('初稿')
    expect(JSON.stringify(document)).toBe(persisted)
  })

  it('renders nested Select options and applies the user selection to instance state', async () => {
    const document = schema(
      [
        {
          kind: 'component',
          apiKey: 'select',
          nodeId: 'choice',
          props: {},
          models: { modelValue: state('choice') },
          slots: {
            default: [
              {
                kind: 'component',
                apiKey: 'option-group',
                nodeId: 'group',
                props: { label: literal('分类') },
                slots: {
                  default: [
                    {
                      kind: 'component',
                      apiKey: 'option',
                      nodeId: 'one',
                      props: { label: literal('选项一'), value: literal('one') },
                    },
                    {
                      kind: 'component',
                      apiKey: 'option',
                      nodeId: 'two',
                      props: { label: literal('选项二'), value: literal('two') },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      { choice: literal('one') },
    )
    const { wrapper, engine } = render(document)
    await wrapper.get('.el-select__wrapper').trigger('click')
    await flushPromises()
    const item = [
      ...documentBody().querySelectorAll<HTMLElement>('.el-select-dropdown__item'),
    ].find((item) => item.textContent?.includes('选项二'))
    expect(item).toBeDefined()
    item!.click()
    await flushPromises()
    expect(engine.state.choice).toBe('two')
    expect(wrapper.text()).toContain('选项二')
  })

  it('keeps per-row scope writable and resettable without overwriting another repeated row', async () => {
    const document = schema(
      [
        {
          kind: 'for',
          nodeId: 'rows',
          itemName: 'row',
          indexName: 'index',
          items: state('rows'),
          children: [
            {
              kind: 'component',
              apiKey: 'input',
              nodeId: 'row-input',
              props: {},
              models: { modelValue: scope('row', 'title') },
            },
            {
              kind: 'component',
              apiKey: 'button',
              nodeId: 'reset',
              props: {},
              events: {
                click: [{ actionKey: 'reset-state', params: { target: scope('row', 'title') } }],
              },
              slots: { default: [text('reset-label', literal('还原'))] },
            },
          ],
        },
      ],
      {
        rows: literal([
          { id: 'first', title: '第一行' },
          { id: 'second', title: '第二行' },
        ]),
      },
    )
    const { wrapper, engine } = render(document)
    await wrapper.findAll('input')[0]!.setValue('仅修改第一行')
    expect(engine.state.rows).toEqual([
      { id: 'first', title: '仅修改第一行' },
      { id: 'second', title: '第二行' },
    ])
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(
      wrapper.findAll('input').map((input) => (input.element as HTMLInputElement).value),
    ).toEqual(['第一行', '第二行'])
  })

  it('passes the actual Table column scoped slot through to child bindings', async () => {
    const document = schema(
      [
        {
          kind: 'component',
          apiKey: 'table',
          nodeId: 'table',
          props: { data: state('rows') },
          slots: {
            default: [
              {
                kind: 'component',
                apiKey: 'table-column',
                nodeId: 'title-column',
                props: { label: literal('想法') },
                slots: { default: [text('row-title', scope('row', 'title'))] },
              },
            ],
          },
        },
      ],
      { rows: literal([{ id: 'first', title: '通过真实作用域显示' }]) },
    )
    const { wrapper } = render(document)
    await flushPromises()
    expect(wrapper.get('.el-table__body').text()).toContain('通过真实作用域显示')
  })

  it('calls an actual mounted Input public focus method through a registered ref action', async () => {
    const document = schema([
      { kind: 'component', apiKey: 'input', nodeId: 'focus-target', props: {} },
      {
        kind: 'component',
        apiKey: 'button',
        nodeId: 'focus-button',
        props: {},
        slots: { default: [text('focus-label', literal('聚焦'))] },
        events: {
          click: [
            {
              actionKey: 'method',
              params: { target: { kind: 'ref', nodeId: 'focus-target', expose: 'focus' } },
            },
          ],
        },
      },
    ])
    const { wrapper, engine } = render(document)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(engine.errors).toEqual({})
    expect(documentBody().ownerDocument.activeElement).toBe(wrapper.get('input').element)
  })

  it('preserves Date/RegExp/icon/VNode values as typed runtime values without executing HTML', () => {
    const { engine } = render(schema([]))
    expect(engine.resolve({ kind: 'date', value: '2026-10-15T00:00:00.000Z' })).toBeInstanceOf(Date)
    const pattern = engine.resolve({ kind: 'regexp', source: '^idea[0-9]+$', flags: 'i' }) as RegExp
    expect(pattern.test('IDEA12')).toBe(true)
    expect(engine.resolve({ kind: 'icon', name: 'ArrowDown' })).toBeTruthy()
    expect(engine.resolve({ kind: 'component', apiKey: 'input' })).toBeTruthy()
    const html = engine.resolve({
      kind: 'html',
      value: '<p>允许排版</p><img src=x onerror="alert(1)"><script>alert(1)</script>',
    }) as string
    expect(html).toContain('<p>允许排版</p>')
    expect(html).not.toMatch(/onerror|<script/)
  })

  it('shows local malformed-node feedback while a neighboring input remains usable', async () => {
    const { wrapper } = render(
      schema(
        [
          { kind: 'component', apiKey: 'unregistered', nodeId: 'bad', props: {} },
          {
            kind: 'component',
            apiKey: 'input',
            nodeId: 'good',
            props: {},
            models: { modelValue: state('good') },
          },
          text('literal-html', literal('<script>字面文本</script>')),
        ],
        { good: literal('') },
      ),
      false,
    )
    expect(wrapper.text()).toContain('组件 API 未注册')
    expect(wrapper.text()).toContain('<script>字面文本</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    await wrapper.get('input').setValue('仍可输入')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('仍可输入')
  })

  it('applies design tokens locally and leaves the document root untouched', () => {
    const key = '--el-color-primary'
    const original = document.documentElement.style.getPropertyValue(key)
    const { wrapper } = render(
      schema([
        { kind: 'design', apiKey: 'color', nodeId: 'colors', props: { [key]: literal('#123456') } },
      ]),
    )
    expect(wrapper.get('.design-preview').attributes('style')).toContain(`${key}: #123456`)
    expect(document.documentElement.style.getPropertyValue(key)).toBe(original)
    expect(wrapper.text()).toContain('primary')
  })

  it('uses registered autocomplete callback values and the explicit resolve parameter', async () => {
    const document = schema([
      {
        kind: 'component',
        apiKey: 'autocomplete',
        nodeId: 'search',
        props: { 'trigger-on-focus': literal(false), debounce: literal(0) },
        callbacks: {
          'fetch-suggestions': {
            callbackKey: 'return-binding',
            params: { value: literal([{ value: '安全建议' }]) },
            mode: 'resolve',
            resolveIndex: 1,
          },
        },
      },
    ])
    const { wrapper } = render(document)
    await wrapper.get('input').setValue('安全')
    await vi.waitFor(() => expect(documentBody().textContent).toContain('安全建议'))
  })

  it('keeps current-user resources in preview simulated and blocks late published data after a session change', async () => {
    const document = {
      ...schema([]),
      resources: [{ resourceId: 'ideas', sourceKey: 'current-user-ideas' as const }],
    }
    const preview = render(document)
    await preview.engine.initialize()
    expect(readIdeas).not.toHaveBeenCalled()
    expect(preview.engine.data.ideas).toEqual(
      expect.arrayContaining([expect.objectContaining({ ideaId: 'preview-idea' })]),
    )
    let complete!: (value: Awaited<ReturnType<typeof readIdeas>>) => void
    readIdeas.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    const published = render(document, true, 'published')
    const loading = published.engine.initialize()
    acceptSession({
      userId: 'changed-user',
      username: 'new-user',
      role: 'user',
      email: null,
      emailVerified: false,
      disabled: false,
      createdTime: '',
    })
    complete([{ ideaId: 'old-user-idea', ideaContent: '旧账号结果', createdTime: '' }])
    await loading
    expect(published.engine.data.ideas).toBeUndefined()
  })

  it('invokes a MessageBox public prompt method through its service facade', async () => {
    const document = schema([
      { kind: 'service', apiKey: 'message-box', nodeId: 'prompt-service', props: {} },
    ])
    const { engine } = render(document)
    const execution = engine
      .execute([
        {
          actionKey: 'method',
          params: {
            target: { kind: 'ref', nodeId: 'prompt-service', expose: 'prompt' },
            args: { kind: 'array', items: [literal('输入新的标题'), literal('公开服务方法')] },
          },
        },
      ])
      .then(
        () => undefined,
        (error) => error as Error,
      )
    await flushPromises()
    if (!documentBody().querySelector('.el-message-box')) assert.equal(await execution, undefined)
    expect(documentBody().querySelector('.el-message-box')?.textContent).toContain('公开服务方法')
    const dialogInput = documentBody().querySelector<HTMLInputElement>('.el-message-box input')!
    dialogInput.value = '新的标题'
    dialogInput.dispatchEvent(new Event('input', { bubbles: true }))
    const confirm = [
      ...documentBody().querySelectorAll<HTMLButtonElement>('.el-message-box button'),
    ].find(
      (button) =>
        button.textContent?.includes('OK') || button.classList.contains('el-button--primary'),
    )
    expect(confirm).toBeDefined()
    confirm!.click()
    expect(await execution).toBeUndefined()
  })

  it('attaches Loading to a registered component target and restores target attributes on unmount', async () => {
    const document = schema(
      [
        {
          kind: 'component',
          apiKey: 'card',
          nodeId: 'panel',
          props: {},
          slots: { default: [text('panel-body', literal('加载区域'))] },
        },
        {
          kind: 'directive',
          apiKey: 'loading-directive',
          nodeId: 'loading',
          target: 'panel',
          props: { 'v-loading': state('busy'), 'element-loading-text': literal('正在加载') },
        },
      ],
      { busy: literal(true) },
    )
    const { wrapper, engine } = render(document)
    await flushPromises()
    const target = wrapper.get('.el-card').element
    expect(target.querySelector('.el-loading-mask')?.textContent).toContain('正在加载')
    expect(target.getAttribute('element-loading-text')).toBe('正在加载')
    engine.state.busy = false
    await flushPromises()
    wrapper.unmount()
    expect(target.getAttribute('element-loading-text')).toBeNull()
  })

  it('passes the actual Popover instance to the public popover directive target', async () => {
    const document = schema([
      {
        kind: 'component',
        apiKey: 'button',
        nodeId: 'trigger',
        props: {},
        slots: { default: [text('trigger-text', literal('显示浮层'))] },
      },
      {
        kind: 'component',
        apiKey: 'popover',
        nodeId: 'popup',
        props: { trigger: literal('click'), content: literal('通过公开指令关联') },
      },
      {
        kind: 'directive',
        apiKey: 'popover-directive',
        nodeId: 'attached-popover',
        target: 'trigger',
        props: { value: { kind: 'ref', nodeId: 'popup' } },
      },
    ])
    const { wrapper } = render(document)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() =>
      expect(documentBody().querySelector('.el-popover')?.textContent).toContain(
        '通过公开指令关联',
      ),
    )
  })

  it('disposes messages opened through a public service shortcut without closing unrelated messages', async () => {
    const { engine } = render(
      schema([{ kind: 'service', apiKey: 'message', nodeId: 'message-service', props: {} }]),
    )
    await engine.execute([
      {
        actionKey: 'method',
        params: {
          target: { kind: 'ref', nodeId: 'message-service', expose: 'success' },
          args: { kind: 'array', items: [literal('仅所属实例的消息')] },
        },
      },
    ])
    ElMessage({ message: '另一个实例的消息', duration: 0 })
    await flushPromises()
    expect(documentBody().textContent).toContain('仅所属实例的消息')
    engine.dispose()
    await vi.waitFor(
      () => {
        expect(documentBody().textContent).not.toContain('仅所属实例的消息')
        expect(documentBody().textContent).toContain('另一个实例的消息')
      },
      { timeout: 1500 },
    )
  })

  it('applies the configured feedback severity of a show-message action', async () => {
    const { engine } = render(schema([]))
    await engine.execute([
      {
        actionKey: 'show-message',
        params: { message: literal('请检查内容'), type: literal('warning') },
      },
    ])
    await flushPromises()
    expect(documentBody().querySelector('.el-message--warning')?.textContent).toContain(
      '请检查内容',
    )
  })
})

function documentBody(): HTMLElement {
  return globalThis.document.body
}

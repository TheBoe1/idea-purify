// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createDefaultSchemaV2,
  getSchemaV2Error,
  type ApiNode,
  type DataBinding,
  type JsonValue,
  type SchemaV2,
  type TypedValue,
  type WorkbenchNode,
} from '../shared/contracts/workbench.ts'

const literal = (value: JsonValue): TypedValue => ({ kind: 'literal', value })
const binding = (source: DataBinding['source'], ...path: DataBinding['path']): DataBinding => ({
  kind: 'binding',
  source,
  path,
})
const node = (
  apiKey: string,
  props: ApiNode['props'] = {},
  patch: Partial<ApiNode> = {},
): ApiNode => ({ kind: 'component', apiKey, nodeId: `node-${apiKey}`, props, ...patch })
const schema = (root: WorkbenchNode[], state: SchemaV2['state'] = {}): SchemaV2 => ({
  ...createDefaultSchemaV2('独立语义审计'),
  root,
  state,
})

describe('V2 contract independent cross-field audit', () => {
  it('accepts an open HTML input type while keeping a closed Button enum constrained', () => {
    expect(getSchemaV2Error(schema([node('input', { type: literal('week') })]))).toBeUndefined()
    expect(
      getSchemaV2Error(schema([node('button', { type: literal('unregistered-color') })])),
    ).toBeDefined()
  })

  it('accepts a typed TableV2 column renderer with declared callback input and enforces its required width', () => {
    const column: TypedValue = {
      kind: 'object',
      apiKey: 'table-v2-column',
      entries: {
        key: literal('title'),
        title: literal('标题'),
        width: literal(160),
        cellRenderer: {
          kind: 'callback',
          reference: { callbackKey: 'format', params: { value: binding('event', 0, 'cellData') } },
        },
      },
    }
    const table = node('table-v2', {
      width: literal(400),
      height: literal(200),
      data: literal([]),
      columns: { kind: 'array', items: [column] },
    })
    expect(getSchemaV2Error(schema([table]))).toBeUndefined()
    delete column.entries.width
    expect(getSchemaV2Error(schema([table]))).toBeDefined()
  })

  it.each([{ 'model-value': literal('静态值') }, { modelValue: literal('静态值') }])(
    'rejects duplicate canonical props/model channels instead of silently overwriting a supplied value',
    (props) => {
      expect(
        getSchemaV2Error(
          schema([node('input', props, { models: { modelValue: binding('state', 'title') } })], {
            title: literal('动态值'),
          }),
        ),
      ).toBeDefined()
    },
  )

  it('rejects duplicate prop/callback channels even when one uses a kebab alias', () => {
    const callback: TypedValue = {
      kind: 'callback',
      reference: { callbackKey: 'date-disable', params: {} },
    }
    expect(
      getSchemaV2Error(
        schema([
          node(
            'date-picker',
            { 'disabled-date': callback },
            {
              callbacks: {
                disabledDate: { callbackKey: 'return-binding', params: { value: literal(false) } },
              },
            },
          ),
        ]),
      ),
    ).toBeDefined()
  })

  it('requires a documented update event for model channels instead of silently binding a read-only prop', () => {
    expect(
      getSchemaV2Error(
        schema([node('input', {}, { models: { type: binding('state', 'type') } })], {
          type: literal('text'),
        }),
      ),
    ).toBeDefined()
  })

  it('only accepts internal ref paths actually exposed by the referenced parent', () => {
    const tabs = node('tabs', {}, { nodeId: 'tabs' })
    const target: TypedValue = {
      kind: 'ref',
      nodeId: 'tabs',
      apiKey: 'tab-nav',
      path: ['tabNavRef'],
      expose: 'scrollToActiveTab',
    }
    const valid = schema([tabs], { navigation: target })
    expect(getSchemaV2Error(valid)).toBeUndefined()
    expect(
      getSchemaV2Error(schema([tabs], { navigation: { ...target, path: ['unregisteredRef'] } })),
    ).toBeDefined()
    expect(
      getSchemaV2Error(schema([node('input', {}, { nodeId: 'tabs' })], { navigation: target })),
    ).toBeDefined()
  })

  it('rejects DOM references to text-only nodes that have no registered element target', () => {
    const text: WorkbenchNode = {
      kind: 'text',
      nodeId: 'copy',
      value: literal('没有组件 DOM 引用'),
    }
    const loading = node(
      'loading-service',
      { target: { kind: 'dom', nodeId: 'copy' } },
      { kind: 'service' },
    )
    expect(getSchemaV2Error(schema([text, loading]))).toBeDefined()
  })

  it.each(['url(https://example.com/tracker)', 'red;position:fixed', 'expression(alert(1))'])(
    'rejects unsafe design token content before saving: %s',
    (value) => {
      expect(
        getSchemaV2Error(
          schema([node('color', { '--el-color-primary': literal(value) }, { kind: 'design' })]),
        ),
      ).toBeDefined()
    },
  )

  it('rejects callback parameter shapes that would silently disable promised validation', () => {
    const validation = (value: JsonValue) =>
      schema([
        node(
          'input',
          {},
          {
            callbacks: {
              formatter: { callbackKey: 'validate', params: { minLength: literal(value) } },
            },
          },
        ),
      ])
    expect(getSchemaV2Error(validation(2))).toBeUndefined()
    expect(getSchemaV2Error(validation('two'))).toBeDefined()
    expect(getSchemaV2Error(validation(-2))).toBeDefined()
  })

  it('allows a lexical parent binding but rejects a sibling loop variable', () => {
    const loop: WorkbenchNode = {
      kind: 'for',
      nodeId: 'loop',
      itemName: 'item',
      items: literal(['一个']),
      children: [{ kind: 'text', nodeId: 'child', value: binding('scope', 'item') }],
    }
    expect(getSchemaV2Error(schema([loop]))).toBeUndefined()
    expect(
      getSchemaV2Error(
        schema([loop, { kind: 'text', nodeId: 'sibling', value: binding('scope', 'item') }]),
      ),
    ).toBeDefined()
  })
})

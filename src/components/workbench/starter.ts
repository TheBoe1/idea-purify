import {
  createDefaultSchemaV2,
  type SchemaV2,
  type ApiNode,
} from '../../../shared/contracts/workbench.ts'
import { makeApiNode, typedJson } from './editor-model'

// A useful starting point, represented entirely by the existing public Schema contract.
export function simpleForm(): SchemaV2 {
  const schema = createDefaultSchemaV2('简单表单')
  schema.state.form = typedJson({ title: '' })
  const form = makeApiNode('form')
  const item = makeApiNode('form-item')
  const input = makeApiNode('input')
  const button = makeApiNode('button')
  form.props = {
    model: { kind: 'binding', source: 'state', path: ['form'] },
    'label-position': { kind: 'literal', value: 'top' },
  }
  form.props.rules = typedJson({
    title: [{ required: true, min: 2, max: 80, message: '请输入 2–80 个字符', trigger: 'blur' }],
  })
  item.props = {
    label: { kind: 'literal', value: '标题' },
    prop: { kind: 'literal', value: 'title' },
  }
  input.props = { placeholder: { kind: 'literal', value: '填写标题' } }
  input.models = { 'model-value': { kind: 'binding', source: 'state', path: ['form', 'title'] } }
  item.slots = { default: [input] }
  button.props = { type: { kind: 'literal', value: 'primary' } }
  button.slots = {
    default: [
      {
        kind: 'text',
        nodeId: `${button.nodeId}-label`,
        value: { kind: 'literal', value: '验证表单' },
      },
    ],
  }
  button.events = {
    click: [
      {
        actionKey: 'method',
        params: {
          target: { kind: 'ref', nodeId: form.nodeId, expose: 'validate' },
          args: { kind: 'array', items: [] },
        },
      },
      {
        actionKey: 'show-message',
        params: {
          message: { kind: 'literal', value: '验证成功' },
          type: { kind: 'literal', value: 'success' },
        },
      },
    ],
  }
  form.slots = { default: [item, button] }
  schema.root = [form as ApiNode]
  return schema
}

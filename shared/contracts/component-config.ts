export const COMPONENT_SCHEMA_VERSION = 1
export const COMPONENT_LIBRARY_KEY = 'element-plus'
export const COMPONENT_KEYS = ['input', 'textarea', 'button'] as const
export type ComponentKey = typeof COMPONENT_KEYS[number]
export type ButtonType = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface InputValidation {
  required?: boolean
  minLength?: number
  maxLength?: number
}
export interface InputProps {
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  maxlength?: number
}
export interface TextareaProps {
  placeholder?: string
  disabled?: boolean
  maxlength?: number
  rows?: number
}
export interface ButtonProps {
  text?: string
  type?: ButtonType
  disabled?: boolean
}
export interface ShowMessageAction {
  event: 'click'
  actionKey: 'show-message'
  message: string
}
interface SchemaBase {
  schemaVersion: 1
  libraryKey: 'element-plus'
  name: string
  // Phase A 只支持叶子组件；后续版本才能增加布局和子组件。
  children: []
}
export type ComponentSchema = SchemaBase & (
  | { componentKey: 'input'; props: InputProps; field?: string; validation?: InputValidation; actions?: [] }
  | { componentKey: 'textarea'; props: TextareaProps; field?: string; validation?: InputValidation; actions?: [] }
  | { componentKey: 'button'; props: ButtonProps; actions?: [] | [ShowMessageAction] }
)
export interface ComponentDefinition {
  componentKey: ComponentKey
  libraryKey: 'element-plus'
  schemaVersion: 1
  name: string
  category: 'input' | 'action'
  description: string
  configurableProps: string[]
  supportsField: boolean
  supportsValidation: boolean
  defaultSchema: ComponentSchema
}
export interface ComponentConfig {
  configId: string
  schema: ComponentSchema
  createdTime: string
  updatedTime: string
}
export interface SaveComponentConfigRequest { schema: ComponentSchema }

export function createDefaultComponentSchema(componentKey: ComponentKey): ComponentSchema {
  const base: Pick<SchemaBase, 'schemaVersion' | 'libraryKey' | 'children'> = { schemaVersion: 1, libraryKey: COMPONENT_LIBRARY_KEY, children: [] }
  if (componentKey === 'input') return { ...base, componentKey, name: '输入框',
    props: { placeholder: '请输入内容', clearable: true, disabled: false, maxlength: 255 },
    field: 'value', validation: {}, actions: [] }
  if (componentKey === 'textarea') return { ...base, componentKey, name: '多行输入框',
    props: { placeholder: '请输入内容', disabled: false, maxlength: 255, rows: 4 },
    field: 'value', validation: {}, actions: [] }
  return { ...base, componentKey, name: '按钮', props: { text: '按钮', type: 'primary', disabled: false }, actions: [] }
}

// 定义只描述已安装的能力；数据库中的字符串不能增加可执行组件或动作。
export const COMPONENT_DEFINITIONS: ComponentDefinition[] = [
  { componentKey: 'input', libraryKey: COMPONENT_LIBRARY_KEY, schemaVersion: 1, name: '输入框', category: 'input',
    description: '输入单行文字', configurableProps: ['placeholder', 'clearable', 'disabled', 'maxlength'],
    supportsField: true, supportsValidation: true, defaultSchema: createDefaultComponentSchema('input') },
  { componentKey: 'textarea', libraryKey: COMPONENT_LIBRARY_KEY, schemaVersion: 1, name: '多行输入框', category: 'input',
    description: '输入多行文字', configurableProps: ['placeholder', 'disabled', 'maxlength', 'rows'],
    supportsField: true, supportsValidation: true, defaultSchema: createDefaultComponentSchema('textarea') },
  { componentKey: 'button', libraryKey: COMPONENT_LIBRARY_KEY, schemaVersion: 1, name: '按钮', category: 'action',
    description: '显示按钮，可绑定预先注册的消息提示动作', configurableProps: ['text', 'type', 'disabled'],
    supportsField: false, supportsValidation: false, defaultSchema: createDefaultComponentSchema('button') },
]

const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor'])
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && !dangerousKeys.has(key) && keys.includes(key))
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}
const buttonTypes: readonly string[] = ['default', 'primary', 'success', 'warning', 'danger', 'info']

export function getComponentSchemaError(value: unknown): string | undefined {
  if (!record(value) || !onlyKeys(value, ['schemaVersion', 'libraryKey', 'componentKey', 'name', 'props', 'field', 'validation', 'children', 'actions'])) return '组件配置必须是仅包含允许字段的 JSON 对象'
  if (value.schemaVersion !== COMPONENT_SCHEMA_VERSION) return '不支持的组件配置版本'
  if (value.libraryKey !== COMPONENT_LIBRARY_KEY) return '当前仅支持 Element Plus'
  if (!COMPONENT_KEYS.some(key => key === value.componentKey)) return '组件未注册'
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64) return '组件名称需为 1–64 个字符'
  if (!Array.isArray(value.children) || value.children.length !== 0) return '当前版本仅支持没有子组件的叶子配置'
  if (!record(value.props)) return '组件属性必须是 JSON 对象'
  const props = value.props
  const allowedProps = value.componentKey === 'input' ? ['placeholder', 'clearable', 'disabled', 'maxlength']
    : value.componentKey === 'textarea' ? ['placeholder', 'disabled', 'maxlength', 'rows'] : ['text', 'type', 'disabled']
  if (!onlyKeys(props, allowedProps)) return '组件包含未支持的属性'
  for (const key of ['disabled', 'clearable']) {
    if (key in props && typeof props[key] !== 'boolean') return `${key} 必须为布尔值`
  }
  if ('placeholder' in props && (typeof props.placeholder !== 'string' || props.placeholder.length > 120)) return '输入提示最多 120 个字符'
  if ('maxlength' in props && !integer(props.maxlength, 1, 255)) return '输入长度上限需为 1–255 的整数'
  if ('rows' in props && !integer(props.rows, 2, 10)) return '多行输入框行数需为 2–10 的整数'
  if ('text' in props && (typeof props.text !== 'string' || !props.text.trim() || props.text.length > 64)) return '按钮文字需为 1–64 个字符'
  if ('type' in props && (typeof props.type !== 'string' || !buttonTypes.includes(props.type))) return '按钮类型无效'
  if (value.componentKey === 'button') {
    if ('field' in value || 'validation' in value) return '按钮不支持表单字段和输入校验'
  } else {
    if ('field' in value && (typeof value.field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(value.field) || dangerousKeys.has(value.field))) return '字段名需以字母开头，仅含字母、数字、下划线，最多 32 位'
    if ('validation' in value) {
      const validation = value.validation
      if (!record(validation) || !onlyKeys(validation, ['required', 'minLength', 'maxLength'])) return '输入校验包含未支持的规则'
      if ('required' in validation && typeof validation.required !== 'boolean') return '必填规则必须为布尔值'
      if ('minLength' in validation && !integer(validation.minLength, 0, 255)) return '最小长度需为 0–255 的整数'
      if ('maxLength' in validation && !integer(validation.maxLength, 1, 255)) return '最大长度需为 1–255 的整数'
      const max = typeof validation.maxLength === 'number' ? validation.maxLength : 255
      const min = typeof validation.minLength === 'number' ? validation.minLength : 0
      const inputMax = typeof props.maxlength === 'number' ? props.maxlength : 255
      if (min > max || min > inputMax || ('maxLength' in validation && max > inputMax)) return '校验长度范围必须与输入长度上限一致'
    }
  }
  if ('actions' in value) {
    if (!Array.isArray(value.actions) || value.actions.length > 1) return '组件动作最多配置一个'
    if (value.actions.length > 0) {
      if (value.componentKey !== 'button') return '只有按钮支持点击动作'
      const action: unknown = value.actions[0]
      if (!record(action) || !onlyKeys(action, ['event', 'actionKey', 'message']) || action.event !== 'click' || action.actionKey !== 'show-message') return '只允许已注册的点击消息提示动作'
      if (typeof action.message !== 'string' || !action.message.trim() || action.message.length > 200) return '消息提示需为 1–200 个字符'
    }
  }
}

export function isComponentSchema(value: unknown): value is ComponentSchema { return getComponentSchemaError(value) === undefined }
export function getSaveComponentConfigError(value: unknown): string | undefined {
  if (!record(value) || !onlyKeys(value, ['schema']) || !('schema' in value)) return '请仅提交 schema 组件配置'
  return getComponentSchemaError(value.schema)
}
export function isSaveComponentConfigRequest(value: unknown): value is SaveComponentConfigRequest {
  return getSaveComponentConfigError(value) === undefined
}
export function isComponentConfig(value: unknown): value is ComponentConfig {
  return record(value) && onlyKeys(value, ['configId', 'schema', 'createdTime', 'updatedTime'])
    && typeof value.configId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.configId)
    && isComponentSchema(value.schema) && typeof value.createdTime === 'string' && Number.isFinite(Date.parse(value.createdTime))
    && typeof value.updatedTime === 'string' && Number.isFinite(Date.parse(value.updatedTime))
}
export function isComponentDefinition(value: unknown): value is ComponentDefinition {
  if (!record(value) || !onlyKeys(value, ['componentKey', 'libraryKey', 'schemaVersion', 'name', 'category', 'description', 'configurableProps', 'supportsField', 'supportsValidation', 'defaultSchema'])) return false
  const installed = COMPONENT_DEFINITIONS.find(definition => definition.componentKey === value.componentKey)
  return !!installed && value.libraryKey === installed.libraryKey && value.schemaVersion === installed.schemaVersion
    && value.name === installed.name && value.category === installed.category && value.description === installed.description
    && Array.isArray(value.configurableProps) && value.configurableProps.length === installed.configurableProps.length
    && value.configurableProps.every((prop, index) => prop === installed.configurableProps[index])
    && value.supportsField === installed.supportsField && value.supportsValidation === installed.supportsValidation
    && isComponentSchema(value.defaultSchema) && value.defaultSchema.componentKey === installed.componentKey
}

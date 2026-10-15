import {
  CALLBACK_KEYS,
  CALLBACK_PARAM_KEYS,
  type CallbackReference,
} from '../../../shared/contracts/workbench.ts'
const labels: Record<CallbackReference['callbackKey'], string> = {
  'return-binding': '读取绑定值',
  format: '格式化或构建内容',
  filter: '筛选选项',
  compare: '比较与排序',
  validate: '输入验证',
  'lazy-load': '读取子节点',
  'preview-upload': '受控上传预览',
  'date-disable': '限制日期范围',
}
export const callbackStrategies = CALLBACK_KEYS.map((key) => ({
  key,
  label: labels[key],
  parameters: CALLBACK_PARAM_KEYS[key],
}))
export type CallbackStrategyKey = CallbackReference['callbackKey']
export function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const key of path) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(String(key)) ||
      current === null ||
      !['object', 'function'].includes(typeof current)
    )
      return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}
function text(value: unknown): string {
  return value === undefined || value === null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
}
export function runCallbackStrategy(
  key: CallbackStrategyKey,
  args: unknown[],
  params: Record<string, unknown>,
): unknown {
  if (key === 'return-binding') return Object.hasOwn(params, 'value') ? params.value : args[0]
  if (key === 'format') {
    if (params.node) return params.node
    const value = Object.hasOwn(params, 'value') ? params.value : args[0]
    return typeof params.template === 'string'
      ? params.template.replace(
          /\{\{\s*(value(?:\.[a-zA-Z0-9_$-]+)*)\s*\}\}/g,
          (_match, reference: string) => text(readPath({ value }, reference.split('.'))),
        )
      : text(value)
  }
  if (key === 'filter') {
    const query = text(params.query ?? args[0])
      .trim()
      .toLowerCase()
    const field = typeof params.labelKey === 'string' ? params.labelKey : 'label'
    const match = (item: unknown) =>
      text(
        item && typeof item === 'object'
          ? (readPath(item, [field]) ?? readPath(item, ['value']))
          : item,
      )
        .toLowerCase()
        .includes(query)
    return params.resultMode === 'match'
      ? match(params.options ?? args[1])
      : (Array.isArray(params.options) ? params.options : []).filter(match)
  }
  if (key === 'compare') {
    const first = params.left ?? args[0]
    const second = params.right ?? args[1]
    const keyPath = typeof params.key === 'string' ? params.key.split('.') : []
    const left = readPath(first, keyPath)
    const right = readPath(second, keyPath)
    const result =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : new Intl.Collator('zh-CN').compare(text(left), text(right))
    return params.direction === 'desc' ? -result : result
  }
  if (key === 'validate') {
    const value = Object.hasOwn(params, 'value')
      ? params.value
      : args.length > 1
        ? args[1]
        : args[0]
    const content = text(value)
    let message = ''
    if (params.required && (value === undefined || value === null || !content.trim()))
      message = '此字段为必填项'
    else if (
      typeof params.minLength === 'number' &&
      content &&
      [...content].length < params.minLength
    )
      message = `至少输入 ${params.minLength} 个字符`
    else if (typeof params.maxLength === 'number' && [...content].length > params.maxLength)
      message = `最多输入 ${params.maxLength} 个字符`
    else if (params.pattern instanceof RegExp && !params.pattern.test(content))
      message = '输入格式不正确'
    const error = message
      ? typeof params.message === 'string' && params.message
        ? params.message
        : message
      : ''
    if (params.resultMode === 'boolean') return !error
    if (params.resultMode === 'message') return error || true
    return error ? new Error(error) : undefined
  }
  if (key === 'lazy-load') {
    if (params.data !== undefined) return params.data
    const keyName = typeof params.childrenKey === 'string' ? params.childrenKey : 'children'
    return readPath(args[0], ['data', keyName]) ?? readPath(args[0], [keyName]) ?? []
  }
  if (key === 'preview-upload')
    return new Promise((resolve, reject) => {
      const complete = () => {
        if (params.success === false) {
          reject(new Error('上传预览失败'))
          return
        }
        const file = readPath(args[0], ['file'])
        resolve(
          params.data ?? {
            status: 'success',
            name: text(readPath(file, ['name'])),
            size: readPath(file, ['size']) ?? 0,
            url: params.url ?? '',
          },
        )
      }
      setTimeout(
        complete,
        typeof params.delay === 'number' ? Math.min(2000, Math.max(0, params.delay)) : 0,
      )
    })
  const input = params.date ?? args[0]
  const date = input instanceof Date ? input : new Date(text(input))
  if (!Number.isFinite(date.getTime())) return true
  if (params.mode === 'weekends') return [0, 6].includes(date.getDay())
  if (typeof params.before === 'string' && date.getTime() < Date.parse(params.before)) return true
  return typeof params.after === 'string' && date.getTime() > Date.parse(params.after)
}

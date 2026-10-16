<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import {
  ELEMENT_PLUS_APIS,
  ELEMENT_PLUS_ICON_KEYS,
  findElementPlusApi,
  type ApiProp,
} from '../../../shared/catalog/element-plus.ts'
import {
  getSafeRegexpError,
  type JsonValue,
  type SchemaV2,
  type TypedValue,
} from '../../../shared/contracts/workbench.ts'
import ApiPropertyEditor from './ApiPropertyEditor.vue'
import CallbackEditor from './CallbackEditor.vue'
import NodeEditor from './NodeEditor.vue'
import StructuredValueEditor from './StructuredValueEditor.vue'
import {
  allApiNodes,
  declareStateKey,
  defaultTypedValue,
  nodeId,
  renderableApis,
  typedJson,
} from './editor-model'
const props = withDefaults(
  defineProps<{
    modelValue: TypedValue
    schema: SchemaV2
    metadata?: ApiProp
    objectApiKey?: string
    scopeNames?: string[]
    label?: string
  }>(),
  { scopeNames: () => [], label: '参数值' },
)
const emit = defineEmits<{ 'update:modelValue': [value: TypedValue] }>()
const declareState = inject(declareStateKey, undefined)
const newStateKey = computed(() => {
  const value = props.modelValue
  if (value.kind !== 'binding' || value.source !== 'state' || value.path.length !== 1) return ''
  const key = value.path[0]
  return typeof key === 'string' &&
    /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) &&
    !['constructor', 'prototype', '__proto__'].includes(key) &&
    !Object.hasOwn(props.schema.state, key)
    ? key
    : ''
})
const fieldName = ref('')
const fieldAttempted = ref(false)
const fieldError = computed(() => {
  if (!fieldName.value) return fieldAttempted.value ? '请输入字段名。' : ''
  if (['constructor', 'prototype', '__proto__'].includes(fieldName.value))
    return '此字段名为保留字段，请换一个名称。'
  if (
    props.modelValue.kind === 'object' &&
    Object.hasOwn(props.modelValue.entries, fieldName.value)
  )
    return '字段已存在，原值已保留。请编辑已有字段或使用其他名称。'
  return ''
})
const bindingError = computed(() => {
  if (props.modelValue.kind !== 'binding') return ''
  const path = props.modelValue.path
  if (!path.length || path.length > 12) return '绑定路径需要 1–12 层字段。'
  if (
    path.some((part) =>
      typeof part === 'number'
        ? !Number.isInteger(part) || part < 0 || part > 2000
        : !/^[a-zA-Z_$][a-zA-Z0-9_$-]{0,63}$/.test(part) ||
          ['constructor', 'prototype', '__proto__'].includes(part),
    )
  )
    return '每层字段最多 64 字符，以字母、_ 或 $ 开头；数组索引为 0–2000。'
  if (props.modelValue.source === 'state' && !Object.hasOwn(props.schema.state, path[0]!))
    return '此状态尚未声明，请选择已有状态或在状态设置中创建。'
  return ''
})
const htmlError = computed(() =>
  props.modelValue.kind === 'html' && props.modelValue.value.length > 8000
    ? `HTML 最多 8000 字符，当前 ${props.modelValue.value.length}；内容已保留，请缩短。`
    : '',
)
const regexpError = computed(() =>
  props.modelValue.kind === 'regexp'
    ? getSafeRegexpError(props.modelValue.source, props.modelValue.flags)
    : '',
)
watch(
  () => props.modelValue,
  (value) => {
    if (value.kind === 'literal' && value.value && typeof value.value === 'object')
      emit('update:modelValue', typedJson(value.value))
  },
  { immediate: true },
)
const meta = computed<ApiProp>(
  () =>
    props.metadata ?? {
      name: props.label,
      runtimeName: props.label,
      typeText: '安全类型化值',
      valueKinds: ['unknown'],
      enumValues: [],
      defaultText: '',
    },
)
const objectApi = computed(() =>
  findElementPlusApi(
    props.modelValue.kind === 'object'
      ? (props.modelValue.apiKey ?? props.objectApiKey ?? '')
      : (props.objectApiKey ?? ''),
  ),
)
const objectMembers = computed(() => objectApi.value?.props ?? meta.value.members ?? [])
const arrayItemMetadata = computed<ApiProp | undefined>(() =>
  meta.value.members?.length
    ? {
        ...meta.value,
        valueKinds: ['object'],
        enumValues: [],
        defaultText: '{}',
        typeText: '数组项对象',
      }
    : undefined,
)
const allNodes = computed(() => allApiNodes(props.schema.root))
const currentRef = computed(() => {
  const value = props.modelValue
  return value.kind === 'ref'
    ? allNodes.value.find((node) => node.nodeId === value.nodeId)
    : undefined
})
const availableObjectMembers = computed(() => {
  const value = props.modelValue
  return objectMembers.value.filter(
    (prop) => value.kind !== 'object' || !Object.hasOwn(value.entries, prop.name),
  )
})
const internalRefs = computed(() =>
  ELEMENT_PLUS_APIS.filter(
    (api) =>
      api.parentApiKey === currentRef.value?.apiKey && api.propPath && !api.propPath.includes('[]'),
  ).flatMap((api) =>
    api.propPath!.split('|').map((path) => ({ ...api, choiceKey: `${api.apiKey}::${path}`, path })),
  ),
)
const refApi = computed(() =>
  props.modelValue.kind === 'ref'
    ? findElementPlusApi(props.modelValue.apiKey ?? currentRef.value?.apiKey ?? '')
    : undefined,
)
const kindOptions = computed(() => {
  const allowed = meta.value.valueKinds
  const any = allowed.includes('unknown')
  const result: TypedValue['kind'][] = ['binding', 'ref']
  if (any || allowed.some((kind) => ['string', 'number', 'boolean', 'null'].includes(kind)))
    result.unshift('literal')
  if (any || allowed.includes('array')) result.push('array')
  if (any || allowed.includes('object')) result.push('object', 'style')
  if (any || allowed.includes('date')) result.push('date')
  if (any || allowed.includes('regexp')) result.push('regexp')
  if (any || allowed.includes('function')) result.push('callback', 'ref')
  if (any || allowed.includes('component')) result.push('component', 'icon')
  if (any || allowed.includes('vnode')) result.push('node', 'icon')
  if (any || allowed.includes('element')) result.push('dom')
  if (any || allowed.includes('string')) result.push('html')
  return [...new Set([...result, props.modelValue.kind])]
})
const labels: Record<TypedValue['kind'], string> = {
  literal: '固定值',
  binding: '数据绑定',
  array: '数组',
  object: '对象',
  date: '日期',
  regexp: '正则',
  icon: '图标',
  component: '组件引用',
  node: '内容节点',
  callback: '函数策略',
  dom: 'DOM 引用',
  ref: '公开实例引用',
  html: '安全排版 HTML',
  style: 'CSS 属性',
}
const literalKind = computed(() =>
  props.modelValue.kind !== 'literal'
    ? 'string'
    : props.modelValue.value === null
      ? 'null'
      : typeof props.modelValue.value === 'number'
        ? 'number'
        : typeof props.modelValue.value === 'boolean'
          ? 'boolean'
          : 'string',
)
function update(value: TypedValue) {
  emit('update:modelValue', JSON.parse(JSON.stringify(value)) as TypedValue)
}
function updateBindingPath(text: string) {
  if (props.modelValue.kind !== 'binding') return
  // Keep empty path parts while typing so a trailing dot is not silently erased.
  const path = text.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  update({ ...props.modelValue, path })
}
function changeKind(kind: TypedValue['kind']) {
  const defaults: Record<TypedValue['kind'], TypedValue> = {
    literal:
      defaultTypedValue(meta.value).kind === 'literal'
        ? defaultTypedValue(meta.value)
        : { kind: 'literal', value: '' },
    binding: {
      kind: 'binding',
      source: 'state',
      path: [Object.keys(props.schema.state)[0] ?? 'value'],
    },
    array: { kind: 'array', items: [] },
    object: {
      kind: 'object',
      entries: {},
      ...(props.objectApiKey ? { apiKey: props.objectApiKey } : {}),
    },
    date: { kind: 'date', value: new Date().toISOString() },
    regexp: { kind: 'regexp', source: '', flags: '' },
    icon: { kind: 'icon', name: 'ArrowDown' },
    component: { kind: 'component', apiKey: 'input' },
    node: {
      kind: 'node',
      node: { kind: 'text', nodeId: nodeId('text'), value: { kind: 'literal', value: '内容' } },
    },
    callback: { kind: 'callback', reference: { callbackKey: 'return-binding', params: {} } },
    dom: { kind: 'dom', nodeId: 'root' },
    ref: { kind: 'ref', nodeId: allNodes.value[0]?.nodeId ?? '' },
    html: { kind: 'html', value: '<p>内容</p>' },
    style: { kind: 'style', value: {} },
  }
  update(defaults[kind])
}
function addField() {
  fieldAttempted.value = true
  if (props.modelValue.kind !== 'object' || fieldError.value) return
  const member = objectMembers.value.find((prop) => prop.name === fieldName.value)
  update({
    ...props.modelValue,
    ...(props.objectApiKey ? { apiKey: props.objectApiKey } : {}),
    entries: { ...props.modelValue.entries, [fieldName.value]: defaultTypedValue(member) },
  })
  fieldName.value = ''
  fieldAttempted.value = false
}
function field(value: TypedValue, key: string, child: TypedValue) {
  if (value.kind === 'object') update({ ...value, entries: { ...value.entries, [key]: child } })
}
function removeField(value: TypedValue, key: string) {
  if (value.kind === 'object') {
    const entries = { ...value.entries }
    delete entries[key]
    update({ ...value, entries })
  }
}
function refKind(choice: string) {
  const [apiKey, path] = choice.split('::')
  if (!apiKey) return
  if (props.modelValue.kind !== 'ref') return
  const api = findElementPlusApi(apiKey)
  update({
    kind: 'ref',
    nodeId: props.modelValue.nodeId,
    ...(api?.parentApiKey ? { apiKey, path: path?.split('.') } : {}),
  })
}
</script>
<template>
  <div class="typed-editor">
    <div class="value-heading">
      <span :title="label" class="value-label">{{ label }}</span
      ><el-select
        :model-value="modelValue.kind"
        :aria-label="`${label} 值来源`"
        @change="changeKind"
        ><el-option v-for="kind in kindOptions" :key="kind" :value="kind" :label="labels[kind]"
      /></el-select>
    </div>
    <ApiPropertyEditor
      v-if="modelValue.kind === 'literal'"
      :metadata="meta"
      :value-kind="literalKind"
      :model-value="modelValue.value"
      @update:model-value="update({ kind: 'literal', value: $event as JsonValue })"
    />
    <template v-else-if="modelValue.kind === 'binding'">
      <div class="inline">
        <el-select
          :model-value="modelValue.source"
          aria-label="绑定来源"
          @change="update({ ...modelValue, source: $event })"
          ><el-option
            v-for="source in ['state', 'data', 'scope', 'event', 'auth']"
            :key="source"
            :value="source"
            :label="source" /></el-select
        ><el-input
          :model-value="modelValue.path.join('.')"
          placeholder="字段路径，例如 row.label 或 0"
          aria-label="绑定字段路径"
          :aria-invalid="!!bindingError"
          @update:model-value="updateBindingPath"
        />
      </div>
      <p v-if="bindingError" class="field-error" role="alert">{{ bindingError }}</p>
      <el-button
        v-if="newStateKey && declareState"
        @click="declareState(newStateKey, defaultTypedValue(metadata))"
        >创建状态 {{ newStateKey }}</el-button
      >
      <p class="hint">
        状态：{{ Object.keys(schema.state).join('、') || '未声明' }}；数据源：{{
          schema.resources.map((item) => item.resourceId).join('、') || '未声明'
        }}；当前作用域：{{ scopeNames.join('、') || '无' }}。事件参数使用 0、1 等索引。
      </p>
    </template>
    <template v-else-if="modelValue.kind === 'array'">
      <div v-for="(item, index) in modelValue.items" :key="index" class="nested">
        <TypedValueEditor
          :model-value="item"
          :schema="schema"
          :metadata="arrayItemMetadata"
          :object-api-key="objectApiKey"
          :scope-names="scopeNames"
          :label="`第 ${index + 1} 项`"
          @update:model-value="
            update({
              ...modelValue,
              items: modelValue.items.map((entry, i) => (i === index ? $event : entry)),
            })
          "
        /><el-button
          @click="update({ ...modelValue, items: modelValue.items.filter((_, i) => i !== index) })"
          >删除项</el-button
        >
      </div>
      <el-button
        @click="
          update({
            ...modelValue,
            items: [
              ...modelValue.items,
              objectApiKey
                ? { kind: 'object', apiKey: objectApiKey, entries: {} }
                : arrayItemMetadata
                  ? { kind: 'object', entries: {} }
                  : { kind: 'literal', value: '' },
            ],
          })
        "
        >添加数组项</el-button
      >
    </template>
    <template v-else-if="modelValue.kind === 'object'">
      <p v-if="objectApi" class="hint">
        结构 API：{{ objectApi.apiKey }} · {{ objectApi.props.length }} 个公开字段
      </p>
      <div v-for="(entry, key) in modelValue.entries" :key="key" class="nested">
        <TypedValueEditor
          :model-value="entry"
          :schema="schema"
          :metadata="objectMembers.find((prop) => prop.name === key || prop.runtimeName === key)"
          :scope-names="scopeNames"
          :label="String(key)"
          @update:model-value="field(modelValue, String(key), $event)"
        /><el-button @click="removeField(modelValue, String(key))">删除字段</el-button>
      </div>
      <div class="inline">
        <el-select v-if="objectMembers.length" v-model="fieldName" filterable aria-label="对象字段"
          ><el-option
            v-for="prop in availableObjectMembers"
            :key="prop.name"
            :value="prop.name"
            :label="`${prop.name} · ${prop.typeText}`" /></el-select
        ><el-input
          v-else
          v-model="fieldName"
          placeholder="字段名"
          aria-label="对象字段"
          :aria-invalid="!!fieldError"
        /><el-button @click="addField">添加字段</el-button>
      </div>
      <p v-if="fieldError" class="field-error" role="alert">{{ fieldError }}</p>
    </template>
    <el-date-picker
      v-else-if="modelValue.kind === 'date'"
      :model-value="modelValue.value"
      type="datetime"
      value-format="YYYY-MM-DDTHH:mm:ssZ"
      aria-label="日期值"
      @update:model-value="update({ ...modelValue, value: String($event ?? '') })"
    />
    <template v-else-if="modelValue.kind === 'regexp'"
      ><div class="inline">
        <el-input
          :model-value="modelValue.source"
          aria-label="正则规则"
          @update:model-value="update({ ...modelValue, source: $event })"
        /><el-input
          :model-value="modelValue.flags"
          aria-label="正则标记"
          @update:model-value="update({ ...modelValue, flags: $event })"
        />
      </div>
      <p v-if="regexpError" class="field-error" role="alert">{{ regexpError }}</p>
    </template>
    <el-select
      v-else-if="modelValue.kind === 'icon'"
      :model-value="modelValue.name"
      filterable
      aria-label="图标引用"
      @change="update({ ...modelValue, name: $event })"
      ><el-option v-for="name in ELEMENT_PLUS_ICON_KEYS" :key="name" :value="name" :label="name"
    /></el-select>
    <el-select
      v-else-if="modelValue.kind === 'component'"
      :model-value="modelValue.apiKey"
      filterable
      aria-label="组件引用"
      @change="update({ ...modelValue, apiKey: $event })"
      ><el-option
        v-for="api in renderableApis.filter(
          (api) => api.kind === 'component' || api.kind === 'composite',
        )"
        :key="api.apiKey"
        :value="api.apiKey"
        :label="api.runtimeExport"
    /></el-select>
    <NodeEditor
      v-else-if="modelValue.kind === 'node'"
      :model-value="modelValue.node"
      :schema="schema"
      :scope-names="scopeNames"
      @update:model-value="update({ ...modelValue, node: $event })"
    />
    <CallbackEditor
      v-else-if="modelValue.kind === 'callback'"
      :model-value="modelValue.reference"
      :schema="schema"
      :metadata="meta"
      :scope-names="scopeNames"
      @update:model-value="update({ ...modelValue, reference: $event })"
    />
    <el-select
      v-else-if="modelValue.kind === 'dom'"
      :model-value="modelValue.nodeId"
      filterable
      aria-label="DOM目标"
      @change="update({ ...modelValue, nodeId: $event })"
      ><el-option value="root" label="当前渲染区域根容器" /><el-option
        v-for="node in allNodes.filter((node) => ['component', 'composite'].includes(node.kind))"
        :key="node.nodeId"
        :value="node.nodeId"
        :label="`${node.apiKey} · ${node.nodeId}`"
    /></el-select>
    <template v-else-if="modelValue.kind === 'ref'">
      <p class="hint">只在当前循环项和祖先作用域中查找实例；根节点不会任意读取其他行的实例。</p>
      <el-select
        :model-value="modelValue.nodeId"
        filterable
        aria-label="实例目标"
        @change="update({ kind: 'ref', nodeId: $event })"
        ><el-option
          v-for="node in allNodes"
          :key="node.nodeId"
          :value="node.nodeId"
          :label="`${node.apiKey} · ${node.nodeId}`"
      /></el-select>
      <el-select
        :model-value="
          modelValue.apiKey
            ? `${modelValue.apiKey}::${modelValue.path?.join('.')}`
            : currentRef?.apiKey
        "
        aria-label="公开对象 API"
        @change="refKind"
        ><el-option v-if="currentRef" :value="currentRef.apiKey" label="组件本身" /><el-option
          v-for="api in internalRefs"
          :key="api.choiceKey"
          :value="api.choiceKey"
          :label="`${api.apiKey} · ${api.path}`"
      /></el-select>
      <el-select
        :model-value="modelValue.expose"
        clearable
        filterable
        aria-label="公开方法"
        @change="update({ ...modelValue, expose: $event || undefined })"
        ><el-option
          v-for="method in refApi?.exposes ?? []"
          :key="method.name"
          :value="method.name"
          :label="`${method.name} · ${method.signature}`"
      /></el-select>
    </template>
    <template v-else-if="modelValue.kind === 'html'"
      ><el-input
        :model-value="modelValue.value"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 12 }"
        aria-label="安全 HTML"
        :aria-invalid="!!htmlError"
        @update:model-value="update({ ...modelValue, value: $event })"
      />
      <p v-if="htmlError" class="field-error" role="alert">{{ htmlError }}</p>
      <p class="hint">仅支持无属性排版标签；安全检查与 DOMPurify 同时生效。</p></template
    >
    <StructuredValueEditor
      v-else-if="modelValue.kind === 'style'"
      :model-value="modelValue.value"
      :string-limit="200"
      @update:model-value="
        update({ ...modelValue, value: $event as Record<string, string | number> })
      "
    />
  </div>
</template>
<style scoped>
.typed-editor {
  padding: 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.value-heading,
.inline {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}
.inline > :deep(.el-input),
.inline > :deep(.el-select) {
  flex: 1 1 140px;
  min-width: 0;
  max-width: 100%;
}
.value-label {
  flex: 1 1 90px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value-heading {
  justify-content: space-between;
}
.value-heading :deep(.el-select) {
  width: 170px;
  flex-shrink: 0;
  max-width: 100%;
}
.nested {
  border-left: 2px solid #d9ecff;
  padding-left: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.typed-editor .typed-editor .typed-editor {
  padding-inline: 0;
  border-inline: 0;
}
.nested .nested .nested {
  padding-left: 0;
  border-left: 0;
}
.field-error {
  margin: 0;
  color: #f56c6c;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.typed-editor :deep(.el-date-editor),
.typed-editor :deep(.el-input-number) {
  max-width: 100%;
}
.typed-editor :deep(.el-textarea__inner) {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.hint {
  font-size: 12px;
  margin: 0;
  color: #606266;
  overflow-wrap: anywhere;
}
</style>

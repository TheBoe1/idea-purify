<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ELEMENT_PLUS_APIS,
  ELEMENT_PLUS_ICON_KEYS,
  findElementPlusApi,
  type ApiProp,
} from '../../../shared/catalog/element-plus.ts'
import type { JsonValue, SchemaV2, TypedValue } from '../../../shared/contracts/workbench.ts'
import ApiPropertyEditor from './ApiPropertyEditor.vue'
import CallbackEditor from './CallbackEditor.vue'
import NodeEditor from './NodeEditor.vue'
import StructuredValueEditor from './StructuredValueEditor.vue'
import {
  allApiNodes,
  defaultTypedValue,
  nodeId,
  parsePath,
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
const fieldName = ref('')
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
  if (
    props.modelValue.kind !== 'object' ||
    !/^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(fieldName.value) ||
    ['constructor', 'prototype', '__proto__'].includes(fieldName.value)
  )
    return
  const member = objectMembers.value.find((prop) => prop.name === fieldName.value)
  update({
    ...props.modelValue,
    ...(props.objectApiKey ? { apiKey: props.objectApiKey } : {}),
    entries: { ...props.modelValue.entries, [fieldName.value]: defaultTypedValue(member) },
  })
  fieldName.value = ''
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
      <span>{{ label }}</span
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
          @update:model-value="update({ ...modelValue, path: parsePath($event) })"
        />
      </div>
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
        /><el-button @click="addField">添加字段</el-button>
      </div>
    </template>
    <el-date-picker
      v-else-if="modelValue.kind === 'date'"
      :model-value="modelValue.value"
      type="datetime"
      value-format="YYYY-MM-DDTHH:mm:ssZ"
      aria-label="日期值"
      @update:model-value="update({ ...modelValue, value: String($event ?? '') })"
    />
    <div v-else-if="modelValue.kind === 'regexp'" class="inline">
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
        aria-label="安全 HTML"
        @update:model-value="update({ ...modelValue, value: $event })"
      />
      <p class="hint">仅支持无属性排版标签；安全检查与 DOMPurify 同时生效。</p></template
    >
    <StructuredValueEditor
      v-else-if="modelValue.kind === 'style'"
      :model-value="modelValue.value"
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
}
.value-heading,
.inline {
  display: flex;
  gap: 8px;
  align-items: center;
}
.value-heading {
  justify-content: space-between;
}
.value-heading :deep(.el-select) {
  width: 170px;
  flex-shrink: 0;
}
.nested {
  border-left: 2px solid #d9ecff;
  padding-left: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hint {
  font-size: 12px;
  margin: 0;
  color: #606266;
  overflow-wrap: anywhere;
}
</style>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import {
  ELEMENT_PLUS_APIS,
  findElementPlusApi,
  type ApiProp,
  type ApiValueKind,
} from '../../../shared/catalog/element-plus.ts'
import type {
  ApiNode,
  DataBinding,
  SchemaV2,
  TypedValue,
  WorkbenchNode,
} from '../../../shared/contracts/workbench.ts'
import TypedValueEditor from './TypedValueEditor.vue'
import ActionEditor from './ActionEditor.vue'
import CallbackEditor from './CallbackEditor.vue'
import NodeListEditor from './NodeListEditor.vue'
import ApiPropertyEditor from './ApiPropertyEditor.vue'
import { allApiNodes, declareStateKey, defaultTypedValue } from './editor-model'
const props = withDefaults(
  defineProps<{ modelValue: WorkbenchNode; schema: SchemaV2; scopeNames?: string[] }>(),
  { scopeNames: () => [] },
)
const emit = defineEmits<{ 'update:modelValue': [value: WorkbenchNode] }>()
const declareState = inject(declareStateKey, undefined)
const query = ref('')
const addedProp = ref('')
const activeTab = ref('basic')
watch(
  () => props.modelValue.nodeId,
  () => {
    activeTab.value = 'basic'
  },
)
const node = computed(() =>
  ['component', 'composite', 'service', 'directive', 'design'].includes(props.modelValue.kind)
    ? (props.modelValue as ApiNode)
    : undefined,
)
const api = computed(() => node.value && findElementPlusApi(node.value.apiKey))
const quickLabels: Record<string, string> = {
  placeholder: '占位文字',
  type: '类型',
  size: '尺寸',
  disabled: '禁用',
  clearable: '允许清空',
  maxlength: '最大输入长度',
  minlength: '最小输入长度',
  showWordLimit: '显示字数',
  label: '标签文字',
  prop: '绑定字段',
  required: '必填',
  title: '标题',
  description: '描述',
  content: '内容',
  name: '名称',
  loading: '加载中',
  multiple: '多选',
  filterable: '可搜索',
  labelWidth: '标签宽度',
  labelPosition: '标签位置',
  rows: '输入行数',
  autosize: '自动高度',
  text: '文字按钮',
  round: '圆角',
  plain: '朴素样式',
  effect: '主题',
  closable: '可关闭',
}
const quickNames: Record<string, string[]> = {
  input: [
    'placeholder',
    'type',
    'clearable',
    'maxlength',
    'minlength',
    'showWordLimit',
    'disabled',
    'size',
  ],
  button: ['type', 'size', 'loading', 'disabled', 'plain', 'round'],
  form: ['labelWidth', 'labelPosition', 'size', 'disabled'],
  'form-item': ['label', 'prop', 'required', 'labelWidth'],
  select: ['placeholder', 'multiple', 'filterable', 'clearable', 'disabled', 'size'],
  'input-number': ['min', 'max', 'step', 'disabled', 'size'],
}
const quickProps = computed(() => {
  if (!api.value) return []
  const names = quickNames[api.value.apiKey] ?? [
    'label',
    'title',
    'placeholder',
    'type',
    'size',
    'disabled',
    'content',
    'description',
    'closable',
  ]
  return names.flatMap((name) =>
    api.value!.props.filter(
      (prop) =>
        prop.runtimeName === name &&
        prop.valueKinds.some((kind) => ['string', 'number', 'boolean'].includes(kind)),
    ),
  )
})
function quickValue(prop: ApiProp): TypedValue {
  const configured = node.value?.props[prop.name]
  if (configured) return configured
  if (prop.enumValues.length && ['', '—'].includes(prop.defaultText.trim()))
    return { kind: 'literal', value: null }
  return defaultTypedValue(prop)
}
function quickKind(prop: ApiProp): ApiValueKind {
  const value = quickValue(prop)
  return value.kind === 'literal' && ['string', 'number', 'boolean'].includes(typeof value.value)
    ? (typeof value.value as ApiValueKind)
    : (prop.valueKinds.find((kind) => ['string', 'number', 'boolean'].includes(kind)) ?? 'string')
}
const simpleText = computed(() => {
  const content = node.value?.slots?.default
  const first = content?.[0]
  return content?.length === 1 &&
    first?.kind === 'text' &&
    first.value.kind === 'literal' &&
    typeof first.value.value === 'string'
    ? first
    : undefined
})
const textMeta: ApiProp = {
  name: '显示文字',
  runtimeName: 'text',
  typeText: 'string',
  valueKinds: ['string'],
  enumValues: [],
  defaultText: '',
}
function updateSimpleText(value: unknown) {
  if (!node.value || !simpleText.value) return
  update({
    slots: {
      ...node.value.slots,
      default: [{ ...simpleText.value, value: { kind: 'literal', value: String(value) } }],
    },
  })
}
const visibleProps = computed(
  () =>
    api.value?.props.filter((prop) =>
      `${prop.name} ${prop.typeText}`.toLowerCase().includes(query.value.toLowerCase()),
    ) ?? [],
)
function update(patch: Partial<WorkbenchNode>) {
  emit(
    'update:modelValue',
    JSON.parse(JSON.stringify({ ...props.modelValue, ...patch })) as WorkbenchNode,
  )
}
const domNodes = computed(() =>
  allApiNodes(props.schema.root).filter(
    (item) => ['component', 'composite'].includes(item.kind) && item.nodeId !== node.value?.nodeId,
  ),
)
function property(name: string, value: TypedValue) {
  if (node.value) update({ props: { ...node.value.props, [name]: value } })
}
function removeProperty(name: string) {
  if (!node.value) return
  const values = { ...node.value.props }
  delete values[name]
  update({ props: values })
}
function addProperty() {
  const prop = api.value?.props.find((prop) => prop.name === addedProp.value)
  if (
    prop &&
    node.value &&
    !Object.hasOwn(node.value.props, prop.name) &&
    !node.value.models?.[prop.name]
  )
    property(prop.name, defaultTypedValue(prop))
  addedProp.value = ''
}
function model(name: string, value: TypedValue) {
  if (node.value && value.kind === 'binding')
    update({ models: { ...node.value.models, [name]: value as DataBinding } })
}
function toggleModel(name: string, enabled: unknown) {
  if (!node.value) return
  const models = { ...node.value.models }
  if (enabled) {
    const key = `model-${node.value.nodeId}-${name}`
    if (!Object.hasOwn(props.schema.state, key))
      declareState?.(key, defaultTypedValue(api.value?.props.find((prop) => prop.name === name)))
    models[name] = { kind: 'binding', source: 'state', path: [key] }
  } else delete models[name]
  const values = { ...node.value.props }
  if (enabled) delete values[name]
  update({ models, props: values })
}
function setCallback(
  name: string,
  callback: NonNullable<ApiNode['callbacks']>[string] | undefined,
) {
  if (!node.value) return
  const callbacks = { ...node.value.callbacks }
  const values = { ...node.value.props }
  delete values[name]
  if (callback) callbacks[name] = callback
  else delete callbacks[name]
  update({ props: values, callbacks })
}
function hasModelEvent(name: string) {
  const normalize = (value: string) =>
    value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return api.value?.events.some(
    (event) =>
      event.name.startsWith('update:') && normalize(event.name.slice(7)) === normalize(name),
  )
}
function objectApiKey(name: string) {
  const current = api.value
  if (!current) return
  return ELEMENT_PLUS_APIS.find(
    (entry) =>
      entry.parentApiKey === current.apiKey &&
      entry.propPath === `${current.props.find((prop) => prop.name === name)?.runtimeName}[]`,
  )?.apiKey
}
function slotScope(text: string, fields?: string[]) {
  return [
    ...new Set([
      ...props.scopeNames,
      ...(fields ?? text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*[?:])/g) ?? []),
    ]),
  ]
}
</script>
<template>
  <div class="node-editor">
    <div class="node-heading">
      <strong :title="node?.apiKey ?? modelValue.kind">{{ node?.apiKey ?? modelValue.kind }}</strong
      ><span class="hint node-id" :title="modelValue.nodeId">{{ modelValue.nodeId }}</span>
    </div>
    <TypedValueEditor
      v-if="modelValue.kind === 'text'"
      :model-value="modelValue.value"
      :schema="schema"
      :scope-names="scopeNames"
      label="文本内容"
      @update:model-value="update({ value: $event })"
    />
    <template v-else-if="modelValue.kind === 'for'"
      ><TypedValueEditor
        :model-value="modelValue.items"
        :schema="schema"
        :scope-names="scopeNames"
        label="循环数据"
        @update:model-value="update({ items: $event })" />
      <div class="inline">
        <el-input
          :model-value="modelValue.itemName"
          aria-label="循环项变量"
          @update:model-value="update({ itemName: $event })"
        /><el-input
          :model-value="modelValue.indexName ?? ''"
          aria-label="循环索引变量"
          @update:model-value="update({ indexName: $event || undefined })"
        />
      </div>
      <NodeListEditor
        :model-value="modelValue.children"
        :schema="schema"
        :scope-names="[
          ...scopeNames,
          modelValue.itemName,
          ...(modelValue.indexName ? [modelValue.indexName] : []),
        ]"
        label="循环内容"
        @update:model-value="update({ children: $event })"
    /></template>
    <template v-else-if="modelValue.kind === 'if'"
      ><TypedValueEditor
        :model-value="modelValue.test"
        :schema="schema"
        :scope-names="scopeNames"
        label="条件"
        @update:model-value="update({ test: $event })" /><NodeListEditor
        :model-value="modelValue.children"
        :schema="schema"
        :scope-names="scopeNames"
        label="满足条件"
        @update:model-value="update({ children: $event })" /><NodeListEditor
        :model-value="modelValue.elseChildren ?? []"
        :schema="schema"
        :scope-names="scopeNames"
        label="其他条件"
        @update:model-value="update({ elseChildren: $event })"
    /></template>
    <el-alert
      v-else-if="modelValue.kind === 'business'"
      title="复用真实想法表单。预览只模拟保存反馈；已发布页面使用本人想法 API，每个实例保留独立草稿。"
      type="info"
      :closable="false"
    />
    <template v-else-if="node && api">
      <el-alert
        v-if="api.parentApiKey && api.propPath"
        title="内部对象必须通过父组件属性或公开引用配置"
        type="error"
        :closable="false"
      />
      <el-tabs v-model="activeTab"
        ><el-tab-pane label="常用属性" name="basic">
          <ApiPropertyEditor
            v-if="simpleText"
            :metadata="textMeta"
            :model-value="simpleText.value.kind === 'literal' ? simpleText.value.value : ''"
            value-kind="string"
            simple
            @update:model-value="updateSimpleText"
          />
          <div v-for="prop in quickProps" :key="prop.name" class="quick-property">
            <template v-if="node.models?.[prop.name] || quickValue(prop).kind !== 'literal'">
              <span>{{ quickLabels[prop.runtimeName] ?? prop.name }}</span>
              <el-button @click="activeTab = `props-${modelValue.nodeId}`"
                >编辑绑定或复杂值</el-button
              >
            </template>
            <ApiPropertyEditor
              v-else
              :metadata="{ ...prop, name: quickLabels[prop.runtimeName] ?? prop.name }"
              :model-value="
                quickValue(prop).kind === 'literal'
                  ? (quickValue(prop) as { kind: 'literal'; value: unknown }).value
                  : ''
              "
              :value-kind="quickKind(prop)"
              simple
              @update:model-value="
                property(prop.name, {
                  kind: 'literal',
                  value: $event as string | number | boolean | null,
                })
              "
            />
          </div>
          <p v-if="!quickProps.length && !simpleText" class="hint">此组件的配置在完整 API 中。</p>
          <el-button class="advanced-entry" @click="activeTab = `props-${modelValue.nodeId}`"
            >完整属性与数据绑定（{{ api.props.length }}）</el-button
          >
        </el-tab-pane>
        <el-tab-pane :label="`Props（${api.props.length}）`" :name="`props-${modelValue.nodeId}`"
          ><el-input v-model="query" placeholder="搜索公开属性或类型" aria-label="搜索公开属性" />
          <div class="inline">
            <el-select v-model="addedProp" filterable aria-label="添加公开属性"
              ><el-option
                v-for="prop in visibleProps.filter(
                  (prop) => !node!.props[prop.name] && !node!.models?.[prop.name],
                )"
                :key="prop.name"
                :value="prop.name"
                :label="`${prop.name}${prop.required ? ' *' : ''} · ${prop.typeText}`" /></el-select
            ><el-button @click="addProperty">添加属性</el-button>
          </div>
          <div
            v-for="prop in visibleProps.filter(
              (prop) => node!.props[prop.name] || node!.models?.[prop.name],
            )"
            :key="prop.name"
            class="property"
          >
            <template v-if="node.models?.[prop.name]"
              ><TypedValueEditor
                :model-value="node.models[prop.name]!"
                :schema="schema"
                :scope-names="scopeNames"
                :label="`${prop.name} 双向绑定`"
                @update:model-value="model(prop.name, $event)"
              /><el-button @click="toggleModel(prop.name, false)">取消双向绑定</el-button></template
            ><template v-else
              ><TypedValueEditor
                :model-value="node.props[prop.name]!"
                :metadata="prop"
                :schema="schema"
                :scope-names="scopeNames"
                :object-api-key="objectApiKey(prop.name)"
                :label="prop.name"
                @update:model-value="property(prop.name, $event)"
              />
              <div class="inline">
                <el-button @click="removeProperty(prop.name)">删除属性</el-button
                ><el-button
                  v-if="hasModelEvent(prop.runtimeName)"
                  @click="toggleModel(prop.name, true)"
                  >改为双向绑定</el-button
                >
              </div></template
            >
          </div>
          <p class="hint">
            未配置的属性使用 Element Plus 原始默认值；全部
            {{ api.props.length }} 项可搜索选择。对象、数组中的函数和节点保持类型化。
          </p>
        </el-tab-pane>
        <el-tab-pane :label="`Events（${api.events.length}）`" :name="`events-${modelValue.nodeId}`"
          ><el-collapse
            ><el-collapse-item
              v-for="event in api.events"
              :key="event.name"
              :title="event.name"
              :name="event.name"
              ><p class="hint">{{ event.signature }}</p>
              <ActionEditor
                :model-value="node.events?.[event.name] ?? []"
                :schema="schema"
                :scope-names="scopeNames"
                @update:model-value="
                  update({ events: { ...node!.events, [event.name]: $event } })
                " /></el-collapse-item></el-collapse
          ><el-empty v-if="!api.events.length" description="此 API 没有公开事件"
        /></el-tab-pane>
        <el-tab-pane :label="`Slots（${api.slots.length}）`" :name="`slots-${modelValue.nodeId}`"
          ><el-collapse
            ><el-collapse-item
              v-for="slot in api.slots"
              :key="slot.name"
              :title="slot.name"
              :name="slot.name"
              ><p class="hint">作用域：{{ slot.scopeText || '无作用域参数' }}</p>
              <NodeListEditor
                :model-value="node.slots?.[slot.name] ?? []"
                :schema="schema"
                :scope-names="slotScope(slot.scopeText, slot.scopeFields)"
                :label="`${slot.name} 插槽内容`"
                @update:model-value="
                  update({ slots: { ...node!.slots, [slot.name]: $event } })
                " /></el-collapse-item></el-collapse
          ><el-empty v-if="!api.slots.length" description="此 API 没有公开插槽"
        /></el-tab-pane>
        <el-tab-pane
          :label="`Callbacks（${api.props.filter((prop) => prop.valueKinds.includes('function')).length}）`"
          :name="`callbacks-${modelValue.nodeId}`"
          ><el-collapse
            ><el-collapse-item
              v-for="prop in api.props.filter((prop) => prop.valueKinds.includes('function'))"
              :key="prop.name"
              :title="prop.name"
              :name="prop.name"
              ><p class="hint">{{ prop.typeText }}</p>
              <CallbackEditor
                v-if="node.callbacks?.[prop.name]"
                :model-value="node.callbacks[prop.name]!"
                :schema="schema"
                :metadata="prop"
                :scope-names="scopeNames"
                @update:model-value="setCallback(prop.name, $event)"
              /><el-button
                v-else
                @click="setCallback(prop.name, { callbackKey: 'return-binding', params: {} })"
                >配置回调</el-button
              ><el-button
                v-if="node.callbacks?.[prop.name]"
                @click="setCallback(prop.name, undefined)"
                >移除回调</el-button
              ></el-collapse-item
            ></el-collapse
          ></el-tab-pane
        >
        <el-tab-pane
          :label="`公开引用（${api.exposes.length}）`"
          :name="`exposes-${modelValue.nodeId}`"
          ><p class="hint">
            通过事件动作中的“公开实例方法”，或函数类型的“公开实例引用”调用这些已登记接口。
          </p>
          <dl>
            <template v-for="method in api.exposes" :key="method.name"
              ><dt>{{ method.name }}</dt>
              <dd>{{ method.signature }}</dd></template
            >
          </dl></el-tab-pane
        >
      </el-tabs>
      <template v-if="node.kind === 'service'"
        ><label
          >触发方式<el-select
            :model-value="node.trigger ?? 'manual'"
            aria-label="服务触发方式"
            @change="update({ trigger: $event })"
            ><el-option value="manual" label="点击触发" /><el-option
              value="mount"
              label="挂载触发" /></el-select></label
      ></template>
      <label v-if="node.kind === 'directive'"
        >指令目标（可选，默认本容器）<el-select
          :model-value="node.target"
          clearable
          filterable
          aria-label="指令目标"
          @change="update({ target: $event || undefined })"
          ><el-option value="root" label="当前区域根容器" /><el-option
            v-for="target in domNodes"
            :key="target.nodeId"
            :value="target.nodeId"
            :label="`${target.apiKey} · ${target.nodeId}`" /></el-select
      ></label>
      <NodeListEditor
        v-if="['directive', 'design'].includes(node.kind)"
        :model-value="node.children ?? []"
        :schema="schema"
        :scope-names="scopeNames"
        label="容器内容"
        @update:model-value="update({ children: $event })"
      />
    </template>
  </div>
</template>
<style scoped>
.node-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
}
.node-heading,
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.node-heading strong {
  overflow-wrap: anywhere;
}
.node-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.node-heading {
  justify-content: space-between;
}
.inline {
  margin: 10px 0;
}
.inline :deep(.el-select) {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}
.inline :deep(.el-input) {
  flex: 1 1 140px;
  min-width: 0;
  max-width: 100%;
}
.quick-property,
.advanced-entry {
  margin-top: 10px;
  max-width: 100%;
}
.node-editor :deep(.el-tabs),
.node-editor :deep(.el-tab-pane),
.node-editor :deep(.el-tabs__content) {
  min-width: 0;
  max-width: 100%;
}
.node-editor :deep(.el-collapse-item__header) {
  overflow-wrap: anywhere;
  height: auto;
  min-height: 48px;
}
.node-editor :deep(.el-collapse-item__wrap) {
  overflow: visible;
}
.hint,
dd {
  font-size: 12px;
  color: #606266;
  overflow-wrap: anywhere;
}
.property {
  margin: 12px 0;
}
dt {
  font-weight: 600;
}
dd {
  margin: 4px 0 12px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { ApiProp } from '../../../shared/catalog/element-plus.ts'
import type {
  CallbackReference,
  SchemaV2,
  TypedValue,
} from '../../../shared/contracts/workbench.ts'
import { CALLBACK_PARAM_KEYS } from '../../../shared/contracts/workbench.ts'
import { callbackStrategies } from './callback-strategies'
import TypedValueEditor from './TypedValueEditor.vue'
const props = withDefaults(
  defineProps<{
    modelValue: CallbackReference
    schema: SchemaV2
    scopeNames?: string[]
    metadata?: ApiProp
  }>(),
  { scopeNames: () => [] },
)
const emit = defineEmits<{ 'update:modelValue': [value: CallbackReference] }>()
function update(value: CallbackReference) {
  emit('update:modelValue', JSON.parse(JSON.stringify(value)) as CallbackReference)
}
const parameters = computed(() => CALLBACK_PARAM_KEYS[props.modelValue.callbackKey])
function param(key: string, value: TypedValue) {
  update({ ...props.modelValue, params: { ...props.modelValue.params, [key]: value } })
}
function changeMode(mode: CallbackReference['mode']) {
  const { resolveIndex: _resolve, rejectIndex: _reject, ...value } = props.modelValue
  void _resolve
  void _reject
  update({ ...value, mode })
}
function result(enabled: unknown) {
  if (enabled)
    update({
      ...props.modelValue,
      result: {
        kind: 'binding',
        source: 'state',
        path: [Object.keys(props.schema.state)[0] ?? 'result'],
      },
    })
  else {
    const { result: _result, ...value } = props.modelValue
    void _result
    update(value)
  }
}
function remove(key: string) {
  const params = { ...props.modelValue.params }
  delete params[key]
  update({ ...props.modelValue, params })
}
</script>
<template>
  <div class="callback-editor">
    <div class="inline">
      <el-select
        :model-value="modelValue.callbackKey"
        aria-label="回调策略"
        @change="update({ callbackKey: $event, params: {}, mode: modelValue.mode })"
        ><el-option
          v-for="strategy in callbackStrategies"
          :key="strategy.key"
          :value="strategy.key"
          :label="strategy.label" /></el-select
      ><el-select
        :model-value="modelValue.mode ?? 'sync'"
        aria-label="回调返回方式"
        @change="changeMode($event)"
        ><el-option value="sync" label="同步返回" /><el-option
          value="promise"
          label="Promise 返回" /><el-option value="resolve" label="resolve 回调"
      /></el-select>
    </div>
    <p v-if="metadata" class="hint">
      {{ metadata.typeText }} · 参数数：{{ metadata.parameterCount ?? '以公开签名为准' }}
    </p>
    <p class="hint">
      参数可绑定当前事件数组，如 0、1、2；返回方式遵循官方签名。配置只引用已登记策略。
    </p>
    <div v-if="modelValue.mode === 'resolve'" class="inline">
      <label
        >resolve 参数索引（从 0 开始）<el-input-number
          :model-value="modelValue.resolveIndex"
          :min="0"
          :max="15"
          aria-label="resolve 参数索引"
          @update:model-value="
            update({ ...modelValue, resolveIndex: $event ?? undefined })
          " /></label
      ><label
        >reject 参数索引（可选）<el-input-number
          :model-value="modelValue.rejectIndex"
          :min="0"
          :max="15"
          aria-label="reject 参数索引"
          @update:model-value="update({ ...modelValue, rejectIndex: $event ?? undefined })"
      /></label>
    </div>
    <el-checkbox
      :model-value="Boolean(modelValue.gate)"
      @change="
        update({ ...modelValue, gate: $event ? { kind: 'literal', value: true } : undefined })
      "
      >启用执行条件（false 时不调用策略或关闭回调）</el-checkbox
    >
    <TypedValueEditor
      v-if="modelValue.gate"
      :model-value="modelValue.gate"
      :schema="schema"
      :scope-names="scopeNames"
      label="执行条件"
      @update:model-value="update({ ...modelValue, gate: $event })"
    />
    <div v-for="key in parameters" :key="key">
      <TypedValueEditor
        v-if="Object.hasOwn(modelValue.params, key)"
        :model-value="modelValue.params[key]!"
        :schema="schema"
        :scope-names="scopeNames"
        :label="key"
        @update:model-value="param(key, $event)"
      /><el-button v-if="Object.hasOwn(modelValue.params, key)" size="small" @click="remove(key)"
        >移除 {{ key }}</el-button
      ><el-button v-else size="small" @click="param(key, { kind: 'literal', value: '' })"
        >配置 {{ key }}</el-button
      >
    </div>
    <el-checkbox :model-value="Boolean(modelValue.result)" @change="result($event)"
      >将返回值写入状态</el-checkbox
    >
    <TypedValueEditor
      v-if="modelValue.result"
      :model-value="modelValue.result"
      :schema="schema"
      :scope-names="scopeNames"
      label="返回目标"
      @update:model-value="$event.kind === 'binding' && update({ ...modelValue, result: $event })"
    />
  </div>
</template>
<style scoped>
.callback-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.inline {
  display: flex;
  gap: 8px;
}
.hint {
  font-size: 12px;
  color: #606266;
  margin: 0;
}
</style>

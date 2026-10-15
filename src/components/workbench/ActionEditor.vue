<script setup lang="ts">
import {
  ACTION_KEYS,
  ACTION_PARAM_KEYS,
  type ActionReference,
  type SchemaV2,
  type TypedValue,
} from '../../../shared/contracts/workbench.ts'
import TypedValueEditor from './TypedValueEditor.vue'
const props = withDefaults(
  defineProps<{ modelValue: ActionReference[]; schema: SchemaV2; scopeNames?: string[] }>(),
  { scopeNames: () => [] },
)
const emit = defineEmits<{ 'update:modelValue': [value: ActionReference[]] }>()
const labels: Record<ActionReference['actionKey'], string> = {
  'set-state': '更新状态',
  'reset-state': '重置状态',
  'show-message': '消息提示',
  method: '公开实例方法',
  service: '反馈服务',
  'load-data': '加载登记数据源',
}
function update(index: number, action: ActionReference) {
  emit(
    'update:modelValue',
    props.modelValue.map((item, i) => (i === index ? action : item)),
  )
}
function param(index: number, key: string, value: TypedValue) {
  const action = props.modelValue[index]!
  update(index, { ...action, params: { ...action.params, [key]: value } })
}
function initial(key: string, action: ActionReference): TypedValue {
  if (key === 'target')
    return action.actionKey === 'method'
      ? { kind: 'ref', nodeId: '' }
      : { kind: 'binding', source: 'state', path: [Object.keys(props.schema.state)[0] ?? 'value'] }
  if (key === 'args') return { kind: 'array', items: [] }
  if (key === 'options' || key === 'params') return { kind: 'object', entries: {} }
  return { kind: 'literal', value: '' }
}
function move(index: number, delta: number) {
  const list = [...props.modelValue]
  const target = index + delta
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target]!, list[index]!]
  emit('update:modelValue', list)
}
</script>
<template>
  <div class="actions">
    <div v-for="(action, index) in modelValue" :key="index" class="action">
      <div class="inline">
        <span>动作 {{ index + 1 }}</span
        ><el-select
          :model-value="action.actionKey"
          aria-label="动作类型"
          @change="update(index, { actionKey: $event, params: {} })"
          ><el-option
            v-for="key in ACTION_KEYS"
            :key="key"
            :value="key"
            :label="labels[key]" /></el-select
        ><el-button :disabled="index === 0" @click="move(index, -1)">上移</el-button
        ><el-button
          @click="
            emit(
              'update:modelValue',
              modelValue.filter((_, i) => i !== index),
            )
          "
          >删除</el-button
        >
      </div>
      <div v-for="key in ACTION_PARAM_KEYS[action.actionKey]" :key="key">
        <TypedValueEditor
          v-if="action.params[key]"
          :model-value="action.params[key]!"
          :schema="schema"
          :scope-names="scopeNames"
          :label="key"
          @update:model-value="param(index, key, $event)"
        /><el-button v-else @click="param(index, key, initial(key, action))"
          >配置 {{ key }}</el-button
        >
      </div>
    </div>
    <el-button
      @click="
        emit('update:modelValue', [
          ...modelValue,
          { actionKey: 'show-message', params: { message: { kind: 'literal', value: '你好' } } },
        ])
      "
      >添加动作</el-button
    >
  </div>
</template>
<style scoped>
.actions,
.action {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.action {
  border: 1px solid #ebeef5;
  padding: 10px;
}
.inline {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{ modelValue: unknown; depth?: number; disabled?: boolean; stringLimit?: number }>(),
  { depth: 0, disabled: false, stringLimit: 16000 },
)
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()
const newKey = ref('')
const multiline = ref(
  typeof props.modelValue === 'string' &&
    (props.modelValue.length > 120 || props.modelValue.includes('\n')),
)
const attempted = ref(false)
const keyError = computed(() => {
  if (!newKey.value.trim()) return attempted.value ? '请输入字段名。' : ''
  if (['__proto__', 'constructor', 'prototype'].includes(newKey.value.trim()))
    return '此字段名为保留字段，请换一个名称。'
  if (Object.hasOwn(objectValue.value ?? {}, newKey.value.trim()))
    return '字段已存在，原值已保留。请编辑原字段或更换名称。'
  return ''
})
const stringError = computed(() =>
  typeof props.modelValue === 'string' && props.modelValue.length > props.stringLimit
    ? `最多 ${props.stringLimit} 字符，当前 ${props.modelValue.length}；内容已保留，请缩短。`
    : '',
)
const objectValue = computed(() =>
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, unknown>)
    : null,
)
const arrayValue = computed(() =>
  Array.isArray(props.modelValue) ? (props.modelValue as unknown[]) : null,
)
const valueType = computed(() =>
  props.modelValue === null
    ? 'null'
    : arrayValue.value
      ? 'array'
      : objectValue.value
        ? 'object'
        : typeof props.modelValue,
)
function changeType(type: string) {
  const initial: Record<string, unknown> = {
    string: '',
    number: 0,
    boolean: false,
    null: null,
    object: {},
    array: [],
  }
  if (type in initial) emit('update:modelValue', initial[type])
}
function setField(key: string, value: unknown) {
  if (['__proto__', 'constructor', 'prototype'].includes(key)) return
  emit('update:modelValue', { ...objectValue.value, [key]: value })
}
function removeField(key: string) {
  const next = { ...objectValue.value }
  delete next[key]
  emit('update:modelValue', next)
}
function addField() {
  attempted.value = true
  const key = newKey.value.trim()
  if (keyError.value) return
  setField(key, '')
  newKey.value = ''
  attempted.value = false
}
function setItem(index: number, value: unknown) {
  const next = [...(arrayValue.value ?? [])]
  next[index] = value
  emit('update:modelValue', next)
}
function removeItem(index: number) {
  emit(
    'update:modelValue',
    arrayValue.value?.filter((_, itemIndex) => itemIndex !== index),
  )
}
</script>

<template>
  <div class="structured-editor">
    <el-select
      :model-value="valueType"
      :disabled="disabled"
      aria-label="值类型"
      @change="changeType"
      ><el-option
        v-for="type in ['string', 'number', 'boolean', 'null', 'object', 'array']"
        :key="type"
        :value="type"
        :label="type"
    /></el-select>
    <template v-if="valueType === 'string'"
      ><el-input
        :model-value="String(modelValue)"
        :type="multiline ? 'textarea' : 'text'"
        :autosize="{ minRows: 2, maxRows: 8 }"
        :disabled="disabled"
        aria-label="文字值"
        :aria-invalid="!!stringError"
        @blur="multiline = String(modelValue).length > 120 || String(modelValue).includes('\n')"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <p v-if="stringError" class="field-error" role="alert">{{ stringError }}</p></template
    >
    <el-input-number
      v-else-if="valueType === 'number'"
      :model-value="Number(modelValue)"
      :disabled="disabled"
      aria-label="数值"
      @update:model-value="emit('update:modelValue', $event ?? 0)"
    />
    <el-switch
      v-else-if="valueType === 'boolean'"
      :model-value="Boolean(modelValue)"
      :disabled="disabled"
      aria-label="布尔值"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <template v-else-if="objectValue">
      <div v-for="(value, key) in objectValue" :key="key" class="nested-row">
        <span class="field-name" :title="String(key)">{{ key }}</span
        ><StructuredValueEditor
          :model-value="value"
          :depth="depth + 1"
          :disabled="disabled"
          :string-limit="stringLimit"
          @update:model-value="setField(key, $event)"
        /><el-button :disabled="disabled" text type="danger" @click="removeField(key)"
          >删除字段</el-button
        >
      </div>
      <div class="add-row">
        <el-input
          v-model="newKey"
          :disabled="disabled"
          placeholder="新增字段名"
          aria-label="新增字段名"
          :aria-invalid="!!keyError"
        /><el-button :disabled="disabled" @click="addField">添加字段</el-button>
      </div>
      <p v-if="keyError" class="field-error" role="alert">{{ keyError }}</p>
    </template>
    <template v-else-if="arrayValue">
      <div v-for="(value, index) in arrayValue" :key="index" class="nested-row">
        <span>{{ index + 1 }}</span
        ><StructuredValueEditor
          :model-value="value"
          :depth="depth + 1"
          :disabled="disabled"
          :string-limit="stringLimit"
          @update:model-value="setItem(index, $event)"
        /><el-button :disabled="disabled" text type="danger" @click="removeItem(index)"
          >删除项</el-button
        >
      </div>
      <el-button :disabled="disabled" @click="emit('update:modelValue', [...arrayValue, ''])"
        >添加数组项</el-button
      >
    </template>
  </div>
</template>

<style scoped>
.structured-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.structured-editor > :deep(.el-select) {
  width: 130px;
  max-width: 100%;
}
.nested-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  padding: 8px;
  border-left: 2px solid #dcdfe6;
  min-width: 0;
}
.field-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.nested-row .nested-row .nested-row {
  padding-inline: 0;
  border-left: 0;
}
.add-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.add-row :deep(.el-input) {
  flex: 1 1 140px;
  min-width: 0;
}
.field-error {
  margin: 0;
  color: #f56c6c;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.structured-editor :deep(.el-input-number) {
  max-width: 100%;
}
.structured-editor :deep(.el-textarea__inner) {
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>

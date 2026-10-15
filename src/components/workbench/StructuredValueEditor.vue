<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{ modelValue: unknown; depth?: number; disabled?: boolean }>(),
  { depth: 0, disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()
const newKey = ref('')
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
  const key = newKey.value.trim()
  if (
    !key ||
    ['__proto__', 'constructor', 'prototype'].includes(key) ||
    Object.hasOwn(objectValue.value ?? {}, key)
  )
    return
  setField(key, '')
  newKey.value = ''
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
    <el-input
      v-if="valueType === 'string'"
      :model-value="String(modelValue)"
      :disabled="disabled"
      aria-label="文字值"
      @update:model-value="emit('update:modelValue', $event)"
    />
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
        <span>{{ key }}</span
        ><StructuredValueEditor
          :model-value="value"
          :depth="depth + 1"
          :disabled="disabled"
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
        /><el-button :disabled="disabled" @click="addField">添加字段</el-button>
      </div>
    </template>
    <template v-else-if="arrayValue">
      <div v-for="(value, index) in arrayValue" :key="index" class="nested-row">
        <span>{{ index + 1 }}</span
        ><StructuredValueEditor
          :model-value="value"
          :depth="depth + 1"
          :disabled="disabled"
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
}
.structured-editor > :deep(.el-select) {
  width: 130px;
}
.nested-row {
  display: grid;
  grid-template-columns: minmax(40px, auto) minmax(100px, 1fr) auto;
  align-items: start;
  gap: 8px;
  padding: 8px;
  border-left: 2px solid #dcdfe6;
}
.add-row {
  display: flex;
  gap: 8px;
}
</style>

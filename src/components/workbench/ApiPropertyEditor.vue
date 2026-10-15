<script setup lang="ts">
import { computed } from 'vue'
import type { ApiProp, ApiValueKind } from '../../../shared/catalog/element-plus.ts'
import StructuredValueEditor from './StructuredValueEditor.vue'

const props = withDefaults(
  defineProps<{
    metadata: ApiProp
    modelValue: unknown
    valueKind: ApiValueKind
    referenceChoices?: { key: string; label: string }[]
    disabled?: boolean
  }>(),
  { referenceChoices: () => [], disabled: false },
)
const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  'update:valueKind': [kind: ApiValueKind]
}>()
const selectableKinds = computed(() =>
  props.metadata.valueKinds.includes('unknown')
    ? ([
        'string',
        'number',
        'boolean',
        'array',
        'object',
        'function',
        'component',
        'vnode',
        'date',
        'element',
        'regexp',
        'null',
      ] as ApiValueKind[])
    : props.metadata.valueKinds,
)
const referenceValue = computed(() =>
  typeof props.modelValue === 'string' ? props.modelValue : '',
)
const regexp = computed(() =>
  props.modelValue && typeof props.modelValue === 'object'
    ? (props.modelValue as Record<string, unknown>)
    : {},
)
function changeKind(kind: ApiValueKind) {
  emit('update:valueKind', kind)
  const defaults: Partial<Record<ApiValueKind, unknown>> = {
    string: '',
    number: 0,
    boolean: false,
    array: [],
    object: {},
    date: new Date().toISOString(),
    regexp: { pattern: '', flags: '' },
    null: null,
  }
  emit(
    'update:modelValue',
    Object.hasOwn(defaults, kind) ? defaults[kind] : (props.referenceChoices[0]?.key ?? ''),
  )
}
</script>

<template>
  <div class="api-property-editor">
    <div class="property-heading">
      <span>{{ metadata.name }}<b v-if="metadata.required"> *</b></span
      ><el-select
        :model-value="valueKind"
        :disabled="disabled"
        :aria-label="`${metadata.name} 属性类型`"
        @change="changeKind"
        ><el-option v-for="kind in selectableKinds" :key="kind" :value="kind" :label="kind"
      /></el-select>
    </div>
    <p class="type-description">
      {{ metadata.typeText
      }}<span v-if="metadata.defaultText"> · 默认：{{ metadata.defaultText }}</span>
    </p>
    <el-select
      v-if="metadata.enumValues.length && ['string', 'number', 'boolean'].includes(valueKind)"
      :model-value="modelValue"
      :disabled="disabled"
      filterable
      :allow-create="metadata.allowCustom"
      :aria-label="`${metadata.name} 属性值`"
      @update:model-value="emit('update:modelValue', $event)"
      ><el-option
        v-for="value in metadata.enumValues"
        :key="String(value)"
        :value="value"
        :label="String(value)"
    /></el-select>
    <el-switch
      v-else-if="valueKind === 'boolean'"
      :model-value="Boolean(modelValue)"
      :disabled="disabled"
      :aria-label="`${metadata.name} 属性值`"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <el-input-number
      v-else-if="valueKind === 'number'"
      :model-value="typeof modelValue === 'number' ? modelValue : 0"
      :disabled="disabled"
      :aria-label="`${metadata.name} 属性值`"
      @update:model-value="emit('update:modelValue', $event ?? 0)"
    />
    <el-input
      v-else-if="valueKind === 'string'"
      :model-value="typeof modelValue === 'string' ? modelValue : ''"
      :disabled="disabled"
      :aria-label="`${metadata.name} 属性值`"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <el-date-picker
      v-else-if="valueKind === 'date'"
      :model-value="typeof modelValue === 'string' ? modelValue : ''"
      type="datetime"
      value-format="YYYY-MM-DDTHH:mm:ssZ"
      :disabled="disabled"
      :aria-label="`${metadata.name} 日期值`"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <div v-else-if="valueKind === 'regexp'" class="regexp-editor">
      <el-input
        :model-value="String(regexp.pattern ?? '')"
        :disabled="disabled"
        placeholder="正则规则"
        aria-label="正则规则"
        @update:model-value="emit('update:modelValue', { ...regexp, pattern: $event })"
      /><el-input
        :model-value="String(regexp.flags ?? '')"
        :disabled="disabled"
        placeholder="flags"
        aria-label="正则标记"
        @update:model-value="emit('update:modelValue', { ...regexp, flags: $event })"
      />
    </div>
    <el-select
      v-else-if="['function', 'component', 'vnode', 'element'].includes(valueKind)"
      :model-value="referenceValue"
      :disabled="disabled"
      filterable
      :aria-label="`${metadata.name} 注册引用`"
      @update:model-value="emit('update:modelValue', $event)"
      ><el-option
        v-for="choice in referenceChoices"
        :key="choice.key"
        :value="choice.key"
        :label="choice.label"
    /></el-select>
    <StructuredValueEditor
      v-else-if="valueKind === 'array' || valueKind === 'object' || valueKind === 'unknown'"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <span v-else-if="valueKind === 'null'">null</span>
  </div>
</template>

<style scoped>
.api-property-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
}
.property-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.property-heading :deep(.el-select) {
  width: 140px;
}
.property-heading b {
  color: #f56c6c;
}
.type-description {
  font-size: 12px;
  color: #606266;
  margin: 0;
  overflow-wrap: anywhere;
}
.regexp-editor {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 100px;
  gap: 8px;
}
</style>

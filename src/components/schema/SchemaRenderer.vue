<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { getComponentSchemaError, isComponentSchema } from '../../../shared/contracts/component-config.ts'
import { componentRegistry, getRegisteredProps, runRegisteredAction } from './registry'

const props = defineProps<{ schema: unknown }>()
const inputId = `configured-input-${useId()}`
const schema = computed(() => isComponentSchema(props.schema) ? props.schema : null)
const configError = computed(() => getComponentSchemaError(props.schema))
const registration = computed(() => schema.value ? componentRegistry[schema.value.componentKey] : null)
const registeredProps = computed(() => schema.value ? getRegisteredProps(schema.value) : {})
const value = ref('')
const touched = ref(false)
const validationMessage = ref('')

watch(() => props.schema, () => { value.value = ''; touched.value = false; validationMessage.value = '' }, { deep: true })
function validateValue() {
    touched.value = true
    const current = schema.value
    if (!current || current.componentKey === 'button') return
    const rules = current.validation
    if (rules?.required && !value.value.trim()) validationMessage.value = '此字段为必填项'
    else if (value.value && rules?.minLength !== undefined && value.value.length < rules.minLength) validationMessage.value = `至少输入 ${rules.minLength} 个字符`
    else if (rules?.maxLength !== undefined && value.value.length > rules.maxLength) validationMessage.value = `最多输入 ${rules.maxLength} 个字符`
    else validationMessage.value = ''
}
function updateValue(input: string) { value.value = input; if (touched.value) validateValue() }
function clickButton() {
    const current = schema.value
    if (current?.componentKey !== 'button' || current.props.disabled) return
    const action = current.actions?.[0]
    if (action) runRegisteredAction(action)
}
</script>

<template>
    <section class="schema-renderer">
        <el-alert v-if="configError || !schema || !registration" :title="configError || '组件配置无法渲染'" type="error" :closable="false" role="alert" />
        <template v-else>
            <template v-if="schema.componentKey === 'button'">
                <p class="component-name">{{ schema.name }}</p>
                <component :is="registration.component" v-bind="registeredProps" @click="clickButton">{{ schema.props.text || '按钮' }}</component>
            </template>
            <template v-else>
                <label :for="inputId">{{ schema.name }}<span v-if="schema.validation?.required" class="required"> *</span></label>
                <component :is="registration.component" :id="inputId" :model-value="value" v-bind="registeredProps" :aria-invalid="Boolean(validationMessage)" @update:model-value="updateValue" @blur="validateValue" />
                <p v-if="schema.field" class="field-hint">字段：{{ schema.field }}</p>
                <el-alert v-if="validationMessage" :title="validationMessage" type="error" :closable="false" role="alert" />
            </template>
        </template>
    </section>
</template>

<style scoped>
.schema-renderer { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; width: 100%; }
.schema-renderer :deep(.el-input), .schema-renderer :deep(.el-textarea) { width: 100%; }
.component-name, .field-hint { margin: 0; }
.field-hint { color: #606266; font-size: 13px; }
.required { color: #f56c6c; }
</style>

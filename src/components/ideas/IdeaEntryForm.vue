<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { loadAll } from '@/api/ideas'
import type { IdeaSuggestion } from '@/types/idea'
import { getIdeaContentError, IDEA_CONTENT_MAX_LENGTH } from '../../../shared/contracts/idea.ts'

const props = withDefaults(defineProps<{
    modelValue: string
    submitting: boolean
    saved?: boolean
    errorMessage?: string
    inputId?: string
}>(), { saved: false, errorMessage: '' })
const emit = defineEmits<{
    'update:modelValue': [value: string]
    submit: [ideaContent: string]
}>()
const suggestions = loadAll()
const generatedInputId = `idea-input-${useId()}`
const inputId = computed(() => props.inputId ?? generatedInputId)
const validationMessage = ref('')
const feedback = computed(() => validationMessage.value || props.errorMessage)
function updateValue(value: string) {
    validationMessage.value = ''
    emit('update:modelValue', value)
}
function querySearch(queryString: string, callback: (results: IdeaSuggestion[]) => void) {
    const query = queryString.trim().toLowerCase()
    callback(query.length < 2 ? [] : suggestions.filter(item => item.ideaContent.toLowerCase().includes(query)))
}
function submit() {
    if (props.submitting) return
    const ideaContent = props.modelValue.trim()
    validationMessage.value = getIdeaContentError(ideaContent) ?? ''
    if (!validationMessage.value) emit('submit', ideaContent)
}
</script>

<template>
    <form class="idea-form" :aria-busy="submitting" @submit.prevent="submit">
        <label :for="inputId">想法内容</label>
        <el-autocomplete
            :id="inputId"
            :model-value="modelValue"
            :fetch-suggestions="querySearch"
            value-key="ideaContent"
            :trigger-on-focus="false"
            :maxlength="IDEA_CONTENT_MAX_LENGTH"
            :disabled="submitting"
            clearable
            placeholder="输入至少两个字，试试“我今天”"
            @update:model-value="updateValue"
        />
        <p class="hint">输入时会出现提前准备的提示词，也可以直接写自己的想法。</p>
        <el-alert v-if="feedback" :title="feedback" type="error" :closable="false" role="alert" />
        <el-button type="primary" native-type="submit" :loading="submitting" :disabled="submitting" @click.prevent="submit">提交</el-button>
        <p v-if="saved" role="status">想法已保存，<RouterLink to="/archive">去归档查看</RouterLink>。</p>
    </form>
</template>

<style scoped>
.idea-form { display: flex; flex-direction: column; gap: 16px; }
.hint { margin: 0; color: #606266; font-size: 14px; line-height: 1.6; }
</style>

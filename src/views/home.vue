<script lang="ts" setup>
import { ref } from 'vue'
import { ElNotification } from 'element-plus'
import { createIdea, loadAll } from '@/api/ideas'
import type { IdeaDraft, IdeaSuggestion } from '@/types/idea'
import { getIdeaContentError, IDEA_CONTENT_MAX_LENGTH } from '../../shared/contracts/idea.ts'

const suggestions = loadAll()
const draft = ref<IdeaDraft>({ ideaContent: '' })
const submitting = ref(false)
const saved = ref(false)

const querySearch = (queryString: string, callback: (results: IdeaSuggestion[]) => void) => {
    const query = queryString.trim().toLowerCase()
    callback(query.length < 2 ? [] : suggestions.filter(item => item.ideaContent.toLowerCase().includes(query)))
}

const handleSubmit = async () => {
    if (submitting.value) return
    const ideaContent = draft.value.ideaContent.trim()
    const message = getIdeaContentError(ideaContent)
    if (message) {
        ElNotification({ title: '请检查输入', message, type: 'warning' })
        return
    }

    submitting.value = true
    saved.value = false
    try {
        await createIdea({ ideaContent })
        draft.value = { ideaContent: '' }
        saved.value = true
        ElNotification({ title: '保存成功', message: '可以在归档中查看这条想法', type: 'success' })
    } catch (error) {
        ElNotification({
            title: '保存失败',
            message: error instanceof Error ? error.message : '提交想法时出错，请稍后重试',
            type: 'error',
        })
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <section class="idea-area">
        <h1>记录一个想法</h1>
        <label for="idea-input">想法内容</label>
        <el-autocomplete
            id="idea-input"
            v-model="draft.ideaContent"
            :fetch-suggestions="querySearch"
            value-key="ideaContent"
            :trigger-on-focus="false"
            :maxlength="IDEA_CONTENT_MAX_LENGTH"
            :disabled="submitting"
            clearable
            placeholder="输入至少两个字，试试“我今天”"
        />
        <p class="hint">输入时会出现提前准备的提示词，也可以直接写自己的想法。</p>
        <el-button type="primary" :loading="submitting" :disabled="submitting" @click="handleSubmit">
            提交
        </el-button>
        <p v-if="saved" role="status">想法已保存，<RouterLink to="/archive">去归档查看</RouterLink>。</p>
    </section>
</template>

<style scoped>
.idea-area {
    width: min(100%, 520px);
    margin: 24px auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.idea-area h1 { margin: 0 0 8px; }
.hint { margin: 0; color: #606266; font-size: 14px; line-height: 1.6; }
</style>

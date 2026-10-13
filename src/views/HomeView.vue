<script lang="ts" setup>
import { ref } from 'vue'
import { ElNotification } from 'element-plus'
import { createIdea } from '@/api/ideas'
import IdeaEntryForm from '@/components/ideas/IdeaEntryForm.vue'
import { authState } from '@/stores/auth'
import { ideaDraft, clearIdeaDraft } from '@/stores/ideaDraft'

if (ideaDraft.ownerId && ideaDraft.ownerId !== authState.user?.userId) clearIdeaDraft()
ideaDraft.ownerId = authState.user?.userId ?? ''
const draft = ideaDraft
const submitting = ref(false)
const saved = ref(false)
const errorMessage = ref('')

function updateDraft(value: string) {
    draft.ideaContent = value
    saved.value = false
    errorMessage.value = ''
}

const handleSubmit = async (ideaContent: string) => {
    if (submitting.value) return
    const submittedOwnerId = authState.user?.userId
    const submittedDraft = draft.ideaContent

    submitting.value = true
    saved.value = false
    errorMessage.value = ''
    try {
        await createIdea({ ideaContent })
        // 请求返回前可能已换账号或写入新草稿，旧响应只结束自己的提交。
        if (!submittedOwnerId || authState.user?.userId !== submittedOwnerId || draft.ownerId !== submittedOwnerId || draft.ideaContent !== submittedDraft) return
        draft.ideaContent = ''
        saved.value = true
        ElNotification({ title: '保存成功', message: '可以在归档中查看这条想法', type: 'success' })
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '提交想法时出错，请稍后重试'
        ElNotification({
            title: '保存失败',
            message: errorMessage.value,
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
        <IdeaEntryForm
            input-id="idea-input"
            :model-value="draft.ideaContent"
            :submitting="submitting"
            :saved="saved"
            :error-message="errorMessage"
            @update:model-value="updateDraft"
            @submit="handleSubmit"
        />
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
</style>

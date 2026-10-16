<script lang="ts" setup>
import { reactive, ref, watch } from 'vue'
import { ElMessageBox, ElNotification } from 'element-plus'
import { createIdea } from '@/api/ideas'
import IdeaEntryForm from '@/components/ideas/IdeaEntryForm.vue'
import { authState } from '@/stores/auth'
import {
  ideaDraft,
  activateIdeaDraft,
  discardIdeaDraft,
  persistIdeaDraft,
} from '@/stores/ideaDraft'
import { getSessionGeneration } from '@/api/http'

const props = defineProps<{ inputId?: string; draftKey?: string }>()

if (!props.draftKey && authState.user) activateIdeaDraft(authState.user.userId)
// 页面原表单保留已有草稿，配置中的业务节点拥有独立输入与提交锁。
const draft = props.draftKey
  ? reactive({ ideaContent: '', ownerId: authState.user?.userId ?? '' })
  : ideaDraft
const submitting = ref(false)
const saved = ref(false)
const errorMessage = ref('')
const localRevision = ref(0)
watch(
  () => draft.ideaContent,
  () => {
    localRevision.value += 1
  },
  { flush: 'sync' },
)
watch(
  () => authState.user?.userId,
  (ownerId) => {
    if (props.draftKey) {
      if (ownerId && draft.ownerId !== ownerId) draft.ideaContent = ''
      if (ownerId) draft.ownerId = ownerId
    } else if (ownerId) activateIdeaDraft(ownerId)
    saved.value = false
    errorMessage.value = ''
  },
)

async function discard() {
  const ownerId = authState.user?.userId
  const revision = ideaDraft.revision
  try {
    await ElMessageBox.confirm('丢弃这条尚未提交的想法？此操作无法撤销。', '丢弃 Idea 草稿', {
      confirmButtonText: '丢弃草稿',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
    if (authState.user?.userId !== ownerId || ideaDraft.revision !== revision) return
    discardIdeaDraft()
    saved.value = false
    errorMessage.value = ''
  } catch {
    /* 取消时保留输入。 */
  }
}

function updateDraft(value: string) {
  draft.ideaContent = value
  saved.value = false
  errorMessage.value = ''
}

const handleSubmit = async (ideaContent: string) => {
  if (submitting.value) return
  const submittedOwnerId = authState.user?.userId
  const submittedDraft = draft.ideaContent
  const submittedRevision = props.draftKey ? localRevision.value : ideaDraft.revision
  const generation = getSessionGeneration()

  submitting.value = true
  saved.value = false
  errorMessage.value = ''
  try {
    await createIdea({ ideaContent })
    // 请求返回前可能已换账号或写入新草稿，旧响应只结束自己的提交。
    if (
      generation !== getSessionGeneration() ||
      !submittedOwnerId ||
      authState.user?.userId !== submittedOwnerId ||
      draft.ownerId !== submittedOwnerId ||
      draft.ideaContent !== submittedDraft ||
      (props.draftKey ? localRevision.value : ideaDraft.revision) !== submittedRevision
    )
      return
    if (props.draftKey) draft.ideaContent = ''
    else discardIdeaDraft()
    saved.value = true
    ElNotification({ title: '保存成功', message: '可以在归档中查看这条想法', type: 'success' })
  } catch (error) {
    if (generation !== getSessionGeneration() || authState.user?.userId !== submittedOwnerId) return
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
    <div v-if="!props.draftKey" class="draft-status" aria-live="polite">
      <p v-if="ideaDraft.persistenceState === 'saved'" role="status">
        {{
          ideaDraft.restored
            ? '已恢复本标签的 Idea 未提交草稿'
            : 'Idea 未提交草稿已暂存于本标签，刷新可恢复'
        }}
      </p>
      <p v-else-if="ideaDraft.persistenceState === 'memory-only'" role="status">
        Idea 未提交草稿仅保留在当前页面，请登录后提交。
      </p>
      <el-alert
        v-if="ideaDraft.persistenceError"
        :title="ideaDraft.persistenceError"
        type="warning"
        :closable="false"
        role="alert"
      />
      <div
        v-if="draft.ideaContent || ideaDraft.persistenceState === 'failed'"
        class="draft-actions"
      >
        <el-button
          v-if="ideaDraft.persistenceState === 'failed'"
          size="small"
          @click="persistIdeaDraft"
          >重试本标签暂存</el-button
        >
        <el-button size="small" :disabled="submitting" @click="discard">丢弃 Idea 草稿</el-button>
      </div>
    </div>
    <IdeaEntryForm
      :input-id="props.inputId"
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
  min-width: 0;
  margin: 24px auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.idea-area h1 {
  margin: 0 0 8px;
}
.draft-status {
  min-width: 0;
  overflow-wrap: anywhere;
}
.draft-status p {
  margin: 0;
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
}
.draft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.draft-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>

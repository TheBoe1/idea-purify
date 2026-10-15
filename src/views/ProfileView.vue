<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { authState, updateCurrentProfile } from '@/stores/auth'
import { getNicknameError } from '../../shared/contracts/auth.ts'

const nickname = ref('')
const pending = ref(false)
const feedback = ref('')
const failed = ref(false)
const username = computed(() => authState.user?.username ?? '')
watch(
  () => [
    authState.user?.userId,
    authState.user && 'nickname' in authState.user ? authState.user.nickname : undefined,
  ],
  () => {
    const user = authState.user
    nickname.value =
      user && 'nickname' in user && typeof user.nickname === 'string' ? user.nickname : ''
    feedback.value = ''
  },
  { immediate: true },
)
async function save() {
  if (pending.value || !authState.user) return
  pending.value = true
  feedback.value = ''
  failed.value = false
  const submittedNickname = nickname.value
  const validationMessage = getNicknameError(submittedNickname)
  if (validationMessage) {
    failed.value = true
    feedback.value = validationMessage
    pending.value = false
    return
  }
  try {
    const updated = await updateCurrentProfile(submittedNickname)
    if (updated) feedback.value = '昵称已保存，登录用户名保持不变。'
  } catch (error) {
    failed.value = true
    feedback.value = error instanceof Error ? error.message : '保存昵称失败'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="profile-page">
    <h1>个人资料</h1>
    <el-form label-position="top" :aria-busy="pending" @submit.prevent="save">
      <el-form-item label="登录用户名"
        ><el-input :model-value="username" readonly aria-label="登录用户名"
      /></el-form-item>
      <el-form-item label="昵称"
        ><el-input
          v-model="nickname"
          :disabled="pending"
          maxlength="80"
          clearable
          placeholder="请输入 1–40 个字符"
          aria-label="昵称"
      /></el-form-item>
      <p class="hint">昵称用于页面显示，不会改变你的登录用户名或想法归属。</p>
      <el-alert
        v-if="feedback"
        :title="feedback"
        :type="failed ? 'error' : 'success'"
        :closable="false"
        role="status"
      />
      <el-button type="primary" :loading="pending" :disabled="pending" @click="save"
        >保存昵称</el-button
      >
    </el-form>
  </section>
</template>

<style scoped>
.profile-page {
  max-width: 520px;
  margin: 24px auto;
}
.hint {
  color: #606266;
  line-height: 1.6;
}
.profile-page :deep(.el-alert) {
  margin: 16px 0;
}
</style>

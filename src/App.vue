<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElNotification } from 'element-plus'
import AppMenu from './components/AppMenu.vue'
import AuthDialog from './components/AuthDialog.vue'
import { authState, acceptSession, initializeSession, revalidateSession } from './stores/auth'
import * as auth from './api/auth'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const errorMessage = ref('')
const resetToken = computed(() => route.path === '/reset-password' && typeof route.query.token === 'string' ? route.query.token : undefined)
const authVisible = computed(() => authState.dialogVisible || Boolean(resetToken.value))
let sessionTimer: ReturnType<typeof setInterval> | undefined

async function runAuth(action: () => Promise<void>) {
    if (loading.value) return
    loading.value = true
    errorMessage.value = ''
    try { await action() }
    catch (error) { errorMessage.value = error instanceof Error ? error.message : '操作失败，请重试' }
    finally { loading.value = false }
}
const handleLogin = (credentials: { username: string; password: string }) => runAuth(async () => {
    acceptSession(await auth.login(credentials))
    if (route.path === '/reset-password' || route.path === '/verify-email') await router.replace('/')
})
const handleRegister = (credentials: { username: string; password: string; email?: string }) => runAuth(async () => {
    const result = await auth.register(credentials)
    acceptSession(result.user)
    if (result.emailDelivery !== 'none') ElNotification({
        title: result.emailDelivery === 'sent' ? '注册成功' : '账号已创建',
        message: result.emailDelivery === 'sent' ? '验证邮件已发送，请在邮箱中确认。' : '验证邮件发送失败，可以点击右上角“重发验证邮件”重试。',
        type: result.emailDelivery === 'sent' ? 'success' : 'warning',
    })
})
const handleRecover = (email: string) => runAuth(async () => { authState.notice = await auth.forgotPassword(email) })
const handleReset = (credentials: { token: string; password: string }) => runAuth(async () => {
    authState.notice = await auth.resetPassword(credentials)
    authState.user = null
    authState.dialogVisible = true
    await router.replace('/')
})

onMounted(async () => {
    await initializeSession()
    if ((route.path === '/reset-password' || route.path === '/verify-email') && (typeof route.query.token !== 'string' || !route.query.token)) {
        authState.notice = '链接缺少有效凭据，请重新申请邮件链接。'
        authState.dialogVisible = true
    }
    if (route.path === '/verify-email' && typeof route.query.token === 'string') await runAuth(async () => {
        authState.notice = await auth.verifyEmail(route.query.token as string)
        ElNotification({ title: '邮箱验证', message: authState.notice, type: 'success' })
        await initializeSession()
        await router.replace('/')
    })
    window.addEventListener('focus', revalidateSession)
    sessionTimer = setInterval(() => { if (document.visibilityState === 'visible') void revalidateSession() }, 60_000)
})
onUnmounted(() => {
    window.removeEventListener('focus', revalidateSession)
    if (sessionTimer) clearInterval(sessionTimer)
})
</script>

<template>
    <el-container class="app-layout">
        <el-header><AppMenu /></el-header>
        <el-main>
            <p v-if="!authState.ready" role="status">正在确认登录状态…</p>
            <RouterView v-else-if="authState.user" :key="authState.user.userId" />
            <p v-else class="login-hint">登录或注册后，记录并查看自己的想法。</p>
            <el-alert v-if="authState.user && authState.sessionError" :title="authState.sessionError" type="warning" :closable="false" />
            <el-alert v-if="errorMessage && route.path === '/verify-email'" :title="errorMessage" type="error" :closable="false" />
        </el-main>
        <AuthDialog :model-value="authVisible" :loading="loading" :error-message="errorMessage || authState.sessionError" :notice="authState.notice" :reset-token="resetToken" @login="handleLogin" @register="handleRegister" @recover="handleRecover" @reset="handleReset" @mode-change="errorMessage = ''; authState.sessionError = ''" @cancel-reset="router.replace('/')" />
    </el-container>
</template>

<style scoped>
.app-layout { min-height: 100vh; }
.app-layout :deep(.el-header) { padding: 0; }
.login-hint { max-width: 720px; margin: 32px auto; color: #606266; }
</style>

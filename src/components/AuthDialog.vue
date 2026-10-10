<script setup lang="ts">
import { ref, watch } from 'vue'
import { getEmailError, getPasswordError, getUsernameError } from '../../shared/contracts/auth.ts'

type AuthMode = 'login' | 'register' | 'recover' | 'reset'
const props = defineProps<{
    modelValue: boolean
    loading: boolean
    errorMessage: string
    notice: string
    resetToken?: string
}>()
const emit = defineEmits<{
    'update:modelValue': [value: boolean]
    login: [credentials: { username: string; password: string }]
    register: [credentials: { username: string; password: string; email?: string }]
    recover: [email: string]
    reset: [credentials: { token: string; password: string }]
    'mode-change': []
    'cancel-reset': []
}>()

const mode = ref<AuthMode>(props.resetToken ? 'reset' : 'login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const email = ref('')
const validationMessage = ref('')

watch(() => props.resetToken, token => {
    if (token) mode.value = 'reset'
    else if (mode.value === 'reset') mode.value = 'login'
})
watch(mode, () => {
    password.value = ''
    confirmPassword.value = ''
    validationMessage.value = ''
    emit('mode-change')
})
watch(() => props.modelValue, value => {
    if (!value) {
        password.value = ''
        confirmPassword.value = ''
        if (mode.value !== 'reset') mode.value = 'login'
    }
})

function submit() {
    if (props.loading) return
    validationMessage.value = ''
    if ((mode.value === 'login' || mode.value === 'register') && !username.value.trim()) {
        validationMessage.value = '请输入用户名'
        return
    }
    if (mode.value === 'recover') {
        if (!email.value.trim()) { validationMessage.value = '请输入注册时设置的邮箱'; return }
        const message = getEmailError(email.value.trim())
        if (message) { validationMessage.value = message; return }
        emit('recover', email.value.trim())
        return
    }
    if (!password.value) {
        validationMessage.value = '请输入密码'
        return
    }
    if ((mode.value === 'register' || mode.value === 'reset') && password.value !== confirmPassword.value) {
        validationMessage.value = '两次输入的密码不一致'
        return
    }
    if (mode.value === 'register' || mode.value === 'reset') {
        const message = getPasswordError(password.value) || (mode.value === 'register' ? getUsernameError(username.value.trim()) : undefined)
            || (mode.value === 'register' && email.value.trim() ? getEmailError(email.value.trim()) : undefined)
        if (message) { validationMessage.value = message; return }
    }
    if (mode.value === 'login') emit('login', { username: username.value.trim(), password: password.value })
    else if (mode.value === 'register') {
        emit('register', {
            username: username.value.trim(),
            password: password.value,
            ...(email.value.trim() ? { email: email.value.trim() } : {}),
        })
    } else if (props.resetToken) emit('reset', { token: props.resetToken, password: password.value })
}

const titles: Record<AuthMode, string> = { login: '登录', register: '注册', recover: '找回密码', reset: '设置新密码' }
</script>

<template>
    <el-dialog
        :model-value="modelValue"
        :title="titles[mode]"
        width="min(440px, 92vw)"
        :close-on-click-modal="false"
        :close-on-press-escape="false"
        :show-close="false"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <p v-if="notice" class="auth-notice" role="status">{{ notice }}</p>
        <el-alert v-if="errorMessage || validationMessage" :title="validationMessage || errorMessage" type="error" show-icon :closable="false" />
        <form class="auth-form" @submit.prevent="submit">
            <template v-if="mode === 'login' || mode === 'register'">
                <label for="auth-username">用户名</label>
                <el-input id="auth-username" v-model="username" :disabled="loading" :maxlength="32" autocomplete="username" />
                <p v-if="mode === 'register'" class="form-hint">用户名为 3–32 位，以字母开头，仅含字母、数字、下划线。</p>
            </template>
            <template v-if="mode === 'register' || mode === 'recover'">
                <label for="auth-email">{{ mode === 'register' ? '邮箱（选填）' : '账号邮箱' }}</label>
                <el-input id="auth-email" v-model="email" type="email" :disabled="loading" :maxlength="254" autocomplete="email" />
                <p v-if="mode === 'register'" class="form-hint">填写并验证邮箱后才能通过邮件重设密码，请确认邮箱可用。</p>
            </template>
            <template v-if="mode !== 'recover'">
                <label for="auth-password">{{ mode === 'reset' ? '新密码' : '密码' }}</label>
                <el-input id="auth-password" v-model="password" type="password" show-password :disabled="loading" :maxlength="128" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" />
                <template v-if="mode === 'register' || mode === 'reset'">
                    <p class="form-hint">密码长度为 12–128 个字符，可以使用密码短语。</p>
                    <label for="auth-password-confirm">确认密码</label>
                    <el-input id="auth-password-confirm" v-model="confirmPassword" type="password" :disabled="loading" :maxlength="128" autocomplete="new-password" />
                </template>
            </template>
            <p v-else class="form-hint">如果邮箱对应可恢复的账号，会收到重设密码的链接。</p>
            <el-button type="primary" native-type="submit" :loading="loading" :disabled="loading">{{ titles[mode] }}</el-button>
        </form>
        <div v-if="mode !== 'reset'" class="auth-links">
            <el-button v-if="mode !== 'login'" link :disabled="loading" @click="mode = 'login'">已有账号，去登录</el-button>
            <el-button v-if="mode !== 'register'" link :disabled="loading" @click="mode = 'register'">没有账号，去注册</el-button>
            <el-button v-if="mode === 'login'" link :disabled="loading" @click="mode = 'recover'">忘记密码</el-button>
        </div>
        <el-button v-else link :disabled="loading" class="auth-links" @click="emit('cancel-reset')">返回登录</el-button>
    </el-dialog>
</template>

<style scoped>
.auth-form { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }
.auth-form label { color: #303133; }
.auth-links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 20px; }
.auth-notice, .form-hint { font-size: 14px; line-height: 1.6; color: #606266; margin: 0; }
.auth-notice { margin-bottom: 16px; }
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElNotification } from 'element-plus'
import { authState } from '@/stores/auth'
import { logout, resendVerification } from '@/api/auth'
import { clearIdeaDraft } from '@/stores/ideaDraft'
import { getMenuRoutes } from '@/router/routes'

const route = useRoute()
const menuRoutes = computed(() => getMenuRoutes(authState.user?.role))
const pending = ref(false)
async function signOut() {
    if (pending.value) return
    pending.value = true
    try {
        await logout()
        authState.user = null
        authState.dialogVisible = true
        authState.notice = '已退出登录。'
        clearIdeaDraft()
    } catch (error) { ElNotification({ title: '退出失败', message: error instanceof Error ? error.message : '请重试', type: 'error' }) }
    finally { pending.value = false }
}
async function resend() {
    if (pending.value) return
    pending.value = true
    try { ElNotification({ title: '验证邮箱', message: await resendVerification(), type: 'success' }) }
    catch (error) { ElNotification({ title: '发送失败', message: error instanceof Error ? error.message : '请重试', type: 'error' }) }
    finally { pending.value = false }
}
</script>

<template>
    <nav class="menu-bar" aria-label="主导航">
        <div class="menu-links">
            <RouterLink v-for="item in menuRoutes" :key="item.path" :to="item.path" :class="{ 'menu-active': route.path === item.path || route.meta.activeMenu === item.path }">{{ item.meta?.title }}</RouterLink>
        </div>
        <div v-if="authState.user" class="account-links">
            <span>{{ authState.user.username }}</span>
            <el-button v-if="authState.user.email && !authState.user.emailVerified" link :disabled="pending" @click="resend">重发验证邮件</el-button>
            <el-button link :disabled="pending" @click="signOut">退出登录</el-button>
        </div>
    </nav>
</template>

<style scoped>
.menu-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; min-height: 60px; background: #f5f5f5; padding: 8px 24px; box-sizing: border-box; }
.menu-links, .account-links { display: flex; align-items: center; flex-wrap: wrap; gap: 24px; }
.menu-links a { text-decoration: none; color: #333; font-size: 18px; }
.menu-links a.menu-active { color: #409eff; }
.account-links { gap: 16px; font-size: 14px; }
</style>

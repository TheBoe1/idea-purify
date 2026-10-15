<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useRouter } from 'vue-router'
import { ArrowDown } from '@element-plus/icons-vue'
import { ElNotification } from 'element-plus'
import { authState } from '@/stores/auth'
import { logout, resendVerification } from '@/api/auth'
import { clearIdeaDraft } from '@/stores/ideaDraft'
import { getMenuRoutes } from '@/router/routes'
import { getSessionGeneration } from '@/api/http'

const route = useRoute()
const router = useRouter()
const menuRoutes = computed(() => getMenuRoutes(authState.user?.role))
const inAdmin = computed(() => route.path.startsWith('/admin'))
const accountName = computed(() => {
  const user = authState.user
  return user && 'nickname' in user && typeof user.nickname === 'string' && user.nickname
    ? user.nickname
    : user?.username
})
const pending = ref(false)
async function signOut() {
  if (pending.value) return
  pending.value = true
  const generation = getSessionGeneration()
  try {
    await logout()
    if (generation !== getSessionGeneration()) return
    authState.user = null
    authState.dialogVisible = true
    authState.notice = '已退出登录。'
    clearIdeaDraft()
  } catch (error) {
    ElNotification({
      title: '退出失败',
      message: error instanceof Error ? error.message : '请重试',
      type: 'error',
    })
  } finally {
    pending.value = false
  }
}
function command(action: string) {
  if (action === 'logout') void signOut()
  if (action === 'profile') void router.push('/profile')
  if (action === 'admin' && authState.user?.role === 'admin') void router.push('/admin')
}
async function resend() {
  if (pending.value) return
  pending.value = true
  try {
    ElNotification({ title: '验证邮箱', message: await resendVerification(), type: 'success' })
  } catch (error) {
    ElNotification({
      title: '发送失败',
      message: error instanceof Error ? error.message : '请重试',
      type: 'error',
    })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <nav class="menu-bar" aria-label="主导航">
    <div class="menu-links">
      <RouterLink v-if="inAdmin" to="/">返回业务区</RouterLink>
      <template v-else
        ><RouterLink
          v-for="item in menuRoutes"
          :key="item.path"
          :to="item.path"
          :class="{
            'menu-active': route.path === item.path || route.meta.activeMenu === item.path,
          }"
          >{{ item.meta?.title }}</RouterLink
        ></template
      >
    </div>
    <div v-if="authState.user" class="account-links">
      <el-button
        v-if="authState.user.email && !authState.user.emailVerified"
        link
        :disabled="pending"
        @click="resend"
        >重发验证邮件</el-button
      >
      <el-dropdown trigger="click" @command="command">
        <el-button text :disabled="pending" aria-label="账号菜单"
          >{{ accountName }}<el-icon class="account-arrow"><ArrowDown /></el-icon
        ></el-button>
        <template #dropdown
          ><el-dropdown-menu>
            <el-dropdown-item command="profile">个人资料</el-dropdown-item>
            <el-dropdown-item v-if="authState.user.role === 'admin'" command="admin"
              >管理区域</el-dropdown-item
            >
            <el-dropdown-item command="logout" divided :disabled="pending"
              >退出登录</el-dropdown-item
            >
          </el-dropdown-menu></template
        >
      </el-dropdown>
    </div>
  </nav>
</template>

<style scoped>
.menu-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  min-height: 60px;
  background: #f5f5f5;
  padding: 8px 24px;
  box-sizing: border-box;
}
.menu-links,
.account-links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 24px;
}
.menu-links a {
  text-decoration: none;
  color: #333;
  font-size: 18px;
}
.menu-links a.menu-active {
  color: #409eff;
}
.account-links {
  gap: 16px;
  font-size: 14px;
}
.account-arrow {
  margin-left: 8px;
}
</style>

import { createRouter, createWebHistory } from 'vue-router'
import { ElNotification } from 'element-plus'
import { appRoutes } from './routes'
import { authState, initializeSession } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: appRoutes,
})

router.beforeEach(async to => {
  const roles = to.meta.roles
  if (!roles) return true
  // 直接打开管理端时先确认会话，避免把尚未初始化的管理员当成普通用户。
  if (!authState.ready) await initializeSession()
  if (!authState.user) {
    authState.dialogVisible = true
    authState.notice = '请先登录管理员账号后访问管理页面。'
    return { path: '/', replace: true }
  }
  if (!roles.includes(authState.user.role)) {
    ElNotification({ title: '无权访问', message: '此页面仅管理员可以访问，已返回首页。', type: 'warning' })
    return { path: '/', replace: true }
  }
  return true
})

export default router

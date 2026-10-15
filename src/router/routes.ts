import type { RouteRecordRaw } from 'vue-router'
import type { AuthUser } from '../../shared/contracts/auth.ts'
import ArchiveView from '@/views/ArchiveView.vue'
import HomeView from '@/views/HomeView.vue'
import IdeasView from '@/views/IdeasView.vue'
import IdeaDetailView from '@/views/IdeaDetailView.vue'
import AdminView from '@/views/AdminView.vue'
import ComponentConfigView from '@/views/ComponentConfigView.vue'
import ComponentsView from '@/views/ComponentsView.vue'
import AdminLayout from '@/views/AdminLayout.vue'
import ProfileView from '@/views/ProfileView.vue'
import DynamicPageView from '@/views/DynamicPageView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    menu?: boolean
    order?: number
    roles?: AuthUser['role'][]
    activeMenu?: string
    adminMenu?: boolean
  }
}

// 页面模块只能在代码中注册。配置数据不能决定 import 路径。
export const appRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '首页', menu: true, order: 0 } },
  {
    path: '/archive',
    name: 'archive',
    component: ArchiveView,
    meta: { title: '归档', menu: true, order: 1 },
  },
  {
    path: '/ideas',
    name: 'ideas',
    component: IdeasView,
    meta: { title: '想法', menu: true, order: 2 },
  },
  {
    path: '/ideas/:ideaId',
    name: 'idea-detail',
    component: IdeaDetailView,
    meta: { title: '想法详情', activeMenu: '/ideas' },
  },
  { path: '/profile', name: 'profile', component: ProfileView, meta: { title: '个人资料' } },
  {
    path: '/pages/:pageKey',
    name: 'dynamic-page',
    component: DynamicPageView,
    meta: { title: '配置页面' },
  },
  {
    path: '/admin',
    component: AdminLayout,
    redirect: '/admin/users',
    meta: { title: '管理区域', roles: ['admin'] },
    children: [
      {
        path: 'users',
        name: 'admin',
        component: AdminView,
        meta: { title: '用户管理', adminMenu: true, order: 0, roles: ['admin'] },
      },
      {
        path: 'catalog',
        name: 'component-catalog',
        component: ComponentsView,
        meta: { title: '组件目录', adminMenu: true, order: 1, roles: ['admin'] },
      },
      {
        path: 'workbench',
        name: 'component-config',
        component: ComponentConfigView,
        meta: { title: '方案工作台', adminMenu: true, order: 2, roles: ['admin'] },
      },
    ],
  },
  { path: '/components', redirect: '/admin/catalog', meta: { roles: ['admin'] } },
  { path: '/admin/components', redirect: '/admin/workbench', meta: { roles: ['admin'] } },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: HomeView,
    meta: { title: '重设密码' },
  },
  { path: '/verify-email', name: 'verify-email', component: HomeView, meta: { title: '验证邮箱' } },
]

export function getMenuRoutes(role?: AuthUser['role']): RouteRecordRaw[] {
  return appRoutes
    .filter(
      (route) =>
        route.meta?.menu && (!route.meta.roles || Boolean(role && route.meta.roles.includes(role))),
    )
    .sort((left, right) => (left.meta?.order ?? 0) - (right.meta?.order ?? 0))
}

export function getAdminMenuRoutes(): RouteRecordRaw[] {
  return (
    appRoutes
      .find((route) => route.path === '/admin')
      ?.children?.filter((route) => route.meta?.adminMenu)
      .sort((left, right) => (left.meta?.order ?? 0) - (right.meta?.order ?? 0)) ?? []
  )
}

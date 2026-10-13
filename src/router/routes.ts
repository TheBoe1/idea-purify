import type { RouteRecordRaw } from 'vue-router'
import type { AuthUser } from '../../shared/contracts/auth.ts'
import ArchiveView from '@/views/ArchiveView.vue'
import HomeView from '@/views/HomeView.vue'
import IdeasView from '@/views/IdeasView.vue'
import IdeaDetailView from '@/views/IdeaDetailView.vue'
import AdminView from '@/views/AdminView.vue'
import ComponentConfigView from '@/views/ComponentConfigView.vue'
import ComponentsView from '@/views/ComponentsView.vue'

declare module 'vue-router' {
    interface RouteMeta {
        title?: string
        menu?: boolean
        order?: number
        roles?: AuthUser['role'][]
        activeMenu?: string
    }
}

// 页面模块只能在代码中注册。配置数据不能决定 import 路径。
export const appRoutes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: HomeView, meta: { title: '首页', menu: true, order: 0 } },
    { path: '/archive', name: 'archive', component: ArchiveView, meta: { title: '归档', menu: true, order: 1 } },
    { path: '/ideas', name: 'ideas', component: IdeasView, meta: { title: '想法', menu: true, order: 2 } },
    { path: '/ideas/:ideaId', name: 'idea-detail', component: IdeaDetailView, meta: { title: '想法详情', activeMenu: '/ideas' } },
    { path: '/components', name: 'components', component: ComponentsView, meta: { title: '组件展示', menu: true, order: 3 } },
    { path: '/admin', name: 'admin', component: AdminView, meta: { title: '用户管理', menu: true, order: 4, roles: ['admin'] } },
    { path: '/admin/components', name: 'component-config', component: ComponentConfigView, meta: { title: '组件配置', menu: true, order: 5, roles: ['admin'] } },
    { path: '/reset-password', name: 'reset-password', component: HomeView, meta: { title: '重设密码' } },
    { path: '/verify-email', name: 'verify-email', component: HomeView, meta: { title: '验证邮箱' } },
]

export function getMenuRoutes(role?: AuthUser['role']): RouteRecordRaw[] {
    return appRoutes.filter(route => route.meta?.menu && (!route.meta.roles || Boolean(role && route.meta.roles.includes(role))))
        .sort((left, right) => (left.meta?.order ?? 0) - (right.meta?.order ?? 0))
}

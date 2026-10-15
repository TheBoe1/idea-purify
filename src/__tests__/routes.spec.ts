import { afterEach, describe, expect, it } from 'vitest'
import { appRoutes, getAdminMenuRoutes, getMenuRoutes } from '../router/routes'
import router from '../router'
import { authState } from '../stores/auth'

afterEach(async () => {
  await router.replace('/')
})

describe('固定页面注册与路由元数据', () => {
  it('普通菜单与管理员菜单来自同一注册表，详情使用列表激活项', () => {
    expect(getMenuRoutes('user').map((route) => route.path)).toEqual(['/', '/archive', '/ideas'])
    expect(getMenuRoutes('admin').map((route) => route.path)).toEqual(['/', '/archive', '/ideas'])
    expect(getAdminMenuRoutes().map((route) => route.path)).toEqual([
      'users',
      'catalog',
      'workbench',
    ])
    expect(appRoutes.find((route) => route.name === 'idea-detail')?.meta?.activeMenu).toBe('/ideas')
    expect(
      appRoutes.every(
        (route) => typeof route.component === 'object' || typeof route.redirect === 'string',
      ),
    ).toBe(true)
    expect(
      appRoutes
        .find((route) => route.path === '/admin')
        ?.children?.every(
          (route) => typeof route.component === 'object' && route.meta?.roles?.includes('admin'),
        ),
    ).toBe(true)
    expect(appRoutes.some((route) => route.path.includes(':componentPath'))).toBe(false)
  })

  it('直接访问管理路径也要检查角色；普通用户退回首页，管理员可进入', async () => {
    Object.assign(authState, { ready: true, user: { userId: 'u', username: 'user', role: 'user' } })
    await router.push('/admin/components')
    expect(router.currentRoute.value.path).toBe('/')
    Object.assign(authState, { user: { userId: 'a', username: 'admin', role: 'admin' } })
    await router.push('/admin/components')
    expect(router.currentRoute.value.path).toBe('/admin/workbench')
  })

  it('未登录的管理路径显示登录提示，不渲染管理入口', async () => {
    Object.assign(authState, { ready: true, user: null, dialogVisible: false, notice: '' })
    await router.push('/admin')
    expect(router.currentRoute.value.path).toBe('/')
    expect(authState.dialogVisible).toBe(true)
    expect(authState.notice).toContain('管理员')
  })
})

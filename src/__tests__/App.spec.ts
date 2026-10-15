import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import App from '../App.vue'
import HomeView from '../views/HomeView.vue'
import IdeasView from '../views/IdeasView.vue'
import ArchiveView from '../views/ArchiveView.vue'
import { acceptSession, authState } from '../stores/auth'
import { clearIdeaDraft, ideaDraft } from '../stores/ideaDraft'
import type { AuthUser } from '../../shared/contracts/auth.ts'

const user: AuthUser = { userId: '1', username: 'alice', email: null, emailVerified: false, role: 'user', disabled: false, createdTime: '2026-10-10T08:00:00Z' }
const secondUser: AuthUser = { ...user, userId: '2', username: 'bob' }
let activeUser = user
const wrappers: ReturnType<typeof mount>[] = []

beforeEach(() => {
  clearIdeaDraft()
  Object.assign(authState, { user: null, ready: false, dialogVisible: false, notice: '', sessionError: '' })
  activeUser = user
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async input => {
    const path = String(input)
    if (path === '/api/auth/session') return Response.json(activeUser)
    if (path === '/api/idea') return Response.json({ message: '登录已失效' }, { status: 401 })
    if (path === '/api/ideas') return Response.json([{ ideaId: activeUser.userId, ideaContent: `${activeUser.username}的想法`, createdTime: '' }])
    return Response.json({ message: '未找到' }, { status: 404 })
  }))
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.unstubAllGlobals()
  clearIdeaDraft()
})
async function renderApp(path = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/ideas', component: IdeasView },
      { path: '/archive', component: ArchiveView },
      { path: '/components', component: { template: '<p>组件展示</p>' } },
      { path: '/ideas/:ideaId', name: 'idea-detail', component: { template: '<p>详情</p>' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router, ElementPlus], stubs: { AuthDialog: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('鉴权页面和草稿', () => {
  it('显示首页、归档和想法三个同级导航', async () => {
    const { wrapper } = await renderApp()
    expect(wrapper.get('a[href="/"]').text()).toBe('首页')
    expect(wrapper.get('a[href="/archive"]').text()).toBe('归档')
    expect(wrapper.get('a[href="/ideas"]').text()).toBe('想法')
  })
  it('401 会话失效弹出登录；同一账号重新登录后恢复未提交内容', async () => {
    const { wrapper } = await renderApp()
    await wrapper.get('#idea-input').setValue('尚未提交的用户想法')
    await wrapper.findAll('button').find(button => button.text() === '提交')!.trigger('click')
    await flushPromises()
    expect(authState.user).toBeNull()
    expect(authState.dialogVisible).toBe(true)
    expect(ideaDraft.ideaContent).toBe('尚未提交的用户想法')
    expect(wrapper.find('#idea-input').exists()).toBe(false)
    acceptSession(user)
    await flushPromises()
    expect((wrapper.get('#idea-input').element as HTMLInputElement).value).toBe('尚未提交的用户想法')
  })
  it('换另一个账号重新登录时清空上一账号草稿', async () => {
    const { wrapper } = await renderApp()
    await wrapper.get('#idea-input').setValue('alice的私密草稿')
    await wrapper.findAll('button').find(button => button.text() === '提交')!.trigger('click')
    await flushPromises()
    acceptSession(secondUser)
    await flushPromises()
    expect((wrapper.get('#idea-input').element as HTMLInputElement).value).toBe('')
    expect(ideaDraft.ownerId).toBe(secondUser.userId)
  })
  it('换账号后个人列表重新加载，不残留上一用户的卡片', async () => {
    const { wrapper } = await renderApp('/ideas')
    expect(wrapper.text()).toContain('alice的想法')
    activeUser = secondUser
    acceptSession(secondUser)
    await flushPromises()
    expect(wrapper.text()).toContain('bob的想法')
    expect(wrapper.text()).not.toContain('alice的想法')
  })
})

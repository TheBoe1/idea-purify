import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import App from '../App.vue'
import AuthDialog from '../components/AuthDialog.vue'
import HomeView from '../views/HomeView.vue'
import { loadComponentConfigs } from '../api/componentConfigs'
import { acceptSession, authState, initializeSession, revalidateSession } from '../stores/auth'
import { clearIdeaDraft, ideaDraft } from '../stores/ideaDraft'
import type { AuthUser } from '../../shared/contracts/auth.ts'

const alice: AuthUser = {
  userId: 'alice-id',
  username: 'alice',
  email: null,
  emailVerified: false,
  role: 'user',
  disabled: false,
  createdTime: '2026-10-14T00:00:00Z',
}
const bob: AuthUser = { ...alice, userId: 'bob-id', username: 'bob' }
const wrappers: ReturnType<typeof mount>[] = []
function delayedResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
beforeEach(() => {
  clearIdeaDraft()
  Object.assign(authState, {
    user: null,
    ready: false,
    dialogVisible: false,
    notice: '',
    sessionError: '',
  })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.unstubAllGlobals()
  clearIdeaDraft()
  Object.assign(authState, { user: null, dialogVisible: false, notice: '', sessionError: '' })
})
async function renderApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/archive', component: { template: '<p>归档</p>' } },
      { path: '/ideas', component: { template: '<p>想法</p>' } },
      { path: '/components', component: { template: '<p>组件</p>' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(App, {
    global: { plugins: [router, ElementPlus], stubs: { AuthDialog: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((item) => item.text() === text)!
}

describe('请求与登录身份隔离', () => {
  it('上一账号的配置请求401仍拒绝该请求，但不能退出已登录的新账号', async () => {
    acceptSession(alice)
    const oldResponse = delayedResponse()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => oldResponse.promise),
    )
    const oldRequest = loadComponentConfigs()
    const rejection = oldRequest.catch((error: unknown) => error)
    acceptSession(bob)
    ideaDraft.ownerId = bob.userId
    ideaDraft.ideaContent = '新账号未提交的想法'
    oldResponse.resolve(Response.json({ message: '旧账号会话过期' }, { status: 401 }))
    await expect(rejection).resolves.toMatchObject({ status: 401 })
    expect(authState.user?.userId).toBe(bob.userId)
    expect(authState.dialogVisible).toBe(false)
    expect(ideaDraft.ideaContent).toBe('新账号未提交的想法')
  })

  it('同一账号重新登录后，旧会话的迟到401也不能退出新会话', async () => {
    acceptSession(alice)
    const oldResponse = delayedResponse()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => oldResponse.promise),
    )
    const rejection = loadComponentConfigs().catch((error: unknown) => error)
    acceptSession({ ...alice })
    oldResponse.resolve(Response.json({ message: '上一会话过期' }, { status: 401 }))
    await expect(rejection).resolves.toMatchObject({ status: 401 })
    expect(authState.user?.userId).toBe(alice.userId)
    expect(authState.dialogVisible).toBe(false)
  })

  it('通过页面退出并登录新账号后，旧401保留新草稿和当前首页', async () => {
    const oldResponse = delayedResponse()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const path = String(input)
        if (path === '/api/auth/session') return Response.json(alice)
        if (path === '/api/auth/logout') return Response.json({ message: '已退出登录' })
        if (path === '/api/auth/login') return Response.json(bob)
        if (path === '/api/component-configs') return oldResponse.promise
        return Response.json({ message: '未找到' }, { status: 404 })
      }),
    )
    const wrapper = await renderApp()
    await wrapper.get('#idea-input').setValue('原账号私密草稿')
    const rejection = loadComponentConfigs().catch((error: unknown) => error)
    await wrapper.get('button[aria-label="账号菜单"]').trigger('click')
    await flushPromises()
    const logoutItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === '退出登录',
    )
    expect(logoutItem).toBeDefined()
    logoutItem!.click()
    await flushPromises()
    expect(authState.user).toBeNull()
    expect(ideaDraft.ideaContent).toBe('')
    wrapper
      .findComponent(AuthDialog)
      .vm.$emit('login', { username: 'bob', password: 'a valid test password' })
    await flushPromises()
    await wrapper.get('#idea-input').setValue('Bob重新登录后的草稿')
    oldResponse.resolve(Response.json({ message: 'Alice旧会话过期' }, { status: 401 }))
    await expect(rejection).resolves.toMatchObject({ status: 401 })
    await flushPromises()
    expect(authState.user?.userId).toBe(bob.userId)
    expect(wrapper.findComponent(AuthDialog).props('modelValue')).toBe(false)
    expect((wrapper.get('#idea-input').element as HTMLInputElement).value).toBe(
      'Bob重新登录后的草稿',
    )
    expect(ideaDraft.ownerId).toBe(bob.userId)
  })

  it('当前会话401仍显示登录提示并保留同账号未提交草稿', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) =>
          String(input) === '/api/auth/session'
            ? Response.json(alice)
            : String(input).startsWith('/api/ui/regions/')
              ? Response.json({ message: '尚未发布' }, { status: 404 })
              : Response.json({ message: '当前会话过期' }, { status: 401 }),
        ),
    )
    const wrapper = await renderApp()
    await wrapper.get('#idea-input').setValue('当前会话到期仍保留')
    await button(wrapper, '提交').trigger('click')
    await flushPromises()
    expect(authState.user).toBeNull()
    expect(wrapper.findComponent(AuthDialog).props('modelValue')).toBe(true)
    expect(wrapper.findComponent(AuthDialog).props('notice')).toContain('登录状态已失效')
    expect(ideaDraft.ideaContent).toBe('当前会话到期仍保留')
    acceptSession(alice)
    await flushPromises()
    expect((wrapper.get('#idea-input').element as HTMLInputElement).value).toBe(
      '当前会话到期仍保留',
    )
  })
})

describe('后台会话检查不能覆盖之后建立的会话', () => {
  it.each([200, 401, 503])('初始化的旧响应 %s 不能覆盖新登录账号', async (status) => {
    const oldResponse = delayedResponse()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => oldResponse.promise),
    )
    const initialization = initializeSession()
    acceptSession(bob)
    oldResponse.resolve(
      Response.json(status === 200 ? alice : { message: '旧初始化结果' }, { status }),
    )
    await initialization
    expect(authState.user?.userId).toBe(bob.userId)
    expect(authState.ready).toBe(true)
    expect(authState.dialogVisible).toBe(false)
    expect(authState.sessionError).toBe('')
  })

  it.each([200, 401, 503])('周期检查的旧响应 %s 不改变同账号重新登录后的状态', async (status) => {
    acceptSession(alice)
    const oldResponse = delayedResponse()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => oldResponse.promise),
    )
    const checking = revalidateSession()
    acceptSession({ ...alice, email: 'new-login@example.com' })
    oldResponse.resolve(
      Response.json(status === 200 ? alice : { message: '旧检查结果' }, { status }),
    )
    await checking
    expect(authState.user?.email).toBe('new-login@example.com')
    expect(authState.dialogVisible).toBe(false)
    expect(authState.sessionError).toBe('')
  })
})

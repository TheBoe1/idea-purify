import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onBeforeUnmount } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElDropdown } from 'element-plus'
import AppMenu from '../components/AppMenu.vue'
import { acceptSession, authState } from '../stores/auth'
import { clearIdeaDraft, ideaDraft } from '../stores/ideaDraft'
import {
  clearWorkbenchRecovery,
  confirmWorkbenchLeave,
  registerWorkbenchLeaveGuard,
  saveWorkbenchRecovery,
  takeWorkbenchRecovery,
} from '../stores/workbenchRecovery'
import type { AuthUser } from '../../shared/contracts/auth.ts'

const alice: AuthUser = {
  userId: 'recovery-alice',
  username: 'alice',
  role: 'admin',
  email: null,
  emailVerified: false,
  disabled: false,
  createdTime: '',
}
const bob: AuthUser = { ...alice, userId: 'recovery-bob', username: 'bob' }
const disposers: (() => void)[] = []
const wrappers: ReturnType<typeof mount>[] = []

beforeEach(() => {
  clearWorkbenchRecovery()
  clearIdeaDraft()
  acceptSession(alice)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  disposers.splice(0).forEach((dispose) => dispose())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearWorkbenchRecovery()
  clearIdeaDraft()
  authState.user = null
})

function register(owner: string, guard: () => boolean | Promise<boolean>) {
  const unregister = registerWorkbenchLeaveGuard(owner, guard)
  disposers.push(unregister)
  return unregister
}
async function renderMenu(stashOnUnmount = false) {
  const Editor = defineComponent({
    setup() {
      onBeforeUnmount(() => {
        if (stashOnUnmount) saveWorkbenchRecovery(alice.userId, { name: '卸载时暂存' })
      })
      return () => h('p', '编辑器')
    },
  })
  const Harness = defineComponent({
    setup: () => () => h('div', [h(AppMenu), authState.user ? h(Editor) : null]),
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<p>首页</p>' } }],
  })
  await router.push('/')
  const wrapper = mount(Harness, { global: { plugins: [ElementPlus, router] } })
  wrappers.push(wrapper)
  return wrapper
}
function logout(wrapper: ReturnType<typeof mount>) {
  wrapper.findComponent(ElDropdown).vm.$emit('command', 'logout')
}

describe('工作台恢复缓存按账号单次领取', () => {
  it('401卸载后同账号取回自己的快照，不同账号互不读取，取回后移除', () => {
    saveWorkbenchRecovery(alice.userId, { schema: { name: 'Alice 未保存方案' }, pageId: 'a' })
    saveWorkbenchRecovery(bob.userId, { schema: { name: 'Bob 未保存方案' }, pageId: 'b' })
    authState.user = null
    expect(takeWorkbenchRecovery('unknown-user')).toBeUndefined()
    acceptSession(bob)
    expect(takeWorkbenchRecovery(bob.userId)).toEqual({
      schema: { name: 'Bob 未保存方案' },
      pageId: 'b',
    })
    expect(takeWorkbenchRecovery(bob.userId)).toBeUndefined()
    acceptSession(alice)
    expect(takeWorkbenchRecovery(alice.userId)).toEqual({
      schema: { name: 'Alice 未保存方案' },
      pageId: 'a',
    })
  })

  it('拒绝无账号缓存，清单个账号保留其他账号，退出全清', () => {
    saveWorkbenchRecovery('', { private: true })
    expect(takeWorkbenchRecovery('')).toBeUndefined()
    saveWorkbenchRecovery(alice.userId, 'A')
    saveWorkbenchRecovery(bob.userId, 'B')
    clearWorkbenchRecovery(alice.userId)
    expect(takeWorkbenchRecovery(alice.userId)).toBeUndefined()
    expect(takeWorkbenchRecovery(bob.userId)).toBe('B')
    saveWorkbenchRecovery(alice.userId, 'A')
    clearWorkbenchRecovery()
    expect(takeWorkbenchRecovery(alice.userId)).toBeUndefined()
  })

  it('旧编辑器注销不清除新编辑器guard，账号只调用自己的guard', async () => {
    const stale = vi.fn<() => boolean>(() => true)
    const active = vi.fn<() => boolean>(() => false)
    const bobGuard = vi.fn<() => boolean>(() => true)
    const unregister = register(alice.userId, stale)
    register(alice.userId, active)
    register(bob.userId, bobGuard)
    unregister()
    expect(await confirmWorkbenchLeave(alice.userId)).toBe(false)
    expect(stale).not.toHaveBeenCalled()
    expect(active).toHaveBeenCalledOnce()
    expect(bobGuard).not.toHaveBeenCalled()
    expect(await confirmWorkbenchLeave(bob.userId)).toBe(true)
    expect(bobGuard).toHaveBeenCalledOnce()
  })
})

describe('显式退出先保护工作台，再清理已放弃的缓存', () => {
  it('取消离开不发退出请求，不清Idea或工作台未保存内容', async () => {
    register(alice.userId, () => false)
    ideaDraft.ideaContent = '仍要保留的Idea'
    saveWorkbenchRecovery(alice.userId, { name: '仍要保留的工作台' })
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await renderMenu()
    logout(wrapper)
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(authState.user?.userId).toBe(alice.userId)
    expect(ideaDraft.ideaContent).toBe('仍要保留的Idea')
    expect(takeWorkbenchRecovery(alice.userId)).toEqual({ name: '仍要保留的工作台' })
  })

  it('明确放弃且退出成功后，连卸载期间产生的恢复缓存也清理', async () => {
    const guard = vi.fn<() => boolean>(() => true)
    register(alice.userId, guard)
    ideaDraft.ideaContent = '明确退出时丢弃的Idea'
    saveWorkbenchRecovery(alice.userId, { name: '先前缓存' })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: '已退出' }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await renderMenu(true)
    logout(wrapper)
    await flushPromises()
    expect(guard).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(authState.user).toBeNull()
    expect(ideaDraft.ideaContent).toBe('')
    expect(takeWorkbenchRecovery(alice.userId)).toBeUndefined()
    expect(wrapper.text()).not.toContain('编辑器')
  })

  it('退出网络失败不清空内容，恢复网络后可以重试', async () => {
    register(alice.userId, () => true)
    ideaDraft.ideaContent = '退出失败仍保留'
    saveWorkbenchRecovery(alice.userId, { name: '退出失败的工作台' })
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('网络中断'))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await renderMenu()
    logout(wrapper)
    await flushPromises()
    expect(authState.user?.userId).toBe(alice.userId)
    expect(ideaDraft.ideaContent).toBe('退出失败仍保留')
    expect(takeWorkbenchRecovery(alice.userId)).toEqual({ name: '退出失败的工作台' })
    fetchMock.mockResolvedValue(Response.json({ message: '已退出' }))
    logout(wrapper)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(authState.user).toBeNull()
  })

  it('等待离开确认期间换账号，不向新会话发送旧账号退出请求', async () => {
    let release!: (allowed: boolean) => void
    const guard = vi.fn<() => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve
        }),
    )
    register(alice.userId, guard)
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await renderMenu()
    logout(wrapper)
    logout(wrapper)
    expect(guard).toHaveBeenCalledOnce()
    acceptSession(bob)
    ideaDraft.ideaContent = 'Bob 新草稿'
    release(true)
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(authState.user?.userId).toBe(bob.userId)
    expect(ideaDraft.ideaContent).toBe('Bob 新草稿')
  })
})

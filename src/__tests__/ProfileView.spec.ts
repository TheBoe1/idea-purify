import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ProfileView from '../views/ProfileView.vue'
import {
  acceptSession,
  authState,
  initializeSession,
  revalidateSession,
  updateCurrentProfile,
} from '../stores/auth'

const alice = {
  userId: 'profile-alice',
  username: 'alice',
  nickname: '原昵称',
  email: null,
  emailVerified: false,
  role: 'user' as const,
  disabled: false,
  createdTime: '2026-10-14T00:00:00Z',
}
const bob = { ...alice, userId: 'profile-bob', username: 'bob', nickname: 'Bob昵称' }
const wrappers: ReturnType<typeof mount>[] = []
function delayed() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
function nicknameOfCurrentUser() {
  return authState.user && 'nickname' in authState.user ? authState.user.nickname : null
}
beforeEach(() => {
  acceptSession(alice)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.unstubAllGlobals()
  authState.user = null
})
function render() {
  const wrapper = mount(ProfileView, { global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

describe('个人资料昵称更新', () => {
  it('仅提交昵称，登录名只读，保存后更新账号显示数据', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...alice, nickname: '新昵称' }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = render()
    expect(
      (wrapper.get('input[aria-label="登录用户名"]').element as HTMLInputElement).readOnly,
    ).toBe(true)
    await wrapper.get('input[aria-label="昵称"]').setValue('新昵称')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/profile')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ nickname: '新昵称' }))
    expect(authState.user?.username).toBe('alice')
    expect(nicknameOfCurrentUser()).toBe('新昵称')
    expect(wrapper.text()).toContain('昵称已保存')
  })

  it.each(['', '字'.repeat(41), '昵称\u0000', '昵称\u200b'])(
    '非法昵称不发请求：%s',
    async (nickname) => {
      const fetchMock = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = render()
      await wrapper.get('input[aria-label="昵称"]').setValue(nickname)
      await wrapper.get('button').trigger('click')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(wrapper.text()).toMatch(/1–40|控制或隐藏/)
    },
  )

  it('HTTP失败保留昵称编辑内容并恢复按钮', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message: '暂时无法保存资料' }, { status: 503 })),
    )
    const wrapper = render()
    await wrapper.get('input[aria-label="昵称"]').setValue('尚未保存的昵称')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('input[aria-label="昵称"]').element).toHaveProperty(
      'value',
      '尚未保存的昵称',
    )
    expect(wrapper.get('button').element).toHaveProperty('disabled', false)
    expect(wrapper.text()).toContain('暂时无法保存资料')
  })

  it('迟到的上一账号资料响应不会覆盖新账号或显示旧成功信息', async () => {
    const response = delayed()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => response.promise),
    )
    const wrapper = render()
    await wrapper.get('input[aria-label="昵称"]').setValue('Alice新昵称')
    await wrapper.get('button').trigger('click')
    acceptSession(bob)
    response.resolve(Response.json({ ...alice, nickname: 'Alice新昵称' }))
    await flushPromises()
    expect(authState.user?.userId).toBe(bob.userId)
    expect(nicknameOfCurrentUser()).toBe('Bob昵称')
    expect(wrapper.text()).not.toContain('昵称已保存')
  })

  it('较早的更新响应不能覆盖同账号较晚保存的昵称', async () => {
    const first = delayed()
    const second = delayed()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    )
    const firstSave = updateCurrentProfile('第一份昵称')
    const secondSave = updateCurrentProfile('第二份昵称')
    second.resolve(Response.json({ ...alice, nickname: '第二份昵称' }))
    expect(await secondSave).toBe(true)
    first.resolve(Response.json({ ...alice, nickname: '第一份昵称' }))
    expect(await firstSave).toBe(false)
    expect(nicknameOfCurrentUser()).toBe('第二份昵称')
  })

  it.each(['initialize', 'revalidate'])('旧%s资料检查不覆盖已经保存的新昵称', async (operation) => {
    const oldCheck = delayed()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) =>
          String(input) === '/api/auth/session'
            ? oldCheck.promise
            : Response.json({ ...alice, nickname: '最新昵称' }),
        ),
    )
    const checking = operation === 'initialize' ? initializeSession() : revalidateSession()
    await updateCurrentProfile('最新昵称')
    oldCheck.resolve(Response.json(alice))
    await checking
    expect(nicknameOfCurrentUser()).toBe('最新昵称')
  })
})

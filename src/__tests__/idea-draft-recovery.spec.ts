import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import IdeaEntryPanel from '../components/ideas/IdeaEntryPanel.vue'
import { acceptSession, authState } from '../stores/auth'
import { activateIdeaDraft, clearIdeaDraft, ideaDraft, persistIdeaDraft } from '../stores/ideaDraft'
import type { AuthUser } from '../../shared/contracts/auth.ts'

const alice: AuthUser = {
  userId: 'draft-alice',
  username: 'alice',
  email: null,
  emailVerified: false,
  role: 'user',
  disabled: false,
  createdTime: '',
}
const bob: AuthUser = { ...alice, userId: 'draft-bob', username: 'bob' }
const prefix = 'idea-purify:unsubmitted-idea:v1:'
// Element Plus 2.14.5 将确认结果声明成交叉类型，运行时 confirm 返回 action 字符串。
const confirmed = 'confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>
const key = (owner = alice.userId) => `${prefix}${encodeURIComponent(owner)}`
const wrappers: ReturnType<typeof mount>[] = []

beforeEach(() => {
  clearIdeaDraft()
  authState.user = null
  authState.ready = false
  window.sessionStorage.clear()
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearIdeaDraft()
  authState.user = null
  window.sessionStorage.clear()
})

async function renderPanel(draftKey?: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/archive', component: { template: '<p>归档</p>' } }],
  })
  await router.push('/archive')
  const wrapper = mount(IdeaEntryPanel, {
    props: { inputId: 'recovery-input', draftKey },
    global: { plugins: [router, ElementPlus] },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((item) => item.text() === label)!
}
function input(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('#recovery-input')
}
function stubSuccessfulCreate() {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { ideaId: 'saved', ideaContent: '提交的想法', createdTime: '' },
          { status: 201 },
        ),
      ),
  )
}

describe('Idea 未提交草稿的本标签恢复与账号边界', () => {
  it('重新初始化从同账号标签缓存完整恢复，明确显示未提交而非服务器保存成功', async () => {
    const content = '合法长内容'.repeat(51)
    window.sessionStorage.setItem(
      key(),
      JSON.stringify({ ownerId: alice.userId, ideaContent: content }),
    )
    acceptSession(alice)
    const wrapper = await renderPanel()
    expect((input(wrapper).element as HTMLInputElement).value).toBe(content)
    expect(ideaDraft.restored).toBe(true)
    expect(wrapper.text()).toContain('已恢复本标签的 Idea 未提交草稿')
    expect(wrapper.text()).not.toContain('想法已保存')
  })

  it('账号直切后仅恢复各自缓存，不显示其他账号的内容', () => {
    acceptSession(alice)
    ideaDraft.ideaContent = 'Alice 的私密草稿'
    acceptSession(bob)
    expect(ideaDraft.ideaContent).toBe('')
    ideaDraft.ideaContent = 'Bob 的私密草稿'
    acceptSession(alice)
    expect(ideaDraft.ideaContent).toBe('Alice 的私密草稿')
    expect(ideaDraft.ownerId).toBe(alice.userId)
    acceptSession(bob)
    expect(ideaDraft.ideaContent).toBe('Bob 的私密草稿')
  })

  it('会话失效立即清持久缓存，同账号重登可恢复当前内存，新账号看不到', () => {
    acceptSession(alice)
    ideaDraft.ideaContent = '失效时仍在当前页面的想法'
    authState.user = null
    expect(window.sessionStorage.getItem(key())).toBeNull()
    expect(ideaDraft.ideaContent).toBe('失效时仍在当前页面的想法')
    expect(ideaDraft.persistenceState).toBe('memory-only')
    acceptSession(alice)
    expect(ideaDraft.ideaContent).toBe('失效时仍在当前页面的想法')
    expect(ideaDraft.persistenceState).toBe('saved')
    authState.user = null
    acceptSession(bob)
    expect(ideaDraft.ideaContent).toBe('')
  })

  it('显式清理只删除本标签的未提交 Idea，不删除其他业务缓存', () => {
    acceptSession(alice)
    ideaDraft.ideaContent = '待清理的 Alice 内容'
    acceptSession(bob)
    ideaDraft.ideaContent = '待清理的 Bob 内容'
    window.sessionStorage.setItem('workbench:draft', '其他业务')
    clearIdeaDraft()
    expect(window.sessionStorage.getItem(key())).toBeNull()
    expect(window.sessionStorage.getItem(key(bob.userId))).toBeNull()
    expect(window.sessionStorage.getItem('workbench:draft')).toBe('其他业务')
    expect(ideaDraft.ideaContent).toBe('')
    expect(ideaDraft.ownerId).toBe('')
  })

  it('无当前账号不能读取指定其他账号缓存', () => {
    window.sessionStorage.setItem(
      key(),
      JSON.stringify({ ownerId: alice.userId, ideaContent: '私密内容' }),
    )
    activateIdeaDraft(alice.userId)
    expect(ideaDraft.ideaContent).toBe('')
  })

  it('刷新初始化确认未登录后清理旧缓存，不等到后续登录才处理', () => {
    window.sessionStorage.setItem(
      key(),
      JSON.stringify({ ownerId: alice.userId, ideaContent: '已失效会话的缓存' }),
    )
    authState.ready = true
    expect(window.sessionStorage.getItem(key())).toBeNull()
    acceptSession(alice)
    expect(ideaDraft.ideaContent).toBe('')
  })
})

describe('本标签存储失败的真实状态与恢复', () => {
  it('配额失败保留最新输入、提示失败并保护刷新，重试成功才恢复成功状态', async () => {
    acceptSession(alice)
    const wrapper = await renderPanel()
    await input(wrapper).setValue('上一版本草稿')
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    await input(wrapper).setValue('存储失败时的最新输入')
    expect(ideaDraft.ideaContent).toBe('存储失败时的最新输入')
    expect(ideaDraft.persistenceState).toBe('failed')
    expect(wrapper.text()).toContain('本标签暂存失败')
    expect(wrapper.text()).not.toContain('已暂存于本标签')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    write.mockRestore()
    await button(wrapper, '重试本标签暂存').trigger('click')
    expect(ideaDraft.persistenceState).toBe('saved')
    expect(JSON.parse(window.sessionStorage.getItem(key())!).ideaContent).toBe(
      '存储失败时的最新输入',
    )
    expect(wrapper.text()).not.toContain('本标签暂存失败')
    const savedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(savedUnload)
    expect(savedUnload.defaultPrevented).toBe(false)
  })

  it('浏览器禁止读取存储时不报成功，恢复权限后的重试读取原草稿', () => {
    window.sessionStorage.setItem(
      key(),
      JSON.stringify({ ownerId: alice.userId, ideaContent: '权限恢复后应读回的内容' }),
    )
    const read = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    acceptSession(alice)
    expect(ideaDraft.persistenceState).toBe('failed')
    expect(ideaDraft.persistenceError).toContain('无法读取')
    read.mockRestore()
    persistIdeaDraft()
    expect(ideaDraft.ideaContent).toBe('权限恢复后应读回的内容')
    expect(ideaDraft.persistenceState).toBe('saved')
  })

  it('损坏或账号不符的缓存不进入编辑器，重试不静默覆盖原记录', async () => {
    const invalid = JSON.stringify({ ownerId: bob.userId, ideaContent: '不能跨账号显示' })
    window.sessionStorage.setItem(key(), invalid)
    acceptSession(alice)
    const wrapper = await renderPanel()
    expect(ideaDraft.ideaContent).toBe('')
    expect(wrapper.text()).toContain('无法读取')
    await button(wrapper, '重试本标签暂存').trigger('click')
    expect(window.sessionStorage.getItem(key())).toBe(invalid)
    expect(ideaDraft.persistenceState).toBe('failed')
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(confirmed)
    await button(wrapper, '丢弃 Idea 草稿').trigger('click')
    await flushPromises()
    expect(window.sessionStorage.getItem(key())).toBeNull()
    expect(ideaDraft.persistenceState).toBe('empty')
  })
})

describe('提交与丢弃不清除后续草稿', () => {
  it('服务端成功后清除对应本标签记录，服务器失败保留内容与缓存', async () => {
    acceptSession(alice)
    const wrapper = await renderPanel()
    await input(wrapper).setValue('提交的想法')
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ message: '网络暂时不可用' }, { status: 503 })),
    )
    await button(wrapper, '提交').trigger('click')
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('提交的想法')
    expect(JSON.parse(window.sessionStorage.getItem(key())!).ideaContent).toBe('提交的想法')
    expect(wrapper.text()).not.toContain('想法已保存')
    stubSuccessfulCreate()
    await button(wrapper, '提交').trigger('click')
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('')
    expect(window.sessionStorage.getItem(key())).toBeNull()
    expect(wrapper.text()).toContain('想法已保存')
  })

  it('请求期间内容改走再改回，迟到成功仍不能清除这个新修订', async () => {
    let complete!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve
          }),
      ),
    )
    acceptSession(alice)
    const wrapper = await renderPanel()
    await input(wrapper).setValue('重复文本也属于新的草稿')
    await button(wrapper, '提交').trigger('click')
    ideaDraft.ideaContent = '期间新输入'
    ideaDraft.ideaContent = '重复文本也属于新的草稿'
    complete(
      Response.json(
        { ideaId: 'old', ideaContent: '重复文本也属于新的草稿', createdTime: '' },
        { status: 201 },
      ),
    )
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('重复文本也属于新的草稿')
    expect(JSON.parse(window.sessionStorage.getItem(key())!).ideaContent).toBe(
      '重复文本也属于新的草稿',
    )
    expect(wrapper.text()).not.toContain('想法已保存')
  })

  it('丢弃确认期间发生编辑不能清除新内容，取消确认也保留输入', async () => {
    acceptSession(alice)
    const wrapper = await renderPanel()
    await input(wrapper).setValue('打开确认前的草稿')
    let confirm!: () => void
    const confirmation = vi.spyOn(ElMessageBox, 'confirm').mockImplementation(
      () =>
        new Promise((resolve) => {
          confirm = () => resolve(confirmed)
        }),
    )
    await button(wrapper, '丢弃 Idea 草稿').trigger('click')
    ideaDraft.ideaContent = '确认期间更新的草稿'
    confirm()
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('确认期间更新的草稿')
    confirmation.mockRejectedValue('cancel')
    await button(wrapper, '丢弃 Idea 草稿').trigger('click')
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('确认期间更新的草稿')
    confirmation.mockResolvedValue(confirmed)
    await button(wrapper, '丢弃 Idea 草稿').trigger('click')
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('')
    expect(window.sessionStorage.getItem(key())).toBeNull()
  })

  it('独立业务节点输入不覆盖首页草稿或建立混淆的本标签记录', async () => {
    acceptSession(alice)
    ideaDraft.ideaContent = '首页原始草稿'
    const wrapper = await renderPanel('node-private')
    await input(wrapper).setValue('业务节点独立输入')
    expect(ideaDraft.ideaContent).toBe('首页原始草稿')
    expect(JSON.parse(window.sessionStorage.getItem(key())!).ideaContent).toBe('首页原始草稿')
    expect(wrapper.text()).not.toContain('本标签')
  })
})

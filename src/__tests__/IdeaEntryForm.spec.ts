import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import IdeaEntryForm from '../components/ideas/IdeaEntryForm.vue'
import HomeView from '../views/HomeView.vue'
import { authState } from '../stores/auth'
import { clearIdeaDraft, ideaDraft } from '../stores/ideaDraft'
import type { Idea } from '../../shared/contracts/idea.ts'

const wrappers: ReturnType<typeof mount>[] = []
const savedIdea: Idea = { ideaId: '31', ideaContent: '用户想法', createdTime: '2026-10-13T08:00:00Z' }

beforeEach(() => {
  clearIdeaDraft()
  Object.assign(authState, { user: { userId: 'form-user', username: 'form_user', role: 'user' }, ready: true })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.unstubAllGlobals()
  clearIdeaDraft()
})
async function renderForm(modelValue = '') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/archive', component: { template: '<p>归档</p>' } }] })
  await router.push('/archive')
  const wrapper = mount(IdeaEntryForm, { props: { modelValue, submitting: false, inputId: 'idea-input' }, global: { plugins: [ElementPlus, router] } })
  wrappers.push(wrapper)
  return wrapper
}
async function renderHome() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: HomeView }, { path: '/archive', component: { template: '<p>归档</p>' } }] })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(HomeView, { global: { plugins: [ElementPlus, router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function submitButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button').find(button => button.text() === '提交')!
}

describe('Idea 录入组件的公开接口', () => {
  it('受控输入通过 update:modelValue 交给页面，提交去除首尾空格的内容', async () => {
    const wrapper = await renderForm()
    await wrapper.get('#idea-input').setValue('  一个新想法  ')
    const updates = wrapper.emitted('update:modelValue')
    expect(updates?.[updates.length - 1]).toEqual(['  一个新想法  '])
    await wrapper.setProps({ modelValue: '  一个新想法  ' })
    await submitButton(wrapper).trigger('click')
    expect(wrapper.emitted('submit')).toEqual([['一个新想法']])
  })

  it.each([' ', '字', '字'.repeat(256)])('非法内容不会发出提交事件：%s', async content => {
    const wrapper = await renderForm(content)
    await submitButton(wrapper).trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('提交中禁用输入和按钮，不发出重复提交事件', async () => {
    const wrapper = await renderForm('用户想法')
    await wrapper.setProps({ submitting: true })
    expect((wrapper.get('#idea-input').element as HTMLInputElement).disabled).toBe(true)
    expect((submitButton(wrapper).element as HTMLButtonElement).disabled).toBe(true)
    await submitButton(wrapper).trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('输入前缀仍显示原有预设建议', async () => {
    const wrapper = await renderForm()
    await wrapper.get('#idea-input').trigger('focus')
    await wrapper.get('#idea-input').setValue('我今天')
    await wrapper.setProps({ modelValue: '我今天' })
    await new Promise(resolve => setTimeout(resolve, 350))
    await flushPromises()
    expect(document.body.textContent).toContain('我今天看到了什么')
    expect(document.body.textContent).toContain('我今天想要做')
  })

  it('显示服务端错误文本和成功归档入口', async () => {
    const wrapper = await renderForm('用户想法')
    await wrapper.setProps({ errorMessage: '<img src=x onerror=alert(1)>', saved: true })
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('a[href="/archive"]').text()).toContain('归档')
  })
})

describe('Home 页面提交编排', () => {
  it('只发一次创建请求，等待期间锁定表单，成功后清空草稿', async () => {
    let complete!: (response: Response) => void
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { complete = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await renderHome()
    await wrapper.get('#idea-input').setValue('  用户想法  ')
    await submitButton(wrapper).trigger('click')
    await submitButton(wrapper).trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/idea')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ ideaContent: '用户想法' }))
    expect((wrapper.get('#idea-input').element as HTMLInputElement).disabled).toBe(true)
    complete(Response.json(savedIdea, { status: 201 }))
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('')
    expect((wrapper.get('#idea-input').element as HTMLInputElement).disabled).toBe(false)
    expect(wrapper.text()).toContain('想法已保存')
  })

  it('HTTP 失败保留输入并恢复操作，不显示保存成功', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: '暂时无法保存想法' }, { status: 503 })))
    const wrapper = await renderHome()
    await wrapper.get('#idea-input').setValue('失败后需要保留的内容')
    await submitButton(wrapper).trigger('click')
    await flushPromises()
    expect(ideaDraft.ideaContent).toBe('失败后需要保留的内容')
    expect((wrapper.get('#idea-input').element as HTMLInputElement).value).toBe('失败后需要保留的内容')
    expect((wrapper.get('#idea-input').element as HTMLInputElement).disabled).toBe(false)
    expect(wrapper.text()).not.toContain('想法已保存')
  })
})

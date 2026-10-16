import { clearWorkbenchRecovery } from '../stores/workbenchRecovery'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import ElementPlus, { ElInput, ElMessageBox } from 'element-plus'
import ComponentConfigView from '../views/ComponentConfigView.vue'
import WorkbenchManager from '../components/workbench/WorkbenchManager.vue'
import { authState } from '../stores/auth'
import {
  createDefaultSchemaV2,
  type PageConfig,
  type WorkbenchTemplate,
} from '../../shared/contracts/workbench.ts'

const pageId = 'd452be9b-5555-4444-8888-1c0f3db50012'
const templateId = 'd452be9b-5555-4444-8888-1c0f3db50011'
const time = '2026-10-15T00:00:00Z'
const wrappers: ReturnType<typeof mount>[] = []
let page: PageConfig
let template: WorkbenchTemplate | undefined
let failure = 0
let releaseSave: (() => void) | undefined
let delayedSave: Promise<void> | undefined
let writes: { path: string; method: string; body: Record<string, unknown> }[]
function mockConfirm() { return vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel') }
let confirm: ReturnType<typeof mockConfirm>

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

beforeEach(() => {
  clearWorkbenchRecovery()
  Object.assign(authState, { user: { userId: 'ux-admin', username: 'admin', role: 'admin' }, ready: true })
  page = {
    pageConfigId: pageId,
    name: '已有页面草稿',
    target: { kind: 'dynamic', pageKey: 'ux-safety-test', regionKey: 'root' },
    schema: createDefaultSchemaV2('已有页面内容'),
    draftRevision: 1,
    publishedRevision: null,
    publishedTime: null,
    status: 'draft',
    createdTime: time,
    updatedTime: time,
  }
  template = undefined
  failure = 0
  releaseSave = undefined
  delayedSave = undefined
  writes = []
  confirm = mockConfirm()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    if (body) {
      writes.push({ path, method: init?.method ?? 'GET', body })
      if (delayedSave && !path.endsWith('/publish')) await delayedSave
      if (failure) return Response.json({ message: failure === 409 ? '版本冲突，请重新加载' : '网络中断，保存失败' }, { status: failure })
    }
    if (path === '/api/admin/templates' && !body) return Response.json(template ? [template] : [])
    if (path === '/api/admin/page-configs' && !body) return Response.json([page])
    if (path === `/api/admin/page-configs/${pageId}` && !body) return Response.json(page)
    if (path === `/api/admin/templates/${templateId}` && !body) return Response.json(template)
    if (path.startsWith('/api/admin/templates') && body) {
      template = { configId: templateId, schema: copy(body.schema as WorkbenchTemplate['schema']), revision: (template?.revision ?? 0) + 1, createdTime: time, updatedTime: time }
      return Response.json(template)
    }
    if (path.endsWith('/publish') && body) {
      page = { ...page, publishedRevision: page.draftRevision, publishedTime: time, status: 'published' }
      return Response.json(page)
    }
    if (path.startsWith('/api/admin/page-configs') && body) {
      page = { ...page, name: String(body.name), schema: copy(body.schema as PageConfig['schema']), draftRevision: page.draftRevision + 1, status: page.publishedRevision ? 'changed' : 'draft' }
      return Response.json(page)
    }
    return Response.json({ message: '测试路径不存在' }, { status: 404 })
  }))
})

afterEach(() => {
  releaseSave?.()
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function render(initialPath = '/admin/workbench') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/workbench', component: ComponentConfigView },
    { path: '/other', component: defineComponent({ render: () => h('p', '其他页面') }) },
  ] })
  await router.push(initialPath)
  const wrapper = mount(defineComponent({ render: () => authState.user ? h(RouterView, { key: authState.user.userId }) : h('p', '请登录') }), {
    attachTo: document.body,
    global: { plugins: [router, ElementPlus], stubs: { WorkbenchRenderer: true, ComponentsView: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

async function click(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll('button').find(button => button.text() === label)
  expect(button, `找不到按钮：${label}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}

async function openPage(wrapper: ReturnType<typeof mount>) {
  await click(wrapper, '方案管理')
  const manager = wrapper.findComponent(WorkbenchManager)
  const row = manager.findAll('.saved-item').find(item => item.text().includes('已有页面草稿'))
  expect(row).toBeDefined()
  await row!.get('button').trigger('click')
  await flushPromises()
}

describe('工作台编辑状态与发布保护', () => {
  it('保存为组件方案不等于保存当前页面草稿，发布不能悄悄使用旧页面内容', async () => {
    const { wrapper } = await render()
    await openPage(wrapper)
    await wrapper.get('input[aria-label="方案名称"]').setValue('新编辑的页面内容')
    await click(wrapper, '保存方案')
    expect(template?.schema.name).toBe('新编辑的页面内容')
    expect(page.schema.name).toBe('已有页面内容')
    await click(wrapper, '发布已保存版本')
    expect(wrapper.text()).toContain('当前修改尚未保存，请先保存页面草稿')
    expect(writes.filter(write => write.path.endsWith('/publish'))).toHaveLength(0)
    await click(wrapper, '保存页面草稿')
    await click(wrapper, '发布已保存版本')
    expect(page.schema.name).toBe('新编辑的页面内容')
    expect(page.publishedRevision).toBe(page.draftRevision)
    expect(writes.filter(write => write.path.endsWith('/publish'))).toHaveLength(1)
  })

  it('修改页面名称同样需要先保存，不能只检查 Schema', async () => {
    const { wrapper } = await render()
    await openPage(wrapper)
    await wrapper.get('input[aria-label="页面配置名称"]').setValue('尚未保存的新页面名')
    await click(wrapper, '发布已保存版本')
    expect(writes).toHaveLength(0)
    expect(page.name).toBe('已有页面草稿')
    await click(wrapper, '保存页面草稿')
    await click(wrapper, '发布已保存版本')
    expect(page.name).toBe('尚未保存的新页面名')
    expect(page.status).toBe('published')
  })

  it('成功后再次编辑、网络失败和重试分别展示真实状态，并保留输入', async () => {
    const { wrapper } = await render()
    const name = wrapper.get('input[aria-label="方案名称"]')
    await name.setValue('首次保存')
    await click(wrapper, '保存方案')
    expect(wrapper.get('.work-status').text()).toContain('保存成功')
    await name.setValue('失败时必须保留的新输入')
    expect(wrapper.get('.work-status').text()).toContain('存在未保存修改')
    failure = 503
    await click(wrapper, '保存方案')
    expect(wrapper.get('.work-status').text()).toContain('保存失败')
    expect(wrapper.get('.work-status').text()).not.toContain('保存成功')
    expect(wrapper.text()).not.toContain('方案已保存，版本')
    expect((name.element as HTMLInputElement).value).toBe('失败时必须保留的新输入')
    expect(template?.schema.name).toBe('首次保存')
    failure = 0
    await click(wrapper, '保存方案')
    expect(template?.schema.name).toBe('失败时必须保留的新输入')
    expect(wrapper.get('.work-status').text()).toContain('保存成功')
  })

  it('保存响应只确认提交快照，响应前的新输入仍为未保存', async () => {
    const { wrapper } = await render()
    const name = wrapper.get('input[aria-label="方案名称"]')
    await name.setValue('请求提交快照')
    delayedSave = new Promise(resolve => { releaseSave = resolve })
    await click(wrapper, '保存方案')
    expect(wrapper.get('.work-status').text()).toContain('正在保存')
    // 模拟保存状态更新前已经排队的输入事件；它不能被旧响应确认保存。
    const nameEditor = wrapper.findAllComponents(ElInput).find(input => input.find('input[aria-label="方案名称"]').exists())!
    nameEditor.vm.$emit('update:modelValue', '保存期间的新输入')
    await flushPromises()
    releaseSave!()
    await flushPromises()
    expect(template?.schema.name).toBe('请求提交快照')
    expect((name.element as HTMLInputElement).value).toBe('保存期间的新输入')
    expect(wrapper.get('.work-status').text()).toContain('存在未保存修改')
  })

  it('未保存的新建与路由离开均可取消，明确放弃后才离开', async () => {
    const { wrapper, router } = await render()
    await wrapper.get('input[aria-label="方案名称"]').setValue('离开前保留')
    await click(wrapper, '新建方案')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect((wrapper.get('input[aria-label="方案名称"]').element as HTMLInputElement).value).toBe('离开前保留')
    await router.push('/other')
    expect(router.currentRoute.value.path).toBe('/admin/workbench')
    expect(confirm).toHaveBeenCalledTimes(2)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    confirm.mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await router.push('/other')
    expect(router.currentRoute.value.path).toBe('/other')
  })

  it('版本冲突保留编辑，另存方案后脱离旧页面绑定', async () => {
    const { wrapper } = await render()
    await openPage(wrapper)
    await wrapper.get('input[aria-label="方案名称"]').setValue('冲突时的本地修改')
    failure = 409
    await click(wrapper, '保存页面草稿')
    expect(wrapper.text()).toContain('版本冲突')
    expect(wrapper.get('.work-status').text()).toContain('保存失败')
    expect((wrapper.get('input[aria-label="方案名称"]').element as HTMLInputElement).value).toBe('冲突时的本地修改')
    expect(page.schema.name).toBe('已有页面内容')
    failure = 0
    await click(wrapper, '保留修改，另存为新方案')
    expect(template?.schema.name).toBe('冲突时的本地修改')
    const publishButton = wrapper.findAll('button').find(button => button.text() === '发布已保存版本')!
    expect((publishButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(page.schema.name).toBe('已有页面内容')
  })

  it('只改页面名发生冲突再另存失败，仍保留原页面绑定和离开保护', async () => {
    const { wrapper, router } = await render()
    await openPage(wrapper)
    await wrapper.get('input[aria-label="页面配置名称"]').setValue('只改页面名且不得丢失')
    failure = 409
    await click(wrapper, '保存页面草稿')
    expect(wrapper.text()).toContain('版本冲突')
    expect(page.name).toBe('已有页面草稿')
    failure = 503
    await click(wrapper, '保留修改，另存为新方案')
    expect(writes.at(-1)).toMatchObject({ path: '/api/admin/templates', method: 'POST' })
    expect(template).toBeUndefined()
    expect(wrapper.get('.work-status').text()).toContain('页面草稿 r1')
    expect(wrapper.get('.work-status').text()).toContain('保存失败')
    expect((wrapper.get('input[aria-label="页面配置名称"]').element as HTMLInputElement).value).toBe('只改页面名且不得丢失')
    const publishButton = wrapper.findAll('button').find(button => button.text() === '发布已保存版本')!
    expect((publishButton.element as HTMLButtonElement).disabled).toBe(false)
    await router.push('/other')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/admin/workbench')
    expect((wrapper.get('input[aria-label="页面配置名称"]').element as HTMLInputElement).value).toBe('只改页面名且不得丢失')
  })

  it('会话中断卸载后同账号恢复未保存 V2，其他账号不能看到或消费恢复内容', async () => {
    const owner = copy(authState.user!)
    const { wrapper } = await render()
    await wrapper.get('input[aria-label="方案名称"]').setValue('只属于原账号的中断编辑')
    authState.user = null
    await flushPromises()
    expect(wrapper.find('input[aria-label="方案名称"]').exists()).toBe(false)
    authState.user = { ...owner, userId: 'another-ux-admin', username: 'another_admin' }
    await flushPromises()
    expect((wrapper.get('input[aria-label="方案名称"]').element as HTMLInputElement).value).toBe('新方案')
    expect(wrapper.text()).not.toContain('只属于原账号的中断编辑')
    expect(wrapper.text()).not.toContain('已恢复本账号中断前的编辑')
    authState.user = null
    await flushPromises()
    authState.user = owner
    await flushPromises()
    expect((wrapper.get('input[aria-label="方案名称"]').element as HTMLInputElement).value).toBe('只属于原账号的中断编辑')
    expect(wrapper.text()).toContain('已恢复本账号中断前的编辑，修改尚未保存到服务器')
    expect(wrapper.get('.work-status').text()).toContain('存在未保存修改')
    expect(writes).toHaveLength(0)
  })

  it('组件目录 apiKey 入口中断后恢复原节点，不因残留 query 重复添加', async () => {
    const owner = copy(authState.user!)
    const { wrapper, router } = await render('/admin/workbench?apiKey=input')
    const originalIds = wrapper.findAll('.node-item[data-node-id]').map(node => node.attributes('data-node-id'))
    expect(originalIds).toHaveLength(1)
    expect(router.currentRoute.value.query.apiKey).toBe('input')
    authState.user = null
    await flushPromises()
    authState.user = owner
    await flushPromises()
    expect(wrapper.text()).toContain('已恢复本账号中断前的编辑')
    const restoredIds = wrapper.findAll('.node-item[data-node-id]').map(node => node.attributes('data-node-id'))
    expect(restoredIds).toEqual(originalIds)
    expect(writes).toHaveLength(0)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ComponentConfigView from '../views/ComponentConfigView.vue'
import DynamicPageView from '../views/DynamicPageView.vue'
import PageRegion from '../components/workbench/PageRegion.vue'
import WorkbenchRenderer from '../components/workbench/WorkbenchRenderer.vue'
import { createDefaultComponentSchema } from '../../shared/contracts/component-config.ts'
import { authState } from '../stores/auth'
import {
  getSchemaV2Error,
  isRuntimeSchema,
  type PageConfig,
  type PublishedPage,
  type WorkbenchTemplate,
} from '../../shared/contracts/workbench.ts'
const wrappers: ReturnType<typeof mount>[] = []
const templateId = 'd452be9b-5555-4444-8888-1c0f3db50001',
  pageId = 'd452be9b-5555-4444-8888-1c0f3db50002',
  time = '2026-10-15T00:00:00Z'
let savedTemplate: WorkbenchTemplate | undefined,
  savedPage: PageConfig | undefined,
  published: PublishedPage | undefined
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  failSave = false
const writes: { path: string; body: Record<string, unknown> }[] = []
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
beforeEach(() => {
  Object.assign(authState, {
    user: { userId: 'admin-id', username: 'admin', role: 'admin' },
    ready: true,
  })
  savedTemplate = undefined
  savedPage = undefined
  published = undefined
  writes.length = 0
  failSave = false
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = String(input),
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    if (body) {
      writes.push({ path, body })
      if (failSave) return Response.json({ message: '模拟保存失败，编辑仍保留' }, { status: 503 })
    }
    if (path === '/api/admin/templates' && !body)
      return Response.json(savedTemplate ? [savedTemplate] : [])
    if (path === '/api/admin/page-configs' && !body)
      return Response.json(savedPage ? [savedPage] : [])
    if (path === `/api/admin/templates/${templateId}` && !body) return Response.json(savedTemplate)
    if (path === `/api/admin/page-configs/${pageId}` && !body) return Response.json(savedPage)
    if (path.startsWith('/api/admin/templates') && body) {
      const schemaError = getSchemaV2Error(body.schema)
      if (schemaError) return Response.json({ message: schemaError }, { status: 400 })
      savedTemplate = {
        configId: templateId,
        schema: copy(body.schema as WorkbenchTemplate['schema']),
        revision: (savedTemplate?.revision ?? 0) + 1,
        createdTime: time,
        updatedTime: time,
      }
      return Response.json(savedTemplate)
    }
    if (path.endsWith('/publish') && body && savedPage) {
      if (body.expectedRevision !== savedPage.draftRevision)
        return Response.json({ message: '版本冲突' }, { status: 409 })
      savedPage = {
        ...savedPage,
        publishedRevision: savedPage.draftRevision,
        publishedTime: time,
        status: 'published',
      }
      published = {
        pageConfigId: savedPage.pageConfigId,
        name: savedPage.name,
        target: copy(savedPage.target),
        schema: copy(savedPage.schema),
        publishedRevision: savedPage.draftRevision,
        publishedTime: time,
      }
      return Response.json(savedPage)
    }
    if (path.startsWith('/api/admin/page-configs') && body) {
      if (!isRuntimeSchema(body.schema))
        return Response.json({ message: 'Schema无效' }, { status: 400 })
      savedPage = {
        pageConfigId: pageId,
        name: String(body.name),
        target: savedPage?.target ?? copy(body.target as PageConfig['target']),
        schema: copy(body.schema as PageConfig['schema']),
        draftRevision: (savedPage?.draftRevision ?? 0) + 1,
        publishedRevision: savedPage?.publishedRevision ?? null,
        publishedTime: savedPage?.publishedTime ?? null,
        status: savedPage?.publishedRevision ? 'changed' : 'draft',
        createdTime: time,
        updatedTime: time,
      }
      return Response.json(savedPage)
    }
    if (path.startsWith('/api/ui/') && published) return Response.json(published)
    return Response.json({ message: '尚未发布' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.unstubAllGlobals()
})
async function render(
  component:
    typeof ComponentConfigView | typeof DynamicPageView | typeof PageRegion = ComponentConfigView,
  props: Record<string, unknown> = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/workbench', component: ComponentConfigView },
      { path: '/pages/:pageKey', component: DynamicPageView },
    ],
  })
  await router.push(component === DynamicPageView ? '/pages/new-page' : '/admin/workbench')
  const wrapper = mount(component, { props, global: { plugins: [ElementPlus, router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
async function click(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((button) => button.text() === text)
  expect(button, `找不到按钮${text}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
describe('完整 Schema 工作台到页面发布', () => {
  it('真实编辑节点和预览，保存Schema不保存预览输入，再按版本更新及重新加载', async () => {
    const wrapper = await render()
    await wrapper.get('input[aria-label="方案名称"]').setValue('可复用输入方案')
    await click(wrapper, '添加根节点')
    await click(wrapper, '校验并预览')
    const preview = wrapper.findComponent(WorkbenchRenderer)
    await preview.get('input').setValue('这段用户预览输入不应保存')
    await click(wrapper, '保存方案')
    expect(savedTemplate?.schema.name).toBe('可复用输入方案')
    expect(savedTemplate?.schema.schemaVersion).toBe(2)
    expect(JSON.stringify(writes)).not.toContain('不应保存')
    expect(Object.keys(writes[0]!.body)).toEqual(['schema'])
    await wrapper.get('input[aria-label="方案名称"]').setValue('更新方案')
    await click(wrapper, '保存方案')
    expect(writes[1]!.body.expectedRevision).toBe(1)
    expect(savedTemplate?.revision).toBe(2)
    await wrapper.get('input[aria-label="方案名称"]').setValue('未保存的修改')
    await click(wrapper, '重新加载当前方案')
    expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty('value', '更新方案')
  })
  it('独立页面保存发布后从公共发布API重新渲染，未发布修改不泄露', async () => {
    const wrapper = await render()
    await click(wrapper, '添加根节点')
    await wrapper.get('input[aria-label="页面配置名称"]').setValue('团队记录页')
    await click(wrapper, '保存页面草稿')
    expect(savedPage?.target).toEqual({ kind: 'dynamic', pageKey: 'new-page', regionKey: 'root' })
    await click(wrapper, '发布已保存版本')
    expect(published?.publishedRevision).toBe(1)
    const page = await render(DynamicPageView)
    expect(page.text()).toContain('团队记录页')
    expect(page.find('input').exists()).toBe(true)
    await wrapper.get('input[aria-label="方案名称"]').setValue('尚未保存')
    await click(wrapper, '发布已保存版本')
    expect(wrapper.text()).toContain('当前修改尚未保存')
    expect(writes.filter((write) => write.path.endsWith('/publish'))).toHaveLength(1)
    await click(wrapper, '保存页面草稿')
    expect(savedPage?.status).toBe('changed')
    const reloaded = await render(DynamicPageView)
    expect(reloaded.find('input').exists()).toBe(true)
    expect(published?.schema.name).not.toBe('尚未保存')
  })
  it('既有区域只取冻结发布快照，404区域保持空，不影响Idea页面', async () => {
    const empty = await render(PageRegion, { pageKey: 'home', regionKey: 'after-entry' })
    expect(empty.text()).toBe('')
    published = {
      pageConfigId: pageId,
      name: '首页补充',
      target: { kind: 'existing', pageKey: 'home', regionKey: 'after-entry' },
      schema: {
        schemaVersion: 2,
        libraryKey: 'element-plus',
        libraryVersion: '2.14.5',
        name: '区域文本',
        root: [
          {
            kind: 'text',
            nodeId: 'message',
            value: { kind: 'literal', value: '发布到首页的内容' },
          },
        ],
        state: {},
        resources: [],
      },
      publishedRevision: 1,
      publishedTime: time,
    }
    const region = await render(PageRegion, { pageKey: 'home', regionKey: 'after-entry' })
    expect(region.text()).toContain('发布到首页的内容')
    expect(
      fetchMock.mock.calls.some((call) => call[0] === '/api/ui/regions/home/after-entry'),
    ).toBe(true)
  })
  it('V1页面重新加载后保存和发布使用原始V1，绝不使用遗留V2草稿覆盖', async () => {
    const legacy = createDefaultComponentSchema('input')
    legacy.name = '旧输入方案'
    legacy.props = { placeholder: '兼容V1输入', maxlength: 64 }
    savedPage = {
      pageConfigId: pageId,
      name: 'V1首页区域',
      target: { kind: 'existing', pageKey: 'home', regionKey: 'after-entry' },
      schema: legacy,
      draftRevision: 3,
      publishedRevision: null,
      publishedTime: null,
      status: 'draft',
      createdTime: time,
      updatedTime: time,
    }
    const wrapper = await render()
    await wrapper.get('input[aria-label="方案名称"]').setValue('遗留V2草稿不得覆盖')
    const input = wrapper.get('input[aria-label="已有页面配置"]')
    await input.trigger('click')
    await flushPromises()
    const popup = document.getElementById(input.attributes('aria-controls') ?? '')
    const option = [...(popup ?? document).querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.includes('V1首页区域'),
    )
    expect(option).toBeDefined()
    option!.click()
    await flushPromises()
    expect(wrapper.text()).toContain('V1方案：旧输入方案')
    expect(wrapper.find('input[placeholder="兼容V1输入"]').exists()).toBe(true)
    await click(wrapper, '保存页面草稿')
    expect(savedPage.schema).toEqual(legacy)
    expect(savedPage.draftRevision).toBe(4)
    await click(wrapper, '发布已保存版本')
    expect(published?.schema).toEqual(legacy)
    expect(published?.publishedRevision).toBe(4)
    expect(JSON.stringify(writes)).not.toContain('遗留V2草稿不得覆盖')
  })
  it('失败保留编辑内容并恢复按钮；普通用户直接挂载不触发后台请求', async () => {
    const wrapper = await render()
    await wrapper.get('input[aria-label="方案名称"]').setValue('重试时保留')
    failSave = true
    await click(wrapper, '保存方案')
    expect(wrapper.text()).toContain('模拟保存失败')
    expect(wrapper.get('input[aria-label="方案名称"]').element).toHaveProperty(
      'value',
      '重试时保留',
    )
    expect(
      (
        wrapper.findAll('button').find((button) => button.text() === '保存方案')!
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false)
    Object.assign(authState, { user: { userId: 'user-id', username: 'user', role: 'user' } })
    fetchMock.mockClear()
    const denied = await render()
    expect(denied.text()).toContain('需要管理员权限')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

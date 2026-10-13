import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import ComponentConfigView from '../views/ComponentConfigView.vue'
import ComponentsView from '../views/ComponentsView.vue'
import { authState } from '../stores/auth'
import { COMPONENT_DEFINITIONS } from '../../shared/contracts/component-config.ts'
import type { ComponentConfig, ComponentSchema } from '../../shared/contracts/component-config.ts'

const wrappers: ReturnType<typeof mount>[] = []
const configId = 'fb31b121-3d89-4e6f-b45e-7ca3c042b9ec'
let stored: ComponentConfig | undefined
let writes: { method: string; body: unknown }[]
let failSave = false
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  Object.assign(authState, { user: { userId: 'config-admin', username: 'admin', role: 'admin' }, ready: true })
  stored = undefined
  writes = []
  failSave = false
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = String(input)
    if (path === '/api/component-definitions') return Response.json(COMPONENT_DEFINITIONS)
    if (path === '/api/component-configs') return Response.json(stored ? [stored] : [])
    if (path === `/api/component-configs/${configId}`) return stored ? Response.json(stored) : Response.json({ message: '配置不存在' }, { status: 404 })
    if (path === '/api/admin/component-configs' || path === `/api/admin/component-configs/${configId}`) {
      writes.push({ method: init?.method ?? '', body: JSON.parse(String(init?.body)) as unknown })
      if (failSave) return Response.json({ message: '服务暂时不可用，请稍后重试' }, { status: 503 })
      const schema = (JSON.parse(String(init?.body)) as { schema: ComponentSchema }).schema
      stored = { configId, schema, createdTime: '2026-10-13T00:00:00Z', updatedTime: '2026-10-13T00:00:00Z' }
      return Response.json(stored, { status: init?.method === 'POST' ? 201 : 200 })
    }
    return Response.json({ message: '未找到' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals() })
async function render(component: typeof ComponentConfigView | typeof ComponentsView) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/components', component: ComponentsView }] })
  await router.push('/components')
  const wrapper = mount(component, { global: { plugins: [router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
async function click(wrapper: ReturnType<typeof mount>, text: string) {
  await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click')
  await flushPromises()
}

describe('配置式创建与展示的页面流程', () => {
  it('创建、预览、保存、重载和修改复用同一实例；预览值不提交', async () => {
    const wrapper = await render(ComponentConfigView)
    expect(wrapper.text()).toContain('使用输入框创建')
    expect(wrapper.text()).toContain('使用多行输入框创建')
    expect(wrapper.text()).toContain('使用按钮创建')
    await wrapper.get('input[aria-label="配置名称"]').setValue('标题输入')
    await wrapper.get('textarea[aria-label="组件属性 JSON"]').setValue('{"placeholder":"自定义标题提示","maxlength":64}')
    await click(wrapper, '校验并预览')
    await wrapper.get('input[placeholder="自定义标题提示"]').setValue('不应持久化的私密预览值')
    await click(wrapper, '保存配置')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.method).toBe('POST')
    expect(Object.keys(writes[0]?.body as object)).toEqual(['schema'])
    expect(JSON.stringify(writes[0]?.body)).not.toContain('私密预览值')
    expect(stored?.schema.name).toBe('标题输入')

    const latest = stored!.schema
    if (latest.componentKey === 'button') throw new Error('本测试创建的是输入实例')
    stored = { ...stored!, schema: { ...latest, props: { placeholder: '服务端最新提示', maxlength: 64 } } }
    await click(wrapper, '重新加载当前配置')
    expect(wrapper.get('textarea[aria-label="组件属性 JSON"]').element).toHaveProperty('value', expect.stringContaining('服务端最新提示'))
    await wrapper.get('input[aria-label="配置名称"]').setValue('修改后的标题输入')
    await click(wrapper, '保存配置')
    expect(writes[1]?.method).toBe('PUT')
    expect(stored?.configId).toBe(configId)
    const display = await render(ComponentsView)
    expect(display.text()).toContain('修改后的标题输入')
    expect(display.get('input').attributes('placeholder')).toBe('服务端最新提示')
  })

  it('非法 JSON 或可执行属性会阻止保存，不把错误配置交给 HTTP', async () => {
    const wrapper = await render(ComponentConfigView)
    await wrapper.get('textarea[aria-label="组件属性 JSON"]').setValue('{')
    await click(wrapper, '保存配置')
    expect(wrapper.text()).toContain('有效 JSON')
    expect(writes).toHaveLength(0)
    await wrapper.get('textarea[aria-label="组件属性 JSON"]').setValue('{"onInput":"alert(1)"}')
    await click(wrapper, '保存配置')
    expect(wrapper.text()).toContain('未支持的属性')
    expect(writes).toHaveLength(0)
  })

  it('HTTP 保存失败保留配置编辑内容并恢复按钮', async () => {
    failSave = true
    const wrapper = await render(ComponentConfigView)
    await wrapper.get('input[aria-label="配置名称"]').setValue('等待重试的配置')
    await click(wrapper, '保存配置')
    expect(wrapper.text()).toContain('服务暂时不可用')
    expect((wrapper.get('input[aria-label="配置名称"]').element as HTMLInputElement).value).toBe('等待重试的配置')
    expect((wrapper.findAll('button').find(button => button.text() === '保存配置')!.element as HTMLButtonElement).disabled).toBe(false)
    expect(stored).toBeUndefined()
  })

  it('普通用户不能通过直接挂载管理页触发配置查询或写入', async () => {
    Object.assign(authState, { user: { userId: 'normal-user', username: 'user', role: 'user' } })
    const wrapper = await render(ComponentConfigView)
    expect(wrapper.text()).toContain('仅管理员可以配置组件')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('input[aria-label="配置名称"]').exists()).toBe(false)
  })
})

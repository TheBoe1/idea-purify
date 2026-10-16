import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import assert from 'node:assert/strict'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import LegacyConfigEditor from '../components/workbench/LegacyConfigEditor.vue'
import { authState } from '../stores/auth'
import { clearWorkbenchRecovery } from '../stores/workbenchRecovery'
import * as api from '../api/componentConfigs'
import {
  COMPONENT_DEFINITIONS,
  createDefaultComponentSchema,
  type ComponentConfig,
} from '../../shared/contracts/component-config.ts'

vi.mock('../api/componentConfigs', () => ({
  loadComponentDefinitions: vi.fn<typeof api.loadComponentDefinitions>(),
  loadComponentConfigs: vi.fn<typeof api.loadComponentConfigs>(),
  loadComponentConfig: vi.fn<typeof api.loadComponentConfig>(),
  saveComponentConfig: vi.fn<typeof api.saveComponentConfig>(),
}))
const wrappers: ReturnType<typeof mount>[] = []
const admin = {
  userId: 'legacy-admin',
  username: 'admin',
  role: 'admin' as const,
  email: null,
  emailVerified: false,
  disabled: false,
  createdTime: '2026-10-15T00:00:00Z',
}
const stored: ComponentConfig = {
  configId: 'legacy-1',
  schema: { ...createDefaultComponentSchema('input'), name: '服务端配置' },
  createdTime: '2026-10-15T00:00:00Z',
  updatedTime: '2026-10-15T00:00:00Z',
}
let confirm: MockInstance<typeof ElMessageBox.confirm>
beforeEach(() => {
  vi.clearAllMocks()
  clearWorkbenchRecovery()
  Object.assign(authState, { user: admin, ready: true })
  vi.mocked(api.loadComponentDefinitions).mockResolvedValue(COMPONENT_DEFINITIONS)
  vi.mocked(api.loadComponentConfigs).mockResolvedValue([stored])
  vi.mocked(api.loadComponentConfig).mockResolvedValue(stored)
  vi.mocked(api.saveComponentConfig).mockImplementation(async (schema) => ({ ...stored, schema }))
  // Element Plus 2.14.5 declares the resolved data as an impossible intersection;
  // confirm actually resolves the action string and this component only awaits it.
  confirm = vi.spyOn(ElMessageBox, 'confirm').mockImplementation(async () => 'confirm' as never)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
  clearWorkbenchRecovery()
})
async function render(navigationManaged = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: LegacyConfigEditor, props: { navigationManaged } },
      { path: '/other', component: { template: '<p>其他页面</p>' } },
      { path: '/components', component: { template: '<p>组件展示</p>' } },
    ],
  })
  await router.push('/')
  const wrapper = mount(defineComponent({ setup: () => () => h(RouterView) }), {
    global: { plugins: [router, ElementPlus], stubs: { SchemaRenderer: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, editor: wrapper.getComponent(LegacyConfigEditor) }
}
async function click(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  assert.ok(button, `找不到按钮：${text}`)
  await button.trigger('click')
  await flushPromises()
}
async function selectSaved(wrapper: ReturnType<typeof mount>) {
  const select = wrapper
    .findAllComponents({ name: 'ElSelect' })
    .find((item) => item.find('input[aria-label="已有配置"]').exists())
  expect(select).toBeDefined()
  select!.vm.$emit('change', stored.configId)
  await flushPromises()
}

describe('V1 兼容编辑器未保存保护', () => {
  it('默认空配置不脏；非法JSON也会被保护，新建取消不覆盖输入，确认才替换', async () => {
    const { wrapper, editor } = await render()
    expect(editor.emitted('dirty-change')?.at(-1)).toEqual([false])
    await wrapper.get('textarea[aria-label="组件属性 JSON"]').setValue('{未完成')
    expect(editor.emitted('dirty-change')?.at(-1)).toEqual([true])
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    confirm.mockRejectedValueOnce('cancel')
    await click(wrapper, '新建配置')
    expect(wrapper.get('textarea[aria-label="组件属性 JSON"]').element).toHaveProperty(
      'value',
      '{未完成',
    )
    await click(wrapper, '新建配置')
    expect(wrapper.get('input[aria-label="配置名称"]').element).toHaveProperty(
      'value',
      createDefaultComponentSchema('input').name,
    )
    expect(editor.emitted('dirty-change')?.at(-1)).toEqual([false])
  })

  it('切换已有配置取消时不发加载请求，确认后才读取并建立新基线', async () => {
    const { wrapper, editor } = await render()
    await wrapper.get('input[aria-label="配置名称"]').setValue('等待保存')
    confirm.mockRejectedValueOnce('cancel')
    await selectSaved(wrapper)
    expect(api.loadComponentConfig).not.toHaveBeenCalled()
    expect(wrapper.get('input[aria-label="配置名称"]').element).toHaveProperty('value', '等待保存')
    await selectSaved(wrapper)
    expect(api.loadComponentConfig).toHaveBeenCalledWith(stored.configId)
    expect(wrapper.get('input[aria-label="配置名称"]').element).toHaveProperty(
      'value',
      '服务端配置',
    )
    expect(editor.emitted('dirty-change')?.at(-1)).toEqual([false])
  })

  it('保存失败仍为dirty且可重试；成功后清除dirty，向父报告真实请求状态', async () => {
    const { wrapper, editor } = await render()
    await wrapper.get('input[aria-label="配置名称"]').setValue('需要重试')
    vi.mocked(api.saveComponentConfig).mockRejectedValueOnce(new Error('网络中断'))
    await click(wrapper, '保存配置')
    expect(wrapper.text()).toContain('保存失败，修改仍保留')
    expect(editor.emitted('dirty-change')?.at(-1)).toEqual([true])
    expect(editor.emitted('saving-change')?.slice(-2)).toEqual([[true], [false]])
    await click(wrapper, '保存配置')
    expect(editor.emitted('dirty-change')?.at(-1)).toEqual([false])
    expect(wrapper.text()).toContain('已保存')
  })

  it('独立路由可取消离开；交给父管理时不会重复弹框', async () => {
    const { wrapper, router } = await render()
    await wrapper.get('input[aria-label="配置名称"]').setValue('不要丢失')
    confirm.mockRejectedValueOnce('cancel')
    await router.push('/other')
    expect(router.currentRoute.value.path).toBe('/')
    await router.push('/other')
    expect(router.currentRoute.value.path).toBe('/other')
    const managed = await render(true)
    await managed.wrapper.get('input[aria-label="配置名称"]').setValue('由父保护')
    confirm.mockClear()
    await managed.router.push('/other')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('65字符名称保持完整并报错，阻止保存而不会静默截断', async () => {
    const { wrapper } = await render()
    const name = '长'.repeat(65)
    await wrapper.get('input[aria-label="配置名称"]').setValue(name)
    await flushPromises()
    expect(wrapper.get('input[aria-label="配置名称"]').element).toHaveProperty('value', name)
    await vi.waitFor(() => expect(wrapper.text()).toContain('最多 64 字符，当前 65'))
    await click(wrapper, '保存配置')
    expect(api.saveComponentConfig).not.toHaveBeenCalled()
  })

  it('被动会话失效保留本页原始JSON，仅相同账号重新进入时恢复', async () => {
    const { wrapper } = await render()
    await wrapper.get('input[aria-label="配置名称"]').setValue('401 后恢复')
    await wrapper.get('textarea[aria-label="组件属性 JSON"]').setValue('{未完成的JSON')
    authState.user = null
    await flushPromises()
    wrapper.unmount()
    Object.assign(authState, { user: { ...admin, userId: 'other-admin' } })
    const other = await render()
    expect(other.wrapper.get('input[aria-label="配置名称"]').element).not.toHaveProperty(
      'value',
      '401 后恢复',
    )
    other.wrapper.unmount()
    Object.assign(authState, { user: admin })
    const restored = await render()
    expect(restored.wrapper.get('input[aria-label="配置名称"]').element).toHaveProperty(
      'value',
      '401 后恢复',
    )
    expect(restored.wrapper.get('textarea[aria-label="组件属性 JSON"]').element).toHaveProperty(
      'value',
      '{未完成的JSON',
    )
    expect(restored.editor.emitted('dirty-change')?.at(-1)).toEqual([true])
    expect(restored.wrapper.text()).toContain('已恢复此账号')
  })

  it('旧账号的保存响应不能覆盖切换后的编辑器或错误显示保存成功', async () => {
    const { wrapper, editor } = await render()
    let release!: (saved: ComponentConfig) => void
    vi.mocked(api.saveComponentConfig).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    await wrapper.get('input[aria-label="配置名称"]').setValue('账号 A 的保存')
    await click(wrapper, '保存配置')
    expect(editor.emitted('saving-change')?.at(-1)).toEqual([true])
    authState.user = null
    await flushPromises()
    authState.user = { ...admin, userId: 'account-b' }
    await flushPromises()
    release({ ...stored, schema: { ...stored.schema, name: '账号 A 的保存' } })
    await flushPromises()
    expect(wrapper.get('input[aria-label="配置名称"]').element).toHaveProperty(
      'value',
      createDefaultComponentSchema('input').name,
    )
    expect(wrapper.text()).not.toContain('上次保存：')
    expect(editor.emitted('dirty-change')?.at(-1)).toEqual([false])
    expect(editor.emitted('saving-change')?.at(-1)).toEqual([false])
  })
})

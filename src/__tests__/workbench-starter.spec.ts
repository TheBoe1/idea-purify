import { describe, expect, it, vi } from 'vitest'
import { simpleForm } from '../components/workbench/starter'
import { getSchemaV2Error } from '../../shared/contracts/workbench.ts'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import WorkbenchRenderer from '../components/workbench/WorkbenchRenderer.vue'

describe('简单表单起点', () => {
  it('已有公开契约可保存，真实预览可检验非法及合法值，不写业务API', async () => {
    const schema = simpleForm()
    expect(getSchemaV2Error(schema)).toBeUndefined()
    const wrapper = mount(WorkbenchRenderer, {
      props: { schema },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('请输入 2–80 个字符'))
    await wrapper.get('input').setValue('合格标题')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('.el-form-item__error').exists()).toBe(false))
    wrapper.unmount()
  })
})

describe('实时预览服务隔离', () => {
  it('预览反复重建不会自动弹服务，手动按钮和正式发布mount仍可运行', async () => {
    const { createDefaultSchemaV2 } = await import('../../shared/contracts/workbench.ts')
    const schema = createDefaultSchemaV2('服务隔离')
    schema.root = [
      {
        kind: 'service',
        apiKey: 'message',
        nodeId: 'notice',
        trigger: 'mount',
        props: { message: { kind: 'literal', value: '服务隔离验收' } },
      },
    ]
    const preview = mount(WorkbenchRenderer, {
      props: { schema },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    expect(document.body.textContent).not.toContain('服务隔离验收')
    await preview.setProps({ schema: JSON.parse(JSON.stringify(schema)) })
    await flushPromises()
    expect(document.body.textContent).not.toContain('服务隔离验收')
    await preview.get('button').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('服务隔离验收')
    preview.unmount()
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('服务隔离验收'))
    const published = mount(WorkbenchRenderer, {
      props: { schema, mode: 'published' },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    expect(document.body.textContent).toContain('服务隔离验收')
    published.unmount()
  })
})

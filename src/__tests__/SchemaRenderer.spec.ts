import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import SchemaRenderer from '../components/schema/SchemaRenderer.vue'
import type { ComponentSchema } from '../../shared/contracts/component-config.ts'

const input: ComponentSchema = { schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'input',
  name: '复用输入', props: { placeholder: '输入配置预览', maxlength: 20 }, field: 'title',
  validation: { required: true, minLength: 2, maxLength: 20 }, children: [] }
const button: ComponentSchema = { schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'button',
  name: '消息按钮', props: { text: '查看提示', type: 'primary' }, children: [],
  actions: [{ event: 'click', actionKey: 'show-message', message: '<img src=x onerror=alert(1)>' }] }
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); ElMessage.closeAll() })
function render(schema: unknown) {
  const wrapper = mount(SchemaRenderer, { attachTo: document.body, props: { schema }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

describe('白名单配置组件的用户行为', () => {
  it('输入显示属性、在失焦后验证，修改配置会清除预览值', async () => {
    const schema = structuredClone(input)
    const wrapper = render(schema)
    expect(wrapper.get('input').attributes('placeholder')).toBe('输入配置预览')
    ;(wrapper.get('input').element as HTMLInputElement).focus()
    await flushPromises()
    ;(wrapper.get('input').element as HTMLInputElement).blur()
    await flushPromises()
    expect(wrapper.text()).toContain('此字段为必填项')
    await wrapper.get('input').setValue('字')
    expect(wrapper.text()).toContain('至少输入 2 个字符')
    await wrapper.get('input').setValue('用户输入')
    expect(wrapper.text()).not.toContain('至少输入')
    expect(schema).toEqual(input)
    await wrapper.setProps({ schema: { ...input, name: '新实例' } })
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('多行输入映射为 textarea，同页复用输入具有独立标签关联', async () => {
    const wrapper = mount({ components: { SchemaRenderer },
      data: () => ({ input, textarea: { ...input, componentKey: 'textarea', props: { rows: 4, maxlength: 20 } } }),
      template: '<div><SchemaRenderer :schema="input" /><SchemaRenderer :schema="textarea" /></div>',
    }, { global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    const [a, b] = wrapper.findAllComponents(SchemaRenderer)
    expect(a && b).toBeTruthy()
    expect(b!.get('textarea').attributes('rows')).toBe('4')
    expect(a!.get('label').attributes('for')).toBe(a!.get('input').attributes('id'))
    expect(b!.get('label').attributes('for')).toBe(b!.get('textarea').attributes('id'))
    expect(a!.get('input').attributes('id')).not.toBe(b!.get('textarea').attributes('id'))
  })

  it.each([null, { ...input, componentKey: 'script' }, { ...input, props: { onInput: 'alert(1)' } }, { ...input, schemaVersion: 99 }])(
    '异常配置显示局部错误并保持其他实例可操作', async invalid => {
      const bad = render(invalid)
      const good = render(input)
      expect(bad.find('[role="alert"]').exists()).toBe(true)
      expect(bad.find('input').exists()).toBe(false)
      await good.get('input').setValue('正常实例')
      expect((good.get('input').element as HTMLInputElement).value).toBe('正常实例')
    },
  )

  it('组件名称、按钮标签及固定动作消息均显示字面文本', async () => {
    const wrapper = render({ ...button, name: '<script>alert(1)</script>', props: { text: '<img src=x>' } })
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.get('button').text()).toBe('<img src=x>')
    expect(wrapper.find('script, img').exists()).toBe(false)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const message = document.querySelector('.el-message')!
    expect(message.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(message.querySelector('img')).toBeNull()
  })
})

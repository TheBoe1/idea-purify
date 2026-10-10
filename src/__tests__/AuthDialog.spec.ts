import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AuthDialog from '../components/AuthDialog.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    document.body.innerHTML = ''
})
async function renderDialog() {
    const wrapper = mount(AuthDialog, {
        attachTo: document.body,
        props: { modelValue: true, loading: false, errorMessage: '', notice: '' },
        global: { plugins: [ElementPlus], stubs: { teleport: true } },
    })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
}

describe('登录注册弹窗', () => {
    it('切换登录和注册会清除密码，同时保留用户名', async () => {
        const wrapper = await renderDialog()
        await wrapper.get('#auth-username').setValue('alice')
        await wrapper.get('#auth-password').setValue('a valid password')
        await wrapper.findAll('button').find(button => button.text() === '没有账号，去注册')!.trigger('click')
        expect((wrapper.get('#auth-password').element as HTMLInputElement).value).toBe('')
        expect((wrapper.get('#auth-username').element as HTMLInputElement).value).toBe('alice')
    })
    it('允许不填邮箱注册，只发送用户名和密码', async () => {
        const wrapper = await renderDialog()
        await wrapper.findAll('button').find(button => button.text() === '没有账号，去注册')!.trigger('click')
        await wrapper.get('#auth-username').setValue('alice')
        await wrapper.get('#auth-password').setValue('a valid password')
        await wrapper.get('#auth-password-confirm').setValue('a valid password')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.emitted('register')).toEqual([[{ username: 'alice', password: 'a valid password' }]])
    })
    it('拒绝不符合规则的用户名和不一致密码', async () => {
        const wrapper = await renderDialog()
        await wrapper.findAll('button').find(button => button.text() === '没有账号，去注册')!.trigger('click')
        await wrapper.get('#auth-username').setValue('<script>')
        await wrapper.get('#auth-password').setValue('a valid password')
        await wrapper.get('#auth-password-confirm').setValue('different password')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.emitted('register')).toBeUndefined()
        expect(wrapper.text()).toContain('两次输入的密码不一致')
        await wrapper.get('#auth-password-confirm').setValue('a valid password')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.emitted('register')).toBeUndefined()
        expect(wrapper.text()).toContain('用户名需为')
    })
})

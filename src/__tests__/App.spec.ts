import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import App from '../App.vue'
import ElementPlus from 'element-plus'

describe('App', () => {
  it('mounts renders properly', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [ElementPlus],
        stubs: {
          RouterView: true,
          RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        },
      },
    })
    expect(wrapper.get('a[href="/"]').text()).toBe('首页')
    expect(wrapper.get('a[href="/archive"]').text()).toBe('归档')
    wrapper.unmount()
  })
})

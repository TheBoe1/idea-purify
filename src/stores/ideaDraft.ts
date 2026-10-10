import { reactive } from 'vue'

// 只保留在当前页面的内存中，重新登录不会丢掉未提交内容。
export const ideaDraft = reactive({ ideaContent: '', ownerId: '' })
export function clearIdeaDraft() { ideaDraft.ideaContent = ''; ideaDraft.ownerId = '' }

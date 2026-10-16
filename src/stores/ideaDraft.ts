import { reactive, watch } from 'vue'
import { authState } from './auth'

const STORAGE_PREFIX = 'idea-purify:unsubmitted-idea:v1:'
type PersistenceState = 'empty' | 'saved' | 'failed' | 'memory-only'

// 这是尚未提交的 Idea；与工作台方案、发布版本完全独立。
export const ideaDraft = reactive({
  ideaContent: '',
  ownerId: '',
  revision: 0,
  persistenceState: 'empty' as PersistenceState,
  persistenceError: '',
  restored: false,
})
let restoring = false
let readFailed = false

function storageKey(ownerId: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(ownerId)}`
}

export function persistIdeaDraft() {
  if (!ideaDraft.ownerId || authState.user?.userId !== ideaDraft.ownerId) {
    ideaDraft.persistenceState = ideaDraft.ideaContent ? 'memory-only' : 'empty'
    return
  }
  if (readFailed) {
    activateIdeaDraft(ideaDraft.ownerId, true)
    return
  }
  try {
    if (ideaDraft.ideaContent) {
      window.sessionStorage.setItem(
        storageKey(ideaDraft.ownerId),
        JSON.stringify({
          ownerId: ideaDraft.ownerId,
          ideaContent: ideaDraft.ideaContent,
        }),
      )
    } else {
      window.sessionStorage.removeItem(storageKey(ideaDraft.ownerId))
    }
    ideaDraft.persistenceState = ideaDraft.ideaContent ? 'saved' : 'empty'
    ideaDraft.persistenceError = ''
  } catch {
    ideaDraft.persistenceState = 'failed'
    ideaDraft.persistenceError = ideaDraft.ideaContent
      ? '本标签暂存失败，内容仍在当前页面。请重试或先提交；刷新、关闭页面可能丢失修改。'
      : '本标签旧草稿清理失败，刷新可能恢复旧内容。请重试清理。'
  }
}

export function activateIdeaDraft(ownerId: string, retryRead = false) {
  if (!ownerId || authState.user?.userId !== ownerId) return
  // 会话失效后，同账号重新登录继续使用当前内存，不能用旧缓存覆盖新修改。
  if (ideaDraft.ownerId === ownerId && !retryRead) {
    persistIdeaDraft()
    return
  }
  restoring = true
  ideaDraft.ownerId = ownerId
  ideaDraft.ideaContent = ''
  ideaDraft.revision += 1
  ideaDraft.restored = false
  ideaDraft.persistenceState = 'empty'
  ideaDraft.persistenceError = ''
  readFailed = false
  try {
    const stored = window.sessionStorage.getItem(storageKey(ownerId))
    if (stored) {
      const record: unknown = JSON.parse(stored)
      if (
        typeof record !== 'object' ||
        record === null ||
        !('ownerId' in record) ||
        record.ownerId !== ownerId ||
        !('ideaContent' in record) ||
        typeof record.ideaContent !== 'string'
      ) {
        throw new Error('Invalid draft')
      }
      ideaDraft.ideaContent = record.ideaContent
      ideaDraft.restored = Boolean(record.ideaContent)
      ideaDraft.persistenceState = record.ideaContent ? 'saved' : 'empty'
    }
  } catch {
    readFailed = true
    ideaDraft.persistenceState = 'failed'
    ideaDraft.persistenceError =
      '无法读取本标签未提交草稿，请检查浏览器存储权限后重试。已有缓存未被覆盖。'
  } finally {
    restoring = false
  }
}

function clearStoredIdeaDrafts() {
  try {
    const storage = window.sessionStorage
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    keys.forEach((key) => {
      if (key?.startsWith(STORAGE_PREFIX)) storage.removeItem(key)
    })
    ideaDraft.persistenceState = ideaDraft.ideaContent ? 'memory-only' : 'empty'
    ideaDraft.persistenceError = ''
  } catch {
    ideaDraft.persistenceState = 'failed'
    ideaDraft.persistenceError = '未能清理本标签缓存。请关闭此标签页，并检查浏览器存储设置。'
  }
}

// 提交成功/主动丢弃只清当前账号，不影响其他账号自己的缓存。
export function discardIdeaDraft() {
  readFailed = false
  ideaDraft.ideaContent = ''
  ideaDraft.restored = false
  ideaDraft.revision += 1
  persistIdeaDraft()
}

// 显式退出的既有入口：清理本标签全部未提交 Idea，保留其他业务的存储。
export function clearIdeaDraft() {
  readFailed = false
  restoring = true
  ideaDraft.ideaContent = ''
  ideaDraft.ownerId = ''
  ideaDraft.revision += 1
  ideaDraft.restored = false
  restoring = false
  clearStoredIdeaDrafts()
}

watch(
  () => [ideaDraft.ownerId, ideaDraft.ideaContent],
  () => {
    if (restoring) return
    readFailed = false
    ideaDraft.revision += 1
    ideaDraft.restored = false
    persistIdeaDraft()
  },
  { flush: 'sync' },
)

watch(
  () => [authState.user?.userId, authState.ready] as const,
  ([ownerId, ready]) => {
    if (ownerId) activateIdeaDraft(ownerId)
    else if (ready) clearStoredIdeaDrafts()
  },
  { flush: 'sync' },
)

// 站内导航后录入面板会卸载，保护仍需保留在 store。
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (
      ideaDraft.persistenceState === 'failed' ||
      (ideaDraft.ideaContent && ideaDraft.persistenceState !== 'saved')
    ) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
}

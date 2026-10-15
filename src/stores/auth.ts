import { reactive, watch } from 'vue'
import type { AuthUser } from '../../shared/contracts/auth.ts'
import { loadSession, updateProfile } from '@/api/auth'
import { advanceSessionGeneration, ApiError, getSessionGeneration, onUnauthorized } from '@/api/http'

export const authState = reactive({
    user: null as AuthUser | null,
    ready: false,
    dialogVisible: false,
    notice: '',
    sessionError: '',
})

// 包含现有退出/重置密码入口的身份清理；普通资料刷新不改变会话代次。
watch(() => authState.user?.userId, () => advanceSessionGeneration(), { flush: 'sync' })

function expireSession() {
    advanceSessionGeneration()
    authState.user = null
    authState.dialogVisible = true
    authState.notice = '登录状态已失效，请重新登录。尚未提交的想法已保留在当前页面。'
}
onUnauthorized(expireSession)

let checkingSession = false
let profileRevision = 0
export async function revalidateSession() {
    if (checkingSession || !authState.user) return
    const userId = authState.user.userId
    const requestGeneration = getSessionGeneration()
    const requestProfileRevision = profileRevision
    checkingSession = true
    try {
        const user = await loadSession()
        if (requestGeneration === getSessionGeneration() && requestProfileRevision === profileRevision && authState.user?.userId === userId) { authState.user = user; authState.sessionError = '' }
    } catch (error) {
        if (requestGeneration !== getSessionGeneration() || requestProfileRevision !== profileRevision || authState.user?.userId !== userId) return
        if (error instanceof ApiError && error.status === 401) expireSession()
        else authState.sessionError = error instanceof Error ? error.message : '暂时无法确认登录状态'
    } finally { checkingSession = false }
}

export async function initializeSession() {
    const requestGeneration = getSessionGeneration()
    const requestProfileRevision = profileRevision
    authState.sessionError = ''
    try {
        const user = await loadSession()
        if (requestGeneration !== getSessionGeneration() || requestProfileRevision !== profileRevision) return
        authState.user = user
        authState.ready = true
    } catch (error) {
        if (requestGeneration !== getSessionGeneration() || requestProfileRevision !== profileRevision) return
        authState.user = null
        authState.dialogVisible = true
        if (!(error instanceof ApiError && error.status === 401)) authState.sessionError = error instanceof Error ? error.message : '无法确认登录状态'
        authState.ready = true
    }
}

export function acceptSession(user: AuthUser) {
    profileRevision += 1
    advanceSessionGeneration()
    authState.user = user
    authState.ready = true
    authState.dialogVisible = false
    authState.notice = ''
    authState.sessionError = ''
}

export async function updateCurrentProfile(nickname: string): Promise<boolean> {
    const userId = authState.user?.userId
    if (!userId) return false
    const generation = getSessionGeneration()
    const revision = ++profileRevision
    try {
        const user = await updateProfile(nickname)
        if (generation !== getSessionGeneration() || revision !== profileRevision || authState.user?.userId !== userId) return false
        if (user.userId !== userId) throw new Error('资料结果的账号不匹配')
        profileRevision += 1
        authState.user = user
        return true
    } catch (error) {
        if (generation !== getSessionGeneration() || revision !== profileRevision || authState.user?.userId !== userId) return false
        throw error
    }
}

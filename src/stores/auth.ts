import { reactive } from 'vue'
import type { AuthUser } from '../../shared/contracts/auth.ts'
import { loadSession } from '@/api/auth'
import { ApiError, onUnauthorized } from '@/api/http'

export const authState = reactive({
    user: null as AuthUser | null,
    ready: false,
    dialogVisible: false,
    notice: '',
    sessionError: '',
})

function expireSession() {
    authState.user = null
    authState.dialogVisible = true
    authState.notice = '登录状态已失效，请重新登录。尚未提交的想法已保留在当前页面。'
}
onUnauthorized(expireSession)

let checkingSession = false
export async function revalidateSession() {
    if (checkingSession || !authState.user) return
    const userId = authState.user.userId
    checkingSession = true
    try {
        const user = await loadSession()
        if (authState.user?.userId === userId) { authState.user = user; authState.sessionError = '' }
    } catch (error) {
        if (authState.user?.userId !== userId) return
        if (error instanceof ApiError && error.status === 401) expireSession()
        else authState.sessionError = error instanceof Error ? error.message : '暂时无法确认登录状态'
    } finally { checkingSession = false }
}

export async function initializeSession() {
    authState.sessionError = ''
    try {
        authState.user = await loadSession()
    } catch (error) {
        authState.user = null
        authState.dialogVisible = true
        if (!(error instanceof ApiError && error.status === 401)) authState.sessionError = error instanceof Error ? error.message : '无法确认登录状态'
    } finally {
        authState.ready = true
    }
}

export function acceptSession(user: AuthUser) {
    authState.user = user
    authState.dialogVisible = false
    authState.notice = ''
    authState.sessionError = ''
}

import type { AuthUser } from '../../shared/contracts/auth.ts'
import { isAuthUser } from '../../shared/contracts/auth.ts'
import { requestJson, responseMessage } from './http'

function readUser(data: unknown): AuthUser {
    if (!isAuthUser(data)) throw new Error('账号数据格式不正确')
    return data
}

export const loadSession = async () => readUser(await requestJson('/auth/session', {}, false))
export const login = async (credentials: { username: string; password: string }) => readUser(await requestJson('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }, false))
export async function register(credentials: { username: string; password: string; email?: string }): Promise<{ user: AuthUser; emailDelivery: 'sent' | 'failed' | 'none' }> {
    const data = await requestJson('/auth/register', { method: 'POST', body: JSON.stringify(credentials) }, false)
    if (typeof data !== 'object' || data === null || !('user' in data) || !isAuthUser(data.user) || !('emailDelivery' in data) || !['sent', 'failed', 'none'].includes(String(data.emailDelivery))) throw new Error('注册结果的数据格式不正确')
    return { user: data.user, emailDelivery: data.emailDelivery as 'sent' | 'failed' | 'none' }
}
export const logout = async () => responseMessage(await requestJson('/auth/logout', { method: 'POST', body: '{}' }, false))
export const forgotPassword = async (email: string) => responseMessage(await requestJson('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }, false))
export const resetPassword = async (credentials: { token: string; password: string }) => responseMessage(await requestJson('/auth/reset-password', { method: 'POST', body: JSON.stringify(credentials) }, false))
export const verifyEmail = async (token: string) => responseMessage(await requestJson('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }, false))
export const resendVerification = async () => responseMessage(await requestJson('/auth/resend-verification', { method: 'POST', body: '{}' }))
export async function loadUsers(): Promise<AuthUser[]> {
    const data = await requestJson('/admin/users')
    if (!Array.isArray(data) || !data.every(isAuthUser)) throw new Error('用户列表的数据格式不正确')
    return data
}
export const setUserDisabled = async (userId: string, disabled: boolean) => readUser(await requestJson(`/admin/users/${encodeURIComponent(userId)}/status`, { method: 'PATCH', body: JSON.stringify({ disabled }) }))

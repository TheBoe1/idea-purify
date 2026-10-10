import { afterEach, describe, expect, it, vi } from 'vitest'
import { register } from '../api/auth'
import { authState, acceptSession, revalidateSession } from '../stores/auth'
import type { AuthUser } from '../../shared/contracts/auth.ts'

const user: AuthUser = { userId: '1', username: 'alice', email: 'alice@example.com', emailVerified: false, role: 'user', disabled: false, createdTime: '' }
afterEach(() => {
    vi.unstubAllGlobals()
    Object.assign(authState, { user: null, dialogVisible: false, notice: '', sessionError: '' })
})
describe('账号接口与会话检查', () => {
    it('验证邮件发送失败仍然保留已成功创建的账号结果', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user, emailDelivery: 'failed' }, { status: 201 })))
        await expect(register({ username: 'alice', password: 'a valid password', email: 'alice@example.com' })).resolves.toEqual({ user, emailDelivery: 'failed' })
    })
    it('定期确认会话遇到401时弹出登录界面', async () => {
        acceptSession(user)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: '登录失效' }, { status: 401 })))
        await revalidateSession()
        expect(authState.user).toBeNull()
        expect(authState.dialogVisible).toBe(true)
        expect(authState.notice).toContain('登录状态已失效')
    })
    it('数据库暂时失败不伪装成会话到期，仅展示服务异常', async () => {
        acceptSession(user)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: '数据库暂时不可用' }, { status: 503 })))
        await revalidateSession()
        expect(authState.user?.userId).toBe('1')
        expect(authState.dialogVisible).toBe(false)
        expect(authState.sessionError).toBe('数据库暂时不可用')
    })
})

export type UserRole = 'user' | 'admin'

export interface AuthUser {
  userId: string
  username: string
  nickname?: string | null
  email: string | null
  emailVerified: boolean
  role: UserRole
  disabled: boolean
  createdTime: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest extends LoginRequest {
  email?: string
}

export interface RegisterResult {
  user: AuthUser
  emailDelivery: 'sent' | 'failed' | 'none'
}

export function getUsernameError(username: string): string | undefined {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(username)) {
    return '用户名需为 3–32 位，以字母开头，仅含字母、数字、下划线'
  }
}

export function getPasswordError(password: string): string | undefined {
  if (password.length < 12 || password.length > 128) return '密码需为 12–128 个字符'
}

export function getNicknameError(nickname: string): string | undefined {
  const value = nickname.trim()
  if (Array.from(value).length < 1 || Array.from(value).length > 40) return '昵称需为 1–40 个字符'
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return '昵称不能包含控制或隐藏字符'
}

export function getEmailError(email: string): string | undefined {
  if (email.length > 254 || !/^[\x21-\x7e]+$/.test(email)
    || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return '请输入有效邮箱地址（使用英文邮箱地址）'
}

export function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const user = value as Record<string, unknown>
  return typeof user.userId === 'string' && user.userId.length > 0
    && typeof user.username === 'string'
    && (user.nickname === undefined || user.nickname === null || typeof user.nickname === 'string')
    && (typeof user.email === 'string' || user.email === null)
    && typeof user.emailVerified === 'boolean'
    && (user.role === 'user' || user.role === 'admin')
    && typeof user.disabled === 'boolean'
    && typeof user.createdTime === 'string'
}

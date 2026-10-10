// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../backend/auth/password.ts'

describe('密码存储安全', () => {
  it('相同密码使用独立随机盐，保存可验证的 Argon2id 哈希及 256 位摘要', async () => {
    const password = '测试密码 independent salt 2026'
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)])
    expect(first).not.toBe(second)
    expect(first.startsWith('$argon2id$')).toBe(true)
    expect(first).not.toContain(password)
    const parts = first.split('$')
    expect(Buffer.from(parts.at(-1)!, 'base64').byteLength).toBe(32)
    expect(Buffer.from(parts.at(-2)!, 'base64').byteLength).toBeGreaterThanOrEqual(16)
    expect(await verifyPassword(first, password)).toBe(true)
    expect(await verifyPassword(second, password)).toBe(true)
    expect(await verifyPassword(first, '不同密码 independent salt 2026')).toBe(false)
  })
})

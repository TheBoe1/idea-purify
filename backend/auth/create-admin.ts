import { getUsernameError, getPasswordError } from '../../shared/contracts/auth.ts'
import { authRepository } from '../db/auth.ts'
import { db } from '../db/index.ts'
import { hashPassword } from './password.ts'

try {
    const username = process.env.ADMIN_USERNAME?.trim().toLowerCase() ?? ''
    const password = process.env.ADMIN_PASSWORD ?? ''
    const error = getUsernameError(username) ?? getPasswordError(password)
    if (error) throw new Error(`请配置 ADMIN_USERNAME / ADMIN_PASSWORD：${error}`)
    if (await authRepository.findByUsername(username)) throw new Error('账号已存在；不会自动提升现有账号权限')
    await authRepository.create({ username, passwordHash: await hashPassword(password), email: null, role: 'admin' })
    console.log('管理员已创建；凭据仅从本机环境读取，不输出密码')
} catch (error) {
    console.error(error instanceof Error && !('code' in error) ? error.message : '管理员创建失败，请检查数据库配置和账号重名')
    process.exitCode = 1
} finally { await db.end() }

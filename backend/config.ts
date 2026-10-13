function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`缺少 ${name}，请按 .env.example 配置 .env.local`)
    return value
}

function port(value: string, name: string): number {
    const result = Number(value)
    if (!Number.isInteger(result) || result < 1 || result > 65535) {
        throw new Error(`${name} 必须是有效端口`)
    }
    return result
}

export const databaseConfig = {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: port(process.env.DB_PORT ?? '3306', 'DB_PORT'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
}

export const serverPort = port(process.env.PORT ?? '3000', 'PORT')

function flag(name: string, fallback = false): boolean {
    const value = process.env[name]
    if (!value) return fallback
    if (value !== 'true' && value !== 'false') throw new Error(`${name} 必须是 true 或 false`)
    return value === 'true'
}
export function getSmtpConfiguration() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) return null
    return { host: process.env.SMTP_HOST, port: port(process.env.SMTP_PORT ?? '587', 'SMTP_PORT'),
        secure: flag('SMTP_SECURE'), user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.SMTP_FROM }
}
export function getAuthConfiguration() {
    const origin = new URL(required('APP_ORIGIN'))
    if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
        throw new Error('APP_ORIGIN 必须是完整站点来源，例如 http://127.0.0.1:5173，不包含路径')
    }
    const sessionSecret = required('SESSION_SECRET')
    if (sessionSecret.length < 32 || /^(replace-with|change-me)/i.test(sessionSecret)) {
        throw new Error('SESSION_SECRET 需替换为至少 32 个字符的随机密钥，不能使用示例占位符')
    }
    const ttl = Number(process.env.SESSION_TTL_SECONDS ?? '28800')
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 604800) throw new Error('SESSION_TTL_SECONDS 需为 1–604800 的整数')
    return { appOrigin: origin.origin, sessionSecret, sessionTtlMs: ttl * 1000,
        secureCookies: flag('COOKIE_SECURE', process.env.NODE_ENV === 'production') }
}

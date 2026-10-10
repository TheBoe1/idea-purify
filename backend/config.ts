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

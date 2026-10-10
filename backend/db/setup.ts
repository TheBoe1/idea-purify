import { readFileSync } from 'node:fs'
import type { RowDataPacket } from 'mysql2/promise'
import { db } from './index.ts'

try {
    const statements = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').split(';').filter(statement => statement.trim())
    for (const statement of statements) await db.query(statement)
    const [columns] = await db.query<RowDataPacket[]>('SHOW COLUMNS FROM idea LIKE ?', ['create_time'])
    if (columns[0]?.Null === 'NO') {
        // 兼容已有表；历史 JSON 没有时间时保存 NULL，不伪造创建时间。
        await db.query('ALTER TABLE idea MODIFY create_time DATETIME NULL DEFAULT CURRENT_TIMESTAMP')
    }
    const [owners] = await db.query<RowDataPacket[]>('SHOW COLUMNS FROM idea LIKE ?', ['user_id'])
    if (!owners.length) {
        // 旧数据保留为无归属记录，不自动公开或分配给第一个注册账号。
        await db.query('ALTER TABLE idea ADD COLUMN user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD INDEX idea_owner_time (user_id, create_time)')
    }
    console.log('用户、会话、邮件令牌及想法表已就绪；旧记录保留且不公开')
} catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'UNKNOWN'
    console.error('初始化失败：', code)
    process.exitCode = 1
} finally { await db.end() }

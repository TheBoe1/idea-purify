import { readFileSync } from 'node:fs'
import type { RowDataPacket } from 'mysql2/promise'
import { db } from './index.ts'

try {
    await db.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
    const [columns] = await db.query<RowDataPacket[]>('SHOW COLUMNS FROM idea LIKE ?', ['create_time'])
    if (columns[0]?.Null === 'NO') {
        // 兼容已有表；历史 JSON 没有时间时保存 NULL，不伪造创建时间。
        await db.query('ALTER TABLE idea MODIFY create_time DATETIME NULL DEFAULT CURRENT_TIMESTAMP')
    }
    console.log('idea 表已就绪，已有记录保留')
} catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'UNKNOWN'
    console.error('初始化失败：', code)
    process.exitCode = 1
} finally { await db.end() }

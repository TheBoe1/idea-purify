import { readFileSync } from 'node:fs'
import type { RowDataPacket } from 'mysql2/promise'
import { isIdea } from '../../shared/contracts/idea.ts'
import { db } from './index.ts'

try {
    const records: unknown = JSON.parse(readFileSync(new URL('../data/ideas.json', import.meta.url), 'utf8'))
    if (!Array.isArray(records) || !records.every(isIdea)) throw new Error('历史记录格式不正确')
    const connection = await db.getConnection()
    try {
        await connection.beginTransaction()
        const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM idea')
        if (Number(rows[0]?.total) !== 0) {
            console.log('idea 表已有数据，跳过导入，避免重复或覆盖')
        } else {
            for (const idea of records) {
                await connection.execute('INSERT INTO idea (idea_content, create_time) VALUES (?, ?)', [
                    idea.ideaContent,
                    idea.createdTime ? new Date(idea.createdTime) : null,
                ])
            }
            console.log(`已导入 ${records.length} 条历史想法，ID 由 MySQL 分配`)
        }
        await connection.commit()
    } catch (error) {
        await connection.rollback()
        throw error
    } finally { connection.release() }
} catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'UNKNOWN'
    console.error('历史数据导入失败：', code)
    process.exitCode = 1
} finally { await db.end() }

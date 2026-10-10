import type { RowDataPacket } from 'mysql2/promise'
import type { CreateIdeaRequest, Idea } from '../../shared/contracts/idea.ts'
import { db } from './index.ts'

export interface IdeaRepository {
    create(userId: string, request: CreateIdeaRequest): Promise<Idea>
    list(userId: string): Promise<Idea[]>
    find(userId: string, ideaId: string): Promise<Idea | null>
}

interface IdeaRow extends RowDataPacket {
    ideaId: string
    ideaContent: string
    createdTime: Date | null
}

const selectColumns = 'CAST(id AS CHAR) AS ideaId, idea_content AS ideaContent, create_time AS createdTime'

function toIdea(row: IdeaRow): Idea {
    return {
        ideaId: row.ideaId,
        ideaContent: row.ideaContent,
        createdTime: row.createdTime?.toISOString() ?? '',
    }
}

export const ideaRepository: IdeaRepository = {
    async create(userId, request) {
        const connection = await db.getConnection()
        try {
            await connection.beginTransaction()
            // 参数与 SQL 分开传递，用户内容不会拼接进 SQL。
            await connection.execute(
                'INSERT INTO idea (user_id, idea_content, create_time) VALUES (?, ?, ?)',
                [userId, request.ideaContent, new Date()],
            )
            const [rows] = await connection.execute<IdeaRow[]>(
                `SELECT ${selectColumns} FROM idea WHERE id = LAST_INSERT_ID() AND user_id = ?`, [userId],
            )
            const row = rows[0]
            if (!row) throw new Error('无法读取刚保存的想法')
            const idea = toIdea(row)
            await connection.commit()
            return idea
        } catch (error) {
            await connection.rollback()
            throw error
        } finally {
            connection.release()
        }
    },
    async list(userId) {
        const [rows] = await db.execute<IdeaRow[]>(
            `SELECT ${selectColumns} FROM idea WHERE user_id = ? ORDER BY (create_time IS NULL), create_time DESC, CAST(idea_content AS BINARY) ASC, id ASC`,
            [userId],
        )
        return rows.map(toIdea)
    },
    async find(userId, ideaId) {
        const [rows] = await db.execute<IdeaRow[]>(
            `SELECT ${selectColumns} FROM idea WHERE user_id = ? AND id = ?`, [userId, ideaId],
        )
        return rows[0] ? toIdea(rows[0]) : null
    },
}

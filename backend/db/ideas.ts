import type { RowDataPacket } from 'mysql2/promise'
import type { CreateIdeaRequest, Idea } from '../../shared/contracts/idea.ts'
import { db } from './index.ts'

export interface IdeaRepository {
    create(request: CreateIdeaRequest): Promise<Idea>
    list(): Promise<Idea[]>
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
    async create(request) {
        const connection = await db.getConnection()
        try {
            await connection.beginTransaction()
            // 参数与 SQL 分开传递，用户内容不会拼接进 SQL。
            await connection.execute(
                'INSERT INTO idea (idea_content, create_time) VALUES (?, ?)',
                [request.ideaContent, new Date()],
            )
            const [rows] = await connection.execute<IdeaRow[]>(
                `SELECT ${selectColumns} FROM idea WHERE id = LAST_INSERT_ID()`,
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
    async list() {
        const [rows] = await db.execute<IdeaRow[]>(
            `SELECT ${selectColumns} FROM idea ORDER BY create_time DESC, id DESC`,
        )
        return rows.map(toIdea)
    },
}

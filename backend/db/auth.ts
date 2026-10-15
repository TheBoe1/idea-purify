import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { AuthUser } from '../../shared/contracts/auth.ts'
import { db } from './index.ts'
import { publicUser } from '../auth/user.ts'

export type EmailTokenPurpose = 'verify-email' | 'reset-password'
export interface UserRecord extends AuthUser { passwordHash: string; authVersion: number }
export interface NewUser { username: string; email: string | null; passwordHash: string; role?: 'user' | 'admin' }
export interface AuthRepository {
    findById(userId: string): Promise<UserRecord | null>
    findByUsername(username: string): Promise<UserRecord | null>
    findByEmail(email: string): Promise<UserRecord | null>
    create(user: NewUser): Promise<UserRecord>
    listUsers(): Promise<AuthUser[]>
    setDisabled(userId: string, disabled: boolean): Promise<AuthUser | null>
    updateNickname(userId: string, nickname: string): Promise<AuthUser | null>
    issueEmailToken(userId: string, purpose: EmailTokenPurpose, hash: Buffer, expires: Date): Promise<void>
    consumeEmailToken(hash: Buffer, purpose: EmailTokenPurpose, passwordHash?: string): Promise<boolean>
}

interface UserRow extends RowDataPacket {
    userId: string; username: string; nickname: string | null; email: string | null; emailVerified: number
    role: 'user' | 'admin'; disabled: number; createdTime: Date; passwordHash: string; authVersion: number
}
const columns = 'id AS userId, username, nickname, email, email_verified AS emailVerified, role, disabled, created_time AS createdTime, password_hash AS passwordHash, auth_version AS authVersion'
function toRecord(row: UserRow): UserRecord {
    return { ...row, emailVerified: Boolean(row.emailVerified), disabled: Boolean(row.disabled), createdTime: row.createdTime.toISOString() }
}
async function find(column: 'id' | 'username' | 'email', value: string): Promise<UserRecord | null> {
    const [rows] = await db.execute<UserRow[]>(`SELECT ${columns} FROM app_user WHERE ${column} = ?`, [value])
    return rows[0] ? toRecord(rows[0]) : null
}

export const authRepository: AuthRepository = {
    findById: id => find('id', id),
    findByUsername: username => find('username', username),
    findByEmail: email => find('email', email),
    async create(user) {
        const id = randomUUID()
        await db.execute('INSERT INTO app_user (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [id, user.username, user.email, user.passwordHash, user.role ?? 'user'])
        const record = await find('id', id)
        if (!record) throw new Error('无法读取新用户')
        return record
    },
    async listUsers() {
        const [rows] = await db.query<UserRow[]>(`SELECT ${columns} FROM app_user ORDER BY created_time DESC, id ASC`)
        return rows.map(row => publicUser(toRecord(row)))
    },
    async setDisabled(userId, disabled) {
        // 管理员只能禁用普通用户，不能借此关闭管理员账号。
        await db.execute("UPDATE app_user SET disabled = ?, auth_version = auth_version + 1 WHERE id = ? AND role = 'user'", [disabled, userId])
        const record = await find('id', userId)
        return record ? publicUser(record) : null
    },
    async updateNickname(userId, nickname) {
        await db.execute('UPDATE app_user SET nickname = ? WHERE id = ? AND disabled = FALSE', [nickname, userId])
        const record = await find('id', userId)
        return record && !record.disabled ? publicUser(record) : null
    },
    async issueEmailToken(userId, purpose, hash, expires) {
        const connection = await db.getConnection()
        try {
            await connection.beginTransaction()
            // 同账号的重发串行化，保证新链接替换旧链接。
            await connection.execute('SELECT id FROM app_user WHERE id = ? FOR UPDATE', [userId])
            await connection.execute('DELETE FROM auth_email_token WHERE user_id = ? AND purpose = ?', [userId, purpose])
            await connection.execute('INSERT INTO auth_email_token (token_hash, user_id, purpose, expires_time) VALUES (?, ?, ?, ?)', [hash, userId, purpose, expires])
            await connection.commit()
        } catch (error) { await connection.rollback(); throw error }
        finally { connection.release() }
    },
    async consumeEmailToken(hash, purpose, passwordHash) {
        const connection = await db.getConnection()
        try {
            await connection.beginTransaction()
            const [rows] = await connection.execute<RowDataPacket[]>(
                'SELECT t.user_id, u.disabled FROM auth_email_token t INNER JOIN app_user u ON u.id = t.user_id WHERE t.token_hash = ? AND t.purpose = ? AND t.used_time IS NULL AND t.expires_time > UTC_TIMESTAMP() FOR UPDATE', [hash, purpose])
            const row = rows[0]
            if (!row || row.disabled || (purpose === 'reset-password' && !passwordHash)) {
                await connection.rollback()
                return false
            }
            if (purpose === 'reset-password') {
                await connection.execute('UPDATE app_user SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', [passwordHash, row.user_id])
            } else {
                await connection.execute('UPDATE app_user SET email_verified = TRUE WHERE id = ?', [row.user_id])
            }
            const [result] = await connection.execute<ResultSetHeader>('UPDATE auth_email_token SET used_time = UTC_TIMESTAMP() WHERE token_hash = ? AND used_time IS NULL', [hash])
            await connection.commit()
            return result.affectedRows === 1
        } catch (error) { await connection.rollback(); throw error }
        finally { connection.release() }
    },
}

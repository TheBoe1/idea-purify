import type { AuthUser } from '../../shared/contracts/auth.ts'
import type { UserRecord } from '../db/auth.ts'

export function publicUser(user: UserRecord): AuthUser {
    return { userId: user.userId, username: user.username, email: user.email, emailVerified: user.emailVerified,
        role: user.role, disabled: user.disabled, createdTime: user.createdTime }
}

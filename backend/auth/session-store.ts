import session from 'express-session'
import createMySQLStore from 'express-mysql-session'
import type { Pool } from 'mysql2'
import { db } from '../db/index.ts'

export function createSessionStore(expiration: number) {
    const MySQLStore = createMySQLStore(session)
    return new MySQLStore({ createDatabaseTable: false, endConnectionOnClose: false, disableTouch: true,
        expiration, schema: { tableName: 'auth_session' },
    }, db as unknown as Pool)
}

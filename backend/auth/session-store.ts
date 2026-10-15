import session from 'express-session'
import createMySQLStore from 'express-mysql-session'
import { db } from '../db/index.ts'

export function createSessionStore(expiration: number) {
    const MySQLStore = createMySQLStore(session)
    // The adapter's declarations pin an older mysql2; keep this compatibility cast at its boundary.
    type StoreConnection = ConstructorParameters<typeof MySQLStore>[1]
    return new MySQLStore({ createDatabaseTable: false, endConnectionOnClose: false, disableTouch: true,
        expiration, schema: { tableName: 'auth_session' },
    }, db as unknown as StoreConnection)
}

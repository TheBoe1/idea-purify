import mysql from 'mysql2/promise'
import { databaseConfig } from '../config.ts'

export const db = mysql.createPool({
    ...databaseConfig,
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 3000,
})

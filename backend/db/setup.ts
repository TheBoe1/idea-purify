import { readFileSync } from 'node:fs'
import type { RowDataPacket } from 'mysql2/promise'
import { db } from './index.ts'
import { seedComponentDefinitions } from './component-configs.ts'
import { seedWorkbenchDefinitions } from './workbench.ts'

try {
    const statements = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').split(';').filter(statement => statement.trim())
    for (const statement of statements) await db.query(statement)
    const [nicknames] = await db.query<RowDataPacket[]>('SHOW COLUMNS FROM app_user LIKE ?', ['nickname'])
    if (!nicknames.length) await db.query('ALTER TABLE app_user ADD COLUMN nickname VARCHAR(40) NULL')
    const [versions] = await db.query<RowDataPacket[]>('SHOW COLUMNS FROM component_definition LIKE ?', ['library_version'])
    if (!versions.length) await db.query("ALTER TABLE component_definition ADD COLUMN library_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''")
    for (const table of ['component_definition', 'component_config'] as const) {
        const [keys] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, ['component_key'])
        if (keys[0]?.Type !== 'varchar(128)') await db.query(`ALTER TABLE ${table} MODIFY component_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`)
    }
    const [revisions] = await db.query<RowDataPacket[]>('SHOW COLUMNS FROM component_config LIKE ?', ['revision'])
    if (!revisions.length) await db.query('ALTER TABLE component_config ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1')
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
    await seedComponentDefinitions()
    await seedWorkbenchDefinitions()
    console.log('用户、会话、邮件令牌、想法及组件配置表已就绪；旧想法保留且不公开')
} catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'UNKNOWN'
    console.error('初始化失败：', code)
    process.exitCode = 1
} finally { await db.end() }

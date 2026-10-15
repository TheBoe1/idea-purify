import { createIdeaServer } from './app.ts'
import { serverPort, getAuthConfiguration, getSmtpConfiguration } from './config.ts'
import { db } from './db/index.ts'
import { ideaRepository } from './db/ideas.ts'
import { authRepository } from './db/auth.ts'
import { createSessionStore } from './auth/session-store.ts'
import { createMailer } from './auth/mail.ts'
import { componentConfigRepository } from './db/component-configs.ts'
import { workbenchRepository } from './db/workbench.ts'

const config = getAuthConfiguration()
const sessionStore = createSessionStore(config.sessionTtlMs)
const server = createIdeaServer(ideaRepository, { ...config, authRepository, sessionStore, componentConfigRepository, workbenchRepository,
    mailer: createMailer(getSmtpConfiguration()) })
server.on('error', () => {
    console.error(`后端启动失败，请检查 ${serverPort} 端口是否被占用`)
    process.exitCode = 1
    void sessionStore.close().then(() => db.end())
})
server.listen(serverPort, '127.0.0.1', () => {
    console.log(`Node Server running at http://127.0.0.1:${serverPort}`)
})

db.query('SELECT 1').then(() => {
    console.log('MySQL连接成功')
}).catch(() => {
    console.error('MySQL连接失败，请检查本地配置；请求会返回明确错误')
})

function shutdown() {
    server.close(() => { void sessionStore.close().then(() => db.end()) })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

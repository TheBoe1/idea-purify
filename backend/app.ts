import http from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import session from 'express-session'
import { Passport } from 'passport'
import { Strategy as LocalStrategy } from 'passport-local'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { getIdeaContentError, isCreateIdeaRequest } from '../shared/contracts/idea.ts'
import { getUsernameError, getPasswordError, getEmailError } from '../shared/contracts/auth.ts'
import type { IdeaRepository } from './db/ideas.ts'
import type { AuthRepository, UserRecord, EmailTokenPurpose } from './db/auth.ts'
import { publicUser } from './auth/user.ts'
import { hashPassword, verifyPassword } from './auth/password.ts'
import type { Mailer } from './auth/mail.ts'

// Passport 的类型需要合并全局 Express.User，空接口继承在这里用于声明扩展。
// eslint-disable-next-line @typescript-eslint/no-namespace, @typescript-eslint/no-empty-object-type
declare global { namespace Express { interface User extends UserRecord {} } }
declare module 'express-session' { interface SessionData { authenticatedAt?: number } }

export interface AuthServerOptions {
    authRepository: AuthRepository
    mailer: Mailer
    sessionStore: session.Store
    sessionSecret: string
    appOrigin: string
    sessionTtlMs?: number
    secureCookies?: boolean
}
class RequestError extends Error {
    readonly status: number
    constructor(status: number, message: string) { super(message); this.status = status }
}
const dummyHash = hashPassword('invalid-account-dummy-comparison')
const digest = (token: string) => createHash('sha256').update(token).digest()
function body(req: Request): Record<string, unknown> {
    const value: unknown = req.body
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, '请求体必须是 JSON 对象')
    return value as Record<string, unknown>
}
function credentials(req: Request) {
    const input = body(req)
    if (typeof input.username !== 'string' || typeof input.password !== 'string') throw new RequestError(400, '请输入用户名和密码')
    const username = input.username.trim().toLowerCase()
    const error = getUsernameError(username) ?? getPasswordError(input.password)
    if (error) throw new RequestError(400, error)
    return { username, password: input.password }
}
function authenticated(req: Request, _res: Response, next: NextFunction) {
    if (!req.user) return next(new RequestError(401, '登录状态已失效，请重新登录'))
    next()
}
function administrator(req: Request, _res: Response, next: NextFunction) {
    if (req.user?.role !== 'admin') return next(new RequestError(403, '需要管理员权限'))
    next()
}
function login(req: Request, user: UserRecord): Promise<void> {
    return new Promise((resolve, reject) => req.login(user, error => {
        if (error) { reject(error); return }
        req.session.authenticatedAt = Date.now()
        req.session.save(error => error ? reject(error) : resolve())
    }))
}
function tokenFrom(req: Request) {
    const token = body(req).token
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new RequestError(400, '链接无效或已过期，请重新申请')
    return token
}

export function createIdeaServer(repository: IdeaRepository, options: AuthServerOptions): http.Server {
    if (options.sessionSecret.length < 32) throw new Error('SESSION_SECRET 至少需要 32 个字符')
    const app = express()
    const auth = options.authRepository
    const passport = new Passport()
    const ttl = options.sessionTtlMs ?? 8 * 60 * 60 * 1000
    const cookieName = 'idea_purify.sid'
    app.disable('x-powered-by')
    app.use(helmet())
    app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
    app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
        message: { message: '请求过于频繁，请稍后再试' } }))
    app.use((req, _res, next) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            if (req.get('origin') !== options.appOrigin) return next(new RequestError(403, '请求来源不受信任'))
            if (req.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return next(new RequestError(415, '请使用 application/json 提交'))
        }
        next()
    })
    app.use(express.json({ limit: '16kb', strict: false }))
    app.use(session({ name: cookieName, secret: options.sessionSecret, store: options.sessionStore,
        resave: false, saveUninitialized: false, rolling: false, genid: () => randomBytes(32).toString('base64url'),
        cookie: { httpOnly: true, sameSite: 'strict', secure: options.secureCookies ?? false, maxAge: ttl, path: '/' },
    }))
    app.use((req, res, next) => {
        if (req.session.authenticatedAt && Date.now() - req.session.authenticatedAt >= ttl) {
            req.session.regenerate(error => { req.user = undefined; res.clearCookie(cookieName, { path: '/' }); next(error) })
        } else next()
    })
    passport.use(new LocalStrategy(async (username, password, done) => {
        try {
            const user = await auth.findByUsername(username)
            const valid = await verifyPassword(user?.passwordHash ?? await dummyHash, password)
            done(null, valid && user && !user.disabled ? user : false)
        } catch (error) { done(error) }
    }))
    passport.serializeUser((user, done) => done(null, { userId: user.userId, authVersion: user.authVersion }))
    passport.deserializeUser(async (identity: { userId: string; authVersion: number }, done) => {
        try {
            const user = await auth.findById(identity.userId)
            done(null, user && !user.disabled && user.authVersion === identity.authVersion ? user : false)
        } catch (error) { done(error) }
    })
    app.use(passport.initialize())
    app.use(passport.session())
    const limitedAuth = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
        message: { message: '账户操作过于频繁，请 15 分钟后再试' } })
    const limitedMail = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
        message: { message: '邮件操作过于频繁，请 15 分钟后再试' } })
    async function sendToken(user: UserRecord, purpose: EmailTokenPurpose) {
        if (!user.email) throw new RequestError(400, '此账号没有绑定邮箱')
        const token = randomBytes(32).toString('base64url')
        await auth.issueEmailToken(user.userId, purpose, digest(token), new Date(Date.now() + 30 * 60_000))
        const path = purpose === 'verify-email' ? '/verify-email' : '/reset-password'
        await options.mailer.send(user.email, purpose, `${options.appOrigin}${path}?token=${encodeURIComponent(token)}`)
    }
    app.post('/auth/register', limitedAuth, async (req, res) => {
        const input = body(req)
        const { username, password } = credentials(req)
        const email = typeof input.email === 'string' && input.email.trim() ? input.email.trim().toLowerCase() : null
        if (input.email !== undefined && typeof input.email !== 'string') throw new RequestError(400, '邮箱必须是字符串')
        if (email) { const error = getEmailError(email); if (error) throw new RequestError(400, error) }
        const user = await auth.create({ username, email, passwordHash: await hashPassword(password), role: 'user' })
        await login(req, user)
        let emailDelivery: 'sent' | 'failed' | 'none' = 'none'
        if (email) {
            try { await sendToken(user, 'verify-email'); emailDelivery = 'sent' }
            catch { emailDelivery = 'failed' }
        }
        res.status(201).json({ user: publicUser(user), emailDelivery })
    })
    app.post('/auth/login', limitedAuth, (req, res, next) => {
        req.body = credentials(req)
        passport.authenticate('local', (error: unknown, user: UserRecord | false) => {
            if (error) { next(error); return }
            if (!user) { next(new RequestError(401, '用户名或密码错误，账号可能已被禁用')); return }
            login(req, user).then(() => res.json(publicUser(user)), next)
        })(req, res, next)
    })
    app.get('/auth/session', authenticated, (req, res) => res.json(publicUser(req.user!)))
    app.post('/auth/logout', (req, res, next) => {
        req.session.destroy(error => {
            if (error) { next(error); return }
            res.clearCookie(cookieName, { path: '/' })
            res.json({ message: '已退出登录' })
        })
    })
    app.post('/auth/resend-verification', authenticated, limitedMail, async (req, res) => {
        if (req.user!.emailVerified) { res.json({ message: '邮箱已验证' }); return }
        await sendToken(req.user!, 'verify-email')
        res.json({ message: '验证邮件已发送，请检查收件箱' })
    })
    app.post('/auth/verify-email', limitedAuth, async (req, res) => {
        if (!await auth.consumeEmailToken(digest(tokenFrom(req)), 'verify-email')) throw new RequestError(400, '链接无效或已过期，请重新申请')
        res.json({ message: '邮箱验证成功，现在可以使用邮箱重设密码' })
    })
    app.post('/auth/forgot-password', limitedMail, async (req, res) => {
        const email = body(req).email
        if (typeof email !== 'string' || getEmailError(email.trim())) throw new RequestError(400, '请输入有效邮箱地址')
        if (options.mailer.configured === false) throw new RequestError(503, '邮件服务尚未配置，请联系管理员')
        const user = await auth.findByEmail(email.trim().toLowerCase())
        if (user?.emailVerified && !user.disabled) {
            // 统一响应避免探测账号，邮件内容与令牌从不回传浏览器。
            try { await sendToken(user, 'reset-password') }
            catch { console.error('重设密码邮件发送失败，请检查 SMTP 配置') }
        }
        res.json({ message: '如果邮箱已验证并绑定有效账号，你将收到重设密码邮件；若未收到请联系管理员' })
    })
    app.post('/auth/reset-password', limitedAuth, async (req, res) => {
        const token = tokenFrom(req)
        const password = body(req).password
        if (typeof password !== 'string') throw new RequestError(400, '请输入新密码')
        const error = getPasswordError(password)
        if (error) throw new RequestError(400, error)
        if (!await auth.consumeEmailToken(digest(token), 'reset-password', await hashPassword(password))) throw new RequestError(400, '链接无效或已过期，请重新申请')
        res.json({ message: '密码已重设，请使用新密码重新登录' })
    })
    app.post('/idea', authenticated, async (req, res) => {
        if (!isCreateIdeaRequest(req.body)) throw new RequestError(400, 'ideaContent 必须是字符串')
        const ideaContent = req.body.ideaContent.trim()
        const error = getIdeaContentError(ideaContent)
        if (error) throw new RequestError(400, error)
        res.status(201).json(await repository.create(req.user!.userId, { ideaContent }))
    })
    app.get('/ideas', authenticated, async (req, res) => res.json(await repository.list(req.user!.userId)))
    app.get('/ideas/:ideaId', authenticated, async (req, res) => {
        const ideaId = req.params.ideaId
        if (typeof ideaId !== 'string' || !/^[1-9]\d{0,18}$/.test(ideaId)) throw new RequestError(404, '想法不存在')
        const idea = await repository.find(req.user!.userId, ideaId)
        if (!idea) throw new RequestError(404, '想法不存在')
        res.json(idea)
    })
    app.get('/admin/users', authenticated, administrator, async (_req, res) => res.json(await auth.listUsers()))
    app.patch('/admin/users/:userId/status', authenticated, administrator, async (req, res) => {
        const userId = req.params.userId
        const disabled = body(req).disabled
        if (typeof userId !== 'string' || typeof disabled !== 'boolean') throw new RequestError(400, '账号状态无效')
        const target = await auth.findById(userId)
        if (!target) throw new RequestError(404, '账号不存在')
        if (target.role === 'admin' || target.userId === req.user!.userId) throw new RequestError(403, '只能修改普通用户的状态')
        res.json(await auth.setDisabled(userId, disabled))
    })
    app.use((_req, res) => res.status(404).json({ message: '接口不存在' }))
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (res.headersSent) return
        if (error instanceof RequestError) { res.status(error.status).json({ message: error.message }); return }
        const detail = error as { type?: string; code?: string }
        if (detail?.type === 'entity.too.large') { res.status(413).json({ message: '提交的内容过大' }); return }
        if (detail?.type === 'entity.parse.failed') { res.status(400).json({ message: '请求体必须是有效的 JSON' }); return }
        if (detail?.code === 'ER_DUP_ENTRY') { res.status(409).json({ message: '用户名或邮箱已被使用' }); return }
        res.status(503).json({ message: '服务暂时不可用，请稍后重试' })
    })
    const server = http.createServer(app)
    server.requestTimeout = 30_000
    server.headersTimeout = 10_000
    return server
}

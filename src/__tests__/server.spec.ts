// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import session from 'express-session'
import { createIdeaServer } from '../../backend/app.ts'
import type { IdeaRepository } from '../../backend/db/ideas.ts'
import { createSecurityRepositories } from '../../tests/security-fixtures.ts'

const idea = { ideaId: '6', ideaContent: '用户想法', createdTime: '2026-10-10T08:00:00Z' }
const repository = { create: vi.fn<IdeaRepository['create']>(), list: vi.fn<IdeaRepository['list']>(), find: vi.fn<IdeaRepository['find']>() }
const origin = 'http://127.0.0.1:5174'
let server: http.Server
let base: string
let cookie: string
let userId: string

beforeEach(async () => {
    repository.create.mockReset().mockResolvedValue(idea)
    repository.list.mockReset().mockResolvedValue([idea])
    repository.find.mockReset().mockResolvedValue(idea)
    const fixtures = createSecurityRepositories()
    server = createIdeaServer(repository, { authRepository: fixtures.authRepository, sessionStore: new session.MemoryStore(),
        sessionSecret: 'local-unit-test-session-secret-long-enough', appOrigin: origin, mailer: { async send() {} } })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ username: 'test_user', password: 'long-test-password' }) })
    if (response.status !== 201) throw new Error('测试账号初始化失败')
    cookie = response.headers.get('set-cookie')!.split(';')[0]!
    userId = (await response.json()).user.userId
})
afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})
const post = (body: string) => fetch(`${base}/idea`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body,
})
const get = (path = '/ideas') => fetch(`${base}${path}`, { headers: { Cookie: cookie } })

describe('想法 HTTP 接口', () => {
    it('保存成功才返回 201 和后端生成的记录，忽略客户端 ID 和用户归属', async () => {
        const response = await post(JSON.stringify({ ideaContent: ' 用户想法 ', ideaId: 'client', userId: 'client-user' }))
        expect(response.status).toBe(201)
        expect(await response.json()).toEqual(idea)
        expect(repository.create).toHaveBeenCalledWith(userId, { ideaContent: '用户想法' })
    })
    it('从同一个存储接口返回本人的历史记录', async () => {
        const response = await get()
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([idea])
        expect(repository.list).toHaveBeenCalledWith(userId)
    })
    it('详情查询携带真实会话用户 ID', async () => {
        expect((await get('/ideas/6')).status).toBe(200)
        expect(repository.find).toHaveBeenCalledWith(userId, '6')
    })
    it.each(['{', 'null', '{}', '{"ideaContent":1}', '{"ideaContent":" "}', '{"ideaContent":"一"}', JSON.stringify({ ideaContent: '字'.repeat(256) })])(
        '拒绝非法输入，不触发数据库写入：%s', async body => {
            expect((await post(body)).status).toBe(400)
            expect(repository.create).not.toHaveBeenCalled()
        },
    )
    it('限制请求大小', async () => {
        expect((await post(JSON.stringify({ ideaContent: '字'.repeat(6000) }))).status).toBe(413)
        expect(repository.create).not.toHaveBeenCalled()
    })
    it('数据库写入失败返回 503，不能返回成功记录', async () => {
        repository.create.mockRejectedValue(new Error('database failure'))
        const response = await post(JSON.stringify({ ideaContent: '用户想法' }))
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ message: '服务暂时不可用，请稍后重试' })
    })
    it('数据库查询失败返回 503', async () => {
        repository.list.mockRejectedValue(new Error('database failure'))
        expect((await get()).status).toBe(503)
    })
    it('匿名用户不能读取数据', async () => {
        expect((await fetch(`${base}/ideas`)).status).toBe(401)
        expect(repository.list).not.toHaveBeenCalled()
    })
})

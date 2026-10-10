// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createIdeaServer } from '../../backend/app.ts'
import type { IdeaRepository } from '../../backend/db/ideas.ts'

const idea = { ideaId: '6', ideaContent: '用户想法', createdTime: '2026-10-10T08:00:00Z' }
const repository = { create: vi.fn<IdeaRepository['create']>(), list: vi.fn<IdeaRepository['list']>() }
let server: http.Server
let base: string

beforeEach(async () => {
    repository.create.mockReset().mockResolvedValue(idea)
    repository.list.mockReset().mockResolvedValue([idea])
    server = createIdeaServer(repository)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

const post = (body: string) => fetch(`${base}/idea`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
})

describe('想法 HTTP 接口', () => {
    it('保存成功才返回 201 和后端生成的记录，忽略客户端 ID', async () => {
        const response = await post(JSON.stringify({ ideaContent: ' 用户想法 ', ideaId: 'client', userId: 'client-user' }))
        expect(response.status).toBe(201)
        expect(await response.json()).toEqual(idea)
        expect(repository.create).toHaveBeenCalledWith({ ideaContent: '用户想法' })
    })
    it('从同一个存储接口返回历史记录', async () => {
        const response = await fetch(`${base}/ideas`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([idea])
        expect(repository.list).toHaveBeenCalledOnce()
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
        expect(await response.json()).toEqual({ message: '暂时无法读取或保存想法，请稍后重试' })
    })
    it('数据库查询失败返回 503', async () => {
        repository.list.mockRejectedValue(new Error('database failure'))
        expect((await fetch(`${base}/ideas`)).status).toBe(503)
    })
})

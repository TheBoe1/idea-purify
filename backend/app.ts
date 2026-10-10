import http from 'node:http'
import { isCreateIdeaRequest, getIdeaContentError } from '../shared/contracts/idea.ts'
import type { IdeaRepository } from './db/ideas.ts'

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
}

class RequestError extends Error {
    readonly status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = ''
        let bytes = 0
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk)
            if (bytes <= 16 * 1024) body += chunk
        })
        req.on('error', reject)
        req.on('end', () => {
            if (bytes > 16 * 1024) {
                reject(new RequestError(413, '提交的内容过大'))
                return
            }
            try { resolve(JSON.parse(body)) }
            catch { reject(new RequestError(400, '请求体必须是有效的 JSON')) }
        })
    })
}

export function createIdeaServer(repository: IdeaRepository): http.Server {
    return http.createServer(async (req, res) => {
        try {
            if (req.method === 'POST' && req.url === '/idea') {
                if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
                    throw new RequestError(415, '请使用 application/json 提交')
                }
                const body = await readJson(req)
                if (!isCreateIdeaRequest(body)) {
                    throw new RequestError(400, 'ideaContent 必须是字符串')
                }
                const ideaContent = body.ideaContent.trim()
                const message = getIdeaContentError(ideaContent)
                if (message) throw new RequestError(400, message)
                const idea = await repository.create({ ideaContent })
                sendJson(res, 201, idea)
                return
            }
            if (req.method === 'GET' && req.url === '/ideas') {
                sendJson(res, 200, await repository.list())
                return
            }
            sendJson(res, 404, { message: '接口不存在' })
        } catch (error) {
            if (error instanceof RequestError) {
                sendJson(res, error.status, { message: error.message })
            } else {
                // 响应中不暴露 SQL 和数据库登录信息。
                sendJson(res, 503, { message: '暂时无法读取或保存想法，请稍后重试' })
            }
        }
    })
}

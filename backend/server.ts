import http from 'node:http'
import fs from 'node:fs'
import { db } from './db/index.ts'
import {
    isCreateIdeaRequest,
    isIdea,
    type CreateIdeaRequest,
} from '../shared/contracts/idea.ts'

async function testDatabase() {
    const [rows] = await db.query('SELECT 1')
    console.log('MySQL连接成功：', rows)
}

testDatabase().catch((error: unknown) => {
    console.error('数据库连接失败：', error)
})

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
}

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/idea') {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => {
            body += chunk
        })
        req.on('end', () => {
            let parsedBody: unknown
            try {
                parsedBody = JSON.parse(body)
            } catch {
                sendJson(res, 400, { message: '请求体必须是有效的 JSON' })
                return
            }

            if (!isCreateIdeaRequest(parsedBody)) {
                sendJson(res, 400, { message: 'ideaContent 必须是字符串' })
                return
            }

            // 从验证后的数据构造请求对象；客户端的其他字段不会参与创建。
            const createIdeaRequest: CreateIdeaRequest = {
                ideaContent: parsedBody.ideaContent.trim(),
            }
            if (createIdeaRequest.ideaContent.length < 2) {
                sendJson(res, 400, { message: '请输入至少两个字符' })
                return
            }

            // 此处仅确认接收；数据库保存会在下一步接入。
            sendJson(res, 200, { data: createIdeaRequest })
        })
        return
    }

    if (req.method === 'GET' && req.url === '/ideas') {
        try {
            const data: unknown = JSON.parse(
                fs.readFileSync(new URL('./data/ideas.json', import.meta.url), 'utf8'),
            )
            if (!Array.isArray(data) || !data.every(isIdea)) {
                sendJson(res, 500, { message: '想法列表的数据格式不正确' })
                return
            }
            sendJson(res, 200, data)
        } catch {
            sendJson(res, 500, { message: '读取想法列表失败' })
        }
        return
    }

    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('Welcome to the home page!\n')
        return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('404 Not Found\n')
})

server.listen(3000, () => {
    console.log('Node Server running on port 3000')
})

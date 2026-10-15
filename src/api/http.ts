export class ApiError extends Error {
    readonly status: number
    constructor(message: string, status: number) {
        super(message)
        this.status = status
    }
}

let unauthorizedHandler = () => {}
export function onUnauthorized(handler: () => void) { unauthorizedHandler = handler }
let sessionGeneration = 0
export function getSessionGeneration() { return sessionGeneration }
export function advanceSessionGeneration() { sessionGeneration += 1 }

export async function requestJson(path: string, options: RequestInit = {}, handleUnauthorized = true): Promise<unknown> {
    const requestGeneration = sessionGeneration
    const headers = new Headers(options.headers)
    if (options.body) headers.set('Content-Type', 'application/json')
    const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin', cache: 'no-store' })
    let body: unknown
    try { body = await response.json() } catch { /* 使用状态码说明非 JSON 错误。 */ }
    if (!response.ok) {
        // 旧会话的响应只能拒绝自己的请求，不能退出之后建立的新会话。
        if (response.status === 401 && handleUnauthorized && requestGeneration === sessionGeneration) unauthorizedHandler()
        const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
            ? body.message : `请求失败：${response.status}`
        throw new ApiError(message, response.status)
    }
    return body
}

export function responseMessage(body: unknown): string {
    if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') return body.message
    throw new Error('服务器返回的数据格式不正确')
}

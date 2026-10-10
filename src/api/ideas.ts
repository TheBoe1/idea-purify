import type { CreateIdeaRequest, Idea, IdeaSuggestion } from '@/types/idea'
import { isIdea } from '../../shared/contracts/idea.ts'

async function responseError(response: Response): Promise<Error> {
    try {
        const body: unknown = await response.json()
        if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') {
            return new Error(body.message)
        }
    } catch { /* 非 JSON 错误响应使用状态码提示。 */ }
    return new Error(`请求失败：${response.status}`)
}

export const createIdea = async (request: CreateIdeaRequest): Promise<Idea> => {
    const response = await fetch('/api/idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaContent: request.ideaContent.trim() }),
    })
    if (!response.ok) throw await responseError(response)
    const data: unknown = await response.json()
    if (!isIdea(data)) throw new Error('保存结果的数据格式不正确')
    return data
}

export const loadIdeas = async (): Promise<Idea[]> => {
    const response = await fetch('/api/ideas')

    if (!response.ok) {
        throw await responseError(response)
    }

    const data: unknown = await response.json()
    if (!Array.isArray(data) || !data.every(isIdea)) {
        throw new Error('想法列表的数据格式不正确')
    }

    return data
}

export const loadAll = (): IdeaSuggestion[] => {
    return [
        { ideaContent: '我今天吃了'},
        { ideaContent: '我今天想要做' },
        { ideaContent: '我今天看到了什么' },
    ]
}

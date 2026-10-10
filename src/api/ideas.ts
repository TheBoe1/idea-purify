import type { CreateIdeaRequest, Idea, IdeaSuggestion } from '@/types/idea'
import { isIdea } from '../../shared/contracts/idea.ts'
import { requestJson } from './http'

export const createIdea = async (request: CreateIdeaRequest): Promise<Idea> => {
    const data = await requestJson('/idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaContent: request.ideaContent.trim() }),
    })
    if (!isIdea(data)) throw new Error('保存结果的数据格式不正确')
    return data
}

export const loadIdeas = async (): Promise<Idea[]> => {
    const data = await requestJson('/ideas')
    if (!Array.isArray(data) || !data.every(isIdea)) {
        throw new Error('想法列表的数据格式不正确')
    }

    return data
}

export const loadIdea = async (ideaId: string): Promise<Idea> => {
    const data = await requestJson(`/ideas/${encodeURIComponent(ideaId)}`)
    if (!isIdea(data)) throw new Error('想法详情的数据格式不正确')
    return data
}

export const loadAll = (): IdeaSuggestion[] => {
    return [
        { ideaContent: '我今天吃了'},
        { ideaContent: '我今天想要做' },
        { ideaContent: '我今天看到了什么' },
    ]
}

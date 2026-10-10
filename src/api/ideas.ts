import type { Idea, IdeaSuggestion } from '@/types/idea'
import { isIdea } from '../../shared/contracts/idea.ts'

export const loadIdeas = async (): Promise<Idea[]> => {
    const response = await fetch('/api/ideas')

    if (!response.ok) {
        throw new Error(`加载想法失败：${response.status}`)
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

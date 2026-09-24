import type { Idea } from '@/types/idea'
export const loadIdeas = async () => {
    const response = await fetch('/api/ideas')

    const data = await response.json()

    return data.map((item: { idea: string }) => ({
        value: item.idea
    }))
}
export const loadAll = () => {
    return [
        { ideaContent: '我今天吃了'},
        { ideaContent: '我今天想要做' },
        { ideaContent: '我今天看到了什么' },
    ]
}
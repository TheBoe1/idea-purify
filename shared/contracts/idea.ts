// 创建接口接收的内容；ID 和创建时间由后端生成。
export interface CreateIdeaRequest {
    ideaContent: string
}

export const IDEA_CONTENT_MAX_LENGTH = 255

export function getIdeaContentError(content: string): string | undefined {
    if (content.trim().length < 2) return '请输入至少两个字符'
    if (content.length > IDEA_CONTENT_MAX_LENGTH) return `想法最多 ${IDEA_CONTENT_MAX_LENGTH} 个字符`
}

// 已保存的想法，前后端共用这一份定义。
export interface Idea {
    ideaId: string
    ideaContent: string
    // 历史记录未保存创建时间时使用空字符串。
    createdTime: string
}

export function isCreateIdeaRequest(value: unknown): value is CreateIdeaRequest {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        'ideaContent' in value &&
        typeof value.ideaContent === 'string'
    )
}

export function isIdea(value: unknown): value is Idea {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        'ideaId' in value &&
        typeof value.ideaId === 'string' &&
        value.ideaId.length > 0 &&
        'ideaContent' in value &&
        typeof value.ideaContent === 'string' &&
        'createdTime' in value &&
        typeof value.createdTime === 'string'
    )
}

export type { CreateIdeaRequest, Idea } from '../../shared/contracts/idea'

// 前端草稿可以预留 ID，但创建请求只发送内容。
export interface IdeaDraft {
    ideaId?: string
    ideaContent: string
}

// 提前准备的输入提示词
export interface IdeaSuggestion {
    ideaContent: string
}

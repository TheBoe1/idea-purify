import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadIdeas } from '../api/ideas'

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('loadIdeas', () => {
    it('保留后端返回的想法 ID、内容和创建时间', async () => {
        const ideas = [
            {
                ideaId: 'idea-1',
                ideaContent: '一个想法',
                createdTime: '2026-10-10T08:00:00Z',
            },
        ]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ideas,
        }))

        await expect(loadIdeas()).resolves.toEqual(ideas)
    })

    it('拒绝仍然使用旧字段的响应，而不是返回缺少 ID 的数据', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [{ idea: '旧字段' }],
        }))

        await expect(loadIdeas()).rejects.toThrow('数据格式不正确')
    })

    it('将 HTTP 错误报告给调用页面', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

        await expect(loadIdeas()).rejects.toThrow('加载想法失败：500')
    })
})

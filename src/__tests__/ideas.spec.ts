import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdea, loadIdeas } from '../api/ideas'

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

        await expect(loadIdeas()).rejects.toThrow('请求失败：500')
    })
})

describe('createIdea', () => {
    it('只提交去除首尾空格的内容，返回后端保存的完整记录', async () => {
        const idea = { ideaId: '10', ideaContent: '用户想法', createdTime: '2026-10-10T08:00:00Z' }
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(idea), { status: 201 }))
        vi.stubGlobal('fetch', fetchMock)
        const draft = { ideaId: 'temporary', ideaContent: '  用户想法  ' }
        await expect(createIdea(draft)).resolves.toEqual(idea)
        expect(fetchMock).toHaveBeenCalledWith('/api/idea', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ ideaContent: '用户想法' }),
        }))
    })

    it('把后端错误信息传给页面，避免失败时显示保存成功', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, status: 503, json: async () => ({ message: '暂时无法保存想法' }),
        }))
        await expect(createIdea({ ideaContent: '用户想法' })).rejects.toThrow('暂时无法保存想法')
    })
})

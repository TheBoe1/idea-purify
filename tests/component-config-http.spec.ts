// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import session from 'express-session'
import { createIdeaServer } from '../backend/app.ts'
import { hashPassword } from '../backend/auth/password.ts'
import type { ComponentConfigRepository } from '../backend/db/component-configs.ts'
import { COMPONENT_DEFINITIONS } from '../shared/contracts/component-config.ts'
import type { ComponentConfig, ComponentSchema } from '../shared/contracts/component-config.ts'
import { createSecurityRepositories } from './security-fixtures.ts'

const configId = 'd6e3a054-bc2f-4cc0-a8bb-0c345a16d5f0'
const schema: ComponentSchema = { schemaVersion: 1, libraryKey: 'element-plus', componentKey: 'input',
  name: '共享输入', props: { placeholder: '请输入内容', clearable: true }, field: 'title', children: [] }
const result: ComponentConfig = { configId, schema, createdTime: '2026-10-13T00:00:00Z', updatedTime: '2026-10-13T00:00:00Z' }
const password = 'Config acceptance password 2026!'
const hashed = hashPassword(password)
let server: http.Server
let base: string
let adminCookie: string
let userCookie: string
let adminId: string
let repository: { [K in keyof ComponentConfigRepository]: ReturnType<typeof vi.fn<ComponentConfigRepository[K]>> }

async function request(path: string, cookie = '', method = 'GET', input?: unknown) {
  const headers = { 'Content-Type': 'application/json', Cookie: cookie }
  return fetch(`${base}${path}`, { method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
}
beforeEach(async () => {
  const fixtures = createSecurityRepositories()
  const passwordHash = await hashed
  const admin = await fixtures.authRepository.create({ username: 'config_admin', email: null, role: 'admin', passwordHash })
  await fixtures.authRepository.create({ username: 'config_user', email: null, role: 'user', passwordHash })
  adminId = admin.userId
  repository = {
    listDefinitions: vi.fn<ComponentConfigRepository['listDefinitions']>().mockResolvedValue(COMPONENT_DEFINITIONS),
    create: vi.fn<ComponentConfigRepository['create']>().mockResolvedValue(result),
    update: vi.fn<ComponentConfigRepository['update']>().mockResolvedValue(result),
    list: vi.fn<ComponentConfigRepository['list']>().mockResolvedValue([result]),
    find: vi.fn<ComponentConfigRepository['find']>().mockResolvedValue(result),
  }
  server = createIdeaServer(fixtures.ideaRepository, { authRepository: fixtures.authRepository,
    sessionStore: new session.MemoryStore(), sessionSecret: 'component-config-test-secret-at-least-32', appOrigin: 'http://127.0.0.1:5173',
    mailer: { async send() {} }, componentConfigRepository: repository })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  for (const username of ['config_admin', 'config_user']) {
    const response = await request('/auth/login', '', 'POST', { username, password })
    expect(response.status).toBe(200)
    const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!
    if (username === 'config_admin') adminCookie = cookie
    else userCookie = cookie
  }
})
afterEach(async () => {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

describe('共享组件配置 HTTP 验收', () => {
  it('匿名读写均为 401，普通用户只有读取权限', async () => {
    for (const path of ['/component-definitions', '/component-configs', `/component-configs/${configId}`]) {
      expect((await request(path)).status).toBe(401)
      expect((await request(path, userCookie)).status).toBe(200)
    }
    for (const [path, method] of [['/admin/component-configs', 'POST'], [`/admin/component-configs/${configId}`, 'PUT']] as const) {
      expect((await request(path, '', method, { schema })).status).toBe(401)
      expect((await request(path, userCookie, method, { schema })).status).toBe(403)
    }
    expect(repository.create).not.toHaveBeenCalled()
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('管理员创建返回保存记录，归属使用真实会话；普通用户可以复用相同配置', async () => {
    const response = await request('/admin/component-configs', adminCookie, 'POST', { schema })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(result)
    expect(repository.create).toHaveBeenCalledWith(adminId, schema)
    expect(await (await request('/component-configs', userCookie)).json()).toEqual([result])
    expect(await (await request(`/component-configs/${configId}`, userCookie)).json()).toEqual(result)
  })

  it('更新既有实例返回同一 ID，不提供删除 API', async () => {
    const edited = { ...schema, name: '已更新的共享输入', props: { placeholder: '更新提示' } }
    repository.update.mockResolvedValue({ ...result, schema: edited })
    const response = await request(`/admin/component-configs/${configId}`, adminCookie, 'PUT', { schema: edited })
    expect(response.status).toBe(200)
    expect((await response.json()).configId).toBe(configId)
    expect(repository.update).toHaveBeenCalledWith(adminId, configId, edited)
    expect((await request(`/admin/component-configs/${configId}`, adminCookie, 'DELETE', {})).status).toBe(404)
  })

  it('未知版本、脚本属性、动作、用户归属和预览数据写入前受控拒绝', async () => {
    for (const input of [
      { schema: { ...schema, schemaVersion: 2 } }, { schema: { ...schema, props: { onInput: 'alert(1)' } } },
      { schema: { ...schema, componentKey: 'script' } }, { schema: { ...schema, actions: [{ event: 'input', actionKey: 'request' }] } },
      { schema, userId: 'forged' }, { schema, modelValue: '不可存储的预览内容' }, null,
    ]) expect((await request('/admin/component-configs', adminCookie, 'POST', input)).status).toBe(400)
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('未知 UUID 返回 404，非法 ID 不传入 Repository', async () => {
    repository.find.mockResolvedValue(null)
    repository.update.mockResolvedValue(null)
    expect((await request(`/component-configs/${configId}`, userCookie)).status).toBe(404)
    expect((await request(`/admin/component-configs/${configId}`, adminCookie, 'PUT', { schema })).status).toBe(404)
    repository.find.mockClear()
    repository.update.mockClear()
    for (const id of ['unknown', '1%20OR%201=1', '../../script']) {
      expect((await request(`/component-configs/${id}`, userCookie)).status).toBe(404)
      expect((await request(`/admin/component-configs/${id}`, adminCookie, 'PUT', { schema })).status).toBe(404)
    }
    expect(repository.find).not.toHaveBeenCalled()
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('数据库失败返回 503 且不泄露内部 SQL、连接账号或密码', async () => {
    const internal = new Error('SELECT secret FROM component_config; user=internal password=private')
    repository.create.mockRejectedValue(internal)
    repository.list.mockRejectedValue(internal)
    for (const response of [await request('/admin/component-configs', adminCookie, 'POST', { schema }), await request('/component-configs', userCookie)]) {
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body).toEqual({ message: '服务暂时不可用，请稍后重试' })
      expect(JSON.stringify(body)).not.toContain('SELECT')
    }
  })
})

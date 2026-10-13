import { Router } from 'express'
import type { Request, RequestHandler } from 'express'
import { getSaveComponentConfigError, isSaveComponentConfigRequest } from '../../shared/contracts/component-config.ts'
import type { ComponentConfigRepository } from '../db/component-configs.ts'

interface RouteOptions {
  repository?: ComponentConfigRepository
  authenticated: RequestHandler
  administrator: RequestHandler
  error: (status: number, message: string) => Error
}

export function createComponentConfigRouter(options: RouteOptions): Router {
  const router = Router()
  function repository(): ComponentConfigRepository {
    if (!options.repository) throw options.error(503, '配置服务暂时不可用')
    return options.repository
  }
  function id(req: Request): string {
    const value = req.params.configId
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw options.error(404, '组件配置不存在')
    return value
  }
  function schema(req: Request) {
    const input: unknown = req.body
    if (!isSaveComponentConfigRequest(input)) throw options.error(400, getSaveComponentConfigError(input) ?? '组件配置无效')
    return input.schema
  }
  router.get('/component-definitions', options.authenticated, async (_req, res) => {
    res.json(await repository().listDefinitions())
  })
  router.get('/component-configs', options.authenticated, async (_req, res) => {
    res.json(await repository().list())
  })
  router.get('/component-configs/:configId', options.authenticated, async (req, res) => {
    const saved = await repository().find(id(req))
    if (!saved) throw options.error(404, '组件配置不存在')
    res.json(saved)
  })
  router.post('/admin/component-configs', options.authenticated, options.administrator, async (req, res) => {
    const input = schema(req)
    res.status(201).json(await repository().create(req.user!.userId, input))
  })
  router.put('/admin/component-configs/:configId', options.authenticated, options.administrator, async (req, res) => {
    const configId = id(req)
    const input = schema(req)
    const saved = await repository().update(req.user!.userId, configId, input)
    if (!saved) throw options.error(404, '组件配置不存在')
    res.json(saved)
  })
  return router
}

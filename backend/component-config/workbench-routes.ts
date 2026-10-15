import { Router } from 'express'
import type { Request, Response, RequestHandler, NextFunction } from 'express'
import {
  getCreatePageConfigError,
  getUpdatePageConfigError,
  getSaveTemplateError,
  getPageTargetError,
  isCreatePageConfigRequest,
  isUpdatePageConfigRequest,
  isSaveTemplateRequest,
  isUpdateTemplateRequest,
  isPageTarget,
} from '../../shared/contracts/workbench.ts'
import { WorkbenchConflictError } from './errors.ts'
import type { WorkbenchRepository } from '../db/workbench.ts'

interface Options {
  repository?: WorkbenchRepository
  authenticated: RequestHandler
  administrator: RequestHandler
  error: (status: number, message: string) => Error
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createWorkbenchRouter(options: Options): Router {
  const router = Router()
  const admin = [options.authenticated, options.administrator]
  function repository(): WorkbenchRepository {
    if (!options.repository) throw options.error(503, '工作台服务暂时不可用')
    return options.repository
  }
  function id(req: Request): string {
    const value = req.params.id
    if (typeof value !== 'string' || !uuid.test(value)) throw options.error(404, '配置不存在')
    return value
  }
  router.get('/admin/catalog', admin, async (_req: Request, res: Response) =>
    res.json(await repository().listCatalog()),
  )
  router.get('/admin/templates', admin, async (_req: Request, res: Response) =>
    res.json(await repository().listTemplates()),
  )
  router.get('/admin/templates/:id', admin, async (req: Request, res: Response) => {
    const value = await repository().findTemplate(id(req))
    if (!value) throw options.error(404, '方案不存在')
    res.json(value)
  })
  router.post('/admin/templates', admin, async (req: Request, res: Response) => {
    if (!isSaveTemplateRequest(req.body))
      throw options.error(400, getSaveTemplateError(req.body) ?? '方案无效')
    res.status(201).json(await repository().createTemplate(req.user!.userId, req.body.schema))
  })
  router.put('/admin/templates/:id', admin, async (req: Request, res: Response) => {
    const configId = id(req)
    if (!isUpdateTemplateRequest(req.body))
      throw options.error(400, getSaveTemplateError(req.body, true) ?? '方案无效')
    const value = await repository().updateTemplate(
      req.user!.userId,
      configId,
      req.body.schema,
      req.body.expectedRevision,
    )
    if (!value) throw options.error(404, '方案不存在')
    res.json(value)
  })
  router.get('/admin/page-configs', admin, async (_req: Request, res: Response) =>
    res.json(await repository().listPages()),
  )
  router.get('/admin/page-configs/:id', admin, async (req: Request, res: Response) => {
    const value = await repository().findPage(id(req))
    if (!value) throw options.error(404, '页面配置不存在')
    res.json(value)
  })
  router.post('/admin/page-configs', admin, async (req: Request, res: Response) => {
    if (!isCreatePageConfigRequest(req.body))
      throw options.error(400, getCreatePageConfigError(req.body) ?? '页面配置无效')
    res.status(201).json(await repository().createPage(req.user!.userId, req.body))
  })
  router.put('/admin/page-configs/:id', admin, async (req: Request, res: Response) => {
    const pageConfigId = id(req)
    if (!isUpdatePageConfigRequest(req.body))
      throw options.error(400, getUpdatePageConfigError(req.body) ?? '页面配置无效')
    const value = await repository().updatePage(req.user!.userId, pageConfigId, req.body)
    if (!value) throw options.error(404, '页面配置不存在')
    res.json(value)
  })
  router.post('/admin/page-configs/:id/publish', admin, async (req: Request, res: Response) => {
    const pageConfigId = id(req)
    const input: unknown = req.body
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !('expectedRevision' in input) ||
      typeof input.expectedRevision !== 'number' ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    )
      throw options.error(400, '发布需提交当前 expectedRevision')
    const value = await repository().publishPage(
      req.user!.userId,
      pageConfigId,
      input.expectedRevision,
    )
    if (!value) throw options.error(404, '页面配置不存在')
    res.json(value)
  })
  router.get('/ui/pages/:pageKey', options.authenticated, async (req, res) => {
    const target = { kind: 'dynamic', pageKey: req.params.pageKey, regionKey: 'root' }
    if (!isPageTarget(target)) throw options.error(404, getPageTargetError(target) ?? '页面不存在')
    const value = await repository().findPublished(target)
    if (!value) throw options.error(404, '页面不存在或尚未发布')
    res.json(value)
  })
  router.get('/ui/regions/:pageKey/:regionKey', options.authenticated, async (req, res) => {
    const target = {
      kind: 'existing',
      pageKey: req.params.pageKey,
      regionKey: req.params.regionKey,
    }
    if (!isPageTarget(target)) throw options.error(404, '页面区域未注册')
    const value = await repository().findPublished(target)
    if (!value) throw options.error(404, '该区域尚未发布')
    res.json(value)
  })
  router.use((error: unknown, _req: Request, _res: Response, next: NextFunction) => {
    next(error instanceof WorkbenchConflictError ? options.error(409, error.message) : error)
  })
  return router
}

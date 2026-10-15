// 路由与仓库共享领域错误，不让纯 HTTP 应用工厂导入数据库连接配置。
export class WorkbenchConflictError extends Error {}

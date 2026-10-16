# idea-purify

Vue + Element Plus + Node.js + MySQL 的想法记录应用。支持用户注册、登录、管理员禁用账号，以及每个用户自己的想法时间线、卡片和详情。

## 组件工作台与页面发布

首页保留 Idea 输入、提示词、草稿和提交。用户名下拉菜单提供个人资料、退出及管理员入口；管理区域统一放置用户管理、组件目录和方案工作台。

工作台以 Element Plus **2.14.5** 的官方 **82 条目录**及版本匹配的 Props/Events/Slots/Exposes 元数据为基础，通过结构化编辑保存 Schema。组件、服务、指令、设计规范及内部接口分别表达；元数据覆盖不等于所有高级交互已经逐项验收。没有任意 JS、数据库动态 import 或路由模块执行入口。

方案保存在 MySQL；管理员将方案关联到独立 `/pages/:pageKey` 或既有页面的注册区域，显式发布后已登录用户才能读取。草稿修改不改变正在使用的发布快照，更新/发布使用 `expectedRevision` 防止旧编辑覆盖。模板、目录和后台配置读写均仅管理员可用。

- `component_definition` 保存代码安装的元数据，`component_config` 保存 V1/V2 方案，`ui_page_config` 保存页面目标、草稿及发布快照。`npm run db:init` 增量安装；既有账号和 Idea 不清空、不重分配。
- V1 的 input/textarea/button 记录与接口保持兼容，旧配置 GET 接口也改为管理员权限；普通用户通过 `/ui/pages`、`/ui/regions` 读取发布内容。
- `shared/contracts/workbench.ts` 校验版本、类型化属性、模型/回调、槽位、词法作用域、资源及受控动作。浏览器运行实例的输入不会自动写回配置；本人 Idea 仍由原 API 保存与隔离。
- 管理 API：`/admin/catalog`、`/admin/templates`、`/admin/page-configs` 及 `/:id/publish`。Node 会话/角色校验为最终权限边界；没有配置删除 API。

工作台可在站内打开组件目录，按用途查找并添加；常用属性直接编辑，完整 API 保持可达。有效配置在防抖后自动预览；预览中的挂载服务只手动触发，发布运行仍支持原有 mount。方案管理列出组件方案、页面草稿及发布状态；保存为显式操作，更新与发布仍分别校验版本。未保存编辑有切换、离开、刷新及退出确认，当前标签内存可在同账号会话中断后恢复，刷新或关闭前仍应先保存。UX 改造及实际验收边界见 [操作流程与交付记录](docs/workbench-ux-delivery.md)。

具体架构、API 表和现有区域清单见 [组件工作台架构](docs/component-config-phase-a.md)，已执行与待执行验证见 [工作台验收记录](docs/testing-component-config.md)。真实 MySQL 验收脚本独立执行：

```sh
node --env-file-if-exists=.env.local tests/mysql-component-config-smoke.ts
node --env-file-if-exists=.env.local tests/mysql-workbench-smoke.ts
```

脚本只创建随机临时账号及其配置，精确清理并比较既有数据指纹；不发送邮件。第二个脚本需要至少一个未占用的注册页面区域，且运行期间避免并发修改既有数据，以免指纹比较产生干扰。拖拽、完整动态菜单和工作流不在本次实现范围。

## 本地启动

需要 Node.js 22.18+（或 24.12+）和 MySQL 8。

1. 在项目根目录运行 `npm ci`，使用已提交的 npm 锁文件安装依赖。
2. 由数据库管理员创建 `Ideasource` 数据库及本机项目账号，例如：

```sql
CREATE DATABASE IF NOT EXISTS Ideasource CHARACTER SET utf8mb4;
CREATE USER 'idea_purify'@'localhost' IDENTIFIED BY 'replace-with-your-local-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER ON Ideasource.* TO 'idea_purify'@'localhost';
```

3. 复制 `.env.example` 为 `.env.local`，填写本机配置。真实密码不提交到 Git，也不使用 `VITE_` 前缀。
4. 配置随机 `SESSION_SECRET`。`APP_ORIGIN` 用于生成邮箱验证和密码重设链接，本地默认 `http://127.0.0.1:5173`；它不用于请求来源校验。需要发送邮件时，将它设为收件人能够打开的前端地址。
5. 运行 `npm run db:init` 创建或兼容已有账号、想法及工作台表，增量增加昵称、配置版本、页面发布和已安装目录元数据。原有匿名想法保留为未认领记录，不向任何账号显示。已有部署应先备份，再执行迁移。
6. 如需导入原有 JSON 想法，运行 `npm run db:import-json`。只向空表导入；表已有数据时跳过，避免重复。导入记录同样保持未认领。JSON 文件只作为历史备份，运行时不再读写它。
7. 运行 `npm run dev`，打开 Vite 输出的地址（默认端口 5173），然后注册普通用户。Vite 自动改用其他端口时，登录不会因来源不匹配被拦截。

如果 MySQL 运行在 Docker 中，服务端可能将本机连接识别为容器网关 IP。本机目前是 `172.18.0.1`，已为专用账号配置这个来源；其他机器应按实际登录错误中的主机地址授权，仍只授予项目数据库权限。

后端默认监听 http://127.0.0.1:3000。`.env.local` 的 `PORT` 可以更改端口；Vite 代理使用同一个配置。`npm run start:server` 单独启动后端，`npm run dev:client` 单独启动前端。

`npm run dev` 使用 Node 自带的环境文件加载和 TypeScript 支持，不依赖临时下载 tsx。后端与共享类型也包含在项目类型检查中。

## 数据结构与接口

共享定义在 `shared/contracts/idea.ts`。前端草稿可预留 `ideaId`，创建请求只提交 `ideaContent`。

- `POST /idea`：接收 JSON `{ "ideaContent": "一个想法" }`，去除首尾空格，验证长度为 2–255，执行参数化 INSERT。事务提交成功后返回 201 和完整 `Idea`。
- `GET /ideas`：从同一张 `idea` 表查询当前用户的 `Idea[]`。
- `GET /ideas/:ideaId`：返回当前用户的想法详情；其他用户的 ID 与不存在的 ID 都返回 404。
- 页面请求 `/api/idea` 和 `/api/ideas`，由 Vite 代理到后端。
- 非法 JSON/内容返回 400，错误 Content-Type 返回 415，Idea/认证超过 16 KiB 返回 413，数据库读取或写入失败返回 503。管理配置 HTTP 上限为 256 KiB，其中单份 Schema 限 UTF-8 128 KiB。

数据库字段 `id / idea_content / create_time` 映射为接口字段 `ideaId / ideaContent / createdTime`。`user_id` 来自服务端登录会话，不能由客户端指定。ID 以字符串返回；新记录时间由后端生成，以 UTC ISO 字符串返回，页面按本地时区显示。建表语句位于 `backend/db/schema.sql`，初始化不清空已有记录。

## 账号与安全

用户名为 3–32 位 ASCII 字母、数字或下划线，以字母开头，统一转换为小写；密码为 12–128 个字符。邮箱可选。个人资料通过 `PATCH /auth/profile {nickname}` 修改本人昵称，trim 后为 1–40 个 Unicode 字符，拒绝控制/隐藏字符；username、角色和 userId 不随昵称变化。公开注册只能创建普通用户，管理员可管理、禁用普通账号，不能查看其他人的想法。

密码使用 Argon2id，随机盐和 256 位摘要由库生成，数据库保存完整算法、参数、盐、摘要，不能还原原密码。想法正文正常保存，使用参数化 SQL 和 Vue 文本转义；不会用删除引号或尖括号的方式损坏内容。

Passport 与 express-session 管理登录会话，MySQL 持久保存，Cookie 使用 HttpOnly 和 SameSite=Strict。生产部署必须使用 HTTPS 并设置 `COOKIE_SECURE=true`。写接口不校验 Origin，但仍只接受 JSON Content-Type；浏览器表单和文本提交会返回 415。后端没有开放 CORS，浏览器不能直接从其他站点发起跨站 JSON 写请求；前端通过同源 `/api` 代理访问。若未来开放 CORS，应同步设计 CSRF 防护。登录有请求频率限制；当前限流存储位于单个 Node 进程，多实例部署需要接共享限流存储。

当前 Node 监听本机 HTTP，未信任代理转发头。未来经 HTTPS 反向代理部署时，还需明确配置固定可信代理并验证 Secure Cookie 能正常下发；不能直接开启无范围的 `trust proxy`。本阶段验收的是本机开发流程。

会话过期或账号被禁用时接口返回 401，页面提示并显示登录/注册弹窗。服务端销毁失效旧会话；延迟到达的旧 401 不清除或重发旧 SID Cookie，避免覆盖新登录。携带失效 Cookie 可直接重新登录，错误凭据不产生匿名 SID；显式退出仍清除 Cookie。首页的 Idea 未提交草稿按账号暂存在当前标签的 sessionStorage，刷新可恢复；暂存失败会提示并保留当前输入，支持重试或确认丢弃。会话失效会清理标签缓存，同账号重登仍可继续当前内存内容；显式退出会清空。配置业务节点的输入仍保留在各自实例内存中。退出或切换账号后清除先前账号的展示数据。密码重设会使旧会话失效。

## 邮箱验证与重设密码

在 `.env.local` 配置 `SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASSWORD / SMTP_FROM`。邮箱授权码仅保存在本机环境文件，不写到源码、聊天或 Git。465 通常使用直接 TLS；587 使用 STARTTLS，具体以服务商设置为准。

注册时填写邮箱会收到验证链接，验证后才能通过该邮箱重设密码。重设操作保存新密码哈希，不读取或恢复旧密码。邮件链接只用一次、30 分钟过期，数据库只存随机令牌的 SHA-256 摘要。不填写邮箱的账号不能自助找回密码。

邮件发送失败时页面必须显示实际状态；注册账号仍保留，可以重新发送验证邮件。找回接口使用统一回应，避免公开某个邮箱是否注册。SMTP 连接检查、模拟发送测试不能代替实际邮件到达验收。

Brevo 使用 `smtp-relay.brevo.com:587`、`SMTP_SECURE=false`，强制 STARTTLS。`SMTP_USER` 是后台显示的 SMTP 登录名，`SMTP_PASSWORD` 是 SMTP key，`SMTP_FROM` 必须是已验证的发件人。用 `npm run mail:check` 验证连接；设置 `MAIL_TEST_TO` 并运行 `npm run mail:check -- --send` 才会主动发送测试邮件。

首次管理员初始化：在本机环境文件填写 `ADMIN_USERNAME / ADMIN_PASSWORD`，执行 `npm run auth:create-admin`。命令不会提升已经存在的普通用户，不打印密码；完成后从环境文件移除这两个初始化字段。正式运行的登录界面没有默认管理员账号。

## 检查与验收

```sh
npm run build
npm run test:unit -- --run
npm run test:integration
```

验收流程见 `docs/testing-auth.md`：注册两个用户 → 输入想法并保存 → 归档与卡片可见 → 点击详情 → 刷新保持 → 切换用户后无法查看前一用户记录。还需要确认登录过期提示、管理员禁用、邮箱验证与一次性重设密码、SQL/XSS 字面量及数据库故障。

依赖检查：`npm audit --omit=dev` 检查运行依赖。开发工具的 `@vue/eslint-config-typescript → fast-glob → micromatch → braces` 存在尚无兼容发布修复的深层模式递归问题；本项目不向该开发工具传入用户请求，后续发布修复后需更新并复查。

生产环境需要单独运行 Node 服务，并将 `/api` 代理到它；Vite 的代理配置只用于开发。

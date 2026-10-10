# idea-purify

Vue + Element Plus + Node.js + MySQL 的想法记录应用。输入内容时显示预设提示词，提交后保存到 MySQL，在归档页用时间线查看历史想法。

## 本地启动

需要 Node.js 22.18+（或 24.12+）和 MySQL 8。

1. 在项目根目录运行 `npm install`。
2. 由数据库管理员创建 `Ideasource` 数据库及本机项目账号，例如：

```sql
CREATE DATABASE IF NOT EXISTS Ideasource CHARACTER SET utf8mb4;
CREATE USER 'idea_purify'@'localhost' IDENTIFIED BY 'replace-with-your-local-password';
GRANT SELECT, INSERT, CREATE, ALTER ON Ideasource.* TO 'idea_purify'@'localhost';
```

3. 复制 `.env.example` 为 `.env.local`，填写本机配置。真实密码不提交到 Git，也不使用 `VITE_` 前缀。
4. 运行 `npm run db:init` 创建或兼容已有的 `idea` 表。
5. 如需导入原有 JSON 想法，运行 `npm run db:import-json`。只向空表导入；表已有数据时跳过，避免重复。旧记录没有时间的保存为 NULL，页面显示“创建时间未记录”。导入时由 MySQL 分配 ID，JSON 文件只作为历史备份，运行时不再读写它。
6. 运行 `npm run dev`，打开终端显示的 Vite 地址（通常是 http://localhost:5173）。

如果 MySQL 运行在 Docker 中，服务端可能将本机连接识别为容器网关 IP。本机目前是 `172.18.0.1`，已为专用账号配置这个来源；其他机器应按实际登录错误中的主机地址授权，仍只授予项目数据库权限。

后端默认监听 http://127.0.0.1:3000。`.env.local` 的 `PORT` 可以更改端口；Vite 代理使用同一个配置。`npm run start:server` 单独启动后端，`npm run dev:client` 单独启动前端。

`npm run dev` 使用 Node 自带的环境文件加载和 TypeScript 支持，不依赖临时下载 tsx。后端与共享类型也包含在项目类型检查中。

## 数据结构与接口

共享定义在 `shared/contracts/idea.ts`。前端草稿可预留 `ideaId`，创建请求只提交 `ideaContent`。

- `POST /idea`：接收 JSON `{ "ideaContent": "一个想法" }`，去除首尾空格，验证长度为 2–255，执行参数化 INSERT。事务提交成功后返回 201 和完整 `Idea`。
- `GET /ideas`：从同一张 `idea` 表查询，按创建时间和 ID 从新到旧返回 `Idea[]`。
- 页面请求 `/api/idea` 和 `/api/ideas`，由 Vite 代理到后端。
- 非法 JSON/内容返回 400，错误 Content-Type 返回 415，超过 16 KiB 的请求返回 413，数据库读取或写入失败返回 503。

数据库字段 `id / idea_content / create_time` 映射为接口字段 `ideaId / ideaContent / createdTime`。ID 以字符串返回；新记录时间由后端生成，以 UTC ISO 字符串返回，页面按本地时区显示。建表语句位于 `backend/db/schema.sql`，初始化仅兼容创建时间可为空，不清空已有记录。

## 检查与验收

```sh
npm run build
npm run test:unit -- --run
```

验收流程：输入“我今天”触发提示词 → 输入自己的内容并提交 → 点击归档看到新想法和时间 → 刷新后记录仍在。空白或不足两个字符不能提交；失败时保留输入、恢复提交按钮；归档加载失败时显示错误并支持刷新重试。

生产环境需要单独运行 Node 服务，并将 `/api` 代理到它；Vite 的代理配置只用于开发。

# 系统架构

## 源码边界

```text
src/
├── client/  浏览器入口、页面、组件、样式与前端 API Client
├── server/  HTTP API、认证授权、组织管理、数据库与 Fal 接口
├── worker/  Fal 队列恢复、租约执行与邀请邮件投递
└── shared/  跨运行时领域模型、DTO、常量与工作流契约
```

客户端只依赖 `client` 与 `shared`，`shared` 不依赖任何运行时目录。Server API 负责装配 Worker，Worker 可复用 `server` 中的数据库、Fal 凭证和账单服务；客户端不得导入服务端或 Worker 实现。

## 运行时

- 浏览器通过同源 API 访问认证、组织、素材、画布状态与 Fal 任务。
- Node 服务统一执行会话、CSRF、权限、Tenant/Project 范围和输入校验。
- SQLite 保存业务状态、组织数据、Fal 作业、租约、恢复载荷与邮件 Outbox。
- Worker 在服务进程内启动，通过租约推进未完成任务；当前拓扑仅支持单机多进程，不支持多主机共享 SQLite。
- 前端产物输出到 `dist/`，服务端产物输出到 `dist-server/server.mjs`。

身份、租户与命令授权的详细设计见 [architecture/auth-tenant-design.md](architecture/auth-tenant-design.md)。数据库模型、迁移和恢复见 [operations/database-runbook.md](operations/database-runbook.md)。

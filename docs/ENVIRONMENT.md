# 环境变量

生产模板见 [deploy/content-studio.env.example](../deploy/content-studio.env.example)。密钥文件与身份配置必须使用 `0600` 权限，数据目录建议使用 `0700` 权限。

## 服务与发布

| 变量 | 用途 |
| --- | --- |
| `CONTENT_STUDIO_HOST` | 服务监听地址；生产必须为 loopback |
| `CONTENT_STUDIO_PORT` | 服务端口，默认 `4173` |
| `CONTENT_STUDIO_PUBLIC_BASE_URL` | 对外 HTTPS 地址及同源校验基准 |
| `CONTENT_STUDIO_SECURE_COOKIES` | 生产必须为 `true` |
| `CONTENT_STUDIO_RELEASE_ARTIFACT_DIR` | 前端构建目录，默认 `dist` |
| `CONTENT_STUDIO_RELEASE_SERVER_FILE` | 服务端构建入口，默认 `dist-server/server.mjs` |
| `CONTENT_STUDIO_RELEASE_BACKUP_FILE` | 发布前 SQLite 回滚备份 |
| `CONTENT_STUDIO_RELEASE_VERSION` | 写入发布元数据的版本覆盖值 |
| `CONTENT_STUDIO_RELEASE_REVISION` | 写入发布元数据的 Git revision 覆盖值 |
| `CONTENT_STUDIO_RELEASE_DIRTY` | 发布元数据的工作树状态覆盖值 |

## 身份、数据与素材

| 变量 | 用途 |
| --- | --- |
| `CONTENT_STUDIO_AUTH_CONFIG_FILE` | 身份配置文件 |
| `CONTENT_STUDIO_PERSISTENCE_BACKEND` | `sqlite` 或迁移回滚用 `file` |
| `CONTENT_STUDIO_DATABASE_FILE` | SQLite 数据库文件 |
| `CONTENT_STUDIO_ASSET_DIR` | 内容哈希素材目录 |
| `CONTENT_STUDIO_STATE_FILE` | 旧单文件画布状态，仅迁移/回滚使用 |
| `CONTENT_STUDIO_STATE_DIR` | 旧分区画布状态目录，仅迁移/回滚使用 |

## Fal 与 Worker

| 变量 | 用途 |
| --- | --- |
| `FAL_KEY_FILE` | Fal 推理 Key 文件，生产必用 |
| `FAL_ADMIN_KEY_FILE` | Fal Billing Admin Key 文件，生产必用 |
| `FAL_KEY` | Fal 推理 Key，仅本地开发兼容 |
| `FAL_ADMIN_KEY` | Fal Admin Key，仅本地诊断兼容 |
| `CONTENT_STUDIO_FAL_WORKER_INTERVAL_MS` | Worker 轮询间隔，默认 `2500` |
| `CONTENT_STUDIO_FAL_LEASE_TTL_MS` | 作业租约时长，默认 `15000` |
| `CONTENT_STUDIO_FAL_BILLING_RETRY_MS` | 账单对账重试间隔，默认 `300000` |
| `CONTENT_STUDIO_FAL_JOB_STATE_FILE` | 旧单文件队列状态，仅迁移/回滚使用 |
| `CONTENT_STUDIO_FAL_JOB_STATE_DIR` | 旧分区队列目录，仅迁移/回滚使用 |

## 邀请邮件

| 变量 | 用途 |
| --- | --- |
| `CONTENT_STUDIO_EMAIL_FROM` | 邀请邮件发件人 |
| `CONTENT_STUDIO_EMAIL_WEBHOOK_URL` | HTTPS 邮件 Relay 地址 |
| `CONTENT_STUDIO_EMAIL_WEBHOOK_KEY_FILE` | Relay 鉴权 Key 文件 |
| `CONTENT_STUDIO_INVITATION_ENCRYPTION_KEY_FILE` | 邀请 Outbox 加密 Key 文件 |

变量组合、阻塞码与生产示例见 [operations/release-preflight.md](operations/release-preflight.md)、[operations/deployment-runbook.md](operations/deployment-runbook.md) 和 [operations/tenant-state-migration.md](operations/tenant-state-migration.md)。

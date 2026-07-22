# 环境变量

生产模板见 [deploy/pias.env.example](../deploy/pias.env.example)。密钥文件与身份配置必须使用 `0600` 权限，数据目录建议使用 `0700` 权限。

## 服务与发布

| 变量 | 用途 |
| --- | --- |
| `PIAS_HOST` | 服务监听地址；生产必须为 loopback |
| `PIAS_PORT` | 服务端口，默认 `4173` |
| `PIAS_PUBLIC_BASE_URL` | 对外 HTTPS 地址及同源校验基准 |
| `PIAS_SECURE_COOKIES` | 生产必须为 `true` |
| `PIAS_RELEASE_ARTIFACT_DIR` | 前端构建目录，默认 `dist` |
| `PIAS_RELEASE_SERVER_FILE` | 服务端构建入口，默认 `dist-server/server.mjs` |
| `PIAS_RELEASE_BACKUP_FILE` | 发布前 SQLite 回滚备份 |
| `PIAS_RELEASE_VERSION` | 写入发布元数据的版本覆盖值 |
| `PIAS_RELEASE_REVISION` | 写入发布元数据的 Git revision 覆盖值 |
| `PIAS_RELEASE_DIRTY` | 发布元数据的工作树状态覆盖值 |

## 身份、数据与素材

| 变量 | 用途 |
| --- | --- |
| `PIAS_AUTH_CONFIG_FILE` | 身份配置文件 |
| `PIAS_PERSISTENCE_BACKEND` | `sqlite` 或迁移回滚用 `file` |
| `PIAS_DATABASE_FILE` | SQLite 数据库文件 |
| `PIAS_ASSET_DIR` | 内容哈希素材目录 |
| `PIAS_STUDIO_STATE_FILE` | 旧单文件画布状态，仅迁移/回滚使用 |
| `PIAS_STUDIO_STATE_DIR` | 旧分区画布状态目录，仅迁移/回滚使用 |

## Fal 与 Worker

| 变量 | 用途 |
| --- | --- |
| `FAL_KEY_FILE` | Fal 推理 Key 文件，生产必用 |
| `FAL_ADMIN_KEY_FILE` | Fal Billing Admin Key 文件，生产必用 |
| `FAL_KEY` | Fal 推理 Key，仅本地开发兼容 |
| `FAL_ADMIN_KEY` | Fal Admin Key，仅本地诊断兼容 |
| `PIAS_FAL_WORKER_INTERVAL_MS` | Worker 轮询间隔，默认 `2500` |
| `PIAS_FAL_LEASE_TTL_MS` | 作业租约时长，默认 `15000` |
| `PIAS_FAL_BILLING_RETRY_MS` | 账单对账重试间隔，默认 `300000` |
| `PIAS_FAL_JOB_STATE_FILE` | 旧单文件队列状态，仅迁移/回滚使用 |
| `PIAS_FAL_JOB_STATE_DIR` | 旧分区队列目录，仅迁移/回滚使用 |

## 邀请邮件

| 变量 | 用途 |
| --- | --- |
| `PIAS_EMAIL_FROM` | 邀请邮件发件人 |
| `PIAS_EMAIL_WEBHOOK_URL` | HTTPS 邮件 Relay 地址 |
| `PIAS_EMAIL_WEBHOOK_KEY_FILE` | Relay 鉴权 Key 文件 |
| `PIAS_INVITATION_ENCRYPTION_KEY_FILE` | 邀请 Outbox 加密 Key 文件 |

变量组合、阻塞码与生产示例见 [operations/release-preflight.md](operations/release-preflight.md)、[operations/deployment-runbook.md](operations/deployment-runbook.md) 和 [operations/tenant-state-migration.md](operations/tenant-state-migration.md)。

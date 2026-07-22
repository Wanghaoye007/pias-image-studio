# PIAS 生产发布预检

## 目的

`npm run release:preflight` 把生产运行时、数据回滚、身份安全、外部服务和构建产物汇总为单一机器可读硬门禁。输出只包含稳定检查 ID、阻塞码和状态，不输出密钥、文件路径或 Provider 响应正文。

## 执行方式

先生成生产构建与当前数据库备份，再加载生产环境变量：

```bash
npm run build
npm run database -- backup \
  --database "$PIAS_DATABASE_FILE" \
  --output /var/backups/pias/pias-release.sqlite
export PIAS_RELEASE_BACKUP_FILE=/var/backups/pias/pias-release.sqlite
export PIAS_RELEASE_ARTIFACT_DIR=/opt/pias/dist
npm run release:preflight
```

硬门禁通过返回 `0`，任一检查失败返回 `1`。整改期间可运行 `npm run release:preflight:report`，它输出相同 JSON 但始终返回 `0`，不得用于发布流水线放行。

## 自动检查

| 检查 ID | 放行条件 | 常见阻塞码 |
| --- | --- | --- |
| `runtime.node` | Node.js 24.x | `NODE_VERSION_UNSUPPORTED` |
| `deployment.mode` | `NODE_ENV=production` | `PRODUCTION_MODE_REQUIRED` |
| `security.cookies` | `PIAS_SECURE_COOKIES=true` | `SECURE_COOKIES_REQUIRED` |
| `security.raw_secrets` | Fal 凭证只从文件读取 | `RAW_SECRET_ENV_FORBIDDEN` |
| `deployment.persistence` | 使用 SQLite 后端 | `SQLITE_BACKEND_REQUIRED` |
| `deployment.public_url` | 非本机公开 HTTPS 地址 | `PUBLIC_HTTPS_URL_REQUIRED` |
| `database.integrity` | 当前数据库为 `0600`、schema v7、完整性通过 | `DATABASE_*` |
| `database.rollback` | 私有备份及清单哈希有效，来源匹配当前数据库 | `RELEASE_BACKUP_*` |
| `identity.config` | 私有身份配置、scrypt 哈希、项目范围、管理员 MFA | `AUTH_CONFIG_*` |
| `fal.key_files` | 推理与 Admin Key 文件非空且为 `0600` | `FAL_KEY_FILES_*` |
| `email.config` | HTTPS Relay、发件人、Webhook Key、32 字节加密 Key 完整 | `EMAIL_*` |
| `storage.assets` | 素材目录存在且为 `0700` | `ASSET_STORAGE_REQUIRED` |
| `build.artifact` | `index.html` 与干净提交生成的 `release.json` 有效 | `BUILD_ARTIFACT_REQUIRED`、`BUILD_METADATA_*` |
| `server.artifact` | 独立生产服务 `dist-server/server.mjs` 存在且非空 | `SERVER_ARTIFACT_REQUIRED` |
| `fal.billing` | Admin Key 对 Billing Events 实际请求成功 | `BILLING_*` |

## 发布判定

预检通过只证明配置与自动检查满足放行条件，不替代业务验收。正式发布还必须满足：

1. `npm run acceptance` 返回 `0`，必选业务证据全部为 `pass`。
2. 使用专用测试邮箱完成邀请实发、收件、链接接受与审计核对；仅有 `email.config=pass` 不代表真实送达。
3. 记录本次备份文件、清单、构建版本和回滚负责人；失败时按 [`database-runbook.md`](database-runbook.md) 执行停写恢复。

独立 Node 服务启动、健康检查、TLS 反代边界和 systemd 模板见 [`deployment-runbook.md`](deployment-runbook.md)。

预检中的 Fal Billing 是只读网络检查，不提交图片任务、不发送邮件、不修改数据库。真实付费模型调用和公开部署仍需负责人按发布窗口授权。

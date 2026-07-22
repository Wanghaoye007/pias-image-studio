# PIAS 中文节点式图片工作台 MVP

基于 `docs/PRD_企业级AI全链路内容生产工作台_图片MVP_V1.2.md` 搭建的可交互前端与领域逻辑 MVP。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。

八类图片节点统一通过 Vite 服务端代理调用 Fal。凭证按以下优先级读取：

1. 环境变量 `FAL_KEY`
2. `FAL_KEY_FILE` 指向的本地文件
3. 本地开发默认文件 `~/Desktop/key.md`（生产服务不会读取该回退路径）

Key 只在服务端进程读取，不会进入浏览器构建产物。

## 已实现

- 全中文企业导航：首页、项目、图片工作台、素材库、审核、用量、企业管理。
- React Flow 无限画布、场景/任务/结果三类节点、自由拖拽、缩放、小地图和版本谱系。
- 生成、融图、多角度、定向光、去除、抠图、扩图、超分八类任务入口。
- 深色画布、场景素材栏、悬浮工具栏、节点旁参数面板和底部任务抽屉。
- 八类工具均已接入 Fal，并统一支持真实队列、进度、取消、失败反馈和结果追踪：
  - 生成、融图：`fal-ai/bria/product-shot`
  - 多角度：`fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles`
  - 定向光：`bria/fibo-edit/edit`
  - 去除：`fal-ai/bria/eraser`
  - 抠图：`fal-ai/bria/background/remove`
  - 扩图：`fal-ai/bria/expand`
  - 超分：`fal-ai/topaz/upscale/image`
- 去除节点支持直接在画布上绘制黑底白色蒙版；扩图节点支持九宫格锚点和原图占比；8K 超分会按 Fal 单次放大限制分阶段执行。
- 所有工具共享额度预估、冻结、结算和任务中心。
- 客户额度使用不可变 Reserve/Charge/Release 台账；部分成功按成功输出结算，失败、取消和过期默认释放客户额度。
- Fal 供应商成本通过独立 Admin Key 拉取 Billing Events，按上游 request ID 私有对账，不进入普通用户 API 或用量界面。
- 项目、画布、任务、结果、审核、用量和审计状态通过 revision API 自动保存；企业身份模式默认使用 SQLite 事务后端，支持跨进程并发冲突保护、页面刷新与服务重启恢复。
- 企业项目支持真实创建、持久化列表、安全切换和刷新恢复；首次进入新项目只建立空白工作台，不会注入演示数据。
- 企业所有者/管理员可按真实项目签发七天有效的一次性成员邀请；支持安全链接接受、管理员 MFA、撤销、过期、重新签发、重复消费保护和成员跨重启登录。配置邮件后进入 SQLite Outbox 并自动重试，发送成功后才显示“已发送”；未配置时由管理员复制链接安全传递，不冒充邮件已发送。
- Fal 作业、两阶段恢复载荷与 Worker 租约进入同一 SQLite 数据库；后台 Worker 自动推进未完成任务，同主机多进程通过续租、过期接管和互斥更新避免重复提交。
- 素材库支持 PNG、JPG、WebP 上传；图片以 SHA-256 内容哈希去重并独立保存，工作台状态只记录图片 URL，避免 Base64 导致状态包膨胀。
- 结果继续派生、提交审核、批准、单图下载，以及用量和审计视图。
- 桌面和平板画布编辑、移动端预览/任务/审核模式。
- PIAS 化妆品演示素材，不引用竞品商标或界面截图。
- 核心领域单元测试、严格模式任务幂等回归测试和四档浏览器响应式验收。

## 安全整改进展

身份与授权核心已经实现密码策略、scrypt 哈希、连续失败渐进锁定、TOTP MFA 防重放、30 分钟闲置/12 小时绝对会话过期、会话撤销、成员停用失效、角色权限矩阵及 Tenant/Project 范围判断。`/api/auth/login`、`/api/auth/mfa`、`/api/auth/session` 和 `/api/auth/logout` 已使用 Strict Cookie、HttpOnly Session 与双重 CSRF；中文登录/MFA/退出界面、会话恢复门禁和全部业务 API 的会话/CSRF 守卫已经接入。生产入口额外校验写请求 Origin 与 JSON 媒体类型，限制登录总量、请求/头部时长和连接预算，并统一发送 CSP、HSTS、跨源隔离头及 API `no-store`。素材上传、Fal 提交/取消和 StudioState 变更均执行服务端命令权限；审核人、新增审计 actor 与 Fal 创建人来自可信会话，既有审计历史不可删改。配置文件强制权限为 `0600` 且禁止明文密码。

## 当前边界

当前版本尚未达到 PRD 第 29 节定义的 Production 完成态。业务状态与 Fal 队列使用 SQLite 事务存储，素材文件、Fal 作业和恢复载荷按可信 Tenant/Project 分区；同主机多进程 Worker 可续租和过期接管运行中任务，身份会话、命令级 RBAC、安全链接入组、成员邀请邮件 Outbox、重新签发、成员禁用/恢复、角色与项目范围变更、首次/后续登录审计、备份恢复、旧数据迁移以及撤回/驳回/修改后重试与站内通知已经闭环。SQLite 不用于多主机共享，多主机横向扩展需换用具备分布式一致性的数据库。定向光当前通过通用编辑模型和严格保真提示实现，属于实验能力，建议对品牌字样和材质进行人工复核。正式环境仍必须提供具备 Billing Events 权限的 Fal Admin Key 并通过预检，同时配置并实发验证邮件 Relay；对象存储和签名导出基础设施仍未闭环。

单机数据目录可通过环境变量配置：

```bash
PIAS_STUDIO_STATE_FILE=/var/lib/pias/studio-state.json
PIAS_STUDIO_STATE_DIR=/var/lib/pias/studio-state-scopes
PIAS_PERSISTENCE_BACKEND=sqlite
PIAS_DATABASE_FILE=/var/lib/pias/pias.sqlite
PIAS_ASSET_DIR=/var/lib/pias/asset-scopes
PIAS_FAL_JOB_STATE_FILE=/var/lib/pias/fal-queue-state.json
PIAS_FAL_JOB_STATE_DIR=/var/lib/pias/fal-queue-scopes
PIAS_FAL_WORKER_INTERVAL_MS=2500
PIAS_FAL_LEASE_TTL_MS=15000
PIAS_FAL_BILLING_RETRY_MS=300000
FAL_KEY_FILE=/etc/pias/fal-inference.key
FAL_ADMIN_KEY_FILE=/etc/pias/fal-admin.key
PIAS_AUTH_CONFIG_FILE=/etc/pias/auth.json
PIAS_SECURE_COOKIES=true
PIAS_PUBLIC_BASE_URL=https://studio.example.com
PIAS_EMAIL_FROM='PIAS <no-reply@example.com>'
PIAS_EMAIL_WEBHOOK_URL=https://mail-relay.example.com/v1/send
PIAS_EMAIL_WEBHOOK_KEY_FILE=/etc/pias/mail-webhook.key
PIAS_INVITATION_ENCRYPTION_KEY_FILE=/etc/pias/invitation-encryption.key
PIAS_RELEASE_BACKUP_FILE=/var/backups/pias/pias-release.sqlite
PIAS_RELEASE_ARTIFACT_DIR=/opt/pias/dist
PIAS_RELEASE_SERVER_FILE=/opt/pias/dist-server/server.mjs
```

启用身份配置后，StudioState、Fal 作业、租约、邀请邮件 Outbox 和必要的两阶段恢复载荷默认写入 `PIAS_DATABASE_FILE` 指定的 SQLite 数据库，并按服务端会话 Tenant 与已授权 Project 分区；`PIAS_PERSISTENCE_BACKEND=file` 只用于迁移回滚。恢复载荷在最终阶段提交或任务取消后立即删除，数据库目录和备份仍须按敏感业务数据保护。旧单文件/范围文件升级先执行 [`docs/operations/tenant-state-migration.md`](docs/operations/tenant-state-migration.md)，再按 [`docs/operations/database-runbook.md`](docs/operations/database-runbook.md) dry-run 导入 SQLite、备份和验证回滚。素材目录中的文件名来自内容哈希，可安全去重且不会接受路径穿越形式的请求。推理 Key、账单 Admin Key、邮件 Webhook Key 与邀请加密 Key 必须分文件、最小权限配置，密钥文件权限为 `0600`；生产发布禁止通过 `FAL_KEY` 或 `FAL_ADMIN_KEY` 注入明文密钥。部署前按 [`docs/operations/release-preflight.md`](docs/operations/release-preflight.md) 执行统一门禁，并按 [`docs/operations/organization-management.md`](docs/operations/organization-management.md) 完成测试邀请实发。身份配置只允许 scrypt 密码哈希，业务用户必须至少分配一个项目，配置文件权限必须为 `0600`。HTTPS 环境必须保持 `PIAS_SECURE_COOKIES=true`；仅本机 HTTP 开发可显式设为 `false`。

## 验证

```bash
npm run repo:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm audit --omit=dev --audit-level=high
npm run release:preflight:report
npm run acceptance:report
```

`.github/workflows/release-quality.yml` 会在 PR、`main` 与 `codex/**` 分支推送时使用 Node.js 24 重复执行仓库卫生、静态检查、全量测试、双产物构建和生产依赖审计，并将 `dist/`、`dist-server/` 作为七天有效的候选产物归档。工作流只授予只读仓库权限，官方 Actions 固定到完整提交 SHA，Checkout 不保留 Git 凭证。

`npm run release:preflight` 是生产环境硬门禁，校验 Node、HTTPS、安全 Cookie、SQLite/回滚备份、身份与密钥权限、邮件配置、发布产物和 Fal Billing 权限，任一失败即返回非零；`release:preflight:report` 始终返回零，仅用于查看机器可读阻塞码。`npm run acceptance` 是业务验收硬门禁：只在自动化检查通过且 `acceptance/manifest.json` 中所有必选业务证据均为 `pass` 时返回成功。两个硬门禁都通过才允许发布。

生产构建同时生成前端 `dist/` 与独立 Node 服务 `dist-server/server.mjs`；正式服务使用 `npm start`，不依赖 Vite Preview。单机生产目录、环境模板、systemd 启停、健康检查与回滚步骤见 [`docs/operations/deployment-runbook.md`](docs/operations/deployment-runbook.md)。

验收制度、PIAS 实查报告和可复用 Prompt 位于 [`docs/acceptance`](docs/acceptance)。当前 MVP 的生产验收结论以该目录中的项目报告为准。

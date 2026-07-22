# PIAS 企业项目与成员运维说明

## 当前能力

- `POST /api/organization/projects` 创建项目、创建者成员关系和不可变审计事件；`GET` 按 Tenant 与成员范围列出项目。
- 项目切换同时更新 `x-pias-project-id` 和 SameSite Cookie，刷新时只恢复当前会话仍有权访问的项目。
- 新项目无 StudioState 快照时创建空白工作台，演示数据仅用于未启用企业身份的本机模式。
- `POST /api/organization/invitations` 校验成员角色和真实企业项目范围，生成 256 位一次性令牌，数据库只保存 SHA-256 摘要；重复待处理邀请返回 `409`。
- `POST /api/organization/invitations/preview` 与 `/accept` 是仅凭邀请令牌访问的公开入口；接受交易会原子创建成员、项目关系、邀请状态和审计事件，令牌重复消费返回 `409`。
- `POST /api/organization/invitations/:id/revoke` 仅允许 `owner` / `admin`，重复撤销幂等；七天到期邀请会在预览、接受或管理员列表读取时持久化为 `expired`。
- `POST /api/organization/invitations/:id/resend` 原子撤销旧邀请并签发新令牌；旧链接立即失效，已接受邀请返回 `409`，不会产生两个有效待处理邀请。
- 邀请管理员时，接受页会生成 TOTP Secret，并要求当前六位验证码通过后才允许创建账户。
- `GET /api/organization/members` 按可信 Tenant 返回已激活成员；`PATCH /api/organization/members/:id` 原子变更角色、启用状态和项目范围，拒绝跨 Tenant、空项目范围及未启用 MFA 的管理员升级。
- 成员停用后，身份服务下一次校验会立即拒绝并销毁旧会话；重新启用不恢复旧会话，成员必须重新登录。角色和项目范围在每次请求时从 SQLite 重新解析。
- 每次成功登录都写入不可变 `auth.login_succeeded` 审计；成员表仅首次写入 `first_login_at`，后续登录明确记录 `firstLogin=false`。

## 存储与备份

项目、成员关系、邀请、邮件 Outbox 和组织审计使用 `PIAS_DATABASE_FILE` 中的 SQLite schema version 7，由同一数据库备份/恢复命令管理。v4 到 v6 依次增量添加令牌生命周期、持久成员和 `first_login_at`；v7 新增 `organization_email_outbox`，原邀请和成员行均不删除。运行时与命令行迁移工具会直接升级到 v7。旧 `token_hash=NULL` 的待处理邀请不能接受，管理员应撤销并重新签发。恢复前必须停止全部写入，dry-run 校验通过后再 `--apply`；回滚使用恢复命令保留的 `.rollback-*` 主文件和 sidecar。旧版二进制回滚时必须同时恢复升级前数据库，不允许让 v6 代码继续写入 v7 数据库。详见 `database-runbook.md`。

## 权限边界

- 项目创建：`owner` / `admin` / `creator`。
- 成员邀请、邀请列表和成员生命周期变更：仅 `owner` / `admin`，且特权角色必须完成 MFA。
- 服务端从会话获取 Tenant、用户和角色；不信任客户端传入的主体信息。

## 邀请投递与上线边界

邮件服务未配置时，降级投递方式为管理员复制一次性链接后通过企业受控渠道发送，`deliveryStatus=pending_configuration` 明确表示系统未发邮件。链接使用 URL fragment，且页面设置 `Referrer-Policy: no-referrer`，避免令牌进入服务端访问日志和外部 Referer。

配置邮件后，邀请令牌以 AES-256-GCM 密文进入 `organization_email_outbox`，摘要仍保存在邀请表用于一次性校验。密文绑定 Tenant、邀请 ID 与收件邮箱作为附加认证数据，数据库、审计和错误字段均不保存明文令牌或 Provider 响应正文。Worker 通过 `BEGIN IMMEDIATE` 领取租约，使用固定 `messageId` 作为 `Idempotency-Key` 调用 HTTPS Webhook；2xx 后才写入 `sent`，失败从 60 秒开始指数退避，最长一小时。发送成功和失败均写入 `system` 审计，失败只记录稳定错误码。撤销、过期或重新签发会同步取消旧 Outbox 行，已在途但无法阻止的邮件中的旧链接仍因邀请状态守卫而不可使用。

## 邮件 Relay 配置

必须一次性提供全部配置，部分配置会阻止服务启动：

```bash
PIAS_PUBLIC_BASE_URL=https://studio.example.com
PIAS_EMAIL_FROM='PIAS <no-reply@example.com>'
PIAS_EMAIL_WEBHOOK_URL=https://mail-relay.example.com/v1/send
PIAS_EMAIL_WEBHOOK_KEY_FILE=/etc/pias/mail-webhook.key
PIAS_INVITATION_ENCRYPTION_KEY_FILE=/etc/pias/invitation-encryption.key
```

两个密钥文件必须是普通文件且权限为 `0600`。邀请加密 Key 必须为 32 字节，可使用 64 位十六进制或 Base64：

```bash
umask 077
openssl rand -base64 32 > /etc/pias/invitation-encryption.key
chmod 600 /etc/pias/invitation-encryption.key /etc/pias/mail-webhook.key
```

Relay 接收 `POST` JSON，字段为 `messageId`、`template`、`from`、`to`、`subject` 和 `variables`；`variables` 包含 `displayName`、`role`、`acceptUrl`、`expiresAt`。请求头包含 `Authorization: Bearer <key>` 和 `Idempotency-Key: <messageId>`。Relay 必须按幂等键去重，并仅在邮件服务已接受投递时返回 2xx。

## 上线与回滚

1. 停止写入并按数据库手册创建升级前备份，确认 `integrity_check=ok`。
2. 配置五个邮件环境变量和两个 `0600` 密钥文件，再启动新版本；启动会事务升级到 schema v7。
3. 创建专用测试成员邀请，确认管理端依次显示“等待发送”“已发送”，Relay 只收到一次同一 `Idempotency-Key`，审计包含 `member.invitation_delivery_succeeded`。
4. 点击重新签发，确认旧链接返回 `409`、新链接可预览且旧 Outbox 行为 `canceled`。
5. 若测试失败，停止服务，恢复升级前数据库备份和旧二进制；不要只回滚二进制。保留失败数据库副本用于离线排查，但不得把其中密文或密钥上传到工单。

加密 Key 不支持在线直接替换。轮换前必须暂停新邀请，等待 `queued/sending/failed` 全部清空并完成数据库备份，再在维护窗口替换；否则旧待发密文将无法解密。Webhook Key 可由 Relay 支持双 Key 窗口后分阶段轮换。

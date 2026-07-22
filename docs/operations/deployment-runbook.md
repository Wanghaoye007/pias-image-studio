# Content Studio 单机生产部署手册

## 部署边界

当前发布拓扑是单机 Node.js 24 + SQLite。独立 HTTP 服务只允许监听 `127.0.0.1` 或 `::1`，由同机 TLS 反向代理对外提供 `CONTENT_STUDIO_PUBLIC_BASE_URL`；不得把应用端口直接暴露到公网。SQLite、素材和备份必须位于本机 POSIX 文件系统，多主机部署不在本手册范围内。

## 目录与权限

```text
/opt/content-studio/releases/<revision>/  只读代码与构建产物
/opt/content-studio/current               指向当前版本的软链接
/etc/content-studio/                      0600 身份和密钥文件
/var/lib/content-studio/                  0700 数据库与素材目录
/var/backups/content-studio/              0700 独立回滚备份目录
```

服务用户不得拥有 `/etc/content-studio` 以外的系统密钥访问权限。数据库、身份配置和四个密钥文件必须为 `0600`，数据、素材和备份目录必须为 `0700`。以 [`deploy/content-studio.env.example`](../../deploy/content-studio.env.example) 为基础创建 `/etc/content-studio/content-studio.env`，禁止写入 Fal 明文 Key。

## 构建与发布

1. 在干净、已锁定提交的发布目录安装依赖并构建：

```bash
npm ci
npm run repo:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm audit --omit=dev --audit-level=high
```

以上命令必须与 PR 的 `Release quality / Lint, test, and build` 检查同时通过。构建会生成 `dist/release.json`，包含版本、Git revision、构建时间和工作树状态。脏工作树仍可构建用于测试，但生产预检会以 `BUILD_METADATA_DIRTY` 拒绝发布。

构建同时生成 `dist-server/server.mjs`。该独立 Node HTTP 服务复用与开发环境相同的认证、组织、素材、StudioState 和 Fal 中间件，提供静态 SPA fallback、JSON API 边界、安全响应头、live/ready 和 SIGTERM 优雅停机，不依赖 Vite Preview。完成测试和验收后可执行 `npm prune --omit=dev`，运行时仅保留生产依赖。

### 入口安全约束

- `CONTENT_STUDIO_PUBLIC_BASE_URL` 必须是生产 HTTPS 地址。带 `Origin` 的写请求必须与其 Origin 完全一致；`Sec-Fetch-Site: cross-site` 一律拒绝。反向代理必须原样传递 `Origin` 和 `Sec-Fetch-Site`，不得为应用 API 添加 CORS 放行头。
- 登录、MFA、组织管理、StudioState 写入和 Fal 提交只接受 `application/json`；素材上传继续使用受控的 PNG/JPEG/WebP 类型。反向代理不得把 `text/plain` 改写为 JSON。
- 单实例登录入口最多接受 20 次密码校验/分钟，超过后返回 `429` 与 `Retry-After`；按邮箱的渐进锁定仍同时生效。监控应对持续 `AUTH_RATE_LIMITED` 告警，但不得记录密码或请求正文。
- Node 服务限制完整请求 60 秒、请求头 15 秒、单次头部 16 KiB/100 个字段、Keep-Alive 空闲 5 秒及单连接 1000 次请求。反向代理的超时和头部上限不得宽于应用层。
- 所有响应发送 CSP、HSTS、`nosniff`、禁止嵌入、Referrer/Permissions Policy 与跨源隔离头；所有 `/api/` 默认 `Cache-Control: no-store`，仅内容哈希素材由路由覆盖为私有不可变缓存。

2. 按 [`database-runbook.md`](database-runbook.md) 创建本次数据库备份，并让 `CONTENT_STUDIO_RELEASE_BACKUP_FILE` 指向该备份。
3. 加载 `/etc/content-studio/content-studio.env` 后执行双门禁：

```bash
npm run release:preflight
npm run acceptance
```

4. 复制 [`deploy/content-studio.service.example`](../../deploy/content-studio.service.example) 为 `/etc/systemd/system/content-studio.service`，确认 Node/npm 绝对路径与主机一致，再启动。`ExecStartPre` 会执行生产预检，`ExecStart` 直接运行 `dist-server/server.mjs`：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now content-studio
```

5. 将 [`deploy/nginx-content-studio.conf.example`](../../deploy/nginx-content-studio.conf.example) 复制到 Nginx 站点配置，替换域名和证书路径。该样例只回源 `127.0.0.1:4173`，按接口限制请求体，代理层拦截的超限请求统一返回 `413 REQUEST_BODY_TOO_LARGE` JSON，并原样传递应用同源判定所需的 `Origin` 与 `Sec-Fetch-Site`。先执行语法检查，再原子加载配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

确认公网 HTTP 自动跳转 HTTPS，HTTPS 响应中没有重复或放宽的 CORS 头，并从外部网络验证 `/api/health/live` 与登录页。若实际应用端口不是 `4173`，必须同时修改 `CONTENT_STUDIO_PORT` 和所有 `proxy_pass`，且回源地址仍须为 loopback。

## 日志与故障定位

systemd 样例将标准输出和标准错误写入 journald，并固定 `SyslogIdentifier=content-studio`。应用日志为单行 JSON：每个 HTTP 响应带服务端生成的 `X-Request-ID`，对应完成日志只包含 `requestId`、固定路由模板、方法、状态和耗时；启动日志只包含监听地址与发布版本。内部异常及 Fal Worker/持久化异常仅记录稳定 `errorCode`，不记录 Error message、stack、Query、Cookie、Prompt、图片/Data URL、用户输入或客户端提供的 Request ID。

```bash
journalctl -u content-studio -o cat --since '30 minutes ago'
journalctl -u content-studio -o cat --since today | jq -Rc 'fromjson? | select(.requestId == "<request-id>")'
journalctl -u content-studio -o cat --since today | jq -Rc 'fromjson? | select(.status >= 500 or (.event | endswith("_failed")))'
```

生产主机必须启用持久 journal，并由运维统一设置容量上限和 30 天保留期；Content Studio 业务审计记录仍按 365 天策略保留，不得用系统访问日志替代。监控至少告警：5xx 比例持续升高、连续 `429`、异常 `403` 峰值、`content_studio_fal_recovery_failed`、`content_studio_fal_queue_hydration_failed`、`content_studio_fal_queue_persistence_failed` 以及 ready 连续失败。日志采集器不得补采请求正文或 Cookie。

## 健康检查

负载均衡只使用就绪端点接流量，进程监控使用存活端点：

```bash
curl --fail --silent http://127.0.0.1:4173/api/health/live
curl --fail --silent http://127.0.0.1:4173/api/health/ready
```

- `/api/health/live`：进程能响应即返回 `200`，包含安全的版本和 revision。
- `/api/health/ready`：身份已配置、数据库 schema v7 可读且完整、构建首页存在、素材目录可读写时返回 `200`；否则返回无路径、无底层错误的 `503 CONTENT_STUDIO_NOT_READY`。
- 两个端点均为公开只读端点，禁止缓存；`POST` 等写方法返回 `405`。

上线后还需使用专用测试邮箱完成一次邀请、收件、链接接受和审计核对，并按 [`fal-billing-reconciliation.md`](fal-billing-reconciliation.md) 核对 Billing Events。

## 回滚

1. 从反向代理摘除实例并停止服务，不允许旧版和新版并行写 SQLite。
2. 将 `/opt/content-studio/current` 切回上一个只读发布目录。
3. 若 schema 未变化，可保留当前数据库；若 schema 或数据写入不兼容，按 [`database-runbook.md`](database-runbook.md) 使用本次发布前备份 dry-run 后恢复。
4. 重新运行上一个版本的 `release:preflight`，启动单实例，确认 live、ready、登录、项目读取和一项非付费写入后再恢复流量。
5. 保留失败版本、数据库和日志作为调查证据，不在回滚窗口内删除。

每次正式发布前至少在隔离目录演练一次数据库恢复：运行 backup、restore dry-run、restore `--apply`，确认命令生成 `.rollback-*` 且恢复后 `integrity: ok`。演练不得指向生产数据库；真实生产恢复仍必须先停止全部 Content Studio 实例。

若 `release:preflight`、`acceptance`、ready、真实邮件或 Billing 任一项失败，发布立即中止并保持旧版本服务。

# PIAS 单机生产部署手册

## 部署边界

当前发布拓扑是单机 Node.js 24 + SQLite。独立 HTTP 服务只允许监听 `127.0.0.1` 或 `::1`，由同机 TLS 反向代理对外提供 `PIAS_PUBLIC_BASE_URL`；不得把应用端口直接暴露到公网。SQLite、素材和备份必须位于本机 POSIX 文件系统，多主机部署不在本手册范围内。

## 目录与权限

```text
/opt/pias/releases/<revision>/  只读代码与构建产物
/opt/pias/current               指向当前版本的软链接
/etc/pias/                      0600 身份和密钥文件
/var/lib/pias/                  0700 数据库与素材目录
/var/backups/pias/              0700 独立回滚备份目录
```

服务用户不得拥有 `/etc/pias` 以外的系统密钥访问权限。数据库、身份配置和四个密钥文件必须为 `0600`，数据、素材和备份目录必须为 `0700`。以 [`deploy/pias.env.example`](../../deploy/pias.env.example) 为基础创建 `/etc/pias/pias.env`，禁止写入 Fal 明文 Key。

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

2. 按 [`database-runbook.md`](database-runbook.md) 创建本次数据库备份，并让 `PIAS_RELEASE_BACKUP_FILE` 指向该备份。
3. 加载 `/etc/pias/pias.env` 后执行双门禁：

```bash
npm run release:preflight
npm run acceptance
```

4. 复制 [`deploy/pias.service.example`](../../deploy/pias.service.example) 为 `/etc/systemd/system/pias.service`，确认 Node/npm 绝对路径与主机一致，再启动。`ExecStartPre` 会执行生产预检，`ExecStart` 直接运行 `dist-server/server.mjs`：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pias
```

## 健康检查

负载均衡只使用就绪端点接流量，进程监控使用存活端点：

```bash
curl --fail --silent http://127.0.0.1:4173/api/health/live
curl --fail --silent http://127.0.0.1:4173/api/health/ready
```

- `/api/health/live`：进程能响应即返回 `200`，包含安全的版本和 revision。
- `/api/health/ready`：身份已配置、数据库 schema v7 可读且完整、构建首页存在、素材目录可读写时返回 `200`；否则返回无路径、无底层错误的 `503 PIAS_NOT_READY`。
- 两个端点均为公开只读端点，禁止缓存；`POST` 等写方法返回 `405`。

上线后还需使用专用测试邮箱完成一次邀请、收件、链接接受和审计核对，并按 [`fal-billing-reconciliation.md`](fal-billing-reconciliation.md) 核对 Billing Events。

## 回滚

1. 从反向代理摘除实例并停止服务，不允许旧版和新版并行写 SQLite。
2. 将 `/opt/pias/current` 切回上一个只读发布目录。
3. 若 schema 未变化，可保留当前数据库；若 schema 或数据写入不兼容，按 [`database-runbook.md`](database-runbook.md) 使用本次发布前备份 dry-run 后恢复。
4. 重新运行上一个版本的 `release:preflight`，启动单实例，确认 live、ready、登录、项目读取和一项非付费写入后再恢复流量。
5. 保留失败版本、数据库和日志作为调查证据，不在回滚窗口内删除。

若 `release:preflight`、`acceptance`、ready、真实邮件或 Billing 任一项失败，发布立即中止并保持旧版本服务。

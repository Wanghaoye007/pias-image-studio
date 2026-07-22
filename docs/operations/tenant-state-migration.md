# StudioState 租户分区迁移与回滚

启用 `CONTENT_STUDIO_AUTH_CONFIG_FILE` 后，工作台状态从旧单文件切换为按可信 Tenant/Project 范围哈希的独立目录。迁移命令默认只输出计划，不写入文件。

完成范围拆分后，生产环境还必须继续执行 [`database-runbook.md`](database-runbook.md) 的 SQLite dry-run 导入、备份和恢复演练；本文件中的范围 JSON 会作为迁移回滚源保留。

## 迁移前

1. 停止 Content Studio 写流量并备份 `CONTENT_STUDIO_STATE_FILE`、素材目录和 Fal 队列状态。
2. 从身份配置确认目标 `tenantId` 与 `projectId`；业务用户的 `projectIds` 必须包含该项目。
3. 先执行 dry-run，核对输出中的源和目标路径。

```bash
npm run migrate:studio-state -- \
  --source /var/lib/content-studio/studio-state.json \
  --target-root /var/lib/content-studio/studio-state-scopes \
  --tenant tenant-a \
  --project project-main
```

确认后增加 `--apply`。命令使用排他复制，目标存在时立即失败，不会覆盖；旧源文件始终保留。

```bash
npm run migrate:studio-state -- \
  --source /var/lib/content-studio/studio-state.json \
  --target-root /var/lib/content-studio/studio-state-scopes \
  --tenant tenant-a \
  --project project-main \
  --apply
```

使用同一 Tenant/Project 把素材与 Fal 请求映射迁移到范围目录。该命令也默认 dry-run，并在任一目标已存在时拒绝执行。

```bash
npm run migrate:project-storage -- \
  --asset-source /var/lib/content-studio/assets \
  --asset-target-root /var/lib/content-studio/asset-scopes \
  --fal-source /var/lib/content-studio/fal-queue-state.json \
  --fal-target-root /var/lib/content-studio/fal-queue-scopes \
  --tenant tenant-a \
  --project project-main
```

核对素材数量和两个目标路径后增加 `--apply`。失败时只清理本轮创建的目标，两个源位置始终保留。

## 上线配置

```bash
CONTENT_STUDIO_STATE_FILE=/var/lib/content-studio/studio-state.json
CONTENT_STUDIO_STATE_DIR=/var/lib/content-studio/studio-state-scopes
CONTENT_STUDIO_ASSET_DIR=/var/lib/content-studio/asset-scopes
CONTENT_STUDIO_FAL_JOB_STATE_FILE=/var/lib/content-studio/fal-queue-state.json
CONTENT_STUDIO_FAL_JOB_STATE_DIR=/var/lib/content-studio/fal-queue-scopes
CONTENT_STUDIO_AUTH_CONFIG_FILE=/etc/content-studio/auth.json
CONTENT_STUDIO_SECURE_COOKIES=true
```

启动后以目标租户账号登录，核对项目名、revision、素材、任务、结果、审核和用量；确认写入后刷新并再次核对 revision 递增。

## 回滚

1. 停止写流量，保留分区目录并记录最新 revision。
2. 部署迁移前构建，移除 `CONTENT_STUDIO_AUTH_CONFIG_FILE`，继续使用未被迁移命令修改的 `CONTENT_STUDIO_STATE_FILE`。
3. 若分区环境已经产生新写入，不得直接覆盖旧文件；先导出并人工合并差异，再决定恢复点。
4. 回滚验证完成前禁止同时启动旧单文件实例和新分区实例写入同一业务项目。

该回滚不删除任何状态文件。回滚旧构建时同时恢复旧素材目录与 `CONTENT_STUDIO_FAL_JOB_STATE_FILE`；已分区目录保留用于核对新旧差异。

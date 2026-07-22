# PIAS SQLite 数据库运维手册

## 适用范围

启用企业身份配置后，StudioState、Fal 作业、Worker 租约和两阶段恢复载荷默认使用 SQLite。本文覆盖首次启用、旧范围快照迁移、在线备份、停机恢复和回滚。素材原文件仍位于 `PIAS_ASSET_DIR`，必须与数据库使用同一备份批次。

## 运行基线

- 固定使用 Node.js 24.x；`package.json` 已限制运行时主版本。
- 数据库必须位于本机持久 POSIX 文件系统，不得放在 NFS、SMB 或对象存储挂载目录。
- 运行用户独占数据库目录，目录权限 `0700`、数据库和备份权限 `0600`。
- 同一主机可运行多个 PIAS 进程；SQLite 使用 WAL、`synchronous=FULL`、5 秒 busy timeout 和 `BEGIN IMMEDIATE` 保证 revision 更新串行化。
- Fal Worker 每轮扫描未完成作业，单作业通过数据库租约互斥；慢上游调用期间自动续租，进程终止后由租约过期接管。
- SQLite 只支持同主机多进程，不支持多主机共享；多主机横向扩展必须迁移到具备分布式一致性的数据库与队列。

生产环境变量：

```bash
PIAS_PERSISTENCE_BACKEND=sqlite
PIAS_DATABASE_FILE=/var/lib/pias/pias.sqlite
PIAS_STUDIO_STATE_DIR=/var/lib/pias/studio-state-scopes
PIAS_ASSET_DIR=/var/lib/pias/asset-scopes
PIAS_FAL_JOB_STATE_DIR=/var/lib/pias/fal-queue-scopes
PIAS_FAL_WORKER_INTERVAL_MS=2500
PIAS_FAL_LEASE_TTL_MS=15000
```

## 旧数据迁移

1. 停止 PIAS 写入，先按 `tenant-state-migration.md` 将旧单文件拆分到范围目录。
2. 执行 dry-run；该步骤不创建数据库：

```bash
npm run migrate:sqlite -- \
  --studio-root /var/lib/pias/studio-state-scopes \
  --fal-root /var/lib/pias/fal-queue-scopes \
  --database /var/lib/pias/pias.sqlite
```

3. 核对 `studioStates` 与 `falJobs` 数量，再应用迁移：

```bash
npm run migrate:sqlite -- \
  --studio-root /var/lib/pias/studio-state-scopes \
  --fal-root /var/lib/pias/fal-queue-scopes \
  --database /var/lib/pias/pias.sqlite \
  --apply
```

迁移在单个 `BEGIN IMMEDIATE` 事务中执行；任何目标 StudioState 或 Fal 作业已存在时整体拒绝，不覆盖数据库记录，也不删除旧 JSON。验证应用登录、项目恢复、Fal 队列接管和审计记录后再开放写入。

定向光等多阶段任务会暂存完成下一阶段所需的原图载荷。载荷按 Tenant/Project 范围隔离，在最终阶段提交或任务取消后删除；因此数据库及备份必须按原始素材同等级加密、授权和保留期限管理。

迁移回滚：停止服务，设置 `PIAS_PERSISTENCE_BACKEND=file`，继续使用原 `PIAS_STUDIO_STATE_DIR`。禁止 SQLite 与旧文件后端同时写入同一项目。

## 在线备份

数据库可在服务运行时备份。命令先执行 WAL checkpoint，再使用 SQLite Online Backup API，随后对副本执行 `PRAGMA integrity_check` 并生成 SHA-256 清单：

```bash
npm run database -- backup \
  --database /var/lib/pias/pias.sqlite \
  --output /var/backups/pias/pias-$(date +%Y%m%d-%H%M%S).sqlite
```

备份成功输出 `integrity: ok`、`sha256` 和 `.manifest.json` 路径。备份任务失败时不得删除上一次成功副本。建议每日全量备份、保留 30 天，并将同批次数据库、素材目录和身份配置的加密副本写入独立介质。

发布前将本次备份路径写入 `PIAS_RELEASE_BACKUP_FILE`。统一预检会校验备份与清单均为 `0600`、SHA-256 和完整性有效，并确认清单 `source` 对应当前 `PIAS_DATABASE_FILE`，防止拿无关健康数据库冒充回滚点：

```bash
export PIAS_RELEASE_BACKUP_FILE=/var/backups/pias/pias-20260722-050000.sqlite
npm run release:preflight
```

预检不会修改数据库；完整生产配置、阻塞码与处置方式见 [`release-preflight.md`](release-preflight.md)。

## 恢复与验证

恢复必须停止全部 PIAS 进程，先 dry-run 校验备份完整性与清单哈希：

```bash
npm run database -- restore \
  --database /var/lib/pias/pias.sqlite \
  --backup /var/backups/pias/pias-20260722-050000.sqlite
```

dry-run 返回 `integrity: ok` 后执行：

```bash
npm run database -- restore \
  --database /var/lib/pias/pias.sqlite \
  --backup /var/backups/pias/pias-20260722-050000.sqlite \
  --apply
```

应用恢复会把旧数据库及 `-wal`、`-shm` sidecar 移到同时间戳的 `.rollback-*` 路径，再原子替换并二次执行完整性检查。随后启动一个实例，验证登录、项目加载、一次写入和 `npm run acceptance:report`，再恢复流量。

## 恢复回滚

若恢复后的业务验证失败：

1. 停止全部 PIAS 进程。
2. 保留失败数据库作为调查证据，将当前数据库及 sidecar 移出运行路径。
3. 把恢复命令输出的 `.rollback-*` 主文件改回 `PIAS_DATABASE_FILE`，对应 `-wal`、`-shm` sidecar 同步恢复。
4. 启动单实例并再次执行完整性、登录、读写与验收检查。

未完成验证前不得删除 rollback 文件或旧范围 JSON。

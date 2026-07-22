# PIAS 发布整改记录

本记录按自动整改轮次追加，只记录可复现的完成事实。正式发布结论以 `acceptance/manifest.json` 和 `npm run acceptance` 为准。

## 2026-07-22 03:20 CST - 认证 HTTP 边界闭环

### 本轮完成

- 为身份服务会话增加独立 CSRF 密钥及常量时间校验。
- 实现登录、MFA、会话查询、登出四个认证 API；挑战令牌与会话令牌仅通过 HttpOnly Cookie 下发，不进入 JSON 响应。
- 实现可复用业务 API 鉴权守卫：读取可信会话，写请求同时验证 CSRF Header 与 Cookie，并向服务端请求附加可信用户、租户、角色和项目范围。
- 实现仅接受 scrypt 密码哈希的身份配置加载器；拒绝明文密码、不安全文件权限和非法角色配置。
- 将认证插件接入 Vite 服务。未配置身份文件时认证端点明确返回 `503 AUTH_NOT_CONFIGURED`，不静默创建默认管理员。

### 修改文件

- `src/auth/identityService.ts`
- `src/auth/authApiPlugin.ts`
- `src/auth/authConfig.ts`
- `vite.config.ts`
- `tests/identityService.test.ts`
- `tests/authApiPlugin.test.ts`
- `tests/authConfig.test.ts`
- `acceptance/manifest.json`
- `README.md`

### 验证结果

- 认证定向测试：4 个文件、18 项测试通过。
- 全量回归：22 个文件、260 项测试通过。
- TypeScript 与 Vite 生产构建通过；构建产物成功生成。
- `npm audit --omit=dev --audit-level=high`：0 个漏洞。
- `git diff --check`：通过。
- 真实开发服务：`GET /api/auth/session` 在未配置身份服务时返回 HTTP 503 与稳定错误码；服务保持监听。

### 风险控制

- 未读取、打印或提交真实密钥。
- 未配置身份时不创建危险默认账号。
- 暂未全局启用业务 API 守卫，以免在登录界面和客户端 CSRF 接入前造成所有现有流程不可用；验收项继续保持 `partial`。

### 剩余问题

- P0：登录/MFA/退出界面和前端会话恢复尚未接入。
- P0：素材、状态、Fal 任务接口尚未统一启用鉴权守卫并绑定可信租户/项目范围。
- P1：持久数据库、任务队列、用量台账和多实例恢复仍未完成。

### 下一轮优先事项

先以失败测试定义匿名访问、跨租户访问和 CSRF 写请求的服务端拒绝契约，再接入前端登录会话与三个业务 API 的统一守卫；只有端到端流程通过后才将认证和隔离证据升级为 `pass`。

## 2026-07-22 03:42 CST - 登录门禁与业务 API 守卫

### 本轮完成

- 实现浏览器认证客户端，统一解析认证未配置、匿名、已登录和 MFA 两阶段状态。
- 实现中文登录、六位验证码、会话恢复和退出界面；业务工作台只在身份边界确认后挂载。
- 状态保存、素材上传、Fal 提交和取消自动读取 CSRF Cookie 并注入写请求头。
- 认证开启时，Vite 开发与预览服务均在认证路由之后注册全业务 API 会话/CSRF 守卫；未配置身份时保留明确标识的本机模式。
- 已登录用户与角色显示在现有租户区，退出使用现有导航区域，不增加遮挡画布的悬浮控件。

### 修改文件

- `src/auth/authClient.ts`
- `src/auth/AuthBoundary.tsx`
- `src/auth/authApiPlugin.ts`
- `src/App.tsx`
- `src/SecondaryViews.tsx`
- `src/studio/studioStateClient.ts`
- `src/assets/assetImageClient.ts`
- `src/fal/falImageClient.ts`
- `src/soft-glass.css`
- `tests/authClient.test.ts`
- `tests/authBoundary.test.tsx`
- `tests/authApiPlugin.test.ts`
- `tests/app.test.tsx`
- `tests/studioStateClient.test.ts`
- `package.json`
- `package-lock.json`
- `acceptance/manifest.json`

### 验证结果

- 新增契约先失败后实现通过；认证相关定向测试 12 项通过，受影响链路定向回归 45 项通过。
- 全量回归：24 个文件、268 项测试通过。
- TypeScript 与 Vite 生产构建通过；构建产物成功生成。
- Vitest 从 2.1 升级到 4.1.10，移除验收脚本已废弃的 `minWorkers` 参数；生产与开发依赖全量审计均为 0 漏洞。
- 浏览器 1280 x 720 验收：本机模式正确恢复节点画布，无水平溢出，控制台 0 错误/警告。
- 正式验收仍为红色：8 项通过、8 项部分实现。

### 风险控制

- Session 与 MFA 挑战始终只存在于 HttpOnly Cookie；浏览器 JavaScript 仅能读取独立 CSRF Cookie。
- 未配置身份服务时页面明确显示本机开发模式，生产文档仍要求提供 0600 身份配置和 Secure Cookie。
- 未把认证项提前标记为通过：整体状态 PUT 尚不能可靠区分审核、生成、素材和导出命令的角色权限。

### 剩余问题

- P0：整体快照写入缺少命令级服务端 RBAC，固定操作者尚未全部替换为可信会话主体。
- P0：StudioState、素材和 Fal 请求映射仍未按 Tenant/Project 分区，双租户 IDOR 测试尚未建立。
- P1：持久数据库、Worker 接管、供应商实际费用和完整逆向流程仍未闭环。

### 下一轮优先事项

优先建立双租户持久化失败测试，将 StudioState、素材和 Fal 请求映射按可信 Tenant/Project 上下文分区；随后拆分高风险命令并按角色执行服务端授权，消除剩余两个 P0。

## 2026-07-22 03:59 CST - StudioState 双租户分区

### 本轮完成

- 认证模式下所有业务请求必须携带合法项目 ID；Tenant 始终取自服务端会话，客户端不能提交或覆盖。
- 非 Owner/Admin 访问未分配项目统一返回资源不可见；业务账号缺少项目分配会在启动加载身份配置时失败。
- StudioState 使用 `SHA-256(tenantId + NUL + projectId)` 目录键独立持久化，各范围拥有独立 revision 与写入队列。
- 未配置身份服务时继续使用旧单机状态文件，保持本机开发和既有演示数据兼容。
- 新增默认 dry-run 的状态迁移命令；应用时排他复制、拒绝覆盖、目标权限 0600，并始终保留旧源文件。

### 修改文件

- `src/auth/authApiPlugin.ts`
- `src/auth/authClient.ts`
- `src/auth/AuthBoundary.tsx`
- `src/auth/authConfig.ts`
- `src/studio/studioStatePersistence.ts`
- `src/studio/studioStatePlugin.ts`
- `src/studio/studioStateClient.ts`
- `src/fal/falImageClient.ts`
- `vite.config.ts`
- `scripts/migrate-studio-state.mjs`
- `tests/authApiPlugin.test.ts`
- `tests/authClient.test.ts`
- `tests/authBoundary.test.tsx`
- `tests/authConfig.test.ts`
- `tests/studioStatePersistence.test.ts`
- `tests/migrateStudioState.test.ts`
- `docs/operations/tenant-state-migration.md`

### 验证结果

- 双租户同项目 ID 测试证明状态和 revision 独立，分区目录名为固定 64 位哈希。
- 迁移测试证明 dry-run 不写入、apply 不删除源文件、目标 0600 且重复执行拒绝覆盖。
- 受影响链路定向回归：8 个文件、62 项测试通过；配置专项 21 项通过。
- 全量回归：25 个文件、271 项测试通过。
- TypeScript 与 Vite 生产构建通过；生产与开发依赖审计均为 0 漏洞；Git 空白检查通过。

### 风险控制

- Tenant 不从 Header、Query 或请求体读取，只能来自已验证 Session。
- Tenant/Project 原值不参与文件路径拼接，统一使用不可逆哈希目录，消除路径穿越与跨范围碰撞。
- 迁移不覆盖、不移动、不删除旧状态；回滚期间禁止新旧实例同时写同一项目。

### 剩余问题

- P0：素材图片与 Fal 请求映射尚未按 Tenant/Project 分区。
- P0：整体状态写入仍缺少命令级 RBAC，审计 actor 尚未全部来自可信会话。
- P1：事务数据库、多实例、Worker 接管和供应商实际费用仍待完成。

### 下一轮优先事项

沿用已验证的 RequestProjectScope 和哈希目录策略，迁移素材存储与 Fal 队列；补相同图片哈希跨 Tenant 不可读取、相同 Fal request ID 跨范围不可访问的 IDOR 测试。

## 2026-07-22 04:18 CST - 素材与 Fal 范围隔离

### 本轮完成

- 素材图片按 Tenant/Project 范围哈希目录存储；相同内容哈希在不同租户中互不可见。
- 新上传素材 URL 包含已授权项目 ID，原生图片请求无需自定义 Header 也会由会话守卫恢复并校验项目范围。
- 兼容旧素材 URL：只允许从当前会话设置的项目 Cookie 恢复范围，Tenant 仍完全来自服务端 Session。
- Fal 每个 Tenant/Project 使用独立服务实例与持久映射，相同本地 request ID 不会跨范围覆盖或查询。
- 增加素材与 Fal 联合迁移命令，默认 dry-run、拒绝覆盖、失败清理本轮目标并保留全部源数据。

### 修改文件

- `src/auth/authApiPlugin.ts`
- `src/auth/authClient.ts`
- `src/assets/assetImageStorage.ts`
- `src/assets/assetImagePlugin.ts`
- `src/fal/falJobPersistence.ts`
- `src/fal/falProxyPlugin.ts`
- `vite.config.ts`
- `scripts/migrate-project-storage.mjs`
- `tests/assetImageStorage.test.ts`
- `tests/assetImagePlugin.test.ts`
- `tests/authApiPlugin.test.ts`
- `tests/authClient.test.ts`
- `tests/falJobPersistence.test.ts`
- `tests/migrateProjectStorage.test.ts`
- `docs/operations/tenant-state-migration.md`

### 验证结果

- 素材、Fal 与请求范围定向回归：7 个文件、32 项测试通过。
- 联合迁移测试证明 dry-run、排他目标、源数据保留及目标内容一致。
- 全量回归：27 个文件、275 项测试通过。
- TypeScript 与 Vite 生产构建通过；Git 空白检查通过。
- `ISOLATION-001` 具备代码、双租户测试与迁移回滚证据，已升级为 `pass`。

### 风险控制

- 客户端项目 Cookie 仅用于无 Header 的图片 GET，必须再次经过 Session 角色/项目授权；客户端不能提供 Tenant。
- 项目 URL 与服务端请求范围不一致时统一返回素材不存在，不查询其他范围存储。
- 所有范围路径只使用 SHA-256 目录键，Tenant/Project 原值不进入文件路径。

### 剩余问题

- P0：整体状态 PUT 尚缺命令级服务端 RBAC，客户端仍可能伪造审核/导出等高权限状态变化。
- P1：审计 actor 仍含固定字符串，事务数据库、Worker 接管和供应商实际费用尚未闭环。

### 下一轮优先事项

拆分或验证整体状态写入中的高风险命令差异，按可信会话角色执行 `job.create`、`review.decide`、`export.production` 等权限；同时由服务端覆盖审计 actor，清除最后一个 P0。

## 2026-07-22 04:43 CST - 命令级 RBAC 与可信操作者

### 本轮完成

- 为素材上传、Fal 任务提交/取消和 StudioState 写入增加服务端命令权限，Viewer 等只读角色在进入业务处理前即被拒绝。
- StudioState 写入按差异识别素材、场景、任务、审核、导出与结果命令；非法审核跳转、缺少命令审计和未知事件拒绝落库。
- 新增审计事件、审核人和采用人统一由服务端会话用户 ID 覆盖；既有审计历史不可删除或修改，客户端旧 actor 不能覆盖服务端记录。
- Fal 任务持久化可信创建人，Creator 只能取消本人任务，Owner/Admin 保留跨用户取消权限。
- 增加登录会话到状态持久化的角色 E2E，验证 Creator 提交成功、伪造审批失败、Reviewer 审批成功及可信 actor 落库。

### 修改文件

- `src/auth/authApiPlugin.ts`
- `src/studio/studioStateAuthorization.ts`
- `src/studio/studioStatePlugin.ts`
- `src/fal/falQueueService.ts`
- `src/fal/falProxyPlugin.ts`
- `tests/authApiPlugin.test.ts`
- `tests/studioStateAuthorization.test.ts`
- `tests/authRoleE2E.test.ts`
- `tests/falQueueService.test.ts`
- `acceptance/manifest.json`
- `docs/architecture/auth-tenant-design.md`
- `README.md`

### 验证结果

- 命令权限、可信 actor、Fal 所有权与角色 E2E 定向回归：5 个文件、34 项测试通过；角色链路 E2E 单独通过。
- 全量回归：29 个文件、283 项测试通过；TypeScript 与 Vite 生产构建通过。
- 高危依赖审计为 0；Git 空白检查通过。
- 浏览器重载后 17 个画布节点、素材图片和保存状态正常，无横向溢出、破图或控制台错误。
- `AUTH-001` 与 `REVIEW-001` 已升级为 `pass`，验收清单不再存在 P0，当前结论由红色转为黄色。

### 风险控制

- 权限与 actor 仅从服务端已验证 Session 读取；客户端不能提交 Tenant、角色或最终审计主体。
- 服务端保持审计前缀不可变，对客户端残留的旧 actor 只做忽略和回填，不放宽事件类型、目标、时间或详情校验。
- 旧 Fal 快照缺少创建人时，普通 Creator 不能取消；管理员可按 `job.cancel_any` 处理，避免迁移数据被错误认领。

### 剩余问题

- P1：事务数据库、备份、多实例一致性和持久 Worker 接管尚未闭环。
- P1：供应商失败/取消的实际费用口径、完整撤回/驳回恢复流程仍待实现。
- P2：新建项目、邀请成员和部分表头操作仍待补齐。

### 下一轮优先事项

优先处理 DATA-001 与 RECOVERY-001：引入可事务化的持久状态后端、备份/恢复验证和 Worker 租约接管，消除单机文件与进程内队列限制。

## 2026-07-22 05:03 CST - SQLite 事务与灾备闭环

### 本轮完成

- 企业身份模式默认切换为 SQLite StudioState 后端，范围键继续使用 Tenant/Project SHA-256，数据库目录和文件权限分别固定为 `0700`、`0600`。
- 启用 WAL、`synchronous=FULL`、5 秒 busy timeout 与 `BEGIN IMMEDIATE`，跨连接并发写只允许一个 revision 提交成功。
- 增加离页保护：存在排队、写入中、冲突或未确认状态时阻止无提示关闭，`pagehide` 会立即触发待写刷新。
- 增加在线备份命令，执行 checkpoint、SQLite Online Backup、完整性检查、SHA-256 清单和权限收敛。
- 增加默认 dry-run 的恢复命令；应用恢复前保留旧数据库和 WAL/SHM sidecar，失败时自动回滚原文件。
- 增加旧范围 JSON 到 SQLite 的单事务迁移，目标冲突整体拒绝，所有源快照始终保留。

### 修改文件

- `src/persistence/sqliteDatabase.ts`
- `src/studio/studioStatePersistence.ts`
- `src/studio/studioStatePlugin.ts`
- `src/studio/usePersistentStudioState.ts`
- `scripts/sqlite-common.mjs`
- `scripts/pias-database.mjs`
- `scripts/migrate-to-sqlite.mjs`
- `tests/studioStateSqlitePersistence.test.ts`
- `tests/sqliteOperations.test.ts`
- `tests/app.test.tsx`
- `vite.config.ts`
- `package.json`
- `README.md`
- `docs/operations/database-runbook.md`
- `docs/operations/tenant-state-migration.md`
- `acceptance/manifest.json`

### 验证结果

- SQLite 事务、跨连接冲突、重启恢复、损坏数据、备份恢复、回滚副本和迁移专项：2 个文件、6 项测试通过。
- App 离页保护及相关状态回归：22 项测试通过。
- 全量回归：31 个文件、290 项测试通过；TypeScript 与 Vite 生产构建通过。
- 高危依赖审计为 0；Git 空白检查通过。
- 浏览器重载后 17 个画布节点、素材和保存状态正常，无横向溢出、破图或控制台错误。
- `DATA-001` 已升级为 `pass`；剩余发布阻塞集中于 Fal Worker 恢复、费用口径和逆向流程。

### 风险控制

- SQLite 仅允许本机持久 POSIX 文件系统，不支持 NFS/SMB；运行时固定 Node 24.x。
- 迁移与恢复均默认 dry-run，拒绝覆盖已有范围；旧 JSON、旧数据库与 sidecar 在人工验证前不删除。
- 在线备份同时输出完整性结果和独立哈希清单；恢复必须停服务并在单实例验证后再恢复流量。

### 剩余问题

- P1：Fal 队列仍需持久 Worker、跨实例任务租约和自动接管。
- P1：供应商失败/取消实际费用口径，以及撤回/驳回/恢复流程尚未闭环。
- P2：新建项目、邀请成员和部分表头操作仍待补齐。

### 下一轮优先事项

将 Fal 作业元数据和 Worker 租约迁入 SQLite，增加租约过期接管、并发实例防重复推进与恢复循环 E2E，关闭 RECOVERY-001。

## 2026-07-22 05:30 CST - Fal 持久 Worker 与租约接管闭环

### 本轮完成

- Fal 作业迁入按 Tenant/Project 范围隔离的 SQLite 表，增量 UPSERT 避免多进程覆盖其他任务。
- 增加单作业租约、慢调用定时续租、争用只读缓存进度和租约过期接管，阻止跨进程重复推进。
- 增加后台恢复器，自动发现未完成范围与任务；重叠轮次合并，开发/预览服务关闭时停止并等待当前轮完成。
- 定向光两阶段任务增加隔离恢复载荷；服务重启后可继续最终阶段，提交成功或取消后立即删除源图载荷。
- 首次任务持久化失败会取消已经提交的 Fal 上游请求并返回 `FAL_PERSIST_FAILED`，避免孤儿任务继续计费。
- 旧范围 Fal JSON 与 StudioState 支持同一 `BEGIN IMMEDIATE` 事务导入，目标冲突整体拒绝并保留源文件。

### 修改文件

- `src/fal/falQueueService.ts`
- `src/fal/falSqlitePersistence.ts`
- `src/fal/falRecoveryWorker.ts`
- `src/fal/falProxyPlugin.ts`
- `src/persistence/sqliteDatabase.ts`
- `scripts/sqlite-common.mjs`
- `scripts/migrate-to-sqlite.mjs`
- `tests/falQueueService.test.ts`
- `tests/falSqliteRecovery.test.ts`
- `tests/sqliteOperations.test.ts`
- `vite.config.ts`
- `README.md`
- `docs/operations/database-runbook.md`
- `acceptance/manifest.json`

### 验证结果

- Fal 队列、租约、恢复器、迁移与代理专项：4 个文件、24 项测试通过。
- 全量回归：32 个文件、299 项测试通过；TypeScript 与 Vite 生产构建通过。
- 高危依赖审计为 0；Git 空白检查通过。
- 浏览器重载后 17 个画布节点与素材正常，0 破图、0 控制台警告/错误、无横向溢出；拖拽后节点无滤镜亮光。
- `RECOVERY-001` 已升级为 `pass`；验收统计为 13 项通过、3 项部分通过。

### 风险控制

- SQLite 仅声明支持同主机多进程，不宣传多主机共享；多主机扩展需迁移到分布式数据库与队列。
- 定向光恢复载荷按项目隔离并及时清理；数据库及备份按原始素材同等级保护。
- Worker 只扫描未完成任务，单任务状态推进受租约保护；持久化失败不会向调用方返回伪成功。
- 旧文件迁移默认 dry-run，StudioState 或 Fal 作业任一冲突都会回滚整个事务。

### 剩余问题

- P1：Fal 失败/取消响应尚未提供可核对的供应商实际费用，额度结算仍缺真实账单对账闭环。
- P1：撤回、驳回、修改后重试与恢复的角色/原因/血缘/通知闭环尚未完整实现。
- P2：新建项目、邀请成员和部分表头操作仍待实现或明确禁用。

### 下一轮优先事项

优先处理 `USAGE-001`：先核对 Fal 队列与结果接口可获得的费用字段，再建立供应商费用归一化、失败/取消结算和账单对账测试；若上游不提供费用，则以不可伪造的估算/待对账状态明确降级，不把预估值冒充实际值。

## 2026-07-22 05:52 CST - 客户额度与 Fal 成本对账闭环

### 本轮完成

- 客户额度新增不可变 Reserve、Charge 和 Release 台账，服务端校验追加性、Job/Profile 引用、每笔余额和汇总值，拒绝篡改历史或直接伪造余额。
- 修正部分成功结算：不再按全部预估输出扣费，而是按实际成功图片数与 Task Profile 单价计算，并释放剩余冻结额度。
- 修正用量界面的零值显示：失败、取消、过期任务显示实际 `0` 点，不再因真值判断错误回退显示预占额度。
- 接入 Fal Billing Events Admin API，按所有上游 request ID 私有归集计费单位、单价、折扣和实际纳美元成本；客户任务结果 API 不暴露该数据。
- 只有全部上游请求都获得账单事件才进入 `confirmed`；部分返回保持 `pending`，后台 Worker 按冷却周期自动重试。
- 修复 Admin Key 缺失/权限不足后的永久停滞：`unavailable` 账单在冷却期后会重试，运维更正凭证后无需直接改数据。
- 新增不输出密钥或账单正文的 `npm run fal:billing:check` 上线预检，且禁止在 Admin Key 缺失时回退使用推理 Key。

### 修改文件

- `src/domain.ts`
- `src/workbench/Workbench.tsx`
- `src/SecondaryViews.tsx`
- `src/studio/studioStateSchema.ts`
- `src/studio/studioStateAuthorization.ts`
- `src/fal/falBillingClient.ts`
- `src/fal/falQueueService.ts`
- `src/fal/falRecoveryWorker.ts`
- `src/fal/falProxyPlugin.ts`
- `scripts/check-fal-billing-access.mjs`
- `tests/domain.test.ts`
- `tests/workbench.test.tsx`
- `tests/studioStateAuthorization.test.ts`
- `tests/falBillingClient.test.ts`
- `tests/falBillingPreflight.test.ts`
- `tests/falQueueService.test.ts`
- `tests/falSqliteRecovery.test.ts`
- `acceptance/manifest.json`
- `README.md`
- `docs/operations/fal-billing-reconciliation.md`

### 验证结果

- 先执行部分成功过量扣费、台账篡改、账单权限隔离、部分 Billing Events 和 `unavailable` 永久停滞的失败测试，确认红灯后修复。
- Fal 账单客户端、预检、队列对账和恢复 Worker 定向回归：4 个文件、28 项测试通过。
- 全量回归：34 个文件、312 项测试通过；TypeScript 与 Vite 生产构建通过。
- 高危依赖审计为 0；Git 空白检查通过。
- 浏览器重载后会话恢复、画布和用量页正常；用量汇总与 4 条任务明细对齐，0 控制台警告/错误、0 破图、无横向溢出，客户页面未暴露供应商采购成本。
- 当前本地凭证对 Billing Events 权限预检返回 HTTP 403 `billing_access_denied`，未泄露凭证或响应正文；因此 `USAGE-001` 保持 `partial`，不冒充生产已对账。

### 风险控制

- 推理 Key 与 Admin Key 使用独立环境变量/文件，账单客户端不读取 `FAL_KEY` 或默认桌面密钥。
- 供应商采购成本只在服务端 Fal 作业快照中保存，普通结果 API 和客户用量界面仅使用企业额度台账。
- 账单未到达、网络失败和权限失效都保留明确的 `pending/unavailable` 状态，预估成本不会写成实际成本。

### 剩余问题

- P1 外部前置：正式部署需配置具有 Billing Events 权限的 Fal Admin Key，并让 `npm run fal:billing:check` 返回 `billing_access_confirmed`。
- P1：撤回、驳回、修改后重试与恢复的角色、原因、血缘、通知和账务闭环尚未完整实现。
- P2：新建项目、邀请成员和部分表头操作仍待实现或明确禁用。

### 下一轮优先事项

处理 `REVERSE-001`：从需求状态图和现有审核/重试代码建立反证测试矩阵，先闭环驳回原因、修改后新 Job 血缘、重复命令幂等与可恢复任务，再补撤回与通知语义。

## 2026-07-22 06:15 CST - 审核逆向流程与修改版本闭环

### 本轮完成

- 审核状态机补齐明确拒绝与提交人撤回；审核退回和拒绝原因强制为 5-500 字，旧结果不得绕过修改直接重新提交。
- 修改后重试创建独立 Job 与 Result，保留 `retryOfJobId` / `supersedesResultId` 血缘；场景、Profile、源结果和重复活动重试均由领域层与服务端双重校验。
- 服务端以可信会话校验审核人、原提交人和重试血缘，阻止自审、他人撤回、伪造原因、篡改历史通知与伪造重试来源。
- 历史审计 actor 改写不再静默纠正，而是以 `STUDIO_AUDIT_IMMUTABLE` 明确拒绝，新增事件仍统一覆盖为可信会话用户。
- 每次提交、撤回、通过、退回和拒绝都追加按角色或用户定向的站内通知；通知、审核事件和原结果历史均不可变。
- 工作台补齐待审核撤回、退回/拒绝后的“修改后重试”弹窗；审核页补齐显式拒绝与原因弹窗，失败/过期任务重试同步记录来源 Job。
- README 与验收清单同步修正，`REVERSE-001` 由 `partial` 升级为 `pass`。

### 修改文件

- `src/domain.ts`
- `src/studio/studioStateAuthorization.ts`
- `src/studio/studioStateSchema.ts`
- `src/App.tsx`
- `src/SecondaryViews.tsx`
- `src/workbench/graph.ts`
- `src/workbench/CanvasNodes.tsx`
- `src/workbench/Workbench.tsx`
- `src/workbench/ResultInspector.tsx`
- `src/styles.css`
- `src/soft-glass.css`
- `tests/domain.test.ts`
- `tests/studioStateAuthorization.test.ts`
- `tests/studioStateSchema.test.ts`
- `tests/workbench.test.tsx`
- `tests/app.test.tsx`
- `acceptance/manifest.json`
- `README.md`

### 验证结果

- 先执行自审、越权撤回、伪造原因/血缘、历史审计 actor 改写、旧结果直接重提、重复活动重试和 UI 缺失的失败测试，确认红灯后修复。
- 领域、服务端授权、Schema、工作台与应用专项：5 个文件、164 项测试通过。
- 全量回归：34 个文件、326 项测试通过；TypeScript 与 Vite 生产构建通过。
- 生产验收脚本通过全部自动检查；高危依赖审计为 0，Git 空白检查通过。
- 浏览器 1280 x 720 实测退回、拒绝、通过三个入口；拒绝原因 4 字时确认禁用、达到最小长度后启用，取消不改变待审核状态；0 破图、无横向溢出、控制台 0 警告/错误。
- 验收统计更新为 14 项通过、2 项部分通过；当前仍为黄色，不冒充正式上线完成。

### 风险控制

- 退回/拒绝结果保留为不可变历史，新版本通过独立 Job 结算，避免覆盖原参数、审核决定或额度账目。
- 通知收件人由服务端根据可信角色和最近提交审计重新计算，客户端不能把审核信息投递给任意用户。
- 审核决定弹窗只有确认后才写状态；本轮浏览器验收仅打开、校验和取消弹窗，未修改持久化演示数据。

### 剩余问题

- P1 外部前置：正式部署需配置具备 Billing Events 权限的 Fal Admin Key，并让 `npm run fal:billing:check` 返回 `billing_access_confirmed`。
- P2：新建项目、邀请成员和部分表头操作仍待实现或明确禁用。

### 下一轮优先事项

处理 `UI-001`：按真实运营链路补齐新建项目与邀请成员，逐个审计仍无动作的表头按钮；可暂缓功能必须显示为不可用并说明条件，不能保留无反馈的假入口。

## 2026-07-22 06:51 CST - 项目与成员管理真实化

### 本轮完成

- 新建项目接入按 Tenant 隔离的 SQLite 事务，同一事务创建项目、创建者成员关系和不可变审计事件。
- 项目列表、创建表单和打开入口改为真实 API；打开项目会切换请求头/Cookie 作用域、重新加载快照，刷新后只恢复会话仍有权访问的当前项目。
- 企业项目首次进入时先解析服务端项目元数据，无快照只建立空白节点，不再将演示素材写入生产项目。
- 成员邀请按可信角色和项目范围保存，阻止重复待处理邀请与越权操作；当前项目为默认分配范围。
- 界面对 `pending_configuration` 明确显示“邮件服务未配置，尚未发送”，不冒充投递成功；本机模式禁用企业操作并说明条件。
- 移除“导出清单”“审计日志”等无任何动作的表头按钮，改为非交互状态信息。

### 修改文件

- `src/App.tsx`
- `src/SecondaryViews.tsx`
- `src/auth/AuthBoundary.tsx`
- `src/auth/authClient.ts`
- `src/auth/authApiPlugin.ts`
- `src/auth/identityService.ts`
- `src/organization/organizationClient.ts`
- `src/organization/organizationPlugin.ts`
- `src/organization/organizationService.ts`
- `src/persistence/sqliteDatabase.ts`
- `src/studio/demoState.ts`
- `src/studio/usePersistentStudioState.ts`
- `src/styles.css`
- `src/soft-glass.css`
- `scripts/sqlite-common.mjs`
- `vite.config.ts`
- `tests/app.test.tsx`
- `tests/authBoundary.test.tsx`
- `tests/authClient.test.ts`
- `tests/authApiPlugin.test.ts`
- `tests/identityService.test.ts`
- `tests/organizationClient.test.ts`
- `tests/organizationApiPlugin.test.ts`
- `tests/organizationService.test.ts`
- `tests/sqliteOperations.test.ts`
- `README.md`
- `docs/operations/organization-management.md`
- `acceptance/manifest.json`

### 验证结果

- 先执行本机模式假入口、项目创建/切换、刷新恢复、企业首次空白状态、邀请真实投递状态和新项目邀请范围的失败测试，确认红灯后逐项修复。
- 全量回归：37 个文件、343 项测试通过；TypeScript 与 Vite 生产构建通过，Git 空白检查通过。
- 生产依赖高危漏洞为 0；验收报告为 15 项通过、2 项部分通过，仍为黄色。
- 浏览器企业态跑通登录/MFA、创建项目、切换、刷新恢复、成员邀请；1280 x 720 与 390 x 844 均无横向溢出或文字裁切，0 破图，清洁页签控制台 0 警告/错误。
- 浏览器证据：`docs/acceptance/evidence/pias-organization-project-2026-07-22.png` 和 `pias-organization-admin-2026-07-22.png`。

### 风险控制

- 项目恢复 Cookie 只作为选择偏好，必须出现在服务端会话返回的有权项目列表才会生效；伪造项目 ID 会回退到第一个有权项目。
- 组织数据进入 SQLite schema version 4，继承在线备份、完整性检查、dry-run 恢复和 `.rollback-*` 回滚机制。
- 临时企业浏览器验收使用 `/tmp` 隔离数据库和测试账户，未使用 Fal Key、生产数据或真实邮箱投递。

### 剩余问题

- P1 外部前置：正式部署需配置具备 Billing Events 权限的 Fal Admin Key，并让 `npm run fal:billing:check` 返回 `billing_access_confirmed`。
- P1：成员邀请尚缺短期签名令牌、邮件队列/投递、接受交易、撤销和过期回收闭环。

### 下一轮优先事项

处理 `MEMBER-001`：先用失败测试定义不可逆的邀请令牌哈希、接受/撤销/过期状态机和幂等语义，再接入可替换的邮件投递队列；未配置邮件时保留可复制的管理员入组链接，不伪造发送成功。

## 2026-07-22 07:20 CST - 成员邀请与持久身份闭环

### 本轮完成

- SQLite 升级到 schema version 5；新增持久成员表，并为邀请加入令牌摘要、接受时间和撤销时间。v4 数据库通过事务增量迁移，原邀请行保留。
- 邀请令牌使用 256 位随机值，数据库仅保存 SHA-256 摘要；原始令牌只在创建响应中出现一次，管理端生成 URL fragment 链接，页面设置 `no-referrer`。
- 公开预览与接受 API 已闭环；接受交易原子创建成员、项目关系、邀请状态和审计事件，重复消费返回 `409`，过期邀请持久化为 `expired`。
- 管理员邀请强制完成 TOTP 初始化与当前验证码校验；普通成员通过 scrypt 密码策略创建账户。
- 身份服务加入持久用户解析器，登录、MFA、会话恢复和项目权限均从 SQLite 重新读取；服务重启后新成员仍可登录。
- 管理端只允许选择真实企业项目，创建后展示一次性链接和复制按钮；待处理邀请可撤销且重复撤销幂等。邮件未配置时不冒充发送成功。
- 新增独立中文邀请接受页，覆盖邀请信息、密码确认、管理员 MFA、成功状态和失效状态；桌面和移动布局均无横向溢出。

### 修改文件

- `src/persistence/sqliteDatabase.ts`
- `scripts/sqlite-common.mjs`
- `src/auth/identityService.ts`
- `src/auth/authApiPlugin.ts`
- `src/organization/organizationService.ts`
- `src/organization/organizationPlugin.ts`
- `src/organization/organizationClient.ts`
- `src/organization/InvitationAcceptance.tsx`
- `src/App.tsx`
- `src/SecondaryViews.tsx`
- `src/soft-glass.css`
- `index.html`
- `tests/identityService.test.ts`
- `tests/authApiPlugin.test.ts`
- `tests/organizationService.test.ts`
- `tests/organizationApiPlugin.test.ts`
- `tests/organizationClient.test.ts`
- `tests/app.test.tsx`
- `acceptance/manifest.json`
- `README.md`
- `docs/operations/organization-management.md`

### 验证结果

- 先执行令牌明文入库、重复消费、撤销/过期、动态成员登录、公开路由边界、v4 升级和管理员 MFA 失败测试，确认 7 项红灯后实现。
- 聚焦回归：身份、组织服务、API、客户端和应用测试全部通过。
- 全量回归：37 个文件、353 项测试通过；TypeScript 与 Vite 生产构建通过，Git 空白检查通过。
- `npm audit --omit=dev --audit-level=high`：0 漏洞。
- 验收报告：15 项通过、2 项部分通过；`MEMBER-001` 的安全链接入组子链路已通过，但整体仍缺 PRD 必选的邮件与成员生命周期，当前保持黄色。
- 真实浏览器完成所有者登录/MFA、创建企业项目、签发邀请、公开接受、服务重启、新成员登录和旧链接重放失败。1280 x 720 与 390 x 844 均无横向溢出，0 破图，控制台 0 警告/错误。
- 浏览器证据：`docs/acceptance/evidence/pias-member-invitation-admin-2026-07-22.jpg`、`pias-member-invitation-accepted-2026-07-22.jpg`。
- 主服务已用最新代码重启，`http://127.0.0.1:5173/` 返回 HTTP 200。

### 风险控制

- 公开接口只放行邀请预览和接受，撤销仍要求有效会话、CSRF、`member.manage` 和可信 Tenant；自动化测试验证匿名撤销返回 `401`。
- 原始令牌不进入数据库、审计、持久前端状态或 Referer；令牌丢失只能撤销后重签，不能恢复。
- 旧 v4 待处理邀请因没有令牌摘要而不可接受，管理员必须撤销并重签；迁移不伪造令牌。
- 浏览器验收使用 `/tmp` 隔离数据库、专用测试账户和不存在的 Fal Key 文件，未调用付费模型、未发送邮件、未接触真实业务数据；验收后临时服务和页签已清理。

### 剩余问题

- P1 外部前置：正式部署需配置具备 Billing Events 权限的 Fal Admin Key，并让 `npm run fal:billing:check` 返回 `billing_access_confirmed`。当前凭证仍返回 HTTP 403，不能标记通过。
- P1：邀请邮件与重发、成员禁用/重新启用、角色变更和首次登录审计尚未实现；安全链接只能作为真实降级，不能替代 PRD 的正式上线要求。
- P2 架构边界：当前素材与导出仍是单机文件系统；多主机发布需接入对象存储和签名 URL，或明确保持单机部署拓扑。

### 下一轮优先事项

继续处理 `MEMBER-001`：先以失败测试定义成员禁用/重新启用、60 秒内会话失效、角色与项目范围变更、首次登录审计和邀请重发；邮件采用可替换队列接口，未配置提供商时仍保持 `pending_configuration`，不得伪造投递成功。

## 2026-07-22 07:45 CST - 成员生命周期与登录审计闭环

### 本轮完成

- SQLite 升级到 schema version 6，成员新增首次登录时间；v5 成员行通过 `BEGIN IMMEDIATE` 增量迁移且不丢失，运行时与命令行迁移工具保持同一版本。
- 新增租户范围内的成员列表，以及角色、启用状态和多项目范围原子更新；拒绝跨租户访问、空项目范围、停用当前成员和未启用 MFA 的管理员升级。
- 动态成员的状态、角色和项目权限在每次请求时从数据库重新解析；停用后下一次请求立即使旧会话失效，重新启用不恢复已销毁的会话。
- 每次成功建立会话写入不可变登录审计；首次登录通过条件更新原子标记，后续登录记录 `firstLogin=false`，失败登录不写成功审计。
- 企业管理页新增成员表和编辑面板，角色使用下拉、项目使用多选、停用使用复选开关；保存后立即显示服务端最新状态。

### 修改文件

- `src/auth/identityService.ts`
- `src/organization/organizationService.ts`
- `src/organization/organizationPlugin.ts`
- `src/organization/organizationClient.ts`
- `src/persistence/sqliteDatabase.ts`
- `src/SecondaryViews.tsx`
- `src/soft-glass.css`
- `scripts/sqlite-common.mjs`
- `tests/identityService.test.ts`
- `tests/organizationService.test.ts`
- `tests/organizationApiPlugin.test.ts`
- `tests/organizationClient.test.ts`
- `tests/sqliteOperations.test.ts`
- `tests/app.test.tsx`
- `README.md`
- `docs/operations/organization-management.md`
- `acceptance/manifest.json`

### 验证结果

- 先执行成员生命周期、登录审计、v5 到 v6 迁移、HTTP/客户端和界面失败测试，确认红灯后逐层实现。
- 全量回归：37 个测试文件、361 项测试通过；TypeScript 与 Vite 生产构建通过，Git 空白检查通过。
- 全量依赖审计：0 漏洞；生产验收自动检查全部通过。
- 隔离企业态浏览器与独立 Cookie Jar 跑通：所有者登录/MFA、创建项目、签发邀请、公开激活、新成员登录、角色变更、停用、旧会话从 HTTP 200 变为 401、重新启用及新角色登录。
- SQLite 取证确认 schema v6、成员最终为 `reviewer/active`，审计顺序包含首次登录、停用、角色变更、恢复和后续登录；浏览器 1280 x 720 无横向溢出、0 破图、控制台 0 警告/错误。
- 浏览器证据：`docs/acceptance/evidence/pias-member-lifecycle-2026-07-22.png`。
- 验收统计维持 15 项通过、2 项部分通过，未把外部配置缺口冒充为通过。

### 风险控制

- 登录审计不记录密码、会话、CSRF、MFA Secret 或邀请令牌；成员编辑审计只保存旧值和新值。
- 成员历史记录不因停用而删除；项目关系变更与角色/状态审计在同一事务提交，失败整体回滚。
- 浏览器验收使用 `/tmp` 隔离数据库和测试身份，未调用付费模型、未发送邮件、未读取真实 Fal Key；验收后临时服务、数据和页签均已清理。
- schema v6 回滚继续使用数据库恢复命令生成的 `.rollback-*` 副本；回滚前必须停止写入，避免旧二进制与 v6 数据库并行写入。

### 剩余问题

- P1 外部前置：正式部署需配置具备 Billing Events 权限的 Fal Admin Key，并让 `npm run fal:billing:check` 返回 `billing_access_confirmed`。
- P1：PRD 必选的邀请邮件与重发尚未实现；当前一次性安全链接只允许受控试用，不能作为正式邮件投递替代。
- P2 架构边界：素材和导出仍采用单机文件系统；多主机部署需接入对象存储和签名 URL，或保持文档约束的单机拓扑。

### 下一轮优先事项

继续处理 `MEMBER-001`：先以失败测试定义“重发即撤销旧令牌并生成新令牌”的不可逆语义，再实现 SQLite 邮件 Outbox、可替换投递适配器、失败重试与投递审计；未配置邮件提供商时继续保持 `pending_configuration`。

## 2026-07-22 08:06 CST - 邀请重发与加密邮件 Outbox

### 本轮完成内容

- 新增邀请重新签发状态机与 `POST /api/organization/invitations/:id/resend`：同一事务撤销旧邀请并签发新令牌，旧链接立即失效，已接受邀请禁止重发，同邮箱始终最多一个有效待处理邀请。
- 管理端新增重新签发按钮、处理中状态和真实投递文案；`queued` 显示进入邮件发送队列，未配置邮件时才提示管理员通过受控渠道发送。
- SQLite 升级到 schema v7，新增 `organization_email_outbox`。令牌使用 AES-256-GCM 密文保存，并以 Tenant、邀请 ID、收件邮箱绑定附加认证数据；邀请表继续只存 SHA-256 摘要。
- 新增随组织 Vite 插件启动的邮件 Worker：`BEGIN IMMEDIATE` 领取租约，HTTPS Webhook 使用固定 `Idempotency-Key`，2xx 后才标记 `sent`；失败从 60 秒起指数退避，最长一小时。
- 撤销、过期和重新签发会同步取消旧 Outbox 行；投递成功/失败写入不可变 `system` 审计，失败仅保存稳定错误码，不保存 Provider 响应正文。
- 补齐五项生产邮件配置、`0600` 密钥约束、Relay 请求契约、上线实发验证、Key 轮换限制和 schema v7 成对回滚说明。

### 修改文件

- `src/organization/invitationEmailDelivery.ts`
- `src/organization/organizationService.ts`
- `src/organization/organizationPlugin.ts`
- `src/organization/organizationClient.ts`
- `src/persistence/sqliteDatabase.ts`
- `src/SecondaryViews.tsx`
- `scripts/sqlite-common.mjs`
- `tests/invitationEmailDelivery.test.ts`
- `tests/organizationService.test.ts`
- `tests/organizationApiPlugin.test.ts`
- `tests/organizationClient.test.ts`
- `tests/sqliteOperations.test.ts`
- `tests/app.test.tsx`
- `README.md`
- `docs/operations/organization-management.md`
- `acceptance/manifest.json`
- `docs/acceptance/evidence/pias-invitation-resend-2026-07-22.jpg`

### 验证结果

- 严格按红绿循环完成服务、HTTP、客户端、界面、SQLite 迁移、密文、重试、取消、审计和插件启动测试。
- 全量回归：38 个测试文件、372 项测试通过；TypeScript 与 Vite 生产构建通过，Git 空白检查通过。
- `npm audit --omit=dev`：0 漏洞；验收自动检查全部通过。
- 隔离企业态浏览器跑通所有者登录/MFA、创建项目、签发邀请和重新签发；旧链接返回 `409 ORG_INVITATION_NOT_PENDING`，新链接预览返回 `200`。
- 1280 x 720 页面 `scrollWidth=clientWidth=1280`、0 破图、控制台 0 警告/错误；证据为 `docs/acceptance/evidence/pias-invitation-resend-2026-07-22.jpg`。
- 隔离服务与临时身份、数据库已清理，主服务 `http://127.0.0.1:5173/` 保持 HTTP 200。
- 验收统计仍为 15 项通过、2 项部分通过；自动化实现完成不等同于生产邮件已真实送达。

### 风险控制

- 浏览器验收未配置邮件、未调用付费模型、未读取真实 Fal Key；邀请地址只指向隔离本机环境，验收后临时数据全部删除。
- 密文、摘要、审计和错误字段均不记录可直接使用的明文令牌；Webhook 响应正文不会持久化。
- 同主机多 Worker 通过数据库写锁、租约和幂等键控制重复投递；在途邮件无法撤回时，旧链接仍由邀请状态机拒绝。
- schema v7 回滚必须同时恢复升级前数据库和旧二进制；加密 Key 轮换前必须清空待发队列并备份。

### 剩余问题

- P1 外部前置：生产 Fal Admin Key 对 Billing Events 仍返回 `403`，需更换具备权限的凭证并通过 `npm run fal:billing:check`。
- P1 外部前置：生产邮件 Relay、公开 HTTPS 域名、发件人域名和两个密钥文件尚未配置，需完成专用测试邮箱实发后才能把 `MEMBER-001` 改为通过。
- P2 架构边界：素材和导出仍采用单机文件系统；当前只支持文档约束的单机部署拓扑。

### 下一轮优先事项

补充统一生产发布预检，把 Fal Billing 权限、邮件五项配置、数据库完整性、schema 版本和 HTTPS 安全 Cookie 汇总为单一机器可读门禁；在没有真实外部凭证时继续保持黄色，不伪造上线通过。

## 2026-07-22 08:23 CST - 统一生产发布预检门禁

### 本轮完成内容

- 新增 `release:preflight` 生产硬门禁和仅查看报告的 `release:preflight:report`，统一输出不含密钥和路径的稳定 JSON 检查结果。
- 自动核验 Node 24、生产模式、安全 Cookie、公开 HTTPS、SQLite 后端、schema v7 与完整性、私有资产目录、构建产物、身份配置、Fal 双 Key 文件、邮件 Relay 与加密 Key、Billing Events 实际权限。
- 回滚门禁不仅检查备份完整性、SHA-256 清单和 `0600` 权限，还验证清单来源与当前数据库一致，拒绝无关健康备份。
- 生产门禁禁止 `FAL_KEY`、`FAL_ADMIN_KEY` 明文环境变量；Billing 探测会丢弃这两项，只从专用 `0600` 文件读取 Admin Key。
- 补齐发布预检、数据库备份衔接、阻塞码处置和“邮件配置通过不等于真实送达”的运维说明；业务验收和生产配置门禁必须同时通过。

### 修改文件

- `scripts/release-preflight-core.mjs`
- `scripts/release-preflight-core.d.mts`
- `scripts/release-preflight.mjs`
- `tests/releasePreflight.test.ts`
- `package.json`
- `README.md`
- `docs/operations/release-preflight.md`
- `docs/operations/database-runbook.md`
- `docs/acceptance/README.md`
- `acceptance/manifest.json`

### 测试和构建结果

- 以失败测试覆盖空配置、完整生产夹具、明文密钥隔离、无关备份拒绝和报告 CLI；聚焦测试 5 项通过。
- 全量回归：39 个测试文件、377 项测试通过。
- TypeScript 严格检查与 Vite 生产构建通过；构建产物稳定生成，保留一个 570.14 kB 主包的非阻断体积提示。
- `npm audit --omit=dev --audit-level=high`：0 漏洞；`git diff --check`：通过。
- `npm run acceptance:report` 自动检查全部通过，结论维持 15 项通过、2 项部分通过、黄色。
- `npm run release:preflight:report` 在当前非生产环境准确返回配置阻塞码，未输出密钥或本机路径；主服务 `http://127.0.0.1:5173/` 返回 HTTP 200。

### 风险控制

- 预检除 Fal Billing 只读 GET 外不发起网络写入，不发送邮件、不提交图片任务、不修改数据库。
- 报告只暴露稳定检查 ID 与错误码；Provider 响应、凭证内容、配置路径和用户信息均不会输出。
- 报告模式固定返回 0，文档明确禁止用于发布放行；只有硬门禁命令在失败时返回非零。
- 未使用真实生产数据、未执行付费模型、未公开部署，也未改变正在运行的本机开发服务。

### 剩余问题

- P1 外部前置：当前生产 Fal Admin Key 未配置；历史凭证对 Billing Events 返回 403，必须取得具备权限的专用 Key 后让 `fal.billing` 通过。
- P1 外部前置：生产 HTTPS 域名、邮件 Relay、发件人域名和密钥文件尚未配置，必须使用专用邮箱完成实发、收件、接受与审计取证。
- P2：Vite 主包 570.14 kB，后续可按导航视图拆分动态加载；不阻断当前单机发布链路。

### 下一轮优先事项

在外部 P1 等待真实凭证期间，继续补齐可离线完成的发布运维闭环：生产环境模板、启动/停止与健康检查、构建版本标识及失败回滚演练，确保外部配置到位后只需执行一次硬门禁与真实收件验收。

## 2026-07-22 08:42 CST - 健康探针、发布身份与候选部署契约

### 本轮完成内容

- 新增公开只读的 `/api/health/live` 与 `/api/health/ready`；存活端点标识进程和版本，就绪端点实际检查 SQLite schema v7/quick check、构建首页、素材目录读写能力和身份配置。
- 健康响应统一禁用缓存并设置 `nosniff`；就绪异常只返回稳定状态和 `PIAS_NOT_READY`，不泄露数据库路径或底层错误。
- 构建新增原子 `dist/release.json`，记录 package version、Git revision、构建时间与工作树状态；Preview 实例会从产物读取真实 revision。
- 发布预检新增元数据校验，拒绝缺失、篡改、未知 revision 或脏工作树产物；测试构建允许生成 dirty 产物，但不能进入生产。
- 新增无密钥环境模板、systemd 候选模板、单机目录权限、TLS 反代边界、双门禁、健康检查和回滚手册。
- 自查确认 API 仍由 Vite Preview 承载，不将其冒充正式生产 HTTP 服务；新增 `OPS-001` 并保持部分通过。

### 修改文件

- `src/server/healthPlugin.ts`
- `src/server/productionReadiness.ts`
- `src/server/releaseIdentity.ts`
- `scripts/write-release-metadata-core.mjs`
- `scripts/write-release-metadata-core.d.mts`
- `scripts/write-release-metadata.mjs`
- `scripts/release-preflight-core.mjs`
- `tests/healthPlugin.test.ts`
- `tests/releaseMetadata.test.ts`
- `tests/releasePreflight.test.ts`
- `vite.config.ts`
- `package.json`
- `.gitignore`
- `deploy/pias.env.example`
- `deploy/pias.service.example`
- `docs/operations/deployment-runbook.md`
- `docs/operations/release-preflight.md`
- `README.md`
- `acceptance/manifest.json`

### 测试和构建结果

- 先以缺失模块和 dirty 产物未拒绝的失败测试建立红灯，再完成实现；聚焦 3 个文件、13 项测试通过。
- 全量回归：41 个测试文件、385 项测试通过；TypeScript 严格检查与 Vite 构建通过。
- 构建成功生成 `release.json`，当前工作树按事实标记 `dirty=true`；生产预检准确返回 `BUILD_METADATA_DIRTY`。
- 隔离 Preview 端口 `4174` 实测 live 返回 HTTP 200、版本 `0.1.0` 和当前 40 位 Git revision，验收后临时进程已停止。
- 主服务 `5173` 实测 live 为 200；缺少生产身份/数据库时 ready 为 503，响应不含本机路径或底层错误。
- `npm audit --omit=dev --audit-level=high` 为 0 漏洞，`git diff --check` 通过。
- 验收自动检查全部通过；业务结论为 15 项通过、3 项部分通过、黄色。

### 风险控制

- 健康探针不执行写入、不访问 Fal、不发送邮件；数据库以只读连接执行 `PRAGMA quick_check`。
- 发布元数据只含公开版本信息，不包含构建路径、用户、环境变量或密钥。
- systemd 候选服务仅绑定 `127.0.0.1`，模板禁止 Fal 明文 Key；正式公网流量必须经过 TLS 反向代理。
- 未公开部署、未调用付费模型、未发送真实邮件，隔离 Preview 已清理且主开发服务未中断。

### 剩余问题

- P1 `OPS-001`：后端 API 仍依赖 Vite Preview，需构建独立 Node HTTP 生产入口并完成启动、静态文件、API、优雅停机和健康 E2E。
- P1 `USAGE-001`：仍缺具备 Billing Events 权限的生产 Fal Admin Key。
- P1 `MEMBER-001`：仍缺生产 HTTPS 域名、邮件 Relay、发件人域名和专用邮箱真实收件证据。
- P2：主包 570.14 kB，后续可按导航视图动态拆分。

### 下一轮优先事项

测试驱动实现独立 Node HTTP 生产服务，复用现有认证、组织、素材、状态和 Fal 中间件，安全提供静态 SPA fallback、API 404、SIGTERM 优雅停机及 live/ready；替换 systemd 的 Vite Preview 后再评估 `OPS-001`。

## 2026-07-22 09:07 CST - 独立 Node 生产服务闭环

### 本轮完成内容

- 新增独立 Node HTTP 服务，直接复用认证、组织/邮件 Worker、素材、StudioState、Fal 队列与健康中间件，不再依赖 Vite Preview 承载生产 API。
- 使用 `sirv` 提供静态资源和 SPA 深链 fallback；哈希资源一年 immutable，HTML 与健康/API 禁止缓存，并统一设置 `nosniff`、`DENY`、`no-referrer` 和设备权限策略。
- 服务强制生产模式、安全 Cookie、SQLite、身份配置和回环地址；未知 API 不会回退到 HTML，匿名请求继续遵循现有认证隐藏边界。
- 支持动态测试端口、端口冲突显式失败、幂等关闭和 SIGTERM/SIGINT 优雅停机；启动日志仅包含安全版本信息。
- Vite SSR 构建新增 `dist-server/server.mjs`，`npm start` 和 systemd 已切换到该文件；生产预检新增 `server.artifact` 硬检查。
- 部署手册恢复为正式单机生产拓扑，补充双产物、生产依赖裁剪和独立服务说明；`OPS-001` 基于代码、测试和真实进程证据改为通过。

### 修改文件

- `src/server/productionServer.ts`
- `vite.server.config.ts`
- `tests/productionServer.test.ts`
- `scripts/release-preflight-core.mjs`
- `tests/releasePreflight.test.ts`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `.gitignore`
- `deploy/pias.env.example`
- `deploy/pias.service.example`
- `docs/operations/deployment-runbook.md`
- `docs/operations/release-preflight.md`
- `README.md`
- `acceptance/manifest.json`

### 测试和构建结果

- 先以缺失生产服务和缺失 server artifact 建立失败测试，再完成运行器、静态层、构建与预检实现。
- 独立服务聚焦测试 5 项通过：live/ready、SPA/缓存、安全头、API 认证边界、生产配置拒绝、优雅关闭和端口冲突。
- 全量回归：42 个测试文件、390 项测试通过；TypeScript 严格检查通过。
- 前端 `dist/` 与服务端 `dist-server/server.mjs` 均构建成功；服务 bundle 124.66 kB，source map 408.71 kB。
- 隔离构建产物真实进程在 `4175` 启动，ready 返回 200 且四项检查均为 `ok`，SPA 深链为 200，未知 API 为 JSON 401；SIGTERM 后退出码为 0，临时数据库、身份和素材目录已删除。
- `server.artifact` 在真实预检报告中为 pass；生产依赖树完整，`npm audit --omit=dev` 为 0 漏洞，`git diff --check` 通过。
- 验收自动检查全部通过，结论恢复为 16 项通过、2 项外部 P1 部分通过、黄色。

### 风险控制

- 生产服务只允许绑定 `127.0.0.1` 或 `::1`，公网必须经过 TLS 反向代理；错误响应不包含文件路径、堆栈或 Provider 正文。
- 隔离 E2E 使用临时 SQLite、测试身份和空素材目录，未读取真实 Fal Key、未启动邮件 Worker、未调用付费模型或外部写入。
- 端口冲突实例会清理已挂载 Worker/数据库资源，不中断已运行实例；测试验证现有 live 仍为 200。
- 构建产物和临时目录均不进入 Git，主开发服务 `5173` 未中断。

### 剩余问题

- P1 `USAGE-001`：仍缺具备 Billing Events 权限的生产 Fal Admin Key。
- P1 `MEMBER-001`：仍缺生产 HTTPS 域名、邮件 Relay、发件人域名和专用邮箱真实收件证据。
- 发布门禁：当前工作树尚未形成干净发布提交，因此 `release.json` 如实为 `dirty=true`，正式发布会被拒绝。
- P2：前端主包 570.14 kB，可在外部 P1 等待期间按视图拆分。

### 下一轮优先事项

审查 Git 工作树和远端状态，隔离视频/分析等非发布素材，为全部已验证代码建立可回滚发布提交并生成干净构建；随后再次执行双门禁。不会提交密钥、临时数据库或构建目录。

## 2026-07-22 09:22 CST - 发布源码卫生与可重复质量门

### 本轮完成内容

- 修复生产服务显式禁用默认 Key 文件时仍会回退到开发机凭证路径的问题；空路径现在立即拒绝读取，生产只接受明确配置的凭证文件。
- 本地开发默认路径改为从用户主目录动态计算，源码和文档不再固化个人绝对路径。
- 新增正式 `lint` 与 `typecheck` 命令及 ESLint flat config，使发布标准中的静态质量门可由 CI/运维重复执行。
- 修复迁移脚本错误链丢失和静态检查问题；本地视频、Figma 参考稿与分析缓存明确排除在发布提交之外。
- 按发布白名单暂存代码、测试、运维文档和小型验收截图，并执行提交级敏感信息与文件体积审计。

### 修改文件

- `src/fal/falCredentials.ts`
- `tests/falCredentials.test.ts`
- `scripts/migrate-studio-state.mjs`
- `scripts/migrate-to-sqlite.mjs`
- `scripts/release-preflight-core.mjs`
- `src/assets/assetImageClient.ts`
- `tests/identityService.test.ts`
- `eslint.config.js`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `README.md`
- Fal 多角度设计与计划文档

### 测试和构建结果

- 先以失败测试复现生产凭证路径穿透，再完成最小修复；凭证专项 2 项测试通过。
- `npm run lint` 零错误、零警告；`npm run typecheck` 通过。
- 全量回归：43 个测试文件、392 项测试通过。
- 浏览器与独立 Node 服务双产物构建通过；前端主包 570.14 kB，服务 bundle 124.75 kB。
- `npm audit --omit=dev` 为 0 漏洞；暂存差异 `git diff --cached --check` 通过。
- 127 个发布文件完成白名单审计，最大文件 165 kB；未发现 Fal/OpenAI/AWS Key 形态或个人绝对路径。

### 风险控制

- 失败测试通过注入文件读取器验证，不读取真实凭证；主开发服务 `5173` 未中断。
- `analysis/`、`figma_thesea_slides_15_21/`、`thesea_videos/` 仅加入忽略规则，用户原始素材未删除或移动。
- 未调用付费模型、未发送真实邮件、未公开部署、未写入生产数据。

### 剩余问题

- P1 `USAGE-001`：仍缺具备 Billing Events 权限的生产 Fal Admin Key。
- P1 `MEMBER-001`：仍缺生产 HTTPS 域名、邮件 Relay、发件人域名和专用邮箱真实收件证据。
- 当前构建在提交前按事实标记 `dirty=true`；发布提交后需重新构建并验证 `dirty=false`。
- P2：前端主包 570.14 kB，可继续按视图拆分。

### 下一轮优先事项

形成并推送可回滚发布提交，基于干净 Git 状态重新生成产物，复跑预检与验收报告；外部配置仍未到位时继续处理不依赖真实凭证的 P2 包体拆分。

## 2026-07-22 09:40 CST - 前端视图按需加载与包体告警清零

### 本轮完成内容

- 将全局导航从企业后台视图中拆为轻量同步模块，首页、项目、素材、审核、用量和企业管理仅在首次进入时异步加载。
- 将节点画布与 React Flow 工作台拆为独立视图块；应用外壳、认证和状态恢复无需等待画布代码即可渲染。
- 后台视图首次加载后保持挂载，切回工作台不会丢失其弹窗和表单状态；工作台切换前后继续复用同一 StudioState。
- 新增包体架构回归测试，禁止工作台和企业后台重新变成 `App.tsx` 的静态依赖。

### 修改文件

- `src/App.tsx`
- `src/GlobalNav.tsx`
- `src/SecondaryViews.tsx`
- `src/workbench/Workbench.tsx`
- `tests/bundleArchitecture.test.ts`
- `tests/app.test.tsx`
- `docs/acceptance/evidence/pias-bundle-split-workbench-2026-07-22.png`

### 测试和构建结果

- 先以架构测试复现静态依赖红灯，再完成企业后台与工作台两层异步拆分。
- 聚焦回归：应用、工作台与包体架构 3 个测试文件、87 项测试通过。
- 全量回归：44 个测试文件、393 项测试通过；`npm run lint` 与 `npm run typecheck` 通过。
- 原 570.14 kB 单一主包拆分为：应用壳 257.44 kB、工作台 274.32 kB、企业后台 31.31 kB、图谱共享块 9.11 kB；所有 JS 块低于 500 kB，Vite 包体告警消失。
- 浏览器实测首次工作台加载、切换素材库、返回节点画布均成功；10 个结果节点保持，页面无横向溢出，控制台零错误。
- `npm audit --omit=dev` 为 0 漏洞，截图证据已归档。

### 风险控制

- 拆分只改变代码加载边界，不改变业务命令、权限、持久化和 Fal 调用契约。
- 异步加载期间提供中文状态反馈；加载完成后组件保持挂载，避免导航导致临时界面状态丢失。
- 未调用付费模型、未发送真实邮件、未公开部署或写入生产数据；主开发服务保持运行。

### 剩余问题

- P1 `USAGE-001`：仍缺具备 Billing Events 权限的生产 Fal Admin Key。
- P1 `MEMBER-001`：仍缺生产 HTTPS 域名、邮件 Relay、发件人域名和专用邮箱真实收件证据。
- 当前修改尚需形成干净提交并重新生成 `dirty=false` 发布产物。

### 下一轮优先事项

推送本轮包体优化并重新执行发布报告；随后补齐远端 CI 质量门，使 PR 自动执行 lint、typecheck、全量测试、构建、依赖审计和敏感信息检查，避免发布正确性只依赖本机验收。

## 2026-07-22 09:58 CST - 远端 CI 与仓库卫生硬门禁

### 本轮完成内容

- 新增 GitHub Actions `Release quality` 工作流，在 PR、`main`、`codex/**` 推送及手动触发时执行完整发布质量门。
- 工作流固定 Node.js 24，使用 `npm ci` 和 npm 缓存，串行执行仓库卫生、lint、typecheck、全量测试、双产物构建和生产依赖审计。
- Checkout、Setup Node 与 Upload Artifact 固定到官方完整提交 SHA；Checkout 不保留 Git 凭证，`GITHUB_TOKEN` 仅授予 `contents: read`。
- 同一分支的新运行自动取消旧运行，避免过期提交浪费执行时间；成功产物归档 `dist/`、`dist-server/` 七天。
- 新增本地/CI 共用的 `repo:check`：拒绝跟踪本地分析、视频、构建目录、环境文件、数据库、超过 5 MB 的文件、个人绝对路径及常见密钥形态。
- README 与部署手册同步远端和本地质量门命令，明确 PR 检查与生产双门禁的职责边界。

### 修改文件

- `.github/workflows/release-quality.yml`
- `scripts/repository-hygiene-core.mjs`
- `scripts/repository-hygiene-core.d.mts`
- `scripts/check-repository-hygiene.mjs`
- `tests/repositoryHygiene.test.ts`
- `tests/ciWorkflow.test.ts`
- `package.json`
- `README.md`
- `docs/operations/deployment-runbook.md`

### 测试和构建结果

- 先以缺失扫描器和缺失工作流建立红灯，再实现仓库规则和 CI 契约；2 个专项文件、12 项测试通过。
- `npm run repo:check` 在最终提交上扫描 200 个已跟踪文件，通过且无敏感内容或禁入文件。
- `npm run lint` 与 `npm run typecheck` 通过。
- 全量回归：46 个测试文件、405 项测试通过。
- 前端与独立 Node 服务双产物构建通过，所有 JS 块继续低于 500 kB。
- `npm audit --omit=dev --audit-level=high` 为 0 漏洞。
- GitHub PR 运行 `29884548194` 与分支推送运行 `29884547736` 均在提交 `eb9470d0a5212b517e45f50319d83db673cd04b1` 上通过全部 11 个步骤。
- PR 运行上传发布候选 `pias-release-feb1b6a4bb0ac0f96a1329b0c516a48aa427b2f2`，大小 9,119,225 字节，摘要 `sha256:ba11c283ea626552501174d11a9fc1bc2d4f2f344f269524cb732b8df5910b4f`，保留至 2026-07-29。
- 本地 `dist/release.json` 确认 revision 为 `eb9470d0a5212b517e45f50319d83db673cd04b1` 且 `dirty=false`。

### 风险控制

- CI 不注入 Fal、邮件或生产身份密钥，不执行付费请求、部署、数据库迁移或外部写入。
- 工作流最小权限且固定官方 Action SHA，降低令牌滥用和可变标签供应链风险。
- 仓库扫描只读取 Git 跟踪文件；失败输出仅包含文件路径和稳定错误码，不打印命中的敏感内容。

### 剩余问题

- P1 `USAGE-001`：仍缺具备 Billing Events 权限的生产 Fal Admin Key。
- P1 `MEMBER-001`：仍缺生产 HTTPS 域名、邮件 Relay、发件人域名和专用邮箱真实收件证据。
- P2 `CI-GOV-001`：私有仓库当前套餐不支持分支保护，GitHub API 返回 403；远端检查已生效，但合并前仍可能被仓库管理员绕过。升级 GitHub Pro 或将仓库转为公开后再把 `Lint, test, and build` 设为必需检查。

### 下一轮优先事项

继续审查不依赖生产凭证的部署与供应链风险；外部配置到位后优先完成 Fal Billing Events 对账和真实邀请邮件收件验证。仓库套餐支持分支保护时，将 `Lint, test, and build` 设为合并前必需检查。

## 2026-07-22 10:23 CST - 生产入口安全闭环

### 本轮完成内容

- 为独立 Node 服务增加生产 CSP、HSTS、COOP/CORP、禁止嵌入、`nosniff`、Referrer/Permissions Policy 等统一响应头。
- 所有 `/api/` 默认使用 `Cache-Control: no-store`；内容哈希素材仍由素材路由覆盖为私有不可变缓存。
- 写请求携带的 Origin 必须与 `PIAS_PUBLIC_BASE_URL` 完全一致，`Sec-Fetch-Site: cross-site` 直接拒绝；登录、MFA、组织管理、StudioState 与 Fal JSON 写入只接受 `application/json`。
- 在按邮箱渐进锁定之外增加单实例 20 次/分钟登录总量门，阻断轮换邮箱持续触发同步 scrypt；超限返回稳定 `429` 与 `Retry-After`。
- 固定 Node HTTP 入口预算：完整请求 60 秒、头部 15 秒、Keep-Alive 5 秒、16 KiB/100 个请求头及单连接 1000 次请求。
- README 与部署手册同步反向代理、安全头、Origin、媒体类型、限流和超时约束。

### 修改文件

- `src/server/productionServer.ts`
- `tests/productionServer.test.ts`
- `README.md`
- `docs/operations/deployment-runbook.md`

### 测试和构建结果

- 先以真实独立服务复现三类红灯：安全响应头缺失、认证状态 JSON 未声明禁缓存、轮换邮箱绕过登录成本预算；随后复现跨站 JSON 与 `text/plain` JSON 均被登录端点接受。
- 生产服务聚焦回归 9 项通过；全量回归 46 个测试文件、409 项测试通过。
- `npm run repo:check`、`npm run lint`、`npm run typecheck`、前端与独立 Node 双产物构建全部通过；所有前端 JS 块继续低于 500 kB。
- `npm audit --omit=dev --audit-level=high` 为 0 漏洞。
- 使用临时 SQLite、临时身份与占位密钥启动构建后的独立生产服务；浏览器确认登录页、脚本和样式加载成功，无横向溢出，控制台零错误零警告。

### 风险控制

- Origin 校验只拒绝明确不匹配或浏览器明确标记为跨站的写请求；无 Origin 的同机运维请求仍可执行，现有同源客户端协议不变。
- JSON 媒体类型门不作用于 PNG/JPEG/WebP 素材上传；API 默认禁缓存不覆盖内容哈希素材的私有缓存策略。
- 浏览器验收未使用真实数据库、用户、密钥或域名，未发邮件、未调用 Fal、未公开部署，临时服务已关闭。

### 剩余问题

- P1 `USAGE-001`：仍缺具备 Billing Events 权限的生产 Fal Admin Key。
- P1 `MEMBER-001`：仍缺生产 HTTPS 域名、邮件 Relay、发件人域名和专用邮箱真实收件证据。
- P2 `CI-GOV-001`：私有仓库当前套餐不支持分支保护，远端检查暂不能设为不可绕过的必需项。

### 下一轮优先事项

同步 PR #1 并等待最新远端 CI；外部 P1 仍未就绪时，继续验证请求中止/超大正文处理、反向代理部署样例与恢复演练是否存在可离线修复的发布风险。

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
3. 本机默认文件 `/Users/wangzipeng/Desktop/key.md`

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
- 项目、画布、任务、结果、审核、用量和审计状态通过 revision API 自动保存到服务端单机文件，支持页面刷新与 Vite 服务重启恢复；并发冲突会阻止覆盖并提示重新加载。
- 结果继续派生、提交审核、批准、单图下载，以及用量和审计视图。
- 桌面和平板画布编辑、移动端预览/任务/审核模式。
- PIAS 化妆品演示素材，不引用竞品商标或界面截图。
- 核心领域单元测试、严格模式任务幂等回归测试和四档浏览器响应式验收。

## 当前边界

当前版本用于产品演示、交互验证和后续前后端联调，不是 PRD 第 29 节定义的 Production 完成态。业务状态与 Fal 请求映射已能在单机文件中持久化并跨 Vite 服务重启恢复，但尚未接入事务数据库、备份、多实例一致性和可接管运行中任务的持久 Worker。定向光当前通过通用编辑模型和严格保真提示实现，属于实验能力，建议对品牌字样和材质进行人工复核。尚未接入真实登录/MFA/RBAC、租户隔离、对象存储、持久化任务队列、签名导出、通知和生产审计基础设施。

## 验证

```bash
npm test
npm run build
npm run acceptance:report
```

`npm run acceptance` 是生产发布硬门禁：只在自动化检查通过且 `acceptance/manifest.json` 中所有必选业务证据均为 `pass` 时返回成功。`npm run acceptance:report` 执行相同检查并始终输出完整红黄绿报告，适合整改过程使用。

验收制度、PIAS 实查报告和可复用 Prompt 位于 [`docs/acceptance`](docs/acceptance)。当前 MVP 的生产验收结论以该目录中的项目报告为准。

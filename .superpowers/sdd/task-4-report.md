# Task 4 实施报告

## 变更

- 新增 `src/SecondaryViews.tsx`，承载首页、项目、素材库、审核、用量、企业管理和紧凑图标全局导航。
- 将 `src/App.tsx` 收敛为 state、路由和工作台分支；默认入口为“图片工作台”，该分支只渲染 `Workbench`。
- 保留审核批准、用量和审计数据展示；审核批准后在审核列表开放下载入口。
- 将应用测试改为角色和 aria 名称驱动，覆盖默认节点画布、中文导航、旧英文标签缺失、StrictMode 单次任务和批准后下载开放。

## 实际命令结果

- `npm test -- --run tests/app.test.tsx`：先红灯，现有默认首页缺少“节点画布”，且旧工作台未提供新版工作台行为。
- `npm test -- --run tests/app.test.tsx tests/workbench.test.tsx`：18/18 通过。
- `npm test`：44/44 通过，3 个测试文件全部通过。
- `npm run build`：通过；`tsc -b && vite build` 成功。
- `npm run dev -- --port 5173`：5173 已占用，Vite 启动于 `http://127.0.0.1:5174/`；`curl -I http://127.0.0.1:5174/` 返回 `HTTP/1.1 200 OK`。

## 自检

- 未修改 `src/domain.ts`、`src/workbench/**` 或样式文件。
- 工作台分支不渲染旧 global header，且只传递 `state`、`setState` 给 `Workbench`。
- 全局导航按钮均为图标按钮，具备中文 `aria-label`、`title` 和当前页语义。
- 审核、任务、场景状态均由中文映射呈现；PIAS/SKU 保留。
- `git diff --check` 通过；未还原或暂存工作区内的其他改动。

## 提交

- `553affa feat: localize PIAS application shell`

## Concerns

- 当前 CSS 尚未包含新版 `workbench`、`scene-rail`、`task-tray` 的布局规则；本任务明确不改 styles，视觉布局需由样式任务继续补齐。
- React Flow 在 jsdom 中不会稳定渲染初始结果节点，因此应用级下载断言通过审核列表的语义化下载链接验证；工作台结果按钮与提交回调已有 `tests/workbench.test.tsx` 覆盖。

## 审查修复（2026-07-15）

### 修复内容

- 在 `src/workbench/graph.ts` 集中提供旧操作名中文映射，覆盖 `Generate`、`Blend`、`Directional Light`、`Quick Angle`、`Expand`、`Upscale`、`Remove`、`Extract`；图谱场景数据、由操作名生成的场景标题和派生边标签均在显示边界转换。
- `CanvasNodes.tsx` 使用同一标题转换，避免直接渲染旧场景数据时泄露英文操作名；`SecondaryViews.tsx` 复用该场景标题显示规则。
- 审核列表以来源场景中文标题和 SKU 替代 `sourceSceneId`；用量台账以“任务 01 · 生成”和中文任务状态替代 `job.id`。
- 应用测试以稳定结果标题定位“生成 1”，先断言其无下载入口，再批准并断言仅该目标结果新增下载入口；同时覆盖真实 App 的等待中、生成中、已完成状态流转和内部状态枚举不作为独立文本出现。
- 工作台测试覆盖带 `Directional Light` 的旧派生场景和派生边，以及全部八个旧操作名映射。

### 实际命令结果

- `npm test -- --run tests/app.test.tsx tests/workbench.test.tsx`：红灯确认旧场景节点为 `Directional Light场景`、派生边为英文，审核行显示 `scene-source`；修复后 19/19 通过。
- `npm test`：45/45 通过，3 个测试文件全部通过。
- `npm run build`：通过；`tsc -b && vite build` 成功。
- `git diff --check` 与 `git diff --cached --check`：通过。

### 提交

- `7e9495b fix: close PIAS task 4 review gaps`

### Concerns

- Git 在提交时提示历史遗留的 `.git/gc.log` 与不可达松散对象；提交已成功，未在本任务中执行清理或破坏性 Git 操作。

## 第二轮小修（2026-07-15）

### 修复内容

- `SceneRail` 的场景可见标题和 `aria-label` 统一调用 `getSceneTitle(scene)`；legacy `Directional Light场景` 现在显示为“定向光场景”。
- 首页“最近操作”的审计对象根据当前 state 解析为中文任务编号与工具名、场景中文标题与 SKU 或结果标题；未知对象统一显示“操作对象”，不再回退 `event.targetId`。
- 新增场景栏 legacy 标题组件回归测试、首页导航后的内部 ID 隐藏测试和未知对象兜底测试。

### 实际命令结果

- `npm test -- --run tests/app.test.tsx tests/workbench.test.tsx`：22/22 通过。
- `npm test`：48/48 通过，3 个测试文件全部通过。
- `npm run build`：通过；`tsc -b && vite build` 成功。

### Concerns

- 未修改 `src/workbench/graph.ts`；复用现有 `getSceneTitle` 导出即可完成本轮修复。
- 未触及样式文件；视觉布局仍属于后续任务范围。

# PIAS Soft Glass UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的 Soft Industrial Glass 设计系统落地到 PIAS 全部页面和工作台组件，同时保持现有节点、Fal、审核与导出功能不变。

**Architecture:** 保留 `src/styles.css` 的现有布局与响应式基础，新增独立 `src/design-tokens.css` 管理字体、颜色、间距、圆角、阴影和动效令牌，新增 `src/soft-glass.css` 在原样式之后覆盖全组件外观与交互状态。只有字体导入需要修改 `src/main.tsx`；功能组件不做无关重构。

**Tech Stack:** React 19、TypeScript 5.8、Vite 7、React Flow、Lucide、CSS `backdrop-filter`、`@fontsource-variable/manrope` 5.3.0、`@fontsource-variable/noto-sans-sc` 5.3.0、Vitest、Browser QA。

## Global Constraints

- 使用 Graphite Mineral 深色主题，不增加紫色、紫蓝渐变、装饰光球或霓虹发光。
- 采用 4px 间距网格和 `6 / 8 / 10 / 14 / 16 / 20px` 圆角层级。
- 玻璃仅用于导航、工具和临时浮层；节点、图片、表格和内容卡保持高不透明度。
- 不改变现有中文文案、ARIA 标签、节点操作路径、Fal 参数和任务状态机。
- 所有动效支持 `prefers-reduced-motion`，所有玻璃支持无 `backdrop-filter` 的实色回退。
- 桌面、平板和 390px 移动端不得出现重叠、横向溢出或文字遮挡。

---

### Task 1: Fonts And Design Tokens

**Files:**
- Create: `src/design-tokens.css`
- Modify: `src/main.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: CSS custom properties `--neutral-*`, `--surface-*`, `--color-*-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--duration-*`, `--ease-*` consumed by Task 2-5.

- [ ] **Step 1: Install local variable fonts**

Run:

```bash
npm install @fontsource-variable/manrope@5.3.0 @fontsource-variable/noto-sans-sc@5.3.0
```

Expected: `package.json` and lockfile contain both exact 5.3.0 dependencies.

- [ ] **Step 2: Import fonts and visual layers after legacy styles**

Add to `src/main.tsx`:

```ts
import '@fontsource-variable/manrope';
import '@fontsource-variable/noto-sans-sc';
import './styles.css';
import './design-tokens.css';
import './soft-glass.css';
```

- [ ] **Step 3: Define exact tokens**

Create `src/design-tokens.css` with the design compass values and base rules:

```css
:root {
  --neutral-950: #07090c;
  --neutral-900: #0b0e12;
  --neutral-850: #10141a;
  --neutral-800: #151a21;
  --neutral-750: #1b212a;
  --neutral-700: #242b35;
  --neutral-650: #303946;
  --neutral-500: #687384;
  --neutral-400: #9099a8;
  --neutral-300: #b9c0cc;
  --neutral-100: #f2f4f7;
  --color-primary-foreground: #65a0ff;
  --color-primary-solid: #2866d8;
  --color-primary-solid-hover: #225cc6;
  --color-primary-subtle: rgb(76 141 255 / 14%);
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-xs: 6px;
  --radius-sm: 8px;
  --radius-control: 10px;
  --radius-md: 14px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --duration-fast: 100ms;
  --duration-control: 140ms;
  --duration-panel: 220ms;
  --ease-out: cubic-bezier(.2, .8, .2, 1);
}
```

- [ ] **Step 4: Verify compile and font assets**

Run: `npm run build`

Expected: build exits 0 and output contains local Manrope/Noto font assets.

### Task 2: Global Shell And Secondary Pages

**Files:**
- Create: `src/soft-glass.css`
- Modify: `src/soft-glass.css`

**Interfaces:**
- Consumes: all tokens from `src/design-tokens.css`.
- Produces: complete styles for `.app-frame`, `.nav-rail`, `.global-header`, `.page-surface`, `.overview-grid`, `.kpi-card`, `.wide-table`, `.project-row`, `.catalog-card`, `.review-row`, `.usage-ledger`, buttons and data rows.

- [ ] **Step 1: Build global shell surfaces**

Implement token-based selectors:

```css
.nav-rail,
.global-header,
.workbench-topbar,
.scene-rail {
  background: var(--surface-chrome);
  border-color: var(--stroke-subtle);
  backdrop-filter: blur(var(--blur-chrome)) saturate(115%);
  box-shadow: var(--highlight-inset);
}

.nav-rail nav button,
.secondary-action,
.icon-button {
  border-radius: var(--radius-control);
  transition: background-color var(--duration-fast), color var(--duration-fast), transform var(--duration-fast);
}
```

- [ ] **Step 2: Restyle all secondary data components**

Apply `--radius-md`, `--surface-content`, 4px-grid padding, restrained semantic color and fixed rows to KPI, tables, projects, catalog, review and usage components. Avoid wrapping `.page-surface` as a floating card.

- [ ] **Step 3: Verify secondary pages remain functional**

Run: `npm test -- --run tests/app.test.tsx`

Expected: all app navigation, review and export tests pass.

### Task 3: Workbench Shell And Form Controls

**Files:**
- Modify: `src/soft-glass.css`

**Interfaces:**
- Produces: styles for scene rail, asset items, tool palette, command bar, controls, minimap, node picker, parameter panel, asset picker and every form control.

- [ ] **Step 1: Apply functional glass to workbench chrome**

Use L2 glass for `.workbench-topbar` and `.scene-rail`; L3 glass for `.tool-palette`, `.canvas-command-bar`, `.context-panel`, `.asset-picker`, `.node-type-picker`, `.task-tray` and `.react-flow__controls`.

- [ ] **Step 2: Normalize controls**

```css
.context-panel textarea,
.context-panel select,
.context-panel input,
.asset-picker input {
  border: 1px solid var(--stroke-default);
  border-radius: var(--radius-control);
  background: var(--surface-input);
  color: var(--text-primary);
}

button:active:not(:disabled) {
  transform: translateY(1px) scale(.98);
}
```

Cover text inputs, textarea, select, slider, segmented controls, ratio, count, toggle, reference slot, anchor grid, mask status, primary/secondary/danger/icon buttons.

- [ ] **Step 3: Verify workbench interactions**

Run: `npm test -- --run tests/workbench.test.tsx tests/interactionMachine.test.ts`

Expected: node creation, tool panels, overlays, masks, jobs and viewport tests pass.

### Task 4: Nodes, Results And Production Feedback

**Files:**
- Modify: `src/soft-glass.css`

**Interfaces:**
- Produces: distinct scene/job/result/draft node skins, handles, edges, decision actions, overlays, task tray, compare tray/dialog, inspector, export and node command dialogs.

- [ ] **Step 1: Restyle nodes as stable content surfaces**

```css
.canvas-node {
  border: 1px solid var(--stroke-default);
  border-radius: var(--radius-md);
  background: var(--surface-content);
  box-shadow: var(--shadow-contact);
}

.canvas-node.is-selected,
.react-flow__node.selected .canvas-node {
  border-color: var(--stroke-focus);
  box-shadow: var(--shadow-contact), var(--ring-selected);
  transform: translateY(-2px);
}

.react-flow__node.dragging .canvas-node {
  transition: none;
  transform: scale(1.015);
}
```

- [ ] **Step 2: Restyle production overlays and feedback**

Cover light, expand, angle and remove overlays; task rows; result compare; result inspector; export, rename, delete dialogs; status chips; progress; Toast; focus rings.

- [ ] **Step 3: Verify result and delivery behavior**

Run: `npm test -- --run tests/workbench.test.tsx tests/exportDelivery.test.ts tests/domain.test.ts`

Expected: all result, review, export and task state tests pass.

### Task 5: Motion, Responsive And Accessibility Fallbacks

**Files:**
- Modify: `src/soft-glass.css`

**Interfaces:**
- Produces: consistent motion timings, desktop/tablet/mobile adaptations, reduced-motion, contrast and backdrop-filter fallbacks.

- [ ] **Step 1: Add purposeful motion**

Implement 100-140ms control feedback, 180ms menu entry, 220ms panel entry, 280ms node result entry and no transition while dragging. No infinite decorative animation.

- [ ] **Step 2: Add fallbacks**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: .01ms !important;
  }
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .context-panel,
  .tool-palette,
  .task-tray { background: var(--surface-modal); }
}
```

- [ ] **Step 3: Finish responsive rules**

Validate 1236x671, 900x900, 768x1024 and 390x844. Keep node editing desktop/tablet only; mobile remains result-oriented. Ensure one L3/L4 overlay maximum on mobile.

- [ ] **Step 4: Run full engineering verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: 0 failed tests, build exit 0, no whitespace errors.

### Task 6: Visual QA And Final Review

**Files:**
- Create: `docs/screenshots/soft-glass-ui/desktop.jpg`
- Create: `docs/screenshots/soft-glass-ui/panel.jpg`
- Create: `docs/screenshots/soft-glass-ui/nodes.jpg`
- Create: `docs/screenshots/soft-glass-ui/mobile.jpg`
- Modify: CSS files only when screenshot review finds a concrete issue.

**Interfaces:**
- Consumes: final running UI at `http://127.0.0.1:5173/`.
- Produces: browser-verified evidence for hierarchy, glass restraint, control states, responsive layout and Fal workflow preservation.

- [ ] **Step 1: Start or reuse local server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: localhost responds 200.

- [ ] **Step 2: Capture desktop and mobile states**

Use Browser to verify global pages, open the workbench parameter panel, inspect node Hover/Selected, task tray, result details and 390px mobile preview. Save screenshots under `docs/screenshots/soft-glass-ui/`.

- [ ] **Step 3: Review against the compass**

Check: canvas remains primary; no glass-on-glass; radius hierarchy is visible; text fits; panels do not overlap nodes incoherently; motion is short and direct; mobile has no overflow.

- [ ] **Step 4: Fix findings and repeat full verification**

After any CSS fix, rerun `npm test`, `npm run build`, browser screenshots and `git diff --check` before final commit.

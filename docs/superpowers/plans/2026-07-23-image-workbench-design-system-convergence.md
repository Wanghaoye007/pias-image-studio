# Image Workbench Design System Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the image workbench's stretched, cascade-dependent tool panels with one measurable Header/Body/Footer system while preserving every existing image-task behavior.

**Architecture:** `ContextToolPanel` becomes a task-capability orchestrator. New focused components own panel geometry, shared controls, and generation actions; a dedicated stylesheet owns their visual contract. Legacy panel selectors are mechanically removed from `soft-glass.css`, then component tests and Playwright geometry checks verify all eight tools.

**Tech Stack:** React 19, TypeScript 5.8, native CSS, Vitest, Testing Library, Playwright Core, Vite 7

## Global Constraints

- Do not add image, video, avatar, short-drama, or other business features.
- Do not change task parameters, Fal workflow plans, usage charging, review, export, persistence, authentication, or authorization behavior.
- Keep the right tool editor docked full-height on desktop; only its Body scrolls.
- Ordinary Modals remain content-sized and scroll only after `calc(100dvh - 48px)`.
- Use spacing values `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, and `48px` only in migrated components.
- Use control heights `40px` and `48px` only in migrated components.
- Keep all visible copy in Chinese and make each primary button's accessible name equal its visible label.
- Preserve the user-owned untracked files `src/App.tsx`, `src/SecondaryViews.tsx`, `src/exportDelivery.ts`, and `src/main.tsx`; never stage, modify, or delete them.
- Use TDD for each task and keep commits scoped to the task that introduces the behavior.

---

## File Structure

### New files

- `src/client/workbench/ToolPanelShell.tsx`: owns semantic Header/Body/Footer regions, Escape handling, initial focus, and close button.
- `src/client/workbench/PanelControls.tsx`: owns shared segmented, output, ratio, range, switch, section, and empty-state controls.
- `src/client/workbench/GenerationFooter.tsx`: owns reset, output, ratio, credit, validation, submitting, and primary-action slots.
- `src/client/styles/workbench-panels.css`: sole owner of tool-panel shell, shared control, shared Footer, and responsive Sheet geometry.
- `src/client/styles/dialog-system.css`: sole visual owner of ordinary content-sized dialogs and their Header/Body/Footer spacing.
- `tests/contextToolPanel.test.tsx`: direct eight-tool behavior contract tests.
- `tests/dialogSystem.test.tsx`: direct upload/export Modal structure and interaction tests.

### Modified files

- `src/client/workbench/ContextToolPanel.tsx`: task capability map and tool-specific Body composition.
- `src/client/workbench/Workbench.tsx`: canonical panel selector for focus management.
- `src/client/workbench/AdvancedToolEditors.tsx`: advanced editor class names and section composition only; parameter callbacks remain unchanged.
- `src/client/styles/design-tokens.css`: canonical spacing, Surface, radius, type, and control-size tokens.
- `src/client/styles/soft-glass.css`: remove legacy panel/control/Footer selectors after migration.
- `src/client/main.tsx`: import the canonical panel stylesheet.
- `tests/app.test.tsx`: reject legacy panel selectors and assert stylesheet ownership.
- `tests/workbench.test.tsx`: update button names and preserve queue/submission interaction coverage.
- `scripts/image-mvp-e2e.mjs`: add eight-tool interaction and geometry matrix plus stable screenshots.
- `docs/acceptance/图片工作台MVP发布前收口_2026-07-23.md`: record final visual and automated evidence.

---

### Task 1: Lock the Eight-Tool Component Contract

**Files:**
- Create: `tests/contextToolPanel.test.tsx`
- Modify: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: existing `ContextToolPanelProps` callbacks and `TaskProfileId` values.
- Produces: failing tests for `data-panel-region`, shared Footer behavior, tool-specific labels, focus, validation, and one-shot submission.

- [ ] **Step 1: Add a reusable direct-render harness**

Create `tests/contextToolPanel.test.tsx` with explicit defaults and callback spies:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskProfileId } from '../src/shared/domain';
import { ContextToolPanel } from '../src/client/workbench/ContextToolPanel';

function renderPanel(tool: TaskProfileId, overrides = {}) {
  const callbacks = {
    onPromptChange: vi.fn(),
    onOutputCountChange: vi.fn(),
    onRatioChange: vi.fn(),
    onParameterChange: vi.fn(),
    onReferenceAssetChange: vi.fn(),
    onAssetPickerOpen: vi.fn(),
    onAssetPickerClose: vi.fn(),
    onClearRemoveMask: vi.fn(),
    onClose: vi.fn(),
    onRun: vi.fn(),
  };
  render(
    <ContextToolPanel
      assets={[]}
      availableCredits={2_000}
      hasRemoveMask={tool !== 'remove'}
      outputCount={1}
      parameters={{}}
      previewImageUrl="/demo.png"
      prompt=""
      ratio="1:1"
      referenceAssetId={tool === 'blend' ? 'asset-reference' : ''}
      tool={tool}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}
```

- [ ] **Step 2: Add structural and label matrix tests**

Use the exact labels agreed in the specification:

```tsx
const cases = [
  ['generate', '生成参数', '开始生成'],
  ['blend', '融图参数', '开始融图'],
  ['angle', '多角度参数', '生成视角'],
  ['light', '修改光影参数', '生成光影修改'],
  ['remove', '去除参数', '开始去除'],
  ['extract', '抠图参数', '开始抠图'],
  ['expand', '扩图参数', '开始扩图'],
  ['upscale', '超分参数', '开始超分'],
] as const;

it.each(cases)('%s uses the shared three-region panel', (tool, dialogName, actionName) => {
  renderPanel(tool);
  const panel = screen.getByRole('dialog', { name: dialogName });
  expect(panel.querySelector('[data-panel-region="header"]')).toBeTruthy();
  expect(panel.querySelector('[data-panel-region="body"]')).toBeTruthy();
  expect(panel.querySelector('[data-panel-region="footer"]')).toBeTruthy();
  expect(within(panel).getByRole('button', { name: actionName })).toBeVisible();
});
```

- [ ] **Step 3: Add interaction tests for all shared control types**

Cover segmented buttons, ratio, range, reset, close, Escape, disabled reasons, and one-shot submission:

```tsx
it('keeps output, ratio, parameter, close, and run callbacks functional', () => {
  const callbacks = renderPanel('expand');
  fireEvent.click(screen.getByRole('button', { name: '4' }));
  fireEvent.change(screen.getByRole('combobox', { name: '画面比例' }), { target: { value: '4:5' } });
  fireEvent.change(screen.getByRole('slider', { name: '原图缩放' }), { target: { value: '64' } });
  fireEvent.click(screen.getByRole('button', { name: '开始扩图' }));
  expect(callbacks.onOutputCountChange).toHaveBeenCalledWith(4);
  expect(callbacks.onRatioChange).toHaveBeenCalledWith('4:5');
  expect(callbacks.onParameterChange).toHaveBeenCalledWith('expandScale', 64);
  expect(callbacks.onRun).toHaveBeenCalledTimes(1);
});

it('explains why remove cannot run without a mask', () => {
  renderPanel('remove', { hasRemoveMask: false });
  expect(screen.getByRole('button', { name: '开始去除' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('请先在图片上涂抹要去除的区域');
});
```

- [ ] **Step 4: Run the new tests and confirm RED**

Run:

```bash
npm test -- --run tests/contextToolPanel.test.tsx tests/workbench.test.tsx
```

Expected: new tests fail because `data-panel-region` and task-specific accessible names do not exist.

- [ ] **Step 5: Commit the failing contract tests**

```bash
git add tests/contextToolPanel.test.tsx tests/workbench.test.tsx
git commit -m "test: define tool panel design-system contract"
```

---

### Task 2: Build the Shared Panel and Control Primitives

**Files:**
- Create: `src/client/workbench/ToolPanelShell.tsx`
- Create: `src/client/workbench/PanelControls.tsx`
- Create: `src/client/workbench/GenerationFooter.tsx`
- Test: `tests/contextToolPanel.test.tsx`

**Interfaces:**
- Produces: `ToolPanelShell`, `PanelSection`, `SegmentedControl`, `OutputSelector`, `AspectRatioControl`, `RangeControl`, `SwitchControl`, `GenerationFooter`, and `GenerationFooterProps`.
- Consumes: React nodes, refs, and callback functions only; no domain or Fal service imports in `ToolPanelShell`.

- [ ] **Step 1: Implement `ToolPanelShell`**

Create the shell with explicit semantic regions and initial-focus behavior:

```tsx
import { X } from 'lucide-react';
import { useEffect, type ReactNode, type RefObject } from 'react';

export type ToolPanelShellProps = {
  ariaLabel: string;
  eyebrow?: string;
  title: string;
  toolId: string;
  body: ReactNode;
  footer: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onEscape?: () => void;
};

export function ToolPanelShell(props: ToolPanelShellProps) {
  useEffect(() => { props.initialFocusRef?.current?.focus(); }, [props.initialFocusRef]);
  return (
    <section
      aria-label={props.ariaLabel}
      className="tool-panel"
      data-tool={props.toolId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        (props.onEscape ?? props.onClose)();
      }}
      role="dialog"
    >
      <header data-panel-region="header" className="tool-panel__header">
        <div><small>{props.eyebrow ?? '图片处理'}</small><strong>{props.title}</strong></div>
        <button aria-label="关闭参数面板" onClick={props.onClose} title="关闭参数面板" type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <div data-panel-region="body" className="tool-panel__body">{props.body}</div>
      <div data-panel-region="footer" className="tool-panel__footer">{props.footer}</div>
    </section>
  );
}
```

- [ ] **Step 2: Implement shared controls**

Create typed components in `PanelControls.tsx`. Use native inputs and exact class names:

```tsx
export function OutputSelector({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div aria-label="输出数量" className="panel-output-selector" role="group">
      <span>输出</span>
      {[1, 2, 4].map((count) => (
        <button aria-pressed={count === value} key={count} onClick={() => onChange(count)} type="button">
          {count}
        </button>
      ))}
    </div>
  );
}

export function AspectRatioControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="panel-ratio-control">
      <span>比例</span>
      <select aria-label="画面比例" onChange={(event) => onChange(event.target.value)} value={value}>
        {['1:1', '4:5', '3:4', '4:3', '16:9', '9:16'].map((ratio) => (
          <option key={ratio} value={ratio}>{ratio}</option>
        ))}
      </select>
    </label>
  );
}
```

Also export `PanelSection`, `PanelEmptyState`, `SegmentedControl`, `RangeControl`, and `SwitchControl` with labels above controls, `aria-pressed` for segmented choices, native checkbox state for switches, and a minimum 40px interactive area.

- [ ] **Step 3: Implement the shared `GenerationFooter`**

Create a stable information row and action row:

```tsx
export type GenerationFooterProps = {
  actionLabel: string;
  estimate: number;
  disabled?: boolean;
  disabledReason?: string;
  submitting?: boolean;
  outputCount?: number;
  ratio?: string;
  showOutput?: boolean;
  showRatio?: boolean;
  onOutputCountChange: (count: number) => void;
  onRatioChange: (ratio: string) => void;
  onRun: () => void;
  onReset?: () => void;
  primaryRef?: RefObject<HTMLButtonElement | null>;
};

export function GenerationFooter(props: GenerationFooterProps) {
  return (
    <footer className="generation-footer">
      <div className="generation-footer__settings">
        {props.onReset && <button className="generation-footer__reset" onClick={props.onReset} type="button">重置参数</button>}
        {props.showOutput && <OutputSelector value={props.outputCount ?? 1} onChange={props.onOutputCountChange} />}
        {props.showRatio && <AspectRatioControl value={props.ratio ?? '1:1'} onChange={props.onRatioChange} />}
        <span className="generation-footer__credit">预计 {props.estimate} 点</span>
      </div>
      {props.disabledReason && <p role="alert">{props.disabledReason}</p>}
      <button
        className="generation-footer__run"
        disabled={props.disabled}
        onClick={props.onRun}
        ref={props.primaryRef}
        type="button"
      >
        {props.submitting ? '正在提交' : props.actionLabel}
      </button>
    </footer>
  );
}
```

- [ ] **Step 4: Add focused primitive tests**

Render primitives directly and assert initial focus, Escape, `aria-pressed`, Reset, ratio change, disabled reason, and exact accessible button label.

- [ ] **Step 5: Run primitive tests**

```bash
npm test -- --run tests/contextToolPanel.test.tsx
```

Expected: primitive tests pass; tool matrix remains RED until migration.

- [ ] **Step 6: Commit shared primitives**

```bash
git add src/client/workbench/ToolPanelShell.tsx src/client/workbench/PanelControls.tsx src/client/workbench/GenerationFooter.tsx tests/contextToolPanel.test.tsx
git commit -m "feat: add shared tool panel primitives"
```

---

### Task 3: Migrate Generate, Blend, Remove, Extract, Expand, and Upscale

**Files:**
- Modify: `src/client/workbench/ContextToolPanel.tsx`
- Modify: `src/client/workbench/Workbench.tsx`
- Test: `tests/contextToolPanel.test.tsx`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: shared primitives from Task 2 and existing callback props.
- Produces: six standard tools using `ToolPanelShell` and `GenerationFooter` with unchanged domain inputs.

- [ ] **Step 1: Define a standard tool capability map**

Keep display and Footer behavior declarative:

```tsx
const toolCapabilities = {
  generate: { actionLabel: '开始生成', showOutput: true, showRatio: true, prompt: true },
  blend: { actionLabel: '开始融图', showOutput: true, showRatio: true, prompt: false },
  remove: { actionLabel: '开始去除', showOutput: false, showRatio: false, prompt: false },
  extract: { actionLabel: '开始抠图', showOutput: false, showRatio: false, prompt: false },
  expand: { actionLabel: '开始扩图', showOutput: true, showRatio: true, prompt: true },
  upscale: { actionLabel: '开始超分', showOutput: false, showRatio: false, prompt: false },
} as const;
```

- [ ] **Step 2: Move standard Body controls to shared components**

Replace local `SegmentedOptions`, `RangeControl`, and `BooleanControl` with imports from `PanelControls.tsx`. Wrap each logical group in `PanelSection`. Render the extract Body explicitly:

```tsx
if (tool === 'extract') {
  return (
    <PanelEmptyState
      description="将自动识别主体并输出透明背景图片"
      title="无需额外参数"
    />
  );
}
```

- [ ] **Step 3: Compute explicit disabled reasons**

Use one function without changing existing eligibility:

```tsx
function getDisabledReason(props: ContextToolPanelProps, estimate: number): string | undefined {
  if (props.isSubmitting) return undefined;
  if (props.tool === 'remove' && !props.hasRemoveMask) return '请先在图片上涂抹要去除的区域';
  if (props.tool === 'blend' && !props.referenceAssetId) return '请选择参考素材';
  if (estimate > props.availableCredits) return '可用额度不足';
  return undefined;
}
```

- [ ] **Step 4: Compose standard tools with the shared shell**

Use a `promptRef` for prompt tools, the reference button for blend, and `primaryRef` for extract. Preserve asset-picker Escape precedence:

```tsx
return (
  <ToolPanelShell
    ariaLabel={`${profile.label}参数`}
    body={body}
    footer={<GenerationFooter {...footerProps} />}
    initialFocusRef={initialFocusRef}
    onClose={props.onClose}
    onEscape={() => props.assetPickerOpen ? props.onAssetPickerClose?.() : props.onClose()}
    title={profile.label}
    toolId={props.tool}
  />
);
```

- [ ] **Step 5: Update Workbench focus selector and button-name assertions**

Change `.context-panel` to `.tool-panel` in `Workbench.tsx`. Update tests to query `开始融图`, `开始超分`, `开始去除`, and other visible labels instead of the old generic `aria-label="开始生成"`.

- [ ] **Step 6: Run standard tool tests and confirm GREEN**

```bash
npm test -- --run tests/contextToolPanel.test.tsx tests/workbench.test.tsx
```

Expected: six standard tool cases pass; light and angle cases remain RED.

- [ ] **Step 7: Commit standard migration**

```bash
git add src/client/workbench/ContextToolPanel.tsx src/client/workbench/Workbench.tsx tests/contextToolPanel.test.tsx tests/workbench.test.tsx
git commit -m "refactor: migrate standard image tool panels"
```

---

### Task 4: Migrate Light and Angle Without Changing Parameters

**Files:**
- Modify: `src/client/workbench/ContextToolPanel.tsx`
- Modify: `src/client/workbench/AdvancedToolEditors.tsx`
- Test: `tests/contextToolPanel.test.tsx`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: `LightEditor`, `AngleEditor`, `GenerationFooter`, and existing `onParameterChange` callback.
- Produces: advanced editors inside the same Body/Footer contract as standard tools.

- [ ] **Step 1: Add reset-behavior tests before migration**

For light, assert `lightDirection=front`, `lightIntensity=50`, `lightTemperature=5200`, `lightSmartMode=false`, and `rimLight=false`. For angle, assert `horizontalAngle=-45`, `moveForward=0`, `verticalView=-0.7`, and `wideAngle=false`. Both reset Prompt to an empty string.

- [ ] **Step 2: Extract reset callbacks without changing values**

Implement `resetAdvancedParameters(tool, onParameterChange, onPromptChange)` using the exact values above. Do not change the clamping logic in `AdvancedToolEditors.tsx`.

- [ ] **Step 3: Place advanced editors in `ToolPanelShell` Body**

Use titles `修改光影` and `多角度`, retain risk notices already rendered by the editor, and pass `GenerationFooter` these capabilities:

```tsx
const advancedFooter = {
  light: { actionLabel: '生成光影修改', showOutput: true, showRatio: false },
  angle: { actionLabel: '生成视角', showOutput: true, showRatio: true },
} as const;
```

- [ ] **Step 4: Remove `AdvancedEditorFooter`**

Delete the duplicated component from `ContextToolPanel.tsx`. Keep all preview, pointer, preset, Slider, Switch, and angle-clamping callbacks in `AdvancedToolEditors.tsx` intact.

- [ ] **Step 5: Run advanced editor and Workbench tests**

```bash
npm test -- --run tests/contextToolPanel.test.tsx tests/workbench.test.tsx tests/falMultipleAngles.test.ts
```

Expected: all eight tool cases, reset behavior, and Fal angle constraints pass.

- [ ] **Step 6: Commit advanced migration**

```bash
git add src/client/workbench/ContextToolPanel.tsx src/client/workbench/AdvancedToolEditors.tsx tests/contextToolPanel.test.tsx tests/workbench.test.tsx
git commit -m "refactor: unify advanced image tool panels"
```

---

### Task 5: Establish the Canonical Panel Styles and Remove Legacy Cascade

**Files:**
- Create: `src/client/styles/workbench-panels.css`
- Modify: `src/client/styles/design-tokens.css`
- Modify: `src/client/styles/soft-glass.css`
- Modify: `src/client/main.tsx`
- Test: `tests/app.test.tsx`

**Interfaces:**
- Produces: canonical `.tool-panel`, `.panel-*`, and `.generation-footer` styles.
- Removes: `.context-panel`, `.advanced-editor-footer`, `.segmented`, `.range-control`, `.toggle-control`, `.reference-slot`, `.remove-mask-status`, `.credit-estimate`, and `.angle-risk` selectors from `soft-glass.css`.

- [ ] **Step 1: Write CSS ownership tests and confirm RED**

Add assertions:

```tsx
const panelStyles = readFileSync(`${process.cwd()}/src/client/styles/workbench-panels.css`, 'utf8');
const softGlass = readFileSync(`${process.cwd()}/src/client/styles/soft-glass.css`, 'utf8');

expect(panelStyles).toMatch(/\.tool-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
expect(panelStyles).toMatch(/\.tool-panel__body\s*\{[^}]*align-content:\s*start;[^}]*overflow-y:\s*auto;/s);
expect(panelStyles).toMatch(/\.tool-panel__footer\s*\{[^}]*padding:\s*16px 24px 24px;/s);
expect(panelStyles).toMatch(/\.generation-footer__run\s*\{[^}]*height:\s*48px;/s);
expect(softGlass).not.toMatch(/\.(context-panel|advanced-editor-footer|segmented|range-control|toggle-control|reference-slot|remove-mask-status|credit-estimate|angle-risk)/);
```

- [ ] **Step 2: Add canonical design tokens**

Add exact tokens to `design-tokens.css`:

```css
--surface-canvas: #0b0e12;
--surface-panel: #15191f;
--surface-section: #1b2028;
--surface-raised: #242a34;
--radius-section: 12px;
--radius-modal: 16px;
--control-sm: 40px;
--control-md: 48px;
```

Map existing aliases to these values rather than adding another visual palette.

- [ ] **Step 3: Create `workbench-panels.css`**

Implement the layout contract:

```css
.tool-panel {
  position: absolute;
  z-index: 80;
  inset: 0 0 0 auto;
  width: 360px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border-left: 1px solid var(--stroke-default);
  color: var(--text-primary);
  background: var(--surface-panel);
  box-shadow: -18px 0 48px rgb(0 0 0 / 28%);
}

.tool-panel__header {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
  border-bottom: 1px solid var(--stroke-subtle);
}

.tool-panel__body {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 24px;
  padding: 24px;
  overflow-x: hidden;
  overflow-y: auto;
}

.tool-panel__footer {
  min-width: 0;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--stroke-subtle);
  background: var(--surface-panel);
}

.generation-footer__run {
  width: 100%;
  height: 48px;
  border-radius: var(--radius-control);
}
```

Add the full shared-control states, 396/360/320 width breakpoints, and a `<768px` full-screen Sheet. Set advanced-editor grids to one column within the docked Body and never hide light or angle with `display:none`.

- [ ] **Step 4: Import the canonical stylesheet**

In `src/client/main.tsx`, import it after `soft-glass.css`:

```ts
import './styles/soft-glass.css';
import './styles/workbench-panels.css';
```

- [ ] **Step 5: Mechanically remove legacy selectors from `soft-glass.css`**

Use PostCSS only as a one-time structured rewrite. Remove a rule when all selectors are legacy; otherwise retain only non-legacy selectors:

```bash
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import postcss from 'postcss';

const path = 'src/client/styles/soft-glass.css';
const legacy = [
  '.context-panel', '.advanced-editor-footer', '.segmented', '.range-control',
  '.toggle-control', '.reference-slot', '.remove-mask-status', '.credit-estimate', '.angle-risk',
];
const root = postcss.parse(readFileSync(path, 'utf8'));
root.walkRules((rule) => {
  const kept = rule.selectors.filter((selector) => !legacy.some((fragment) => selector.includes(fragment)));
  if (kept.length === 0) rule.remove();
  else rule.selectors = kept;
});
root.walkAtRules('media', (rule) => { if (rule.nodes?.length === 0) rule.remove(); });
writeFileSync(path, root.toString());
NODE
```

Review `git diff -- src/client/styles/soft-glass.css` and confirm unrelated selectors remain unchanged.

- [ ] **Step 6: Run CSS, component, and build checks**

```bash
npm test -- --run tests/app.test.tsx tests/contextToolPanel.test.tsx tests/workbench.test.tsx
npm run typecheck
npm run lint
npm run build
```

Expected: all commands pass; the built stylesheet contains canonical panel classes and no legacy panel classes.

- [ ] **Step 7: Commit canonical styling and cleanup**

```bash
git add src/client/styles/design-tokens.css src/client/styles/workbench-panels.css src/client/styles/soft-glass.css src/client/main.tsx tests/app.test.tsx
git commit -m "refactor: consolidate image workbench panel styles"
```

---

### Task 6: Converge Ordinary Modal Geometry

**Files:**
- Create: `src/client/styles/dialog-system.css`
- Create: `tests/dialogSystem.test.tsx`
- Modify: `src/client/styles/soft-glass.css`
- Modify: `src/client/main.tsx`
- Modify: `tests/app.test.tsx`
- Test: `tests/app.test.tsx`

**Interfaces:**
- Produces: content-sized upload, organization, review-decision, export, and node-command dialogs with one Body scroll boundary.
- Excludes: `result-compare-dialog`, because image comparison is a genuine full-viewport tool rather than an ordinary Modal.

- [ ] **Step 1: Add failing Modal ownership tests**

Read `dialog-system.css` and assert the shared maximum height, safe padding, Body scroll, and Footer spacing. Also reject the migrated dialog selectors in `soft-glass.css`:

```tsx
const dialogs = readFileSync(`${process.cwd()}/src/client/styles/dialog-system.css`, 'utf8');
const softGlass = readFileSync(`${process.cwd()}/src/client/styles/soft-glass.css`, 'utf8');

expect(dialogs).toMatch(/\.asset-upload-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 48px\);/s);
expect(dialogs).toMatch(/\.asset-upload-dialog__body\s*\{[^}]*padding:\s*24px;[^}]*overflow-y:\s*auto;/s);
expect(dialogs).toMatch(/\.asset-upload-dialog > footer\s*\{[^}]*padding:\s*16px 24px 24px;/s);
expect(dialogs).toMatch(/\.node-command-dialog\s*\{[^}]*height:\s*auto;/s);
expect(dialogs).not.toMatch(/\.result-compare-dialog/);
expect(softGlass).not.toMatch(/\.(asset-upload-dialog|organization-dialog|review-decision-dialog|node-command-dialog|export-dialog)/);
```

Run `npm test -- --run tests/app.test.tsx` and confirm RED because the canonical file does not exist.

Create `tests/dialogSystem.test.tsx`, render `AssetUploadDialog` and `ExportDialog` directly, and assert their Header, Body, Footer, close, form-control, disabled, and submit behavior remains functional:

```tsx
it('keeps upload dialog controls and close behavior available', () => {
  const onClose = vi.fn();
  render(<AssetUploadDialog onClose={onClose} onSubmit={vi.fn()} />);
  const dialog = screen.getByRole('dialog', { name: '上传素材' });
  expect(dialog.querySelector('header')).toBeVisible();
  expect(dialog.querySelector('.asset-upload-dialog__body')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: '确认上传' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭上传素材' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Create the ordinary dialog stylesheet**

Use explicit content-sized rows and the shared spacing scale:

```css
.asset-upload-dialog,
.export-dialog {
  width: min(620px, calc(100vw - 48px));
  height: auto;
  max-height: calc(100dvh - 48px);
  overflow: hidden;
  border: 1px solid var(--stroke-strong);
  border-radius: var(--radius-modal);
  color: var(--text-primary);
  background: var(--surface-panel);
  box-shadow: var(--shadow-modal);
}

.asset-upload-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, auto) auto auto;
}

.export-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, auto) auto;
}

.asset-upload-dialog__body,
.export-dialog__body {
  min-height: 0;
  padding: 24px;
  overflow-x: hidden;
  overflow-y: auto;
}

.asset-upload-dialog > footer,
.export-dialog > footer {
  min-height: auto;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--stroke-subtle);
}

.node-command-dialog {
  width: 320px;
  height: auto;
  max-height: calc(100dvh - 48px);
  padding: 24px;
  border-radius: var(--radius-modal);
}
```

Include `organization-dialog` and `review-decision-dialog` width variants, 24px Header/Section spacing, 16px card gaps, 40px secondary controls, 48px primary actions, and 390px responsive rules.

- [ ] **Step 3: Remove migrated Modal selectors from `soft-glass.css`**

Repeat Task 5's PostCSS selector filter with these fragments:

```js
const legacyDialogs = [
  '.asset-upload-dialog', '.organization-dialog', '.review-decision-dialog',
  '.node-command-dialog', '.export-dialog',
];
```

Preserve `result-dialog-backdrop`, `result-compare-dialog`, and `result-inspector` rules.

- [ ] **Step 4: Import `dialog-system.css` last**

```ts
import './styles/soft-glass.css';
import './styles/workbench-panels.css';
import './styles/dialog-system.css';
```

- [ ] **Step 5: Run Modal and application regression tests**

```bash
npm test -- --run tests/app.test.tsx tests/dialogSystem.test.tsx tests/workbench.test.tsx
npm run typecheck
npm run lint
```

Expected: all ordinary dialog tests pass and result comparison remains full-viewport.

- [ ] **Step 6: Commit Modal convergence**

```bash
git add src/client/styles/dialog-system.css src/client/styles/soft-glass.css src/client/main.tsx tests/app.test.tsx tests/dialogSystem.test.tsx
git commit -m "refactor: unify ordinary dialog geometry"
```

---

### Task 7: Add Browser Geometry and Interaction Acceptance

**Files:**
- Modify: `scripts/image-mvp-e2e.mjs`
- Modify: `docs/acceptance/evidence/*.png`
- Test: `scripts/image-mvp-e2e.mjs`

**Interfaces:**
- Consumes: built application, current stateful E2E API, eight tool labels.
- Produces: deterministic geometry failures and six stable visual evidence screenshots.

- [ ] **Step 1: Add a reusable geometry assertion**

Add this helper near the bottom of `image-mvp-e2e.mjs`:

```js
async function assertToolPanelGeometry(page, dialogName, options = {}) {
  const metrics = await page.getByRole('dialog', { name: dialogName }).evaluate((panel) => {
    const header = panel.querySelector('[data-panel-region="header"]');
    const body = panel.querySelector('[data-panel-region="body"]');
    const footer = panel.querySelector('[data-panel-region="footer"]');
    const action = footer?.querySelector('button:last-of-type');
    if (!header || !body || !footer || !action) return null;
    const panelRect = panel.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    return {
      panel: { left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom },
      header: { left: headerRect.left, right: headerRect.right, bottom: headerRect.bottom },
      body: { top: bodyRect.top, bottom: bodyRect.bottom, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight },
      footer: { top: footerRect.top, bottom: footerRect.bottom },
      actionHeight: actionRect.height,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  if (!metrics) throw new Error(`${dialogName}: 缺少三段式面板区域`);
  if (metrics.header.bottom > metrics.body.top || metrics.body.bottom > metrics.footer.top) {
    throw new Error(`${dialogName}: Header、Body、Footer 发生重叠`);
  }
  if (Math.abs(metrics.actionHeight - 48) > 1) throw new Error(`${dialogName}: 主按钮高度不是 48px`);
  if (!options.expectScroll && metrics.body.scrollHeight > metrics.body.clientHeight + 1) {
    throw new Error(`${dialogName}: 少内容面板过早滚动`);
  }
  if (metrics.documentWidth > metrics.viewportWidth) throw new Error(`${dialogName}: 页面横向溢出`);
}
```

- [ ] **Step 2: Exercise all eight tool panels before the first generation job**

Loop through tool buttons, operate at least one available control, assert geometry, and close using the close button. Use exact dialog names and do not submit jobs during this matrix.

- [ ] **Step 3: Add responsive checks**

Use `page.setViewportSize` for 1440x960, 1024x768, 768x900, and 390x844. At 390px, assert the panel occupies the viewport and light/angle remain available as full-screen Sheets.

- [ ] **Step 4: Assert ordinary Modal geometry**

Open the upload and export dialogs at desktop size. Assert that each dialog height is smaller than `viewport height - 48px` when its content fits, Header/Body/Footer do not overlap, the Body is the only possible scroll container, left and right Body padding are both 24px, and primary controls remain reachable.

- [ ] **Step 5: Capture stable evidence**

When `CONTENT_STUDIO_E2E_SCREENSHOTS=1`, wait for panel opacity `1` and capture:

```text
image-mvp-panel-extract-desktop-2026-07-23.png
image-mvp-panel-generate-prompt-2026-07-23.png
image-mvp-panel-angle-desktop-2026-07-23.png
image-mvp-panel-scroll-1024-2026-07-23.png
image-mvp-panel-mobile-sheet-2026-07-23.png
image-mvp-modal-upload-desktop-2026-07-23.png
```

- [ ] **Step 6: Build and run E2E twice**

```bash
npm run build
npm run e2e:image-mvp
CONTENT_STUDIO_E2E_SCREENSHOTS=1 npm run e2e:image-mvp
```

Expected: both runs report `status: pass`, two Fal submissions, refresh recovery, and two generated results.

- [ ] **Step 7: Inspect every evidence image**

Verify safe-area padding, title hierarchy, Surface hierarchy, control height, Footer bottom padding, no clipped text, no overlapping controls, and no stale loading animation frame. Fix source and repeat this task when any screenshot fails visual review.

- [ ] **Step 8: Commit browser acceptance**

```bash
git add scripts/image-mvp-e2e.mjs docs/acceptance/evidence
git commit -m "test: add tool panel geometry acceptance"
```

---

### Task 8: Final Review, Release Gates, and Deployment Evidence

**Files:**
- Modify: `docs/acceptance/图片工作台MVP发布前收口_2026-07-23.md`
- Review: all files changed since `05c96eb`

**Interfaces:**
- Produces: review findings, complete gate results, clean release metadata, and a deployable branch.

- [ ] **Step 1: Review the complete diff for behavior drift**

```bash
git diff --check 05c96eb..HEAD
git diff --stat 05c96eb..HEAD
git diff 05c96eb..HEAD -- src/shared src/server src/worker
```

Expected: no whitespace errors and no business-layer changes.

- [ ] **Step 2: Run all repository gates**

```bash
npm run repo:check
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e:image-mvp
```

Expected: all pass. Record the actual test count rather than copying the previous 446 count.

- [ ] **Step 3: Run acceptance and release preflight honestly**

```bash
set -a
source "$HOME/.content-studio/lan.env"
set +a
npm run lan:backup
npm run acceptance
CONTENT_STUDIO_RELEASE_BACKUP_FILE="$(ls -t "$HOME"/.content-studio/backups/*.sqlite | head -n 1)" npm run release:preflight
```

Expected: core image-workbench acceptance passes. Preserve and report any real production-configuration partials or blockers.

- [ ] **Step 4: Update the acceptance report**

Record implementation commits, screenshots, geometry matrix, automated commands, remaining production blockers, and any untouched user-owned untracked files.

- [ ] **Step 5: Commit the acceptance report**

```bash
git add docs/acceptance/图片工作台MVP发布前收口_2026-07-23.md
git commit -m "docs: record design-system convergence acceptance"
```

- [ ] **Step 6: Use the finishing-a-development-branch workflow**

Review commit history, verify the branch is clean except for the preserved user-owned untracked files, push `codex/design-system-convergence`, create a PR against `main`, wait for CI, and only deploy the merged revision.

# PIAS Frame-Accurate Workbench Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build six freely operable PIAS image-workbench flows whose panel placement, canvas overlays, task stages, node branching, viewport movement, and visual states follow the six local reference recordings.

**Architecture:** Keep `StudioState` as the source of truth for scenes, jobs, results, reviews, and usage. Add a pure interaction reducer for temporary UI state and pure viewport helpers for panel placement and focus requests; `Workbench` coordinates those modules with React Flow. Tool-specific controls remain in `ContextToolPanel`, while image-surface controls live in focused overlay components rendered by canvas nodes.

**Tech Stack:** React 19, TypeScript 5.8, React Flow 12, Lucide React, Vitest, Testing Library, Vite.

## Global Constraints

- Cover all six reference flows: prompt-free generation, manual creation, AI synthesis, AI lighting, expand/upscale, and angle generation.
- Preserve PIAS branding, Chinese business copy, review gates, and usage accounting; do not copy TheSEA trademarks, proprietary assets, or verbatim copy.
- Every flow must be driven by real user input, resettable, and repeatable; do not implement a scripted video playback.
- Match UI transition cadence while compressing model waits to 5-8 seconds with visible queue, generation, detail, and completion stages.
- Desktop provides full editing; mobile remains a result, task, and review experience.
- Do not add a backend, a model integration, or another large frontend framework.
- Follow TDD for every behavior change: write a focused failing test, observe the expected failure, add the minimum implementation, and rerun the focused and full suites.

---

### Task 1: Explicit Interaction State Machine

**Files:**
- Create: `src/workbench/interactionMachine.ts`
- Create: `tests/interactionMachine.test.ts`

**Interfaces:**
- Produces: `InteractionMode`, `PanelPlacement`, `WorkbenchInteractionState`, `WorkbenchInteractionEvent`, `createInitialInteractionState(nodeId)`, and `reduceWorkbenchInteraction(state, event)`.
- Consumes: `TaskProfileId` from `src/domain.ts`.

- [ ] **Step 1: Write failing reducer tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  createInitialInteractionState,
  reduceWorkbenchInteraction,
} from '../src/workbench/interactionMachine';

describe('workbench interaction machine', () => {
  it('opens a tool against the selected node and enters its editing mode', () => {
    const selected = reduceWorkbenchInteraction(
      createInitialInteractionState('scene:scene-source'),
      { type: 'OPEN_TOOL', tool: 'light' },
    );
    expect(selected).toMatchObject({
      mode: 'editing-light',
      activeTool: 'light',
      anchorNodeId: 'scene:scene-source',
      panelOpen: true,
    });
  });

  it('returns from the asset picker to the blend configuration', () => {
    const opened = reduceWorkbenchInteraction(
      reduceWorkbenchInteraction(
        createInitialInteractionState('scene:scene-source'),
        { type: 'OPEN_TOOL', tool: 'blend' },
      ),
      { type: 'OPEN_ASSET_PICKER' },
    );
    expect(reduceWorkbenchInteraction(opened, { type: 'CLOSE_ASSET_PICKER' })).toMatchObject({
      mode: 'configuring',
      assetPickerOpen: false,
      panelOpen: true,
    });
  });

  it('clears temporary layers when submission starts', () => {
    const editing = reduceWorkbenchInteraction(
      createInitialInteractionState('result:result-1'),
      { type: 'OPEN_TOOL', tool: 'expand' },
    );
    expect(reduceWorkbenchInteraction(editing, { type: 'SUBMIT' })).toMatchObject({
      mode: 'submitting',
      panelOpen: false,
      assetPickerOpen: false,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and observe the missing-module failure**

Run: `npm test -- tests/interactionMachine.test.ts`

Expected: FAIL because `src/workbench/interactionMachine.ts` does not exist.

- [ ] **Step 3: Implement the pure reducer**

```ts
import type { TaskProfileId } from '../domain';

export type InteractionMode =
  | 'idle'
  | 'node-selected'
  | 'configuring'
  | 'picking-asset'
  | 'editing-light'
  | 'editing-expand'
  | 'editing-angle'
  | 'submitting';

export type PanelPlacement = 'left' | 'right';

export type WorkbenchInteractionState = {
  mode: InteractionMode;
  selectedNodeIds: string[];
  activeTool: TaskProfileId | null;
  anchorNodeId: string | null;
  panelOpen: boolean;
  assetPickerOpen: boolean;
  panelPlacement: PanelPlacement;
};

export type WorkbenchInteractionEvent =
  | { type: 'SELECT_NODE'; nodeId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'OPEN_TOOL'; tool: TaskProfileId }
  | { type: 'CLOSE_TOOL' }
  | { type: 'OPEN_ASSET_PICKER' }
  | { type: 'CLOSE_ASSET_PICKER' }
  | { type: 'SET_PANEL_PLACEMENT'; placement: PanelPlacement }
  | { type: 'SUBMIT' }
  | { type: 'SUBMISSION_SETTLED'; nodeId: string }
  | { type: 'RESET'; nodeId: string };

const editingMode = (tool: TaskProfileId): InteractionMode => {
  if (tool === 'light') return 'editing-light';
  if (tool === 'expand') return 'editing-expand';
  if (tool === 'angle') return 'editing-angle';
  return 'configuring';
};
```

Implement every event as an immutable transition. `OPEN_TOOL` is ignored without a selected node; `CLOSE_TOOL` returns to `node-selected`; `CLEAR_SELECTION` closes all temporary layers; `RESET` restores the supplied source node.

- [ ] **Step 4: Verify reducer tests and the full suite**

Run: `npm test -- tests/interactionMachine.test.ts && npm test`

Expected: focused tests pass and the existing suite reports zero failures.

- [ ] **Step 5: Commit the state machine**

```bash
git add src/workbench/interactionMachine.ts tests/interactionMachine.test.ts
git commit -m "feat: add workbench interaction state machine"
```

### Task 2: Deterministic Panel Placement and Viewport Direction

**Files:**
- Create: `src/workbench/viewportDirector.ts`
- Create: `tests/viewportDirector.test.ts`

**Interfaces:**
- Produces: `Rect`, `Size`, `choosePanelPlacement(anchor, viewport, panel, gap)`, `buildFocusNodeIds(anchorNodeId, targetNodeIds)`, and `shouldApplyAutoFocus(requestRevision, userRevision)`.
- Consumes: no React or DOM objects; callers convert DOM rectangles to plain values.

- [ ] **Step 1: Write failing viewport-helper tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildFocusNodeIds,
  choosePanelPlacement,
  shouldApplyAutoFocus,
} from '../src/workbench/viewportDirector';

describe('viewport director', () => {
  it('places the panel on the side with enough room', () => {
    expect(choosePanelPlacement(
      { left: 1040, right: 1280, top: 200, bottom: 520 },
      { left: 240, right: 1440, top: 48, bottom: 900 },
      { width: 320, height: 540 },
      16,
    )).toBe('left');
  });

  it('keeps source and generated targets in a stable focus request', () => {
    expect(buildFocusNodeIds('scene:source', ['result:2', 'result:1', 'result:2']))
      .toEqual(['scene:source', 'result:1', 'result:2']);
  });

  it('rejects automatic focus after a user viewport gesture', () => {
    expect(shouldApplyAutoFocus(3, 4)).toBe(false);
    expect(shouldApplyAutoFocus(4, 4)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and observe the missing-module failure**

Run: `npm test -- tests/viewportDirector.test.ts`

Expected: FAIL because `src/workbench/viewportDirector.ts` does not exist.

- [ ] **Step 3: Implement pure placement and focus helpers**

Use available horizontal space first. When both sides fit, prefer right; when neither fits, choose the larger side. Deduplicate and sort target node IDs before appending them after the anchor node. Apply auto-focus only when the request revision is not older than the latest user-gesture revision.

- [ ] **Step 4: Verify focused and full tests**

Run: `npm test -- tests/viewportDirector.test.ts && npm test`

Expected: all tests pass.

- [ ] **Step 5: Commit viewport helpers**

```bash
git add src/workbench/viewportDirector.ts tests/viewportDirector.test.ts
git commit -m "feat: direct workbench panels and viewport focus"
```

### Task 3: Tool-Specific Panels, Asset Picker, and Canvas Overlays

**Files:**
- Create: `src/workbench/CanvasOverlays.tsx`
- Modify: `src/workbench/ContextToolPanel.tsx`
- Modify: `src/workbench/CanvasNodes.tsx`
- Modify: `src/workbench/graph.ts`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Produces: `LightOverlay`, `ExpandOverlay`, and `AnglePreview` with controlled values and change callbacks.
- Extends `ContextToolPanel` with `assetPickerOpen`, `onAssetPickerOpen`, `onAssetPickerClose`, and a guarded `isSubmitting` prop.
- Extends scene/result node data with `interactionMode`, tool parameters, and controlled overlay callbacks.

- [ ] **Step 1: Add failing component tests**

Add focused tests asserting:

```ts
it('opens a searchable reference-material picker from blend settings', () => {
  render(<WorkbenchHarness />);
  fireEvent.click(screen.getByRole('button', { name: '融图' }));
  fireEvent.click(screen.getByRole('button', { name: '选择参考素材' }));
  expect(screen.getByRole('dialog', { name: '选择参考素材' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: '搜索参考素材' })).toBeInTheDocument();
});

it('synchronizes the light direction overlay with the tool controls', () => {
  render(<WorkbenchHarness />);
  fireEvent.click(screen.getByRole('button', { name: '定向光' }));
  fireEvent.click(screen.getByRole('button', { name: '右上光' }));
  expect(screen.getByLabelText('定向光控制点')).toHaveAttribute('data-direction', 'top-right');
});

it('shows an image boundary and nine-cell grid only while expanding', () => {
  render(<WorkbenchHarness />);
  fireEvent.click(screen.getByRole('button', { name: '扩图' }));
  expect(screen.getByLabelText('扩图构图区域')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭参数面板' }));
  expect(screen.queryByLabelText('扩图构图区域')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused workbench tests and observe assertion failures**

Run: `npm test -- tests/workbench.test.tsx`

Expected: FAIL because the dedicated picker, synchronized direction control, and lifecycle-bound overlays are absent.

- [ ] **Step 3: Implement controlled overlays and tool panels**

`LightOverlay` renders one movable central control and eight directional buttons. `ExpandOverlay` renders the target frame, original-image boundary, and nine-cell grid using CSS variables for scale and ratio. `AnglePreview` renders a compact orbit indicator with selected horizontal and vertical values. All controls use buttons or range inputs with Chinese accessible names.

Replace the blend native select with a thumbnail slot that opens an in-panel picker dialog. Add tool-specific controls:

- Generate: scene template, ratio, output count, quality.
- Blend: reference thumbnail, blend strength, optional description.
- Light: eight-direction segmented control, intensity, color temperature, description.
- Expand: target ratio, original image scale, direction, description.
- Upscale: target size and detail enhancement.
- Angle: horizontal angle, elevation, distance, and up to four reference thumbnails.

Keep remove and extract operational using their existing compact controls. Closing or switching tools must unmount the prior overlay.

- [ ] **Step 4: Verify workbench tests and full tests**

Run: `npm test -- tests/workbench.test.tsx && npm test`

Expected: all tests pass without React warnings.

- [ ] **Step 5: Commit tool interactions**

```bash
git add src/workbench/CanvasOverlays.tsx src/workbench/ContextToolPanel.tsx src/workbench/CanvasNodes.tsx src/workbench/graph.ts tests/workbench.test.tsx
git commit -m "feat: add frame-matched image tool controls"
```

### Task 4: Workbench Integration, Task Stages, and Viewport Choreography

**Files:**
- Modify: `src/workbench/Workbench.tsx`
- Modify: `src/workbench/TaskTray.tsx`
- Modify: `src/workbench/graph.ts`
- Modify: `tests/workbench.test.tsx`
- Modify: `tests/app.test.tsx`

**Interfaces:**
- Consumes: `reduceWorkbenchInteraction`, `choosePanelPlacement`, `buildFocusNodeIds`, and controlled overlay callbacks.
- Produces: a single interaction-state owner, user-gesture revision tracking, deterministic 5-8 second task scheduling, and panel placement classes.

- [ ] **Step 1: Add failing integration tests**

Add tests for these observable behaviors:

```ts
it('closes tool layers on submit and focuses source plus task placeholder', () => {
  reactFlowMocks.fitView.mockClear();
  render(<WorkbenchHarness />);
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
  expect(screen.queryByRole('dialog', { name: '生成参数' })).not.toBeInTheDocument();
  expect(reactFlowMocks.fitView).toHaveBeenCalledWith(expect.objectContaining({ duration: 320 }));
});

it('moves through queue, generation, detail, and completion stages', async () => {
  vi.useFakeTimers();
  render(<WorkbenchHarness />);
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
  expect(screen.getAllByText('等待调度').length).toBeGreaterThan(0);
  await act(() => vi.advanceTimersByTimeAsync(900));
  expect(screen.getAllByText('正在生成').length).toBeGreaterThan(0);
  await act(() => vi.advanceTimersByTimeAsync(2700));
  expect(screen.getAllByText('优化细节').length).toBeGreaterThan(0);
  await act(() => vi.advanceTimersByTimeAsync(2800));
  expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
  vi.useRealTimers();
});
```

Add a test that calls the React Flow `onMoveStart` mock before completion and asserts no completion-driven `fitView` call is made afterward.

- [ ] **Step 2: Run focused tests and observe lifecycle failures**

Run: `npm test -- tests/workbench.test.tsx tests/app.test.tsx`

Expected: FAIL because submission leaves the panel open, task stages finish after 1.4 seconds, and user viewport gestures are not tracked.

- [ ] **Step 3: Integrate reducer, scheduling, and viewport behavior**

Replace `selectedNodeId` plus `panelOpen` with `WorkbenchInteractionState`. Record a user viewport revision from `onMoveStart` and `onNodeDragStart`. On submission:

1. dispatch `SUBMIT`;
2. create the job and record its predicted ID;
3. focus source and placeholder nodes for 320 ms;
4. update progress at 0.9 s, 3.6 s, and 5.4 s;
5. complete at 6.4 s;
6. focus source plus output nodes only when no newer user gesture occurred;
7. dispatch `SUBMISSION_SETTLED` with the most relevant output node.

Use visible stage labels `等待调度`, `正在生成`, `优化细节`, and `已完成`. Preserve cancel, failure, retry, usage release, and StrictMode timer cleanup behavior. Update existing fake-timer tests to 6.4 seconds without loosening their assertions.

- [ ] **Step 4: Verify focused tests and full tests**

Run: `npm test -- tests/workbench.test.tsx tests/app.test.tsx && npm test`

Expected: all tests pass with zero unhandled timer warnings.

- [ ] **Step 5: Commit integrated behavior**

```bash
git add src/workbench/Workbench.tsx src/workbench/TaskTray.tsx src/workbench/graph.ts tests/workbench.test.tsx tests/app.test.tsx
git commit -m "feat: choreograph workbench generation flows"
```

### Task 5: Reference-Matched Visual System and Responsive Behavior

**Files:**
- Modify: `src/styles.css`
- Modify: `src/workbench/CanvasNodes.tsx`
- Modify: `src/workbench/ContextToolPanel.tsx`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: interaction-mode and panel-placement classes from Task 4.
- Produces: stable desktop geometry at 1024-1920 px and mobile result/task/review layout at 375 px.

- [ ] **Step 1: Add failing structural tests for visual-state hooks**

Assert that the open panel has `data-placement`, the selected node has `data-interaction-mode`, progress nodes expose `data-stage`, and mobile controls remain present under the mobile preview landmark. These attributes are stable hooks for screenshots and must describe state rather than styling implementation details.

- [ ] **Step 2: Run workbench tests and observe missing-hook failures**

Run: `npm test -- tests/workbench.test.tsx`

Expected: FAIL because the state hooks do not exist.

- [ ] **Step 3: Apply the visual alignment**

Tune only workbench selectors in `src/styles.css`:

- maintain a near-black canvas with low-contrast 24 px dots;
- keep the scene rail compact and image-led;
- use 240 px source/result nodes with stable media ratios and 8 px maximum radius;
- anchor 300-340 px tool panels beside the selected node, with left/right entry transforms;
- present result batches as compact horizontal lanes;
- darken generated previews while retaining readable progress;
- keep controls, overlays, and task tray clear of React Flow controls and minimap;
- use 80-360 ms transitions from the design specification;
- disable positional transitions for `prefers-reduced-motion`;
- at 1024 px, collapse the rail and preserve the canvas; at 375 px, hide editing controls and show result/task/review actions without overlap.

Do not introduce gradients, decorative blobs, oversized headings, nested cards, or a single-hue palette.

- [ ] **Step 4: Verify tests and production build**

Run: `npm test && npm run build`

Expected: tests pass and Vite production build exits 0.

- [ ] **Step 5: Commit visual alignment**

```bash
git add src/styles.css src/workbench/CanvasNodes.tsx src/workbench/ContextToolPanel.tsx tests/workbench.test.tsx
git commit -m "style: align PIAS workbench interaction frames"
```

### Task 6: Six-Flow Browser QA, Screenshot Comparison, and Repair Loop

**Files:**
- Modify for behavioral comparison failures: `src/workbench/Workbench.tsx`, `src/workbench/interactionMachine.ts`, `src/workbench/viewportDirector.ts`, and `tests/workbench.test.tsx`.
- Modify for visual comparison failures: `src/workbench/CanvasNodes.tsx`, `src/workbench/ContextToolPanel.tsx`, `src/workbench/CanvasOverlays.tsx`, and `src/styles.css`.
- Preserve reference inputs unmodified: `thesea_videos/`, `analysis/contact_sheets/`, and `figma_thesea_slides_15_21/`.

**Interfaces:**
- Consumes: the completed interactive workbench at `http://127.0.0.1:5173/`.
- Produces: verified screenshots for every reference flow checkpoint and fixes for all Critical or Important findings.

- [ ] **Step 1: Start or reuse the Vite development server**

Run: `npm run dev -- --port 5173`

Expected: Vite reports `http://127.0.0.1:5173/`; if 5173 is occupied by this project, reuse it after confirming HTTP 200.

- [ ] **Step 2: Exercise all six flows in a real browser**

For each flow, capture at minimum: source selected, panel open, overlay or asset picker active, task queued, task in detail stage, and completed result batch. Confirm node dragging, canvas pan/zoom, task cancellation, retry, review submission, approval-gated download, panel close, and flow reset.

- [ ] **Step 3: Capture responsive screenshots**

Capture desktop screenshots at 1920 x 1080, 1440 x 900, 1280 x 800, and 1024 x 768, plus mobile at 375 x 812. Check that no visible text, button, panel, node, minimap, task tray, or overlay overlaps incoherently.

- [ ] **Step 4: Compare against local reference frames**

For each flow, compare panel anchoring, node width, result spacing, progress treatment, control-handle position, and viewport framing with `analysis/contact_sheets/*.jpg` and `figma_thesea_slides_15_21/*_after_click.png`. Record each mismatch as Critical, Important, or Minor. Fix all Critical and Important issues using a new failing test whenever the mismatch is behavioral.

- [ ] **Step 5: Run fresh final verification**

Run: `npm test && npm run build && curl -I http://127.0.0.1:5173/`

Expected: all tests pass, build exits 0, and the development server returns HTTP 200.

- [ ] **Step 6: Review the final diff and commit repairs**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Confirm that reference directories remain untracked and unmodified. Commit only implementation and test repairs:

```bash
git add src tests
git commit -m "fix: close frame comparison gaps"
```

Skip the final repair commit when there are no post-QA changes.

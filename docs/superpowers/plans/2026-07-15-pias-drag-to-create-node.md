# PIAS Drag-to-Create Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a large node creation handle that opens an eight-option node picker after a connection is dropped on blank canvas, then preserves the drop position through draft configuration and task submission.

**Architecture:** Extend the existing interaction reducer with a transient node-creation context, merge a draft task node and edge into the React Flow presentation graph, and keep all temporary creation state outside `StudioState`. `Workbench` owns React Flow connection events and converts the draft into the existing domain job flow only when the user submits parameters.

**Tech Stack:** React 19, TypeScript 5.8, React Flow 12, Lucide React, Vitest, Testing Library, Vite.

## Global Constraints

- Existing asset drag behavior remains unchanged: blank canvas creates a source Scene; dropping on an image node binds a blend reference.
- The selected Scene or Result creation control uses a 36px visual button with a 44px pointer target.
- The picker contains exactly eight Chinese tools: 生成、融图、快速视角、定向光、去除、抠图、扩图、超分.
- Temporary picker, edge, and draft task data must not enter `StudioState`, audit events, usage, or the task queue.
- The draft node is 220px × 160px and the picker is 320px wide with at most 8px corner radius.
- Viewports below 768px do not expose canvas editing controls.
- Do not modify or stage `analysis/`, `figma_thesea_slides_15_21/`, or `thesea_videos/`.

---

### Task 1: Node Creation Interaction State

**Files:**
- Modify: `src/workbench/interactionMachine.ts`
- Test: `tests/interactionMachine.test.ts`

**Interfaces:**
- Produces: `DraftNodeCreation`, `BEGIN_NODE_CONNECTION`, `SHOW_NODE_PICKER`, `SELECT_DRAFT_TOOL`, and `CANCEL_NODE_CREATION`.
- Consumed by: `Workbench`, `graph`, `NodeTypePicker`, and `DraftTaskNode` in later tasks.

- [x] **Step 1: Write failing reducer tests**

Add tests that assert the reducer stores the source node, exact screen/canvas positions, selected tool, and clears the draft when canceled or when selection changes:

```ts
it('opens a node picker at the released canvas position', () => {
  const connected = reduceWorkbenchInteraction(createInitialInteractionState('scene:scene-source'), {
    type: 'BEGIN_NODE_CONNECTION', sourceNodeId: 'scene:scene-source',
  });
  const choosing = reduceWorkbenchInteraction(connected, {
    type: 'SHOW_NODE_PICKER',
    screenPosition: { x: 720, y: 420 },
    canvasPosition: { x: 980, y: 560 },
    placement: 'left',
  });

  expect(choosing.mode).toBe('choosing-node-type');
  expect(choosing.draftNode).toMatchObject({
    sourceNodeId: 'scene:scene-source',
    screenPosition: { x: 720, y: 420 },
    canvasPosition: { x: 980, y: 560 },
    placement: 'left',
  });
});
```

- [x] **Step 2: Run reducer tests and confirm red**

Run: `npm test -- --run tests/interactionMachine.test.ts`

Expected: FAIL because the new events and `draftNode` state do not exist.

- [x] **Step 3: Implement the transient state contract**

Add the following public shape and reducer transitions:

```ts
export type DraftNodeCreation = {
  sourceNodeId: string;
  screenPosition: { x: number; y: number };
  canvasPosition: { x: number; y: number };
  placement: PanelPlacement;
  selectedTool: TaskProfileId | null;
};

// BEGIN_NODE_CONNECTION creates a draft with zeroed positions.
// SHOW_NODE_PICKER updates positions and enters choosing-node-type.
// SELECT_DRAFT_TOOL stores the tool, opens the panel, and enters configuring-draft-node.
// CANCEL_NODE_CREATION clears draftNode and returns to node-selected or idle.
```

`SELECT_NODE`, `CLEAR_SELECTION`, `CLOSE_TOOL`, `SUBMIT`, `SUBMISSION_SETTLED`, and `RESET` must clear stale draft state where appropriate.

- [x] **Step 4: Run reducer tests and confirm green**

Run: `npm test -- --run tests/interactionMachine.test.ts`

Expected: all interaction-machine tests pass.

- [x] **Step 5: Commit**

```bash
git add src/workbench/interactionMachine.ts tests/interactionMachine.test.ts
git commit -m "feat: model drag-to-create node state"
```

---

### Task 2: Explicit Job Position and Draft Graph Projection

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/workbench/graph.ts`
- Test: `tests/domain.test.ts`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: `DraftNodeCreation` from Task 1.
- Produces: optional `position` input for `createJob`, `DraftTaskNodeData`, one transient `draft:task` node, and one transient `draft-edge` edge.

- [x] **Step 1: Write failing domain and graph tests**

Add a domain assertion:

```ts
const next = createJob(initialStudioState(), {
  sceneId: 'scene-source',
  profileId: 'generate',
  outputCount: 1,
  position: { x: 860, y: 420 },
});
expect(next.jobs[0]).toMatchObject({ x: 860, y: 420 });
```

Add a graph assertion that a selected tool projects one non-domain draft node and edge:

```ts
const graph = buildCanvasGraph(state, 'scene:scene-source', 'blend', {}, interaction);
expect(graph.nodes.find((node) => node.id === 'draft:task')).toMatchObject({
  type: 'draft-task',
  position: { x: 860, y: 420 },
  data: { tool: 'blend', sourceNodeId: 'scene:scene-source' },
});
expect(graph.edges.find((edge) => edge.id === 'draft-edge')).toMatchObject({
  source: 'scene:scene-source', target: 'draft:task', animated: true,
});
```

- [x] **Step 2: Run focused tests and confirm red**

Run: `npm test -- --run tests/domain.test.ts tests/workbench.test.tsx`

Expected: FAIL because `position` and the draft graph projection are missing.

- [x] **Step 3: Add the minimal domain and graph support**

Extend `createJob` input with `position?: CanvasPosition` and assign coordinates as follows:

```ts
x: input.position?.x ?? source.x + 320,
y: input.position?.y ?? source.y + 24 + (sceneJobCount + sceneBranchCount) * 300,
```

Extend `CanvasGraphInteraction` with optional draft data and append the draft node/edge only when `selectedTool` exists. The draft projection must not mutate `state`.

- [x] **Step 4: Run focused tests and confirm green**

Run: `npm test -- --run tests/domain.test.ts tests/workbench.test.tsx`

Expected: focused domain and graph tests pass.

- [x] **Step 5: Commit**

```bash
git add src/domain.ts src/workbench/graph.ts tests/domain.test.ts tests/workbench.test.tsx
git commit -m "feat: project draft tasks at connection drops"
```

---

### Task 3: Large Creation Handle, Picker, and Draft Node Components

**Files:**
- Create: `src/workbench/NodeTypePicker.tsx`
- Create: `src/workbench/DraftTaskNode.tsx`
- Modify: `src/workbench/CanvasNodes.tsx`
- Modify: `src/workbench/ToolPalette.tsx`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: eight `taskProfiles`, `DraftTaskNodeData`, and node action callbacks.
- Produces: accessible create handles, `NodeTypePicker`, `DraftTaskNode`, and exported `toolIcons`.

- [x] **Step 1: Write failing component tests**

Test that a selected Scene and Result each expose one accessible creation handle, unselected nodes do not expose the large action, the picker renders eight unique options, and choosing one reports the exact tool ID.

```ts
expect(screen.getByRole('button', { name: '拖拽新增节点' })).toBeInTheDocument();
expect(within(picker).getAllByRole('button')).toHaveLength(9); // eight tools plus close
fireEvent.click(within(picker).getByRole('button', { name: '融图' }));
expect(onSelect).toHaveBeenCalledWith('blend');
```

- [x] **Step 2: Run workbench tests and confirm red**

Run: `npm test -- --run tests/workbench.test.tsx`

Expected: FAIL because the picker, draft node, and large handle are missing.

- [x] **Step 3: Implement focused presentation components**

`NodeTypePicker` receives:

```ts
type NodeTypePickerProps = {
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (tool: TaskProfileId) => void;
};
```

`DraftTaskNode` renders the tool icon, label, `待配置`, and a cancel icon button. `CanvasNodes` renders a source `Handle` with `id="create"`, keyboard activation, plus icon, `role="button"`, and `aria-label="拖拽新增节点"` only for selected Scene/Result nodes; its unselected form stays an 8px lineage handle.

- [x] **Step 4: Run workbench tests and confirm green**

Run: `npm test -- --run tests/workbench.test.tsx`

Expected: component tests pass.

- [x] **Step 5: Commit**

```bash
git add src/workbench/NodeTypePicker.tsx src/workbench/DraftTaskNode.tsx src/workbench/CanvasNodes.tsx src/workbench/ToolPalette.tsx tests/workbench.test.tsx
git commit -m "feat: add node creation controls"
```

---

### Task 4: Wire React Flow Connection Completion to Task Submission

**Files:**
- Modify: `src/workbench/Workbench.tsx`
- Modify: `src/workbench/viewportDirector.ts`
- Test: `tests/workbench.test.tsx`
- Test: `tests/viewportDirector.test.ts`

**Interfaces:**
- Consumes: interaction events, draft graph data, `NodeTypePicker`, and explicit job positions.
- Produces: valid blank-pane connection completion, edge-aware menu placement, draft cancellation, and submission at the drop coordinate.

- [x] **Step 1: Write failing placement and workbench tests**

Add pure placement cases for center and all four edges. Add workbench tests for the click fallback: clicking `拖拽新增节点` opens the picker, choosing `融图` shows a draft node and `融图参数`, closing the panel removes both without changing job count, and submitting creates one job at the draft coordinates.

- [x] **Step 2: Run focused tests and confirm red**

Run: `npm test -- --run tests/workbench.test.tsx tests/viewportDirector.test.ts`

Expected: FAIL because connection wiring and placement helpers do not exist.

- [x] **Step 3: Implement Workbench orchestration**

Wire these React Flow props:

```tsx
onConnectStart={handleConnectStart}
onConnectEnd={handleConnectEnd}
onPaneClick={handlePaneClick}
```

`handleConnectEnd` must require `connectionState.fromNode`, reject `connectionState.toNode`, require a `.react-flow__pane` target, convert pointer coordinates with `screenToFlowPosition`, clamp the 320px picker inside the stage, and dispatch `SHOW_NODE_PICKER`.

Choosing a tool dispatches `SELECT_DRAFT_TOOL`, resets tool defaults, opens the existing parameter panel, and leaves `StudioState` unchanged. `handleRunSelected` passes `interaction.draftNode.canvasPosition` to `createJob`; closing or changing selection dispatches `CANCEL_NODE_CREATION`.

- [x] **Step 4: Run focused tests and confirm green**

Run: `npm test -- --run tests/workbench.test.tsx tests/viewportDirector.test.ts`

Expected: all focused tests pass.

- [x] **Step 5: Commit**

```bash
git add src/workbench/Workbench.tsx src/workbench/viewportDirector.ts tests/workbench.test.tsx tests/viewportDirector.test.ts
git commit -m "feat: complete drag-to-create task flow"
```

---

### Task 5: Visual Styling, Responsive Guardrails, and Browser QA

**Files:**
- Modify: `src/styles.css`
- Test: `tests/app.test.tsx`

**Interfaces:**
- Consumes: class names from Tasks 3 and 4.
- Produces: 44px handle target, 320px picker, 220px × 160px draft node, edge-safe responsive behavior, and final browser evidence.

- [ ] **Step 1: Add a failing mobile visibility assertion**

Assert that the mobile preview remains the only editing surface below the existing CSS breakpoint and the new controls have dedicated classes that are hidden by the mobile media query.

- [ ] **Step 2: Run the app test and confirm red**

Run: `npm test -- --run tests/app.test.tsx`

Expected: FAIL until the new control classes are present and covered by the mobile rule.

- [ ] **Step 3: Implement final styling**

Add styles for:

- `.node-create-handle`: 44px hit area, 36px visual circle, blue background, selected-node-only visibility.
- `.node-type-picker`: 320px width, two columns, edge-safe absolute position, 8px radius.
- `.draft-task-node`: 220px × 160px, fixed dimensions, `待配置` status, no layout shift.
- `.draft-edge`: blue 1.5px dashed line.
- reduced motion and `<768px` hiding rules.

- [ ] **Step 4: Run complete automated verification**

Run: `npm test && npm run build && git diff --check`

Expected: all tests pass, production build exits 0, and diff check prints nothing.

- [ ] **Step 5: Run browser interaction QA**

At `http://127.0.0.1:5173/` verify:

1. 1440×900: drag from the 44px source handle to center blank canvas; picker opens at release point with eight options.
2. Select 融图; the 220px × 160px draft node and blend panel appear without changing queue count.
3. Cancel; picker, draft, and temporary edge disappear.
4. Repeat and submit; one real job appears at the release point.
5. Repeat near every viewport edge; picker remains fully visible.
6. 1024×768: command bar, picker, minimap, and panel do not overlap.
7. 375×812: mobile preview contains no creation handle or picker.
8. Capture desktop, edge-drop, tablet, and mobile screenshots and confirm console error count is zero.

- [ ] **Step 6: Review and commit**

Run `git diff --check`, inspect `git diff`, and stage only the implementation files. Then commit:

```bash
git add src/styles.css tests/app.test.tsx
git commit -m "style: finish drag-to-create node experience"
```

# Fal Image Tool Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every simulated image tool in the PIAS canvas with a real Fal-backed workflow while keeping one stable business-node contract.

**Architecture:** Add pure per-profile input adapters behind one in-memory Fal orchestrator and one same-origin API. The browser prepares local image inputs, polls one local request ID, and writes normalized images back through the existing domain settlement functions.

**Tech Stack:** React 19, TypeScript 5.8, Vite 7 Connect middleware, Vitest, `@fal-ai/client` 1.10.1, React Flow.

## Global Constraints

- Fal credentials remain server-side and are read through `readFalKey`; no key, Data URI, or raw upstream error may enter logs or browser responses.
- Keep the eight existing `TaskProfileId` values and preserve existing scene/job/result lineage.
- Use `fal.queue.submit/status/result/cancel`; the browser must not block on a long-running Fal request.
- `remove`, `extract`, and `upscale` produce one result. Other workflows support 1, 2, or 4 results.
- Diagonal and eight-way light control must be labeled experimental because Fal exposes no strict eight-direction numeric endpoint.
- Automated tests use adapters, not paid Fal requests. Paid smoke tests run only after the automated suite is green.

---

### Task 1: Pure Fal Tool Adapters

**Files:**
- Create: `src/fal/toolWorkflows.ts`
- Test: `tests/falToolWorkflows.test.ts`
- Modify: `src/fal/multipleAngles.ts`

**Interfaces:**
- Consumes: `TaskProfileId`, `TaskParameters`, and `buildMultipleAnglesInput`.
- Produces: `FalToolRequest`, `FalInvocation`, `FalWorkflowPlan`, `buildFalWorkflowPlan(request)` and `normalizeFalResult(data)`.

- [ ] **Step 1: Write failing adapter tests**

Cover the exact model IDs and key mappings: Product Shot scene description/reference image, existing multiple angles fields, Fibo light instruction, Eraser mask, RMBG input, Expand canvas geometry, and Topaz factor/sharpen.

```ts
expect(buildFalWorkflowPlan({
  profileId: 'remove', imageUrls: ['source'], maskImageUrl: 'mask',
  prompt: '', ratio: '1:1', outputCount: 1, parameters: {},
}).invocations[0]).toEqual({
  modelId: 'fal-ai/bria/eraser',
  input: { image_url: 'source', mask_url: 'mask', mask_type: 'manual', preserve_alpha: true },
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/falToolWorkflows.test.ts`

Expected: FAIL because `toolWorkflows.ts` does not exist.

- [ ] **Step 3: Implement validated pure builders**

Use one request shape and keep all model-specific fields inside the module:

```ts
export type FalToolRequest = {
  profileId: TaskProfileId;
  imageUrls: string[];
  prompt: string;
  ratio: string;
  outputCount: number;
  parameters: Record<string, unknown>;
  maskImageUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type FalInvocation = { modelId: string; input: Record<string, unknown> };
export type FalWorkflowPlan = {
  modelId: string;
  invocations: FalInvocation[];
  upscaleFactors?: number[];
};
```

Generate exact-size maps and throw Chinese validation errors for missing source/reference/mask, unsupported ratios, invalid counts, no expansion area, and invalid upscale targets.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/falToolWorkflows.test.ts tests/falMultipleAngles.test.ts`

Expected: all adapter tests pass.

### Task 2: Unified Fal Orchestrator and HTTP Proxy

**Files:**
- Replace: `src/fal/falQueueService.ts`
- Replace: `src/fal/falProxyPlugin.ts`
- Modify: `vite.config.ts`
- Test: `tests/falQueueService.test.ts`
- Test: `tests/falProxyPlugin.test.ts`

**Interfaces:**
- Consumes: `buildFalWorkflowPlan` and a generic `FalQueueAdapter`.
- Produces: `createFalQueueService`, `submit(request)`, `status(localRequestId)`, `result(localRequestId)`, and `cancel(localRequestId)` on `/api/fal/jobs`.

- [ ] **Step 1: Replace angle-only tests with failing orchestration tests**

Test one native multi-result request, four Fibo child requests, partial success, aggregate progress, cancellation of all active children, and sequential Topaz stages.

```ts
const submitted = await service.submit(lightRequest({ outputCount: 4 }));
expect(adapter.submit).toHaveBeenCalledTimes(4);
expect(submitted.requestId).toMatch(/^fal-local-/);
expect(submitted.modelId).toBe('bria/fibo-edit/edit');
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/falQueueService.test.ts tests/falProxyPlugin.test.ts`

Expected: FAIL because the service still accepts only `MultipleAnglesRequest` and old routes.

- [ ] **Step 3: Implement the orchestrator**

Store local jobs in a `Map<string, LocalFalJob>` with generated IDs, child model/request IDs, status, errors, and optional sequential upscale factors. Normalize upstream shapes that return either `data.images[]` or `data.image`.

```ts
type LocalFalJob = {
  id: string;
  profileId: TaskProfileId;
  modelId: string;
  children: Array<{ modelId: string; requestId: string; status: 'queued' | 'running' | 'completed' }>;
  remainingUpscaleFactors: number[];
};
```

Expose only the unified routes and retain a compatibility redirect for the existing multiple-angle endpoint until the client migration in Task 3 is green.

- [ ] **Step 4: Run service tests and verify GREEN**

Run: `npm test -- tests/falQueueService.test.ts tests/falProxyPlugin.test.ts`

Expected: all queue and route tests pass without credentials in error messages.

### Task 3: Generic Browser Client

**Files:**
- Create: `src/fal/falImageClient.ts`
- Remove after migration: `src/fal/multipleAnglesClient.ts`
- Test: `tests/falImageClient.test.ts`
- Modify: `tests/multipleAnglesClient.test.ts`

**Interfaces:**
- Consumes: source/reference image URLs and optional mask Data URI.
- Produces: `runFalImageJob(input, options)`, `prepareImageUrlForFal`, and `cancelFalImageJob`.

- [ ] **Step 1: Write failing client tests**

Verify local `/demo-assets` conversion, public HTTPS passthrough, ordered source/reference roles, `/api/fal/jobs` submission, polling, normalized result, abort, and cancel.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/falImageClient.test.ts`

Expected: FAIL because the generic client does not exist.

- [ ] **Step 3: Implement the generic client**

Keep image preparation error copy profile-neutral and send the stable body:

```ts
body: JSON.stringify({
  profileId, imageUrls: preparedImages, prompt, ratio,
  outputCount, parameters, maskImageUrl, sourceWidth, sourceHeight,
})
```

- [ ] **Step 4: Run client tests and verify GREEN**

Run: `npm test -- tests/falImageClient.test.ts`

Expected: all client tests pass.

### Task 4: Domain Snapshot and Workbench Execution

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/workbench/Workbench.tsx`
- Modify: `src/workbench/ResultInspector.tsx`
- Test: `tests/domain.test.ts`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: `runFalImageJob` and unified model metadata.
- Produces: all eight profiles using the real queue path; no simulated scheduler remains.

- [ ] **Step 1: Add failing tests**

Add `maskImageUrl?: string` to `JobInputSnapshot`, ensure retry preserves it without copying it into result `parameters`, and assert generate/light/extract jobs call `/api/fal/jobs`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/domain.test.ts tests/workbench.test.tsx`

Expected: FAIL while non-angle jobs still use timers.

- [ ] **Step 3: Replace scheduler with one Fal effect**

Resolve the source image from the derived Scene, resolve ordered reference assets from `referenceAssetIds`, pass dimensions when known, attach the returned local request/model IDs, and settle normalized images through `completeJobWithResults`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/domain.test.ts tests/workbench.test.tsx`

Expected: all domain and workbench execution tests pass.

### Task 5: Functional Node Controls

**Files:**
- Modify: `src/workbench/ContextToolPanel.tsx`
- Modify: `src/workbench/CanvasOverlays.tsx`
- Modify: `src/workbench/CanvasNodes.tsx`
- Modify: `src/workbench/graph.ts`
- Modify: `src/workbench/interactionMachine.ts`
- Modify: `src/workbench/Workbench.tsx`
- Modify: `src/styles.css`
- Test: `tests/workbench.test.tsx`

**Interfaces:**
- Produces: valid Remove mask, interactive Expand anchor, model-honest output controls, and experimental light disclosure.

- [ ] **Step 1: Write failing interaction tests**

Assert Remove cannot submit before a stroke, clear resets the mask, Expand anchor writes `expandAnchor`, deterministic tools show one output, and Light shows the experimental note.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/workbench.test.tsx`

Expected: FAIL because mask and anchor interactions are absent.

- [ ] **Step 3: Implement controls and overlays**

Add a 512x512 black canvas that draws white round strokes and emits `toDataURL('image/png')`. Add nine anchor buttons to `ExpandOverlay`; map their values to `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`. Hide output/ratio controls where the endpoint cannot honor them.

- [ ] **Step 4: Run interaction tests and verify GREEN**

Run: `npm test -- tests/workbench.test.tsx`

Expected: workbench interaction tests pass at desktop and narrow layout sizes.

### Task 6: Documentation, Full Verification, and Real Smoke Tests

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-20-fal-image-tool-workflows.md`
- Create runtime evidence under: `/tmp/pias-fal-all-nodes-qa/`

- [ ] **Step 1: Document the model registry and local runtime**

Describe the eight profile routes, `FAL_KEY`/`FAL_KEY_FILE`, experimental light limitation, deterministic-node output limits, and paid smoke-test boundary.

- [ ] **Step 2: Run static and automated verification**

Run: `npm test && npm run build && npm audit --omit=dev`

Expected: all tests pass, TypeScript/Vite build exits 0, production audit reports zero vulnerabilities.

- [ ] **Step 3: Restart the Vite service**

Run: `npm run dev -- --port 5173`

Expected: `http://127.0.0.1:5173/` returns HTTP 200 and no key appears in HTML or JS assets.

- [ ] **Step 4: Run one-output paid smoke tests**

Execute generate, blend, angle, light, remove, extract, expand, and upscale using the current server API. Record request IDs, model IDs, dimensions, elapsed time, and downloaded outputs without recording credentials.

- [ ] **Step 5: Browser QA and screenshots**

Exercise node creation, tool parameter editing, queued/running/completed states, cancel/retry, and result details. Capture desktop and mobile screenshots under `/tmp/pias-fal-all-nodes-qa/` and inspect for overlap, clipping, missing images, and stale mock results.

- [ ] **Step 6: Final review**

Run `git diff --check`, inspect `git diff --stat` and changed files, scan for `FAL_KEY`, key-shaped strings, Data URIs, `setTimeout` simulation, and raw upstream errors. Fix findings, then rerun Step 2.

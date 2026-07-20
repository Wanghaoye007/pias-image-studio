# Fal 多角度节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 `angle` 工具升级为通过服务端安全调用 Fal 多角度模型、在画布生成真实结果的功能节点。

**Architecture:** 保留领域层 `angle` ID，在 `src/fal/` 内拆分共享接口映射、浏览器客户端和 Vite 服务端代理。Workbench 只负责根据任务类型选择模拟执行器或 Fal 执行器，领域层负责幂等结算和真实结果入库。

**Tech Stack:** React 19、TypeScript 5.8、Vite 7、Vitest、Testing Library、`@fal-ai/client`、React Flow。

## Global Constraints

- Fal 模型 ID 固定为 `fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles`。
- `angle` 工具 ID 保持不变，所有中文显示更新为「多角度」。
- Fal Key 只能在服务端从 `FAL_KEY`、`FAL_KEY_FILE` 或 `/Users/wangzipeng/Desktop/key.md` 读取。
- 浏览器、审计、错误响应和 Git 中不得出现 Fal Key 或输入图片 Data URI。
- 只有 `angle` 任务改用真实 Fal 执行；其他工具继续使用当前模拟执行器。
- 自动化测试不得进行付费 Fal 调用；最终验收只生成一张真实图片。
- 所有生产代码必须先有能够正确失败的测试。

---

### Task 1: Fal 输入契约与凭证解析

**Files:**
- Create: `src/fal/multipleAngles.ts`
- Create: `src/fal/falCredentials.ts`
- Test: `tests/falMultipleAngles.test.ts`

**Interfaces:**
- Produces: `buildMultipleAnglesInput(request): FalMultipleAnglesInput`
- Produces: `parseFalKey(raw): string`
- Produces: `readFalKey(options?): Promise<string>`
- Produces: `FAL_MULTIPLE_ANGLES_MODEL`

- [ ] **Step 1: Write failing mapping and key parsing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildMultipleAnglesInput, FAL_MULTIPLE_ANGLES_MODEL } from '../src/fal/multipleAngles';
import { parseFalKey } from '../src/fal/falCredentials';

describe('Fal multiple angles contract', () => {
  it('maps native workbench parameters to the official Fal input', () => {
    expect(FAL_MULTIPLE_ANGLES_MODEL).toBe('fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles');
    expect(buildMultipleAnglesInput({
      imageUrls: ['data:image/png;base64,AA=='], ratio: '4:5', outputCount: 2,
      parameters: { horizontalAngle: -45, moveForward: 4, verticalView: -0.5, wideAngle: true },
    })).toMatchObject({
      image_urls: ['data:image/png;base64,AA=='], image_size: { width: 1024, height: 1280 },
      num_images: 2, rotate_right_left: -45, move_forward: 4,
      vertical_angle: -0.5, wide_angle_lens: true, output_format: 'png',
    });
  });

  it('rejects empty images and out-of-range native values', () => {
    expect(() => buildMultipleAnglesInput({ imageUrls: [], ratio: '1:1', outputCount: 1, parameters: {} })).toThrow('输入图片');
    expect(() => buildMultipleAnglesInput({ imageUrls: ['x'], ratio: '1:1', outputCount: 5, parameters: {} })).toThrow('输出数量');
  });

  it('parses a bare key or FAL_KEY assignment without returning markdown', () => {
    expect(parseFalKey('FAL_KEY=abc:def\n')).toBe('abc:def');
    expect(parseFalKey('abc:def')).toBe('abc:def');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/falMultipleAngles.test.ts`
Expected: FAIL because the two source modules do not exist.

- [ ] **Step 3: Implement the contract and credential parser**

Implement strict numeric validation for `horizontalAngle [-180,180]`, `moveForward [0,10]`, `verticalView [-1,1]`, `outputCount [1,4]`, exact ratio sizes, stable official defaults, and a Key parser that accepts a bare line or `FAL_KEY=...` without logging it.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm test -- tests/falMultipleAngles.test.ts`
Expected: all Fal contract tests pass.

### Task 2: Server-side Fal queue proxy and browser client

**Files:**
- Create: `src/fal/falQueueService.ts`
- Create: `src/fal/falProxyPlugin.ts`
- Create: `src/fal/multipleAnglesClient.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/falQueueService.test.ts`
- Test: `tests/multipleAnglesClient.test.ts`

**Interfaces:**
- Produces: `createFalQueueService(adapter)` with `submit`, `status`, `result`, `cancel`
- Produces: `falMultipleAnglesProxyPlugin(): Plugin`
- Produces: `runMultipleAnglesJob(input, callbacks): Promise<FalMultipleAnglesResult>`

- [ ] **Step 1: Write failing service and client tests**

Test an injected queue adapter so no paid call occurs. Assert model ID, official input, normalized `queued/running/completed` status, sanitized Chinese errors, Data URI conversion for local assets, result retrieval, abort behavior, and cancellation route.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/falQueueService.test.ts tests/multipleAnglesClient.test.ts`
Expected: FAIL because service and client modules do not exist.

- [ ] **Step 3: Install the official client**

Run: `npm install @fal-ai/client && npm install -D @types/node`
Expected: dependency install exits 0 and lockfile records both packages.

- [ ] **Step 4: Implement the queue service and Vite middleware**

Use `fal.config({ credentials })`, `fal.queue.submit`, `fal.queue.status`, `fal.queue.result`, and `fal.queue.cancel` behind an adapter. Mount POST, GET status, GET result, and DELETE routes from both `configureServer` and `configurePreviewServer`. Limit request bodies and return JSON `{ error: { code, message } }` without upstream secrets.

- [ ] **Step 5: Implement the browser runner**

Convert same-origin/local image URLs to Data URI, submit once, poll until completion, call progress and request-ID callbacks, fetch results, and support `AbortSignal` plus best-effort DELETE cancellation.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `npm test -- tests/falQueueService.test.ts tests/multipleAnglesClient.test.ts`
Expected: all proxy and browser runner tests pass with no real network access.

### Task 3: Domain support for external execution and real images

**Files:**
- Modify: `src/domain.ts`
- Modify: `tests/domain.test.ts`

**Interfaces:**
- Produces: `attachExternalJob(state, jobId, externalExecution): StudioState`
- Produces: `completeJobWithResults(state, jobId, input): StudioState`
- Extends: `GenerationJob.externalExecution`
- Extends: `Result.generationMetadata`

- [ ] **Step 1: Write failing domain tests**

```ts
const queued = createJob(initialStudioState(), {
  sceneId: 'scene-source', profileId: 'angle', outputCount: 1,
  parameters: { horizontalAngle: 45, moveForward: 2, verticalView: 0, wideAngle: false },
});
const attached = attachExternalJob(queued, queued.jobs[0].id, {
  provider: 'fal', modelId: FAL_MULTIPLE_ANGLES_MODEL, requestId: 'req-1',
});
const settled = completeJobWithResults(attached, attached.jobs[0].id, {
  actualCredits: 22, seed: 123,
  images: [{ url: 'https://fal.media/result.png', width: 1024, height: 1280 }],
});
expect(settled.results[0]).toMatchObject({
  imageUrl: 'https://fal.media/result.png', width: 1024, height: 1280,
  generationMetadata: { provider: 'fal', requestId: 'req-1', seed: 123 },
});
```

Also assert output-count limits, no empty result settlement, terminal idempotency, credit release, and audit metadata without image payloads.

- [ ] **Step 2: Run focused domain tests and confirm RED**

Run: `npm test -- tests/domain.test.ts`
Expected: FAIL because real-result domain APIs are missing.

- [ ] **Step 3: Implement optional external metadata and shared settlement**

Refactor existing `completeJob` to call one internal settlement function. Keep demo image behavior unchanged, while `completeJobWithResults` validates and stores real image descriptors and trace metadata.

- [ ] **Step 4: Run domain tests and confirm GREEN**

Run: `npm test -- tests/domain.test.ts`
Expected: all old and new domain tests pass.

### Task 4: Upgrade the `angle` node UI to model-native controls

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/workbench/ContextToolPanel.tsx`
- Modify: `src/workbench/CanvasOverlays.tsx`
- Modify: `src/workbench/ResultInspector.tsx`
- Modify: `src/workbench/graph.ts`
- Modify: `src/workbench/Workbench.tsx`
- Modify: `src/styles.css`
- Modify: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: `verticalView`, `moveForward`, `wideAngle`
- Produces: accessible Chinese controls and Fal trace metadata in Result Inspector

- [ ] **Step 1: Write failing component tests**

Assert that the toolbar and drag picker show only 「多角度」, the dialog is named 「多角度参数」, prompt is absent for `angle`, sliders expose the correct ranges and values, the wide-angle switch updates the task snapshot, and the warning text is visible.

- [ ] **Step 2: Run the focused UI test and confirm RED**

Run: `npm test -- tests/workbench.test.tsx`
Expected: FAIL on the new Chinese labels and model-native controls.

- [ ] **Step 3: Implement the UI changes**

Rename the profile while retaining ID `angle`; update legacy operation localization; replace distance/degree pitch with native fields; add an accessible checkbox-style switch; hide the unsupported prompt for this tool; keep stable node dimensions and expose `Seed`, model ID and request ID only when metadata exists.

- [ ] **Step 4: Run UI tests and confirm GREEN**

Run: `npm test -- tests/workbench.test.tsx`
Expected: all component tests pass.

### Task 5: Connect `angle` jobs to the real Fal runner

**Files:**
- Modify: `src/workbench/Workbench.tsx`
- Modify: `tests/workbench.test.tsx`

**Interfaces:**
- Consumes: `runMultipleAnglesJob`, `attachExternalJob`, `completeJobWithResults`, `failJob`
- Produces: one real external execution per local angle Job with cancel and retry support

- [ ] **Step 1: Write failing execution tests**

Mock same-origin fetch responses for submit, running status, completed status and result. Submit a 「多角度」 task and assert: non-angle timer is not scheduled for it, request ID is attached, progress changes, a real URL result appears, and settling occurs once. Add failure and cancellation cases that assert no result and zero frozen credits.

- [ ] **Step 2: Run the execution tests and confirm RED**

Run: `npm test -- tests/workbench.test.tsx -t '多角度'`
Expected: FAIL because Workbench still routes `angle` through the demo timer.

- [ ] **Step 3: Implement the dedicated execution path**

Exclude `angle` from `scheduleJob`. Start the Fal runner once per queued angle job, resolve the correct Scene/Result source image, attach the external request, map status to progress, settle with real results, stop on terminal state, and issue best-effort remote cancellation from the existing cancel command.

- [ ] **Step 4: Run execution and regression tests**

Run: `npm test -- tests/workbench.test.tsx`
Expected: all Workbench tests pass, including existing StrictMode and simulated tool tests.

### Task 6: Full verification, real Fal call, browser review, and service update

**Files:**
- Modify only files required by findings from verification.
- Create screenshots under `/tmp/pias-fal-multiple-angles-qa/` rather than the repository.

**Interfaces:**
- Produces: verified service at `http://127.0.0.1:5173/`

- [ ] **Step 1: Run static and automated verification**

Run: `npm test && npm run build && git diff --check`
Expected: all tests pass, TypeScript/Vite build exits 0, and no whitespace errors are reported.

- [ ] **Step 2: Scan for credential leakage**

Run: `rg -n 'FAL_KEY|fal_[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{20,}' src tests vite.config.ts docs/superpowers/plans/2026-07-20-fal-multiple-angles-node.md`
Expected: only variable names and test placeholders appear; the real Key is absent.

- [ ] **Step 3: Start the updated service and make one real single-image call**

Restart Vite at `127.0.0.1:5173`, open the source Scene, choose 「多角度」, set one output and a visible horizontal rotation, then submit. Confirm the Fal request reaches completion and the returned image URL renders in a result node.

- [ ] **Step 4: Browser QA and screenshots**

Capture desktop and mobile screenshots of the parameter panel, running task and completed result. Inspect console/network errors, clipping, overlap, labels, controls, task transitions, result metadata and cancellation/retry paths. Fix issues and repeat the full test/build commands after any code change.

- [ ] **Step 5: Review the final diff and report**

Confirm only the integration files and plan/spec are changed, unrelated untracked directories remain untouched, the local URL returns HTTP 200, and the service process remains running for the user.

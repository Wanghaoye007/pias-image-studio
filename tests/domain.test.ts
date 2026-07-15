import { describe, expect, it } from 'vitest';
import {
  approveResult,
  cancelJob,
  completeJob,
  createBlankScene,
  createDerivedScene,
  createJob,
  createSceneFromAsset,
  deleteScene,
  duplicateScene,
  failJob,
  getProfile,
  initialStudioState,
  moveCanvasItem,
  renameScene,
  returnResult,
  submitForReview,
  updateJobProgress,
} from '../src/domain';

describe('Image Studio domain flow', () => {
  it('freezes estimated usage when a generation job is accepted', () => {
    const state = initialStudioState();

    const next = createJob(state, {
      sceneId: 'scene-source',
      profileId: 'blend',
      outputCount: 4,
    });

    expect(next.jobs.at(-1)).toMatchObject({
      status: 'queued',
      sceneId: 'scene-source',
      profileId: 'blend',
      reservedCredits: 72,
      inputSnapshot: {
        inputKind: 'scene',
        inputNodeId: 'scene-source',
        prompt: '',
        ratio: '1:1',
        parameters: {},
        referenceAssetIds: ['asset-main'],
      },
    });
    expect(next.usage.availableCredits).toBe(1928);
    expect(next.usage.frozenCredits).toBe(72);
  });

  it('settles actual usage, creates results, and releases unused reserve on completion', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 4,
    });
    const jobId = queued.jobs[0].id;

    const settled = completeJob(queued, jobId, {
      successfulOutputs: 3,
      actualCredits: 45,
    });

    expect(settled.jobs[0]).toMatchObject({ status: 'succeeded', actualCredits: 45 });
    expect(settled.scenes.find((scene) => scene.id === 'scene-source')?.resultIds).toHaveLength(3);
    expect(settled.usage.frozenCredits).toBe(0);
    expect(settled.usage.spentCredits).toBe(45);
    expect(settled.usage.availableCredits).toBe(1955);
  });

  it('uses automatic coordinates and keeps the source scene image after completion', () => {
    const source = initialStudioState().scenes[0];
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 2,
    });

    expect(queued.jobs[0]).toMatchObject({ x: source.x + 320, y: source.y + 24 });

    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 2,
      actualCredits: 30,
    });
    const results = settled.results;

    expect(results[0]).toMatchObject({ x: queued.jobs[0].x + 280, y: queued.jobs[0].y });
    expect(results[1]).toMatchObject({ x: queued.jobs[0].x + 500, y: queued.jobs[0].y });
    expect(settled.scenes[0].imageUrl).toBe(source.imageUrl);

    const derived = createDerivedScene(settled, {
      parentSceneId: 'scene-source',
      sourceResultId: results[0].id,
      operation: '定向光',
    });
    expect(derived.scenes.at(-1)).toMatchObject({
      x: results[0].x,
      y: source.y + 324,
    });
  });

  it('keeps lineage when a result is used to derive a new scene', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'light',
      outputCount: 2,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1,
      actualCredits: 28,
    });
    const sourceResultId = settled.results[0].id;

    const derived = createDerivedScene(settled, {
      parentSceneId: 'scene-source',
      sourceResultId,
      operation: 'Directional Light',
    });

    expect(derived.scenes.at(-1)).toMatchObject({
      parentSceneId: 'scene-source',
      sourceResultId,
      operation: 'Directional Light',
      status: 'draft',
    });
    expect(derived.edges.at(-1)).toMatchObject({
      source: sourceResultId,
      target: derived.scenes.at(-1)?.id,
      label: 'Directional Light',
    });
  });

  it('stores an immutable generation input and parameter snapshot', () => {
    const sourceJob = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const settled = completeJob(sourceJob, sourceJob.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    const sourceResultId = settled.results[0].id;
    const branch = createDerivedScene(settled, {
      parentSceneId: 'scene-source', sourceResultId, operation: '融图',
    });
    const next = createJob(branch, {
      sceneId: branch.scenes.at(-1)!.id,
      profileId: 'blend',
      outputCount: 2,
      inputKind: 'result',
      inputNodeId: sourceResultId,
      sourceResultId,
      prompt: '保留瓶身轮廓，融入水面反光',
      ratio: '4:5',
      parameters: { blendStrength: 65 },
      referenceAssetIds: ['asset-scene'],
    });

    expect(next.jobs.at(-1)!.inputSnapshot).toEqual({
      inputKind: 'result',
      inputNodeId: sourceResultId,
      sourceResultId,
      prompt: '保留瓶身轮廓，融入水面反光',
      ratio: '4:5',
      parameters: { blendStrength: 65 },
      referenceAssetIds: ['asset-scene'],
      sourceAssetId: 'asset-main',
      sourceAssetVersion: 'v3',
    });
  });

  it('keeps concurrent jobs in separate lanes and derives scene status from every active job', () => {
    const first = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const second = createJob(first, {
      sceneId: 'scene-source', profileId: 'light', outputCount: 1,
    });

    expect(second.jobs[0].y).not.toBe(second.jobs[1].y);

    const firstRunning = updateJobProgress(second, second.jobs[0].id, 58);
    const firstDone = completeJob(firstRunning, firstRunning.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    expect(firstDone.scenes[0].status).toBe('queued');

    const secondRunning = updateJobProgress(firstDone, firstDone.jobs[1].id, 58);
    expect(secondRunning.scenes[0].status).toBe('running');

    const secondFailed = failJob(secondRunning, secondRunning.jobs[1].id, '服务暂时不可用');
    expect(secondFailed.scenes[0].status).toBe('failed');
  });

  it('reserves a new lane when a parent scene already has a derived branch', () => {
    const first = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const settled = completeJob(first, first.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    const branched = createDerivedScene(settled, {
      parentSceneId: 'scene-source', sourceResultId: settled.results[0].id, operation: '定向光',
    });
    const second = createJob(branched, {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });

    expect(branched.scenes.at(-1)!.y).toBe(first.jobs[0].y + 300);
    expect(second.jobs.at(-1)!.y).toBe(branched.scenes.at(-1)!.y + 300);
  });

  it('treats zero successful outputs as failure and releases the full reserve', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 2,
    });

    const failed = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 0, actualCredits: 15,
    });

    expect(failed.jobs[0]).toMatchObject({
      status: 'failed',
      errorMessage: '任务未生成可用结果',
    });
    expect(failed.results).toHaveLength(0);
    expect(failed.usage).toMatchObject({ availableCredits: 2000, frozenCredits: 0, spentCredits: 0 });
  });

  it('allows a submitted result to be returned with a reason and resubmitted', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    const resultId = settled.results[0].id;
    const submitted = submitForReview(settled, resultId);
    const returned = returnResult(submitted, resultId, '青井审核员', '瓶身高光过强');

    expect(returned.results[0]).toMatchObject({
      reviewStatus: 'returned',
      reviewedBy: '青井审核员',
      reviewComment: '瓶身高光过强',
    });
    expect(returned.auditEvents.at(-1)?.type).toBe('review.returned');

    const resubmitted = submitForReview(returned, resultId);
    expect(resubmitted.results[0]).toMatchObject({
      reviewStatus: 'submitted',
      reviewComment: undefined,
    });
  });

  it('moves a selected result through review approval without changing lineage', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'upscale',
      outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1,
      actualCredits: 12,
    });
    const resultId = settled.results[0].id;

    const submitted = submitForReview(settled, resultId);
    const approved = approveResult(submitted, resultId, 'Reviewer A');

    expect(approved.results[0]).toMatchObject({
      reviewStatus: 'approved',
      approvedBy: 'Reviewer A',
    });
    expect(approved.auditEvents.at(-1)?.type).toBe('review.approved');
    expect(approved.results[0].sourceSceneId).toBe('scene-source');
  });

  it('enforces the draft to submitted to approved review state machine', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1,
      actualCredits: 15,
    });
    const resultId = settled.results[0].id;

    expect(() => approveResult(settled, resultId, 'Reviewer A')).toThrow('已提交');

    const submitted = submitForReview(settled, resultId);
    expect(() => submitForReview(submitted, resultId)).toThrow('草稿');
  });

  it('rejects completion inputs outside the requested output and reserve ranges', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 2,
    });
    const jobId = queued.jobs[0].id;

    expect(() => completeJob(queued, jobId, { successfulOutputs: 3, actualCredits: 30 })).toThrow('产出数量');
    expect(() => completeJob(queued, jobId, { successfulOutputs: 1, actualCredits: -1 })).toThrow('额度');
    expect(() => completeJob(queued, jobId, { successfulOutputs: 1, actualCredits: 31 })).toThrow('额度');
    expect(queued.jobs[0].status).toBe('queued');
    expect(queued.usage.availableCredits).toBe(1970);
    expect(queued.usage.frozenCredits).toBe(30);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid output count %s without changing state',
    (outputCount) => {
      const state = initialStudioState();
      const before = structuredClone(state);

      expect(() => createJob(state, {
        sceneId: 'scene-source', profileId: 'generate', outputCount,
      })).toThrow('正整数');
      expect(state).toEqual(before);
    },
  );

  it.each(['succeeded', 'failed', 'canceled'] as const)('rejects every repeated settlement after %s', (terminalStatus) => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const jobId = queued.jobs[0].id;
    const terminal = terminalStatus === 'succeeded'
      ? completeJob(queued, jobId, { successfulOutputs: 1, actualCredits: 15 })
      : terminalStatus === 'failed'
        ? failJob(queued, jobId, '服务暂时不可用')
        : cancelJob(queued, jobId);
    const usageBefore = terminal.usage;
    const auditCountBefore = terminal.auditEvents.length;

    expect(() => completeJob(terminal, jobId, { successfulOutputs: 0, actualCredits: 0 })).toThrow('重复');
    expect(() => failJob(terminal, jobId, '再次失败')).toThrow('重复');
    expect(() => cancelJob(terminal, jobId)).toThrow('重复');
    expect(terminal.usage).toEqual(usageBefore);
    expect(terminal.auditEvents).toHaveLength(auditCountBefore);
  });

  it.each(['succeeded', 'failed', 'canceled'] as const)(
    'ignores late progress events after a %s job settlement',
    (terminalStatus) => {
      const queued = createJob(initialStudioState(), {
        sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
      });
      const jobId = queued.jobs[0].id;
      const terminal = terminalStatus === 'succeeded'
        ? completeJob(queued, jobId, { successfulOutputs: 1, actualCredits: 15 })
        : terminalStatus === 'failed'
          ? failJob(queued, jobId, '服务暂时不可用')
          : cancelJob(queued, jobId);

      expect(updateJobProgress(terminal, jobId, 48)).toEqual(terminal);
    },
  );

  it('stores manual positions for scenes, jobs, and results', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source',
      profileId: 'generate',
      outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1,
      actualCredits: 15,
    });

    const movedScene = moveCanvasItem(settled, {
      kind: 'scene', id: 'scene-source', position: { x: 120, y: 80 },
    });
    const movedJob = moveCanvasItem(movedScene, {
      kind: 'job', id: settled.jobs[0].id, position: { x: 500, y: 140 },
    });
    const movedResult = moveCanvasItem(movedJob, {
      kind: 'result', id: settled.results[0].id, position: { x: 820, y: 180 },
    });

    expect(movedResult.scenes[0]).toMatchObject({ x: 120, y: 80 });
    expect(movedResult.jobs[0]).toMatchObject({ x: 500, y: 140 });
    expect(movedResult.results[0]).toMatchObject({ x: 820, y: 180 });
  });

  it('defines Chinese labels for every workbench tool', () => {
    expect(getProfile('generate').label).toBe('生成');
    expect(getProfile('blend').label).toBe('融图');
    expect(getProfile('angle').label).toBe('快速视角');
    expect(getProfile('remove').label).toBe('去除');
    expect(getProfile('extract').label).toBe('抠图');
    expect(getProfile('light').label).toBe('定向光');
    expect(getProfile('expand').label).toBe('扩图');
    expect(getProfile('upscale').label).toBe('超分');
  });

  it.each(['failed', 'canceled'] as const)('releases reserved credits when a job is %s', (status) => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'blend', outputCount: 2,
    });
    const settled = status === 'failed'
      ? failJob(queued, queued.jobs[0].id, '服务暂时不可用')
      : cancelJob(queued, queued.jobs[0].id);

    expect(settled.jobs[0].status).toBe(status);
    expect(settled.usage.availableCredits).toBe(2000);
    expect(settled.usage.frozenCredits).toBe(0);
  });

  it('creates a source scene when an asset is dropped on the canvas', () => {
    const state = initialStudioState();
    expect(state.assets.map((asset) => asset.product)).toEqual([
      '精华粉底', '护肤套装', '活动参考',
    ]);

    const next = createSceneFromAsset(state, {
      assetId: 'asset-pack', position: { x: 420, y: 260 },
    });
    expect(next.scenes.at(-1)).toMatchObject({
      title: '护肤套装',
      skuCode: 'PIAS-SK-014',
      x: 420,
      y: 260,
      status: 'source',
      sourceAssetId: 'asset-pack',
      sourceAssetVersion: 'v1',
    });
  });

  it('creates an empty draft scene at the requested canvas position', () => {
    const next = createBlankScene(initialStudioState(), {
      position: { x: 540, y: 320 },
    });

    expect(next.scenes.at(-1)).toMatchObject({
      id: 'scene-2',
      title: '未命名场景',
      skuCode: '未绑定 SKU',
      operation: '空白场景',
      status: 'draft',
      x: 540,
      y: 320,
      imageUrl: '',
      resultIds: [],
    });
    expect(next.selectedSceneId).toBe('scene-2');
  });

  it('duplicates a scene as an independent draft without copying jobs, results, or lineage', () => {
    const state = initialStudioState();
    const next = duplicateScene(state, 'scene-source');

    expect(next.scenes.at(-1)).toMatchObject({
      id: 'scene-2',
      title: '源场景 副本',
      status: 'draft',
      x: 48,
      y: 88,
      imageUrl: state.scenes[0].imageUrl,
      resultIds: [],
      sourceAssetId: 'asset-main',
    });
    expect(next.scenes.at(-1)).not.toHaveProperty('parentSceneId');
    expect(next.scenes.at(-1)).not.toHaveProperty('sourceResultId');
    expect(next.jobs).toHaveLength(0);
    expect(next.results).toHaveLength(0);
    expect(next.edges).toHaveLength(0);
  });

  it('renames a scene with trimmed Chinese text and rejects an empty title', () => {
    const renamed = renameScene(initialStudioState(), 'scene-source', '  夏季主视觉  ');

    expect(renamed.scenes[0].title).toBe('夏季主视觉');
    expect(() => renameScene(renamed, 'scene-source', '   ')).toThrow('场景名称不能为空');
  });

  it('deletes only an unused scene and protects scenes with jobs or downstream content', () => {
    const withBlank = createBlankScene(initialStudioState(), { position: { x: 420, y: 260 } });
    const deleted = deleteScene(withBlank, 'scene-2');

    expect(deleted.scenes.map((scene) => scene.id)).toEqual(['scene-source']);
    expect(deleted.selectedSceneId).toBe('scene-source');

    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    expect(() => deleteScene(queued, 'scene-source')).toThrow('已有任务或下游内容');
  });

  it('does not reuse a deleted scene id recorded by the audit trail', () => {
    const withBlank = createBlankScene(initialStudioState(), { position: { x: 420, y: 260 } });
    const deleted = deleteScene(withBlank, 'scene-2');
    const recreated = createBlankScene(deleted, { position: { x: 520, y: 320 } });

    expect(recreated.scenes.at(-1)?.id).toBe('scene-3');
    expect(recreated.auditEvents.map((event) => event.targetId)).toContain('scene-2');
  });

  it('stores the Chinese failure reason on a failed job', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'blend', outputCount: 1,
    });

    const failed = failJob(queued, queued.jobs[0].id, '服务暂时不可用');

    expect(failed.jobs[0]).toMatchObject({
      status: 'failed',
      errorMessage: '服务暂时不可用',
    });
  });

  it('rejects a derived scene when the result or its task belongs to another scene', () => {
    const first = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const firstSettled = completeJob(first, first.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    const withSecondScene = createSceneFromAsset(firstSettled, {
      assetId: 'asset-pack', position: { x: 420, y: 260 },
    });
    const second = createJob(withSecondScene, {
      sceneId: withSecondScene.scenes.at(-1)!.id,
      profileId: 'blend',
      outputCount: 1,
    });
    const secondSettled = completeJob(second, second.jobs.at(-1)!.id, {
      successfulOutputs: 1, actualCredits: 18,
    });

    expect(() => createDerivedScene(secondSettled, {
      parentSceneId: 'scene-source',
      sourceResultId: secondSettled.results.at(-1)!.id,
      operation: '定向光',
    })).toThrow('归属');
  });

  it('uses Chinese messages for invalid domain operations', () => {
    expect(() => getProfile('missing' as never)).toThrow('未知任务工具');
    expect(() => createJob(initialStudioState(), {
      sceneId: 'missing', profileId: 'generate', outputCount: 1,
    })).toThrow('场景不存在');
    expect(() => createSceneFromAsset(initialStudioState(), {
      assetId: 'missing', position: { x: 0, y: 0 },
    })).toThrow('素材不存在');
  });
});

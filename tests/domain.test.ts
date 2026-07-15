import { describe, expect, it } from 'vitest';
import {
  approveResult,
  cancelJob,
  completeJob,
  createDerivedScene,
  createJob,
  createSceneFromAsset,
  failJob,
  getProfile,
  initialStudioState,
  moveCanvasItem,
  submitForReview,
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
      source: 'scene-source',
      target: derived.scenes.at(-1)?.id,
      label: 'Directional Light',
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

    expect(() => approveResult(settled, resultId, 'Reviewer A')).toThrow('submitted');

    const submitted = submitForReview(settled, resultId);
    expect(() => submitForReview(submitted, resultId)).toThrow('draft');
  });

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
    const next = createSceneFromAsset(initialStudioState(), {
      assetId: 'asset-pack', position: { x: 420, y: 260 },
    });
    expect(next.scenes.at(-1)).toMatchObject({
      skuCode: 'PIAS-SK-014', x: 420, y: 260, status: 'source',
    });
  });
});

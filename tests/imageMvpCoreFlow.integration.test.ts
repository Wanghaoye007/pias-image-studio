import { describe, expect, it } from 'vitest';
import {
  addAsset,
  approveResult,
  attachExternalJob,
  completeJobWithResults,
  createDerivedScene,
  createJob,
  createSceneFromAsset,
  initialStudioState,
  recordResultExport,
  submitForReview,
  toggleResultAdoption,
  type StudioState,
} from '../src/shared/domain';

describe('图片工作台 MVP 核心链路集成验收', () => {
  it('从上传、生成、继续生成到采用、审核、下载和用量记录保持完整血缘', () => {
    let state: StudioState = { ...initialStudioState(), assets: [], scenes: [], selectedSceneId: '' };
    state = addAsset(state, {
      brand: 'Content Studio', product: '发布验收商品', skuCode: 'MVP-001',
      usage: '商品主图', version: 'v1', imageUrl: '/api/assets/images/mvp-source.png',
    });
    const sourceAsset = state.assets[0];
    state = createSceneFromAsset(state, { assetId: sourceAsset.id, position: { x: 0, y: 40 } });
    const sourceScene = state.scenes[0];
    state = createJob(state, {
      sceneId: sourceScene.id, profileId: 'generate', outputCount: 1,
      prompt: '生成干净的电商主图', ratio: '1:1',
    });
    state = attachExternalJob(state, state.jobs[0].id, {
      provider: 'fal', modelId: 'provider-model', requestId: 'provider-request-1',
    });
    state = completeJobWithResults(state, state.jobs[0].id, {
      actualCredits: 15,
      images: [{ url: 'https://fal.media/mvp-result-1.png', width: 1024, height: 1024 }],
    });
    const firstResult = state.results[0];

    state = createDerivedScene(state, {
      parentSceneId: sourceScene.id, sourceResultId: firstResult.id, operation: '修改光影',
    });
    const derivedScene = state.scenes.at(-1)!;
    state = createJob(state, {
      sceneId: derivedScene.id, profileId: 'light', outputCount: 1,
      inputKind: 'result', inputNodeId: firstResult.id, sourceResultId: firstResult.id,
      prompt: '增加柔和侧光',
    });
    const derivedJob = state.jobs.at(-1)!;
    state = attachExternalJob(state, derivedJob.id, {
      provider: 'fal', modelId: 'provider-model-2', requestId: 'provider-request-2',
    });
    state = completeJobWithResults(state, derivedJob.id, {
      actualCredits: 14,
      images: [{ url: 'https://fal.media/mvp-result-2.png', width: 1024, height: 1024 }],
    });
    const adoptedResult = state.results.at(-1)!;
    state = toggleResultAdoption(state, adoptedResult.id, 'creator-1');
    state = submitForReview(state, adoptedResult.id, 'creator-1');
    state = approveResult(state, adoptedResult.id, 'reviewer-1');
    state = recordResultExport(state, adoptedResult.id, 'creator-1', {
      format: 'png', size: 'original', includeManifestCsv: true, includeManifestJson: true,
    });

    expect(derivedScene).toMatchObject({
      parentSceneId: sourceScene.id,
      sourceResultId: firstResult.id,
      sourceAssetId: sourceAsset.id,
    });
    expect(derivedJob.inputSnapshot).toMatchObject({
      inputKind: 'result', sourceResultId: firstResult.id, sourceAssetId: sourceAsset.id,
    });
    expect(state.results.at(-1)).toMatchObject({
      id: adoptedResult.id, isAdopted: true, reviewStatus: 'approved', approvedBy: 'reviewer-1',
    });
    expect(state.usage).toMatchObject({ availableCredits: 1971, frozenCredits: 0, spentCredits: 29 });
    expect(state.usageLedger.map((entry) => entry.entryType)).toEqual([
      'reserve', 'charge', 'release', 'reserve', 'charge', 'release',
    ]);
    expect(state.auditEvents.map((event) => event.type)).toContain('result.exported');
  });
});

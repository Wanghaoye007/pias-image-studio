import { describe, expect, it } from 'vitest';
import {
  buildManifestArtifacts,
  resolveOutputDimensions,
  serializeManifestCsv,
} from '../src/client/export/exportDelivery';
import {
  approveResult,
  completeJob,
  createJob,
  initialStudioState,
  submitForReview,
} from '../src/shared/domain';

describe('production delivery artifacts', () => {
  it('never upscales while honoring the selected maximum edge', () => {
    expect(resolveOutputDimensions(2048, 1024, '1080')).toEqual({ width: 1080, height: 540 });
    expect(resolveOutputDimensions(512, 512, '2048')).toEqual({ width: 512, height: 512 });
    expect(resolveOutputDimensions(1200, 800, 'original')).toEqual({ width: 1200, height: 800 });
  });

  it('serializes traceable CSV and requested manifest files', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const settled = completeJob(queued, queued.jobs[0].id, {
      successfulOutputs: 1, actualCredits: 15,
    });
    const approved = approveResult(submitForReview(settled, 'result-1'), 'result-1', '青井审核员');
    const spec = {
      format: 'webp' as const,
      size: '1080' as const,
      includeManifestCsv: true,
      includeManifestJson: true,
    };
    const artifacts = buildManifestArtifacts(
      approved,
      approved.results[0],
      spec,
      'content-studio-result.webp',
    );

    expect(artifacts.map((artifact) => artifact.filename)).toEqual([
      'content-studio-result_manifest.csv',
      'content-studio-result_manifest.json',
    ]);
    expect(artifacts[0].content).toContain('resultId,skuCode,dimensions,operation,generatedAt,reviewStatus');
    expect(artifacts[0].content).toContain('result-1,AST-SF-001,2048x2048');
    expect(JSON.parse(artifacts[1].content)).toMatchObject({
      exportSpec: spec,
      results: [{ resultId: 'result-1', reviewStatus: 'approved' }],
    });
    expect(serializeManifestCsv([{ resultId: 'a,b', skuCode: 'SKU', dimensions: '1x1', operation: '生成', generatedAt: '', reviewStatus: 'approved' }]))
      .toContain('"a,b"');
  });
});

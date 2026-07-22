import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultInspector } from '../src/client/workbench/ResultInspector';
import {
  attachExternalJob,
  completeJobWithResults,
  createDerivedScene,
  createJob,
  initialStudioState,
} from '../src/shared/domain';

const callbacks = {
  onClose: vi.fn(),
  onDownloadPreview: vi.fn(),
  onOpenExport: vi.fn(),
  onQualityIssue: vi.fn(),
  onSetPrimary: vi.fn(),
  onSubmitReview: vi.fn(),
  onWithdrawReview: vi.fn(),
  onReviseResult: vi.fn(),
  onToggleAdoption: vi.fn(),
  onToggleFavorite: vi.fn(),
};

describe('结果血缘详情', () => {
  it('展示原始图片和父级结果，默认不暴露底层模型名称', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const attached = attachExternalJob(queued, queued.jobs[0].id, {
      provider: 'fal', modelId: 'fal-ai/private-model-id', requestId: 'request-source',
    });
    const settled = completeJobWithResults(attached, attached.jobs[0].id, {
      actualCredits: 15,
      images: [{ url: 'https://fal.media/source-result.png', width: 1024, height: 1024 }],
    });
    const parentResult = settled.results[0];
    const branched = createDerivedScene(settled, {
      parentSceneId: 'scene-source', sourceResultId: parentResult.id, operation: '修改光影',
    });
    const scene = branched.scenes.at(-1)!;
    const nextQueued = createJob(branched, {
      sceneId: scene.id,
      profileId: 'light',
      outputCount: 1,
      inputKind: 'result',
      inputNodeId: parentResult.id,
      sourceResultId: parentResult.id,
    });
    const nextJob = nextQueued.jobs.at(-1)!;
    const nextAttached = attachExternalJob(nextQueued, nextJob.id, {
      provider: 'fal', modelId: 'fal-ai/another-private-model', requestId: 'request-child',
    });
    const completed = completeJobWithResults(nextAttached, nextJob.id, {
      actualCredits: 14,
      images: [{ url: 'https://fal.media/child-result.png', width: 1024, height: 1024 }],
    });
    const result = completed.results.at(-1)!;

    render(<ResultInspector
      {...callbacks}
      job={completed.jobs.at(-1)!}
      parentResult={parentResult}
      result={result}
      scene={completed.scenes.at(-1)!}
      sourceAsset={completed.assets.find((asset) => asset.id === 'asset-main')}
    />);

    expect(screen.getByText('精华粉底 / v3')).toBeInTheDocument();
    expect(screen.getByText(parentResult.title)).toBeInTheDocument();
    expect(screen.getByText('修改光影')).toBeInTheDocument();
    expect(screen.queryByText('fal-ai/another-private-model')).not.toBeInTheDocument();
    expect(screen.queryByText('模型')).not.toBeInTheDocument();
  });
});

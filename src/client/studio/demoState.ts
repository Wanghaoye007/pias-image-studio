import {
  approveResult,
  completeJob,
  createDerivedScene,
  createJob,
  initialStudioState,
  submitForReview,
  type StudioState,
} from '../../shared/domain';
import type { OrganizationProject } from '../../shared/organization/types';

export function createBlankProjectStudioState(
  project: Pick<OrganizationProject, 'name'> & Partial<Pick<OrganizationProject, 'defaultSku'>>,
): StudioState {
  const base = initialStudioState();
  return {
    ...base,
    projectName: project.name,
    selectedSceneId: 'scene-source',
    assets: [],
    scenes: [{
      id: 'scene-source',
      title: '未命名场景',
      skuCode: project.defaultSku ?? '',
      operation: '空白场景',
      status: 'draft',
      x: 0,
      y: 40,
      imageUrl: '',
      resultIds: [],
    }],
    edges: [],
    jobs: [],
    results: [],
    auditEvents: [],
    notifications: [],
  };
}

export function createDemoStudioState(): StudioState {
  const base = initialStudioState();
  const withGenerate = createJob(base, { sceneId: 'scene-source', profileId: 'generate', outputCount: 4 });
  const settled = completeJob(withGenerate, withGenerate.jobs[0].id, {
    successfulOutputs: 3,
    actualCredits: 45,
  });
  const derived = createDerivedScene(settled, {
    parentSceneId: 'scene-source',
    sourceResultId: settled.results[0].id,
    operation: '融图',
  });
  const withPendingReviews = submitForReview(
    submitForReview(derived, settled.results[0].id),
    settled.results[1].id,
  );
  return approveResult(withPendingReviews, settled.results[1].id, '青井审核员');
}

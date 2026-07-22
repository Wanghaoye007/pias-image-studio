import { describe, expect, it } from 'vitest';
import { completeJob, createJob, initialStudioState, submitForReview } from '../src/domain';
import {
  parseStudioState,
  StudioStateValidationError,
} from '../src/studio/studioStateSchema';

function populatedState() {
  const queued = createJob(initialStudioState(), {
    sceneId: 'scene-source',
    profileId: 'generate',
    outputCount: 1,
  });
  return completeJob(queued, queued.jobs[0].id, {
    successfulOutputs: 1,
    actualCredits: 15,
  });
}

describe('StudioState runtime schema', () => {
  it('accepts a complete populated StudioState without changing it', () => {
    const state = populatedState();

    expect(parseStudioState(structuredClone(state))).toEqual(state);
  });

  it('round-trips a role-scoped review notification and rejects ambiguous recipients', () => {
    const state = populatedState();
    const submitted = submitForReview(state, state.results[0].id, 'user-creator');

    expect(parseStudioState(structuredClone(submitted)).notifications.at(-1)).toMatchObject({
      type: 'review.submitted',
      recipientRole: 'reviewer',
    });
    const invalid = structuredClone(submitted);
    invalid.notifications[0].recipientUserId = 'user-creator';
    expect(() => parseStudioState(invalid)).toThrow('必须且只能指定一种通知收件人');
  });

  it('rejects missing required collections with a safe field path', () => {
    const state = initialStudioState() as unknown as Record<string, unknown>;
    delete state.scenes;

    expect(() => parseStudioState(state)).toThrowError(StudioStateValidationError);
    expect(() => parseStudioState(state)).toThrowError('state.scenes');
  });

  it.each([
    ['job status', (state: ReturnType<typeof populatedState>) => { state.jobs[0].status = 'unknown' as never; }, 'state.jobs[0].status'],
    ['review status', (state: ReturnType<typeof populatedState>) => { state.results[0].reviewStatus = 'unknown' as never; }, 'state.results[0].reviewStatus'],
    ['task profile', (state: ReturnType<typeof populatedState>) => { state.jobs[0].profileId = 'unknown' as never; }, 'state.jobs[0].profileId'],
  ])('rejects an invalid %s enum', (_label, mutate, field) => {
    const state = populatedState();
    mutate(state);

    expect(() => parseStudioState(state)).toThrowError(field);
  });

  it.each([
    'preflight',
    'queued',
    'running',
    'postprocessing',
    'partially_succeeded',
    'cancel_requested',
    'succeeded',
    'failed',
    'canceled',
    'expired',
  ] as const)('accepts the production job status %s', (status) => {
    const state = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    state.jobs[0].status = status;

    expect(parseStudioState(state).jobs[0].status).toBe(status);
  });

  it.each([
    ['negative available credits', -1],
    ['non-finite available credits', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, value) => {
    const state = populatedState();
    state.usage.availableCredits = value;

    expect(() => parseStudioState(state)).toThrowError('state.usage.availableCredits');
  });

  it('rejects malformed nested records', () => {
    const state = populatedState() as unknown as { results: Array<Record<string, unknown>> };
    state.results[0].generationMetadata = {
      provider: 'fal',
      modelId: '',
      requestId: 'req-1',
      parameters: {},
    };

    expect(() => parseStudioState(state)).toThrowError('state.results[0].generationMetadata.modelId');
  });
});

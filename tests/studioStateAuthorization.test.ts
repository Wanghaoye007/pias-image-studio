import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/auth/authPolicy';
import {
  approveResult,
  completeJob,
  createJob,
  failJob,
  initialStudioState,
  rejectResult,
  submitForReview,
  withdrawReview,
} from '../src/domain';
import {
  authorizeStudioStateWrite,
  StudioStateCommandError,
} from '../src/studio/studioStateAuthorization';

const scope = { tenantId: 'tenant-a', projectId: 'project-a' };

function context(role: AuthContext['role'], userId: string): AuthContext {
  return {
    userId,
    tenantId: scope.tenantId,
    role,
    projectIds: [scope.projectId],
    mfaVerified: role === 'owner' || role === 'admin',
  };
}

function stateWithDraftResult() {
  const created = createJob(initialStudioState(), {
    sceneId: 'scene-source',
    profileId: 'generate',
    outputCount: 1,
  });
  return completeJob(created, created.jobs[0].id, {
    successfulOutputs: 1,
    actualCredits: 15,
  });
}

describe('StudioState command authorization', () => {
  it('allows a creator to submit review and replaces an untrusted audit actor', () => {
    const previous = stateWithDraftResult();
    const requested = submitForReview(previous, previous.results[0].id);
    requested.auditEvents.at(-1)!.actor = 'forged-owner';

    const authorized = authorizeStudioStateWrite({
      context: context('creator', 'user-creator'),
      scope,
      previous,
      requested,
    });

    expect(authorized.results[0].reviewStatus).toBe('submitted');
    expect(authorized.auditEvents.at(-1)?.actor).toBe('user-creator');
    expect(authorized.notifications.at(-1)).toMatchObject({
      type: 'review.submitted',
      recipientRole: 'reviewer',
    });
  });

  it('rejects changes to the actor of a persisted audit event', () => {
    const previous = stateWithDraftResult();
    const requested = structuredClone(previous);
    requested.auditEvents[0].actor = 'forged-owner';

    expect(() => authorizeStudioStateWrite({
      context: context('creator', 'user-creator'),
      scope,
      previous,
      requested,
    })).toThrow(expect.objectContaining({ code: 'STUDIO_AUDIT_IMMUTABLE' }));
  });

  it('rejects a creator attempting to approve a submitted result', () => {
    const draft = stateWithDraftResult();
    const previous = submitForReview(draft, draft.results[0].id);
    const requested = approveResult(previous, previous.results[0].id, 'forged-reviewer');

    expect(() => authorizeStudioStateWrite({
      context: context('creator', 'user-creator'),
      scope,
      previous,
      requested,
    })).toThrow(expect.objectContaining({ code: 'AUTH_FORBIDDEN' }));
  });

  it('allows a reviewer decision and derives reviewer fields from the trusted session', () => {
    const draft = stateWithDraftResult();
    const previous = submitForReview(draft, draft.results[0].id);
    const requested = approveResult(previous, previous.results[0].id, 'forged-reviewer');
    requested.auditEvents.at(-1)!.actor = 'forged-reviewer';

    const authorized = authorizeStudioStateWrite({
      context: context('reviewer', 'user-reviewer'),
      scope,
      previous,
      requested,
    });

    expect(authorized.results[0]).toMatchObject({
      reviewStatus: 'approved',
      approvedBy: 'user-reviewer',
      reviewedBy: 'user-reviewer',
    });
    expect(authorized.auditEvents.at(-1)?.actor).toBe('user-reviewer');
  });

  it('prevents reviewers from deciding their own submitted result', () => {
    const draft = stateWithDraftResult();
    const submitted = authorizeStudioStateWrite({
      context: context('creator', 'user-author'),
      scope,
      previous: draft,
      requested: submitForReview(draft, draft.results[0].id),
    });
    const requested = approveResult(submitted, submitted.results[0].id, 'forged-reviewer');

    expect(() => authorizeStudioStateWrite({
      context: context('reviewer', 'user-author'),
      scope,
      previous: submitted,
      requested,
    })).toThrow(expect.objectContaining({ code: 'AUTH_FORBIDDEN' }));
  });

  it('allows only the trusted submitter to withdraw a pending review', () => {
    const draft = stateWithDraftResult();
    const submitted = authorizeStudioStateWrite({
      context: context('creator', 'user-author'),
      scope,
      previous: draft,
      requested: submitForReview(draft, draft.results[0].id),
    });
    const requested = withdrawReview(submitted, submitted.results[0].id, 'forged-user');

    expect(() => authorizeStudioStateWrite({
      context: context('creator', 'user-other'),
      scope,
      previous: submitted,
      requested,
    })).toThrow(expect.objectContaining({ code: 'AUTH_FORBIDDEN' }));

    const authorized = authorizeStudioStateWrite({
      context: context('creator', 'user-author'),
      scope,
      previous: submitted,
      requested,
    });
    expect(authorized.results[0]).toMatchObject({ reviewStatus: 'draft' });
    expect(authorized.auditEvents.at(-1)).toMatchObject({
      type: 'review.withdrawn',
      actor: 'user-author',
    });
    expect(authorized.notifications.at(-1)).toMatchObject({
      type: 'review.withdrawn',
      recipientRole: 'reviewer',
      message: '审核申请已撤回',
    });
  });

  it('rejects deletion or mutation of persisted notification history', () => {
    const draft = stateWithDraftResult();
    const previous = authorizeStudioStateWrite({
      context: context('creator', 'user-author'),
      scope,
      previous: draft,
      requested: submitForReview(draft, draft.results[0].id),
    });
    const requested = structuredClone(previous);
    requested.notifications[0].recipientRole = 'creator';

    expect(() => authorizeStudioStateWrite({
      context: context('creator', 'user-author'),
      scope,
      previous,
      requested,
    })).toThrow(expect.objectContaining({ code: 'STUDIO_NOTIFICATION_INVALID' }));
  });

  it('authorizes rejection as a reviewer decision and preserves its reason', () => {
    const draft = stateWithDraftResult();
    const previous = authorizeStudioStateWrite({
      context: context('creator', 'user-author'),
      scope,
      previous: draft,
      requested: submitForReview(draft, draft.results[0].id),
    });
    const requested = rejectResult(
      previous,
      previous.results[0].id,
      'forged-reviewer',
      '商品结构与主素材不一致',
    );

    const authorized = authorizeStudioStateWrite({
      context: context('reviewer', 'user-reviewer'),
      scope,
      previous,
      requested,
    });
    expect(authorized.results[0]).toMatchObject({
      reviewStatus: 'rejected',
      reviewedBy: 'user-reviewer',
      reviewComment: '商品结构与主素材不一致',
    });
    expect(authorized.notifications.at(-1)).toMatchObject({
      type: 'review.rejected',
      recipientUserId: 'user-author',
      message: '审核已拒绝：商品结构与主素材不一致',
    });
  });

  it('rejects forged retry lineage before persisting a new job', () => {
    const queued = createJob(initialStudioState(), {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
    });
    const previous = failJob(queued, queued.jobs[0].id, '供应商超时');
    const requested = createJob(previous, {
      sceneId: 'scene-source', profileId: 'generate', outputCount: 1,
      retryOfJobId: previous.jobs[0].id,
    });
    requested.jobs.at(-1)!.retryOfJobId = 'job-forged';
    requested.auditEvents.at(-1)!.details = { retryOfJobId: 'job-forged' };

    expect(() => authorizeStudioStateWrite({
      context: context('creator', 'user-creator'),
      scope,
      previous,
      requested,
    })).toThrow(expect.objectContaining({ code: 'STUDIO_RETRY_LINEAGE_INVALID' }));
  });

  it('rejects a forged short review reason even with a matching audit event', () => {
    const draft = stateWithDraftResult();
    const previous = authorizeStudioStateWrite({
      context: context('creator', 'user-author'),
      scope,
      previous: draft,
      requested: submitForReview(draft, draft.results[0].id),
    });
    const requested = structuredClone(previous);
    requested.results[0].reviewStatus = 'rejected';
    requested.results[0].reviewComment = '过亮';
    requested.auditEvents.push({
      id: 'audit-forged-reject',
      type: 'review.rejected',
      actor: 'forged-reviewer',
      targetId: requested.results[0].id,
      at: new Date().toISOString(),
    });

    expect(() => authorizeStudioStateWrite({
      context: context('reviewer', 'user-reviewer'),
      scope,
      previous,
      requested,
    })).toThrow('审核原因必须为 5-500 个字符');
  });

  it('rejects deletion or mutation of persisted audit history', () => {
    const previous = stateWithDraftResult();
    const requested = structuredClone(previous);
    requested.auditEvents[0].targetId = 'tampered-target';

    expect(() => authorizeStudioStateWrite({
      context: context('owner', 'user-owner'),
      scope,
      previous,
      requested,
    })).toThrow(StudioStateCommandError);

    expect(() => authorizeStudioStateWrite({
      context: context('owner', 'user-owner'),
      scope,
      previous,
      requested: { ...previous, auditEvents: previous.auditEvents.slice(1) },
    })).toThrow(expect.objectContaining({ code: 'STUDIO_AUDIT_IMMUTABLE' }));
  });

  it('rejects state changes that omit a matching command audit event', () => {
    const previous = stateWithDraftResult();
    const requested = structuredClone(previous);
    requested.results[0].reviewStatus = 'submitted';

    expect(() => authorizeStudioStateWrite({
      context: context('creator', 'user-creator'),
      scope,
      previous,
      requested,
    })).toThrow(expect.objectContaining({ code: 'STUDIO_COMMAND_AUDIT_REQUIRED' }));
  });

  it('rejects mutation of persisted usage ledger history', () => {
    const previous = stateWithDraftResult();
    const requested = structuredClone(previous);
    requested.usageLedger[0].units = 1;

    expect(() => authorizeStudioStateWrite({
      context: context('owner', 'user-owner'),
      scope,
      previous,
      requested,
    })).toThrow(expect.objectContaining({ code: 'STUDIO_USAGE_LEDGER_IMMUTABLE' }));
  });

  it('rejects a forged usage balance without matching ledger entries', () => {
    const previous = stateWithDraftResult();
    const requested = structuredClone(previous);
    requested.usage.availableCredits += 100;

    expect(() => authorizeStudioStateWrite({
      context: context('owner', 'user-owner'),
      scope,
      previous,
      requested,
    })).toThrow(expect.objectContaining({ code: 'STUDIO_USAGE_LEDGER_INVALID' }));
  });
});

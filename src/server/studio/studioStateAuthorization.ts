import {
  AuthorizationError,
  requirePermission,
  type AuthContext,
  type Permission,
  type ResourceScope,
} from '../auth/authPolicy';
import {
  initialStudioState,
  type AuditEvent,
  type Result,
  type StudioNotification,
  type StudioState,
} from '../../shared/domain';

type AuthorizeStudioStateWriteInput = {
  context: AuthContext;
  scope: ResourceScope & { projectId: string };
  previous: StudioState | null;
  requested: StudioState;
};

type ReviewCommand =
  | 'review.submitted'
  | 'review.approved'
  | 'review.returned'
  | 'review.rejected'
  | 'review.withdrawn';

const auditPermission: Record<string, Permission> = {
  'asset.uploaded': 'asset.edit',
  'job.created': 'job.create',
  'job.succeeded': 'job.create',
  'job.partially_succeeded': 'job.create',
  'job.failed': 'job.create',
  'job.canceled': 'job.create',
  'job.expired': 'job.create',
  'scene.created_from_asset': 'project.edit',
  'scene.created_blank': 'project.edit',
  'scene.duplicated': 'project.edit',
  'scene.renamed': 'project.edit',
  'scene.deleted': 'project.edit',
  'scene.derived': 'project.edit',
  'review.submitted': 'review.submit',
  'review.approved': 'review.decide',
  'review.returned': 'review.decide',
  'review.rejected': 'review.decide',
  'review.withdrawn': 'review.submit',
  'result.favorited': 'project.edit',
  'result.unfavorited': 'project.edit',
  'result.adopted': 'project.edit',
  'result.unadopted': 'project.edit',
  'result.primary_set': 'project.edit',
  'result.quality_flagged': 'project.edit',
  'result.exported': 'export.production',
};

export class StudioStateCommandError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'STUDIO_AUDIT_IMMUTABLE'
      | 'STUDIO_USAGE_LEDGER_IMMUTABLE'
      | 'STUDIO_USAGE_LEDGER_INVALID'
      | 'STUDIO_NOTIFICATION_INVALID'
      | 'STUDIO_RETRY_LINEAGE_INVALID'
      | 'STUDIO_INITIAL_STATE_INVALID'
      | 'STUDIO_COMMAND_AUDIT_REQUIRED'
      | 'STUDIO_COMMAND_UNKNOWN',
    readonly statusCode: 400 | 409,
  ) {
    super(message);
    this.name = 'StudioStateCommandError';
  }
}

export function authorizeStudioStateWrite({
  context,
  scope,
  previous,
  requested,
}: AuthorizeStudioStateWriteInput): StudioState {
  if (!previous) {
    requirePermission(context, 'project.edit', scope);
    if (context.role !== 'owner' && context.role !== 'admin') assertInitialState(requested);
    return normalizeInitialState(requested, context.userId);
  }

  assertAuditHistory(previous.auditEvents, requested.auditEvents);
  assertNotificationHistory(previous.notifications ?? [], requested.notifications ?? []);
  assertUsageLedger(previous, requested);
  const next = structuredClone(requested);
  next.auditEvents.splice(
    0,
    previous.auditEvents.length,
    ...structuredClone(previous.auditEvents),
  );
  const appendedEvents = next.auditEvents.slice(previous.auditEvents.length);
  const permissions = new Set<Permission>();

  for (const event of appendedEvents) {
    const permission = auditPermission[event.type];
    if (!permission && event.type !== 'job.cancel_requested') {
      throw new StudioStateCommandError(
        `未知工作台命令：${event.type}`,
        'STUDIO_COMMAND_UNKNOWN',
        400,
      );
    }
    if (permission) permissions.add(permission);
    event.actor = context.userId;
  }

  restorePersistedResultActors(previous, next);
  assertRetryLineage(previous, next, appendedEvents);
  authorizeReviewTransitions(previous, next, appendedEvents, permissions, context.userId);
  authorizeReviewNotifications(previous, next, appendedEvents);
  authorizeSectionChanges(previous, next, appendedEvents, permissions, context);
  for (const permission of permissions) requirePermission(context, permission, scope);
  return next;
}

function assertInitialState(requested: StudioState): void {
  const baselineUsage = initialStudioState().usage;
  const hasPrivilegedHistory = (
    requested.jobs.length > 0
    || requested.results.length > 0
    || requested.auditEvents.length > 0
    || (requested.notifications?.length ?? 0) > 0
    || (requested.usageLedger?.length ?? 0) > 0
  );
  const hasModifiedUsage = (
    requested.usage.monthlyCredits !== baselineUsage.monthlyCredits
    || requested.usage.availableCredits !== baselineUsage.availableCredits
    || requested.usage.frozenCredits !== baselineUsage.frozenCredits
    || requested.usage.spentCredits !== baselineUsage.spentCredits
  );
  if (hasPrivilegedHistory || hasModifiedUsage) {
    throw new StudioStateCommandError(
      '新项目不能夹带任务、审核或用量历史',
      'STUDIO_INITIAL_STATE_INVALID',
      400,
    );
  }
}

function assertRetryLineage(
  previous: StudioState,
  next: StudioState,
  appendedEvents: AuditEvent[],
): void {
  const previousJobs = new Map(previous.jobs.map((job) => [job.id, job]));
  const previousResults = new Map(previous.results.map((result) => [result.id, result]));
  for (const job of next.jobs) {
    const persisted = previousJobs.get(job.id);
    if (persisted) {
      if (
        persisted.retryOfJobId !== job.retryOfJobId
        || persisted.supersedesResultId !== job.supersedesResultId
      ) invalidRetryLineage();
      continue;
    }
    const createdEvent = appendedEvents.find(
      (event) => event.type === 'job.created' && event.targetId === job.id,
    );
    if (!createdEvent) {
      throw new StudioStateCommandError(
        '新任务缺少匹配的创建审计事件',
        'STUDIO_COMMAND_AUDIT_REQUIRED',
        400,
      );
    }
    if (!job.retryOfJobId) {
      if (job.supersedesResultId || createdEvent.details?.retryOfJobId) invalidRetryLineage();
      continue;
    }
    const sourceJob = previousJobs.get(job.retryOfJobId);
    if (
      !sourceJob
      || sourceJob.sceneId !== job.sceneId
      || sourceJob.profileId !== job.profileId
      || createdEvent.details?.retryOfJobId !== job.retryOfJobId
    ) invalidRetryLineage();
    if (job.supersedesResultId) {
      const sourceResult = previousResults.get(job.supersedesResultId);
      if (
        !sourceResult
        || sourceResult.jobId !== sourceJob.id
        || (sourceResult.reviewStatus !== 'returned' && sourceResult.reviewStatus !== 'rejected')
        || createdEvent.details?.supersedesResultId !== job.supersedesResultId
      ) invalidRetryLineage();
    } else if (sourceJob.status !== 'failed' && sourceJob.status !== 'expired') {
      invalidRetryLineage();
    }
  }

  for (const result of next.results) {
    const persisted = previousResults.get(result.id);
    if (persisted && persisted.supersedesResultId !== result.supersedesResultId) {
      invalidRetryLineage();
    }
    if (!persisted && result.supersedesResultId) {
      const job = next.jobs.find((item) => item.id === result.jobId);
      if (job?.supersedesResultId !== result.supersedesResultId) invalidRetryLineage();
    }
  }
}

function invalidRetryLineage(): never {
  throw new StudioStateCommandError(
    '重试任务或修改版本血缘不合法',
    'STUDIO_RETRY_LINEAGE_INVALID',
    400,
  );
}

function assertUsageLedger(previous: StudioState, requested: StudioState): void {
  const previousEntries = previous.usageLedger ?? [];
  const requestedEntries = requested.usageLedger ?? [];
  if (requestedEntries.length < previousEntries.length) {
    throw new StudioStateCommandError(
      '用量台账历史不可删除',
      'STUDIO_USAGE_LEDGER_IMMUTABLE',
      409,
    );
  }
  for (let index = 0; index < previousEntries.length; index += 1) {
    if (JSON.stringify(previousEntries[index]) !== JSON.stringify(requestedEntries[index])) {
      throw new StudioStateCommandError(
        '用量台账历史不可修改',
        'STUDIO_USAGE_LEDGER_IMMUTABLE',
        409,
      );
    }
  }

  const ids = new Set<string>();
  for (const entry of requestedEntries) {
    if (ids.has(entry.id)) {
      throw new StudioStateCommandError(
        '用量台账 ID 不可重复',
        'STUDIO_USAGE_LEDGER_IMMUTABLE',
        409,
      );
    }
    ids.add(entry.id);
  }

  let available = previous.usage.availableCredits;
  let frozen = previous.usage.frozenCredits;
  let spent = previous.usage.spentCredits;
  for (const entry of requestedEntries.slice(previousEntries.length)) {
    const job = requested.jobs.find((item) => item.id === entry.jobId);
    if (!job || job.profileId !== entry.profileId || !Number.isFinite(entry.units) || entry.units < 0) {
      invalidUsageLedger();
    }
    if (entry.entryType === 'reserve') {
      available -= entry.units;
      frozen += entry.units;
    } else if (entry.entryType === 'charge') {
      frozen -= entry.units;
      spent += entry.units;
    } else if (entry.entryType === 'release') {
      available += entry.units;
      frozen -= entry.units;
    } else {
      invalidUsageLedger();
    }
    if (entry.balanceAfter !== available || available < 0 || frozen < 0 || spent < 0) {
      invalidUsageLedger();
    }
  }

  if (
    requested.usage.availableCredits !== available
    || requested.usage.frozenCredits !== frozen
    || requested.usage.spentCredits !== spent
  ) {
    invalidUsageLedger();
  }
}

function invalidUsageLedger(): never {
  throw new StudioStateCommandError(
    '额度汇总与用量台账不一致',
    'STUDIO_USAGE_LEDGER_INVALID',
    400,
  );
}

function normalizeInitialState(requested: StudioState, actor: string): StudioState {
  const next = structuredClone(requested);
  for (const event of next.auditEvents) event.actor = actor;
  for (const result of next.results) {
    if (result.reviewStatus === 'approved') {
      result.approvedBy = actor;
      result.reviewedBy = actor;
    } else if (result.reviewStatus === 'returned' || result.reviewStatus === 'rejected') {
      result.approvedBy = undefined;
      result.reviewedBy = actor;
    }
    if (result.adoptedBy) result.adoptedBy = actor;
  }
  normalizeInitialNotifications(next);
  return next;
}

function normalizeInitialNotifications(state: StudioState): void {
  for (const notification of state.notifications ?? []) {
    if (notification.type === 'review.submitted' || notification.type === 'review.withdrawn') {
      notification.recipientRole = 'reviewer';
      notification.recipientUserId = undefined;
    } else {
      notification.recipientUserId = latestReviewSubmitter(state.auditEvents, notification.targetId);
      notification.recipientRole = undefined;
    }
  }
}

function assertNotificationHistory(
  previous: StudioNotification[],
  requested: StudioNotification[],
): void {
  if (requested.length < previous.length) invalidNotification('通知历史不可删除');
  for (let index = 0; index < previous.length; index += 1) {
    if (JSON.stringify(previous[index]) !== JSON.stringify(requested[index])) {
      invalidNotification('通知历史不可修改');
    }
  }
  const ids = new Set<string>();
  for (const notification of requested) {
    if (ids.has(notification.id)) invalidNotification('通知 ID 不可重复');
    ids.add(notification.id);
  }
}

function assertAuditHistory(previous: AuditEvent[], requested: AuditEvent[]): void {
  if (requested.length < previous.length) {
    throw new StudioStateCommandError('审计历史不可删除', 'STUDIO_AUDIT_IMMUTABLE', 409);
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (JSON.stringify(previous[index]) !== JSON.stringify(requested[index])) {
      throw new StudioStateCommandError('审计历史不可修改', 'STUDIO_AUDIT_IMMUTABLE', 409);
    }
  }
  const ids = new Set<string>();
  for (const event of requested) {
    if (ids.has(event.id)) {
      throw new StudioStateCommandError('审计事件 ID 不可重复', 'STUDIO_AUDIT_IMMUTABLE', 409);
    }
    ids.add(event.id);
  }
}

function restorePersistedResultActors(previous: StudioState, next: StudioState): void {
  const previousById = new Map(previous.results.map((result) => [result.id, result]));
  for (const result of next.results) {
    const before = previousById.get(result.id);
    if (!before) continue;
    if (before.reviewStatus === result.reviewStatus) {
      result.approvedBy = before.approvedBy;
      result.reviewedBy = before.reviewedBy;
      result.reviewComment = before.reviewComment;
    }
    if (before.isAdopted === result.isAdopted) {
      result.adoptedBy = before.adoptedBy;
      result.adoptedAt = before.adoptedAt;
    }
  }
}

function authorizeReviewTransitions(
  previous: StudioState,
  next: StudioState,
  appendedEvents: AuditEvent[],
  permissions: Set<Permission>,
  actor: string,
): void {
  const previousById = new Map(previous.results.map((result) => [result.id, result]));
  for (const result of next.results) {
    const before = previousById.get(result.id);
    if (!before || before.reviewStatus === result.reviewStatus) continue;
    let command: ReviewCommand;
    if (
      before.reviewStatus === 'draft' && result.reviewStatus === 'submitted'
    ) {
      command = 'review.submitted';
      permissions.add('review.submit');
      result.approvedBy = undefined;
      result.reviewedBy = undefined;
      result.reviewComment = undefined;
    } else if (before.reviewStatus === 'submitted' && result.reviewStatus === 'approved') {
      assertReviewerIsNotSubmitter(previous.auditEvents, result.id, actor);
      command = 'review.approved';
      permissions.add('review.decide');
      result.approvedBy = actor;
      result.reviewedBy = actor;
      result.reviewComment = undefined;
    } else if (before.reviewStatus === 'submitted' && result.reviewStatus === 'returned') {
      assertReviewerIsNotSubmitter(previous.auditEvents, result.id, actor);
      assertReviewReason(result.reviewComment);
      command = 'review.returned';
      permissions.add('review.decide');
      result.approvedBy = undefined;
      result.reviewedBy = actor;
    } else if (before.reviewStatus === 'submitted' && result.reviewStatus === 'rejected') {
      assertReviewerIsNotSubmitter(previous.auditEvents, result.id, actor);
      assertReviewReason(result.reviewComment);
      command = 'review.rejected';
      permissions.add('review.decide');
      result.approvedBy = undefined;
      result.reviewedBy = actor;
    } else if (before.reviewStatus === 'submitted' && result.reviewStatus === 'draft') {
      assertReviewSubmitter(previous.auditEvents, result.id, actor);
      command = 'review.withdrawn';
      permissions.add('review.submit');
      result.approvedBy = undefined;
      result.reviewedBy = undefined;
      result.reviewComment = undefined;
    } else {
      throw new StudioStateCommandError(
        '审核状态流转不合法',
        'STUDIO_COMMAND_AUDIT_REQUIRED',
        400,
      );
    }
    requireCommandEvent(appendedEvents, command, result.id);
  }
}

function authorizeReviewNotifications(
  previous: StudioState,
  next: StudioState,
  appendedEvents: AuditEvent[],
): void {
  const previousCount = (previous.notifications ?? []).length;
  const appendedNotifications = (next.notifications ?? []).slice(previousCount);
  const reviewEvents = appendedEvents.filter((event) => event.type.startsWith('review.'));
  if (appendedNotifications.length !== reviewEvents.length) {
    invalidNotification('每个审核状态变化必须生成一条通知');
  }
  for (const notification of appendedNotifications) {
    const event = reviewEvents.find((item) => (
      item.type === notification.type && item.targetId === notification.targetId
    ));
    if (!event || notification.readAt) invalidNotification('审核通知与状态变化不一致');
    notification.at = event.at;
    if (notification.type === 'review.submitted' || notification.type === 'review.withdrawn') {
      notification.recipientRole = 'reviewer';
      notification.recipientUserId = undefined;
    } else {
      const submitter = latestReviewSubmitter(previous.auditEvents, notification.targetId);
      if (!submitter) invalidNotification('无法确定审核通知的原提交人');
      notification.recipientUserId = submitter;
      notification.recipientRole = undefined;
    }
    const result = next.results.find((item) => item.id === notification.targetId);
    notification.message = notificationMessage(notification.type, result?.reviewComment);
  }
}

function notificationMessage(type: StudioNotification['type'], reason?: string): string {
  if (type === 'review.submitted') return '新结果已提交审核';
  if (type === 'review.approved') return '审核已通过';
  if (type === 'review.returned') return `审核已退回：${reason ?? ''}`;
  if (type === 'review.rejected') return `审核已拒绝：${reason ?? ''}`;
  return '审核申请已撤回';
}

function invalidNotification(message: string): never {
  throw new StudioStateCommandError(message, 'STUDIO_NOTIFICATION_INVALID', 400);
}

function assertReviewerIsNotSubmitter(events: AuditEvent[], resultId: string, actor: string): void {
  if (latestReviewSubmitter(events, resultId) === actor) {
    throw new AuthorizationError('不能审核自己提交的结果', 'AUTH_FORBIDDEN', 403);
  }
}

function assertReviewSubmitter(events: AuditEvent[], resultId: string, actor: string): void {
  if (latestReviewSubmitter(events, resultId) !== actor) {
    throw new AuthorizationError('只有原提交人可以撤回审核', 'AUTH_FORBIDDEN', 403);
  }
}

function latestReviewSubmitter(events: AuditEvent[], resultId: string): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'review.submitted' && event.targetId === resultId) return event.actor;
  }
  return undefined;
}

function assertReviewReason(reason: string | undefined): void {
  const normalized = reason?.trim() ?? '';
  if (normalized.length < 5 || normalized.length > 500) {
    throw new StudioStateCommandError(
      '审核原因必须为 5-500 个字符',
      'STUDIO_COMMAND_AUDIT_REQUIRED',
      400,
    );
  }
}

function authorizeSectionChanges(
  previous: StudioState,
  next: StudioState,
  appendedEvents: AuditEvent[],
  permissions: Set<Permission>,
  context: AuthContext,
): void {
  if (changed(previous.assets, next.assets)) permissions.add('asset.edit');
  if (
    changed(previous.scenes, next.scenes)
    || changed(previous.edges, next.edges)
    || previous.tenantName !== next.tenantName
    || previous.projectName !== next.projectName
    || previous.workspaceName !== next.workspaceName
    || previous.selectedSceneId !== next.selectedSceneId
    || previous.selectedTool !== next.selectedTool
  ) {
    permissions.add('project.edit');
  }

  const cancellationTargets = new Set(
    appendedEvents
      .filter((event) => event.type === 'job.cancel_requested')
      .map((event) => event.targetId),
  );
  if (cancellationTargets.size > 0) {
    for (const jobId of cancellationTargets) {
      const created = previous.auditEvents.find(
        (event) => event.type === 'job.created' && event.targetId === jobId,
      );
      permissions.add(created?.actor === context.userId ? 'job.cancel_own' : 'job.cancel_any');
    }
  }
  if (changed(previous.jobs, next.jobs) || changed(previous.usage, next.usage)) {
    if (cancellationTargets.size === 0) permissions.add('job.create');
  }

  if (!sameNonReviewResults(previous.results, next.results)) {
    const addedResult = next.results.some(
      (result) => !previous.results.some((item) => item.id === result.id),
    );
    permissions.add(addedResult ? 'job.create' : 'project.edit');
  }

  for (const event of appendedEvents) {
    if (event.type === 'result.adopted') {
      const result = next.results.find((item) => item.id === event.targetId);
      if (result?.isAdopted) result.adoptedBy = context.userId;
    }
    if (event.type === 'result.unadopted') {
      const result = next.results.find((item) => item.id === event.targetId);
      if (result && !result.isAdopted) {
        result.adoptedBy = undefined;
        result.adoptedAt = undefined;
      }
    }
  }

  for (const event of appendedEvents) {
    if (event.type === 'job.cancel_requested') continue;
    const permission = auditPermission[event.type];
    if (permission) permissions.add(permission);
  }
}

function requireCommandEvent(events: AuditEvent[], type: ReviewCommand, targetId: string): void {
  if (!events.some((event) => event.type === type && event.targetId === targetId)) {
    throw new StudioStateCommandError(
      '状态变化缺少匹配的命令审计事件',
      'STUDIO_COMMAND_AUDIT_REQUIRED',
      400,
    );
  }
}

function sameNonReviewResults(previous: Result[], next: Result[]): boolean {
  return changed(
    previous.map(withoutReviewFields),
    next.map(withoutReviewFields),
  ) === false;
}

function withoutReviewFields(result: Result): Omit<
  Result,
  'reviewStatus' | 'approvedBy' | 'reviewedBy' | 'reviewComment'
> {
  const {
    reviewStatus: _reviewStatus,
    approvedBy: _approvedBy,
    reviewedBy: _reviewedBy,
    reviewComment: _reviewComment,
    ...rest
  } = result;
  return rest;
}

function changed(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

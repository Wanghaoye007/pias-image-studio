import type {
  Asset,
  AuditEvent,
  GenerationJob,
  JobInputSnapshot,
  Result,
  Scene,
  SceneEdge,
  StudioNotification,
  StudioState,
  TaskParameters,
  UsageLedgerEntry,
} from '../domain';

const jobStatuses = new Set([
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
]);
const reviewStatuses = new Set(['draft', 'submitted', 'approved', 'returned', 'rejected']);
const profileIds = new Set(['generate', 'blend', 'angle', 'light', 'remove', 'extract', 'expand', 'upscale']);
const qualityIssues = new Set([
  'product-deformation', 'text-logo', 'material', 'composition', 'lighting',
  'background', 'dimensions', 'content-safety', 'other',
]);
const usageEntryTypes = new Set(['reserve', 'charge', 'release', 'adjustment']);
const pricingRuleVersions = new Set(['pias-credit-v1']);
const notificationTypes = new Set([
  'review.submitted', 'review.approved', 'review.returned', 'review.rejected', 'review.withdrawn',
]);
const notificationRoles = new Set(['creator', 'reviewer']);

export class StudioStateValidationError extends Error {
  constructor(path: string, expectation: string) {
    super(`${path} ${expectation}`);
    this.name = 'StudioStateValidationError';
  }
}

export function parseStudioState(value: unknown): StudioState {
  const state = record(value, 'state');
  return {
    tenantName: text(state.tenantName, 'state.tenantName'),
    projectName: text(state.projectName, 'state.projectName'),
    workspaceName: text(state.workspaceName, 'state.workspaceName'),
    selectedSceneId: text(state.selectedSceneId, 'state.selectedSceneId'),
    selectedTool: enumeration(state.selectedTool, 'state.selectedTool', profileIds) as StudioState['selectedTool'],
    usage: parseUsage(state.usage),
    usageLedger: array(state.usageLedger ?? [], 'state.usageLedger').map(parseUsageLedgerEntry),
    assets: array(state.assets, 'state.assets').map(parseAsset),
    scenes: array(state.scenes, 'state.scenes').map(parseScene),
    edges: array(state.edges, 'state.edges').map(parseEdge),
    jobs: array(state.jobs, 'state.jobs').map(parseJob),
    results: array(state.results, 'state.results').map(parseResult),
    auditEvents: array(state.auditEvents, 'state.auditEvents').map(parseAuditEvent),
    notifications: array(state.notifications ?? [], 'state.notifications').map(parseNotification),
  };
}

function parseNotification(value: unknown, index: number): StudioNotification {
  const path = `state.notifications[${index}]`;
  const notification = record(value, path);
  const recipientUserId = optionalText(notification.recipientUserId, `${path}.recipientUserId`);
  const recipientRole = notification.recipientRole === undefined
    ? undefined
    : enumeration(notification.recipientRole, `${path}.recipientRole`, notificationRoles) as StudioNotification['recipientRole'];
  if (Boolean(recipientUserId) === Boolean(recipientRole)) {
    fail(path, '必须且只能指定一种通知收件人');
  }
  return compact({
    id: text(notification.id, `${path}.id`),
    type: enumeration(notification.type, `${path}.type`, notificationTypes) as StudioNotification['type'],
    targetId: text(notification.targetId, `${path}.targetId`),
    message: text(notification.message, `${path}.message`),
    at: text(notification.at, `${path}.at`),
    recipientUserId,
    recipientRole,
    readAt: optionalText(notification.readAt, `${path}.readAt`),
  }) as StudioNotification;
}

function parseUsageLedgerEntry(value: unknown, index: number): UsageLedgerEntry {
  const path = `state.usageLedger[${index}]`;
  const entry = record(value, path);
  return {
    id: text(entry.id, `${path}.id`),
    jobId: text(entry.jobId, `${path}.jobId`),
    profileId: enumeration(entry.profileId, `${path}.profileId`, profileIds) as UsageLedgerEntry['profileId'],
    entryType: enumeration(entry.entryType, `${path}.entryType`, usageEntryTypes) as UsageLedgerEntry['entryType'],
    units: nonNegativeNumber(entry.units, `${path}.units`),
    balanceAfter: nonNegativeNumber(entry.balanceAfter, `${path}.balanceAfter`),
    pricingRuleVersion: enumeration(
      entry.pricingRuleVersion,
      `${path}.pricingRuleVersion`,
      pricingRuleVersions,
    ) as UsageLedgerEntry['pricingRuleVersion'],
    reason: text(entry.reason, `${path}.reason`),
    at: text(entry.at, `${path}.at`),
  };
}

function parseUsage(value: unknown): StudioState['usage'] {
  const usage = record(value, 'state.usage');
  return {
    monthlyCredits: nonNegativeNumber(usage.monthlyCredits, 'state.usage.monthlyCredits'),
    availableCredits: nonNegativeNumber(usage.availableCredits, 'state.usage.availableCredits'),
    frozenCredits: nonNegativeNumber(usage.frozenCredits, 'state.usage.frozenCredits'),
    spentCredits: nonNegativeNumber(usage.spentCredits, 'state.usage.spentCredits'),
  };
}

function parseAsset(value: unknown, index: number): Asset {
  const path = `state.assets[${index}]`;
  const asset = record(value, path);
  return {
    id: text(asset.id, `${path}.id`),
    brand: stringValue(asset.brand, `${path}.brand`),
    product: text(asset.product, `${path}.product`),
    skuCode: text(asset.skuCode, `${path}.skuCode`),
    usage: stringValue(asset.usage, `${path}.usage`),
    version: text(asset.version, `${path}.version`),
    imageUrl: text(asset.imageUrl, `${path}.imageUrl`),
  };
}

function parseScene(value: unknown, index: number): Scene {
  const path = `state.scenes[${index}]`;
  const scene = record(value, path);
  const status = stringValue(scene.status, `${path}.status`);
  if (status !== 'source' && status !== 'draft' && !jobStatuses.has(status)) {
    fail(`${path}.status`, '必须是有效场景状态');
  }
  return compact({
    id: text(scene.id, `${path}.id`),
    title: text(scene.title, `${path}.title`),
    skuCode: stringValue(scene.skuCode, `${path}.skuCode`),
    operation: stringValue(scene.operation, `${path}.operation`),
    status: status as Scene['status'],
    x: finiteNumber(scene.x, `${path}.x`),
    y: finiteNumber(scene.y, `${path}.y`),
    imageUrl: stringValue(scene.imageUrl, `${path}.imageUrl`),
    resultIds: array(scene.resultIds, `${path}.resultIds`).map((item, itemIndex) => text(item, `${path}.resultIds[${itemIndex}]`)),
    sourceAssetId: optionalText(scene.sourceAssetId, `${path}.sourceAssetId`),
    sourceAssetVersion: optionalText(scene.sourceAssetVersion, `${path}.sourceAssetVersion`),
    parentSceneId: optionalText(scene.parentSceneId, `${path}.parentSceneId`),
    sourceResultId: optionalText(scene.sourceResultId, `${path}.sourceResultId`),
  }) as Scene;
}

function parseEdge(value: unknown, index: number): SceneEdge {
  const path = `state.edges[${index}]`;
  const edge = record(value, path);
  return {
    id: text(edge.id, `${path}.id`),
    source: text(edge.source, `${path}.source`),
    target: text(edge.target, `${path}.target`),
    label: stringValue(edge.label, `${path}.label`),
  };
}

function parseJob(value: unknown, index: number): GenerationJob {
  const path = `state.jobs[${index}]`;
  const job = record(value, path);
  return compact({
    id: text(job.id, `${path}.id`),
    sceneId: text(job.sceneId, `${path}.sceneId`),
    profileId: enumeration(job.profileId, `${path}.profileId`, profileIds) as GenerationJob['profileId'],
    status: enumeration(job.status, `${path}.status`, jobStatuses) as GenerationJob['status'],
    outputCount: positiveInteger(job.outputCount, `${path}.outputCount`),
    reservedCredits: nonNegativeNumber(job.reservedCredits, `${path}.reservedCredits`),
    actualCredits: nonNegativeNumber(job.actualCredits, `${path}.actualCredits`),
    progress: boundedNumber(job.progress, `${path}.progress`, 0, 100),
    x: finiteNumber(job.x, `${path}.x`),
    y: finiteNumber(job.y, `${path}.y`),
    inputSnapshot: parseInputSnapshot(job.inputSnapshot, `${path}.inputSnapshot`),
    retryOfJobId: optionalText(job.retryOfJobId, `${path}.retryOfJobId`),
    supersedesResultId: optionalText(job.supersedesResultId, `${path}.supersedesResultId`),
    externalExecution: job.externalExecution === undefined
      ? undefined
      : parseExternalExecution(job.externalExecution, `${path}.externalExecution`),
    errorMessage: optionalString(job.errorMessage, `${path}.errorMessage`),
  }) as GenerationJob;
}

function parseInputSnapshot(value: unknown, path: string): JobInputSnapshot {
  const input = record(value, path);
  return compact({
    inputKind: enumeration(input.inputKind, `${path}.inputKind`, new Set(['scene', 'result'])) as JobInputSnapshot['inputKind'],
    inputNodeId: text(input.inputNodeId, `${path}.inputNodeId`),
    prompt: stringValue(input.prompt, `${path}.prompt`),
    ratio: text(input.ratio, `${path}.ratio`),
    parameters: parseParameters(input.parameters, `${path}.parameters`),
    referenceAssetIds: array(input.referenceAssetIds, `${path}.referenceAssetIds`)
      .map((item, index) => text(item, `${path}.referenceAssetIds[${index}]`)),
    maskImageUrl: optionalText(input.maskImageUrl, `${path}.maskImageUrl`),
    sourceAssetId: optionalText(input.sourceAssetId, `${path}.sourceAssetId`),
    sourceAssetVersion: optionalText(input.sourceAssetVersion, `${path}.sourceAssetVersion`),
    sourceResultId: optionalText(input.sourceResultId, `${path}.sourceResultId`),
  }) as JobInputSnapshot;
}

function parseResult(value: unknown, index: number): Result {
  const path = `state.results[${index}]`;
  const result = record(value, path);
  return compact({
    id: text(result.id, `${path}.id`),
    sourceSceneId: text(result.sourceSceneId, `${path}.sourceSceneId`),
    jobId: text(result.jobId, `${path}.jobId`),
    assetId: text(result.assetId, `${path}.assetId`),
    title: text(result.title, `${path}.title`),
    imageUrl: text(result.imageUrl, `${path}.imageUrl`),
    reviewStatus: enumeration(result.reviewStatus, `${path}.reviewStatus`, reviewStatuses) as Result['reviewStatus'],
    x: finiteNumber(result.x, `${path}.x`),
    y: finiteNumber(result.y, `${path}.y`),
    approvedBy: optionalText(result.approvedBy, `${path}.approvedBy`),
    reviewedBy: optionalText(result.reviewedBy, `${path}.reviewedBy`),
    reviewComment: optionalString(result.reviewComment, `${path}.reviewComment`),
    supersedesResultId: optionalText(result.supersedesResultId, `${path}.supersedesResultId`),
    isFavorite: optionalBoolean(result.isFavorite, `${path}.isFavorite`),
    isAdopted: optionalBoolean(result.isAdopted, `${path}.isAdopted`),
    isPrimary: optionalBoolean(result.isPrimary, `${path}.isPrimary`),
    adoptedBy: optionalText(result.adoptedBy, `${path}.adoptedBy`),
    adoptedAt: optionalText(result.adoptedAt, `${path}.adoptedAt`),
    qualityIssue: result.qualityIssue === undefined
      ? undefined
      : enumeration(result.qualityIssue, `${path}.qualityIssue`, qualityIssues) as Result['qualityIssue'],
    width: optionalPositiveNumber(result.width, `${path}.width`),
    height: optionalPositiveNumber(result.height, `${path}.height`),
    createdAt: optionalText(result.createdAt, `${path}.createdAt`),
    generationMetadata: result.generationMetadata === undefined
      ? undefined
      : parseGenerationMetadata(result.generationMetadata, `${path}.generationMetadata`),
  }) as Result;
}

function parseExternalExecution(value: unknown, path: string): GenerationJob['externalExecution'] {
  const execution = record(value, path);
  if (execution.provider !== 'fal') fail(`${path}.provider`, '必须是 fal');
  return {
    provider: 'fal',
    modelId: text(execution.modelId, `${path}.modelId`),
    requestId: text(execution.requestId, `${path}.requestId`),
  };
}

function parseGenerationMetadata(value: unknown, path: string): NonNullable<Result['generationMetadata']> {
  const metadata = record(value, path);
  return compact({
    ...parseExternalExecution(metadata, path),
    seed: metadata.seed === undefined ? undefined : finiteNumber(metadata.seed, `${path}.seed`),
    parameters: parseParameters(metadata.parameters, `${path}.parameters`),
  }) as NonNullable<Result['generationMetadata']>;
}

function parseAuditEvent(value: unknown, index: number): AuditEvent {
  const path = `state.auditEvents[${index}]`;
  const event = record(value, path);
  return compact({
    id: text(event.id, `${path}.id`),
    type: text(event.type, `${path}.type`),
    actor: text(event.actor, `${path}.actor`),
    targetId: text(event.targetId, `${path}.targetId`),
    at: text(event.at, `${path}.at`),
    details: event.details === undefined ? undefined : parseParameters(event.details, `${path}.details`),
  }) as AuditEvent;
}

function parseParameters(value: unknown, path: string): TaskParameters {
  const parameters = record(value, path);
  return Object.fromEntries(Object.entries(parameters).map(([key, item]) => {
    if (typeof item === 'number' && Number.isFinite(item)) return [key, item];
    if (typeof item === 'string' || typeof item === 'boolean') return [key, item];
    return fail(`${path}.${key}`, '必须是字符串、有限数字或布尔值');
  }));
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, '必须是数组');
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, '必须是字符串');
  return value;
}

function text(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!result.trim()) fail(path, '不能为空');
  return result;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, path);
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : text(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(path, '必须是布尔值');
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '必须是有限数字');
  return value;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (result < 0) fail(path, '不能小于 0');
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (!Number.isInteger(result) || result <= 0) fail(path, '必须是正整数');
  return result;
}

function optionalPositiveNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  const result = finiteNumber(value, path);
  if (result <= 0) fail(path, '必须大于 0');
  return result;
}

function boundedNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  const result = finiteNumber(value, path);
  if (result < minimum || result > maximum) fail(path, `必须在 ${minimum} 到 ${maximum} 之间`);
  return result;
}

function enumeration(value: unknown, path: string, values: Set<string>): string {
  const result = stringValue(value, path);
  if (!values.has(result)) fail(path, '不是有效枚举值');
  return result;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function fail(path: string, expectation: string): never {
  throw new StudioStateValidationError(path, expectation);
}

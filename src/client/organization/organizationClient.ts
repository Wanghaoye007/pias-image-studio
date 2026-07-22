import { withCsrfProtection } from '../auth/authClient';
import type {
  OrganizationInvitationPreview,
  OrganizationMember,
  OrganizationInvitation,
  OrganizationProject,
} from '../../shared/organization/types';

export class OrganizationClientError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'OrganizationClientError';
  }
}

export async function listProjects(): Promise<OrganizationProject[]> {
  const payload = asRecord(await request('/api/organization/projects', { method: 'GET' }));
  if (!Array.isArray(payload.projects)) invalidResponse();
  return payload.projects.map(parseProject);
}

export async function createProject(input: {
  name: string;
  defaultBrand: string;
  defaultSku: string;
  reviewRequired: boolean;
}): Promise<OrganizationProject> {
  const payload = asRecord(await request('/api/organization/projects', withCsrfProtection({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })));
  return parseProject(payload.project);
}

export async function listInvitations(): Promise<OrganizationInvitation[]> {
  const payload = asRecord(await request('/api/organization/invitations', { method: 'GET' }));
  if (!Array.isArray(payload.invitations)) invalidResponse();
  return payload.invitations.map(parseInvitation);
}

export async function listMembers(): Promise<OrganizationMember[]> {
  const payload = asRecord(await request('/api/organization/members', { method: 'GET' }));
  if (!Array.isArray(payload.members)) invalidResponse();
  return payload.members.map(parseMember);
}

export async function updateMember(
  memberId: string,
  input: {
    role?: OrganizationMember['role'];
    status?: OrganizationMember['status'];
    projectIds?: string[];
  },
): Promise<OrganizationMember> {
  const payload = asRecord(await request(
    `/api/organization/members/${encodeURIComponent(memberId)}`,
    withCsrfProtection({
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  ));
  return parseMember(payload.member);
}

export async function createInvitation(input: {
  email: string;
  displayName: string;
  role: OrganizationInvitation['role'];
  projectIds: string[];
}): Promise<{ invitation: OrganizationInvitation; acceptUrl: string }> {
  const payload = asRecord(await request('/api/organization/invitations', withCsrfProtection({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })));
  const acceptToken = requireString(payload.acceptToken);
  if (!/^[A-Za-z0-9_-]{43}$/.test(acceptToken)) invalidResponse();
  return {
    invitation: parseInvitation(payload.invitation),
    acceptUrl: invitationUrl(acceptToken),
  };
}

export async function previewInvitation(token: string): Promise<OrganizationInvitationPreview> {
  const payload = asRecord(await request('/api/organization/invitations/preview', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ token }),
  }));
  return parseInvitationPreview(payload.invitation);
}

export async function acceptInvitation(input: {
  token: string;
  password: string;
  displayName?: string;
  mfaSecret?: string;
  mfaCode?: string;
}): Promise<OrganizationMember> {
  const payload = asRecord(await request('/api/organization/invitations/accept', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(input),
  }));
  return parseMember(payload.member);
}

export async function revokeInvitation(invitationId: string): Promise<OrganizationInvitation> {
  const payload = asRecord(await request(
    `/api/organization/invitations/${encodeURIComponent(invitationId)}/revoke`,
    withCsrfProtection({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  ));
  return parseInvitation(payload.invitation);
}

export async function resendInvitation(
  invitationId: string,
): Promise<{ invitation: OrganizationInvitation; acceptUrl: string }> {
  const payload = asRecord(await request(
    `/api/organization/invitations/${encodeURIComponent(invitationId)}/resend`,
    withCsrfProtection({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  ));
  const acceptToken = requireString(payload.acceptToken);
  if (!/^[A-Za-z0-9_-]{43}$/.test(acceptToken)) invalidResponse();
  return {
    invitation: parseInvitation(payload.invitation),
    acceptUrl: invitationUrl(acceptToken),
  };
}

async function request(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new OrganizationClientError('无法连接企业管理服务', 'ORG_NETWORK_ERROR', 0); }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new OrganizationClientError('企业管理服务返回无效', 'ORG_RESPONSE_INVALID', 502); }
  if (!response.ok) {
    const error = asRecord(asRecord(payload).error);
    throw new OrganizationClientError(
      typeof error.message === 'string' ? error.message : '企业管理请求失败',
      typeof error.code === 'string' ? error.code : 'ORG_REQUEST_FAILED',
      response.status,
    );
  }
  return payload;
}

function parseProject(value: unknown): OrganizationProject {
  const row = asRecord(value);
  const status = requireString(row.status);
  if (status !== 'active' && status !== 'archived') invalidResponse();
  if (typeof row.reviewRequired !== 'boolean') invalidResponse();
  return {
    id: requireString(row.id),
    tenantId: requireString(row.tenantId),
    name: requireString(row.name),
    ...(typeof row.defaultBrand === 'string' ? { defaultBrand: row.defaultBrand } : {}),
    ...(typeof row.defaultSku === 'string' ? { defaultSku: row.defaultSku } : {}),
    ownerUserId: requireString(row.ownerUserId),
    reviewRequired: row.reviewRequired,
    status,
    createdAt: requireString(row.createdAt),
    updatedAt: requireString(row.updatedAt),
  };
}

function parseInvitation(value: unknown): OrganizationInvitation {
  const row = asRecord(value);
  const role = requireString(row.role);
  const status = requireString(row.status);
  const deliveryStatus = requireString(row.deliveryStatus);
  if (!['admin', 'creator', 'reviewer', 'viewer'].includes(role)) invalidResponse();
  if (!['pending', 'accepted', 'canceled', 'expired'].includes(status)) invalidResponse();
  if (!['pending_configuration', 'queued', 'sent', 'failed'].includes(deliveryStatus)) invalidResponse();
  if (!Array.isArray(row.projectIds) || row.projectIds.some((id) => typeof id !== 'string')) invalidResponse();
  return {
    id: requireString(row.id),
    tenantId: requireString(row.tenantId),
    email: requireString(row.email),
    ...(typeof row.displayName === 'string' ? { displayName: row.displayName } : {}),
    role: role as OrganizationInvitation['role'],
    projectIds: [...row.projectIds] as string[],
    status: status as OrganizationInvitation['status'],
    deliveryStatus: deliveryStatus as OrganizationInvitation['deliveryStatus'],
    createdBy: requireString(row.createdBy),
    createdAt: requireString(row.createdAt),
    expiresAt: requireString(row.expiresAt),
    ...(typeof row.acceptedAt === 'string' ? { acceptedAt: row.acceptedAt } : {}),
    ...(typeof row.canceledAt === 'string' ? { canceledAt: row.canceledAt } : {}),
  };
}

function parseInvitationPreview(value: unknown): OrganizationInvitationPreview {
  const row = asRecord(value);
  const role = requireString(row.role);
  if (!['admin', 'creator', 'reviewer', 'viewer'].includes(role)) invalidResponse();
  if (!Array.isArray(row.projectIds) || row.projectIds.some((id) => typeof id !== 'string')) {
    invalidResponse();
  }
  return {
    email: requireString(row.email),
    ...(typeof row.displayName === 'string' ? { displayName: row.displayName } : {}),
    role: role as OrganizationInvitationPreview['role'],
    projectIds: [...row.projectIds] as string[],
    expiresAt: requireString(row.expiresAt),
  };
}

function parseMember(value: unknown): OrganizationMember {
  const row = asRecord(value);
  const role = requireString(row.role);
  const status = requireString(row.status);
  if (!['admin', 'creator', 'reviewer', 'viewer'].includes(role)) invalidResponse();
  if (status !== 'active' && status !== 'disabled') invalidResponse();
  if (typeof row.mfaEnabled !== 'boolean') invalidResponse();
  if (!Array.isArray(row.projectIds) || row.projectIds.some((id) => typeof id !== 'string')) {
    invalidResponse();
  }
  return {
    id: requireString(row.id),
    tenantId: requireString(row.tenantId),
    email: requireString(row.email),
    displayName: requireString(row.displayName),
    role: role as OrganizationMember['role'],
    status,
    projectIds: [...row.projectIds] as string[],
    mfaEnabled: row.mfaEnabled,
    createdAt: requireString(row.createdAt),
    updatedAt: requireString(row.updatedAt),
    ...(typeof row.firstLoginAt === 'string' ? { firstLoginAt: row.firstLoginAt } : {}),
  };
}

function invitationUrl(token: string): string {
  const url = new URL('/', window.location.origin);
  url.hash = `/accept-invitation?token=${encodeURIComponent(token)}`;
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value) invalidResponse();
  return value;
}

function invalidResponse(): never {
  throw new OrganizationClientError('企业管理服务返回无效', 'ORG_RESPONSE_INVALID', 502);
}

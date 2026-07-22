import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { AuthorizationError, type AuthContext, type AuthRole } from '../auth/authPolicy';
import { getRequestAuthContext } from '../auth/authApiPlugin';
import { IdentityError, type IdentityService } from '../auth/identityService';
import { openPiasDatabase, type PiasDatabase } from '../persistence/sqliteDatabase';
import {
  createOrganizationService,
  OrganizationError,
  type OrganizationService,
} from './organizationService';
import {
  createInvitationEmailDelivery,
  loadInvitationEmailConfig,
  type InvitationEmailConfig,
  type InvitationEmailDelivery,
  type InvitationEmailDeliveryOptions,
} from '../../worker/organization/invitationEmailDelivery';

const projectsPath = '/api/organization/projects';
const invitationsPath = '/api/organization/invitations';
const membersPath = '/api/organization/members';
const invitationPreviewPath = `${invitationsPath}/preview`;
const invitationAcceptPath = `${invitationsPath}/accept`;
const maxBodyBytes = 16 * 1024;

type MiddlewareOptions = {
  getContext?: (request: IncomingMessage) => AuthContext;
};

export function createOrganizationMiddleware(
  serviceSource: OrganizationService | (() => OrganizationService),
  options: MiddlewareOptions = {},
): Connect.NextHandleFunction {
  const getContext = options.getContext ?? getRequestAuthContext;
  return async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const revokeMatch = /^\/api\/organization\/invitations\/(invitation-[a-f0-9-]{36})\/revoke$/.exec(
      url.pathname,
    );
    const resendMatch = /^\/api\/organization\/invitations\/(invitation-[a-f0-9-]{36})\/resend$/.exec(
      url.pathname,
    );
    const memberMatch = /^\/api\/organization\/members\/(user-[a-f0-9-]{36})$/.exec(url.pathname);
    if (
      url.pathname !== projectsPath
      && url.pathname !== invitationsPath
      && url.pathname !== invitationPreviewPath
      && url.pathname !== invitationAcceptPath
      && url.pathname !== membersPath
      && !revokeMatch
      && !resendMatch
      && !memberMatch
    ) {
      next();
      return;
    }
    try {
      const service = typeof serviceSource === 'function' ? serviceSource() : serviceSource;
      if (url.pathname === invitationPreviewPath && request.method === 'POST') {
        const body = asRecord(await readJsonBody(request));
        writeJson(response, 200, {
          invitation: service.previewInvitation(requireString(body.token, '邀请令牌')),
        });
        return;
      }
      if (url.pathname === invitationAcceptPath && request.method === 'POST') {
        const body = asRecord(await readJsonBody(request));
        const displayName = optionalString(body.displayName, '成员姓名');
        const mfaSecret = optionalString(body.mfaSecret, 'MFA Secret');
        const mfaCode = optionalString(body.mfaCode, 'MFA 验证码');
        const member = await service.acceptInvitation({
          token: requireString(body.token, '邀请令牌'),
          password: requireString(body.password, '密码'),
          ...(displayName ? { displayName } : {}),
          ...(mfaSecret ? { mfaSecret } : {}),
          ...(mfaCode ? { mfaCode } : {}),
        });
        writeJson(response, 201, { member });
        return;
      }
      const context = getContext(request);
      if (url.pathname === projectsPath && request.method === 'GET') {
        writeJson(response, 200, { projects: service.listProjects(context) });
        return;
      }
      if (url.pathname === projectsPath && request.method === 'POST') {
        const body = asRecord(await readJsonBody(request));
        const defaultBrand = optionalString(body.defaultBrand, '默认品牌');
        const defaultSku = optionalString(body.defaultSku, '默认 SKU');
        const project = service.createProject(context, {
          name: requireString(body.name, '项目名称'),
          ...(defaultBrand ? { defaultBrand } : {}),
          ...(defaultSku ? { defaultSku } : {}),
          reviewRequired: requireBoolean(body.reviewRequired, '审核策略'),
        });
        writeJson(response, 201, { project });
        return;
      }
      if (url.pathname === invitationsPath && request.method === 'GET') {
        writeJson(response, 200, { invitations: service.listInvitations(context) });
        return;
      }
      if (url.pathname === invitationsPath && request.method === 'POST') {
        const body = asRecord(await readJsonBody(request));
        const displayName = optionalString(body.displayName, '成员姓名');
        const created = service.createInvitation(context, {
          email: requireString(body.email, '成员邮箱'),
          ...(displayName ? { displayName } : {}),
          role: requireString(body.role, '成员角色') as AuthRole,
          projectIds: requireStringArray(body.projectIds, '项目范围'),
        });
        writeJson(response, 201, created);
        return;
      }
      if (url.pathname === membersPath && request.method === 'GET') {
        writeJson(response, 200, { members: service.listMembers(context) });
        return;
      }
      if (memberMatch && request.method === 'PATCH') {
        const body = asRecord(await readJsonBody(request));
        const role = optionalString(body.role, '成员角色');
        const status = optionalString(body.status, '成员状态');
        const member = service.updateMember(context, memberMatch[1], {
          ...(role ? { role: role as AuthRole } : {}),
          ...(status ? { status: status as 'active' | 'disabled' } : {}),
          ...(body.projectIds !== undefined
            ? { projectIds: requireStringArray(body.projectIds, '项目范围') }
            : {}),
        });
        writeJson(response, 200, { member });
        return;
      }
      if (revokeMatch && request.method === 'POST') {
        const invitation = service.revokeInvitation(context, revokeMatch[1]);
        writeJson(response, 200, { invitation });
        return;
      }
      if (resendMatch && request.method === 'POST') {
        const created = service.resendInvitation(context, resendMatch[1]);
        writeJson(response, 201, created);
        return;
      }
      writeJson(response, 405, {
        error: { code: 'ORG_METHOD_NOT_ALLOWED', message: '请求方法不受支持' },
      });
    } catch (error) {
      const safe = normalizeError(error);
      writeJson(response, safe.statusCode, { error: { code: safe.code, message: safe.message } });
    }
  };
}

export function organizationPlugin(
  identity: IdentityService | null,
  options: {
    databaseFile?: string;
    emailConfig?: InvitationEmailConfig | null;
    emailDeliveryOptions?: InvitationEmailDeliveryOptions;
  } = {},
): Plugin {
  const emailConfig = options.emailConfig === undefined
    ? loadInvitationEmailConfig()
    : options.emailConfig;
  let database: PiasDatabase | null = null;
  let service: OrganizationService | null = null;
  let invitationDelivery: InvitationEmailDelivery | null = null;
  const getService = () => {
    if (!identity) throw new OrganizationApiError('企业身份服务尚未配置', 'ORG_NOT_CONFIGURED', 503);
    database ??= openPiasDatabase(
      options.databaseFile || process.env.PIAS_DATABASE_FILE || '/tmp/pias-image-studio/pias.sqlite',
    );
    if (emailConfig) {
      invitationDelivery ??= createInvitationEmailDelivery(
        database,
        emailConfig,
        options.emailDeliveryOptions,
      );
    }
    service ??= createOrganizationService(database, {
      userEmailExists: (email) => identity.hasUserEmail(email),
      ...(invitationDelivery ? { invitationDelivery } : {}),
    });
    return service;
  };
  identity?.setUserResolver({
    findByEmail: (email) => getService().findUserByEmail(email),
    findById: (userId) => getService().findUserById(userId),
  });
  identity?.setProjectAccessResolver((tenantId, userId) => (
    getService().projectIdsForUser(tenantId, userId)
  ));
  identity?.setLoginAuditRecorder((user, at) => getService().recordSuccessfulLogin(user, at));
  const middleware = createOrganizationMiddleware(getService);
  const mount = (server: {
    middlewares: { use(handler: Connect.NextHandleFunction): unknown };
    httpServer?: { once(event: 'close', listener: () => void): unknown } | null;
  }) => {
    server.middlewares.use(middleware);
    if (identity && emailConfig) {
      getService();
      invitationDelivery?.start();
      server.httpServer?.once('close', () => { void invitationDelivery?.stop(); });
    }
  };
  return {
    name: 'pias-organization-api',
    configureServer(server) { mount(server); },
    configurePreviewServer(server) { mount(server); },
    async closeBundle() {
      identity?.setProjectAccessResolver(null);
      identity?.setUserResolver(null);
      identity?.setLoginAuditRecorder(null);
      await invitationDelivery?.stop();
      invitationDelivery = null;
      database?.close();
      database = null;
      service = null;
    },
  };
}

class OrganizationApiError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message);
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        settled = true;
        reject(new OrganizationApiError('请求内容超过 16 KiB 限制', 'ORG_BODY_TOO_LARGE', 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new OrganizationApiError('请求内容不是有效 JSON', 'ORG_INVALID_JSON', 400)); }
    });
    request.on('error', () => {
      if (!settled) {
        settled = true;
        reject(new OrganizationApiError('读取请求失败', 'ORG_REQUEST_FAILED', 400));
      }
    });
  });
}

function normalizeError(error: unknown): OrganizationApiError {
  if (error instanceof OrganizationApiError) return error;
  if (
    error instanceof OrganizationError
    || error instanceof AuthorizationError
    || error instanceof IdentityError
  ) {
    return new OrganizationApiError(error.message, error.code, error.statusCode);
  }
  return new OrganizationApiError('企业管理服务暂不可用', 'ORG_INTERNAL_ERROR', 500);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrganizationApiError('请求格式无效', 'ORG_REQUEST_INVALID', 400);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OrganizationApiError(`${label}不能为空`, 'ORG_REQUEST_INVALID', 400);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new OrganizationApiError(`${label}格式无效`, 'ORG_REQUEST_INVALID', 400);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new OrganizationApiError(`${label}格式无效`, 'ORG_REQUEST_INVALID', 400);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new OrganizationApiError(`${label}格式无效`, 'ORG_REQUEST_INVALID', 400);
  }
  return [...value];
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(value));
}

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  createApiAuthGuard,
  createAuthApiMiddleware,
  getRequestAuthContext,
  getRequestProjectScope,
} from '../src/server/auth/authApiPlugin';
import { hashPassword, IdentityService, type AuthUser } from '../src/server/auth/identityService';
import {
  approveResult,
  completeJob,
  createJob,
  initialStudioState,
  submitForReview,
  type StudioState,
} from '../src/shared/domain';
import { authorizeStudioStateWrite } from '../src/server/studio/studioStateAuthorization';
import type {
  PersistedStudioSnapshot,
  StudioStatePersistence,
} from '../src/server/studio/studioStatePersistence';
import { createStudioStateMiddleware } from '../src/server/studio/studioStatePlugin';

const password = 'PIAS-release-2026!';
const projectId = 'project-a';

type ResponseResult = {
  statusCode: number;
  body?: Record<string, unknown>;
  headers: Map<string, string | string[]>;
};

describe('authenticated role command flow', () => {
  it('uses trusted sessions for submit/approve authorization and persisted actors', async () => {
    const users = await Promise.all([
      user('user-creator', 'creator'),
      user('user-reviewer', 'reviewer'),
    ]);
    const identity = new IdentityService(users);
    const creatorSession = await login(identity, users[0]);
    const reviewerSession = await login(identity, users[1]);
    let stored = snapshot(stateWithDraftResult(), 1);
    const persistence: StudioStatePersistence = {
      load: vi.fn(async () => structuredClone(stored)),
      save: vi.fn(async (expectedRevision, state) => {
        if (expectedRevision !== stored.revision) throw new Error('unexpected test revision');
        stored = snapshot(structuredClone(state), expectedRevision + 1);
        return structuredClone(stored);
      }),
    };
    const guard = createApiAuthGuard(identity);
    const stateApi = createStudioStateMiddleware(persistence, {
      authorizeWrite: (request, previous, requested) => authorizeStudioStateWrite({
        context: getRequestAuthContext(request),
        scope: getRequestProjectScope(request),
        previous,
        requested,
      }),
    });

    const submitted = submitForReview(stored.state, stored.state.results[0].id);
    submitted.auditEvents.at(-1)!.actor = 'forged-owner';
    const submitResponse = await invokeStack(guard, stateApi, creatorSession, stored.revision, submitted);
    expect(submitResponse.statusCode).toBe(200);
    expect(stored).toMatchObject({
      revision: 2,
      state: {
        results: [{ reviewStatus: 'submitted' }],
      },
    });
    expect(stored.state.auditEvents.at(-1)?.actor).toBe('user-creator');

    const forgedApproval = approveResult(stored.state, stored.state.results[0].id, 'forged-owner');
    const denied = await invokeStack(guard, stateApi, creatorSession, stored.revision, forgedApproval);
    expect(denied).toMatchObject({
      statusCode: 403,
      body: { error: { code: 'AUTH_FORBIDDEN' } },
    });
    expect(stored.revision).toBe(2);
    expect(stored.state.results[0].reviewStatus).toBe('submitted');

    const reviewerApproval = approveResult(stored.state, stored.state.results[0].id, 'forged-owner');
    const approved = await invokeStack(guard, stateApi, reviewerSession, stored.revision, reviewerApproval);
    expect(approved.statusCode).toBe(200);
    expect(stored.state.results[0]).toMatchObject({
      reviewStatus: 'approved',
      approvedBy: 'user-reviewer',
      reviewedBy: 'user-reviewer',
    });
    expect(stored.state.auditEvents.at(-1)?.actor).toBe('user-reviewer');
  });
});

async function user(id: string, role: AuthUser['role']): Promise<AuthUser> {
  return {
    id,
    tenantId: 'tenant-a',
    email: `${id}@pias.test`,
    displayName: id,
    passwordHash: await hashPassword(password),
    role,
    status: 'active',
    projectIds: [projectId],
    mfaEnabled: false,
  };
}

function stateWithDraftResult(): StudioState {
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

function snapshot(state: StudioState, revision: number): PersistedStudioSnapshot {
  return {
    schemaVersion: 1,
    revision,
    updatedAt: '2026-07-22T04:40:00.000Z',
    state,
  };
}

async function login(identity: IdentityService, authUser: AuthUser) {
  const response = await invokeOne(
    createAuthApiMiddleware(identity, { secureCookies: false }),
    'POST',
    '/api/auth/login',
    { 'content-type': 'application/json' },
    { email: authUser.email, password },
  );
  const setCookies = response.headers.get('set-cookie') as string[];
  const sessionToken = cookieValue(setCookies, 'pias_session');
  const csrfToken = cookieValue(setCookies, 'pias_csrf');
  return {
    cookie: `pias_session=${sessionToken}; pias_csrf=${csrfToken}`,
    csrfToken,
  };
}

async function invokeStack(
  guard: ReturnType<typeof createApiAuthGuard>,
  stateApi: ReturnType<typeof createStudioStateMiddleware>,
  session: { cookie: string; csrfToken: string },
  expectedRevision: number,
  state: StudioState,
): Promise<ResponseResult> {
  return invokeRequest((request, response, done) => {
    guard(request, response, () => {
      void stateApi(request, response, done);
    });
  }, 'PUT', '/api/studio/state', {
    cookie: session.cookie,
    'content-type': 'application/json',
    'x-pias-csrf': session.csrfToken,
    'x-pias-project-id': projectId,
  }, { schemaVersion: 1, expectedRevision, state });
}

async function invokeOne(
  middleware: (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => void,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<ResponseResult> {
  return invokeRequest((request, response, done) => {
    middleware(request, response, done);
  }, method, url, headers, body);
}

async function invokeRequest(
  run: (request: IncomingMessage, response: ServerResponse, done: () => void) => void,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<ResponseResult> {
  const request = new EventEmitter() as IncomingMessage;
  request.method = method;
  request.url = url;
  request.headers = headers;
  request.destroy = vi.fn() as never;
  let responseBody = '';
  const responseHeaders = new Map<string, string | string[]>();
  let resolveResponse: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string | number | readonly string[]) => {
      responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? [...value] : String(value));
    },
    end: (value = '') => {
      responseBody = String(value);
      resolveResponse();
    },
  } as unknown as ServerResponse;

  run(request, response, resolveResponse);
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)));
    request.emit('end');
  });
  await completed;
  return {
    statusCode: response.statusCode,
    body: responseBody ? JSON.parse(responseBody) as Record<string, unknown> : undefined,
    headers: responseHeaders,
  };
}

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`cookie missing: ${name}`);
  return cookie.slice(name.length + 1).split(';', 1)[0];
}

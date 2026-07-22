import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../src/server/auth/authPolicy';
import { createOrganizationMiddleware } from '../src/server/organization/organizationPlugin';
import { createOrganizationService } from '../src/server/organization/organizationService';
import { openPiasDatabase } from '../src/server/persistence/sqliteDatabase';

const directories: string[] = [];
const context: AuthContext = {
  userId: 'user-owner', tenantId: 'tenant-a', role: 'owner',
  projectIds: ['project-a'], mfaVerified: true,
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true, force: true,
  })));
});

describe('organization API middleware', () => {
  it('creates and lists projects through validated JSON routes', async () => {
    const { middleware, close } = await setup();
    const created = await invoke(middleware, 'POST', '/api/organization/projects', {
      name: '2026 秋季发布', reviewRequired: true,
    });
    expect(created).toMatchObject({
      statusCode: 201,
      body: { project: { name: '2026 秋季发布', ownerUserId: 'user-owner' } },
    });

    const listed = await invoke(middleware, 'GET', '/api/organization/projects');
    expect(listed).toMatchObject({
      statusCode: 200,
      body: { projects: [expect.objectContaining({ name: '2026 秋季发布' })] },
    });
    close();
  });

  it('persists an invitation without claiming email delivery is complete', async () => {
    const { middleware, close } = await setup();
    const project = await invoke(middleware, 'POST', '/api/organization/projects', {
      name: '秋季项目', reviewRequired: true,
    });
    const projectId = (project.body?.project as { id: string }).id;
    const invitation = await invoke(middleware, 'POST', '/api/organization/invitations', {
      email: 'reviewer@pias.test', role: 'reviewer', projectIds: [projectId],
    });
    expect(invitation).toMatchObject({
      statusCode: 201,
      body: {
        invitation: { status: 'pending', deliveryStatus: 'pending_configuration' },
        acceptToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
    });
    close();
  });

  it('accepts a public one-time invitation', async () => {
    const { middleware, close } = await setup();
    const project = await invoke(middleware, 'POST', '/api/organization/projects', {
      name: '公开接受项目', reviewRequired: true,
    });
    const projectId = (project.body?.project as { id: string }).id;
    const created = await invoke(middleware, 'POST', '/api/organization/invitations', {
      email: 'public-member@pias.test', role: 'viewer', projectIds: [projectId],
    });
    const acceptToken = String(created.body?.acceptToken);

    const preview = await invoke(
      middleware,
      'POST',
      '/api/organization/invitations/preview',
      { token: acceptToken },
    );
    expect(preview).toMatchObject({
      statusCode: 200,
      body: { invitation: { email: 'public-member@pias.test', role: 'viewer' } },
    });
    const accepted = await invoke(
      middleware,
      'POST',
      '/api/organization/invitations/accept',
      { token: acceptToken, password: 'PIAS-member-2026!' },
    );
    expect(accepted).toMatchObject({
      statusCode: 201,
      body: { member: { email: 'public-member@pias.test', projectIds: [projectId] } },
    });
    const second = await invoke(
      middleware,
      'POST',
      '/api/organization/invitations/accept',
      { token: acceptToken, password: 'PIAS-member-2026!' },
    );
    expect(second).toMatchObject({ statusCode: 409 });
    close();
  });

  it('reissues an invitation through an authenticated tenant route', async () => {
    const { middleware, close } = await setup();
    const project = await invoke(middleware, 'POST', '/api/organization/projects', {
      name: '重发接口项目', reviewRequired: true,
    });
    const projectId = (project.body?.project as { id: string }).id;
    const original = await invoke(middleware, 'POST', '/api/organization/invitations', {
      email: 'resend-api@pias.test', role: 'reviewer', projectIds: [projectId],
    });
    const originalId = (original.body?.invitation as { id: string }).id;

    const resent = await invoke(
      middleware,
      'POST',
      `/api/organization/invitations/${originalId}/resend`,
    );

    expect(resent).toMatchObject({
      statusCode: 201,
      body: {
        invitation: {
          email: 'resend-api@pias.test',
          status: 'pending',
        },
        acceptToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
    });
    expect((resent.body?.invitation as { id: string }).id).not.toBe(originalId);
    close();
  });

  it('lists and updates accepted members through tenant-scoped routes', async () => {
    const { middleware, close } = await setup();
    const first = await invoke(middleware, 'POST', '/api/organization/projects', {
      name: '成员接口项目一', reviewRequired: true,
    });
    const second = await invoke(middleware, 'POST', '/api/organization/projects', {
      name: '成员接口项目二', reviewRequired: false,
    });
    const firstId = (first.body?.project as { id: string }).id;
    const secondId = (second.body?.project as { id: string }).id;
    const created = await invoke(middleware, 'POST', '/api/organization/invitations', {
      email: 'api-member@pias.test', role: 'creator', projectIds: [firstId],
    });
    const accepted = await invoke(middleware, 'POST', '/api/organization/invitations/accept', {
      token: String(created.body?.acceptToken), password: 'PIAS-member-2026!',
    });
    const memberId = (accepted.body?.member as { id: string }).id;

    expect(await invoke(middleware, 'GET', '/api/organization/members')).toMatchObject({
      statusCode: 200,
      body: { members: [expect.objectContaining({ id: memberId, projectIds: [firstId] })] },
    });
    expect(await invoke(
      middleware,
      'PATCH',
      `/api/organization/members/${memberId}`,
      { role: 'reviewer', status: 'disabled', projectIds: [secondId] },
    )).toMatchObject({
      statusCode: 200,
      body: {
        member: expect.objectContaining({
          id: memberId, role: 'reviewer', status: 'disabled', projectIds: [secondId],
        }),
      },
    });
    close();
  });
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'pias-org-api-'));
  directories.push(directory);
  const database = openPiasDatabase(join(directory, 'pias.sqlite'));
  const service = createOrganizationService(database);
  return {
    middleware: createOrganizationMiddleware(service, { getContext: () => context }),
    close: () => database.close(),
  };
}

async function invoke(
  middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
  method: string,
  url: string,
  body?: unknown,
) {
  const request = new EventEmitter() as IncomingMessage;
  request.method = method;
  request.url = url;
  request.headers = {};
  request.destroy = vi.fn() as never;
  let responseBody = '';
  let resolveResponse: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
  const response = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: (value = '') => { responseBody = String(value); resolveResponse(); },
  } as unknown as ServerResponse;
  middleware(request, response, resolveResponse);
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)));
    request.emit('end');
  });
  await completed;
  return {
    statusCode: response.statusCode,
    body: responseBody ? JSON.parse(responseBody) as Record<string, unknown> : undefined,
  };
}

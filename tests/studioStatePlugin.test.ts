import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { initialStudioState } from '../src/domain';
import {
  createStudioStateMiddleware,
} from '../src/studio/studioStatePlugin';
import {
  StudioStateConflictError,
  StudioStateStorageError,
  type PersistedStudioSnapshot,
  type StudioStatePersistence,
} from '../src/studio/studioStatePersistence';

async function invoke(
  middleware: ReturnType<typeof createStudioStateMiddleware>,
  method: string,
  url: string,
  body?: unknown,
  rawBody?: Buffer,
) {
  const request = new EventEmitter() as IncomingMessage;
  request.method = method;
  request.url = url;
  request.destroy = vi.fn() as never;
  let responseBody = '';
  let resolveResponse: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
  const response = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: (value = '') => {
      responseBody = String(value);
      resolveResponse();
    },
  } as unknown as ServerResponse;
  const next = vi.fn(() => resolveResponse());

  void middleware(request, response, next);
  queueMicrotask(() => {
    if (rawBody) request.emit('data', rawBody);
    else if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)));
    request.emit('end');
  });
  await completed;

  return {
    statusCode: response.statusCode,
    body: responseBody ? JSON.parse(responseBody) as unknown : undefined,
    next,
  };
}

function snapshot(revision = 1): PersistedStudioSnapshot {
  return {
    schemaVersion: 1,
    revision,
    updatedAt: '2026-07-21T16:00:00.000Z',
    state: initialStudioState(),
  };
}

function createPersistence(): StudioStatePersistence {
  return {
    load: vi.fn().mockResolvedValue(snapshot()),
    save: vi.fn().mockResolvedValue(snapshot(2)),
  };
}

describe('StudioState API middleware', () => {
  it('returns a stable not-found response before the first save', async () => {
    const persistence = createPersistence();
    vi.mocked(persistence.load).mockResolvedValue(null);

    const response = await invoke(createStudioStateMiddleware(persistence), 'GET', '/api/studio/state');

    expect(response).toMatchObject({
      statusCode: 404,
      body: { error: { code: 'STUDIO_STATE_NOT_FOUND', message: '尚未保存工作台状态' } },
    });
  });

  it('returns the persisted snapshot', async () => {
    const response = await invoke(createStudioStateMiddleware(createPersistence()), 'GET', '/api/studio/state');

    expect(response).toMatchObject({ statusCode: 200, body: snapshot() });
  });

  it('saves a valid state and returns confirmed metadata only', async () => {
    const persistence = createPersistence();
    const state = initialStudioState();

    const response = await invoke(createStudioStateMiddleware(persistence), 'PUT', '/api/studio/state', {
      schemaVersion: 1,
      expectedRevision: 1,
      state,
    });

    expect(response).toMatchObject({
      statusCode: 200,
      body: {
        schemaVersion: 1,
        revision: 2,
        updatedAt: '2026-07-21T16:00:00.000Z',
      },
    });
    expect(response.body).not.toHaveProperty('state');
    expect(persistence.save).toHaveBeenCalledWith(1, state);
  });

  it('rejects invalid JSON', async () => {
    const response = await invoke(
      createStudioStateMiddleware(createPersistence()),
      'PUT',
      '/api/studio/state',
      undefined,
      Buffer.from('{broken'),
    );

    expect(response).toMatchObject({
      statusCode: 400,
      body: { error: { code: 'STUDIO_STATE_INVALID_JSON' } },
    });
  });

  it('rejects an invalid StudioState before calling persistence', async () => {
    const persistence = createPersistence();
    const response = await invoke(createStudioStateMiddleware(persistence), 'PUT', '/api/studio/state', {
      schemaVersion: 1,
      expectedRevision: 1,
      state: {},
    });

    expect(response).toMatchObject({
      statusCode: 400,
      body: { error: { code: 'STUDIO_STATE_INVALID' } },
    });
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it('returns 409 for a stale revision', async () => {
    const persistence = createPersistence();
    vi.mocked(persistence.save).mockRejectedValue(new StudioStateConflictError(1, 2));

    const response = await invoke(createStudioStateMiddleware(persistence), 'PUT', '/api/studio/state', {
      schemaVersion: 1,
      expectedRevision: 1,
      state: initialStudioState(),
    });

    expect(response).toMatchObject({
      statusCode: 409,
      body: { error: { code: 'STUDIO_STATE_CONFLICT', message: '工作台状态已在其他页面更新' } },
    });
  });

  it('rejects request bodies larger than five MiB', async () => {
    const response = await invoke(
      createStudioStateMiddleware(createPersistence()),
      'PUT',
      '/api/studio/state',
      undefined,
      Buffer.alloc(5 * 1024 * 1024 + 1, 'a'),
    );

    expect(response).toMatchObject({
      statusCode: 413,
      body: { error: { code: 'STUDIO_STATE_BODY_TOO_LARGE' } },
    });
  });

  it('returns a safe storage error', async () => {
    const persistence = createPersistence();
    vi.mocked(persistence.load).mockRejectedValue(new StudioStateStorageError('private path /secret'));

    const response = await invoke(createStudioStateMiddleware(persistence), 'GET', '/api/studio/state');

    expect(response).toMatchObject({
      statusCode: 500,
      body: { error: { code: 'STUDIO_STATE_STORAGE_FAILED', message: '工作台状态存储暂不可用' } },
    });
  });

  it('passes unrelated routes to the next middleware', async () => {
    const response = await invoke(createStudioStateMiddleware(createPersistence()), 'GET', '/assets/app.js');

    expect(response.next).toHaveBeenCalledOnce();
  });
});

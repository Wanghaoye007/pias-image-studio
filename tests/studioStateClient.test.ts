import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialStudioState } from '../src/domain';
import {
  loadStudioState,
  saveStudioState,
  StudioStateClientError,
} from '../src/studio/studioStateClient';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StudioState browser client', () => {
  it('loads and validates a persisted snapshot', async () => {
    const state = initialStudioState();
    state.projectName = '服务端项目';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      schemaVersion: 1,
      revision: 4,
      updatedAt: '2026-07-21T16:00:00.000Z',
      state,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadStudioState()).resolves.toMatchObject({
      revision: 4,
      state: { projectName: '服务端项目' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/studio/state', expect.objectContaining({ method: 'GET' }));
  });

  it('maps the first-run 404 response to null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'STUDIO_STATE_NOT_FOUND', message: '尚未保存工作台状态' },
    }, 404)));

    await expect(loadStudioState()).resolves.toBeNull();
  });

  it('rejects malformed success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      schemaVersion: 1,
      revision: 4,
      updatedAt: '2026-07-21T16:00:00.000Z',
      state: {},
    })));

    await expect(loadStudioState()).rejects.toMatchObject({
      code: 'STUDIO_STATE_RESPONSE_INVALID',
      status: 502,
    });
  });

  it('saves the expected revision and complete state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      schemaVersion: 1,
      revision: 5,
      updatedAt: '2026-07-21T16:01:00.000Z',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const state = initialStudioState();

    await expect(saveStudioState(4, state)).resolves.toEqual({
      schemaVersion: 1,
      revision: 5,
      updatedAt: '2026-07-21T16:01:00.000Z',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/studio/state', expect.objectContaining({
      method: 'PUT',
      headers: expect.any(Headers),
      body: JSON.stringify({ schemaVersion: 1, expectedRevision: 4, state }),
    }));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get('content-type')).toBe('application/json');
  });

  it('preserves a typed conflict code for the autosave state machine', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'STUDIO_STATE_CONFLICT', message: '工作台状态已在其他页面更新' },
    }, 409)));

    const error = await saveStudioState(1, initialStudioState()).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(StudioStateClientError);
    expect(error).toMatchObject({
      code: 'STUDIO_STATE_CONFLICT',
      status: 409,
      message: '工作台状态已在其他页面更新',
    });
  });

  it('normalizes non-JSON server failures without exposing response content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<pre>private stack</pre>', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    })));

    await expect(loadStudioState()).rejects.toMatchObject({
      code: 'STUDIO_STATE_REQUEST_FAILED',
      status: 500,
      message: '工作台状态服务暂不可用',
    });
  });
});

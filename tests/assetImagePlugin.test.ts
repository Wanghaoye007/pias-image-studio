import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  createAssetImageMiddleware,
} from '../src/server/assets/assetImagePlugin';
import type { AssetImageStorage } from '../src/server/assets/assetImageStorage';

function createStorage(): AssetImageStorage {
  return {
    read: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({
      byteLength: 4,
      contentType: 'image/png',
      fileName: 'a'.repeat(64) + '.png',
    }),
  };
}

async function invoke(
  middleware: ReturnType<typeof createAssetImageMiddleware>,
  method: string,
  url: string,
  body?: Buffer,
  contentType?: string,
) {
  const request = new EventEmitter() as IncomingMessage;
  request.method = method;
  request.url = url;
  request.headers = contentType ? { 'content-type': contentType } : {};
  request.destroy = vi.fn() as never;
  let responseBody: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let resolveResponse: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveResponse = resolve; });
  const response = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: (value: string | Buffer = '') => {
      responseBody = Buffer.isBuffer(value) ? value : Buffer.from(value);
      resolveResponse();
    },
  } as unknown as ServerResponse;
  const next = vi.fn(() => resolveResponse());

  void middleware(request, response, next);
  queueMicrotask(() => {
    if (body) request.emit('data', body);
    request.emit('end');
  });
  await completed;

  const responseText = responseBody.toString('utf8');
  return {
    statusCode: response.statusCode,
    body: responseText.startsWith('{') ? JSON.parse(responseText) as unknown : responseBody,
    next,
    response,
  };
}

describe('asset image API middleware', () => {
  it('stores a supported image and returns a stable URL', async () => {
    const storage = createStorage();
    const response = await invoke(
      createAssetImageMiddleware(storage),
      'POST',
      '/api/assets/images',
      Buffer.from('content-studio'),
      'image/png',
    );

    expect(response).toMatchObject({
      statusCode: 201,
      body: {
        byteLength: 4,
        contentType: 'image/png',
        imageUrl: `/api/assets/images/${'a'.repeat(64)}.png`,
      },
    });
    expect(storage.save).toHaveBeenCalledWith({
      bytes: Buffer.from('content-studio'),
      contentType: 'image/png',
    });
  });

  it('embeds the authorized project in scoped image URLs and rejects a mismatched path', async () => {
    const storage = createStorage();
    const middleware = createAssetImageMiddleware(storage, {
      scopeFromRequest: () => ({ tenantId: 'tenant-a', projectId: 'project-a' }),
    });
    const uploaded = await invoke(
      middleware,
      'POST',
      '/api/assets/images',
      Buffer.from('content-studio'),
      'image/png',
    );

    expect(uploaded).toMatchObject({
      statusCode: 201,
      body: { imageUrl: `/api/assets/images/project-a/${'a'.repeat(64)}.png` },
    });

    const mismatch = await invoke(
      middleware,
      'GET',
      `/api/assets/images/project-b/${'a'.repeat(64)}.png`,
    );
    expect(mismatch).toMatchObject({
      statusCode: 404,
      body: { error: { code: 'ASSET_IMAGE_NOT_FOUND' } },
    });
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('rejects unsupported content types before storage', async () => {
    const storage = createStorage();
    const response = await invoke(
      createAssetImageMiddleware(storage),
      'POST',
      '/api/assets/images',
      Buffer.from('svg'),
      'image/svg+xml',
    );

    expect(response).toMatchObject({
      statusCode: 415,
      body: { error: { code: 'ASSET_IMAGE_TYPE_UNSUPPORTED' } },
    });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects images larger than ten MiB', async () => {
    const response = await invoke(
      createAssetImageMiddleware(createStorage()),
      'POST',
      '/api/assets/images',
      Buffer.alloc(10 * 1024 * 1024 + 1, 1),
      'image/webp',
    );

    expect(response).toMatchObject({
      statusCode: 413,
      body: { error: { code: 'ASSET_IMAGE_TOO_LARGE' } },
    });
  });

  it('serves stored images with nosniff and immutable cache headers', async () => {
    const storage = createStorage();
    vi.mocked(storage.read).mockResolvedValue({
      bytes: Buffer.from('image-bytes'),
      contentType: 'image/webp',
    });
    const fileName = `${'b'.repeat(64)}.webp`;

    const response = await invoke(
      createAssetImageMiddleware(storage),
      'GET',
      `/api/assets/images/${fileName}`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(Buffer.from('image-bytes'));
    expect(storage.read).toHaveBeenCalledWith(fileName);
    expect(response.response.setHeader).toHaveBeenCalledWith('x-content-type-options', 'nosniff');
    expect(response.response.setHeader).toHaveBeenCalledWith('cache-control', 'private, max-age=31536000, immutable');
  });

  it('passes unrelated routes to the next middleware', async () => {
    const response = await invoke(
      createAssetImageMiddleware(createStorage()),
      'GET',
      '/assets/app.js',
    );

    expect(response.next).toHaveBeenCalledOnce();
  });
});

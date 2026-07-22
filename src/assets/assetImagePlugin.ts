import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  createFileAssetImageStorage,
  createScopedAssetImageStorage,
  type AssetImageStorage,
} from './assetImageStorage';
import { getRequestProjectScope, type RequestProjectScope } from '../auth/authApiPlugin';

const collectionPath = '/api/assets/images';
const itemPath = /^\/api\/assets\/images\/([a-f0-9]{64}\.(?:jpg|png|webp))$/;
const scopedItemPath = /^\/api\/assets\/images\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})\/([a-f0-9]{64}\.(?:jpg|png|webp))$/;
const maxImageBytes = 10 * 1024 * 1024;
const acceptedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

class AssetImageApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AssetImageApiError';
  }
}

export function createAssetImageMiddleware(
  storageSource: AssetImageStorage | ((request: IncomingMessage) => AssetImageStorage),
  options: {
    scopeFromRequest?: (request: IncomingMessage) => RequestProjectScope;
  } = {},
): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const itemMatch = itemPath.exec(url.pathname);
    const scopedItemMatch = scopedItemPath.exec(url.pathname);
    if (url.pathname !== collectionPath && !itemMatch && !scopedItemMatch) {
      next();
      return;
    }

    try {
      const scope = options.scopeFromRequest?.(request);
      if (scopedItemMatch && scope && scopedItemMatch[1] !== scope.projectId) {
        writeJson(response, 404, {
          error: { code: 'ASSET_IMAGE_NOT_FOUND', message: '素材图片不存在' },
        });
        return;
      }
      const storage = typeof storageSource === 'function'
        ? storageSource(request)
        : storageSource;
      if (request.method === 'POST' && url.pathname === collectionPath) {
        const contentType = getContentType(request);
        if (!acceptedContentTypes.has(contentType)) {
          throw new AssetImageApiError(
            '仅支持 PNG、JPG 或 WebP 图片',
            'ASSET_IMAGE_TYPE_UNSUPPORTED',
            415,
          );
        }
        const bytes = await readImageBody(request);
        if (bytes.length === 0) {
          throw new AssetImageApiError('图片内容为空', 'ASSET_IMAGE_EMPTY', 400);
        }
        const stored = await storage.save({ bytes, contentType });
        writeJson(response, 201, {
          imageUrl: scope
            ? `${collectionPath}/${encodeURIComponent(scope.projectId)}/${stored.fileName}`
            : `${collectionPath}/${stored.fileName}`,
          contentType: stored.contentType,
          byteLength: stored.byteLength,
        });
        return;
      }

      if (request.method === 'GET' && (itemMatch || scopedItemMatch)) {
        const stored = await storage.read((scopedItemMatch ?? itemMatch)![scopedItemMatch ? 2 : 1]);
        if (!stored) {
          writeJson(response, 404, {
            error: { code: 'ASSET_IMAGE_NOT_FOUND', message: '素材图片不存在' },
          });
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', stored.contentType);
        response.setHeader('content-length', stored.bytes.length.toString());
        response.setHeader('cache-control', 'private, max-age=31536000, immutable');
        response.setHeader('x-content-type-options', 'nosniff');
        response.end(stored.bytes);
        return;
      }

      writeJson(response, 405, {
        error: { code: 'ASSET_IMAGE_METHOD_NOT_ALLOWED', message: '请求方法不受支持' },
      });
    } catch (error) {
      const safeError = normalizeError(error);
      writeJson(response, safeError.statusCode, {
        error: { code: safeError.code, message: safeError.message },
      });
    }
  };
}

export function assetImagePlugin(options: { scoped?: boolean; scopedDirectory?: string } = {}): Plugin {
  const rootDirectory = options.scopedDirectory
    || process.env.PIAS_ASSET_DIR
    || '/tmp/pias-image-studio/assets';
  const cache = new Map<string, AssetImageStorage>();
  const storage = options.scoped
    ? (request: IncomingMessage) => {
        const scope = getRequestProjectScope(request);
        const key = `${scope.tenantId}\0${scope.projectId}`;
        let scopedStorage = cache.get(key);
        if (!scopedStorage) {
          scopedStorage = createScopedAssetImageStorage(rootDirectory, scope);
          cache.set(key, scopedStorage);
        }
        return scopedStorage;
      }
    : createFileAssetImageStorage(rootDirectory);
  const middleware = createAssetImageMiddleware(storage, {
    ...(options.scoped ? { scopeFromRequest: getRequestProjectScope } : {}),
  });
  return {
    name: 'pias-asset-images',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function getContentType(request: IncomingMessage): string {
  const header = request.headers['content-type'];
  const value = Array.isArray(header) ? header[0] : header;
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function readImageBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxImageBytes) {
        settled = true;
        reject(new AssetImageApiError(
          '图片不能超过 10 MiB',
          'ASSET_IMAGE_TOO_LARGE',
          413,
        ));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function normalizeError(error: unknown): AssetImageApiError {
  if (error instanceof AssetImageApiError) return error;
  return new AssetImageApiError(
    '素材图片服务暂不可用',
    'ASSET_IMAGE_STORAGE_FAILED',
    500,
  );
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}

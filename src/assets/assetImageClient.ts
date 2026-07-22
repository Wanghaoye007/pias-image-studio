export type UploadedAssetImage = {
  imageUrl: string;
  contentType: string;
  byteLength: number;
};

const acceptedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxImageBytes = 10 * 1024 * 1024;

export class AssetImageClientError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'AssetImageClientError';
  }
}

export async function uploadAssetImage(file: File): Promise<UploadedAssetImage> {
  if (!acceptedContentTypes.has(file.type)) {
    throw new AssetImageClientError('仅支持 PNG、JPG 或 WebP 图片', 'ASSET_IMAGE_TYPE_UNSUPPORTED', 415);
  }
  if (file.size === 0) {
    throw new AssetImageClientError('图片内容为空', 'ASSET_IMAGE_EMPTY', 400);
  }
  if (file.size > maxImageBytes) {
    throw new AssetImageClientError('图片不能超过 10 MB', 'ASSET_IMAGE_TOO_LARGE', 413);
  }

  let response: Response;
  try {
    response = await fetch('/api/assets/images', withCsrfProtection({
      method: 'POST',
      headers: { 'content-type': file.type },
      body: file,
    }));
  } catch {
    throw new AssetImageClientError('无法连接素材图片服务', 'ASSET_IMAGE_NETWORK_ERROR', 0);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const error = readError(payload);
    throw new AssetImageClientError(
      error?.message ?? '素材图片上传失败',
      error?.code ?? 'ASSET_IMAGE_UPLOAD_FAILED',
      response.status,
    );
  }
  const record = asRecord(payload);
  if (
    typeof record.imageUrl !== 'string'
    || typeof record.contentType !== 'string'
    || !Number.isInteger(record.byteLength)
  ) {
    throw new AssetImageClientError('素材图片服务返回无效', 'ASSET_IMAGE_RESPONSE_INVALID', 502);
  }
  return {
    imageUrl: record.imageUrl,
    contentType: record.contentType,
    byteLength: record.byteLength as number,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readError(value: unknown): { code: string; message: string } | null {
  const record = asRecord(value, false);
  const error = record ? asRecord(record.error, false) : null;
  return error && typeof error.code === 'string' && typeof error.message === 'string'
    ? { code: error.code, message: error.message }
    : null;
}

function asRecord(value: unknown, required = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (required) throw new AssetImageClientError('素材图片服务返回无效', 'ASSET_IMAGE_RESPONSE_INVALID', 502);
    return {};
  }
  return value as Record<string, unknown>;
}
import { withCsrfProtection } from '../auth/authClient';

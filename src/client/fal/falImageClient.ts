import type { TaskProfileId } from '../../shared/domain';
import { withCsrfProtection } from '../auth/authClient';
import type { FalGeneratedImage } from '../../shared/fal/multipleAngles';

type Fetcher = typeof fetch;

export const FAL_LIFECYCLE_ABORT_REASON = 'content-studio:lifecycle-unmount';

export type RunFalImageInput = {
  profileId: TaskProfileId;
  imageUrls: string[];
  prompt: string;
  ratio: string;
  outputCount: number;
  parameters: Record<string, unknown>;
  maskImageUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type FalImageJobResult = {
  images: FalGeneratedImage[];
  seed?: number;
  modelId: string;
  childRequestIds: string[];
};

type RunFalImageOptions = {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  onExecution?: (execution: { requestId: string; modelId: string }) => void;
  onProgress?: (progress: number) => void;
};

export type FalImageExecution = {
  requestId: string;
  modelId: string;
};

function shouldCancelRemoteJob(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted && signal.reason !== FAL_LIFECYCLE_ABORT_REASON);
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取输入图片'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function isPublicRemoteUrl(imageUrl: string): boolean {
  if (!imageUrl.startsWith('https://')) return false;
  if (typeof window === 'undefined') return true;
  const url = new URL(imageUrl, window.location.href);
  return url.origin !== window.location.origin
    && url.hostname !== '127.0.0.1'
    && url.hostname !== 'localhost';
}

export async function prepareImageUrlForFal(
  imageUrl: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (imageUrl.startsWith('data:') || isPublicRemoteUrl(imageUrl)) return imageUrl;
  const response = await fetcher(imageUrl, { signal });
  if (!response.ok) throw new Error('无法读取输入图片');
  return blobToDataUri(await response.blob());
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Fal 图片服务返回了无效响应');
  }
  if (!response.ok) {
    const message = (body as { error?: { message?: unknown } })?.error?.message;
    throw new Error(typeof message === 'string' ? message : 'Fal 图片服务暂时不可用');
  }
  return body as T;
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('任务已取消', 'AbortError'));
    }, { once: true });
  });
}

export async function cancelFalImageJob(
  requestId: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  await readJson<{ canceled: boolean }>(await fetcher(
    `/api/fal/jobs/${encodeURIComponent(requestId)}`,
    withCsrfProtection({ method: 'DELETE' }),
  ));
}

async function pollFalImageJob(
  requestId: string,
  options: RunFalImageOptions,
): Promise<FalImageJobResult> {
  const fetcher = options.fetcher ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 1200;

  while (true) {
    const queue = await readJson<{
      status: 'queued' | 'running' | 'completed';
      logs: string[];
      progress: number;
    }>(await fetcher(`/api/fal/jobs/${encodeURIComponent(requestId)}/status`, withCsrfProtection({
      signal: options.signal,
    })));
    options.onProgress?.(queue.progress);
    if (queue.status === 'completed') break;
    await wait(pollIntervalMs, options.signal);
  }

  return readJson<FalImageJobResult>(await fetcher(
    `/api/fal/jobs/${encodeURIComponent(requestId)}/result`,
    withCsrfProtection({ signal: options.signal }),
  ));
}

export async function resumeFalImageJob(
  execution: FalImageExecution,
  options: RunFalImageOptions = {},
): Promise<FalImageJobResult> {
  if (!execution.requestId.trim() || !execution.modelId.trim()) {
    throw new Error('Fal 图片任务信息不完整');
  }
  const fetcher = options.fetcher ?? fetch;
  try {
    return await pollFalImageJob(execution.requestId, options);
  } catch (error) {
    if (shouldCancelRemoteJob(options.signal)) {
      await cancelFalImageJob(execution.requestId, fetcher).catch(() => undefined);
    }
    throw error;
  }
}

export async function runFalImageJob(
  input: RunFalImageInput,
  options: RunFalImageOptions = {},
): Promise<FalImageJobResult> {
  const fetcher = options.fetcher ?? fetch;
  let requestId = '';

  try {
    const imageUrls = await Promise.all(input.imageUrls.map((imageUrl) => (
      prepareImageUrlForFal(imageUrl, fetcher, options.signal)
    )));
    const maskImageUrl = input.maskImageUrl
      ? await prepareImageUrlForFal(input.maskImageUrl, fetcher, options.signal)
      : undefined;
    const submission = await readJson<{ requestId: string; modelId: string }>(await fetcher(
      '/api/fal/jobs',
      withCsrfProtection({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...input,
          imageUrls,
          ...(maskImageUrl ? { maskImageUrl } : {}),
        }),
        signal: options.signal,
      }),
    ));
    requestId = submission.requestId;
    if (!requestId || !submission.modelId) throw new Error('Fal 图片服务未返回任务信息');
    options.onExecution?.({ requestId, modelId: submission.modelId });
    options.onProgress?.(24);
    return await pollFalImageJob(requestId, options);
  } catch (error) {
    if (requestId && shouldCancelRemoteJob(options.signal)) {
      await cancelFalImageJob(requestId, fetcher).catch(() => undefined);
    }
    throw error;
  }
}

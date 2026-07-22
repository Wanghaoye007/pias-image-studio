import type { StudioState } from '../../shared/domain';
import type { PersistedStudioSnapshot } from '../../shared/studio/types';
import { parseStudioState } from '../../shared/studio/studioStateSchema';
import { withCsrfProtection } from '../auth/authClient';

export type PersistedStudioSnapshotMeta = Omit<PersistedStudioSnapshot, 'state'>;

export class StudioStateClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StudioStateClientError';
  }
}

export async function loadStudioState(): Promise<PersistedStudioSnapshot | null> {
  let response: Response;
  try {
    response = await fetch('/api/studio/state', withCsrfProtection({ method: 'GET' }));
  } catch (error) {
    throw requestFailed(error);
  }

  if (response.status === 404) return null;
  const payload = await readPayload(response);
  if (!response.ok) throw responseError(response, payload);

  try {
    const meta = parseMeta(payload);
    const record = asRecord(payload);
    return { ...meta, state: parseStudioState(record.state) };
  } catch (error) {
    if (error instanceof StudioStateClientError) throw error;
    throw new StudioStateClientError(
      '服务端返回的工作台状态无效',
      'STUDIO_STATE_RESPONSE_INVALID',
      502,
      { cause: error },
    );
  }
}

export async function saveStudioState(
  expectedRevision: number,
  state: StudioState,
): Promise<PersistedStudioSnapshotMeta> {
  let response: Response;
  try {
    response = await fetch('/api/studio/state', withCsrfProtection({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, expectedRevision, state }),
    }));
  } catch (error) {
    throw requestFailed(error);
  }

  const payload = await readPayload(response);
  if (!response.ok) throw responseError(response, payload);

  try {
    return parseMeta(payload);
  } catch (error) {
    if (error instanceof StudioStateClientError) throw error;
    throw new StudioStateClientError(
      '服务端返回的保存结果无效',
      'STUDIO_STATE_RESPONSE_INVALID',
      502,
      { cause: error },
    );
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(response: Response, payload: unknown): StudioStateClientError {
  const body = safeErrorBody(payload);
  return new StudioStateClientError(
    body?.message ?? '工作台状态服务暂不可用',
    body?.code ?? 'STUDIO_STATE_REQUEST_FAILED',
    response.status,
  );
}

function requestFailed(error: unknown): StudioStateClientError {
  return new StudioStateClientError(
    '无法连接工作台状态服务',
    'STUDIO_STATE_NETWORK_ERROR',
    0,
    { cause: error },
  );
}

function safeErrorBody(payload: unknown): { code: string; message: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const record = error as Record<string, unknown>;
  return typeof record.code === 'string' && typeof record.message === 'string'
    ? { code: record.code, message: record.message }
    : null;
}

function parseMeta(value: unknown): PersistedStudioSnapshotMeta {
  const record = asRecord(value);
  if (record.schemaVersion !== 1) throw new Error('schemaVersion');
  if (!Number.isInteger(record.revision) || (record.revision as number) < 1) throw new Error('revision');
  if (typeof record.updatedAt !== 'string' || !record.updatedAt) throw new Error('updatedAt');
  return {
    schemaVersion: 1,
    revision: record.revision as number,
    updatedAt: record.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record');
  return value as Record<string, unknown>;
}

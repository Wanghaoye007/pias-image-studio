export type ProductionLogWriter = (message: string) => void;

const safeFields = new Set([
  'requestId',
  'method',
  'path',
  'status',
  'durationMs',
  'host',
  'port',
  'version',
  'revision',
  'signal',
  'component',
  'operation',
]);

export function serializeProductionLog(
  event: string,
  fields: Record<string, unknown> = {},
  error?: unknown,
): string {
  const entry: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (safeFields.has(key) && isSafeValue(value)) entry[key] = value;
  }
  if (error !== undefined) entry.errorCode = safeErrorCode(error);
  return JSON.stringify(entry);
}

export function writeProductionLog(
  logger: ProductionLogWriter | undefined,
  event: string,
  fields: Record<string, unknown> = {},
  error?: unknown,
) {
  if (!logger) return;
  try {
    logger(serializeProductionLog(event, fields, error));
  } catch {
    // Logging must never break request handling or worker cleanup.
  }
}

function isSafeValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  }
  return 'UNEXPECTED_ERROR';
}

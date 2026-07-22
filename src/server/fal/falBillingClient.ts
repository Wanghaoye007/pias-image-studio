import { readFile } from 'node:fs/promises';
import { parseFalKey } from './falCredentials';

export type FalBillingEvent = {
  requestId: string;
  endpointId: string;
  timestamp: string;
  outputUnits: number;
  unitPrice: number;
  percentDiscount: number | null;
  costNanoUsd: number;
};

export type FalBillingReconciliation = {
  status: 'confirmed' | 'pending' | 'unavailable';
  events: FalBillingEvent[];
  totalCostNanoUsd: number;
  currency: 'USD';
  checkedAt: string;
  reason?: 'admin_key_missing' | 'billing_access_denied' | 'billing_api_error' | 'billing_events_incomplete';
};

export type FalBillingAdapter = {
  lookup(requestIds: string[]): Promise<FalBillingReconciliation>;
};

type BillingEventResponse = {
  billing_events?: unknown[];
};

export function createFalBillingClient(options: {
  fetcher?: typeof fetch;
  readAdminKey?: () => Promise<string>;
  now?: () => Date;
} = {}): FalBillingAdapter {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  return {
    async lookup(requestIds) {
      const uniqueRequestIds = [...new Set(requestIds.filter(Boolean))];
      const checkedAt = now().toISOString();
      let credentials: string;
      try {
        credentials = await (options.readAdminKey ?? readFalAdminKey)();
      } catch {
        return reconciliation('unavailable', [], checkedAt, 'admin_key_missing');
      }

      const url = new URL('https://api.fal.ai/v1/models/billing-events');
      url.searchParams.set('limit', String(Math.max(1, uniqueRequestIds.length)));
      uniqueRequestIds.forEach((requestId) => url.searchParams.append('request_id', requestId));
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { Authorization: `Key ${credentials}` },
        });
      } catch {
        return reconciliation('pending', [], checkedAt, 'billing_api_error');
      }
      if (!response.ok) {
        return reconciliation(
          response.status === 401 || response.status === 403 ? 'unavailable' : 'pending',
          [],
          checkedAt,
          response.status === 401 || response.status === 403
            ? 'billing_access_denied'
            : 'billing_api_error',
        );
      }

      let body: BillingEventResponse;
      try {
        body = await response.json() as BillingEventResponse;
      } catch {
        return reconciliation('pending', [], checkedAt, 'billing_api_error');
      }
      const expected = new Set(uniqueRequestIds);
      const events = (body.billing_events ?? [])
        .map(parseBillingEvent)
        .filter((event): event is FalBillingEvent => event !== null && expected.has(event.requestId));
      const seen = new Set(events.map((event) => event.requestId));
      return reconciliation(
        uniqueRequestIds.every((requestId) => seen.has(requestId)) ? 'confirmed' : 'pending',
        events,
        checkedAt,
        uniqueRequestIds.every((requestId) => seen.has(requestId))
          ? undefined
          : 'billing_events_incomplete',
      );
    },
  };
}

export async function readFalAdminKey(options: {
  env?: Record<string, string | undefined>;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  if (env.FAL_ADMIN_KEY) return parseFalKey(env.FAL_ADMIN_KEY);
  if (!env.FAL_ADMIN_KEY_FILE) throw new Error('Fal 账单凭证未配置');
  try {
    return parseFalKey(await readFile(env.FAL_ADMIN_KEY_FILE, 'utf8'));
  } catch {
    throw new Error('Fal 账单凭证未配置');
  }
}

function reconciliation(
  status: FalBillingReconciliation['status'],
  events: FalBillingEvent[],
  checkedAt: string,
  reason?: FalBillingReconciliation['reason'],
): FalBillingReconciliation {
  return {
    status,
    events,
    totalCostNanoUsd: events.reduce((total, event) => total + event.costNanoUsd, 0),
    currency: 'USD',
    checkedAt,
    ...(reason ? { reason } : {}),
  };
}

function parseBillingEvent(value: unknown): FalBillingEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.request_id !== 'string'
    || typeof event.endpoint_id !== 'string'
    || typeof event.timestamp !== 'string'
    || !nonNegative(event.output_units)
    || !nonNegative(event.unit_price)
    || !nonNegative(event.cost_estimate_nano_usd)
    || (event.percent_discount !== null && !nonNegative(event.percent_discount))
  ) return null;
  return {
    requestId: event.request_id,
    endpointId: event.endpoint_id,
    timestamp: event.timestamp,
    outputUnits: event.output_units,
    unitPrice: event.unit_price,
    percentDiscount: event.percent_discount as number | null,
    costNanoUsd: event.cost_estimate_nano_usd,
  };
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

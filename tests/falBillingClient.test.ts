import { describe, expect, it, vi } from 'vitest';
import { createFalBillingClient } from '../src/fal/falBillingClient';

describe('Fal billing events client', () => {
  it('reconciles request-level billing events with an isolated admin key', async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify({
      billing_events: [
        {
          request_id: 'request-1',
          endpoint_id: 'fal-ai/model-a',
          timestamp: '2026-07-22T00:00:00Z',
          output_units: 2,
          unit_price: 0.01,
          percent_discount: 10,
          cost_estimate_nano_usd: 18_000_000,
        },
        {
          request_id: 'request-2',
          endpoint_id: 'fal-ai/model-b',
          timestamp: '2026-07-22T00:00:01Z',
          output_units: 1,
          unit_price: 0.02,
          percent_discount: null,
          cost_estimate_nano_usd: 20_000_000,
        },
      ],
      next_cursor: null,
      has_more: false,
    }), { status: 200 }));
    const client = createFalBillingClient({
      fetcher,
      readAdminKey: async () => 'admin-id:admin-secret',
      now: () => new Date('2026-07-22T00:01:00Z'),
    });

    await expect(client.lookup(['request-1', 'request-2'])).resolves.toMatchObject({
      status: 'confirmed',
      totalCostNanoUsd: 38_000_000,
      currency: 'USD',
      checkedAt: '2026-07-22T00:01:00.000Z',
      events: [
        { requestId: 'request-1', outputUnits: 2, costNanoUsd: 18_000_000 },
        { requestId: 'request-2', outputUnits: 1, costNanoUsd: 20_000_000 },
      ],
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toContain('request_id=request-1');
    expect(String(url)).toContain('request_id=request-2');
    expect(options).toMatchObject({ headers: { Authorization: 'Key admin-id:admin-secret' } });
  });

  it('marks reconciliation unavailable without transmitting the inference key', async () => {
    const fetcher = vi.fn();
    const client = createFalBillingClient({
      fetcher,
      readAdminKey: async () => { throw new Error('missing'); },
    });

    await expect(client.lookup(['request-1'])).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'admin_key_missing',
      events: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps reconciliation pending until every request has a billing event', async () => {
    const client = createFalBillingClient({
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        billing_events: [{
          request_id: 'request-1',
          endpoint_id: 'fal-ai/model-a',
          timestamp: '2026-07-22T00:00:00Z',
          output_units: 1,
          unit_price: 0.01,
          percent_discount: null,
          cost_estimate_nano_usd: 10_000_000,
        }],
      }), { status: 200 })),
      readAdminKey: async () => 'admin-id:admin-secret',
    });

    await expect(client.lookup(['request-1', 'request-2'])).resolves.toMatchObject({
      status: 'pending',
      reason: 'billing_events_incomplete',
      events: [{ requestId: 'request-1' }],
    });
  });
});

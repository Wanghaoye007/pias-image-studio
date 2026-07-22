import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error The production preflight intentionally stays executable as plain Node.js.
import { checkFalBillingAccess } from '../scripts/check-fal-billing-access.mjs';

describe('Fal billing access preflight', () => {
  it('confirms Billing Events access without returning credentials or response data', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      billing_events: [{ request_id: 'private-request-id' }],
    }), { status: 200 }));

    await expect(checkFalBillingAccess({
      env: { FAL_ADMIN_KEY: 'admin-id:admin-secret' },
      fetcher,
    })).resolves.toEqual({ ok: true, status: 200, reason: 'billing_access_confirmed' });
    expect(JSON.stringify(await checkFalBillingAccess({
      env: { FAL_ADMIN_KEY: 'admin-id:admin-secret' },
      fetcher,
    }))).not.toContain('admin-secret');
  });

  it('does not fall back to the inference key', async () => {
    const fetcher = vi.fn();

    await expect(checkFalBillingAccess({
      env: { FAL_KEY: 'inference-id:inference-secret' },
      fetcher,
    })).resolves.toEqual({ ok: false, status: null, reason: 'admin_key_missing' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports denied Admin API permission without exposing the provider body', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      detail: 'authorization_error private-details',
    }), { status: 403 }));

    await expect(checkFalBillingAccess({
      env: { FAL_ADMIN_KEY: 'admin-id:admin-secret' },
      fetcher,
    })).resolves.toEqual({ ok: false, status: 403, reason: 'billing_access_denied' });
  });
});

#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkFalBillingAccess(options = {}) {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  let key;
  try {
    key = env.FAL_ADMIN_KEY
      ? parseAdminKey(env.FAL_ADMIN_KEY)
      : parseAdminKey(await readFile(env.FAL_ADMIN_KEY_FILE, 'utf8'));
  } catch {
    return { ok: false, status: null, reason: 'admin_key_missing' };
  }

  let response;
  try {
    response = await fetcher('https://api.fal.ai/v1/models/billing-events?limit=1', {
      headers: { Authorization: `Key ${key}` },
    });
  } catch {
    return { ok: false, status: null, reason: 'billing_api_unreachable' };
  }
  if (response.ok) {
    return { ok: true, status: response.status, reason: 'billing_access_confirmed' };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: response.status, reason: 'billing_access_denied' };
  }
  return { ok: false, status: response.status, reason: 'billing_api_error' };
}

function parseAdminKey(raw) {
  const assignment = raw.match(/(?:^|\n)\s*(?:export\s+)?FAL_ADMIN_KEY\s*=\s*["']?([^\s"'`#]+)["']?/m);
  if (assignment?.[1]) return assignment[1];
  const bareLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes(':') && !line.startsWith('#') && !line.startsWith('```'));
  if (bareLine && !/\s/.test(bareLine)) return bareLine.replace(/^["']|["']$/g, '');
  throw new Error('Fal Admin Key is missing');
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const result = await checkFalBillingAccess();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

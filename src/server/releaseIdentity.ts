import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthReleaseIdentity } from './healthPlugin';

export function loadReleaseIdentity(
  artifactDirectory: string,
  fallback: HealthReleaseIdentity,
): HealthReleaseIdentity {
  try {
    const metadata = JSON.parse(
      readFileSync(join(artifactDirectory, 'release.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (
      metadata.schemaVersion !== 1
      || metadata.service !== 'content-studio'
      || typeof metadata.version !== 'string'
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version)
      || typeof metadata.revision !== 'string'
      || !/^[a-f0-9]{7,40}$/.test(metadata.revision)
    ) {
      return fallback;
    }
    return { version: metadata.version, revision: metadata.revision };
  } catch {
    return fallback;
  }
}

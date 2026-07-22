import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HealthReadiness } from './healthPlugin';

const expectedDatabaseVersion = 7;

type ProductionReadinessOptions = {
  databaseFile?: string;
  artifactDirectory: string;
  assetDirectory?: string;
  identityConfigured: boolean;
};

export function createProductionReadinessCheck(
  options: ProductionReadinessOptions,
): () => Promise<HealthReadiness> {
  return async () => {
    const [database, artifact, assets] = await Promise.all([
      checkDatabase(options.databaseFile),
      checkArtifact(options.artifactDirectory),
      checkAssets(options.assetDirectory),
    ]);
    const checks: HealthReadiness['checks'] = {
      database,
      artifact,
      assets,
      identity: options.identityConfigured ? 'ok' : 'failed',
    };
    return {
      ok: Object.values(checks).every((status) => status === 'ok'),
      checks,
    };
  };
}

async function checkDatabase(filePath?: string): Promise<'ok' | 'failed'> {
  if (!filePath) return 'failed';
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(filePath, { readOnly: true });
    const integrity = database.prepare('PRAGMA quick_check').get()?.quick_check;
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    return integrity === 'ok' && version === expectedDatabaseVersion ? 'ok' : 'failed';
  } catch {
    return 'failed';
  } finally {
    database?.close();
  }
}

async function checkArtifact(directory: string): Promise<'ok' | 'failed'> {
  try {
    const info = await stat(join(directory, 'index.html'));
    return info.isFile() && info.size > 0 ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

async function checkAssets(directory?: string): Promise<'ok' | 'failed'> {
  if (!directory) return 'failed';
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) return 'failed';
    await access(directory, constants.R_OK | constants.W_OK);
    return 'ok';
  } catch {
    return 'failed';
  }
}

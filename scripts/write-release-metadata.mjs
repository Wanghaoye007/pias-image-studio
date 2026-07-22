#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeReleaseMetadata } from './write-release-metadata-core.mjs';

const artifactDirectory = process.env.PIAS_RELEASE_ARTIFACT_DIR || 'dist';
const revision = process.env.PIAS_RELEASE_REVISION || gitOutput(['rev-parse', 'HEAD']) || 'unknown';
const dirtyOverride = process.env.PIAS_RELEASE_DIRTY;
const dirty = dirtyOverride === undefined
  ? gitOutput(['status', '--porcelain']).length > 0
  : dirtyOverride === 'true';
const metadata = await writeReleaseMetadata({
  packageFile: join(process.cwd(), 'package.json'),
  artifactDirectory,
  revision,
  dirty,
  builtAt: new Date().toISOString(),
});
process.stdout.write(`${JSON.stringify(metadata)}\n`);

function gitOutput(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

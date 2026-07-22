import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeReleaseMetadata(options) {
  const packageDocument = JSON.parse(await readFile(options.packageFile, 'utf8'));
  const metadata = {
    schemaVersion: 1,
    service: 'pias-image-studio',
    version: packageDocument.version,
    revision: options.revision,
    dirty: options.dirty,
    builtAt: options.builtAt,
  };
  if (!isValidMetadata(metadata)) throw new Error('发布元数据无效');

  const target = join(options.artifactDirectory, 'release.json');
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o644);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return metadata;
}

function isValidMetadata(metadata) {
  return metadata.schemaVersion === 1
    && metadata.service === 'pias-image-studio'
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version)
    && (metadata.revision === 'unknown' || /^[a-f0-9]{7,40}$/.test(metadata.revision))
    && typeof metadata.dirty === 'boolean'
    && typeof metadata.builtAt === 'string'
    && Number.isFinite(Date.parse(metadata.builtAt));
}

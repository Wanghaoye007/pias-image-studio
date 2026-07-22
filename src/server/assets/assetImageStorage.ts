import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AssetImageScope = {
  tenantId: string;
  projectId: string;
};

export type StoredAssetImage = {
  byteLength: number;
  contentType: string;
  fileName: string;
};

export type AssetImageStorage = {
  read(fileName: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  save(input: { bytes: Buffer; contentType: string }): Promise<StoredAssetImage>;
};

const extensionsByContentType: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const contentTypesByExtension: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function createFileAssetImageStorage(
  directory = process.env.CONTENT_STUDIO_ASSET_DIR || '/tmp/content-studio/assets',
): AssetImageStorage {
  return {
    async save({ bytes, contentType }) {
      const extension = extensionsByContentType[contentType];
      if (!extension) throw new Error('不支持的素材图片格式');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const fileName = `${digest}.${extension}`;
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(join(directory, fileName), bytes, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      return { byteLength: bytes.length, contentType, fileName };
    },

    async read(fileName) {
      const match = /^([a-f0-9]{64})\.(jpg|png|webp)$/.exec(fileName);
      if (!match) return null;
      try {
        return {
          bytes: await readFile(join(directory, fileName)),
          contentType: contentTypesByExtension[match[2]],
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}

export function createScopedAssetImageStorage(
  rootDirectory: string,
  scope: AssetImageScope,
): AssetImageStorage {
  const scopeKey = createHash('sha256')
    .update(scope.tenantId)
    .update('\0')
    .update(scope.projectId)
    .digest('hex');
  return createFileAssetImageStorage(join(rootDirectory, scopeKey));
}

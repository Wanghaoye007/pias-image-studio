import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import packageDocument from './package.json';
import { assetImagePlugin } from './src/server/assets/assetImagePlugin';
import { authApiPlugin } from './src/server/auth/authApiPlugin';
import { loadIdentityServiceFromConfig } from './src/server/auth/authConfig';
import { falImageProxyPlugin } from './src/server/fal/falProxyPlugin';
import { organizationPlugin } from './src/server/organization/organizationPlugin';
import { healthPlugin } from './src/server/healthPlugin';
import { createProductionReadinessCheck } from './src/server/productionReadiness';
import { loadReleaseIdentity } from './src/server/releaseIdentity';
import { studioStatePlugin } from './src/server/studio/studioStatePlugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PIAS_');
  const identity = loadIdentityServiceFromConfig(
    process.env.PIAS_AUTH_CONFIG_FILE || env.PIAS_AUTH_CONFIG_FILE,
  );
  const secureCookies = (process.env.PIAS_SECURE_COOKIES || env.PIAS_SECURE_COOKIES)
    ? (process.env.PIAS_SECURE_COOKIES || env.PIAS_SECURE_COOKIES) !== 'false'
    : mode !== 'development';
  const persistenceBackend = (process.env.PIAS_PERSISTENCE_BACKEND
    || env.PIAS_PERSISTENCE_BACKEND) === 'file' ? 'file' : 'sqlite';
  const databaseFile = process.env.PIAS_DATABASE_FILE || env.PIAS_DATABASE_FILE;
  const assetDirectory = process.env.PIAS_ASSET_DIR
    || env.PIAS_ASSET_DIR
    || '/tmp/pias-image-studio/assets';
  const artifactDirectory = process.env.PIAS_RELEASE_ARTIFACT_DIR
    || env.PIAS_RELEASE_ARTIFACT_DIR
    || 'dist';

  return {
    plugins: [
      react(),
      healthPlugin({
        release: loadReleaseIdentity(artifactDirectory, {
          version: process.env.PIAS_RELEASE_VERSION || packageDocument.version,
          revision: process.env.PIAS_RELEASE_REVISION || (mode === 'development' ? 'development' : 'unknown'),
        }),
        readinessCheck: createProductionReadinessCheck({
          databaseFile,
          artifactDirectory,
          assetDirectory,
          identityConfigured: Boolean(identity),
        }),
      }),
      authApiPlugin(identity, { secureCookies }),
      organizationPlugin(identity, { ...(databaseFile ? { databaseFile } : {}) }),
      assetImagePlugin({
        scoped: Boolean(identity),
        scopedDirectory: assetDirectory,
      }),
      studioStatePlugin({
        scoped: Boolean(identity),
        persistenceBackend,
        ...(databaseFile ? { databaseFile } : {}),
      }),
      falImageProxyPlugin({
        scoped: Boolean(identity),
        persistenceBackend,
        ...(databaseFile ? { databaseFile } : {}),
      }),
    ],
  };
});

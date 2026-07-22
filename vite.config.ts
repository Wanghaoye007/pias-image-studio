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
  const env = loadEnv(mode, process.cwd(), 'CONTENT_STUDIO_');
  const identity = loadIdentityServiceFromConfig(
    process.env.CONTENT_STUDIO_AUTH_CONFIG_FILE || env.CONTENT_STUDIO_AUTH_CONFIG_FILE,
  );
  const secureCookies = (process.env.CONTENT_STUDIO_SECURE_COOKIES || env.CONTENT_STUDIO_SECURE_COOKIES)
    ? (process.env.CONTENT_STUDIO_SECURE_COOKIES || env.CONTENT_STUDIO_SECURE_COOKIES) !== 'false'
    : mode !== 'development';
  const persistenceBackend = (process.env.CONTENT_STUDIO_PERSISTENCE_BACKEND
    || env.CONTENT_STUDIO_PERSISTENCE_BACKEND) === 'file' ? 'file' : 'sqlite';
  const databaseFile = process.env.CONTENT_STUDIO_DATABASE_FILE || env.CONTENT_STUDIO_DATABASE_FILE;
  const assetDirectory = process.env.CONTENT_STUDIO_ASSET_DIR
    || env.CONTENT_STUDIO_ASSET_DIR
    || '/tmp/content-studio/assets';
  const artifactDirectory = process.env.CONTENT_STUDIO_RELEASE_ARTIFACT_DIR
    || env.CONTENT_STUDIO_RELEASE_ARTIFACT_DIR
    || 'dist';

  return {
    plugins: [
      react(),
      healthPlugin({
        release: loadReleaseIdentity(artifactDirectory, {
          version: process.env.CONTENT_STUDIO_RELEASE_VERSION || packageDocument.version,
          revision: process.env.CONTENT_STUDIO_RELEASE_REVISION || (mode === 'development' ? 'development' : 'unknown'),
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

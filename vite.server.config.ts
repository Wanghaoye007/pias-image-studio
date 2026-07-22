import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/server/productionServer.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'server.mjs',
      },
    },
  },
});

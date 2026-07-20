import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { falImageProxyPlugin } from './src/fal/falProxyPlugin';

export default defineConfig({
  plugins: [react(), falImageProxyPlugin()],
});

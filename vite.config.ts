import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { falImageProxyPlugin } from './src/fal/falProxyPlugin';
import { studioStatePlugin } from './src/studio/studioStatePlugin';

export default defineConfig({
  plugins: [react(), studioStatePlugin(), falImageProxyPlugin()],
});

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  // Preload is built via `rollupOptions.input` (not `build.lib`), so override the
  // output name here. Without this it emits `index.js`, colliding with the main
  // build; this yields `.vite/build/preload.js` (matches the path loaded in
  // createWindow.ts).
  build: {
    rollupOptions: { output: { entryFileNames: 'preload.js' } },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
});

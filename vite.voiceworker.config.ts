import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Build config for the voice inference worker — a `utilityProcess` entry that
// hosts sherpa-onnx (STT/TTS/VAD) off the main thread. Mirrors
// vite.main.config.ts; see that file for why the output filename is pinned
// (Forge's Vite plugin names builds `[name].js` from the entry basename, so
// every main-target entry needs a distinct explicit name) and why native
// modules stay external.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/voice/worker.ts',
      formats: ['cjs'],
      fileName: () => 'voice-worker.js',
    },
    rollupOptions: {
      external: ['sherpa-onnx-node'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
});

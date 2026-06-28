// Ambient types so the renderer is aware of the API exposed by the preload
// script through `contextBridge` (see src/preload/index.ts).

import type { LimbooApi } from './preload';

declare global {
  interface Window {
    limboo: LimbooApi;
  }
}

export {};

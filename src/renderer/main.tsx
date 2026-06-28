/**
 * Renderer entry point (Electron "renderer" / Chromium context).
 *
 * Responsibilities are intentionally narrow: import global styles, mount React,
 * gate the shell behind a startup hydration step (so persisted settings/layout
 * are restored before first paint), and wrap everything in an error boundary.
 * No Node/OS access happens here — that lives in the main process and is reached
 * through the `window.limboo` preload bridge.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/index.css';
import { App } from '@/renderer/App';
import { ErrorBoundary } from '@/renderer/components/feedback/ErrorBoundary';
import { LoadingScreen } from '@/renderer/components/feedback/LoadingScreen';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';

function Root() {
  const hydrated = useSettingsStore((s) => s.hydrated);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    void hydrate();
    // Keep the splash up briefly so the transition never flickers on fast loads.
    const t = setTimeout(() => setMinElapsed(true), 250);
    return () => clearTimeout(t);
  }, [hydrate]);

  if (!hydrated || !minElapsed) {
    return <LoadingScreen />;
  }
  return <App />;
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);

/**
 * Top-level React error boundary. Isolates rendering failures so a single
 * broken component cannot take down the whole window; shows a recoverable
 * fallback and logs the error to the main process for observability.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Logo } from '@/renderer/components/brand/Logo';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console; in a packaged app this reaches the devtools and
    // the main-process log captures uncaught errors separately.
    // eslint-disable-next-line no-console
    console.error('Renderer error boundary caught:', error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-base px-6 text-center text-fg">
        <Logo size={40} />
        <div className="flex items-center gap-2 text-danger">
          <TriangleAlert size={18} />
          <span className="text-[15px] font-semibold">Something went wrong</span>
        </div>
        <p className="max-w-md text-[13px] text-muted">
          A part of the interface failed to render. You can try to recover, or
          reload the window.
        </p>
        <pre className="max-h-40 max-w-lg overflow-auto rounded-lg border border-line bg-surface px-3 py-2 text-left font-mono text-[11px] text-faint">
          {error.message}
        </pre>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
          >
            <RotateCcw size={13} />
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            Reload window
          </button>
        </div>
      </div>
    );
  }
}

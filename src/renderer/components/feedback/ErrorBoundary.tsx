/**
 * Top-level React error boundary. Isolates rendering failures so a single
 * broken component cannot take down the whole window; shows a recoverable
 * fallback and logs the error to the main process for observability.
 *
 * The fallback is an on-palette card (logo, message, copyable diagnostics, and
 * recover/reload actions) anchored above the same skyline illustration used on
 * the Workspace screens, so a crash still feels like part of the product.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Check, Copy, RotateCcw, TriangleAlert } from 'lucide-react';
import { Logo } from '@/renderer/components/brand/Logo';
import { WorkspaceSkyline } from '@/renderer/features/workspace/WorkspaceSkyline';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false };
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // Surface to the console; in a packaged app this reaches the devtools and
    // the main-process log captures uncaught errors separately.
    // eslint-disable-next-line no-console
    console.error('Renderer error boundary caught:', error, info.componentStack);
  }

  componentWillUnmount(): void {
    if (this.copyTimer) clearTimeout(this.copyTimer);
  }

  private reset = (): void => this.setState({ error: null, componentStack: null, copied: false });

  /** Copy the full diagnostic (message + stacks) so users can paste it into a report. */
  private copy = (): void => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const report = [error.message, error.stack, componentStack]
      .filter(Boolean)
      .join('\n\n');
    void window.limboo?.system?.clipboardWrite(report);
    this.setState({ copied: true });
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.setState({ copied: false }), 1400);
  };

  render(): ReactNode {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-base text-fg">
        {/* Cardless — content sits directly on black, mirroring the workspace screens. */}
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <Logo size={40} />
          <div className="flex items-center gap-2 text-danger">
            <TriangleAlert size={18} />
            <span className="text-[15px] font-semibold">Something went wrong</span>
          </div>
          <p className="max-w-md text-[13px] leading-relaxed text-muted">
            A part of the interface failed to render. You can try to recover, or reload the
            window. Copy the details below if you want to report it.
          </p>

          <div className="relative w-full max-w-lg">
            <pre className="max-h-40 w-full overflow-auto rounded-lg border border-line bg-surface-2 px-3 py-2 pr-16 text-left font-mono text-[11px] leading-relaxed text-faint">
              {error.message}
            </pre>
            <button
              type="button"
              onClick={this.copy}
              className="absolute right-2 top-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-elevated hover:text-fg"
            >
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

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

          {/* Soft fade so the content dissolves into the skyline instead of colliding. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-16 bg-gradient-to-t from-base to-transparent" />
        </div>

        {/* Same full-width animated skyline footer as the Workspace screens. */}
        <WorkspaceSkyline className="h-[24vh] max-h-[220px] min-h-[130px] shrink-0" />
      </div>
    );
  }
}

/**
 * TerminalView — hosts one xterm.js instance bound to a main-process PTY.
 *
 * The renderer never touches a shell directly: keystrokes go out through
 * `window.limboo.terminal.write` and PTY output streams back via `onData`. This
 * component owns the xterm lifecycle, replays buffered scrollback on mount, fits
 * the grid to its container (reporting size changes back to the PTY), and themes
 * the terminal with the app's pure-black design tokens so it matches the shell.
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_LIMITS, clamp } from '@shared/constants';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';

/** Read a CSS custom property off the root element (token → hex). */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function TerminalView({
  workspaceId,
  terminalId,
}: {
  workspaceId: string;
  terminalId: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cfg = useSettingsStore((s) => s.settings.agent.terminal);
  // Snapshot appearance at mount; changing it remounts the view (parent `key`).
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    const host = hostRef.current;
    const api = window.limboo?.terminal;
    if (!host || !api) return;

    const c = cfgRef.current;
    const fontFamily =
      c.fontFamily?.trim() ||
      token('--font-mono', 'ui-monospace, SFMono-Regular, Menlo, monospace');

    const terminal = new Terminal({
      fontFamily,
      fontSize: clamp(c.fontSize, TERMINAL_LIMITS.fontSize.min, TERMINAL_LIMITS.fontSize.max),
      cursorStyle: c.cursorStyle,
      cursorBlink: c.cursorBlink,
      scrollback: c.scrollback,
      allowProposedApi: true,
      theme: {
        background: token('--color-base', '#000000'),
        foreground: token('--color-fg', '#ededed'),
        cursor: token('--color-accent', '#6e9bff'),
        cursorAccent: token('--color-base', '#000000'),
        selectionBackground: token('--color-line-strong', '#2a2a2a'),
        black: '#000000',
        brightBlack: token('--color-faint', '#6b6b6b'),
        white: token('--color-fg', '#ededed'),
        brightWhite: '#ffffff',
        blue: token('--color-accent', '#6e9bff'),
        green: token('--color-success', '#3fb950'),
        yellow: token('--color-warning', '#d29922'),
        red: token('--color-danger', '#f85149'),
      },
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);

    const doFit = () => {
      try {
        fit.fit();
        api.resize(terminalId, terminal.cols, terminal.rows);
      } catch {
        // The host may be momentarily detached — ignore.
      }
    };
    doFit();
    terminal.focus();

    // Replay buffered scrollback for this terminal, then stream live output.
    let disposed = false;
    void (async () => {
      try {
        const { scrollback } = await api.list(workspaceId);
        const buffered = scrollback[terminalId];
        if (!disposed && buffered) terminal.write(buffered);
      } catch {
        // Fresh terminal — nothing to replay.
      }
    })();

    // xterm → PTY (keystrokes / paste).
    const inputSub = terminal.onData((data) => api.write(terminalId, data));

    // PTY → xterm (output), filtered to this terminal.
    const offData = api.onData((chunk) => {
      if (chunk.terminalId === terminalId) terminal.write(chunk.data);
    });
    const offExit = api.onExit((exit) => {
      if (exit.terminalId === terminalId) {
        terminal.write(`\r\n\x1b[2m[process exited with code ${exit.exitCode}]\x1b[0m\r\n`);
      }
    });

    // Copy-on-select, when enabled.
    let selectionSub: { dispose: () => void } | null = null;
    if (c.copyOnSelect) {
      selectionSub = terminal.onSelectionChange(() => {
        const sel = terminal.getSelection();
        if (sel) void window.limboo?.system.clipboardWrite(sel);
      });
    }

    const ro = new ResizeObserver(() => doFit());
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      inputSub.dispose();
      selectionSub?.dispose();
      offData();
      offExit();
      terminal.dispose();
    };
    // terminalId identifies the PTY; remount on change is intentional.
  }, [terminalId, workspaceId]);

  return <div ref={hostRef} className="h-full w-full" />;
}

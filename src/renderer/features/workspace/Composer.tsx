/**
 * The composer — a self-contained interaction surface docked at the bottom of
 * the center column in normal flow. It is NOT a full-width bar welded to the
 * window edge: it's a centered rounded card with a gap on every side and no
 * separator line. Because it sits in flow (not absolutely positioned), the
 * conversation scroll area above it shrinks to fit and messages are never
 * hidden behind it.
 *
 * Wired to the Coding Agent Manager: submitting forwards the prompt to the active
 * session's Claude Code run. The footer reflects the live agent *lifecycle* and
 * the active *request* phase, and exposes quick model/thinking/permission
 * controls (left) plus a Send/Stop control (right). Context-aware banners explain
 * rate limits, expired auth, pending approvals, and context warnings.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUp, CircleStop, Mic, Paperclip, Sparkles, Volume2 } from 'lucide-react';
import type { SessionPermissionMode } from '@shared/types';
import { cn } from '@/renderer/lib/cn';
import { Spinner } from '@/renderer/components/ui';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useVoiceStore } from '@/renderer/stores/useVoiceStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { lifecycleMeta, phaseLabel } from '@/renderer/features/agent/status';
import { RUNNING_PHASES } from '@/renderer/features/sessions/useSessionRunning';
import { ComposerControls } from './ComposerControls';
import { ComposerModeSwitch } from './ComposerModeSwitch';
import { ComposerBanner } from './ComposerBanner';
import { ComposerVoiceOverlay } from './ComposerVoiceOverlay';

/** Voice phases during which the composer shows the recording overlay. */
const VOICE_CAPTURE_PHASES = new Set(['starting', 'listening', 'recording', 'transcribing']);

/** Max grow height before the editor scrolls internally (~40vh). */
const MAX_HEIGHT = 320;

export function Composer({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const sessionId = useSessionStore((s) => s.selectedId);
  const lifecycle = useAgentStore((s) => s.lifecycle);
  // This session's own run phase — sessions can run concurrently, so "is THIS
  // composer's session busy" must never be read off a single global field (that
  // mismatch used to make one session's composer look idle/ready while it was
  // actually still streaming or awaiting a decision, simply because a different
  // session had more recently touched the shared state).
  const phase = useAgentStore((s) => (sessionId ? s.requestsBySession[sessionId]?.phase : undefined));
  const installed = useAgentStore((s) => s.install.installed);
  const installError = useAgentStore((s) => s.install.error);
  const runningTool = useAgentStore((s) =>
    sessionId ? s.bySession[sessionId]?.toolCalls.find((c) => c.status === 'running')?.name : undefined,
  );
  const send = useAgentStore((s) => s.send);
  const stop = useAgentStore((s) => s.stop);
  const globalDefaultMode = useSettingsStore((s) => s.settings.agent.plan.defaultMode);
  // A workspace can pin its own starting mode (repo-level Plan-first), overriding
  // the global default — the desktop equivalent of `permissions.defaultMode`.
  const workspaceDefaultMode = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === s.activeId)?.config.planDefaultMode,
  );
  const defaultMode: SessionPermissionMode = workspaceDefaultMode ?? globalDefaultMode;

  // Per-session composer mode, owned by the agent store so plan approval can
  // flip a session out of Plan mode (see composerModeBySession). A session with
  // no stored entry uses the resolved Plan-first default.
  const storedMode = useAgentStore((s) =>
    sessionId ? s.composerModeBySession[sessionId] : undefined,
  );
  const setComposerMode = useAgentStore((s) => s.setComposerMode);
  const mode: SessionPermissionMode = storedMode ?? defaultMode;
  const setMode = (next: SessionPermissionMode) => {
    if (sessionId) setComposerMode(sessionId, next);
  };

  const busy = !!phase && RUNNING_PHASES.has(phase);
  const restricted = lifecycle === 'rate-limited' || lifecycle === 'auth-required';
  const blocked = disabled || !installed || busy || restricted;

  // Voice — speech is another input for the SAME session (never a separate
  // conversation). The mic is the DEFAULT primary button while the textarea is
  // empty; typing morphs it into the send arrow (ChatGPT-style).
  const voicePhase = useVoiceStore((s) => s.state.phase);
  const voiceSessionId = useVoiceStore((s) => s.state.sessionId);
  const modelsReady = useVoiceStore((s) => s.state.modelsReady);
  const startVoice = useVoiceStore((s) => s.startVoice);
  const stopSpeaking = useVoiceStore((s) => s.stopSpeaking);
  const voiceEnabled = useSettingsStore((s) => s.settings.voice.enabled);
  const voiceReady = voiceEnabled && modelsReady.stt && modelsReady.vad;
  const voiceCapturing = VOICE_CAPTURE_PHASES.has(voicePhase) && voiceSessionId === sessionId;

  const beginVoice = () => {
    if (blocked || !sessionId) return;
    if (!voiceReady) {
      useUIStore.getState().addToast({
        title: voiceEnabled ? 'Speech recognition not installed' : 'Voice is disabled',
        description: voiceEnabled
          ? 'Install the speech-recognition + voice-activity models in Settings › Voice to talk.'
          : 'Enable voice in Settings › Voice.',
        tone: 'warning',
      });
      useUIStore.getState().openModal('settings');
      return;
    }
    void startVoice(sessionId, mode).catch((err) => {
      useUIStore.getState().addToast({
        title: 'Voice input failed',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    });
  };

  const autoGrow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  };

  // Keep the height correct when the value is cleared programmatically.
  useEffect(() => {
    if (value === '') autoGrow();
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || blocked || !sessionId) return;
    void send(sessionId, text, mode);
    setValue('');
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.overflowY = 'hidden';
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="bg-surface px-4 pb-6 pt-1">
      <div className="mx-auto w-full max-w-3xl">
        <ComposerBanner />
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface-2 px-4 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.6)] transition-colors focus-within:border-line-strong">
            {voiceCapturing ? (
              <ComposerVoiceOverlay phase={voicePhase} />
            ) : (
              <>
                <button
                  type="button"
                  className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Attach"
                  disabled={blocked}
                >
                  <Paperclip size={15} />
                </button>
                <textarea
                  ref={ref}
                  rows={1}
                  value={value}
                  disabled={disabled || !installed}
                  onChange={(e) => {
                    setValue(e.target.value);
                    autoGrow();
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={composerPlaceholder(disabled, installed, restricted, mode)}
                  className="flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-fg placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
                  style={{ maxHeight: MAX_HEIGHT }}
                />
                {busy ? (
                  <button
                    type="button"
                    onClick={() => sessionId && stop(sessionId)}
                    className="mb-0.5 flex h-7 items-center gap-1.5 rounded-full bg-surface px-2.5 text-[12px] font-semibold text-fg transition-colors hover:bg-elevated"
                  >
                    <CircleStop size={14} />
                    Stop
                  </button>
                ) : value.trim().length === 0 ? (
                  /* Default (empty) state: the voice button — typing morphs it
                     into the send arrow, ChatGPT-style. */
                  <button
                    type="button"
                    onClick={beginVoice}
                    disabled={blocked}
                    title={
                      voiceReady
                        ? 'Voice input'
                        : 'Install the local speech models in Settings › Voice'
                    }
                    className={cn(
                      'mb-0.5 flex h-7 w-7 items-center justify-center rounded-full transition-opacity',
                      blocked
                        ? 'cursor-not-allowed bg-surface text-faint'
                        : voiceReady
                          ? 'bg-accent text-base hover:opacity-90'
                          : 'bg-surface text-muted hover:text-fg',
                    )}
                    aria-label="Voice input"
                  >
                    <Mic size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={blocked}
                    className={cn(
                      'mb-0.5 flex h-7 w-7 items-center justify-center rounded-full transition-opacity',
                      blocked
                        ? 'cursor-not-allowed bg-surface text-faint'
                        : 'bg-accent text-base hover:opacity-90',
                    )}
                    aria-label="Send"
                  >
                    <ArrowUp size={15} />
                  </button>
                )}
              </>
            )}
          </div>

          {/* One-line footer: as the center column narrows (side panels dragged
              inward) the controls SHRINK — the select labels truncate — rather
              than wrapping onto a new bottom row. No horizontal-overflow here on
              purpose: the selects' popovers open upward, and any overflow-x would
              force overflow-y:auto and clip them. */}
          <div className="flex min-w-0 flex-nowrap items-center gap-x-2 px-1">
            <ComposerModeSwitch mode={mode} onChange={setMode} disabled={disabled || !installed} />
            <span className="hidden h-3.5 w-px shrink-0 bg-line sm:block" />
            <ComposerControls disabled={disabled || !installed} />
            <span className="ml-auto flex min-w-0 shrink items-center gap-2 text-[11px] text-faint">
              {voicePhase === 'speaking' && (
                <button
                  type="button"
                  onClick={() => void stopSpeaking()}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-elevated"
                  title="Stop speaking"
                >
                  <Volume2 size={11} />
                  Speaking — tap to stop
                </button>
              )}
              <StatusHint
                installed={installed}
                installError={installError}
                busy={busy}
                lifecycle={lifecycle}
                phase={phase}
                toolName={runningTool}
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function composerPlaceholder(
  disabled: boolean,
  installed: boolean,
  restricted: boolean,
  mode: SessionPermissionMode,
): string {
  if (!installed) return 'Sign in to Claude Code to start…';
  if (restricted) return 'Drafting is fine — sending resumes shortly…';
  if (disabled) return 'Select or create a session to begin…';
  if (mode === 'plan') return 'Describe what to build — Claude Code will plan it first (read-only)…';
  return 'Ask Claude Code to build something…';
}

function StatusHint({
  installed,
  installError,
  busy,
  lifecycle,
  phase,
  toolName,
}: {
  installed: boolean;
  installError?: string;
  busy: boolean;
  lifecycle: ReturnType<typeof useAgentStore.getState>['lifecycle'];
  /** This session's own phase (per-session — see the `phase` selector above). */
  phase: ReturnType<typeof useAgentStore.getState>['request']['phase'] | undefined;
  toolName?: string;
}) {
  const meta = lifecycleMeta(lifecycle, installed);
  if (!installed) {
    return (
      <span className={cn('flex items-center gap-1', meta.text)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
        {installError ? 'Not connected' : meta.label}
      </span>
    );
  }
  if (busy) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-muted">
        <Spinner size={11} />
        {/* `busy` implies `phase` is set (see the busy derivation above). */}
        <span className="truncate">{phaseLabel(phase ?? 'streaming', toolName)}</span>
      </span>
    );
  }
  if (lifecycle === 'ready') {
    return (
      <span className="flex items-center gap-1 text-faint">
        <Sparkles size={11} /> Claude Code ready
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-1', meta.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

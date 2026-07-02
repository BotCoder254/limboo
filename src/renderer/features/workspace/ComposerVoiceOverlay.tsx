/**
 * The recording surface that replaces the composer's textarea row while a
 * voice capture is in flight: cancel (✕) · live waveform · confirm (✓).
 * While transcribing it shows a spinner instead of the waveform. Rendered
 * inside the same rounded `bg-surface-2` container so the composer's shape
 * never changes — only its contents morph.
 */
import { Check, X } from 'lucide-react';
import type { VoicePhase } from '@shared/types';
import { cn } from '@/renderer/lib/cn';
import { Spinner, Waveform } from '@/renderer/components/ui';
import { activeCapture } from '@/renderer/lib/voice/capture';
import { useVoiceStore } from '@/renderer/stores/useVoiceStore';

export function ComposerVoiceOverlay({ phase }: { phase: VoicePhase }) {
  const stopVoice = useVoiceStore((s) => s.stopVoice);
  const cancelVoice = useVoiceStore((s) => s.cancelVoice);
  const transcribing = phase === 'transcribing';
  const analyser = activeCapture()?.analyser ?? null;

  return (
    <div className="flex min-h-[36px] flex-1 items-center gap-2">
      <button
        type="button"
        onClick={() => void cancelVoice()}
        disabled={transcribing}
        aria-label="Cancel voice input"
        className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X size={15} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {transcribing ? (
          <div className="flex items-center gap-2 px-1">
            <Spinner size={14} />
            <span className="text-[12px] text-muted">Transcribing…</span>
          </div>
        ) : (
          <>
            <Waveform analyser={analyser} height={26} className="min-w-0 flex-1" />
            <span
              className={cn(
                'shrink-0 text-[11px]',
                phase === 'recording' ? 'text-accent' : 'text-faint',
              )}
            >
              {phase === 'recording' ? 'Listening…' : 'Waiting for speech…'}
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => void stopVoice()}
        disabled={transcribing}
        aria-label="Finish and send"
        className={cn(
          'mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-opacity',
          transcribing
            ? 'cursor-not-allowed bg-surface text-faint'
            : 'bg-accent text-base hover:opacity-90',
        )}
      >
        <Check size={15} />
      </button>
    </div>
  );
}

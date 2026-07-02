/**
 * Settings › Voice — the full configuration surface of the Voice subsystem:
 * local speech models (download cards with circular progress), input (mic,
 * activation, VAD tuning), output (voice, speed, volume, streaming), playback
 * event gating, behavior/shortcuts, and storage/network policy.
 *
 * Everything is workspace-independent (speech preferences belong to the user)
 * and writes through the standard optimistic `useSettingsStore.update` path.
 */
import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { VOICE_LIMITS } from '@shared/constants';
import { Kbd, Waveform } from '@/renderer/components/ui';
import { startCapture, listAudioDevices } from '@/renderer/lib/voice/capture';
import type { CaptureHandle } from '@/renderer/lib/voice/capture';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useVoiceStore } from '@/renderer/stores/useVoiceStore';
import { Field, Section, SegmentedControl, Select, Toggle } from '../controls';
import { VoiceModelCard } from '../VoiceModelCard';

type VoiceSettings = AppSettings['voice'];

function ActionButton({
  label,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        danger
          ? 'rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-danger transition-colors hover:border-danger disabled:opacity-40'
          : 'rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted transition-colors hover:text-fg disabled:opacity-40'
      }
    >
      {label}
    </button>
  );
}

/** 3-second local mic check rendering live levels (never leaves the renderer). */
function MicTest({ deviceId }: { deviceId: string }) {
  const [handle, setHandle] = useState<CaptureHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    handle?.stop();
    setHandle(null);
  };
  // Tear the test mic down on unmount (stop is stable for this purpose).
  useEffect(() => stop, []);

  const run = async () => {
    setError(null);
    try {
      const h = await startCapture({ deviceId: deviceId || undefined, onChunk: () => undefined });
      setHandle(h);
      timer.current = setTimeout(() => {
        h.stop();
        setHandle(null);
      }, 3000);
    } catch {
      setError('Microphone unavailable');
    }
  };

  return (
    <div className="flex items-center gap-2">
      {handle && <Waveform analyser={handle.analyser} height={20} className="w-28" />}
      {error && <span className="text-[11px] text-danger">{error}</span>}
      <ActionButton label={handle ? 'Stop' : 'Test mic'} onClick={handle ? stop : () => void run()} />
    </div>
  );
}

export function VoicePanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const models = useVoiceStore((s) => s.models);
  const voiceError = useVoiceStore((s) => s.error);
  const speak = useVoiceStore((s) => s.speak);
  const removeModel = useVoiceStore((s) => s.removeModel);
  const revealModels = useVoiceStore((s) => s.revealModels);

  const voice = settings.voice;
  const patch = (p: Partial<{ [K in keyof VoiceSettings]: Partial<VoiceSettings[K]> }>) =>
    void update({ voice: p as never });

  const [devices, setDevices] = useState<{
    inputs: { id: string; label: string }[];
    outputs: { id: string; label: string }[];
  }>({ inputs: [], outputs: [] });

  useEffect(() => {
    void listAudioDevices().then(setDevices).catch(() => undefined);
  }, []);

  const anyInstalled = models.some((m) => m.phase === 'installed');
  const allInstalled = models.length > 0 && models.every((m) => m.phase === 'installed');

  const deviceOptions = (
    list: { id: string; label: string }[],
    current: string,
  ): { value: string; label: string }[] => {
    const options = [{ value: '', label: 'System default' }];
    for (const d of list) if (d.id !== 'default') options.push({ value: d.id, label: d.label });
    if (current && !options.some((o) => o.value === current)) {
      options.push({ value: current, label: 'Previously selected (unplugged)' });
    }
    return options;
  };

  return (
    <div className="flex flex-col gap-6">
      <Field
        id="voiceEnabled"
        label="Enable voice"
        hint="Speak to the same coding session you type to — speech is processed entirely on this machine."
      >
        <Toggle
          checked={voice.enabled}
          onChange={(enabled) => void update({ voice: { enabled } })}
          aria-label="Enable voice"
        />
      </Field>

      {voiceError && (
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-danger">
          {voiceError}
        </p>
      )}

      <Section
        title="Speech models"
        hint={
          allInstalled
            ? 'All local speech models are installed. Speech recognition and synthesis run fully offline.'
            : 'Voice needs local speech models (a one-time download). After installing, no audio or text ever leaves this machine — speech works offline.'
        }
      >
        <div data-field-id="voiceModels" className="flex flex-col divide-y divide-line/60">
          {models.map((model) => (
            <VoiceModelCard key={model.id} model={model} />
          ))}
          {models.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-faint">
              Model catalog unavailable in this environment.
            </p>
          )}
        </div>
      </Section>

      <Section title="Input" hint="How Limboo listens.">
        <Field id="voiceInputDevice" label="Microphone">
          <Select
            value={voice.input.deviceId}
            options={deviceOptions(devices.inputs, voice.input.deviceId)}
            onChange={(deviceId) => patch({ input: { deviceId } })}
          />
        </Field>
        <Field
          id="voiceActivation"
          label="Activation"
          hint="Automatic stops on its own when you pause; tap-to-toggle waits for another click."
        >
          <SegmentedControl
            value={voice.input.activation}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'toggle', label: 'Tap to toggle' },
              { value: 'push-to-talk', label: 'Push to talk' },
            ]}
            onChange={(activation) => patch({ input: { activation } })}
          />
        </Field>
        <Field
          id="voiceSensitivity"
          label="Input sensitivity"
          hint="How confidently speech must be detected before recording starts."
        >
          <Select
            value={String(voice.input.sensitivity)}
            options={[
              { value: '0.3', label: 'High (picks up quiet speech)' },
              { value: '0.5', label: 'Balanced' },
              { value: '0.7', label: 'Low (ignores background noise)' },
            ]}
            onChange={(v) => patch({ input: { sensitivity: Number(v) } })}
          />
        </Field>
        <Field
          id="voiceSilence"
          label="End of speech after"
          hint="Trailing silence that finishes an utterance in automatic mode."
        >
          <Select
            value={String(voice.input.silenceMs)}
            options={[
              { value: '600', label: '0.6 seconds' },
              { value: '1200', label: '1.2 seconds' },
              { value: '2000', label: '2 seconds' },
              { value: '3000', label: '3 seconds' },
            ]}
            onChange={(v) => patch({ input: { silenceMs: Number(v) } })}
          />
        </Field>
        <Field
          id="voiceLanguage"
          label="Language"
          hint="The default recognition model (Parakeet v2) is English-only."
        >
          <Select
            value={voice.input.language}
            options={[{ value: 'en', label: 'English' }]}
            onChange={(language) => patch({ input: { language } })}
          />
        </Field>
        <Field id="voicePunctuation" label="Automatic punctuation">
          <Toggle
            checked={voice.input.autoPunctuation}
            onChange={(autoPunctuation) => patch({ input: { autoPunctuation } })}
            aria-label="Automatic punctuation"
          />
        </Field>
        <Field id="voiceMicTest" label="Microphone test" hint="Levels render locally only.">
          <MicTest deviceId={voice.input.deviceId} />
        </Field>
      </Section>

      <Section title="Output" hint="How Limboo speaks.">
        <Field id="voiceOutputEnabled" label="Speak responses">
          <Toggle
            checked={voice.output.enabled}
            onChange={(enabled) => patch({ output: { enabled } })}
            aria-label="Speak responses"
          />
        </Field>
        <Field id="voiceOutputDevice" label="Speaker">
          <Select
            value={voice.output.deviceId}
            options={deviceOptions(devices.outputs, voice.output.deviceId)}
            onChange={(deviceId) => patch({ output: { deviceId } })}
          />
        </Field>
        <Field id="voiceSpeaker" label="Voice">
          <Select
            value={String(voice.output.speakerId)}
            options={Array.from({ length: VOICE_LIMITS.speakerId.max + 1 }, (_, i) => ({
              value: String(i),
              label: `Voice ${i + 1}`,
            }))}
            onChange={(v) => patch({ output: { speakerId: Number(v) } })}
          />
        </Field>
        <Field id="voiceSpeed" label="Speech speed">
          <Select
            value={String(voice.output.speed)}
            options={[
              { value: '0.75', label: '0.75×' },
              { value: '1', label: '1× (normal)' },
              { value: '1.25', label: '1.25×' },
              { value: '1.5', label: '1.5×' },
            ]}
            onChange={(v) => patch({ output: { speed: Number(v) } })}
          />
        </Field>
        <Field id="voiceVolume" label="Volume">
          <Select
            value={String(voice.output.volume)}
            options={[
              { value: '0.25', label: '25%' },
              { value: '0.5', label: '50%' },
              { value: '0.75', label: '75%' },
              { value: '1', label: '100%' },
            ]}
            onChange={(v) => patch({ output: { volume: Number(v) } })}
          />
        </Field>
        <Field
          id="voiceStreaming"
          label="Speak while generating"
          hint="Start speaking finished sentences while the rest of the response still streams."
        >
          <Toggle
            checked={voice.output.streamWhileGenerating}
            onChange={(streamWhileGenerating) => patch({ output: { streamWhileGenerating } })}
            aria-label="Speak while generating"
          />
        </Field>
        <Field
          id="voiceSpeakWhen"
          label="Speak replies to"
          hint="Voice replies only keeps typed conversations silent."
        >
          <SegmentedControl
            value={voice.output.speakWhen}
            options={[
              { value: 'voice-initiated', label: 'Voice prompts' },
              { value: 'always', label: 'All prompts' },
            ]}
            onChange={(speakWhen) => patch({ output: { speakWhen } })}
          />
        </Field>
        <Field id="voiceSpeakerTest" label="Speaker test">
          <ActionButton
            label="Play sample"
            disabled={!anyInstalled}
            onClick={() => void speak('This is Limboo speaking. Your local voice is ready.')}
          />
        </Field>
      </Section>

      <Section
        title="Playback events"
        hint="Which streamed content is eligible to be spoken aloud."
      >
        <Field id="voiceGateFinal" label="Final answers">
          <Toggle
            checked={voice.playbackEvents.finalAnswers}
            onChange={(finalAnswers) => patch({ playbackEvents: { finalAnswers } })}
            aria-label="Speak final answers"
          />
        </Field>
        <Field id="voiceGateTools" label="While tools run">
          <Toggle
            checked={voice.playbackEvents.whileToolsRun}
            onChange={(whileToolsRun) => patch({ playbackEvents: { whileToolsRun } })}
            aria-label="Speak while tools run"
          />
        </Field>
        <Field id="voiceGatePlanning" label="Planning updates">
          <Toggle
            checked={voice.playbackEvents.planningUpdates}
            onChange={(planningUpdates) => patch({ playbackEvents: { planningUpdates } })}
            aria-label="Speak planning updates"
          />
        </Field>
        <Field id="voiceGateCompletion" label="Task completion">
          <Toggle
            checked={voice.playbackEvents.taskCompletion}
            onChange={(taskCompletion) => patch({ playbackEvents: { taskCompletion } })}
            aria-label="Speak task completion"
          />
        </Field>
        <Field id="voiceGateNotifications" label="Desktop notifications">
          <Toggle
            checked={voice.playbackEvents.notifications}
            onChange={(notifications) => patch({ playbackEvents: { notifications } })}
            aria-label="Speak desktop notifications"
          />
        </Field>
      </Section>

      <Section title="Behavior & shortcuts">
        <Field
          id="voiceInterruption"
          label="When you interrupt"
          hint="What starting to talk does to speech that is still playing."
        >
          <SegmentedControl
            value={voice.interruption}
            options={[
              { value: 'stop', label: 'Stop' },
              { value: 'pause', label: 'Pause' },
              { value: 'ignore', label: 'Keep playing' },
            ]}
            onChange={(interruption) => patch({ interruption } as never)}
          />
        </Field>
        <Field id="voiceShortcutToggle" label="Toggle voice input">
          <Kbd keys={voice.shortcuts.toggle.split('+')} />
        </Field>
      </Section>

      <Section
        title="Storage & downloads"
        hint="Models live in the app's data folder and are reused across sessions — nothing re-downloads unnecessarily."
      >
        <Field
          id="voiceAutoDownload"
          label="Download missing models automatically"
          hint="Off by default — downloads only start when you ask."
        >
          <Toggle
            checked={voice.models.autoDownload}
            onChange={(autoDownload) => patch({ models: { autoDownload } })}
            aria-label="Download models automatically"
          />
        </Field>
        <Field
          id="voiceAutoUpdate"
          label="Update models automatically"
          hint="Re-download a model when the app ships a newer pinned revision."
        >
          <Toggle
            checked={voice.models.autoUpdate}
            onChange={(autoUpdate) => patch({ models: { autoUpdate } })}
            aria-label="Update models automatically"
          />
        </Field>
        <Field
          id="voiceOfflineOnly"
          label="Offline only"
          hint="Never touch the network for voice — blocks model downloads too."
        >
          <Toggle
            checked={voice.models.offlineOnly}
            onChange={(offlineOnly) => patch({ models: { offlineOnly } })}
            aria-label="Offline only"
          />
        </Field>
        <Field id="voiceStorage" label="Model storage" hint="models/local-speech in the app data folder.">
          <ActionButton label="Reveal in file manager" onClick={() => void revealModels()} />
        </Field>
        <Field
          id="voiceCache"
          label="Remove all voice models"
          hint="Frees disk space; voice stays available after re-downloading."
        >
          <ActionButton
            label="Remove all"
            danger
            disabled={!anyInstalled}
            onClick={() => {
              for (const m of models) {
                if (m.phase === 'installed') void removeModel(m.id);
              }
            }}
          />
        </Field>
      </Section>
    </div>
  );
}

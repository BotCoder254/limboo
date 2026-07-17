/**
 * Voice store — the renderer mirror of the main-process VoiceManager +
 * VoiceModelManager. Owns the capture/playback engine handles so components
 * stay purely presentational: the composer just calls `startVoice` /
 * `stopVoice`, the settings panel just renders `models`.
 */
import { create } from 'zustand';
import type { SessionPermissionMode, VoiceModelState, VoiceState } from '@shared/types';
import { startCapture, stopCapture } from '@/renderer/lib/voice/capture';
import { voicePlayback } from '@/renderer/lib/voice/playback';
import { useSettingsStore } from './useSettingsStore';

interface VoiceStoreState {
  state: VoiceState;
  models: VoiceModelState[];
  hydrated: boolean;
  /** Last user-facing error (mic denied, models missing, …). */
  error: string | null;
  /**
   * Live analyser of the active mic capture, for the composer Waveform. Held in
   * the store (not read from `activeCapture()` at render time) because the
   * capture graph finishes opening AFTER the phase flips to listening — a
   * non-reactive read would leave the waveform driven by `null` forever.
   */
  analyser: AnalyserNode | null;

  hydrate: () => Promise<void>;
  startVoice: (sessionId: string, mode: SessionPermissionMode) => Promise<void>;
  stopVoice: () => Promise<void>;
  cancelVoice: () => Promise<void>;
  stopSpeaking: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  clearError: () => void;

  downloadModel: (id: string) => Promise<void>;
  pauseModel: (id: string) => Promise<void>;
  resumeModel: (id: string) => Promise<void>;
  cancelModel: (id: string) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  verifyModel: (id: string) => Promise<boolean>;
  revealModels: () => Promise<void>;
}

const IDLE_STATE: VoiceState = {
  phase: 'idle',
  sessionId: null,
  modelsReady: { stt: false, tts: false, vad: false },
};

/** Phases during which the renderer mic graph should be running. */
const MIC_PHASES = new Set(['listening', 'recording']);

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  state: IDLE_STATE,
  models: [],
  hydrated: false,
  error: null,
  analyser: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const api = window.limboo?.voice;
    if (!api) {
      set({ hydrated: true });
      return;
    }

    const [state, models] = await Promise.all([api.getState(), api.models.list()]);
    set({ state, models, hydrated: true });

    api.onState((next) => {
      // The main process ended the capture (VAD auto-stop, error, cancel) —
      // release the mic when the phase LEAVES listening/recording. This is a
      // transition check on purpose: unrelated broadcasts that are simply not
      // in a mic phase (`starting` while the worker warms, TTS housekeeping)
      // must not tear down a mic that is still opening.
      if (MIC_PHASES.has(get().state.phase) && !MIC_PHASES.has(next.phase)) {
        stopCapture();
        set({ analyser: null });
      }
      set({ state: next, error: next.error ?? get().error });
    });

    api.onTtsChunk((chunk) => {
      const output = useSettingsStore.getState().settings.voice.output;
      voicePlayback.setVolume(output.volume);
      voicePlayback.setSink(output.deviceId);
      voicePlayback.enqueue(chunk);
    });

    api.onPlaybackCancel(() => voicePlayback.cancel());

    api.onModelProgress((model) => {
      set({ models: get().models.map((m) => (m.id === model.id ? model : m)) });
    });

    api.onModelsChanged((models) => set({ models }));
  },

  startVoice: async (sessionId, mode) => {
    const api = window.limboo?.voice;
    if (!api) return;
    // Drop any analyser left over from a previous run so the overlay never
    // renders levels from a closed audio graph while the new mic opens.
    set({ error: null, analyser: null });

    // Open the mic in parallel with the main-side start so getUserMedia + the
    // AudioWorklet warm up while the worker forks and models load, instead of
    // strictly after. Buffer PCM until main reports a mic phase — its pushAudio
    // drops audio until the capture session is armed — then flush, so the very
    // first sound is never lost.
    const deviceId = useSettingsStore.getState().settings.voice.input.deviceId;
    /** ~2 s of 16 kHz mono Int16 (16000 samples/s × 2 bytes × 2 s). */
    const MAX_BUFFERED_BYTES = 16000 * 2 * 2;
    let pending: ArrayBuffer[] = [];
    let pendingBytes = 0;
    let live = false;

    const onChunk = (pcm: ArrayBuffer) => {
      if (live) {
        api.pushAudio(pcm);
        return;
      }
      if (MIC_PHASES.has(get().state.phase)) {
        live = true;
        for (const buffered of pending) api.pushAudio(buffered);
        pending = [];
        pendingBytes = 0;
        api.pushAudio(pcm);
        return;
      }
      // Still starting: hold the chunk, keeping only the most recent ~2 s.
      pending.push(pcm);
      pendingBytes += pcm.byteLength;
      while (pendingBytes > MAX_BUFFERED_BYTES && pending.length > 1) {
        const dropped = pending.shift();
        if (dropped) pendingBytes -= dropped.byteLength;
      }
    };

    const capturePromise = startCapture({ deviceId: deviceId || undefined, onChunk });

    try {
      // Validates models + settings and flips to `starting`/`listening`.
      await api.start(sessionId, mode);
    } catch (err) {
      // Main rejected (models missing / disabled): tear the mic back down once it opens.
      void capturePromise.then(() => stopCapture()).catch(() => undefined);
      set({ error: friendlyError(err) });
      throw err;
    }

    try {
      const capture = await capturePromise;
      const phase = get().state.phase;
      if (phase === 'starting' || MIC_PHASES.has(phase)) {
        // Publish the live analyser so the composer Waveform (a store
        // subscriber) starts rendering real levels the moment the mic opens.
        set({ analyser: capture.analyser });
      } else {
        // The capture ended (cancel/error) while the mic was still opening —
        // nothing will broadcast another teardown, so release it here.
        capture.stop();
      }
    } catch (err) {
      // Mic denied / missing: abandon the main-side capture session too.
      await api.cancel().catch(() => undefined);
      set({ error: friendlyError(err) });
      throw err;
    }
  },

  stopVoice: async () => {
    const api = window.limboo?.voice;
    stopCapture();
    set({ analyser: null });
    await api?.stop().catch(() => undefined);
  },

  cancelVoice: async () => {
    const api = window.limboo?.voice;
    stopCapture();
    set({ analyser: null });
    await api?.cancel().catch(() => undefined);
  },

  stopSpeaking: async () => {
    voicePlayback.cancel();
    await window.limboo?.voice?.stopSpeaking().catch(() => undefined);
  },

  speak: async (text) => {
    const api = window.limboo?.voice;
    if (!api) return;
    set({ error: null });
    try {
      await api.speak(text);
    } catch (err) {
      set({ error: friendlyError(err) });
      throw err;
    }
  },

  clearError: () => set({ error: null }),

  downloadModel: async (id) => window.limboo?.voice?.models.download(id),
  pauseModel: async (id) => window.limboo?.voice?.models.pause(id),
  resumeModel: async (id) => window.limboo?.voice?.models.resume(id),
  cancelModel: async (id) => window.limboo?.voice?.models.cancel(id),
  removeModel: async (id) => window.limboo?.voice?.models.remove(id),
  verifyModel: async (id) => (await window.limboo?.voice?.models.verify(id)) ?? false,
  revealModels: async () => window.limboo?.voice?.models.reveal(),
}));

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/NotAllowedError|Permission denied|denied/i.test(message)) {
    return 'Microphone access was denied';
  }
  if (/NotFoundError|Requested device not found/i.test(message)) {
    return 'No microphone was found';
  }
  // IPC errors arrive as "Error invoking remote method 'voice:start': Error: <msg>".
  const m = message.match(/Error: ([^\n]+)$/);
  return m ? m[1] : message;
}

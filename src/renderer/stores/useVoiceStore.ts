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
      // release the mic as soon as the phase leaves listening/recording.
      if (!MIC_PHASES.has(next.phase)) stopCapture();
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
    set({ error: null });
    try {
      // Main first: it validates models + settings and flips to `starting`.
      await api.start(sessionId, mode);
    } catch (err) {
      set({ error: friendlyError(err) });
      throw err;
    }
    try {
      const deviceId = useSettingsStore.getState().settings.voice.input.deviceId;
      await startCapture({
        deviceId: deviceId || undefined,
        onChunk: (pcm) => api.pushAudio(pcm),
      });
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
    await api?.stop().catch(() => undefined);
  },

  cancelVoice: async () => {
    const api = window.limboo?.voice;
    stopCapture();
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

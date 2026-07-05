/**
 * IPC surface of the Voice subsystem. Every input coming from the renderer is
 * validated here before it reaches a manager (ids, text length, chunk size),
 * matching the validation posture of the other handler files.
 */
import { IpcChannels, IpcSends } from '@shared/ipc-channels';
import type { VoiceModelId, VoiceModelState, VoiceState } from '@shared/types';
import { SESSION_LIMITS, VOICE_LIMITS } from '@shared/constants';
import { voiceModelSpec } from '@shared/voice-models';
import type { VoiceManager } from '../managers/voice/VoiceManager';
import type { VoiceModelManager } from '../managers/voice/VoiceModelManager';
import type { SettingsManager } from '../managers/SettingsManager';
import { handle, on } from './registry';

function assertSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > SESSION_LIMITS.idMax) {
    throw new Error('voice: invalid session id');
  }
}

function assertMode(value: unknown): asserts value is 'plan' | 'default' | 'acceptEdits' {
  if (value !== 'plan' && value !== 'default' && value !== 'acceptEdits') {
    throw new Error('voice: invalid permission mode');
  }
}

function assertModelId(value: unknown): asserts value is VoiceModelId {
  if (typeof value !== 'string' || !voiceModelSpec(value)) {
    throw new Error('voice: unknown model id');
  }
}

export function registerVoiceHandlers(
  voice: VoiceManager,
  models: VoiceModelManager,
  settings: SettingsManager,
): void {
  handle<[], VoiceState>(IpcChannels.voiceGetState, () => voice.getState());

  // Pre-warm the engine (fork worker + load models) on mic intent so the next
  // startCapture flips to listening instantly. Fire-and-forget, no state change.
  handle<[], void>(IpcChannels.voiceWarm, () => voice.warm());

  handle<[string, string], void>(IpcChannels.voiceStart, async (_event, sessionId, mode) => {
    assertSessionId(sessionId);
    assertMode(mode);
    await voice.startCapture(sessionId, mode);
  });

  handle<[], void>(IpcChannels.voiceStop, () => voice.stopCapture());
  handle<[], void>(IpcChannels.voiceCancel, () => voice.cancelCapture());
  handle<[], void>(IpcChannels.voiceStopSpeaking, () => voice.stopSpeaking());

  handle<[string], void>(IpcChannels.voiceSpeak, async (_event, text) => {
    if (typeof text !== 'string' || text.length === 0) throw new Error('voice: invalid text');
    await voice.speak(text.slice(0, VOICE_LIMITS.ttsTextMax));
  });

  handle<[], VoiceModelState[]>(IpcChannels.voiceModelsList, () => models.list());

  handle<[string], void>(IpcChannels.voiceModelDownload, (_event, id) => {
    assertModelId(id);
    const offlineOnly = settings.getAll().voice.models.offlineOnly;
    // Fire-and-forget: progress streams via voice:model-progress events; a
    // failure is reflected in the model's error state (and logged).
    void models
      .download(id, { offlineOnly })
      .then(() => voice.refreshModelsReady())
      .catch(() => undefined);
  });

  handle<[string], void>(IpcChannels.voiceModelPause, (_event, id) => {
    assertModelId(id);
    models.pause(id);
  });

  handle<[string], void>(IpcChannels.voiceModelResume, (_event, id) => {
    assertModelId(id);
    const offlineOnly = settings.getAll().voice.models.offlineOnly;
    void models
      .download(id, { offlineOnly })
      .then(() => voice.refreshModelsReady())
      .catch(() => undefined);
  });

  handle<[string], void>(IpcChannels.voiceModelCancel, async (_event, id) => {
    assertModelId(id);
    await models.cancel(id);
    voice.refreshModelsReady();
  });

  handle<[string], void>(IpcChannels.voiceModelRemove, async (_event, id) => {
    assertModelId(id);
    await models.remove(id);
    voice.refreshModelsReady();
  });

  handle<[string], boolean>(IpcChannels.voiceModelVerify, (_event, id) => {
    assertModelId(id);
    return models.verify(id);
  });

  handle<[], void>(IpcChannels.voiceModelsReveal, () => models.revealDir());

  // High-frequency one-way mic chunks. Dropped unless a capture is active;
  // size-capped before they reach the manager.
  on<[ArrayBuffer | Uint8Array]>(IpcSends.voiceAudioChunk, (_event, chunk) => {
    let pcm: ArrayBuffer | null = null;
    // Copy into a fresh V8-owned buffer before it crosses the SECOND hop
    // (main → voice worker via utilityProcess.postMessage). The ArrayBuffer that
    // arrives here over IPC is backed by *external* memory, and Electron's
    // serializer refuses to re-serialize external buffers ("External buffers are
    // not allowed"), which was crashing the worker. `.slice()` allocates an owned
    // buffer and memcpy's the bytes, stripping the external flag.
    if (chunk instanceof ArrayBuffer) pcm = chunk.slice(0);
    else if (ArrayBuffer.isView(chunk)) {
      pcm = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    }
    if (!pcm || pcm.byteLength === 0 || pcm.byteLength > VOICE_LIMITS.audioChunkBytesMax) return;
    voice.pushAudio(pcm);
  });
}

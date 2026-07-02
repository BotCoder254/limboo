/**
 * Message protocol between the VoiceManager (main process) and the voice
 * inference worker (a `utilityProcess` hosting sherpa-onnx). Everything is
 * structured-clonable; PCM crosses as `ArrayBuffer` (mono Int16).
 *
 * The worker is deliberately dumb: it never touches settings, sessions, or the
 * network — it just loads model files it is handed, turns audio into text and
 * text into audio, and reports back.
 */

/** Model roles the worker can host. */
export type VoiceWorkerModelKind = 'stt' | 'tts' | 'vad';

/** Explicit model file paths — the worker never guesses a layout. */
export interface SttModelPaths {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

export interface TtsModelPaths {
  model: string;
  voices: string;
  tokens: string;
  /** espeak-ng-data directory (required by Kokoro). */
  dataDir: string;
}

export interface VadModelPaths {
  model: string;
}

/** Messages the main process sends to the worker. */
export type VoiceWorkerRequest =
  | { t: 'load'; kind: 'stt'; paths: SttModelPaths; numThreads: number }
  | { t: 'load'; kind: 'tts'; paths: TtsModelPaths; numThreads: number }
  | { t: 'load'; kind: 'vad'; paths: VadModelPaths; sensitivity: number; silenceMs: number }
  | {
      /** Begin a capture session (audio chunks follow). */
      t: 'capture-start';
      /** `auto` = VAD endpointing; `manual` = wait for an explicit endpoint. */
      mode: 'auto' | 'manual';
    }
  | {
      /** One chunk of 16 kHz mono Int16 PCM from the renderer's mic worklet. */
      t: 'audio';
      pcm: ArrayBuffer;
    }
  | {
      /** Manual end-of-utterance (toggle off / PTT release): transcribe now. */
      t: 'endpoint';
    }
  | {
      /** Abandon the capture session and discard all buffered audio. */
      t: 'capture-cancel';
    }
  | {
      /** Queue one sentence/segment for synthesis (FIFO). */
      t: 'tts';
      id: string;
      text: string;
      /** Kokoro speaker id. */
      sid: number;
      /** Speech-rate multiplier. */
      speed: number;
    }
  | {
      /** Cancel queued + in-flight synthesis (all jobs when `ids` is omitted). */
      t: 'tts-cancel';
      ids?: string[];
    }
  | { t: 'shutdown' };

/** Messages the worker sends back to the main process. */
export type VoiceWorkerResponse =
  | { t: 'ready' }
  | { t: 'loaded'; kind: VoiceWorkerModelKind }
  | { t: 'load-error'; kind: VoiceWorkerModelKind; message: string }
  | {
      /** VAD detected the start/end of speech (auto mode only). */
      t: 'vad';
      event: 'speech-start' | 'speech-end';
    }
  | {
      /** A finished utterance was recognized. */
      t: 'transcript';
      text: string;
      /** Length of the recognized audio in ms. */
      durationMs: number;
    }
  | {
      /** One chunk of synthesized mono Int16 PCM for job `id`. */
      t: 'tts-chunk';
      id: string;
      sampleRate: number;
      pcm: ArrayBuffer;
      seq: number;
      last: boolean;
    }
  | {
      /** Synthesis job `id` finished (or was cancelled before completing). */
      t: 'tts-done';
      id: string;
      cancelled: boolean;
    }
  | { t: 'error'; scope: 'capture' | 'tts' | 'worker'; message: string };

/** The capture sample rate the whole pipeline is normalized to. */
export const VOICE_SAMPLE_RATE = 16_000;

/** Silero VAD processes fixed 512-sample windows at 16 kHz. */
export const VAD_WINDOW_SIZE = 512;

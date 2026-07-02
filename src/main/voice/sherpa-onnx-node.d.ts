/**
 * Minimal ambient typings for `sherpa-onnx-node` (the package ships plain JS
 * with JSDoc only). Covers exactly the surface the voice worker uses:
 * offline ASR (Parakeet transducer), offline TTS (Kokoro), and Silero VAD.
 */
declare module 'sherpa-onnx-node' {
  export interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface OfflineRecognizerResult {
    text: string;
  }

  export class OfflineStream {
    acceptWaveform(obj: Waveform): void;
  }

  export class OfflineRecognizer {
    constructor(config: unknown);
    static createAsync(config: unknown): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    decodeAsync(stream: OfflineStream): Promise<OfflineRecognizerResult>;
    getResult(stream: OfflineStream): OfflineRecognizerResult;
  }

  export interface TtsProgressInfo {
    samples: Float32Array;
    progress: number;
  }

  export class OfflineTts {
    constructor(config: unknown);
    static createAsync(config: unknown): Promise<OfflineTts>;
    readonly numSpeakers: number;
    readonly sampleRate: number;
    generate(req: { text: string; sid?: number; speed?: number }): GeneratedAudio;
    generateAsync(req: {
      text: string;
      sid?: number;
      speed?: number;
      /** Streaming chunk callback; return 0/false to cancel generation. */
      onProgress?: (info: TtsProgressInfo) => number | boolean | void;
    }): Promise<GeneratedAudio>;
  }

  export interface SpeechSegment {
    samples: Float32Array;
    start: number;
  }

  export class Vad {
    constructor(config: unknown, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    pop(): void;
    clear(): void;
    front(enableExternalBuffer?: boolean): SpeechSegment;
    reset(): void;
    flush(): void;
  }
}

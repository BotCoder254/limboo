import type { VoiceModelId, VoiceModelKind } from './types';

/**
 * The registry of downloadable local speech models — the single source of truth
 * shared by the main process (download / verify / install) and the renderer
 * (Voice settings model cards). All assets are immutable release artifacts of
 * https://github.com/k2-fsa/sherpa-onnx (the runtime powering STT/TTS/VAD), so
 * their SHA-256 hashes are pinned here and verified after every download.
 */
export interface VoiceModelSpec {
  id: VoiceModelId;
  kind: VoiceModelKind;
  /** Card title in the Voice settings. */
  label: string;
  /** One-line card description. */
  description: string;
  /** HTTPS download URL (host must pass the main-process allowlist). */
  url: string;
  /** `tar.bz2` archives are extracted; `file` assets install as-is. */
  archive: 'tar.bz2' | 'file';
  /** Pinned SHA-256 of the downloaded asset (release assets are immutable). */
  sha256: string;
  /** Approximate download size in bytes (UI estimate + size-cap sanity). */
  approxBytes: number;
  /** Pinned revision — bump to signal an update for `models.autoUpdate`. */
  rev: number;
  /**
   * Paths (relative to the install dir) that must exist after install —
   * validates extraction and guards against a truncated/renamed layout.
   */
  expects: string[];
}

export const VOICE_MODELS: VoiceModelSpec[] = [
  {
    id: 'kokoro-en-v0_19',
    kind: 'tts',
    label: 'Kokoro English (v0.19)',
    description:
      'Neural text-to-speech, 82M parameters, 11 voices. Runs fully offline; speech never leaves this machine.',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2',
    archive: 'tar.bz2',
    sha256: '912804855a04745fa77a30be545b3f9a5d15c4d66db00b88cbcd4921df605ac7',
    approxBytes: 319_625_534,
    rev: 1,
    expects: ['model.onnx', 'voices.bin', 'tokens.txt', 'espeak-ng-data'],
  },
  {
    id: 'parakeet-tdt-0.6b-v2-int8',
    kind: 'stt',
    label: 'Parakeet TDT 0.6B (English, int8)',
    description:
      'Speech recognition with automatic punctuation. Runs fully offline; audio never leaves this machine.',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2',
    archive: 'tar.bz2',
    sha256: '157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad',
    approxBytes: 482_468_385,
    rev: 1,
    expects: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
  },
  {
    id: 'silero-vad',
    kind: 'vad',
    label: 'Silero voice activity detection',
    description: 'Detects when you start and stop speaking (endpointing for hands-free capture).',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    archive: 'file',
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    approxBytes: 643_854,
    rev: 1,
    expects: ['silero_vad.onnx'],
  },
];

/** Look up a registry entry by id (undefined for unknown ids). */
export function voiceModelSpec(id: string): VoiceModelSpec | undefined {
  return VOICE_MODELS.find((m) => m.id === id);
}

/** The registry entry serving a given role (exactly one per kind today). */
export function voiceModelForKind(kind: VoiceModelKind): VoiceModelSpec {
  const spec = VOICE_MODELS.find((m) => m.kind === kind);
  if (!spec) throw new Error(`No voice model registered for kind: ${kind}`);
  return spec;
}

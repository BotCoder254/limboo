/**
 * Speech playback engine (renderer side). Receives synthesized Int16 PCM
 * chunks from the main process (`voice:tts-chunk`) and schedules them gaplessly
 * through Web Audio. Purely presentational: gating/ordering happen in main.
 */

interface TtsChunkLike {
  sampleRate: number;
  pcm: ArrayBuffer;
}

class VoicePlayback {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private nextTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private volume = 1;
  private sinkId = '';

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      this.nextTime = 0;
      this.applySink();
    }
    return this.ctx;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Route playback to a specific output device ('' = system default). */
  setSink(deviceId: string): void {
    if (this.sinkId === deviceId) return;
    this.sinkId = deviceId;
    this.applySink();
  }

  private applySink(): void {
    // AudioContext.setSinkId shipped in Chromium 110 — present in Electron 42,
    // but absent from the bundled TS DOM lib, hence the structural cast.
    const ctx = this.ctx as unknown as {
      setSinkId?: (id: string) => Promise<void>;
    } | null;
    if (ctx?.setSinkId) {
      void ctx.setSinkId(this.sinkId).catch(() => undefined);
    }
  }

  /** Schedule one chunk right after the previously scheduled audio. */
  enqueue(chunk: TtsChunkLike): void {
    if (!chunk.pcm || chunk.pcm.byteLength === 0) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const int16 = new Int16Array(chunk.pcm);
    const floats = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;

    const buffer = ctx.createBuffer(1, floats.length, chunk.sampleRate);
    buffer.getChannelData(0).set(floats);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (this.gain) source.connect(this.gain);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** True while scheduled audio is still playing. */
  isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Stop everything scheduled and reset the timeline (barge-in / stop). */
  cancel(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }
}

export const voicePlayback = new VoicePlayback();

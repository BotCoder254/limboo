/**
 * AudioWorkletProcessor that converts the mic input (context rate, usually
 * 48 kHz float) into 16 kHz mono Int16 PCM chunks for the STT pipeline.
 * Loaded as a same-origin static asset (imported with `?url` in capture.ts) so
 * it works under the strict production CSP (`script-src 'self'`).
 */
const TARGET_RATE = 16000;
/** Samples per posted chunk (64 ms at 16 kHz → 2048 bytes of Int16). */
const CHUNK_SAMPLES = 1024;

class LimbooPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Carry-over input samples not yet consumed by the resampler. */
    this.carry = new Float32Array(0);
    /** Fractional resample cursor into `carry`. */
    this.cursor = 0;
    /** Output accumulation until a full chunk is ready. */
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outLen = 0;
    this.ratio = sampleRate / TARGET_RATE;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    // Append the new block to the carry buffer.
    const merged = new Float32Array(this.carry.length + input.length);
    merged.set(this.carry, 0);
    merged.set(input, this.carry.length);

    // Linear-interpolation resample: consume while a full step fits.
    let pos = this.cursor;
    while (pos + 1 < merged.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const sample = merged[i] * (1 - frac) + merged[i + 1] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.out[this.outLen++] = Math.round(clamped * 32767);
      if (this.outLen === CHUNK_SAMPLES) {
        const chunk = this.out.buffer.slice(0);
        this.port.postMessage(chunk, [chunk]);
        this.out = new Int16Array(CHUNK_SAMPLES);
        this.outLen = 0;
      }
      pos += this.ratio;
    }

    // Keep the unconsumed tail (and the fractional remainder of the cursor).
    const keepFrom = Math.floor(pos);
    this.carry = merged.slice(keepFrom);
    this.cursor = pos - keepFrom;
    return true;
  }
}

registerProcessor('limboo-pcm-capture', LimbooPcmCapture);

/**
 * Microphone capture engine (renderer side). Opens the mic with getUserMedia
 * (granted only for our own origin + audio-only by the main-process permission
 * handler), resamples to 16 kHz mono Int16 in an AudioWorklet, and hands each
 * chunk to a callback (normally `window.limboo.voice.pushAudio`).
 *
 * Also exposes the live AnalyserNode so the composer Waveform can render real
 * mic levels without a second audio graph.
 */
import workletSource from './pcmWorklet.js?raw';

export interface CaptureHandle {
  /** Live frequency/time-domain analyser for the waveform visualization. */
  analyser: AnalyserNode;
  /** Stop the mic + tear the graph down. Idempotent. */
  stop(): void;
}

let active: CaptureHandle | null = null;

/** The currently running capture (for the Waveform component), or null. */
export function activeCapture(): CaptureHandle | null {
  return active;
}

export async function startCapture(options: {
  deviceId?: string;
  onChunk: (pcm: ArrayBuffer) => void;
}): Promise<CaptureHandle> {
  // One mic session at a time.
  active?.stop();

  const constraints: MediaStreamConstraints = {
    audio: {
      ...(options.deviceId ? { deviceId: { ideal: options.deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const ctx = new AudioContext();
  // A suspended context renders the whole graph silent (no worklet chunks, no
  // analyser levels) with zero errors — resume defensively, mirroring playback.ts.
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  // Load the worklet from an inlined Blob rather than a `?url` asset. `?raw`
  // bundles the processor source straight into the JS chunk, so there is no
  // separate asset file to emit and no base/`file://` path resolution to get
  // wrong — it behaves identically under the dev server and the packaged app.
  // (The production CSP allows this via `worker-src 'self' blob:`.)
  const blob = new Blob([workletSource], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, 'limboo-pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => options.onChunk(e.data);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;

  // Keep the graph pulled without ever emitting mic audio to the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(analyser);
  source.connect(worklet);
  worklet.connect(mute);
  mute.connect(ctx.destination);

  let stopped = false;
  const handle: CaptureHandle = {
    analyser,
    stop: () => {
      if (stopped) return;
      stopped = true;
      worklet.port.onmessage = null;
      for (const track of stream.getTracks()) track.stop();
      source.disconnect();
      worklet.disconnect();
      mute.disconnect();
      void ctx.close().catch(() => undefined);
      if (active === handle) active = null;
    },
  };
  active = handle;
  return handle;
}

/** Stop whatever capture is running (idempotent). */
export function stopCapture(): void {
  active?.stop();
}

/** Enumerate audio devices (labels appear after the first mic grant). */
export async function listAudioDevices(): Promise<{
  inputs: { id: string; label: string }[];
  outputs: { id: string; label: string }[];
}> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
  const devices = await navigator.mediaDevices.enumerateDevices();
  const named = (d: MediaDeviceInfo, fallback: string) => ({
    id: d.deviceId,
    label: d.label || fallback,
  });
  return {
    inputs: devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => named(d, `Microphone ${i + 1}`)),
    outputs: devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d, i) => named(d, `Speaker ${i + 1}`)),
  };
}

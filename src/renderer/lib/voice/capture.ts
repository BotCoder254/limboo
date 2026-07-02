/**
 * Microphone capture engine (renderer side). Opens the mic with getUserMedia
 * (granted only for our own origin + audio-only by the main-process permission
 * handler), resamples to 16 kHz mono Int16 in an AudioWorklet, and hands each
 * chunk to a callback (normally `window.limboo.voice.pushAudio`).
 *
 * Also exposes the live AnalyserNode so the composer Waveform can render real
 * mic levels without a second audio graph.
 */
import workletUrl from './pcmWorklet.js?url';

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
  // Vite emits `workletUrl` relative to the app base (`./assets/…`). Resolve it
  // against the document base URL so it loads under the `file://` protocol used
  // by the packaged app, not just the dev server's http origin.
  await ctx.audioWorklet.addModule(new URL(workletUrl, document.baseURI).href);

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

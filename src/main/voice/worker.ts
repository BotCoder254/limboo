/**
 * Voice inference worker — the `utilityProcess` entry that hosts sherpa-onnx
 * (Parakeet STT, Kokoro TTS, Silero VAD) so ONNX inference never runs on the
 * main process thread. See protocol.ts for the message contract.
 *
 * The worker is stateless beyond loaded models + the current capture/TTS jobs;
 * the VoiceManager owns policy (settings, sessions, gating) and restarts the
 * worker if it crashes.
 */
import { OfflineRecognizer, OfflineTts, Vad } from 'sherpa-onnx-node';
import type {
  SttModelPaths,
  TtsModelPaths,
  VadModelPaths,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from './protocol';
import { VAD_WINDOW_SIZE, VOICE_SAMPLE_RATE } from './protocol';

/** Electron gives a utilityProcess child a MessagePort on `process.parentPort`. */
interface ParentPort {
  on(event: 'message', listener: (e: { data: VoiceWorkerRequest }) => void): void;
  postMessage(message: VoiceWorkerResponse): void;
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

function send(message: VoiceWorkerResponse): void {
  parentPort.postMessage(message);
}

/* ------------------------------------------------------------------ */
/* PCM helpers                                                         */
/* ------------------------------------------------------------------ */

function int16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(pcm);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

function float32ToInt16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = Math.round(s * 32767);
  }
  return out.buffer;
}

function concatFloat32(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

let recognizer: OfflineRecognizer | null = null;
let tts: OfflineTts | null = null;
let vad: Vad | null = null;

async function loadStt(paths: SttModelPaths, numThreads: number): Promise<void> {
  recognizer = await OfflineRecognizer.createAsync({
    featConfig: { sampleRate: VOICE_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: paths.encoder,
        decoder: paths.decoder,
        joiner: paths.joiner,
      },
      tokens: paths.tokens,
      numThreads,
      modelType: 'nemo_transducer',
      debug: 0,
      provider: 'cpu',
    },
  });
}

async function loadTts(paths: TtsModelPaths, numThreads: number): Promise<void> {
  tts = await OfflineTts.createAsync({
    model: {
      kokoro: {
        model: paths.model,
        voices: paths.voices,
        tokens: paths.tokens,
        dataDir: paths.dataDir,
      },
      numThreads,
      debug: 0,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  });
}

function loadVad(paths: VadModelPaths, sensitivity: number, silenceMs: number): void {
  vad = new Vad(
    {
      sileroVad: {
        model: paths.model,
        threshold: sensitivity,
        minSilenceDuration: silenceMs / 1000,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 30,
        windowSize: VAD_WINDOW_SIZE,
      },
      sampleRate: VOICE_SAMPLE_RATE,
      numThreads: 1,
      debug: 0,
    },
    /* bufferSizeInSeconds */ 60,
  );
}

/* ------------------------------------------------------------------ */
/* Capture (VAD + STT)                                                 */
/* ------------------------------------------------------------------ */

/** ~5 minutes of 16 kHz mono — hard cap on one buffered utterance. */
const MAX_UTTERANCE_SAMPLES = 4_800_000;

let captureMode: 'auto' | 'manual' | null = null;
/** Manual-mode utterance accumulation. */
let utterance: Float32Array[] = [];
let utteranceSamples = 0;
/** Auto-mode leftover (< one VAD window). */
let vadPending: Float32Array = new Float32Array(0);
let speechActive = false;
/** Serializes decodes so segments transcribe in order. */
let decodeChain: Promise<void> = Promise.resolve();

function resetCapture(): void {
  captureMode = null;
  utterance = [];
  utteranceSamples = 0;
  vadPending = new Float32Array(0);
  speechActive = false;
  vad?.reset();
}

function transcribe(samples: Float32Array): void {
  const rec = recognizer;
  if (!rec || samples.length === 0) return;
  const durationMs = Math.round((samples.length / VOICE_SAMPLE_RATE) * 1000);
  decodeChain = decodeChain
    .then(async () => {
      const stream = rec.createStream();
      stream.acceptWaveform({ samples, sampleRate: VOICE_SAMPLE_RATE });
      const result = await rec.decodeAsync(stream);
      send({ t: 'transcript', text: (result.text ?? '').trim(), durationMs });
    })
    .catch((err) => {
      send({ t: 'error', scope: 'capture', message: String(err) });
    });
}

function drainVadSegments(): void {
  if (!vad) return;
  while (!vad.isEmpty()) {
    const segment = vad.front();
    vad.pop();
    if (speechActive) {
      speechActive = false;
      send({ t: 'vad', event: 'speech-end' });
    }
    transcribe(segment.samples);
  }
}

function onAudio(pcm: ArrayBuffer): void {
  if (!captureMode) return;
  const samples = int16ToFloat32(pcm);

  if (captureMode === 'manual') {
    if (utteranceSamples + samples.length > MAX_UTTERANCE_SAMPLES) return;
    utterance.push(samples);
    utteranceSamples += samples.length;
    return;
  }

  // Auto mode: feed fixed-size windows to the VAD.
  if (!vad) return;
  const merged = new Float32Array(vadPending.length + samples.length);
  merged.set(vadPending, 0);
  merged.set(samples, vadPending.length);

  let offset = 0;
  while (offset + VAD_WINDOW_SIZE <= merged.length) {
    vad.acceptWaveform(merged.subarray(offset, offset + VAD_WINDOW_SIZE));
    offset += VAD_WINDOW_SIZE;
    if (!speechActive && vad.isDetected()) {
      speechActive = true;
      send({ t: 'vad', event: 'speech-start' });
    }
    drainVadSegments();
  }
  vadPending = merged.subarray(offset);
}

function onEndpoint(): void {
  if (!captureMode) return;
  if (captureMode === 'manual') {
    transcribe(concatFloat32(utterance, utteranceSamples));
  } else if (vad) {
    // The user ended capture before the silence window elapsed — flush the VAD
    // so any in-progress speech becomes a final segment.
    if (vadPending.length > 0) vad.acceptWaveform(vadPending);
    vad.flush();
    drainVadSegments();
  }
  resetCapture();
}

/* ------------------------------------------------------------------ */
/* TTS queue                                                           */
/* ------------------------------------------------------------------ */

interface TtsJob {
  id: string;
  text: string;
  sid: number;
  speed: number;
}

/** ~250 ms of 24 kHz audio per pushed chunk. */
const TTS_CHUNK_SAMPLES = 6_000;

const ttsQueue: TtsJob[] = [];
const ttsCancelled = new Set<string>();
let ttsRunning = false;

function cancelTts(ids?: string[]): void {
  if (!ids) {
    for (const job of ttsQueue) ttsCancelled.add(job.id);
    ttsQueue.length = 0;
    if (currentTtsId) ttsCancelled.add(currentTtsId);
    return;
  }
  for (const id of ids) ttsCancelled.add(id);
  for (let i = ttsQueue.length - 1; i >= 0; i--) {
    if (ttsCancelled.has(ttsQueue[i].id)) ttsQueue.splice(i, 1);
  }
}

let currentTtsId: string | null = null;

async function runTtsJob(job: TtsJob): Promise<void> {
  const engine = tts;
  if (!engine) {
    send({ t: 'error', scope: 'tts', message: 'TTS model not loaded' });
    send({ t: 'tts-done', id: job.id, cancelled: true });
    return;
  }
  currentTtsId = job.id;
  const sampleRate = engine.sampleRate;
  let seq = 0;
  let sentSamples = 0;
  /** Accumulates callback audio until a full chunk is ready. */
  let buffered: Float32Array[] = [];
  let bufferedLen = 0;

  const flush = (last: boolean) => {
    if (bufferedLen === 0 && !last) return;
    const samples = concatFloat32(buffered, bufferedLen);
    buffered = [];
    bufferedLen = 0;
    sentSamples += samples.length;
    send({
      t: 'tts-chunk',
      id: job.id,
      sampleRate,
      pcm: float32ToInt16(samples),
      seq: seq++,
      last,
    });
  };

  try {
    const result = await engine.generateAsync({
      text: job.text,
      sid: job.sid,
      speed: job.speed,
      onProgress: (info) => {
        if (ttsCancelled.has(job.id)) return 0;
        buffered.push(info.samples.slice());
        bufferedLen += info.samples.length;
        if (bufferedLen >= TTS_CHUNK_SAMPLES) flush(false);
        return 1;
      },
    });
    const cancelled = ttsCancelled.has(job.id);
    if (!cancelled) {
      // If the runtime didn't stream progress chunks (or held some back), send
      // whatever the final result contains beyond what was already pushed.
      if (result.samples.length > sentSamples + bufferedLen) {
        buffered.push(result.samples.slice(sentSamples + bufferedLen));
        bufferedLen = result.samples.length - sentSamples;
      }
      flush(true);
    }
    send({ t: 'tts-done', id: job.id, cancelled });
  } catch (err) {
    send({ t: 'error', scope: 'tts', message: String(err) });
    send({ t: 'tts-done', id: job.id, cancelled: true });
  } finally {
    ttsCancelled.delete(job.id);
    currentTtsId = null;
  }
}

async function pumpTtsQueue(): Promise<void> {
  if (ttsRunning) return;
  ttsRunning = true;
  try {
    for (;;) {
      const job = ttsQueue.shift();
      if (!job) break;
      if (ttsCancelled.has(job.id)) {
        ttsCancelled.delete(job.id);
        send({ t: 'tts-done', id: job.id, cancelled: true });
        continue;
      }
      await runTtsJob(job);
    }
  } finally {
    ttsRunning = false;
  }
}

/* ------------------------------------------------------------------ */
/* Message loop                                                        */
/* ------------------------------------------------------------------ */

parentPort.on('message', (e) => {
  const msg = e.data;
  switch (msg.t) {
    case 'load': {
      const done = () => send({ t: 'loaded', kind: msg.kind });
      const fail = (err: unknown) =>
        send({ t: 'load-error', kind: msg.kind, message: String(err) });
      try {
        if (msg.kind === 'stt') void loadStt(msg.paths, msg.numThreads).then(done, fail);
        else if (msg.kind === 'tts') void loadTts(msg.paths, msg.numThreads).then(done, fail);
        else {
          loadVad(msg.paths, msg.sensitivity, msg.silenceMs);
          done();
        }
      } catch (err) {
        fail(err);
      }
      break;
    }
    case 'capture-start':
      resetCapture();
      captureMode = msg.mode;
      break;
    case 'audio':
      try {
        onAudio(msg.pcm);
      } catch (err) {
        send({ t: 'error', scope: 'capture', message: String(err) });
        resetCapture();
      }
      break;
    case 'endpoint':
      try {
        onEndpoint();
      } catch (err) {
        send({ t: 'error', scope: 'capture', message: String(err) });
        resetCapture();
      }
      break;
    case 'capture-cancel':
      resetCapture();
      break;
    case 'tts':
      ttsQueue.push({ id: msg.id, text: msg.text, sid: msg.sid, speed: msg.speed });
      void pumpTtsQueue();
      break;
    case 'tts-cancel':
      cancelTts(msg.ids);
      break;
    case 'shutdown':
      process.exit(0);
      break;
  }
});

send({ t: 'ready' });

/**
 * VoiceManager — the hidden orchestration layer that makes speech a modality of
 * the EXISTING agent session (never a separate conversation, never visible to
 * the model):
 *
 *   renderer mic worklet ── audio chunks ──▶ worker (VAD + Parakeet STT)
 *        transcript ──▶ AgentManager.send(sessionId, text, mode)  (same as typing)
 *   AgentManager.onEvent ──▶ SentenceSegmenter ──▶ worker (Kokoro TTS)
 *        PCM chunks ──▶ renderer Web Audio playback
 *
 * ONNX inference lives in a `utilityProcess` (src/main/voice/worker.ts) so the
 * main process never blocks; this class owns policy only — settings, gating,
 * interruption, worker lifecycle, and state broadcast.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { IpcEvents } from '@shared/ipc-channels';
import type {
  AgentEvent,
  SessionPermissionMode,
  VoiceState,
  VoiceTtsChunk,
} from '@shared/types';
import { VOICE_LIMITS } from '@shared/constants';
import type {
  SttModelPaths,
  TtsModelPaths,
  VoiceWorkerModelKind,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from '../../voice/protocol';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';
import type { AgentManager } from '../AgentManager';
import type { VoiceModelManager } from './VoiceModelManager';
import { SentenceSegmenter, stripMarkdown } from './segmenter';

/** Kill an idle worker after this long to release model memory (~1.5–2 GB). */
const WORKER_IDLE_MS = 5 * 60_000;

/** One queued sentence awaiting synthesis. */
interface TtsJob {
  id: string;
  sessionId: string | null;
  text: string;
}

export class VoiceManager {
  private worker: UtilityProcess | null = null;
  private workerReady = false;
  private workerRestarts = 0;
  /** Set when WE asked the worker to shut down, so its exit is not a crash. */
  private expectedExit = false;
  private readonly loadedKinds = new Set<VoiceWorkerModelKind>();
  private readonly loading = new Map<VoiceWorkerModelKind, Promise<void>>();
  /** Signature of the VAD tuning the worker was loaded with. */
  private vadSignature = '';
  private idleTimer: NodeJS.Timeout | null = null;

  private state: VoiceState = {
    phase: 'idle',
    sessionId: null,
    modelsReady: { stt: false, tts: false, vad: false },
  };

  /* Capture session */
  private captureSessionId: string | null = null;
  private captureMode: SessionPermissionMode = 'default';

  /* TTS pipeline (manager-side queue so pause/interrupt stay simple) */
  private readonly ttsQueue: TtsJob[] = [];
  private currentJob: TtsJob | null = null;
  private utteranceSeq = 0;
  /** Sessions whose current/last run began from a spoken prompt. */
  private readonly voiceInitiated = new Set<string>();
  /** Sessions currently inside a tool call (tool-start seen, no tool-end). */
  private readonly toolDepth = new Map<string, number>();
  /** Per-session streaming segmenters (message-start → message-done). */
  private readonly segmenters = new Map<string, SentenceSegmenter>();
  /** Sessions that produced spoken output during the current run. */
  private readonly spokenThisRun = new Set<string>();
  /** Sessions in plan mode for the current voice-initiated run. */
  private readonly planRuns = new Set<string>();

  private unsubscribeAgent: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly settings: SettingsManager,
    private readonly agent: AgentManager,
    private readonly models: VoiceModelManager,
  ) {}

  /** Wire the agent event tap + initial state. Called once from bootstrap. */
  start(): void {
    this.unsubscribeAgent = this.agent.onEvent((event) => this.onAgentEvent(event));
    this.refreshModelsReady();
    const voice = this.settings.getAll().voice;
    if (voice.models.autoDownload && !voice.models.offlineOnly) {
      this.models.autoDownloadMissing();
    }
  }

  getState(): VoiceState {
    return this.state;
  }

  /** Re-derive `modelsReady` from the model store (also called by handlers). */
  refreshModelsReady(): void {
    const modelsReady = {
      stt: this.models.isInstalled('parakeet-tdt-0.6b-v2-int8'),
      tts: this.models.isInstalled('kokoro-en-v0_19'),
      vad: this.models.isInstalled('silero-vad'),
    };
    this.setState({ modelsReady });
  }

  /* ---------------------------------------------------------------- */
  /* Capture (mic → STT → agent)                                       */
  /* ---------------------------------------------------------------- */

  /** Begin a capture session bound to `sessionId` (composer mic button). */
  async startCapture(sessionId: string, mode: SessionPermissionMode): Promise<void> {
    const voice = this.settings.getAll().voice;
    if (!voice.enabled) throw new Error('Voice is disabled in Settings');
    this.refreshModelsReady();
    if (!this.state.modelsReady.stt || !this.state.modelsReady.vad) {
      this.setState({ phase: 'unavailable', error: 'Speech models are not installed yet' });
      throw new Error('Speech models are not installed — download them in Settings › Voice');
    }

    // Barge-in: starting to talk interrupts playback per the user's preference.
    this.applyInterruption();

    this.setState({ phase: 'starting', sessionId, error: undefined });
    const activation = voice.input.activation;
    try {
      await this.ensureWorker();
      // Auto mode needs the VAD loaded before audio flows (the worker feeds every
      // chunk through it to detect speech). Manual mode just accumulates raw audio,
      // so it needs neither VAD nor STT to begin — start listening instantly.
      if (activation === 'auto') await this.ensureLoaded('vad');
    } catch (err) {
      this.setState({ phase: 'unavailable', error: String(err) });
      throw err;
    }

    // STT (Parakeet, ~600 MB) is the slow model and is only needed at transcription
    // time, not to start listening — load it in the background. The worker queues any
    // segment captured before it finishes (see worker.ts `sttReady`), so nothing is
    // lost. Manual mode also warms the VAD lazily (harmless if unused).
    void this.ensureLoaded('stt').catch((err) => logger.warn('voice: stt load failed', err));
    if (activation !== 'auto') {
      void this.ensureLoaded('vad').catch(() => undefined);
    }

    this.captureSessionId = sessionId;
    this.captureMode = mode;
    this.post({ t: 'capture-start', mode: activation === 'auto' ? 'auto' : 'manual' });
    this.setState({ phase: activation === 'auto' ? 'listening' : 'recording', sessionId });
    this.touchActivity();
  }

  /**
   * Warm the speech engine ahead of an actual capture: fork the worker and load
   * the VAD + STT models in the background so the next `startCapture` flips to
   * listening instantly. Fire-and-forget, no state change; safe to call on mic
   * hover/focus. Model memory is still reclaimed by the idle timer.
   */
  warm(): void {
    const voice = this.settings.getAll().voice;
    if (!voice.enabled) return;
    this.refreshModelsReady();
    if (!this.state.modelsReady.stt || !this.state.modelsReady.vad) return;
    void this.ensureWorker()
      .then(() => Promise.all([this.ensureLoaded('vad'), this.ensureLoaded('stt')]))
      .then(() => this.touchActivity())
      .catch((err) => logger.warn('voice: warm failed', err));
  }

  /** One mic PCM chunk from the renderer (already size-capped by the handler). */
  pushAudio(pcm: ArrayBuffer): void {
    if (!this.captureSessionId || !this.worker) return;
    this.post({ t: 'audio', pcm });
  }

  /** Explicit stop (toggle off / PTT release): transcribe what was heard. */
  stopCapture(): void {
    if (!this.captureSessionId) return;
    this.setState({ phase: 'transcribing', sessionId: this.captureSessionId });
    this.post({ t: 'endpoint' });
  }

  /** Abandon the capture without transcribing. */
  cancelCapture(): void {
    if (!this.captureSessionId) return;
    this.post({ t: 'capture-cancel' });
    this.captureSessionId = null;
    this.setIdlePhase();
  }

  /* ---------------------------------------------------------------- */
  /* Speaking                                                          */
  /* ---------------------------------------------------------------- */

  /** Speak arbitrary text (speaker test / notifications). Not session-bound. */
  async speak(text: string): Promise<void> {
    const voice = this.settings.getAll().voice;
    // Gate on `voice.enabled` only — NOT `output.enabled`. This is the explicit
    // speaker-test / notification path: the Settings "Play sample" button must
    // preview the voice even when "Speak responses" is off. The one other caller,
    // `speakNotification()`, checks `output.enabled` itself before calling here.
    if (!voice.enabled) return;
    this.refreshModelsReady();
    if (!this.state.modelsReady.tts) {
      throw new Error('The speech model is not installed — download it in Settings › Voice');
    }
    await this.ensureWorker();
    await this.ensureLoaded('tts');
    this.enqueueTts(null, stripMarkdown(text));
  }

  /** Speak a notification (gated by playbackEvents.notifications). */
  speakNotification(text: string): void {
    const voice = this.settings.getAll().voice;
    if (!voice.enabled || !voice.output.enabled || !voice.playbackEvents.notifications) return;
    if (!this.models.isInstalled('kokoro-en-v0_19')) return;
    void this.speak(text).catch((err) => logger.warn('voice: notification speech failed', err));
  }

  /** Stop all speech playback immediately (user action or barge-in). */
  stopSpeaking(): void {
    this.ttsQueue.length = 0;
    if (this.currentJob) {
      this.post({ t: 'tts-cancel' });
      this.currentJob = null;
    }
    this.broadcast(IpcEvents.voicePlaybackCancel, { sessionId: this.state.sessionId });
    this.setIdlePhase();
  }

  /* ---------------------------------------------------------------- */
  /* Agent event tap → streaming TTS                                   */
  /* ---------------------------------------------------------------- */

  private onAgentEvent(event: AgentEvent): void {
    if (this.disposed) return;
    switch (event.kind) {
      case 'message-start': {
        if (event.message.role !== 'assistant') return;
        if (!this.shouldSpeakFor(event.sessionId)) return;
        this.segmenters.set(event.sessionId, new SentenceSegmenter());
        break;
      }
      case 'message-delta': {
        const seg = this.segmenters.get(event.sessionId);
        if (!seg) return;
        if (!this.deltaGateOpen(event.sessionId)) return;
        const voice = this.settings.getAll().voice;
        if (!voice.output.streamWhileGenerating) {
          seg.push(event.text); // buffer only; spoken on message-done
          return;
        }
        for (const sentence of seg.push(event.text)) {
          this.enqueueSessionTts(event.sessionId, sentence);
        }
        break;
      }
      case 'message-done': {
        const seg = this.segmenters.get(event.sessionId);
        if (!seg) return;
        this.segmenters.delete(event.sessionId);
        if (!this.deltaGateOpen(event.sessionId)) return;
        for (const sentence of seg.flush()) {
          this.enqueueSessionTts(event.sessionId, sentence);
        }
        break;
      }
      case 'tool-start':
        this.toolDepth.set(event.sessionId, (this.toolDepth.get(event.sessionId) ?? 0) + 1);
        break;
      case 'tool-end':
        this.toolDepth.set(
          event.sessionId,
          Math.max(0, (this.toolDepth.get(event.sessionId) ?? 1) - 1),
        );
        break;
      case 'result': {
        const voice = this.settings.getAll().voice;
        // Speak a completion summary only when the run produced no spoken
        // sentences (everything was gated) — avoids double narration.
        if (
          event.ok &&
          voice.playbackEvents.taskCompletion &&
          this.shouldSpeakFor(event.sessionId) &&
          !this.spokenThisRun.has(event.sessionId) &&
          event.text
        ) {
          const summary = stripMarkdown(event.text);
          if (summary) {
            this.enqueueSessionTts(event.sessionId, summary.slice(0, VOICE_LIMITS.ttsTextMax));
          }
        }
        this.toolDepth.delete(event.sessionId);
        this.segmenters.delete(event.sessionId);
        this.spokenThisRun.delete(event.sessionId);
        this.voiceInitiated.delete(event.sessionId);
        this.planRuns.delete(event.sessionId);
        break;
      }
      case 'error':
        this.toolDepth.delete(event.sessionId);
        this.segmenters.delete(event.sessionId);
        this.spokenThisRun.delete(event.sessionId);
        this.voiceInitiated.delete(event.sessionId);
        this.planRuns.delete(event.sessionId);
        break;
    }
  }

  /** Master gate: is this session eligible for spoken output at all? */
  private shouldSpeakFor(sessionId: string): boolean {
    const voice = this.settings.getAll().voice;
    if (!voice.enabled || !voice.output.enabled) return false;
    if (!this.models.isInstalled('kokoro-en-v0_19')) return false;
    if (voice.output.speakWhen === 'voice-initiated' && !this.voiceInitiated.has(sessionId)) {
      return false;
    }
    if (this.planRuns.has(sessionId)) return voice.playbackEvents.planningUpdates;
    return voice.playbackEvents.finalAnswers;
  }

  /** Per-delta gate: honor the while-tools-run preference. */
  private deltaGateOpen(sessionId: string): boolean {
    const voice = this.settings.getAll().voice;
    if ((this.toolDepth.get(sessionId) ?? 0) > 0 && !voice.playbackEvents.whileToolsRun) {
      return false;
    }
    return true;
  }

  private enqueueSessionTts(sessionId: string, text: string): void {
    this.spokenThisRun.add(sessionId);
    void this.ensureWorker()
      .then(() => this.ensureLoaded('tts'))
      .then(() => this.enqueueTts(sessionId, text))
      .catch((err) => logger.warn('voice: tts enqueue failed', err));
  }

  /* ---------------------------------------------------------------- */
  /* TTS queue pump                                                    */
  /* ---------------------------------------------------------------- */

  private enqueueTts(sessionId: string | null, text: string): void {
    const trimmed = text.trim().slice(0, VOICE_LIMITS.ttsTextMax);
    if (!trimmed) return;
    this.ttsQueue.push({ id: `utt-${++this.utteranceSeq}`, sessionId, text: trimmed });
    this.pumpTts();
  }

  private pumpTts(): void {
    if (this.currentJob || this.ttsQueue.length === 0 || !this.worker) return;
    // Hold playback while the user is actively talking (capture in flight).
    if (this.captureSessionId) return;
    const voice = this.settings.getAll().voice;
    const job = this.ttsQueue.shift();
    if (!job) return;
    this.currentJob = job;
    this.setState({ phase: 'speaking', sessionId: job.sessionId ?? this.state.sessionId });
    this.post({
      t: 'tts',
      id: job.id,
      text: job.text,
      sid: voice.output.speakerId,
      speed: voice.output.speed,
    });
    this.touchActivity();
  }

  /* ---------------------------------------------------------------- */
  /* Interruption                                                      */
  /* ---------------------------------------------------------------- */

  /** New voice input arrived while speaking — apply the user's preference. */
  private applyInterruption(): void {
    if (this.state.phase !== 'speaking' && !this.currentJob && this.ttsQueue.length === 0) return;
    const mode = this.settings.getAll().voice.interruption;
    if (mode === 'ignore') return;
    if (mode === 'stop') {
      this.stopSpeaking();
      return;
    }
    // 'pause': cancel the audible playback but keep queued sentences — the
    // pump resumes them once the capture session ends.
    if (this.currentJob) {
      this.ttsQueue.unshift(this.currentJob);
      this.post({ t: 'tts-cancel' });
      this.currentJob = null;
    }
    this.broadcast(IpcEvents.voicePlaybackCancel, { sessionId: this.state.sessionId });
  }

  /* ---------------------------------------------------------------- */
  /* Worker lifecycle                                                  */
  /* ---------------------------------------------------------------- */

  private async ensureWorker(): Promise<void> {
    if (this.worker && this.workerReady) return;
    if (this.worker) return; // fork in flight; ready flips via 'ready'
    const workerPath = path.join(__dirname, 'voice-worker.js');
    const env = { ...process.env } as Record<string, string>;
    const libDir = sherpaPlatformDir();
    if (libDir) {
      if (process.platform === 'win32') env.PATH = `${libDir};${env.PATH ?? ''}`;
      else if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = `${libDir}:${env.DYLD_LIBRARY_PATH ?? ''}`;
      } else env.LD_LIBRARY_PATH = `${libDir}:${env.LD_LIBRARY_PATH ?? ''}`;
    }

    const proc = utilityProcess.fork(workerPath, [], {
      serviceName: 'limboo-voice',
      env,
    });
    this.worker = proc;
    this.workerReady = false;
    this.expectedExit = false;
    this.loadedKinds.clear();
    this.loading.clear();

    proc.on('message', (msg: VoiceWorkerResponse) => this.onWorkerMessage(msg));
    proc.on('exit', (code) => {
      const expected = this.expectedExit && code === 0;
      this.expectedExit = false;
      if (expected) logger.info('voice: worker exited cleanly');
      else logger.warn(`voice: worker exited with code ${code}`);
      const wasReady = this.workerReady;
      this.worker = null;
      this.workerReady = false;
      this.loadedKinds.clear();
      this.loading.clear();
      this.currentJob = null;
      this.captureSessionId = null;
      if (this.disposed) return;
      if (wasReady && this.workerRestarts < 1 && (this.ttsQueue.length > 0 || code !== 0)) {
        this.workerRestarts += 1;
        logger.info('voice: restarting crashed worker');
        void this.ensureWorker()
          .then(() => (this.ttsQueue.length > 0 ? this.ensureLoaded('tts') : undefined))
          .then(() => this.pumpTts())
          .catch(() => undefined);
      } else if (code !== 0) {
        this.setState({ phase: 'unavailable', error: 'The speech engine crashed' });
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Speech engine failed to start')), 15_000);
      const check = setInterval(() => {
        if (this.workerReady) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
        if (!this.worker) {
          clearTimeout(timer);
          clearInterval(check);
          reject(new Error('Speech engine exited during startup'));
        }
      }, 25);
    });
    this.workerRestarts = 0;
  }

  /** Load one model kind into the worker (idempotent, coalesced). */
  private ensureLoaded(kind: VoiceWorkerModelKind): Promise<void> {
    const voice = this.settings.getAll().voice;
    if (kind === 'vad') {
      const signature = `${voice.input.sensitivity}:${voice.input.silenceMs}`;
      if (this.loadedKinds.has('vad') && signature === this.vadSignature) {
        return Promise.resolve();
      }
      this.loadedKinds.delete('vad');
      this.vadSignature = signature;
    } else if (this.loadedKinds.has(kind)) {
      return Promise.resolve();
    }
    const inFlight = this.loading.get(kind);
    if (inFlight) return inFlight;

    const run = new Promise<void>((resolve, reject) => {
      this.loadWaiters.set(kind, { resolve, reject });
      if (kind === 'stt') {
        const dir = this.models.installDir('parakeet-tdt-0.6b-v2-int8');
        const paths: SttModelPaths = {
          encoder: path.join(dir, 'encoder.int8.onnx'),
          decoder: path.join(dir, 'decoder.int8.onnx'),
          joiner: path.join(dir, 'joiner.int8.onnx'),
          tokens: path.join(dir, 'tokens.txt'),
        };
        this.post({ t: 'load', kind: 'stt', paths, numThreads: 2 });
      } else if (kind === 'tts') {
        const dir = this.models.installDir('kokoro-en-v0_19');
        const paths: TtsModelPaths = {
          model: path.join(dir, 'model.onnx'),
          voices: path.join(dir, 'voices.bin'),
          tokens: path.join(dir, 'tokens.txt'),
          dataDir: path.join(dir, 'espeak-ng-data'),
        };
        this.post({ t: 'load', kind: 'tts', paths, numThreads: 2 });
      } else {
        const dir = this.models.installDir('silero-vad');
        this.post({
          t: 'load',
          kind: 'vad',
          paths: { model: path.join(dir, 'silero_vad.onnx') },
          sensitivity: voice.input.sensitivity,
          silenceMs: voice.input.silenceMs,
        });
      }
    }).finally(() => {
      this.loading.delete(kind);
      this.loadWaiters.delete(kind);
    });
    this.loading.set(kind, run);
    return run;
  }

  private readonly loadWaiters = new Map<
    VoiceWorkerModelKind,
    { resolve: () => void; reject: (err: Error) => void }
  >();

  private onWorkerMessage(msg: VoiceWorkerResponse): void {
    switch (msg.t) {
      case 'ready':
        this.workerReady = true;
        break;
      case 'loaded':
        this.loadedKinds.add(msg.kind);
        this.loadWaiters.get(msg.kind)?.resolve();
        break;
      case 'load-error':
        logger.error(`voice: failed to load ${msg.kind} model`, msg.message);
        this.loadWaiters.get(msg.kind)?.reject(new Error(msg.message));
        break;
      case 'vad':
        if (msg.event === 'speech-start') {
          this.applyInterruption();
          if (this.captureSessionId) {
            this.setState({ phase: 'recording', sessionId: this.captureSessionId });
          }
        } else if (this.captureSessionId) {
          this.setState({ phase: 'transcribing', sessionId: this.captureSessionId });
        }
        break;
      case 'transcript':
        this.onTranscript(msg.text, msg.durationMs);
        break;
      case 'tts-chunk': {
        const job = this.currentJob;
        const payload: VoiceTtsChunk = {
          utteranceId: msg.id,
          sessionId: job?.sessionId ?? '',
          sampleRate: msg.sampleRate,
          // Copy before the SECOND hop (main → renderer via webContents.send).
          // The buffer that arrived from the worker is external memory in main,
          // and Electron blocks re-serializing external buffers; `.slice()` makes
          // an owned copy so TTS audio reaches the renderer instead of throwing.
          pcm: msg.pcm.slice(0),
          seq: msg.seq,
          last: msg.last,
        };
        this.broadcast(IpcEvents.voiceTtsChunk, payload);
        break;
      }
      case 'tts-done':
        if (this.currentJob?.id === msg.id) this.currentJob = null;
        if (this.ttsQueue.length === 0 && !this.currentJob) this.setIdlePhase();
        this.pumpTts();
        this.touchActivity();
        break;
      case 'error':
        logger.warn(`voice: worker ${msg.scope} error`, msg.message);
        if (msg.scope === 'capture' && this.captureSessionId) {
          this.captureSessionId = null;
          this.setState({ phase: 'idle', error: msg.message });
        }
        break;
    }
  }

  /** A finished utterance — forward into the SAME agent session as typing. */
  private onTranscript(text: string, durationMs: number): void {
    const sessionId = this.captureSessionId;
    this.captureSessionId = null;
    if (!sessionId) {
      this.setIdlePhase();
      return;
    }
    const voice = this.settings.getAll().voice;
    let prompt = text.trim();
    if (!voice.input.autoPunctuation) {
      prompt = prompt.replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
    }
    this.broadcast(IpcEvents.voiceTranscript, {
      sessionId,
      text: prompt,
      final: true,
      durationMs,
    });
    if (!prompt) {
      this.setIdlePhase();
      return;
    }
    this.voiceInitiated.add(sessionId);
    if (this.captureMode === 'plan') this.planRuns.add(sessionId);
    this.setIdlePhase();
    void this.agent.send(sessionId, prompt, this.captureMode).catch((err) => {
      logger.error('voice: agent send failed', err);
      this.voiceInitiated.delete(sessionId);
      this.planRuns.delete(sessionId);
    });
    // The user stopped talking — queued speech may resume.
    this.pumpTts();
  }

  /* ---------------------------------------------------------------- */
  /* Housekeeping                                                      */
  /* ---------------------------------------------------------------- */

  private setIdlePhase(): void {
    if (this.currentJob || this.ttsQueue.length > 0) return;
    this.setState({ phase: 'idle', sessionId: this.captureSessionId });
    this.touchActivity();
  }

  /** (Re)arm the idle shutdown timer that releases model memory. */
  private touchActivity(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const busy =
        this.captureSessionId !== null || this.currentJob !== null || this.ttsQueue.length > 0;
      if (!busy && this.worker) {
        logger.info('voice: shutting down idle speech worker');
        this.expectedExit = true;
        this.post({ t: 'shutdown' });
      }
    }, WORKER_IDLE_MS);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  private post(msg: VoiceWorkerRequest): void {
    this.worker?.postMessage(msg);
  }

  private setState(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.broadcast(IpcEvents.voiceState, this.state);
  }

  private broadcast<T>(channel: string, payload: T): void {
    if (this.disposed) return;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribeAgent?.();
    this.ttsQueue.length = 0;
    if (this.worker) {
      this.expectedExit = true;
      this.post({ t: 'shutdown' });
      this.worker = null;
    }
  }
}

/**
 * Locate the sherpa-onnx per-platform package directory so its shared
 * libraries can be put on the dynamic-loader search path of the worker.
 * In a packaged build the files live in app.asar.unpacked (see forge.config).
 */
function sherpaPlatformDir(): string | null {
  const name = `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
  try {
    const pkg = require.resolve(`${name}/package.json`);
    const dir = path.dirname(pkg).replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`,
    );
    return fs.existsSync(dir) ? dir : null;
  } catch {
    logger.warn(`voice: platform package ${name} not found`);
    return null;
  }
}

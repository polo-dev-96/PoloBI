export type AnnouncementPhase = "waiting" | "cue" | "speaking" | "displaying";

export type AnnouncementCompletionReason = "completed" | "cancelled";

export type AnnouncementSource = "ticket" | "break" | (string & {});

export type AnnouncementTone =
  | "ticket-open"
  | "ticket-assigned"
  | "ticket-rated"
  | "ticket-deleted"
  | "ticket-finished"
  | "warning"
  | "critical"
  | "error"
  | "break"
  | (() => void | Promise<void>);

export interface AnnouncementRequest {
  id: string;
  text: string;
  tone?: AnnouncementTone;
  source?: AnnouncementSource;
  minimumDisplayMs?: number;
  gapAfterMs?: number;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onPhase?: (phase: AnnouncementPhase) => void;
  onComplete?: (reason: AnnouncementCompletionReason) => void;
}

export interface AnnouncementItem extends AnnouncementRequest {
  phase: AnnouncementPhase;
  enqueuedAt: number;
  startedAt?: number;
}

export interface AnnouncementQueueSnapshot {
  active: AnnouncementItem | null;
  pendingCount: number;
  totalCount: number;
  isBusy: boolean;
  muted: boolean;
  phase: AnnouncementPhase | null;
}

type AnnouncementQueueListener = (snapshot: AnnouncementQueueSnapshot) => void;
type SpeechResult = "ended" | "error" | "muted" | "unsupported";

const DEFAULT_GAP_MS = 450;
const VOICES_TIMEOUT_MS = 500;
export const DEFAULT_SPEECH_VOLUME = 1;

const FEMALE_PORTUGUESE_VOICE_HINTS = [
  "maria",
  "francisca",
  "luciana",
  "camila",
  "fernanda",
  "helena",
  "joana",
  "female",
  "feminina",
];

const normalizeVoiceName = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

export const selectPreferredPortugueseVoice = (
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined => {
  const portugueseBrazil = voices.filter(
    (voice) => voice.lang.toLowerCase() === "pt-br",
  );
  const portuguese = portugueseBrazil.length > 0
    ? portugueseBrazil
    : voices.filter((voice) => voice.lang.toLowerCase().startsWith("pt"));

  for (const hint of FEMALE_PORTUGUESE_VOICE_HINTS) {
    const femaleVoice = portuguese.find((voice) =>
      normalizeVoiceName(voice.name).includes(hint)
    );
    if (femaleVoice) return femaleVoice;
  }

  return portuguese[0];
};

const tonePatterns: Record<Exclude<AnnouncementTone, Function>, Array<[number, number]>> = {
  "ticket-open": [[659, 95], [880, 140]],
  "ticket-assigned": [[523, 85], [659, 85], [784, 135]],
  "ticket-rated": [[659, 75], [784, 75], [988, 155]],
  "ticket-deleted": [[440, 110], [330, 150]],
  "ticket-finished": [[523, 75], [659, 75], [784, 145]],
  warning: [[740, 115], [740, 115]],
  critical: [[880, 120], [587, 120], [880, 160]],
  error: [[392, 130], [294, 180]],
  break: [[523, 90], [659, 130]],
};

const cloneItem = (item: AnnouncementItem | null): AnnouncementItem | null =>
  item ? { ...item } : null;

/**
 * Serializa toda saída de voz da aplicação. A fila nunca interrompe um item
 * para iniciar outro; cancelamentos só acontecem por chamadas explícitas.
 */
export class AnnouncementQueue {
  private pending: AnnouncementItem[] = [];
  private active: AnnouncementItem | null = null;
  private listeners = new Set<AnnouncementQueueListener>();
  private queuedIds = new Set<string>();
  private muted = false;
  private runToken = 0;
  private voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;
  private audioContext: AudioContext | null = null;
  private activeOscillators = new Set<OscillatorNode>();
  private speechResolve: ((result: SpeechResult) => void) | null = null;
  private speechRequest: AbortController | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogStartedAt = 0;
  private watchdogRemainingMs = 0;
  private watchdogCallback: (() => void) | null = null;
  private visibilityInstalled = false;

  constructor() {
    this.installVisibilityListener();
  }

  enqueue(request: AnnouncementRequest): boolean {
    const id = request.id.trim();
    if (!id || this.queuedIds.has(id)) return false;

    const item: AnnouncementItem = {
      ...request,
      id,
      text: request.text.trim(),
      source: request.source ?? "ticket",
      minimumDisplayMs: Math.max(0, request.minimumDisplayMs ?? 0),
      gapAfterMs: Math.max(0, request.gapAfterMs ?? DEFAULT_GAP_MS),
      phase: "waiting",
      enqueuedAt: Date.now(),
    };

    this.pending.push(item);
    this.queuedIds.add(id);
    this.safePhaseCallback(item, "waiting");
    this.emit();
    void this.startNext();
    return true;
  }

  cancelCurrent(_reason = "cancelled"): boolean {
    if (!this.active) return false;

    const item = this.active;
    this.runToken += 1;
    this.stopTone();
    this.stopSpeech("muted", true);
    this.finishItem(item, "cancelled");
    void this.startNext();
    return true;
  }

  cancel(id: string, reason = "cancelled"): boolean {
    if (this.active?.id === id) return this.cancelCurrent(reason);

    const index = this.pending.findIndex((item) => item.id === id);
    if (index < 0) return false;

    const [item] = this.pending.splice(index, 1);
    this.queuedIds.delete(item.id);
    this.safeCompleteCallback(item, "cancelled");
    this.emit();
    return true;
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;

    if (muted) {
      this.stopTone();
      // Silenciar é uma ação explícita: a fala atual pode ser cancelada, mas
      // o item visual continua respeitando seu tempo mínimo.
      this.stopSpeech("muted", true);
    }

    this.emit();
  }

  isMuted(): boolean {
    return this.muted;
  }

  subscribe(listener: AnnouncementQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AnnouncementQueueSnapshot {
    return {
      active: cloneItem(this.active),
      pendingCount: this.pending.length,
      totalCount: this.pending.length + (this.active ? 1 : 0),
      isBusy: Boolean(this.active),
      muted: this.muted,
      phase: this.active?.phase ?? null,
    };
  }

  private async startNext(): Promise<void> {
    if (this.active || this.pending.length === 0) return;

    const item = this.pending.shift()!;
    this.active = item;
    item.startedAt = Date.now();
    const token = ++this.runToken;

    this.setPhase(item, "cue");
    if (!this.muted) await this.playTone(item.tone);
    if (!this.isCurrent(item, token)) return;

    this.setPhase(item, "speaking");
    if (!this.muted && item.text) await this.speak(item);
    if (!this.isCurrent(item, token)) return;

    this.setPhase(item, "displaying");
    const visibleUntil = (item.startedAt ?? Date.now()) + (item.minimumDisplayMs ?? 0);
    await this.delay(Math.max(0, visibleUntil - Date.now()));
    if (!this.isCurrent(item, token)) return;

    await this.delay(item.gapAfterMs ?? DEFAULT_GAP_MS);
    if (!this.isCurrent(item, token)) return;

    this.finishItem(item, "completed");
    void this.startNext();
  }

  private isCurrent(item: AnnouncementItem, token: number): boolean {
    return this.active?.id === item.id && this.runToken === token;
  }

  private setPhase(item: AnnouncementItem, phase: AnnouncementPhase): void {
    item.phase = phase;
    this.safePhaseCallback(item, phase);
    this.emit();
  }

  private finishItem(item: AnnouncementItem, reason: AnnouncementCompletionReason): void {
    if (this.active?.id === item.id) this.active = null;
    this.queuedIds.delete(item.id);
    this.safeCompleteCallback(item, reason);
    this.emit();
  }

  private safePhaseCallback(item: AnnouncementItem, phase: AnnouncementPhase): void {
    try {
      item.onPhase?.(phase);
    } catch (error) {
      console.error("Falha no callback de fase do anúncio", error);
    }
  }

  private safeCompleteCallback(
    item: AnnouncementItem,
    reason: AnnouncementCompletionReason,
  ): void {
    try {
      item.onComplete?.(reason);
    } catch (error) {
      console.error("Falha no callback de conclusão do anúncio", error);
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private async speak(item: AnnouncementItem): Promise<SpeechResult> {
    const token = this.runToken;
    const remoteResult = await this.speakWithElevenLabs(item).catch(() => "error" as const);
    if (!this.isCurrent(item, token) || this.muted) return "muted";
    if (remoteResult === "ended" || remoteResult === "muted") return remoteResult;
    return this.speakWithBrowser(item);
  }

  private async speakWithElevenLabs(item: AnnouncementItem): Promise<SpeechResult> {
    if (typeof window === "undefined" || typeof Audio === "undefined") return "unsupported";
    const controller = new AbortController();
    this.speechRequest = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 13_000);
    let blob: Blob;
    try {
      const response = await fetch("/api/announcements/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: item.text }),
        signal: controller.signal,
      });
      if (!response.ok) return "error";
      blob = await response.blob();
      if (!blob.size) return "error";
    } catch {
      return (!timedOut && controller.signal.aborted) || this.muted || this.active?.id !== item.id
        ? "muted" : "error";
    } finally {
      clearTimeout(timeout);
      if (this.speechRequest === controller) this.speechRequest = null;
    }
    if (this.active?.id !== item.id || this.muted || controller.signal.aborted) return "muted";

    return new Promise<SpeechResult>((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = item.volume ?? DEFAULT_SPEECH_VOLUME;
      this.remoteAudio = audio;
      let settled = false;
      const settle = (result: SpeechResult) => {
        if (settled) return;
        settled = true;
        this.clearWatchdog();
        if (this.speechResolve === settle) this.speechResolve = null;
        if (this.remoteAudio === audio) this.remoteAudio = null;
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        URL.revokeObjectURL(url);
        resolve(result);
      };
      this.speechResolve = settle;
      audio.onended = () => settle("ended");
      audio.onerror = () => settle("error");
      this.startWatchdog(Math.min(120_000, Math.max(12_000, item.text.length * 115)), () => settle("error"));
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        this.pauseWatchdog();
      } else {
        void audio.play().catch(() => {
          if (typeof document === "undefined" || document.visibilityState !== "hidden") settle("error");
        });
      }
    });
  }

  private async speakWithBrowser(item: AnnouncementItem): Promise<SpeechResult> {
    const synth = this.getSpeechSynthesis();
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return "unsupported";

    const voices = await this.loadVoices(synth);
    if (this.active?.id !== item.id || this.muted) return "muted";

    return new Promise<SpeechResult>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = item.lang ?? "pt-BR";
      utterance.rate = item.rate ?? 0.96;
      utterance.pitch = item.pitch ?? 1;
      utterance.volume = item.volume ?? DEFAULT_SPEECH_VOLUME;

      const preferredVoice = selectPreferredPortugueseVoice(voices);
      if (preferredVoice) utterance.voice = preferredVoice;

      let settled = false;
      const settle = (result: SpeechResult) => {
        if (settled) return;
        settled = true;
        this.clearWatchdog();
        if (this.speechResolve === settle) this.speechResolve = null;
        utterance.onend = null;
        utterance.onerror = null;
        resolve(result);
      };

      this.speechResolve = settle;
      utterance.onend = () => settle("ended");
      utterance.onerror = () => settle("error");

      const watchdogMs = Math.min(120_000, Math.max(12_000, item.text.length * 115));
      const verifyNativeSpeechEnded = () => {
        // onend pode falhar em alguns navegadores. Só avançamos quando o motor
        // nativo também estiver ocioso, para não dessincronizar card e voz.
        if (synth.speaking || synth.pending) {
          this.startWatchdog(2_000, verifyNativeSpeechEnded);
          return;
        }
        settle("error");
      };
      this.startWatchdog(watchdogMs, verifyNativeSpeechEnded);

      try {
        synth.speak(utterance);
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          synth.pause();
          this.pauseWatchdog();
        }
      } catch {
        settle("error");
      }
    });
  }

  private loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
    const available = synth.getVoices();
    if (available.length > 0) return Promise.resolve(available);
    if (this.voicesPromise) return this.voicesPromise;

    this.voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        synth.removeEventListener?.("voiceschanged", finish);
        resolve(synth.getVoices());
      };

      synth.addEventListener?.("voiceschanged", finish, { once: true });
      setTimeout(finish, VOICES_TIMEOUT_MS);
    }).finally(() => {
      this.voicesPromise = null;
    });

    return this.voicesPromise;
  }

  private getSpeechSynthesis(): SpeechSynthesis | null {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    return window.speechSynthesis;
  }

  private stopSpeech(result: SpeechResult, cancelBrowserSpeech: boolean): void {
    this.speechRequest?.abort();
    this.speechRequest = null;
    const synth = this.getSpeechSynthesis();
    const resolve = this.speechResolve;
    this.speechResolve = null;
    this.clearWatchdog();

    if (cancelBrowserSpeech) {
      try {
        synth?.cancel();
      } catch {
        // O navegador pode invalidar a síntese durante o descarte da página.
      }
    }
    resolve?.(result);
  }

  private installVisibilityListener(): void {
    if (this.visibilityInstalled || typeof document === "undefined") return;
    this.visibilityInstalled = true;

    document.addEventListener("visibilitychange", () => {
      const audio = this.remoteAudio;
      if (audio && this.active?.phase === "speaking" && this.speechResolve) {
        const settle = this.speechResolve;
        if (document.visibilityState === "hidden") {
          audio.pause();
          this.pauseWatchdog();
        } else {
          this.resumeWatchdog();
          void audio.play().catch(() => {
            if (document.visibilityState !== "hidden") settle("error");
          });
        }
        return;
      }
      const synth = this.getSpeechSynthesis();
      if (!synth || this.active?.phase !== "speaking" || !this.speechResolve) return;

      if (document.visibilityState === "hidden") {
        try {
          synth.pause();
        } finally {
          this.pauseWatchdog();
        }
        return;
      }

      try {
        synth.resume();
      } finally {
        this.resumeWatchdog();
      }
    });
  }

  private startWatchdog(durationMs: number, onTimeout: () => void): void {
    this.clearWatchdog();
    this.watchdogRemainingMs = durationMs;
    this.watchdogCallback = onTimeout;
    this.watchdogStartedAt = Date.now();
    this.watchdogTimer = setTimeout(onTimeout, durationMs);
  }

  private pauseWatchdog(): void {
    if (!this.watchdogTimer) return;
    this.watchdogRemainingMs = Math.max(
      0,
      this.watchdogRemainingMs - (Date.now() - this.watchdogStartedAt),
    );
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private resumeWatchdog(): void {
    if (this.watchdogTimer || !this.watchdogCallback) return;
    this.watchdogStartedAt = Date.now();
    this.watchdogTimer = setTimeout(
      this.watchdogCallback,
      Math.max(1, this.watchdogRemainingMs),
    );
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    this.watchdogStartedAt = 0;
    this.watchdogRemainingMs = 0;
    this.watchdogCallback = null;
  }

  private async playTone(tone?: AnnouncementTone): Promise<void> {
    if (!tone || this.muted) return;
    if (typeof tone === "function") {
      try {
        await tone();
      } catch {
        // O sinal é um aprimoramento; falhas de autoplay não bloqueiam a voz.
      }
      return;
    }

    if (typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const context = this.audioContext ?? new AudioContextClass();
      this.audioContext = context;
      if (context.state === "suspended") {
        await Promise.race([context.resume(), this.delay(500)]);
        if ((context.state as AudioContextState) !== "running") return;
      }

      const pattern = tonePatterns[tone];
      let cursor = context.currentTime;
      let totalMs = 0;
      for (const [frequency, durationMs] of pattern) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, cursor);
        gain.gain.setValueAtTime(0.0001, cursor);
        gain.gain.exponentialRampToValueAtTime(0.11, cursor + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, cursor + durationMs / 1_000);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(cursor);
        oscillator.stop(cursor + durationMs / 1_000 + 0.02);
        this.activeOscillators.add(oscillator);
        oscillator.onended = () => this.activeOscillators.delete(oscillator);
        cursor += durationMs / 1_000 + 0.045;
        totalMs += durationMs + 45;
      }
      await this.delay(totalMs);
    } catch {
      // Sem gesto do usuário alguns navegadores bloqueiam AudioContext.
    }
  }

  private stopTone(): void {
    this.activeOscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // Osciladores já finalizados podem lançar InvalidStateError.
      }
    });
    this.activeOscillators.clear();
  }

  private delay(durationMs: number): Promise<void> {
    if (durationMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}

export const announcementQueue = new AnnouncementQueue();

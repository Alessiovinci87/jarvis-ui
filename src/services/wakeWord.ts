/**
 * Hands-free activation: listens continuously for a wake word using the
 * browser's SpeechRecognition (Web Speech API). No dependencies.
 *
 * Notes:
 * - Chrome/Edge implement it as `webkitSpeechRecognition` and route audio to
 *   an online recognition service; it is unavailable offline and in some browsers.
 * - Only the wake word is handled here. The actual request is recorded and
 *   transcribed by the OpenJarvis backend afterwards.
 */

type RecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isWakeWordSupported(): boolean {
  return getCtor() !== null
}

/** Matches "jarvis" and common mis-hearings, as a whole word. */
export const DEFAULT_WAKE_PATTERN = /\b(jarvis|jarvi|giarvis|jervis|charvis)\b/i

export interface WakeWordOptions {
  lang?: string
  pattern?: RegExp
  onWake: (heard: string) => void
  onError?: (error: string) => void
  /** Fired when the browser refuses to keep listening (e.g. no permission). */
  onUnavailable?: (reason: string) => void
}

export class WakeWordListener {
  private rec: SpeechRecognitionLike | null = null
  private running = false
  private restartTimer: number | undefined
  private readonly opts: Required<Pick<WakeWordOptions, 'lang' | 'pattern'>> & WakeWordOptions

  constructor(options: WakeWordOptions) {
    this.opts = { lang: 'it-IT', pattern: DEFAULT_WAKE_PATTERN, ...options }
  }

  get active(): boolean {
    return this.running
  }

  start(): void {
    const Ctor = getCtor()
    if (!Ctor) {
      this.opts.onUnavailable?.('speech recognition not supported')
      return
    }
    if (this.running) return
    this.running = true
    this.spawn(Ctor)
  }

  stop(): void {
    this.running = false
    window.clearTimeout(this.restartTimer)
    if (this.rec) {
      this.rec.onend = null
      this.rec.onresult = null
      this.rec.onerror = null
      try {
        this.rec.abort()
      } catch {
        /* already stopped */
      }
      this.rec = null
    }
  }

  private spawn(Ctor: RecognitionCtor) {
    const rec = new Ctor()
    rec.lang = this.opts.lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const alt = event.results[i][0]
        const text = alt?.transcript ?? ''
        if (this.opts.pattern.test(text)) {
          this.opts.onWake(text.trim())
          // Stop this session so the wake word is not matched twice; restart later via resume().
          this.pauseSession()
          return
        }
      }
    }
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are routine in continuous mode.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.running = false
        this.opts.onUnavailable?.('microphone permission denied for wake word')
        return
      }
      if (e.error === 'network') {
        this.opts.onError?.('wake word service unreachable')
      }
    }
    rec.onend = () => {
      // Browsers end continuous sessions periodically: restart while enabled.
      if (!this.running) return
      this.restartTimer = window.setTimeout(() => {
        if (this.running) this.spawn(Ctor)
      }, 400)
    }
    this.rec = rec
    try {
      rec.start()
    } catch {
      // start() throws if a session is already active; onend will reschedule.
    }
  }

  /** Temporarily stop recognising (e.g. while recording or speaking). */
  pauseSession(): void {
    window.clearTimeout(this.restartTimer)
    if (this.rec) {
      this.rec.onend = null
      try {
        this.rec.abort()
      } catch {
        /* ignore */
      }
      this.rec = null
    }
  }

  /** Resume after pauseSession() while still enabled. */
  resume(): void {
    if (!this.running || this.rec) return
    const Ctor = getCtor()
    if (Ctor) this.spawn(Ctor)
  }
}

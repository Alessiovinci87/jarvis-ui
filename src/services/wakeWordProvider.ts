/**
 * Wake-word abstraction. `useVoice` only talks to this interface; the concrete
 * engine is chosen at runtime:
 *
 *  - `LocalWakeWordProvider`   — offline "hey jarvis" model running inside the
 *                                local action bridge (openWakeWord + ONNX).
 *                                Audio never leaves the machine.
 *  - `BrowserWakeWordProvider` — Web Speech API (Chrome/Edge route audio to an
 *                                online recogniser). Kept as the fallback.
 */

import { actionBridge } from './actionBridge'
import { WakeWordListener, isWakeWordSupported } from './wakeWord'

export type WakeWordProviderKind = 'local' | 'browser'

export interface WakeWordCallbacks {
  onWake: (detail: string) => void
  onError?: (message: string) => void
  /** The provider cannot keep running (permission denied, bridge gone…). */
  onUnavailable?: (reason: string) => void
}

export interface WakeWordProvider {
  readonly kind: WakeWordProviderKind
  /** Human label for the HUD. */
  readonly label: string
  /** True when audio is processed on this machine only. */
  readonly offline: boolean
  start(): void
  stop(): void
  /** Ignore detections temporarily (while recording / thinking / speaking). */
  pause(): void
  resume(): void
}

/* ------------------------------------------------------------------ browser */

export class BrowserWakeWordProvider implements WakeWordProvider {
  readonly kind = 'browser' as const
  readonly label = 'ONLINE'
  readonly offline = false
  private listener: WakeWordListener | null = null
  private readonly cb: WakeWordCallbacks

  constructor(cb: WakeWordCallbacks) {
    this.cb = cb
  }

  static supported(): boolean {
    return isWakeWordSupported()
  }

  start(): void {
    if (this.listener) return
    this.listener = new WakeWordListener({
      onWake: (heard) => this.cb.onWake(heard),
      onError: (m) => this.cb.onError?.(m),
      onUnavailable: (r) => this.cb.onUnavailable?.(r),
    })
    this.listener.start()
  }

  stop(): void {
    this.listener?.stop()
    this.listener = null
  }

  pause(): void {
    this.listener?.pauseSession()
  }

  resume(): void {
    this.listener?.resume()
  }
}

/* -------------------------------------------------------------------- local */

export class LocalWakeWordProvider implements WakeWordProvider {
  readonly kind = 'local' as const
  readonly label = 'LOCAL'
  readonly offline = true
  private source: EventSource | null = null
  private paused = false
  private running = false
  private retryTimer: number | undefined
  private failures = 0
  private readonly cb: WakeWordCallbacks

  constructor(cb: WakeWordCallbacks) {
    this.cb = cb
  }

  /** Probe the bridge once; resolves to true when the offline model is loaded. */
  static async available(signal?: AbortSignal): Promise<boolean> {
    try {
      const status = await actionBridge.wakeStatus(signal)
      return status.available
    } catch {
      return false
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.paused = false
    void this.connect()
  }

  stop(): void {
    this.running = false
    window.clearTimeout(this.retryTimer)
    this.source?.close()
    this.source = null
    // Release the microphone on the bridge side. Best effort.
    void actionBridge.wakeStop().catch(() => undefined)
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  private async connect(): Promise<void> {
    try {
      await actionBridge.wakeStart()
    } catch (err) {
      this.fail(`local wake word unavailable: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (!this.running) return
    const source = new EventSource(actionBridge.wakeEventsUrl())
    this.source = source
    source.addEventListener('wake', (ev) => {
      if (!this.running || this.paused) return
      let score = ''
      try {
        score = String((JSON.parse((ev as MessageEvent<string>).data) as { score?: number }).score ?? '')
      } catch {
        /* ignore malformed payload */
      }
      this.cb.onWake(score ? `hey jarvis (${score})` : 'hey jarvis')
    })
    source.addEventListener('error', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as { message?: string }
        if (data.message) this.cb.onError?.(`wake engine: ${data.message}`)
      } catch {
        /* a transport error has no payload */
      }
    })
    source.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as { running?: boolean }
        if (data.running) this.failures = 0
      } catch {
        /* ignore */
      }
    })
    source.onerror = () => {
      // EventSource reconnects by itself; after repeated failures give up so the UI can fall back.
      if (!this.running) return
      this.failures += 1
      if (this.failures >= 5) {
        this.fail('local wake word: bridge connection lost')
      }
    }
  }

  private fail(reason: string): void {
    this.running = false
    this.source?.close()
    this.source = null
    this.cb.onUnavailable?.(reason)
  }
}

/* ---------------------------------------------------------------- factory */

export interface ProviderChoice {
  kind: WakeWordProviderKind | null
  reason: string
}

/** Prefer the offline engine; fall back to the browser recogniser; null when neither exists. */
export async function chooseWakeWordProvider(signal?: AbortSignal): Promise<ProviderChoice> {
  if (await LocalWakeWordProvider.available(signal)) return { kind: 'local', reason: 'offline model via local bridge' }
  if (BrowserWakeWordProvider.supported()) return { kind: 'browser', reason: 'bridge unavailable: browser recogniser' }
  return { kind: null, reason: 'no wake word engine available' }
}

export function createWakeWordProvider(kind: WakeWordProviderKind, cb: WakeWordCallbacks): WakeWordProvider {
  return kind === 'local' ? new LocalWakeWordProvider(cb) : new BrowserWakeWordProvider(cb)
}

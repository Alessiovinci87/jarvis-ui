/**
 * Client for the Jarvis Local Action Bridge (loopback-only Python service).
 *
 * The bridge accepts only `{ action, target }` ids from a closed allowlist.
 * This client re-validates the pair before sending, so an unexpected value can
 * never leave the browser.
 */

import {
  TARGET_LABEL,
  isActionIntent,
  type ActionIntent,
  type ActionOutcome,
  type BridgeActionResponse,
  type BridgeHealth,
  type BridgeWakeStatus,
} from '../types/actions'
import type { TranscribeResponse } from '../types/speech'
import type { BrainItem, BrainItemPatch, BrainItemsResponse, BrainOutcome, BrainRecallHit, BrainToday, GoogleStatus } from '../types/brain'

export const BRIDGE_BASE_URL: string =
  (import.meta.env.VITE_JARVIS_BRIDGE_URL as string | undefined) ?? 'http://127.0.0.1:8765'

const DEFAULT_TIMEOUT_MS = 4000

export class BridgeError extends Error {
  readonly status: number | null
  readonly code: string | null
  constructor(message: string, status: number | null, code: string | null = null) {
    super(message)
    this.name = 'BridgeError'
    this.status = status
    this.code = code
  }
}

async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  init.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const res = await fetch(`${BRIDGE_BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    const data: unknown = text ? JSON.parse(text) : null
    if (!res.ok) {
      const detail = (data as { detail?: { code?: string; message?: string } | string } | null)?.detail
      const code = typeof detail === 'object' && detail ? (detail.code ?? null) : null
      const message =
        typeof detail === 'object' && detail ? (detail.message ?? `bridge error ${res.status}`) : `bridge error ${res.status}`
      throw new BridgeError(message, res.status, code)
    }
    return data as T
  } catch (err) {
    if (err instanceof BridgeError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') throw new BridgeError('bridge timeout', null, 'timeout')
    throw new BridgeError('bridge unreachable', null, 'unreachable')
  } finally {
    window.clearTimeout(timer)
  }
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** Casual, spoken-friendly acknowledgements. `detail` comes from the bridge (never a command). */
export function successReply(intent: ActionIntent, detail?: string): string {
  const label = TARGET_LABEL[intent.target] ?? intent.target
  switch (intent.action) {
    case 'open_app':
      return pick([`Fatto, ${label} è aperto.`, `Ecco ${label}.`, `${label} in arrivo.`])
    case 'open_folder':
      return pick(['Ecco la cartella Download.', 'Download aperta.'])
    case 'open_project':
      return pick([`VS Code aperto su ${label}.`, `Ecco ${label} in VS Code, buon lavoro.`])
    case 'web_search':
      return pick([`Ecco la ricerca di «${intent.query}» nel browser.`, `Ti ho aperto «${intent.query}» su Google.`])
    case 'close_app':
      return detail === 'non era aperta' ? `${label} non era aperto.` : pick([`Chiuso ${label}.`, `${label} chiuso.`])
    case 'timer':
      if (intent.target === 'set') return detail ? `Ok, ${detail} impostat${detail.startsWith('sveglia') ? 'a' : 'o'}.` : 'Timer impostato.'
      if (intent.target === 'cancel') return detail === 'nessun timer attivo' ? 'Non c’era nessun timer attivo.' : `Fatto, timer ${detail}.`
      return detail === 'nessun timer attivo' ? 'Nessun timer attivo.' : `Timer attivi: ${detail}.`
    case 'weather':
      return detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.` : 'Meteo non disponibile.'
    case 'find_file':
      return detail
        ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`
        : intent.target === 'folders'
          ? 'Nessuna cartella trovata.'
          : 'Nessun file trovato.'
    case 'play_music':
      return detail?.startsWith('ricerca')
        ? `Ti ho aperto la ricerca di «${intent.query}» su Spotify: scegli tu la versione.`
        : pick([`Metto «${intent.query}».`, `Vai con «${intent.query}».`, `«${intent.query}», ottima scelta.`])
    case 'media':
      switch (intent.target) {
        case 'play_pause':
          return pick(['Ok.', 'Fatto.'])
        case 'next':
          return pick(['Avanti.', 'Prossima.'])
        case 'previous':
          return 'Torno indietro.'
        case 'volume_up':
          return 'Alzo.'
        case 'volume_down':
          return 'Abbasso.'
        case 'mute':
          return 'Silenzio.'
        case 'now_playing':
          return detail && detail !== 'niente in riproduzione' ? `Sta suonando ${detail}.` : 'Al momento non c’è niente in riproduzione.'
      }
  }
}

/** One short sentence for a multi-step command. */
export function sequenceReply(replies: string[]): string {
  const clean = replies.map((r) => r.replace(/[.!]+$/, '').trim()).filter(Boolean)
  if (clean.length <= 1) return `${clean[0] ?? 'Fatto'}.`
  return `${clean.slice(0, -1).join(', ')} e ${clean[clean.length - 1].charAt(0).toLowerCase()}${clean[clean.length - 1].slice(1)}.`
}

function failureReply(err: BridgeError): string {
  switch (err.code) {
    case 'unreachable':
    case 'timeout':
      return 'Non riesco a parlare con il bridge locale, quindi per ora le azioni sul PC sono ferme.'
    case 'not_installed':
      return "Quell'app non risulta installata qui."
    case 'bad_query':
      return err.message ? `${err.message.charAt(0).toUpperCase()}${err.message.slice(1)}` : 'Mi manca un dettaglio: cosa, di preciso?'
    case 'not_found':
      return err.message ? `${err.message.charAt(0).toUpperCase()}${err.message.slice(1)}.` : 'Non l’ho trovato.'
    case 'api_error':
      return 'Il servizio esterno non risponde, riprova tra poco.'
    case 'not_logged_in':
      return 'Per questo mi serve il tuo account Spotify: collegalo da http://127.0.0.1:8765/spotify/login e riprova.'
    case 'premium_required':
      return 'Spotify permette il controllo della riproduzione via API solo con Premium, quindi uso i tasti multimediali.'
    case 'unknown_action':
    case 'unknown_target':
      return 'Questa non è tra le cose che posso fare.'
    default:
      return `Non ci sono riuscito: ${err.message}.`
  }
}

export const actionBridge = {
  health: (signal?: AbortSignal) => request<BridgeHealth>('/health', { signal }),

  wakeStatus: (signal?: AbortSignal) => request<BridgeWakeStatus>('/wake/status', { signal }),
  wakeStart: () => request<BridgeWakeStatus>('/wake/start', { method: 'POST', timeoutMs: 10_000 }),
  wakeStop: () => request<BridgeWakeStatus>('/wake/stop', { method: 'POST' }),
  wakeEventsUrl: () => `${BRIDGE_BASE_URL}/wake/events`,
  /** Generic bridge events (timers firing, …). */
  eventsUrl: () => `${BRIDGE_BASE_URL}/events`,

  sttHealth: (signal?: AbortSignal) =>
    request<{ available: boolean; loaded: boolean; model: string; reason: string | null }>('/stt/health', { signal }),

  /**
   * Speech-to-text with the command vocabulary as Whisper prompt (same model as
   * OpenJarvis, far fewer mis-hearings on app names). Audio stays on this PC.
   */
  async transcribe(audio: Blob, filename: string, language = 'it', signal?: AbortSignal): Promise<TranscribeResponse> {
    const form = new FormData()
    form.append('file', audio, filename)
    form.append('language', language)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 60_000)
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    try {
      const res = await fetch(`${BRIDGE_BASE_URL}/stt`, { method: 'POST', body: form, signal: controller.signal })
      const data = (await res.json()) as TranscribeResponse & { detail?: { code?: string; message?: string } }
      if (!res.ok) throw new BridgeError(data.detail?.message ?? `bridge error ${res.status}`, res.status, data.detail?.code ?? null)
      return data
    } finally {
      window.clearTimeout(timer)
    }
  },

  /** Startup theme: plays `query` quietly for `seconds`, then the bridge pauses it and restores the volume. */
  spotifyIntro: (query: string, seconds = 17, volume = 20, fade = 2) =>
    request<{ ok: boolean; playing: boolean; track: string; artist: string }>('/spotify/intro', {
      method: 'POST',
      body: { query, seconds, volume, fade },
      timeoutMs: 40_000,
    }),

  /**
   * Free text → allowlisted intent via the bridge's compact classifier (Ollama direct,
   * ~20 s on this CPU). `trusted` is true when the preferred model answered; the
   * intent is re-validated here regardless.
   */
  async intent(text: string, context?: string): Promise<{ intent: ActionIntent | null; model: string; trusted: boolean; seconds: number }> {
    const res = await request<{ intent: unknown; model: string; trusted: boolean; seconds: number }>('/intent', {
      method: 'POST',
      body: { text: text.slice(0, 300), ...(context ? { context: context.slice(0, 120) } : {}) },
      timeoutMs: 180_000,
    })
    return { ...res, intent: isActionIntent(res.intent) ? res.intent : null }
  },

  /* ---- second brain (notes, facts, reminders, lists): all local, in the bridge ---- */

  /**
   * Free text → the brain decides whether it is a note / reminder / list / memory
   * request and answers in Italian. `handled:false` means "not for me, go on".
   * With `allowModel` the bridge may ask the local model to *extract* a structure
   * when the sentence clearly talks about notes/reminders but no rule matched.
   */
  brain: (text: string, allowModel = true) =>
    request<BrainOutcome>('/brain', { method: 'POST', body: { text: text.slice(0, 500), allow_model: allowModel }, timeoutMs: allowModel ? 150_000 : 8_000 }),
  brainToday: (signal?: AbortSignal) => request<BrainToday>('/brain/today', { signal }),
  /** Spoken briefing (reminders, open tasks, notes, lists; with `weather` also today's forecast). */
  brainSummary: (weather = false, signal?: AbortSignal) =>
    request<{ reply: string; has_content: boolean }>(`/brain/summary${weather ? '?weather=1' : ''}`, { signal, timeoutMs: 15_000 }),
  brainRecall: (q: string, signal?: AbortSignal) =>
    request<{ results: BrainRecallHit[] }>(`/brain/recall?q=${encodeURIComponent(q.slice(0, 300))}`, { signal }),
  /** Browse everything Jarvis knows, by kind; `q` is a full-text filter. */
  brainItems: (kind: BrainItem['kind'], opts: { q?: string; list?: string; includeDone?: boolean } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams({ kind })
    if (opts.q) params.set('q', opts.q)
    if (opts.list) params.set('list', opts.list)
    if (opts.includeDone) params.set('include_done', '1')
    return request<BrainItemsResponse>(`/brain/items?${params.toString()}`, { signal })
  },
  brainPatch: (id: number, patch: BrainItemPatch) => request<BrainItem>(`/brain/items/${id}`, { method: 'PATCH', body: patch }),
  brainDelete: (id: number) => request<{ ok: boolean; id: number }>(`/brain/items/${id}`, { method: 'DELETE' }),
  googleStatus: (signal?: AbortSignal) => request<GoogleStatus>('/google/status', { signal }),
  googleLoginUrl: () => `${BRIDGE_BASE_URL}/google/login`,
  brainStats: (signal?: AbortSignal) =>
    request<{ backend: string; path: string; counts: Record<string, number> }>('/brain/stats', { signal }),

  /** Executes one allowlisted intent. Never throws: the outcome carries the user-facing reply. */
  async run(intent: ActionIntent): Promise<ActionOutcome> {
    if (!isActionIntent(intent)) {
      return { ok: false, reply: 'Questa azione non è nella lista di quelle consentite.', code: 'invalid_intent' }
    }
    try {
      const res = await request<BridgeActionResponse>('/actions', {
        method: 'POST',
        body: {
          action: intent.action,
          target: intent.target,
          ...('query' in intent && intent.query ? { query: intent.query } : {}),
        },
        timeoutMs: 20_000,
      })
      return { ok: true, reply: successReply(intent, res.detail) }
    } catch (err) {
      const e = err instanceof BridgeError ? err : new BridgeError(String(err), null)
      return { ok: false, reply: failureReply(e), code: e.code ?? 'failed' }
    }
  },
}

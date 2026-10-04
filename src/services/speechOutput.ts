import type { SpeechProvider } from '../types/speech'

/**
 * Text-to-speech abstraction. Two implementations: the OpenJarvis
 * /v1/speech/synthesize endpoint (when the backend reports a TTS engine)
 * and the browser's speechSynthesis as fallback. Swapping providers later
 * only touches this file.
 */
export interface SpeechOutput {
  readonly provider: SpeechProvider
  /** Resolves when playback finishes, rejects on failure. Cancels any ongoing speech first. */
  speak(text: string, lang?: string): Promise<void>
  /** Interrupts the current playback, if any. */
  stop(): void
  readonly speaking: boolean
}

/* ---------------- Browser fallback ---------------- */

const VOICE_STORAGE_KEY = 'jarvis.voice'

/** Name of the voice the user picked, or null for automatic. */
export function getPreferredVoice(): string | null {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setPreferredVoice(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(VOICE_STORAGE_KEY, name)
    else window.localStorage.removeItem(VOICE_STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
}

/** Voices usable for the given language (Italian first), for a picker. */
export function listVoices(lang = 'it-IT'): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  const base = lang.split('-')[0].toLowerCase()
  const all = window.speechSynthesis.getVoices()
  const same = all.filter((v) => v.lang.toLowerCase().startsWith(base))
  const others = all.filter((v) => !v.lang.toLowerCase().startsWith(base) && /^en/i.test(v.lang))
  return [...same, ...others]
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return null
  const preferred = getPreferredVoice()
  if (preferred) {
    const chosen = voices.find((v) => v.name === preferred)
    if (chosen) return chosen
  }
  const base = lang.split('-')[0].toLowerCase()
  const exact = voices.filter((v) => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase())
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  // Prefer non-remote natural voices when several match, then any match, then null (default voice).
  const pool = exact.length ? exact : sameLang
  if (pool.length === 0) return null
  return pool.find((v) => /natural|neural|online/i.test(v.name)) ?? pool.find((v) => v.localService) ?? pool[0]
}

export function createBrowserSpeechOutput(): SpeechOutput | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const synth = window.speechSynthesis
  // Some browsers populate voices asynchronously; trigger the load early.
  synth.getVoices()
  synth.addEventListener?.('voiceschanged', () => synth.getVoices())

  let current: SpeechSynthesisUtterance | null = null

  return {
    provider: 'browser',
    get speaking() {
      return synth.speaking
    },
    stop() {
      current = null
      synth.cancel()
    },
    speak(text, lang = 'it-IT') {
      synth.cancel()
      // Chrome stops any utterance longer than ~15 s and resumes it much later (known
      // bug). Speaking sentence by sentence, with a resume() keep-alive, avoids it.
      const chunks = splitForSpeech(text, 140)
      const voice = pickVoice(lang)
      return new Promise<void>((resolve, reject) => {
        let index = 0
        let keepAlive: number | undefined
        const stopKeepAlive = () => window.clearInterval(keepAlive)
        const next = () => {
          if (index >= chunks.length) {
            stopKeepAlive()
            current = null
            resolve()
            return
          }
          const utter = new SpeechSynthesisUtterance(chunks[index++])
          utter.lang = lang
          if (voice) utter.voice = voice
          utter.rate = 1
          utter.pitch = 1
          utter.volume = 1
          utter.onend = () => {
            if (current !== utter) return // stopped meanwhile
            next()
          }
          utter.onerror = (e) => {
            stopKeepAlive()
            if (current === utter) current = null
            // "interrupted"/"canceled" are user-driven stops, not failures.
            if (e.error === 'interrupted' || e.error === 'canceled') resolve()
            else reject(new Error(`speech synthesis failed: ${e.error}`))
          }
          current = utter
          synth.speak(utter)
        }
        keepAlive = window.setInterval(() => {
          if (synth.paused) synth.resume()
        }, 5000)
        next()
      })
    },
  }
}

/* ---------------- OpenJarvis backend ---------------- */

/** Kokoro voice ids are stored as "kokoro:<id>"; browser voices as their plain name. */
export const KOKORO_PREFIX = 'kokoro:'

export function getPreferredKokoroVoice(): string | null {
  const pref = getPreferredVoice()
  return pref?.startsWith(KOKORO_PREFIX) ? pref.slice(KOKORO_PREFIX.length) : null
}

/** Curated Kokoro voices worth offering (Italian first, then the "Jarvis" British timbres). */
export const KOKORO_VOICES: { id: string; label: string }[] = [
  { id: 'im_nicola', label: 'Nicola · italiano, maschile' },
  { id: 'if_sara', label: 'Sara · italiano, femminile' },
  { id: 'bm_george', label: 'George · inglese britannico, profondo' },
  { id: 'bm_lewis', label: 'Lewis · inglese britannico' },
  { id: 'bm_daniel', label: 'Daniel · inglese britannico' },
  { id: 'bm_fable', label: 'Fable · inglese britannico' },
  { id: 'bf_emma', label: 'Emma · inglese britannico, femminile' },
]

/**
 * Splits text into speakable chunks (sentences, merged up to ~160 chars) so the
 * first chunk can play while the next ones are still being synthesised.
 */
export function splitForSpeech(text: string, maxChars = 160): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;:…])\s+(?=[^\s])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const p of parts) {
    if (current && current.length + p.length + 1 > maxChars) {
      chunks.push(current)
      current = p
    } else {
      current = current ? `${current} ${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [text.trim()]
}

export function createOpenJarvisSpeechOutput(
  synthesize: (text: string) => Promise<Blob>,
): SpeechOutput {
  let audio: HTMLAudioElement | null = null
  let generation = 0

  const playBlob = (wav: Blob): Promise<void> => {
    const url = URL.createObjectURL(wav)
    const el = new Audio(url)
    audio = el
    return new Promise<void>((resolve, reject) => {
      el.onended = () => {
        URL.revokeObjectURL(url)
        if (audio === el) audio = null
        resolve()
      }
      el.onerror = () => {
        URL.revokeObjectURL(url)
        if (audio === el) audio = null
        reject(new Error('audio playback failed'))
      }
      el.play().catch(reject)
    })
  }

  return {
    provider: 'openjarvis',
    get speaking() {
      return !!audio && !audio.paused && !audio.ended
    },
    stop() {
      generation += 1
      if (audio) {
        audio.pause()
        URL.revokeObjectURL(audio.src)
        audio = null
      }
    },
    async speak(text) {
      this.stop()
      const mine = generation
      const chunks = splitForSpeech(text)
      // Pipeline: synthesise chunk i+1 while chunk i is playing.
      let next: Promise<Blob> = synthesize(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        const wav = await next
        if (generation !== mine) return
        if (i + 1 < chunks.length) next = synthesize(chunks[i + 1])
        await playBlob(wav)
        if (generation !== mine) return
      }
    },
  }
}

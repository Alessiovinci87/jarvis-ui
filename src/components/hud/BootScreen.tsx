import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { openJarvisApi } from '../../services/openJarvisApi'
import {
  KOKORO_PREFIX,
  KOKORO_VOICES,
  createBrowserSpeechOutput,
  createOpenJarvisSpeechOutput,
  getPreferredVoice,
  listVoices,
  setPreferredVoice,
  splitForSpeech,
} from '../../services/speechOutput'
import { cachedSynthesize, prewarm } from '../../services/ttsCache'
import { CAPABILITY_SUMMARY, STARTUP_GREETING } from '../../data/capabilities'
import { introThemeAvailable } from '../../services/introTheme'
import { getPreferredMic, listMics, setPreferredMic, type MicOption } from '../../services/micDevice'
import type { TtsHealthResponse } from '../../types/speech'

const MUSIC_STORAGE_KEY = 'jarvis.startup.music'
const SUMMARY_STORAGE_KEY = 'jarvis.startup.summary'
const BRIEFING_STORAGE_KEY = 'jarvis.startup.briefing'
const PREVIEW_TEXT = 'Ciao Alessio, sono Jarvis. Questa è la mia voce.'

export interface BootChoices {
  music: boolean
  summary: boolean
  /** Spoken briefing from the second brain (reminders, tasks, weather) after the greeting. */
  briefing: boolean
}

interface BootScreenProps {
  /** Backend reachable (the greeting can be spoken either way; actions need the bridge). */
  online: boolean
  bridgeReady: boolean
  onStart: (choices: BootChoices) => void
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/**
 * Shown once per page load. Browsers only allow speech synthesis and audio after a
 * user gesture, so the startup routine (theme track + spoken greeting) starts from
 * this click. It is also where the voice is chosen: Kokoro voices (local neural
 * TTS served by OpenJarvis) when available, otherwise the browser's own voices.
 */
export function BootScreen({ online, bridgeReady, onStart }: BootScreenProps) {
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>(() => listVoices())
  const [tts, setTts] = useState<TtsHealthResponse | null>(null)
  const [voice, setVoice] = useState<string>(() => getPreferredVoice() ?? '')
  const [music, setMusic] = useState(() => readFlag(MUSIC_STORAGE_KEY, true))
  // Local theme file present? (public/intro/theme.mp3). Null while checking.
  const [themeReady, setThemeReady] = useState<boolean | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void introThemeAvailable(controller.signal).then((ok) => !controller.signal.aborted && setThemeReady(ok))
    return () => controller.abort()
  }, [])
  const [summary, setSummary] = useState(() => readFlag(SUMMARY_STORAGE_KEY, true))
  const [briefing, setBriefing] = useState(() => readFlag(BRIEFING_STORAGE_KEY, true))
  // Microphone: explicit choice, so Bluetooth earbuds becoming Windows' default do not silence Jarvis.
  const [mics, setMics] = useState<MicOption[]>([])
  const [mic, setMic] = useState<string>(() => getPreferredMic())
  useEffect(() => {
    let alive = true
    void listMics().then((list) => alive && setMics(list))
    const onChange = () => void listMics().then((list) => alive && setMics(list))
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => {
      alive = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
    }
  }, [])
  const chooseMic = (id: string) => {
    setMic(id)
    setPreferredMic(id)
  }
  const [previewing, setPreviewing] = useState(false)

  // Voices load asynchronously in Chrome/Edge.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const refresh = () => setBrowserVoices(listVoices())
    refresh()
    window.speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh)
  }, [])

  // Backend TTS (Kokoro) availability.
  useEffect(() => {
    if (!online) return
    const controller = new AbortController()
    openJarvisApi
      .ttsHealth(controller.signal)
      .then((h) => !controller.signal.aborted && setTts(h))
      .catch(() => !controller.signal.aborted && setTts({ available: false }))
    return () => controller.abort()
  }, [online])

  const ttsNow = online ? tts : null
  const kokoro = !!ttsNow?.available && (ttsNow.backend ?? '').toLowerCase().includes('kokoro')

  // Pre-render the greeting (and summary) with the selected voice while the user is here,
  // so the startup line plays instantly after the click.
  useEffect(() => {
    if (!kokoro) return
    const voice_id = voice.startsWith(KOKORO_PREFIX) ? voice.slice(KOKORO_PREFIX.length) : ''
    const key = voice_id || ttsNow?.voice_id || ''
    const texts = [...splitForSpeech(STARTUP_GREETING), ...splitForSpeech(`${STARTUP_GREETING} ${CAPABILITY_SUMMARY}`)]
    prewarm(key, Array.from(new Set(texts)), (text) =>
      openJarvisApi.synthesize(voice_id ? { text, voice_id } : { text }),
    )
  }, [kokoro, voice, ttsNow?.voice_id])

  const chooseVoice = (name: string) => {
    setVoice(name)
    setPreferredVoice(name || null)
  }

  const preview = async () => {
    if (previewing) return
    setPreviewing(true)
    try {
      if (kokoro && (voice.startsWith(KOKORO_PREFIX) || !voice)) {
        const voice_id = voice.startsWith(KOKORO_PREFIX) ? voice.slice(KOKORO_PREFIX.length) : ''
        const out = createOpenJarvisSpeechOutput((text) =>
          cachedSynthesize(voice_id || ttsNow?.voice_id || '', text, (t) =>
            openJarvisApi.synthesize(voice_id ? { text: t, voice_id } : { text: t }),
          ),
        )
        await out.speak(PREVIEW_TEXT)
      } else {
        await createBrowserSpeechOutput()?.speak(PREVIEW_TEXT, 'it-IT')
      }
    } catch {
      /* preview is best effort */
    } finally {
      setPreviewing(false)
    }
  }

  const start = () => {
    writeFlag(MUSIC_STORAGE_KEY, music)
    writeFlag(SUMMARY_STORAGE_KEY, summary)
    writeFlag(BRIEFING_STORAGE_KEY, briefing)
    onStart({ music: music && themeReady === true, summary, briefing: briefing && bridgeReady })
  }

  const voiceLabel = kokoro
    ? `Kokoro locale · predefinita ${ttsNow?.voice_id ?? 'im_nicola'}`
    : ttsNow?.available
      ? `Backend (${ttsNow.backend ?? 'tts'})`
      : 'Voce del browser'

  return (
    <motion.div
      className="boot"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      role="dialog"
      aria-label="Avvio di Jarvis"
    >
      <div className="boot__panel">
        <h1 className="boot__title">JARVIS</h1>
        <p className="boot__subtitle">LOCAL INTELLIGENCE SYSTEM</p>

        <dl className="boot__status">
          <div>
            <dt>BACKEND</dt>
            <dd className={online ? 'boot__ok' : 'boot__warn'}>{online ? 'ONLINE' : 'OFFLINE'}</dd>
          </div>
          <div>
            <dt>BRIDGE</dt>
            <dd className={bridgeReady ? 'boot__ok' : 'boot__warn'}>{bridgeReady ? 'READY' : 'OFFLINE'}</dd>
          </div>
          <div>
            <dt>TTS</dt>
            <dd className={kokoro ? 'boot__ok' : 'boot__warn'}>{kokoro ? 'KOKORO' : ttsNow?.available ? 'BACKEND' : 'BROWSER'}</dd>
          </div>
        </dl>

        <label className="boot__field">
          <span>MIC</span>
          <select value={mic} onChange={(e) => chooseMic(e.target.value)} aria-label="Microfono" title="Quale microfono usa Jarvis (non segue il predefinito di Windows)">
            <option value="">Predefinito di Windows</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="boot__field">
          <span>VOCE</span>
          <select value={voice} onChange={(e) => chooseVoice(e.target.value)} aria-label="Voce di Jarvis" title={voiceLabel}>
            <option value="">{kokoro ? 'Kokoro · voce predefinita del backend' : 'Automatica (browser, italiano)'}</option>
            {kokoro && (
              <optgroup label="Kokoro · locale, qualità alta">
                {KOKORO_VOICES.map((v) => (
                  <option key={v.id} value={`${KOKORO_PREFIX}${v.id}`}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Browser / Windows">
              {browserVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} · {v.lang}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="button" className="boot__link" onClick={() => void preview()} disabled={previewing}>
            {previewing ? '…' : 'ascolta'}
          </button>
        </label>

        <label className="boot__check">
          <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} disabled={themeReady === false} />
          <span>
            Sigla all’avvio, dal file locale, a basso volume
            {themeReady === false ? ' (manca public/intro/theme.mp3)' : ''}
          </span>
        </label>
        <label className="boot__check">
          <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} />
          <span>Riepilogo delle funzionalità dopo il saluto</span>
        </label>
        <label className="boot__check">
          <input type="checkbox" checked={briefing} onChange={(e) => setBriefing(e.target.checked)} disabled={!bridgeReady} />
          <span>Briefing della giornata: promemoria, cose da fare, meteo{bridgeReady ? '' : ' (bridge offline)'}</span>
        </label>

        <button type="button" className="boot__start" onClick={start} autoFocus>
          AVVIA JARVIS
        </button>
      </div>
    </motion.div>
  )
}

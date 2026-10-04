import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioRecorder, RecorderError, isRecordingSupported } from '../services/audioRecorder'
import { openJarvisApi } from '../services/openJarvisApi'
import {
  createBrowserSpeechOutput,
  createOpenJarvisSpeechOutput,
  getPreferredKokoroVoice,
  type SpeechOutput,
} from '../services/speechOutput'
import {
  chooseWakeWordProvider,
  createWakeWordProvider,
  type WakeWordProvider,
  type WakeWordProviderKind,
} from '../services/wakeWordProvider'
import { cachedSynthesize } from '../services/ttsCache'
import { blobToWav } from '../services/wavEncoder'
import type { ActivityEvent, AiPhase, NodeId } from '../types/ai'
import type { ConversationMessage } from '../types/chat'
import { actionBridge } from '../services/actionBridge'
import type { SpeechProvider, TranscribeResponse, TtsHealthResponse, VoiceState } from '../types/speech'

const MAX_EVENTS = 8
const ERROR_SETTLE_MS = 2500
const LANGUAGE = 'it'
const TTS_LANG = 'it-IT'
const WAKE_STORAGE_KEY = 'jarvis.wakeWord'

/** Internal machine; the public VoiceState also folds in the conversation phase. */
type OwnState = 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'WAITING' | 'SPEAKING' | 'ERROR'

interface UseVoiceOptions {
  /** Backend reachable. */
  online: boolean
  /** Called with the recognised text; the caller sends it through the chat path. */
  onTranscript: (text: string) => void
  /** Current phase of the real conversation (REASONING / RESPONSE / ERROR / IDLE). */
  conversationPhase: AiPhase
  /** A chat request is in flight (used to interrupt speech on new requests). */
  busy: boolean
}

export interface VoiceController {
  state: VoiceState
  /** Phase to impose on the neural sphere, or null when the conversation/demo should drive it. */
  phaseOverride: AiPhase | null
  /** MediaRecorder + getUserMedia available in this browser. */
  supported: boolean
  /** Backend STT reachable (null = not checked yet). */
  sttAvailable: boolean | null
  ttsProvider: SpeechProvider
  /** Live microphone level 0..1 while listening. */
  level: number
  events: ActivityEvent[]
  /** Mic button handler: start / stop / cancel / interrupt depending on state. */
  toggle: () => void
  /** Escape: abandon the current recording or transcription. */
  cancel: () => void
  /** Wire to useConversation({ onReply }): speaks the reply of a voice-initiated turn. */
  onReply: (message: ConversationMessage) => void
  /** Hands-free "Jarvis" activation. */
  wakeWord: {
    supported: boolean
    enabled: boolean
    /** Currently listening for the wake word. */
    armed: boolean
    /** Engine in use: 'local' (offline model in the bridge), 'browser' (online recogniser) or null. */
    provider: WakeWordProviderKind | null
    /** True when wake-word audio never leaves this machine. */
    offline: boolean
    toggle: () => void
  }
}

function readWakePreference(): boolean {
  try {
    return window.localStorage.getItem(WAKE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function describeRecorderError(err: unknown): string {
  if (err instanceof RecorderError) {
    switch (err.code) {
      case 'permission-denied':
        return 'microphone permission denied'
      case 'no-microphone':
        return 'no microphone found'
      case 'device-busy':
        return 'microphone busy'
      case 'unsupported':
        return 'audio recording not supported'
      default:
        return `microphone error: ${err.message}`
    }
  }
  return err instanceof Error ? err.message : String(err)
}

export function useVoice({ online, onTranscript, conversationPhase, busy }: UseVoiceOptions): VoiceController {
  const supported = useMemo(() => isRecordingSupported(), [])
  const [own, setOwn] = useState<OwnState>('IDLE')
  const [level, setLevel] = useState(0)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null)
  const [ttsProvider, setTtsProvider] = useState<SpeechProvider>('none')
  // Which wake-word engine exists: probed at mount (local bridge first, browser fallback).
  const [wakeProvider, setWakeProvider] = useState<WakeWordProviderKind | null>(null)
  const [wakeProbed, setWakeProbed] = useState(false)
  const wakeSupported = wakeProvider !== null
  const [wakeEnabled, setWakeEnabled] = useState<boolean>(() => readWakePreference())
  const wake = useRef<WakeWordProvider | null>(null)
  const startListeningRef = useRef<() => void>(() => undefined)

  const recorder = useRef<AudioRecorder | null>(null)
  const transcribeAbort = useRef<AbortController | null>(null)
  const output = useRef<SpeechOutput | null>(null)
  const errorTimer = useRef<number | undefined>(undefined)
  const nextId = useRef(1)
  const voiceTurn = useRef(false)
  /** True while a reply is being spoken; proactive lines arriving meanwhile wait in `speechQueue`. */
  const speakingNow = useRef(false)
  const speechQueue = useRef<ConversationMessage[]>([])
  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const pushEvent = useCallback((message: string, node: NodeId | null = 'VOICE') => {
    setEvents((prev) =>
      [{ id: nextId.current++, timestamp: Date.now(), message, node }, ...prev].slice(0, MAX_EVENTS),
    )
  }, [])

  const fail = useCallback(
    (message: string) => {
      pushEvent(message, 'SYSTEM')
      setOwn('ERROR')
      voiceTurn.current = false
      window.clearTimeout(errorTimer.current)
      errorTimer.current = window.setTimeout(() => setOwn((s) => (s === 'ERROR' ? 'IDLE' : s)), ERROR_SETTLE_MS)
    },
    [pushEvent],
  )

  /* ---- backend capabilities: checked when the backend comes online ---- */
  useEffect(() => {
    if (!online) return
    const controller = new AbortController()
    void (async () => {
      try {
        const [stt, tts] = await Promise.all([
          openJarvisApi.speechHealth(controller.signal),
          openJarvisApi.ttsHealth(controller.signal).catch((): TtsHealthResponse => ({ available: false })),
        ])
        if (controller.signal.aborted) return
        setSttAvailable(stt.available)
        if (tts.available) {
          // The Kokoro voice picked in the boot screen (if any) overrides the backend default.
          output.current = createOpenJarvisSpeechOutput((text) => {
            const voice_id = getPreferredKokoroVoice()
            return cachedSynthesize(voice_id ?? tts.voice_id ?? '', text, (t) =>
              openJarvisApi.synthesize(voice_id ? { text: t, voice_id } : { text: t }),
            )
          })
          setTtsProvider('openjarvis')
        } else {
          output.current = createBrowserSpeechOutput()
          setTtsProvider(output.current ? 'browser' : 'none')
        }
      } catch {
        if (controller.signal.aborted) return
        setSttAvailable(false)
        output.current = createBrowserSpeechOutput()
        setTtsProvider(output.current ? 'browser' : 'none')
      }
    })()
    return () => controller.abort()
  }, [online])

  /* ---- recording → transcription ---- */
  const transcribe = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      if (blob.size === 0 || durationMs < 300) {
        pushEvent('no audio captured')
        setOwn('IDLE')
        return
      }
      setOwn('TRANSCRIBING')
      pushEvent('transcribing', 'REASONING')
      const controller = new AbortController()
      transcribeAbort.current = controller
      try {
        // Whisper reads the format from the extension: WAV is the safest, raw blob is the fallback.
        let upload = blob
        let filename = 'speech.wav'
        try {
          upload = await blobToWav(blob)
        } catch {
          const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
          filename = `speech.${ext}`
        }
        if (controller.signal.aborted) return
        // Prefer the bridge's STT (vocabulary-primed Whisper); OpenJarvis is the fallback.
        let result: TranscribeResponse
        try {
          result = await actionBridge.transcribe(upload, filename, LANGUAGE, controller.signal)
          pushEvent('stt: bridge (vocabulary)', 'REASONING')
        } catch (err) {
          if (controller.signal.aborted) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          result = await openJarvisApi.transcribe(upload, filename, LANGUAGE, controller.signal)
          pushEvent('stt: openjarvis', 'REASONING')
        }
        if (controller.signal.aborted) return
        const text = result.text.trim()
        if (!text) {
          pushEvent('no speech detected')
          setOwn('IDLE')
          return
        }
        pushEvent(`heard: ${text.length > 42 ? `${text.slice(0, 42)}…` : text}`)
        voiceTurn.current = true
        setOwn('WAITING')
        onTranscriptRef.current(text)
      } catch (err) {
        if (controller.signal.aborted) return
        fail(`transcription failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        if (transcribeAbort.current === controller) transcribeAbort.current = null
      }
    },
    [fail, pushEvent],
  )

  const stopListening = useCallback(async () => {
    const rec = recorder.current
    if (!rec) return
    recorder.current = null
    setLevel(0)
    const result = await rec.stop()
    await transcribe(result.blob, result.mimeType, result.durationMs)
  }, [transcribe])

  const startListening = useCallback(async () => {
    if (!supported) {
      fail('audio recording not supported in this browser')
      return
    }
    if (!online || sttAvailable === false) {
      fail(online ? 'speech backend unavailable' : 'backend offline: voice disabled')
      return
    }
    output.current?.stop()
    const rec = new AudioRecorder({
      onLevel: (l) => setLevel(l),
      onAutoStop: () => pushEvent('end of speech detected'),
    })
    try {
      await rec.start()
    } catch (err) {
      fail(describeRecorderError(err))
      return
    }
    recorder.current = rec
    setOwn('LISTENING')
    pushEvent('listening')
    // When silence detection (or the input track ending) stops the recorder, continue with transcription.
    const poll = window.setInterval(() => {
      if (recorder.current !== rec) {
        window.clearInterval(poll)
        return
      }
      if (!rec.active) {
        window.clearInterval(poll)
        void stopListening()
      }
    }, 120)
  }, [supported, online, sttAvailable, fail, pushEvent, stopListening])

  useEffect(() => {
    startListeningRef.current = () => void startListening()
  }, [startListening])

  /* ---- wake word engine selection: offline bridge model first, browser recogniser as fallback ---- */
  useEffect(() => {
    const controller = new AbortController()
    void chooseWakeWordProvider(controller.signal).then((choice) => {
      if (controller.signal.aborted) return
      setWakeProvider(choice.kind)
      setWakeProbed(true)
      pushEvent(choice.kind ? `wake word engine: ${choice.kind} (${choice.reason})` : choice.reason, choice.kind ? 'VOICE' : 'SYSTEM')
    })
    return () => controller.abort()
  }, [pushEvent])

  /* ---- wake word: arm while idle, pause while recording / thinking / speaking ---- */
  useEffect(() => {
    if (!wakeEnabled || !wakeProbed || !wakeProvider) {
      wake.current?.stop()
      wake.current = null
      return
    }
    const provider = createWakeWordProvider(wakeProvider, {
      onWake: () => {
        pushEvent('wake word detected')
        startListeningRef.current()
      },
      onError: (msg) => pushEvent(msg, 'SYSTEM'),
      onUnavailable: (reason) => {
        pushEvent(reason, 'SYSTEM')
        if (wakeProvider === 'local') {
          // Degrade to the browser recogniser when it exists, otherwise switch off.
          void chooseWakeWordProvider().then((choice) => {
            const next = choice.kind === 'local' ? null : choice.kind
            setWakeProvider(next)
            if (!next) setWakeEnabled(false)
          })
        } else {
          setWakeEnabled(false)
        }
      },
    })
    wake.current = provider
    provider.start()
    return () => {
      provider.stop()
      if (wake.current === provider) wake.current = null
    }
  }, [wakeEnabled, wakeProbed, wakeProvider, pushEvent])

  useEffect(() => {
    const provider = wake.current
    if (!provider || !wakeEnabled) return
    if (own === 'IDLE' || own === 'ERROR') provider.resume()
    else provider.pause()
  }, [own, wakeEnabled])

  /** Listening for the wake word only while nothing else uses the voice pipeline. */
  const wakeArmed = wakeEnabled && wakeSupported && (own === 'IDLE' || own === 'ERROR')

  const toggleWake = useCallback(() => {
    setWakeEnabled((v) => {
      const next = !v
      try {
        window.localStorage.setItem(WAKE_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }, [])

  const cancel = useCallback(() => {
    if (recorder.current) {
      recorder.current.cancel()
      recorder.current = null
      setLevel(0)
      pushEvent('recording cancelled')
      setOwn('IDLE')
      return
    }
    if (transcribeAbort.current) {
      transcribeAbort.current.abort()
      transcribeAbort.current = null
      pushEvent('transcription cancelled')
      setOwn('IDLE')
    }
  }, [pushEvent])

  const toggle = useCallback(() => {
    switch (own) {
      case 'LISTENING':
        void stopListening()
        return
      case 'TRANSCRIBING':
        cancel()
        return
      case 'SPEAKING':
        output.current?.stop()
        voiceTurn.current = false
        setOwn('IDLE')
        return
      case 'WAITING':
        // A request is running; nothing to toggle yet.
        return
      default:
        void startListening()
    }
  }, [own, stopListening, cancel, startListening])

  /* ---- speak the reply of a voice-initiated turn (called by useConversation) ---- */
  const onReply = useCallback(
    (message: ConversationMessage) => {
      if (message.role !== 'assistant') return
      if (!voiceTurn.current && !message.proactive) return
      if (message.proactive) voiceTurn.current = true
      if (message.status === 'error') {
        voiceTurn.current = false
        setOwn('IDLE')
        return
      }
      if (message.status !== 'done') return
      const speaker = output.current
      if (!speaker) {
        pushEvent('voice output unavailable', 'SYSTEM')
        voiceTurn.current = false
        setOwn('IDLE')
        return
      }
      // Proactive lines (greeting, briefing, reminders) never cut each other off: they queue.
      // A reply to a new request still interrupts (see the `busy` effect below).
      if (message.proactive && speakingNow.current) {
        speechQueue.current.push(message)
        return
      }
      speakingNow.current = true
      setOwn('SPEAKING')
      pushEvent('speaking')
      speaker
        .speak(message.content, TTS_LANG)
        .catch((err: unknown) =>
          pushEvent(`voice output failed: ${err instanceof Error ? err.message : String(err)}`, 'SYSTEM'),
        )
        .finally(() => {
          speakingNow.current = false
          const next = speechQueue.current.shift()
          if (next) {
            onReplyRef.current?.(next)
            return
          }
          voiceTurn.current = false
          setOwn((s) => (s === 'SPEAKING' ? 'IDLE' : s))
        })
    },
    [pushEvent],
  )
  const onReplyRef = useRef<typeof onReply | null>(null)
  useEffect(() => {
    onReplyRef.current = onReply
  }, [onReply])

  /* ---- a new request interrupts any ongoing speech ---- */
  useEffect(() => {
    if (busy && output.current?.speaking) {
      speechQueue.current = []
      output.current.stop()
    }
  }, [busy])

  /* ---- cleanup ---- */
  useEffect(
    () => () => {
      recorder.current?.cancel()
      transcribeAbort.current?.abort()
      output.current?.stop()
      window.clearTimeout(errorTimer.current)
    },
    [],
  )

  /* ---- derived public state ---- */
  const state: VoiceState = useMemo(() => {
    if (own === 'WAITING') {
      if (conversationPhase === 'REASONING') return 'REASONING'
      if (conversationPhase === 'RESPONSE') return 'RESPONSE'
      if (conversationPhase === 'ERROR') return 'ERROR'
      return 'REASONING'
    }
    return own
  }, [own, conversationPhase])

  const phaseOverride: AiPhase | null =
    own === 'LISTENING' || own === 'TRANSCRIBING' || own === 'SPEAKING' ? own : own === 'ERROR' ? 'ERROR' : null

  return {
    state,
    phaseOverride,
    supported,
    sttAvailable: online ? sttAvailable : null,
    ttsProvider,
    level,
    events,
    toggle,
    cancel,
    onReply,
    wakeWord: {
      supported: wakeSupported,
      enabled: wakeEnabled,
      armed: wakeArmed,
      provider: wakeProvider,
      offline: wakeProvider === 'local',
      toggle: toggleWake,
    },
  }
}

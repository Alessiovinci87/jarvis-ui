import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CoreFallback } from './components/ai/CoreFallback'
import { JarvisScene } from './components/ai/JarvisScene'
import { ActivityPanel } from './components/hud/ActivityPanel'
import { BootScreen, type BootChoices } from './components/hud/BootScreen'
import {
  CAPABILITY_SUMMARY,
  STARTUP_GREETING,
  STARTUP_TRACK_FADE,
  STARTUP_TRACK_SECONDS,
  STARTUP_TRACK_VOLUME,
} from './data/capabilities'
import { actionBridge } from './services/actionBridge'
import { playIntroTheme } from './services/introTheme'
import { Background } from './components/hud/Background'
import { CommandBar } from './components/hud/CommandBar'
import { ConversationLog } from './components/hud/ConversationLog'
import { TopStatus } from './components/hud/TopStatus'
import { BrainPanel } from './components/hud/BrainPanel'
import { BrainDrawer } from './components/hud/BrainDrawer'
import { useBridgeEvents, type BridgeTimerEvent } from './hooks/useBridgeEvents'
import { useConversation } from './hooks/useConversation'
import { useMemory } from './hooks/useMemory'
import { useOpenJarvisStatus } from './hooks/useOpenJarvisStatus'
import { useSimulatedActivity } from './hooks/useSimulatedActivity'
import { useVoice } from './hooks/useVoice'
import { useWebGLSupport } from './hooks/useWebGLSupport'
import { PHASE_NODES, type ActivityEvent, type NodeId } from './types/ai'
import type { BridgeLastAction } from './types/actions'
import { BRAIN_CHANGED_EVENT, type BrainToday, type BridgeReminderEvent } from './types/brain'
import type { ConversationMessage } from './types/chat'

const FALLBACK_MODEL = 'qwen3.5:2b'
const MAX_EVENTS = 8
/** How long the recognised text is previewed in the command bar before it is sent. */
const TRANSCRIPT_PREVIEW_MS = 700

function App() {
  const webgl = useWebGLSupport()
  const backend = useOpenJarvisStatus()
  const online = backend.status === 'online'
  const model = backend.info?.model ?? backend.models[0]?.id ?? FALLBACK_MODEL

  // The voice controller is created after the conversation, so replies are routed through a ref.
  const replyRef = useRef<(m: ConversationMessage) => void>(() => undefined)
  const onReply = useCallback((m: ConversationMessage) => replyRef.current(m), [])
  // Local action bridge: health (+ last executed action) and the second brain's agenda.
  const [bridgeReady, setBridgeReady] = useState(false)
  const [lastAction, setLastAction] = useState<BridgeLastAction | null>(null)
  const [today, setToday] = useState<BrainToday | null>(null)
  const memory = useMemory({ bridgeReady })
  // Drawer with everything Jarvis knows (notes, reminders, lists, Google state). Toggle: button or Ctrl+M.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const refreshToday = useCallback(() => {
    void actionBridge.brainToday().then(setToday).catch(() => undefined)
    void memory.refresh()
  }, [memory])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        setDrawerOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Anything stored by the brain (reminder, note, list…) shows up in the HUD immediately.
  useEffect(() => {
    const onChanged = () => refreshToday()
    window.addEventListener(BRAIN_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(BRAIN_CHANGED_EVENT, onChanged)
  }, [refreshToday])
  const conversation = useConversation({ model, online, onReply, memory })
  const [input, setInput] = useState('')

  // Always call the latest `send` from timers without re-creating callbacks.
  const sendRef = useRef(conversation.send)
  useEffect(() => {
    sendRef.current = conversation.send
  }, [conversation.send])
  const previewTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(previewTimer.current), [])

  const handleTranscript = useCallback((text: string) => {
    setInput(text)
    window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => {
      setInput('')
      sendRef.current(text)
    }, TRANSCRIPT_PREVIEW_MS)
  }, [])

  const voice = useVoice({
    online,
    onTranscript: handleTranscript,
    conversationPhase: conversation.activity.phase,
    busy: conversation.busy,
  })
  useEffect(() => {
    replyRef.current = voice.onReply
  }, [voice.onReply])

  // Proactive lines (startup greeting, timers) go through the latest `announce`.
  const announceRef = useRef(conversation.announce)
  useEffect(() => {
    announceRef.current = conversation.announce
  }, [conversation.announce])

  // Startup routine: gated behind a click (browser autoplay/speech policy).
  const [booted, setBooted] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const probe = () =>
      actionBridge
        .health(controller.signal)
        .then((h) => {
          if (controller.signal.aborted) return
          setBridgeReady(true)
          setLastAction(h.last_action ?? null)
          return actionBridge.brainToday(controller.signal).then((t) => !controller.signal.aborted && setToday(t))
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setBridgeReady(false)
          setToday(null)
        })
    void probe()
    const timer = window.setInterval(probe, 10_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  const handleBoot = useCallback(
    (choices: BootChoices) => {
      setBooted(true)
      const greeting = choices.summary ? `${STARTUP_GREETING} ${CAPABILITY_SUMMARY}` : STARTUP_GREETING
      const run = async () => {
        if (choices.music) {
          // Quiet local theme (public/intro/theme.mp3) played by the browser: Spotify and
          // anything else already playing are never touched. Fades out by itself.
          const started = await playIntroTheme(STARTUP_TRACK_SECONDS, STARTUP_TRACK_VOLUME / 100, STARTUP_TRACK_FADE)
          if (started) await new Promise((r) => window.setTimeout(r, 1200))
        }
        announceRef.current(greeting, 'VOICE')
        // Briefing from the second brain: spoken only when there is something on the agenda.
        // Read-only: nothing on the PC is touched. The weather call is the only network access.
        if (choices.briefing) {
          try {
            const brief = await actionBridge.brainSummary(true)
            if (brief.has_content) {
              await new Promise((r) => window.setTimeout(r, 2500))
              announceRef.current(brief.reply, 'MEMORY')
            }
          } catch {
            /* bridge gone meanwhile: no briefing */
          }
        }
      }
      void run()
    },
    [],
  )

  // Timers / alarms set through the bridge fire here: Jarvis announces them aloud.
  useBridgeEvents({
    onTimer: useCallback((ev: BridgeTimerEvent) => {
      announceRef.current(ev.kind === 'alarm' ? `Alessio, è ora: ${ev.label}.` : `Alessio, il ${ev.label} è scaduto.`)
    }, []),
    // Reminders from the second brain: spoken here, and shown as a Windows toast by the bridge.
    onReminder: useCallback((ev: BridgeReminderEvent) => {
      announceRef.current(`Alessio, promemoria: ${ev.text}.`, 'MEMORY')
      void actionBridge.brainToday().then(setToday).catch(() => undefined)
    }, []),
  })

  // Priority: voice pipeline → real conversation → demo loop.
  const realActive = conversation.live || voice.phaseOverride !== null
  const simulated = useSimulatedActivity(realActive)
  const phase = voice.phaseOverride ?? (conversation.live ? conversation.activity.phase : simulated.phase)
  const activeNodes = useMemo<ReadonlySet<NodeId>>(() => {
    if (voice.phaseOverride) return new Set(PHASE_NODES[voice.phaseOverride])
    return conversation.live ? conversation.activity.activeNodes : simulated.activeNodes
  }, [voice.phaseOverride, conversation.live, conversation.activity.activeNodes, simulated.activeNodes])

  // One activity feed: voice, chat and demo events interleaved by time.
  const events = useMemo<ActivityEvent[]>(() => {
    const merged = [
      ...voice.events.map((e) => ({ ...e, id: e.id * 3 + 2 })),
      ...conversation.activity.events.map((e) => ({ ...e, id: e.id * 3 + 1 })),
      ...simulated.events.map((e) => ({ ...e, id: e.id * 3 })),
    ]
    merged.sort((a, b) => b.timestamp - a.timestamp)
    return merged.slice(0, MAX_EVENTS)
  }, [voice.events, conversation.activity.events, simulated.events])

  return (
    <main className="app">
      <Background />
      {!booted && <BootScreen online={online} bridgeReady={bridgeReady} onStart={handleBoot} />}

      {webgl ? (
        <JarvisScene phase={phase} activeNodes={activeNodes} voiceLevel={voice.state === 'LISTENING' ? voice.level : 0} />
      ) : (
        <CoreFallback activeNodes={activeNodes} />
      )}

      <TopStatus
        phase={phase}
        backend={backend}
        voiceState={voice.state}
        micSupported={voice.supported}
        wakeArmed={voice.wakeWord.enabled && voice.wakeWord.armed}
        wakeProvider={voice.wakeWord.provider}
        bridgeReady={bridgeReady}
        lastAction={lastAction}
      />
      <ConversationLog messages={conversation.messages} />
      <ActivityPanel
        events={events}
        footer={
          <BrainPanel
            memory={memory.status}
            today={today}
            active={phase === 'MEMORY' || phase === 'MEMORY_STORE' || phase === 'REASONING'}
            onOpen={() => setDrawerOpen(true)}
          />
        }
      />
      <BrainDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} bridgeReady={bridgeReady} today={today} onChanged={refreshToday} />
      <CommandBar
        value={input}
        onChange={setInput}
        onSend={conversation.send}
        busy={conversation.busy}
        online={online}
        voiceState={voice.state}
        micSupported={voice.supported}
        sttAvailable={voice.sttAvailable}
        level={voice.level}
        onMicToggle={voice.toggle}
        onMicCancel={voice.cancel}
        wakeWord={voice.wakeWord}
      />
    </main>
  )
}

export default App

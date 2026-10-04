import { motion } from 'framer-motion'
import { PHASE_LABEL, type AiPhase } from '../../types/ai'
import type { OpenJarvisStatus } from '../../types/openjarvis'
import type { VoiceState } from '../../types/speech'
import type { WakeWordProviderKind } from '../../services/wakeWordProvider'
import type { BridgeLastAction } from '../../types/actions'

interface TopStatusProps {
  phase: AiPhase
  backend: OpenJarvisStatus
  voiceState: VoiceState
  micSupported: boolean
  /** Wake word currently armed (listening for "Jarvis"). */
  wakeArmed: boolean
  /** Which wake-word engine is in use; shown so the user knows whether audio stays local. */
  wakeProvider: WakeWordProviderKind | null
  /** Local action bridge reachable. */
  bridgeReady: boolean
  /** Last action the bridge executed (audit log), if any. */
  lastAction: BridgeLastAction | null
  /** 'MUTO?' / 'BASSO' after a silent recording. */
  micWarning?: string | null
  /** Chat served by the bridge (Ollama direct, streamed) rather than OpenJarvis. */
  bridgeChat?: boolean
}

const fade = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: 'easeOut' as const },
}

const STATUS_LABEL: Record<OpenJarvisStatus['status'], string> = {
  checking: 'CHECKING',
  online: 'ONLINE',
  offline: 'OFFLINE',
}

const WAKE_MODE: Record<WakeWordProviderKind, string> = { local: 'LOCAL', browser: 'ONLINE' }

function micLabel(state: VoiceState, supported: boolean, wakeArmed: boolean, provider: WakeWordProviderKind | null): string {
  if (!supported) return 'N/A'
  switch (state) {
    case 'LISTENING':
      return 'LISTENING'
    case 'TRANSCRIBING':
      return 'TRANSCRIBING'
    case 'SPEAKING':
      return 'SPEAKING'
    default:
      return wakeArmed && provider ? `WAKE·${WAKE_MODE[provider]}` : 'OFF'
  }
}

export function TopStatus({ phase, backend, voiceState, micSupported, wakeArmed, wakeProvider, bridgeReady, lastAction, micWarning = null, bridgeChat = false }: TopStatusProps) {
  const online = backend.status === 'online'
  const model = backend.info?.model ?? backend.models[0]?.id ?? 'LOCAL'
  const dotClass = `status__dot status__dot--${backend.status}`
  const micActive = voiceState === 'LISTENING' || voiceState === 'TRANSCRIBING' || voiceState === 'SPEAKING'

  return (
    <>
      <motion.header className="hud hud--top-left" {...fade}>
        <h1 className="hud__title">JARVIS</h1>
        <p className="hud__subtitle">LOCAL INTELLIGENCE SYSTEM</p>
      </motion.header>

      <motion.aside
        className="hud hud--top-right"
        {...fade}
        transition={{ ...fade.transition, delay: 0.15 }}
        title={backend.error ?? undefined}
      >
        <dl className="status">
          <div className="status__row">
            <dt>SYSTEM</dt>
            <dd>
              <span className={dotClass} /> {STATUS_LABEL[backend.status]}
            </dd>
          </div>
          <div className="status__row">
            <dt>MODEL</dt>
            <dd className="status__value" title={model}>
              {online ? model : 'LOCAL'}
            </dd>
          </div>
          <div className="status__row">
            <dt>BACKEND</dt>
            <dd title={bridgeChat ? 'Conversazione via bridge: Ollama in diretta, risposta in streaming' : undefined}>
              {bridgeChat ? 'BRIDGE·OLLAMA' : online ? (backend.info?.engine ?? 'ok').toUpperCase() : 'DEMO'}
            </dd>
          </div>
          <div className="status__row">
            <dt>AGENTS</dt>
            <dd>{online ? backend.agents.length : '--'}</dd>
          </div>
          <div className="status__row">
            <dt>MIC</dt>
            <dd
              className={micActive ? 'status__live' : undefined}
              title={wakeProvider === 'local' ? 'Wake word: offline model, audio stays on this PC' : wakeProvider === 'browser' ? 'Wake word: browser recogniser (may use online services)' : undefined}
            >
              {micWarning && !micActive ? <span className="status__warn" title="L'ultima registrazione non conteneva segnale: controlla microfono (mute, dispositivo) nel BootScreen o in Windows">{micWarning}</span> : micLabel(voiceState, micSupported, wakeArmed, wakeProvider)}
            </dd>
          </div>
          <div className="status__row">
            <dt>CORE</dt>
            <dd>{PHASE_LABEL[phase]}</dd>
          </div>
          <div className="status__row">
            <dt>BRIDGE</dt>
            <dd>
              <span className={`status__dot status__dot--${bridgeReady ? 'online' : 'offline'}`} /> {bridgeReady ? 'ONLINE' : 'OFFLINE'}
            </dd>
          </div>
          <div className="status__row">
            <dt>LAST</dt>
            <dd
              className="status__value"
              title={lastAction ? `${new Date(lastAction.ts).toLocaleString()} — ${lastAction.result ?? ''}` : 'Nessuna azione eseguita dal bridge in questa sessione'}
            >
              {bridgeReady ? (lastAction?.label ?? 'NONE') : '--'}
            </dd>
          </div>
        </dl>
      </motion.aside>
    </>
  )
}

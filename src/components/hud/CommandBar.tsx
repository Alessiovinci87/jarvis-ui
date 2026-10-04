import type { KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import type { VoiceState } from '../../types/speech'

interface CommandBarProps {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  /** A request is in flight. */
  busy: boolean
  /** Backend reachable; input is disabled otherwise. */
  online: boolean
  voiceState: VoiceState
  /** Browser can record audio at all. */
  micSupported: boolean
  /** Backend speech-to-text reachable (null = unknown yet). */
  sttAvailable: boolean | null
  /** Live input level 0..1 while listening. */
  level: number
  onMicToggle: () => void
  onMicCancel: () => void
  wakeWord: { supported: boolean; enabled: boolean; armed: boolean; offline: boolean; toggle: () => void }
}

const VOICE_HINT: Partial<Record<VoiceState, string>> = {
  LISTENING: 'LISTENING...',
  TRANSCRIBING: 'TRANSCRIBING...',
  SPEAKING: 'SPEAKING...',
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  )
}

export function CommandBar({
  value,
  onChange,
  onSend,
  busy,
  online,
  voiceState,
  micSupported,
  sttAvailable,
  level,
  onMicToggle,
  onMicCancel,
  wakeWord,
}: CommandBarProps) {
  const voiceActive = voiceState === 'LISTENING' || voiceState === 'TRANSCRIBING'
  const disabled = busy || !online || voiceActive
  const canSend = !disabled && value.trim().length > 0
  const micEnabled = micSupported && online && sttAvailable !== false && !busy

  const submit = () => {
    if (!canSend) return
    onSend(value)
    onChange('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && voiceActive) {
      e.preventDefault()
      onMicCancel()
    }
  }

  const hint = busy
    ? 'PROCESSING'
    : (VOICE_HINT[voiceState] ?? (online ? 'ENTER TO SEND' : 'BACKEND OFFLINE'))
  const hintActive = busy || voiceState in VOICE_HINT

  const micTitle = !micSupported
    ? 'Audio recording not supported in this browser'
    : !online
      ? 'Backend offline'
      : sttAvailable === false
        ? 'Speech recognition unavailable on the backend'
        : voiceState === 'LISTENING'
          ? 'Stop and transcribe (Esc to cancel)'
          : voiceState === 'TRANSCRIBING'
            ? 'Cancel transcription'
            : voiceState === 'SPEAKING'
              ? 'Stop speaking'
              : 'Speak to Jarvis'

  const micClass = [
    'command__mic',
    voiceState === 'LISTENING' && 'command__mic--listening',
    voiceState === 'TRANSCRIBING' && 'command__mic--transcribing',
    voiceState === 'SPEAKING' && 'command__mic--speaking',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <motion.form
      className="hud hud--bottom"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.45 }}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className={busy || voiceActive ? 'command command--busy' : 'command'}>
        <span className="command__prompt" aria-hidden="true">
          &gt;
        </span>
        <textarea
          className="command__input"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={voiceState === 'LISTENING' ? 'Listening...' : 'Ask Jarvis...'}
          disabled={disabled}
          aria-label="Ask Jarvis"
          aria-busy={busy}
          autoComplete="off"
          spellCheck={false}
        />
        <span className={hintActive ? 'command__hint command__hint--busy' : 'command__hint'}>{hint}</span>
        <button
          type="button"
          className={[
            'command__wake',
            wakeWord.enabled && 'command__wake--on',
            wakeWord.enabled && wakeWord.armed && 'command__wake--armed',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={wakeWord.toggle}
          disabled={!wakeWord.supported}
          aria-pressed={wakeWord.enabled}
          title={
            !wakeWord.supported
              ? 'Wake word not supported in this browser'
              : wakeWord.enabled
                ? `Wake word on (${wakeWord.offline ? 'offline' : 'online'}): say "${wakeWord.offline ? 'Hey Jarvis' : 'Jarvis'}" to talk (click to disable)`
                : `Enable wake word: say "${wakeWord.offline ? 'Hey Jarvis' : 'Jarvis'}" to talk`
          }
        >
          WAKE
        </button>
        <button
          type="button"
          className={micClass}
          onClick={onMicToggle}
          disabled={!micEnabled && voiceState === 'IDLE'}
          aria-pressed={voiceState === 'LISTENING'}
          aria-label={micTitle}
          title={micTitle}
          style={{ ['--level' as string]: level.toFixed(3) }}
        >
          <MicIcon />
        </button>
      </label>
    </motion.form>
  )
}

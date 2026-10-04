import { motion } from 'framer-motion'
import type { BrainToday } from '../../types/brain'
import type { MemoryStatus } from '../../types/memory'

interface BrainPanelProps {
  memory: MemoryStatus
  /** True while a request is retrieving or storing memory. */
  active: boolean
  /** Snapshot from the bridge's second brain (null while offline). */
  today: BrainToday | null
  /** Opens the drawer with everything Jarvis knows. */
  onOpen: () => void
}

function dueLabel(due: string | null): string {
  if (!due) return 'senza orario'
  const d = new Date(due)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `oggi ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `domani ${time}`
  return `${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

/**
 * MEMORY + OGGI readout under the activity feed: how many facts/notes Jarvis
 * keeps, matches for the current request, and the next reminder due.
 */
export function BrainPanel({ memory, active, today, onOpen }: BrainPanelProps) {
  let value: string
  if (memory.status === 'unavailable') value = 'OFFLINE'
  else if (memory.status === 'unknown') value = '--'
  else if (active && memory.lastMatches !== null) value = `${memory.lastMatches} MATCH${memory.lastMatches === 1 ? '' : 'ES'}`
  else if (memory.entries !== null) value = `${memory.entries} ITEM${memory.entries === 1 ? '' : 'S'}`
  else value = 'READY'

  const next = today?.next ?? null
  const overdue = today?.overdue.length ?? 0
  const reminders = today?.counts.reminder ?? 0
  const lists = today?.lists ?? []

  return (
    <motion.section
      className="memory"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.5 }}
      title={memory.detail ?? (memory.backend ? `memoria locale: ${memory.backend}` : undefined)}
      aria-label="Memory and agenda"
    >
      <h2 className="hud__label">MEMORY</h2>
      <p className={active ? 'memory__value memory__value--active' : 'memory__value'}>{value}</p>

      <h2 className="hud__label brain__label">OGGI</h2>
      {today ? (
        <dl className="brain">
          <div className="brain__row">
            <dt>NEXT</dt>
            <dd className="brain__next" title={next ? `${next.text} · ${dueLabel(next.due)}` : undefined}>
              {next ? (
                <>
                  <span className="brain__when">{dueLabel(next.due)}</span> {next.text}
                </>
              ) : (
                'nessun promemoria'
              )}
            </dd>
          </div>
          <div className="brain__row">
            <dt>TODO</dt>
            <dd>
              {reminders}
              {overdue > 0 && <span className="brain__overdue"> · {overdue} in sospeso</span>}
            </dd>
          </div>
          <div className="brain__row">
            <dt>LISTE</dt>
            <dd title={lists.map((l) => `${l.name} (${l.count})`).join(', ') || undefined}>
              {lists.length ? lists.slice(0, 2).map((l) => `${l.name} ${l.count}`).join(' · ') : '--'}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="memory__value">--</p>
      )}
      <button type="button" className="memory__open" onClick={onOpen} title="Apri la memoria di Jarvis (Ctrl+M)">
        ESPLORA ▸
      </button>
    </motion.section>
  )
}

import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { ActivityEvent } from '../../types/ai'

interface ActivityPanelProps {
  events: ActivityEvent[]
  /** Optional compact block rendered under the feed (e.g. MEMORY readout). */
  footer?: ReactNode
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function ActivityPanel({ events, footer }: ActivityPanelProps) {
  return (
    <motion.aside
      className="hud hud--right"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
      aria-live="polite"
    >
      <div className="panel">
        <h2 className="hud__label">ACTIVITY</h2>
        <ul className="activity">
          <AnimatePresence initial={false}>
            {events.map((e, i) => (
              <motion.li
                key={e.id}
                className={i === 0 ? 'activity__item activity__item--latest' : 'activity__item'}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1 - i * 0.1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              >
                <span className="activity__time">{formatTime(e.timestamp)}</span>
                <span className="activity__text">&gt; {e.message}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {footer}
      </div>
    </motion.aside>
  )
}

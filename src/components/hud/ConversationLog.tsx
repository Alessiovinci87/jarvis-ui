import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ConversationMessage } from '../../types/chat'

interface ConversationLogProps {
  messages: ConversationMessage[]
}

/** Only the latest turns are kept in the DOM; the panel scrolls if needed. */
const VISIBLE_LIMIT = 12

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function ConversationLog({ messages }: ConversationLogProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const visible = messages.slice(-VISIBLE_LIMIT)
  const last = visible[visible.length - 1]

  // Keep the newest line in view whenever content changes.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last?.id, last?.status, last?.content])

  if (visible.length === 0) return null

  return (
    <motion.section
      className="hud hud--left"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      aria-label="Conversation"
      aria-live="polite"
    >
      <div className="panel panel--log" ref={scroller}>
        <ol className="log">
          <AnimatePresence initial={false}>
            {visible.map((m) => (
              <motion.li
                key={m.id}
                className={`log__entry log__entry--${m.role}${m.status ? ` log__entry--${m.status}` : ''}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
              >
                <div className="log__head">
                  <span className="log__role">{m.role === 'user' ? 'USER' : 'JARVIS'}</span>
                  <span className="log__time">{formatTime(m.timestamp)}</span>
                </div>
                <p className="log__text">
                  <span className="log__caret" aria-hidden="true">
                    &gt;{' '}
                  </span>
                  {m.status === 'pending' ? (
                    <span className="log__pending" aria-label="waiting for response">
                      ...
                    </span>
                  ) : (
                    m.content
                  )}
                </p>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </motion.section>
  )
}

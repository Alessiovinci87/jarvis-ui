import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { actionBridge } from '../../services/actionBridge'
import type { BrainItem, BrainToday, GoogleStatus } from '../../types/brain'

type Tab = 'today' | 'reminder' | 'note' | 'fact' | 'list' | 'google'

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'OGGI' },
  { id: 'reminder', label: 'PROMEMORIA' },
  { id: 'note', label: 'NOTE' },
  { id: 'fact', label: 'RICORDI' },
  { id: 'list', label: 'LISTE' },
  { id: 'google', label: 'GOOGLE' },
]

interface BrainDrawerProps {
  open: boolean
  onClose: () => void
  bridgeReady: boolean
  today: BrainToday | null
  /** Something was edited or deleted: the caller refreshes the HUD snapshot. */
  onChanged: () => void
}

function fmtDue(due: string | null): string {
  if (!due) return 'senza orario'
  const d = new Date(due)
  return d.toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtCreated(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Local datetime → value for <input type="datetime-local"> */
function toLocalInput(due: string | null): string {
  return due ? due.slice(0, 16) : ''
}

/**
 * Everything Jarvis knows, browsable and editable: reminders, notes, facts,
 * lists, plus the Google (calendar/mail) connection state. Edits go through the
 * bridge and its audit log; nothing here runs an action on the PC.
 */
export function BrainDrawer({ open, onClose, bridgeReady, today, onChanged }: BrainDrawerProps) {
  const [tab, setTab] = useState<Tab>('today')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<BrainItem[]>([])
  const [lists, setLists] = useState<{ name: string; count: number }[]>([])
  const [includeDone, setIncludeDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const [editing, setEditing] = useState<{ id: number; text: string; due: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const kind = tab === 'today' || tab === 'google' ? null : tab

  const load = useCallback(async () => {
    if (!open || !bridgeReady) return
    setError(null)
    if (tab === 'google') {
      try {
        setGoogle(await actionBridge.googleStatus())
      } catch {
        setGoogle(null)
      }
      return
    }
    if (!kind) return
    setLoading(true)
    try {
      const res = await actionBridge.brainItems(kind, { q: query.trim() || undefined, includeDone })
      setItems(res.items)
      setLists(res.lists)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [open, bridgeReady, tab, kind, query, includeDone])

  // Debounced reload on tab / search changes.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200)
    return () => window.clearTimeout(t)
  }, [load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    window.setTimeout(() => searchRef.current?.focus(), 50)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const changed = useCallback(() => {
    onChanged()
    void load()
  }, [onChanged, load])

  const remove = async (id: number) => {
    try {
      await actionBridge.brainDelete(id)
      setConfirmDelete(null)
      changed()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleDone = async (item: BrainItem) => {
    try {
      await actionBridge.brainPatch(item.id, { done: !item.done })
      changed()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const item = items.find((i) => i.id === editing.id)
    try {
      await actionBridge.brainPatch(editing.id, {
        text: editing.text.trim() || undefined,
        ...(item?.kind === 'reminder' ? (editing.due ? { due: editing.due } : { clear_due: true }) : {}),
      })
      setEditing(null)
      changed()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const grouped = useMemo(() => {
    if (kind !== 'list') return null
    const map = new Map<string, BrainItem[]>()
    for (const it of items) {
      const name = it.list_name ?? 'altro'
      map.set(name, [...(map.get(name) ?? []), it])
    }
    return [...map.entries()]
  }, [kind, items])

  const renderItem = (item: BrainItem) => {
    const isEditing = editing?.id === item.id
    return (
      <li key={item.id} className={`brainlist__item${item.done ? ' brainlist__item--done' : ''}${item.fired && !item.done ? ' brainlist__item--overdue' : ''}`}>
        {isEditing ? (
          <div className="brainlist__edit">
            <input
              className="brainlist__input"
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveEdit()
                if (e.key === 'Escape') setEditing(null)
              }}
              autoFocus
            />
            {item.kind === 'reminder' && (
              <input
                className="brainlist__input brainlist__input--when"
                type="datetime-local"
                value={editing.due}
                onChange={(e) => setEditing({ ...editing, due: e.target.value })}
              />
            )}
            <button type="button" className="brainlist__btn" onClick={() => void saveEdit()}>salva</button>
            <button type="button" className="brainlist__btn" onClick={() => setEditing(null)}>annulla</button>
          </div>
        ) : (
          <>
            {(item.kind === 'reminder' || item.kind === 'list') && (
              <input type="checkbox" className="brainlist__check" checked={!!item.done} onChange={() => void toggleDone(item)} title={item.done ? 'riapri' : 'segna come fatto'} />
            )}
            <div className="brainlist__body">
              <span className="brainlist__text">{item.text}</span>
              <span className="brainlist__meta">
                {item.kind === 'reminder' ? fmtDue(item.due) : fmtCreated(item.created)}
                {item.fired && !item.done ? ' · in sospeso' : ''}
              </span>
            </div>
            <div className="brainlist__actions">
              <button type="button" className="brainlist__btn" onClick={() => setEditing({ id: item.id, text: item.text, due: toLocalInput(item.due) })} title="modifica">✎</button>
              {confirmDelete === item.id ? (
                <>
                  <button type="button" className="brainlist__btn brainlist__btn--danger" onClick={() => void remove(item.id)}>elimina</button>
                  <button type="button" className="brainlist__btn" onClick={() => setConfirmDelete(null)}>no</button>
                </>
              ) : (
                <button type="button" className="brainlist__btn" onClick={() => setConfirmDelete(item.id)} title="elimina">✕</button>
              )}
            </div>
          </>
        )}
      </li>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="drawer"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          role="dialog"
          aria-label="Memoria di Jarvis"
        >
          <header className="drawer__head">
            <h2 className="hud__label drawer__title">MEMORIA DI JARVIS</h2>
            <button type="button" className="brainlist__btn" onClick={onClose} title="chiudi (Esc)">✕</button>
          </header>

          <nav className="drawer__tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`drawer__tab${tab === t.id ? ' drawer__tab--on' : ''}`} onClick={() => { setTab(t.id); setQuery(''); setEditing(null) }}>
                {t.label}
                {t.id !== 'today' && t.id !== 'google' && today ? <span className="drawer__count">{today.counts[t.id]}</span> : null}
              </button>
            ))}
          </nav>

          {!bridgeReady && <p className="drawer__hint">Bridge offline: la memoria non è raggiungibile.</p>}

          {kind && (
            <div className="drawer__tools">
              <input ref={searchRef} className="brainlist__input" placeholder="cerca…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {(kind === 'reminder' || kind === 'list') && (
                <label className="drawer__toggle">
                  <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} /> fatti
                </label>
              )}
            </div>
          )}

          {error && <p className="drawer__hint drawer__hint--error">{error}</p>}

          <div className="drawer__body">
            {tab === 'today' && (
              today ? (
                <div className="drawer__today">
                  <h3 className="hud__label">PROSSIMI 7 GIORNI</h3>
                  {today.upcoming.length ? (
                    <ul className="brainlist">{today.upcoming.map(renderItem)}</ul>
                  ) : (
                    <p className="drawer__hint">Nessun promemoria in programma. Dimmi: «ricordami domani alle 9 di…»</p>
                  )}
                  <h3 className="hud__label">NOTE RECENTI</h3>
                  {today.notes_recent.length ? <ul className="brainlist">{today.notes_recent.map(renderItem)}</ul> : <p className="drawer__hint">Nessuna nota nelle ultime 24 ore.</p>}
                  <h3 className="hud__label">LISTE</h3>
                  {today.lists.length ? (
                    <p className="drawer__hint">{today.lists.map((l) => `${l.name} (${l.count})`).join(' · ')}</p>
                  ) : (
                    <p className="drawer__hint">Nessuna lista. Dimmi: «aggiungi il latte alla spesa».</p>
                  )}
                </div>
              ) : (
                <p className="drawer__hint">--</p>
              )
            )}

            {kind && kind !== 'list' && (
              loading && items.length === 0 ? <p className="drawer__hint">…</p> : items.length ? <ul className="brainlist">{items.map(renderItem)}</ul> : <p className="drawer__hint">Niente qui{query ? ' per questa ricerca' : ''}.</p>
            )}

            {kind === 'list' && grouped && (
              grouped.length ? (
                grouped.map(([name, its]) => (
                  <section key={name} className="drawer__group">
                    <h3 className="hud__label">{name.toUpperCase()} <span className="drawer__count">{lists.find((l) => l.name === name)?.count ?? its.length}</span></h3>
                    <ul className="brainlist">{its.map(renderItem)}</ul>
                  </section>
                ))
              ) : (
                <p className="drawer__hint">Nessuna lista{query ? ' per questa ricerca' : ''}.</p>
              )
            )}

            {tab === 'google' && (
              <div className="drawer__today">
                <h3 className="hud__label">CALENDARIO E MAIL (SOLA LETTURA)</h3>
                {!google ? (
                  <p className="drawer__hint">Stato non disponibile.</p>
                ) : !google.configured ? (
                  <>
                    <p className="drawer__hint">Non ancora configurato. Servono le credenziali OAuth di Google nel file <code>jarvis-bridge/.env</code>.</p>
                    <ol className="drawer__steps">
                      <li>console.cloud.google.com → nuovo progetto</li>
                      <li>Abilita Google Calendar API e Gmail API</li>
                      <li>Schermata consenso OAuth: External, aggiungi il tuo account come tester</li>
                      <li>Credenziali → ID client OAuth → tipo Desktop</li>
                      <li>Copia ID e secret in .env come GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET e riavvia il bridge</li>
                    </ol>
                    <p className="drawer__hint">Jarvis leggerà solo: eventi del giorno, mittenti e oggetti delle mail non lette. Mai il contenuto, mai invii.</p>
                  </>
                ) : !google.logged_in ? (
                  <>
                    <p className="drawer__hint">Credenziali presenti. Collega l'account per avere calendario e mail nel briefing.</p>
                    <a className="drawer__link" href={actionBridge.googleLoginUrl()} target="_blank" rel="noreferrer">Collega Google →</a>
                  </>
                ) : (
                  <p className="drawer__hint">Collegato{google.account ? ` come ${google.account}` : ''}. Calendario e mail entrano nel briefing del mattino.</p>
                )}
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { actionBridge } from '../services/actionBridge'
import type { MemoryHit, MemoryStatus } from '../types/memory'

/** Maximum memories injected into one request. */
const MAX_INJECTED = 3
/** Tokens shorter than this are ignored by the lexical relevance guard. */
const MIN_TOKEN_CHARS = 4
/** Stats refresh cadence while the bridge is up. */
const REFRESH_INTERVAL_MS = 30_000

interface UseMemoryOptions {
  /** Local action bridge reachable (the brain lives there). */
  bridgeReady: boolean
}

export interface MemoryController {
  status: MemoryStatus
  /** Persist an explicit memory. Resolves true when the bridge confirmed the write. */
  store: (content: string) => Promise<boolean>
  /** Search and filter relevant memories for a question. Never throws. */
  retrieve: (query: string) => Promise<MemoryHit[]>
  /** Re-read stats (entry count). */
  refresh: () => Promise<void>
}

const STOPWORDS = new Set([
  'come', 'cosa', 'dove', 'quando', 'quale', 'quali', 'quanto', 'quanta', 'quanti', 'perché', 'perche',
  'sono', 'sei', 'siamo', 'siete', 'essere', 'avere', 'hanno', 'questo', 'questa', 'questi', 'queste',
  'quello', 'quella', 'della', 'delle', 'dello', 'degli', 'nella', 'nelle', 'nello', 'sulla', 'sulle',
  'anche', 'ancora', 'allora', 'oppure', 'però', 'pero', 'mentre', 'dimmi', 'sai', 'jarvis', 'what',
  'which', 'where', 'when', 'that', 'this', 'with', 'from', 'have', 'does', 'about', 'tell', 'know',
])

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9àèéìòù]+/i)
      .filter((t) => t.length >= MIN_TOKEN_CHARS && !STOPWORDS.has(t)),
  )
}

/** Keep only hits that share vocabulary with the question (the bridge already ranked them). */
export function filterRelevant(query: string, hits: MemoryHit[]): MemoryHit[] {
  if (hits.length === 0) return []
  const q = tokens(query)
  if (q.size === 0) return []
  const kept = hits.filter((h) => {
    const c = tokens(h.content)
    for (const t of q) {
      for (const w of c) {
        if (w === t || (t.length >= 5 && w.startsWith(t.slice(0, 5)))) return true
      }
    }
    return false
  })
  return kept.slice(0, MAX_INJECTED)
}

/**
 * Personal memory, served by the bridge's second brain (SQLite + full-text search
 * on this PC). OpenJarvis is not involved: the hits are injected into the chat
 * prompt by the conversation hook.
 */
export function useMemory({ bridgeReady }: UseMemoryOptions): MemoryController {
  const [status, setStatus] = useState<MemoryStatus>({
    status: 'unknown',
    backend: null,
    entries: null,
    detail: null,
    lastMatches: null,
  })

  const refresh = useCallback(async () => {
    try {
      const stats = await actionBridge.brainStats()
      const entries = (stats.counts.fact ?? 0) + (stats.counts.note ?? 0)
      setStatus((s) => ({ ...s, status: 'available', backend: stats.backend, entries, detail: null }))
    } catch {
      setStatus((s) => ({ ...s, status: 'unavailable', entries: null, detail: 'bridge offline' }))
    }
  }, [])

  useEffect(() => {
    if (!bridgeReady) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [bridgeReady, refresh])

  const store = useCallback(
    async (content: string): Promise<boolean> => {
      try {
        const out = await actionBridge.brain(`ricordati che ${content}`, false)
        if (!out.handled || out.kind !== 'fact') return false
        void refresh()
        return true
      } catch (err) {
        setStatus((s) => ({ ...s, status: 'unavailable', detail: err instanceof Error ? err.message : String(err) }))
        return false
      }
    },
    [refresh],
  )

  const retrieve = useCallback(async (query: string): Promise<MemoryHit[]> => {
    try {
      const res = await actionBridge.brainRecall(query)
      const hits: MemoryHit[] = (res.results ?? []).map((r, i) => ({
        content: r.content,
        score: 1 - i * 0.1,
        metadata: { kind: r.kind, created: r.created, id: r.id },
      }))
      const relevant = filterRelevant(query, hits)
      setStatus((s) => ({ ...s, lastMatches: relevant.length }))
      return relevant
    } catch {
      // A failing search must never block the question.
      setStatus((s) => ({ ...s, lastMatches: null }))
      return []
    }
  }, [])

  // While the bridge is offline the readout is derived, not stored: nothing to reset later.
  const exposed: MemoryStatus = bridgeReady
    ? status
    : { ...status, status: 'unavailable', entries: null, lastMatches: null, detail: 'bridge offline' }

  return { status: exposed, store, retrieve, refresh }
}

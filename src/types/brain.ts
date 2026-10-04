/**
 * Jarvis' second brain (bridge `/brain*`): notes, facts, reminders, lists.
 * Everything is stored locally by the bridge in SQLite; nothing here touches OpenJarvis.
 */

export type BrainKind = 'note' | 'fact' | 'reminder' | 'list' | 'recall' | 'today' | 'forget' | 'none'

export interface BrainItem {
  id: number
  kind: 'note' | 'fact' | 'reminder' | 'list'
  text: string
  list_name: string | null
  /** ISO local datetime (minutes) for reminders, null when the task has no time. */
  due: string | null
  created: string
  done: number
  fired: number
  deleted: number
}

/** POST /brain → outcome. `handled:false` means the sentence is not for the brain. */
export interface BrainOutcome {
  handled: boolean
  kind: BrainKind
  op: string
  /** Spoken-friendly Italian reply (empty when not handled). */
  reply: string
  /** A destructive request waits for "sì"/"no" on the next turn. */
  needs_confirm: boolean
  /** Which parser decided: deterministic rules or the local model (extraction only). */
  source: 'rules' | 'model'
  item: BrainItem | null
  items: BrainItem[]
}

/** GET /brain/today */
export interface BrainToday {
  now: string
  counts: Record<'note' | 'fact' | 'reminder' | 'list', number>
  next: BrainItem | null
  upcoming: BrainItem[]
  overdue: BrainItem[]
  lists: { name: string; count: number }[]
  notes_recent: BrainItem[]
}

/** GET /brain/recall?q= */
export interface BrainRecallHit {
  content: string
  kind: 'fact' | 'note'
  created: string
  id: number
}

/** GET /brain/items */
export interface BrainItemsResponse {
  items: BrainItem[]
  lists: { name: string; count: number }[]
}

/** PATCH /brain/items/{id} body. */
export interface BrainItemPatch {
  text?: string
  /** ISO local datetime, e.g. "2026-10-05T09:00". */
  due?: string
  clear_due?: boolean
  done?: boolean
  list_name?: string
}

/** GET /google/status */
export interface GoogleStatus {
  configured: boolean
  logged_in: boolean
  scopes: string[]
  account: string | null
  token_file: string
  setup: string | null
}

/** SSE `reminder` event on the bridge's /events stream. */
export interface BridgeReminderEvent {
  type: 'reminder'
  id: number
  text: string
  due: string | null
}

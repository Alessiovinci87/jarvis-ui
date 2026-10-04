/**
 * Local desktop actions. The ids here mirror the bridge's `allowlist.json`:
 * the frontend can only *name* an (action, target) pair, the bridge decides
 * whether it exists and how it is launched. Nothing here is a shell command.
 *
 * `play_music` is the one action that carries free text (`query`): it is only
 * ever used as a Spotify search string, sanitised on both sides.
 */

export type ActionId =
  | 'open_app'
  | 'open_folder'
  | 'open_project'
  | 'play_music'
  | 'media'
  | 'web_search'
  | 'close_app'
  | 'timer'
  | 'weather'
  | 'find_file'

export type AppTarget = 'vscode' | 'spotify' | 'browser'
export type FolderTarget = 'downloads'
export type ProjectTarget = 'jarvis-ui' | 'openjarvis'
export type MusicTarget = 'spotify'
export type MediaTarget = 'play_pause' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute' | 'now_playing'

export type ActionIntent =
  | { action: 'open_app'; target: AppTarget }
  | { action: 'open_folder'; target: FolderTarget }
  | { action: 'open_project'; target: ProjectTarget }
  | { action: 'play_music'; target: MusicTarget; query: string }
  | { action: 'media'; target: MediaTarget }
  | { action: 'web_search'; target: 'browser'; query: string }
  | { action: 'close_app'; target: AppTarget }
  | { action: 'timer'; target: 'set'; query: string }
  | { action: 'timer'; target: 'cancel' | 'list' }
  | { action: 'weather'; target: 'forecast'; query?: string }
  | { action: 'find_file'; target: 'documents' | 'folders'; query: string }

/** Actions whose intent carries a free-text `query` (required unless listed in OPTIONAL_QUERY). */
export const QUERY_ACTIONS: readonly ActionId[] = ['play_music', 'web_search', 'timer', 'weather', 'find_file']
const OPTIONAL_QUERY: readonly string[] = ['weather', 'timer:cancel', 'timer:list']

/** Closed catalogue used for validation on the client before anything is sent. */
export const ACTION_TARGETS: Record<ActionId, readonly string[]> = {
  open_app: ['vscode', 'spotify', 'browser'],
  open_folder: ['downloads'],
  open_project: ['jarvis-ui', 'openjarvis'],
  play_music: ['spotify'],
  media: ['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute', 'now_playing'],
  web_search: ['browser'],
  close_app: ['vscode', 'spotify', 'browser'],
  timer: ['set', 'cancel', 'list'],
  weather: ['forecast'],
  find_file: ['documents', 'folders'],
}

/** Human labels for replies / HUD. */
export const TARGET_LABEL: Record<string, string> = {
  vscode: 'VS Code',
  spotify: 'Spotify',
  browser: 'il browser',
  downloads: 'la cartella Download',
  'jarvis-ui': 'Jarvis UI',
  openjarvis: 'OpenJarvis',
  play_pause: 'play/pausa',
  next: 'brano successivo',
  previous: 'brano precedente',
  volume_up: 'volume su',
  volume_down: 'volume giù',
  mute: 'muto',
  now_playing: 'cosa sta suonando',
  set: 'timer',
  cancel: 'annulla timer',
  list: 'timer attivi',
  forecast: 'meteo',
  documents: 'i tuoi documenti',
  folders: 'le tue cartelle',
}

/** Letters (incl. accents), digits, spaces and a few punctuation marks; max 80 chars. Shared by music and web search. */
export const MUSIC_QUERY_RE = /^[\p{L}\p{N} '’\-.,&!?:/]{1,80}$/u

export function sanitizeMusicQuery(raw: string): string | null {
  const q = raw.replace(/\s+/g, ' ').trim()
  return MUSIC_QUERY_RE.test(q) ? q : null
}

export function isActionIntent(value: unknown): value is ActionIntent {
  if (!value || typeof value !== 'object') return false
  const v = value as { action?: unknown; target?: unknown; query?: unknown }
  if (typeof v.action !== 'string' || typeof v.target !== 'string') return false
  const targets = ACTION_TARGETS[v.action as ActionId]
  if (!Array.isArray(targets) || !targets.includes(v.target)) return false
  if (QUERY_ACTIONS.includes(v.action as ActionId)) {
    const optional = OPTIONAL_QUERY.includes(v.action) || OPTIONAL_QUERY.includes(`${v.action}:${v.target}`)
    if (v.query === undefined) return optional
    return typeof v.query === 'string' && MUSIC_QUERY_RE.test(v.query)
  }
  return v.query === undefined
}

/** Result of running an intent through the bridge. */
export interface ActionOutcome {
  ok: boolean
  /** Short sentence for the user (spoken by TTS). */
  reply: string
  /** Machine-readable failure code from the bridge, if any. */
  code?: string
}

/** Bridge responses. */
export interface BridgeHealth {
  status: string
  wake: BridgeWakeStatus
  /** Last desktop action the bridge actually executed (from its audit log), if any. */
  last_action?: BridgeLastAction | null
}

export interface BridgeLastAction {
  ts: string
  /** e.g. `open_app/vscode` */
  label: string | null
  result: string | null
}

export interface BridgeWakeStatus {
  available: boolean
  running: boolean
  model: string
  threshold: number
  reason: string | null
  detections: number
  last_score: number
  last_detection: number | null
}

export interface BridgeActionResponse {
  ok: boolean
  action: ActionId
  target: string
  label: string
  detail: string
}

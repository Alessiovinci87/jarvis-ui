/**
 * Command router: turns user text (typed or transcribed) into structured,
 * allowlisted desktop intents — or decides it is ordinary chat.
 *
 * Layers, in order:
 *  1. `refused`  — hard deny-list for anything that smells like a shell command,
 *                  a filesystem path or a destructive operation. Never reaches
 *                  the model or the bridge.
 *  2. `action`   — deterministic rules (verb + known target lexicon, media
 *                  controls, "metti <canzone>"). No LLM.
 *     `sequence` — two to four deterministic steps joined by "e / poi / quindi".
 *  3. `maybe`    — an "open"-style verb was used but the target is unknown; the
 *                  caller may ask the model for a *structured* intent from the
 *                  closed list (see `parseModelIntent`) and must validate it.
 *  4. `none`     — plain conversation.
 *
 * The model never produces commands: at most it picks an (action, target) pair
 * that is re-validated against `ACTION_TARGETS` before anything is executed.
 */

import {
  ACTION_TARGETS,
  TARGET_LABEL,
  isActionIntent,
  sanitizeMusicQuery,
  type ActionId,
  type ActionIntent,
} from '../types/actions'

export type RoutedCommand =
  | { kind: 'action'; intent: ActionIntent; matched: string }
  /** Several deterministic steps in one sentence ("apri spotify e metti One degli U2"). */
  | { kind: 'sequence'; intents: ActionIntent[] }
  | { kind: 'maybe'; text: string }
  | { kind: 'refused'; reason: string; reply: string }
  /** A bare verb ("apri", "cerca"): ask what, instantly, instead of a 40 s model round-trip. */
  | { kind: 'clarify'; reply: string }
  | { kind: 'none' }

const LEADING_ADDRESS = /^\s*(?:ehi|hey|ok|okay|ciao|senti)?\s*jarvis\s*[,:!.]?\s*/i

/** Verbs that express "open / launch". Italian + English, incl. common STT variants. */
const OPEN_VERB =
  /\b(?:apri(?:mi|re|amo)?|avvia(?:mi|re)?|lancia(?:mi|re)?|esegui|fai\s+partire|open|launch|start|run)\b/i

/** "riproduci / metti / suona <qualcosa>" → play_music. The capture is the free-text query. */
const PLAY_VERB =
  /\b(?:riproduci(?:mi)?|metti(?:mi)?(?:\s+su)?|suona(?:mi)?|fai\s+(?:partire|sentire)|ascoltiamo|mettiamo|play)\b\s*(?:un\s+po['’]\s+(?:di\s+)?|la\s+canzone\s+|il\s+brano\s+|il\s+pezzo\s+|l['’]album\s+|la\s+playlist\s+|qualcosa\s+(?:di|degli|dei|delle|del|della)\s+|(?:gli|i|le|lo|la|il)\s+)?(.+)$/i

/** "cerca (su google / sul browser / online) <qualcosa>" → web_search. */
const SEARCH_VERB =
  /\b(?:cerca(?:mi)?|ricerca|googla|trova(?:mi)?|search(?:\s+for)?|google)\b\s*(?:su\s+(?:google|internet|web|chrome|edge)\s+|sul\s+(?:browser|web)\s+|online\s+|nel\s+browser\s+|in\s+rete\s+)?(.+)$/i
const SEARCH_TAIL = /\s+(?:su\s+(?:google|internet|web|chrome|edge)|sul\s+(?:browser|web)|online|nel\s+browser|in\s+rete)\s*$/i

/**
 * Any verb that asks the PC to *do* something. When one is present but no rule
 * matches, the text is a `maybe` (model fallback / clarification) rather than
 * chat — so the model is never put in a position to pretend it acted.
 */
const ACTION_VERB =
  /\b(?:apri|avvia|lancia|esegui|chiudi|cerca|trova|metti|riproduci|suona|manda|invia|scrivi|imposta|accendi|spegni|mostra|fammi\s+vedere|scarica|installa|crea|cancella|elimina|rinomina|sposta|copia|salva|stampa|ricorda|avvisa|sveglia|abbassa|alza|open|launch|close|search|play|send|set|show)(?:mi|melo|mela|meli|mele|lo|la|li|le|ci|gli)?\b/i

/** Just a verb, optionally with "mi"/"lo"/"la"/"il"/"un" and punctuation: no object to act on. */
const BARE_VERB =
  /^(?:apri|aprimi|avvia|lancia|esegui|chiudi|cerca|cercami|trova|trovami|metti|mettimi|riproduci|suona|open|launch|close|search|play|start|run)(?:\s+(?:mi|lo|la|il|un|una|the|a))?[\s.!?]*$/i

/** "chiudi spotify / vs code / il browser" → close_app. */
const CLOSE_VERB = /\b(?:chiudi(?:mi)?|close|quit|termina)\b/i

/** Timers and alarms. Capture = the duration / time expression. */
const TIMER_SET =
  /\b(?:(?:metti(?:mi)?|imposta(?:mi)?|avvia|fai\s+partire|set|start|un|il)\s+(?:un\s+|a\s+)?(?:timer|conto\s+alla\s+rovescia|cronometro)\s*(?:di|da|per|for)?\s*(.+)|(?:timer|sveglia|svegliami|alarm)\s+(.+)|(?:metti(?:mi)?|imposta(?:mi)?|set)\s+(?:una\s+|la\s+|an?\s+)?(?:sveglia|alarm)\s*(.+)|(?:ricorda(?:mi|melo)?|avvisami|avvertimi|chiamami|dimmi)\s+(?:tra|fra)\s+(.+))$/i
const TIMER_CANCEL = /\b(?:annulla|cancella|ferma|togli|stop|disattiva)\b.*\b(?:timer|sveglia|sveglie|conto\s+alla\s+rovescia)\b|\b(?:timer|sveglia)\b.*\b(?:annulla|cancella|ferma|togli)/i
const TIMER_LIST = /\b(?:quali|quanti|che)\s+timer\b|\btimer\s+(?:attivi|ho|ci\s+sono)|\bquanto\s+manca\b/i

/** Weather: "che tempo fa a Milano", "meteo domani", "pioverà domani a Roma?". Capture = rest. */
const WEATHER =
  /(?<!\p{L})(?:che\s+tempo\s+(?:fa|far[àa]|c[’']?è)|com[’']?è\s+il\s+tempo|meteo|previsioni(?:\s+del\s+tempo)?|piover[àa]|piove|nevica|weather|temperatura|quanti\s+gradi)(?!\p{L})\s*(.*)$/iu

/** File search: "trova il file preventivo", "cerca il documento fattura marzo", "dov'è il pdf del contratto". */
const FIND_FILE =
  /\b(?:trova(?:mi)?|cerca(?:mi)?|dov[’']?è|dove\s+(?:è|sta|ho\s+messo)|apri(?:mi)?|mostrami|search|find)(?:\s+e\s+(?:apri(?:mi)?|mostrami))?\s+(?:il\s+|lo\s+|la\s+|un\s+|una\s+|i\s+|le\s+)?(?:(?<folder>cartella|cartelle|folder|directory)|file|documento|documenti|pdf|foto|immagine|fattura|preventivo|contratto|excel|word)\b\s*(?:che\s+si\s+chiama\s+|chiamat[oa]\s+|di\s+nome\s+|di\s+|del\s+|della\s+|su\s+|con\s+)?(.+)$/i
/** "… sul mio pc / nel computer / qui" at the end of a file request adds nothing. */
const ON_PC_TAIL =
  /(?:\s*,)?\s+(?:che\s+(?:ho|sta|si\s+trova|c['’]è)\s+)?(?:(?:sul|nel|del|dal|sul\s+mio|nel\s+mio|del\s+mio|dal\s+mio)\s+(?:pc|computer|disco|hard\s+disk)|sul\s+desktop|qui|in\s+locale|(?:e\s+)?(?:che\s+)?si\s+trova\s+(?:nel|sul)\s+(?:mio\s+)?(?:pc|computer))\s*$/i
/** Follow-up phrasing: "la cartella si chiama Ale", "il file si chiama preventivo 2026". */
const NAMED_ITEM =
  /\b(?:(?<folder2>cartella|cartelle|folder|directory)|file|documento|pdf)\b\s+(?:che\s+)?(?:si\s+chiama|chiamat[oa]|di\s+nome|è|e['’]?)\s+(.+)$/i
/** The sentence talks about a folder/file: never a web search, even when "trova" appears. */
const FILE_NOUN = /\b(?:cartella|cartelle|folder|directory|file|documento|documenti|pdf)\b/i

/** Media controls, Italian + English. Order matters: more specific first. */
const MEDIA_RULES: { re: RegExp; intent: ActionIntent }[] = [
  {
    re: /\b(?:cosa|che)\s+(?:sto\s+ascoltando|(?:canzone|pezzo|brano)\s+è(?:\s+quest[ao])?|sta\s+suonando|c['’]è\s+in\s+riproduzione)|\bchi\s+(?:canta|è\s+questo)|\bwhat['’]?s\s+playing\b/i,
    intent: { action: 'media', target: 'now_playing' },
  },
  {
    // Bare "alza / abbassa" in a short line means the music volume.
    re: /\b(?:alza(?:lo|la)?|aumenta(?:lo|la)?|su\s+con)\b|\bvolume\s+(?:su|più\s+alto|up)\b|\bpiù\s+forte\b/i,
    intent: { action: 'media', target: 'volume_up' },
  },
  {
    re: /\b(?:abbassa(?:lo|la)?|diminuisci|riduci|giù\s+con)\b|\bvolume\s+(?:giù|più\s+basso|down)\b|\bpiù\s+piano\b|\btroppo\s+(?:alta|alto|forte)\b/i,
    intent: { action: 'media', target: 'volume_down' },
  },
  {
    re: /\b(?:muto|silenzia|togli\s+(?:il\s+)?(?:suono|audio|muto)|mute|unmute)\b/i,
    intent: { action: 'media', target: 'mute' },
  },
  {
    re: /\b(?:prossim[ao]|successiv[ao]|avanti|salta|skip|next|canzone\s+dopo|pezzo\s+dopo|cambia\s+(?:canzone|pezzo|brano))\b/i,
    intent: { action: 'media', target: 'next' },
  },
  {
    re: /\b(?:precedente|torna\s+indietro|indietro|previous|back)\b/i,
    intent: { action: 'media', target: 'previous' },
  },
  {
    re: /\b(?:pausa|metti\s+in\s+pausa|ferma(?:ti|la)?|stoppa|stop|basta(?:\s+(?:musica|così|cosi))?|riprendi|riparti|continua|resume|pause|play)\b/i,
    intent: { action: 'media', target: 'play_pause' },
  },
]

/** Words that just mean "music" without naming anything: resume rather than search. */
const GENERIC_MUSIC = /^(?:la\s+|un\s+po['’]\s+di\s+|della\s+|un\s+po['’]\s+di\s+)?(?:musica|qualcosa|spotify|una\s+canzone|qualcosa\s+di\s+bello|un\s+po['’]\s+di\s+musica)\.?$/i

/** Splits "apri spotify e poi metti One" into steps. */
const CONJUNCTION = /\s*(?:,\s*)?\b(?:e\s+poi|e\s+dopo|poi|quindi|dopodiché|e|and\s+then|and|then)\b\s+/i

/* ---------- deny-list: never executed, never sent to the model as a command ---------- */
const REFUSE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh\.exe|wsl)\b/i, reason: 'shell command' },
  // "del" is also an Italian preposition: only the DOS forms with switches/paths count.
  { re: /\b(?:remove-item|rm\s+-r|rm\s+-f|rmdir\b|del\s+\/[a-z]|del\s+[a-z]:|erase\s+\/|format\s+[a-z]:|diskpart)\b/i, reason: 'destructive command' },
  { re: /\b(?:shutdown|restart|riavvia|spegni|arresta|kill|taskkill|stop-process)\b/i, reason: 'system control command' },
  { re: /\b(?:install|installa|winget|choco|npm\s+i|pip\s+install|uv\s+add)\b/i, reason: 'install command' },
  { re: /\b(?:elimina|cancella|rimuovi|sovrascrivi|modifica)\b.*\b(?:file|cartella|directory|folder)\b/i, reason: 'file mutation' },
  { re: /(?:^|\s)[a-z]:[\\/]/i, reason: 'filesystem path' },
  { re: /(?:^|\s)(?:\\\\|~[\\/]|\.\.[\\/]|\/(?:etc|usr|home|c)\b)/i, reason: 'filesystem path' },
  { re: /[;|`$]{1,2}\s*\w|&&/, reason: 'shell syntax' },
]

/* ---------- deterministic target lexicon ---------- */
interface Lexeme {
  re: RegExp
  intent: ActionIntent
}

const LEXICON: Lexeme[] = [
  // Projects first: "vs code sul progetto X" must win over plain "vs code".
  {
    re: /\b(?:progetto|project|cartella|repo(?:sitory)?)?\s*(?:jarvis[\s-]?ui|jarvis\s+u\.?i\.?|ui\s+di\s+jarvis|interfaccia\s+jarvis)\b/i,
    intent: { action: 'open_project', target: 'jarvis-ui' },
  },
  {
    re: /\b(?:progetto|project|cartella|repo(?:sitory)?)?\s*(?:open[\s-]?jarvis|openjarvis|back[\s-]?end\s+(?:di\s+)?jarvis)\b/i,
    intent: { action: 'open_project', target: 'openjarvis' },
  },
  { re: /\b(?:visual\s+studio\s+code|vs\s*code|vscode|v\s*s\s*code|code\s+editor)\b/i, intent: { action: 'open_app', target: 'vscode' } },
  { re: /\bspotif[yi]\b/i, intent: { action: 'open_app', target: 'spotify' } },
  { re: /\b(?:browser|navigatore|chrome|edge|internet)\b/i, intent: { action: 'open_app', target: 'browser' } },
  { re: /\b(?:cartella\s+)?(?:download|downloads|scaricati)\b/i, intent: { action: 'open_folder', target: 'downloads' } },
]

/** Words that mean the sentence is a question or about something else, not a command. */
const NOT_A_COMMAND = /\?\s*$|\b(?:cos'?[èe]|come\s+(?:si|posso|faccio)|perch[ée]|quando|dove|chi|spiega|dimmi|cosa\s+[èe])\b/i

const MAX_COMMAND_WORDS = 14
const MAX_MEDIA_WORDS = 5

export function stripAddress(input: string): string {
  return input.replace(LEADING_ADDRESS, '').trim()
}

/** "puoi / potresti / mi puoi / vorrei / mi va di / ti va di / riusciresti a / per favore …" */
const POLITE_PREFIX =
  /^\s*(?:(?:mi\s+|ci\s+)?(?:puoi|potresti|riesci\s+a|riusciresti\s+a|ti\s+va\s+di|ti\s+andrebbe\s+di|vorrei(?:\s+che\s+tu)?|voglio|mi\s+va\s+di|ho\s+voglia\s+di|avrei\s+voglia\s+di|mi\s+piacerebbe|mi\s+serve|mi\s+servirebbe|fammi|facci|dai|per\s+favore|per\s+piacere|cortesemente|gentilmente|ora|adesso|allora)\s*,?\s*)+/i
const POLITE_SUFFIX = /\s*(?:,\s*)?(?:per\s+favore|per\s+piacere|per\s+cortesia|grazie|ti\s+prego|dai|ok)\s*[.!?]*\s*$/i
const INFINITIVES: [RegExp, string][] = [
  [/\baprir(?:e|mi|lo|la)\b/gi, 'apri'],
  [/\bchiuder(?:e|mi|lo|la)\b/gi, 'chiudi'],
  [/\b(?:ascoltar(?:e|mi)|sentir(?:e|mi)|sentire)\b/gi, 'metti'],
  [/\bmetter(?:e|mi|la|lo)\b/gi, 'metti'],
  [/\briprodurr?(?:e|mi)\b/gi, 'riproduci'],
  [/\bsuonar(?:e|mi)\b/gi, 'suona'],
  [/\bcercar(?:e|mi)\b/gi, 'cerca'],
  [/\btrovar(?:e|mi)\b/gi, 'trova'],
  [/\bimpostar(?:e|mi)\b/gi, 'imposta'],
  [/\bavviar(?:e|mi)\b/gi, 'avvia'],
  [/\blanciar(?:e|mi)\b/gi, 'lancia'],
  [/\bsapere\s+(?:che\s+tempo|il\s+meteo|com[’']?è\s+il\s+tempo)/gi, 'che tempo'],
]

/**
 * Turns a natural request into its imperative core so the deterministic rules apply:
 *   "potresti aprire VS Code sul progetto jarvis ui?" → "apri VS Code sul progetto jarvis ui"
 *   "vorrei ascoltare gli U2 su Spotify"               → "metti gli U2 su Spotify"
 */
export function normalizeRequest(input: string): string {
  let t = stripAddress(input)
  const before = t
  t = t.replace(POLITE_PREFIX, '').replace(POLITE_SUFFIX, '').trim()
  for (const [re, rep] of INFINITIVES) t = t.replace(re, rep)
  // A request phrased as a question ("mi apri il browser?") is still a request.
  if (t !== before || /^(?:apri|chiudi|metti|riproduci|suona|cerca|trova|imposta|avvia|lancia)\b/i.test(t)) {
    t = t.replace(/\?+\s*$/, '')
  }
  return t.trim()
}

class RefusedSignal {
  readonly reason: string
  constructor(reason: string) {
    this.reason = reason
  }
}

export function routeCommand(input: string): RoutedCommand {
  try {
    // "… del pc / che si trova nel mio computer" says where to look (always this PC):
    // drop it before splitting on conjunctions, or ", e si trova nel mio pc" becomes a second step.
    const text = normalizeRequest(input).replace(ON_PC_TAIL, '').trim()
    // Compound sentence first: every part must be a deterministic action.
    return routeSequence(text) ?? route(text)
  } catch (err) {
    if (err instanceof RefusedSignal) return { kind: 'refused', reason: err.reason, reply: refusalReply(err.reason) }
    throw err
  }
}

function routeSequence(text: string): RoutedCommand | null {
  const parts = text.split(CONJUNCTION).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > 4) return null
  const intents: ActionIntent[] = []
  for (const part of parts) {
    const r = route(part)
    if (r.kind !== 'action') return null
    intents.push(r.intent)
  }
  return { kind: 'sequence', intents }
}

function route(text: string): RoutedCommand {
  if (!text) return { kind: 'none' }

  const words = text.split(/\s+/).length
  const hasOpen = OPEN_VERB.test(text)
  const play = PLAY_VERB.exec(text)
  const search = SEARCH_VERB.exec(text)
  const hasVerb = hasOpen || play !== null || search !== null || ACTION_VERB.test(text)
  const question = NOT_A_COMMAND.test(text)
  const shortish = words <= MAX_COMMAND_WORDS

  // 1) Deny-list, before anything else. With an execution verb it always applies;
  //    a bare short shell/destructive line ("powershell Remove-Item …") is refused too,
  //    while questions about those topics stay ordinary chat.
  REFUSE_PATTERNS.forEach(({ re, reason }, index) => {
    if (!re.test(text)) return
    if (hasVerb || (index < 3 && shortish && !question)) {
      throw new RefusedSignal(reason)
    }
  })

  // 2a) Media controls: short lines only ("pausa", "prossima", "alza il volume", "cosa sto ascoltando?").
  //     These may legitimately be questions, so NOT_A_COMMAND does not apply here.
  if (words <= MAX_MEDIA_WORDS + 3 && !LEXICON.some((l) => l.re.test(text)) && !PLAY_VERB.test(text)) {
    for (const { re, intent } of MEDIA_RULES) {
      if (re.test(text)) return { kind: 'action', intent, matched: text }
    }
  }

  // 2a-bis) Timers, weather, files and closing — before the generic open/search rules so
  //         "cerca il file X" or "metti un timer" are not read as web search / music.
  if (shortish) {
    if (TIMER_CANCEL.test(text)) return { kind: 'action', intent: { action: 'timer', target: 'cancel' }, matched: text }
    if (TIMER_LIST.test(text)) return { kind: 'action', intent: { action: 'timer', target: 'list' }, matched: text }
    const timer = TIMER_SET.exec(text)
    if (timer) {
      const expr = (timer[1] ?? timer[2] ?? timer[3] ?? timer[4] ?? '').replace(/[.!?]+$/, '').trim()
      const query = sanitizeMusicQuery(/\bsveglia|svegliami|alarm\b/i.test(text) && !/\balle\b|\bat\b/i.test(expr) ? `alle ${expr}` : expr)
      if (query) return { kind: 'action', intent: { action: 'timer', target: 'set', query }, matched: timer[0] }
    }
    const file = FIND_FILE.exec(text)
    if (file) {
      const raw = file[file.length - 1].replace(ON_PC_TAIL, '').replace(/[.!?]+$/, '').replace(/^["«»“”']|["«»“”']$/g, '').trim()
      const query = sanitizeMusicQuery(raw)
      const target = file.groups?.folder ? 'folders' : 'documents'
      // Known folders keep their dedicated action ("apri la cartella Download").
      if (target === 'folders' && /^(?:dei\s+)?(?:download|downloads|scaricati)$/i.test(raw)) {
        return { kind: 'action', intent: { action: 'open_folder', target: 'downloads' }, matched: file[0] }
      }
      if (query) return { kind: 'action', intent: { action: 'find_file', target, query }, matched: file[0] }
    }
    const named = NAMED_ITEM.exec(text)
    if (named && !question) {
      const raw = named[named.length - 1].replace(ON_PC_TAIL, '').replace(/[.!?]+$/, '').replace(/^["«»“”']|["«»“”']$/g, '').trim()
      const query = sanitizeMusicQuery(raw)
      if (query) {
        return { kind: 'action', intent: { action: 'find_file', target: named.groups?.folder2 ? 'folders' : 'documents', query }, matched: named[0] }
      }
    }
    const wx = WEATHER.exec(text)
    if (wx && !/\bcerca|googla|search\b/i.test(text)) {
      const rest = wx[1].replace(/[.!?]+$/, '').trim()
      const query = rest ? sanitizeMusicQuery(rest) : undefined
      return { kind: 'action', intent: { action: 'weather', target: 'forecast', ...(query ? { query } : {}) }, matched: wx[0] }
    }
    if (CLOSE_VERB.test(text)) {
      for (const { re, intent } of LEXICON) {
        if (intent.action === 'open_app' && re.test(text)) {
          return { kind: 'action', intent: { action: 'close_app', target: intent.target }, matched: text }
        }
      }
    }
  }

  // 2b) Web search: "cerca oasis sul browser", "googla meteo milano". Questions allowed ("cerca che ore sono a tokyo?").
  if (search && shortish && !FILE_NOUN.test(text)) {
    const rawQuery = search[1].replace(SEARCH_TAIL, '').replace(/^["«»“”']|["«»“”']$/g, '').trim()
    const query = sanitizeMusicQuery(rawQuery.replace(/[.!]+$/, ''))
    if (query) return { kind: 'action', intent: { action: 'web_search', target: 'browser', query }, matched: search[0] }
  }

  if (/^(?:la\s+)?musica\.?$/i.test(text)) return { kind: 'action', intent: { action: 'media', target: 'play_pause' }, matched: text }

  // STT sometimes garbles the verb but keeps the app name ("Jarvis, apreso Spotify"):
  // a very short line naming a known target is handed to the classifier instead of chat.
  if (!hasVerb && !question && words <= 5 && LEXICON.some((l) => l.re.test(text))) {
    return { kind: 'maybe', text }
  }

  if (!hasVerb || question || !shortish) return { kind: 'none' }

  // Verb alone, nothing to act on ("Apri.", "cerca", "metti"): ask, do not guess.
  if (words <= 2 && BARE_VERB.test(text)) {
    const v = text.toLowerCase().replace(/[^a-zà-ù\s]/g, '').trim().split(/\s+/)[0]
    const what = /^apr|^avvi|^lanci|^open|^launch/.test(v) ? 'Apro cosa?' : /^cerc|^trov|^search/.test(v) ? 'Cerco cosa?' : /^mett|^riprod|^suon|^play/.test(v) ? 'Metto cosa?' : /^chiud|^close/.test(v) ? 'Chiudo cosa?' : 'Cosa devo fare, esattamente?'
    return { kind: 'clarify', reply: what }
  }

  // 2b) Music: "metti One degli U2", "riproduci qualcosa dei Pink Floyd", "metti un po' di jazz".
  if (play) {
    const rawQuery = play[1]
      .replace(/\s+su\s+spotify\b/i, '')
      .replace(/[.!]+$/, '')
      .trim()
    if (GENERIC_MUSIC.test(rawQuery)) {
      return { kind: 'action', intent: { action: 'media', target: 'play_pause' }, matched: text }
    }
    const query = sanitizeMusicQuery(rawQuery.replace(/\?+$/, ''))
    if (query) return { kind: 'action', intent: { action: 'play_music', target: 'spotify', query }, matched: play[0] }
  }

  // 2c) Deterministic open match — only with an *open* verb ("chiudi spotify" must not open it).
  if (hasOpen) {
    for (const { re, intent } of LEXICON) {
      const m = re.exec(text)
      if (m) return { kind: 'action', intent, matched: m[0].trim() }
    }
  }

  // 3) Looks like a command, target unknown: let the caller decide (model → structured intent).
  return { kind: 'maybe', text }
}

function refusalReply(reason: string): string {
  switch (reason) {
    case 'filesystem path':
      return 'Percorsi a caso non li apro, mi spiace. Posso aprire solo le cartelle e i progetti che abbiamo messo in lista.'
    case 'shell command':
    case 'shell syntax':
      return 'Comandi di shell no, su quello sono irremovibile. Posso aprire app, cartelle, progetti e gestire la musica.'
    case 'destructive command':
    case 'file mutation':
      return 'Cancellare o modificare file non rientra nelle cose che faccio. Meglio così, fidati.'
    case 'system control command':
      return 'Spegnere, riavviare o chiudere processi non è roba mia. Il PC lo spegni tu.'
    case 'install command':
      return 'Installazioni no, quelle le fai tu con calma.'
    default:
      return 'Questa non posso farla.'
  }
}

/* ---------- LLM fallback: structured intent from a closed list ---------- */

export const INTENT_SYSTEM_PROMPT = [
  'You classify a short user request into ONE desktop intent from a closed list, or none.',
  'Allowed intents and targets:',
  ...(Object.keys(ACTION_TARGETS) as ActionId[]).map((a) => `- ${a}: ${ACTION_TARGETS[a].join(', ')}`),
  'For play_music the target is always "spotify" and "query" is the song/artist text, max 80 chars.',
  'For web_search the target is always "browser" and "query" is the search text, max 80 chars.',
  'For timer/set "query" is the duration or clock time (e.g. "10 minuti", "alle 7:30"); weather/forecast "query" is the city (optional); find_file/documents "query" is part of the file name.',
  'Rules: never invent targets; if the request is unclear or not in the list, answer {"intent":"none"}.',
  'Reply with JSON only, no prose: {"intent":"<action id or none>","target":"<target id>","query":"<only for play_music>"}.',
].join('\n')

/** Parses and validates the model answer. Anything not in the allowlist becomes null. */
export function parseModelIntent(raw: string): ActionIntent | null {
  const match = /\{[\s\S]*?\}/.exec(raw)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { intent?: unknown; action?: unknown; target?: unknown; query?: unknown }
    const query = typeof parsed.query === 'string' ? sanitizeMusicQuery(parsed.query) : undefined
    const candidate = { action: parsed.intent ?? parsed.action, target: parsed.target, ...(query ? { query } : {}) }
    return isActionIntent(candidate) ? candidate : null
  } catch {
    return null
  }
}

/** Clarification offered when nothing matched. Lists only what is actually available. */
export function clarificationReply(): string {
  const apps = ACTION_TARGETS.open_app.map((t) => TARGET_LABEL[t] ?? t).join(', ')
  const projects = ACTION_TARGETS.open_project.map((t) => TARGET_LABEL[t] ?? t).join(' e ')
  return `Cosa apro, di preciso? Ho sottomano ${apps}, la cartella Download, VS Code sui progetti ${projects}, e posso mettere musica su Spotify.`
}

/** "sì / ok / vai / confermo" — used to accept a model-proposed intent. */
const AFFIRMATIVE = /^\s*(?:s[iì]|ok(?:ay)?|certo|vai|conferm[oa]|esatto|yes|yep|sure|go|dai)\b[\s.!]*$/i
const NEGATIVE = /^\s*(?:no|nope|annulla|lascia|cancella|non\s+(?:serve|importa)|stop)\b[\s.!]*$/i

export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE.test(stripAddress(text))
}

export function isNegative(text: string): boolean {
  return NEGATIVE.test(stripAddress(text))
}

/* ---------- conversational follow-ups ---------- */

/** "no", "nooo", "intendevo", "volevo dire", "anzi", "invece", "non quella" … a correction of the previous command. */
const CORRECTION =
  /^(?:no+\b|non\b|nooo+|intendevo|volevo\s+dire|dicevo|sbagliato|anzi|invece|cio[èe]|non\s+quell[oa]|quell[oa]\s+sbagliat[oa]|hai\s+(?:capito|sbagliato)|mi\s+sono\s+spiegato\s+male)/i
const FOLLOWUP_MARKERS =
  /\b(?:no+|non|intendevo|volevo\s+dire|dicevo|sbagliato|anzi|invece|cio[èe]|hai\s+capito\s+male|hai\s+sbagliato|mi\s+sono\s+spiegato\s+male|non\s+quell[oa]|quell[oa]\s+sbagliat[oa])\b[\s,:!.]*/gi
/** Filler left once the correction words are gone: "devi aprire la cartella X" → "X". */
const FOLLOWUP_FILLER =
  /\b(?:devi|dovevi|dovresti|volevo|voglio|vorrei|che\s+tu|mi|ti\s+ho\s+detto|ho\s+detto|dicevo|cercavo|chiedevo)\b|\b(?:apri(?:mi|re)?|aprissi|cerca(?:mi|re)?|cercassi|trova(?:mi|re)?|metti(?:mi|re)?|riproduci|riprodurre|suona(?:re)?|si\s+chiama|chiamat[oa]|di\s+nome|quell[oa]\s+(?:che\s+)?(?:si\s+chiama|chiamat[oa]))\b/gi
const FOLLOWUP_NOUN = /\b(?:la\s+|il\s+|lo\s+|una?\s+)?(?<kind>cartella|folder|directory|file|documento|pdf|canzone|brano|pezzo|album|artista|città|citt[àa])\b\s*/gi

/**
 * Reads a short reply in the light of the previous desktop command. Returns a
 * corrected intent when the user is clearly fixing the target of what Jarvis just
 * did ("nooo, la cartella Ale" after a folder search), null otherwise.
 * Deterministic and conservative: only the *query* or the *target* can change,
 * never the kind of action, and only with a correction marker present.
 */
export function resolveFollowUp(input: string, last: ActionIntent | null): ActionIntent | null {
  if (!last) return null
  const text = normalizeRequest(input)
  if (!text || !CORRECTION.test(text) || text.split(/\s+/).length > 12) return null
  let rest = text.replace(FOLLOWUP_MARKERS, ' ')
  rest = rest.replace(FOLLOWUP_FILLER, ' ')
  let kind: string | null = null
  rest = rest.replace(FOLLOWUP_NOUN, (_m, ...args) => {
    const groups = args[args.length - 1] as { kind?: string }
    kind = (groups.kind ?? '').toLowerCase()
    return ' '
  })
  rest = rest
    .replace(ON_PC_TAIL, '')
    .replace(/[.!?]+$/, '')
    .replace(/^["«»“”']|["«»“”']$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!rest) return null

  // Queries: same action, new subject.
  if (last.action === 'find_file') {
    const query = sanitizeMusicQuery(rest)
    if (!query) return null
    const target = kind === 'cartella' || kind === 'folder' || kind === 'directory' ? 'folders' : kind ? 'documents' : last.target
    return { action: 'find_file', target: target as 'folders' | 'documents', query }
  }
  if (last.action === 'web_search' || last.action === 'play_music' || last.action === 'weather') {
    const query = sanitizeMusicQuery(rest)
    return query ? ({ ...last, query } as ActionIntent) : null
  }
  // Opens: a known target named in the correction ("no, spotify" after opening the browser).
  if (last.action === 'open_app' || last.action === 'open_project' || last.action === 'open_folder') {
    for (const { re, intent } of LEXICON) {
      if (re.test(rest)) return intent
    }
    if (kind === 'cartella' || kind === 'folder') {
      const query = sanitizeMusicQuery(rest)
      if (query) return { action: 'find_file', target: 'folders', query }
    }
  }
  return null
}

/** Question asked before executing an intent the model (not a rule) proposed. */
export function confirmationReply(intent: ActionIntent): string {
  const label = TARGET_LABEL[intent.target] ?? intent.target
  const what =
    intent.action === 'open_project'
      ? `VS Code sul progetto ${label}`
      : intent.action === 'play_music'
        ? `«${intent.query}» su Spotify`
        : intent.action === 'web_search'
          ? `una ricerca web per «${intent.query}»`
          : intent.action === 'close_app'
            ? `(chiudere) ${label}`
            : intent.action === 'timer'
              ? `un ${intent.target === 'set' ? `timer «${intent.query}»` : label}`
              : intent.action === 'weather'
                ? `il meteo${intent.query ? ` per «${intent.query}»` : ''}`
                : intent.action === 'find_file'
                  ? `la ricerca del file «${intent.query}»`
                  : intent.action === 'media'
          ? `il controllo ${label}`
          : label
  return `Vuoi che apra ${what}? Dimmi di sì e vado.`
}

/** HUD-safe description of an intent (no paths, no commands). */
export function describeIntent(intent: ActionIntent): { tool: string; target: string } {
  const query = 'query' in intent && intent.query ? ` «${intent.query}»` : ''
  return { tool: intent.action, target: `${intent.target}${query}` }
}

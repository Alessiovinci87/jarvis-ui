// Standalone check of the command router (deterministic layer + deny-list).
// Run: node scripts/router.test.mjs   (uses the built TS via a tiny esbuild-free transpile through Vite's SSR loader)
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { routeCommand, parseModelIntent } = await vite.ssrLoadModule('/src/services/commandRouter.ts')

const cases = [
  ['Jarvis, apri Visual Studio Code', 'action', 'open_app/vscode'],
  ['Apri Spotify', 'action', 'open_app/spotify'],
  ['apri spotify', 'action', 'open_app/spotify'],
  ['avvia vscode', 'action', 'open_app/vscode'],
  ['Apri la cartella Download', 'action', 'open_folder/downloads'],
  ['apri download', 'action', 'open_folder/downloads'],
  ['Apri il browser', 'action', 'open_app/browser'],
  ['Apri VS Code sul progetto jarvis-ui', 'action', 'open_project/jarvis-ui'],
  ['Apri VS Code sul progetto OpenJarvis', 'action', 'open_project/openjarvis'],
  ['ehi jarvis potresti aprire spotify per favore', 'action', 'open_app/spotify'],
  ['esegui powershell Remove-Item C:\\x', 'refused'],
  ['powershell Remove-Item C:\\x', 'refused'],
  ['apri C:\\qualcosa\\inventato', 'refused'],
  ['apri la cartella C:\\Users\\aless\\Documents', 'refused'],
  ['spegni il computer', 'refused'],
  ['Apri.', 'clarify'],
  ['apri', 'clarify'],
  ['cerca', 'clarify'],
  ['mettimi', 'clarify'],
  ['apri notepad', 'maybe'],
  ['Apri la calcolatrice', 'maybe'],
  ['che ore sono?', 'none'],
  ['come si apre un file in python?', 'none'],
  ['raccontami una storia su un browser', 'none'],
  ["cos'è spotify?", 'none'],
  ['ricordati che domani apro il negozio alle 9', 'none'],
  // folders / files on the PC
  ['apri la cartella ale del pc', 'action', 'find_file/folders', 'ale'],
  ['apri la cartella Ale che ho sul mio pc', 'action', 'find_file/folders', 'Ale'],
  ['trova la cartella ale nel computer', 'action', 'find_file/folders', 'ale'],
  ['La cartella si Chiama Ale, e si trova nel mio pc', 'action', 'find_file/folders', 'Ale'],
  ['il file si chiama preventivo 2026', 'action', 'find_file/documents', 'preventivo 2026'],
  ['trova il documento fattura marzo sul pc', 'action', 'find_file/documents', 'fattura marzo'],
  ['cerca oasis sul browser', 'action', 'web_search/browser', 'oasis'],
  // music + media
  ['metti One degli U2', 'action', 'play_music/spotify', 'One degli U2'],
  ['riproduci la canzone With or Without You', 'action', 'play_music/spotify', 'With or Without You'],
  ["Jarvis, metti un po' di jazz", 'action', 'play_music/spotify', 'jazz'],
  ['metti la musica', 'action', 'media/play_pause'],
  ['pausa', 'action', 'media/play_pause'],
  ['prossima', 'action', 'media/play_pause'.replace('play_pause','next')],
  ['alza il volume', 'action', 'media/volume_up'],
  ["abbassa un po' il volume", 'action', 'media/volume_down'],
  ['metti powershell Remove-Item', 'refused'],
  ['cosa sto ascoltando?', 'action', 'media/now_playing'],
  ['cerca sul browser "oasis"', 'action', 'web_search/browser', 'oasis'],
  ['cerca oasis su google', 'action', 'web_search/browser', 'oasis'],
  ['Jarvis cercami il meteo di Milano per domani', 'action', 'web_search/browser', 'il meteo di Milano per domani'],
  ['googla che ore sono a tokyo?', 'action', 'web_search/browser', 'che ore sono a tokyo?'],
  ['mandami una mail a marco', 'maybe'],
  ['mi racconti una barzelletta?', 'none'],
  ['chiudi spotify', 'action', 'close_app/spotify'],
  // natural phrasings
  ['vorrei ascoltare gli U2 su Spotify', 'action', 'play_music/spotify', 'U2'],
  ["mi va di sentire un po' di Pink Floyd", 'action', 'play_music/spotify', 'Pink Floyd'],
  ['puoi mettermi With or Without You?', 'action', 'play_music/spotify', 'With or Without You'],
  ['fammi ascoltare qualcosa degli AC/DC', 'action', 'play_music/spotify', 'AC/DC'],
  ['potresti aprire VS Code sul progetto jarvis ui?', 'action', 'open_project/jarvis-ui'],
  ['mi apri il browser per favore', 'action', 'open_app/browser'],
  ['che tempo farà domani a Torino?', 'action', 'weather/forecast', 'domani a Torino'],
  ['ricordami tra venti minuti di chiamare Marco', 'action', 'timer/set', 'venti minuti di chiamare Marco'],
  ["mi serve un timer di mezz'ora", 'action', 'timer/set', "mezz'ora"],
  ['ho voglia di musica', 'action', 'media/play_pause'],
  ["abbassa un po' che è troppo alta", 'action', 'media/volume_down'],
  ['basta musica', 'action', 'media/play_pause'],
  ['vorrei sapere come funziona la fotosintesi', 'none'],
  ['puoi spiegarmi la relatività?', 'none'],
  ['Jarvis, apreso Spotify.', 'maybe'],
  ['spotify', 'maybe'],
  ['Spotify è nato in Svezia nel 2006 e oggi ha milioni di utenti', 'none'],
  ['chiudi vs code', 'action', 'close_app/vscode'],
  ['metti un timer di 10 minuti', 'action', 'timer/set', '10 minuti'],
  ['timer 5 minuti', 'action', 'timer/set', '5 minuti'],
  ['svegliami alle 7:30', 'action', 'timer/set', 'alle 7:30'],
  ['metti una sveglia alle 7', 'action', 'timer/set', 'alle 7'],
  ['annulla il timer', 'action', 'timer/cancel'],
  ['quanto manca?', 'action', 'timer/list'],
  ['che tempo fa a Milano?', 'action', 'weather/forecast', 'a Milano'],
  ['meteo domani', 'action', 'weather/forecast', 'domani'],
  ['pioverà domani a Roma?', 'action', 'weather/forecast', 'domani a Roma'],
  ['trova il file preventivo', 'action', 'find_file/documents', 'preventivo'],
  ['cerca il documento fattura marzo', 'action', 'find_file/documents', 'fattura marzo'],
  ["dov'è il pdf del contratto", 'action', 'find_file/documents', 'contratto'],
  ['cerca e apri la cartella Ale sul mio pc', 'action', 'find_file/folders', 'Ale'],
  ['apri la cartella Fatture', 'action', 'find_file/folders', 'Fatture'],
  ['trova la cartella foto vacanze', 'action', 'find_file/folders', 'foto vacanze'],
  ['apri la cartella download', 'action', 'open_folder/downloads'],
  ['che canzone è questa', 'action', 'media/now_playing'],
  // compound
  ['apri spotify e riproduci one degli u2', 'sequence', 'open_app/spotify > play_music/spotify:one degli u2'],
  ['Jarvis, apri spotify e poi metti One degli U2', 'sequence', 'open_app/spotify > play_music/spotify:One degli U2'],
  ['apri vs code sul progetto jarvis-ui e apri il browser', 'sequence', 'open_project/jarvis-ui > open_app/browser'],
  ['apri spotify e cancella la cartella download', 'refused'],
  ['apri spotify e dimmi che ore sono', 'none'], // mixed command + question stays chat (known limit)
]

let fail = 0
const fmt = (i) => `${i.action}/${i.target}${i.query ? ':' + i.query : ''}`
for (const [text, kind, pair, query] of cases) {
  const r = routeCommand(text)
  const got = r.kind === 'action' ? `${r.intent.action}/${r.intent.target}` : r.kind === 'sequence' ? r.intents.map(fmt).join(' > ') : ''
  const ok = r.kind === kind && (!pair || got === pair) && (!query || r.intent?.query === query)
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(text)} -> ${r.kind}${got ? ' ' + got : ''}${r.kind === 'refused' ? ' (' + r.reason + ')' : ''}`)
}

// Follow-ups: a correction read in the light of the previous command.
const { resolveFollowUp } = await vite.ssrLoadModule('/src/services/commandRouter.ts')
const follow = [
  [{ action: 'find_file', target: 'folders', query: 'ale del pc' }, 'nooo devi aprire la cartella Ale', 'find_file/folders', 'Ale'],
  [{ action: 'find_file', target: 'folders', query: 'ale' }, 'no, intendevo il file preventivo', 'find_file/documents', 'preventivo'],
  [{ action: 'web_search', target: 'browser', query: 'nel mio pc' }, 'no, cercavo oasis', 'web_search/browser', 'oasis'],
  [{ action: 'web_search', target: 'browser', query: 'oasis' }, 'no, volevo dire blur', 'web_search/browser', 'blur'],
  [{ action: 'play_music', target: 'spotify', query: 'one' }, 'nooo, One degli U2', 'play_music/spotify', 'One degli U2'],
  [{ action: 'open_app', target: 'browser' }, 'no, spotify', 'open_app/spotify'],
  [{ action: 'open_app', target: 'browser' }, 'no, la cartella Ale', 'find_file/folders', 'Ale'],
  [{ action: 'open_app', target: 'spotify' }, 'no grazie', null],
  [{ action: 'find_file', target: 'folders', query: 'ale' }, 'che ore sono?', null],
  [{ action: 'find_file', target: 'folders', query: 'ale' }, 'apri spotify', null],
  [null, 'no, la cartella Ale', null],
]
for (const [last, text, want, query] of follow) {
  const r = resolveFollowUp(text, last)
  const got = r ? `${r.action}/${r.target}` : null
  const ok = got === want && (!query || r?.query === query)
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} followup ${JSON.stringify(text)} -> ${got}${r?.query ? ' «' + r.query + '»' : ''}`)
}

const parsed = [
  ['{"intent":"open_project","target":"jarvis-ui"}', 'open_project/jarvis-ui'],
  ['Sure! {"intent":"open_app","target":"spotify"}', 'open_app/spotify'],
  ['{"intent":"open_app","target":"notepad"}', null],
  ['{"intent":"run_shell","target":"vscode"}', null],
  ['{"intent":"none"}', null],
  ['{"intent":"play_music","target":"spotify","query":"One U2"}', 'play_music/spotify'],
  ['{"intent":"play_music","target":"spotify","query":"x; rm -rf /"}', null],
  ['garbage', null],
]
for (const [raw, want] of parsed) {
  const r = parseModelIntent(raw)
  const got = r ? `${r.action}/${r.target}` : null
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} parse ${raw} -> ${got}`)
}
await vite.close()
console.log(fail ? `${fail} FAILED` : 'ALL PASS')
process.exit(fail ? 1 : 0)

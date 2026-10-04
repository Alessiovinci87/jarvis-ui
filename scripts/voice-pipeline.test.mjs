// End-to-end check of the voice pipeline without a microphone:
//   WAV (Windows TTS) → OpenJarvis /v1/speech/transcribe (faster-whisper) → command router → bridge.
// Usage: node scripts/voice-pipeline.test.mjs <dir-with-wavs-and-phrases.txt> [--run]
// With --run, the first recognised deterministic command is actually executed through the bridge.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'

const dir = process.argv[2]
const run = process.argv.includes('--run')
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { routeCommand } = await vite.ssrLoadModule('/src/services/commandRouter.ts')

const phrases = Object.fromEntries(
  readFileSync(join(dir, 'phrases.txt'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('=')),
)

let fail = 0
let executed = false
for (const file of readdirSync(dir).filter((f) => f.endsWith('.wav')).sort()) {
  const id = file.replace('.wav', '')
  const form = new FormData()
  form.append('file', new Blob([readFileSync(join(dir, file))], { type: 'audio/wav' }), 'speech.wav')
  form.append('language', 'it')
  const t0 = Date.now()
  const sttUrl = process.argv.includes('--openjarvis') ? 'http://127.0.0.1:8000/v1/speech/transcribe' : 'http://127.0.0.1:8765/stt'
  const res = await fetch(sttUrl, { method: 'POST', body: form })
  const stt = await res.json()
  const heard = (stt.text ?? '').trim()
  const routed = routeCommand(heard)
  const got =
    routed.kind === 'action'
      ? `${routed.intent.action}/${routed.intent.target}${routed.intent.query ? ':' + routed.intent.query : ''}`
      : routed.kind === 'sequence'
        ? routed.intents.map((i) => `${i.action}/${i.target}`).join(' > ')
        : routed.kind
  console.log(`${id} said="${phrases[id]}"\n   heard="${heard}" (${((Date.now() - t0) / 1000).toFixed(1)}s) -> ${got}`)
  if (!heard) fail++

  if (run && !executed && routed.kind === 'action') {
    executed = true
    const body = { action: routed.intent.action, target: routed.intent.target, ...(routed.intent.query ? { query: routed.intent.query } : {}) }
    const r = await fetch('http://127.0.0.1:8765/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    console.log(`   EXECUTED via bridge -> ${r.status} ${(await r.text()).slice(0, 120)}`)
  }
}
await vite.close()
console.log(fail ? `${fail} transcription(s) empty` : 'pipeline OK')
process.exit(fail ? 1 : 0)

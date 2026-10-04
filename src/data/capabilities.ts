/**
 * Startup routine texts. Kept as data so the greeting and the capability
 * summary stay in sync with what the allowlist actually offers.
 */

export const STARTUP_GREETING = 'Ciao Ale, in cosa posso esserti utile?'

/** Spoken after the greeting; one breath, no lists (it is read by TTS). */
export const CAPABILITY_SUMMARY = [
  'Sono il tuo secondo cervello: prendo appunti, ricordo quello che mi dici, tengo promemoria con data e ora e le tue liste, come la spesa.',
  'Ti avviso quando scade qualcosa e la mattina ti faccio il punto della giornata, meteo compreso.',
  'Sul PC apro e chiudo VS Code, Spotify e il browser, apro i tuoi progetti e le cartelle, trovo file, metto la musica, cerco sul web, imposto timer.',
  'Le azioni le faccio solo quando me le chiedi tu, e se non sono sicuro ti chiedo conferma.',
  'Tutto quello che ti salvo lo trovi nel pannello Memoria, con control M.',
].join(' ')

/**
 * Startup theme: a local file at `public/intro/theme.mp3`, played by the browser
 * (never Spotify: whatever is already playing is left alone). Seconds, fade, volume %.
 */
export const STARTUP_TRACK_SECONDS = 20
/** Fade-out length at the end of the intro, in seconds (starts at SECONDS - FADE). */
export const STARTUP_TRACK_FADE = 2.5
export const STARTUP_TRACK_VOLUME = 25

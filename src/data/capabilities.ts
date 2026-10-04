/**
 * Startup routine texts. Kept as data so the greeting and the capability
 * summary stay in sync with what the allowlist actually offers.
 */

export const STARTUP_GREETING = 'Ciao Ale, in cosa posso esserti utile?'

/** Spoken after the greeting; one breath, no lists (it is read by TTS). */
export const CAPABILITY_SUMMARY = [
  'Al momento so aprire e chiudere VS Code, Spotify e il browser,',
  'aprire i progetti Jarvis UI e OpenJarvis e la cartella Download,',
  'mettere la musica che vuoi su Spotify e controllarla,',
  'cercare sul web, dirti il meteo, impostare timer e sveglie,',
  'trovare i tuoi file e ricordare quello che mi chiedi di tenere a mente.',
  'Per il resto, chiedi pure.',
].join(' ')

/**
 * Startup theme: a local file at `public/intro/theme.mp3`, played by the browser
 * (never Spotify: whatever is already playing is left alone). Seconds, fade, volume %.
 */
export const STARTUP_TRACK_SECONDS = 20
/** Fade-out length at the end of the intro, in seconds (starts at SECONDS - FADE). */
export const STARTUP_TRACK_FADE = 2.5
export const STARTUP_TRACK_VOLUME = 25

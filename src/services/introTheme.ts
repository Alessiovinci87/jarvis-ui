/**
 * Startup theme played by the browser from a local file (`public/intro/theme.mp3`).
 *
 * Nothing leaves the PC and nothing else is touched: Spotify or any other player
 * keeps going. The clip plays quietly for a few seconds and fades out on its own.
 * When the file is missing the feature simply reports itself unavailable.
 */

export const INTRO_THEME_URL = '/intro/theme.mp3'

let current: HTMLAudioElement | null = null

/** True when the local theme file exists (checked with a cheap HEAD request). */
export async function introThemeAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(INTRO_THEME_URL, { method: 'HEAD', signal })
    const type = res.headers.get('content-type') ?? ''
    // Vite dev serves index.html for unknown paths: accept only real audio.
    return res.ok && (type.startsWith('audio/') || type === 'application/octet-stream')
  } catch {
    return false
  }
}

/**
 * Plays the theme at `volume` (0..1) for `seconds`, fading out over the last `fade`
 * seconds. Resolves when playback has started (or immediately when unavailable).
 */
export async function playIntroTheme(seconds = 20, volume = 0.25, fade = 2.5, startAt = 0): Promise<boolean> {
  stopIntroTheme()
  const audio = new Audio(INTRO_THEME_URL)
  audio.volume = Math.min(1, Math.max(0, volume))
  audio.currentTime = startAt
  current = audio
  try {
    await audio.play()
  } catch {
    current = null
    return false
  }
  const fadeStart = Math.max(0, seconds - fade) * 1000
  const steps = 20
  window.setTimeout(() => {
    if (current !== audio) return
    let i = 0
    const tick = window.setInterval(() => {
      i += 1
      audio.volume = Math.max(0, volume * (1 - i / steps))
      if (i >= steps) {
        window.clearInterval(tick)
        if (current === audio) stopIntroTheme()
      }
    }, (fade * 1000) / steps)
  }, fadeStart)
  return true
}

export function stopIntroTheme(): void {
  if (current) {
    current.pause()
    current.src = ''
    current = null
  }
}

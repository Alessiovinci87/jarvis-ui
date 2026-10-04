/**
 * Local cache for synthesised speech (Cache API, per browser profile).
 * Fixed lines — greeting, capability summary, "Fatto." — are generated once and
 * then play instantly; Kokoro on CPU takes ~1.3× the audio length to render.
 */

const CACHE_NAME = 'jarvis-tts-v1'
const MAX_ENTRIES = 300

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

function keyFor(voice: string, text: string): string {
  // A synthetic same-origin URL; the Cache API only accepts http(s) requests.
  return `${location.origin}/__tts/${encodeURIComponent(voice || 'default')}/${encodeURIComponent(text)}`
}

/** Returns the cached WAV or synthesises and stores it. Never throws because of the cache. */
export async function cachedSynthesize(voice: string, text: string, synthesize: (text: string) => Promise<Blob>): Promise<Blob> {
  const cache = await openCache()
  const key = keyFor(voice, text)
  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) return await hit.blob()
    } catch {
      /* cache read failed: synthesise */
    }
  }
  const blob = await synthesize(text)
  if (cache && blob.size > 0) {
    try {
      await cache.put(key, new Response(blob, { headers: { 'content-type': blob.type || 'audio/wav' } }))
      void trim(cache)
    } catch {
      /* quota or private mode: ignore */
    }
  }
  return blob
}

async function trim(cache: Cache): Promise<void> {
  try {
    const keys = await cache.keys()
    if (keys.length <= MAX_ENTRIES) return
    for (const req of keys.slice(0, keys.length - MAX_ENTRIES)) await cache.delete(req)
  } catch {
    /* ignore */
  }
}

/** Pre-renders texts in the background (e.g. the startup greeting while the boot screen is shown). */
export function prewarm(voice: string, texts: string[], synthesize: (text: string) => Promise<Blob>): void {
  void (async () => {
    for (const t of texts) {
      try {
        await cachedSynthesize(voice, t, synthesize)
      } catch {
        /* backend busy or offline: the live path will retry */
      }
    }
  })()
}

import { useEffect, useState } from 'react'
import { openJarvisApi } from '../services/openJarvisApi'
import type { OpenJarvisStatus } from '../types/openjarvis'

/** Poll cadence: one health probe every 15 s, metadata refreshed every 60 s. */
const HEALTH_INTERVAL_MS = 15_000
const DETAILS_INTERVAL_MS = 60_000
/** Consecutive failed probes required before reporting OFFLINE (avoids flicker under CPU load). */
const OFFLINE_AFTER_FAILURES = 2

const INITIAL: OpenJarvisStatus = {
  status: 'checking',
  loading: true,
  error: null,
  info: null,
  models: [],
  agents: [],
  lastSeen: null,
}

/**
 * Tracks whether the OpenJarvis backend is reachable and exposes its
 * read-only metadata. Never throws: failures surface as status "offline".
 */
export function useOpenJarvisStatus(): OpenJarvisStatus {
  const [state, setState] = useState<OpenJarvisStatus>(INITIAL)

  useEffect(() => {
    const controller = new AbortController()
    let lastDetailsAt = 0
    let failures = 0
    let timer: number | undefined

    const fetchDetails = async () => {
      const [info, models, agents] = await Promise.all([
        openJarvisApi.info(controller.signal),
        openJarvisApi.models(controller.signal),
        openJarvisApi.managedAgents(controller.signal),
      ])
      return { info, models: models.data, agents: agents.agents }
    }

    const tick = async () => {
      try {
        const health = await openJarvisApi.health(controller.signal)
        if (controller.signal.aborted) return
        const healthy = health.status === 'ok'
        const now = Date.now()

        let details: Partial<OpenJarvisStatus> = {}
        if (healthy && now - lastDetailsAt >= DETAILS_INTERVAL_MS) {
          details = await fetchDetails()
          lastDetailsAt = now
        }
        if (controller.signal.aborted) return

        failures = healthy ? 0 : failures + 1
        setState((prev) => ({
          ...prev,
          ...details,
          status: healthy
            ? 'online'
            : failures >= OFFLINE_AFTER_FAILURES || prev.status === 'checking'
              ? 'offline'
              : prev.status,
          loading: false,
          error: healthy ? null : `health status: ${health.status}`,
          lastSeen: healthy ? now : prev.lastSeen,
        }))
      } catch (err) {
        if (controller.signal.aborted) return
        // Force a full metadata refresh once the backend comes back.
        lastDetailsAt = 0
        failures += 1
        const offline = failures >= OFFLINE_AFTER_FAILURES
        setState((prev) => ({
          ...prev,
          // One slow probe keeps the previous ONLINE state; a cold start goes straight to OFFLINE.
          status: offline || prev.status === 'checking' ? 'offline' : prev.status,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(tick, HEALTH_INTERVAL_MS)
        }
      }
    }

    void tick()

    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  return state
}

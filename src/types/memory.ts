/**
 * Memory types mirroring the real OpenJarvis endpoints
 * (schemas from /openapi.json, responses from server/api_routes.py, 2026-10-01).
 */

/** POST /v1/memory/store body (components/schemas/MemoryStoreRequest). */
export interface MemoryStoreRequest {
  content: string
  metadata?: Record<string, unknown> | null
}

/** POST /v1/memory/store → {"status":"stored"} */
export interface MemoryStoreResponse {
  status: string
}

/** POST /v1/memory/search body (components/schemas/MemorySearchRequest). */
export interface MemorySearchRequest {
  query: string
  /** default 5 */
  top_k?: number
}

export interface MemoryHit {
  content: string
  score: number
  metadata: Record<string, unknown>
}

/** POST /v1/memory/search → {"results":[{content, score, metadata}]} */
export interface MemorySearchResponse {
  results: MemoryHit[]
}

/** GET /v1/memory/stats → {"entries": n, "backend": "sqlite"} or {"entries":0,"backend":"none","status":"not_configured"} */
export interface MemoryStatsResponse {
  entries: number
  backend: string
  status?: string
}

/** GET /v1/memory/config */
export interface MemoryConfigResponse {
  backend_type: string
  available: boolean
  detail: string | null
  context_top_k: number
  context_min_score: number
  context_max_tokens: number
  context_from_memory: boolean
}

export type MemoryBackendStatus = 'unknown' | 'available' | 'unavailable'

export interface MemoryStatus {
  status: MemoryBackendStatus
  backend: string | null
  entries: number | null
  /** Last unavailability reason reported by the backend. */
  detail: string | null
  /** Matches used for the most recent request (null when none was performed). */
  lastMatches: number | null
}

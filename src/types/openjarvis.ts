/**
 * Types mirroring the real payloads returned by the OpenJarvis backend
 * (captured from http://127.0.0.1:8000 on 2026-10-01).
 */

/** GET /health → {"status":"ok"} */
export interface HealthResponse {
  status: string
}

/** GET /v1/info → {"model":"qwen3.5:4b","agent":"orchestrator","engine":"multi"} */
export interface InfoResponse {
  model: string
  agent: string
  engine: string
}

/** Single entry of GET /v1/models (OpenAI-compatible list). */
export interface ModelEntry {
  id: string
  object: 'model' | string
  created: number
  owned_by: string
}

/** GET /v1/models → {"object":"list","data":[...]} */
export interface ModelsResponse {
  object: 'list' | string
  data: ModelEntry[]
}

/**
 * Entry of GET /v1/managed-agents. The backend returned an empty list during
 * capture, so the element shape is unknown: only optional common fields are
 * declared and anything else is preserved as-is.
 */
export interface ManagedAgent {
  id?: string
  name?: string
  [key: string]: unknown
}

/** GET /v1/managed-agents → {"agents":[]} */
export interface ManagedAgentsResponse {
  agents: ManagedAgent[]
}

export type BackendStatus = 'checking' | 'online' | 'offline'

export interface OpenJarvisStatus {
  status: BackendStatus
  loading: boolean
  error: string | null
  info: InfoResponse | null
  models: ModelEntry[]
  agents: ManagedAgent[]
  /** Timestamp of the last successful health check. */
  lastSeen: number | null
}

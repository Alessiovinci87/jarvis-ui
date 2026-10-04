import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatRequestMessage,
  ChatToolDefinition,
  HTTPValidationError,
} from '../types/chat'
import type {
  HealthResponse,
  InfoResponse,
  ManagedAgentsResponse,
  ModelsResponse,
} from '../types/openjarvis'
import type {
  MemoryConfigResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  MemoryStatsResponse,
  MemoryStoreRequest,
  MemoryStoreResponse,
} from '../types/memory'
import type {
  SpeechHealthResponse,
  SpeechSynthesizeRequest,
  TranscribeResponse,
  TtsHealthResponse,
} from '../types/speech'

/**
 * Base URL of the OpenJarvis backend. The backend already sends CORS headers
 * for the Vite dev origin, so calls go directly to it. Override with
 * VITE_OPENJARVIS_URL (e.g. "" to use same-origin relative paths behind a proxy).
 */
export const OPENJARVIS_BASE_URL: string =
  import.meta.env.VITE_OPENJARVIS_URL ?? 'http://127.0.0.1:8000'

const DEFAULT_TIMEOUT_MS = 4000
/** Health may be slow while the local model saturates the CPU. */
const HEALTH_TIMEOUT_MS = 8000
/** Local models can be slow on first token; allow generous time for a reply. */
const CHAT_TIMEOUT_MS = 180_000

export class OpenJarvisApiError extends Error {
  readonly status: number | null
  /** Parsed 422 body, when the backend rejected the payload. */
  readonly validation: HTTPValidationError | null

  constructor(
    message: string,
    status: number | null = null,
    validation: HTTPValidationError | null = null,
  ) {
    super(message)
    this.name = 'OpenJarvisApiError'
    this.status = status
    this.validation = validation
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  /** JSON body (serialised) or FormData (sent as multipart). */
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
  /** 'json' (default) parses the body, 'blob' returns it raw (audio). */
  responseType?: 'json' | 'blob'
}

/** Whisper on CPU: allow a generous window for longer recordings. */
const TRANSCRIBE_TIMEOUT_MS = 60_000
const SYNTHESIZE_TIMEOUT_MS = 60_000

async function readErrorBody(res: Response): Promise<{ text: string; validation: HTTPValidationError | null }> {
  const text = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as HTTPValidationError).detail)) {
      return { text, validation: parsed as HTTPValidationError }
    }
  } catch {
    /* not JSON */
  }
  return { text, validation: null }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, responseType = 'json' } = options
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort)

  try {
    const res = await fetch(`${OPENJARVIS_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: responseType === 'blob' ? '*/*' : 'application/json',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const { text, validation } = await readErrorBody(res)
      const detail = validation
        ? validation.detail.map((d) => `${d.loc.join('.')}: ${d.msg}`).join('; ')
        : text.slice(0, 200)
      throw new OpenJarvisApiError(
        `${method} ${path} failed with ${res.status}${detail ? ` (${detail})` : ''}`,
        res.status,
        validation,
      )
    }
    if (responseType === 'blob') return (await res.blob()) as T
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof OpenJarvisApiError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new OpenJarvisApiError(`${method} ${path}: ${message}`)
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

export interface SendChatOptions {
  model: string
  temperature?: number
  max_tokens?: number
  /** Tool definitions: OpenJarvis forwards them to Ollama and returns raw `tool_calls` (never executes them). */
  tools?: ChatToolDefinition[]
  signal?: AbortSignal
}

/** Memory calls are local SQLite + FTS; keep them snappy so a slow search never blocks a question. */
const MEMORY_TIMEOUT_MS = 6000

/** Read-only + chat + speech + memory client for the OpenJarvis HTTP API. */
export const openJarvisApi = {
  /* ---- memory ---- */
  memoryConfig: (signal?: AbortSignal) =>
    request<MemoryConfigResponse>('/v1/memory/config', { signal, timeoutMs: MEMORY_TIMEOUT_MS }),
  memoryStats: (signal?: AbortSignal) =>
    request<MemoryStatsResponse>('/v1/memory/stats', { signal, timeoutMs: MEMORY_TIMEOUT_MS }),
  memoryStore: (body: MemoryStoreRequest, signal?: AbortSignal) =>
    request<MemoryStoreResponse>('/v1/memory/store', { method: 'POST', body, signal, timeoutMs: MEMORY_TIMEOUT_MS }),
  memorySearch: (body: MemorySearchRequest, signal?: AbortSignal) =>
    request<MemorySearchResponse>('/v1/memory/search', { method: 'POST', body, signal, timeoutMs: MEMORY_TIMEOUT_MS }),

  /* ---- speech ---- */
  speechHealth: (signal?: AbortSignal) =>
    request<SpeechHealthResponse>('/v1/speech/health', { signal, timeoutMs: HEALTH_TIMEOUT_MS }),
  ttsHealth: (signal?: AbortSignal) =>
    request<TtsHealthResponse>('/v1/speech/tts/health', { signal, timeoutMs: HEALTH_TIMEOUT_MS }),

  /**
   * POST /v1/speech/transcribe (multipart). The backend infers the audio
   * format from the filename extension, so `filename` must carry the right one.
   */
  transcribe: (audio: Blob, filename: string, language?: string, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', audio, filename)
    if (language) form.append('language', language)
    return request<TranscribeResponse>('/v1/speech/transcribe', {
      method: 'POST',
      body: form,
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
      signal,
    })
  },

  /** POST /v1/speech/synthesize → audio/wav blob (501 when no TTS backend is configured). */
  synthesize: (body: SpeechSynthesizeRequest, signal?: AbortSignal) =>
    request<Blob>('/v1/speech/synthesize', {
      method: 'POST',
      body,
      timeoutMs: SYNTHESIZE_TIMEOUT_MS,
      signal,
      responseType: 'blob',
    }),

  health: (signal?: AbortSignal) =>
    request<HealthResponse>('/health', { signal, timeoutMs: HEALTH_TIMEOUT_MS }),
  info: (signal?: AbortSignal) => request<InfoResponse>('/v1/info', { signal }),
  models: (signal?: AbortSignal) => request<ModelsResponse>('/v1/models', { signal }),
  managedAgents: (signal?: AbortSignal) =>
    request<ManagedAgentsResponse>('/v1/managed-agents', { signal }),

  /**
   * POST /v1/chat/completions, non-streaming. `messages` is the full history
   * to send (the backend is stateless between calls).
   */
  sendChatMessage: (messages: ChatRequestMessage[], options: SendChatOptions) => {
    const { model, temperature, max_tokens, tools, signal } = options
    const payload: ChatCompletionRequest = {
      model,
      messages,
      stream: false,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max_tokens !== undefined ? { max_tokens } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
    }
    return request<ChatCompletionResponse>('/v1/chat/completions', {
      method: 'POST',
      body: payload,
      timeoutMs: CHAT_TIMEOUT_MS,
      signal,
    })
  },
}

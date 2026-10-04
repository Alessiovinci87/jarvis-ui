/**
 * Chat types mirroring the real OpenJarvis contract:
 * request from /openapi.json (ChatCompletionRequest / ChatMessage),
 * response captured from a live POST /v1/chat/completions on 2026-10-01.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

/** components/schemas/ChatMessage (request side). Only `role` is required. */
/** OpenAI-style tool definition passed through OpenJarvis to Ollama. */
export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** Tool call proposed by the model (never executed as-is: validated first). */
export interface ChatToolCall {
  id?: string
  type?: 'function' | string
  function?: { name: string; arguments?: string }
}

export interface ChatRequestMessage {
  role: ChatRole
  content?: string
  name?: string | null
  tool_calls?: Record<string, unknown>[] | null
  tool_call_id?: string | null
}

/** components/schemas/ChatCompletionRequest. */
export interface ChatCompletionRequest {
  model: string
  messages: ChatRequestMessage[]
  /** default 0.7 */
  temperature?: number
  /** default 1024 */
  max_tokens?: number
  /** default false */
  stream?: boolean
  tools?: ChatToolDefinition[] | Record<string, unknown>[] | null
}

/** choices[].message as returned by the backend. */
export interface ChatResponseMessage {
  role: ChatRole
  content: string
  tool_calls: Record<string, unknown>[] | null
  audio: unknown | null
}

export interface ChatChoice {
  index: number
  message: ChatResponseMessage
  finish_reason: string | null
}

export interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** OpenJarvis-specific extra field. */
export interface ChatComplexity {
  score: number
  tier: string
  suggested_max_tokens: number
}

/**
 * Observed response:
 * {"id":"chatcmpl-…","object":"chat.completion","created":…,"model":"qwen3.5:4b",
 *  "choices":[{"index":0,"message":{"role":"assistant","content":"…","tool_calls":null,"audio":null},"finish_reason":"stop"}],
 *  "usage":{"prompt_tokens":557,"completion_tokens":33,"total_tokens":590},
 *  "complexity":{"score":0.06,"tier":"trivial","suggested_max_tokens":2048}}
 */
export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion' | string
  created: number
  model: string
  choices: ChatChoice[]
  usage?: ChatUsage
  complexity?: ChatComplexity
}

/** components/schemas/ValidationError (HTTP 422). */
export interface ValidationError {
  loc: (string | number)[]
  msg: string
  type: string
  input?: unknown
  ctx?: Record<string, unknown>
}

/** components/schemas/HTTPValidationError. */
export interface HTTPValidationError {
  detail: ValidationError[]
}

/* ---------- UI-side conversation state ---------- */

export type ConversationRole = 'user' | 'assistant'
export type MessageStatus = 'pending' | 'done' | 'error'

export interface ConversationMessage {
  id: number
  role: ConversationRole
  content: string
  timestamp: number
  status?: MessageStatus
  usage?: ChatUsage
  /** Jarvis spoke on his own initiative (timer fired, startup greeting…): always voiced. */
  proactive?: boolean
  /** Reply arrived as a stream and its sentences were already queued for speech. */
  streamed?: boolean
}

/**
 * Speech types mirroring the real OpenJarvis endpoints
 * (captured from http://127.0.0.1:8000 on 2026-10-01).
 */

/** GET /v1/speech/health → {"available":true,"backend":"faster-whisper"} */
export interface SpeechHealthResponse {
  available: boolean
  backend?: string
  reason?: string
}

/** GET /v1/speech/tts/health → {"available":false,"reason":"No text-to-speech backend available"} */
export interface TtsHealthResponse {
  available: boolean
  /** Backend id, e.g. "kokoro". */
  backend?: string
  /** Default voice id configured on the backend, e.g. "im_nicola". */
  voice_id?: string
  voice?: string
  reason?: string
}

/**
 * POST /v1/speech/transcribe (multipart: file=<audio>, language=<iso>)
 * → {"text":"…","language":"it","confidence":1,"duration_seconds":2.9}
 */
export interface TranscribeResponse {
  text: string
  language: string | null
  confidence: number | null
  duration_seconds: number | null
}

/** components/schemas/SpeechSynthesizeRequest (POST /v1/speech/synthesize → audio/wav). */
export interface SpeechSynthesizeRequest {
  text: string
  voice_id?: string | null
  speed?: number | null
}

/** Voice pipeline state shown in the HUD. */
export type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'TRANSCRIBING'
  | 'REASONING'
  | 'RESPONSE'
  | 'SPEAKING'
  | 'ERROR'

export type SpeechProvider = 'openjarvis' | 'browser' | 'none'

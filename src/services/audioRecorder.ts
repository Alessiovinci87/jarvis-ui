/**
 * Microphone capture built on MediaRecorder + Web Audio (no dependencies).
 * Detects end of speech from the signal level so the user does not have to
 * click twice, and exposes a live level for the UI.
 */

export type RecorderErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'no-microphone'
  | 'device-busy'
  | 'unknown'

export class RecorderError extends Error {
  readonly code: RecorderErrorCode
  constructor(code: RecorderErrorCode, message: string) {
    super(message)
    this.name = 'RecorderError'
    this.code = code
  }
}

export interface RecorderOptions {
  /** Silence (ms) after detected speech that ends the recording. */
  silenceMs?: number
  /** Hard cap on recording length (ms). */
  maxMs?: number
  /** RMS threshold (0..1) that counts as speech. */
  threshold?: number
  /** Called when end-of-speech is detected (recording stops automatically). */
  onAutoStop?: () => void
  /** Called ~20 times per second with the current RMS level (0..1). */
  onLevel?: (level: number) => void
}

export interface Recording {
  blob: Blob
  mimeType: string
  /** True when the stop was triggered by silence detection. */
  auto: boolean
  durationMs: number
}

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

function mapGetUserMediaError(err: unknown): RecorderError {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new RecorderError('permission-denied', 'microphone permission denied')
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new RecorderError('no-microphone', 'no microphone available')
    case 'NotReadableError':
    case 'AbortError':
      return new RecorderError('device-busy', 'microphone is busy or unreadable')
    default:
      return new RecorderError('unknown', err instanceof Error ? err.message : String(err))
  }
}

export class AudioRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private chunks: BlobPart[] = []
  private levelTimer: number | undefined
  private startedAt = 0
  private speechDetected = false
  private lastVoiceAt = 0
  private autoStopped = false
  private lastResult: Recording | null = null
  private stopResolve: ((r: Recording) => void) | null = null
  private readonly opts: Required<Pick<RecorderOptions, 'silenceMs' | 'maxMs' | 'threshold'>> &
    RecorderOptions

  constructor(options: RecorderOptions = {}) {
    this.opts = { silenceMs: 1300, maxMs: 15_000, threshold: 0.02, ...options }
  }

  /** True while recording; false once stopped for any reason. */
  get active(): boolean {
    return this.recorder?.state === 'recording'
  }

  /** True when the recorder finished on its own and audio is waiting to be collected. */
  get finished(): boolean {
    return this.lastResult !== null
  }

  async start(): Promise<void> {
    if (!isRecordingSupported()) {
      throw new RecorderError('unsupported', 'MediaRecorder is not available in this browser')
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
    } catch (err) {
      throw mapGetUserMediaError(err)
    }

    const mimeType = pickMimeType()
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.lastResult = null
    this.speechDetected = false
    this.autoStopped = false
    this.startedAt = performance.now()
    this.lastVoiceAt = this.startedAt

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || mimeType || 'audio/webm' })
      const result: Recording = {
        blob,
        mimeType: blob.type,
        auto: this.autoStopped,
        durationMs: performance.now() - this.startedAt,
      }
      this.lastResult = result
      this.cleanup()
      this.stopResolve?.(result)
      this.stopResolve = null
    }

    // If the input track ends by itself (device unplugged, fake device file over)
    // the recorder stops without our stop(): mark it so the caller can collect the audio.
    this.stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (this.recorder && this.recorder.state === 'recording') {
          this.autoStopped = true
          this.opts.onAutoStop?.()
          this.recorder.stop()
        }
      }
    })

    // Level metering for end-of-speech detection.
    try {
      this.context = new AudioContext()
      const source = this.context.createMediaStreamSource(this.stream)
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = 1024
      source.connect(this.analyser)
      const buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
      this.levelTimer = window.setInterval(() => this.meter(buf), 50)
    } catch {
      // Metering is optional: without it the user stops manually or by max duration.
    }

    this.recorder.start(250)
  }

  private meter(buf: Float32Array<ArrayBuffer>) {
    if (!this.analyser || !this.recorder || this.recorder.state !== 'recording') return
    this.analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    this.opts.onLevel?.(Math.min(1, rms * 6))

    const now = performance.now()
    if (rms > this.opts.threshold) {
      this.speechDetected = true
      this.lastVoiceAt = now
    }
    const elapsed = now - this.startedAt
    const silentFor = now - this.lastVoiceAt
    const endOfSpeech = this.speechDetected && elapsed > 1000 && silentFor > this.opts.silenceMs
    if (endOfSpeech || elapsed > this.opts.maxMs) {
      this.autoStopped = true
      this.opts.onAutoStop?.()
      void this.stop()
    }
  }

  /** Stops and resolves with the recorded audio. */
  stop(): Promise<Recording> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        // Already stopped (track ended or auto-stop): hand back what was captured.
        if (this.lastResult) {
          resolve(this.lastResult)
          return
        }
        if (this.chunks.length > 0) {
          const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' })
          this.cleanup()
          resolve({ blob, mimeType: blob.type, auto: this.autoStopped, durationMs: performance.now() - this.startedAt })
          return
        }
        this.cleanup()
        resolve({ blob: new Blob(), mimeType: '', auto: this.autoStopped, durationMs: 0 })
        return
      }
      this.stopResolve = resolve
      this.recorder.stop()
    })
  }

  /** Discards the current recording without resolving a result. */
  cancel(): void {
    this.stopResolve = null
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.cleanup()
  }

  private cleanup() {
    window.clearInterval(this.levelTimer)
    this.levelTimer = undefined
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.context?.close().catch(() => undefined)
    this.context = null
    this.analyser = null
    this.recorder = null
  }
}

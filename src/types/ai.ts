export type NodeId =
  | 'MEMORY'
  | 'REASONING'
  | 'TOOLS'
  | 'VOICE'
  | 'VISION'
  | 'AGENTS'
  | 'KNOWLEDGE'
  | 'SYSTEM'

export type Vec3 = [number, number, number]

export interface NeuralNodeDef {
  id: NodeId
  label: string
  position: Vec3
}

export interface NeuralConnectionDef {
  from: NodeId
  to: NodeId
}

/** High-level phase of the simulated assistant loop. */
export type AiPhase =
  | 'IDLE'
  | 'REASONING'
  | 'MEMORY'
  | 'TOOLS'
  | 'RESPONSE'
  | 'ERROR'
  | 'LISTENING'
  | 'TRANSCRIBING'
  | 'SPEAKING'
  | 'MEMORY_STORE'

/** Which functional regions light up for each phase. */
export const PHASE_NODES: Record<AiPhase, NodeId[]> = {
  IDLE: [],
  REASONING: ['REASONING'],
  MEMORY: ['MEMORY'],
  TOOLS: ['TOOLS'],
  RESPONSE: ['VOICE', 'REASONING'],
  ERROR: ['SYSTEM'],
  LISTENING: ['VOICE'],
  TRANSCRIBING: ['VOICE', 'REASONING'],
  SPEAKING: ['VOICE'],
  MEMORY_STORE: ['MEMORY'],
}

/** Human-readable phase label for the HUD. */
export const PHASE_LABEL: Record<AiPhase, string> = {
  IDLE: 'ACTIVE',
  REASONING: 'REASONING',
  MEMORY: 'MEMORY',
  TOOLS: 'TOOLS',
  RESPONSE: 'RESPONSE',
  ERROR: 'ERROR',
  LISTENING: 'LISTENING',
  TRANSCRIBING: 'TRANSCRIBING',
  SPEAKING: 'SPEAKING',
  MEMORY_STORE: 'STORING',
}

export interface ActivityEvent {
  id: number
  timestamp: number
  message: string
  node: NodeId | null
}

export interface AiActivityState {
  phase: AiPhase
  /** Nodes currently lit up. */
  activeNodes: ReadonlySet<NodeId>
  events: ActivityEvent[]
}

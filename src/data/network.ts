import type { NeuralConnectionDef, NeuralNodeDef, NodeId } from '../types/ai'

/**
 * Nodes are arranged on a loose shell around the core (origin).
 * Positions are hand-tuned so labels do not overlap at 16:9.
 */
export const NODES: NeuralNodeDef[] = [
  { id: 'REASONING', label: 'REASONING', position: [0, 2.9, 0.4] },
  { id: 'MEMORY', label: 'MEMORY', position: [-3.1, 1.6, -0.6] },
  { id: 'KNOWLEDGE', label: 'KNOWLEDGE', position: [3.1, 1.6, -0.8] },
  { id: 'TOOLS', label: 'TOOLS', position: [-3.6, -0.6, 0.5] },
  { id: 'AGENTS', label: 'AGENTS', position: [3.6, -0.6, 0.3] },
  { id: 'VOICE', label: 'VOICE', position: [-1.9, -2.6, -0.4] },
  { id: 'VISION', label: 'VISION', position: [1.9, -2.6, -0.7] },
  { id: 'SYSTEM', label: 'SYSTEM', position: [0, -3.0, 0.8] },
]

export const CONNECTIONS: NeuralConnectionDef[] = [
  { from: 'REASONING', to: 'MEMORY' },
  { from: 'REASONING', to: 'KNOWLEDGE' },
  { from: 'REASONING', to: 'TOOLS' },
  { from: 'REASONING', to: 'AGENTS' },
  { from: 'MEMORY', to: 'KNOWLEDGE' },
  { from: 'MEMORY', to: 'TOOLS' },
  { from: 'KNOWLEDGE', to: 'AGENTS' },
  { from: 'TOOLS', to: 'VOICE' },
  { from: 'TOOLS', to: 'AGENTS' },
  { from: 'AGENTS', to: 'VISION' },
  { from: 'VOICE', to: 'SYSTEM' },
  { from: 'VISION', to: 'SYSTEM' },
  { from: 'VOICE', to: 'VISION' },
  { from: 'SYSTEM', to: 'TOOLS' },
  { from: 'SYSTEM', to: 'AGENTS' },
]

export const NODE_MAP: Record<NodeId, NeuralNodeDef> = Object.fromEntries(
  NODES.map((n) => [n.id, n]),
) as Record<NodeId, NeuralNodeDef>

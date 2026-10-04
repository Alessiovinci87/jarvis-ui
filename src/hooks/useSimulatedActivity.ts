import { useEffect, useMemo, useState } from 'react'
import type { ActivityEvent, AiActivityState, AiPhase, NodeId } from '../types/ai'

interface Step {
  phase: AiPhase
  nodes: NodeId[]
  message: string | null
  duration: number
}

/** Demo loop: IDLE → REASONING → MEMORY → TOOLS → REASONING → RESPONSE → IDLE */
const SCRIPT: Step[] = [
  { phase: 'IDLE', nodes: [], message: null, duration: 4000 },
  { phase: 'REASONING', nodes: ['REASONING'], message: 'reasoning', duration: 2200 },
  { phase: 'MEMORY', nodes: ['MEMORY', 'KNOWLEDGE'], message: 'memory retrieval', duration: 2000 },
  { phase: 'TOOLS', nodes: ['TOOLS', 'AGENTS'], message: 'tool execution', duration: 2400 },
  { phase: 'REASONING', nodes: ['REASONING'], message: 'synthesizing result', duration: 1800 },
  { phase: 'RESPONSE', nodes: ['VOICE', 'SYSTEM'], message: 'response composed', duration: 2000 },
  { phase: 'IDLE', nodes: [], message: 'idle', duration: 5000 },
  { phase: 'REASONING', nodes: ['VISION', 'REASONING'], message: 'vision analysis', duration: 2200 },
  { phase: 'MEMORY', nodes: ['MEMORY'], message: 'memory write', duration: 1600 },
  { phase: 'RESPONSE', nodes: ['VOICE'], message: 'response composed', duration: 1800 },
]

const MAX_EVENTS = 8

/**
 * @param paused When true the loop freezes in IDLE (used while a real
 * request drives the visuals). Events already logged are kept.
 */
export function useSimulatedActivity(paused = false): AiActivityState {
  const [stepIndex, setStepIndex] = useState(0)
  const [events, setEvents] = useState<ActivityEvent[]>(() => [
    { id: 0, timestamp: Date.now(), message: 'system online', node: 'SYSTEM' },
  ])

  useEffect(() => {
    if (paused) return
    const step = SCRIPT[stepIndex]
    const timer = window.setTimeout(() => {
      const nextIndex = (stepIndex + 1) % SCRIPT.length
      const next = SCRIPT[nextIndex]
      if (next.message) {
        setEvents((prev) => {
          const event: ActivityEvent = {
            id: (prev[0]?.id ?? 0) + 1,
            timestamp: Date.now(),
            message: next.message!,
            node: next.nodes[0] ?? null,
          }
          return [event, ...prev].slice(0, MAX_EVENTS)
        })
      }
      setStepIndex(nextIndex)
    }, step.duration)
    return () => window.clearTimeout(timer)
  }, [stepIndex, paused])

  const step = paused ? SCRIPT[0] : SCRIPT[stepIndex]
  const activeNodes = useMemo(() => new Set<NodeId>(step.nodes), [step])

  return { phase: step.phase, activeNodes, events }
}

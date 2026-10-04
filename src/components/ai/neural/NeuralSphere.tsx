import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { AiPhase, NodeId } from '../../../types/ai'
import { FunctionalRegions, type RegionLabelRegistry } from './FunctionalRegions'
import { NeuralFilaments } from './NeuralFilaments'
import { NeuralParticles } from './NeuralParticles'
import { NeuralPulse, ResponseWave } from './NeuralPulse'
import { REGIONS, createRuntime, generateSphere, type SphereRuntime } from './sphereData'

interface NeuralSphereProps {
  phase: AiPhase
  activeNodes: ReadonlySet<NodeId>
  labelRegistry: RefObject<RegionLabelRegistry>
  /** Receives the shared runtime so the core can read activity levels. */
  runtimeRef?: RefObject<SphereRuntime | null>
  /** Live microphone level 0..1 while listening. */
  voiceLevel?: number
}

const WAVE_DURATION = 1.4
const GLITCH_DECAY = 2.8

/** Mutable per-frame state. A single sphere exists per scene, so one shared instance is enough. */
const runtime = createRuntime()

/**
 * The "energetic brain": composes micro-nodes, filaments, pulses and
 * functional regions. Owns the per-frame runtime state that every layer
 * reads, so React never re-renders during animation.
 */
export function NeuralSphere({ phase, activeNodes, labelRegistry, runtimeRef, voiceLevel = 0 }: NeuralSphereProps) {
  const data = useMemo(() => generateSphere(7, 280), [])
  const group = useRef<THREE.Group>(null)
  const prevPhase = useRef<AiPhase>('IDLE')
  const waveStart = useRef(-1)

  useEffect(() => {
    if (runtimeRef) runtimeRef.current = runtime
  }, [runtimeRef])

  // Runs before every other useFrame (negative priority) so children see
  // this frame's values.
  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime()
    runtime.time = t
    const dt = Math.min(delta, 0.05)
    const k = 1 - Math.exp(-dt * 4)

    // Voice level: fast attack so syllables show, slower release so it does not flicker.
    const voiceTarget = phase === 'LISTENING' ? Math.min(1, voiceLevel * 1.6) : 0
    const vk = 1 - Math.exp(-dt * (voiceTarget > runtime.voice ? 18 : 6))
    runtime.voice += (voiceTarget - runtime.voice) * vk

    // Phase transitions → one-shot effects.
    if (phase !== prevPhase.current) {
      const wasResponse = prevPhase.current === 'RESPONSE'
      if (phase === 'RESPONSE' || (phase === 'SPEAKING' && !wasResponse)) waveStart.current = t
      if (phase === 'ERROR') runtime.glitch = 1
      prevPhase.current = phase
    }

    runtime.mode =
      phase === 'LISTENING'
        ? 'listening'
        : phase === 'SPEAKING'
          ? 'speaking'
          : phase === 'MEMORY_STORE'
            ? 'memory-store'
            : phase === 'MEMORY'
              ? 'memory-retrieve'
              : phase === 'IDLE'
                ? 'idle'
                : 'active'

    // Region activation targets.
    for (let i = 0; i < REGIONS.length; i++) {
      const id = REGIONS[i].id
      let target = activeNodes.has(id) ? 1 : 0
      let rate = k
      if (phase === 'REASONING' && id === 'REASONING') target = 1
      if (phase === 'SPEAKING' && id === 'VOICE') {
        // Rhythmic pulsing while Jarvis talks.
        target = 0.6 + 0.4 * Math.max(0, Math.sin(t * 6.5) * 0.7 + Math.sin(t * 11.3) * 0.3)
        rate = 1 - Math.exp(-dt * 14)
      }
      if (phase === 'LISTENING' && id === 'VOICE') target = 0.85 + Math.sin(t * 2.2) * 0.15
      if (runtime.hovered === id) target = Math.max(target, 0.65)
      runtime.activation[i] += (target - runtime.activation[i]) * rate
    }

    const activityTarget =
      phase === 'IDLE'
        ? 0
        : phase === 'ERROR'
          ? 0.5
          : phase === 'LISTENING'
            ? 0.45
            : phase === 'TRANSCRIBING'
              ? 0.7
              : phase === 'SPEAKING'
                ? 0.6
                : phase === 'MEMORY_STORE' || phase === 'MEMORY'
                  ? 0.75
                  : 1
    runtime.activity += (activityTarget + runtime.voice * 0.5 - runtime.activity) * k

    runtime.wave = waveStart.current >= 0 ? (t - waveStart.current) / WAVE_DURATION : -1
    if (runtime.wave > 1) {
      runtime.wave = -1
      waveStart.current = -1
    }

    runtime.glitch = Math.max(0, runtime.glitch - dt * GLITCH_DECAY)

    const g = group.current
    if (g) {
      // Gentle sway instead of full rotation keeps regions where users expect them.
      g.rotation.y = Math.sin(t * 0.09) * 0.22
      g.rotation.x = Math.sin(t * 0.07 + 1) * 0.08
      g.rotation.z = Math.sin(t * 0.05) * 0.04
      // Controlled jitter during ERROR: fast pseudo-random offsets from time.
      const jitter = runtime.glitch * 0.06
      g.position.set(Math.sin(t * 173.3) * jitter, Math.cos(t * 191.7) * jitter, 0)
    }
  }, -1)

  return (
    <group ref={group}>
      <NeuralFilaments data={data} runtime={runtime} />
      <NeuralParticles data={data} runtime={runtime} />
      <NeuralPulse data={data} runtime={runtime} />
      <ResponseWave runtime={runtime} />
      <FunctionalRegions runtime={runtime} anchorGroup={group} registry={labelRegistry} />
    </group>
  )
}

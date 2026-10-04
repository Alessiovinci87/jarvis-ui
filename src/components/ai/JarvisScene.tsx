import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import type { AiPhase, NodeId } from '../../types/ai'
import { CameraRig } from './CameraRig'
import { JarvisCore } from './JarvisCore'
import { RegionLabelLayer, type RegionLabelRegistry } from './neural/FunctionalRegions'
import { NeuralSphere } from './neural/NeuralSphere'
import type { SphereRuntime } from './neural/sphereData'
import { Particles } from './Particles'

/** How bright the core gets in each phase (0 idle … 1 full). */
const CORE_INTENSITY: Record<AiPhase, number> = {
  IDLE: 0,
  REASONING: 1,
  MEMORY: 0.8,
  TOOLS: 0.8,
  RESPONSE: 1,
  ERROR: 0.6,
  LISTENING: 0.35,
  TRANSCRIBING: 0.7,
  SPEAKING: 0.6,
  MEMORY_STORE: 0.7,
}

interface JarvisSceneProps {
  phase: AiPhase
  activeNodes: ReadonlySet<NodeId>
  /** Live microphone level 0..1 while listening: the brain lights up with the voice. */
  voiceLevel?: number
}

export function JarvisScene({ phase, activeNodes, voiceLevel = 0 }: JarvisSceneProps) {
  const registry = useRef<RegionLabelRegistry>(new Map())
  const runtime = useRef<SphereRuntime | null>(null)

  return (
    <>
      <Canvas
        className="scene"
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 10.5], fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <CameraRig />
        <ambientLight intensity={0.25} />
        <Particles count={160} />
        <JarvisCore intensity={CORE_INTENSITY[phase]} runtime={runtime} />
        <NeuralSphere
          phase={phase}
          activeNodes={activeNodes}
          voiceLevel={voiceLevel}
          labelRegistry={registry}
          runtimeRef={runtime}
        />
      </Canvas>
      <RegionLabelLayer registry={registry} />
    </>
  )
}

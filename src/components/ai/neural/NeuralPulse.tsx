import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getRingTexture } from '../glowTexture'
import { createGlowPointsMaterial } from './glowPointsMaterial'
import {
  REGION_INDEX,
  filamentActivation,
  quadBezier,
  rng,
  type SphereData,
  type SphereRuntime,
} from './sphereData'

interface NeuralPulseProps {
  data: SphereData
  runtime: SphereRuntime
  count?: number
}

const BASE = new THREE.Color('#9eeeff')
const p = new THREE.Vector3()

interface PulseState {
  filament: Int32Array
  progress: Float32Array
  speed: Float32Array
  dir: Int8Array
  rand: () => number
}

function createPulseState(count: number, filamentCount: number): PulseState {
  const rand = rng(1234)
  const filament = new Int32Array(count)
  const progress = new Float32Array(count)
  const speed = new Float32Array(count)
  const dir = new Int8Array(count)
  for (let i = 0; i < count; i++) {
    filament[i] = Math.floor(rand() * filamentCount)
    progress[i] = rand()
    speed[i] = 0.12 + rand() * 0.35
    dir[i] = rand() < 0.5 ? 1 : -1
  }
  return { filament, progress, speed, dir, rand }
}

/**
 * Travelling pulses along filaments. A single Points layer; each pulse keeps
 * its filament index, progress and speed in typed arrays.
 */
export function NeuralPulse({ data, runtime, count = 160 }: NeuralPulseProps) {
  const points = useRef<THREE.Points>(null)

  // Mutable pulse bookkeeping; created lazily on the first frame.
  const stateRef = useRef<PulseState | null>(null)

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage),
    )
    const rand = rng(4321)
    const size = new Float32Array(count)
    for (let i = 0; i < count; i++) size[i] = 0.16 + rand() * 0.16
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute(
      'aColor',
      new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage),
    )
    return g
  }, [count])

  const material = useMemo(() => createGlowPointsMaterial(), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_, delta) => {
    const pts = points.current
    if (!pts) return
    if (!stateRef.current) stateRef.current = createPulseState(count, data.filaments.length)
    const state = stateRef.current
    const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute
    const col = pts.geometry.getAttribute('aColor') as THREE.BufferAttribute
    const dt = Math.min(delta, 0.05)

    // Idle shows a sparse set of pulses; activity reveals more of them.
    const visible = Math.floor(count * (0.3 + runtime.activity * 0.7))

    const total = data.filaments.length
    for (let i = 0; i < count; i++) {
      let fi = state.filament[i]
      let act = filamentActivation(data, runtime, fi)
      state.progress[i] += dt * state.speed[i] * (1 + act * 2.2 + runtime.activity * 0.5)
      if (state.progress[i] >= 1) {
        // Respawn on a new filament, biased towards active regions.
        const memoryFlow = runtime.mode === 'memory-store' || runtime.mode === 'memory-retrieve'
        let best = Math.floor(state.rand() * total)
        const tries = memoryFlow ? 6 : 3
        for (let k = 0; k < tries; k++) {
          const cand = Math.floor(state.rand() * total)
          if (memoryFlow) {
            // Prefer filaments touching the MEMORY region or the inner core.
            const fc = data.filaments[cand]
            const ra = REGION_INDEX[data.nodes[fc.a].region]
            const rb = REGION_INDEX[data.nodes[fc.b].region]
            const memIdx = REGION_INDEX.MEMORY
            const coreIdx = REGION_INDEX.REASONING
            const touches = ra === memIdx || rb === memIdx || ra === coreIdx || rb === coreIdx
            if (touches && filamentActivation(data, runtime, cand) >= filamentActivation(data, runtime, best)) best = cand
          } else if (filamentActivation(data, runtime, cand) > filamentActivation(data, runtime, best)) {
            best = cand
          }
        }
        fi = best
        act = filamentActivation(data, runtime, fi)
        state.filament[i] = fi
        state.progress[i] = 0
        const fa = data.filaments[fi]
        const outwardFirst = data.nodes[fa.a].radius >= data.nodes[fa.b].radius
        if (runtime.mode === 'listening' || runtime.mode === 'memory-retrieve') {
          // Converge towards the core: MEMORY → REASONING, mic → core.
          state.dir[i] = outwardFirst ? 1 : -1
        } else if (runtime.mode === 'memory-store') {
          // Core → MEMORY: travel outward.
          state.dir[i] = outwardFirst ? -1 : 1
        } else {
          state.dir[i] = state.rand() < 0.5 ? 1 : -1
        }
        state.speed[i] = 0.12 + state.rand() * 0.35
      }

      const f = data.filaments[fi]
      const tt = state.dir[i] > 0 ? state.progress[i] : 1 - state.progress[i]
      quadBezier(data.nodes[f.a].position, f.ctrl, data.nodes[f.b].position, tt, p)
      pos.setXYZ(i, p.x, p.y, p.z)

      // Fade in/out at the ends of the filament so pulses do not pop.
      const edgeFade = Math.min(1, Math.min(state.progress[i], 1 - state.progress[i]) * 6)
      let intensity = i < visible ? (0.35 + act * 1.1 + (f.bright ? 0.2 : 0)) * edgeFade : 0
      if (runtime.glitch > 0.01) intensity *= 1 - runtime.glitch * 0.7
      col.setXYZ(i, BASE.r * intensity, BASE.g * intensity, BASE.b * intensity)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  })

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
}

/**
 * Radial wave emitted from the core when a response arrives: a camera-facing
 * luminous ring that expands and fades. Driven by runtime.wave (0..1).
 */
export function ResponseWave({ runtime }: { runtime: SphereRuntime }) {
  const ring = useRef<THREE.Sprite>(null)
  const ringInner = useRef<THREE.Sprite>(null)

  useFrame(() => {
    const a = ring.current
    const b = ringInner.current
    if (!a || !b) return
    const w = runtime.wave
    if (w < 0) {
      a.visible = false
      b.visible = false
      return
    }
    a.visible = true
    b.visible = true
    const eased = 1 - Math.pow(1 - w, 2.2)
    const s = 1.6 + eased * 7.2
    a.scale.set(s, s, 1)
    const matA = a.material as THREE.SpriteMaterial
    matA.opacity = (1 - w) * 0.55
    // Second, slower ring trailing behind the first one.
    const w2 = Math.max(0, w - 0.18) / 0.82
    const s2 = 1.6 + (1 - Math.pow(1 - w2, 2.2)) * 6.4
    b.scale.set(s2, s2, 1)
    const matB = b.material as THREE.SpriteMaterial
    matB.opacity = w > 0.18 ? (1 - w2) * 0.3 : 0
  })

  return (
    <group>
      <sprite ref={ring} visible={false}>
        <spriteMaterial
          map={getRingTexture()}
          color="#bff4ff"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      <sprite ref={ringInner} visible={false}>
        <spriteMaterial
          map={getRingTexture()}
          color="#4fd8ff"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
    </group>
  )
}

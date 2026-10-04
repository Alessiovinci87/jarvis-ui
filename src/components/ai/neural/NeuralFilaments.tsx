import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  SEGMENTS_PER_FILAMENT,
  filamentActivation,
  type SphereData,
  type SphereRuntime,
} from './sphereData'

interface NeuralFilamentsProps {
  data: SphereData
  runtime: SphereRuntime
}

const BASE = new THREE.Color('#4fd8ff')
const HOT = new THREE.Color('#e6fbff')
const tmp = new THREE.Color()

/**
 * All curved filaments in a single LineSegments (one draw call). Positions
 * are static; only the vertex colours change each frame.
 */
export function NeuralFilaments({ data, runtime }: NeuralFilamentsProps) {
  const lines = useRef<THREE.LineSegments>(null)
  const filamentCount = data.filaments.length
  const vertsPerFilament = SEGMENTS_PER_FILAMENT * 2

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(filamentCount * vertsPerFilament * 3)
    const stride = (SEGMENTS_PER_FILAMENT + 1) * 3
    for (let fi = 0; fi < filamentCount; fi++) {
      for (let s = 0; s < SEGMENTS_PER_FILAMENT; s++) {
        const src = fi * stride + s * 3
        const dst = (fi * vertsPerFilament + s * 2) * 3
        pos[dst] = data.curvePoints[src]
        pos[dst + 1] = data.curvePoints[src + 1]
        pos[dst + 2] = data.curvePoints[src + 2]
        pos[dst + 3] = data.curvePoints[src + 3]
        pos[dst + 4] = data.curvePoints[src + 4]
        pos[dst + 5] = data.curvePoints[src + 5]
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(pos.length), 3).setUsage(THREE.DynamicDrawUsage),
    )
    return g
  }, [data, filamentCount, vertsPerFilament])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(() => {
    const ls = lines.current
    if (!ls) return
    const colors = ls.geometry.getAttribute('color') as THREE.BufferAttribute
    const arr = colors.array as Float32Array
    const t = runtime.time
    const glitch = runtime.glitch

    for (let fi = 0; fi < filamentCount; fi++) {
      const f = data.filaments[fi]
      const act = filamentActivation(data, runtime, fi)
      // Subtle slow shimmer so idle filaments are never fully static.
      const shimmer = 0.85 + Math.sin(t * 0.9 + fi * 0.37) * 0.15
      let intensity = (0.05 + (f.bright ? 0.07 : 0) + runtime.activity * 0.04) * shimmer + act * 0.55
      if (glitch > 0.01 && Math.sin(t * 61 + fi) > 0.6) intensity += glitch * 0.5

      tmp.copy(BASE).lerp(HOT, act * 0.6)
      const r = tmp.r * intensity
      const g = tmp.g * intensity
      const b = tmp.b * intensity
      const base = fi * vertsPerFilament * 3
      for (let k = 0; k < vertsPerFilament; k++) {
        const o = base + k * 3
        arr[o] = r
        arr[o + 1] = g
        arr[o + 2] = b
      }
    }
    colors.needsUpdate = true
  })

  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  )
}

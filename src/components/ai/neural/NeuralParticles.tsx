import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createGlowPointsMaterial } from './glowPointsMaterial'
import { REGION_INDEX, SPHERE_RADIUS, type SphereData, type SphereRuntime } from './sphereData'

interface NeuralParticlesProps {
  data: SphereData
  runtime: SphereRuntime
}

const DIM = new THREE.Color('#1d7fa3')
const BASE = new THREE.Color('#4fd8ff')
const HOT = new THREE.Color('#d8f8ff')

// Scratch objects reused every frame (single sphere instance per scene).
const dummy = new THREE.Object3D()
const color = new THREE.Color()

/**
 * Micro-nodes: one InstancedMesh for the solid cores plus one Points layer
 * for the soft halos. Two draw calls regardless of node count.
 */
export function NeuralParticles({ data, runtime }: NeuralParticlesProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const halo = useRef<THREE.Points>(null)
  const count = data.nodes.length

  const haloGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const color = new Float32Array(count * 3)
    data.nodes.forEach((n, i) => {
      pos.set([n.position.x, n.position.y, n.position.z], i * 3)
      size[i] = 0.28 + n.size * 0.55
    })
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage))
    return g
  }, [data, count])

  const haloMaterial = useMemo(() => createGlowPointsMaterial(), [])

  useEffect(() => {
    return () => {
      haloGeometry.dispose()
      haloMaterial.dispose()
    }
  }, [haloGeometry, haloMaterial])

  useFrame(() => {
    const im = mesh.current
    const pts = halo.current
    if (!im || !pts) return
    const t = runtime.time
    const haloColors = pts.geometry.getAttribute('aColor') as THREE.BufferAttribute
    const glitch = runtime.glitch

    for (let i = 0; i < count; i++) {
      const n = data.nodes[i]
      const act = runtime.activation[REGION_INDEX[n.region]]
      const breathe = 1 + Math.sin(t * 1.3 + n.phase) * 0.12
      // Depth cue: nodes on the far side of the sphere are smaller and dimmer.
      const depth = 0.55 + 0.45 * THREE.MathUtils.clamp((n.position.z / SPHERE_RADIUS + 1) * 0.5, 0, 1)
      const scale = (0.02 + n.size * 0.045) * breathe * depth * (1 + act * 0.9 + runtime.activity * 0.15)

      dummy.position.copy(n.position)
      if (glitch > 0.01) {
        dummy.position.x += (Math.sin(t * 97 + i) * 0.5) * glitch * 0.12
        dummy.position.y += (Math.cos(t * 83 + i * 3) * 0.5) * glitch * 0.12
      }
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      im.setMatrixAt(i, dummy.matrix)

      // Core colour: dim cyan → cyan → near white when the region is active.
      color.copy(DIM).lerp(BASE, Math.min(1, 0.25 + n.size * 0.5 + runtime.activity * 0.3))
      color.lerp(HOT, act * 0.85)
      if (glitch > 0.01) color.lerp(HOT, glitch * 0.6)
      color.multiplyScalar(0.55 + depth * 0.45)
      im.setColorAt(i, color)

      const haloIntensity =
        (0.08 + n.size * 0.12 + act * 0.75 + runtime.activity * 0.08) *
        depth *
        (0.9 + Math.sin(t * 1.3 + n.phase) * 0.1)
      haloColors.setXYZ(i, BASE.r * haloIntensity, BASE.g * haloIntensity, BASE.b * haloIntensity)
    }

    im.instanceMatrix.needsUpdate = true
    if (im.instanceColor) im.instanceColor.needsUpdate = true
    haloColors.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <points ref={halo} geometry={haloGeometry} material={haloMaterial} frustumCulled={false} />
    </group>
  )
}

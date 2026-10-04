import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CYAN_DIM, getGlowTexture } from './glowTexture'

interface ParticlesProps {
  count?: number
  spread?: number
}

/** Sparse dust floating slowly in the background. */
export function Particles({ count = 220, spread = 18 }: ParticlesProps) {
  const ref = useRef<THREE.Points>(null)

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    // Deterministic LCG so the field is stable across re-renders.
    let s = 1234
    const rnd = () => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rnd() - 0.5) * spread
      arr[i * 3 + 1] = (rnd() - 0.5) * spread * 0.6
      arr[i * 3 + 2] = (rnd() - 0.5) * spread * 0.5 - 2
    }
    return arr
  }, [count, spread])

  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    ref.current.rotation.y = t * 0.012
    ref.current.rotation.x = Math.sin(t * 0.05) * 0.03
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={getGlowTexture()}
        color={CYAN_DIM}
        size={0.09}
        sizeAttenuation
        transparent
        opacity={0.55}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

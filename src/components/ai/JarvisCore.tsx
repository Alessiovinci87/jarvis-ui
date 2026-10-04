import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createGlowPointsMaterial } from './neural/glowPointsMaterial'
import { rng, type SphereRuntime } from './neural/sphereData'
import { CYAN, CYAN_DIM, getGlowTexture } from './glowTexture'

interface RingProps {
  radius: number
  tube: number
  tilt: [number, number, number]
  speed: number
  opacity: number
}

function Ring({ radius, tube, tilt, speed, opacity }: RingProps) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (!ref.current) return
    ref.current.rotation.z += delta * speed
    ref.current.rotation.x += delta * speed * 0.15
  })
  return (
    <mesh ref={ref} rotation={tilt}>
      <torusGeometry args={[radius, tube, 6, 96]} />
      <meshBasicMaterial
        color={CYAN}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

/** Tiny sparks orbiting inside the nucleus (one Points draw call). */
function InnerImpulses({ runtime }: { runtime: RefObject<SphereRuntime | null> }) {
  const COUNT = 36
  const points = useRef<THREE.Points>(null)
  const seeds = useMemo(() => {
    const rand = rng(99)
    const arr: { r: number; a: number; b: number; s: number; size: number }[] = []
    for (let i = 0; i < COUNT; i++) {
      arr.push({
        r: 0.25 + rand() * 0.45,
        a: rand() * Math.PI * 2,
        b: rand() * Math.PI,
        s: (0.4 + rand() * 0.9) * (rand() < 0.5 ? 1 : -1),
        size: 0.1 + rand() * 0.12,
      })
    }
    return arr
  }, [])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from(seeds, (s) => s.size), 1))
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage))
    return g
  }, [seeds])
  const material = useMemo(() => createGlowPointsMaterial(), [])
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useFrame(({ clock }) => {
    const pts = points.current
    if (!pts) return
    const t = clock.getElapsedTime()
    const activity = runtime.current?.activity ?? 0
    const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute
    const col = pts.geometry.getAttribute('aColor') as THREE.BufferAttribute
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i]
      const a = s.a + t * s.s * (0.6 + activity * 1.2)
      const b = s.b + Math.sin(t * 0.7 + i) * 0.4
      const r = s.r * (0.9 + Math.sin(t * 2 + i) * 0.1)
      pos.setXYZ(i, r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a))
      const intensity = (0.35 + activity * 0.9) * (0.7 + Math.sin(t * 3 + i * 1.7) * 0.3)
      col.setXYZ(i, 0.85 * intensity, 0.98 * intensity, 1.0 * intensity)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  })

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
}

interface JarvisCoreProps {
  /** 0 = idle, 1 = fully active. Drives pulse intensity. */
  intensity: number
  runtime: RefObject<SphereRuntime | null>
}

export function JarvisCore({ intensity, runtime }: JarvisCoreProps) {
  const group = useRef<THREE.Group>(null)
  const nucleus = useRef<THREE.Mesh>(null)
  const mantle = useRef<THREE.Mesh>(null)
  const shellA = useRef<THREE.Mesh>(null)
  const shellB = useRef<THREE.Mesh>(null)
  const glowNear = useRef<THREE.Sprite>(null)
  const glowFar = useRef<THREE.Sprite>(null)
  const light = useRef<THREE.PointLight>(null)
  const smoothed = useRef(0)

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime()
    smoothed.current += (intensity - smoothed.current) * Math.min(1, delta * 2.5)
    const glitch = runtime.current?.glitch ?? 0
    // Voice feedback: while Alessio talks, the core brightens and swells with the mic level.
    const voice = runtime.current?.voice ?? 0
    const k = Math.min(1.4, smoothed.current + voice * 0.9)

    const slow = Math.sin(t * 1.1)
    const fast = Math.sin(t * 3.4)
    const pulse = 1 + slow * 0.04 + fast * 0.012 + k * 0.09 + voice * 0.1

    if (nucleus.current) {
      nucleus.current.scale.setScalar(pulse * (1 - glitch * 0.08))
      nucleus.current.rotation.y = t * 0.18
      nucleus.current.rotation.z = t * 0.06
      const mat = nucleus.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.85 + k * 1.1 + fast * 0.06 + glitch * 1.5
    }
    if (mantle.current) {
      mantle.current.scale.setScalar(1.18 + slow * 0.03 + k * 0.1)
      mantle.current.rotation.y = -t * 0.1
      const mat = mantle.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.16 + k * 0.14 + Math.sin(t * 1.7) * 0.03
    }
    if (shellA.current) {
      shellA.current.rotation.y = -t * 0.08
      shellA.current.rotation.x = t * 0.05
      const mat = shellA.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.2 + k * 0.18 + Math.sin(t * 2) * 0.03 + glitch * 0.3
    }
    if (shellB.current) {
      shellB.current.rotation.y = t * 0.05
      shellB.current.rotation.z = -t * 0.04
      const mat = shellB.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.08 + k * 0.1
    }
    if (glowNear.current) {
      const s = 3.6 + slow * 0.2 + k * 1.1
      glowNear.current.scale.set(s, s, 1)
      ;(glowNear.current.material as THREE.SpriteMaterial).opacity = 0.42 + k * 0.3
    }
    if (glowFar.current) {
      const s = 7.5 + slow * 0.4 + k * 2.2
      glowFar.current.scale.set(s, s, 1)
      ;(glowFar.current.material as THREE.SpriteMaterial).opacity = 0.14 + k * 0.14
    }
    if (light.current) light.current.intensity = 5 + k * 6 + glitch * 4 + voice * 6
    if (group.current) group.current.rotation.y = t * 0.03
  })

  return (
    <group ref={group}>
      {/* Deep outer glow + tighter inner glow */}
      <sprite ref={glowFar}>
        <spriteMaterial map={getGlowTexture()} color="#0f4d66" transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <sprite ref={glowNear}>
        <spriteMaterial map={getGlowTexture()} color={CYAN_DIM} transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>

      {/* Emissive nucleus */}
      <mesh ref={nucleus}>
        <icosahedronGeometry args={[0.5, 3]} />
        <meshStandardMaterial color="#9feaff" emissive={CYAN} emissiveIntensity={0.85} roughness={0.35} metalness={0.05} toneMapped={false} />
      </mesh>

      {/* Translucent mantle layer */}
      <mesh ref={mantle}>
        <sphereGeometry args={[0.5, 32, 24]} />
        <meshBasicMaterial color="#7fe6ff" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* Two wireframe shells rotating in opposite directions */}
      <mesh ref={shellA}>
        <icosahedronGeometry args={[0.85, 1]} />
        <meshBasicMaterial color={CYAN} wireframe transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={shellB}>
        <icosahedronGeometry args={[1.05, 2]} />
        <meshBasicMaterial color={CYAN} wireframe transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      <InnerImpulses runtime={runtime} />

      {/* Concentric rings rotating in different directions */}
      <Ring radius={1.25} tube={0.012} tilt={[Math.PI / 2.2, 0, 0]} speed={0.25} opacity={0.6} />
      <Ring radius={1.5} tube={0.008} tilt={[Math.PI / 3, 0.6, 0]} speed={-0.18} opacity={0.4} />
      <Ring radius={1.75} tube={0.006} tilt={[-Math.PI / 2.6, -0.4, 0.3]} speed={0.12} opacity={0.3} />
      <Ring radius={2.05} tube={0.005} tilt={[Math.PI / 1.7, 0.9, -0.5]} speed={-0.07} opacity={0.18} />

      <pointLight ref={light} color={CYAN} intensity={5} distance={9} decay={2} />
    </group>
  )
}

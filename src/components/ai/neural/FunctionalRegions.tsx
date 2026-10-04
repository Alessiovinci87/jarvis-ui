import { useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from '../glowTexture'
import { REGIONS, REGION_INDEX, SPHERE_RADIUS, type RegionId, type SphereRuntime } from './sphereData'

export type RegionLabelRegistry = Map<RegionId, HTMLSpanElement>

/* ------------------------------------------------------------------ */
/*  3D part: soft region glows + invisible hover targets.               */
/* ------------------------------------------------------------------ */

interface FunctionalRegionsProps {
  runtime: SphereRuntime
  /** Group whose world matrix the labels must follow. */
  anchorGroup: RefObject<THREE.Group | null>
  registry: RefObject<RegionLabelRegistry>
}

const scratch = new THREE.Vector3()

export function FunctionalRegions({ runtime, anchorGroup, registry }: FunctionalRegionsProps) {
  const glows = useRef<(THREE.Sprite | null)[]>([])
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  useFrame(() => {
    const group = anchorGroup.current
    for (let i = 0; i < REGIONS.length; i++) {
      const region = REGIONS[i]
      const act = runtime.activation[i]

      const sprite = glows.current[i]
      if (sprite) {
        const mat = sprite.material as THREE.SpriteMaterial
        mat.opacity = act * (region.id === 'REASONING' ? 0.2 : 0.42)
        const s = (region.id === 'REASONING' ? 2.4 : 3.2) * (0.8 + act * 0.5)
        sprite.scale.set(s, s, 1)
      }

      // DOM label: follow the anchor and fade with activation / hover.
      const el = registry.current.get(region.id)
      if (!el) continue
      scratch.copy(region.anchor)
      if (group) group.localToWorld(scratch)
      scratch.project(camera)
      const px = (scratch.x * 0.5 + 0.5) * size.width
      const py = (-scratch.y * 0.5 + 0.5) * size.height
      el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`
      const hover = runtime.hovered === region.id ? 1 : 0
      const visible = Math.max(act, hover * 0.9)
      el.style.opacity = visible < 0.08 ? '0' : Math.min(1, visible).toFixed(2)
      el.classList.toggle('region-label--active', act > 0.5)
    }
  })

  return (
    <group>
      {REGIONS.map((region, i) => {
        const center =
          region.id === 'REASONING'
            ? new THREE.Vector3(0, 0, 0)
            : region.dir.clone().multiplyScalar(SPHERE_RADIUS * 0.92)
        return (
          <group key={region.id} position={center}>
            <sprite
              ref={(el) => {
                glows.current[i] = el
              }}
            >
              <spriteMaterial
                map={getGlowTexture()}
                color="#3fc6f0"
                transparent
                opacity={0}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </sprite>
            {region.id !== 'REASONING' && (
              <mesh
                visible={false}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  runtime.hovered = region.id
                }}
                onPointerOut={() => {
                  if (runtime.hovered === region.id) runtime.hovered = null
                }}
              >
                <sphereGeometry args={[1.15, 12, 8]} />
                <meshBasicMaterial />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  DOM part: labels rendered next to the canvas (positions set above). */
/* ------------------------------------------------------------------ */

export function RegionLabelLayer({ registry }: { registry: RefObject<RegionLabelRegistry> }) {
  return (
    <div className="labels" aria-hidden="true">
      {REGIONS.map((r) => (
        <span
          key={r.id}
          ref={(el) => {
            if (el) registry.current.set(r.id, el)
            else registry.current.delete(r.id)
          }}
          className="region-label"
          style={{ opacity: 0 }}
          data-region={REGION_INDEX[r.id]}
        >
          {r.label}
        </span>
      ))}
    </div>
  )
}

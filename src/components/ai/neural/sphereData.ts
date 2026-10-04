import * as THREE from 'three'
import type { NodeId } from '../../../types/ai'

/* ------------------------------------------------------------------ */
/*  Procedural generation of the neural sphere: micro-nodes, curved     */
/*  filaments and functional regions. Deterministic (seeded) so the     */
/*  layout is stable across reloads.                                    */
/* ------------------------------------------------------------------ */

export type RegionId = NodeId

export interface RegionDef {
  id: RegionId
  label: string
  /** Unit direction of the region on the sphere (REASONING is the inner core). */
  dir: THREE.Vector3
  /** Where the label is anchored, in world units. */
  anchor: THREE.Vector3
}

export interface MicroNode {
  position: THREE.Vector3
  radius: number
  region: RegionId
  /** 0..1, larger values for a few hub nodes. */
  size: number
  phase: number
}

export interface Filament {
  a: number
  b: number
  /** Quadratic Bézier control point. */
  ctrl: THREE.Vector3
  bright: boolean
  length: number
}

export const SPHERE_RADIUS = 2.75
export const INNER_RADIUS = 1.55
export const SEGMENTS_PER_FILAMENT = 10

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize()

export const REGIONS: RegionDef[] = [
  { id: 'REASONING', label: 'REASONING', dir: v(0, 0, 1), anchor: new THREE.Vector3(0, -1.05, 1.2) },
  { id: 'VISION', label: 'VISION', dir: v(0, 1, 0.1), anchor: new THREE.Vector3(0, 3.35, 0.3) },
  { id: 'VOICE', label: 'VOICE', dir: v(0, -1, 0.15), anchor: new THREE.Vector3(0, -3.35, 0.4) },
  { id: 'MEMORY', label: 'MEMORY', dir: v(-1, 0.15, 0.2), anchor: new THREE.Vector3(-3.45, 0.55, 0.5) },
  { id: 'TOOLS', label: 'TOOLS', dir: v(1, 0.15, 0.2), anchor: new THREE.Vector3(3.45, 0.55, 0.5) },
  { id: 'KNOWLEDGE', label: 'KNOWLEDGE', dir: v(-0.65, 0.55, -0.7), anchor: new THREE.Vector3(-2.3, 2.05, -2.3) },
  { id: 'AGENTS', label: 'AGENTS', dir: v(0.7, -0.35, -0.7), anchor: new THREE.Vector3(2.45, -1.3, -2.3) },
  { id: 'SYSTEM', label: 'SYSTEM', dir: v(0.25, -0.65, 0.75), anchor: new THREE.Vector3(0.9, -2.35, 2.4) },
]

export const REGION_INDEX: Record<RegionId, number> = Object.fromEntries(
  REGIONS.map((r, i) => [r.id, i]),
) as Record<RegionId, number>

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function regionForDirection(dir: THREE.Vector3): RegionId {
  let best: RegionId = 'VISION'
  let bestDot = -Infinity
  for (const r of REGIONS) {
    if (r.id === 'REASONING') continue
    const d = r.dir.dot(dir)
    if (d > bestDot) {
      bestDot = d
      best = r.id
    }
  }
  return best
}

export interface SphereData {
  nodes: MicroNode[]
  filaments: Filament[]
  /** Precomputed polyline points for every filament (SEGMENTS_PER_FILAMENT + 1 each). */
  curvePoints: Float32Array
  /** For each region, the indices of nodes belonging to it. */
  regionNodes: Record<RegionId, number[]>
}

export function generateSphere(seed = 7, nodeCount = 280): SphereData {
  const rand = rng(seed)
  const nodes: MicroNode[] = []
  const tmp = new THREE.Vector3()

  for (let i = 0; i < nodeCount; i++) {
    // Fibonacci-ish spread then jittered so it is not perfectly uniform.
    const u = (i + 0.5) / nodeCount
    const phi = Math.acos(1 - 2 * u) + (rand() - 0.5) * 0.35
    const theta = Math.PI * (1 + Math.sqrt(5)) * i + (rand() - 0.5) * 0.9
    tmp.setFromSphericalCoords(1, phi, theta)

    const inner = rand() < 0.22
    let radius: number
    if (inner) {
      radius = 0.95 + rand() * (INNER_RADIUS - 0.95)
    } else {
      // Irregular shell: lobes + noise so the sphere is not a perfect ball.
      const lobe = 1 + 0.07 * Math.sin(3 * theta + phi * 2) + 0.05 * Math.cos(5 * phi)
      radius = SPHERE_RADIUS * lobe * (0.86 + Math.pow(rand(), 1.6) * 0.3)
    }

    const hub = rand() < 0.12
    nodes.push({
      position: tmp.clone().multiplyScalar(radius),
      radius,
      region: inner ? 'REASONING' : regionForDirection(tmp),
      size: hub ? 0.55 + rand() * 0.45 : 0.12 + rand() * 0.25,
      phase: rand() * Math.PI * 2,
    })
  }

  // Filaments: each node links to a few near neighbours with decreasing probability.
  const filaments: Filament[] = []
  const seen = new Set<string>()
  const maxDist = 1.45
  const mid = new THREE.Vector3()
  const radial = new THREE.Vector3()
  const tangent = new THREE.Vector3()

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    const near: { j: number; d: number }[] = []
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      const d = a.position.distanceTo(nodes[j].position)
      if (d < maxDist) near.push({ j, d })
    }
    near.sort((p, q) => p.d - q.d)
    const probs = [0.75, 0.4, 0.22, 0.1]
    for (let k = 0; k < Math.min(near.length, probs.length); k++) {
      if (rand() > probs[k]) continue
      const j = near[k].j
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key)

      const b = nodes[j]
      mid.addVectors(a.position, b.position).multiplyScalar(0.5)
      radial.copy(mid).normalize()
      tangent.crossVectors(radial, a.position.clone().sub(b.position).normalize())
      const bulge = (rand() - 0.5) * 0.9 * near[k].d
      const sway = (rand() - 0.5) * 0.5 * near[k].d
      const ctrl = mid.clone().addScaledVector(radial, bulge).addScaledVector(tangent, sway)

      filaments.push({ a: i, b: j, ctrl, bright: rand() < 0.15, length: near[k].d })
    }
  }

  // Sample every filament once; consumers only read this buffer afterwards.
  const stride = (SEGMENTS_PER_FILAMENT + 1) * 3
  const curvePoints = new Float32Array(filaments.length * stride)
  const p = new THREE.Vector3()
  filaments.forEach((f, fi) => {
    const A = nodes[f.a].position
    const B = nodes[f.b].position
    for (let s = 0; s <= SEGMENTS_PER_FILAMENT; s++) {
      const t = s / SEGMENTS_PER_FILAMENT
      quadBezier(A, f.ctrl, B, t, p)
      const o = fi * stride + s * 3
      curvePoints[o] = p.x
      curvePoints[o + 1] = p.y
      curvePoints[o + 2] = p.z
    }
  })

  const regionNodes = Object.fromEntries(REGIONS.map((r) => [r.id, [] as number[]])) as Record<
    RegionId,
    number[]
  >
  nodes.forEach((n, i) => regionNodes[n.region].push(i))

  return { nodes, filaments, curvePoints, regionNodes }
}

export function quadBezier(
  a: THREE.Vector3,
  c: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const mt = 1 - t
  out.x = mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x
  out.y = mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y
  out.z = mt * mt * a.z + 2 * mt * t * c.z + t * t * b.z
  return out
}

/* ------------------------------------------------------------------ */
/*  Shared runtime state, written once per frame by NeuralSphere and    */
/*  read by every sub-component (no React re-renders involved).         */
/* ------------------------------------------------------------------ */

export interface SphereRuntime {
  /** Smoothed activation per region, 0..1 (index = REGION_INDEX). */
  activation: Float32Array
  /** Global activity 0..1 (0 = idle). */
  activity: number
  /** Error disturbance 0..1, decays quickly. */
  glitch: number
  /** Radial response wave progress 0..1, or -1 when inactive. */
  wave: number
  hovered: RegionId | null
  time: number
  /** Coarse interaction mode, used by pulses and regions for special motion. */
  mode: 'idle' | 'listening' | 'speaking' | 'memory-store' | 'memory-retrieve' | 'active'
  /** Live microphone level 0..1 while Alessio speaks (fast attack, quick decay). */
  voice: number
}

export function createRuntime(): SphereRuntime {
  return {
    activation: new Float32Array(REGIONS.length),
    activity: 0,
    glitch: 0,
    wave: -1,
    hovered: null,
    time: 0,
    mode: 'idle',
    voice: 0,
  }
}

/** Activation of a filament = max of its endpoint regions. */
export function filamentActivation(data: SphereData, rt: SphereRuntime, fi: number): number {
  const f = data.filaments[fi]
  const ra = rt.activation[REGION_INDEX[data.nodes[f.a].region]]
  const rb = rt.activation[REGION_INDEX[data.nodes[f.b].region]]
  return Math.max(ra, rb)
}

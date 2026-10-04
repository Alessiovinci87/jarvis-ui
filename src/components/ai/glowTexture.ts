import * as THREE from 'three'

let cached: THREE.Texture | null = null

/** Soft radial sprite used for glows. Generated once, shared everywhere. */
export function getGlowTexture(): THREE.Texture {
  if (cached) return cached
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.5)')
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  cached = new THREE.CanvasTexture(canvas)
  cached.colorSpace = THREE.SRGBColorSpace
  return cached
}

let ringCached: THREE.Texture | null = null

/** Thin luminous ring with soft edges, used for the radial response wave. */
export function getRingTexture(): THREE.Texture {
  if (ringCached) return ringCached
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.82, 'rgba(255,255,255,0)')
  g.addColorStop(0.9, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.94, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ringCached = new THREE.CanvasTexture(canvas)
  ringCached.colorSpace = THREE.SRGBColorSpace
  return ringCached
}

export const CYAN = '#4fd8ff'
export const CYAN_DIM = '#1a7fa6'
export const WHITE_CYAN = '#bff4ff'

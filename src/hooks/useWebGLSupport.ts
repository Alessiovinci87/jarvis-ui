import { useState } from 'react'

function detectWebGL(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')
    return gl !== null
  } catch {
    return false
  }
}

/** Detected once per mount; WebGL availability does not change at runtime. */
export function useWebGLSupport(): boolean {
  const [supported] = useState(detectWebGL)
  return supported
}

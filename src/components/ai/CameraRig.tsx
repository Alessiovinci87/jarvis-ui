import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const BASE_DISTANCE = 10.5
const FOV_DEG = 42
/** Half-width (world units) that must stay visible: outer nodes plus label margin. */
const REQUIRED_HALF_WIDTH = 4.0

/**
 * Keeps the whole network in frame: on narrow viewports the camera moves
 * back just enough for the outer nodes to remain visible.
 */
export function CameraRig() {
  useFrame(({ camera, size }) => {
    const aspect = size.width / Math.max(1, size.height)
    const halfFov = THREE.MathUtils.degToRad(FOV_DEG / 2)
    const needed = REQUIRED_HALF_WIDTH / (Math.tan(halfFov) * aspect)
    const target = Math.max(BASE_DISTANCE, needed)
    if (Math.abs(camera.position.z - target) > 0.01) {
      camera.position.z += (target - camera.position.z) * 0.2
    }
  })

  return null
}

import * as THREE from 'three'

export const VIEW_BIAS_Y = -0.1
const FRAME_EDGE = 0.88 // leave 6% of the viewport clear on each side

/** Fit the shell's eight corners, including the floor slab and framing bias. */
export function fitHomeCamera(
  bounds: { w: number; d: number },
  wallHeight: number,
  viewport: { width: number; height: number },
  theta: number,
  phi: number,
  fov = 40,
  viewBiasY = VIEW_BIAS_Y,
): { zoom: number; distance: number } {
  const backward = new THREE.Vector3().setFromSphericalCoords(1, phi, theta)
  const right = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, backward).normalize()
  const up = new THREE.Vector3().crossVectors(backward, right)
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov / 2))
  const tanX = tanY * viewport.width / viewport.height
  let zoom = Infinity
  let distance = 3
  // Walls extend 0.12 m outward; the slab overhang adds another 0.25 m.
  for (const x of [-bounds.w / 2 - 0.37, bounds.w / 2 + 0.37]) {
    for (const y of [-0.2 - 0.8, wallHeight - 0.8]) {
      for (const z of [-bounds.d / 2 - 0.37, bounds.d / 2 + 0.37]) {
        const point = new THREE.Vector3(x, y, z)
        const px = Math.abs(point.dot(right))
        const py = point.dot(up)
        const pz = point.dot(backward)
        const yEdge = FRAME_EDGE - Math.sign(py) * 2 * viewBiasY
        zoom = Math.min(zoom, viewport.width * FRAME_EDGE / (2 * px), viewport.height * yEdge / (2 * Math.abs(py)))
        distance = Math.max(distance, pz + px / (tanX * FRAME_EDGE), pz + Math.abs(py) / (tanY * yEdge))
      }
    }
  }
  return { zoom, distance }
}

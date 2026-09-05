import assert from 'node:assert/strict'
import * as THREE from 'three'
import { fitHomeCamera, VIEW_BIAS_Y } from '../src/three/cameraFit'

let cases = 0
for (const viewport of [{ width: 390, height: 700 }, { width: 1100, height: 850 }, { width: 700, height: 340 }]) {
  for (const bounds of [{ w: 5, d: 4 }, { w: 15, d: 10 }, { w: 80, d: 8 }]) {
    for (const wallHeight of [2.7, 5]) {
      for (const projection of ['orthographic', 'perspective']) {
        const theta = Math.PI / 4
        const phi = Math.acos(1 / Math.sqrt(3))
        const fit = fitHomeCamera(bounds, wallHeight, viewport, theta, phi)
        const camera = projection === 'orthographic'
          ? new THREE.OrthographicCamera(-viewport.width / 2, viewport.width / 2, viewport.height / 2, -viewport.height / 2, -100, 2000)
          : new THREE.PerspectiveCamera(40, viewport.width / viewport.height, 0.1, 2000)
        const target = new THREE.Vector3(11, 0.8, -7)
        camera.position.setFromSphericalCoords(projection === 'orthographic' ? 18 : fit.distance, phi, theta).add(target)
        camera.zoom = projection === 'orthographic' ? fit.zoom : 1
        camera.lookAt(target)
        camera.setViewOffset(viewport.width, viewport.height, 0, viewport.height * VIEW_BIAS_Y, viewport.width, viewport.height)
        camera.updateMatrixWorld()
        for (const x of [-bounds.w / 2 - 0.37, bounds.w / 2 + 0.37]) {
          for (const y of [-0.15, wallHeight]) {
            for (const z of [-bounds.d / 2 - 0.37, bounds.d / 2 + 0.37]) {
              const projected = new THREE.Vector3(x + target.x, y, z + target.z).project(camera)
              assert.ok(Math.abs(projected.x) <= 0.881 && Math.abs(projected.y) <= 0.881, `${projection} ${JSON.stringify({ viewport, bounds, projected })}`)
            }
          }
        }
        cases++
      }
    }
  }
}
console.log(`Camera fit: ${cases} viewport/shell/projection combinations passed`)

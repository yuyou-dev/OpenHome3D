// Exercise screenshot camera changes with real Three cameras and a fake canvas.
// No WebGL, browser, AI calls or persistent user data are needed.
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createServer } from 'vite'
const memory = new Map()
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: key => memory.delete(key),
}
globalThis.window = { localStorage: globalThis.localStorage }
globalThis.requestAnimationFrame = callback => { callback(0); return 0 }
const vite = await createServer({
  configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { useStore } = await vite.ssrLoadModule('/src/state/store.ts')
  const { setRootState, captureFittedScreenshot, captureUnbiasedScreenshot } = await vite.ssrLoadModule('/src/three/runtime.ts')
  const bounds = { cx: 18, cz: -12, w: 12, d: 8 }
  useStore.setState({
    home: { rooms: [{ id: 'offset', type: 'living', name: 'Offset home', rect: { x: bounds.cx, z: bounds.cz, w: bounds.w, d: bounds.d }, salt: 0, partitionHeight: 0 }], openings: [] },
    wallHeight: 3,
  })
  const size = { width: 1200, height: 800 }
  const staleCamera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 2000)
  const live = { camera: staleCamera, size, controls: null, gl: null }
  let inspect = () => {}
  let throwCapture = false
  live.gl = { domElement: { toDataURL() { inspect(); if (throwCapture) throw new Error('canvas unavailable'); return 'data:image/png;base64,test' } } }
  setRootState({ ...live, get: () => live })
  const cameras = [new THREE.OrthographicCamera(-600, 600, 400, -400, -100, 2000), new THREE.PerspectiveCamera(40, 1.5, 0.1, 2000)]
  for (const camera of cameras) {
    live.camera = camera
    const target = new THREE.Vector3(bounds.cx + 4, 0.8, bounds.cz - 3) // intentional pan
    camera.position.copy(target).add(new THREE.Vector3(14, 12, 14))
    camera.lookAt(target)
    camera.zoom = camera.isOrthographicCamera ? 42 : 1.4
    camera.setViewOffset(size.width, size.height, 0, -80, size.width, size.height)
    live.controls = { target, enabled: true }
    const savedPosition = camera.position.clone()
    const savedQuaternion = camera.quaternion.clone()
    const savedTarget = target.clone()
    const savedZoom = camera.zoom
    const savedView = { ...camera.view }
    for (const ratio of [1, 1.5, 2 / 3]) {
      inspect = () => {
        assert.equal(camera.view.enabled, false, 'capture clears the live camera bias')
        assert.equal(live.controls.enabled, false)
        assert.deepEqual(target.toArray(), [bounds.cx, 0.8, bounds.cz], 'fit recenters the translated home')
        camera.updateMatrixWorld(true)
        const cropX = Math.min(1, ratio / 1.5)
        const cropY = Math.min(1, 1.5 / ratio)
        for (const x of [-bounds.w / 2 - 0.37, bounds.w / 2 + 0.37]) {
          for (const y of [-0.2, 3]) for (const z of [-bounds.d / 2 - 0.37, bounds.d / 2 + 0.37]) {
            const point = new THREE.Vector3(bounds.cx + x, y, bounds.cz + z).project(camera)
            assert.ok(Math.abs(point.x) <= cropX && Math.abs(point.y) <= cropY, 'every shell corner fits inside the output crop')
          }
        }
      }
      assert.equal(await captureFittedScreenshot(ratio), 'data:image/png;base64,test')
      assert.deepEqual(camera.position, savedPosition)
      assert.deepEqual(camera.quaternion.toArray(), savedQuaternion.toArray())
      assert.deepEqual(target, savedTarget)
      assert.deepEqual(camera.view, savedView)
      assert.equal(camera.zoom, savedZoom)
      assert.equal(live.controls.enabled, true)
    }
    inspect = () => assert.equal(camera.view.enabled, false)
    assert.equal(await captureUnbiasedScreenshot(), 'data:image/png;base64,test')
    assert.deepEqual(camera.view, savedView)
    throwCapture = true
    assert.equal(await captureFittedScreenshot(), null)
    assert.deepEqual(camera.position, savedPosition, 'capture failure restores camera position')
    assert.deepEqual(camera.view, savedView, 'capture failure restores bias')
    assert.deepEqual(target, savedTarget, 'capture failure restores pan')
    assert.equal(live.controls.enabled, true)
    throwCapture = false
  }
  assert.deepEqual(staleCamera.position.toArray(), [0, 0, 0], 'the obsolete onCreated camera remains untouched')
  console.log('runtime OK: live projection, translated bounds, all output crops, pan/zoom/bias restoration and failed captures')
} finally {
  await vite.close()
}

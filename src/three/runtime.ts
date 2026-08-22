import type { RootState } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { homeAABB } from '../state/home'

/** Camera view presets the UI can request (consumed by CameraRig). */
export type ViewPreset = 'iso-ne' | 'iso-nw' | 'iso-se' | 'iso-sw' | 'top' | 'reset'

// ---------------------------------------------------------------------------
// View preset bus — UI publishes, CameraRig subscribes
// ---------------------------------------------------------------------------

const viewSubs = new Set<(v: ViewPreset) => void>()

/** Request a camera view change. Safe to call from anywhere (UI buttons). */
export function requestView(v: ViewPreset): void {
  viewSubs.forEach((cb) => cb(v))
}

/** Internal: CameraRig subscribes here. Returns an unsubscribe function. */
export function subscribeView(cb: (v: ViewPreset) => void): () => void {
  viewSubs.add(cb)
  return () => viewSubs.delete(cb)
}

// ---------------------------------------------------------------------------
// Zoom-level probe — SceneRoot emits the camera zoom as a designer-friendly
// percentage (~2/s, 100% = default framing), the status bar subscribes
// ---------------------------------------------------------------------------

const zoomSubs = new Set<(pct: number) => void>()

/** Subscribe to zoom-level updates (~2 per second). Returns an unsubscribe function. */
export function subscribeZoomPct(cb: (pct: number) => void): () => void {
  zoomSubs.add(cb)
  return () => zoomSubs.delete(cb)
}

/** Internal: called by the SceneRoot frame probe. */
export function emitZoomPct(pct: number): void {
  zoomSubs.forEach((cb) => cb(pct))
}

// ---------------------------------------------------------------------------
// Scene-ready signal — SceneRoot emits once after assets are loaded and a few
// stable frames have rendered; the loading veil subscribes
// ---------------------------------------------------------------------------

const readySubs = new Set<() => void>()
let sceneReady = false

/** Subscribe to the one-time scene-ready signal (fires immediately if already ready). */
export function subscribeSceneReady(cb: () => void): () => void {
  if (sceneReady) {
    cb()
    return () => {}
  }
  readySubs.add(cb)
  return () => readySubs.delete(cb)
}

/** Internal: called by SceneRoot's ReadyProbe. */
export function emitSceneReady(): void {
  if (sceneReady) return
  sceneReady = true
  readySubs.forEach((cb) => cb())
  readySubs.clear()
}

// ---------------------------------------------------------------------------
// Screenshot — SceneRoot registers the live root state on creation
// ---------------------------------------------------------------------------

let rootState: RootState | null = null

/** Internal: called from Canvas onCreated. */
export function setRootState(state: RootState): void {
  rootState = state
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    ;(window as unknown as { __three: RootState }).__three = state
  }
}

/**
 * Data-URL PNG of the current canvas, or null before the canvas exists.
 * The canvas is created with preserveDrawingBuffer, so the last presented
 * frame (including postprocessing) is still readable.
 */
export function captureScreenshot(): string | null {
  if (!rootState) return null
  try {
    return rootState.gl.domElement.toDataURL('image/png')
  } catch {
    return null
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Camera with an optional three.js view-offset (the editor's framing bias). */
type ViewOffsetCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera

/**
 * Screenshot WITHOUT the editor's framing bias: AI-render inputs must be
 * truly centered — the image model recenters subjects on its own, so a biased
 * input guarantees a framing mismatch between the 3D view and the render.
 * Clears the view offset, renders fresh frames, captures, then restores it.
 */
export async function captureUnbiasedScreenshot(): Promise<string | null> {
  if (!rootState) return null
  const cam = rootState.camera as ViewOffsetCamera
  if (!cam.setViewOffset) return captureScreenshot()
  const saved = cam.view ? { ...cam.view } : null
  if (!saved?.enabled) return captureScreenshot() // no bias active — read the buffer as-is
  cam.clearViewOffset()
  await nextFrame()
  await nextFrame()
  const shot = captureScreenshot()
  cam.setViewOffset(saved.fullWidth, saved.fullHeight, saved.offsetX, saved.offsetY, saved.width, saved.height)
  return shot
}

/**
 * Best-fit screenshot: temporarily re-frames the camera so the room bounds
 * (walls + slab, up to wall height) fill the frame at the requested output
 * aspect, renders, captures, then restores the user's exact camera pose.
 * The structure-locking quality of the AI render depends heavily on the room
 * filling the input image — a small room in a sea of canvas margin makes the
 * model hallucinate layout. `targetRatio` = w/h of the intended output
 * (undefined → current canvas ratio).
 */
export async function captureFittedScreenshot(targetRatio?: number): Promise<string | null> {
  if (!rootState) return null
  const { camera, size } = rootState
  const controls = rootState.controls as {
    target: THREE.Vector3
    enabled: boolean
  } | null

  const st = useStore.getState()
  const aabb = homeAABB(st.home)
  const w = aabb.w
  const d = aabb.d
  const wh = st.wallHeight

  const canvasRatio = size.width / size.height
  const ratio = targetRatio && targetRatio > 0 ? targetRatio : canvasRatio
  // effective viewport area once the frame is cropped to the output ratio
  let effW = size.width
  let effH = size.height
  if (canvasRatio > ratio) effW = size.height * ratio
  else effH = size.width / ratio

  const target = controls ? controls.target.clone() : new THREE.Vector3(0, 0.8, 0)

  // room AABB corners (walls + slab overhang) in view space
  const ox = w / 2 + 0.45
  const oz = d / 2 + 0.45
  const invQ = camera.quaternion.clone().invert()
  let maxX = 0
  let maxY = 0
  const v = new THREE.Vector3()
  for (const x of [-ox, ox]) {
    for (const y of [-0.2, wh]) {
      for (const z of [-oz, oz]) {
        v.set(x, y, z).sub(target).applyQuaternion(invQ)
        maxX = Math.max(maxX, Math.abs(v.x))
        maxY = Math.max(maxY, Math.abs(v.y))
      }
    }
  }
  const extX = maxX * 2
  const extY = maxY * 2

  // save the exact camera pose
  const savedPos = camera.position.clone()
  const savedQuat = camera.quaternion.clone()
  const savedZoom = camera.zoom
  const savedView = camera.view ? { ...camera.view } : null
  const wasEnabled = controls?.enabled ?? false

  const isOrtho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true
  if (isOrtho) {
    camera.zoom = Math.min(effW / extX, effH / extY) * 0.92
  } else {
    const persp = camera as THREE.PerspectiveCamera
    const vfov = THREE.MathUtils.degToRad(persp.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (effW / effH))
    const distY = extY / 2 / Math.tan(vfov / 2)
    const distX = extX / 2 / Math.tan(hfov / 2)
    const dir = camera.position.clone().sub(target).normalize()
    camera.position.copy(target).addScaledVector(dir, Math.max(distX, distY) * 1.15)
    camera.lookAt(target)
  }
  // drop the editor's framing bias while capturing: the image model centers
  // the subject on its own, so a biased input guarantees a mismatched render
  if (savedView?.enabled) (camera as ViewOffsetCamera).clearViewOffset()
  camera.updateProjectionMatrix()
  if (controls) controls.enabled = false

  await nextFrame()
  await nextFrame()
  const shot = captureScreenshot()

  camera.position.copy(savedPos)
  camera.quaternion.copy(savedQuat)
  camera.zoom = savedZoom
  if (savedView?.enabled) {
    ;(camera as ViewOffsetCamera).setViewOffset(
      savedView.fullWidth,
      savedView.fullHeight,
      savedView.offsetX,
      savedView.offsetY,
      savedView.width,
      savedView.height,
    )
  }
  camera.updateProjectionMatrix()
  if (controls) controls.enabled = wasEnabled
  await nextFrame()
  return shot
}

// ---------------------------------------------------------------------------
// Upload blob storage key (shared with the UI agent)
// ---------------------------------------------------------------------------

/** idb-keyval key under which the UI stores uploaded GLB Blobs. */
export const MODEL_BLOB_KEY = (id: string) => `model:${id}`

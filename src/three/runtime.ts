import type { RootState } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { homeAABB, homeHeight, homeForRoomLevel } from '../state/home'
import { fitHomeCamera } from './cameraFit'

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
    return rootState.get().gl.domElement.toDataURL('image/png')
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
  const cam = rootState.get().camera as ViewOffsetCamera
  if (!cam.setViewOffset) return captureScreenshot()
  const saved = cam.view ? { ...cam.view } : null
  if (!saved?.enabled) return captureScreenshot() // no bias active — read the buffer as-is
  cam.clearViewOffset()
  try {
    await nextFrame()
    await nextFrame()
    return captureScreenshot()
  } finally {
    cam.setViewOffset(saved.fullWidth, saved.fullHeight, saved.offsetX, saved.offsetY, saved.width, saved.height)
  }
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
  // Canvas onCreated is a snapshot; projection switches replace the live camera.
  const { camera, size, controls: liveControls } = rootState.get()
  const controls = liveControls as { target: THREE.Vector3; enabled: boolean } | null
  const cam = camera as ViewOffsetCamera
  const st = useStore.getState()
  const bounds = homeAABB(homeForRoomLevel(st.home,st.activeRoomId))
  const target = new THREE.Vector3(bounds.cx, 0.8, bounds.cz)
  const savedTarget = controls?.target.clone()
  const orbitTarget = savedTarget ?? target
  const direction = new THREE.Spherical().setFromVector3(cam.position.clone().sub(orbitTarget))
  const canvasRatio = size.width / size.height
  const ratio = targetRatio && targetRatio > 0 ? targetRatio : canvasRatio
  const viewport = {
    width: Math.min(size.width, size.height * ratio),
    height: Math.min(size.height, size.width / ratio),
  }
  const isOrtho = cam instanceof THREE.OrthographicCamera
  // Cropping the canvas reduces the visible vertical field of view as well.
  const fov = isOrtho ? 40 : THREE.MathUtils.radToDeg(2 * Math.atan(
    Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * viewport.height / size.height,
  ))
  const fit = fitHomeCamera(bounds, homeHeight(homeForRoomLevel(st.home,st.activeRoomId),st.wallHeight), viewport, direction.theta, direction.phi, fov, 0)
  const savedPos = cam.position.clone()
  const savedQuat = cam.quaternion.clone()
  const savedZoom = cam.zoom
  const savedView = cam.view ? { ...cam.view } : null
  const wasEnabled = controls?.enabled ?? false

  try {
    if (controls) {
      controls.enabled = false
      controls.target.copy(target)
    }
    cam.position.setFromSphericalCoords(isOrtho ? direction.radius : fit.distance, direction.phi, direction.theta).add(target)
    cam.lookAt(target)
    cam.zoom = isOrtho ? fit.zoom * (cam.top - cam.bottom) / size.height : 1
    if (savedView?.enabled) cam.clearViewOffset()
    cam.updateProjectionMatrix()
    await nextFrame()
    await nextFrame()
    return captureScreenshot()
  } finally {
    cam.position.copy(savedPos)
    cam.quaternion.copy(savedQuat)
    cam.zoom = savedZoom
    if (savedView?.enabled) {
      cam.setViewOffset(savedView.fullWidth, savedView.fullHeight, savedView.offsetX, savedView.offsetY, savedView.width, savedView.height)
    }
    cam.updateProjectionMatrix()
    if (controls && savedTarget) {
      controls.target.copy(savedTarget)
      controls.enabled = wasEnabled
    }
  }
}

// ---------------------------------------------------------------------------
// Upload blob storage key (shared with the UI agent)
// ---------------------------------------------------------------------------

/** idb-keyval key under which the UI stores uploaded GLB Blobs. */
export const MODEL_BLOB_KEY = (id: string) => `model:${id}`

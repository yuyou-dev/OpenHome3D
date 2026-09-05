import { useEffect, useRef, useState, type ComponentRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { useStore } from '../state/store'
import { useUI } from '../ui/uiStore'
import { homeAABB, homeHeight, homeForRoomLevel } from '../state/home'
import { subscribeView, type ViewPreset } from './runtime'
import { fitHomeCamera, VIEW_BIAS_Y } from './cameraFit'

/** Keep the established orbit height while fitting the complete shell. */
const TARGET = new THREE.Vector3(0, 0.8, 0)
/** Classic axonometric elevation: 35.264° above the horizon. */
const ISO_PHI = THREE.MathUtils.degToRad(90 - 35.264)
const ORTHO_RADIUS = 18
/** Legacy zoom reference for consumers before a fitted camera is ready. */
export const ORTHO_ZOOM = 55
const PERSP_POS = new THREE.Vector3(9, 8, 9)
/** Perspective default offset from the orbit target. */
const PERSP_OFFSET = PERSP_POS.clone().sub(TARGET)
export const PERSP_RADIUS = PERSP_OFFSET.length()
const PERSP_PHI = Math.acos(PERSP_OFFSET.y / PERSP_RADIUS)
const TWEEN_SECONDS = 0.4

type Controls = ComponentRef<typeof OrbitControls>

interface Pose {
  theta: number // azimuth around +y, from +z
  phi: number // polar from +y
  radius: number
  zoom: number
}

interface Tween {
  from: Pose
  to: Pose
  t: number
}

const ISO_THETAS: Record<string, number> = {
  'iso-se': Math.PI / 4, // camera in the +x/+z octant
  'iso-ne': (3 * Math.PI) / 4,
  'iso-nw': (-3 * Math.PI) / 4,
  'iso-sw': -Math.PI / 4,
}

/** Shortest signed angular distance a → b, in (-π, π]. */
function angleDelta(a: number, b: number): number {
  return THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI
}

/**
 * Orthographic isometric / perspective camera with orbit controls and
 * UI-driven view presets, tweened over ~0.4 s.
 */
export default function CameraRig() {
  const projection = useStore((s) => s.projection)
  // pan mode (TopBar toggle): left-drag / one-finger drag pans instead of orbiting
  const panMode = useUI((s) => s.panMode)
  // orbit target follows the home AABB center (origin for the 1-room case)
  const cx = useStore((s) => homeAABB(homeForRoomLevel(s.home,s.activeRoomId)).cx)
  const cz = useStore((s) => homeAABB(homeForRoomLevel(s.home,s.activeRoomId)).cz)
  // Pose anchor: the AABB center captured at mount and re-captured only on a
  // projection switch — the only moments the camera pose is (re)applied.
  // Plain AABB-center moves (room drags) must NOT touch the camera props;
  // they retarget the controls smoothly in useFrame instead.
  const [anchor, setAnchor] = useState(() => {
    const bb = homeAABB(homeForRoomLevel(useStore.getState().home,useStore.getState().activeRoomId))
    return { cx: bb.cx, cz: bb.cz }
  })
  const get = useThree((s) => s.get)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controlsRef = useRef<Controls>(null)
  const tween = useRef<Tween | null>(null)
  const manuallyFramed = useRef(false)
  const scratch = useRef(new THREE.Spherical())
  const targetRef = useRef(new THREE.Vector3(anchor.cx, 0.8, anchor.cz))
  targetRef.current.set(cx, 0.8, cz)
  // AABB center as of the last applied camera shift — panning moves the
  // orbit target away from it on purpose, so we track the DELTA instead of
  // pulling the target back (a lerp-back used to undo every pan)
  const lastCenter = useRef(new THREE.Vector3(anchor.cx, 0.8, anchor.cz))

  // A projection swap replaces the default camera: drop any in-flight tween
  // and re-anchor the default pose to the current AABB center (adjusting
  // state during render so the remounted camera gets the fresh anchor).
  const [prevProjection, setPrevProjection] = useState(projection)
  if (prevProjection !== projection) {
    setPrevProjection(projection)
    tween.current = null
    manuallyFramed.current = false
    const bb = homeAABB(homeForRoomLevel(useStore.getState().home,useStore.getState().activeRoomId))
    setAnchor({ cx: bb.cx, cz: bb.cz })
    lastCenter.current.set(bb.cx, 0.8, bb.cz)
  }

  // Shift+left-drag pans (trackpad-friendly alternative to right-drag pan and
  // the TopBar pan-mode toggle). Restore honors the toggle's panMode.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const onDown = (e: PointerEvent) => {
      if (e.button === 0 && e.shiftKey) controls.mouseButtons.LEFT = THREE.MOUSE.PAN
    }
    const onUp = () => {
      controls.mouseButtons.LEFT = useUI.getState().panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
    }
  }, [])

  // Frame the room slightly below center so the floor sits comfortably low
  // (also when zoomed in). viewOffset lives on the camera's projection, so it
  // survives OrbitControls' zoom updates but must be re-applied per camera.
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera & THREE.PerspectiveCamera
    if (!cam.setViewOffset) return
    cam.setViewOffset(size.width, size.height, 0, VIEW_BIAS_Y * size.height, size.width, size.height)
    return () => cam.clearViewOffset()
  }, [camera, size])

  // Refit only an untouched view when the canvas settles/resizes. Room edits
  // deliberately do not trigger this effect, preserving the user's orbit/pan.
  useEffect(() => {
    if (manuallyFramed.current || size.width <= 0 || size.height <= 0) return
    const isOrtho = projection === 'isometric'
    if (isOrtho !== Boolean((camera as THREE.OrthographicCamera).isOrthographicCamera)) return
    const state = useStore.getState()
    const bb = homeAABB(homeForRoomLevel(state.home,state.activeRoomId))
    const phi = isOrtho ? ISO_PHI : PERSP_PHI
    const fit = fitHomeCamera(bb, homeHeight(homeForRoomLevel(state.home,state.activeRoomId),state.wallHeight), size, ISO_THETAS['iso-se'], phi)
    camera.userData.fitZoom = fit.zoom
    camera.userData.fitDistance = fit.distance
    const target = targetRef.current
    camera.position.setFromSphericalCoords(isOrtho ? ORTHO_RADIUS : fit.distance, phi, ISO_THETAS['iso-se']).add(target)
    camera.zoom = isOrtho ? fit.zoom : 1
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    controlsRef.current?.target.copy(target)
    controlsRef.current?.update()
    lastCenter.current.copy(target)
  }, [camera, projection, size.width, size.height])

  // View preset requests from the UI bus.
  useEffect(() => {
    return subscribeView((v: ViewPreset) => {
      const cam = get().camera
      const target = targetRef.current
      const sph = new THREE.Spherical().setFromVector3(cam.position.clone().sub(target))
      const from: Pose = { theta: sph.theta, phi: sph.phi, radius: sph.radius, zoom: cam.zoom }
      let to: Pose
      if (v === 'reset') {
        const state = useStore.getState()
        const fit = fitHomeCamera(homeAABB(homeForRoomLevel(state.home,state.activeRoomId)), homeHeight(homeForRoomLevel(state.home,state.activeRoomId),state.wallHeight), get().size, ISO_THETAS['iso-se'], state.projection === 'isometric' ? ISO_PHI : PERSP_PHI)
        cam.userData.fitZoom = fit.zoom
        cam.userData.fitDistance = fit.distance
        manuallyFramed.current = false
        to =
          state.projection === 'isometric'
            ? { theta: ISO_THETAS['iso-se'], phi: ISO_PHI, radius: ORTHO_RADIUS, zoom: fit.zoom }
            : { theta: ISO_THETAS['iso-se'], phi: PERSP_PHI, radius: fit.distance, zoom: 1 }
      } else if (v === 'top') {
        manuallyFramed.current = true
        const state = useStore.getState()
        const fit = state.home.architecture ? fitHomeCamera(homeAABB(homeForRoomLevel(state.home,state.activeRoomId)), homeHeight(homeForRoomLevel(state.home,state.activeRoomId),state.wallHeight), get().size, 0, 0.01) : null
        to = { ...from, phi: 0.01, ...(fit ? {theta:0, zoom:state.projection==='isometric'?fit.zoom:1, radius:state.projection==='isometric'?ORTHO_RADIUS:fit.distance} : {}) }
      } else {
        manuallyFramed.current = true
        to = { ...from, theta: ISO_THETAS[v], phi: ISO_PHI }
      }
      tween.current = { from, to, t: 0 }
    })
  }, [get])

  useFrame((_, delta) => {
    const tw = tween.current
    if (tw) {
      tw.t = Math.min(1, tw.t + delta / TWEEN_SECONDS)
      const k = tw.t * tw.t * (3 - 2 * tw.t) // smoothstep
      const cam = get().camera
      const sph = scratch.current.set(
        THREE.MathUtils.lerp(tw.from.radius, tw.to.radius, k),
        THREE.MathUtils.lerp(tw.from.phi, tw.to.phi, k),
        tw.from.theta + angleDelta(tw.from.theta, tw.to.theta) * k,
      )
      cam.position.setFromSpherical(sph).add(targetRef.current)
      cam.zoom = THREE.MathUtils.lerp(tw.from.zoom, tw.to.zoom, k)
      cam.updateProjectionMatrix()
      cam.lookAt(targetRef.current)
      // keep the controls' target glued to the tween's reference point so the
      // trailing controls.update() doesn't fight the tweened pose
      if (controlsRef.current) {
        controlsRef.current.target.copy(targetRef.current)
        controlsRef.current.update()
      }
      if (tw.t >= 1) {
        tween.current = null
        // a preset/reset retakes the AABB center as the pan reference
        lastCenter.current.copy(targetRef.current)
      }
      return
    }
    // No explicit view change in flight: an AABB-center move (room dragged,
    // added, removed) shifts target and camera by the same delta — the pose,
    // including any user pan offset, is preserved.
    const controls = controlsRef.current
    if (controls) {
      const dst = targetRef.current
      const last = lastCenter.current
      const dx = dst.x - last.x
      const dy = dst.y - last.y
      const dz = dst.z - last.z
      if (dx * dx + dy * dy + dz * dz > 1e-12) {
        const t = controls.target
        t.x += dx
        t.y += dy
        t.z += dz
        const cam = get().camera
        cam.position.x += dx
        cam.position.y += dy
        cam.position.z += dz
        controls.update()
        last.copy(dst)
      }
    }
  })

  return (
    <>
      {projection === 'isometric' ? (
        <OrthographicCamera
          makeDefault
          position={[anchor.cx + ORTHO_RADIUS / Math.sqrt(3), 0.8 + ORTHO_RADIUS / Math.sqrt(3), anchor.cz + ORTHO_RADIUS / Math.sqrt(3)]}
          zoom={ORTHO_ZOOM}
          near={-100}
          far={2000}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          fov={40}
          position={[anchor.cx + PERSP_OFFSET.x, 0.8 + PERSP_OFFSET.y, anchor.cz + PERSP_OFFSET.z]}
          near={0.1}
          far={2000}
        />
      )}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        onStart={() => { manuallyFramed.current = true; tween.current = null }}
        enableDamping
        dampingFactor={0.08}
        screenSpacePanning={false}
        // pan mode swaps the primary drag to pan; right-drag always pans
        mouseButtons={{
          LEFT: panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        touches={{
          ONE: panMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
        // 0.01 (not 0.15) so the 'top' preset is a true top-down view —
        // structure-edit handles/markers must not hide behind tall walls
        minPolarAngle={0.01}
        maxPolarAngle={1.45}
        minZoom={0.1}
        maxZoom={1000}
        minDistance={3}
        maxDistance={1000}
        target={[anchor.cx, 0.8, anchor.cz]}
      />
    </>
  )
}

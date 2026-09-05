import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { useStore } from '../state/store'
import { useUI } from '../ui/uiStore'
import { homeAABB } from '../state/home'
import CameraRig, { ORTHO_ZOOM, PERSP_RADIUS } from './CameraRig'
import Lights from './Lights'
import Home from './Home'
import HomeEditor from './HomeEditor'
import FurnitureItem from './FurnitureItem'
import Effects from './Effects'
import { emitSceneReady, emitZoomPct, setRootState } from './runtime'

/** Scratch vector for the perspective zoom reference point (home AABB center). */
const VIEW_TARGET = new THREE.Vector3(0, 0.8, 0)

/** Emits the camera zoom as a percentage over the runtime bus ~2×/s. */
function ZoomProbe() {
  const acc = useRef(0)
  useFrame(({ camera, controls }, delta) => {
    acc.current += delta
    if (acc.current < 0.5) return
    acc.current = 0
    const bb = homeAABB(useStore.getState().home)
    VIEW_TARGET.set(bb.cx, 0.8, bb.cz)
    const isOrtho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true
    const pct = isOrtho
      ? (camera.zoom / (camera.userData.fitZoom ?? ORTHO_ZOOM)) * 100
      : ((camera.userData.fitDistance ?? PERSP_RADIUS) / Math.max(0.001, camera.position.distanceTo((controls as { target?: THREE.Vector3 } | null)?.target ?? VIEW_TARGET))) * 100
    emitZoomPct(Math.round(pct))
  })
  return null
}

/**
 * Emits scene-ready once GLB assets have finished loading and a few frames
 * have rendered at the settled canvas size (the loading veil lifts on it).
 * Guards: empty scene (no loaders → progress never reaches 100) and a hard
 * timeout so users can never get stuck on the veil.
 */
function ReadyProbe() {
  const frames = useRef(0)
  const done = useRef(false)

  const finish = () => {
    if (done.current) return
    done.current = true
    emitSceneReady()
  }

  useFrame(() => {
    if (done.current) return
    frames.current += 1
    const { active, progress } = useProgress.getState()
    if ((!active && progress >= 100 && frames.current >= 5) || frames.current >= 90) finish()
  })
  useEffect(() => {
    const t = setTimeout(finish, 4000)
    return () => clearTimeout(t)
  }, [])
  return null
}

/** Global shortcuts: arrows nudge, a/e rotate, Delete removes, Escape deselects. */
function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (document.querySelector('[data-modal]')) return
      const s = useStore.getState()
      if (e.key === 'Escape') {
        s.select(null)
        s.selectOpening(null)
        return
      }
      const id = s.selectedId
      if (!id) return
      const grid = s.moveGrid
      switch (e.key) {
        case 'ArrowUp':
          s.nudgeFurniture(id, 0, -grid)
          e.preventDefault()
          break
        case 'ArrowDown':
          s.nudgeFurniture(id, 0, grid)
          e.preventDefault()
          break
        case 'ArrowLeft':
          s.nudgeFurniture(id, -grid, 0)
          e.preventDefault()
          break
        case 'ArrowRight':
          s.nudgeFurniture(id, grid, 0)
          e.preventDefault()
          break
        case 'a':
        case 'A': {
          const f = s.furniture.find((it) => it.id === id)
          if (f) s.rotateFurniture(id, f.rotationY + Math.PI / 12)
          break
        }
        case 'e':
        case 'E': {
          const f = s.furniture.find((it) => it.id === id)
          if (f) s.rotateFurniture(id, f.rotationY - Math.PI / 12)
          break
        }
        case 'Delete':
        case 'Backspace':
          s.removeFurniture(id)
          e.preventDefault()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * The whole 3D scene. Transparent canvas — the CSS behind supplies the
 * pastel backdrop.
 */
export default function SceneRoot() {
  const home = useStore((s) => s.home)
  const furniture = useStore((s) => s.furniture)
  const showFurniture = useStore((s) => s.showFurniture)
  const panMode = useUI((s) => s.panMode)
  const planTab = useStore((s) => s.planTab)
  useKeyboardShortcuts()

  // Guard: a click after an orbit/drag (>5 px travel) is not a deselect.
  const downPos = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      downPos.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  return (
    <Canvas
      shadows
      gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
      dpr={[1, 2]}
      flat={false}
      // grab cursor in pan mode: the primary drag pans instead of orbiting
      style={{ cursor: panMode ? 'grab' : undefined }}
      // the canvas box animates with the sidebar via CSS; re-allocating the
      // drawing buffer every animation frame makes the toggle stutter, so the
      // buffer resize is debounced and happens once after the transition
      resize={{ debounce: 75 }}
      onCreated={setRootState}
      onPointerMissed={(e) => {
        const d = downPos.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
        useStore.getState().select(null)
      }}
    >
      <CameraRig />
      <Lights />
      <Home />
      {planTab === 'home' && <HomeEditor />}
      {showFurniture &&
        home.rooms.map((r) => (
          <group key={r.id} position={[r.rect.x, 0, r.rect.z]}>
            {furniture
              .filter((f) => f.roomId === r.id)
              .map((inst) => (
                <FurnitureItem
                  key={inst.id}
                  instance={inst}
                  roomOffset={[r.rect.x, r.rect.z]}
                />
              ))}
          </group>
        ))}
      <Effects />
      <ZoomProbe />
      <ReadyProbe />
    </Canvas>
  )
}

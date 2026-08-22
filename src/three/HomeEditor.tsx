/**
 * In-canvas 2D structure editor — mounted by SceneRoot only while
 * planTab === 'home'. Entering the tab requests a top-down view.
 *
 * - Room overlays: one thin translucent plane per room on the floor. Press
 *   selects the room; drag moves it (snap moveGrid, Alt = off-grid) with live
 *   overlap validation — the drag holds the last VALID candidate, applies it
 *   visually only, and commits via setRoomRect on release (x/z moves do not
 *   regenerate furniture). No valid candidate → snaps back.
 * - Resize handles (active room): 8 small boxes (4 edge midpoints + 4
 *   corners). Drag resizes with the opposite edge/corner pinned, min 1.5 m
 *   per dimension; committing a w/d change regenerates that room's furniture
 *   (existing setRoomRect behavior, intended).
 * - Opening markers: small colored boxes on the wall lines (door wood, open
 *   light wood, window mid blue; 打通/fullHeight lavender). Click selects the
 *   opening (sidebar shows its editor).
 *
 * All handlers stopPropagation so events never reach furniture or
 * onPointerMissed; furniture above the overlays stays clickable (its own
 * stopPropagation already wins the raycast).
 *
 * This is an editor overlay, not scene content: flat basic/standard materials
 * on purpose (no toon shading), colors from PALETTE/SHELL + the shared
 * EDGE/SELECT_EDGE tokens (selection blue is reserved for active/selected).
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import { useStore } from '../state/store'
import {
  roomById,
  roomsOverlap,
  sideSpan,
  type HomeDef,
  type Opening,
  type RoomDef,
} from '../state/home'
import { EDGE, SELECT_EDGE } from '../models/parametric/shared'
import { PALETTE, SHELL } from '../models/palette'
import { requestView } from './runtime'

/** Minimum room dimension during a resize drag (same floor as the store). */
const MIN_DIM = 1.5

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/** R3F overrides event.target with its pointer-capture API at runtime. */
type CaptureTarget = {
  setPointerCapture: (pointerId: number) => void
  releasePointerCapture: (pointerId: number) => void
}
const captureOf = (e: ThreeEvent<PointerEvent>) => e.target as unknown as CaptureTarget

type Rect = RoomDef['rect']

type HandleId = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'
const HANDLES: HandleId[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']

/**
 * World position of a resize handle on a room rect. Handles are inset from
 * the boundary so they sit on open floor: walls have no pointer handlers (so
 * drags would work even under them), but a handle straddling the wall line is
 * visually covered by the wall's footprint in top view.
 */
const HANDLE_INSET = 0.15
function handlePos(h: HandleId, r: Rect): [number, number] {
  const x0 = r.x - r.w / 2 + HANDLE_INSET
  const x1 = r.x + r.w / 2 - HANDLE_INSET
  const z0 = r.z - r.d / 2 + HANDLE_INSET
  const z1 = r.z + r.d / 2 - HANDLE_INSET
  switch (h) {
    case 'n':
      return [r.x, z0]
    case 's':
      return [r.x, z1]
    case 'w':
      return [x0, r.z]
    case 'e':
      return [x1, r.z]
    case 'nw':
      return [x0, z0]
    case 'ne':
      return [x1, z0]
    case 'sw':
      return [x0, z1]
    case 'se':
      return [x1, z1]
  }
}

/** Resize with the opposite edge/corner pinned; each dimension clamped to ≥ MIN_DIM. */
function resizedRect(rect: Rect, handle: HandleId, hx: number, hz: number): Rect {
  let x0 = rect.x - rect.w / 2
  let x1 = rect.x + rect.w / 2
  let z0 = rect.z - rect.d / 2
  let z1 = rect.z + rect.d / 2
  if (handle.includes('w')) x0 = Math.min(hx, x1 - MIN_DIM)
  if (handle.includes('e')) x1 = Math.max(hx, x0 + MIN_DIM)
  if (handle.includes('n')) z0 = Math.min(hz, z1 - MIN_DIM)
  if (handle.includes('s')) z1 = Math.max(hz, z0 + MIN_DIM)
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 }
}

interface RoomDrag {
  mode: 'move' | 'resize'
  handle: HandleId | null
  /** move mode: ground hit minus room center at drag start */
  grabDX: number
  grabDZ: number
  /** last overlap-free candidate, committed on pointer up */
  candidate: Rect | null
  /** pending visual apply, consumed once per frame */
  next: Rect | null
}

/** One room's floor overlay plus (when active) its 8 resize handles. */
function RoomEditor({ room, active }: { room: RoomDef; active: boolean }) {
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const overlayRef = useRef<THREE.Mesh>(null)
  const handleRefs = useRef<Partial<Record<HandleId, THREE.Mesh | null>>>({})
  const drag = useRef<RoomDrag | null>(null)
  const hit = useRef(new THREE.Vector3())

  /** Move/scale the overlay + handle meshes to a candidate rect (visual only). */
  const applyRect = (r: Rect) => {
    const m = overlayRef.current
    if (m) {
      m.position.set(r.x, 0.01, r.z)
      // the plane is rotated flat, so its local y maps to world z
      m.scale.set(r.w, r.d, 1)
    }
    for (const h of HANDLES) {
      const hm = handleRefs.current[h]
      if (!hm) continue
      const [hx, hz] = handlePos(h, r)
      hm.position.set(hx, 0.06, hz)
    }
  }

  // apply the throttled drag candidate once per frame (no store writes mid-drag)
  useFrame(() => {
    const d = drag.current
    if (!d?.next) return
    applyRect(d.next)
    d.next = null
  })

  const startDrag = (e: ThreeEvent<PointerEvent>, mode: RoomDrag['mode'], handle: HandleId | null = null) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (mode === 'move') useStore.getState().selectRoom(room.id) // also clears furniture/opening selection
    if (controls) controls.enabled = false
    captureOf(e).setPointerCapture(e.pointerId)
    if (e.ray.intersectPlane(groundPlane, hit.current)) {
      drag.current = {
        mode,
        handle,
        grabDX: mode === 'move' ? hit.current.x - room.rect.x : 0,
        grabDZ: mode === 'move' ? hit.current.z - room.rect.z : 0,
        candidate: null,
        next: null,
      }
    }
  }

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    if (!e.ray.intersectPlane(groundPlane, hit.current)) return
    const st = useStore.getState()
    const grid = st.moveGrid
    const snap = (v: number) => (e.altKey ? v : Math.round(v / grid) * grid)
    const cand: Rect =
      d.mode === 'move'
        ? { ...room.rect, x: snap(hit.current.x - d.grabDX), z: snap(hit.current.z - d.grabDZ) }
        : resizedRect(room.rect, d.handle ?? 'se', snap(hit.current.x), snap(hit.current.z))
    // invalid (overlaps another room) → hold the last valid candidate
    const probe: RoomDef = { ...room, rect: cand }
    if (st.home.rooms.some((r) => r.id !== room.id && roomsOverlap(probe, r))) return
    d.candidate = cand
    d.next = cand
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    captureOf(e).releasePointerCapture(e.pointerId)
    if (controls) controls.enabled = true
    const c = d.candidate
    const changed =
      c !== null &&
      (Math.abs(c.x - room.rect.x) > 1e-9 ||
        Math.abs(c.z - room.rect.z) > 1e-9 ||
        Math.abs(c.w - room.rect.w) > 1e-9 ||
        Math.abs(c.d - room.rect.d) > 1e-9)
    if (c && changed) {
      useStore.getState().setRoomRect(room.id, c)
      // settle the visuals on whatever the store accepted (rejection → snap back)
      const after = roomById(useStore.getState().home, room.id)
      applyRect(after?.rect ?? room.rect)
    } else {
      applyRect(room.rect) // no valid candidate / no change → snap back
    }
  }

  const { x, z, w, d: dep } = room.rect
  return (
    <group>
      <mesh
        ref={overlayRef}
        rotation-x={-Math.PI / 2}
        position={[x, 0.01, z]}
        scale={[w, dep, 1]}
        onPointerDown={(e) => startDrag(e, 'move')}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={active ? SELECT_EDGE : PALETTE.cream}
          transparent
          opacity={active ? 0.15 : 0.08}
          depthWrite={false}
        />
        <Edges lineWidth={1} color={active ? SELECT_EDGE : EDGE} />
      </mesh>
      {active &&
        HANDLES.map((h) => {
          const [hx, hz] = handlePos(h, room.rect)
          return (
            <mesh
              key={h}
              ref={(m) => {
                handleRefs.current[h] = m
              }}
              position={[hx, 0.06, hz]}
              onPointerDown={(e) => startDrag(e, 'resize', h)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <boxGeometry args={[0.14, 0.12, 0.14]} />
              <meshStandardMaterial color={PALETTE.cream} roughness={1} metalness={0} />
              <Edges lineWidth={1} color={EDGE} />
            </mesh>
          )
        })}
    </group>
  )
}

/** Marker colors per opening kind (matches the plan's convention). */
const OPENING_COLORS: Record<Opening['kind'], string> = {
  door: SHELL.doorLeaf,
  open: PALETTE.wood,
  window: PALETTE.blue,
}
/** fullHeight 'open' (打通, no wall at all) gets a receding lavender. */
const GAP_COLOR = PALETTE.lavender

/** Small flat box sitting on the opening's wall line; click to select it. */
function OpeningMarker({
  home,
  opening,
  selected,
}: {
  home: HomeDef
  opening: Opening
  selected: boolean
}) {
  const room = roomById(home, opening.a)
  if (!room) return null
  const span = sideSpan(room, opening.side)
  const t = span.length > 0 ? opening.offset / span.length : 0
  const px = span.from[0] + (span.to[0] - span.from[0]) * t
  const pz = span.from[1] + (span.to[1] - span.from[1]) * t
  // a fullHeight opening visualizes its whole gap span along the wall axis
  const gap = opening.kind === 'open' && !!opening.fullHeight
  const alongX = opening.side === 'n' || opening.side === 's'
  const len = Math.max(opening.width, 0.24)
  const args: [number, number, number] = gap
    ? alongX
      ? [len, 0.03, 0.12]
      : [0.12, 0.03, len]
    : [0.24, 0.03, 0.24]
  return (
    <mesh
      position={[px, 0.035, pz]}
      scale={selected ? 1.3 : 1}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        const st = useStore.getState()
        // make the declaring room active first (it clears opening selection),
        // then select — the sidebar lands on this opening's editable row
        st.selectRoom(opening.a)
        st.selectOpening(opening.id)
      }}
    >
      <boxGeometry args={args} />
      <meshStandardMaterial
        color={gap ? GAP_COLOR : OPENING_COLORS[opening.kind]}
        emissive={selected ? SELECT_EDGE : '#000000'}
        emissiveIntensity={selected ? 0.7 : 0}
        roughness={1}
        metalness={0}
      />
      <Edges lineWidth={1} color={selected ? SELECT_EDGE : EDGE} />
    </mesh>
  )
}

export default function HomeEditor() {
  const home = useStore((s) => s.home)
  const activeRoomId = useStore((s) => s.activeRoomId)
  const selectedOpeningId = useStore((s) => s.selectedOpeningId)

  // entering the structure editor starts from a top-down view
  useEffect(() => {
    requestView('top')
  }, [])

  return (
    <group>
      {home.rooms.map((room) => (
        <RoomEditor key={room.id} room={room} active={room.id === activeRoomId} />
      ))}
      {home.openings.map((o) => (
        <OpeningMarker key={o.id} home={home} opening={o} selected={o.id === selectedOpeningId} />
      ))}
    </group>
  )
}

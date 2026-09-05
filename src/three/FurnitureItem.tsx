import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { get } from 'idb-keyval'
import { footprintOf, getModel, type FurnitureInstance } from '../models/registry'
import { PARAMETRIC_COMPONENTS } from '../models/parametric'
import { SELECT_EDGE } from '../models/parametric/shared'
import { useStore } from '../state/store'
import { MODEL_BLOB_KEY } from './runtime'
import EdgedModel from './EdgedModel'

// ---------------------------------------------------------------------------
// Upload blobs → object URLs (cached for the session; never revoked)
// ---------------------------------------------------------------------------

const objectUrlCache = new Map<string, string>()

function useUploadUrl(modelId: string): string | null {
  const [url, setUrl] = useState(() => objectUrlCache.get(modelId) ?? null)
  useEffect(() => {
    if (objectUrlCache.has(modelId)) return
    let alive = true
    get(MODEL_BLOB_KEY(modelId)).then((blob) => {
      if (!alive || !(blob instanceof Blob)) return
      const u = URL.createObjectURL(blob)
      objectUrlCache.set(modelId, u)
      setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [modelId])
  return url
}

// ---------------------------------------------------------------------------
// Selection outline: flat rectangle ring on the floor around the footprint
// ---------------------------------------------------------------------------

function SelectionRing({ w, d }: { w: number; d: number }) {
  const geom = useMemo(() => {
    const hw = w / 2 + 0.08
    const hd = d / 2 + 0.08
    const t = 0.03
    const s = new THREE.Shape()
    s.moveTo(-hw, -hd)
    s.lineTo(hw, -hd)
    s.lineTo(hw, hd)
    s.lineTo(-hw, hd)
    s.closePath()
    const hole = new THREE.Path()
    hole.moveTo(-(hw - t), -(hd - t))
    hole.lineTo(hw - t, -(hd - t))
    hole.lineTo(hw - t, hd - t)
    hole.lineTo(-(hw - t), hd - t)
    hole.closePath()
    s.holes.push(hole)
    return new THREE.ShapeGeometry(s)
  }, [w, d])
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh geometry={geom} rotation-x={-Math.PI / 2} position-y={0.012}>
      <meshBasicMaterial color={SELECT_EDGE} transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Furniture item
// ---------------------------------------------------------------------------

interface DragState {
  offX: number
  offZ: number
  /** latest snapped target, consumed once per frame */
  next: { x: number; z: number } | null
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/** R3F overrides event.target with its pointer-capture API at runtime. */
type CaptureTarget = {
  setPointerCapture: (pointerId: number) => void
  releasePointerCapture: (pointerId: number) => void
}
const captureOf = (e: ThreeEvent<PointerEvent>) => e.target as unknown as CaptureTarget

export default function FurnitureItem({
  instance,
  roomOffset,
}: {
  instance: FurnitureInstance
  /** room center in home coords; drag hits are converted to room-local with it */
  roomOffset: [number, number]
}) {
  const def = getModel(instance.modelId)
  const selected = useStore((s) => s.selectedId === instance.id)
  const wallHeight = useStore((s) => s.wallHeight)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const drag = useRef<DragState | null>(null)
  const hit = useRef(new THREE.Vector3())

  // Apply the throttled drag position once per frame.
  useFrame(() => {
    const d = drag.current
    if (!d?.next) return
    const { moveFurniture } = useStore.getState()
    moveFurniture(instance.id, d.next.x, d.next.z)
    d.next = null
  })

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    useStore.getState().select(instance.id)
    if (controls) controls.enabled = false
    captureOf(e).setPointerCapture(e.pointerId)
    if (e.ray.intersectPlane(groundPlane, hit.current)) {
      // ground-plane hit is world space; the drag offset is room-local
      drag.current = {
        offX: hit.current.x - roomOffset[0] - instance.position[0],
        offZ: hit.current.z - roomOffset[1] - instance.position[1],
        next: null,
      }
    }
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    if (!e.ray.intersectPlane(groundPlane, hit.current)) return
    let x = hit.current.x - roomOffset[0] - d.offX
    let z = hit.current.z - roomOffset[1] - d.offZ
    if (!e.altKey) {
      const grid = useStore.getState().moveGrid
      x = Math.round(x / grid) * grid
      z = Math.round(z / grid) * grid
    }
    d.next = { x, z }
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    // Commit the last pointer target before the gesture's history entry closes.
    if (drag.current.next) {
      useStore.getState().moveFurniture(instance.id, drag.current.next.x, drag.current.next.z)
    }
    drag.current = null
    captureOf(e).releasePointerCapture(e.pointerId)
    if (controls) controls.enabled = true
  }

  if (!def) return null

  const [footW, footD] = footprintOf(def, instance.params, 1)
  let y = def.mount === 'ceiling' ? wallHeight : 0
  // The TV stands on its bench: the layout places both at the same spot — lift
  // the panel by the bench's Height param (renderer-side, instances carry no y).
  if (def.id === 'builtin:tv') {
    const bench = useStore
      .getState()
      .furniture.find(
        (f) =>
          f.roomId === instance.roomId &&
          f.modelId === 'builtin:tv-bench' &&
          Math.abs(f.position[0] - instance.position[0]) < 0.06 &&
          Math.abs(f.position[1] - instance.position[1]) < 0.06,
      )
    const h = bench?.params?.Height
    y = typeof h === 'number' ? h : 0.45
  }

  let content: React.ReactNode = null
  if (def.kind === 'parametric') {
    const Comp = PARAMETRIC_COMPONENTS[def.id]
    content = Comp ? <Comp params={instance.params} selected={selected} /> : null
  } else if (def.kind === 'glb' && def.file) {
    content = (
      <EdgedModel
        url={def.file}
        footprint={def.footprint}
        selected={selected}
        hang={def.mount === 'ceiling'}
      />
    )
  } else if (def.kind === 'upload') {
    content = <UploadModel key={def.id} modelId={def.id} footprint={def.footprint} selected={selected} />
  }

  return (
    <group
      position={[instance.position[0], y, instance.position[1]]}
      rotation-y={instance.rotationY}
      scale={instance.scale}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <Suspense fallback={null}>{content}</Suspense>
      {/* selection ring always lands on the floor, even for ceiling-mounted pieces */}
      {selected && (
        <group position-y={-y}>
          <SelectionRing w={footW} d={footD} />
        </group>
      )}
    </group>
  )
}

function UploadModel({
  modelId,
  footprint,
  selected,
}: {
  modelId: string
  footprint: [number, number]
  selected?: boolean
}) {
  const url = useUploadUrl(modelId)
  if (!url) return null
  return <EdgedModel url={url} footprint={footprint} selected={selected} />
}

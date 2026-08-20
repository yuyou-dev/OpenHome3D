import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateLayout } from '../gen/layout'
import { getRoomType, typeDefaults } from '../gen/roomTypes'
import { boxAt, clamp, clampToRoom } from '../lib/geom'
import { randomSeed, rngFrom, uid } from '../lib/prng'
import {
  doorZonesFor,
  materializeShell,
  roomById,
  sideSpan,
  validateOpening,
  type HomeDef,
  type Opening,
  type RoomDef,
} from './home'
import {
  allModels,
  defaultParams,
  footprintOf,
  getModel,
  registerUpload,
  removeUpload as unregisterUpload,
  type FurnitureInstance,
  type ModelDef,
} from '../models/registry'

export type Projection = 'isometric' | 'perspective'

/** Global shell settings updatable via setStructure (partition height is per-room now). */
export interface StructureSettings {
  wallHeight: number
  cutawayWalls: boolean
  floorSlab: boolean
  windows: boolean
  doorLeaves: boolean
  showFurniture: boolean
}

/**
 * Single-room state: `home.rooms` always holds exactly one room (the HomeDef
 * wrapper is kept so the layout engine, wall derivation and opening logic are
 * unchanged); furniture positions stay room-local with the room center at [0,0].
 */
export interface HGState extends StructureSettings {
  home: HomeDef
  seed: string
  extras: number // 0–100
  moveGrid: number
  projection: Projection
  furniture: FurnitureInstance[]
  selectedId: string | null
  uploads: ModelDef[]
  lastSwapId: string | null

  setRoomType: (type: string) => void
  setRoomRect: (roomId: string, rect: RoomDef['rect']) => void
  setRoomPartition: (height: number) => void
  setSeed: (seed: string) => void
  randomizeSeed: () => void
  newRoom: () => void
  rebuild: () => void
  reshuffleFurniture: () => void
  addOpening: (o: Omit<Opening, 'id'>) => void
  removeOpening: (id: string) => void
  updateOpening: (id: string, partial: Partial<Omit<Opening, 'id'>>) => void
  setStructure: (partial: Partial<StructureSettings>) => void
  setExtras: (n: number) => void
  setMoveGrid: (n: number) => void
  setProjection: (p: Projection) => void
  addFurniture: (modelId: string, at?: [number, number]) => void
  removeFurniture: (id: string) => void
  duplicateFurniture: (id: string) => void
  swapModel: (id: string, newModelId: string) => void
  moveFurniture: (id: string, x: number, z: number) => void
  rotateFurniture: (id: string, rotationY: number) => void
  nudgeFurniture: (id: string, dx: number, dz: number) => void
  setScale: (id: string, scale: number) => void
  setParam: (id: string, key: string, value: number | boolean) => void
  resetShape: (id: string) => void
  select: (id: string | null) => void
  addUpload: (def: ModelDef) => void
  removeUpload: (id: string) => void
}

/**
 * Deterministic layout for one room. Instances get a room-prefixed id and
 * their roomId; positions stay room-local (engine math unchanged). Door
 * zones come from `s.home` — pass the next home when the calling action is
 * changing rooms/openings.
 */
function layoutForRoom(
  s: { seed: string; extras: number; home: HomeDef },
  room: RoomDef,
): FurnitureInstance[] {
  return generateLayout({
    roomType: room.type,
    seed: `${s.seed}@${room.id}`,
    salt: room.salt,
    width: room.rect.w,
    depth: room.rect.d,
    extras: s.extras,
    models: allModels(),
    doors: doorZonesFor(room, s.home),
  }).map((inst) => ({ ...inst, id: `${room.id}:${inst.id}`, roomId: room.id }))
}

/** All furniture except `room`'s, plus a freshly generated layout for it. */
function regenRoom(s: HGState, room: RoomDef, home: HomeDef = s.home): FurnitureInstance[] {
  return [
    ...s.furniture.filter((f) => f.roomId !== room.id),
    ...layoutForRoom({ seed: s.seed, extras: s.extras, home }, room),
  ]
}

/** Fresh layouts for every room (order follows rooms). */
function regenAll(
  s: { seed: string; extras: number; home: HomeDef },
  rooms: RoomDef[],
): FurnitureInstance[] {
  return rooms.flatMap((r) => layoutForRoom(s, r))
}

const round5cm = (v: number) => Math.round(v * 20) / 20
const clampDim = (v: number) => Math.min(12, Math.max(1.5, round5cm(v)))

/** Clamp an instance's position so its footprint stays inside a room of roomW×roomD. */
function clampedPosition(
  inst: FurnitureInstance,
  x: number,
  z: number,
  roomW: number,
  roomD: number,
): [number, number] {
  const def = getModel(inst.modelId)
  const [w, d] = def ? footprintOf(def, inst.params, inst.scale) : ([0.5, 0.5] as [number, number])
  const box = boxAt(x, z, w, d, inst.rotationY)
  return clampToRoom(box.x, box.z, box.w, box.d, roomW, roomD)
}

/** Keep an instance's current position inside its room after its geometry changes. */
function reclampInstance(inst: FurnitureInstance, home: HomeDef): FurnitureInstance {
  const room = roomById(home, inst.roomId)
  if (!room) return inst
  return {
    ...inst,
    position: clampedPosition(
      inst,
      inst.position[0],
      inst.position[1],
      room.rect.w,
      room.rect.d,
    ),
  }
}

const MIN_OPENING_W = 0.3

/** Clamp an opening's width/offset into its wall span. */
function clampOpeningToWall(home: HomeDef, o: Opening): Opening {
  const room = roomById(home, o.a)
  if (!room) return o
  const span = sideSpan(room, o.side).length
  const width = clamp(o.width, MIN_OPENING_W, Math.max(MIN_OPENING_W, span))
  const offset = clamp(o.offset, width / 2, span - width / 2)
  return { ...o, width, offset }
}

function initialLayoutState() {
  const seed = randomSeed()
  const rng = rngFrom(`${seed}:room:living`)
  const d = typeDefaults('living', rng)
  const room: RoomDef = {
    id: 'r1',
    type: 'living',
    name: getRoomType('living').label,
    rect: { x: 0, z: 0, w: d.width, d: d.depth },
    salt: 0,
    partitionHeight: d.partitionHeight,
  }
  const home: HomeDef = { rooms: [room], openings: materializeShell(room, getRoomType('living')) }
  return {
    seed,
    wallHeight: d.wallHeight,
    home,
    furniture: layoutForRoom({ seed, extras: 85, home }, room),
  }
}

const init = initialLayoutState()

/** Persisted slice (partialize result). */
type Persisted = {
  home: HomeDef
  seed: string
  wallHeight: number
  cutawayWalls: boolean
  floorSlab: boolean
  windows: boolean
  doorLeaves: boolean
  showFurniture: boolean
  extras: number
  moveGrid: number
  projection: Projection
  furniture: FurnitureInstance[]
  uploads: ModelDef[]
}

export const useStore = create<HGState>()(
  persist(
    (set, get) => ({
      home: init.home,
      seed: init.seed,
      wallHeight: init.wallHeight,
      cutawayWalls: true,
      floorSlab: true,
      windows: true,
      doorLeaves: true,
      showFurniture: true,
      extras: 85,
      moveGrid: 0.05,
      projection: 'isometric',
      furniture: init.furniture,
      selectedId: null,
      uploads: [],
      lastSwapId: null,

      setRoomType: (type) => {
        const s = get()
        const room = s.home.rooms[0]
        if (!room || room.type === type) return
        const spec = getRoomType(type)
        const next: RoomDef = { ...room, type, name: spec.label, salt: 0 }
        const rooms = s.home.rooms.map((r) => (r.id === room.id ? next : r))
        // re-materialize this room's shell openings to match the new type's spec
        const openings = [
          ...s.home.openings.filter((o) => o.a !== room.id),
          ...materializeShell(next, spec),
        ]
        set({ home: { rooms, openings }, furniture: regenRoom(s, next, { rooms, openings }), selectedId: null })
      },

      setRoomRect: (roomId, rect) => {
        const s = get()
        const room = roomById(s.home, roomId)
        if (!room) return
        const nextRect = {
          x: round5cm(rect.x),
          z: round5cm(rect.z),
          w: clampDim(rect.w),
          d: clampDim(rect.d),
        }
        const candidate: RoomDef = { ...room, rect: nextRect }
        const rooms = s.home.rooms.map((r) => (r.id === roomId ? candidate : r))
        // w/d change → regenerate that room; x/z move keeps room-local furniture as-is
        const dimsChanged = nextRect.w !== room.rect.w || nextRect.d !== room.rect.d
        set({
          home: { ...s.home, rooms },
          ...(dimsChanged ? { furniture: regenRoom(s, candidate, { ...s.home, rooms }) } : {}),
        })
      },

      setRoomPartition: (height) => {
        const s = get()
        const room = s.home.rooms[0]
        if (!room) return
        const h = Math.max(0, round5cm(height))
        const rooms = s.home.rooms.map((r) =>
          r.id === room.id ? { ...r, partitionHeight: h } : r,
        )
        set({ home: { ...s.home, rooms } })
      },

      setSeed: (seed) => {
        const clean = seed.trim().toUpperCase()
        if (!clean) return
        const s = get()
        const rooms = s.home.rooms.map((r) => ({ ...r, salt: 0 }))
        set({
          seed: clean,
          home: { ...s.home, rooms },
          furniture: regenAll({ seed: clean, extras: s.extras, home: { ...s.home, rooms } }, rooms),
        })
      },

      randomizeSeed: () => {
        get().setSeed(randomSeed())
      },

      newRoom: () => {
        const s = get()
        const seed = randomSeed()
        const rng = rngFrom(`${seed}:room:living`)
        const d = typeDefaults('living', rng)
        const room: RoomDef = {
          id: uid(),
          type: 'living',
          name: getRoomType('living').label,
          rect: { x: 0, z: 0, w: d.width, d: d.depth },
          salt: 0,
          partitionHeight: d.partitionHeight,
        }
        const home: HomeDef = {
          rooms: [room],
          openings: materializeShell(room, getRoomType('living')),
        }
        set({
          seed,
          home,
          wallHeight: d.wallHeight,
          furniture: layoutForRoom({ seed, extras: s.extras, home }, room),
          selectedId: null,
        })
      },

      rebuild: () => {
        const s = get()
        const room = s.home.rooms[0]
        if (!room) return
        set({ furniture: regenRoom(s, room), selectedId: null })
      },

      reshuffleFurniture: () => {
        const s = get()
        const room = s.home.rooms[0]
        if (!room) return
        const next: RoomDef = { ...room, salt: room.salt + 1 }
        const rooms = s.home.rooms.map((r) => (r.id === room.id ? next : r))
        set({
          home: { ...s.home, rooms },
          furniture: regenRoom(s, next, { ...s.home, rooms }),
          selectedId: null,
        })
      },

      addOpening: (o) => {
        const s = get()
        if (!roomById(s.home, o.a)) return
        const next = clampOpeningToWall(s.home, { ...o, id: uid() })
        if (!validateOpening(s.home, next)) return
        set({ home: { ...s.home, openings: [...s.home.openings, next] } })
      },

      removeOpening: (id) => {
        const s = get()
        set({
          home: { ...s.home, openings: s.home.openings.filter((o) => o.id !== id) },
        })
      },

      updateOpening: (id, partial) => {
        const s = get()
        const cur = s.home.openings.find((o) => o.id === id)
        if (!cur) return
        const next = clampOpeningToWall(s.home, { ...cur, ...partial, id: cur.id })
        if (!validateOpening(s.home, next)) return
        set({
          home: { ...s.home, openings: s.home.openings.map((o) => (o.id === id ? next : o)) },
        })
      },

      setStructure: (partial) => set(partial),

      setExtras: (n) => {
        const extras = Math.max(0, Math.min(100, Math.round(n)))
        const s = get()
        set({ extras, furniture: regenAll({ seed: s.seed, extras, home: s.home }, s.home.rooms) })
      },

      setMoveGrid: (n) => set({ moveGrid: Math.max(0.01, n) }),

      setProjection: (p) => set({ projection: p }),

      addFurniture: (modelId, at) => {
        const def = getModel(modelId)
        if (!def) return
        const s = get()
        const room = s.home.rooms[0]
        if (!room) return
        const inst: FurnitureInstance = {
          id: uid(),
          roomId: room.id,
          modelId: def.id,
          label: def.name,
          position: [0, 0],
          rotationY: 0,
          params: defaultParams(def),
          scale: 1,
        }
        inst.position = clampedPosition(inst, at?.[0] ?? 0, at?.[1] ?? 0, room.rect.w, room.rect.d)
        set({ furniture: [...s.furniture, inst], selectedId: inst.id })
      },

      removeFurniture: (id) => {
        const s = get()
        set({
          furniture: s.furniture.filter((f) => f.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })
      },

      duplicateFurniture: (id) => {
        const s = get()
        const src = s.furniture.find((f) => f.id === id)
        if (!src) return
        const room = roomById(s.home, src.roomId)
        if (!room) return
        const copy: FurnitureInstance = {
          ...src,
          id: uid(),
          params: { ...src.params },
          position: [src.position[0], src.position[1]],
        }
        copy.position = clampedPosition(
          copy,
          src.position[0] + 0.3,
          src.position[1] + 0.3,
          room.rect.w,
          room.rect.d,
        )
        set({ furniture: [...s.furniture, copy], selectedId: copy.id })
      },

      swapModel: (id, newModelId) => {
        const def = getModel(newModelId)
        if (!def) return
        const s = get()
        set({
          furniture: s.furniture.map((f) =>
            f.id === id
              ? reclampInstance(
                  { ...f, modelId: def.id, label: def.name, params: defaultParams(def) },
                  s.home,
                )
              : f,
          ),
          lastSwapId: newModelId,
        })
      },

      moveFurniture: (id, x, z) => {
        const s = get()
        set({
          furniture: s.furniture.map((f) => {
            if (f.id !== id) return f
            const room = roomById(s.home, f.roomId)
            return room
              ? { ...f, position: clampedPosition(f, x, z, room.rect.w, room.rect.d) }
              : f
          }),
        })
      },

      rotateFurniture: (id, rotationY) => {
        const s = get()
        set({
          furniture: s.furniture.map((f) => {
            if (f.id !== id) return f
            const room = roomById(s.home, f.roomId)
            if (!room) return f
            const next = { ...f, rotationY }
            next.position = clampedPosition(
              next,
              f.position[0],
              f.position[1],
              room.rect.w,
              room.rect.d,
            )
            return next
          }),
        })
      },

      nudgeFurniture: (id, dx, dz) => {
        const s = get()
        const f = s.furniture.find((it) => it.id === id)
        if (!f) return
        get().moveFurniture(id, f.position[0] + dx, f.position[1] + dz)
      },

      setScale: (id, scale) => {
        if (!Number.isFinite(scale)) return
        const s = get()
        const nextScale = clamp(scale, 0.1, 2)
        set({
          furniture: s.furniture.map((f) =>
            f.id === id ? reclampInstance({ ...f, scale: nextScale }, s.home) : f,
          ),
        })
      },

      setParam: (id, key, value) => {
        const s = get()
        set({
          furniture: s.furniture.map((f) =>
            f.id === id
              ? reclampInstance({ ...f, params: { ...f.params, [key]: value } }, s.home)
              : f,
          ),
        })
      },

      resetShape: (id) => {
        const s = get()
        set({
          furniture: s.furniture.map((f) => {
            if (f.id !== id) return f
            const def = getModel(f.modelId)
            return def
              ? reclampInstance({ ...f, params: defaultParams(def), scale: 1 }, s.home)
              : f
          }),
        })
      },

      select: (id) => set({ selectedId: id }),

      addUpload: (def) => {
        registerUpload(def)
        const s = get()
        if (s.uploads.some((u) => u.id === def.id)) return
        set({ uploads: [...s.uploads, def] })
      },

      removeUpload: (id) => {
        unregisterUpload(id)
        const s = get()
        const removedIds = new Set(
          s.furniture.filter((f) => f.modelId === id).map((f) => f.id),
        )
        set({
          uploads: s.uploads.filter((u) => u.id !== id),
          furniture: s.furniture.filter((f) => f.modelId !== id),
          selectedId: s.selectedId && removedIds.has(s.selectedId) ? null : s.selectedId,
        })
      },
    }),
    {
      name: 'openhome3d',
      version: 1,
      partialize: (s): Persisted => ({
        home: s.home,
        seed: s.seed,
        wallHeight: s.wallHeight,
        cutawayWalls: s.cutawayWalls,
        floorSlab: s.floorSlab,
        windows: s.windows,
        doorLeaves: s.doorLeaves,
        showFurniture: s.showFurniture,
        extras: s.extras,
        moveGrid: s.moveGrid,
        projection: s.projection,
        furniture: s.furniture,
        uploads: s.uploads,
      }),
      onRehydrateStorage: () => (state) => {
        // restored uploads are metadata-only in storage; re-register them in the live registry
        state?.uploads.forEach((u) => registerUpload(u))
      },
    },
  ),
)

export type { FurnitureInstance, ModelDef } from '../models/registry'

// dev-only debug handle (used by scripts/smoke-ui.mjs to drive deterministic states)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}

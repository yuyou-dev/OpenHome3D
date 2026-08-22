import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateLayout } from '../gen/layout'
import { getRoomType, typeDefaults } from '../gen/roomTypes'
import { buildHome } from '../gen/templates'
import { boxAt, clamp, clampToRoom } from '../lib/geom'
import { randomSeed, rngFrom, uid } from '../lib/prng'
import {
  doorZonesFor,
  materializeShell,
  roomById,
  roomsOverlap,
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
import { deletePlanImage, PLAN_IMAGE_KEY, savePlanImage } from '../lib/planImage'

export type PlanTab = 'home' | 'room'
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
 * Multi-room home state: `home{rooms,openings}` (rectangular rooms in a shared
 * coordinate system; walls are derived, never stored), home-level `seed`, and
 * furniture instances positioned room-locally (room center = [0,0]).
 * `planTab`/`activeRoomId`/`selectedOpeningId`/`lastSwapId` are session-only
 * (activeRoomId falls back to rooms[0] on rehydrate).
 */
export interface HGState extends StructureSettings {
  planTab: PlanTab
  home: HomeDef
  seed: string
  /** room the Room tab edits and new furniture lands in; NOT persisted */
  activeRoomId: string
  extras: number // 0–100
  moveGrid: number
  projection: Projection
  furniture: FurnitureInstance[]
  selectedId: string | null
  /** opening selected in the HomeEditor canvas / Home tab list; NOT persisted */
  selectedOpeningId: string | null
  uploads: ModelDef[]
  lastSwapId: string | null
  /**
   * idb-keyval key of the latest imported floor-plan image (bytes live in
   * IndexedDB, see src/lib/planImage.ts); null = no image. Persisted.
   */
  planImageKey: string | null

  setPlanTab: (tab: PlanTab) => void
  setRoomType: (type: string) => void
  setRoomRect: (roomId: string, rect: RoomDef['rect']) => void
  setRoomPartition: (height: number) => void
  setSeed: (seed: string) => void
  randomizeSeed: () => void
  newRoom: () => void
  newHome: (templateId: string) => void
  importHome: (home: HomeDef) => void
  /** Save the imported plan image (dataURL) to IndexedDB and mark it present. */
  setPlanImage: (dataUrl: string) => void
  /** Drop the imported plan image (IndexedDB + flag). */
  clearPlanImage: () => void
  rebuild: () => void
  reshuffleFurniture: () => void
  addRoom: (type?: string) => void
  removeRoom: (roomId: string) => void
  selectRoom: (roomId: string) => void
  selectOpening: (id: string | null) => void
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
  exportProject: () => string
  importProject: (json: string) => string | null // null = ok; bilingual error otherwise
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

/** Lightweight project-file schema version (see exportProject/importProject). */
const PROJECT_FILE_VERSION = 1

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
  planImageKey: string | null
}

export const useStore = create<HGState>()(
  persist(
    (set, get) => ({
      planTab: 'room',
      home: init.home,
      seed: init.seed,
      activeRoomId: init.home.rooms[0].id,
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
      selectedOpeningId: null,
      uploads: [],
      lastSwapId: null,
      planImageKey: null,

      setPlanTab: (tab) => set({ planTab: tab }),

      setRoomType: (type) => {
        const s = get()
        const room = roomById(s.home, s.activeRoomId)
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
        // never overlap another room (a shared edge is fine)
        if (s.home.rooms.some((r) => r.id !== roomId && roomsOverlap(candidate, r))) return
        const rooms = s.home.rooms.map((r) => (r.id === roomId ? candidate : r))
        // w/d change → regenerate that room; x/z move keeps room-local furniture as-is
        const dimsChanged = nextRect.w !== room.rect.w || nextRect.d !== room.rect.d
        // resized walls can strand openings: re-clamp this room's into their spans
        const nextHome: HomeDef = { ...s.home, rooms }
        const openings = dimsChanged
          ? s.home.openings.map((o) => (o.a === roomId ? clampOpeningToWall(nextHome, o) : o))
          : s.home.openings
        const home: HomeDef = { ...nextHome, openings }
        set({
          home,
          ...(dimsChanged ? { furniture: regenRoom(s, candidate, home) } : {}),
        })
      },

      setRoomPartition: (height) => {
        const s = get()
        const room = roomById(s.home, s.activeRoomId)
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
          activeRoomId: room.id,
          wallHeight: d.wallHeight,
          furniture: layoutForRoom({ seed, extras: s.extras, home }, room),
          selectedId: null,
          selectedOpeningId: null,
        })
      },

      newHome: (templateId) => {
        const s = get()
        const seed = randomSeed()
        const home = buildHome(templateId, seed)
        // a template no longer matches any imported plan image
        if (s.planImageKey) deletePlanImage()
        set({
          seed,
          home,
          activeRoomId: home.rooms[0].id,
          furniture: regenAll({ seed, extras: s.extras, home }, home.rooms),
          selectedId: null,
          selectedOpeningId: null,
          planImageKey: null,
        })
      },

      /** Adopt an imported home (floor-plan recognition): keep the current seed, lay out every room. */
      importHome: (home) => {
        const s = get()
        set({
          home,
          activeRoomId: home.rooms[0].id,
          furniture: regenAll({ seed: s.seed, extras: s.extras, home }, home.rooms),
          selectedId: null,
          selectedOpeningId: null,
        })
      },

      setPlanImage: (dataUrl) => {
        savePlanImage(dataUrl).catch(() => {})
        set({ planImageKey: PLAN_IMAGE_KEY })
      },

      clearPlanImage: () => {
        deletePlanImage().catch(() => {})
        set({ planImageKey: null })
      },

      rebuild: () => {
        const s = get()
        const room = roomById(s.home, s.activeRoomId)
        if (!room) return
        set({ furniture: regenRoom(s, room), selectedId: null })
      },

      reshuffleFurniture: () => {
        const s = get()
        const room = roomById(s.home, s.activeRoomId)
        if (!room) return
        const next: RoomDef = { ...room, salt: room.salt + 1 }
        const rooms = s.home.rooms.map((r) => (r.id === room.id ? next : r))
        set({
          home: { ...s.home, rooms },
          furniture: regenRoom(s, next, { ...s.home, rooms }),
          selectedId: null,
        })
      },

      addRoom: (type) => {
        const s = get()
        const active = roomById(s.home, s.activeRoomId) ?? s.home.rooms[0]
        if (!active) return
        const t = type ?? 'living'
        const spec = getRoomType(t)
        const d = typeDefaults(t, rngFrom(`${s.seed}:room:${t}`))
        const room: RoomDef = {
          id: uid(),
          type: t,
          name: spec.label,
          rect: {
            // east of the active room, gap 0, same depth (shared n/s edges)
            x: active.rect.x + active.rect.w / 2 + d.width / 2,
            z: active.rect.z,
            w: d.width,
            d: active.rect.d,
          },
          salt: 0,
          partitionHeight: d.partitionHeight,
        }
        // slot taken → stagger +z until free (bounded search, last try stands)
        for (let i = 0; i < 10 && s.home.rooms.some((r) => roomsOverlap(room, r)); i++) {
          room.rect.z += 0.5
        }
        const home: HomeDef = { rooms: [...s.home.rooms, room], openings: s.home.openings }
        // shell openings that violate placement rules (e.g. a window landing on
        // a now-shared interior wall) are dropped, same contract as addOpening
        const shell = materializeShell(room, spec).filter((o) => validateOpening(home, o))
        const nextHome: HomeDef = { ...home, openings: [...home.openings, ...shell] }
        set({
          home: nextHome,
          activeRoomId: room.id,
          furniture: [
            ...s.furniture,
            ...layoutForRoom({ seed: s.seed, extras: s.extras, home: nextHome }, room),
          ],
        })
      },

      removeRoom: (roomId) => {
        const s = get()
        if (s.home.rooms.length <= 1) return // keep at least one room
        if (!roomById(s.home, roomId)) return
        const rooms = s.home.rooms.filter((r) => r.id !== roomId)
        const openings = s.home.openings.filter((o) => o.a !== roomId && o.b !== roomId)
        set({
          home: { rooms, openings },
          furniture: s.furniture.filter((f) => f.roomId !== roomId),
          activeRoomId: s.activeRoomId === roomId ? rooms[0].id : s.activeRoomId,
          selectedId: s.furniture.some((f) => f.id === s.selectedId && f.roomId === roomId)
            ? null
            : s.selectedId,
          selectedOpeningId: openings.some((o) => o.id === s.selectedOpeningId)
            ? s.selectedOpeningId
            : null,
        })
      },

      selectRoom: (roomId) => {
        if (roomById(get().home, roomId))
          set({ activeRoomId: roomId, selectedOpeningId: null, selectedId: null })
      },

      selectOpening: (id) => set({ selectedOpeningId: id }),

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
          selectedOpeningId: s.selectedOpeningId === id ? null : s.selectedOpeningId,
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

      // Lightweight JSON project file (idea from OpenHome3D discussion #6):
      // room, openings and registry furniture only — uploaded GLBs stay out of scope.
      exportProject: () => {
        const s = get()
        return JSON.stringify(
          {
            version: PROJECT_FILE_VERSION,
            seed: s.seed,
            extras: s.extras,
            home: s.home,
            // uploaded GLBs stay out of the project file (their blobs live in
            // IndexedDB and can't travel), so their instances are filtered out
            furniture: s.furniture.filter((f) => !f.modelId.startsWith('upload:')),
          },
          null,
          2,
        )
      },

      importProject: (json) => {
        let p: any
        try {
          p = JSON.parse(json)
        } catch {
          return '文件不是有效的 JSON Invalid JSON file'
        }
        if (p?.version !== PROJECT_FILE_VERSION)
          return '项目文件版本不支持 Unsupported project file version'
        const rawRooms = p.home?.rooms
        if (!Array.isArray(rawRooms) || rawRooms.length === 0)
          return '项目文件没有房间 No rooms in project file'
        // rooms: validate rects, clamp dims, dedupe/keep ids, drop overlaps
        const idMap = new Map<string, string>() // file id → live id
        const rooms: RoomDef[] = []
        for (const r of rawRooms) {
          const rect = r?.rect
          if (!rect || ![rect.x, rect.z, rect.w, rect.d].every((v) => Number.isFinite(v))) continue
          const fileId = typeof r.id === 'string' && r.id ? r.id : ''
          const id = fileId && !idMap.has(fileId) ? fileId : uid()
          const room: RoomDef = {
            id,
            type: getRoomType(r.type) ? r.type : 'living',
            name:
              typeof r.name === 'string' && r.name
                ? r.name
                : (getRoomType(r.type)?.label ?? '客厅 Living'),
            rect: {
              x: round5cm(rect.x),
              z: round5cm(rect.z),
              w: clampDim(rect.w),
              d: clampDim(rect.d),
            },
            salt: Number.isFinite(r.salt) ? Math.max(0, Math.round(r.salt)) : 0,
            partitionHeight: Number.isFinite(r.partitionHeight)
              ? Math.max(0, round5cm(r.partitionHeight))
              : 0,
          }
          if (rooms.some((o) => roomsOverlap(room, o))) continue
          rooms.push(room)
          if (fileId) idMap.set(fileId, id)
        }
        if (rooms.length === 0) return '房间尺寸数据无效 Invalid room rect'
        const home: HomeDef = { rooms, openings: [] }
        // openings: a/b resolved through the id map ('exterior' stays)
        for (const o of Array.isArray(p.home?.openings) ? p.home.openings : []) {
          if (!o || !['door', 'window', 'open'].includes(o.kind)) continue
          if (!['n', 's', 'e', 'w'].includes(o.side)) continue
          if (!Number.isFinite(o.offset) || !Number.isFinite(o.width)) continue
          const a = idMap.get(o.a)
          const b = o.b === 'exterior' ? 'exterior' : idMap.get(o.b)
          if (!a || !b) continue
          const next = clampOpeningToWall(home, {
            id: typeof o.id === 'string' && o.id ? o.id : uid(),
            kind: o.kind,
            a,
            b,
            side: o.side,
            offset: o.offset,
            width: o.width,
            ...(o.fullHeight === true ? { fullHeight: true } : {}),
          })
          if (validateOpening(home, next)) home.openings.push(next)
        }
        const fallbackRoom = rooms[0]
        const furniture: FurnitureInstance[] = []
        for (const f of Array.isArray(p.furniture) ? p.furniture : []) {
          const def = f && getModel(f.modelId)
          if (!def) continue
          const room = roomById(home, idMap.get(f.roomId) ?? '') ?? fallbackRoom
          const inst: FurnitureInstance = {
            id: typeof f.id === 'string' && f.id ? f.id : uid(),
            roomId: room.id,
            modelId: def.id,
            label: def.name,
            position: [
              Number.isFinite(f.position?.[0]) ? f.position[0] : 0,
              Number.isFinite(f.position?.[1]) ? f.position[1] : 0,
            ],
            rotationY: Number.isFinite(f.rotationY) ? f.rotationY : 0,
            params: { ...defaultParams(def), ...(f.params ?? {}) },
            scale: clamp(Number.isFinite(f.scale) ? f.scale : 1, 0.1, 2),
          }
          inst.position = clampedPosition(
            inst,
            inst.position[0],
            inst.position[1],
            room.rect.w,
            room.rect.d,
          )
          furniture.push(inst)
        }
        set({
          seed: typeof p.seed === 'string' && p.seed.trim() ? p.seed.trim().toUpperCase() : randomSeed(),
          extras: Number.isFinite(p.extras) ? Math.max(0, Math.min(100, Math.round(p.extras))) : 50,
          home,
          furniture,
          activeRoomId: rooms[0].id,
          selectedId: null,
          selectedOpeningId: null,
        })
        return null
      },

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
        const room = roomById(s.home, s.activeRoomId) ?? s.home.rooms[0]
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
      version: 2,
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
        planImageKey: s.planImageKey,
      }),
      migrate: (persisted, version): Persisted => {
        // v1 → v2: same HomeDef shape (single room in an array); the only new
        // persisted field is planImageKey. Pure pass-through.
        if (version < 2) return { ...((persisted ?? {}) as Persisted), planImageKey: null }
        return persisted as Persisted
      },
      onRehydrateStorage: () => (state) => {
        // restored uploads are metadata-only in storage; re-register them in the live registry
        state?.uploads.forEach((u) => registerUpload(u))
        // activeRoomId is not persisted: fall back to the first room
        if (state && !state.home.rooms.some((r) => r.id === state.activeRoomId)) {
          state.activeRoomId = state.home.rooms[0]?.id ?? ''
        }
      },
    },
  ),
)

export type { FurnitureInstance, ModelDef } from '../models/registry'

// dev-only debug handle (used by scripts/smoke-ui.mjs to drive deterministic states)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}

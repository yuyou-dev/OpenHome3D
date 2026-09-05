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
  fitOpening,
  reconcileOpenings,
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
import { deletePlanImage, loadPlanImage, PLAN_IMAGE_KEY, savePlanImage } from '../lib/planImage'
import { createHistory } from './history'
import type { ArchitecturalPlan } from './architecture'
import { validateArchitecture } from '../gen/importArchitecture'
import { architecturalFurnitureFits, canonicalArchitecturalHome, findArchitecturalPosition, generateArchitecturalRoom, importArchitecturalFurniture } from '../gen/architecturalFurniture'

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
export interface CompleteProjectState extends StructureSettings {
  home: HomeDef
  seed: string
  extras: number
  furniture: FurnitureInstance[]
  uploads: ModelDef[]
  planImageUrl: string | null
  moveGrid: number
  projection: Projection
}

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
  structureNotice: string | null
  dismissStructureNotice: () => void
  restoreCompleteProject: (project: CompleteProjectState) => void
  /**
   * idb-keyval key of the latest imported floor-plan image (bytes live in
   * IndexedDB, see src/lib/planImage.ts); null = no image. Persisted.
   */
  planImageKey: string | null
  /** Reactive image bytes for this session; never written to localStorage. */
  planImageUrl: string | null
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  beginEdit: () => void
  endEdit: () => void
  /** Rehydrate image bytes and any snapshots captured while IndexedDB was loading. */
  restorePlanImage: () => Promise<void>

  setArchitecture: (plan: ArchitecturalPlan) => void
  setPlanTab: (tab: PlanTab) => void
  setRoomType: (type: string) => void
  setRoomRect: (roomId: string, rect: RoomDef['rect']) => void
  setRoomPartition: (height: number) => void
  setSeed: (seed: string) => void
  randomizeSeed: () => void
  newRoom: () => void
  newHome: (templateId: string) => void
  importHome: (home: HomeDef, imageUrl?: string) => void
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
  setFurnitureLocked: (id: string, locked: boolean) => void
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
  preserved: FurnitureInstance[] = [],
  decorOnly = false,
): FurnitureInstance[] {
  if (s.home.architecture) return generateArchitecturalRoom(s.home, room, s.seed, s.extras, preserved, decorOnly)
  return generateLayout({
    roomType: room.type,
    seed: `${s.seed}@${room.id}`,
    salt: room.salt,
    width: room.rect.w,
    depth: room.rect.d,
    extras: s.extras,
    models: allModels(),
    preserved,
    decorOnly,
    doors: doorZonesFor(room, s.home),
  }).map((inst) => ({ ...inst, id: `${room.id}:${inst.id}`, roomId: room.id }))
}

/** User/legacy work survives regeneration. Only untouched automatic pieces are replaceable. */
function isPreserved(f: FurnitureInstance): boolean {
  return f.source !== 'generated' || !!f.locked
}

function regenRoom(s: HGState, room: RoomDef, home: HomeDef = s.home): FurnitureInstance[] {
  const preserved = s.furniture.filter((f) => f.roomId === room.id && isPreserved(f))
  return [
    ...s.furniture.filter((f) => f.roomId !== room.id),
    ...preserved,
    ...layoutForRoom({ seed: s.seed, extras: s.extras, home }, room, preserved),
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
  if (!room || home.architecture) return inst
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

/** Lightweight project-file schema version (see exportProject/importProject). */
const PROJECT_FILE_VERSION = 1

function structurePatch(home: HomeDef, selectedOpeningId: string | null): Partial<HGState> {
  if (home.architecture) return { home, selectedOpeningId: null, structureNotice: home.architecture.warnings.length ? `${home.architecture.warnings.length} 项提示见专业结构面板 Review notes in the structure panel` : null }
  const result = reconcileOpenings(home)
  return {
    home: result.home,
    selectedOpeningId: result.home.openings.some((o) => o.id === selectedOpeningId) ? selectedOpeningId : null,
    structureNotice: result.removed || result.adjusted
      ? `门窗已随墙体更新：移除 ${result.removed}，调整 ${result.adjusted}。Openings updated: ${result.removed} removed, ${result.adjusted} adjusted.`
      : null,
  }
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

const EDIT_KEYS = [
  'home', 'seed', 'furniture', 'extras', 'wallHeight', 'cutawayWalls',
  'floorSlab', 'windows', 'doorLeaves', 'showFurniture', 'planImageUrl', 'planImageKey',
] as const
const SNAPSHOT_KEYS = [...EDIT_KEYS, 'activeRoomId', 'selectedId', 'selectedOpeningId'] as const
type SceneSnapshot = Pick<HGState, typeof SNAPSHOT_KEYS[number]>
type EditSnapshot = SceneSnapshot & {
  /** Only project replacement restores these; ordinary editing leaves the user's view alone. */
  importSettings?: Pick<HGState, 'projection' | 'moveGrid'>
}
function snapshot(state: HGState, includeView = false): EditSnapshot {
  const scene = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, state[key]])) as SceneSnapshot
  return includeView ? { ...scene, importSettings: { projection: state.projection, moveGrid: state.moveGrid } } : scene
}

function persistPlanImage(before: HGState, after: HGState) {
  if (before.planImageUrl === after.planImageUrl && before.planImageKey === after.planImageKey) return
  // A present key with no URL means hydration is still pending, not deletion.
  if (after.planImageKey && !after.planImageUrl) return
  const saving = after.planImageUrl ? savePlanImage(after.planImageUrl) : deletePlanImage()
  saving.catch(() => {})
}

export const useStore = create<HGState>()(
  persist(
    (rawSet, get) => {
      const history = createHistory<EditSnapshot>()
      const set = (patch: Partial<HGState>, includeView = false) => {
        const before = get()
        const nextHome = patch.home ?? before.home
        if (nextHome.architecture && patch.furniture) {
          let rejected = 0
          const furniture = patch.furniture.flatMap(item => {
            if (architecturalFurnitureFits(nextHome, item)) return [item]
            rejected++
            const previous = before.furniture.find(f => f.id === item.id)
            return previous && architecturalFurnitureFits(nextHome, previous) ? [previous] : []
          })
          patch = { ...patch, furniture: furniture.length === before.furniture.length && furniture.every((f, i) => f === before.furniture[i]) ? before.furniture : furniture }
          if (rejected) patch.structureNotice = '家具不能进入墙体、门区、挑空、楼梯或房间外部 Furniture must remain on usable floor'
          const selectedId = patch.selectedId === undefined ? before.selectedId : patch.selectedId
          if (selectedId && !furniture.some(f => f.id === selectedId)) patch.selectedId = null
        }
        const after = { ...before, ...patch }
        if (EDIT_KEYS.some((key) => before[key] !== after[key]) ||
          (includeView && (before.projection !== after.projection || before.moveGrid !== after.moveGrid))) {
          history.record(snapshot(before, includeView))
        }
        rawSet({ ...patch, ...history.flags() })
        persistPlanImage(before, after)
      }
      const blockRectangleEdit = () => {
        if (!get().home.architecture) return false
        rawSet({ structureNotice: '请在专业结构面板编辑真实户型 Edit this plan in the architectural structure panel' })
        return true
      }
      const restore = (direction: 'undo' | 'redo') => {
        const before = get()
        const next = history[direction](snapshot(before), (current, target) =>
          target.importSettings ? snapshot(before, true) : current)
        if (!next) return
        const { importSettings, ...scene } = next
        rawSet({ ...scene, ...importSettings, ...history.flags() })
        persistPlanImage(before, get())
      }
      return {
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
        structureNotice: null,
        dismissStructureNotice: () => rawSet({ structureNotice: null }),
        restoreCompleteProject: (project) => {
          if (project.home.architecture) validateArchitecture(project.home.architecture)
          const before = get()
          history.end()
          project.uploads.forEach(registerUpload)
          const uploads = [...before.uploads.filter((u) => !project.uploads.some((next) => next.id === u.id)), ...project.uploads]
          set({
            ...project,
            uploads,
            ...structurePatch(project.home, null),
            activeRoomId: project.home.rooms[0].id,
            selectedId: null,
            planImageKey: project.planImageUrl ? PLAN_IMAGE_KEY : null,
          }, true)
        },
        planImageKey: null,
        planImageUrl: null,
        canUndo: false,
        canRedo: false,
        undo: () => restore('undo'),
        redo: () => restore('redo'),
        beginEdit: history.begin,
        endEdit: history.end,
        restorePlanImage: async () => {
          const url = (await loadPlanImage()) ?? null
          history.update((entry) => entry.planImageKey && entry.planImageUrl === null
            ? { ...entry, planImageUrl: url } : entry)
          if (get().planImageKey && get().planImageUrl === null) {
            rawSet({ planImageUrl: url })
            // A reset followed by undo may have cleared the slot while loading.
            if (url) await savePlanImage(url)
          }
        },

        setArchitecture: (plan) => {
          validateArchitecture(plan)
          const s = get()
          const home = canonicalArchitecturalHome({ ...s.home, architecture: plan })
          const factor = s.home.architecture ? plan.source.scale / s.home.architecture.source.scale : 1
          const furniture = s.furniture.flatMap(item => {
            const oldRoom = roomById(s.home, item.roomId), room = roomById(home, item.roomId)
            if (!oldRoom || !room) return []
            const next: FurnitureInstance = { ...item, scale: item.scale * factor, position: [(item.position[0] + oldRoom.rect.x) * factor - room.rect.x, (item.position[1] + oldRoom.rect.z) * factor - room.rect.z] }
            return architecturalFurnitureFits(home, next) ? [next] : []
          })
          const removed = s.furniture.length - furniture.length
          set({ home, furniture, activeRoomId: home.rooms.some(room => room.id === s.activeRoomId) ? s.activeRoomId : home.rooms[0].id,
            selectedOpeningId: null,
            structureNotice: removed ? `结构调整移除了 ${removed} 件无合法位置的家具 Removed furniture outside usable floor: ${removed}` : null })
        },

        setPlanTab: (tab) => set({ planTab: tab }),

        setRoomType: (type) => {
          if (blockRectangleEdit()) return
          const s = get()
          const room = roomById(s.home, s.activeRoomId)
          if (!room || room.type === type) return
          const spec = getRoomType(type)
          const next: RoomDef = { ...room, type, name: spec.label }
          const rooms = s.home.rooms.map((r) => (r.id === room.id ? next : r))
          set({ home: { ...s.home, rooms } })
        },

        setRoomRect: (roomId, rect) => {
          if (blockRectangleEdit()) return
          const s = get()
          const room = roomById(s.home, roomId)
          if (!room) return
          const nextRect = {
            x: round5cm(rect.x),
            z: round5cm(rect.z),
            w: clampDim(rect.w),
            d: clampDim(rect.d),
          }
          if (Object.entries(nextRect).every(([key, value]) => room.rect[key as keyof RoomDef['rect']] === value)) return
          const candidate: RoomDef = { ...room, rect: nextRect }
          // never overlap another room (a shared edge is fine)
          if (s.home.rooms.some((r) => r.id !== roomId && roomsOverlap(candidate, r))) return
          const rooms = s.home.rooms.map((r) => (r.id === roomId ? candidate : r))
          const dimsChanged = nextRect.w !== room.rect.w || nextRect.d !== room.rect.d
          const home: HomeDef = { ...s.home, rooms }
          set({
            ...structurePatch(home, s.selectedOpeningId),
            ...(dimsChanged ? { furniture: s.furniture.map((f) => f.roomId === roomId ? reclampInstance(f, home) : f) } : {}),
          })
        },

        setRoomPartition: (height) => {
          if (blockRectangleEdit()) return
          const s = get()
          const room = roomById(s.home, s.activeRoomId)
          if (!room) return
          const h = Math.max(0, round5cm(height))
          if (room.partitionHeight === h) return
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
            furniture: rooms.flatMap((room) => {
              const preserved = s.furniture.filter((f) => f.roomId === room.id && isPreserved(f))
              return [...preserved, ...layoutForRoom({ seed: clean, extras: s.extras, home: { ...s.home, rooms } }, room, preserved)]
            }),
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
            planImageKey: null,
            planImageUrl: null,
            furniture: layoutForRoom({ seed, extras: s.extras, home }, room),
            selectedId: null,
            selectedOpeningId: null,
          })
        },

        newHome: (templateId) => {
          const s = get()
          const seed = randomSeed()
          const home = buildHome(templateId, seed)
          set({
            seed,
            home,
            activeRoomId: home.rooms[0].id,
            furniture: regenAll({ seed, extras: s.extras, home }, home.rooms),
            selectedId: null,
            selectedOpeningId: null,
            planImageKey: null,
            planImageUrl: null,
          })
        },

        /** Adopt an imported home (floor-plan recognition): keep the current seed, lay out every room. */
        importHome: (home, imageUrl) => {
          home = home.architecture ? canonicalArchitecturalHome(home) : reconcileOpenings(home).home
          const s = get()
          const imported = home.architecture ? importArchitecturalFurniture(home, s.seed, s.extras) : null
          if (imported && home.architecture) home = {...home,architecture:{...home.architecture,warnings:[...new Set(imported.warnings)]}}
          set({
            home,
            activeRoomId: home.rooms.find(room => !home.architecture || ['room', 'balcony'].includes(home.architecture.spaces.find(space => space.id === room.id)!.kind))?.id ?? home.rooms[0].id,
            furniture: imported?.furniture ?? regenAll({ seed: s.seed, extras: s.extras, home }, home.rooms),
            structureNotice: imported?.warnings.length ? `${imported.warnings.length} 项识别/家具提示已保存在专业面板 Review ${imported.warnings.length} notes in the structure panel` : null,
            planImageKey: imageUrl ? PLAN_IMAGE_KEY : null,
            planImageUrl: imageUrl ?? null,
            selectedId: null,
            selectedOpeningId: null,
          })
        },

        setPlanImage: (dataUrl) => {
          set({ planImageKey: PLAN_IMAGE_KEY, planImageUrl: dataUrl })
        },

        clearPlanImage: () => {
          set({ planImageKey: null, planImageUrl: null })
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
          if (blockRectangleEdit()) return
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
          // Move directly beyond every colliding room. Each step passes at least
          // one south edge, so this terminates in at most rooms.length steps.
          let blockers = s.home.rooms.filter((r) => roomsOverlap(room, r))
          while (blockers.length) {
            room.rect.z = Math.max(...blockers.map((r) => r.rect.z + r.rect.d / 2)) + room.rect.d / 2
            blockers = s.home.rooms.filter((r) => roomsOverlap(room, r))
          }
          const home: HomeDef = { rooms: [...s.home.rooms, room], openings: s.home.openings }
          // shell openings that violate placement rules (e.g. a window landing on
          // a now-shared interior wall) are dropped, same contract as addOpening
          const shell = materializeShell(room, spec).flatMap((o) => { const next = fitOpening(home, o); return next ? [next] : [] })
          const nextHome: HomeDef = { ...home, openings: [...home.openings, ...shell] }
          set({
            ...structurePatch(nextHome, s.selectedOpeningId),
            activeRoomId: room.id,
            furniture: [
              ...s.furniture,
              ...layoutForRoom({ seed: s.seed, extras: s.extras, home: nextHome }, room),
            ],
          })
        },

        removeRoom: (roomId) => {
          if (blockRectangleEdit()) return
          const s = get()
          if (s.home.rooms.length <= 1) return // keep at least one room
          if (!roomById(s.home, roomId)) return
          const rooms = s.home.rooms.filter((r) => r.id !== roomId)
          const openings = s.home.openings.filter((o) => o.a !== roomId && o.b !== roomId)
          set({
            ...structurePatch({ rooms, openings: s.home.openings }, s.selectedOpeningId),
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
          if (blockRectangleEdit()) return
          const s = get()
          if (!roomById(s.home, o.a)) return
          const next = fitOpening(s.home, { ...o, id: uid() })
          if (!next) { set({ structureNotice: '该墙段无法放置门窗 No suitable wall segment for this opening' }); return }
          set({ home: { ...s.home, openings: [...s.home.openings, next] } })
        },
        removeOpening: (id) => {
          if (blockRectangleEdit()) return
          const s = get()
          if (!s.home.openings.some((o) => o.id === id)) return
          set({
            home: { ...s.home, openings: s.home.openings.filter((o) => o.id !== id) },
            selectedOpeningId: s.selectedOpeningId === id ? null : s.selectedOpeningId,
          })
        },

        updateOpening: (id, partial) => {
          if (blockRectangleEdit()) return
          const s = get()
          const cur = s.home.openings.find((o) => o.id === id)
          if (!cur) return
          const next = fitOpening(s.home, { ...cur, ...partial, id: cur.id })
          if (!next) { set({ structureNotice: '该墙段无法放置门窗 No suitable wall segment for this opening' }); return }
          if (Object.entries(next).every(([key, value]) => cur[key as keyof Opening] === value)) return
          set({
            home: { ...s.home, openings: s.home.openings.map((o) => (o.id === id ? next : o)) },
          })
        },

        setStructure: (partial) => {
          if (partial.wallHeight !== undefined && get().home.architecture) {
            blockRectangleEdit()
            const { wallHeight: _height, ...display } = partial
            set(display)
            return
          }
          set(partial)
        },

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
          let architecturalHome: HomeDef | undefined
          if (p.home?.architecture !== undefined) {
            try { architecturalHome = canonicalArchitecturalHome(p.home) }
            catch (error) { return `建筑数据无效 Invalid architecture: ${error instanceof Error ? error.message : String(error)}` }
          }
          const rawRooms = architecturalHome?.rooms ?? p.home?.rooms
          if (!Array.isArray(rawRooms) || rawRooms.length === 0)
            return '项目文件没有房间 No rooms in project file'
          // Keep stable IDs when possible; duplicate IDs must not couple unrelated edits.
          const ids = new Set<string>()
          const claimId = (value: unknown): string => {
            const id = typeof value === 'string' && value && !ids.has(value) ? value : uid()
            ids.add(id)
            return id
          }
          // rooms: validate rects, clamp dims, dedupe/keep ids, drop overlaps
          const idMap = new Map<string, string>() // file id → live id
          const rooms: RoomDef[] = []
          for (const r of rawRooms) {
            if (architecturalHome) {
              rooms.push(r)
              ids.add(r.id)
              idMap.set(r.id, r.id)
              continue
            }
            const rect = r?.rect
            if (!rect || ![rect.x, rect.z, rect.w, rect.d].every((v) => Number.isFinite(v))) continue
            const fileId = typeof r.id === 'string' && r.id ? r.id : ''
            const id = claimId(fileId)
            const room: RoomDef = {
              id,
              type: getRoomType(r.type).id,
              name:
                typeof r.name === 'string' && r.name
                  ? r.name
                  : getRoomType(r.type).label,
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
            if (fileId && !idMap.has(fileId)) idMap.set(fileId, id)
          }
          if (rooms.length === 0) return '房间尺寸数据无效 Invalid room rect'
          const home: HomeDef = architecturalHome ?? { rooms, openings: [] }
          // openings: a/b resolved through the id map ('exterior' stays)
          for (const o of !architecturalHome && Array.isArray(p.home?.openings) ? p.home.openings : []) {
            if (!o || !['door', 'window', 'open'].includes(o.kind)) continue
            if (!['n', 's', 'e', 'w'].includes(o.side)) continue
            if (!Number.isFinite(o.offset) || !Number.isFinite(o.width)) continue
            const a = idMap.get(o.a)
            const b = o.b === 'exterior' ? 'exterior' : idMap.get(o.b)
            if (!a || !b) continue
            const next = fitOpening(home, {
              id: claimId(o.id),
              kind: o.kind,
              a,
              b,
              side: o.side,
              offset: o.offset,
              width: o.width,
              ...(o.fullHeight === true ? { fullHeight: true } : {}),
            })
            if (next) home.openings.push(next)
          }
          const fallbackRoom = rooms[0]
          const furniture: FurnitureInstance[] = []
          for (const f of Array.isArray(p.furniture) ? p.furniture : []) {
            const def = f && getModel(f.modelId)
            if (!def) continue
            if (architecturalHome && !idMap.has(f.roomId)) return '家具所属空间不存在 Furniture space is missing'
            if (architecturalHome && (!Number.isFinite(f.scale) || f.scale <= 0)) return '家具缩放无效 Invalid furniture scale'
            const room = roomById(home, idMap.get(f.roomId) ?? '') ?? fallbackRoom
            const params = defaultParams(def)
            for (const spec of def.params ?? []) {
              const value = f.params?.[spec.key]
              if (spec.kind === 'boolean' && typeof value === 'boolean') params[spec.key] = value
              if (spec.kind === 'number' && Number.isFinite(value)) {
                params[spec.key] = clamp(value, spec.min ?? -Infinity, spec.max ?? Infinity)
              }
            }
            const inst: FurnitureInstance = {
              id: claimId(f.id),
              roomId: room.id,
              modelId: def.id,
              label: def.name,
              position: [
                Number.isFinite(f.position?.[0]) ? f.position[0] : 0,
                Number.isFinite(f.position?.[1]) ? f.position[1] : 0,
              ],
              rotationY: Number.isFinite(f.rotationY) ? f.rotationY : 0,
              params,
              scale: architecturalHome ? f.scale : clamp(Number.isFinite(f.scale) ? f.scale : 1, 0.1, 2),
              ...(f.source === 'generated' || f.source === 'manual' ? { source: f.source } : {}),
              ...(typeof f.decor === 'boolean' ? { decor: f.decor } : {}),
              ...(typeof f.locked === 'boolean' ? { locked: f.locked } : {}),
            }
            if (architecturalHome && !architecturalFurnitureFits(home, inst)) return '家具不在可用空间内 Furniture lies outside usable floor'
            inst.position = architecturalHome ? inst.position : clampedPosition(
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
            structureNotice: home.architecture?.warnings.length ? `${home.architecture.warnings.length} 项提示见专业结构面板 Review notes in the structure panel` : null,
            planImageKey: null,
            planImageUrl: null,
          })
          return null
        },

        setExtras: (n) => {
          const extras = Math.max(0, Math.min(100, Math.round(n)))
          const s = get()
          if (extras === s.extras) return
          const furniture = s.home.rooms.flatMap((room) => {
            const preserved = s.furniture.filter((f) => f.roomId === room.id && (isPreserved(f) || !f.decor))
            return [...preserved, ...layoutForRoom({ seed: s.seed, extras, home: s.home }, room, preserved, true)]
          })
          set({ extras, furniture })
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
            source: 'manual',
          }
          inst.position = s.home.architecture ? [at?.[0] ?? 0, at?.[1] ?? 0] : clampedPosition(inst, at?.[0] ?? 0, at?.[1] ?? 0, room.rect.w, room.rect.d)
          if (s.home.architecture && !at) {
            const position = findArchitecturalPosition(s.home, inst)
            if (position) inst.position = position
          }
          set({ furniture: [...s.furniture, inst], selectedId: inst.id })
        },

        removeFurniture: (id) => {
          const s = get()
          if (!s.furniture.some((f) => f.id === id)) return
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
            source: 'manual',
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
          if (!s.furniture.some((f) => f.id === id)) return
          set({
            furniture: s.furniture.map((f) =>
              f.id === id
                ? reclampInstance(
                    { ...f, source: 'manual', modelId: def.id, label: def.name, params: defaultParams(def) },
                    s.home,
                  )
                : f,
            ),
            lastSwapId: newModelId,
          })
        },

        moveFurniture: (id, x, z) => {
          const s = get()
          const item = s.furniture.find((f) => f.id === id)
          const room = item && roomById(s.home, item.roomId)
          if (!item || !room) return
          const position: [number, number] = s.home.architecture ? [x, z] : clampedPosition(item, x, z, room.rect.w, room.rect.d)
          if (position[0] === item.position[0] && position[1] === item.position[1]) return
          set({ furniture: s.furniture.map((f) => f.id === id ? { ...f, source: 'manual', position } : f) })
        },

        rotateFurniture: (id, rotationY) => {
          const s = get()
          const item = s.furniture.find((f) => f.id === id)
          if (!item || item.rotationY === rotationY) return
          set({
            furniture: s.furniture.map((f) => {
              if (f.id !== id) return f
              const room = roomById(s.home, f.roomId)
              if (!room) return f
              const next: FurnitureInstance = { ...f, source: 'manual', rotationY }
              next.position = s.home.architecture ? f.position : clampedPosition(
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

        setFurnitureLocked: (id, locked) => {
          const s = get()
          const item = s.furniture.find((f) => f.id === id)
          if (!item || isPreserved(item) === locked) return
          set({ furniture: s.furniture.map((f) => f.id === id ? { ...f, locked, ...(locked ? {} : { source: 'generated' as const }) } : f) })
        },

        setScale: (id, scale) => {
          if (!Number.isFinite(scale)) return
          const s = get()
          const nextScale = clamp(scale, 0.1, 2)
          const item = s.furniture.find((f) => f.id === id)
          if (!item || item.scale === nextScale) return
          set({
            furniture: s.furniture.map((f) =>
              f.id === id ? reclampInstance({ ...f, source: 'manual', scale: nextScale }, s.home) : f,
            ),
          })
        },

        setParam: (id, key, value) => {
          const s = get()
          const item = s.furniture.find((f) => f.id === id)
          if (!item || item.params[key] === value) return
          set({
            furniture: s.furniture.map((f) =>
              f.id === id
                ? reclampInstance({ ...f, source: 'manual', params: { ...f.params, [key]: value } }, s.home)
                : f,
            ),
          })
        },

        resetShape: (id) => {
          const s = get()
          const item = s.furniture.find((f) => f.id === id)
          const def = item && getModel(item.modelId)
          if (!item || !def) return
          const params = defaultParams(def)
          if (item.scale === 1 && Object.keys(item.params).length === Object.keys(params).length &&
            Object.entries(params).every(([key, value]) => item.params[key] === value)) return
          set({
            furniture: s.furniture.map((f) => f.id === id
              ? reclampInstance({ ...f, source: 'manual', params, scale: 1 }, s.home) : f),
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
          // Blob deletion is outside scene history: do not restore dangling models.
          const s = get()
          if (!s.uploads.some((u) => u.id === id)) return
          history.clear()
          unregisterUpload(id)
          const removedIds = new Set(
            s.furniture.filter((f) => f.modelId === id).map((f) => f.id),
          )
          rawSet({
            ...history.flags(),
            uploads: s.uploads.filter((u) => u.id !== id),
            furniture: s.furniture.filter((f) => f.modelId !== id),
            selectedId: s.selectedId && removedIds.has(s.selectedId) ? null : s.selectedId,
          })
        },
      }
    },
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
        if (state?.planImageKey) void state.restorePlanImage().catch(() => {})
        if (state) state.home = state.home.architecture ? canonicalArchitecturalHome(state.home) : reconcileOpenings(state.home).home
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

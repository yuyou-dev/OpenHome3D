/**
 * Multi-room home model: rectangular rooms placed in a shared "home"
 * coordinate system, plus wall openings (doors/windows). Walls themselves
 * are never stored — they are derived from room adjacency (see gen/walls.ts).
 *
 * Conventions:
 * - Sides: n = -z (north), s = +z (south), e = +x (east), w = -x (west).
 * - `Opening.offset` is meters from the wall START to the opening center.
 *   For n/s walls the start is the west (-x) end; for e/w walls it is the
 *   north (-z) end.
 * - `RoomDef.rect.x/z` is the room CENTER in home coordinates (meters);
 *   furniture positions stay room-local with the room center at [0,0].
 */
import { wallFootprint } from '../gen/architectureGeometry'
import type { ArchitecturalPlan } from './architecture'
import { aabbOf, overlaps } from '../lib/geom'
import type { RoomTypeSpec } from '../gen/roomTypes'

export type Side = 'n' | 's' | 'e' | 'w'

export interface RoomDef {
  id: string // 'r1' (migrated/initial single room) | uid() (added rooms)
  type: string // ROOM_TYPES id
  name: string // display name, defaults to the room type label
  rect: { x: number; z: number; w: number; d: number } // center + size, home coords (m)
  salt: number // per-room reshuffle counter (feeds the layout rng)
  partitionHeight: number // 0 = none; moved here from global StructureSettings
}

export interface Opening {
  id: string
  kind: 'door' | 'window' | 'open' // open = doorway without a leaf
  a: string // roomId whose wall carries the opening
  b: string // roomId on the other side | 'exterior'
  side: Side // side of room a
  offset: number // from wall start to opening center (m) — see header conventions
  width: number // opening width along the wall (m)
  /**
   * Only meaningful for kind 'open' on an interior wall (b = roomId): the
   * opening span generates NO wall at all (rooms opened up / 打通), instead
   * of a DOOR_H-high doorway notch. The covered interval is subtracted from
   * the interior wall during derivation (see walls.ts).
   */
  fullHeight?: boolean
}

export interface HomeDef {
  architecture?: ArchitecturalPlan
  rooms: RoomDef[]
  openings: Opening[]
}

const EPS = 1e-6

/** Look up a room by id. */
export function roomById(home: HomeDef, id: string): RoomDef | undefined {
  return home.rooms.find((r) => r.id === id)
}

/** Union bounding box of all rooms, in home coordinates. */
export function homeAABB(home: HomeDef): {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  cx: number
  cz: number
  w: number
  d: number
} {
  if (home.rooms.length === 0) {
    return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, cx: 0, cz: 0, w: 0, d: 0 }
  }
  let rects = home.rooms.map((r) => r.rect)
  if (home.architecture) {
    const plan=home.architecture
    const points=[...plan.spaces.flatMap(s=>s.polygon),...plan.walls.flatMap(w=>wallFootprint(w,plan.walls.filter(v=>v.levelId===w.levelId)))]
    rects=points.map(([x,z])=>({x,z,w:0,d:0}))
  }
  const u = aabbOf(rects)
  return {
    minX: u.x - u.w / 2,
    minZ: u.z - u.d / 2,
    maxX: u.x + u.w / 2,
    maxZ: u.z + u.d / 2,
    cx: u.x,
    cz: u.z,
    w: u.w,
    d: u.d,
  }
}

/**
 * True if two rooms overlap. Sharing an edge does NOT count as overlap; the
 * boxes are shrunk by 1e-6 m first so a shared edge never counts even when
 * the two rooms' boundary coordinates were computed through different float
 * paths (real overlaps are ≥ 5 cm, far above this tolerance).
 */
export function roomsOverlap(a: RoomDef, b: RoomDef): boolean {
  return overlaps(a.rect, b.rect, -1e-6)
}

export interface WallSpan {
  /** wall start (= offset 0) in home coords — west end for n/s, north end for e/w */
  from: [number, number]
  /** wall end (= offset length) in home coords */
  to: [number, number]
  /** wall length in meters */
  length: number
}

/** A room side as a segment in home coordinates (see header for start/end conventions). */
export function sideSpan(room: RoomDef, side: Side): WallSpan {
  const { x, z, w, d } = room.rect
  const minX = x - w / 2
  const maxX = x + w / 2
  const minZ = z - d / 2
  const maxZ = z + d / 2
  switch (side) {
    case 'n':
      return { from: [minX, minZ], to: [maxX, minZ], length: w }
    case 's':
      return { from: [minX, maxZ], to: [maxX, maxZ], length: w }
    case 'w':
      return { from: [minX, minZ], to: [minX, maxZ], length: d }
    case 'e':
      return { from: [maxX, minZ], to: [maxX, maxZ], length: d }
  }
}

function overlap1D(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return hi - lo > EPS ? [lo, hi] : null
}

/**
 * Shared boundary span between two adjacent rooms, or null when they do not
 * touch. When they do, reports which side of `a` faces `b` plus the shared
 * interval [from, to] measured from that side's wall start (same convention
 * as Opening.offset). Rooms may touch on at most one side (rectangles).
 */
export function sharedSpan(
  a: RoomDef,
  b: RoomDef,
): { side: Side; from: number; to: number } | null {
  const aMinX = a.rect.x - a.rect.w / 2
  const aMaxX = a.rect.x + a.rect.w / 2
  const aMinZ = a.rect.z - a.rect.d / 2
  const aMaxZ = a.rect.z + a.rect.d / 2
  const bMinX = b.rect.x - b.rect.w / 2
  const bMaxX = b.rect.x + b.rect.w / 2
  const bMinZ = b.rect.z - b.rect.d / 2
  const bMaxZ = b.rect.z + b.rect.d / 2

  // vertical shared edges (a east of b, or a west of b)
  if (Math.abs(aMinX - bMaxX) < EPS || Math.abs(aMaxX - bMinX) < EPS) {
    const span = overlap1D(aMinZ, aMaxZ, bMinZ, bMaxZ)
    if (span) {
      const side: Side = Math.abs(aMinX - bMaxX) < EPS ? 'w' : 'e'
      return { side, from: span[0] - aMinZ, to: span[1] - aMinZ }
    }
  }
  // horizontal shared edges (a north of b, or a south of b)
  if (Math.abs(aMinZ - bMaxZ) < EPS || Math.abs(aMaxZ - bMinZ) < EPS) {
    const span = overlap1D(aMinX, aMaxX, bMinX, bMaxX)
    if (span) {
      const side: Side = Math.abs(aMinZ - bMaxZ) < EPS ? 'n' : 's'
      return { side, from: span[0] - aMinX, to: span[1] - aMinX }
    }
  }
  return null
}

/** All openings on one side of a room. */
export function openingsOn(room: RoomDef, side: Side, openings: Opening[]): Opening[] {
  return openings.filter((o) => o.a === room.id && o.side === side)
}

/** Legal intervals on the actual wall: a shared span, or exposed exterior segments. */
export function openingIntervals(home: HomeDef, o: Pick<Opening, 'a' | 'b' | 'side' | 'kind'>): [number, number][] {
  const room = roomById(home, o.a)
  if (!room) return []
  if (o.b !== 'exterior') {
    const neighbor = roomById(home, o.b)
    const shared = neighbor && sharedSpan(room, neighbor)
    return o.kind !== 'window' && shared?.side === o.side ? [[shared.from, shared.to]] : []
  }
  let spans: [number, number][] = [[0, sideSpan(room, o.side).length]]
  for (const other of home.rooms) {
    if (other.id === room.id) continue
    const shared = sharedSpan(room, other)
    if (!shared || shared.side !== o.side) continue
    spans = spans.flatMap(([lo, hi]) => {
      if (shared.to <= lo || shared.from >= hi) return [[lo, hi]]
      const remaining: [number, number][] = []
      if (shared.from > lo) remaining.push([lo, shared.from])
      if (shared.to < hi) remaining.push([shared.to, hi])
      return remaining
    })
  }
  return spans
}

/** Openings must fit one contiguous wall segment connecting their declared rooms. */
export function validateOpening(home: HomeDef, o: Opening): boolean {
  if (!Number.isFinite(o.width) || !Number.isFinite(o.offset) || o.width <= 0) return false
  return openingIntervals(home, o).some(([lo, hi]) =>
    o.offset - o.width / 2 >= lo - EPS && o.offset + o.width / 2 <= hi + EPS)
}

/** Move/resize into the nearest legal segment, or remove when the connection is gone. */
export function fitOpening(home: HomeDef, o: Opening): Opening | null {
  if (!Number.isFinite(o.width) || !Number.isFinite(o.offset)) return null
  const candidates = openingIntervals(home, o).filter(([lo, hi]) => hi - lo >= 0.3 - EPS)
    .map(([lo, hi]) => {
      const width = Math.min(Math.max(0.3, o.width), hi - lo)
      const offset = Math.max(lo + width / 2, Math.min(hi - width / 2, o.offset))
      return { ...o, width, offset }
    })
  candidates.sort((a, b) => Math.abs(a.offset - o.offset) - Math.abs(b.offset - o.offset))
  const next = candidates[0]
  if (!next) return null
  return next.width === o.width && next.offset === o.offset ? o : next
}

/** Reconcile both owners and neighbors after any change to room topology. */
export function reconcileOpenings(home: HomeDef): { home: HomeDef; removed: number; adjusted: number } {
  let removed = 0, adjusted = 0
  const openings = home.openings.flatMap((o) => {
    const next = fitOpening(home, o)
    if (!next) { removed++; return [] }
    if (next !== o) adjusted++
    return [next]
  })
  return { home: removed || adjusted ? { ...home, openings } : home, removed, adjusted }
}

/** A doorway interval on one wall of a room, wall-local meters (header conventions). */
export interface DoorZone {
  side: Side
  from: number
  to: number
}

const OPPOSITE_SIDE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' }

/** Clamp a raw interval into the room's wall span; append when non-degenerate. */
function pushZone(zones: DoorZone[], room: RoomDef, side: Side, from: number, to: number): void {
  const len = sideSpan(room, side).length
  const lo = Math.min(len, Math.max(0, from))
  const hi = Math.min(len, Math.max(0, to))
  if (hi - lo > EPS) zones.push({ side, from: lo, to: hi })
}

/**
 * Door zones a room's layout must keep clear (kind 'door'/'open' only;
 * windows don't block furniture), in the room's own wall-local coordinates.
 *
 * Own declarations (opening.a === room.id) map directly. A doorway declared
 * by the neighbor (opening.b === room.id) is mirrored onto the opposite
 * side: both walls measure u from the same world direction (west end for
 * n/s walls, north end for e/w walls), so only the origin shifts —
 * u_b = u_a + (originA − originB) along the wall axis.
 */
export function doorZonesFor(room: RoomDef, home: HomeDef): DoorZone[] {
  const zones: DoorZone[] = []
  for (const o of home.openings) {
    if (o.kind === 'window') continue
    if (o.a === room.id) {
      pushZone(zones, room, o.side, o.offset - o.width / 2, o.offset + o.width / 2)
    } else if (o.b === room.id) {
      const a = roomById(home, o.a)
      if (!a) continue
      const sh = sharedSpan(a, room)
      if (!sh || sh.side !== o.side) continue // rooms no longer share that wall
      const bSide = OPPOSITE_SIDE[o.side]
      const aSpan = sideSpan(a, o.side)
      const bSpan = sideSpan(room, bSide)
      const axis = o.side === 'n' || o.side === 's' ? 0 : 1 // n/s walls run along x, e/w along z
      const shift = aSpan.from[axis] - bSpan.from[axis]
      pushZone(zones, room, bSide, o.offset - o.width / 2 + shift, o.offset + o.width / 2 + shift)
    }
  }
  return zones
}

/**
 * Materialize the implicit shell openings of the legacy single-room renderer
 * (pre-v2 src/three/Room.tsx, since removed) as data: one door centered on the north wall toward
 * the east end, plus windows evenly spread along the west wall. Shared by
 * the initial state and newRoom so a fresh room renders
 * exactly like the old hard-coded shell.
 */
export function materializeShell(room: RoomDef, spec: RoomTypeSpec): Opening[] {
  const { w, d } = room.rect
  const out: Opening[] = []

  // door on the north wall: Room.tsx doorX = w/2 - doorW/2 - 0.3 (room-local,
  // center origin) → offset = doorX + w/2 measured from the west end.
  const doorW = (spec.doors.width[0] + spec.doors.width[1]) / 2
  const doorX = w / 2 - doorW / 2 - 0.3
  out.push({
    id: `${room.id}:door:n:0`,
    kind: 'door',
    a: room.id,
    b: 'exterior',
    side: 'n',
    offset: doorX + w / 2,
    width: doorW,
  })

  // windows on the west wall: count = clamp(round(d/1.8), spec.windows.count),
  // even segments; width = min(spec midpoint, seg - 0.3); centers u_i =
  // -d/2 + seg*(i+0.5) → offset = u_i + d/2 from the north end.
  const [cMin, cMax] = spec.windows.count
  const count = Math.min(cMax, Math.max(cMin, Math.round(d / 1.8)))
  if (count > 0) {
    const seg = d / count
    const winW = Math.min((spec.windows.width[0] + spec.windows.width[1]) / 2, seg - 0.3)
    // mirrors Room.tsx's "window too small → no window" guard
    // (the wallHeight guard there can never fire: type wall heights are ≥ 2.7 m)
    if (winW >= 0.25) {
      for (let i = 0; i < count; i++) {
        const u = -d / 2 + seg * (i + 0.5)
        out.push({
          id: `${room.id}:win:w:${i}`,
          kind: 'window',
          a: room.id,
          b: 'exterior',
          side: 'w',
          offset: u + d / 2,
          width: winW,
        })
      }
    }
  }
  return out
}

/** Framing uses actual architectural wall heights; legacy scenes retain their global setting. */
export function homeHeight(home: HomeDef, fallback: number): number {
  return home.architecture ? Math.max(...home.architecture.levels.map(l=>l.height), ...home.architecture.walls.map(w=>w.height)) : fallback
}

/** View/capture bounds follow the selected floor; persistence always keeps the complete building. */
export function homeForRoomLevel(home: HomeDef, roomId: string): HomeDef {
  const plan = home.architecture
  if (!plan) return home
  const levelId = plan.spaces.find(s => s.id === roomId)?.levelId ?? plan.levels[0].id
  const spaces = plan.spaces.filter(s => s.levelId === levelId)
  const walls = plan.walls.filter(w => w.levelId === levelId)
  return { ...home, rooms: home.rooms.filter(r => spaces.some(s => s.id === r.id)), architecture: {
    ...plan, spaces, walls, levels: plan.levels.filter(l => l.id === levelId),
    openings: plan.openings.filter(o => walls.some(w => w.id === o.wallId)),
    furniture: plan.furniture.filter(f => spaces.some(s => s.id === f.spaceId)),
  } }
}

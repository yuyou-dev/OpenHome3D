/**
 * Floor-plan import: convert the AI-recognized PlanJson returned by
 * POST /api/ai/understand into a HomeDef, plus an ImportReport of what was
 * kept vs. dropped.
 *
 * PlanJson rooms are top-left-corner rects in plan coordinates (meters,
 * y down = south, plan top = north); HomeDef rooms are center rects, and
 * the whole plan is translated so its AABB centers on the origin.
 *
 * Recognized rectangles rarely tile perfectly, so geometry is repaired
 * before openings are placed:
 *   a. snap every rect to 5 cm; clamp w/d to [1.5, 12]
 *   b. overlap repair: split each overlapping pair along the axis of
 *      smaller overlap at the (snapped) overlap midline — each side
 *      retreats to what becomes the shared edge
 *   c. edge snapping: opposing parallel edges ≤ 0.15 m apart whose
 *      cross-axis intervals intersect are aligned to their (snapped) mean,
 *      so shared edges become truly collinear and openings can land on them
 * Steps b/c repeat until a pass moves nothing (bounded at MAX_PASSES).
 * Fully deterministic: fixed iteration order, no rng, input never mutated.
 *
 * Doors/windows carry optional recognized hints — `at` (0..1 center fraction
 * along the wall/shared span, from its west/north end), `widthM`, entrance
 * `wall`, and door `open` (no leaf = opened-up wall → kind 'open' with
 * fullHeight). Invalid or missing hints fall back to centered DOOR_W/WIN_W.
 */
import { overlaps, quantize } from '../lib/geom'
import {
  sharedSpan,
  sideSpan,
  validateOpening,
  type HomeDef,
  type Opening,
  type RoomDef,
  type Side,
} from '../state/home'

/** Strict-JSON shape produced by POST /api/ai/understand (codex --output-schema). */
export interface PlanJson {
  overall: { widthM: number; depthM: number }
  rooms: { name: string; type: string; x: number; y: number; w: number; d: number }[]
  doors: {
    between: [string, string]
    /** entrance doors only: which exterior wall of the room */
    wall?: Side
    /** opening center as a 0..1 fraction along the (shared) wall, from its west/north end */
    at?: number
    widthM?: number
    /** true = no door leaf: cased opening / open plan / missing wall (打通) */
    open?: boolean
  }[]
  windows: { room: string; wall: Side; at?: number; widthM?: number }[]
}

/** What planJsonToHome kept vs. dropped (invalid rooms, unplaceable openings). */
export interface ImportReport {
  roomsApplied: number
  roomsDropped: number
  doorsApplied: number
  doorsDropped: number
  windowsApplied: number
  windowsDropped: number
}

const SNAP = 0.05 // geometry grid (m)
const MIN_SIZE = 1.5 // clamp floor for w/d (m)
const MAX_SIZE = 12 // clamp ceiling for w/d (m)
const MIN_VALID = 0.3 // rooms at/below this w or d are dropped, not clamped
const EDGE_SNAP = 0.15 // max opposing-edge gap closed by edge snapping (m)
const DOOR_W = 0.9
const WIN_W = 1.2
const EPS = 1e-6
const MAX_PASSES = 32
const SIDES: Side[] = ['n', 's', 'e', 'w']

/** Recognized types pass through; garage/office/other/unknown all become office. */
const TYPE_MAP: Record<string, string> = {
  living: 'living',
  dining: 'dining',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  bathroom: 'bathroom',
  balcony: 'balcony',
}

/** Center-form rect (home coordinates) used during repair. */
interface Rect {
  x: number
  z: number
  w: number
  d: number
}

const minX = (r: Rect) => r.x - r.w / 2
const maxX = (r: Rect) => r.x + r.w / 2
const minZ = (r: Rect) => r.z - r.d / 2
const maxZ = (r: Rect) => r.z + r.d / 2

/** Coerce to a number (accepts non-empty numeric strings), else NaN. */
function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

/** Recognized 0..1 wall fraction, or null when missing/out of range. */
function frac(v: unknown): number | null {
  const n = num(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

/**
 * Recognized opening width (m), clamped into [minW, maxLen]; falls back when
 * the field is missing or implausible.
 */
function widthOr(v: unknown, minW: number, maxLen: number, fallback: number): number {
  const n = num(v)
  if (Number.isFinite(n) && n >= minW - EPS && n <= maxLen + EPS) return Math.min(n, maxLen)
  return fallback
}

/** Clamp an opening center so its width stays inside the wall interval [lo, hi]. */
function clampCenter(center: number, w: number, lo: number, hi: number): number {
  return Math.min(hi - w / 2, Math.max(lo + w / 2, center))
}

/** Split one overlapping pair along the axis of smaller overlap at the snapped midline. */
function splitOverlap(a: Rect, b: Rect): void {
  const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x)
  const oz = (a.d + b.d) / 2 - Math.abs(a.z - b.z)
  if (ox < oz) {
    const m = quantize((Math.max(minX(a), minX(b)) + Math.min(maxX(a), maxX(b))) / 2, SNAP)
    const [west, east] = a.x <= b.x ? [a, b] : [b, a]
    west.x = m - west.w / 2
    east.x = m + east.w / 2
  } else {
    const m = quantize((Math.max(minZ(a), minZ(b)) + Math.min(maxZ(a), maxZ(b))) / 2, SNAP)
    const [north, south] = a.z <= b.z ? [a, b] : [b, a]
    north.z = m - north.d / 2
    south.z = m + south.d / 2
  }
}

/**
 * Snap a pair's opposing edges to their snapped mean when they are
 * ≤ EDGE_SNAP apart (in either direction) and the cross-axis intervals
 * intersect. The move is reverted (and left to the overlap-repair passes)
 * when it would push either room into a third one — otherwise a snap and a
 * split fighting over the same edge can ping-pong forever. Returns true
 * when a room moved.
 */
/** A pending edge-snap move: align low's high edge and high's low edge to m. */
interface SnapMove {
  low: Rect
  high: Rect
  axis: 'x' | 'z'
  m: number
}

function findSnap(a: Rect, b: Rect): SnapMove | null {
  const zInt = Math.min(maxZ(a), maxZ(b)) - Math.max(minZ(a), minZ(b))
  if (zInt > EPS) {
    const [west, east] = a.x <= b.x ? [a, b] : [b, a]
    const gap = minX(east) - maxX(west)
    if (Math.abs(gap) > EPS && Math.abs(gap) <= EDGE_SNAP) {
      return { low: west, high: east, axis: 'x', m: quantize((maxX(west) + minX(east)) / 2, SNAP) }
    }
  }
  const xInt = Math.min(maxX(a), maxX(b)) - Math.max(minX(a), minX(b))
  if (xInt > EPS) {
    const [north, south] = a.z <= b.z ? [a, b] : [b, a]
    const gap = minZ(south) - maxZ(north)
    if (Math.abs(gap) > EPS && Math.abs(gap) <= EDGE_SNAP) {
      return { low: north, high: south, axis: 'z', m: quantize((maxZ(north) + minZ(south)) / 2, SNAP) }
    }
  }
  return null
}

function snapEdges(rects: Rect[], i: number, j: number): boolean {
  const mv = findSnap(rects[i], rects[j])
  if (!mv) return false
  const { low, high, axis, m } = mv
  const oldLow = axis === 'x' ? low.x : low.z
  const oldHigh = axis === 'x' ? high.x : high.z
  if (axis === 'x') {
    low.x = m - low.w / 2
    high.x = m + high.w / 2
  } else {
    low.z = m - low.d / 2
    high.z = m + high.d / 2
  }
  for (let k = 0; k < rects.length; k++) {
    if (k === i || k === j) continue
    if (overlaps(rects[k], rects[i], -EPS) || overlaps(rects[k], rects[j], -EPS)) {
      if (axis === 'x') {
        low.x = oldLow
        high.x = oldHigh
      } else {
        low.z = oldLow
        high.z = oldHigh
      }
      return false
    }
  }
  return true
}

/**
 * Convert recognized plan JSON into a HomeDef. Throws Error('no valid
 * rooms') when nothing usable remains; otherwise invalid rooms and
 * unplaceable openings are dropped and counted in the report.
 */
export function planJsonToHome(json: unknown): { home: HomeDef; report: ImportReport } {
  const report: ImportReport = {
    roomsApplied: 0,
    roomsDropped: 0,
    doorsApplied: 0,
    doorsDropped: 0,
    windowsApplied: 0,
    windowsDropped: 0,
  }
  const pj = (json ?? {}) as { rooms?: unknown; doors?: unknown; windows?: unknown }

  // (a) validate + coerce rooms, snap to grid, clamp sizes
  interface Pending {
    name: string
    type: string
    rect: Rect
  }
  const kept: Pending[] = []
  const rawRooms: unknown[] = Array.isArray(pj.rooms) ? pj.rooms : []
  rawRooms.forEach((raw, i) => {
    const r = raw as {
      name?: unknown
      type?: unknown
      x?: unknown
      y?: unknown
      w?: unknown
      d?: unknown
    } | null
    const x = num(r?.x)
    const y = num(r?.y)
    const w = num(r?.w)
    const d = num(r?.d)
    if (![x, y, w, d].every(Number.isFinite) || w <= MIN_VALID || d <= MIN_VALID) {
      report.roomsDropped++
      return
    }
    const qw = Math.min(MAX_SIZE, Math.max(MIN_SIZE, quantize(w, SNAP)))
    const qd = Math.min(MAX_SIZE, Math.max(MIN_SIZE, quantize(d, SNAP)))
    kept.push({
      name: typeof r?.name === 'string' && r.name !== '' ? r.name : `Room ${i + 1}`,
      type: TYPE_MAP[String(r?.type)] ?? 'office',
      rect: { x: quantize(x, SNAP) + qw / 2, z: quantize(y, SNAP) + qd / 2, w: qw, d: qd },
    })
  })
  if (kept.length === 0) throw new Error('no valid rooms')

  // (b)+(c) geometry repair: overlap splits and edge snaps until stable
  const rects = kept.map((k) => k.rect)
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (overlaps(rects[i], rects[j], -EPS)) {
          splitOverlap(rects[i], rects[j])
          moved = true
        }
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (snapEdges(rects, i, j)) moved = true
      }
    }
    if (!moved) break
  }

  // (d) translate so the union AABB centers on the origin
  let loX = Infinity
  let hiX = -Infinity
  let loZ = Infinity
  let hiZ = -Infinity
  for (const r of rects) {
    loX = Math.min(loX, minX(r))
    hiX = Math.max(hiX, maxX(r))
    loZ = Math.min(loZ, minZ(r))
    hiZ = Math.max(hiZ, maxZ(r))
  }
  const cx = (loX + hiX) / 2
  const cz = (loZ + hiZ) / 2
  for (const r of rects) {
    r.x -= cx
    r.z -= cz
  }

  const rooms: RoomDef[] = kept.map((k, i) => ({
    id: `r${i + 1}`,
    type: k.type,
    name: k.name,
    rect: k.rect,
    salt: 0,
    partitionHeight: 0,
  }))
  const home: HomeDef = { rooms, openings: [] }
  const byName = new Map<string, RoomDef>()
  for (const r of rooms) if (!byName.has(r.name)) byName.set(r.name, r)

  const hasNeighbor = (room: RoomDef, side: Side): boolean =>
    rooms.some((o) => o.id !== room.id && sharedSpan(room, o)?.side === side)

  const pushOpening = (o: Opening, kind: 'doors' | 'windows'): void => {
    if (validateOpening(home, o)) {
      o.id = `o${home.openings.length + 1}`
      home.openings.push(o)
      report[`${kind}Applied`]++
    } else {
      report[`${kind}Dropped`]++
    }
  }

  // (e) doors: 'exterior' → recognized wall hint or longest neighbor-free
  // side; room pair → shared span. Recognized position hints (at / widthM /
  // open) are consumed when valid, otherwise placement falls back to a
  // centered DOOR_W opening. open:true becomes a fullHeight gap (打通).
  const rawDoors: unknown[] = Array.isArray(pj.doors) ? pj.doors : []
  for (const raw of rawDoors) {
    const d = raw as {
      between?: unknown
      wall?: unknown
      at?: unknown
      widthM?: unknown
      open?: unknown
    } | null
    const between = d?.between
    const aName = Array.isArray(between) ? between[0] : undefined
    const bName = Array.isArray(between) ? between[1] : undefined
    const at = frac(d?.at)
    let candidate: Opening | null = null
    if (typeof aName === 'string' && typeof bName === 'string') {
      if ((aName === 'exterior') !== (bName === 'exterior')) {
        const room = byName.get(aName === 'exterior' ? bName : aName)
        if (room) {
          const hint: Side | null =
            typeof d?.wall === 'string' && (SIDES as string[]).includes(d.wall)
              ? (d.wall as Side)
              : null
          const widthFor = (side: Side) =>
            widthOr(d?.widthM, 0.5, sideSpan(room, side).length, DOOR_W)
          const eligible = (side: Side) =>
            !hasNeighbor(room, side) && sideSpan(room, side).length >= widthFor(side) - EPS
          let best: Side | null = hint && eligible(hint) ? hint : null
          if (!best) {
            let bestLen = 0
            for (const side of SIDES) {
              if (!eligible(side)) continue
              const len = sideSpan(room, side).length
              if (len > bestLen + EPS) {
                best = side
                bestLen = len
              }
            }
          }
          if (best) {
            const len = sideSpan(room, best).length
            if (d?.open === true) {
              // open exterior edge (balcony railing): parapet instead of a wall
              const width = widthOr(d?.widthM, 0.5, len, len)
              candidate = {
                id: '',
                kind: 'open',
                fullHeight: true,
                a: room.id,
                b: 'exterior',
                side: best,
                offset: at !== null ? clampCenter(at * len, width, 0, len) : len / 2,
                width,
              }
            } else {
              const width = widthFor(best)
              candidate = {
                id: '',
                kind: 'door',
                a: room.id,
                b: 'exterior',
                side: best,
                offset: at !== null ? clampCenter(at * len, width, 0, len) : len / 2,
                width,
              }
            }
          }
        }
      } else if (aName !== 'exterior' && bName !== 'exterior') {
        const a = byName.get(aName)
        const b = byName.get(bName)
        if (a && b && a.id !== b.id) {
          const sh = sharedSpan(a, b)
          if (sh) {
            const spanLen = sh.to - sh.from
            if (d?.open === true) {
              // opened-up connection: no wall across the gap span at all;
              // without a recognized width the whole shared span opens up
              const width = widthOr(d?.widthM, 0.5, spanLen, spanLen)
              candidate = {
                id: '',
                kind: 'open',
                fullHeight: true,
                a: a.id,
                b: b.id,
                side: sh.side,
                offset:
                  at !== null
                    ? clampCenter(sh.from + at * spanLen, width, sh.from, sh.to)
                    : (sh.from + sh.to) / 2,
                width,
              }
            } else {
              const width = widthOr(d?.widthM, 0.5, spanLen, DOOR_W)
              if (spanLen >= width - EPS) {
                candidate = {
                  id: '',
                  kind: 'door',
                  a: a.id,
                  b: b.id,
                  side: sh.side,
                  offset:
                    at !== null
                      ? clampCenter(sh.from + at * spanLen, width, sh.from, sh.to)
                      : (sh.from + sh.to) / 2,
                  width,
                }
              }
            }
          }
        }
      }
    }
    if (candidate) pushOpening(candidate, 'doors')
    else report.doorsDropped++
  }

  // windows: only on neighbor-free sides; recognized at/widthM when valid,
  // else 1.2 m centered (interior-wall windows stay dropped)
  const rawWindows: unknown[] = Array.isArray(pj.windows) ? pj.windows : []
  for (const raw of rawWindows) {
    const w = raw as { room?: unknown; wall?: unknown; at?: unknown; widthM?: unknown } | null
    const room = typeof w?.room === 'string' ? byName.get(w.room) : undefined
    const side =
      typeof w?.wall === 'string' && (SIDES as string[]).includes(w.wall)
        ? (w.wall as Side)
        : null
    const at = frac(w?.at)
    let candidate: Opening | null = null
    if (room && side && !hasNeighbor(room, side)) {
      const len = sideSpan(room, side).length
      const width = widthOr(w?.widthM, 0.4, len, WIN_W)
      if (len >= width - EPS) {
        candidate = {
          id: '',
          kind: 'window',
          a: room.id,
          b: 'exterior',
          side,
          offset: at !== null ? clampCenter(at * len, width, 0, len) : len / 2,
          width,
        }
      }
    }
    if (candidate) pushOpening(candidate, 'windows')
    else report.windowsDropped++
  }

  report.roomsApplied = rooms.length
  return { home, report }
}

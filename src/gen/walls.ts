/**
 * Wall derivation: turns a HomeDef (rooms + openings) into renderable wall
 * segments. Walls are never stored — they are derived from room adjacency:
 *
 * - A side shared with another room (sharedSpan) becomes interior wall
 *   segments rendered by the room with the lexicographically smaller id,
 *   thickness centered on the shared boundary. Openings with
 *   `fullHeight: true` (kind 'open', 打通) subtract their span from the
 *   shared interval first, so the remaining wall is split into sub-segments
 *   (zero sub-segments = fully opened up).
 * - The unshared remainder of a side becomes exterior wall: inner face flush
 *   with the room edge, bulging outward by WALL_T (the legacy Room.tsx look).
 *   A fullHeight opening to the exterior (b 'exterior', 阳台开口) replaces
 *   the full-height wall across its span with a PARAPET_H railing wall.
 * - n/s exterior segments are extended by WALL_T at ends that coincide with a
 *   corner of homeAABB (matches the legacy corner caps: n/s walls span
 *   w + 2·WALL_T; e/w wall ends are capped by those extensions).
 * - Openings attach to the wall of room `a` on `side`; `u` is measured along
 *   the segment from `from` (n/s walls run west→east, e/w walls north→south,
 *   same convention as Opening.offset, converted from center to interval).
 */
import {
  homeAABB,
  openingsOn,
  sharedSpan,
  sideSpan,
  type HomeDef,
  type Opening,
  type RoomDef,
  type Side,
} from '../state/home'

export const WALL_T = 0.12
/** Railing-height half wall rendered across an exterior fullHeight opening (balcony edge). */
export const PARAPET_H = 1.05

const EPS = 1e-6
const SIDES: Side[] = ['n', 's', 'e', 'w']
const OUTWARD: Record<Side, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
}
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' }

export interface WallDoorway {
  /** center along the segment from `from` (m) */
  u: number
  /** opening width along the wall (m) */
  w: number
  kind: 'door' | 'open'
}

export interface WallWindow {
  u: number
  w: number
}

export interface WallSegment {
  key: string
  kind: 'ext' | 'int'
  /** axis the segment runs along in home coords */
  axis: 'x' | 'z'
  from: [number, number]
  to: [number, number]
  height: number
  doorways: WallDoorway[]
  windows: WallWindow[]
  /** outward normal, exterior walls only (drives cutaway) */
  normal?: [number, number]
  /** room that renders this segment (smaller id for interior walls) */
  roomId: string
}

/** Wall-start coordinate (t) along the side axis: x for n/s walls, z for e/w. */
function axisOf(side: Side): 'x' | 'z' {
  return side === 'n' || side === 's' ? 'x' : 'z'
}

function startCoord(room: RoomDef, side: Side): number {
  const { x, z, w, d } = room.rect
  switch (side) {
    case 'n':
    case 's':
      return x - w / 2
    case 'w':
    case 'e':
      return z - d / 2
  }
}

/** Point on the side line at wall-local distance t from the room's wall start. */
function pointAt(room: RoomDef, side: Side, t: number): [number, number] {
  const { x, z, w, d } = room.rect
  switch (side) {
    case 'n':
      return [x - w / 2 + t, z - d / 2]
    case 's':
      return [x - w / 2 + t, z + d / 2]
    case 'w':
      return [x - w / 2, z - d / 2 + t]
    case 'e':
      return [x + w / 2, z - d / 2 + t]
  }
}

interface SharedBit {
  /** shared interval in this room's wall-local coordinates */
  from: number
  to: number
  other: RoomDef
}

/** Convert an opening declared on `decl` (side `declSide`) to a segment-local doorway. */
function toOpening(o: Opening, decl: RoomDef, declSide: Side, segStart: number) {
  const tCenter = startCoord(decl, declSide) + o.offset
  return { u: tCenter - segStart, w: o.width }
}

export function deriveWalls(home: HomeDef, wallHeight: number): WallSegment[] {
  const aabb = homeAABB(home)
  const segments: WallSegment[] = []

  for (const room of home.rooms) {
    for (const side of SIDES) {
      const axis = axisOf(side)
      const span = sideSpan(room, side)

      // shared intervals on this side (merged left-to-right)
      const shared: SharedBit[] = []
      for (const other of home.rooms) {
        if (other.id === room.id) continue
        const sh = sharedSpan(room, other)
        if (sh && sh.side === side) shared.push({ from: sh.from, to: sh.to, other })
      }
      shared.sort((a, b) => a.from - b.from)

      // interior walls: shared interval minus fullHeight gaps (打通), one
      // segment per remaining sub-span, rendered by the smaller id
      for (const sh of shared) {
        if (room.id > sh.other.id) continue
        const segStart = startCoord(room, side) + sh.from
        const segLen = sh.to - sh.from
        const gaps: [number, number][] = [] // segment-local intervals with no wall
        const allDoorways: WallDoorway[] = [] // segment-local u (from segStart)
        for (const o of home.openings) {
          if (o.kind === 'window') continue // defensively ignored on interior walls
          let conv: { u: number; w: number } | null = null
          if (o.a === room.id && o.side === side && o.b === sh.other.id) {
            conv = toOpening(o, room, side, segStart)
          } else if (o.a === sh.other.id && o.side === OPPOSITE[side] && o.b === room.id) {
            conv = toOpening(o, sh.other, OPPOSITE[side], segStart)
          }
          if (!conv) continue
          if (o.kind === 'open' && o.fullHeight) {
            gaps.push([conv.u - conv.w / 2, conv.u + conv.w / 2])
          } else {
            allDoorways.push({ ...conv, kind: o.kind })
          }
        }
        // subtract gap intervals from the shared span (same cursor sweep as extSpans)
        gaps.sort((a, b) => a[0] - b[0])
        const subSpans: [number, number][] = []
        let intCursor = 0
        for (const [gLo, gHi] of gaps) {
          const lo = Math.min(segLen, Math.max(0, gLo))
          const hi = Math.min(segLen, Math.max(0, gHi))
          if (lo - intCursor > EPS) subSpans.push([intCursor, lo])
          intCursor = Math.max(intCursor, hi)
        }
        if (segLen - intCursor > EPS) subSpans.push([intCursor, segLen])
        subSpans.forEach(([lo, hi], i) => {
          segments.push({
            key: `int:${room.id}:${sh.other.id}:${i}`,
            kind: 'int',
            axis,
            from: pointAt(room, side, sh.from + lo),
            to: pointAt(room, side, sh.from + hi),
            height: wallHeight,
            // doorways whose center survived in this sub-span, re-based to it;
            // one falling inside a gap is defensively dropped
            doorways: allDoorways
              .filter((d) => d.u >= lo - EPS && d.u <= hi + EPS)
              .map((d) => ({ ...d, u: d.u - lo })),
            windows: [],
            roomId: room.id,
          })
        })
      }

      // exterior remainders: side span minus the shared intervals
      const extSpans: [number, number][] = []
      let cursor = 0
      for (const sh of shared) {
        if (sh.from - cursor > EPS) extSpans.push([cursor, sh.from])
        cursor = Math.max(cursor, sh.to)
      }
      if (span.length - cursor > EPS) extSpans.push([cursor, span.length])

      const openings = openingsOn(room, side, home.openings).filter((o) => o.b === 'exterior')
      // fullHeight openings to the exterior (balcony edge, 阳台): the
      // full-height wall across the span is replaced by a parapet
      const extGaps: [number, number][] = openings
        .filter((o) => o.kind === 'open' && o.fullHeight)
        .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as [number, number])
        .sort((a, b) => a[0] - b[0])
      const plain = openings.filter((o) => !(o.kind === 'open' && o.fullHeight))

      let segIdx = 0
      extSpans.forEach(([lo, hi]) => {
        // split the span into full-height wall pieces and parapet gaps
        const pieces: { lo: number; hi: number; parapet: boolean }[] = []
        let cur = lo
        for (const [gLo, gHi] of extGaps) {
          const a = Math.min(hi, Math.max(lo, gLo))
          const b = Math.min(hi, Math.max(lo, gHi))
          if (a - cur > EPS) pieces.push({ lo: cur, hi: a, parapet: false })
          if (b - a > EPS) pieces.push({ lo: a, hi: b, parapet: true })
          cur = Math.max(cur, b)
        }
        if (hi - cur > EPS) pieces.push({ lo: cur, hi, parapet: false })

        for (const p of pieces) {
          // corner caps: extend n/s full-height segments at ends that
          // coincide with an aabb corner (parapets stay unextended)
          let elo = p.lo
          let ehi = p.hi
          if (!p.parapet && axis === 'x') {
            const zLine = pointAt(room, side, p.lo)[1]
            const onAabbZ =
              Math.abs(zLine - aabb.minZ) < EPS || Math.abs(zLine - aabb.maxZ) < EPS
            const tLo = startCoord(room, side) + p.lo
            const tHi = startCoord(room, side) + p.hi
            if (onAabbZ && Math.abs(tLo - aabb.minX) < EPS) elo -= WALL_T
            if (onAabbZ && Math.abs(tHi - aabb.maxX) < EPS) ehi += WALL_T
          }
          const doorways: WallDoorway[] = []
          const windows: WallWindow[] = []
          if (!p.parapet) {
            for (const o of plain) {
              const tCenter = o.offset // room wall-local
              if (tCenter < p.lo - EPS || tCenter > p.hi + EPS) continue
              if (o.kind === 'window') {
                windows.push({ u: tCenter - elo, w: o.width })
              } else {
                doorways.push({ u: tCenter - elo, w: o.width, kind: o.kind })
              }
            }
          }
          segments.push({
            key: `ext:${room.id}:${side}:${segIdx++}`,
            kind: 'ext',
            axis,
            from: pointAt(room, side, elo),
            to: pointAt(room, side, ehi),
            height: p.parapet ? PARAPET_H : wallHeight,
            doorways,
            windows,
            normal: OUTWARD[side],
            roomId: room.id,
          })
        }
      })
    }
  }
  return segments
}

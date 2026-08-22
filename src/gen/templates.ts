/**
 * Home templates: deterministic multi-room HomeDef builders.
 *
 * Every random draw comes from a seeded rng — `rngFrom(`${seed}:home:<id>`)`,
 * except 'studio', which keeps the legacy `${seed}:room:living` stream so it
 * produces exactly what `newRoom()` builds for the single-room case. Same
 * seed + same template → identical HomeDef.
 *
 * Rooms are laid out from a NW origin (+x east, +z south) and then shifted so
 * the home AABB is centered on the origin.
 */
import { aabbOf } from '../lib/geom'
import { range, rngFrom, type Rng } from '../lib/prng'
import { getRoomType, typeDefaults } from './roomTypes'
import {
  materializeShell,
  sharedSpan,
  sideSpan,
  type HomeDef,
  type Opening,
  type RoomDef,
  type Side,
} from '../state/home'

export interface HomeTemplate {
  id: string
  label: string
}

export const HOME_TEMPLATES: HomeTemplate[] = [
  { id: 'studio', label: '单间 Studio' },
  { id: '1br', label: '一室一厅 1BR' },
  { id: '2br', label: '两室一厅 2BR' },
]

const round5cm = (v: number) => Math.round(v * 20) / 20
/** Snap to 0.1 mm so rects/JSON stay free of float noise. */
const q = (v: number) => Math.round(v * 10000) / 10000

/** Opening without an id yet; the builder assigns o1, o2, … in creation order. */
type OpeningDraft = Omit<Opening, 'id'>

/** 5cm-rounded dimension draw within a room type's range. */
function dimDraw(rng: Rng, typeId: string, axis: 'width' | 'depth'): number {
  const t = getRoomType(typeId)
  return round5cm(range(rng, t[axis][0], t[axis][1]))
}

/** Room from absolute edge coordinates (pre-centering); salt 0, partition 0. */
function roomFromEdges(
  id: string,
  type: string,
  name: string,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): RoomDef {
  return {
    id,
    type,
    name,
    rect: {
      x: q((x0 + x1) / 2),
      z: q((z0 + z1) / 2),
      w: q(x1 - x0),
      d: q(z1 - z0),
    },
    salt: 0,
    partitionHeight: 0,
  }
}

/** Shift all rooms so the home AABB center sits on the origin. */
function centerRooms(rooms: RoomDef[]): RoomDef[] {
  const a = aabbOf(rooms.map((r) => r.rect))
  return rooms.map((r) => ({
    ...r,
    rect: { ...r.rect, x: q(r.rect.x - a.x), z: q(r.rect.z - a.z) },
  }))
}

/**
 * Door on the wall two rooms share, centered on the shared span so the
 * mirrored door zone lands correctly in the neighbor's layout. Null when the
 * rooms do not touch or the shared span cannot fit a door.
 */
function doorBetween(a: RoomDef, b: RoomDef, maxW: number): OpeningDraft | null {
  const sh = sharedSpan(a, b)
  if (!sh) return null
  const width = q(Math.min(maxW, sh.to - sh.from - 0.1))
  if (width < 0.6) return null
  return { kind: 'door', a: a.id, b: b.id, side: sh.side, offset: q((sh.from + sh.to) / 2), width }
}

/** Centered window on an (exterior) wall of a room. */
function windowOn(room: RoomDef, side: Side, width: number): OpeningDraft {
  return {
    kind: 'window',
    a: room.id,
    b: 'exterior',
    side,
    offset: q(sideSpan(room, side).length / 2),
    width,
  }
}

/** 'studio' 单间: the legacy single room — same dims/shell as newRoom(). */
function buildStudio(seed: string): HomeDef {
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
  return { rooms: [room], openings: materializeShell(room, getRoomType('living')) }
}

/**
 * '1br' 一室一厅: living north-east of the bedroom; bath + kitchen in a row
 * south of the bedroom (bed/bath cluster), entrance on the kitchen's south
 * wall near its east end. Living depth is capped at the bedroom depth so the
 * living room never collides with the kitchen row.
 */
function build1br(seed: string): HomeDef {
  const rng = rngFrom(`${seed}:home:1br`)
  const bedT = getRoomType('bedroom')
  const livT = getRoomType('living')
  const wb = dimDraw(rng, 'bedroom', 'width')
  // shared bedroom/living depth band: intersection of both type ranges
  const db = round5cm(
    range(rng, Math.max(bedT.depth[0], livT.depth[0]), Math.min(bedT.depth[1], livT.depth[1])),
  )
  const wl = dimDraw(rng, 'living', 'width')
  const dl = round5cm(range(rng, livT.depth[0], db))
  const wBath = dimDraw(rng, 'bathroom', 'width')
  const dBath = dimDraw(rng, 'bathroom', 'depth')
  const wk = dimDraw(rng, 'kitchen', 'width')
  const dk = dimDraw(rng, 'kitchen', 'depth')

  const liv = roomFromEdges('r1', 'living', livT.label, wb, 0, wb + wl, dl)
  const bed = roomFromEdges('r2', 'bedroom', bedT.label, 0, 0, wb, db)
  const kit = roomFromEdges('r3', 'kitchen', getRoomType('kitchen').label, wBath, db, wBath + wk, db + dk)
  const bath = roomFromEdges('r4', 'bathroom', getRoomType('bathroom').label, 0, db, wBath, db + dBath)
  const [l, b, k, t] = centerRooms([liv, bed, kit, bath])

  let n = 0
  const openings: Opening[] = []
  const push = (o: OpeningDraft | null) => {
    if (o) openings.push({ ...o, id: `o${++n}` })
  }
  push(doorBetween(b, l, 0.9)) // bedroom ↔ living
  push(doorBetween(b, k, 0.9)) // bedroom ↔ kitchen (flow without crossing the bath)
  push(doorBetween(t, b, 0.8)) // bath ↔ bedroom
  push(doorBetween(t, k, 0.8)) // bath ↔ kitchen
  // entrance: kitchen south wall, near its east end (kitchen at the entrance)
  const ks = sideSpan(k, 's').length
  push({ kind: 'door', a: k.id, b: 'exterior', side: 's', offset: q(ks - 0.45 - 0.3), width: 0.9 })
  push(windowOn(b, 'n', 1.2))
  push(windowOn(l, 'e', 1.5))
  push({ ...windowOn(k, 's', 1.0), offset: 0.8 }) // clear of the entrance door
  push(windowOn(t, 'w', 0.8))
  return { rooms: [l, b, k, t], openings }
}

/**
 * '2br' 两室一厅: fixed 8.4 × 7.2 topology (centered) —
 * 主卧 x 0–x1, z 0–z1 · 次卧 x 0–x1, z z1–7.2 · 厨房 x x1–x2, z 0–z2 ·
 * 卫生间 x x2–8.4, z 0–z2 · 客厅 x x1–8.4, z z2–7.2 (base splits 3.6/6.0/3.4/2.6).
 * Jitter moves whole column/row split lines (±0.3 m) so shared edges stay
 * aligned; the row pair is re-drawn until the 主卧↔客厅 shared span fits a door.
 */
function build2br(seed: string): HomeDef {
  const rng = rngFrom(`${seed}:home:2br`)
  const jx = round5cm(range(rng, -0.3, 0.3)) // bedroom/living column split
  let jz1 = 0.15 // fallback: 主卧/次卧 row split
  let jz2 = -0.15 // fallback: kitchen/bath south edge
  for (let i = 0; i < 10; i++) {
    const a = round5cm(range(rng, -0.3, 0.3))
    const b = round5cm(range(rng, -0.3, 0.3))
    if (3.4 + a - (2.6 + b) >= 0.9) {
      jz1 = a
      jz2 = b
      break
    }
  }
  const x1 = 3.6 + jx
  const x2 = 6.0 + jx
  const z1 = 3.4 + jz1
  const z2 = 2.6 + jz2

  const bed1 = roomFromEdges('r1', 'bedroom', '主卧', 0, 0, x1, z1)
  const bed2 = roomFromEdges('r2', 'bedroom', '次卧', 0, z1, x1, 7.2)
  const kit = roomFromEdges('r3', 'kitchen', '厨房', x1, 0, x2, z2)
  const bath = roomFromEdges('r4', 'bathroom', '卫生间', x2, 0, 8.4, z2)
  const liv = roomFromEdges('r5', 'living', '客厅', x1, z2, 8.4, 7.2)
  const [b1, b2, k, t, l] = centerRooms([bed1, bed2, kit, bath, liv])

  let n = 0
  const openings: Opening[] = []
  const push = (o: OpeningDraft | null) => {
    if (o) openings.push({ ...o, id: `o${++n}` })
  }
  push(doorBetween(b1, l, 0.9)) // 主卧 ↔ 客厅
  push(doorBetween(b2, l, 0.9)) // 次卧 ↔ 客厅
  push(doorBetween(k, l, 0.9)) // 厨房 ↔ 客厅
  push(doorBetween(t, l, 0.8)) // 卫生间 ↔ 客厅
  // entrance on the 客厅 south wall, near the SE corner
  const ls = sideSpan(l, 's').length
  push({ kind: 'door', a: l.id, b: 'exterior', side: 's', offset: q(ls - 0.45 - 0.3), width: 0.9 })
  push(windowOn(b1, 'n', 1.2))
  push(windowOn(b2, 's', 1.2))
  push(windowOn(k, 'n', 1.2))
  push(windowOn(t, 'n', 0.8))
  push(windowOn(l, 'e', 1.5))
  return { rooms: [b1, b2, k, t, l], openings }
}

/** Build a template home. Unknown ids fall back to 'studio'. */
export function buildHome(templateId: string, seed: string): HomeDef {
  switch (templateId) {
    case '1br':
      return build1br(seed)
    case '2br':
      return build2br(seed)
    default:
      return buildStudio(seed)
  }
}

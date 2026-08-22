/**
 * Smoke test for the procedural generator (no vitest, run via tsx):
 *   npx tsx scripts/smoke-gen.ts
 *
 * For every room type × 3 fixed seeds:
 *  - generate twice → deep-equal (determinism)
 *  - every modelId resolves in the registry
 *  - every instance stays within room bounds
 *  - pairwise AABB overlap count = 0 (rug / tv-on-bench pairs excepted)
 *  - living room contains a sofa and a tv-bench
 *
 * Plus door avoidance:
 *  - doorZonesFor maps own + mirrored neighbor declarations onto a room
 *  - multi-room fixture (4 rooms sharing edges) × 3 seeds × 2 salts:
 *    determinism / in-bounds / zero overlap per room, and no wall- or
 *    run-placed piece intersects a door strip on its own wall
 *  - door stress: one living room, a 0.9 m door centered on every wall
 *
 * Plus home templates: per template, buildHome determinism, pairwise
 * room non-overlap, opening validity, windows only on exterior walls
 *
 * Plus floor-plan import: planJsonToHome over the saved fixtures —
 * determinism, structural validity, report counts — plus geometry-repair,
 * type-mapping, opening-position (at/widthM/wall hints) and open-plan
 * (打通 fullHeight) unit cases, and deriveWalls gap subtraction
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planJsonToHome } from '../src/gen/importPlan'
import { deriveWalls, PARAPET_H } from '../src/gen/walls'
import { DOOR_CLEAR, generateLayout, generateLayoutDetailed, overlapAllowed, type LayoutOpts } from '../src/gen/layout'
import { ROOM_TYPES, typeDefaults } from '../src/gen/roomTypes'
import { HOME_TEMPLATES, buildHome } from '../src/gen/templates'
import { boxAt, overlaps, type Box } from '../src/lib/geom'
import { rngFrom } from '../src/lib/prng'
import { allModels, footprintOf, getModel, type FurnitureInstance } from '../src/models/registry'
import {
  doorZonesFor,
  roomById,
  roomsOverlap,
  sharedSpan,
  validateOpening,
  type DoorZone,
  type HomeDef,
  type RoomDef,
} from '../src/state/home'

const SEEDS = ['ALPHA2', 'BETA33', 'GAMMA4']
const SALTS = [0, 1]

let failures = 0
let checks = 0

function fail(msg: string) {
  failures++
  console.error(`  FAIL ${msg}`)
}

function instanceBox(inst: FurnitureInstance): Box | null {
  const def = getModel(inst.modelId)
  if (!def) return null
  const [w, d] = footprintOf(def, inst.params, inst.scale)
  return boxAt(inst.position[0], inst.position[1], w, d, inst.rotationY)
}

for (const type of ROOM_TYPES) {
  for (const seed of SEEDS) {
    const dims = typeDefaults(type.id, rngFrom(`${seed}:room:${type.id}`))
    for (const salt of SALTS) {
      const tag = `${type.id}/${seed}/salt${salt}`
      const opts = {
        roomType: type.id,
        seed,
        salt,
        width: dims.width,
        depth: dims.depth,
        extras: 85,
        models: allModels(),
      }
      const a = generateLayout(opts)
      const b = generateLayout(opts)
      checks++

      if (JSON.stringify(a) !== JSON.stringify(b)) {
        fail(`${tag}: non-deterministic output`)
      }
      if (a.length === 0) {
        fail(`${tag}: empty layout`)
        continue
      }

      // registry lookups + bounds
      const boxes: (Box | null)[] = []
      for (const inst of a) {
        if (!getModel(inst.modelId)) {
          fail(`${tag}: unknown modelId ${inst.modelId}`)
          boxes.push(null)
          continue
        }
        const box = instanceBox(inst)!
        boxes.push(box)
        if (
          Math.abs(box.x) + box.w / 2 > dims.width / 2 + 1e-6 ||
          Math.abs(box.z) + box.d / 2 > dims.depth / 2 + 1e-6
        ) {
          fail(
            `${tag}: ${inst.modelId} out of bounds at (${box.x.toFixed(2)}, ${box.z.toFixed(2)}) ` +
              `${box.w.toFixed(2)}x${box.d.toFixed(2)} in room ${dims.width}x${dims.depth}`,
          )
        }
      }

      // pairwise overlaps
      for (let i = 0; i < a.length; i++) {
        for (let j = i + 1; j < a.length; j++) {
          const bi = boxes[i]
          const bj = boxes[j]
          if (!bi || !bj) continue
          if (overlaps(bi, bj, 0) && !overlapAllowed(a[i], a[j])) {
            fail(`${tag}: overlap ${a[i].modelId} <-> ${a[j].modelId}`)
          }
        }
      }

      if (type.id === 'living') {
        const ids = a.map((f) => f.modelId)
        for (const req of ['builtin:sofa', 'builtin:tv-bench']) {
          if (!ids.includes(req)) fail(`${tag}: living room missing ${req}`)
        }
      }
      checks++
    }
  }
}

// spot-check: different seeds should give different arrangements
{
  const dims = typeDefaults('living', rngFrom('SAME:room:living'))
  const mk = (seed: string) =>
    JSON.stringify(
      generateLayout({
        roomType: 'living',
        seed,
        salt: 0,
        width: dims.width,
        depth: dims.depth,
        extras: 85,
        models: allModels(),
      }),
    )
  checks++
  if (mk('SEEDAA') === mk('SEEDBB')) fail('different seeds produced identical living layouts')
}

// ---------------------------------------------------------------------------
// P3: door avoidance
// ---------------------------------------------------------------------------

/** How deep a door strip reaches into the room from its wall (meters). */
const DOOR_STRIP_DEPTH = 0.6

/** Room-local AABB of a door zone expanded by DOOR_CLEAR along the wall. */
function doorStripBox(zone: DoorZone, roomW: number, roomD: number): Box {
  const c = (zone.from + zone.to) / 2
  const len = zone.to - zone.from + 2 * DOOR_CLEAR
  switch (zone.side) {
    case 'n':
      return { x: c - roomW / 2, z: -roomD / 2 + DOOR_STRIP_DEPTH / 2, w: len, d: DOOR_STRIP_DEPTH }
    case 's':
      return { x: c - roomW / 2, z: roomD / 2 - DOOR_STRIP_DEPTH / 2, w: len, d: DOOR_STRIP_DEPTH }
    case 'e':
      return { x: roomW / 2 - DOOR_STRIP_DEPTH / 2, z: c - roomD / 2, w: DOOR_STRIP_DEPTH, d: len }
    case 'w':
      return { x: -roomW / 2 + DOOR_STRIP_DEPTH / 2, z: c - roomD / 2, w: DOOR_STRIP_DEPTH, d: len }
  }
}

/**
 * Shared assertions for a door-aware layout: determinism, in-bounds, zero
 * overlap, and no wall/run-placed piece (side-tagged by the engine) blocking
 * a door strip on its own wall. Only the avoided class is checked, and only
 * against its own wall — other rule kinds don't avoid doors, and a piece on
 * one wall may legitimately stand next to a door on an adjacent wall.
 */
function checkDoorAwareLayout(tag: string, opts: LayoutOpts, doors: DoorZone[]): void {
  const a = generateLayoutDetailed(opts)
  const b = generateLayoutDetailed(opts)
  checks++
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail(`${tag}: non-deterministic output`)
  }
  if (a.length === 0) {
    fail(`${tag}: empty layout`)
    checks++
    return
  }

  // bounds
  const boxes: (Box | null)[] = []
  for (const p of a) {
    const box = instanceBox(p.inst)
    if (!box) {
      fail(`${tag}: unknown modelId ${p.inst.modelId}`)
      boxes.push(null)
      continue
    }
    boxes.push(box)
    if (
      Math.abs(box.x) + box.w / 2 > opts.width / 2 + 1e-6 ||
      Math.abs(box.z) + box.d / 2 > opts.depth / 2 + 1e-6
    ) {
      fail(
        `${tag}: ${p.inst.modelId} out of bounds at (${box.x.toFixed(2)}, ${box.z.toFixed(2)}) ` +
          `${box.w.toFixed(2)}x${box.d.toFixed(2)} in room ${opts.width}x${opts.depth}`,
      )
    }
  }

  // pairwise overlaps
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const bi = boxes[i]
      const bj = boxes[j]
      if (!bi || !bj) continue
      if (overlaps(bi, bj, 0) && !overlapAllowed(a[i].inst, a[j].inst)) {
        fail(`${tag}: overlap ${a[i].inst.modelId} <-> ${a[j].inst.modelId}`)
      }
    }
  }

  // door strips (1 mm tolerance: stored rotationY is rounded to 4 decimals,
  // which inflates the piece AABB by ~2e-6 m at exact-touch boundaries)
  const strips = doors.map((zone) => ({ zone, box: doorStripBox(zone, opts.width, opts.depth) }))
  for (let i = 0; i < a.length; i++) {
    const side = a[i].side
    if (!side) continue // only wall/run placements avoid doors
    const box = boxes[i]
    if (!box) continue
    for (const s of strips) {
      if (s.zone.side !== side) continue
      if (overlaps(box, s.box, -1e-3)) {
        fail(
          `${tag}: ${a[i].inst.modelId} blocks door on ${side} ` +
            `[${s.zone.from.toFixed(2)}, ${s.zone.to.toFixed(2)}]`,
        )
      }
    }
  }
  checks++
}

// multi-room fixture: living + bedroom (west-adjacent) + kitchen (north) +
// bath (east), all sharing edges with the living room
const mkRoom = (id: string, type: string, x: number, z: number, w: number, d: number): RoomDef => ({
  id,
  type,
  name: id,
  rect: { x, z, w, d },
  salt: 0,
  partitionHeight: 0,
})
const HOME: HomeDef = {
  rooms: [
    mkRoom('living', 'living', 0, 0, 4.8, 4.6),
    mkRoom('bedroom', 'bedroom', -4.2, 0, 3.6, 3.4),
    mkRoom('kitchen', 'kitchen', 1.2, -3.6, 2.4, 2.6),
    mkRoom('bath', 'bathroom', 3.6, 0, 2.4, 2.6),
  ],
  openings: [
    { id: 'o1', kind: 'door', a: 'living', b: 'exterior', side: 's', offset: 1.5, width: 0.9 },
    { id: 'o2', kind: 'door', a: 'bedroom', b: 'living', side: 'e', offset: 1.7, width: 0.9 },
    { id: 'o3', kind: 'door', a: 'kitchen', b: 'living', side: 's', offset: 1.2, width: 0.9 },
    { id: 'o4', kind: 'door', a: 'bath', b: 'living', side: 'w', offset: 1.3, width: 0.9 },
    // second kitchen door on a run-candidate wall, exercises placeRun avoidance
    { id: 'o5', kind: 'door', a: 'kitchen', b: 'exterior', side: 'w', offset: 1.3, width: 0.9 },
    { id: 'o6', kind: 'window', a: 'bedroom', b: 'exterior', side: 'w', offset: 1.7, width: 1.2 },
    { id: 'o7', kind: 'window', a: 'kitchen', b: 'exterior', side: 'n', offset: 1.2, width: 1.2 },
    { id: 'o8', kind: 'window', a: 'bath', b: 'exterior', side: 'e', offset: 1.3, width: 1.2 },
    { id: 'o9', kind: 'window', a: 'living', b: 'exterior', side: 's', offset: 3.6, width: 1.5 },
  ],
}

// doorZonesFor: living's own south entrance + three mirrored neighbor doors
{
  checks++
  const zones = doorZonesFor(HOME.rooms[0], HOME)
  const expect: DoorZone[] = [
    { side: 's', from: 1.05, to: 1.95 }, // own entrance
    { side: 'w', from: 1.85, to: 2.75 }, // mirrored from bedroom's east door
    { side: 'n', from: 3.15, to: 4.05 }, // mirrored from kitchen's south door
    { side: 'e', from: 1.85, to: 2.75 }, // mirrored from bath's west door
  ]
  const match =
    zones.length === expect.length &&
    expect.every(
      (e, i) =>
        zones[i].side === e.side &&
        Math.abs(zones[i].from - e.from) < 1e-9 &&
        Math.abs(zones[i].to - e.to) < 1e-9,
    )
  if (!match) fail(`doorZonesFor(living): got ${JSON.stringify(zones)}`)
}

// every fixture room: determinism + bounds + overlaps + door strips
for (const seed of SEEDS) {
  for (const salt of SALTS) {
    for (const room of HOME.rooms) {
      const doors = doorZonesFor(room, HOME)
      checkDoorAwareLayout(
        `home/${room.id}/${seed}/salt${salt}`,
        {
          roomType: room.type,
          seed: `${seed}@${room.id}`,
          salt,
          width: room.rect.w,
          depth: room.rect.d,
          extras: 85,
          models: allModels(),
          doors,
        },
        doors,
      )
    }
  }
}

// door stress: one living room, a 0.9 m door centered on each of the 4 walls
{
  const W = 6.4
  const doors: DoorZone[] = (['n', 's', 'e', 'w'] as const).map((side) => ({
    side,
    from: W / 2 - 0.45,
    to: W / 2 + 0.45,
  }))
  for (const seed of SEEDS) {
    for (const salt of SALTS) {
      checkDoorAwareLayout(
        `door-stress/${seed}/salt${salt}`,
        {
          roomType: 'living',
          seed: `${seed}@stress`,
          salt,
          width: W,
          depth: W,
          extras: 85,
          models: allModels(),
          doors,
        },
        doors,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// P4a: home templates — determinism + structural sanity
// ---------------------------------------------------------------------------
for (const tpl of HOME_TEMPLATES) {
  const tag = `template/${tpl.id}`
  const h1 = buildHome(tpl.id, 'SEEDX')
  const h2 = buildHome(tpl.id, 'SEEDX')
  const h3 = buildHome(tpl.id, 'SEEDY')

  checks++
  if (JSON.stringify(h1) !== JSON.stringify(h2)) fail(`${tag}: non-deterministic buildHome`)
  if (JSON.stringify(h1) === JSON.stringify(h3)) fail(`${tag}: seed had no effect`)

  checks++
  for (let i = 0; i < h1.rooms.length; i++) {
    for (let j = i + 1; j < h1.rooms.length; j++) {
      if (roomsOverlap(h1.rooms[i], h1.rooms[j])) {
        fail(`${tag}: rooms overlap ${h1.rooms[i].id} <-> ${h1.rooms[j].id}`)
      }
    }
  }

  checks++
  for (const o of h1.openings) {
    if (!validateOpening(h1, o)) {
      fail(`${tag}: invalid opening ${o.id} (${o.kind} ${o.a}:${o.side} off=${o.offset} w=${o.width})`)
    }
  }

  checks++
  for (const o of h1.openings) {
    if (o.kind !== 'window') continue
    const room = roomById(h1, o.a)
    if (!room) continue
    for (const r of h1.rooms) {
      if (r.id === room.id) continue
      const sh = sharedSpan(room, r)
      if (sh && sh.side === o.side) {
        fail(`${tag}: window ${o.id} on interior wall ${o.a}:${o.side} (shared with ${r.id})`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Q2: floor-plan import — planJsonToHome fixtures + geometry repair
// ---------------------------------------------------------------------------
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// room/door/window counts come from the AI output each fixture was extracted
// from; real-c found 6 areas, so a few dropped rooms are tolerated there
const IMPORT_FIXTURES = [
  { file: 'plan-2br.json', rooms: 5, minRooms: 5, doors: 5, windows: 5 },
  { file: 'plan-real-b.json', rooms: 12, minRooms: 12, doors: 10, windows: 11 },
  { file: 'plan-real-c.json', rooms: 6, minRooms: 4, doors: 4, windows: 4 },
]

for (const fx of IMPORT_FIXTURES) {
  const tag = `import/${fx.file}`
  const json = JSON.parse(readFileSync(join(FIXTURE_DIR, fx.file), 'utf8'))
  const r1 = planJsonToHome(json)
  const r2 = planJsonToHome(json)

  checks++
  if (JSON.stringify(r1) !== JSON.stringify(r2)) fail(`${tag}: non-deterministic planJsonToHome`)

  const { home, report } = r1

  checks++
  for (let i = 0; i < home.rooms.length; i++) {
    for (let j = i + 1; j < home.rooms.length; j++) {
      if (roomsOverlap(home.rooms[i], home.rooms[j])) {
        fail(`${tag}: rooms overlap ${home.rooms[i].id} <-> ${home.rooms[j].id}`)
      }
    }
  }

  checks++
  for (const o of home.openings) {
    if (!validateOpening(home, o)) {
      fail(`${tag}: invalid opening ${o.id} (${o.kind} ${o.a}:${o.side} off=${o.offset} w=${o.width})`)
    }
  }

  checks++
  for (const o of home.openings) {
    if (o.kind !== 'window') continue
    const room = roomById(home, o.a)
    if (!room) continue
    for (const r of home.rooms) {
      if (r.id === room.id) continue
      const sh = sharedSpan(room, r)
      if (sh && sh.side === o.side) {
        fail(`${tag}: window ${o.id} on interior wall ${o.a}:${o.side} (shared with ${r.id})`)
      }
    }
  }

  checks++
  const ids = [...home.rooms.map((r) => r.id), ...home.openings.map((o) => o.id)]
  if (new Set(ids).size !== ids.length) fail(`${tag}: duplicate ids`)

  checks++
  if (report.roomsApplied !== home.rooms.length) {
    fail(`${tag}: roomsApplied ${report.roomsApplied} != ${home.rooms.length} rooms`)
  }
  if (report.roomsApplied < fx.minRooms || report.roomsApplied > fx.rooms) {
    fail(`${tag}: roomsApplied ${report.roomsApplied} outside [${fx.minRooms}, ${fx.rooms}]`)
  }
  if (report.doorsApplied + report.doorsDropped !== fx.doors) {
    fail(`${tag}: doors ${report.doorsApplied}+${report.doorsDropped} != ${fx.doors}`)
  }
  if (report.windowsApplied + report.windowsDropped !== fx.windows) {
    fail(`${tag}: windows ${report.windowsApplied}+${report.windowsDropped} != ${fx.windows}`)
  }
}

// geometry-repair unit case: A/B overlap by 0.2 m, C's north edge sits 0.1 m
// off A's south edge — output must be overlap-free with both pairs sharing a
// span wide enough for their doors
{
  const tag = 'import/geometry-repair'
  const plan = {
    overall: { widthM: 12, depthM: 8 },
    rooms: [
      { name: 'A', type: 'living', x: 0, y: 0, w: 4, d: 4 },
      { name: 'B', type: 'bedroom', x: 3.8, y: 0, w: 4, d: 4 }, // overlaps A by 0.2 m
      { name: 'C', type: 'kitchen', x: 0, y: 4.1, w: 4, d: 3 }, // 0.1 m off A's south edge
    ],
    doors: [{ between: ['A', 'B'] }, { between: ['A', 'C'] }],
    windows: [],
  }
  const { home, report } = planJsonToHome(plan)

  checks++
  for (let i = 0; i < home.rooms.length; i++) {
    for (let j = i + 1; j < home.rooms.length; j++) {
      if (roomsOverlap(home.rooms[i], home.rooms[j])) {
        fail(`${tag}: residual overlap ${home.rooms[i].id} <-> ${home.rooms[j].id}`)
      }
    }
  }

  checks++
  const named = new Map(home.rooms.map((r) => [r.name, r]))
  const spanAB = sharedSpan(named.get('A')!, named.get('B')!)
  const spanAC = sharedSpan(named.get('A')!, named.get('C')!)
  if (!spanAB || spanAB.to - spanAB.from < 0.9) {
    fail(`${tag}: A/B edges not repaired into a shared span (got ${JSON.stringify(spanAB)})`)
  }
  if (!spanAC || spanAC.to - spanAC.from < 0.9) {
    fail(`${tag}: A/C edges not snapped into a shared span (got ${JSON.stringify(spanAC)})`)
  }

  checks++
  if (report.roomsApplied !== 3 || report.doorsApplied !== 2 || report.doorsDropped !== 0) {
    fail(`${tag}: unexpected report ${JSON.stringify(report)}`)
  }
}

// type-mapping unit case: garage + unknown type → office (names preserved);
// a room with non-numeric w is dropped and counted
{
  const tag = 'import/type-mapping'
  const plan = {
    overall: { widthM: 9, depthM: 4 },
    rooms: [
      { name: 'GARAGE', type: 'garage', x: 0, y: 0, w: 4, d: 4 },
      { name: 'DEN', type: 'parlor', x: 4.5, y: 0, w: 4, d: 4 },
      { name: 'BAD', type: 'living', x: 0, y: 0, w: 'wide', d: 4 },
    ],
    doors: [],
    windows: [],
  }
  const { home, report } = planJsonToHome(plan)

  checks++
  const garage = home.rooms.find((r) => r.name === 'GARAGE')
  const den = home.rooms.find((r) => r.name === 'DEN')
  if (garage?.type !== 'office' || den?.type !== 'office') {
    fail(`${tag}: garage/unknown not mapped to office (${garage?.type}, ${den?.type})`)
  }

  checks++
  if (report.roomsApplied !== 2 || report.roomsDropped !== 1) {
    fail(`${tag}: unexpected report ${JSON.stringify(report)}`)
  }
}

// nothing usable → throws
{
  checks++
  let threw = false
  try {
    planJsonToHome({ rooms: [] })
  } catch (e) {
    threw = e instanceof Error && e.message === 'no valid rooms'
  }
  if (!threw) fail('import/empty: did not throw Error("no valid rooms")')
}

// opening-position unit case: recognized at/widthM/wall hints land the
// openings at the right offsets; an `at` too close to the wall end clamps
{
  const tag = 'import/opening-position'
  const plan = {
    overall: { widthM: 8, depthM: 4 },
    rooms: [
      { name: 'A', type: 'living', x: 0, y: 0, w: 4, d: 4 },
      { name: 'B', type: 'bedroom', x: 4, y: 0, w: 4, d: 4 },
    ],
    doors: [
      { between: ['A', 'B'], at: 0.25, widthM: 1.0 }, // shared span is 4 m → offset 1.0
      { between: ['A', 'B'], at: 0.02 }, // clamps to 0.45 (default 0.9 wide)
      { between: ['A', 'exterior'], wall: 'w', at: 0.5, widthM: 0.9 },
    ],
    windows: [{ room: 'B', wall: 'e', at: 0.3, widthM: 1.5 }], // 4 m wall → offset 1.2
  }
  const { home, report } = planJsonToHome(plan)
  const named = new Map(home.rooms.map((r) => [r.name, r]))
  const aId = named.get('A')!.id
  const bId = named.get('B')!.id
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6

  checks++
  const inner = home.openings.filter((o) => o.a === aId && o.b === bId)
  const positioned = inner.find((o) => near(o.width, 1.0))
  const clamped = inner.find((o) => near(o.width, 0.9))
  if (
    inner.length !== 2 ||
    !positioned ||
    !near(positioned.offset, 1.0) ||
    positioned.side !== 'e' ||
    !clamped ||
    !near(clamped.offset, 0.45)
  ) {
    fail(`${tag}: interior doors wrong ${JSON.stringify(inner)}`)
  }

  checks++
  const entrance = home.openings.find((o) => o.b === 'exterior' && o.kind === 'door')
  if (!entrance || entrance.a !== aId || entrance.side !== 'w' || !near(entrance.offset, 2.0)) {
    fail(`${tag}: entrance door wrong ${JSON.stringify(entrance)}`)
  }

  checks++
  const win = home.openings.find((o) => o.kind === 'window')
  if (!win || win.a !== bId || win.side !== 'e' || !near(win.offset, 1.2) || !near(win.width, 1.5)) {
    fail(`${tag}: window wrong ${JSON.stringify(win)}`)
  }
  if (report.doorsApplied !== 3 || report.windowsApplied !== 1) {
    fail(`${tag}: unexpected report ${JSON.stringify(report)}`)
  }
}

// open-plan unit case: doors with open:true become a fullHeight gap spanning
// the (recognized or whole) shared interval, and deriveWalls emits NO
// interior wall across it
{
  const tag = 'import/open-plan'
  const plan = {
    overall: { widthM: 8, depthM: 4 },
    rooms: [
      { name: 'KITCHEN', type: 'kitchen', x: 0, y: 0, w: 4, d: 4 },
      { name: 'LIVING', type: 'living', x: 4, y: 0, w: 4, d: 4 },
    ],
    doors: [{ between: ['KITCHEN', 'LIVING'], open: true }],
    windows: [],
  }
  const { home, report } = planJsonToHome(plan)

  checks++
  const gap = home.openings[0]
  if (
    !gap ||
    gap.kind !== 'open' ||
    gap.fullHeight !== true ||
    Math.abs(gap.width - 4) > 1e-6 ||
    Math.abs(gap.offset - 2) > 1e-6
  ) {
    fail(`${tag}: gap opening wrong ${JSON.stringify(gap)}`)
  }
  if (report.doorsApplied !== 1 || report.doorsDropped !== 0) {
    fail(`${tag}: unexpected report ${JSON.stringify(report)}`)
  }

  checks++
  const segs = deriveWalls(home, 2.6)
  if (segs.some((s) => s.kind === 'int')) {
    fail(`${tag}: interior wall survived a full-width gap ${JSON.stringify(segs.filter((s) => s.kind === 'int'))}`)
  }
  if (JSON.stringify(segs) !== JSON.stringify(deriveWalls(home, 2.6))) {
    fail(`${tag}: non-deterministic deriveWalls`)
  }
}

// walls/full-height-gap: a partial 打通 subtracts its span from the interior
// wall — two sub-segments remain, a door inside a surviving sub-span keeps
// its (re-based) doorway, a door inside the gap is dropped
{
  const tag = 'walls/full-height-gap'
  const home: HomeDef = {
    rooms: [
      { id: 'r1', type: 'kitchen', name: 'K', rect: { x: 0, z: 0, w: 4, d: 4 }, salt: 0, partitionHeight: 0 },
      { id: 'r2', type: 'living', name: 'L', rect: { x: 4, z: 0, w: 4, d: 4 }, salt: 0, partitionHeight: 0 },
    ],
    openings: [
      { id: 'o1', kind: 'open', fullHeight: true, a: 'r1', b: 'r2', side: 'e', offset: 2, width: 2 },
      { id: 'o2', kind: 'door', a: 'r1', b: 'r2', side: 'e', offset: 0.5, width: 0.9 },
      { id: 'o3', kind: 'door', a: 'r1', b: 'r2', side: 'e', offset: 2.5, width: 0.9 }, // inside the gap
    ],
  }
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6

  checks++
  const ints = deriveWalls(home, 2.6).filter((s) => s.kind === 'int')
  if (ints.length !== 2) {
    fail(`${tag}: expected 2 interior sub-segments, got ${ints.length}`)
  } else {
    const [s1, s2] = ints
    // r1's e wall runs north→south from z=-2; gap [1,3] leaves [0,1] and [3,4]
    const ok1 = near(s1.from[0], 2) && near(s1.from[1], -2) && near(s1.to[1], -1)
    const ok2 = near(s2.from[0], 2) && near(s2.from[1], 1) && near(s2.to[1], 2)
    if (!ok1 || !ok2) fail(`${tag}: sub-segment spans wrong ${JSON.stringify(ints.map((s) => [s.from, s.to]))}`)
    if (s1.doorways.length !== 1 || !near(s1.doorways[0].u, 0.5)) {
      fail(`${tag}: surviving doorway wrong ${JSON.stringify(s1.doorways)}`)
    }
    if (s2.doorways.length !== 0) {
      fail(`${tag}: gap-covered doorway not dropped ${JSON.stringify(s2.doorways)}`)
    }
  }

  checks++
  if (JSON.stringify(deriveWalls(home, 2.6)) !== JSON.stringify(deriveWalls(home, 2.6))) {
    fail(`${tag}: non-deterministic deriveWalls`)
  }
}

// walls/exterior-gap: an exterior fullHeight opening (阳台) turns its span
// into a parapet segment; the remaining wall pieces keep full height
{
  const tag = 'walls/exterior-gap'
  const home: HomeDef = {
    rooms: [
      { id: 'r1', type: 'balcony', name: 'B', rect: { x: 0, z: 0, w: 4, d: 2 }, salt: 0, partitionHeight: 0 },
    ],
    openings: [
      { id: 'o1', kind: 'open', fullHeight: true, a: 'r1', b: 'exterior', side: 's', offset: 2, width: 3 },
      { id: 'o2', kind: 'window', a: 'r1', b: 'exterior', side: 'n', offset: 2, width: 1.2 },
    ],
  }
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6

  checks++
  const segs = deriveWalls(home, 2.8)
  // south wall (z=+1): pieces [0,0.5] and [3.5,4] full height + parapet [0.5,3.5]
  const south = segs.filter((s) => s.kind === 'ext' && near(s.from[1], 1))
  const parapets = south.filter((s) => near(s.height, PARAPET_H))
  const fulls = south.filter((s) => near(s.height, 2.8))
  if (south.length !== 3 || parapets.length !== 1 || fulls.length !== 2) {
    fail(`${tag}: expected 2 full + 1 parapet on the south edge, got ${JSON.stringify(south.map((s) => [s.from, s.to, s.height]))}`)
  } else {
    const p = parapets[0]
    if (!near(p.from[0], -1.5) || !near(p.to[0], 1.5)) {
      fail(`${tag}: parapet span wrong ${JSON.stringify([p.from, p.to])}`)
    }
    if (p.doorways.length !== 0 || p.windows.length !== 0) {
      fail(`${tag}: parapet carries openings`)
    }
  }

  checks++
  const northWin = segs.some((s) => s.windows.length === 1)
  if (!northWin) fail(`${tag}: north window lost`)
  if (JSON.stringify(segs) !== JSON.stringify(deriveWalls(home, 2.8))) {
    fail(`${tag}: non-deterministic deriveWalls`)
  }
}

// import/balcony: balcony type passes through; open exterior door → parapet
// opening; open interior pair → fullHeight gap with the recognized width
{
  const tag = 'import/balcony'
  const plan = {
    overall: { widthM: 6, depthM: 5.6 },
    rooms: [
      { name: 'LIVING', type: 'living', x: 0, y: 0, w: 6, d: 4 },
      { name: 'BALCONY', type: 'balcony', x: 0, y: 4, w: 6, d: 1.6 },
    ],
    doors: [
      { between: ['LIVING', 'BALCONY'], open: true, widthM: 4.5, at: 0.5 },
      { between: ['BALCONY', 'exterior'], wall: 's', open: true, widthM: 5.5, at: 0.5 },
    ],
    windows: [],
  }
  const { home, report } = planJsonToHome(plan)
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6

  checks++
  const balcony = home.rooms.find((r) => r.name === 'BALCONY')
  if (balcony?.type !== 'balcony') fail(`${tag}: balcony type not preserved (${balcony?.type})`)

  checks++
  const sliding = home.openings.find((o) => o.b === balcony?.id || o.a === balcony?.id)
  const railing = home.openings.find((o) => o.b === 'exterior')
  if (!sliding || sliding.kind !== 'open' || sliding.fullHeight !== true || !near(sliding.width, 4.5)) {
    fail(`${tag}: sliding opening wrong ${JSON.stringify(sliding)}`)
  }
  if (!railing || railing.kind !== 'open' || railing.fullHeight !== true || !near(railing.width, 5.5) || railing.side !== 's') {
    fail(`${tag}: railing opening wrong ${JSON.stringify(railing)}`)
  }
  if (report.doorsApplied !== 2 || report.doorsDropped !== 0) {
    fail(`${tag}: unexpected report ${JSON.stringify(report)}`)
  }
}

if (failures > 0) {
  console.error(`\nsmoke-gen: ${failures} failure(s) across ${checks} checks`)
  process.exit(1)
}
console.log(
  `smoke-gen OK: ${checks} checks ` +
    `(${ROOM_TYPES.length} room types x ${SEEDS.length} seeds x ${SALTS.length} salts ` +
    `+ door zones + ${HOME.rooms.length + 1} door-aware rooms + ${HOME_TEMPLATES.length} templates ` +
    `+ ${IMPORT_FIXTURES.length} import fixtures + 3 import unit cases)`,
)

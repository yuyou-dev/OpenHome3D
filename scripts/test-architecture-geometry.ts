import assert from 'node:assert/strict'
import { architecturalFloorPieces, architecturalStairSolids, clipSegmentToPolygon, clipVerticalRange, floorPieces, footprintPolygon, isSimplePolygon, pointInPolygon, polygonArea, polygonBoundarySegments, polygonContainsFootprint, polygonContainsPolygon, signedPolygonArea, splitWallSolid, stairBaseElevation, stairFlightSolids, stairStepSolids, triangulatePolygon, validateArchitecturalOpening, wallFootprint, wallLength } from '../src/gen/architectureGeometry'
import type { ArchitecturalOpening, ArchitecturalSpace, ArchitecturalWall, PlanPoint } from '../src/state/architecture'

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`)
const rectangle = (x: number, z: number, w: number, d: number): PlanPoint[] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]]
const area = (pieces: PlanPoint[][]) => pieces.reduce((sum, p) => sum + polygonArea(p), 0)
const perimeter = (pieces: PlanPoint[][]) => polygonBoundarySegments(pieces).reduce((sum, [a, b]) => sum + Math.hypot(a[0] - b[0], a[1] - b[1]), 0)
let checks = 0
function check(name: string, fn: () => void) { fn(); checks++; console.log(`✓ ${name}`) }

const lShape: PlanPoint[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]
check('L room area, winding, point and boundary containment', () => {
  near(polygonArea(lShape), 7)
  near(signedPolygonArea([...lShape].reverse()), -7)
  assert.equal(isSimplePolygon(lShape), true)
  assert.equal(pointInPolygon([0.5, 3], lShape), true)
  assert.equal(pointInPolygon([2, 2], lShape), false)
  assert.equal(pointInPolygon([1, 2], lShape), true)
  assert.equal(pointInPolygon([1, 2], lShape, false), false)
})
check('Simple polygons reject crossing, touching, duplicate and backtracking edges', () => {
  for (const polygon of [
    [[0, 0], [3, 3], [0, 3], [3, 0]],
    [[0, 0], [3, 0], [1, 0], [1, 2], [0, 2]],
    [[0, 0], [3, 0], [3, 0], [0, 2]],
    [[0, 0], [3, 0], [3, 3], [1, 0], [0, 3]],
    [[0, 0], [1, 1], [2, 2]],
    [[0, 0], [2, 0], [Infinity, 2]],
  ] as PlanPoint[][]) assert.equal(isSimplePolygon(polygon), false, JSON.stringify(polygon))
  assert.equal(isSimplePolygon([[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]]), true)
})
check('Furniture cannot bridge a concave notch even when all four corners fit', () => {
  const center: PlanPoint = [2, 2]
  const footprint = footprintPolygon(center, 4.2, 0.2, Math.PI / 4)
  assert.ok(footprint.every(p => pointInPolygon(p, lShape)))
  assert.equal(polygonContainsFootprint(lShape, center, 4.2, 0.2, Math.PI / 4), false)
  assert.equal(polygonContainsFootprint(lShape, [0.5, 2], 0.6, 2, 0), true)
  assert.equal(polygonContainsFootprint(lShape, [0.5, 2], 2, 0.6, Math.PI / 2), true)
})
check('Furniture respects a void inside its footprint and crossing an edge', () => {
  const room = rectangle(0, 0, 6, 6), voids = [rectangle(2, 2, 2, 2)]
  assert.equal(polygonContainsFootprint(room, [3, 3], 5, 5, 0, voids), false)
  assert.equal(polygonContainsFootprint(room, [2, 3], 1, 1, 0, voids), false)
  assert.equal(polygonContainsFootprint(room, [1, 3], 1, 1, 0, voids), true)
  assert.equal(polygonContainsPolygon(room, rectangle(0, 0, 2, 2)), true)
  assert.equal(polygonContainsFootprint(room, [3, 3], 2, 2, 0, voids), false)
})
check('Concave and diagonal floor triangulation preserves exact area', () => {
  near(area(triangulatePolygon(lShape)), 7)
  near(area(triangulatePolygon([...lShape].reverse())), 7)
  const diagonal: PlanPoint[] = [[0, 0], [4, 1], [3, 4], [1, 3]]
  near(area(floorPieces(diagonal)), polygonArea(diagonal))
  near(area(triangulatePolygon([[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]])), 16)
})
check('Enclosed void leaves a true hole and no internal triangulation boundaries', () => {
  const room = rectangle(0, 0, 6, 6), hole = rectangle(2, 2, 2, 2)
  const pieces = floorPieces(room, [hole])
  near(area(pieces), 32)
  near(perimeter(pieces), 32)
  for (const polygon of pieces) {
    const centroid: PlanPoint = [polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length, polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length]
    assert.equal(pointInPolygon(centroid, hole, false), false)
  }
})
check('Void crossing a room boundary becomes a notch rather than a filled slab', () => {
  const pieces = floorPieces(rectangle(0, 0, 6, 6), [rectangle(4, 2, 4, 2)])
  near(area(pieces), 32)
  near(perimeter(pieces), 28)
  near(area(floorPieces(lShape, [rectangle(0.2, 2, 0.6, 1)])), 6.4)
  near(area(floorPieces(rectangle(0, 0, 2, 2), [rectangle(-1, -1, 4, 4)])), 0)
})
check('Overlapping voids subtract their union only once', () => {
  near(area(floorPieces(rectangle(0, 0, 6, 6), [rectangle(1, 1, 2, 2), rectangle(2, 2, 2, 2)])), 29)
})
check('Stair tread clipping follows concavity and excludes voids', () => {
  const lines = clipSegmentToPolygon([-1, 2], [5, 2], lShape)
  near(lines.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0), 1)
  const parts = clipSegmentToPolygon([0, 3], [6, 3], rectangle(0, 0, 6, 6), [rectangle(2, 2, 2, 2)])
  assert.equal(parts.length, 2)
  near(parts.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0), 4)
})

const wall: ArchitecturalWall = { id: 'w', levelId: 'l', start: [0, 0], end: [5, 0], thickness: 0.2, height: 3, kind: 'exterior' }
const opening = (patch: Partial<ArchitecturalOpening> = {}): ArchitecturalOpening => ({ id: 'd', wallId: 'w', kind: 'door', offset: 2, width: 1, sill: 0, height: 2, operation: 'hinged', hinge: 'start', swing: 1, ...patch })
const solidArea = (cuts: ArchitecturalOpening[]) => splitWallSolid(wall, cuts).reduce((sum, r) => sum + (r.to - r.from) * (r.top - r.bottom), 0)
check('Wall openings enforce horizontal and vertical extents and references', () => {
  assert.equal(validateArchitecturalOpening(wall, opening()), null)
  assert.equal(validateArchitecturalOpening(wall, opening({ offset: 0.5 })), null)
  for (const o of [opening({ offset: 0.4 }), opening({ offset: 4.6 }), opening({ sill: 2 }), opening({ width: -1 }), opening({ sill: -0.1 }), opening({ wallId: 'other' })]) assert.notEqual(validateArchitecturalOpening(wall, o), null)
})
check('Door/window overlap is two dimensional; touching edges are legal', () => {
  const door = opening()
  assert.notEqual(validateArchitecturalOpening(wall, opening({ id: 'window', sill: 1, height: 1 }), [door]), null)
  assert.equal(validateArchitecturalOpening(wall, opening({ id: 'transom', sill: 2, height: 1 }), [door]), null)
  assert.equal(validateArchitecturalOpening(wall, opening({ id: 'neighbor', offset: 3 }), [door]), null)
})
check('Parapet supports glazing above it without relaxing ordinary wall or door limits', () => {
  const parapet: ArchitecturalWall = { ...wall, kind: 'railing', height: 1.05, end: [3.73, 0] }
  const glazing = opening({ kind: 'window', operation: 'fixed', offset: 1.87, width: 2.79, sill: 1.05, height: 1.4 })
  assert.equal(validateArchitecturalOpening(parapet, glazing), null)
  for (const kind of ['exterior', 'interior'] as const) assert.notEqual(validateArchitecturalOpening({ ...parapet, kind }, glazing), null)
  for (const kind of ['door', 'open'] as const) assert.notEqual(validateArchitecturalOpening(parapet, { ...glazing, kind }), null)
  assert.notEqual(validateArchitecturalOpening(parapet, { ...glazing, offset: 0 }), null)
  assert.notEqual(validateArchitecturalOpening(parapet, glazing, [{ ...glazing, id: 'duplicate' }]), null)
  const snapshot = structuredClone(glazing)
  const expected = [{ from: 0, to: 3.73, bottom: 0, top: 1.05 }]
  assert.deepEqual(splitWallSolid(parapet, [glazing]), expected)
  assert.deepEqual(splitWallSolid(parapet, [{ ...glazing, sill: 1.5 }]), expected, 'Above-wall glass must not grow a fictitious wall to its sill')
  const inset = splitWallSolid(parapet, [{ ...glazing, sill: 0.8 }])
  near(inset.reduce((sum, rect) => sum + (rect.to - rect.from) * (rect.top - rect.bottom), 0), 3.73 * 1.05 - 2.79 * 0.25)
  assert.ok(inset.every(rect => rect.top <= parapet.height && rect.bottom >= 0))
  assert.deepEqual(glazing, snapshot, 'Glass keeps its actual sill and height for the renderer')
  assert.deepEqual(clipVerticalRange(glazing.sill, glazing.sill + glazing.height, Infinity), { bottom: 1.05, top: 2.45 })
})
check('Wall solid decomposition preserves real doors, window sills and lintels', () => {
  near(solidArea([opening()]), 13)
  near(solidArea([opening(), opening({ id: 'window', offset: 4, sill: 1, height: 1, kind: 'window' })]), 12)
  near(solidArea([opening(), opening({ id: 'overlap', offset: 2.5 })]), 12)
  near(solidArea([opening({ offset: 20 })]), 15)
  assert.deepEqual(splitWallSolid(wall, [opening({ offset: 2.5, width: 5, height: 3, kind: 'open' })]), [])
})
check('Top section exposes door and window apertures without changing full-height walls', () => {
  const full = splitWallSolid(wall, [opening(), opening({ id: 'window', offset: 4, sill: 0.9, height: 1.2, kind: 'window' })])
  const snapshot = structuredClone(full)
  const section = (height: number) => full.flatMap(rect => {
    const range = clipVerticalRange(rect.bottom, rect.top, height)
    return range ? [{ ...rect, ...range }] : []
  })
  const cut = section(1.2)
  assert.ok(cut.every(rect => rect.bottom < 1.2 && rect.top <= 1.2))
  assert.ok(!cut.some(rect => rect.from < 2 && rect.to > 2), 'Door must have no lintel in plan view')
  assert.ok(cut.some(rect => rect.from <= 4 && rect.to >= 4 && rect.top === 0.9), 'Window sill remains below the cut')
  assert.ok(!cut.some(rect => rect.from < 4 && rect.to > 4 && rect.top > 0.9), 'Window lintel must be absent')
  near(cut.reduce((sum, rect) => sum + (rect.to - rect.from) * (rect.top - rect.bottom), 0), 4.5)
  assert.deepEqual(section(Infinity), snapshot)
  assert.deepEqual(full, snapshot)
  assert.equal(wall.height, 3)
})
check('Top section clips leaves and jambs without relocating upper frames to the cut', () => {
  assert.deepEqual(clipVerticalRange(0.045, 1.955, 1.2), { bottom: 0.045, top: 1.2 })
  assert.deepEqual(clipVerticalRange(0.9, 0.945, 1.2), { bottom: 0.9, top: 0.945 })
  assert.equal(clipVerticalRange(1.955, 2, 1.2), null)
  assert.equal(clipVerticalRange(1.2, 2, 1.2), null)
})
check('Arbitrary wall angle retains centerline length and physical thickness', () => {
  const diagonal: ArchitecturalWall = { ...wall, start: [1, 2], end: [4, 6] }
  near(wallLength(diagonal), 5)
  near(polygonArea(wallFootprint(diagonal, [])), 1)
})
check('Two-wall corners share miter coordinates for horizontal and diagonal joints', () => {
  for (const end of [[5, 4], [8, 3]] as PlanPoint[]) {
    const other: ArchitecturalWall = { ...wall, id: 'other', start: [5, 0], end, kind: 'interior' }
    const a = wallFootprint(wall, [wall, other]), b = wallFootprint(other, [wall, other])
    assert.ok(a.filter(p => b.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)).length >= 2)
  }
})
check('Stair solids follow the polygon and rise in the recognized direction', () => {
  const polygon: PlanPoint[] = [[0, 0], [4, 1], [3, 3], [0, 2]]
  const steps = stairStepSolids(polygon, [1, 0.25], 3, 15)
  near(area(steps.map(step => step.polygon)), polygonArea(polygon))
  near(Math.max(...steps.map(step => step.height)), 3)
  assert.ok(steps.every(step => step.bottom === 0 && step.height > 0 && polygonContainsPolygon(polygon, step.polygon)))
  const low = steps.filter(step => step.index === 0), high = steps.filter(step => step.index === 14)
  assert.ok(Math.max(...low.flatMap(step => step.polygon.map(p => p[0]))) < Math.min(...high.flatMap(step => step.polygon.map(p => p[0]))))
  const hole = rectangle(1, 1, 0.5, 0.5)
  near(area(stairStepSolids(polygon, [1, 0.25], 3, 15, [hole]).map(step => step.polygon)), polygonArea(polygon) - 0.25)
})
check('Wall foundations bridge inner-face rooms and door thresholds without filling the exterior notch', () => {
  const space = (id: string, polygon: PlanPoint[], kind: ArchitecturalSpace['kind'] = 'room'): ArchitecturalSpace => ({ id, name: id, type: 'living', kind, levelId: 'l', polygon })
  const rooms = [space('left', rectangle(0, 0, 2, 4)), space('right', rectangle(2.2, 0, 2, 4))]
  const middle: ArchitecturalWall = { ...wall, start: [2.1, 0], end: [2.1, 4] }
  const floor = architecturalFloorPieces(rooms, [middle])
  near(area(floor), 16.8)
  assert.ok(floor.some(piece => pointInPolygon([2.1, 2], piece)))
  near(area(architecturalFloorPieces([...rooms, space('void', rectangle(2, 1, 0.2, 2), 'void')], [middle])), 16.4)
  const boundaryWalls = lShape.map((start, i): ArchitecturalWall => ({ ...wall, id: `l${i}`, start, end: lShape[(i + 1) % lShape.length] }))
  assert.ok(architecturalFloorPieces([space('L', lShape)], boundaryWalls).every(piece => !pointInPolygon([2, 2], piece)))
})
check('Raised ledge is excluded from floor union even when a room overlaps it', () => {
  const room: ArchitecturalSpace = { id: 'room', name: 'Room', type: 'bedroom', levelId: 'l', kind: 'room', polygon: rectangle(0, 0, 4, 4) }
  const ledge: ArchitecturalSpace = { ...room, id: 'ledge', kind: 'ledge', surfaceHeight: 0.65, polygon: rectangle(0, 3, 4, 1.5) }
  const floor = architecturalFloorPieces([room, ledge], [])
  near(area(floor), 12)
  assert.ok(floor.every(piece => !pointInPolygon([2, 3.5], piece)))
  assert.ok(floor.every(piece => !pointInPolygon([2, 4.25], piece)))
  near(area(floorPieces(ledge.polygon, [rectangle(1, 3.5, 1, 1)])), 5)
  assert.equal(ledge.surfaceHeight, 0.65)
})
check('U stair follows ordered runs and landing without filling its center or straightening the turn', () => {
  assert.deepEqual(stairStepSolids(lShape, [0, 1], 3), [], 'a concave turn must not become a single straight flight')
  const polygon = rectangle(0, 0, 4, 4)
  const flights = [
    { id: 'up', path: [[0.5, 0.5], [0.5, 3.5]] as PlanPoint[], width: 1, rise: 1.5, steps: 8 },
    { id: 'landing', path: [[0.5, 3.5], [2.5, 3.5]] as PlanPoint[], width: 1, rise: 0 },
    { id: 'return', path: [[2.5, 3.5], [2.5, 0.5]] as PlanPoint[], width: 1, rise: 1.5, steps: 8 },
  ]
  const steps = stairFlightSolids(polygon, flights)
  near(Math.max(...steps.map(step => step.bottom + step.height)), 3)
  near(area(steps.map(step => step.polygon)), 8)
  assert.ok(steps.every(step => !pointInPolygon([1.5, 2], step.polygon)))
  assert.ok(steps.some(step => pointInPolygon([1.5, 3.5], step.polygon) && Math.abs(step.bottom + step.height - 1.5) < 1e-6))
  assert.ok(steps.some(step => pointInPolygon([2.5, 0.6], step.polygon) && Math.abs(step.bottom + step.height - 3) < 1e-6))
  const withVoid = stairFlightSolids(polygon, flights, [rectangle(2.25, 1.5, 0.5, 0.5)])
  near(area(withVoid.map(step => step.polygon)), 7.75)
})
check('Down stair ends at this floor and cuts a stairwell without reversing its uphill path', () => {
  const room: ArchitecturalSpace = { id: 'r', name: 'Upper room', type: 'living', levelId: 'L2', kind: 'room', polygon: rectangle(0, 0, 5, 5) }
  const space: ArchitecturalSpace = { ...room, id: 's', name: 'Down stair', kind: 'stair', polygon: rectangle(1, 1, 3, 1), stair: { connection: 'down', flights: [
    { id: 'run', path: [[1, 1.5], [3, 1.5]], width: 1, rise: 1.8, steps: 10 },
    { id: 'landing', path: [[3, 1.5], [4, 1.5]], width: 1, rise: 0, steps: 0 },
  ] } }
  const before = structuredClone(space)
  near(stairBaseElevation(space, 2.8), -1.8)
  const solids = architecturalStairSolids(space, 2.8)
  assert.ok(solids.length > 0)
  near(Math.max(...solids.map(solid => solid.bottom + solid.height)), 0)
  near(Math.min(...solids.map(solid => solid.bottom)), -1.8)
  assert.ok(solids.some(solid => pointInPolygon([3.5, 1.5], solid.polygon) && Math.abs(solid.bottom + solid.height) < 1e-6))
  const floor = architecturalFloorPieces([room, space], [])
  near(area(floor), 22)
  assert.ok(floor.every(piece => !pointInPolygon([2, 1.5], piece)), 'A y=0 slab must not hide descending treads')
  assert.deepEqual(space, before)
  const up: ArchitecturalSpace = { ...space, stair: { ...space.stair, connection: 'up' } }
  near(Math.max(...architecturalStairSolids(up, 2.8).map(solid => solid.bottom + solid.height)), 1.8)
  near(area(architecturalFloorPieces([room, up], [])), 25)
})
check('Unknown stair connections stay planar; legacy and direction-only stairs remain compatible', () => {
  const space: ArchitecturalSpace = { id: 's', name: 'Stair', type: 'other', levelId: 'L2', kind: 'stair', polygon: rectangle(0, 0, 1, 3), stair: { connection: 'unknown', direction: [0, 1] } }
  assert.deepEqual(architecturalStairSolids(space, 3), [])
  near(area(architecturalFloorPieces([space], [])), 3)
  const down: ArchitecturalSpace = { ...space, stair: { ...space.stair, connection: 'down' } }
  near(Math.max(...architecturalStairSolids(down, 3).map(solid => solid.bottom + solid.height)), 0)
  const legacy: ArchitecturalSpace = { ...space, stair: { direction: [0, 1] } }
  near(Math.max(...architecturalStairSolids(legacy, 3).map(solid => solid.bottom + solid.height)), 3)
})
console.log(`Architecture geometry: ${checks} checks passed.`)

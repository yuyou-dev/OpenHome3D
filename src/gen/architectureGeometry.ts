import type { ArchitecturalOpening, ArchitecturalSpace, ArchitecturalWall, PlanPoint } from '../state/architecture'

const EPS = 1e-7
const cross = (a: PlanPoint, b: PlanPoint) => a[0] * b[1] - a[1] * b[0]
const sub = (a: PlanPoint, b: PlanPoint): PlanPoint => [a[0] - b[0], a[1] - b[1]]
const distance = (a: PlanPoint, b: PlanPoint) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function signedPolygonArea(polygon: PlanPoint[]): number {
  return polygon.reduce((sum, a, i) => sum + cross(a, polygon[(i + 1) % polygon.length]), 0) / 2
}
export const polygonArea = (polygon: PlanPoint[]): number => Math.abs(signedPolygonArea(polygon))

function onSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): boolean {
  return Math.abs(cross(sub(b, a), sub(p, a))) <= EPS * Math.max(1, distance(a, b)) &&
    p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS
}

/** Boundary points count as inside unless requested otherwise. */
export function pointInPolygon(point: PlanPoint, polygon: PlanPoint[], includeBoundary = true): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i]
    if (onSegment(point, a, b)) return includeBoundary
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function segmentsIntersect(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const ab = sub(b, a), cd = sub(d, c)
  const c1 = cross(ab, sub(c, a)), c2 = cross(ab, sub(d, a))
  const c3 = cross(cd, sub(a, c)), c4 = cross(cd, sub(b, c))
  if (c1 * c2 < -EPS && c3 * c4 < -EPS) return true
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
}

/** Reject self intersections, repeated vertices, zero-length edges and zero area. */
export function isSimplePolygon(polygon: PlanPoint[]): boolean {
  if (polygon.length < 3 || polygon.some(p => p.length !== 2 || !p.every(Number.isFinite)) || polygonArea(polygon) < EPS) return false
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    if (distance(a, b) < EPS) return false
    const previous = polygon[(i + polygon.length - 1) % polygon.length]
    if (onSegment(b, previous, a) || onSegment(previous, a, b)) return false
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue
      if (segmentsIntersect(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return false
    }
  }
  return true
}

/** Concave stairs need explicit flights; one direction cannot describe their turn. */
export function isConvexPolygon(polygon: PlanPoint[]): boolean {
  const sign = Math.sign(signedPolygonArea(polygon))
  return !!sign && polygon.every((p, i) => sign * cross(sub(polygon[(i + 1) % polygon.length], p), sub(polygon[(i + 2) % polygon.length], polygon[(i + 1) % polygon.length])) >= -EPS)
}

/** Rectangle rotation follows THREE's rotationY: +x rotates towards -z. */
export function footprintPolygon(center: PlanPoint, width: number, depth: number, rotation: number): PlanPoint[] {
  const c = Math.cos(rotation), s = Math.sin(rotation)
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]
    .map(([x, z]) => [center[0] + c * x + s * z, center[1] - s * x + c * z])
}

function segmentBreaks(a: PlanPoint, b: PlanPoint, polygons: PlanPoint[][]): number[] {
  const delta = sub(b, a), lengthSquared = delta[0] ** 2 + delta[1] ** 2
  const values = [0, 1]
  if (lengthSquared < EPS ** 2) return values
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], edge = sub(q, p)
    const denominator = cross(delta, edge)
    if (Math.abs(denominator) > EPS) {
      const t = cross(sub(p, a), edge) / denominator, u = cross(sub(p, a), delta) / denominator
      if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) values.push(t)
    } else if (Math.abs(cross(sub(p, a), delta)) < EPS) {
      for (const point of [p, q]) {
        const t = ((point[0] - a[0]) * delta[0] + (point[1] - a[1]) * delta[1]) / lengthSquared
        if (t > EPS && t < 1 - EPS) values.push(t)
      }
    }
  }
  return [...new Set(values)].sort((a, b) => a - b)
}

/** Clip a line to usable floor; useful for stair treads and direction marks. */
export function clipSegmentToPolygon(a: PlanPoint, b: PlanPoint, polygon: PlanPoint[], holes: PlanPoint[][] = []): [PlanPoint, PlanPoint][] {
  const at = (t: number): PlanPoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const values = segmentBreaks(a, b, [polygon, ...holes])
  return values.slice(0, -1).flatMap((from, i) => {
    const to = values[i + 1], middle = at((from + to) / 2)
    return to - from > EPS && pointInPolygon(middle, polygon) && !holes.some(hole => pointInPolygon(middle, hole, false))
      ? [[at(from), at(to)] as [PlanPoint, PlanPoint]] : []
  })
}

/** Checks whole edges, not just corners, so a footprint cannot bridge a concave notch. */
export function polygonContainsPolygon(polygon: PlanPoint[], inner: PlanPoint[], holes: PlanPoint[][] = []): boolean {
  if (!inner.length || inner.some(p => !pointInPolygon(p, polygon) || holes.some(hole => pointInPolygon(p, hole, false)))) return false
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i], b = inner[(i + 1) % inner.length]
    const length = clipSegmentToPolygon(a, b, polygon, holes).reduce((sum, [p, q]) => sum + distance(p, q), 0)
    if (length < distance(a, b) - EPS) return false
  }
  // A rectangle can completely enclose a void without crossing any void edges.
  return !holes.some(hole => hole.some(p => pointInPolygon(p, inner, false)) ||
    triangulatePolygon(hole).some(triangle => pointInPolygon([
      (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
      (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
    ], inner, false)))
}

export function polygonContainsFootprint(polygon: PlanPoint[], center: PlanPoint, width: number, depth: number, rotation: number, holes: PlanPoint[][] = []): boolean {
  return width > 0 && depth > 0 && polygonContainsPolygon(polygon, footprintPolygon(center, width, depth, rotation), holes)
}

export const wallLength = (wall: ArchitecturalWall): number => distance(wall.start, wall.end)
export interface WallSolidRect { from: number; to: number; bottom: number; top: number }

/** Display-only section: preserve the actual bottom and omit solids above the cut. */
export function clipVerticalRange(bottom: number, top: number, cutHeight: number): { bottom: number; top: number } | null {
  const visibleTop = Math.min(top, cutHeight)
  return visibleTop > bottom ? { bottom, top: visibleTop } : null
}

export function validateArchitecturalOpening(wall: ArchitecturalWall, opening: ArchitecturalOpening, others: ArchitecturalOpening[] = []): string | null {
  if (opening.wallId !== wall.id) return 'Opening references another wall'
  if (![opening.offset, opening.width, opening.sill, opening.height].every(Number.isFinite) || opening.width <= 0 || opening.height <= 0 || opening.sill < 0) return 'Opening dimensions are invalid'
  // Balcony glazing may sit above its supporting parapet; ordinary wall apertures may not.
  const aboveParapet = wall.kind === 'railing' && opening.kind === 'window'
  if (opening.offset - opening.width / 2 < -EPS || opening.offset + opening.width / 2 > wallLength(wall) + EPS || (!aboveParapet && opening.sill + opening.height > wall.height + EPS)) return 'Opening lies outside its wall'
  if (others.some(other => other.id !== opening.id && other.wallId === wall.id &&
    Math.abs(other.offset - opening.offset) < (other.width + opening.width) / 2 - EPS &&
    Math.min(other.sill + other.height, opening.sill + opening.height) > Math.max(other.sill, opening.sill) + EPS)) return 'Openings overlap'
  return null
}

/** Exact union subtraction in the wall's (distance, height) plane. */
export function splitWallSolid(wall: ArchitecturalWall, openings: ArchitecturalOpening[]): WallSolidRect[] {
  const cuts = openings.filter(opening => !validateArchitecturalOpening(wall, opening))
  const xs = [...new Set([0, wallLength(wall), ...cuts.flatMap(o => [o.offset - o.width / 2, o.offset + o.width / 2])])].sort((a, b) => a - b)
  const solids: WallSolidRect[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const from = xs[i], to = xs[i + 1]
    if (to - from < EPS) continue
    const intervals = cuts.filter(o => o.offset - o.width / 2 < to - EPS && o.offset + o.width / 2 > from + EPS)
      .map(o => [Math.max(0, Math.min(wall.height, o.sill)), Math.max(0, Math.min(wall.height, o.sill + o.height))])
      .filter(([lo, hi]) => hi - lo > EPS).sort((a, b) => a[0] - b[0])
    let bottom = 0
    const append = (lo: number, hi: number) => {
      if (hi - lo < EPS) return
      const previous = solids.find(rect => Math.abs(rect.to - from) < EPS && Math.abs(rect.bottom - lo) < EPS && Math.abs(rect.top - hi) < EPS)
      if (previous) previous.to = to
      else solids.push({ from, to, bottom: lo, top: hi })
    }
    for (const [lo, hi] of intervals) { append(bottom, lo); bottom = Math.max(bottom, hi) }
    append(bottom, wall.height)
  }
  return solids
}

/** Centerline wall footprint; ordinary two-wall corners share exact miter endpoints. */
export function wallFootprint(wall: ArchitecturalWall, neighbors: ArchitecturalWall[]): PlanPoint[] {
  const length = wallLength(wall)
  if (length < EPS) return []
  const u: PlanPoint = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length]
  const endpoint = (start: boolean, side: number): PlanPoint => {
    const p = start ? wall.start : wall.end, direction: PlanPoint = start ? u : [-u[0], -u[1]]
    const normal: PlanPoint = [-direction[1], direction[0]], sign = start ? side : -side
    const own: PlanPoint = [p[0] + normal[0] * wall.thickness / 2 * sign, p[1] + normal[1] * wall.thickness / 2 * sign]
    const connected = neighbors.filter(other => other.id !== wall.id && other.levelId === wall.levelId &&
      (distance(other.start, p) < EPS || distance(other.end, p) < EPS))
    if (connected.length !== 1) return own
    const other = connected[0], far = distance(other.start, p) < EPS ? other.end : other.start
    const otherLength = distance(far, p)
    if (otherLength < EPS) return own
    const v: PlanPoint = [(far[0] - p[0]) / otherLength, (far[1] - p[1]) / otherLength]
    const denominator = cross(direction, v)
    if (Math.abs(denominator) < EPS) return own
    const otherOffset: PlanPoint = [p[0] + v[1] * other.thickness / 2 * sign, p[1] - v[0] * other.thickness / 2 * sign]
    const t = cross(sub(otherOffset, own), v) / denominator
    // Acute joints use a bevel rather than an arbitrarily long miter spike.
    if (Math.abs(t) > Math.min(length / 2, Math.max(wall.thickness, other.thickness) * 4)) return own
    return [own[0] + direction[0] * t, own[1] + direction[1] * t]
  }
  return [endpoint(true, 1), endpoint(false, 1), endpoint(false, -1), endpoint(true, -1)]
}

/** Ear clipping keeps this module independent of WebGL and handles concave rooms. */
export function triangulatePolygon(polygon: PlanPoint[]): PlanPoint[][] {
  const points = signedPolygonArea(polygon) < 0 ? [...polygon].reverse() : [...polygon]
  const result: PlanPoint[][] = []
  while (points.length > 3) {
    let clipped = false
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length]
      const turn = cross(sub(b, a), sub(c, b))
      if (Math.abs(turn) < EPS) { points.splice(i, 1); clipped = true; break }
      if (turn < 0) continue
      const triangle = [a, b, c]
      if (points.some(p => p !== a && p !== b && p !== c && pointInPolygon(p, triangle))) continue
      result.push(triangle)
      points.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) return [] // Self-intersecting input has no trustworthy surface.
  }
  if (points.length === 3 && polygonArea(points) > EPS) result.push(points)
  return result
}

/** Sutherland–Hodgman clip against one directed line. */
export function clipPolygonHalfPlane(polygon: PlanPoint[], a: PlanPoint, b: PlanPoint, keepLeft = true): PlanPoint[] {
  const sign = keepLeft ? 1 : -1, axis = sub(b, a)
  const side = (p: PlanPoint) => sign * cross(axis, sub(p, a))
  const result: PlanPoint[] = []
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = side(p), dq = side(q)
    if (dp >= -EPS) result.push(p)
    if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
      const t = dp / (dp - dq)
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return result.filter((p, i) => distance(p, result[(i + result.length - 1) % result.length]) > EPS)
}

function convexPolygonsOverlap(a: PlanPoint[], b: PlanPoint[]): boolean {
  const separated = (polygon: PlanPoint[], other: PlanPoint[]) => polygon.some((point, i) => {
    const edge = sub(polygon[(i + 1) % polygon.length], point)
    return other.every(p => cross(edge, sub(p, point)) <= EPS)
  })
  return !separated(a, b) && !separated(b, a)
}

/** Convex pieces of usable floor, including voids touching/crossing an outer boundary. */
export function floorPieces(polygon: PlanPoint[], voids: PlanPoint[][] = []): PlanPoint[][] {
  let pieces = triangulatePolygon(polygon)
  for (const hole of voids) for (const triangle of triangulatePolygon(hole)) {
    pieces = pieces.flatMap(piece => {
      // Disjoint cuts must not fragment a floor along unrelated infinite edge lines.
      if (!convexPolygonsOverlap(piece, triangle)) return [piece]
      const outside: PlanPoint[][] = []
      let inside = piece
      for (let i = 0; i < triangle.length && inside.length; i++) {
        const a = triangle[i], b = triangle[(i + 1) % triangle.length]
        const remaining = clipPolygonHalfPlane(inside, a, b, false)
        if (polygonArea(remaining) > EPS) outside.push(remaining)
        inside = clipPolygonHalfPlane(inside, a, b)
      }
      return outside
    })
  }
  return pieces
}

/** Exposed polygon edges after subtraction; cancels shared triangulation edges. */
export function polygonBoundarySegments(pieces: PlanPoint[][]): [PlanPoint, PlanPoint][] {
  const edges = new Map<string, { segment: [PlanPoint, PlanPoint]; count: number }>()
  const key = (p: PlanPoint) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`
  for (const polygon of pieces) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const values = segmentBreaks(a, b, pieces)
    const at = (t: number): PlanPoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    for (let j = 0; j < values.length - 1; j++) {
      const p = at(values[j]), q = at(values[j + 1])
      if (distance(p, q) < EPS) continue
      const name = [key(p), key(q)].sort().join(':')
      const entry = edges.get(name)
      if (entry) entry.count++
      else edges.set(name, { segment: [p, q], count: 1 })
    }
  }
  return [...edges.values()].filter(entry => entry.count === 1).map(entry => entry.segment)
}

export interface StairStepSolid { polygon: PlanPoint[]; bottom: number; height: number; index: number }
/** A single straight flight, clipped to the surveyed stair polygon and voids. */
export function stairStepSolids(polygon: PlanPoint[], direction: PlanPoint, levelHeight: number, steps?: number, voids: PlanPoint[][] = []): StairStepSolid[] {
  const length = Math.hypot(...direction)
  if (length < EPS || levelHeight <= 0 || !isConvexPolygon(polygon)) return []
  const u: PlanPoint = [direction[0] / length, direction[1] / length], v: PlanPoint = [-u[1], u[0]]
  const projection = polygon.map(p => p[0] * u[0] + p[1] * u[1])
  const from = Math.min(...projection), to = Math.max(...projection)
  const count = Math.max(2, Math.min(60, Math.round(steps ?? levelHeight / 0.18)))
  const pieces = floorPieces(polygon, voids)
  const point = (d: number, side: number): PlanPoint => [u[0] * d + v[0] * side, u[1] * d + v[1] * side]
  return Array.from({ length: count }, (_, index) => {
    const lo = from + (to - from) * index / count, hi = from + (to - from) * (index + 1) / count
    return pieces.flatMap(piece => {
      const strip = clipPolygonHalfPlane(clipPolygonHalfPlane(piece, point(lo, 1), point(lo, -1)), point(hi, -1), point(hi, 1))
      return polygonArea(strip) > EPS ? [{ polygon: strip, bottom: 0, height: levelHeight * (index + 1) / count, index }] : []
    })
  }).flat()
}


/** Union of room inner faces and actual wall footprints; ledges have their own raised surface. */
export function architecturalFloorPieces(spaces: ArchitecturalSpace[], walls: ArchitecturalWall[]): PlanPoint[][] {
  const voids = spaces.filter(space => space.kind === 'void' || space.kind === 'ledge' || space.kind === 'stair' && space.stair?.connection === 'down').map(space => space.polygon)
  const covered: PlanPoint[][] = []
  const polygons = [...spaces.filter(space => space.kind !== 'void' && space.kind !== 'ledge').map(space => space.polygon), ...walls.map(wall => wallFootprint(wall, walls))]
  return polygons.flatMap(polygon => {
    const pieces = floorPieces(polygon, [...voids, ...covered])
    covered.push(polygon)
    return pieces
  })
}

export interface StairFlight { id: string; path: PlanPoint[]; width: number; rise: number; steps?: number }

/** Paths always run uphill; a down connection anchors their final landing at this level's y=0. */
export function stairBaseElevation(space: ArchitecturalSpace, levelHeight: number): number {
  if (space.stair?.connection !== 'down') return 0
  return -(space.stair.flights?.length ? space.stair.flights.reduce((sum, flight) => sum + flight.rise, 0) : levelHeight)
}

/** Unknown connections stay planar, while missing legacy metadata retains the original up schematic. */
export function architecturalStairSolids(space: ArchitecturalSpace, levelHeight: number, voids: PlanPoint[][] = []): StairStepSolid[] {
  if (space.stair?.connection === 'unknown') return []
  const solids = space.stair?.flights?.length ? stairFlightSolids(space.polygon, space.stair.flights, voids)
    : space.stair?.direction ? stairStepSolids(space.polygon, space.stair.direction, levelHeight, space.stair.steps, voids) : []
  const base = stairBaseElevation(space, levelHeight)
  return solids.map(solid => ({ ...solid, bottom: solid.bottom + base }))
}

/** Ordered flights/platforms follow their explicit centerline; corners never become a diagonal shortcut. */
export function stairFlightSolids(polygon: PlanPoint[], flights: StairFlight[], voids: PlanPoint[][] = []): StairStepSolid[] {
  const floor = floorPieces(polygon, voids)
  const result: StairStepSolid[] = []
  let base = 0, stepIndex = 0
  const runs = flights.map(flight => {
    const segments: ArchitecturalWall[] = flight.path.slice(0, -1).map((start, i): ArchitecturalWall => ({
      id: `${flight.id}:${i}`, levelId: 'stair', start, end: flight.path[i + 1], thickness: flight.width, height: 1, kind: 'interior',
    })).filter(segment => wallLength(segment) > EPS)
    return { flight, segments }
  })
  const neighbors = runs.flatMap(run => run.segments)
  for (const { flight, segments } of runs) {
    const total = segments.reduce((sum, segment) => sum + wallLength(segment), 0)
    const count = flight.rise > 0 ? Math.max(1, Math.min(60, Math.round(flight.steps ?? flight.rise / 0.18))) : 1
    let station = 0
    for (const segment of segments) {
      const length = wallLength(segment), u: PlanPoint = [(segment.end[0] - segment.start[0]) / length, (segment.end[1] - segment.start[1]) / length]
      const v: PlanPoint = [-u[1], u[0]], footprint = wallFootprint(segment, neighbors)
      const at = (d: number, side: number): PlanPoint => [segment.start[0] + u[0] * d + v[0] * side, segment.start[1] + u[1] * d + v[1] * side]
      for (let i = 0; i < count; i++) {
        const lo = Math.max(0, total * i / count - station), hi = Math.min(length, total * (i + 1) / count - station)
        if (hi - lo < EPS) continue
        let strip = footprint
        if (lo > EPS) strip = clipPolygonHalfPlane(strip, at(lo, 1), at(lo, -1))
        if (hi < length - EPS) strip = clipPolygonHalfPlane(strip, at(hi, -1), at(hi, 1))
        if (signedPolygonArea(strip) < 0) strip = [...strip].reverse()
        for (const piece of floor) {
          let clipped = piece
          for (let edge = 0; edge < strip.length && clipped.length; edge++) clipped = clipPolygonHalfPlane(clipped, strip[edge], strip[(edge + 1) % strip.length])
          if (polygonArea(clipped) <= EPS) continue
          result.push({ polygon: clipped, bottom: flight.rise > 0 ? base : base - 0.12,
            height: flight.rise > 0 ? flight.rise * (i + 1) / count : 0.12, index: stepIndex + i })
        }
      }
      station += length
    }
    base += flight.rise
    stepIndex += count
  }
  return result
}

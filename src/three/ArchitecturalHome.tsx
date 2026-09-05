import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Edges, Line } from '@react-three/drei'
import { useStore } from '../state/store'
import type { ArchitecturalOpening, ArchitecturalPlan, ArchitecturalSpace, ArchitecturalWall, PlanPoint } from '../state/architecture'
import { architecturalFloorPieces, architecturalStairSolids, clipPolygonHalfPlane, clipSegmentToPolygon, clipVerticalRange, floorPieces, isConvexPolygon, pointInPolygon, polygonArea, polygonBoundarySegments, splitWallSolid, stairBaseElevation, validateArchitecturalOpening, wallFootprint, wallLength } from '../gen/architectureGeometry'
import { toonGradientMap } from '../lib/toon'
import { PALETTE, SHELL } from '../models/palette'

function Box({ size, position, color = SHELL.wall, glass = false, cutHeight = Infinity }: {
  size: [number, number, number]; position: [number, number, number]; color?: string; glass?: boolean; cutHeight?: number
}) {
  const range = clipVerticalRange(position[1] - size[1] / 2, position[1] + size[1] / 2, cutHeight)
  if (!range) return null
  return <mesh castShadow receiveShadow position={[position[0], (range.bottom + range.top) / 2, position[2]]}>
    <boxGeometry args={[size[0], range.top - range.bottom, size[2]]} />
    <meshToonMaterial color={color} gradientMap={toonGradientMap()} transparent={glass} opacity={glass ? 0.35 : 1} depthWrite={!glass} />
    {!glass && <Edges threshold={20} lineWidth={1} color={PALETTE.ink} />}
  </mesh>
}

function prismGeometry(polygon: PlanPoint[], bottom: number, height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, bottom, 0)
  return geometry
}

function PolygonSolid({ polygon, bottom, height, color = SHELL.wall }: { polygon: PlanPoint[]; bottom: number; height: number; color?: string }) {
  const geometry = useMemo(() => prismGeometry(polygon, bottom, height), [polygon, bottom, height])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh castShadow receiveShadow geometry={geometry}>
    <meshToonMaterial color={color} gradientMap={toonGradientMap()} />
    <Edges threshold={20} lineWidth={1} color={PALETTE.ink} />
  </mesh>
}

/** Build a slab from the actual polygon difference, never its bounding rectangle. */
function floorGeometry(pieces: PlanPoint[][], boundaries: [PlanPoint, PlanPoint][], thickness: number): THREE.BufferGeometry {
  const vertices: number[] = []
  const triangle = (a: number[], b: number[], c: number[]) => vertices.push(...a, ...b, ...c)
  for (const piece of pieces) for (let i = 1; i < piece.length - 1; i++) {
    const [a, b, c] = [piece[0], piece[i], piece[i + 1]]
    triangle([a[0], 0, a[1]], [c[0], 0, c[1]], [b[0], 0, b[1]])
    triangle([a[0], -thickness, a[1]], [b[0], -thickness, b[1]], [c[0], -thickness, c[1]])
  }
  for (const [a, b] of boundaries) {
    triangle([a[0], 0, a[1]], [b[0], 0, b[1]], [a[0], -thickness, a[1]])
    triangle([b[0], 0, b[1]], [b[0], -thickness, b[1]], [a[0], -thickness, a[1]])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

function Floor({ pieces, thickness }: { pieces: PlanPoint[][]; thickness: number }) {
  const boundaries = useMemo(() => polygonBoundarySegments(pieces), [pieces])
  const geometry = useMemo(() => floorGeometry(pieces, boundaries, thickness), [pieces, boundaries, thickness])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <group>
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshToonMaterial color={SHELL.floor} gradientMap={toonGradientMap()} side={THREE.DoubleSide} />
    </mesh>
    {/* Draw only exposed boundaries: triangulation must not add fictitious floor seams. */}
    {boundaries.map(([a, b], i) => <Line key={i} points={[[a[0], 0.003, a[1]], [b[0], 0.003, b[1]]]} color={PALETTE.ink} lineWidth={1} />)}
  </group>
}

function OpeningLeaf({ opening, thickness, windows, doorLeaves, cutHeight }: { opening: ArchitecturalOpening; thickness: number; windows: boolean; doorLeaves: boolean; cutHeight: number }) {
  const o = opening
  if (o.kind === 'open' || o.operation === 'open' || (o.kind === 'window' ? !windows : !doorLeaves)) return null
  const glass = o.kind === 'window' || o.operation === 'sliding', color = glass ? SHELL.glass : SHELL.doorLeaf
  const trim = Math.min(0.045, o.width / 8, o.height / 8)
  const width = o.width - trim * 2, height = o.height - trim * 2
  const centerY = o.sill + o.height / 2
  const hingeSign = o.hinge === 'start' ? 1 : -1
  return <group position={[o.offset, 0, 0]}>
    <Box cutHeight={cutHeight} size={[trim, o.height, thickness + 0.015]} position={[-o.width / 2 + trim / 2, centerY, 0]} />
    <Box cutHeight={cutHeight} size={[trim, o.height, thickness + 0.015]} position={[o.width / 2 - trim / 2, centerY, 0]} />
    <Box cutHeight={cutHeight} size={[o.width, trim, thickness + 0.015]} position={[0, o.sill + o.height - trim / 2, 0]} />
    {glass && <Box cutHeight={cutHeight} size={[o.width, trim, thickness + 0.025]} position={[0, o.sill + trim / 2, 0]} />}
    {o.operation === 'hinged' ? <group position={[-hingeSign * width / 2, 0, 0]} rotation-y={-o.swing * hingeSign * (glass ? Math.PI / 12 : Math.PI / 3)}>
      <Box cutHeight={cutHeight} size={[width, height, glass ? 0.025 : 0.04]} position={[hingeSign * width / 2, centerY, 0]} color={color} glass={glass} />
    </group> : o.operation === 'sliding' ? <>
      <Box cutHeight={cutHeight} size={[width * 0.52, height, 0.035]} position={[-width * 0.08, centerY, -0.025]} color={color} glass={glass} />
      <Box cutHeight={cutHeight} size={[width * 0.52, height, 0.035]} position={[width * 0.25, centerY, 0.025]} color={color} glass={glass} />
      <Box cutHeight={cutHeight} size={[width, trim, 0.09]} position={[0, o.sill + trim / 2, 0]} color={SHELL.doorLeaf} />
    </> : <Box cutHeight={cutHeight} size={[width, height, glass ? 0.025 : 0.04]} position={[0, centerY, 0]} color={color} glass={glass} />}
  </group>
}

function Railing({ from, to, bottom, top, thickness }: { from: number; to: number; bottom: number; top: number; thickness: number }) {
  const width = to - from, height = top - bottom, rail = Math.min(thickness, 0.065, height / 2)
  const count = Math.max(1, Math.ceil(width / 0.7))
  return <group>
    <Box size={[width, rail, Math.max(thickness, rail)]} position={[(from + to) / 2, top - rail / 2, 0]} color={PALETTE.woodDark} />
    {Array.from({ length: count + 1 }, (_, i) => <Box key={i} size={[rail, height, rail]} position={[from + rail / 2 + (width - rail) * i / count, bottom + height / 2, 0]} color={PALETTE.woodDark} />)}
  </group>
}

function Wall({ wall, neighbors, openings, spaces, cutaway, windows, doorLeaves, cutHeight }: {
  wall: ArchitecturalWall; neighbors: ArchitecturalWall[]; openings: ArchitecturalOpening[]; spaces: ArchitecturalSpace[]
  cutaway: boolean; windows: boolean; doorLeaves: boolean; cutHeight: number
}) {
  const group = useRef<THREE.Group>(null)
  const length = wallLength(wall)
  const ux = (wall.end[0] - wall.start[0]) / length, uz = (wall.end[1] - wall.start[1]) / length
  const normal = useMemo(() => {
    const midpoint: PlanPoint = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
    const n: PlanPoint = [-uz, ux], probe = Math.max(wall.thickness, 0.15)
    const left: PlanPoint = [midpoint[0] + n[0] * probe, midpoint[1] + n[1] * probe]
    const right: PlanPoint = [midpoint[0] - n[0] * probe, midpoint[1] - n[1] * probe]
    const leftInside = spaces.some(space => space.kind !== 'void' && pointInPolygon(left, space.polygon))
    const rightInside = spaces.some(space => space.kind !== 'void' && pointInPolygon(right, space.polygon))
    // Exterior metadata determines eligibility; geometry determines which side is outside.
    return new THREE.Vector3(leftInside && !rightInside ? -n[0] : n[0], 0, leftInside && !rightInside ? -n[1] : n[1])
  }, [wall, ux, uz, spaces])
  const direction = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    if (group.current) group.current.visible = !cutaway || wall.kind !== 'exterior' || normal.dot(camera.getWorldDirection(direction)) >= -0.05
  })
  const validOpenings = useMemo(() => openings.filter(o => (o.kind !== 'window' || windows) && !validateArchitecturalOpening(wall, o)), [wall, openings, windows])
  const solids = useMemo(() => splitWallSolid(wall, validOpenings).flatMap(rect => {
    const range = clipVerticalRange(rect.bottom, rect.top, cutHeight)
    return range ? [{ ...rect, ...range }] : []
  }), [wall, validOpenings, cutHeight])
  const polygons = useMemo(() => {
    const footprint = wallFootprint(wall, neighbors).map(([x, z]): PlanPoint => [(x - wall.start[0]) * ux + (z - wall.start[1]) * uz, -(x - wall.start[0]) * uz + (z - wall.start[1]) * ux])
    return solids.map(rect => {
      let polygon = footprint
      if (rect.from > 1e-7) polygon = clipPolygonHalfPlane(polygon, [rect.from, 1], [rect.from, 0])
      if (rect.to < length - 1e-7) polygon = clipPolygonHalfPlane(polygon, [rect.to, 0], [rect.to, 1])
      return polygon
    })
  }, [wall, neighbors, ux, uz, solids, length])
  return <group ref={group} position={[wall.start[0], 0, wall.start[1]]} rotation-y={Math.atan2(-uz, ux)}>
    {solids.map((rect, i) => wall.kind === 'railing'
      ? <Railing key={i} {...rect} thickness={wall.thickness} />
      : polygonArea(polygons[i]) > 1e-9 && <PolygonSolid key={i} polygon={polygons[i]} bottom={rect.bottom} height={rect.top - rect.bottom} />)}
    {validOpenings.map(opening => <OpeningLeaf key={opening.id} opening={opening} thickness={wall.thickness} windows={windows} doorLeaves={doorLeaves} cutHeight={cutHeight} />)}
  </group>
}

function Stair({ space, voids, levelHeight }: { space: ArchitecturalSpace; voids: PlanPoint[][]; levelHeight: number }) {
  const connected = space.stair?.connection !== 'unknown'
  const hasFlights = connected && !!space.stair?.flights?.length
  const straight = connected && !!space.stair?.direction && isConvexPolygon(space.polygon)
  const baseElevation = stairBaseElevation(space, levelHeight)
  const solids = useMemo(() => architecturalStairSolids(space, levelHeight, voids), [space, voids, levelHeight])
  const flightArrows = useMemo(() => {
    const result: [number, number, number][][] = []
    if (!connected) return result
    let base = baseElevation
    for (const flight of space.stair?.flights ?? []) {
      const segments = flight.path.slice(0, -1).map((a, i) => [a, flight.path[i + 1]] as [PlanPoint, PlanPoint])
      const total = segments.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0)
      const clearance = flight.rise / Math.max(1, Math.round(flight.steps ?? flight.rise / 0.18)) + 0.04
      let station = 0
      for (let i = 0; i < segments.length; i++) {
        const [a, b] = segments[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (!length) continue
        const u: PlanPoint = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
        const y = (p: PlanPoint) => base + flight.rise * (station + (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]) / total + clearance
        const append = (p: PlanPoint, q: PlanPoint) => {
          for (const [from, to] of clipSegmentToPolygon(p, q, space.polygon, voids)) result.push([[from[0], y(from), from[1]], [to[0], y(to), to[1]]])
        }
        append(a, b)
        if (i === segments.length - 1) {
          const size = Math.min(0.2, flight.width / 4, length / 4)
          append(b, [b[0] - u[0] * size - u[1] * size, b[1] - u[1] * size + u[0] * size])
          append(b, [b[0] - u[0] * size + u[1] * size, b[1] - u[1] * size - u[0] * size])
        }
        station += length
      }
      base += flight.rise
    }
    return result
  }, [space, voids, connected, baseElevation])
  const lines = useMemo(() => {
    const edges = space.polygon.map((p, i) => [p, space.polygon[(i + 1) % space.polygon.length]] as [PlanPoint, PlanPoint])
    const longest = [...edges].sort(([a, b], [c, d]) => Math.hypot(d[0] - c[0], d[1] - c[1]) - Math.hypot(b[0] - a[0], b[1] - a[1]))[0]
    const raw = space.stair?.direction ?? [longest[1][0] - longest[0][0], longest[1][1] - longest[0][1]]
    const length = Math.hypot(raw[0], raw[1]) || 1
    const u: PlanPoint = [raw[0] / length, raw[1] / length], v: PlanPoint = [-u[1], u[0]]
    const along = space.polygon.map(p => p[0] * u[0] + p[1] * u[1]), across = space.polygon.map(p => p[0] * v[0] + p[1] * v[1])
    const lo = Math.min(...along), hi = Math.max(...along), left = Math.min(...across), right = Math.max(...across)
    const at = (a: number, b: number): PlanPoint => [u[0] * a + v[0] * b, u[1] * a + v[1] * b]
    const steps = Math.max(2, Math.min(60, Math.round(space.stair?.steps ?? (hi - lo) / 0.28)))
    const treads = Array.from({ length: steps - 1 }, (_, i) => {
      const d = lo + (hi - lo) * (i + 1) / steps
      return clipSegmentToPolygon(at(d, left), at(d, right), space.polygon, voids)
    }).flat()
    const from = at(lo + (hi - lo) * 0.2, (left + right) / 2), to = at(lo + (hi - lo) * 0.8, (left + right) / 2)
    const arrowSize = Math.min(0.25, (right - left) / 4, (hi - lo) / 8)
    const arrow = straight && !hasFlights ? [
      [from, to],
      [to, [to[0] - u[0] * arrowSize + v[0] * arrowSize, to[1] - u[1] * arrowSize + v[1] * arrowSize]],
      [to, [to[0] - u[0] * arrowSize - v[0] * arrowSize, to[1] - u[1] * arrowSize - v[1] * arrowSize]],
    ] as [PlanPoint, PlanPoint][] : []
    const rise = levelHeight / Math.max(2, Math.min(60, Math.round(space.stair?.steps ?? levelHeight / 0.18)))
    const elevation = (p: PlanPoint) => space.stair?.direction ? baseElevation + levelHeight * (p[0] * u[0] + p[1] * u[1] - lo) / (hi - lo) + rise + 0.03 : 0.025
    return { treads, elevation, arrow: arrow.flatMap(([a, b]) => clipSegmentToPolygon(a, b, space.polygon, voids)) }
  }, [space, voids, levelHeight, hasFlights, straight, baseElevation])
  return <group>
    {solids.map((solid, i) => <PolygonSolid key={`s${i}`} polygon={solid.polygon} bottom={solid.bottom} height={solid.height} color={SHELL.floor} />)}
    {!straight && !hasFlights && lines.treads.map(([a, b], i) => <Line key={`t${i}`} points={[[a[0], 0.012, a[1]], [b[0], 0.012, b[1]]]} color={PALETTE.ink} lineWidth={1} />)}
    {flightArrows.map((points, i) => <Line key={`f${i}`} points={points} color={PALETTE.terra} lineWidth={2} />)}
    {lines.arrow.map(([a, b], i) => <Line key={`a${i}`} points={[[a[0], lines.elevation(a), a[1]], [b[0], lines.elevation(b), b[1]]]} color={PALETTE.terra} lineWidth={2} />)}
  </group>
}

/** One architectural level, displayed at y=0; elevation remains plan metadata. */
export default function ArchitecturalHome({ plan, levelId }: { plan: ArchitecturalPlan; levelId: string }) {
  const [topSection, setTopSection] = useState(false)
  const lastTopSection = useRef(false)
  const viewDirection = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    camera.getWorldDirection(viewDirection)
    const next = viewDirection.y < 0 && Math.hypot(viewDirection.x, viewDirection.z) / -viewDirection.y < 0.02
    if (next !== lastTopSection.current) {
      lastTopSection.current = next
      setTopSection(next)
    }
  })
  const cutHeight = topSection ? 1.2 : Infinity
  const cutaway = useStore(s => s.cutawayWalls)
  const floorSlab = useStore(s => s.floorSlab)
  const windows = useStore(s => s.windows)
  const doorLeaves = useStore(s => s.doorLeaves)
  const levelHeight = plan.levels.find(level => level.id === levelId)?.height ?? 3
  const spaces = useMemo(() => plan.spaces.filter(space => space.levelId === levelId), [plan.spaces, levelId])
  const walls = useMemo(() => plan.walls.filter(wall => wall.levelId === levelId && wallLength(wall) > 1e-7 && wall.thickness > 0 && wall.height > 0), [plan.walls, levelId])
  const voids = useMemo(() => spaces.filter(space => space.kind === 'void').map(space => space.polygon), [spaces])
  const floors = useMemo(() => architecturalFloorPieces(spaces, walls), [spaces, walls])
  const ledges = useMemo(() => spaces.filter(space => space.kind === 'ledge').map(space =>
    ({ id: space.id, pieces: floorPieces(space.polygon, voids), height: space.surfaceHeight ?? 0 })), [spaces, voids])
  const openings = useMemo(() => new Map(walls.map(wall => [wall.id, plan.openings.filter(opening => opening.wallId === wall.id)])), [walls, plan.openings])
  return <group name={`architecture:${levelId}`}>
    <Floor pieces={floors} thickness={floorSlab ? 0.15 : 0.02} />
    {ledges.map(ledge => {
      const height = Math.min(ledge.height, cutHeight)
      return height > 0 && <group key={ledge.id} position-y={height}><Floor pieces={ledge.pieces} thickness={height} /></group>
    })}
    {walls.map(wall => <Wall key={wall.id} wall={wall} neighbors={walls} openings={openings.get(wall.id)!} spaces={spaces} cutaway={cutaway} windows={windows} doorLeaves={doorLeaves} cutHeight={cutHeight} />)}
    {spaces.filter(space => space.kind === 'stair').map(space => <Stair key={space.id} space={space} voids={voids} levelHeight={levelHeight} />)}
  </group>
}

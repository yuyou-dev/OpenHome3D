import type { ArchitecturalPlan, PlanPoint, RecognizedFurniture } from '../state/architecture'
import type { HomeDef, RoomDef } from '../state/home'
import { allModels, defaultParams, footprintOf, getModel, type FurnitureInstance, type ModelDef } from '../models/registry'
import { clamp } from '../lib/geom'
import { generateLayout } from './layout'
import { footprintPolygon, polygonContainsFootprint, wallFootprint, wallLength } from './architectureGeometry'
import { architectureToHome } from './importArchitecture'

const allowsFurniture = (kind: ArchitecturalPlan['spaces'][number]['kind']) => kind === 'room' || kind === 'balcony'

/** Structure comes from the plan, while a room's generation counter remains editable scene state. */
export function canonicalArchitecturalHome(home: HomeDef): HomeDef {
  const canonical = architectureToHome(home.architecture!)
  return { ...canonical, rooms: canonical.rooms.map(room => {
    const salt = (Array.isArray(home.rooms) ? home.rooms : []).find(previous => previous.id === room.id)?.salt
    return typeof salt === 'number' && Number.isInteger(salt) && salt >= 0 ? { ...room, salt } : room
  }) }
}

/** Floor obstacles also include the circulation on both sides of non-window openings. */
export function architecturalObstacles(plan: ArchitecturalPlan, levelId: string): PlanPoint[][] {
  const walls = plan.walls.filter(wall => wall.levelId === levelId)
  const obstacles = walls.map(wall => wallFootprint(wall, walls))
  for (const opening of plan.openings) {
    if (opening.kind === 'window') continue
    const wall = walls.find(w => w.id === opening.wallId)
    if (!wall) continue
    const length = wallLength(wall), dx = (wall.end[0] - wall.start[0]) / length, dz = (wall.end[1] - wall.start[1]) / length
    const center: PlanPoint = [wall.start[0] + dx * opening.offset, wall.start[1] + dz * opening.offset]
    const clearance = opening.operation === 'hinged' ? opening.width : 0.6
    obstacles.push(footprintPolygon(center, opening.width + 0.1, wall.thickness + 2 * clearance, -Math.atan2(dz, dx)))
  }
  return [...obstacles, ...plan.spaces.filter(space => space.levelId === levelId && !allowsFurniture(space.kind)).map(space => space.polygon)]
}

/** Furniture positions stay room-local; geometry checks use the plan's metric coordinates. */
export function architecturalFurnitureFits(home: HomeDef, item: FurnitureInstance, def = getModel(item.modelId)): boolean {
  const plan = home.architecture
  if (!plan) return true
  const space = plan.spaces.find(s => s.id === item.roomId)
  const room = home.rooms.find(r => r.id === item.roomId)
  if (!def || !room || !space || !allowsFurniture(space.kind)) return false
  const [width, depth] = footprintOf(def, item.params, item.scale)
  return polygonContainsFootprint(space.polygon, [room.rect.x + item.position[0], room.rect.z + item.position[1]], width, depth, item.rotationY, architecturalObstacles(plan, space.levelId))
}

/** Preserve original dimensional evidence: only scale a matched library model uniformly. */
const SEMANTICS: Record<string, RegExp> = {
  bed: /\bbed\b|bed-(single|double)|bedroom-bed/,
  sofa: /sofa|couch/, chair: /chair|armchair|stool/,
  table: /table/, desk: /desk/, wardrobe: /wardrobe|closet/,
  cabinet: /cabinet|cupboard|dresser|shelf|bookcase/,
  counter: /counter|kitchen.*cabinet/, sink: /sink|basin/,
  toilet: /toilet/, shower: /shower/, bathtub: /bathtub|bath-tub/,
  plant: /plant|potted/, appliance: /fridge|refrigerator|oven|stove|washer|washing|dishwasher/,
}

const APPLIANCES: [RegExp, RegExp][] = [
  [/洗碗|dishwasher/i, /dishwasher/],
  [/洗衣|洗烘|washer|washing|laundry/i, /\bwasher\b|washing/],
  [/冰箱|冷藏|fridge|refrigerator/i, /fridge|refrigerator/],
  [/灶|炉头|stove|cooktop|hob/i, /stove|cooktop|hob/],
  [/烤箱|oven/i, /oven/],
  [/电视|television|\btv\b/i, /television|\btv\b/],
]

/** Semantics constrain the candidate pool before dimensions rank it. A washer is never a stove. */
function matchesSource(def: ModelDef, source: RecognizedFurniture, room: RoomDef): boolean {
  const name = `${def.id.replace(/[:_]/g, ' ')} ${def.name}`.toLowerCase()
  const label = source.label || ''
  if (source.type === 'appliance') {
    const subtype = APPLIANCES.find(([pattern]) => pattern.test(label))
    return !!subtype && subtype[1].test(name) && def.type !== 'STORAGE'
  }
  if (source.type === 'bed' && /cabinet|drawer|nightstand|bedside|desk|table|柜|桌/.test(name)) return false
  if (source.type === 'sink' || source.type === 'counter' && /水槽|洗手|面盆|sink|basin/i.test(label)) {
    const bathroom = /洗手|洗脸|面盆|washbasin|bathroom|vanity/i.test(label) || !/厨房|水槽|kitchen/i.test(label) && room.type === 'bathroom'
    return SEMANTICS.sink.test(name) && def.type === (bathroom ? 'BATHROOM' : 'KITCHEN')
  }
  if (source.type === 'counter' && /sink|basin|stove|oven|fridge|refrigerator|dishwasher|washer/.test(name)) return false
  if (source.type === 'counter' && room.type === 'bathroom') return /bathroom.*cabinet|vanity/.test(name)
  if (source.type === 'cabinet' && /电视|tv|television/i.test(label)) return /cabinet.*television|tv-bench|tv stand/.test(name) && def.type === 'STORAGE'
  if (source.type === 'cabinet' && /床头|bedside|nightstand/i.test(label)) return /cabinet-bed|bedside|nightstand|side-table/.test(name)
  const categories: Record<string, string[]> = {
    bed: ['BEDS'], sofa: ['SEATING'], chair: ['SEATING'], table: ['TABLES'], desk: ['TABLES'],
    wardrobe: ['STORAGE'], cabinet: ['STORAGE'], counter: ['KITCHEN', 'STORAGE'],
    toilet: ['BATHROOM'], shower: ['BATHROOM'], bathtub: ['BATHROOM'], plant: ['DECOR'],
  }
  if (!categories[source.type]?.includes(def.type) || !SEMANTICS[source.type]?.test(name)) return false
  if (source.type === 'table') {
    if (/茶几|coffee/i.test(label)) return /coffee|table-low/.test(name)
    if (/餐桌|dining/i.test(label)) return !/coffee|side|low|desk|sink|counter|bed/.test(name)
    if (/圆桌|round/i.test(label)) return /round/.test(name)
  }
  return true
}

// A 1 cm grid captures small diagonal corrections while enforcing a 20 cm radial limit.
const BED_OFFSETS: PlanPoint[] = Array.from({ length: 41 * 41 }, (_, i) => [(i % 41 - 20) / 100, (Math.floor(i / 41) - 20) / 100] as PlanPoint)
  .filter(([x, z]) => x * x + z * z > 0 && x * x + z * z <= 0.04 + 1e-12)
  .sort((a, b) => Math.hypot(...a) - Math.hypot(...b))

function matchFurniture(source: RecognizedFurniture, room: RoomDef, home: HomeDef, warnings: string[]): FurnitureInstance | undefined {
  const matches = allModels().filter(def => def.kind !== 'upload' && matchesSource(def, source, room))
    .map(def => {
      const params = defaultParams(def)
      for (const spec of def.params ?? []) {
        const target = spec.key === 'Width' ? source.width : spec.key === 'Depth' ? source.depth : undefined
        if (target !== undefined && spec.kind === 'number') params[spec.key] = clamp(target, spec.min ?? target, spec.max ?? target)
      }
      const [w, d] = footprintOf(def, params)
      const scale = clamp(Math.sqrt(source.width * source.depth / (w * d)), 0.1, 2)
      const score = Math.abs(Math.log(w * scale / source.width)) + Math.abs(Math.log(d * scale / source.depth))
      const instance: FurnitureInstance = {
        id: `${room.id}:recognized:${source.id}`, roomId: room.id, modelId: def.id,
        label: source.label || def.name, position: [source.center[0] - room.rect.x, source.center[1] - room.rect.z],
        rotationY: source.rotation, params, scale, source: 'manual', locked: true,
      }
      return { instance, score, def }
    }).sort((a, b) => a.score - b.score || a.def.id.localeCompare(b.def.id))
  const exact = matches.find(match => architecturalFurnitureFits(home, match.instance))
  if (exact) return exact.instance
  if (source.type !== 'bed') return undefined
  const plan = home.architecture!, space = plan.spaces.find(s => s.id === room.id)!
  const obstacles = architecturalObstacles(plan, space.levelId)
  for (const { instance, def } of matches) {
    const [width, depth] = footprintOf(def, instance.params, instance.scale)
    const offset = BED_OFFSETS.find(([dx, dz]) => polygonContainsFootprint(space.polygon, [source.center[0] + dx, source.center[1] + dz], width, depth, instance.rotationY, obstacles))
    if (offset) {
      warnings.push(`${source.label || '床'} (${room.name})：匹配床为避墙/门微移 ${(Math.hypot(...offset) * 100).toFixed(1)} cm（东 ${Math.round(offset[0] * 100)} cm，南 ${Math.round(offset[1] * 100)} cm）/ Bed shifted within 20 cm; original trace retained`)
      return { ...instance, position: [instance.position[0] + offset[0], instance.position[1] + offset[1]] }
    }
  }
  return undefined
}

/** Existing rectangular rules supply candidates only; the polygon is the final placement authority. */
export function generateArchitecturalRoom(home: HomeDef, room: RoomDef, seed: string, extras: number, preserved: FurnitureInstance[] = [], decorOnly = false): FurnitureInstance[] {
  const space = home.architecture?.spaces.find(s => s.id === room.id)
  if (!space || !allowsFurniture(space.kind)) return []
  const candidates = generateLayout({ roomType: room.type, seed: `${seed}@${room.id}`, salt: room.salt,
    width: room.rect.w, depth: room.rect.d, extras, models: allModels(), preserved, decorOnly })
  const ids = new Set(preserved.map(item => item.id))
  return candidates.flatMap(item => {
    let id = `${room.id}:${item.id}`
    while (ids.has(id)) id += ':auto'
    ids.add(id)
    const instance = { ...item, roomId: room.id, id }
    return architecturalFurnitureFits(home, instance) ? [instance] : []
  })
}

export function importArchitecturalFurniture(home: HomeDef, seed: string, extras: number): { furniture: FurnitureInstance[]; warnings: string[] } {
  const plan = home.architecture!
  const warnings = [...plan.warnings]
  const furniture = home.rooms.flatMap(room => {
    const space = plan.spaces.find(s => s.id === room.id)!
    if (!allowsFurniture(space.kind)) return []
    const recognized = plan.furniture.filter(item => item.spaceId === room.id)
    const matched = recognized.flatMap(item => {
      const instance = matchFurniture(item, room, home, warnings)
      if (!instance) warnings.push(item.type === 'bed' ? `未能安全放置识别床 ${item.label || '床'} (${room.name}) / Recognized bed missing` : `未能安全匹配家具 ${item.label || item.type} (${room.name}) / Furniture not matched`)
      return instance ? [instance] : []
    })
    if (matched.length) return matched
    const generated = generateArchitecturalRoom(home, room, seed, extras)
    warnings.push(`${room.name} 未匹配到识别家具，已生成 ${generated.length} 件可用摆放 / Generated fallback furniture`)
    return generated
  })
  return { furniture, warnings }
}

/** Returns an actual usable position when the polygon's bounding-box center falls outside it. */
export function findArchitecturalPosition(home: HomeDef, item: FurnitureInstance): PlanPoint | null {
  if (architecturalFurnitureFits(home, item)) return item.position
  const room = home.rooms.find(r => r.id === item.roomId)
  if (!room) return null
  // Bounded search for Add only; dragging and shape edits reject an illegal pose instead.
  for (let z = -room.rect.d / 2; z <= room.rect.d / 2; z += Math.max(0.1, room.rect.d / 24)) {
    for (let x = -room.rect.w / 2; x <= room.rect.w / 2; x += Math.max(0.1, room.rect.w / 24)) {
      const position: PlanPoint = [x, z]
      if (architecturalFurnitureFits(home, { ...item, position })) return position
    }
  }
  return null
}

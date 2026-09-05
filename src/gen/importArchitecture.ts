import type { ArchitecturalPlan, PlanPoint } from '../state/architecture'
import type { HomeDef, RoomDef } from '../state/home'
import { isSimplePolygon, polygonArea, validateArchitecturalOpening } from './architectureGeometry'

const finite = (n: number) => typeof n === 'number' && Number.isFinite(n)
const point = (p: PlanPoint) => Array.isArray(p) && p.length === 2 && p.every(finite)
const requireValue = (ok: unknown, message: string): void => { if (!ok) throw new Error(message) }

/** Validate the persisted metric contract, including references and hosted apertures. No geometry repair. */
export function validateArchitecture(plan: ArchitecturalPlan): void {
  requireValue(plan?.version === 1, 'Unsupported architectural plan version')
  for (const key of ['levels','spaces','walls','openings','furniture','dimensions','warnings'] as const) requireValue(Array.isArray(plan[key]), `Missing ${key}`)
  const identities = (items: {id:string}[]) => {
    const ids = new Set<string>()
    for (const item of items) { requireValue(typeof item.id === 'string' && item.id && !ids.has(item.id), `Duplicate/missing ID: ${item.id}`); ids.add(item.id) }
    return ids
  }
  const levels = identities(plan.levels), spaces = identities(plan.spaces), walls = identities(plan.walls)
  identities(plan.openings); identities(plan.furniture)
  requireValue(levels.size && spaces.size, 'No levels/spaces')
  for (const l of plan.levels) requireValue(finite(l.elevation) && finite(l.height) && l.height > 0, `Invalid level ${l.id}`)
  for (const r of plan.spaces) requireValue(levels.has(r.levelId) && ['room','balcony','void','stair','ledge'].includes(r.kind) && Array.isArray(r.polygon) && r.polygon.every(point) && isSimplePolygon(r.polygon) && polygonArea(r.polygon) > .01, `Invalid space polygon ${r.id}`)
  for (const s of plan.spaces) if(s.surfaceHeight !== undefined) requireValue(finite(s.surfaceHeight) && s.surfaceHeight > 0, `Invalid platform height ${s.id}`)
  for (const s of plan.spaces) if(s.stair) {
    requireValue(s.stair.connection === undefined || ['up','down','unknown'].includes(s.stair.connection), `Invalid stair connection ${s.id}`)
    requireValue((s.stair.direction===undefined || point(s.stair.direction) && Math.hypot(...s.stair.direction)>0) && (s.stair.steps===undefined || Number.isInteger(s.stair.steps)&&s.stair.steps>0), `Invalid stair ${s.id}`)
    for(const f of s.stair.flights??[]) requireValue(typeof f.id==='string' && Array.isArray(f.path) && f.path.length>=2 && f.path.every(point) && finite(f.width) && f.width>0 && finite(f.rise) && f.rise>=0 && (f.steps===undefined || Number.isInteger(f.steps)&&(f.steps>0||f.rise===0&&f.steps===0)), `Invalid stair flight ${s.id}`)
  }
  for (const w of plan.walls) requireValue(levels.has(w.levelId) && point(w.start) && point(w.end) && Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1]) > .01 && finite(w.thickness) && w.thickness > 0 && w.thickness <= 1 && finite(w.height) && w.height > 0 && ['exterior','interior','railing'].includes(w.kind), `Invalid wall ${w.id}`)
  for (const o of plan.openings) {
    requireValue(walls.has(o.wallId) && ['door','window','open'].includes(o.kind) && ['hinged','sliding','fixed','open'].includes(o.operation) && ['start','end'].includes(o.hinge) && [-1,1].includes(o.swing), `Invalid opening ${o.id}`)
    const wall = plan.walls.find(w => w.id === o.wallId)!
    const error = validateArchitecturalOpening(wall,o,plan.openings.filter(other=>other.id!==o.id && other.wallId===o.wallId))
    requireValue(!error, `${o.id}: ${error}`)
  }
  for (const f of plan.furniture) requireValue(spaces.has(f.spaceId) && point(f.center) && [f.width,f.depth,f.rotation,f.confidence].every(finite) && f.width>0 && f.depth>0, `Invalid furniture ${f.id}`)
  requireValue(plan.source && [plan.source.width,plan.source.height,plan.source.scale].every(n=>finite(n)&&n>0) && Array.isArray(plan.source.bounds) && plan.source.bounds.length===4 && plan.source.bounds.every(finite), 'Invalid source calibration')
  requireValue(plan.warnings.every(w=>typeof w==='string'), 'Invalid warnings')
  for (const d of plan.dimensions) requireValue(typeof d.label==='string' && ['x','z'].includes(d.axis) && [d.from,d.to,d.meters].every(finite) && d.meters>0 && ['used','conflict','estimated'].includes(d.status),'Invalid dimension')
}

/** Compatibility room records carry bounding boxes for selection/furniture only, never generate walls. */
export function architectureToHome(plan: ArchitecturalPlan): HomeDef {
  validateArchitecture(plan)
  const rooms: RoomDef[] = plan.spaces.map(space => {
    const xs=space.polygon.map(p=>p[0]), zs=space.polygon.map(p=>p[1])
    const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs)
    const type=['living','dining','bedroom','kitchen','bathroom','balcony','office'].includes(space.type)?space.type:'office'
    return { id:space.id,name:space.name,type,rect:{x:(minX+maxX)/2,z:(minZ+maxZ)/2,w:maxX-minX,d:maxZ-minZ},salt:0,partitionHeight:0 }
  })
  return { rooms, openings:[], architecture:plan }
}

/** Pixel wire v2 -> metric architecture v1. Pixel evidence is preserved by one uniform scale. */
export function importArchitecturalPlan(raw: unknown): HomeDef {
  const data=raw as Omit<ArchitecturalPlan,'version'|'spaces'> & {version:2;spaces:(ArchitecturalPlan['spaces'][number]&{stairConnection?:'up'|'down'|'unknown';stairDirection:PlanPoint|null;stairFlights?:{id:string;path:PlanPoint[];width:number;rise:number;steps:number}[]})[]}
  requireValue(data?.version===2 && data.source && finite(data.source.scale) && data.source.scale>0 && data.source.scale<1,'Invalid recognition calibration')
  const scale=data.source.scale
  const p=(v:PlanPoint):PlanPoint=>[v[0]*scale,v[1]*scale]
  const plan:ArchitecturalPlan={
    version:1,source:{...data.source},levels:data.levels.map(l=>({...l})),
    spaces:data.spaces.map(s=>({id:s.id,name:s.name,type:s.type,levelId:s.levelId,kind:s.kind,polygon:s.polygon.map(p),...(s.kind==='stair'?{stair:{connection:s.stairConnection??'up',...(s.stairDirection?{direction:s.stairDirection}:{}),...(s.stairFlights?.length?{flights:s.stairFlights.map(f=>({...f,path:f.path.map(p),width:f.width*scale}))}:{})}}:{})})),
    walls:data.walls.map(w=>({...w,start:p(w.start),end:p(w.end),thickness:w.thickness*scale})),
    openings:data.openings.map(o=>({...o,offset:o.offset*scale,width:o.width*scale})),
    furniture:data.furniture.map(f=>({...f,center:p(f.center),width:f.width*scale,depth:f.depth*scale})),
    dimensions:data.dimensions.map(d=>({...d,from:d.from*scale,to:d.to*scale})),warnings:[...data.warnings],
  }
  // Pixel endpoints can differ by one or two raster pixels at a host junction.
  // Clip only that bounded uncertainty, report it, and reject larger mismatches below.
  for (const o of plan.openings) {
    const wall=plan.walls.find(w=>w.id===o.wallId)
    if(!wall) continue
    if(wall.kind==='railing' && o.kind==='open' && o.sill<wall.height && o.sill+o.height>wall.height) {
      o.height=wall.height-o.sill
      plan.warnings.push(`${o.id}：栏杆缺口高度按栏杆顶收口 / Railing passage clipped to parapet height`)
    }
    const length=Math.hypot(wall.end[0]-wall.start[0],wall.end[1]-wall.start[1])
    const lo=o.offset-o.width/2, hi=o.offset+o.width/2
    if((lo<0||hi>length) && lo>=-2*scale-1e-9 && hi<=length+2*scale+1e-9) {
      const from=Math.max(0,lo),to=Math.min(length,hi)
      o.offset=(from+to)/2; o.width=to-from
      plan.warnings.push(`${o.id}：门窗端点按宿主墙裁去不超过 2 像素 / Raster endpoint clipped within 2 px`)
    }
  }
  // A labeled bay sill is not usable room floor and must never receive random furniture.
  for (const space of plan.spaces) if (space.kind === 'ledge' || space.type === 'other' && /飘窗|窗台|设备平台|bay[ -]?window|window[ -]?ledge/i.test(space.name)) {
    space.kind = 'ledge'
    const nearby = plan.openings.filter(o => o.kind === 'window' && o.sill > 0).map(o => {
      const wall = plan.walls.find(w => w.id === o.wallId)!
      const length = Math.hypot(wall.end[0]-wall.start[0],wall.end[1]-wall.start[1])
      const center: PlanPoint = [wall.start[0]+(wall.end[0]-wall.start[0])*o.offset/length,wall.start[1]+(wall.end[1]-wall.start[1])*o.offset/length]
      return { sill:o.sill, distance:Math.min(...space.polygon.map(v=>Math.hypot(v[0]-center[0],v[1]-center[1]))) }
    }).sort((a,b)=>a.distance-b.distance)
    space.surfaceHeight = nearby[0]?.distance < 1 ? nearby[0].sill : 0.6
    plan.warnings.push(`${space.name}：窗台高 ${space.surfaceHeight.toFixed(2)} m 为推定，需实测校准 / Estimated raised sill height`)
  }
  for (const space of plan.spaces.filter(s=>s.kind==='stair')) {
    if (data.spaces.find(s=>s.id===space.id)?.stairConnection === undefined) plan.warnings.push(`${space.name}：旧识别缺少楼层连接，沿用从本层上行示意，需核对 / Legacy stair connection is schematic`)
    plan.warnings.push(space.stair?.connection==='unknown' ? `${space.name}：楼层连接未知，仅显示平面示意 / Stair connection unknown` : space.stair?.flights?.length ? `${space.name}：${space.stair.connection==='down'?'下接楼梯顶部对齐本层':'上行楼梯起点对齐本层'}；梯段升高为估算 / Verify stair rise and level alignment` : space.stair?.direction ? `${space.name}：踏步为单跑示意，转角梯段及上下层连接待核对 / Stair flight schematic; verify connections` : `${space.name}：上行方向无法确认，仅显示平面示意 / Stair direction unknown`)
  }
  // Expose scale disagreements numerically; do not distort the traced floor plan to hide them.
  for (const d of plan.dimensions) {
    const traced=Math.abs(d.to-d.from)
    if (Math.abs(traced-d.meters)/d.meters>.05) {
      d.status='conflict'
      plan.warnings.push(`尺寸 ${d.label}: 标注 ${d.meters.toFixed(2)} m，按统一比例 ${traced.toFixed(2)} m / dimension conflict`)
    }
  }
  return architectureToHome(plan)
}

const distance=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y)}
const lerp=(a,b,t)=>[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]
// Strict interior intersection: path endpoints may lie near a doorway boundary.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
const segmentsCross=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-1e-12 && cross(c,d,a)*cross(c,d,b)<-1e-12
export function measurePrecision(raw,gt,expected,{physicalOutline,circulation,uncertainOutline=[]}={}) {
  const item={id:gt.sample,bedrooms:raw.spaces?.filter(s=>s.type==='bedroom').length,bathrooms:raw.spaces?.filter(s=>s.type==='bathroom').length,expected:expected,failures:[]}
  const norm=([x,y])=>[x/gt.imageSize[0],y/gt.imageSize[1]]
  const walls=raw.walls.map(w=>({a:norm(w.start),b:norm(w.end)}))
  const outline=physicalOutline??gt.outline
  item.outline=outline.map((a,j)=>({edge:j,error:Math.max(...[.1,.3,.5,.7,.9].map(t=>Math.min(...walls.map(v=>distance(lerp(a,outline[(j+1)%outline.length],t),v.a,v.b)))))}))
  item.uncertainOutline=uncertainOutline
  item.outline=item.outline.filter(w=>!uncertainOutline.some(e=>JSON.stringify(e.a)===JSON.stringify(outline[w.edge])&&JSON.stringify(e.b)===JSON.stringify(outline[(w.edge+1)%outline.length])))
  item.maxOutlineError=Math.max(...item.outline.map(w=>w.error))
  item.walls=gt.walls.map(w=>({label:w.label,error:Math.max(...[.1,.3,.5,.7,.9].map(t=>Math.min(...walls.map(v=>distance(lerp(w.a,w.b,t),v.a,v.b)))))}))
  const openings=raw.openings.map(o=>{const w=raw.walls.find(w=>w.id===o.wallId);if(!w)return null;const l=Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1]);return{a:norm(lerp(w.start,w.end,(o.offset-o.width/2)/l)),b:norm(lerp(w.start,w.end,(o.offset+o.width/2)/l)),id:o.id,kind:o.kind}}).filter(Boolean)
  item.openings=gt.openings.filter(o=>!o.label.includes('敞口')&&!o.excludeFromDefiniteOpeningDistance).map(o=>{const candidates=openings.filter(v=>o.label.includes('门')?v.kind==='door':o.label.includes('窗')?v.kind==='window':true);const ranked=candidates.map(v=>({id:v.id,centerError:Math.hypot(...lerp(o.a,o.b,.5).map((n,k)=>n-lerp(v.a,v.b,.5)[k])),endpointError:Math.min(Math.max(Math.hypot(o.a[0]-v.a[0],o.a[1]-v.a[1]),Math.hypot(o.b[0]-v.b[0],o.b[1]-v.b[1])),Math.max(Math.hypot(o.a[0]-v.b[0],o.a[1]-v.b[1]),Math.hypot(o.b[0]-v.a[0],o.b[1]-v.a[1])))})).sort((a,b)=>a.centerError-b.centerError);return{label:o.label,...(ranked[0]??{id:null,centerError:Infinity,endpointError:Infinity})}})
  item.maxWallError=Math.max(...item.walls.map(w=>w.error));item.maxOpeningCenterError=Math.max(...item.openings.map(w=>w.centerError));item.maxOpeningEndpointError=Math.max(...item.openings.map(w=>w.endpointError))
  if(item.bedrooms!==expected[0]||item.bathrooms!==expected[1])item.failures.push('bedroom/bathroom counts')
  if(item.maxOutlineError>.01)item.failures.push('exterior outline > 0.01 normalized distance')
  if(item.maxWallError>.01)item.failures.push('wall trace > 0.01 normalized distance')
  if(item.maxOpeningCenterError>.01)item.failures.push('opening center > 0.01 normalized distance')
  if(item.maxOpeningEndpointError>.015)item.failures.push('opening endpoint > 0.015 normalized distance')
  if(gt.void&&!raw.spaces.some(s=>s.kind==='void'))item.failures.push('missing void')
  if(gt.stairs&&raw.spaces.filter(s=>s.kind==='stair').length<gt.stairs.length)item.failures.push('missing staircase region')
  item.stairs=(gt.stairs??[]).map(stair=>{
    const bounds=stair.bounds.flat()
    const candidates=raw.spaces.filter(s=>s.kind==='stair').map(space=>{
      const points=space.polygon.map(norm),xs=points.map(p=>p[0]),ys=points.map(p=>p[1])
      const actual=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]
      return {id:space.id,boundsError:Math.max(...actual.map((v,k)=>Math.abs(v-bounds[k]))),connection:space.stairConnection??'legacy-up'}
    }).sort((a,b)=>a.boundsError-b.boundsError)
    return {label:stair.label,...(candidates[0]??{id:null,boundsError:Infinity,connection:null})}
  })
  if(item.stairs.some(s=>s.boundsError>.035))item.failures.push('stair region bounds > 0.035 normalized distance')
  if(item.stairs.some(s=>s.label.endsWith('-下')&&s.connection!=='down'))item.failures.push('down stair must connect below this floor')
  if(gt.void) {
    const edges=raw.spaces.filter(s=>s.kind==='void').flatMap(s=>s.polygon.map((p,i)=>[norm(p),norm(s.polygon[(i+1)%s.polygon.length])]))
    item.voidOutlineError=Math.max(...gt.void.flatMap((a,i)=>[.1,.3,.5,.7,.9].map(t=>Math.min(...edges.map(([c,d])=>distance(lerp(a,gt.void[(i+1)%gt.void.length],t),c,d))))))
    if(item.voidOutlineError>.01)item.failures.push('void outline > 0.01 normalized distance')
  }
  item.blockedCirculation = []
  for (const path of circulation ?? []) for (let j=0;j<path.points.length-1;j++) {
    const a=path.points[j], b=path.points[j+1]
    for (const wall of walls) if (segmentsCross(a,b,wall.a,wall.b)) item.blockedCirculation.push({path:path.label,segment:j})
  }
  if(item.blockedCirculation.length)item.failures.push('invented wall crosses wall-free circulation')
  return item
}

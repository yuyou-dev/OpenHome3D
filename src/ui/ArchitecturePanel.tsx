import { calibrateArchitecture } from '../gen/calibrateArchitecture'
import { useState } from 'react'
import type { ArchitecturalPlan } from '../state/architecture'
import { useStore } from '../state/store'
import { useUI } from './uiStore'
import { polygonArea, wallLength } from '../gen/architectureGeometry'
import { GhostButton, PrimaryButton, NumberInput } from './components'
import PlanDialog from './PlanDialog'
import type { HomeDef } from '../state/home'
import { requestView } from '../three/runtime'

/** A trace of the same metric model used by 3D, registered to original source pixels. */
export function PlanTrace({ plan, image, opacity = .65 }: {plan:ArchitecturalPlan;image:string|null;opacity?:number}) {
  const scale=plan.source.scale
  const points=(p:[number,number][])=>p.map(([x,z])=>`${x/scale},${z/scale}`).join(' ')
  return <svg data-plan-trace viewBox={`0 0 ${plan.source.width} ${plan.source.height}`} style={{width:'100%',maxHeight:'72vh',background:'white'}}>
    {image && <image href={image} width={plan.source.width} height={plan.source.height} opacity={opacity}/>}
    {plan.spaces.map(s=><polygon key={s.id} points={points(s.polygon)} fill={s.kind==='void'?'var(--pink)':'var(--blue)'} fillOpacity={s.kind==='void'?.3:.10} stroke="var(--select)" strokeWidth="1.5" strokeDasharray={s.kind==='void'?'8 5':undefined}><title>{s.id}: {s.name} · {polygonArea(s.polygon).toFixed(2)} m²</title></polygon>)}
    {plan.walls.map(w=><line key={w.id} x1={w.start[0]/scale} y1={w.start[1]/scale} x2={w.end[0]/scale} y2={w.end[1]/scale} stroke="var(--select)" strokeWidth={Math.max(2,w.thickness/scale)} opacity=".65"><title>{w.id} · {w.thickness.toFixed(3)} m</title></line>)}
    {plan.openings.map(o=>{
      const w=plan.walls.find(w=>w.id===o.wallId)!,l=wallLength(w),dx=(w.end[0]-w.start[0])/l,dz=(w.end[1]-w.start[1])/l
      return <line key={o.id} x1={(w.start[0]+dx*(o.offset-o.width/2))/scale} y1={(w.start[1]+dz*(o.offset-o.width/2))/scale} x2={(w.start[0]+dx*(o.offset+o.width/2))/scale} y2={(w.start[1]+dz*(o.offset+o.width/2))/scale} stroke={o.kind==='window'?'var(--yellow)':'var(--pink)'} strokeWidth={Math.max(4,w.thickness/scale+2)}><title>{o.id} · {o.kind} · {o.width.toFixed(2)} m</title></line>
    })}
  </svg>
}

export function PlanReview({plan,home,image,onClose,onImport,summary,warnings=[],error}:{
  plan?:ArchitecturalPlan;home?:HomeDef;image:string|null;onClose:()=>void;onImport?:()=>void;summary?:string;warnings?:string[];error?:string|null
}) {
  const [opacity,setOpacity]=useState(.7)
  return <PlanDialog className="plan-dialog-review" title={onImport?'核对户型 · 2 / 3 Review plan':'原图与解析叠加 Trace review'} label="户型解析核对 Plan review" onDismiss={onClose}
    actions={<><GhostButton onClick={onClose}>{onImport?'放弃导入 Cancel':'关闭 Close'}</GhostButton>{onImport&&<PrimaryButton onClick={onImport}>导入 Import</PrimaryButton>}</>}>
    <div className="plan-review-controls">
      {error&&<p role="alert">{error}</p>}
      {summary&&<p>{summary}</p>}
      {onImport&&<p className="caption">核对后点击「导入」替换当前方案，导入后可撤销。Review, then import to replace the current plan. You can undo.</p>}
      {plan&&<><p className="caption">蓝色：空间与墙线 · 粉色：门洞 · 黄色：窗 · 虚线：挑空。解析与 3D 使用相同几何。Blue: geometry · Pink: doors · Yellow: windows · Dashed: void.</p>
      <label className="plan-review-opacity">原图透明度 Image opacity <input aria-label="原图透明度 Image opacity" type="range" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label></>}
      {warnings.length>0&&<details><summary>需要核对 {warnings.length} 项 Review notes</summary>{warnings.map((warning,index)=><p className="caption" key={index}>{warning}</p>)}</details>}
    </div>
    {plan?<PlanTrace plan={plan} image={image} opacity={opacity}/>:<div className="plan-legacy-review">
      {image&&<img className="plan-dialog-image" src={image} alt="户型原图 Original plan"/>}
      <div><p className="caption">此结果为简化布局，请核对空间与尺寸。Simplified layout: review rooms and dimensions.</p>{home?.rooms.map(room=><p key={room.id}>{room.name} · {room.rect.w.toFixed(1)} × {room.rect.d.toFixed(1)} m</p>)}</div>
    </div>}
  </PlanDialog>
}

export default function ArchitecturePanel() {
  const home=useStore(s=>s.home),active=useStore(s=>s.activeRoomId),image=useStore(s=>s.planImageUrl)
  const setArchitecture=useStore(s=>s.setArchitecture),selectRoom=useStore(s=>s.selectRoom)
  const pushToast=useUI(s=>s.pushToast)
  const [review,setReview]=useState(false),[wallId,setWallId]=useState(''),[openingId,setOpeningId]=useState(''),[dimensionIndex,setDimensionIndex]=useState(0)
  const plan=home.architecture!
  const levelId=plan.spaces.find(s=>s.id===active)?.levelId??plan.levels[0].id
  const dimension=plan.dimensions[dimensionIndex]??plan.dimensions[0]
  const wall=plan.walls.find(w=>w.id===wallId&&w.levelId===levelId)??plan.walls.find(w=>w.levelId===levelId)
  const visibleOpenings=plan.openings.filter(o=>plan.walls.some(w=>w.id===o.wallId&&w.levelId===levelId))
  const opening=visibleOpenings.find(o=>o.id===openingId)??visibleOpenings.find(o=>o.wallId===wall?.id)??visibleOpenings[0]
  const commit=(next:ArchitecturalPlan)=>{try{setArchitecture(next)}catch(e){pushToast(String(e instanceof Error?e.message:e))}}
  const editWall=(patch:Partial<NonNullable<typeof wall>>)=>wall&&commit({...plan,walls:plan.walls.map(w=>w.id===wall.id?{...w,...patch}:w)})
  const editOpening=(patch:Partial<NonNullable<typeof opening>>)=>opening&&commit({...plan,openings:plan.openings.map(o=>o.id===opening.id?{...o,...patch}:o)})
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='architectural-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return <div data-architecture-panel>
    <p className="caption">精确结构 Architectural model · 米 m · 顶视剖切 1.2 m<br/>轮廓、墙线和门窗位置来自原图；高度与尺寸不确定项见下方。Trace geometry; review inferred dimensions below.</p>
    <div className="btn-row"><GhostButton onClick={()=>setReview(true)}>核对原图 Review trace</GhostButton><GhostButton onClick={()=>requestView('top')}>顶视 Top</GhostButton><GhostButton onClick={download}>解析 JSON</GhostButton></div>
    {plan.levels.map(l=><GhostButton key={l.id} onClick={()=>{const space=plan.spaces.find(s=>s.levelId===l.id);if(space){selectRoom(space.id);requestAnimationFrame(()=>requestView('reset'))}setWallId('');setOpeningId('')}}>{l.name} · {l.elevation.toFixed(2)} m</GhostButton>)}
    <div className="lib-group"><strong>空间 Spaces</strong>{plan.spaces.filter(s=>s.levelId===levelId).map(s=><button className={`room-item${s.id===active?' active':''}`} key={s.id} onClick={()=>selectRoom(s.id)}><span>{s.name}</span><span className="caption">{s.kind==='void'?'挑空 Void':s.kind==='stair'?'楼梯 Stair':s.kind==='ledge'?'窗台 Ledge':`${polygonArea(s.polygon).toFixed(2)} m²`}</span></button>)}</div>
    <details><summary>尺寸与不确定项 Dimensions &amp; uncertainty ({plan.warnings.length})</summary>
      {plan.dimensions.map((d,i)=><p className="caption" key={i}>{d.label} · 标注 {d.meters.toFixed(2)} m / 场景 {Math.abs(d.to-d.from).toFixed(2)} m · {d.status==='conflict'?'冲突 Conflict':d.status==='estimated'?'估算 Estimated':'标注 Used'}</p>)}
      <p className="caption">识别与导入记录 Import notes（校准后的距离见上方 Current distances above）</p>
      {plan.warnings.map((w,i)=><p className="caption" key={i}>{w}</p>)}
    </details>
    <details><summary>比例校准 Calibrate scale</summary>
      <p className="caption">输入一个已核实距离以校准统一比例；不会拉伸或移动单个房间。Apply one uniform scale.</p>
      {dimension && <><select className="input" aria-label="校准标注 Calibration dimension" value={dimensionIndex} onChange={e=>setDimensionIndex(Number(e.target.value))}>{plan.dimensions.map((d,i)=><option key={i} value={i}>{d.label} · {d.axis==='x'?'横向 Width':'纵向 Depth'}</option>)}</select>
      <NumberInput label="核实距离 Verified" value={Math.abs(dimension.to-dimension.from)} min={.1} max={100} step={.001} unit="m" onCommit={length=>{
        const scale=plan.source.scale*length/Math.abs(dimension.to-dimension.from)
        commit(calibrateArchitecture(plan,scale))
      }}/></>}
      {!dimension && <p className="caption">无可读尺寸标注 No readable dimension anchor</p>}
    </details>
    <details><summary>墙体参数 Walls</summary><select className="input" aria-label="墙体 Wall" value={wall?.id??''} onChange={e=>{setWallId(e.target.value);setOpeningId('')}}>{plan.walls.filter(w=>w.levelId===levelId).map(w=><option key={w.id} value={w.id}>{w.id} · {w.kind} · {wallLength(w).toFixed(2)} m</option>)}</select>
      {wall&&<><NumberInput label="墙厚 Thickness" value={wall.thickness} min={.02} max={.6} step={.01} unit="m" onCommit={v=>editWall({thickness:v})}/><NumberInput label="墙高 Height" value={wall.height} min={.3} max={6} step={.05} unit="m" onCommit={v=>editWall({height:v})}/></>}
    </details>
    <details><summary>门窗参数 Hosted openings</summary><select className="input" aria-label="门窗 Opening" value={opening?.id??''} onChange={e=>setOpeningId(e.target.value)}>{visibleOpenings.map(o=><option key={o.id} value={o.id}>{o.id} · {o.kind} @ {o.wallId}</option>)}</select>
      {opening&&<><NumberInput label="沿墙中心 Offset" value={opening.offset} min={0} max={50} step={.01} unit="m" onCommit={v=>editOpening({offset:v})}/><NumberInput label="宽 Width" value={opening.width} min={.1} max={15} step={.01} unit="m" onCommit={v=>editOpening({width:v})}/><NumberInput label="底高 Sill" value={opening.sill} min={0} max={4} step={.01} unit="m" onCommit={v=>editOpening({sill:v})}/><NumberInput label="洞高 Height" value={opening.height} min={.1} max={5} step={.01} unit="m" onCommit={v=>editOpening({height:v})}/><div className="btn-row"><GhostButton onClick={()=>editOpening({hinge:opening.hinge==='start'?'end':'start'})}>换铰链 Hinge</GhostButton><GhostButton onClick={()=>editOpening({swing:opening.swing===1?-1:1})}>开向 Swing</GhostButton></div></>}
    </details>
    {review&&<PlanReview plan={plan} image={image} onClose={()=>setReview(false)}/>}
  </div>
}

import assert from 'node:assert/strict'
import { importArchitecturalPlan, architectureToHome, validateArchitecture } from '../src/gen/importArchitecture'
import { planJsonToHome } from '../src/gen/importPlan'
const fixture={version:2,source:{width:1200,height:900,bounds:[100,100,900,700],scale:.01,confidence:.9},levels:[{id:'L2',name:'二层',elevation:3,height:2.8}],spaces:[
 {id:'living',name:'客厅',type:'living',levelId:'L2',polygon:[[100,100],[600,100],[600,300],[300,300],[300,700],[100,700]],kind:'room',stairDirection:null},
 {id:'bed1',name:'次卧',type:'bedroom',levelId:'L2',polygon:[[600,100],[900,100],[900,400],[600,400]],kind:'room',stairDirection:null},
 {id:'bed2',name:'次卧',type:'bedroom',levelId:'L2',polygon:[[300,400],[900,400],[900,700],[300,700]],kind:'room',stairDirection:null},
 {id:'void',name:'客厅上空',type:'other',levelId:'L2',polygon:[[320,320],[580,320],[580,380],[320,380]],kind:'void',stairDirection:null},
],walls:[{id:'w1',levelId:'L2',start:[100,100],end:[900,100],thickness:20,height:2.8,kind:'exterior'}],openings:[{id:'o1',wallId:'w1',kind:'door',offset:70,width:80,sill:0,height:2.1,operation:'hinged',hinge:'end',swing:1}],furniture:[],dimensions:[{label:'8000',axis:'x',from:100,to:900,meters:8,status:'used'},{label:'9000',axis:'x',from:100,to:900,meters:9,status:'used'}],warnings:['高度推测']}
const home=importArchitecturalPlan(fixture)
assert.equal(home.rooms.length,4)
assert.equal(home.rooms.filter(r=>r.name==='次卧').length,2,'duplicate display names retain distinct IDs')
assert.equal(home.architecture!.spaces[0].polygon.length,6,'L shape is not boxed')
assert.ok(Math.abs(home.architecture!.openings[0].offset-.7)<1e-9,'off-centre doorway retains measured position')
assert.equal(home.architecture!.walls[0].thickness,.2)
assert.equal(home.architecture!.levels[0].elevation,3)
assert.equal(home.architecture!.dimensions[1].status,'conflict')
assert.deepEqual(home.architecture!.spaces[0].polygon[0],[1,1],'image coordinates retain registration')
assert.equal(home.openings.length,0,'legacy adjacency openings are not fabricated')
assert.deepEqual(architectureToHome(JSON.parse(JSON.stringify(home.architecture))),home,'metric JSON round trip is lossless')
assert.equal(planJsonToHome(fixture).report.doorsApplied,1)
assert.equal(planJsonToHome(fixture).report.warnings?.length,2)
const invalid=structuredClone(home.architecture!)
invalid.openings[0].offset=0
assert.throws(()=>validateArchitecture(invalid),/o1/,'reject out-of-wall door, never silently recenter')
const crossed=structuredClone(fixture);crossed.spaces[1].polygon=[[600,100],[900,400],[600,400],[900,100]]
assert.throws(()=>importArchitecturalPlan(crossed),/polygon/)
const duplicate=structuredClone(fixture);duplicate.spaces[1].id='living'
assert.throws(()=>importArchitecturalPlan(duplicate),/Duplicate/)
const narrow=structuredClone(fixture);narrow.spaces[1].polygon=[[600,100],[650,100],[650,400],[600,400]]
assert.equal(importArchitecturalPlan(narrow).rooms[1].rect.w,.5,'no former 1.5m minimum clamp')
const raster=structuredClone(fixture);raster.openings[0].offset=782;raster.openings[0].width=40
const clipped=importArchitecturalPlan(raster).architecture!
assert.equal(clipped.openings[0].offset+clipped.openings[0].width/2,8)
assert(clipped.warnings.some(w=>w.includes('2 px')))
raster.openings[0].offset=783
assert.throws(()=>importArchitecturalPlan(raster),/outside/,'larger than 2px host mismatch is rejected')
const sill=structuredClone(fixture);sill.spaces[1].type='other';sill.spaces[1].name='飘窗'
assert.equal(importArchitecturalPlan(sill).architecture!.spaces[1].kind,'ledge')
assert(importArchitecturalPlan(sill).architecture!.warnings.some(w=>w.includes('Estimated raised sill')))
const landing=structuredClone(home.architecture!)
landing.spaces[0].kind='stair';landing.spaces[0].stair={flights:[{id:'landing',path:[[1,1],[2,1]],width:1,rise:0,steps:0}]}
assert.doesNotThrow(()=>validateArchitecture(landing),'zero-rise landing has zero steps')
landing.spaces[0].stair.flights![0].rise=1
assert.throws(()=>validateArchitecture(landing),/stair flight/,'rising flight requires steps')
const gap=structuredClone(fixture);gap.walls[0].kind='railing';gap.walls[0].height=1.05;gap.openings[0].kind='open';gap.openings[0].operation='open'
assert.equal(importArchitecturalPlan(gap).architecture!.openings[0].height,1.05)
assert(importArchitecturalPlan(gap).architecture!.warnings.some(w=>w.includes('Railing passage')))
const stairWire = { ...structuredClone(fixture), spaces: [{ ...fixture.spaces[0], kind:'stair', stairConnection:'down', stairDirection:[1,0], stairFlights:[
  { id:'run', path:[[100,150],[250,150]], width:80, rise:1.8, steps:10 },
  { id:'platform', path:[[250,150],[300,150]], width:80, rise:0, steps:0 },
] }] }
const down = importArchitecturalPlan(stairWire).architecture!
assert.equal(down.spaces[0].stair!.connection, 'down')
assert.deepEqual(down.spaces[0].stair!.flights![0].path, [[1,1.5],[2.5,1.5]])
assert.equal(down.spaces[0].stair!.flights![0].width, .8)
assert.equal(down.spaces[0].stair!.flights![0].rise, 1.8, 'vertical rise is already meters')
assert.equal(down.levels[0].elevation, 3, 'level metadata does not set the stair connection')
assert.deepEqual(architectureToHome(JSON.parse(JSON.stringify(down))).architecture, down)
const unknown = importArchitecturalPlan({ ...stairWire, spaces:stairWire.spaces.map(s=>({ ...s, stairConnection:'unknown' })) }).architecture!
assert.equal(unknown.spaces[0].stair!.connection,'unknown')
assert(unknown.warnings.some(w=>w.includes('Stair connection unknown')))
const legacyStair = importArchitecturalPlan({ ...stairWire, spaces:stairWire.spaces.map(({stairConnection: _connection,...s})=>s) }).architecture!
assert.equal(legacyStair.spaces[0].stair!.connection,'up', 'old data retains the prior schematic even on L2')
assert(legacyStair.warnings.some(w=>w.includes('Legacy stair connection is schematic')))
assert.throws(()=>importArchitecturalPlan({ ...stairWire, spaces:stairWire.spaces.map(s=>({ ...s, stairConnection:'sideways' })) }), /stair connection/)
console.log('Architectural import: 37 precision/identity/calibration/round-trip/raster/ledge/landing/stair-connection checks passed')

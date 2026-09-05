import assert from 'node:assert/strict'
import { measurePrecision } from './lib/precision-acceptance.mjs'
const raw={spaces:[{type:'bedroom'}],walls:[{id:'north',start:[0,0],end:[100,0]},{id:'east',start:[100,0],end:[100,100]},{id:'south',start:[100,100],end:[0,100]},{id:'west',start:[0,100],end:[0,0]}],openings:[{id:'door',wallId:'north',kind:'door',offset:50,width:20}]}
const gt={sample:'synthetic',imageSize:[100,100],outline:[[0,0],[1,0],[1,1],[0,1]],walls:[{label:'west',a:[0,0],b:[0,1]}],openings:[{label:'入户门',a:[.4,0],b:[.6,0]}]}
const options={circulation:[{label:'open living-dining',points:[[.2,.5],[.8,.5]]}]}
assert.deepEqual(measurePrecision(raw,gt,[1,0],options).failures,[])
const missing=measurePrecision({...raw,openings:[]},gt,[1,0],options)
assert.equal(missing.maxOpeningCenterError,Infinity)
assert(missing.failures.some(f=>f.includes('opening center')))
assert(measurePrecision({...raw,openings:[{...raw.openings[0],kind:'window'}]},gt,[1,0],options).failures.length)
const extra={...raw,walls:[...raw.walls,{id:'invented',start:[50,10],end:[50,90]}]}
assert(measurePrecision(extra,gt,[1,0],options).failures.includes('invented wall crosses wall-free circulation'))
assert(measurePrecision({...raw,spaces:[]},gt,[1,0],options).failures.includes('bedroom/bathroom counts'))
assert(measurePrecision(raw,{...gt,void:[]},[1,0],options).failures.includes('missing void'))
console.log('Precision acceptance: correct trace, missing opening, wrong opening kind, invented wall, counts and void checks passed')

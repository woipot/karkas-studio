import test from 'node:test';import assert from 'node:assert/strict';
import {generateHouse} from './house-generator.js';import {calculateDesigner,validateDesignerProject} from './designer-engine.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const fixture=()=>{const {project:p}=generateHouse({width:8,depth:6,sections:{walls:'48x198'}});p.roof.type='none';p.walls.push({id:'P',kind:'partition',level:1,a:{x:4,y:.099},b:{x:4,y:5.901},section:'48x98',studStep:.6,endpointMode:'faces'});return p;};
test('physical-face partition endpoints place terminal studs inside the plate extent with no invented corner package',()=>{
 const p=fixture(),r=calculateDesigner(p),bs=r.timber.instances.filter(b=>b.wallId==='P'&&b.role==='stud'),ys=bs.map(b=>b.start[2]);
 near(Math.min(...ys)-.024,.099);near(Math.max(...ys)+.024,5.901);assert.ok(!r.corners.some(c=>c.wallIds.includes('P')));
 const plates=r.timber.instances.filter(b=>b.wallId==='P'&&b.role==='plate');assert.ok(plates.length>=3);near(Math.min(...plates.flatMap(b=>[b.start[2],b.end[2]])),.099);near(Math.max(...plates.flatMap(b=>[b.start[2],b.end[2]])),5.901);
 assert.ok(bs.every(b=>b.length>0&&b.cutLength<=6));
});
test('legacy axis endpoints remain unchanged, while ambiguous face mode on bearing/exterior walls is rejected',()=>{
 const p=fixture();p.walls.at(-1).endpointMode='axes';const r=calculateDesigner(p),ys=r.timber.instances.filter(b=>b.wallId==='P'&&b.role==='stud').map(b=>b.start[2]);near(Math.min(...ys),.099);near(Math.max(...ys),5.901);
 for(const kind of ['exterior','bearing']){const q=fixture();q.walls.at(-1).kind=kind;assert.equal(validateDesignerProject(q).valid,false);}const q=fixture();q.walls.at(-1).endpointMode='typo';assert.equal(validateDesignerProject(q).valid,false);
});

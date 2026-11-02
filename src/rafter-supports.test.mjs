import test from 'node:test';import assert from 'node:assert/strict';
import {defaultDesignerProject,calculateDesigner} from './designer-engine.js';
import {buildRafterSupports} from './rafter-supports.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
const rect=(x,y,w,h,prefix='w',level=1)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}].map((a,i,all)=>({id:prefix+i,a,b:all[(i+1)%4],level,kind:'exterior',section:'50x150',studStep:.6}));
function monoProject(){const p=clone(defaultDesignerProject);p.openings=[];p.walls=rect(0,0,6,4);return p;}
function rafters(base,highY){const low=base.geometry.levels[0].topY;return Array.from({length:11},(_,i)=>({id:'r'+i,role:'rafter',b:50,h:200,start:[i*.6,low,4],end:[i*.6,highY,0]}));}
test('standalone mono adds explicit high-wall posts/plate above an existing wall, with geometry mass',()=>{
  const p=monoProject(),base=calculateDesigner(p),high=base.geometry.levels[0].topY+4*Math.tan(25*Math.PI/180),raw=rafters(base,high),z={id:'z',shape:'mono',levelIndex:1,eave:base.geometry.levels[0].topY},r=buildRafterSupports(p,base,z,raw);
  assert.notEqual(r.status,'fail');assert.ok(r.instances.some(b=>b.role==='rafterSupport'));assert.ok(r.instances.some(b=>b.role==='rafterPlate'));assert.ok(r.instances.every(b=>b.category==='roof'&&b.role!=='web'&&b.role!=='bottom'));
  const plate=r.instances.find(b=>b.role==='rafterPlate'),highSeat=r.supports.find(s=>s.end==='high');near(plate.start[1]+plate.b/2000,highSeat.bearingY);assert.ok(r.instances.every(b=>Number.isFinite(b.mass)&&b.mass>0));assert.ok(r.supports.every(s=>s.verified===false));assert.ok(r.checks.some(c=>c.status==='unverified'));
});
test('no existing wall under a high edge: no invented support posts, explicit failure',()=>{
  const p=monoProject(),base=calculateDesigner(p),low=base.geometry.levels[0].topY,raw=[{id:'free',role:'rafter',b:50,h:200,start:[3,low,4],end:[3,low+1.8,2]}],r=buildRafterSupports(p,base,{id:'z',shape:'mono',levelIndex:1},raw);
  assert.equal(r.status,'fail');assert.equal(r.instances.length,0);assert.ok(r.supports.some(s=>s.end==='high'&&s.mode==='unsupported'));assert.ok(r.checks.find(c=>c.id.endsWith('rafter-support-missing')).missingCount>0);
});
test('upper wall face creates ledger below rafters, never an imaginary truss web',()=>{
  const p=monoProject();p.floors=2;p.levels=[{id:'l1',index:1,name:'1',height:2.8},{id:'l2',index:2,name:'2',height:2.8}];p.walls.push(...rect(0,-4,6,4,'up',2));const base=calculateDesigner(p),high=base.geometry.levels[0].topY+4*Math.tan(25*Math.PI/180),raw=rafters(base,high),r=buildRafterSupports(p,base,{id:'z',shape:'mono',levelIndex:1},raw);
  assert.notEqual(r.status,'fail');const ledger=r.instances.find(b=>b.role==='rafterLedger');assert.ok(ledger);assert.equal(r.instances.some(b=>b.role==='rafterSupport'),false);assert.equal(ledger.level,2);const seat=r.supports.find(s=>s.end==='high');near(ledger.start[1]+ledger.h/2000,seat.bearingY);assert.ok(ledger.start[1]<high);assert.equal(ledger.connectionVerified,false);
});
test('ledger at an upper-window height fails and never draws through the opening',()=>{
  const p=monoProject();p.floors=2;p.levels=[{id:'l1',index:1,name:'1',height:2.8},{id:'l2',index:2,name:'2',height:2.8}];p.walls.push(...rect(0,-4,6,4,'up',2));p.openings=[{id:'glass',wallId:'up2',offset:2,width:2,height:1.4,sill:.8,type:'window',floor:2}];const base=calculateDesigner(p),high=base.geometry.levels[0].topY+4*Math.tan(25*Math.PI/180),r=buildRafterSupports(p,base,{id:'z',shape:'mono',levelIndex:1},rafters(base,high));
  assert.equal(r.status,'fail');assert.ok(r.supports.some(s=>s.mode==='openingConflict'&&s.openingId==='glass'));assert.ok(r.checks.find(c=>c.id.endsWith('rafter-support-openings')).conflictCount>0);
  for(const ledger of r.instances.filter(b=>b.role==='rafterLedger')){const min=Math.min(ledger.start[0],ledger.end[0]),max=Math.max(ledger.start[0],ledger.end[0]);assert.ok(max<=2+1e-7||min>=4-1e-7,'No ledger through the upper window');}
});
test('an explicit beam counts only where its actual top face matches the rafter underside',()=>{
  const p=monoProject(),before=calculateDesigner(p),low=before.geometry.levels[0].topY,high=low+1.8,raw=[{id:'r',role:'rafter',b:50,h:200,start:[3,low,4],end:[3,high,2]}],L=Math.hypot(2,1.8),bearing=high-.1*L/2;
  p.objects=[{id:'beam',type:'beam',a:{x:0,y:2},b:{x:6,y:2},section:'50x200',elevation:bearing-.1-before.geometry.levels[0].wallBaseY,level:1}];const base=calculateDesigner(p),r=buildRafterSupports(p,base,{id:'z',shape:'mono',levelIndex:1},raw);assert.notEqual(r.status,'fail');assert.ok(r.supports.some(s=>s.end==='high'&&s.mode==='existingBeam'&&s.objectId==='beam'));assert.equal(r.instances.length,0);
  p.objects[0].elevation-=.2;const moved=buildRafterSupports(p,calculateDesigner(p),{id:'z',shape:'mono',levelIndex:1},raw);assert.equal(moved.status,'fail');
});
test('corner-inset rows choose the perpendicular bearing wall, not the adjacent side wall',()=>{
  const p=monoProject();p.walls=rect(0,0,8,4);const base=calculateDesigner(p),low=base.geometry.levels[0].topY,high=low+4*Math.tan(25*Math.PI/180);const raw=Array.from({length:15},(_,i)=>({id:'r'+i,role:'rafter',b:50,h:200,start:[.025+7.95*i/14,low,0],end:[.025+7.95*i/14,high,4]}));const r=buildRafterSupports(p,base,{id:'eight',shape:'mono',levelIndex:1},raw);
  assert.notEqual(r.status,'fail');assert.ok(r.supports.filter(s=>s.end==='high').every(s=>s.wallId==='w2'));assert.ok(r.supports.filter(s=>s.end==='low').every(s=>s.wallId==='w0'));assert.ok(r.instances.every(b=>b.wallId==='w2'));assert.equal(r.instances.filter(b=>b.role==='rafterPlate').length,1);near(r.instances.find(b=>b.role==='rafterPlate').length,8);
});
test('ledger contact uses the rafter underside plane at fixed wall station, not the displaced normal point',()=>{
  const p=monoProject();p.floors=2;p.levels=[{id:'l1',index:1,name:'1',height:2.8},{id:'l2',index:2,name:'2',height:2.8}];p.walls.push(...rect(0,-4,6,4,'up',2));const base=calculateDesigner(p),pitch=25*Math.PI/180,high=base.geometry.levels[0].topY+4*Math.tan(pitch),r=buildRafterSupports(p,base,{id:'plane',shape:'mono',levelIndex:1},rafters(base,high));
  const ledger=r.instances.find(b=>b.role==='rafterLedger');assert.ok(ledger);const fixedStationUnderside=high-.2/(2*Math.cos(pitch));near(ledger.start[1]+ledger.h/2000,fixedStationUnderside);near(ledger.end[1]+ledger.h/2000,fixedStationUnderside);
  // The normal-offset point has also moved horizontally and is not a seat at
  // the wall station. Its Y alone must not be used as the contact height.
  assert.ok(Math.abs(fixedStationUnderside-(high-.1*Math.cos(pitch)))>.01);
});

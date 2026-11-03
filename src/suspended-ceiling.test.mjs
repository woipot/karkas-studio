import test from 'node:test';import assert from 'node:assert/strict';
import {buildAuxiliaryTimber} from './auxiliary-timber.js';import {calculateCutting} from './cutting.js';import {defaultDesignerProject} from './designer-engine.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(angle=0){
 const p=structuredClone(defaultDesignerProject),c=Math.cos(angle),s=Math.sin(angle),at=(u,y,v)=>[c*u-s*v,y,s*u+c*v],point=(u,v)=>({x:c*u-s*v,y:s*u+c*v}),ridge=[c,0,s],poly=[point(0,0),point(8,0),point(8,6),point(0,6)];
 p.walls=poly.map((a,i)=>({id:'W'+i,a,b:poly[(i+1)%4],kind:'exterior',section:'50x150',level:1}));p.openings=[];p.material.density=450;p.site={finishedPlan:{externalInteriorLining:.06}};p.auxiliaryTimber={enabled:true,roofInterior:false,ceilingBattens:true,ceilingSection:'50x100',ceilingStep:.4};
 const walls=[];for(const v of [0,6])for(let i=0;i<=16;i++)walls.push({id:`WALL-${v}-${i}`,role:'stud',category:'walls',level:1,b:50,h:150,start:at(i/2,1,v),end:at(i/2,4.155,v),crossAxis:ridge});
 const ties=Array.from({length:11},(_,i)=>({id:'T'+i,zoneId:'Z',role:'bottomChord',physicalTruss:true,b:50,h:150,start:at(i*.8,4.33,0),end:at(i*.8,4.33,6),crossAxis:ridge}));
 const zone={id:'Z',shape:'gable',levelIndex:1,tiedRafters:true,eave:4.255,ceilingDrop:.3,ceilingDatumY:3.955,tieTaperLength:.35,bearingArea:48,surfaceArea:54,polygon:poly};
 return {p,r:{geometry:{levels:[{index:1,polygon:poly}]},timber:{instances:walls},roofModel:{zones:[zone],instances:ties}},at,ridge};
}
test('suspended ceiling has actual supports, stays within finished wall faces, and hangs only from full-depth tie segments',()=>{
 for(const angle of [0,.73]){const x=fixture(angle),a=buildAuxiliaryTimber(x.p,x.r),hangers=a.instances.filter(b=>b.role==='ceilingHanger'),ledgers=a.instances.filter(b=>b.role==='ceilingLedger'),battens=a.instances.filter(b=>b.role==='ceilingBatten');assert.ok(hangers.length>50);assert.equal(ledgers.length,6);assert.ok(battens.length>15);
  const u=q=>q[0]*Math.cos(angle)+q[2]*Math.sin(angle),v=q=>-q[0]*Math.sin(angle)+q[2]*Math.cos(angle);
  for(const h of hangers){near(h.start[1],3.955);near(h.end[1],4.255);near(h.length,.3);assert.equal(h.supportBottomChordIds.length,1);assert.ok(v(h.start)-.025>=.35-1e-7);assert.ok(v(h.start)+.025<=5.65+1e-7);assert.ok(u(h.start)>.18&&u(h.start)<7.82);}
  for(const b of battens){near(b.start[1]+b.b/2000,3.955);assert.ok(Math.min(v(b.start),v(b.end))-b.h/2000>.135-1e-7);assert.ok(Math.max(v(b.start),v(b.end))+b.h/2000<5.865+1e-7);assert.ok(b.sourceMemberIds.length>=2);}
  for(const l of ledgers){assert.ok(l.cutLength<=6+1e-7);near(l.start[1]+l.h/2000,3.955);if(l.supportedSpliceStart||l.supportedSpliceEnd){const q=l.supportedSpliceStart?l.start:l.end;near(u(q)*2,Math.round(u(q)*2));}}
  assert.equal(a.checks.find(c=>c.id==='ceiling-Z-edge-grid').status,'pass');assert.ok(a.checks.some(c=>c.id==='ceiling-Z-connections'&&c.status==='unverified'));
 }
});
test('all ceiling timber enters self weight and six-metre fabrication once',()=>{
 const {p,r}=fixture(),a=buildAuxiliaryTimber(p,r),ceiling=a.instances.filter(b=>/^ceiling/.test(b.role)),mass=ceiling.reduce((s,b)=>s+b.mass,0),cut=calculateCutting(p,{timber:{instances:ceiling}}),placed=cut.stocks.flatMap(s=>s.pieces.map(p=>p.sourceId));assert.equal(cut.overlength.length,0);assert.equal(placed.length,ceiling.length);assert.equal(new Set(placed).size,ceiling.length);near(a.ceilingExtraDeadByZone.Z*48,mass*9.80665/1000);near(a.roofExtraDeadByZone.Z*54,mass*9.80665/1000);for(const b of ceiling)near(b.mass,b.volume*450);
});

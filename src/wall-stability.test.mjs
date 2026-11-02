import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFullHeightWall,checkFullHeightWalls,evaluateWallSectionCandidates} from './wall-stability.js';
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const input=()=>({studs:[{id:'s',length:5.4,b:50,h:150,tributaryWidth:.6}],roofReactionLine:{design:5,service:4},wind:.3});

test('Euler uses the complete actual height, never the former 2.8m storey or hidden stud restraint',()=>{
  const p=input(),a=checkFullHeightWall({...p,material:{studRestraint:2.8},studRestraint:2.8}),b=checkFullHeightWall({...p,studs:[{...p.studs[0],length:2.7}]});
  near(a.worst.unbracedWeakLength,5.4);near(a.worst.unbracedStrongLength,5.4);near(a.worst.eulerWeak,b.worst.eulerWeak/4);near(a.worst.eulerStrong,b.worst.eulerStrong/4);
  near(a.worst.eulerWeak,Math.PI**2*10000*(150*50**3/12)/5400**2/1000);near(a.worst.eulerStrong/a.worst.eulerWeak,9);
});
test('bottom axial load adds roof reaction, real wall layers and timber mass exactly once',()=>{
  const r=checkFullHeightWall(input()),s=r.worst;
  near(s.timberMass,.05*.15*5.4*500);near(s.wallWeight,.5*.6*5.4);
  near(s.force,5*.6+(s.timberMass*9.80665/1000+s.wallWeight)*1.1);near(s.serviceForce,4*.6+s.timberWeight+s.wallWeight);
});
test('independent 3m wind beam: q=.12kN/m gives M=.189kNm design, stress1.008MPa, first-order deflection.9mm',()=>{
  const r=checkFullHeightWall({studs:[{id:'w',length:3,b:50,h:150,tributaryWidth:.6}],roofReactionLine:0,wallDead:0,wind:.2}),s=r.worst;
  near(s.windLineService,.12);near(s.windLineDesign,.168);near(s.windMoment,.189);near(s.windStressFirstOrder,1.008);near(s.windDeflectionFirstOrder,.9);
  assert.ok(s.windDeflection>s.windDeflectionFirstOrder);assert.ok(s.windStress>s.windStressFirstOrder);
});
test('full-height 50x150 can fail while a larger same-width section passes the shown private checks',()=>{
  const a=checkFullHeightWall(input()),b=checkFullHeightWall({...input(),studs:[{...input().studs[0],h:200}]});
  assert.equal(a.capacityPass,false);assert.ok(a.utilization>1);assert.equal(b.capacityPass,true);assert.equal(b.status,'unverified');assert.equal(b.worst.b,50);assert.equal(b.worst.h,200);
  const candidates=evaluateWallSectionCandidates(input());assert.equal(candidates.recommended.section,'50x200');
});
test('strong-axis P-delta amplification follows explicitly shown N/Euler and fails at instability',()=>{
  const r=checkFullHeightWall(input()),s=r.worst;near(s.amplification,1/(1-s.force/s.eulerStrong));near(s.windStress,s.windStressFirstOrder*s.amplification);
  const fail=checkFullHeightWall({...input(),roofReactionLine:{design:1000,service:1000}});assert.equal(fail.status,'fail');assert.equal(fail.capacityPass,false);assert.equal(fail.worst.amplification,Infinity);
});
test('Emin changes stability while mean E still controls first-order bending stiffness',()=>{
  const a=checkFullHeightWall(input()),b=checkFullHeightWall({...input(),Emin:5000});near(b.worst.eulerWeak,a.worst.eulerWeak/2);near(b.worst.eulerStrong,a.worst.eulerStrong/2);near(b.worst.windDeflectionFirstOrder,a.worst.windDeflectionFirstOrder);assert.ok(b.worst.windDeflection>a.worst.windDeflection);
});
test('compression capacity is capped by material stress as well as both Euler axes',()=>{
  const r=checkFullHeightWall({...input(),Fc:.2,studs:[{...input().studs[0],length:1}]}),s=r.worst;near(s.compressionCapacity,.2*50*150/1000);assert.ok(s.compressionCapacity<=s.eulerWeak);assert.ok(s.compressionCapacity<=s.eulerStrong);
});
test('stock fit checks the long-point blank including a top miter, not only axis length',()=>{
  const r=checkFullHeightWall({studs:[{id:'cut',length:5.95,b:50,h:200,cutEnd:{scheme:'miter',angle:45}}],roofReactionLine:0,wallDead:0});near(r.worst.cutLength,6.05);assert.equal(r.stockFits,false);assert.equal(r.capacityPass,false);assert.equal(r.checks.find(c=>c.id==='full-wall-stock').status,'fail');
});
test('wrapper joins stock pieces back to the complete continuous logical stud and rejects over-6m assembly',()=>{
  const p={height:2.8,walls:[{id:'w',studStep:.6}],material:{E:10000,Fc:12,Ft:8,Fb:13,Fv:1.5,density:500,studRestraint:2.8},loads:{wind:0,gammaG:1.1,gammaQ:1.4,wallDead:0}};
  const a={role:'stud',wallId:'w',level:1,memberId:'full',b:50,h:200};
  const r={timber:{instances:[{...a,id:'p1',start:[0,0,0],end:[0,6,0],partIndex:0},{...a,id:'p2',start:[0,5.6,0],end:[0,6.4,0],partIndex:1}]}};
  const roof={wallProfiles:[{wallId:'w',level:1,mode:'continuous',roofReactionLine:{design:0,service:0}}]},m=checkFullHeightWalls(p,r,roof);near(m.walls[0].worst.length,6.4);near(m.walls[0].worst.cutLength,6.4);assert.equal(m.walls[0].stockFits,false);assert.equal(m.status,'fail');
});
test('missing roof reaction cannot approve a loadbearing full-height wall and stacked walls stay unverified',()=>{
  const r=checkFullHeightWall({studs:[{id:'s',length:3,b:50,h:200}],wallDead:0});assert.equal(r.capacityPass,false);assert.equal(r.status,'unverified');assert.equal(r.checks.find(c=>c.id==='full-wall-load-path').status,'unverified');
  const m=checkFullHeightWalls({walls:[]},{timber:{instances:[]}},{wallProfiles:[{wallId:'w',level:1,mode:'stacked'}]});assert.equal(m.capacityPass,false);assert.equal(m.status,'unverified');
});
test('wind deflection ratio is explicit and not silently switched by wall height',()=>{
  const a=checkFullHeightWall({...input(),deflectionRatio:200}),b=checkFullHeightWall({...input(),deflectionRatio:300});near(a.worst.deflectionAllowed,5400/200);near(b.worst.deflectionAllowed,5400/300);near(b.worst.deflectionUtilization,a.worst.deflectionUtilization*1.5);
});
test('uplift is treated as tension without a fictitious compression amplification',()=>{
  const r=checkFullHeightWall({studs:[{id:'up',length:3,b:50,h:150,roofForceDesign:-10,roofForceService:-8}],wallDead:0,wind:0}),s=r.worst;assert.ok(s.force<0);near(s.compressionForce,0);assert.ok(s.tensionForce>0);near(s.amplification,1);near(s.tensionUtilization,s.tensionForce/s.tensionCapacity);
});
test('malformed dimensions, stiffness, loads and cut metadata produce explicit validation failures',()=>{
  for(const patch of [{studs:[]},{E:NaN},{Emin:20000},{wind:Infinity},{stockLength:8},{spacing:0},{roofReactionLine:{design:NaN}},{studs:[{id:'x',length:4,b:50,h:150,cutEnd:{scheme:'miter',angle:NaN}}]}]){const r=checkFullHeightWall({...input(),...patch});assert.equal(r.status,'fail');assert.ok(r.errors.length>0);assert.equal(r.capacityPass,false);}
});

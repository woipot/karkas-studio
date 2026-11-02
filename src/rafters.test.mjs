import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRafter,evaluateRafterCandidates} from './rafters.js';
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);

test('3-4-5 slope: roof layers on actual area, snow on horizontal projection, self weight once',()=>{
  const r=calculateRafter({horizontalSpan:4,rise:3,b:50,h:200,spacing:.5,roofDead:.6,snow:2,mu:.8});
  near(r.slopeLength,5);near(r.loads.roofDeadAxis,.3);near(r.loads.snowAxis,.64);near(r.loads.timberAxis,.05*.2*500*9.80665/1000);
  near(r.loads.normalService,r.loads.verticalService*.8);near(r.loads.axialService,r.loads.verticalService*.6);
  near(r.loads.snowWeight,2*.8*.5*4);near(r.loads.roofLayersWeight,.6*.5*5);near(r.loads.timberWeight,r.mass*9.80665/1000);
});
test('vertical reactions and internal moment/shear/axial fields satisfy the declared sloping-beam model',()=>{
  const r=calculateRafter({horizontalSpan:4,rise:3,h:200});
  near(r.reactions.verticalA+r.reactions.verticalB,r.loads.totalDesign);near(r.reactions.horizontalA,0);near(r.reactions.horizontalB,0);
  near(r.moment,r.loads.normalDesign*5**2/8);near(r.shear,r.loads.normalDesign*5/2);near(r.axialMax,r.loads.axialDesign*5/2);
  near(r.diagrams[0].N,-r.axialMax);near(r.diagrams.at(-1).N,r.axialMax);near(r.diagrams[8].N,0);near(r.diagrams[8].M,r.moment);
  near(r.diagrams[0].M,0);near(r.diagrams.at(-1).M,0);
});
test('independent flat 4m 50x200 beam under 1kN/m gives M2, stress6MPa and 10mm deflection',()=>{
  const self=.05*.2*500*9.80665/1000,roofDead=(1-.75-self)/.5;
  const r=calculateRafter({horizontalSpan:4,pitch:0,b:50,h:200,spacing:.5,roofDead,snow:1.5,mu:1,E:10000,gammaG:1,gammaQ:1});
  near(r.loads.verticalService,1);near(r.moment,2);near(r.stress,6);near(r.normalDeflection,10);near(r.verticalDeflection,10);near(r.shearStress,.3);near(r.axialMax,0);
});
test('four metres is not a structural-system threshold: 50x150 fails while 50x200 can pass',()=>{
  const thin=calculateRafter(),deeper=calculateRafter({h:200}),heavy=calculateRafter({h:200,snow:8});
  assert.equal(thin.capacityPass,false);assert.ok(thin.deflectionUtilization>1);assert.equal(thin.h,150);
  assert.equal(deeper.capacityPass,true);assert.equal(deeper.status,'warning');near(deeper.verticalDeflection,12.197957005607007);
  assert.equal(heavy.capacityPass,false);assert.ok(heavy.recommendations.some(s=>s.includes('Уменьшить')));assert.ok(heavy.recommendations.some(s=>s.includes('опору')));
});
test('doubling E halves all instantaneous displacements without changing force resultants',()=>{
  const a=calculateRafter({h:200}),b=calculateRafter({h:200,E:20000});
  near(b.normalDeflection,a.normalDeflection/2);near(b.verticalDeflection,a.verticalDeflection/2);near(b.axialDisplacement,a.axialDisplacement/2);near(b.moment,a.moment);near(b.axialMax,a.axialMax);
});
test('density doubles mass and only the timber portion of the axis load',()=>{
  const a=calculateRafter({h:200}),b=calculateRafter({h:200,density:1000});
  near(b.mass,a.mass*2);near(b.volume,a.volume);near(b.loads.timberAxis,a.loads.timberAxis*2);
  near(b.loads.verticalService-a.loads.verticalService,a.loads.timberAxis);near(b.loads.snowAxis,a.loads.snowAxis);near(b.loads.roofDeadAxis,a.loads.roofDeadAxis);
});
test('snow total is independent of slope for a fixed horizontal footprint; transverse snow has cos²',()=>{
  for(const pitch of [0,25,45,60]){
    const a=calculateRafter({h:200,pitch}),b=calculateRafter({h:200,pitch,snow:0}),c=Math.cos(pitch*Math.PI/180);
    near(a.loads.snowWeight,1.5*.8*.6*4);near(a.loads.normalService-b.loads.normalService,1.5*.8*.6*c*c);
  }
});
test('combined axial/bending interaction maximizes coincident fields instead of adding unrelated peaks',()=>{
  const r=calculateRafter({horizontalSpan:4,pitch:50,h:150,Ft:1,Fc:2});let brute=0;const L=r.slopeLength*1000;
  for(let i=0;i<=20000;i++){
    const s=L*i/20000,N=r.loads.axialDesign*(s-L/2),M=r.loads.normalDesign*s*(L-s)/2;
    brute=Math.max(brute,Math.abs(N)/(r.A*(N<0?r.Fc:r.Ft))+Math.abs(M)/(r.Z*r.Fb));
  }
  near(r.interactionUtilization,brute,1e-7);assert.ok(r.interactionUtilization>=r.bendingUtilization);
  assert.ok(r.interactionUtilization<r.bendingUtilization+Math.max(r.compressionUtilization,r.tensionUtilization));
});
test('vertical deflection includes elastic axial shortening projected onto the vertical',()=>{
  const r=calculateRafter({horizontalSpan:4,rise:3,h:200}),L=5000;
  const axial=r.loads.axialService*L**2/(8*r.E*r.A);near(r.axialDisplacement,axial);near(r.verticalDeflection,r.normalDeflection*.8+axial*.6);
  near(r.diagrams[8].verticalDeflection,r.verticalDeflection);near(r.diagrams[8].axialDisplacement,-axial);
  near(r.deflectionAllowed,4000/300);near(r.normalDeflectionAllowed,5000/300);
});
test('reported maximum span is horizontal and solves the actual limiting utilization at fixed pitch',()=>{
  const r=calculateRafter({h:200}),at=calculateRafter({h:200,horizontalSpan:r.maxSpan}),beyond=calculateRafter({h:200,horizontalSpan:r.maxSpan*1.02});
  near(at.utilization,1,1e-8);assert.ok(beyond.utilization>1);near(r.maxSlopeLength,r.maxSpan/Math.cos(25*Math.PI/180));
});
test('load factors affect forces but do not multiply service deflection',()=>{
  const a=calculateRafter({h:200,gammaG:1,gammaQ:1}),b=calculateRafter({h:200,gammaG:2,gammaQ:2});
  near(b.moment,a.moment*2);near(b.axialMax,a.axialMax*2);near(b.verticalDeflection,a.verticalDeflection);near(b.reactions.verticalA,a.reactions.verticalA*2);
});
test('catalog screens material/geometry candidates and retains unknown bearing/lateral/wind checks',()=>{
  const c=evaluateRafterCandidates();assert.equal(c.recommended.section,'50x200');assert.ok(c.acceptable.every(x=>x.capacityPass));
  const r=c.recommended.analysis;for(const id of ['rafter-bearing','rafter-lateral','rafter-wind'])assert.equal(r.checks.find(x=>x.id===id).status,'unverified');
  const none=evaluateRafterCandidates({horizontalSpan:12,snow:20},['50x150','50x200']);assert.equal(none.recommended,null);assert.equal(none.anyAcceptable,false);assert.ok(none.note.includes('не доказательство необходимости фермы'));
});
test('actual rise takes priority over a stale angle; malformed inputs fail gracefully',()=>{
  const r=calculateRafter({horizontalSpan:4,rise:3,pitch:25});near(r.pitch,Math.atan2(3,4)*180/Math.PI);assert.ok(r.warnings.length>0);
  for(const input of [null,[],{horizontalSpan:0},{rise:-1},{E:NaN},{density:'500'},{h:40,b:50},{spacing:0}]){const r=calculateRafter(input);assert.equal(r.valid,false);assert.equal(r.capacityPass,false);assert.equal(r.status,'fail');}
});

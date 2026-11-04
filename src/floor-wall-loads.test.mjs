import test from 'node:test';
import assert from 'node:assert/strict';
import {solveFloorWallBeam,attachFloorWallLoads} from './floor-wall-loads.js';
import {checkDesignerMembers} from './designer-mechanics.js';
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<t,`${a} != ${b}`);
const beam={length:4,b:100,h:200,E:10000,Fb:13,Fv:1.6};
const total=a=>a.reduce((s,x)=>s+x,0);

test('AWC simple UDL benchmark: 4m,100x200,q1 gives M2,V2,delta5mm',()=>{
 const r=solveFloorWallBeam({...beam,uniformService:1,uniformDesign:1});assert.equal(r.valid,true);near(r.moment,2);near(r.shear,2);near(r.deflection,5);near(r.reactions.designA,2);near(r.reactions.designB,2);near(r.service.at(0).deflection,0);near(r.service.at(4).deflection,0);near(r.I,100*200**3/12);
});
test('central P2 gives M2 and exact PL³/(48EI)=4mm; endpoint P creates no bending',()=>{
 const a=solveFloorWallBeam({...beam,loads:[{type:'point',at:2,service:2,design:2}]});near(a.moment,2);near(a.deflection,4);near(a.reactions.designA,1);
 const z=solveFloorWallBeam({...beam,loads:[{type:'point',at:0,service:2,design:2},{type:'point',at:4,service:3,design:3}]});near(z.moment,0);near(z.deflection,0);near(z.reactions.designA,2);near(z.reactions.designB,3);
});
test('off-centre point maximum deflection uses exact non-midpoint extremum and reflects',()=>{
 const a=1,P=3,L=4,EI=beam.E*(beam.b*beam.h**3/12)/1e9;
 const A=solveFloorWallBeam({...beam,loads:[{type:'point',at:a,service:P,design:P}]}),B=solveFloorWallBeam({...beam,loads:[{type:'point',at:L-a,service:P,design:P}]});
 const x=L-Math.sqrt((L*L-a*a)/3),delta=P*a*(L-x)*(L*L-a*a-(L-x)**2)/(6*L*EI)*1000;
 near(A.moment,P*a*(L-a)/L);near(A.deflection,delta);near(A.deflection,B.deflection);near(A.reactions.designA,B.reactions.designB);assert.ok(Math.abs(x-2)>.1);
});
test('adjacent partial UDLs reproduce full UDL; superposition and tiny loads remain linear',()=>{
 const loads=[{type:'partialUDL',from:0,to:1.3,qService:1,qDesign:1},{type:'partialUDL',from:1.3,to:4,qService:1,qDesign:1}],A=solveFloorWallBeam({...beam,loads}),B=solveFloorWallBeam({...beam,uniformService:1,uniformDesign:1});near(A.moment,B.moment);near(A.deflection,B.deflection);
 const C=solveFloorWallBeam({...beam,loads:[{type:'partialUDL',from:.3,to:1.7,qService:2,qDesign:3}]}),D=solveFloorWallBeam({...beam,loads:[{type:'point',at:2.8,service:1,design:2}]}),S=solveFloorWallBeam({...beam,loads:[{type:'partialUDL',from:.3,to:1.7,qService:2,qDesign:3},{type:'point',at:2.8,service:1,design:2}]});
 for(const x of[0,.3,1,1.7,2.1,2.8,3.6,4]){near(S.service.at(x).deflection,C.service.at(x).deflection+D.service.at(x).deflection);near(S.design.at(x).moment,C.design.at(x).moment+D.design.at(x).moment);}
 const tiny=solveFloorWallBeam({...beam,uniformService:1e-10,uniformDesign:1e-10});near(tiny.moment/1e-10,2);near(tiny.deflection/1e-10,5);
});
test('invalid loads, NaN and numerical overflow return unverified without NaN',()=>{
 for(const invalid of[{loads:[null]},{loads:[{type:'point',at:5,service:2,design:2}]},{E:NaN},{h:1e200},{uniformService:Infinity},{loads:[{type:'partialUDL',from:2,to:1,qService:1,qDesign:1}]}]){const r=solveFloorWallBeam({...beam,...invalid});assert.equal(r.valid,false);assert.equal(r.status,'unverified');assert.ok(r.errors.length);assert.equal(r.utilization,null);}
});

const joist=(id,u)=>({id,memberId:id,role:'joist',category:'floor',b:50,h:200,mass:0,start:[u,1,0],end:[u,1,4],floor:1,analyticalSpan:4,tributaryWidth:.5,supportStatus:'pass',supportStart:{kind:'grillage',sourceId:'GA',station:0,point:{x:u,y:0}},supportEnd:{kind:'grillage',sourceId:'GZ',station:4,point:{x:u,y:4}}});
function fixture(perp=false){
 const wall={id:'P',kind:'partition',level:1,height:2,a:perp?{x:.1,y:2}:{x:.5,y:.5},b:perp?{x:1.9,y:2}:{x:.5,y:3.5}};
 const js=perp?[joist('J0',0),joist('J1',2)]:[joist('J0',.475),joist('J1',.525)];
 const wood={id:'S',wallId:'P',category:'walls',role:'stud',b:50,h:100,mass:10,start:[perp?1:.5,1,2],end:[perp?1:.5,3,2],floor:1};
 const bs=perp?[1.975,2.025].map((v,i)=>({id:'B'+i,role:'wallTransferBlocking',category:'floor',b:50,h:200,mass:1,start:[.025,1,v],end:[1.975,1,v],floor:1,supports:[{memberIds:['J0'],point:{x:.025,y:v}},{memberIds:['J1'],point:{x:1.975,y:v}}]})):[];
 const p={floors:1,height:2,floor:{axis:'y',spacing:.5,wallSupportFraming:true},material:{E:10000,Fb:13,Ft:8,Fc:13,Fv:1.6},loads:{wallDead:.1,openingDead:.02,gammaG:1.1,gammaQ:1.4,floorDead:.3,live:1.5},walls:[wall],openings:[]};
 const geometry={area:8,totalFloorArea:8,bounds:{width:2,height:4},levels:[{index:1,height:2,netFloorArea:8}]},timber={instances:[...js,...bs,wood],totals:{floor:{weight:0},walls:{weight:.0980665}}},floorPlatform={wallSupports:[{wallId:'P',level:1,kind:'partition',orientation:perp?'perpendicular':'parallel',geometryComplete:true,joistIds:js.map(j=>j.id),transferBoardIds:bs.map(b=>b.id)}]};
 return{p,geometry,timber,floorPlatform,walls:p.walls};
}
test('parallel wall routes actual wood and layer UDL through two individual joists with exact N+Px+Py',()=>{
 const f=fixture(),before=total(f.timber.instances.map(b=>b.mass)),out=attachFloorWallLoads(f.p,f);assert.deepEqual(out.routedWallLayerIds,['P']);assert.deepEqual(out.routedBoardIds,['S']);near(out.walls[0].expected.force,.6+.0980665);for(const k of['force','momentX','momentY'])near(out.balance[k],0);assert.equal(total(f.timber.instances.map(b=>b.mass)),before);assert.equal(out.routedJoistIds.length,2);near(total(out.foundationSamples.map(s=>s.characteristic)),.6980665);assert.ok(out.foundationSamples.every(s=>s.beamId==='GA'||s.beamId==='GZ'));
 const q=structuredClone(f),a=JSON.stringify(out.foundationSamples);const again=attachFloorWallLoads(f.p,f);assert.equal(JSON.stringify(again.foundationSamples),a);assert.equal(f.timber.instances[0].wallLoads.length,q.timber.instances[0].wallLoads.length);
});
test('perpendicular wall uses actual clear transfer-block spans and retains both plan first moments',()=>{
 const f=fixture(true),out=attachFloorWallLoads(f.p,f);assert.deepEqual(out.routedWallLayerIds,['P']);near(out.walls[0].expected.force,.36+.0980665);for(const k of['force','momentX','momentY'])near(out.balance[k],0);assert.equal(out.transferMembers.length,2);for(const b of out.transferMembers){near(b.length,1.95);assert.equal(b.valid,true);assert.equal(b.connectionVerified,false);}assert.ok(out.checks.some(c=>c.id==='floor-wall-transfer-connections'&&c.status==='unverified'));assert.ok(f.timber.instances.filter(b=>b.role==='joist').every(j=>j.wallLoads.every(q=>q.type==='point')));
});
test('opening replaces wall layers rather than adding duplicate fill weight',()=>{
 const f=fixture();f.p.openings=[{id:'D',wallId:'P',offset:1,width:1,height:1.8,floor:1}];const out=attachFloorWallLoads(f.p,f);near(out.walls[0].layerWeight,.6-1.8*.1+1.8*.02);near(out.balance.force,0);
});
test('incomplete support aborts the whole wall transfer, retains direct-routing IDs and disallows full joist pass',()=>{
 const f=fixture();f.timber.instances[0].supportStart.kind='unknown';const out=attachFloorWallLoads(f.p,f);assert.equal(out.routedBoardIds.length,0);assert.equal(out.routedWallLayerIds.length,0);assert.equal(out.foundationSamples.length,0);assert.deepEqual(out.unverifiedWallIds,['P']);assert.ok(f.timber.instances.filter(b=>b.role==='joist').every(j=>j.wallLoadsComplete===false));const m=checkDesignerMembers(f.p,{...f,loads:{}});assert.ok(m.joist.members.every(j=>j.status==='unverified'&&!j.numericChecksApplicable));
});
test('mixed wall loads augment individual joist checks, no composite credit or false UDL-only span limit',()=>{
 const f=fixture(),baseline=checkDesignerMembers(f.p,{...f,loads:{}});attachFloorWallLoads(f.p,f);const m=checkDesignerMembers(f.p,{...f,loads:{}});assert.ok(m.joist.moment>baseline.joist.moment);assert.ok(m.joist.deflection>baseline.joist.deflection);assert.equal(m.joist.wallLoaded,true);assert.equal(m.joist.maxSpan,null);near(m.joist.I,50*200**3/12);assert.equal(m.joist.wallLoadsComplete,true);assert.ok(m.joist.loadTotalService>m.joist.lineLoadService*4);
});


test('rotating an orthogonal partition and floor axis preserves force, bending and deflection',()=>{
 const f=fixture(true),g=structuredClone(f);g.p.floor.axis='x';const xy=q=>({x:q.y,y:q.x});for(const w of g.walls){w.a=xy(w.a);w.b=xy(w.b);}g.p.walls=g.walls;for(const b of g.timber.instances){b.start=[b.start[2],b.start[1],b.start[0]];b.end=[b.end[2],b.end[1],b.end[0]];for(const support of[b.supportStart,b.supportEnd,...(b.supports??[])].filter(Boolean))support.point=xy(support.point);}
 const a=attachFloorWallLoads(f.p,f),b=attachFloorWallLoads(g.p,g);assert.deepEqual(b.routedWallLayerIds,['P']);near(a.walls[0].expected.force,b.walls[0].expected.force);near(a.walls[0].expected.momentX,b.walls[0].expected.momentY);near(a.transferMembers[0].moment,b.transferMembers[0].moment);near(a.transferMembers[0].deflection,b.transferMembers[0].deflection);for(const k of['force','momentX','momentY'])near(b.balance[k],0);
});

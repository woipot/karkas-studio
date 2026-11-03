import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDesignerMembers,logicalMembers} from './designer-mechanics.js';
import {calculateDesigner,defaultDesignerProject} from './designer-engine.js';
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const cp=x=>JSON.parse(JSON.stringify(x));
const make=()=>({...cp(defaultDesignerProject),openings:[]});
const run=p=>checkDesignerMembers(p,calculateDesigner(p));

test('physical overlapping stock pieces recover the original eight-metre logical span',()=>{
  const b={memberId:'M',role:'joist',b:50,h:250,mass:10,floor:1};
  const a=logicalMembers([{...b,id:'p1',start:[0,0,0],end:[0,0,6]},{...b,id:'p2',start:[0,0,5.6],end:[0,0,8]}],'joist');
  assert.equal(a.length,1);near(a[0].length,8);near(a[0].mass,20);assert.equal(a[0].spliced,true);
});
test('lower-floor bearing wall creates four-metre spans; ground grillage and stock splices are not upper-floor supports',()=>{
  const p=make();p.floors=2;const a=run(p);near(a.joist.span,4);assert.ok(a.joist.members.filter(m=>m.floor===1).every(m=>m.span<=p.foundation.spacing+1e-7));
  p.walls=p.walls.filter(w=>w.kind!=='bearing');const r=calculateDesigner(p),b=checkDesignerMembers(p,r);near(b.joist.span,8);
  assert.ok(r.timber.instances.filter(x=>x.role==='joist'&&x.level===2).every(x=>x.cutLength>6));
  assert.ok(b.joist.members.filter(x=>x.floor===2).every(x=>!x.spliced));assert.ok(b.joist.members.filter(x=>x.floor===1).every(x=>!x.spliced&&x.span<=p.foundation.spacing+1e-7));near(b.joist.deflection/a.joist.deflection,16*b.joist.lineLoadService/a.joist.lineLoadService);
  assert.ok(b.joist.deflectionUtilization>1);assert.equal(b.joist.status,'fail');
});
test('turning off physical splitting preserves the same unsupported analytical span and forces',()=>{
  const p=make();p.floors=2;p.walls=p.walls.filter(w=>w.kind!=='bearing');const a=run(p);p.joints.spliceScheme='none';const b=run(p);
  near(a.joist.span,b.joist.span);near(a.joist.moment,b.joist.moment);near(a.joist.deflection,b.joist.deflection);
  assert.equal(a.joist.spliced,false);assert.equal(b.joist.spliced,false);
});
test('independent 4m 50×200 beam under 1kN/m: M2, stress6MPa, deflection10mm',()=>{
  const p=make();p.floor={section:'50x200',spacing:.5,axis:'y'};p.loads={...p.loads,floorDead:.5,live:1.5,gammaG:1,gammaQ:1,wind:0};
  const r={geometry:{area:40,bounds:{width:10,height:4}},loads:{roofWeight:0,snow:0,rows:[]},timber:{instances:[{id:'j',memberId:'j',role:'joist',b:50,h:200,start:[0,0,0],end:[0,0,4],mass:0}],totals:{floor:{weight:0},walls:{weight:0},bracing:{weight:0}},braceBays:[]}};
  const m=checkDesignerMembers(p,r);near(m.joist.lineLoadService,1);near(m.joist.lineLoadDesign,1);near(m.joist.moment,2);near(m.joist.stress,6);near(m.joist.deflection,10);near(m.joist.shearStress,.3);
});
test('timber density affects beam dead load exactly once through actual floor wood weight',()=>{
  const p=make(),r=calculateDesigner(p),a=checkDesignerMembers(p,r);const q=cp(p);q.material.density*=2;const s=calculateDesigner(q),b=checkDesignerMembers(q,s);
  near(b.joist.floorWoodPressure,2*a.joist.floorWoodPressure);
  near(b.joist.lineLoadService-a.joist.lineLoadService,a.joist.floorWoodPressure*p.floor.spacing);
});
test('doubling E halves beam deflection and doubles ideal stud Euler force',()=>{
  const p=make(),a=run(p);p.material.E*=2;const b=run(p);near(b.joist.deflection,a.joist.deflection/2);near(b.stud.eulerWeak,a.stud.eulerWeak*2);
});
test('a stud has full unsupported length without an explicit restraint; K and length have inverse-square effect',()=>{
  const p=make();delete p.material.studRestraint;const a=run(p);near(a.stud.unbracedLength,p.height-3*.05);
  p.material.studRestraint=a.stud.length/2;const b=run(p);near(b.stud.eulerWeak,a.stud.eulerWeak*4);
  p.material.columnK=2;const c=run(p);near(c.stud.eulerWeak,b.stud.eulerWeak/4);
  assert.ok(a.stud.capacity<=a.stud.crushing);assert.ok(a.stud.capacity<=a.stud.euler);
});
test('modern bracing demand scales with wind while unknown shear capacity and anchors remain unverified',()=>{
  const p=make(),ra=calculateDesigner(p),a=checkDesignerMembers(p,ra);p.loads.wind*=2;const rb=calculateDesigner(p),b=checkDesignerMembers(p,rb);
  assert.ok(ra.bracingModel.wallLines.length);for(const line of ra.bracingModel.wallLines){const next=rb.bracingModel.wallLines.find(l=>l.wallId===line.wallId&&l.level===line.level);assert.ok(next);near(next.demandShear,line.demandShear*2);assert.equal(line.capacity,null);assert.equal(next.capacity,null);assert.ok(line.checks.some(c=>c.id.endsWith('shear-capacity')&&c.status==='unverified'));assert.ok(line.checks.some(c=>c.id.endsWith('load-path')&&c.status==='unverified'));}
  assert.equal(a.bracing.tension,null);assert.equal(b.bracing.tension,null);assert.equal(a.checks.some(c=>c.id==='designerBraceTension'),false);assert.ok(a.checks.some(c=>c.id==='designerMemberSystem'&&c.status==='unverified'));
});
test('open geometry never fabricates floor or axial wall load results',()=>{
  const p=make();p.walls=p.walls.slice(0,3);const m=run(p);assert.equal(m.joist,null);assert.equal(m.stud,null);assert.equal(m.status,'unverified');
});
test('impossible material inputs are unverified instead of producing NaN checks',()=>{
  const p=make(),r=calculateDesigner(p);p.material.E=0;const m=checkDesignerMembers(p,r);assert.equal(m.joist,null);assert.equal(m.stud,null);assert.equal(m.status,'unverified');
});
test('independent floor footprints and second-light voids use net floor area for wood pressure',()=>{
  const p=make();p.floors=2;const r=calculateDesigner(p);r.geometry.totalFloorArea=152;r.geometry.levels=[{height:2.8,closed:true,netFloorArea:96},{height:3,closed:true,netFloorArea:56,voidArea:8}];r.timber.totals.floor.weight=30;
  const m=checkDesignerMembers(p,r);near(m.joist.floorWoodPressure,30/152);near(m.stud.length,3-.15);assert.ok(m.checks.some(c=>c.id==='designerVoidLoadPath'&&c.status==='unverified'));
});

test('representative stud includes physical upper deck ring dead load while live area stays axial',()=>{
  const p=make();p.floors=2;const r=calculateDesigner(p);
  r.geometry.levels=[{index:1,height:2.8,closed:true,netFloorArea:96,platformNetArea:100},{index:2,height:2.8,closed:true,netFloorArea:80,platformNetArea:80}];
  const a=checkDesignerMembers(p,r);r.geometry.levels[1].platformNetArea=84;
  const b=checkDesignerMembers(p,r);
  near(b.stud.equivalentLineLoad-a.stud.equivalentLineLoad,4*p.loads.floorDead*p.loads.gammaG/(2*a.stud.supportLength));
});

test('joist screen carries full deck dead load and exposes physical end consoles separately',()=>{
 const p=make(),r=calculateDesigner(p),l=r.geometry.levels[0];
 l.platformNetArea=l.netFloorArea*1.1;
 const b=r.timber.instances.find(b=>b.role==='joist');b.physicalOverhangStart=.051;
 const m=checkDesignerMembers(p,r),j=m.joist.members.find(j=>j.parts.some(q=>q.id===b.id));
 near(j.floorDeadPressure,p.loads.floorDead*1.1);
 const c=m.checks.find(c=>c.id==='floorJoistEndConsoles');assert.equal(c.status,'unverified');assert.ok(c.memberIds.includes(b.id));assert.ok(c.logicalMemberIds.includes(j.id));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSourceRoof,validateSourceRoofModel} from './source-roof.js';
import {calculateRoofZones} from './roof-zones.js';
import {defaultDesignerProject,calculateDesigner,validateDesignerProject} from './designer-engine.js';
import {calculateCutting} from './cutting.js';
import {exportBoardsCSV,exportModelOBJ} from './house-exports.js';
import {analyzeSnowCases} from './snow-envelope.js';
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<t,`${a} != ${b}`),cp=structuredClone;
function project(){const p=cp(defaultDesignerProject);p.openings=[];p.auxiliaryTimber={...p.auxiliaryTimber,enabled:false};p.roof={...p.roof,type:'gable',snowMu:1,sourceModel:{id:'IMPORTED',source:{title:'Source reconstruction',pageRefs:[46,47]},members:[{id:'B1',name:'Imported rafter',role:'rafter',section:'40x200',start:[0,4.2,0],end:[4,4.2,0],crossAxis:[0,0,1],sourceMark:'B-41'}],surfaces:[{id:'S1',kind:'left',points:[[0,4,0],[4,4,0],[4,5.5,3],[0,5.5,3]]}]}};p.material.density=500;return p;}
const model=p=>p.roof.sourceModel;

test('physical timber mass, slope area and horizontal snow area are computed independently once',()=>{
 const p=project(),before=JSON.stringify(p),r=calculateRoofZones(p,{});assert.equal(r.sourceMode,true);near(r.mass,16);near(r.volume,.032);near(r.area,12*Math.sqrt(1.25));near(r.projectedArea,12);near(r.snowEffectiveArea,12);assert.equal(JSON.stringify(p),before);assert.equal(r.status,'unverified');assert.equal(r.structurallyVerified,false);assert.equal(r.certified,false);assert.deepEqual(r.zones,[]);assert.ok(r.checks.some(c=>c.id==='source-roof-strength'&&c.status==='unverified'));assert.ok(r.checks.some(c=>c.id==='source-roof-load-path'&&c.status==='unverified'));
});
test('Orion5.49m is the plumb-cut blank, not unsupported span or axis length',()=>{
 const p=project(),a=20*Math.PI/180,b=model(p).members[0],run=4.5+.590;b.start=[0,3,0];b.end=[0,3+run*Math.tan(a),run];b.crossAxis=[1,0,0];b.cutStart={scheme:'miter',plane:'depth',angle:20,tiltSign:-1};b.cutEnd={scheme:'miter',plane:'depth',angle:20,tiltSign:1};const r=calculateSourceRoof(p),m=r.instances[0];near(m.length,run/Math.cos(a));near(m.cutLength,run/Math.cos(a)+.2*Math.tan(a));near(m.cutLength,5.49,.001);near(m.volume,.04*.2*m.length);assert.ok(m.cutLength>m.length);assert.equal(m.requireSingleStock,true);
});
test('ready birdsmouth profile preserves its actual net volume and centre of mass without a second cut',()=>{
 const p=project(),b=model(p).members[0];b.shape={type:'rafterSeats',points:[[-2,-.1],[2,-.1],[2,.1],[.5,.1],[.5,0],[-.5,0],[-.5,.1],[-2,.1]]};const r=calculateSourceRoof(p),m=r.instances[0];near(m.volume,.028);near(m.mass,14);near(m.grossVolume,.032);near(m.cutLength,4);assert.ok(m.massCenter[1]<4.2);assert.equal(m.cutStart.scheme,'butt');b.cutStart={scheme:'miter',angle:20};assert.equal(validateSourceRoofModel(model(p)).valid,false);
});
test('reject malformed geometry, NaN, parallel basis, invalid cuts, duplicate IDs and >40m bounds',()=>{
 for(const change of[p=>{model(p).members[0].start[0]=NaN;},p=>{model(p).members[0].end[0]=41;},p=>{model(p).members[0].crossAxis=[1,0,0];},p=>{model(p).members[0].cutStart={scheme:'halfLap',lapLength:1};},p=>{model(p).members[0].cutStart={scheme:'miter',angle:NaN};},p=>{model(p).members[0].cutStart={scheme:'miter',angle:20,cutWidthMM:NaN};},p=>{model(p).members.push(cp(model(p).members[0]));},p=>{model(p).members[0].section='0x200';},p=>{p.roof.sourceModel=null;}]){const p=project();change(p);const r=calculateRoofZones(p,{});assert.equal(r.status,'fail');assert.equal(r.instances.length,0);assert.equal(r.zones.length,0);assert.ok(r.errors.length);}
});
test('nonplanar and self-crossing roof facets fail instead of fabricating area',()=>{
 const p=project();model(p).surfaces[0].points[2][1]+=.2;assert.equal(calculateSourceRoof(p).status,'fail');
 model(p).surfaces[0].points=[[0,4,0],[4,4,4],[0,4,4],[4,4,0]];assert.equal(calculateSourceRoof(p).status,'fail');
});
test('overlapping surface projections at any height reject double-counted roof snow; shared edges are valid',()=>{
 const p=project(),s=cp(model(p).surfaces[0]);s.id='S2';s.points.forEach(q=>q[1]+=1);model(p).surfaces.push(s);const invalid=calculateSourceRoof(p);assert.equal(invalid.status,'fail');assert.ok(invalid.errors.some(e=>e.field==='roof.sourceModel.surfaces'));
 s.points=s.points.map(q=>[q[0]+4,q[1]-1,q[2]]);const valid=calculateSourceRoof(p);assert.equal(valid.status,'unverified');near(valid.projectedArea,24);near(valid.snowEffectiveArea,24);
});
test('concave imported roof uses actual footprint, not bbox; surface snow override is weighted',()=>{
 const p=project();model(p).surfaces=[{id:'L',kind:'mono',snowMu:1.2,points:[[0,4,0],[4,4,0],[4,4,1],[2,4,1],[2,4,3],[0,4,3]]}];const r=calculateSourceRoof(p);near(r.area,8);near(r.projectedArea,8);near(r.snowEffectiveArea,9.6);assert.equal(r.surfaces[0].snowCoefficientBasis,'explicit-surface');
});
test('native zones, none type and malformed source never silently fall back to an automatic roof',()=>{
 for(const change of[p=>p.roof.zones=[],p=>p.roof.type='none',p=>model(p).members=[]]){const p=project();change(p);const v=validateDesignerProject(p);assert.equal(v.valid,false);assert.ok(v.errors.some(e=>e.field.startsWith('roof.sourceModel')||e.field==='roof.zones'));assert.equal(calculateRoofZones(p,{}).instances.length,0);assert.throws(()=>calculateDesigner(p));}
});
test('canonical timber, CSV/OBJ exports and global roof mass include each imported board once',()=>{
 const p=project(),roof=calculateRoofZones(p,{}),r=calculateDesigner(p,{roofModel:roof}),bs=r.timber.instances.filter(b=>b.category==='roof');assert.equal(bs.length,1);near(bs[0].mass,roof.mass);near(r.timber.totals.roof.mass,roof.mass);near(r.loads.snow,p.loads.snow*12);assert.equal(bs[0].sourceBoardId,'B1');assert.equal(bs[0].requireSingleStock,true);assert.ok(exportBoardsCSV({result:r}).includes(bs[0].id));assert.ok(exportModelOBJ({engine:{version:'test'},result:r}).includes('v '));assert.ok(r.checks.some(c=>c.id.includes('source-roof-load-path')&&c.status==='unverified'));
});
test('a9m imported ceiling board stays one physical board and is unplaced rather than auto-spliced',()=>{
 const p=project(),b=model(p).members[0];b.role='ceilingJoist';b.end=[9,4.2,0];const roof=calculateRoofZones(p,{});assert.equal(roof.status,'fail');assert.ok(roof.checks.some(c=>c.id==='source-roof-stock'&&c.status==='fail'));const r=calculateDesigner(p,{roofModel:roof}),bs=r.timber.instances.filter(b=>b.category==='roof');assert.equal(bs.length,1);near(bs[0].length,9);assert.equal(bs[0].requireSingleStock,true);const c=calculateCutting(p,r);assert.ok(c.overlength.some(q=>q.id===bs[0].id));
});
test('source geometry never returns screen_pass or structural cases for even an empty zoneFactors case',()=>{
 const p=project();p.snowDesign={cases:[{id:'fake',name:'Not structural',zoneFactors:{}}]};const r=analyzeSnowCases(p,{});assert.equal(r.cases.length,0);assert.equal(r.certified,false);assert.ok(r.checks.every(c=>c.status==='unverified'));assert.equal(r.worstTotalDesignCase,null);
});
test('declared missing source components stay explicit rather than fake timber mass/procurement',()=>{
 const p=project();model(p).missingItems=['Z1 plywood20mm: quantity and density not imported'];const r=calculateSourceRoof(p);near(r.mass,16);assert.equal(r.fidelityVerified,false);assert.ok(r.checks.some(c=>c.id==='source-roof-missing-items'&&c.status==='unverified'));assert.equal(r.missingItems.length,1);
});

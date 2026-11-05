import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSourceRoof,validateSourceRoofModel} from './source-roof.js';
import {calculateRoofZones} from './roof-zones.js';
import {defaultDesignerProject,calculateDesigner,validateDesignerProject} from './designer-engine.js';
import {calculateCutting} from './cutting.js';
import {exportBoardsCSV,exportModelOBJ} from './house-exports.js';
import {analyzeSnowCases} from './snow-envelope.js';
import {cutGeometry} from './board-geometry.js';
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<t,`${a} != ${b}`),cp=structuredClone;
function project(){const p=cp(defaultDesignerProject);p.openings=[];p.auxiliaryTimber={...p.auxiliaryTimber,enabled:false};p.roof={...p.roof,type:'gable',snowMu:1,sourceModel:{id:'IMPORTED',source:{title:'Source reconstruction',pageRefs:[46,47]},members:[{id:'B1',name:'Imported rafter',role:'rafter',section:'40x200',start:[0,4.2,0],end:[4,4.2,0],crossAxis:[0,0,1],sourceMark:'B-41'}],surfaces:[{id:'S1',kind:'left',points:[[0,4,0],[4,4,0],[4,5.5,3],[0,5.5,3]]}]}};p.material.density=500;return p;}
const model=p=>p.roof.sourceModel;
const meshVolume=b=>{const g=cutGeometry(b),p=g.getAttribute('position');let v=0;for(let i=0;i<p.count;i+=3)v+=(p.getX(i)*(p.getY(i+1)*p.getZ(i+2)-p.getZ(i+1)*p.getY(i+2))+p.getY(i)*(p.getZ(i+1)*p.getX(i+2)-p.getX(i+1)*p.getZ(i+2))+p.getZ(i)*(p.getX(i+1)*p.getY(i+2)-p.getY(i+1)*p.getX(i+2)))/6;g.dispose();return v;};
test('layered width profiles retain the110mm stud back behind a40mm brace groove; mesh and net mass agree',()=>{
 const p=project(),b=model(p).members[0],rect=(a,z)=>[[a,-.02],[z,-.02],[z,.02],[a,.02]];b.section='40x150';b.shape={type:'layeredProfile',plane:'width',layers:[{from:-.075,to:.035,points:rect(-2,2)},{from:.035,to:.075,points:rect(-2,-.1)},{from:.035,to:.075,points:rect(.1,2)}]};const r=calculateSourceRoof(p),m=r.instances[0];near(m.volume,.04*4*.15-.04*.2*.04);near(meshVolume(m),m.volume,1e-7);near(m.mass,m.volume*500);assert.ok(m.massCenter[1]<4.2);const d=calculateDesigner(p,{roofModel:r}),physical=d.timber.instances.find(m=>m.sourceBoardId==='B1');assert.deepEqual(physical.shape,m.shape);near(meshVolume(physical),m.volume,1e-7);assert.ok(exportModelOBJ({engine:{version:'test'},result:d}).includes('v '));
 b.shape.layers.push(cp(b.shape.layers[0]));assert.equal(validateSourceRoofModel(model(p)).valid,false);b.shape.layers.pop();b.shape.layers[0].from=-.076;assert.equal(validateSourceRoofModel(model(p)).valid,false);b.shape.layers[0].from=-.075;b.shape.layers[0].points[0][1]=-.021;assert.equal(validateSourceRoofModel(model(p)).valid,false);
});
test('ordinary width-face profile has actual150mm extrusion and no reversed mesh winding',()=>{
 const p=project(),b=model(p).members[0];b.section='40x150';b.shape={type:'rippedBoard',plane:'width',points:[[-2,-.02],[2,-.02],[2,.02],[-2,.02]]};const m=calculateSourceRoof(p).instances[0];near(m.volume,.024);near(meshVolume(m),.024,1e-7);
});

test('physical timber mass, slope area and horizontal snow area are computed independently once',()=>{
 const p=project(),before=JSON.stringify(p),r=calculateRoofZones(p,{});assert.equal(r.sourceMode,true);near(r.mass,16);near(r.volume,.032);near(r.area,12*Math.sqrt(1.25));near(r.projectedArea,12);near(r.snowEffectiveArea,12);assert.equal(JSON.stringify(p),before);assert.equal(r.status,'unverified');assert.equal(r.structurallyVerified,false);assert.equal(r.certified,false);assert.deepEqual(r.zones,[]);assert.ok(r.checks.some(c=>c.id==='source-roof-strength'&&c.status==='unverified'));assert.ok(r.checks.some(c=>c.id==='source-roof-load-path'&&c.status==='unverified'));
});
test('Orion5.49m is the plumb-cut blank, not unsupported span or axis length',()=>{
 const p=project(),a=20*Math.PI/180,b=model(p).members[0],run=4.5+.590;b.start=[0,3,0];b.end=[0,3+run*Math.tan(a),run];b.crossAxis=[1,0,0];b.cutStart={scheme:'miter',plane:'depth',angle:20,tiltSign:-1};b.cutEnd={scheme:'miter',plane:'depth',angle:20,tiltSign:1};const r=calculateSourceRoof(p),m=r.instances[0];near(m.length,run/Math.cos(a));near(m.cutLength,run/Math.cos(a)+.2*Math.tan(a));near(m.cutLength,5.49,.001);near(m.volume,.04*.2*m.length);assert.ok(m.cutLength>m.length);assert.equal(m.requireSingleStock,true);
});
test('ready birdsmouth profile preserves its actual net volume and centre of mass without a second cut',()=>{
 const p=project(),b=model(p).members[0];b.shape={type:'rafterSeats',points:[[-2,-.1],[2,-.1],[2,.1],[.5,.1],[.5,0],[-.5,0],[-.5,.1],[-2,.1]]};const r=calculateSourceRoof(p),m=r.instances[0];near(m.volume,.028);near(m.mass,14);near(m.grossVolume,.032);near(m.cutLength,4);assert.ok(m.massCenter[1]<4.2);assert.equal(m.cutStart.scheme,'butt');b.cutStart={scheme:'miter',angle:20};assert.equal(validateSourceRoofModel(model(p)).valid,false);
});
test('precut blank allowance survives end-open grooves without adding net timber or bypassing stock limits',()=>{
 const p=project(),b=model(p).members[0];b.shape={type:'rafterSeats',points:[[-1.98,-.1],[2,-.1],[2,.1],[-1.9,.1],[-1.9,.06],[-1.98,.06]]};b.blankLength=4.1;
 const r=calculateSourceRoof(p),m=r.instances[0];near(m.cutLength,4.1);near(m.grossVolume,.04*.2*4.1);near(m.mass,calculateSourceRoof({...p,roof:{...p.roof,sourceModel:{...model(p),members:[{...b,blankLength:undefined}]}}}).mass);
 const d=calculateDesigner(p,{roofModel:r}),board=d.timber.instances.find(m=>m.sourceBoardId==='B1');near(board.cutLength,4.1);assert.ok(exportBoardsCSV({result:d}).includes(board.id));
 for(const length of[3.97,0,-1,NaN,Infinity,41]){b.blankLength=length;assert.equal(validateSourceRoofModel(model(p)).valid,false);}
 b.blankLength=6.1;const roof=calculateSourceRoof(p);assert.ok(roof.checks.some(c=>c.id==='source-roof-stock'&&c.status==='fail'));const over=calculateCutting(p,calculateDesigner(p,{roofModel:roof}));assert.ok(over.overlength.some(q=>q.sourceBoardId==='B1'||q.id===board.id));
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

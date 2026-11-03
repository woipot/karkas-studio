import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDesignerProject,calculateDesigner,validateDesignerProject,parseSection,pointInPolygon} from './designer-engine.js';
const cp=x=>JSON.parse(JSON.stringify(x));
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
const make=()=>({...cp(defaultDesignerProject),openings:[]});
const polygon=(coords)=>coords.map((a,i)=>({id:'w'+i,a:{x:a[0],y:a[1]},b:{x:coords[(i+1)%coords.length][0],y:coords[(i+1)%coords.length][1]},kind:'exterior',section:'50x150',studStep:.6}));

test('default schema validates; exact area and graph joins survive bearing T intersections',()=>{
  const p=make(),r=calculateDesigner(p);assert.equal(validateDesignerProject(p).valid,true);assert.equal(r.geometry.closed,true);near(r.geometry.area,96);near(r.geometry.perimeter,40);assert.equal(r.corners.filter(x=>x.kind==='t').length,2);
  near(r.foundation.reactionSum,r.loads.totalDesign);near(r.foundation.characteristicSum,r.loads.totalCharacteristic);
  near(r.loads.rows.reduce((s,x)=>s+x.design,0),r.loads.totalDesign);
  assert.ok(r.timber.instances.every(x=>Number.isFinite(x.mass)&&x.mass>0&&x.cutLength<=6+1e-7));
});
test('open graph and empty canvas keep quantities but have no fabricated area or force results',()=>{
  for(const walls of [make().walls.slice(0,3),[]]){const r=calculateDesigner({...make(),walls});assert.equal(r.geometry.closed,false);assert.equal(r.geometry.area,null);assert.equal(r.loads,null);assert.equal(r.foundation,null);assert.deepEqual(r.piles,[]);assert.equal(r.status,'open');}
});
test('L-shaped polygon: exact area, perimeter, concave corner and piles inside',()=>{
  const p=make();p.walls=polygon([[0,0],[8,0],[8,4],[4,4],[4,8],[0,8]]);const r=calculateDesigner(p);
  near(r.geometry.area,48);near(r.geometry.perimeter,32);assert.equal(r.geometry.rectangular,false);assert.ok(r.corners.some(c=>Math.abs(c.angle-270)<1e-6));
  for(const pile of r.piles)assert.ok(pointInPolygon(pile,r.geometry.polygon));near(r.foundation.reactionSum,r.loads.totalDesign);
  const joists=r.timber.instances.filter(b=>b.role==='joist');assert.ok(joists.length>0);for(const b of joists){const mid={x:(b.start[0]+b.end[0])/2,y:(b.start[2]+b.end[2])/2};assert.ok(pointInPolygon(mid,r.geometry.polygon));}
});
test('separate rings and crossing exterior outlines do not pretend to be one closed house',()=>{
  const p=make();const a=polygon([[0,0],[4,0],[4,4],[0,4]]),b=polygon([[8,0],[12,0],[12,4],[8,4]]).map(w=>({...w,id:'b'+w.id}));assert.equal(calculateDesigner({...p,walls:[...a,...b]}).geometry.closed,false);
  p.walls=polygon([[0,0],[4,4],[0,4],[4,0]]);assert.equal(calculateDesigner(p).geometry.closed,false);
});
test('arbitrary angle intersections remain connected without parameter-rounding gaps',()=>{
  const p=make();p.walls=polygon([[.13,.27],[11.37,.27],[11.37,7.83],[.13,7.83]]);p.walls.push({id:'diag',a:{x:.13,y:1.1},b:{x:11.37,y:6.2},kind:'bearing',section:'50x150',studStep:.6});const r=calculateDesigner(p);assert.equal(r.geometry.closed,true);near(r.geometry.area,11.24*7.56);assert.equal(r.corners.filter(x=>x.kind==='t').length,2);
});
test('ground joists use real grillage lines while an upper unsupported eight-metre span remains uncut',()=>{
  const p=make();p.floors=2;p.joints.spliceScheme='none';let r=calculateDesigner(p);assert.ok(r.timber.instances.filter(b=>b.role==='joist'&&b.level===1).every(b=>b.length<=p.foundation.spacing+1e-5));assert.ok(r.timber.instances.filter(b=>b.role==='joist'&&b.level===2).every(b=>Math.abs(b.length-4)<1e-5));
  p.walls=p.walls.filter(w=>w.kind!=='bearing');r=calculateDesigner(p);assert.ok(r.timber.instances.filter(b=>b.role==='joist'&&b.level===1).every(b=>b.length<=p.foundation.spacing+1e-5));assert.ok(r.timber.instances.filter(b=>b.role==='joist'&&b.level===2).every(b=>Math.abs(b.length-8)<1e-5));assert.ok(r.timber.overStock.some(b=>b.role==='joist'&&b.level===2));assert.equal(r.splices.length,0);
});
test('half-lap physical pieces: length assembly, mass conservation and all cut lengths ≤6m',()=>{
  const p=make(),r=calculateDesigner(p);const groups=Map.groupBy(r.timber.instances,b=>b.memberId);
  for(const joint of r.splices){assert.equal(joint.verified,false);assert.equal(joint.scheme,'halfLap');assert.equal(joint.partIds.length,2);for(const id of joint.partIds){const b=r.timber.instances.find(b=>b.id===id);assert.ok(b.spliceIds.includes(joint.id));}}
  const parts=[...groups.values()].find(a=>a.length===3&&a[0].role==='plate'&&a[0].wallId==='w-north');assert.ok(parts);
  near(parts.reduce((s,b)=>s+b.length,0)-.4*(parts.length-1),12);near(parts.reduce((s,b)=>s+b.volume,0),.05*.15*12);assert.ok(parts.every(b=>b.cutLength<=6+1e-7));
  const none=make();none.joints.spliceScheme='none';const r0=calculateDesigner(none);near(r.timber.mass,r0.timber.mass);
});
test('fishplates add separate boards and weight without imaginary base-board overlap',()=>{
  const p=make();p.joints.spliceScheme='fishplate';const r=calculateDesigner(p);assert.ok(r.splices.length>0);assert.equal(r.timber.instances.filter(b=>b.role==='fishplate').length,r.splices.length*2);assert.ok(r.splices.every(s=>s.scheme==='fishplate'));
  const pieces=r.timber.instances.filter(b=>b.role==='plate'&&b.wallId==='w-north');near(pieces.reduce((s,b)=>s+b.volume,0),3*.05*.15*12);near(r.foundation.reactionSum,r.loads.totalDesign);
});
test('miter override changes blank long point and physical cuts, half-lap exposes recess depth',()=>{
  const p=make();const initial=calculateDesigner(p);const corner=initial.corners.find(c=>c.point.x===0&&c.point.y===0);p.joints.overrides[corner.id]={type:'three3',cutScheme:'miter'};const r=calculateDesigner(p);const c=r.corners.find(c=>c.id===corner.id);near(c.cutAngle,45);assert.equal(c.type,'three3');const plate=r.timber.instances.find(b=>b.role==='plate'&&(b.cutStart.scheme==='miter'||b.cutEnd.scheme==='miter'));assert.ok(plate);assert.ok(plate.cutLength>plate.length);assert.ok(plate.cutLength<=6+1e-7);
  p.joints.overrides[corner.id].cutScheme='half-lap';const lap=calculateDesigner(p).timber.instances.find(b=>b.role==='plate'&&(b.cutStart.scheme==='half-lap'||b.cutEnd.scheme==='half-lap'));const cut=lap.cutStart.scheme==='half-lap'?lap.cutStart:lap.cutEnd;near(cut.recessDepth,.025);
});
test('instance IDs stable across repeated solve and unrelated custom object additions',()=>{
  const p=make(),a=calculateDesigner(p),b=calculateDesigner(p);assert.deepEqual(a.timber.instances.map(b=>b.id),b.timber.instances.map(b=>b.id));assert.equal(new Set(a.timber.instances.map(b=>b.id)).size,a.timber.instances.length);p.objects.push({id:'post1',type:'post',a:{x:3,y:3},section:'100x100',height:2.8});const c=calculateDesigner(p);for(const board of a.timber.instances)assert.ok(c.timber.instances.some(x=>x.id===board.id));
});
test('custom objects add exact mass once and do not become automatic floor supports',()=>{
  const p=make(),a=calculateDesigner(p);p.objects=[{id:'post',type:'post',a:{x:3,y:3},section:'100x100',height:2.8},{id:'beam',type:'beam',a:{x:2,y:2},b:{x:6,y:2},section:'50x200',elevation:2.8}];const b=calculateDesigner(p);near(b.timber.mass-a.timber.mass,(.1*.1*2.8+.05*.2*4)*500);near(b.loads.totalDesign-a.loads.totalDesign,(b.timber.mass-a.timber.mass)*9.80665/1000*p.loads.gammaG);near(b.foundation.reactionSum,b.loads.totalDesign);assert.equal(b.timber.instances.filter(x=>x.role==='joist').length,a.timber.instances.filter(x=>x.role==='joist').length);
});
test('all layer loads zero: self weight still balances, with no double-counted stock or kerf',()=>{
  const p=make();for(const k of ['floorDead','live','roofDead','wallDead','openingDead','snow','wind'])p.loads[k]=0;const r=calculateDesigner(p),selfWeight=r.timber.mass*9.80665/1000+r.loads.structuralPanelWeight;near(r.loads.totalCharacteristic,selfWeight);near(r.loads.totalDesign,selfWeight*p.loads.gammaG);near(r.foundation.reactionSum,r.loads.totalDesign);near(r.timber.volume,r.timber.instances.reduce((s,b)=>s+b.volume,0));
});
test('roof geometry via canonical nodes/bars adds each repeated bar exactly once; truss failure propagates',()=>{
  const p=make(),truss={nodes:[{id:'A',x:0,y:0},{id:'B',x:8,y:0}],bars:[{id:'B1',nodeA:'A',nodeB:'B',b:50,h:150,role:'bottomChord'}],checks:[],stable:true,status:'warning'};const r=calculateDesigner(p,{truss});assert.equal(r.timber.roofGeometryAvailable,true);near(r.timber.totals.roof.mass,21*8*.05*.15*500);assert.ok(r.splices.some(s=>s.role==='bottomChord'&&s.requiresSupport));near(r.foundation.reactionSum,r.loads.totalDesign);
  const bad=calculateDesigner(p,{truss:{...truss,status:'fail',stable:false}});assert.equal(bad.status,'fail');assert.ok(bad.checks.some(c=>c.id==='trussSolution'&&c.status==='fail'));
});
test('two floors have non-overlapping wall/platform geometry',()=>{
  const p=make();p.floors=2;const r=calculateDesigner(p);const walls=r.timber.instances.filter(b=>b.floor===1&&b.role==='plate');const top=Math.max(...walls.map(b=>b.start[1]+b.b/2000));const joists=r.timber.instances.filter(b=>b.floor===2&&b.role==='joist');const bottom=Math.min(...joists.map(b=>b.start[1]-b.h/2000));near(top,bottom);
});
test('strict input validation rejects nonfinite, corrupt structures, collinear overlaps and bad opening references',()=>{
  for(const change of [p=>{p.height=NaN},p=>{p.floor='bad'},p=>{p.cutting=null},p=>{p.objects=null},p=>{p.material.density=Infinity},p=>{p.walls[0].a.x='0'},p=>{p.openings=[{id:'x',wallId:'missing',offset:1,width:1,height:1,sill:.8,type:'window'}]},p=>p.walls.push({...p.walls[0],id:'overlap'}),p=>{p.cutting.stockLength=8},p=>{p.joints.spliceLength=-1}]){const p=make();change(p);assert.equal(validateDesignerProject(p).valid,false);assert.throws(()=>calculateDesigner(p),{name:'DesignerValidationError'});}
});
test('section mm to volume m³ is exact and invalid orientations are rejected',()=>{
  assert.deepEqual(parseSection('50x150'),{b:50,h:150});assert.deepEqual(parseSection('50 × 150'),{b:50,h:150});for(const x of ['150x50','5x150','50xInfinity',null])assert.equal(parseSection(x),null);
  const r=calculateDesigner(make()),b=r.timber.instances.find(b=>b.role==='stud');near(b.volume,b.b*b.h*b.length/1e6);near(b.mass,b.volume*500);
});
test('member-level manual cuts affect only outer ends, preserve stable identity and obey six-metre blanks',()=>{
  const p=make(),a=calculateDesigner(p);const board=a.timber.instances.find(b=>b.role==='plate'&&b.wallId==='w-north');
  p.boardCuts[board.memberId]={start:{scheme:'miter',angle:60},end:{scheme:'miter',angle:30}};
  const r=calculateDesigner(p),parts=r.timber.instances.filter(b=>b.memberId===board.memberId).sort((a,b)=>a.partIndex-b.partIndex);
  near(parts[0].cutStart.angle,60);near(parts.at(-1).cutEnd.angle,30);assert.ok(parts.every(b=>b.cutLength<=6+1e-7));assert.equal(parts[0].cutEnd.scheme,'halfLap');
  const short=a.timber.instances.find(b=>b.role==='stud');p.boardCuts[short.id]={start:{scheme:'miter',angle:45}};const changed=calculateDesigner(p).timber.instances.find(b=>b.id===short.id);assert.equal(changed.cutStart.scheme,'miter');assert.ok(changed.cutLength>changed.length);
});
test('shorter-than-stock axis with long miter points splits without extending past original endpoint',()=>{
  const p=make();p.objects=[{id:'beam',type:'beam',a:{x:1,y:1},b:{x:6.85,y:1},section:'50x200',elevation:2.8}];const initial=calculateDesigner(p);const beam=initial.timber.instances.find(b=>b.role==='customBeam');p.boardCuts[beam.memberId]={start:{scheme:'miter',angle:45},end:{scheme:'miter',angle:45}};const r=calculateDesigner(p),parts=r.timber.instances.filter(b=>b.memberId===beam.memberId).sort((a,b)=>a.partIndex-b.partIndex);assert.equal(parts.length,2);near(parts[0].start[0],1);near(parts.at(-1).end[0],6.85);assert.ok(parts.every(b=>b.cutLength<=6+1e-7));near(parts.reduce((s,b)=>s+b.volume,0),5.85*.05*.2);
});
test('wall layers, openings and inner walls have exact geometric quantities and balance',()=>{
  const p=cp(defaultDesignerProject),r=calculateDesigner(p);const openingArea=p.openings.reduce((s,o)=>s+o.width*o.height,0);near(r.geometry.openingArea,openingArea);near(r.geometry.netWallArea+r.geometry.exteriorOpeningArea,r.geometry.grossWallArea);near(r.geometry.innerWallArea,12*2.8);near(r.loads.wallWeight,r.geometry.netWallArea*.5);near(r.loads.openingWeight,openingArea*.3);near(r.foundation.reactionSum,r.loads.totalDesign);near(r.loads.rows.reduce((s,x)=>s+x.design,0),r.loads.totalDesign);
});
test('normalized app pricing schema and optional mechanics material fields validate',()=>{
  const p=make();p.prices={timberM3:34000,sheathingM2:600,insulationM2:900,roofM2:1200,pileEach:6500,windowsM2:14000,doorsEach:18000,fastenersM3:4500,laborPercent:35,wastePercent:10,contingencyPercent:10,sectionPrices:{}};Object.assign(p.material,{Fv:1.5,studRestraint:2.8,columnK:1});assert.equal(validateDesignerProject(p).valid,true);assert.doesNotThrow(()=>calculateDesigner(p));p.prices.sectionPrices={'50x150':35000,'100x100':0};assert.equal(validateDesignerProject(p).valid,true);assert.deepEqual(defaultDesignerProject.prices,{});
  for(const bad of [{sectionPrices:{'50x150':-1}},{sectionPrices:[]},{sectionPrices:{'50x150':Infinity}},{laborPercent:301},{timberM3:'34000'}]){const q=make();q.prices=bad;assert.equal(validateDesignerProject(q).valid,false);}
  const q=make();q.material.Fv=NaN;assert.equal(validateDesignerProject(q).valid,false);
});
test('effective closed4 override rejects imported thin adjacent wall sections',()=>{
  const p=make();p.walls=p.walls.map(w=>({...w,section:'50x50'}));const r=calculateDesigner(p);const corner=r.corners.find(c=>c.kind==='corner');p.joints.overrides[corner.id]={type:'closed4'};assert.equal(validateDesignerProject(p).valid,false);assert.throws(()=>calculateDesigner(p),{name:'DesignerValidationError'});
});
function twoLevels(){
  const p=make();p.floors=2;p.roof.type='none';p.levels=[{id:'level-1',index:1,name:'Первый',height:2.8},{id:'level-2',index:2,name:'Второй',height:3.1}];p.walls=p.walls.map(w=>({...w,level:1}));p.walls.push(...polygon([[0,0],[6,0],[6,8],[0,8]]).map(w=>({...w,id:'L2-'+w.id,level:2})));return p;
}
test('independent explicit floors support different contours, heights and stable level corner IDs',()=>{
  const p=twoLevels(),r=calculateDesigner(p);assert.equal(r.geometry.levels.length,2);near(r.geometry.levels[0].area,96);near(r.geometry.levels[1].area,48);near(r.geometry.totalFloorArea,144);near(r.geometry.levels[1].baseY,r.geometry.levels[0].topY);near(r.geometry.levels[1].wallBaseY,r.geometry.levels[1].baseY+r.timber.platformHeight);near(r.geometry.levels[1].topY,r.geometry.levels[1].wallBaseY+3.1);assert.ok(r.corners.filter(c=>c.level===2).every(c=>c.id.startsWith('j_2_')));assert.ok(r.timber.instances.filter(b=>b.wallId==='w-north').every(b=>b.level===1));assert.ok(r.timber.instances.filter(b=>b.wallId==='L2-w0').every(b=>b.level===2));near(r.geometry.grossWallArea,40*2.8+28*3.1);near(r.foundation.reactionSum,r.loads.totalDesign);assert.ok(r.piles.every(q=>pointInPolygon(q,r.geometry.polygon)));
});
test('double height cuts only upper platform, creates edge headers and reduces area loads exactly',()=>{
  const p=twoLevels(),before=calculateDesigner(p),voidPoly=[{x:1,y:2},{x:3,y:2},{x:3,y:6},{x:1,y:6}];p.voids=[{id:'v1',level:2,kind:'doubleHeight',polygon:voidPoly,edgeSection:'50x250'}];const r=calculateDesigner(p);near(r.geometry.levels[0].netFloorArea,96);near(r.geometry.levels[1].voidArea,8);near(r.geometry.levels[1].netFloorArea,40);near(r.geometry.totalFloorArea,136);near(before.loads.live-r.loads.live,8*p.loads.live);assert.ok(r.timber.instances.filter(b=>['voidHeader','openingHeader','openingTrimmer'].includes(b.role)).length>=4);
  const lower=r.timber.instances.filter(b=>b.role==='joist'&&b.level===1);assert.ok(lower.some(b=>[.25,.5,.75].some(t=>pointInPolygon({x:b.start[0]+(b.end[0]-b.start[0])*t,y:b.start[2]+(b.end[2]-b.start[2])*t},voidPoly,false))));
  for(const b of r.timber.instances.filter(b=>b.role==='joist'&&b.level===2)){const mid={x:(b.start[0]+b.end[0])/2,y:(b.start[2]+b.end[2])/2};assert.equal(pointInPolygon(mid,voidPoly,false),false);}
  near(r.foundation.reactionSum,r.loads.totalDesign);assert.equal(r.timber.instances.filter(b=>b.category==='walls').length,before.timber.instances.filter(b=>b.category==='walls').length);
});
test('level-dependent opening and custom object elevation are inherited from wall/floor',()=>{
  const p=twoLevels();p.openings=[{id:'upperWin',wallId:'L2-w0',offset:1,width:1.5,height:1.5,sill:.8,type:'window'}];p.objects=[{id:'upperPost',type:'post',a:{x:2,y:3},section:'100x100',height:3.1,level:2}];const r=calculateDesigner(p);const upper=r.timber.instances.find(b=>b.objectId==='upperPost');near(upper.start[1],r.geometry.levels[1].wallBaseY);assert.equal(upper.level,2);const headers=r.timber.instances.filter(b=>b.openingId==='upperWin');assert.ok(headers.length);assert.ok(headers.every(b=>b.level===2));p.openings[0].floor=1;assert.equal(validateDesignerProject(p).valid,false);
});
test('void import validation rejects overlapping, outside and wrong-floor second-light openings',()=>{
  const v={id:'v1',level:2,kind:'doubleHeight',polygon:[{x:1,y:1},{x:3,y:1},{x:3,y:3},{x:1,y:3}],edgeSection:'50x250'};
  for(const transform of [q=>q.level=1,q=>q.polygon[0].x=NaN,q=>q.polygon=[{x:5,y:1},{x:7,y:1},{x:7,y:3},{x:5,y:3}]]){const p=twoLevels(),q=cp(v);transform(q);p.voids=[q];assert.equal(validateDesignerProject(p).valid,false);}
  const p=twoLevels();p.voids=[v,{...cp(v),id:'v2'}];assert.equal(validateDesignerProject(p).valid,false);
});
test('roofModel absolute unsplit instances are stock-split once and use supplied areas/snow slopes',()=>{
  const p=twoLevels();p.roof.type='fink';const base=calculateDesigner(p),top=base.geometry.levels[1].topY;const roofModel={instances:[{name:'Пояс зоны',role:'bottom',b:50,h:150,start:[0,top,0],end:[0,top,8],zoneId:'z1'}],area:60,projectedArea:48,snowEffectiveArea:30,checks:[],warnings:[],assumptions:[],status:'unverified'};const r=calculateDesigner(p,{roofModel});near(r.geometry.roofArea,60);near(r.loads.snow,30*p.loads.snow);near(r.timber.totals.roof.mass,8*.05*.15*500);assert.ok(r.timber.instances.filter(b=>b.category==='roof').every(b=>b.cutLength<=6+1e-7));near(r.foundation.reactionSum,r.loads.totalDesign);assert.ok(r.timber.instances.filter(b=>b.category==='roof').every(b=>b.start[1]===top));
});
const roofZone=()=>({id:'z1',name:'Крыло дома',polygon:[{x:0,y:0},{x:12,y:0},{x:12,y:8},{x:0,y:8}],shape:'gable',ridgeAngle:0,pitchLeft:25,pitchRight:40,spacing:.6,chordSection:'50x150',webSection:'50x100',elevation:null,levelIndex:1});
test('roof-zone import accepts auto/none/valid zones and rejects corrupt objects before calculation',()=>{
  const p=make();assert.equal(validateDesignerProject(p).valid,true);p.roof.zones=[];assert.equal(validateDesignerProject(p).valid,true);p.roof.zones=[roofZone()];assert.equal(validateDesignerProject(p).valid,true);
  for(const zones of [[null],[false],{},null,[{...roofZone(),ridgeAngle:Infinity}],[{...roofZone(),pitchLeft:0}],[{...roofZone(),spacing:0}],[{...roofZone(),levelIndex:2}],[{...roofZone(),name:42}],[{...roofZone(),chordSection:'bad'}],[roofZone(),roofZone()]]){const q=make();q.roof.zones=zones;assert.equal(validateDesignerProject(q).valid,false);assert.throws(()=>calculateDesigner(q),{name:'DesignerValidationError'});}
});
test('roof-zone polygons reject self-crossing, nonfinite and collinear overlapping boundary imports',()=>{
  for(const polygon of [[{x:0,y:0},{x:4,y:4},{x:0,y:4},{x:4,y:0}],[{x:0,y:0},{x:4,y:0},{x:4,y:NaN},{x:0,y:4}],[{x:0,y:0},{x:4,y:0},{x:2,y:0},{x:2,y:4},{x:0,y:4}]]){const p=make();p.roof.zones=[{...roofZone(),polygon}];assert.equal(validateDesignerProject(p).valid,false);}
});

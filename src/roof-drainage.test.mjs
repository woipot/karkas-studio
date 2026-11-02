import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRoofDrainage,orientRoofsAwayFromWalls} from './roof-drainage.js';
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const rect=(a,b,c,d)=>[{x:a,y:b},{x:c,y:b},{x:c,y:d},{x:a,y:d}];
const surface=(id,zoneId,polygon,H)=>({id,zoneId,points:polygon.map(p=>[p.x,H(p.x,p.y),p.y])});
const ground=rect(0,0,10,8),base={geometry:{polygon:ground,levels:[{index:1,baseY:.72,wallBaseY:1.005,topY:3,height:1.995}]}};
const project={height:2.8,floors:1,walls:[],roof:{}};
const audit=(surfaces,p=project,b=base,zones=[])=>calculateRoofDrainage(p,b,{surfaces,zones});

test('plane gradient gives exact steepest downhill and all paths descend in real polygons',()=>{
  const r=audit([surface('s','z',ground,(x,z)=>3+.3*x+.4*z)]),s=r.surfaces[0];near(s.slope,.5);near(s.gradient[0],.3);near(s.gradient[1],.4);
  for(const f of r.flows){near(f.horizontalDirection[0],-.6);near(f.horizontalDirection[1],-.8);assert.ok(f.end[1]<f.start[1]);near((f.end[0]-f.start[0])/(f.end[2]-f.start[2]),.75);}
  near(r.quantities.projectedCatchmentArea,80);near(r.quantities.totalResolvedArea,80);near(r.quantities.catchmentBalanceError,0);
});
test('flat plane is unresolved instead of inventing an arbitrary downhill arrow',()=>{
  const r=audit([surface('flat','z',ground,()=>3)]);assert.equal(r.status,'fail');near(r.quantities.unresolvedArea,80);assert.ok(r.issues.some(i=>i.code==='flat-surface'));
});
test('opposing slopes classify a ridge and do not collect water at it',()=>{
  const r=audit([surface('a','z',rect(0,0,10,4),(x,z)=>3+.5*z),surface('b','z',rect(0,4,10,8),(x,z)=>7-.5*z)]);
  assert.ok(r.edges.some(e=>e.type==='ridge'));assert.ok(!r.edges.some(e=>e.type==='valley'));near(r.quantities.totalResolvedArea,80);near(r.quantities.gutterLength,20);
});
test('converging slopes into a horizontal valley have no fictional longitudinal outlet',()=>{
  const r=audit([surface('a','a',rect(0,0,10,4),(x,z)=>5-.5*z),surface('b','b',rect(0,4,10,8),(x,z)=>1+.5*z)]);
  near(r.quantities.valleyLength,10);near(r.quantities.unresolvedArea,80);assert.ok(r.issues.some(i=>i.code==='flat-valley'));assert.equal(r.status,'fail');
});
test('a graded valley can reach its low exterior endpoint and keeps the water-area balance',()=>{
  const r=audit([surface('a','a',rect(0,0,10,4),(x,z)=>5-.5*z+.1*x),surface('b','b',rect(0,4,10,8),(x,z)=>1+.5*z+.1*x)]);
  assert.ok(r.edges.some(e=>e.type==='valley'));near(r.quantities.totalResolvedArea,80);near(r.quantities.catchmentBalanceError,0);assert.ok(!r.issues.some(i=>i.code==='flat-valley'));
});
test('raised platform rim is a wall barrier and suggested mono points away from it',()=>{
  const p={...project,floors:2,walls:[{id:'high',level:2,kind:'exterior',a:{x:0,y:4},b:{x:10,y:4}}]};
  const b={geometry:{polygon:ground,levels:[{index:1,baseY:.72,topY:3},{index:2,baseY:3,wallBaseY:3.3,topY:6}]}};
  const zones=[{id:'lower',polygon:rect(0,0,10,4),eave:3.1,pitchLeft:25}],roof={zones,surfaces:[surface('low','lower',zones[0].polygon,(x,z)=>5.1-.5*z)]};
  const r=calculateRoofDrainage(p,b,roof);near(r.quantities.unresolvedArea,40);assert.ok(r.flows.some(f=>f.status==='wallBlock'));assert.ok(r.edges.some(e=>e.wallBottom===3));
  const fix=orientRoofsAwayFromWalls(p,b,roof);assert.equal(fix.suggestions.length,1);near(fix.zones[0].ridgeAngle,0);assert.equal(fix.zones[0].shape,'mono');
});
test('lower flashing and upper gutter have separate elevations on a stepped roof-wall joint',()=>{
  const p={...project,floors:2,walls:[{id:'high',level:2,kind:'exterior',a:{x:0,y:4},b:{x:10,y:4}}]},b={geometry:{polygon:ground,levels:[{index:2,baseY:3,wallBaseY:3.3,topY:6}]}};
  const r=audit([surface('low','lower',rect(0,0,10,4),(x,z)=>3+.5*z),surface('high','upper',rect(0,4,10,8),(x,z)=>6+.2*(z-4))],p,b);
  const flash=r.edges.find(e=>e.type==='wall-abutment');assert.ok(flash);near(flash.start[1],5);near(flash.end[1],5);assert.equal(flash.flowIntoWall,false);
  const gutter=r.gutters.find(g=>Math.abs(g.start[1]-6)<1e-6&&Math.abs(g.start[2]-4)<1e-6);assert.ok(gutter);assert.ok(gutter.downpipeId);assert.ok(r.flows.some(f=>f.status==='roofTransfer'));
  assert.equal(r.checks.find(c=>c.id==='drainage-cascade').status,'unverified');
});
test('an interior roof island has no exterior outlet despite a free facet edge',()=>{
  const r=audit([surface('island','z',rect(2,2,6,6),(x,z)=>3+.5*z)]);near(r.quantities.projectedCatchmentArea,16);near(r.quantities.unresolvedArea,16);near(r.quantities.totalResolvedArea,0);assert.equal(r.quantities.downpipeCount,0);assert.equal(r.status,'fail');assert.equal(r.checks.find(c=>c.id==='drainage-gutter-outlet').status,'fail');
});
test('a roof facet intersecting upper walls internally is an explicit geometric failure',()=>{
  const points=rect(3,2,7,6),walls=points.map((a,i)=>({id:'w'+i,kind:'exterior',level:2,a,b:points[(i+1)%points.length]}));
  const p={...project,floors:2,walls},b={geometry:{polygon:ground,levels:[{index:2,baseY:3,wallBaseY:3.3,topY:6}]}};
  const r=audit([surface('collision','z',ground,(x,z)=>3+.1*z)],p,b);assert.ok(r.issues.some(i=>i.code==='interior-roof-wall-crossing'));near(r.quantities.totalResolvedArea,0);near(r.quantities.unresolvedArea,80);assert.equal(r.status,'fail');
});
test('partial high-wall/T-junction splits the catchment at its actual endpoint',()=>{
  const p={...project,floors:2,walls:[{id:'half',level:2,kind:'exterior',a:{x:0,y:4},b:{x:5,y:4}}]},b={geometry:{polygon:ground,levels:[{index:2,baseY:3,topY:6}]}};
  const r=audit([surface('low','lower',rect(0,0,10,4),(x,z)=>5-.5*z)],p,b);near(r.flows.filter(f=>f.status==='wallBlock').reduce((s,f)=>s+f.catchmentArea,0),20);near(r.quantities.projectedCatchmentArea,40);near(r.quantities.catchmentBalanceError,0);
});
test('own supporting wall at the eave does not block drainage',()=>{
  const p={...project,walls:[{id:'support',level:1,kind:'exterior',a:{x:0,y:0},b:{x:10,y:0}}]};
  const r=audit([surface('roof','z',ground,(x,z)=>3+.5*z)],p);assert.ok(!r.flows.some(f=>f.status==='wallBlock'));near(r.quantities.totalResolvedArea,80);
});
test('pipe quantity equals its full geometric route including the upper connector',()=>{
  const r=audit([surface('roof','z',ground,(x,z)=>3+.5*z)]);assert.ok(r.downpipes.length);
  for(const d of r.downpipes){const actual=d.path.slice(1).reduce((s,p,i)=>s+Math.hypot(...p.map((v,k)=>v-d.path[i][k])),0);near(d.length,actual);near(d.length,d.verticalLength+.18);}
  near(r.quantities.downpipeLength,r.downpipes.reduce((s,d)=>s+d.length,0));
});
test('malformed and nonplanar surfaces are flagged without throwing or false approval',()=>{
  const r=audit([null,{id:'bad',points:[[0,3,0],[1,3,0],[1,4,1],[0,3,1]]}]);assert.equal(r.status,'fail');assert.ok(r.issues.some(i=>i.code==='invalid-surface'));assert.ok(r.issues.some(i=>i.code==='nonplanar-surface'));
});

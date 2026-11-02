import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGrillage,checkGrillageSpan} from './grillage.js';

const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const polygonArea=p=>Math.abs(p.reduce((s,a,i)=>s+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0))/2;
function fixture(polygon=[{x:0,y:0},{x:12,y:0},{x:12,y:8},{x:0,y:8}],extraWalls=[]){
  const walls=polygon.map((a,i)=>({id:'w'+i,kind:'exterior',a,b:polygon[(i+1)%polygon.length],section:'50x150'})).concat(extraWalls);
  const project={walls,material:{density:500},floor:{axis:'y'},foundation:{spacing:2,capacity:40,grillage:{section:'50x200',plies:3,deflectionRatio:300,capSize:250}}};
  return {project,base:{geometry:{closed:true,polygon,levels:[{index:1,polygon}]},walls}};
}
function inside(q,p){if(p.some((a,i)=>{const b=p[(i+1)%p.length];return Math.abs(cross(a,b,q))<1e-7&&q.x>=Math.min(a.x,b.x)-1e-7&&q.x<=Math.max(a.x,b.x)+1e-7&&q.y>=Math.min(a.y,b.y)-1e-7&&q.y<=Math.max(a.y,b.y)+1e-7;}))return true;let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function body(b){const a={x:b.start[0],y:b.start[2]},z={x:b.end[0],y:b.end[2]},half=b.b/2000,v={x:b.crossAxis[0],y:b.crossAxis[2]};const p=[{x:a.x-v.x*half,y:a.y-v.y*half},{x:z.x-v.x*half,y:z.y-v.y*half},{x:z.x+v.x*half,y:z.y+v.y*half},{x:a.x+v.x*half,y:a.y+v.y*half}];return cross(p[0],p[1],p[2])<0?p.reverse():p;}
function overlap(a,b){let p=a;for(let i=0;i<b.length&&p.length;i++){const c=b[i],d=b[(i+1)%b.length],out=[];for(let j=0;j<p.length;j++){const q=p[j],r=p[(j+1)%p.length],f=cross(c,d,q),g=cross(c,d,r);if(f>=-1e-10)out.push(q);if((f>=0)!==(g>=0)){const t=f/(f-g);out.push({x:q.x+(r.x-q.x)*t,y:q.y+(r.y-q.y)*t});}}p=out;}return p.length>=3?polygonArea(p):0;}

test('rectangular grillage has real support topology and no floating grid piles',()=>{
  const f=fixture(),r=buildGrillage(f.project,f.base);
  assert.equal(r.beams.length,7);assert.equal(r.piles.length,35);assert.equal(r.spans.length,38);
  near(r.pileHeadY,.72);near(r.beamBottomY,.72);near(r.topY,.92);
  for(const b of r.beams){assert.equal(typeof b.b,'object');assert.equal(b.section.b,50);near(b.stations[0].station,0);near(b.stations.at(-1).station,b.length);near(r.spans.filter(s=>s.beamId===b.id).reduce((s,p)=>s+p.length,0),b.length);}
  for(const p of r.piles){assert.ok(p.beamIds.length);assert.ok(p.stationRefs.length);for(const ref of p.stationRefs){const b=r.beams.find(b=>b.id===ref.beamId),s=b.stations.find(s=>s.pileId===p.id);near(length(s.point,p),0);}}
  for(const s of r.spans){assert.ok(s.length<=2+1e-8);near(s.length,length(s.start,s.end));assert.ok(r.piles.some(p=>p.id===s.startPileId));assert.ok(r.piles.some(p=>p.id===s.endPileId));assert.notEqual(s.startPileId,s.endPileId);}
});

test('on-edge plies touch the cap at .72 and occupy distinct side-by-side volumes',()=>{
  const f=fixture(),r=buildGrillage(f.project,f.base);
  for(const b of r.instances){assert.equal(b.category,'foundation');assert.equal(b.role,'grillagePly');assert.ok(b.plyIndex>=0&&b.plyIndex<3);near(b.start[1]-.2/2,.72);near(b.end[1]+.2/2,.92);assert.equal(b.crossAxis[1],0);near(b.length,Math.hypot(...b.end.map((v,i)=>v-b.start[i])));near(b.volume,.05*.2*b.length);near(b.mass,b.volume*500);}
  for(let i=0;i<r.instances.length;i++)for(let j=i+1;j<r.instances.length;j++)assert.ok(overlap(body(r.instances[i]),body(r.instances[j]))<1e-8,`${r.instances[i].id} intersects ${r.instances[j].id}`);
  // A 150 mm package union: perimeter ring + three interior 11.85 m lines.
  near(r.quantities.volume,(40+3*11.85)*.15*.2);near(r.quantities.mass,r.quantities.volume*500);
});

test('all longitudinal joints land on a pile and adjacent ply joints are staggered',()=>{
  const f=fixture(),r=buildGrillage(f.project,f.base),splices=r.joints.filter(j=>j.type==='splice');assert.ok(splices.length);
  for(const j of splices){const pile=r.piles.find(p=>p.id===j.pileId),b=r.beams.find(b=>b.id===j.beamId);assert.ok(pile);assert.equal(j.scheme,'butt');assert.equal(j.supported,true);near(length(j.point,pile),0);assert.ok(b.stations.some(s=>s.pileId===j.pileId&&Math.abs(s.station-j.station)<1e-8));assert.ok(j.staggered);for(const other of splices.filter(o=>o.beamId===j.beamId&&Math.abs(o.plyIndex-j.plyIndex)===1))assert.ok(Math.abs(j.station-other.station)>=.4064-1e-8);}
  for(const b of r.instances){assert.equal(b.requireSingleStock,true);assert.ok(b.cutLength<=6+1e-8);assert.equal(b.cutStart.scheme,'butt');assert.equal(b.cutEnd.scheme,'butt');assert.ok(r.piles.some(p=>p.id===b.startPileId));assert.ok(r.piles.some(p=>p.id===b.endPileId));}
});

test('L footprint clips support lines exactly and does not frame across its missing wing',()=>{
  const polygon=[{x:0,y:0},{x:8,y:0},{x:8,y:3},{x:4,y:3},{x:4,y:7},{x:0,y:7}],f=fixture(polygon,[{id:'bearing',kind:'bearing',level:1,a:{x:-2,y:1},b:{x:10,y:1},section:'50x150'}]),r=buildGrillage(f.project,f.base);
  near(r.quantities.footprintArea,40);
  for(const b of r.beams)for(let i=0;i<=40;i++)assert.ok(inside({x:b.a.x+(b.b.x-b.a.x)*i/40,y:b.a.y+(b.b.y-b.a.y)*i/40},polygon));
  for(const p of r.piles){assert.ok(inside(p,polygon));assert.ok(!(p.x>4+1e-8&&p.y>3+1e-8));}
  const bearing=r.beams.find(b=>b.wallIds.includes('bearing'));assert.ok(bearing);near(bearing.a.x,0);near(bearing.b.x,8);
});

test('bearing and grid collinear overlap is one beam; upper-floor bearing is not a foundation line',()=>{
  const f=fixture(undefined,[{id:'bearing',kind:'bearing',level:1,a:{x:0,y:4},b:{x:12,y:4},section:'50x150'},{id:'upper',kind:'bearing',level:2,a:{x:0,y:3},b:{x:12,y:3},section:'50x150'}]),r=buildGrillage(f.project,f.base);
  assert.equal(r.beams.length,7);assert.equal(r.beams.filter(b=>b.wallIds.includes('bearing')).length,1);assert.ok(!r.beams.some(b=>b.sources.includes('upper')));
});

test('turning joists rotates only the added transverse support system',()=>{
  const f=fixture();f.project.floor.axis='x';const r=buildGrillage(f.project,f.base),internal=r.beams.filter(b=>b.kind==='floorSupport');assert.equal(internal.length,5);assert.ok(internal.every(b=>Math.abs(b.a.x-b.b.x)<1e-8));
  assert.ok(internal.every(b=>Math.abs(b.u.x)<1e-8&&Math.abs(b.u.y-1)<1e-8));
});

test('a requested six-metre pile interval still produces physical stock at most six metres',()=>{
  const f=fixture();f.project.foundation.spacing=6;const r=buildGrillage(f.project,f.base);
  assert.ok(r.instances.every(b=>b.length<=6+1e-8));assert.ok(r.spans.every(s=>s.length<=6+1e-8));assert.ok(r.piles.some(p=>p.stationRefs.some(ref=>ref.station>0)));
  assert.ok(!r.checks.some(c=>c.status==='fail'));
});

test('orthogonal X/T butt cuts remove crossings without subtracting invented notches',()=>{
  const f=fixture(undefined,[{id:'vertical-bearing',kind:'bearing',level:1,a:{x:6,y:0},b:{x:6,y:8},section:'50x150'}]),r=buildGrillage(f.project,f.base);
  assert.ok(r.joints.some(j=>j.type==='node'&&j.beamIds.length===2&&j.point.x===6&&j.point.y===4));
  for(let i=0;i<r.instances.length;i++)for(let j=i+1;j<r.instances.length;j++)assert.ok(overlap(body(r.instances[i]),body(r.instances[j]))<1e-8,`${r.instances[i].id}/${r.instances[j].id}`);
  assert.ok(r.instances.every(b=>!b.notches));assert.ok(!r.checks.some(c=>c.status==='fail'));
});

test('acute nodes that cannot fit a small cap explicitly fail their bearing geometry',()=>{
  const f=fixture(undefined,[{id:'diagonal',kind:'bearing',level:1,a:{x:0,y:1},b:{x:12,y:7},section:'50x150'}]),r=buildGrillage(f.project,f.base);
  assert.equal(r.status,'fail');assert.ok(r.checks.some(c=>c.id.startsWith('grillage-bearing-')&&c.status==='fail'));
  assert.ok(r.checks.some(c=>c.id.startsWith('grillage-node-')&&c.status==='unverified'));
});

test('with a sufficiently wide cap, skew bearing lines have distinct real board volumes',()=>{
  const f=fixture(undefined,[{id:'diagonal',kind:'bearing',level:1,a:{x:0,y:1},b:{x:12,y:7},section:'50x150'}]);f.project.foundation.grillage.capSize=1000;const r=buildGrillage(f.project,f.base);
  assert.ok(!r.checks.some(c=>c.status==='fail'));
  for(let i=0;i<r.instances.length;i++)for(let j=i+1;j<r.instances.length;j++)assert.ok(overlap(body(r.instances[i]),body(r.instances[j]))<1e-8,`${r.instances[i].id}/${r.instances[j].id}`);
});

test('UDL mechanics benchmark has correct units and linear sum of ply inertias',()=>{
  const input={length:2,b:50,h:200,plies:3,E:10000,Fb:13,Fv:1.5,deflectionRatio:300,designLineLoad:10,serviceLineLoad:7},r=checkGrillageSpan(input),one=checkGrillageSpan({...input,plies:1});
  near(r.I,100000000);near(r.W,1000000);near(r.M,5);near(r.V,10);near(r.stress.bending,5);near(r.stress.shear,.5);near(r.deflection.value,1.4583333333333333);near(r.deflection.allowed,2000/300);
  near(r.I,3*one.I);near(one.deflection.value,3*r.deflection.value);near(r.reactions.designA+r.reactions.designB,20);assert.equal(r.capacityPass,true);assert.equal(r.status,'unverified');
  const limit=checkGrillageSpan({...input,length:r.maxSpan});near(limit.maxUtilization,1);assert.equal(checkGrillageSpan({...input,length:r.maxSpan*1.1}).status,'fail');
});

test('input and stock are not mutated, zero loading is valid and invalid material inputs fail gracefully',()=>{
  const f=fixture(),before=JSON.stringify(f);buildGrillage(f.project,f.base);assert.equal(JSON.stringify(f),before);
  const zero=checkGrillageSpan({length:2,b:50,h:200,plies:3,E:10000,Fb:13,Fv:1.5,designLineLoad:0,serviceLineLoad:0});assert.equal(zero.maxSpan,null);assert.equal(zero.maxUtilization,0);
  assert.equal(checkGrillageSpan({length:2,b:50,h:200,plies:3,E:0,Fb:13,designLineLoad:1,serviceLineLoad:1}).status,'fail');
  f.project.foundation.grillage.plies=2.5;assert.equal(buildGrillage(f.project,f.base).status,'fail');
});

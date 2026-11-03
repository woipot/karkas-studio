import test from 'node:test';
import assert from 'node:assert/strict';
import {generateHouse} from './house-generator.js';
import {calculateDesigner,validateDesignerProject} from './designer-engine.js';
import {calculateCutting} from './cutting.js';
import {cutGeometry} from './board-geometry.js';

const G=9.80665,EPS=1e-6;
const sum=(a,f=x=>x)=>a.reduce((s,q)=>s+f(q),0);
const near=(a,b,t=EPS)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} != ${b}`);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function fixture(mode='shared'){
  const {project:p}=generateHouse({name:'Общая рама QA',width:8,depth:6,sections:{walls:'50x150',floor:'48x198',grillage:'75x248'},foundation:{spacing:2,capacity:200,grillage:{plies:3,capSize:350,deflectionRatio:300}},bracing:{method:'none'}});
  const wall=p.walls.find(w=>w.a.y===0&&w.b.y===0);
  p.roof.type='none';p.floor.rimSection='48x198';
  p.foundation.grillage.crossTies={spacing:2,pileSpacing:3,positions:[2,4,6]};
  p.openings=[{id:'D-ACCESS',wallId:wall.id,type:'door',offset:2,width:1,height:2.1,sill:0}];
  p.annexes=[{id:'A',name:'Веранда',kind:'coveredTerrace',attachedWallId:wall.id,offset:1.2,width:4,depth:2,gap:.075,
    foundation:{mode,spacing:3.5,capacity:p.foundation.capacity,edgeInset:.35,pileHeadY:mode==='shared'?.72:null,grillage:{...p.foundation.grillage}},
    floor:{section:'48x198',spacing:.5,deckThickness:.028,blockingStep:1.2},
    roof:{section:'75x248',beamSection:'98x248',postSection:'98x98',pitch:10,spacing:.5}}];
  delete p.annexes[0].foundation.grillage.crossTies;
  return p;
}
const calculate=p=>{const v=validateDesignerProject(p);assert.equal(v.valid,true,JSON.stringify(v.errors));return calculateDesigner(p);};
function moments(samples,key='design'){
  return samples.reduce((s,q)=>({N:s.N+q[key],Mx:s.Mx+q[key]*q.point.y,My:s.My+q[key]*q.point.x}),{N:0,Mx:0,My:0});
}
function nearMoments(a,b){for(const k of ['N','Mx','My'])near(a[k],b[k],1e-5);}
function projectedSpanSamples(spans,key='design'){
  return spans.flatMap(s=>s.pointLoads.map(q=>({point:{x:s.start.x+(s.end.x-s.start.x)*q.at/s.length,y:s.start.y+(s.end.y-s.start.y)*q.at/s.length},[key]:q[key]})));
}
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function hull(points){
  const p=points.sort((a,b)=>a.x-b.x||a.y-b.y).filter((q,i,a)=>!i||dist(q,a[i-1])>1e-9);
  const half=list=>{const h=[];for(const q of list){while(h.length>1&&cross(h.at(-2),h.at(-1),q)<=1e-10)h.pop();h.push(q);}return h;};
  return half(p).slice(0,-1).concat(half([...p].reverse()).slice(0,-1));
}
function meshPlan(b){
  const mesh=cutGeometry(b),pos=mesh.attributes.position,axis=b.end.map((q,i)=>(q-b.start[i])/b.length),width=b.crossAxis;
  const p=[];for(let i=0;i<pos.count;i++)p.push({x:(b.start[0]+b.end[0])/2+width[0]*pos.getX(i)+axis[0]*pos.getY(i),y:(b.start[2]+b.end[2])/2+width[2]*pos.getX(i)+axis[2]*pos.getY(i)});
  mesh.dispose();return hull(p);
}
function positivePlanOverlap(A,B,tolerance=2e-6){
  for(const P of [A,B])for(let i=0;i<P.length;i++){
    const a=P[i],b=P[(i+1)%P.length],d=dist(a,b),n={x:-(b.y-a.y)/d,y:(b.x-a.x)/d};
    const pa=A.map(q=>q.x*n.x+q.y*n.y),pb=B.map(q=>q.x*n.x+q.y*n.y);
    if(Math.min(Math.max(...pa),Math.max(...pb))-Math.max(Math.min(...pa),Math.min(...pb))<tolerance)return false;
  }
  return true;
}
function crossing(A,B){
  const dx=A.b.x-A.a.x,dy=A.b.y-A.a.y,ex=B.b.x-B.a.x,ey=B.b.y-B.a.y,den=dx*ey-dy*ex;
  if(Math.abs(den)<1e-8)return null;
  const px=B.a.x-A.a.x,py=B.a.y-A.a.y,t=(px*ey-py*ex)/den,u=(px*dy-py*dx)/den;
  return t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS?{x:A.a.x+t*dx,y:A.a.y+t*dy}:null;
}

test('one connected shared foundation places every T/X node on one canonical pile',()=>{
  const p=fixture(),r=calculate(p),g=r.grillageModel,a=r.annexes.items[0];
  assert.deepEqual(r.checks.filter(c=>c.status==='fail').map(c=>({id:c.id,note:c.note})),[]);
  assert.equal(a.foundation.shared,true);assert.ok(g.beams.some(b=>b.kinds.includes('annexConnector')));assert.ok(g.beams.some(b=>b.kinds.includes('transverseTie')));
  assert.equal(new Set(r.piles.map(q=>q.id)).size,r.piles.length);assert.equal(r.piles.length,g.piles.length);
  assert.equal(new Set(r.piles.map(q=>`${q.x.toFixed(7)}:${q.y.toFixed(7)}`)).size,r.piles.length);
  const adjacency=new Map(g.piles.map(q=>[q.id,[]]));for(const s of g.spans){adjacency.get(s.startPileId).push(s.endPileId);adjacency.get(s.endPileId).push(s.startPileId);}
  const seen=new Set(),todo=[g.piles[0].id];while(todo.length){const id=todo.pop();if(seen.has(id))continue;seen.add(id);todo.push(...adjacency.get(id));}assert.equal(seen.size,g.piles.length);
  for(let i=0;i<g.beams.length;i++)for(let j=0;j<i;j++){const q=crossing(g.beams[i],g.beams[j]);if(!q)continue;const piles=g.piles.filter(p=>dist(p,q)<EPS);assert.equal(piles.length,1);assert.ok(piles[0].beamIds.includes(g.beams[i].id)&&piles[0].beamIds.includes(g.beams[j].id));}
  for(const q of a.foundation.piles)assert.ok(r.piles.some(p=>p.id===q.id&&dist(p,q)<EPS));
  assert.ok(r.checks.some(c=>c.status==='unverified'&&/пространствен|совместн|креп|сло[ёе]/i.test(c.note??'')));
});

test('actual canonical foundation mesh has no positive-volume double wood, unsupported stock joins or overlength pieces',()=>{
  const r=calculate(fixture()),g=r.grillageModel,pieces=r.timber.instances.filter(b=>b.category==='foundation'),shapes=pieces.map(b=>meshPlan(b));
  assert.equal(pieces.length,g.instances.length);assert.equal(new Set(pieces.map(b=>b.id)).size,pieces.length);
  for(let i=0;i<pieces.length;i++){
    const b=pieces[i];near(b.length,Math.hypot(...b.end.map((q,j)=>q-b.start[j])));near(b.volume,b.b*b.h*b.length/1e6);assert.ok(b.cutLength<=6+EPS);assert.equal(b.requireSingleStock,true);
    for(let j=0;j<i;j++)assert.equal(positivePlanOverlap(shapes[i],shapes[j]),false,`${b.id} overlaps ${pieces[j].id}`);
  }
  for(const j of g.joints){assert.equal(j.supported,true);assert.equal(j.connectionVerified,false);assert.ok(g.piles.some(p=>p.id===j.pileId&&dist(p,j.point)<EPS));}
});

test('common foundation timber, procurement and full gravity occur exactly once',()=>{
  const p=fixture(),r=calculate(p),a=r.annexes.items[0],cut=calculateCutting(p,r),found=r.timber.instances.filter(b=>b.category==='foundation');
  assert.equal(a.instances.filter(b=>b.category==='foundation').length,0);assert.equal(a.foundation.instances.length,0);
  near(sum(found,b=>b.mass),r.grillageModel.quantities.mass);near(r.timber.totals.foundation.mass,r.grillageModel.quantities.mass);near(a.quantities.woodMass,sum(a.instances,b=>b.mass));
  const row=r.loads.rows.filter(q=>q.id==='timber-foundation');assert.equal(row.length,1);near(row[0].characteristic,sum(found,b=>b.mass)*G/1000);
  near(r.timber.mass,sum(r.timber.instances,b=>b.mass));near(r.loads.totalDesign,sum(r.loads.rows,q=>q.design));near(r.loads.totalCharacteristic,sum(r.loads.rows,q=>q.characteristic));near(r.foundation.reactionSum,r.loads.totalDesign);
  assert.equal(cut.invalid.length,0);assert.equal(cut.overlength.length,0);assert.equal(cut.summary.pieces,r.timber.instances.length);
  const ids=cut.stocks.flatMap(s=>s.pieces.map(p=>p.sourceId));for(const b of r.timber.instances)assert.equal(ids.filter(id=>id===b.id).length,1,b.id);
  for(const s of cut.stocks){near(s.used,sum(s.pieces,q=>q.length));near(s.kerfWaste,Math.max(0,s.pieces.length-1)*p.cutting.kerf/1000);near(s.used+s.kerfWaste+s.remainder,6);assert.ok(s.consumed<=6+EPS);}
});

test('local annex span loads retain force and both plan moments in canonical coordinates',()=>{
  const r=calculate(fixture()),a=r.annexes.items[0],samples=a.sharedLoadSamples;
  assert.ok(samples.length>0);near(sum(samples,q=>q.design),a.loads.totalDesign);near(sum(samples,q=>q.characteristic),a.loads.totalCharacteristic);
  for(const key of ['design','characteristic'])nearMoments(moments(samples,key),moments(projectedSpanSamples(a.foundation.spans,key),key));
  for(const q of samples){const b=r.grillageModel.beams.find(b=>b.id===q.beamId);assert.ok(b&&b.sources.some(s=>s===`annex:A:${q.localSpanId.split('-S')[0]}`));assert.equal(q.annexId,'A');const along=((q.point.x-b.a.x)*(b.b.x-b.a.x)+(q.point.y-b.a.y)*(b.b.y-b.a.y))/b.length;assert.ok(along>=-EPS&&along<=b.length+EPS);near(Math.abs((q.point.x-b.a.x)*(b.b.y-b.a.y)-(q.point.y-b.a.y)*(b.b.x-b.a.x))/b.length,0);}
  // The strict moment screen is span point loads -> end piles. The earlier
  // midpoint-area -> nearest-beam transverse allocation is an explicit model assumption.
  const g=r.grillageModel;for(const [key,reaction] of [['design','reaction'],['characteristic','reactionCharacteristic']])nearMoments(moments(projectedSpanSamples(g.spans,key),key),moments(r.piles.map(q=>({point:q,[key]:q[reaction]})),key));
  near(sum(g.spans,s=>s.designTotal),r.loads.totalDesign);near(g.unassignedDesign,0);near(g.unassignedCharacteristic,0);
});

test('doubling density changes only one copy of every installed timber member and its factored gravity',()=>{
  const p=fixture(),a=calculate(p);p.material.density*=2;const b=calculate(p);
  near(b.timber.mass,2*a.timber.mass);near(b.loads.dead-a.loads.dead,a.timber.mass*G/1000);near(b.loads.totalDesign-a.loads.totalDesign,a.timber.mass*G/1000*p.loads.gammaG);near(b.foundation.reactionSum-a.foundation.reactionSum,b.loads.totalDesign-a.loads.totalDesign);
  near(b.annexes.items[0].loads.dead-a.annexes.items[0].loads.dead,a.annexes.items[0].quantities.woodMass*G/1000);
});

test('independent legacy annex remains unchanged when its explicit mode is omitted',()=>{
  const p=fixture('independent'),a=calculate(p);delete p.annexes[0].foundation.mode;const b=calculate(p);
  assert.deepEqual(a.timber,b.timber);assert.deepEqual(a.piles,b.piles);assert.deepEqual(a.loads,b.loads);assert.deepEqual(a.grillageModel,b.grillageModel);
  assert.ok(a.annexes.items[0].instances.some(b=>b.category==='foundation'));assert.ok(a.piles.length>a.grillageModel.piles.length);
});

test('shared graph rejects differing foundation elevations and capacity/section assumptions before calculation',()=>{
  for(const change of [a=>a.foundation.pileHeadY=.8,a=>a.deckTopY=2,a=>a.foundation.grillage.section='75x200',a=>a.foundation.grillage.plies=2,a=>a.foundation.grillage.capSize=400,a=>a.foundation.capacity=100]){
    const p=fixture();change(p.annexes[0]);assert.equal(validateDesignerProject(p).valid,false);assert.throws(()=>calculateDesigner(p),{name:'DesignerValidationError'});
  }
  const p=fixture(),theta=.23,rotate=q=>({x:q.x*Math.cos(theta)-q.y*Math.sin(theta),y:q.x*Math.sin(theta)+q.y*Math.cos(theta)});
  for(const w of p.walls){w.a=rotate(w.a);w.b=rotate(w.b);}assert.equal(validateDesignerProject(p).valid,false);assert.throws(()=>calculateDesigner(p),{name:'DesignerValidationError'});
});

test('all shared component support and joint references resolve to physical canonical IDs',()=>{
  const r=calculate(fixture()),a=r.annexes.items[0],pileIds=new Set(r.grillageModel.piles.map(q=>q.id)),beamIds=new Set(r.grillageModel.beams.map(q=>q.id));
  for(const span of a.foundation.spans){assert.ok(beamIds.has(span.beamId),span.beamId);assert.ok(pileIds.has(span.startPileId),span.startPileId);assert.ok(pileIds.has(span.endPileId),span.endPileId);}
  for(const joint of a.foundation.joints){assert.ok(pileIds.has(joint.pileId),joint.pileId);for(const id of [joint.beamId,joint.primaryBeamId,...joint.beamIds??[]].filter(Boolean))assert.ok(beamIds.has(id),id);}
  for(const post of a.roof.posts)assert.ok(pileIds.has(post.supportedPileId),post.supportedPileId);
  for(const component of r.foundation.components)for(const id of component.pileIds)assert.ok(r.piles.some(p=>p.id===id),`${component.id}: ${id}`);
});

test('an independent annex can coexist with a shared frame without losing or duplicating either foundation',()=>{
  const p=fixture(),shared=calculate(p),other=structuredClone(p.annexes[0]),wall=p.walls.find(w=>w.a.y===6&&w.b.y===6);
  other.id='B';other.name='Независимая веранда';other.attachedWallId=wall.id;other.foundation.mode='independent';other.foundation.pileHeadY=null;
  p.annexes.push(other);p.openings.push({id:'D-OTHER',wallId:wall.id,type:'door',offset:2,width:1,height:2.1,sill:0});
  const r=calculate(p),a=r.annexes.items.find(a=>a.id==='A'),b=r.annexes.items.find(a=>a.id==='B');
  assert.equal(a.foundation.shared,true);assert.equal(b.foundation.shared,false);assert.equal(r.piles.length,r.grillageModel.piles.length+b.foundation.piles.length);assert.equal(new Set(r.piles.map(p=>p.id)).size,r.piles.length);
  assert.deepEqual(r.grillageModel.instances,shared.grillageModel.instances);
  near(r.timber.totals.foundation.mass,shared.timber.totals.foundation.mass+sum(b.instances.filter(q=>q.category==='foundation'),q=>q.mass));
  near(r.loads.totalDesign,sum(r.piles,p=>p.reaction));near(r.loads.totalCharacteristic,sum(r.piles,p=>p.reactionCharacteristic));near(r.loads.totalDesign,sum(r.loads.rows,q=>q.design));
  for(const q of b.foundation.piles)assert.ok(r.piles.some(p=>p.id===q.id&&dist(p,q)<EPS));
  near(sum(r.grillageModel.piles,q=>q.reaction)+sum(b.foundation.piles,q=>q.reaction),r.loads.totalDesign);
});

test('distinct nearby pile caps cannot overlap silently even when their timber packages clear each other',()=>{
  const p=fixture(),r0=calculate(p),connector=r0.grillageModel.beams.find(b=>b.kinds.includes('annexConnector'));
  const gap=(r0.grillageModel.width+p.foundation.grillage.capSize/1000)/2;
  p.foundation.grillage.crossTies.positions=[connector.a.x+gap];const r=calculate(p),overlaps=[];
  for(let i=0;i<r.grillageModel.piles.length;i++)for(let j=0;j<i;j++){
    const a=r.grillageModel.piles[i],b=r.grillageModel.piles[j],halfSum=(a.capSize+b.capSize)/2000;
    if(Math.abs(a.x-b.x)<halfSum-EPS&&Math.abs(a.y-b.y)<halfSum-EPS)overlaps.push([a.id,b.id]);
  }
  assert.ok(overlaps.length>0,'Fixture must create two physically distinct overlapping caps.');
  assert.ok(r.checks.some(c=>c.status==='fail'&&/оголов|cap.*overlap/i.test([c.id,c.label,c.note].join(' '))));
});

test('shared omitted foundation properties inherit the canonical frame without inventing separate capacities',()=>{
  const p=fixture(),expected=calculate(p);p.annexes[0].foundation={mode:'shared',spacing:3.5,edgeInset:.35};
  const r=calculate(p);assert.deepEqual(r.grillageModel.instances,expected.grillageModel.instances);assert.deepEqual(r.piles,expected.piles);near(r.loads.totalDesign,expected.loads.totalDesign);assert.equal(r.annexes.items[0].input.foundation.capacity,p.foundation.capacity);assert.equal(r.annexes.items[0].input.foundation.grillage.section,p.foundation.grillage.section);
});

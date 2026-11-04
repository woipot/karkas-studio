import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDesigner,defaultDesignerProject} from './designer-engine.js';
import {checkDesignerMembers} from './designer-mechanics.js';
import {calculateCutting} from './cutting.js';
import {cutGeometry} from './board-geometry.js';
const EPS=1e-6,G=9.80665,sum=(a,f=x=>x)=>a.reduce((s,q)=>s+f(q),0),near=(a,b,t=EPS)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} != ${b}`),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),area=P=>Math.abs(P.reduce((s,a,i)=>s+a.x*P[(i+1)%P.length].y-P[(i+1)%P.length].x*a.y,0))/2;
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
function fixture(axis='y'){
  const p=structuredClone(defaultDesignerProject),points=rect(.075,.075,5.925,4.925);p.floors=1;p.levels=[{id:'L1',index:1,name:'Первый',height:2.8}];p.height=2.8;p.walls=points.map((a,i)=>({id:'E'+i,kind:'exterior',level:1,a,b:points[(i+1)%points.length],section:'75x150',studStep:.6}));
  p.walls.push({id:'P-PAR',kind:'partition',level:1,a:{x:2.2,y:.15},b:{x:2.2,y:3.4},section:'48x98',studStep:.6,endpointMode:'faces',height:2.75},{id:'P-CROSS',kind:'partition',level:1,a:{x:1.2,y:1.8},b:{x:5.85,y:1.8},section:'48x98',studStep:.6,endpointMode:'faces',height:2.75});
  p.openings=[{id:'D',wallId:'P-PAR',floor:1,offset:.2,width:.9,height:2.1,sill:0,type:'door'}];p.objects=[];p.voids=[];p.roof.type='none';p.bracing.method='none';p.auxiliaryTimber={enabled:false};p.floor={section:'50x200',rimSection:'50x200',spacing:.6,axis,blocking:true,blockingSection:'50x200',blockingStep:1.2,wallSupportFraming:true};p.foundation={spacing:2,capacity:200,grillage:{section:'75x248',plies:3,capSize:350,deflectionRatio:300,girderSpacing:2}};return p;
}
function hull(points){const P=points.sort((a,b)=>a.x-b.x||a.y-b.y).filter((q,i,a)=>!i||Math.hypot(q.x-a[i-1].x,q.y-a[i-1].y)>1e-9),half=a=>{const h=[];for(const q of a){while(h.length>1&&cross(h.at(-2),h.at(-1),q)<=1e-10)h.pop();h.push(q);}return h;};return half(P).slice(0,-1).concat(half([...P].reverse()).slice(0,-1));}
function shape(b){const g=cutGeometry(b),P=g.attributes.position,Y=b.end.map((q,i)=>(q-b.start[i])/b.length);let X=[...b.crossAxis];const d=X.reduce((s,q,i)=>s+q*Y[i],0);X=X.map((q,i)=>q-d*Y[i]);const N=Math.hypot(...X);X=X.map(q=>q/N);const Z=[X[1]*Y[2]-X[2]*Y[1],X[2]*Y[0]-X[0]*Y[2],X[0]*Y[1]-X[1]*Y[0]],c=b.start.map((q,i)=>(q+b.end[i])/2),vertices=[];for(let i=0;i<P.count;i++)vertices.push(c.map((q,j)=>q+X[j]*P.getX(i)+Y[j]*P.getY(i)+Z[j]*P.getZ(i)));g.dispose();return{poly:hull(vertices.map(q=>({x:q[0],y:q[2]}))),low:Math.min(...vertices.map(q=>q[1])),high:Math.max(...vertices.map(q=>q[1]))};}
function clip(A,B){let P=A;for(let i=0;i<B.length&&P.length>=3;i++){const a=B[i],b=B[(i+1)%B.length],next=[];for(let j=0;j<P.length;j++){const q=P[j],r=P[(j+1)%P.length],f=cross(a,b,q),g=cross(a,b,r);if(f>=-1e-10)next.push(q);if((f>=-1e-10)!==(g>=-1e-10)){const t=f/(f-g);next.push({x:q.x+(r.x-q.x)*t,y:q.y+(r.y-q.y)*t});}}P=next;}return P.length>=3?P:[];}
function footprint(w){const L=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),d=Number(w.section.split('x')[1])/2000,n={x:-(w.b.y-w.a.y)/L,y:(w.b.x-w.a.x)/L};return hull([w.a,w.b].flatMap(q=>[-1,1].map(s=>({x:q.x+n.x*d*s,y:q.y+n.y*d*s}))));}
const floors=r=>r.timber.instances.filter(b=>b.category==='floor'&&!b.annexId).map(b=>({b,...shape(b)}));
function sharedBoundary(A,B){let len=0;for(let i=0;i<A.length;i++)for(let j=0;j<B.length;j++){const a=A[i],b=A[(i+1)%A.length],c=B[j],d=B[(j+1)%B.length],L=Math.hypot(b.x-a.x,b.y-a.y),u={x:(b.x-a.x)/L,y:(b.y-a.y)/L};if(Math.abs(cross(a,b,c))/L>EPS||Math.abs(cross(a,b,d))/L>EPS)continue;const s=q=>(q.x-a.x)*u.x+(q.y-a.y)*u.y;len+=Math.max(0,Math.min(L,Math.max(s(c),s(d)))-Math.max(0,Math.min(s(c),s(d))));}return len;}

test('parallel and perpendicular internal walls have actual full-width full-depth floor timber in both joist-axis directions',()=>{
  for(const axis of ['x','y']){const p=fixture(axis),r=calculateDesigner(p),floor=floors(r),level=r.geometry.levels[0];
    for(const w of p.walls.filter(w=>w.kind==='partition')){const P=footprint(w),actual=sum(floor,q=>area(clip(P,q.poly))),support=r.floorPlatform.wallSupports.find(s=>s.wallId===w.id);assert.ok(Math.abs(actual-area(P))<1e-7,JSON.stringify({axis,wall:w.id,actual,expected:area(P),reported:support.coverageRatio,uncovered:support.uncoveredArea}));near(support.coverageRatio,1);assert.equal(support.geometryComplete,true);assert.equal(support.connectionsVerified,false);assert.equal(support.loadSpreadingVerified,false);
      for(const q of floor.filter(q=>support.boardIds.includes(q.b.id))){near(q.low,level.baseY);near(q.high,level.wallBaseY-.035);assert.equal(q.b.h,200);}
    }
    assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-wall-framing-L1'&&c.status==='pass'));
    assert.ok(r.timber.instances.some(b=>b.role==='wallTransferBlocking'));
  }
});

test('all physical floor bodies remain disjoint, including T junctions and crossing support strips',()=>{
  const p=fixture();p.walls[5].a={x:2.2,y:1.8};const r=calculateDesigner(p),boards=floors(r);
  for(let i=0;i<boards.length;i++)for(let j=0;j<i;j++)if(Math.min(boards[i].high,boards[j].high)-Math.max(boards[i].low,boards[j].low)>EPS)near(area(clip(boards[i].poly,boards[j].poly)),0,1e-7);
  for(const w of p.walls.filter(w=>w.kind==='partition')){const P=footprint(w);near(sum(boards,q=>area(clip(P,q.poly))),area(P),1e-7);}
});

test('added longitudinal joists bear on real grillage wood and transverse pieces meet real joist side faces',()=>{
  const r=calculateDesigner(fixture()),floor=floors(r),byId=new Map(floor.map(q=>[q.b.id,q])),grillage=new Map(r.timber.instances.filter(b=>b.category==='foundation').map(b=>[b.id,{b,...shape(b)}]));
  for(const q of floor.filter(q=>q.b.wallSupportWallIds?.length)){
    const b=q.b;near(b.length,Math.hypot(...b.end.map((p,i)=>p-b.start[i])));assert.ok(b.cutLength<=6+EPS);
    if(b.role==='joist'){assert.equal(b.supportStatus,'pass');assert.ok(b.analyticalSpan>0);for(const s of [b.supportStart,b.supportEnd]){assert.ok(s.contactBoardIds.length>0);for(const id of s.contactBoardIds){const g=grillage.get(id);assert.ok(g,id);near(g.high,q.low);assert.ok(area(clip(g.poly,q.poly))>1e-8);}}}
    else if(b.role==='wallTransferBlocking'){assert.equal(b.wallLoadTransfer,true);assert.equal(b.verticalSupport,false);assert.equal(b.connectionVerified,false);assert.equal(b.supports.length,2);for(const support of b.supports){assert.ok(support.memberIds.length);const contact=sum(support.memberIds,id=>{const other=byId.get(id);assert.ok(other,id);near(other.low,q.low);near(other.high,q.high);return sharedBoundary(q.poly,other.poly);});near(contact,b.b/1000,1e-6);}}
  }
});

test('oblique partitions and upper walls crossing a floor void cannot obtain a false complete support status',()=>{
  const p=fixture();p.walls[4].a={x:1.3,y:.3};p.walls[4].b={x:4.7,y:3.7};p.openings=[];const r=calculateDesigner(p),support=r.floorPlatform.wallSupports.find(s=>s.wallId==='P-PAR');assert.equal(support.orientation,'oblique');assert.equal(support.geometryComplete,false);assert.ok(support.coverageRatio<.99);assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-wall-framing-L1'&&c.status==='fail'));
  const q=fixture();q.floors=2;q.levels.push({id:'L2',index:2,name:'Второй',height:2.8});q.walls.push(...q.walls.filter(w=>w.kind==='exterior').map(w=>({...structuredClone(w),id:w.id+'-2',level:2})),{id:'P-OVER-VOID',kind:'partition',level:2,a:{x:2.2,y:.3},b:{x:2.2,y:4.5},section:'48x98',studStep:.6});q.voids=[{id:'V',level:2,kind:'doubleHeight',polygon:rect(1.5,1.5,4.5,3),edgeSection:'50x200'}];const R=calculateDesigner(q),S=R.floorPlatform.wallSupports.find(s=>s.wallId==='P-OVER-VOID');assert.equal(S.geometryComplete,false);assert.ok(S.coverageRatio<.9);assert.ok(R.floorPlatform.checks.some(c=>c.id==='floor-wall-framing-L2'&&c.status==='fail'));
  for(const b of floors(R).filter(q=>q.b.level===2&&['joist','wallTransferBlocking','floorBlocking'].includes(q.b.role)))near(area(clip(b.poly,q.voids[0].polygon)),0,1e-7);
});

test('door openings keep the bottom plate broken while its real solid segments receive full support',()=>{
  const p=fixture(),r=calculateDesigner(p),w=p.walls.find(w=>w.id==='P-PAR'),level=r.geometry.levels[0],plates=r.timber.instances.filter(b=>b.wallId===w.id&&b.role==='plate'&&b.platePosition==='bottom'),floor=floors(r);assert.equal(plates.length,2);
  for(const b of plates){const P=shape(b);near(P.low,level.wallBaseY);near(sum(floor,q=>area(clip(P.poly,q.poly))),area(P.poly),1e-7);}
  assert.ok(plates.every(b=>Math.max(b.start[2],b.end[2])<=.35+EPS||Math.min(b.start[2],b.end[2])>=1.25-EPS));
});

test('legacy missing/false flag is identical and added physical timber contributes mass, reactions and stock exactly once',()=>{
  const p=fixture();delete p.floor.wallSupportFraming;const legacy=calculateDesigner(p);p.floor.wallSupportFraming=false;const off=calculateDesigner(p);assert.deepEqual(legacy.timber,off.timber);assert.deepEqual(legacy.loads,off.loads);assert.deepEqual(legacy.piles,off.piles);
  p.floor.wallSupportFraming=true;const r=calculateDesigner(p),cut=calculateCutting(p,r),delta=r.timber.mass-off.timber.mass,floorDelta=r.timber.totals.floor.mass-off.timber.totals.floor.mass;assert.ok(delta>0);near(delta,floorDelta);near(r.loads.totalCharacteristic-off.loads.totalCharacteristic,delta*G/1000);near(r.loads.totalDesign-off.loads.totalDesign,delta*G/1000*p.loads.gammaG);near(sum(r.piles,q=>q.reaction),r.loads.totalDesign);
  near(r.timber.mass,sum(r.timber.instances,b=>b.mass));near(r.timber.mass,sum(r.timber.schedule,b=>b.mass));assert.equal(new Set(r.timber.instances.map(b=>b.id)).size,r.timber.instances.length);assert.equal(cut.invalid.length,0);assert.equal(cut.overlength.length,0);const ids=cut.stocks.flatMap(s=>s.pieces.map(q=>q.sourceId));for(const b of r.timber.instances)assert.equal(ids.filter(id=>id===b.id).length,1,b.id);for(const s of cut.stocks)near(s.used+s.kerfWaste+s.remainder,6);
});


test('non-divisible perimeter widths can use real continuous grillage backing without a false two-prop capacity pass',()=>{
  const p=fixture();p.floor={...p.floor,section:'48x198',rimSection:'48x198',blockingSection:'48x198'};const r=calculateDesigner(p),boards=floors(r),grillage=r.timber.instances.filter(b=>b.category==='foundation').map(shape),checked=checkDesignerMembers(p,r).joist.members;
  const backed=r.floorPlatform.instances.filter(b=>b.role==='joist'&&[b.supportStart,b.supportEnd].some(s=>s.continuousBacking));assert.ok(backed.length);
  for(const b of backed){const P=shape(b);near(sum(grillage,g=>area(clip(P.poly,g.poly))),area(P.poly),1e-7);assert.ok(b.cutLength<=6+EPS);assert.equal(b.supportStatus,'unverified');assert.equal(checked.find(j=>j.platformSpanId===b.id).numericChecksApplicable,false);}
  assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-supports-L1'&&c.status==='unverified'));
  for(const w of p.walls){const support=r.floorPlatform.wallSupports.find(s=>s.wallId===w.id);near(support.coverageRatio,1);}
});

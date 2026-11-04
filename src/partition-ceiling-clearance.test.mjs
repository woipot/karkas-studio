import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDesignerProject} from './designer-engine.js';
import {evaluateHouse} from './house-engine.js';
import {cutGeometry} from './board-geometry.js';
const EPS=1e-6,sum=(a,f=x=>x)=>a.reduce((s,q)=>s+f(q),0),near=(a,b,t=EPS)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} != ${b}`),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),area=P=>Math.abs(P.reduce((s,a,i)=>s+a.x*P[(i+1)%P.length].y-P[(i+1)%P.length].x*a.y,0))/2;
function fixture(height=3.08){
  const p=structuredClone(defaultDesignerProject),poly=[{x:.075,y:.075},{x:7.925,y:.075},{x:7.925,y:5.925},{x:.075,y:5.925}];p.height=3.1;p.levels=[{id:'L1',index:1,name:'Первый',height:3.1}];p.walls=poly.map((a,i)=>({id:'W'+i,a,b:poly[(i+1)%4],kind:'exterior',level:1,section:'75x150',studStep:.6}));
  const walls=[['ENTRY',2.2,.15,2.2,1.751],['TECH',4,.15,4,1.751],['KITCHEN',2.151,1.8,5.751,1.8],['BATH',5.8,.15,5.8,3.401],['BED-FRONT',3.751,3.45,7.85,3.45],['BED-LEFT',3.8,3.499,3.8,5.85]];p.walls.push(...walls.map(([id,x,y,X,Y])=>({id,kind:'partition',level:1,a:{x,y},b:{x:X,y:Y},section:'48x98',studStep:.6,endpointMode:'faces',...(height>3?{topAttachment:{target:'roofTieUnderside',gap:.02,mode:'sliding'}}:{height})})));
  p.openings=[['D1','ENTRY',.2,.9],['D2','TECH',.2,.8],['D3','BATH',2.32,.8],['D4','BED-LEFT',.151,.9]].map(([id,wallId,offset,width])=>({id,wallId,offset,width,type:'door',floor:1,height:2.1,sill:0}));p.objects=[];p.voids=[];p.bracing.method='none';p.floor={section:'50x200',rimSection:'50x200',axis:'y',spacing:.6,blocking:true,blockingSection:'50x200',blockingStep:1.2,wallSupportFraming:true};p.foundation={spacing:1.8,capacity:80,grillage:{section:'50x200',plies:3,capSize:250,girderSpacing:2}};
  p.auxiliaryTimber={enabled:true,wallService:'45x45',roofInterior:false,roofCounter:'50x50',roofBattens:'50x100',ceilingBattens:true,ceilingSection:'50x50',ceilingStep:.4,roofAboveRafterGap:0};p.roof={type:'king',shape:'gable',pitch:25,spacing:1,chordSection:'75x200',webSection:'50x100',collarSection:'50x100',collarConnection:'faceLap',collarEndInset:.025,framing:'tiedRafters',ceilingDrop:.3,kneeRun:.8,collarHeightRatio:.75,ceilingDead:.18,snowMu:1,overhangs:{low:.52,high:.42,start:.42,end:.42}};p.loads={...p.loads,floorDead:.7,live:1.5,roofDead:.42,wallDead:.3,openingDead:.3,snow:1.5,gammaG:1.1,gammaQ:1.4};p.material={...p.material,E:10000,Emin:7400,Fb:13,Ft:8,Fc:13,Fv:1.6,density:450,studRestraint:3.1};p.site={...p.site,finishedPlan:{externalInteriorLining:.0695,partitionLining:.0125}};return p;
}
function hull(points){const P=points.sort((a,b)=>a.x-b.x||a.y-b.y).filter((q,i,a)=>!i||Math.hypot(q.x-a[i-1].x,q.y-a[i-1].y)>1e-9),half=P=>{const h=[];for(const q of P){while(h.length>1&&cross(h.at(-2),h.at(-1),q)<=1e-10)h.pop();h.push(q);}return h;};return half(P).slice(0,-1).concat(half([...P].reverse()).slice(0,-1));}
function shape(b){const g=cutGeometry(b),P=g.attributes.position,Y=b.end.map((q,i)=>(q-b.start[i])/b.length);let X=[...b.crossAxis];const dot=X.reduce((s,q,i)=>s+q*Y[i],0);X=X.map((q,i)=>q-dot*Y[i]);const L=Math.hypot(...X);X=X.map(q=>q/L);const Z=[X[1]*Y[2]-X[2]*Y[1],X[2]*Y[0]-X[0]*Y[2],X[0]*Y[1]-X[1]*Y[0]],c=b.start.map((q,i)=>(q+b.end[i])/2),points=[];for(let i=0;i<P.count;i++)points.push(c.map((q,j)=>q+X[j]*P.getX(i)+Y[j]*P.getY(i)+Z[j]*P.getZ(i)));g.dispose();return{b,poly:hull(points.map(q=>({x:q[0],y:q[2]}))),low:Math.min(...points.map(q=>q[1])),high:Math.max(...points.map(q=>q[1]))};}
function clip(A,B){let P=A;for(let i=0;i<B.length&&P.length>=3;i++){const a=B[i],b=B[(i+1)%B.length],next=[];for(let j=0;j<P.length;j++){const q=P[j],r=P[(j+1)%P.length],f=cross(a,b,q),g=cross(a,b,r);if(f>=-1e-10)next.push(q);if((f>=-1e-10)!==(g>=-1e-10)){const t=f/(f-g);next.push({x:q.x+(r.x-q.x)*t,y:q.y+(r.y-q.y)*t});}}P=next;}return P.length>=3?P:[];}
function envelope(w,base){const d=Number(w.section.split('x')[1])/2000,L=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),n={x:-(w.b.y-w.a.y)/L,y:(w.b.x-w.a.x)/L};return{poly:hull([w.a,w.b].flatMap(q=>[-1,1].map(s=>({x:q.x+n.x*d*s,y:q.y+n.y*d*s})))),low:base,high:base+w.height};}
const overlap=(a,b)=>Math.min(a.high,b.high)-Math.max(a.low,b.low)>EPS&&area(clip(a.poly,b.poly))>1e-8;
const pointOn=(q,P)=>P.some((a,i)=>{const b=P[(i+1)%P.length],dx=b.x-a.x,dy=b.y-a.y,t=((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy);return t>=-EPS&&t<=1+EPS&&Math.abs(cross(a,b,q))/Math.hypot(dx,dy)<EPS;});
function boundary(A,B){let length=0;for(let i=0;i<A.length;i++)for(let j=0;j<B.length;j++){const a=A[i],b=A[(i+1)%A.length],c=B[j],d=B[(j+1)%B.length],L=Math.hypot(b.x-a.x,b.y-a.y),u={x:(b.x-a.x)/L,y:(b.y-a.y)/L};if(Math.abs(cross(a,b,c))/L>EPS||Math.abs(cross(a,b,d))/L>EPS)continue;const s=q=>(q.x-a.x)*u.x+(q.y-a.y)*u.y;length+=Math.max(0,Math.min(L,Math.max(s(c),s(d)))-Math.max(0,Math.min(s(c),s(d))));}return length;}
let raised,old;const report=()=>raised??=evaluateHouse(fixture()),legacy=()=>old??=evaluateHouse(fixture(2.75)),ceiling=r=>r.timber.instances.filter(b=>/^ceiling/.test(b.role)).map(shape);

test('raising only partitions preserves roof/ceiling datums and the assumed20mm clearance below real lower ties',()=>{
  const x=report(),r=x.result,z=r.roofModel.zones[0];near(z.bottomChordBottomY,4.255);near(z.ceilingDatumY,3.955);near(z.ceilingDrop,.3);
  for(const w of r.project.walls.filter(w=>w.kind==='partition')){near(w.height,3.08);const top=Math.max(...r.timber.instances.filter(b=>b.wallId===w.id).map(b=>shape(b).high));near(top,4.235);near(z.bottomChordBottomY-top,.02);}
  const physical=r=>r.timber.instances.filter(b=>b.tiedRafters).map(b=>({id:b.id,role:b.role,b:b.b,h:b.h,start:b.start,end:b.end,shape:b.shape}));assert.deepEqual(physical(r),physical(legacy().result));assert.ok(r.project.walls.filter(w=>w.height===3.08).every(w=>w.kind==='partition'));assert.ok(r.partitionHeads.items.every(i=>i.verticalBearing===false));
});

test('ceiling timber clears full partition envelopes, actual partition timber and other ceiling members including T junctions',()=>{
  const x=report(),r=x.result,C=ceiling(r),partitions=r.project.walls.filter(w=>w.kind==='partition'),ids=new Set(partitions.map(w=>w.id)),walls=r.timber.instances.filter(b=>ids.has(b.wallId)).map(shape),envelopes=partitions.map(w=>({id:w.id,...envelope(w,r.geometry.levels[0].wallBaseY)}));
  for(const c of C){for(const w of envelopes)assert.equal(overlap(c,w),false,`${c.b.id} enters ${w.id}`);for(const w of walls)assert.equal(overlap(c,w),false,`${c.b.id} intersects ${w.b.id}`);}
  for(let i=0;i<C.length;i++)for(let j=0;j<i;j++)assert.equal(overlap(C[i],C[j]),false,`${C[i].b.id} intersects ${C[j].b.id}`);
});

test('every batten end cut at a wall contacts a real hanger that reaches a roof tie or transfer header',()=>{
  const x=report(),r=x.result,C=ceiling(r),walls=r.project.walls.filter(w=>w.kind==='partition').map(w=>envelope(w,r.geometry.levels[0].wallBaseY)),hangers=C.filter(q=>q.b.role==='ceilingHanger'),upper=[...C.filter(q=>q.b.role==='ceilingTransferHeader'),...r.timber.instances.filter(b=>b.role==='bottomChord'&&b.tiedRafters).map(shape)];let ends=0;
  for(const b of C.filter(q=>q.b.role==='ceilingBatten'))for(const[end,point]of[['start',b.b.start],['end',b.b.end]])if(walls.some(w=>pointOn({x:point[0],y:point[2]},w.poly))){ends++;const candidates=hangers.filter(q=>Math.abs(q.low-b.high)<EPS&&Math.hypot(q.b.start[0]-point[0],q.b.start[2]-point[2])<=.1+EPS&&area(clip(b.poly,q.poly))>1e-7);assert.ok(candidates.length,`${b.b.id} has an orphan wall end`);const metadata=b.b.ceilingEndSupports?.find(q=>q.end===end);assert.ok(metadata,`${b.b.id}: missing actual end support identity`);assert.equal(metadata.memberId,b.b.id);assert.equal(metadata.connectionVerified,false);assert.ok(candidates.some(q=>q.b.id===metadata.hangerId));
    for(const hanger of candidates){const contact=sum(upper.filter(q=>Math.abs(q.low-hanger.high)<EPS),q=>area(clip(hanger.poly,q.poly)));assert.ok(contact>1e-7,`${hanger.b.id} has no actual roof contact`);}
  }
  assert.ok(ends>=20,'Fixture must exercise many genuine wall-cut batten ends.');
});

test('upright transfer headers touch both actual tie side faces and do not invent support from partitions',()=>{
  const r=report().result,headers=ceiling(r).filter(q=>q.b.role==='ceilingTransferHeader'),ties=r.timber.instances.filter(b=>b.role==='bottomChord'&&b.tiedRafters).map(shape);assert.ok(headers.length>0);
  for(const q of headers){assert.equal(q.b.b,50);assert.equal(q.b.h,100);near(q.low,4.255);near(q.high,4.355);const contacts=ties.map(s=>({s,line:boundary(q.poly,s.poly)})).filter(q=>q.line>1e-6);assert.equal(contacts.length,2,`${q.b.id}: expected both actual tie side faces`);
    for(const c of contacts){near(c.line,.05);assert.ok(Math.min(q.high,c.s.high)-Math.max(q.low,c.s.low)>=.1-EPS);assert.equal(overlap(q,c.s),false);}
    assert.notEqual(q.b.connectionVerified,true);assert.ok(!q.b.partitionWallId);
  }
  assert.equal(ceiling(r).some(q=>q.b.role==='ceilingWallLedger'),false);
});

test('legacy low partitions leave the ceiling intact, while exactly the four TECH hangers are removed for raised partitions',()=>{
  const before=ceiling(legacy().result),after=ceiling(report().result);assert.equal(before.filter(q=>q.b.role==='ceilingHanger').length,98);assert.equal(before.filter(q=>q.b.role==='ceilingBatten').length,28);assert.equal(before.filter(q=>q.b.role==='ceilingLedger').length,6);assert.equal(before.filter(q=>q.b.role==='ceilingTransferHeader').length,0);
  const retained=new Set(after.filter(q=>q.b.role==='ceilingHanger').map(q=>q.b.id));for(const q of before.filter(q=>q.b.role==='ceilingHanger'))assert.equal(retained.has(q.b.id),!(Math.abs(q.b.start[0]-4)<EPS&&q.b.start[2]<1.751));
});

test('all trimmed ceiling pieces and transfer headers have actual lengths, one mass contribution and one placement on6m stock',()=>{
  const x=report(),r=x.result,ids=x.cutting.stocks.flatMap(s=>s.pieces.map(p=>p.sourceId));near(r.timber.mass,sum(r.timber.instances,b=>b.mass));near(r.timber.mass,sum(r.timber.schedule,b=>b.mass));near(r.loads.totalDesign,sum(r.piles,q=>q.reaction));near(r.loads.totalDesign,sum(r.loads.rows,q=>q.design));assert.equal(new Set(r.timber.instances.map(b=>b.id)).size,r.timber.instances.length);
  for(const q of ceiling(r)){const b=q.b;near(b.length,Math.hypot(...b.end.map((v,i)=>v-b.start[i])));near(b.volume,b.b*b.h*b.length/1e6);near(b.mass,b.volume*x.project.material.density);assert.ok(b.cutLength<=6+EPS);assert.equal(ids.filter(id=>id===b.id).length,1,b.id);}
  assert.equal(x.cutting.overlength.length,0);assert.equal(x.cutting.invalid.length,0);for(const s of x.cutting.stocks)near(s.used+s.kerfWaste+s.remainder,6);
});

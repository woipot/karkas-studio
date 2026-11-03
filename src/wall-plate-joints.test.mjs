import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDesigner,defaultDesignerProject} from './designer-engine.js';
import {calculateCutting} from './cutting.js';
import {cutGeometry} from './board-geometry.js';

const near=(a,b,t=1e-6)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} != ${b}`);
const sum=(a,f=x=>x)=>a.reduce((s,q)=>s+f(q),0);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const area=P=>Math.abs(P.reduce((s,p,i)=>s+p.x*P[(i+1)%P.length].y-P[(i+1)%P.length].x*p.y,0))/2;
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
function fixture(b=75,reverse=false){
  const p=structuredClone(defaultDesignerProject),points=rect(.075,.075,7.925,5.925);if(reverse)points.reverse();
  p.floors=1;p.levels=[{id:'L1',index:1,name:'Первый',height:2.8}];p.height=2.8;p.walls=points.map((a,i)=>({id:'W'+i,level:1,kind:'exterior',a,b:points[(i+1)%points.length],section:`${b}x150`,studStep:.6}));
  p.openings=[];p.objects=[];p.voids=[];p.roof.type='none';p.bracing.method='none';p.auxiliaryTimber={enabled:false};
  p.floor={...p.floor,section:'48x198',rimSection:'48x198'};p.foundation={spacing:2,capacity:200,grillage:{section:'75x248',plies:3,capSize:350,deflectionRatio:300}};
  p.joints={...p.joints,defaultCorner:'california2',defaultCut:'butt',overrides:{}};return p;
}
function hull(points){
  const p=points.sort((a,b)=>a.x-b.x||a.y-b.y).filter((q,i,a)=>!i||Math.hypot(q.x-a[i-1].x,q.y-a[i-1].y)>1e-9);
  const half=list=>{const h=[];for(const q of list){while(h.length>1&&cross(h.at(-2),h.at(-1),q)<=1e-10)h.pop();h.push(q);}return h;};
  return half(p).slice(0,-1).concat(half([...p].reverse()).slice(0,-1));
}
function shape(board){
  const geometry=cutGeometry(board),pos=geometry.attributes.position,y=board.end.map((q,i)=>(q-board.start[i])/board.length);let x=[...board.crossAxis];
  const dot=x.reduce((s,q,i)=>s+q*y[i],0);x=x.map((q,i)=>q-dot*y[i]);const length=Math.hypot(...x);x=x.map(q=>q/length);const z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]],center=board.start.map((q,i)=>(q+board.end[i])/2),points=[];
  for(let i=0;i<pos.count;i++)points.push(center.map((q,j)=>q+x[j]*pos.getX(i)+y[j]*pos.getY(i)+z[j]*pos.getZ(i)));
  geometry.dispose();return {plan:hull(points.map(q=>({x:q[0],y:q[2]}))),low:Math.min(...points.map(q=>q[1])),high:Math.max(...points.map(q=>q[1]))};
}
function clip(A,B){
  let P=A;
  for(let j=0;j<B.length&&P.length>=3;j++){
    const a=B[j],b=B[(j+1)%B.length],next=[];
    for(let i=0;i<P.length;i++){const q=P[i],r=P[(i+1)%P.length],f=cross(a,b,q),g=cross(a,b,r);if(f>=-1e-10)next.push(q);if((f>=-1e-10)!==(g>=-1e-10)){const t=f/(f-g);next.push({x:q.x+(r.x-q.x)*t,y:q.y+(r.y-q.y)*t});}}
    P=next;
  }
  return P.length>=3?P:[];
}
function cornerLayer(r,c,centerY){
  const [u,v]=c.directions,local=q=>({x:(q.x-c.point.x)*u.x+(q.y-c.point.y)*u.y,y:(q.x-c.point.x)*v.x+(q.y-c.point.y)*v.y}),patch=rect(-.075,-.075,.3,.3);
  return r.timber.instances.filter(b=>b.role==='plate'&&c.wallIds.includes(b.wallId)&&Math.abs((b.start[1]+b.end[1])/2-centerY)<1e-6).map(b=>({b,mesh:shape(b)})).map(q=>({...q,poly:clip(hull(q.mesh.plan.map(local)),patch)})).filter(q=>area(q.poly)>1e-7);
}
function sharedBoundaryLength(A,B){
  let length=0;
  for(let i=0;i<A.length;i++)for(let j=0;j<B.length;j++){
    const a=A[i],b=A[(i+1)%A.length],c=B[j],d=B[(j+1)%B.length],L=Math.hypot(b.x-a.x,b.y-a.y),u={x:(b.x-a.x)/L,y:(b.y-a.y)/L};
    if(Math.abs(cross(a,b,c))/L>1e-6||Math.abs(cross(a,b,d))/L>1e-6)continue;
    const s=q=>(q.x-a.x)*u.x+(q.y-a.y)*u.y,lo=Math.min(s(c),s(d)),hi=Math.max(s(c),s(d));length+=Math.max(0,Math.min(L,hi)-Math.max(0,lo));
  }
  return length;
}

test('each actual 90-degree exterior plate layer forms one complete L with touching ends and no double wood',()=>{
  for(const b of [50,75])for(const reverse of [false,true]){
    const p=fixture(b,reverse),r=calculateDesigner(p),level=r.geometry.levels[0],B=b/1000;
    for(const c of r.corners)for(const Y of [level.wallBaseY+B/2,level.topY-1.5*B,level.topY-B/2]){
      const pieces=cornerLayer(r,c,Y);assert.equal(pieces.length,2,`${c.id} Y${Y}`);
      near(area(clip(pieces[0].poly,pieces[1].poly)),0,1e-7);
      near(sum(pieces,q=>area(q.poly)),.15*.3*2,1e-7);
      near(sharedBoundaryLength(pieces[0].poly,pieces[1].poly),.15,1e-6);
      // Both external faces meet at the real outside corner, rather than axes.
      for(const point of [{x:-.074,y:-.074},{x:.299,y:0},{x:0,y:.299}])assert.ok(pieces.some(q=>area(clip(rect(point.x-.0001,point.y-.0001,point.x+.0001,point.y+.0001),q.poly))>1e-8));
      for(const q of pieces){near(q.mesh.low,Y-B/2);near(q.mesh.high,Y+B/2);}
    }
  }
});

test('top courses alternate their physically continuous wall instead of duplicating the same corner butt seam',()=>{
  const p=fixture(),r=calculateDesigner(p),level=r.geometry.levels[0],B=.075;
  for(const c of r.corners){
    const ids=[...c.wallIds].sort(),layers=[{Y:level.topY-1.5*B,primary:ids[0]},{Y:level.topY-B/2,primary:ids[1]}];
    for(const layer of layers){
      const pieces=cornerLayer(r,c,layer.Y),primary=pieces.find(q=>q.b.wallId===layer.primary),secondary=pieces.find(q=>q.b.wallId!==layer.primary);
      assert.ok(primary&&secondary);const w=p.walls.find(w=>w.id===primary.b.wallId),other=Math.hypot(w.a.x-c.point.x,w.a.y-c.point.y)<1e-6?w.b:w.a,L=Math.hypot(other.x-c.point.x,other.y-c.point.y),u={x:(other.x-c.point.x)/L,y:(other.y-c.point.y)/L};
      near(Math.min(...primary.mesh.plan.map(q=>(q.x-c.point.x)*u.x+(q.y-c.point.y)*u.y)),-.075);
      assert.equal(primary.b.platePosition,'top');assert.equal(secondary.b.platePosition,'top');
    }
  }
});

test('actual corner studs have full end contact with the corrected bottom and lower top plates',()=>{
  const r=calculateDesigner(fixture()),level=r.geometry.levels[0],B=.075;
  for(const c of r.corners){
    const studs=r.timber.instances.filter(b=>b.role==='corner'&&b.cornerId===c.id);assert.equal(studs.length,2);
    for(const stud of studs){const S=shape(stud);near(S.low,level.wallBaseY+B);near(S.high,level.topY-2*B);
      for(const Y of [level.wallBaseY+B/2,level.topY-1.5*B]){
        const plates=r.timber.instances.filter(b=>b.role==='plate'&&c.wallIds.includes(b.wallId)&&Math.abs(b.start[1]-Y)<1e-6).map(shape),contact=sum(plates,P=>area(clip(S.plan,P.plan)));
        near(contact,area(S.plan),1e-7);
      }
    }
  }
});

test('the corrected physical board lengths and mass reach the schedule, load rows and stock map exactly once',()=>{
  const p=fixture(),before=JSON.stringify(p),r=calculateDesigner(p),cut=calculateCutting(p,r),plates=r.timber.instances.filter(b=>b.role==='plate');assert.equal(JSON.stringify(p),before);
  near(r.timber.mass,sum(r.timber.instances,b=>b.mass));near(r.timber.mass,sum(r.timber.schedule,b=>b.mass));
  near(r.loads.totalDesign,sum(r.loads.rows,q=>q.design));near(r.loads.totalDesign,sum(r.piles,q=>q.reaction));
  assert.equal(cut.invalid.length,0);assert.equal(cut.overlength.length,0);const ids=cut.stocks.flatMap(s=>s.pieces.map(q=>q.sourceId));
  for(const b of plates){near(b.length,Math.hypot(...b.end.map((q,i)=>q-b.start[i])));assert.ok(b.cutLength<=6+1e-7);assert.equal(ids.filter(id=>id===b.id).length,1,b.id);}
  for(const s of cut.stocks){near(s.used+s.kerfWaste+s.remainder,6);near(s.kerfWaste,Math.max(0,s.pieces.length-1)*p.cutting.kerf/1000);}
  assert.ok(r.checks.some(c=>c.status==='unverified'&&/креп|соединен|узл/i.test(c.note??'')),'Geometric contact does not certify the connection.');
});

test('corner metadata belongs only to the actual outer piece after six-metre stock splitting',()=>{
  const p=fixture(),r=calculateDesigner(p),keys=new Map();
  assert.ok(r.timber.instances.some(b=>b.role==='plate'&&b.partIndex===1));
  for(const board of r.timber.instances.filter(b=>b.role==='plate'))for(const j of board.cornerEndJoints??[]){
    const w=p.walls.find(w=>w.id===board.wallId),length=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),u={x:(w.b.x-w.a.x)/length,y:(w.b.y-w.a.y)/length},point=j.end==='start'?board.start:board.end,station=(point[0]-w.a.x)*u.x+(point[2]-w.a.y)*u.y;
    near(station,j.end==='start'?j.offset:length-j.offset);assert.equal(j.connectionVerified,false);
    const key=[j.cornerId,board.wallId,board.platePosition,board.plateLayer].join(':');keys.set(key,(keys.get(key)??0)+1);
  }
  assert.equal(keys.size,4*2*3);for(const [key,count] of keys)assert.equal(count,1,key);
});

test('unequal vertical plate thickness does not receive a false three-dimensional butt-joint claim',()=>{
  const p=fixture();p.walls[0].section='50x150';const r=calculateDesigner(p),affected=r.corners.filter(c=>c.wallIds.includes(p.walls[0].id));
  assert.equal(affected.length,2);for(const c of affected){assert.ok(c.warning,'Different plate elevations require an explicit unresolved corner warning.');assert.equal(r.timber.instances.some(b=>(b.cornerEndJoints??[]).some(j=>j.cornerId===c.id)),false);}
});

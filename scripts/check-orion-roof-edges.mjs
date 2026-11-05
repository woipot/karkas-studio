import assert from 'node:assert/strict';
import {cutGeometry} from '../src/board-geometry.js';
const sub=(a,b)=>a.map((v,k)=>v-b[k]),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),unit=v=>v.map(x=>x/Math.hypot(...v)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const area=P=>Math.abs(P.reduce((s,q,i)=>s+q[0]*P[(i+1)%P.length][1]-P[(i+1)%P.length][0]*q[1],0)/2);
function clip(P,k,value,sign){const R=[];for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],fa=(a[k]-value)*sign,fb=(b[k]-value)*sign;if(fa>=0)R.push(a);if((fa>=0)!==(fb>=0)){const t=fa/(fa-fb);R.push(a.map((v,j)=>v+(b[j]-v)*t));}}return R;}
function overlap(P,a,b,c,d){for(const [k,v,s]of[[0,a,1],[0,b,-1],[1,c,1],[1,d,-1]]){P=clip(P,k,v,s);if(!P.length)return 0;}return area(P);}
export function checkGeometry(roof){
 const rafters=roof.instances.filter(b=>b.role==='rafter'),outlookers=roof.instances.filter(b=>b.role==='roofOutlooker');let originalOverlapVolume=0,remainingOverlapVolume=0,contacts=0;
 for(const b of rafters){const d=unit(sub(b.end,b.start)),x=unit(b.crossAxis),n=unit(cross(x,d)),C=b.start.map((v,k)=>(v+b.end[k])/2),L=b.length,shift=v=>-n[2]/d[2]*v;
  // Independently reconstruct a plain rafter bounded by vertical source end planes.
  const plain=[[-L/2+shift(-.1),-.1],[L/2+shift(-.1),-.1],[L/2+shift(.1),.1],[-L/2+shift(.1),.1]],finished=b.shape?.points??plain;
  const mesh=cutGeometry(b),pos=mesh.getAttribute('position'),zs=[];for(let i=0;i<pos.count;i++)zs.push(C[2]+x[2]*pos.getX(i)+d[2]*pos.getY(i)+n[2]*pos.getZ(i));mesh.dispose();near(Math.min(...zs),Math.min(b.start[2],b.end[2]),1e-6);near(Math.max(...zs),Math.max(b.start[2],b.end[2]),1e-6);
  for(const o of outlookers){if(dot(o.crossAxis,n)<.999999)continue;const width=Math.min(b.start[0]+.02,o.end[0])-Math.max(b.start[0]-.02,o.start[0]);if(width<1e-7)continue;const center=o.start.map((v,k)=>(v+o.end[k])/2),s=dot(sub(center,C),d),v=dot(sub(center,C),n),a=s-.075,z=s+.075,floor=v-.02,top=v+.02,A=overlap(plain,s-.075,s+.075,floor,top);if(A<1e-8)continue;contacts++;near(top,.1);originalOverlapVolume+=A*width;remainingOverlapVolume+=overlap(finished,a,z,floor,top)*width;
   // Slot floor has physical timber below and clearance above, except at clipped end.
   const station=(Math.max(a,-L/2+shift(floor))+Math.min(z,L/2+shift(floor)))/2;assert.ok(overlap(finished,station-.001,station+.001,floor-.001,floor-.0001)>1e-7);assert.ok(overlap(finished,station-.001,station+.001,floor+.0001,floor+.001)<1e-10);
  }
 }
 assert.equal(rafters.length,72);assert.equal(contacts,126);near(remainingOverlapVolume,0,1e-10);
 return{contacts,originalOverlapVolume,remainingOverlapVolume,verticalRafterEndPlanes:72};
}

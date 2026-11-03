import test from 'node:test';
import assert from 'node:assert/strict';
import {ShapeUtils,Vector2} from 'three';
import {calculateTiedRafters} from './tied-rafters.js';
import {defaultDesignerProject,calculateDesigner} from './designer-engine.js';
import {calculateRoofZones} from './roof-zones.js';
import {evaluateHouse} from './house-engine.js';
import {cutGeometry} from './board-geometry.js';

const sum=(a,f=x=>x)=>a.reduce((s,x)=>s+f(x),0),near=(a,b,t=1e-6)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} != ${b}`),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),area=P=>Math.abs(P.reduce((s,a,i)=>s+a.x*P[(i+1)%P.length].y-P[(i+1)%P.length].x*a.y,0))/2;
const input={chordSection:'75x200',webSection:'50x100',collarSection:'50x100',collarConnection:'faceLap',collarEndInset:.025,Emin:7400};
const frame=extra=>{const r=calculateTiedRafters({...input,...extra});assert.equal(r.stable,true,r.errors.join('; '));return r;};
function triangles(P){return ShapeUtils.triangulateShape(P.map(p=>new Vector2(p.x,p.y)),[]).map(ids=>{const q=ids.map(i=>P[i]);return cross(...q)<0?q.reverse():q;});}
function convexIntersection(A,B){let P=A;for(let i=0;i<B.length&&P.length>=3;i++){const a=B[i],b=B[(i+1)%B.length],next=[];for(let j=0;j<P.length;j++){const q=P[j],r=P[(j+1)%P.length],f=cross(a,b,q),g=cross(a,b,r);if(f>=-1e-11)next.push(q);if((f>=-1e-11)!==(g>=-1e-11)){const t=f/(f-g);next.push({x:q.x+(r.x-q.x)*t,y:q.y+(r.y-q.y)*t});}}P=next;}return P.length>=3?area(P):0;}
const intersection=(A,B)=>sum(triangles(A),a=>sum(triangles(B),b=>convexIntersection(a,b)));
const sub=(a,b)=>a.map((q,i)=>q-b[i]),norm=a=>Math.hypot(...a),unit=a=>a.map(q=>q/norm(a)),dot=(a,b)=>sum(a.map((q,i)=>q*b[i])),cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function mesh(board){
  const g=cutGeometry(board),P=g.attributes.position,y=unit(sub(board.end,board.start));let x=unit(board.crossAxis);x=unit(x.map((q,i)=>q-y[i]*dot(x,y)));const z=cross3(x,y),center=board.start.map((q,i)=>(q+board.end[i])/2),vertices=[];
  for(let i=0;i<P.count;i++)vertices.push(center.map((q,j)=>q+x[j]*P.getX(i)+y[j]*P.getY(i)+z[j]*P.getZ(i)));g.dispose();
  let volume=0,centroid=[0,0,0];for(let i=0;i<vertices.length;i+=3){const a=vertices[i],b=vertices[i+1],c=vertices[i+2],v=dot(a,cross3(b,c))/6;volume+=v;for(let j=0;j<3;j++)centroid[j]+=v*(a[j]+b[j]+c[j])/4;}
  return {vertices,volume:Math.abs(volume),centroid:centroid.map(q=>q/volume)};
}
function coreMesh(b){return mesh({...b,start:[b.outOfPlaneOffset??0,b.start.y,b.start.x],end:[b.outOfPlaneOffset??0,b.end.y,b.end.x],crossAxis:[b.widthSign,0,0]});}
function fixture(){
  const p=structuredClone(defaultDesignerProject),poly=[{x:.075,y:.075},{x:7.925,y:.075},{x:7.925,y:5.925},{x:.075,y:5.925}];p.height=3.1;p.levels=[{id:'L1',index:1,name:'Первый',height:3.1}];p.walls=poly.map((a,i)=>({id:'W'+i,a,b:poly[(i+1)%4],kind:'exterior',level:1,section:'75x150',studStep:.6}));p.openings=[];p.objects=[];p.voids=[];p.bracing.method='none';p.floor.section='50x200';
  p.foundation={spacing:1.8,capacity:80,grillage:{section:'50x200',plies:3,capSize:250,girderSpacing:2}};
  p.auxiliaryTimber={enabled:true,roofInterior:false,roofCounter:'50x50',roofBattens:'50x100',ceilingBattens:true,ceilingSection:'50x50',roofAboveRafterGap:0};
  p.roof={type:'king',shape:'gable',ridgeAngle:0,pitch:25,spacing:1,chordSection:'75x200',webSection:'50x100',collarSection:'50x100',collarConnection:'faceLap',collarEndInset:.025,framing:'tiedRafters',ceilingDrop:.3,kneeRun:.8,collarHeightRatio:.75,ceilingDead:.18,snowMu:1,overhangs:{low:.52,high:.42,start:.42,end:.42}};
  p.loads={...p.loads,floorDead:.7,live:1.5,roofDead:.42,wallDead:.3,openingDead:.3,snow:1.5,gammaG:1.1,gammaQ:1.4};p.material={...p.material,E:10000,Emin:7400,Fb:13,Ft:8,Fc:13,Fv:1.6,density:450,studRestraint:3.1};
  p.snowDesign={cases:[{id:'base',name:'База',zoneFactors:{'roof-level-1-1':1}},{id:'heavy',name:'Снег ×1.5',zoneFactors:{'roof-level-1-1':1.5}}]};return p;
}
let cached;const report=()=>cached??=(evaluateHouse(fixture()));
function inside(q,P){let yes=false;for(let i=0,j=P.length-1;i<P.length;j=i++){const a=P[i],b=P[j],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy)));if(Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy)<1e-6)return true;if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function surfaceY(points,x,z){const a=points[0],u=sub(points[1],a),v=sub(points[2],a),n=cross3(u,v);assert.ok(Math.abs(n[1])>1e-8);return a[1]-(n[0]*(x-a[0])+n[2]*(z-a[2]))/n[1];}

test('face-lap collar remains 100mm upright and has independently derived square-cut length and cladding clearance',()=>{
  const r=frame(),b=r.boards.find(b=>b.id==='UPPER-COLLAR'),p=r.input,angle=p.pitch*Math.PI/180,axis=200/2000/Math.cos(angle),collarX=p.span/2*p.collarHeightRatio,Y=axis+Math.tan(angle)*collarX,expectedStart=collarX+(.05-axis)/Math.tan(angle)+p.collarEndInset,expectedLength=p.span-2*expectedStart;
  near(b.length,expectedLength);near(b.cutLength,expectedLength);near(b.length,1.6712896245795443);near(b.outOfPlaneOffset,.0625);near(b.start.y,Y);near(b.end.y,Y);assert.equal(b.h,100);assert.equal(b.b,50);assert.equal(b.cutStart.scheme,'butt');assert.equal(b.cutEnd.scheme,'butt');
  const vertices=coreMesh(b).vertices;near(Math.max(...vertices.map(q=>q[1]))-Math.min(...vertices.map(q=>q[1])),.1);near(Math.max(...vertices.map(q=>q[0]))-Math.min(...vertices.map(q=>q[0])),.05);
  const clear=Math.min(...b.polygon.map(q=>Math.min(Math.tan(angle)*q.x,Math.tan(angle)*(p.span-q.x))+.2/Math.cos(angle)-q.y));near(clear,.025*Math.tan(angle));assert.ok(clear>.0116);near(coreMesh(b).volume,b.volume,1e-8);
});

test('both broad faces touch real rafter profiles with positive area and no timber volume overlap',()=>{
  const r=frame(),collar=r.boards.find(b=>b.id==='UPPER-COLLAR');assert.equal(r.connections.length,2);
  for(const connection of r.connections){const raf=r.boards.find(b=>connection.members.includes(b.id)&&b.role==='topChord'),expected=intersection(collar.polygon,raf.polygon),C=coreMesh(collar),R=coreMesh(raf),min=a=>Math.min(...a.vertices.map(q=>q[0])),max=a=>Math.max(...a.vertices.map(q=>q[0]));
    near(min(C),max(R),1e-7);near(expected,.0341014970605,1e-10);near(connection.contactAreaM2,expected,1e-10);near(area(connection.contactPolygonXY),expected,1e-10);near(connection.eccentricityM,.0625);near(connection.axisOffsetMomentScaleKNm,connection.demandKN*connection.eccentricityM);assert.equal(connection.fastenersVerified,false);assert.equal(connection.status,'unverified');assert.ok(expected>0);
  }
  for(let i=0;i<r.boards.length;i++)for(let j=0;j<i;j++){const a=r.boards[i],b=r.boards[j],A=coreMesh(a),B=coreMesh(b),depth=Math.min(...[A,B].map(m=>Math.max(...m.vertices.map(q=>q[0]))))-Math.max(...[A,B].map(m=>Math.min(...m.vertices.map(q=>q[0]))));if(depth>2e-6)near(depth*intersection(a.polygon,b.polygon),0,1e-8);}
});

test('legacy in-plane geometry stays unchanged and invalid connection settings fail explicitly',()=>{
  const a=calculateTiedRafters({chordSection:'75x200',Emin:7400}),b=frame({collarConnection:'inPlane'}),select=r=>r.boards.map(q=>({id:q.id,start:q.start,end:q.end,polygon:q.polygon,volume:q.volume,cutLength:q.cutLength}));assert.deepEqual(select(a),select(b));
  const collar=a.boards.find(b=>b.id==='UPPER-COLLAR');near(collar.cutLength,1.2037103754204557);assert.ok(!collar.outOfPlaneOffset);assert.equal(a.connections.length,0);
  for(const q of [{collarConnection:'face-lpa'},{collarEndInset:NaN},{collarEndInset:-.001},{collarEndInset:.201}]){const r=calculateTiedRafters({...input,...q});assert.equal(r.stable,false);assert.ok(r.errors.length);}
});

test('full pipeline preserves offset, world mass centre, contacts, 100mm height, cladding clearance and one stock placement',()=>{
  const x=report(),r=x.result,z=r.roofModel.zones[0],collars=r.timber.instances.filter(b=>b.role==='collarTie'),ids=x.cutting.stocks.flatMap(s=>s.pieces.map(p=>p.sourceId));assert.equal(collars.length,z.frameRows.length);
  for(const b of collars){const M=mesh(b);assert.equal(b.collarConnection,'faceLap');near(b.outOfPlaneOffset,.0625);near(b.mass,b.volume*450);near(b.volume,M.volume,1e-7);for(let i=0;i<3;i++)near(b.massCenter[i],M.centroid[i],1e-6);near(Math.max(...M.vertices.map(p=>p[1]))-Math.min(...M.vertices.map(p=>p[1])),.1);assert.ok(b.cutLength<=6+1e-7);assert.equal(ids.filter(id=>id===b.id).length,1);
    for(const v of M.vertices){const surfaces=r.roofModel.surfaces.filter(s=>s.zoneId===b.zoneId&&inside({x:v[0],y:v[2]},s.points.map(p=>({x:p[0],y:p[2]}))));assert.ok(surfaces.length);assert.ok(Math.min(...surfaces.map(s=>surfaceY(s.points,v[0],v[2])-v[1]))>.0116);}
  }
  for(const row of z.frameRows){assert.equal(row.lapConnections.length,2);for(const c of row.lapConnections){assert.equal(c.memberWorldIds.length,2);for(const id of c.memberWorldIds)assert.ok(r.timber.instances.some(b=>b.id===id));for(const v of c.worldContactPolygon)near(v[0],c.worldContactPlaneU);near(c.contactAreaM2,.0341014970605);}}
  near(r.timber.mass,sum(r.timber.instances,b=>b.mass));near(r.loads.totalDesign,sum(r.piles,p=>p.reaction));near(r.loads.totalDesign,sum(r.loads.rows,q=>q.design));assert.equal(x.cutting.overlength.length,0);assert.equal(x.cutting.invalid.length,0);
});

test('fixed snow cases retain side-lap contact geometry and installed mass while updating force demands',()=>{
  const x=report(),r=x.result,z=r.roofModel.zones[0],cases=r.snowAssessment.cases;assert.equal(cases.length,2);
  for(const c of cases){near(c.timberMass,r.timber.mass);near(c.timberVolume,r.timber.volume);assert.equal(c.boardCount,r.timber.boardCount);assert.equal(c.sectionsFixed,true);assert.equal(c.frames[0].collarConnection,'faceLap');assert.equal(c.frames[0].connections.length,2);for(let i=0;i<2;i++){assert.deepEqual(c.frames[0].connections[i].contactPolygonXY,z.frameAnalysis.connections[i].contactPolygonXY);near(c.frames[0].connections[i].contactAreaM2,z.frameAnalysis.connections[i].contactAreaM2);near(c.frames[0].connections[i].eccentricityM,.0625);assert.equal(c.frames[0].connections[i].fastenersVerified,false);}}
  assert.ok(cases[1].snowCharacteristic>cases[0].snowCharacteristic);assert.ok(cases[1].frames[0].connections.some((q,i)=>Math.abs(q.demandKN-cases[0].frames[0].connections[i].demandKN)>1e-5));
});

test('opposite roof orientation preserves contact on the positive local broad face of both rafters',()=>{
  const p=fixture();p.roof.ridgeAngle=180;const roof=calculateRoofZones(p,calculateDesigner(p)),z=roof.zones[0],theta=z.ridgeAngle*Math.PI/180,U=[Math.cos(theta),0,Math.sin(theta)];
  for(const row of z.frameRows)for(const connection of row.lapConnections){const C=roof.instances.find(b=>b.id===connection.memberSourceBoardIds.find(id=>roof.instances.find(b=>b.id===id)?.role==='collarTie')),R=roof.instances.find(b=>b.id===connection.memberSourceBoardIds.find(id=>roof.instances.find(b=>b.id===id)?.role==='topChord'));assert.ok(C&&R);const c=mesh(C),r=mesh(R);near(Math.min(...c.vertices.map(p=>dot(p,U))),Math.max(...r.vertices.map(p=>dot(p,U))),1e-6);for(const point of connection.worldContactPolygon)near(dot(point,U),connection.worldContactPlaneU,1e-6);near(dot(C.massCenter,U),row.u+.0625,1e-6);}
});

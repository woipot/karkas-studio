import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {generateHouse} from './house-generator.js';
import {calculateDesigner} from './designer-engine.js';
import {calculateRoofZones} from './roof-zones.js';
import {cutGeometry} from './board-geometry.js';
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
const rect=(a,b,c,d)=>[{x:a,y:b},{x:c,y:b},{x:c,y:d},{x:a,y:d}];
function fixture(){const p=generateHouse({template:'l-shape',width:12,depth:8,wingWidth:8,wingDepth:4,levels:[{height:2.8},{height:2.8}],sections:{walls:'75x198',roof:'48x248'},roof:{shape:'mono',framing:'rafters',wallFraming:'continuous'},bracing:{method:'none'},material:{density:450,E:11000,Emin:7400,Fb:14.77,Fv:2.46,Fc:12.92,Ft:8.62},loads:{snow:2.75,gammaG:1.35,gammaQ:1.5}}).project;
  for(const level of [1,2])p.walls.push({id:'B-'+level,level,kind:'bearing',a:{x:0,y:4},b:{x:8,y:4},section:'75x198',studStep:.6});
  p.roof.zones=[{id:'N',name:'North',polygon:rect(0,0,12,4),shape:'mono',ridgeAngle:0,pitchLeft:25,pitchRight:25,elevation:null,levelIndex:2,framing:'rafters',spacing:.5,chordSection:'48x248',webSection:'48x98',trussType:'mono'},{id:'S',name:'South',polygon:rect(0,4,8,8),shape:'mono',ridgeAngle:180,pitchLeft:25,pitchRight:25,elevation:null,levelIndex:2,framing:'rafters',spacing:.5,chordSection:'48x248',webSection:'48x98',trussType:'mono'}];return p;}
function vertices(b){const geo=cutGeometry(b),start=new THREE.Vector3(...b.start),end=new THREE.Vector3(...b.end),dir=end.clone().sub(start).normalize(),width=new THREE.Vector3(...b.crossAxis);width.addScaledVector(dir,-width.dot(dir)).normalize();const height=new THREE.Vector3().crossVectors(width,dir).normalize(),mid=start.clone().add(end).multiplyScalar(.5),p=geo.attributes.position,points=[];for(let i=0;i<p.count;i++)points.push(mid.clone().addScaledVector(width,p.getX(i)).addScaledVector(dir,p.getY(i)).addScaledVector(height,p.getZ(i)));geo.dispose();return points;}
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function hull(points){const p=[...new Map(points.map(q=>[`${q.x.toFixed(8)}:${q.y.toFixed(8)}`,q])).values()].sort((a,b)=>a.x-b.x||a.y-b.y),half=list=>{const h=[];for(const q of list){while(h.length>1&&cross(h.at(-2),h.at(-1),q)<=1e-10)h.pop();h.push(q);}return h;},a=half(p),b=half([...p].reverse());return a.slice(0,-1).concat(b.slice(0,-1));}
function intersectionArea(a,b){let p=a;for(let i=0;i<b.length&&p.length;i++){const c=b[i],d=b[(i+1)%b.length],out=[];for(let j=0;j<p.length;j++){const q=p[j],r=p[(j+1)%p.length],f=cross(c,d,q),g=cross(c,d,r);if(f>=-1e-10)out.push(q);if((f>=0)!==(g>=0)){const t=f/(f-g);out.push({x:q.x+(r.x-q.x)*t,y:q.y+(r.y-q.y)*t});}}p=out;}return p.length<3?0:Math.abs(p.reduce((s,q,i)=>s+q.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*q.y,0))/2;}

test('supported opposed mono slopes receive plumb high cuts in their actual width/depth bases',()=>{
  const p=fixture(),r=calculateRoofZones(p,calculateDesigner(p));assert.equal(r.rafterJoints.length,1);const n=r.instances.filter(b=>b.zoneId==='N'&&b.rafterJointId),s=r.instances.filter(b=>b.zoneId==='S'&&b.rafterJointId);assert.equal(n.length,17);assert.equal(s.length,17);
  for(const b of [...n,...s]){assert.equal(b.cutEnd.scheme,'miter');assert.equal(b.cutEnd.plane,'depth');near(b.cutEnd.angle,25);assert.equal(b.cutEnd.tiltSign,1);near(b.cutLength,b.length+b.h/2000*Math.tan(25*Math.PI/180));assert.ok(b.cutLength<=6);near(b.volume,b.b*b.h*b.length/1e6);}
  assert.ok(r.instances.filter(b=>b.zoneId==='N'&&b.end[0]>8).every(b=>b.cutEnd.scheme==='butt'),'unshared high eave is unchanged');assert.equal(r.rafterJoints[0].connectionVerified,false);
});

test('actual production meshes stay on their own side of the shared ridge, eliminating butt-cut overlap',()=>{
  const p=fixture(),r=calculateRoofZones(p,calculateDesigner(p)),n=r.instances.filter(b=>b.zoneId==='N'&&b.rafterJointId),s=r.instances.filter(b=>b.zoneId==='S'&&b.rafterJointId);
  for(const b of n)assert.ok(vertices(b).every(v=>v.z<=4+5e-7));for(const b of s)assert.ok(vertices(b).every(v=>v.z>=4-5e-7));
  let intersection=0;for(const a of n)for(const b of s){const width=Math.max(0,Math.min(a.start[0]+a.b/2000,b.start[0]+b.b/2000)-Math.max(a.start[0]-a.b/2000,b.start[0]-b.b/2000));if(width>0)intersection+=width*intersectionArea(hull(vertices(a).map(v=>({x:v.z,y:v.y}))),hull(vertices(b).map(v=>({x:v.z,y:v.y}))));}assert.ok(intersection<5e-8,`Float32 mesh residue ${intersection}`);
  const oldA={...n[0],cutEnd:{scheme:'butt'}},oldB={...s.at(-1),cutEnd:{scheme:'butt'}},oldArea=intersectionArea(hull(vertices(oldA).map(v=>({x:v.z,y:v.y}))),hull(vertices(oldB).map(v=>({x:v.z,y:v.y}))));assert.ok(oldArea>.007,'regression is sensitive to the former square-end collision');
});

test('engine stock lengths include the real miter allowance while installed mass and beam loads stay unchanged',()=>{
  const p=fixture(),base=calculateDesigner(p),r=calculateRoofZones(p,base),single=calculateRoofZones({...p,roof:{...p.roof,zones:[p.roof.zones[0]]}},base),full=calculateDesigner(p,{roofModel:r});
  assert.deepEqual(r.zones[0].rafterAnalysis,single.zones[0].rafterAnalysis);const n=r.instances.filter(b=>b.zoneId==='N'&&b.role==='rafter'),one=single.instances.filter(b=>b.zoneId==='N'&&b.role==='rafter');near(n.reduce((s,b)=>s+b.mass,0),one.reduce((s,b)=>s+b.mass,0));
  const installed=full.timber.instances.filter(b=>b.role==='rafter'&&b.cutEnd.scheme==='miter');assert.equal(installed.length,34);for(const b of installed){near(b.cutLength,b.length+b.h/2000*Math.tan(b.cutEnd.angle*Math.PI/180));near(b.volume,b.b*b.h*b.length/1e6);assert.ok(b.cutLength<6);}
});

test('rotation of the supported ridge uses the actual board basis rather than a hard-coded world axis',()=>{
  const p=fixture(),rotate=q=>({x:-q.y,y:q.x});for(const w of p.walls){w.a=rotate(w.a);w.b=rotate(w.b);}for(const z of p.roof.zones){z.polygon=z.polygon.map(rotate);z.ridgeAngle+=90;}
  const r=calculateRoofZones(p,calculateDesigner(p));assert.equal(r.rafterJoints.length,1);for(const b of r.instances.filter(b=>b.rafterJointId)){const x=vertices(b).map(v=>v.x);assert.ok(b.zoneId==='N'?Math.min(...x)>=-4-5e-7:Math.max(...x)<=-4+5e-7);}
});

test('an unsupported shared high edge does not get an implicitly engineered ridge connection',()=>{
  const p=fixture();p.walls=p.walls.filter(w=>w.id!=='B-2');const r=calculateRoofZones(p,calculateDesigner(p));assert.equal(r.rafterJoints.length,0);assert.ok(r.checks.some(c=>c.status==='fail'));assert.equal(r.status,'fail');
});

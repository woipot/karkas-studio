import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDesigner, defaultDesignerProject} from './designer-engine.js';
import {calculateRoofZones} from './roof-zones.js';
import {calculateCutting} from './cutting.js';
import {cutGeometry} from './board-geometry.js';

const near = (a,b,t=1e-6) => assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t, `${a} != ${b}`);
const sum = (a,f=x=>x) => a.reduce((s,x)=>s+f(x),0);
const rect = (x0,y0,x1,y1) => [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
function project(polygon=rect(0,0,8,4), floors=2) {
  const p=structuredClone(defaultDesignerProject);
  p.floors=floors; p.openings=[]; p.objects=[]; p.voids=[]; p.bracing.method='none'; p.roof.type='none';
  p.floor={...p.floor,section:'48x248',rimSection:'48x248'};
  p.foundation.grillage={...p.foundation.grillage,section:'75x248',plies:4,capSize:350};
  p.walls=Array.from({length:floors},(_,i)=>polygon.map((a,j)=>({id:`L${i+1}-W${j}`,level:i+1,a:{...a},b:{...polygon[(j+1)%polygon.length]},kind:'exterior',section:'48x198',studStep:.6}))).flat();
  return p;
}
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function area(p) { return Math.abs(p.reduce((s,a,i)=>s+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0))/2; }
function hull(points) {
  const p=points.sort((a,b)=>a.x-b.x||a.y-b.y).filter((a,i,s)=>!i||Math.hypot(a.x-s[i-1].x,a.y-s[i-1].y)>1e-9);
  const half=list=>{const h=[];for(const q of list){while(h.length>1&&cross(h.at(-2),h.at(-1),q)<=1e-10)h.pop();h.push(q);}return h;};
  return half(p).slice(0,-1).concat(half([...p].reverse()).slice(0,-1));
}
function meshPlan(b) {
  const g=cutGeometry(b),p=g.attributes.position,u=b.end.map((x,i)=>(x-b.start[i])/b.length),v=b.crossAxis,points=[];
  for(let i=0;i<p.count;i++)points.push({x:(b.start[0]+b.end[0])/2+v[0]*p.getX(i)+u[0]*p.getY(i),y:(b.start[2]+b.end[2])/2+v[2]*p.getX(i)+u[2]*p.getY(i)});
  g.dispose();return hull(points);
}
function overlap(A,B) {
  let p=A;
  for(let j=0;j<B.length&&p.length>=3;j++) {
    const a=B[j],b=B[(j+1)%B.length],next=[];
    for(let i=0;i<p.length;i++){const q=p[i],r=p[(i+1)%p.length],f=cross(a,b,q),g=cross(a,b,r);if(f>=0)next.push(q);if((f>=0)!==(g>=0)){const t=f/(f-g);next.push({x:q.x+(r.x-q.x)*t,y:q.y+(r.y-q.y)*t});}}
    p=next;
  }
  return p.length>=3?area(p):0;
}
const floorBoards=r=>r.timber.instances.filter(b=>['rimJoist','joist','floorBlocking','openingHeader','openingTrimmer'].includes(b.role));

test('198mm wall / 48mm rim aligns the actual outer face, with a 75mm axis offset and 51mm inner face',()=>{
  for(const winding of [rect(0,0,8,4),rect(0,0,8,4).reverse()]) {
    const p=project(winding),r=calculateDesigner(p),rims=r.floorPlatform.instances.filter(b=>b.role==='rimJoist');
    for(const l of r.floorPlatform.levels) {
      near(l.quantities.rimLength,24.6);
      near(area(l.axisPolygon),32); near(area(l.outerPolygon),(8+.198)*(4+.198));
      assert.ok(l.rimSegments.every(s=>Math.abs(s.outwardOffset-.075)<1e-7));
      assert.ok(l.rimSegments.every(s=>s.bearing.status==='pass'&&Math.abs(s.bearing.minWidth-.048)<1e-7));
      const points=rims.filter(b=>b.level===l.index).flatMap(meshPlan);
      near(Math.min(...points.map(v=>v.x)),-.099);near(Math.max(...points.map(v=>v.x)),8.099);
      near(Math.min(...points.map(v=>v.y)),-.099);near(Math.max(...points.map(v=>v.y)),4.099);
    }
    const north=rims.filter(b=>Math.abs(b.start[2]+.075)<1e-7&&Math.abs(b.end[2]+.075)<1e-7);
    assert.ok(north.length>=2);for(const b of north)near(Math.max(...meshPlan(b).map(v=>v.y)),-.051);
    const j=r.floorPlatform.instances.find(b=>b.level===2&&b.role==='joist'&&b.start[0]>.1&&b.start[0]<7.9&&Math.abs(b.analyticalSpan-4)<1e-7);
    assert.ok(j);near(j.start[2],-.051);near(j.end[2],4.051);near(j.analyticalSpan,4);
    near(j.supportStart.point.y,0);near(j.supportEnd.point.y,4);
    assert.ok(r.floorPlatform.instances.filter(b=>b.role==='joist'&&b.supportStatus==='pass').every(b=>b.analyticalSpan>1e-6),'A support axis must not create a separate zero-span edge stub.');
    assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-rim-corners-L2'&&c.status==='unverified'));
    assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-platform-connections'&&c.status==='unverified'));
  }
});

test('an L contour has closed mitred physical rims and no positive-volume floor-board intersections',()=>{
  const p=project([{x:0,y:0},{x:12,y:0},{x:12,y:4},{x:8,y:4},{x:8,y:8},{x:0,y:8}]);
  for(let level=1;level<=2;level++)p.walls.push({id:`L${level}-B`,level,a:{x:0,y:4},b:{x:8,y:4},kind:'bearing',section:'48x198',studStep:.6});
  const r=calculateDesigner(p),boards=floorBoards(r).map(b=>({...b,poly:meshPlan(b)}));
  for(const l of r.floorPlatform.levels){near(l.quantities.rimLength,40.6);near(area(l.outerPolygon),83.999204);assert.ok(l.rimSegments.every(s=>s.bearing.status==='pass'));}
  for(let i=0;i<boards.length;i++)for(let j=0;j<i;j++)if(boards[i].level===boards[j].level)assert.ok(overlap(boards[i].poly,boards[j].poly)<1e-6,`${boards[i].id} overlaps ${boards[j].id}`);
  assert.ok(r.floorPlatform.checks.filter(c=>c.id.startsWith('floor-rim-bearing-')).every(c=>c.status==='pass'));
});

test('a narrow 96mm grillage cannot acquire support merely because its axis matches a displaced rim',()=>{
  const p=project(rect(0,0,8,4),1);p.foundation.grillage.section='48x248';p.foundation.grillage.plies=2;
  const r=calculateDesigner(p),segments=r.floorPlatform.levels[0].rimSegments;
  assert.ok(segments.some(s=>s.bearing.status==='fail'&&s.bearing.minWidth<1e-7));
  assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-rim-bearing-L1'&&c.status==='fail'));
  assert.ok(r.floorPlatform.instances.filter(b=>b.role==='rimJoist').some(b=>b.continuousBacking===false));
});

test('an upper outline beyond the lower wall band stays unsupported and its rim is not cut into fake supported pieces',()=>{
  const p=project();for(const w of p.walls.filter(w=>w.level===2)){w.a.x+=.4;w.b.x+=.4;}
  const r=calculateDesigner(p),level=r.floorPlatform.levels.find(l=>l.index===2);
  assert.ok(level.rimSegments.some(s=>s.bearing.status!=='pass'));
  assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-rim-bearing-L2'&&c.status!=='pass'));
  const unsupported=r.floorPlatform.instances.filter(b=>b.level===2&&b.role==='rimJoist'&&!b.continuousBacking);
  assert.ok(unsupported.length);assert.ok(unsupported.every(b=>!b.supportedSpliceStart&&!b.supportedSpliceEnd));
});

test('rim-width changes preserve wall axes, real roof bearings and the declared horizontal overhang reference',()=>{
  const p=project(rect(0,0,8,4),1);p.auxiliaryTimber={enabled:true,roofBattens:'50x100'};p.roof.type='mono';p.roof.zones=[{id:'Z',name:'QA mono',polygon:rect(0,0,8,4),shape:'mono',ridgeAngle:0,pitchLeft:25,pitchRight:25,levelIndex:1,elevation:null,spacing:.5,framing:'rafters',chordSection:'75x300',webSection:'48x98',overhangs:{low:.6,high:0,start:.35,end:.45}}];
  const before=structuredClone(p.walls),baseA=calculateDesigner(p),a=calculateRoofZones(p,baseA),q=structuredClone(p);q.floor.rimSection='98x248';const baseB=calculateDesigner(q),b=calculateRoofZones(q,baseB);
  assert.deepEqual(p.walls,before);assert.deepEqual(baseA.geometry.polygon,baseB.geometry.polygon);
  assert.deepEqual(a.zones[0].polygon,b.zones[0].polygon);assert.deepEqual(a.zones[0].bounds,b.zones[0].bounds);near(a.projectedArea,8.8*4.6);near(a.projectedArea,b.projectedArea);
  assert.deepEqual(a.instances.filter(x=>x.role==='rafter').map(x=>({start:x.start,end:x.end,bearingStart:x.bearingStart,bearingEnd:x.bearingEnd})),b.instances.filter(x=>x.role==='rafter').map(x=>({start:x.start,end:x.end,bearingStart:x.bearingStart,bearingEnd:x.bearingEnd})));
});

test('new physical lengths, mass and stock coverage remain exact without converting geometry checks into connection approval',()=>{
  const p=project(),r=calculateDesigner(p),cut=calculateCutting(p,r),ids=cut.stocks.flatMap(s=>s.pieces.map(b=>b.sourceId));
  assert.equal(new Set(r.timber.instances.map(b=>b.id)).size,r.timber.instances.length);
  for(const b of floorBoards(r)){near(b.length,Math.hypot(...b.end.map((v,i)=>v-b.start[i])));near(b.volume,b.b*b.h*b.length/1e6);near(b.mass,b.volume*p.material.density);assert.equal(ids.filter(id=>id===b.id).length,1,b.id);}
  near(r.timber.totals.floor.mass,sum(r.timber.instances.filter(b=>b.category==='floor'),b=>b.mass));near(r.foundation.reactionSum,r.loads.totalDesign);
  assert.equal(cut.overlength.length,0);assert.equal(cut.invalid.length,0);assert.ok(cut.stocks.every(s=>s.consumed<=6+1e-7));
  assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-platform-connections'&&c.status==='unverified'));
});

test('physical deck ring enters dead layers once while planning area, voids and live load retain the axial convention',()=>{
  const p=project([{x:0,y:0},{x:12,y:0},{x:12,y:4},{x:8,y:4},{x:8,y:8},{x:0,y:8}]);
  p.loads.floorDead=.7;p.loads.live=2;
  for(let level=1;level<=2;level++)p.walls.push({id:`L${level}-B`,level,a:{x:0,y:4},b:{x:8,y:4},kind:'bearing',section:'48x198',studStep:.6});
  p.voids=[{id:'LIGHT',level:2,kind:'doubleHeight',polygon:rect(.6,.4,3.4,3),edgeSection:'98x248'},{id:'STAIR',level:2,kind:'stair',polygon:rect(3.8,.8,7,3),edgeSection:'98x248'}];
  const r=calculateDesigner(p),physical=sum(r.floorPlatform.levels,l=>area(l.outerPolygon))-14.32;
  near(r.geometry.totalFloorArea,145.68);near(physical,153.678408);near(r.geometry.totalPlatformArea,physical);
  near(r.loads.rows.find(x=>x.id==='floor-layers').characteristic,153.678408*.7);
  near(r.loads.rows.find(x=>x.id==='live').characteristic,145.68*2);
  near(r.loads.platformArea,153.678408);near(r.loads.floorArea,145.68);
  near(r.loads.totalCharacteristic,sum(r.loads.rows,x=>x.characteristic));near(r.foundation.reactionSum,r.loads.totalDesign);
  assert.equal(r.geometry.platformAreaComplete,true);
});

test('grillage joint metadata names physical contact plies separately from the analytical crossing',()=>{
  const p=project(rect(0,0,8,4),1),r=calculateDesigner(p),plies=r.timber.instances.filter(b=>b.category==='foundation').map(b=>({...b,poly:meshPlan(b)}));
  let aliases=0;
  for(const j of r.floorPlatform.instances.filter(b=>b.role==='joist'))for(const s of [j.supportStart,j.supportEnd]) {
    if(s.kind!=='grillage')continue;
    assert.equal(s.analyticalSourceId,s.sourceId);assert.ok(s.sourceIdMeaning.includes('analytical'));
    assert.ok(s.contactBeamIds.length);assert.equal(s.nodeTransferVerified,false);
    const u={x:(j.end[0]-j.start[0])/j.length,y:(j.end[2]-j.start[2])/j.length},v={x:-u.y,y:u.x},at=t=>({x:j.start[0]+u.x*t,y:j.start[2]+u.y*t});
    const station=(s.point.x-j.start[0])*u.x+(s.point.y-j.start[2])*u.y,from=Math.max(0,station-s.halfBearing),to=Math.min(j.length,station+s.halfBearing),half=j.b/2000;
    const seat=hull([from,to].flatMap(t=>[-half,half].map(w=>({x:at(t).x+v.x*w,y:at(t).y+v.y*w}))));
    for(const beamId of s.contactBeamIds)assert.ok(plies.some(b=>b.beamId===beamId&&overlap(seat,b.poly)>1e-9),`${j.id}: no physical contact with ${beamId}`);
    assert.equal(s.sourceDirectContact,s.contactBeamIds.includes(s.sourceId));if(!s.sourceDirectContact)aliases++;
  }
  assert.ok(aliases>0,'The edge joist must expose its real primary-beam contact at a butt T joint.');
  assert.ok(r.floorPlatform.checks.some(c=>c.id==='floor-grillage-node-transfer-L1'&&c.status==='unverified'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateDesigner,defaultDesignerProject,pointInPolygon} from './designer-engine.js';
import {calculateRoofZones} from './roof-zones.js';
import {calculateRoofDrainage,orientRoofsAwayFromWalls} from './roof-drainage.js';
import {calculateCutting} from './cutting.js';

const clone=x=>JSON.parse(JSON.stringify(x));
const near=(a,b,tol=1e-5)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<tol,`${a} ≠ ${b}`);
const sample=JSON.parse(readFileSync(new URL('../public/examples/l-two-levels.json',import.meta.url),'utf8')).project;
const lowerIds=['roof-level-1-1','roof-level-1-2'];
function oldGables(){
  const p=clone(sample);
  for(const [i,id] of lowerIds.entries()){
    const zone=p.roof.zones.find(z=>z.id===id);assert.ok(zone,`Sample lost ${id}`);
    Object.assign(zone,{shape:'gable',ridgeAngle:i===0?0:90,pitchLeft:30,pitchRight:20,trussType:'queen',levelIndex:1,elevation:null});
  }
  return p;
}
function calculate(p){const base=calculateDesigner(p),roof=calculateRoofZones(p,base),drainage=calculateRoofDrainage(p,base,roof);return {p,base,roof,drainage,result:calculateDesigner(p,{roofModel:roof})};}
function corrected(){
  const old=calculate(oldGables()),fix=orientRoofsAwayFromWalls(old.p,old.base,old.roof),p=clone(old.p);
  assert.ok(Array.isArray(fix.zones));p.roof.zones=fix.zones;
  return {old,fix,...calculate(p)};
}

test('actual L-house sample: old lower gables discharge into raised floor/walls',()=>{
  const {base,roof,drainage}=calculate(oldGables());
  near(base.geometry.levels[0].topY,3.805);near(base.geometry.levels[1].baseY,3.805);near(base.geometry.levels[1].wallBaseY,4.09);near(base.geometry.levels[1].topY,6.69);
  near(roof.projectedArea,92);near(drainage.quantities.projectedCatchmentArea,92);
  const blocked=drainage.flows.filter(f=>f.status==='wallBlock');
  assert.ok(blocked.some(f=>f.zoneId===lowerIds[0]),'South lower roof must detect inflow at y=5');
  assert.ok(blocked.some(f=>f.zoneId===lowerIds[1]),'East lower roof must detect inflow at x=8');
  assert.ok(drainage.issues.some(i=>i.code==='wall-inflow'));
  assert.ok(drainage.quantities.unresolvedArea>0);
});

test('suggested mono roofs point away from high walls; all 92m² reach exterior outlets',()=>{
  const {fix,p,base,roof,drainage}=corrected();
  for(const id of lowerIds)assert.ok(fix.appliedZoneIds.includes(id));
  const south=p.roof.zones.find(z=>z.id===lowerIds[0]),east=p.roof.zones.find(z=>z.id===lowerIds[1]);
  assert.equal(south.shape,'mono');assert.equal(east.shape,'mono');
  const downhill=z=>[Math.sin(z.ridgeAngle*Math.PI/180),-Math.cos(z.ridgeAngle*Math.PI/180)];
  near(downhill(south)[0],0);near(downhill(south)[1],1);near(downhill(east)[0],1);near(downhill(east)[1],0);
  near(roof.projectedArea,92);near(drainage.quantities.projectedCatchmentArea,92);near(drainage.quantities.totalResolvedArea,92);near(drainage.quantities.unresolvedArea,0);
  assert.equal(drainage.flows.some(f=>f.status==='wallBlock'),false);
  assert.ok(drainage.flows.some(f=>f.status==='roofTransfer'),'Upper south slope should transfer to the lower wing');
  for(const f of drainage.flows.filter(f=>f.resolved&&f.catchmentArea>1e-6)){
    assert.ok(f.outletEdgeId,'Resolved flow must identify its final outlet edge');
    const last=f.path.at(-1);assert.ok(Array.isArray(last)&&last.length===3,'Flow route uses absolute XYZ points');
    assert.equal(pointInPolygon({x:last[0],y:last[2]},base.geometry.polygon,false),false,'Final discharge must reach the external ground footprint boundary');
  }
});

test('drainage fix updates real roof mass, six-metre stock map and foundation loads exactly once',()=>{
  const {old,p,roof,result}=corrected(),oldStock=calculateCutting(old.p,old.result),stock=calculateCutting(p,result);
  assert.ok(Math.abs(roof.mass-old.roof.mass)>1e-4,'Mono geometry must change the actual roof BOM');
  near(result.timber.totals.roof.mass,roof.mass);
  assert.ok(result.timber.instances.every(b=>Number.isFinite(b.mass)&&b.cutLength<=6+1e-7));
  assert.equal(stock.overlength.length,0);assert.equal(stock.invalid.length,0);
  assert.equal(stock.summary.pieces,result.timber.instances.length);
  assert.ok(Math.abs(stock.summary.usedVolume-oldStock.summary.usedVolume)>1e-6,'Changed roof must alter the physical cut map');
  for(const s of stock.stocks)assert.ok(s.consumed<=6+1e-7);
  const expected=(result.timber.mass-old.result.timber.mass)*9.80665/1000*p.loads.gammaG
    +(roof.area-old.roof.area)*p.loads.roofDead*p.loads.gammaG
    +(roof.gableArea-old.roof.gableArea)*p.loads.wallDead*p.loads.gammaG
    +(roof.snowEffectiveArea-old.roof.snowEffectiveArea)*p.loads.snow*p.loads.gammaQ;
  near(result.loads.totalDesign-old.result.loads.totalDesign,expected);
  near(result.foundation.reactionSum,result.loads.totalDesign);
  const zones=new Map(roof.zones.map(z=>[z.id,z]));
  for(const board of result.timber.instances.filter(b=>b.category==='roof')){
    assert.ok(zones.has(board.zoneId));assert.equal(board.level,zones.get(board.zoneId).levelIndex,'Lower-wing boards must keep their actual floor tag');
  }
});

test('default rectangular automatic roof has connected exterior drainage without phantom walls',()=>{
  const p=clone(defaultDesignerProject);delete p.roof.zones;
  const {roof,drainage}=calculate(p);near(roof.projectedArea,96);near(drainage.quantities.projectedCatchmentArea,96);near(drainage.quantities.totalResolvedArea,96);near(drainage.quantities.unresolvedArea,0);assert.equal(drainage.flows.some(f=>f.status==='wallBlock'),false);
});
test('automatic two-level L-house rebuild orients lower wings away from the raised floor',()=>{
  const p=clone(sample);delete p.roof.zones;const {roof,drainage,base}=calculate(p);
  assert.equal(roof.autoDrainageAdjusted,true);near(roof.projectedArea,92);near(drainage.quantities.projectedCatchmentArea,92);near(drainage.quantities.totalResolvedArea,92);near(drainage.quantities.unresolvedArea,0);assert.equal(drainage.flows.some(f=>f.status==='wallBlock'),false);
  const changed=roof.zones.filter(z=>z.levelIndex===1&&z.shape==='mono');assert.ok(changed.length>0,'The lower slope that discharged into a wall must be reoriented');
  for(const f of drainage.flows.filter(f=>f.resolved&&f.catchmentArea>1e-6)){const last=f.path.at(-1);assert.equal(pointInPolygon({x:last[0],y:last[2]},base.geometry.polygon,false),false,'Automatic flow must terminate at the exterior ground-footprint boundary');}
});

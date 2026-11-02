import test from 'node:test';import assert from 'node:assert/strict';
import {calculateDesigner,defaultDesignerProject} from './designer-engine.js';import {calculateRoofZones} from './roof-zones.js';import {calculateCutting} from './cutting.js';import {checkDesignerMembers} from './designer-mechanics.js';
const near=(a,b,t=1e-6)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} ≠ ${b}`);
const clone=x=>JSON.parse(JSON.stringify(x));
function project(method='none',openings=true){
  const p=clone(defaultDesignerProject),points=[{x:0,y:0},{x:6,y:0},{x:6,y:4},{x:0,y:4}];p.walls=points.map((a,i)=>({id:'w'+i,a,b:points[(i+1)%4],kind:'exterior',level:1,section:'50x150',studStep:.6}));p.openings=openings?[{id:'window',wallId:'w0',offset:2.25,width:1.5,height:1.4,sill:.8,type:'window',floor:1}]:[];p.roof.type='none';p.bracing={method,section:'25x100',sheetWidth:1.25,sheetHeight:2.5,thickness:12,edgeNailSpacing:150,fieldNailSpacing:300,designShear:null,sheetDensity:650};return p;
}
function calculate(p){const base=calculateDesigner(p),roof=p.roof.type==='none'?null:calculateRoofZones(p,base),r=roof?calculateDesigner(p,{roofModel:roof}):base;return {p,r,roof,m:r.bracingModel,cutting:calculateCutting(p,r),mechanics:checkDesignerMembers(p,r)};}
const local=(point,w)=>{const L=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y);return {x:((point[0]-w.a.x)*(w.b.x-w.a.x)+(point[2]-w.a.y)*(w.b.y-w.a.y))/L,y:point[1]};};
function interiorOverlap(a,b){
  for(const poly of [a,b])for(let i=0;i<poly.length;i++){const q=poly[i],r=poly[(i+1)%poly.length],axis={x:-(r.y-q.y),y:r.x-q.x};const pa=a.map(p=>p.x*axis.x+p.y*axis.y),pb=b.map(p=>p.x*axis.x+p.y*axis.y);if(Math.min(Math.max(...pa),Math.max(...pb))-Math.max(Math.min(...pa),Math.min(...pb))<=1e-8)return false;}return true;
}
const windowPolygon=(o,base)=>[{x:o.offset,y:base+o.sill},{x:o.offset+o.width,y:base+o.sill},{x:o.offset+o.width,y:base+o.sill+o.height},{x:o.offset,y:base+o.sill+o.height}];

test('none removes decorative X geometry and does not fabricate a lateral capacity',()=>{
  const {r,m,mechanics}=calculate(project());assert.equal(m.method,'none');assert.equal(m.instances.length,0);assert.equal(m.panels.length,0);assert.equal(m.notches.length,0);assert.equal(r.timber.instances.some(b=>['brace','letInBrace'].includes(b.role)),false);near(r.loads.structuralPanelWeight,0);assert.equal(mechanics.bracing.tension,null);assert.equal(mechanics.checks.some(c=>c.id==='designerBraceTension'),false);assert.ok(m.checks.some(c=>c.status==='unverified'));
});

test('let-in braces sit inside the wall depth at 45–60° without crossing windows or forming external Xs',()=>{
  const {p,r,m}=calculate(project('letIn'));assert.ok(m.braces.length>0);assert.equal(r.timber.instances.some(b=>b.role==='brace'),false);assert.equal(m.panels.length,0);
  const base=r.geometry.levels[0].wallBaseY;
  for(const b of m.braces){const w=p.walls.find(w=>w.id===b.wallId),a=local(b.start,w),z=local(b.end,w),run=Math.abs(z.x-a.x),rise=Math.abs(z.y-a.y),angle=Math.atan2(rise,run)*180/Math.PI;assert.ok(angle>=45-1e-6&&angle<=60+1e-6);assert.equal(b.connectedPlates,true);
    const L=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),n={x:-(w.b.y-w.a.y)/L,y:(w.b.x-w.a.x)/L},normalOffset=(b.start[0]-w.a.x)*n.x+(b.start[2]-w.a.y)*n.y;assert.ok(Math.abs(normalOffset)+b.b/2000<=.15/2+1e-7);
    const length=Math.hypot(z.x-a.x,z.y-a.y),nx=-(z.y-a.y)/length*b.h/2000,ny=(z.x-a.x)/length*b.h/2000,poly=[{x:a.x+nx,y:a.y+ny},{x:z.x+nx,y:z.y+ny},{x:z.x-nx,y:z.y-ny},{x:a.x-nx,y:a.y-ny}];
    for(const o of p.openings.filter(o=>o.wallId===w.id))assert.equal(interiorOverlap(poly,windowPolygon(o,base)),false);
  }
  for(const line of m.wallLines){const braces=m.braces.filter(b=>b.wallId===line.wallId);assert.equal(line.braceCount,braces.length);assert.ok(braces.every(b=>b.connectedPlates),'Every diagonal connects the real plates');}
});

test('let-in notches remove installed wood exactly once while gross stock blanks retain their full length',()=>{
  const none=calculate(project('none')),v=calculate(project('letIn')),rho=v.p.material.density;assert.ok(v.m.notches.length>0);const notchVolume=v.m.notches.reduce((s,n)=>s+n.volume,0);near(notchVolume,v.m.quantities.notchVolume);
  for(const n of v.m.notches){const b=v.r.timber.instances.find(b=>b.id===n.boardId);assert.ok(b);const original=none.r.timber.instances.find(x=>x.id===b.id);assert.ok(original);near(b.volume,original.volume-n.volume);near(b.mass,b.volume*rho);near(b.cutLength,original.cutLength);near(b.grossVolume,original.grossVolume);assert.ok(n.depth>0&&n.depth<=.025+1e-7);}
  const added=v.m.instances.reduce((s,b)=>s+b.volume,0);near(v.r.timber.volume-none.r.timber.volume,added-notchVolume);near(v.r.timber.mass-none.r.timber.mass,(added-notchVolume)*rho);near(v.r.timber.schedule.reduce((s,b)=>s+b.mass,0),v.r.timber.mass);near(v.r.timber.schedule.reduce((s,b)=>s+b.volume,0),v.r.timber.volume);near(v.r.loads.totalCharacteristic-none.r.loads.totalCharacteristic,(v.r.timber.mass-none.r.timber.mass)*9.80665/1000);near(v.r.foundation.reactionSum,v.r.loads.totalDesign);assert.equal(v.cutting.summary.pieces,v.r.timber.instances.length);assert.equal(v.cutting.invalid.length,0);assert.equal(v.cutting.overlength.length,0);
});

test('physical sheathing excludes windows, shares stock-sheet IDs and adds panel weight once outside timber stock',()=>{
  const v=calculate(project('sheathing')),none=calculate(project('none')),q=v.m.quantities;assert.ok(v.m.panels.length>0);near(q.sheetArea,v.r.geometry.netWallArea);near(q.panelMass,q.sheetArea*.012*650);near(q.panelMass,v.m.panels.reduce((s,p)=>s+p.mass,0));assert.equal(new Set(v.m.panels.map(p=>p.stockSheetId)).size,q.sheets);near(q.purchasedSheetArea,q.sheets*1.25*2.5);assert.ok(q.purchasedSheetArea>=q.sheetArea-1e-6);
  const base=v.r.geometry.levels[0].wallBaseY;for(const panel of v.m.panels){for(const o of v.p.openings.filter(o=>o.wallId===panel.wallId))assert.equal(interiorOverlap(panel.localPolygon,windowPolygon(o,base)),false);assert.equal(v.r.timber.instances.some(b=>b.id===panel.id),false);}
  const panelWeight=q.panelMass*9.80665/1000;near(v.r.loads.structuralPanelWeight,panelWeight);const rows=v.r.loads.rows.filter(r=>r.id==='structural-panels');assert.equal(rows.length,1);near(rows[0].characteristic,panelWeight);near(rows[0].design,panelWeight*v.p.loads.gammaG);near(v.r.loads.totalCharacteristic-none.r.loads.totalCharacteristic,(v.r.timber.mass-none.r.timber.mass)*9.80665/1000+panelWeight);near(v.r.loads.totalDesign-none.r.loads.totalDesign,((v.r.timber.mass-none.r.timber.mass)*9.80665/1000+panelWeight)*v.p.loads.gammaG);near(v.r.foundation.reactionSum,v.r.loads.totalDesign);assert.equal(v.cutting.summary.pieces,v.r.timber.instances.length);assert.equal(v.cutting.invalid.length,0);
});

test('sheet seams have actual timber backing or an explicit unresolved-edge condition',()=>{
  const {p,r,m}=calculate(project('sheathing'));assert.ok(m.instances.some(b=>['sheathingStud','sheathingBlocking'].includes(b.role)));assert.ok(m.quantities.blockingLength>0);
  const w=p.walls.find(w=>w.id==='w1'),line=m.wallLines.find(l=>l.wallId===w.id),seam=r.geometry.levels[0].wallBaseY+2.5;
  const boards=r.timber.instances.filter(b=>b.wallId===w.id||b.wallIds?.includes(w.id));let tested=0;
  for(const panel of m.panels.filter(q=>q.wallId===w.id))for(let i=0;i<panel.localPolygon.length;i++){const a=panel.localPolygon[i],b=panel.localPolygon[(i+1)%panel.localPolygon.length];if(Math.abs(a.y-seam)>1e-6||Math.abs(b.y-seam)>1e-6||Math.abs(a.x-b.x)<.05)continue;const q={x:(a.x+b.x)/2,y:seam};tested++;
    const backed=boards.some(board=>{const c=local(board.start,w),d=local(board.end,w);if(Math.abs(c.x-d.x)<1e-6)return Math.abs(q.x-c.x)<=board.b/2000+1e-6&&q.y>=Math.min(c.y,d.y)-1e-6&&q.y<=Math.max(c.y,d.y)+1e-6;if(Math.abs(c.y-d.y)<1e-6)return Math.abs(q.y-c.y)<=board.b/2000+1e-6&&q.x>=Math.min(c.x,d.x)-1e-6&&q.x<=Math.max(c.x,d.x)+1e-6;return false;});
    if(!backed)assert.ok(line.unsupportedEdges>0,'A missing seam support must remain explicit');
  }
  assert.ok(tested>0);assert.ok(line.checks.some(c=>c.id.endsWith('sheet-edges')&&c.status==='unverified'));
});

test('unknown diaphragm capacity remains unverified and modern bracing never gets legacy X resistance',()=>{
  for(const method of ['letIn','sheathing']){const {r,m,mechanics}=calculate(project(method));assert.ok(m.wallLines.length);for(const line of m.wallLines){assert.equal(line.designShear,null);assert.equal(line.capacity,null);assert.equal(line.utilization,null);assert.ok(line.checks.some(c=>c.id.endsWith('shear-capacity')&&c.status==='unverified'));assert.ok(line.checks.some(c=>c.id.endsWith('load-path')&&c.status==='unverified'));}assert.equal(mechanics.checks.some(c=>c.id==='designerBraceTension'),false);assert.equal(mechanics.bracing.tension,null);assert.ok(r.checks.some(c=>c.status==='unverified'));}
});

test('let-in geometry follows a full-height mono wall profile without short decorative diagonals',()=>{
  const p=project('letIn',false);p.roof.type='mono';p.roof.wallFraming='continuous';p.roof.zones=[{id:'mono',name:'Высокая стена',polygon:p.walls.map(w=>w.a),shape:'mono',ridgeAngle:180,pitchLeft:25,pitchRight:25,levelIndex:1,elevation:null,framing:'rafters',trussType:'mono',spacing:.6,chordSection:'50x200',webSection:'50x100'}];const {r,m,roof}=calculate(p);const highProfile=r.geometry.wallProfiles.find(q=>q.wallId==='w0'&&q.mode==='continuous');assert.ok(highProfile);const line=m.wallLines.find(l=>l.wallId==='w0'),brace=m.braces.find(b=>b.wallId==='w0');assert.ok(brace||line.checks.some(c=>c.status==='fail'),'An unavailable full-height diagonal must be explicit, not replaced with a short X');if(brace){const top=Math.max(brace.start[1],brace.end[1]);assert.ok(top>highProfile.highTop-.1);const angle=Math.atan2(Math.abs(brace.end[1]-brace.start[1]),Math.hypot(brace.end[0]-brace.start[0],brace.end[2]-brace.start[2]))*180/Math.PI;assert.ok(angle>=45-1e-6&&angle<=60+1e-6);}
  near(r.foundation.reactionSum,r.loads.totalDesign);near(r.timber.totals.roof.mass,roof.mass);assert.equal(r.timber.instances.some(b=>b.role==='brace'),false);
});
test('long added backing keeps exact geometry and mass, with a visible single-stock guard instead of invented joints',()=>{
  const p=project('sheathing',false),points=[{x:0,y:0},{x:6,y:0},{x:6,y:8},{x:0,y:8}];p.walls=points.map((a,i)=>({...p.walls[i],a,b:points[(i+1)%4]}));p.bracing.sheetWidth=.3;p.roof.type='mono';p.roof.wallFraming='continuous';p.roof.zones=[{id:'tall',name:'Проверка частей добавленных досок',polygon:points,shape:'mono',ridgeAngle:180,pitchLeft:45,pitchRight:45,levelIndex:1,elevation:null,framing:'rafters',trussType:'mono',spacing:.6,chordSection:'50x200',webSection:'50x100'}];const {p:input,r,m,roof,cutting}=calculate(p);
  const long=m.instances.filter(b=>b.role==='sheathingStud'&&b.length>6);assert.ok(long.length>0,'Fixture must exercise an added raw board longer than stock');
  for(const source of long){assert.equal(source.requireSingleStock,true);const board=r.timber.instances.find(b=>b.id===source.id);assert.ok(board);near(board.length,source.length);assert.equal(board.partIndex,undefined);assert.ok(cutting.overlength.some(p=>p.sourceId===board.id));assert.equal(r.splices.some(j=>j.memberId===board.memberId),false);}
  const parts=r.timber.instances.filter(b=>b.partIndex!==undefined);assert.ok(parts.length>0,'Other logical members exercise the six-metre splitting pipeline');assert.ok(parts.every(b=>b.cutLength<=6+1e-7));
  for(const b of r.timber.instances){const geometricLength=Math.hypot(...b.end.map((v,i)=>v-b.start[i]));near(b.length,geometricLength);const A=b.b*b.h/1e6,lap=A*[b.cutStart,b.cutEnd].reduce((s,c)=>s+(['halfLap','half-lap','scarf'].includes(c?.scheme)?(c.lapLength??0)/2:0),0),notches=(b.notches??[]).reduce((s,n)=>s+(n.removedVolume??0),0);near(b.volume,geometricLength*A-lap-notches);near(b.mass,b.volume*input.material.density);near(b.grossVolume,b.cutLength*A);}
  near(r.timber.mass,r.timber.instances.reduce((s,b)=>s+b.mass,0));near(r.timber.totals.roof.mass,roof.mass);near(r.foundation.reactionSum,r.loads.totalDesign);
});

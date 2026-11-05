import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundled='/Users/woipot/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const python=process.env.KARKAS_PYTHON||(existsSync(bundled)?bundled:'python3');
function inspect(report){
  const code=String.raw`
import json,runpy,sys
m=runpy.run_path('scripts/structural-album.py');A=m['Album'];report=json.load(sys.stdin)
a=A.__new__(A);a.r=report['result'];a.members=a.r['timber']['instances']
details=a.plate_corner_details()
print(json.dumps([{'id':d['corner']['id'],'records':[{'id':r['member']['id'],'layer':r['layer'],'position':r['position'],'joint':r['joint'],'polygon':a.projected_member(r['member'],lambda p:(p[0],p[2]))} for r in d['records']]} for d in details]))
`;
  return JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(report),encoding:'utf8'}));
}
function fixture(){
  const members=[];
  for(const [position,layer,y] of [['bottom',0,.04],['top',0,2.6],['top',1,2.68]]){
    const flip=position==='top'&&layer===1;
    for(const wallId of ['W1','W2']){
      const through=(wallId==='W1')!==flip,offset=through?-.075:.075;
      members.push({id:`${position}-${layer}-${wallId}`,role:'plate',b:75,h:150,crossAxis:[0,1,0],start:wallId==='W1'?[offset,y,0]:[0,y,offset],end:wallId==='W1'?[1,y,0]:[0,y,1],platePosition:position,plateLayer:layer,cornerEndJoints:[{cornerId:'C1',wallId,neighborWallId:wallId==='W1'?'W2':'W1',end:'start',through,offset}]});
    }
  }
  return {result:{corners:[{id:'C1',kind:'corner',level:1,point:{x:0,y:0},wallIds:['W1','W2']}],timber:{instances:members}}};
}

function projectSection(board){
  const code=String.raw`
import json,runpy,sys
A=runpy.run_path('scripts/structural-album.py')['Album'];a=A.__new__(A)
print(json.dumps(a.projected_member(json.load(sys.stdin),lambda p:(p[0],p[1]))))
`;
  return JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(board),encoding:'utf8'}));
}
test('PDF width-face and layered profiles project their real40mm face rather than150mm thickness',()=>{
 const base={b:40,h:150,start:[0,1,0],end:[2,1,0],crossAxis:[0,1,0]},P=[[-1,-.02],[1,-.02],[1,.02],[-1,.02]];
 for(const shape of[{type:'rippedBoard',plane:'width',points:P},{type:'layeredProfile',plane:'width',layers:[{from:-.075,to:.035,points:P},{from:.035,to:.075,points:[[-1,-.02],[-.1,-.02],[-.1,.02],[-1,.02]]}]}]){const Q=projectSection({...base,shape});assert.ok(Math.abs(Math.min(...Q.map(p=>p[1]))-.98)<1e-8);assert.ok(Math.abs(Math.max(...Q.map(p=>p[1]))-1.02)<1e-8);}
});

test('PDF corner selection preserves all six actual plate bodies and the alternating upper joint',()=>{
  const details=inspect(fixture());assert.equal(details.length,1);assert.equal(details[0].records.length,6);
  const byId=new Map(details[0].records.map(r=>[r.id,r]));
  const lower=byId.get('bottom-0-W1'),upper=byId.get('top-1-W1');
  assert.equal(lower.joint.through,true);assert.equal(upper.joint.through,false);
  assert.ok(Math.abs(Math.min(...lower.polygon.map(p=>p[0]))+.075)<1e-10);
  assert.ok(Math.abs(Math.min(...upper.polygon.map(p=>p[0]))-.075)<1e-10);
  assert.ok(Math.abs(Math.max(...lower.polygon.map(p=>p[1]))-Math.min(...lower.polygon.map(p=>p[1]))-.15)<1e-10);
  // Projected ends remain exactly the supplied physical ends; wall-axis endpoints are never substituted.
  const changed=fixture();changed.result.timber.instances[0].start[0]=-.12;
  assert.ok(Math.abs(Math.min(...inspect(changed)[0].records.find(r=>r.id===lower.id).polygon.map(p=>p[0]))+.12)<1e-10);
});

test('legacy or incomplete metadata never produces a guessed corner layer',()=>{
  const report=fixture();for(const board of report.result.timber.instances)delete board.cornerEndJoints;
  assert.deepEqual(inspect(report),[]);
  const partial=fixture();delete partial.result.timber.instances[4].plateLayer;
  const selected=inspect(partial)[0].records;assert.equal(selected.length,5);assert.equal(selected.some(r=>r.id==='top-1-W1'),false);
});

test('roof projections retain supplied seat notches and signed depth-plane miter ends',()=>{
  const board={start:[0,0,0],end:[1,0,0],b:50,h:200,crossAxis:[0,0,1]};
  const profile=[[-.5,-.1],[-.25,-.1],[-.25,-.05],[-.1,-.05],[-.1,-.1],[.5,-.1],[.5,.1],[-.5,.1]];
  const seat=projectSection({...board,shape:{type:'rafterSeats',points:profile}});
  assert.equal(seat.length,8);assert.ok(seat.some(([x,y])=>Math.abs(x-.25)<1e-10&&Math.abs(y+.05)<1e-10));
  const cut=projectSection({...board,cutStart:{scheme:'miter',angle:45,plane:'depth',tiltSign:1}});
  assert.ok(Math.abs(Math.min(...cut.map(p=>p[0]))+.1)<1e-10);
  const flipped=projectSection({...board,cutStart:{scheme:'miter',angle:45,plane:'depth',tiltSign:-1}});
  assert.ok(cut.some(([x,y])=>x<0&&y<0));assert.ok(flipped.some(([x,y])=>x<0&&y>0));
});

test('frame tables preserve reported force/deflection units and never fill an unknown stiffness',()=>{
  const code=String.raw`
import json,runpy,sys
A=runpy.run_path('scripts/structural-album.py')['Album'];a=A.__new__(A);z=json.load(sys.stdin)
print(json.dumps({'forces':a.roof_frame_force_rows(z),'model':a.roof_frame_model_rows(z)},ensure_ascii=False))
`;
  const zone={id:'Z1',frameAnalysis:{nodes:[{id:'A'},{id:'B'}],elements:[{id:'E1',b:50,h:150,E:10000,releaseA:true,releaseB:false}],design:{elementResults:[{id:'E1',EA:75000,EI:140.625,kind:'frame'}]},service:{},members:[{id:'E1',role:'topChord',b:50,h:150,length:3.5,maxAxial:12.345,maxShear:4,maxMoment:1.23,deflectionMM:8.4,limitMM:11.7,utilization:.72,status:'pass'},{id:'unknown',role:'collarTie'}]}};
  const out=JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(zone),encoding:'utf8'}));
  assert.equal(out.forces[0][3],'12,345');assert.equal(out.forces[0][6],'8,400 / 11,700');
  assert.equal(out.forces[1][3],'-');assert.equal(out.forces[1][6],'- / -');
  assert.ok(out.model.some(r=>r[1].includes('EA = 75 000,000 кН')&&r[1].includes('EI = 140,6250 кН·м²')));
  delete zone.frameAnalysis.design.elementResults[0].EI;
  const missing=JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(zone),encoding:'utf8'}));
  assert.ok(missing.model.some(r=>r[1].includes('EI = - кН·м²')));
});

test('a profiled side-lap plan retains75/50mm thickness and uses the actual offset only once',()=>{
  const code=String.raw`
import json,runpy,sys
A=runpy.run_path('scripts/structural-album.py')['Album'];a=A.__new__(A)
print(json.dumps([a.projected_member(b,lambda p:(p[0],p[2])) for b in json.load(sys.stdin)]))
`;
  const boards=[{b:75,h:200,start:[0,0,0],end:[1,0,0],crossAxis:[0,0,1],shape:{type:'rafterSeats',points:[[-.5,-.1],[.5,-.1],[.5,.1],[-.5,.1]]}},{b:50,h:100,start:[0,0,.0625],end:[1,0,.0625],crossAxis:[0,0,1],outOfPlaneOffset:.0625,shape:{type:'rippedBoard',points:[[-.5,-.05],[.5,-.05],[.5,.05],[-.5,.05]]}}];
  const polygons=JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(boards),encoding:'utf8'}));
  const ranges=polygons.map(poly=>[Math.min(...poly.map(p=>p[1])),Math.max(...poly.map(p=>p[1]))]);
  assert.ok(Math.abs(ranges[0][1]-ranges[0][0]-.075)<1e-10);assert.ok(Math.abs(ranges[1][1]-ranges[1][0]-.05)<1e-10);
  assert.ok(Math.abs(ranges[0][1]-ranges[1][0])<1e-10);assert.ok(Math.abs(ranges[1][0]-.0375)<1e-10);
});

test('collar detail resolves canonicalworld IDs and keeps snow-envelope demand separate from the selected row',()=>{
  const code=String.raw`
import json,runpy,sys
A=runpy.run_path('scripts/structural-album.py')['Album'];a=A.__new__(A);r=json.load(sys.stdin);a.r=r['result'];a.members=a.r['timber']['instances'];z=a.r['roofModel']['zones'][0]
print(json.dumps({'detail':a.collar_lap_detail(z),'snow':a.collar_lap_snow_envelope(z)}))
`;
  const connection=(n,worldIds)=>({id:'C',demandKN:n,axisOffsetMomentScaleKNm:n*.0625,memberWorldIds:worldIds,memberSourceBoardIds:['raw-source'],worldContactPolygon:[[0,0,0],[0,1,0],[0,1,1]]});
  const report={result:{timber:{instances:[{id:'canonical-collar',role:'collarTie'},{id:'canonical-rafter',role:'topChord'}]},roofModel:{zones:[{id:'Z',frameRows:[{row:0,u:0,lapConnections:[connection(5,['canonical-collar','canonical-rafter'])]},{row:1,u:1,lapConnections:[connection(12,['canonical-collar','canonical-rafter'])]}]}]},snowAssessment:{cases:[{id:'snow150',frames:[{zoneId:'Z',connections:[connection(17,[])]}]}]}}};
  const out=JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(report),encoding:'utf8'}));
  assert.equal(out.detail.row.row,1);assert.equal(out.detail.contacts[0].demandKN,12);assert.deepEqual(out.detail.members.map(m=>m.id),['canonical-collar','canonical-rafter']);
  assert.equal(out.snow.connection.demandKN,17);assert.equal(out.snow.connection.axisOffsetMomentScaleKNm,1.0625);assert.deepEqual(out.snow.caseIds,['snow150']);
  report.result.roofModel.zones[0].frameRows=[];const legacy=JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(report),encoding:'utf8'}));assert.equal(legacy.detail,null);
});

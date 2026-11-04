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
import runpy,json,sys
m=runpy.run_path('scripts/structural-album.py');a=m['Album'].__new__(m['Album']);d=json.load(sys.stdin);a.r=d['result'];a.members=a.r['timber']['instances'];a.roof=a.r.get('roofModel')or{};a.wall_map={w['id']:w for w in d['project']['walls']};a.wall_names={w['id']:'Стена 01'for w in d['project']['walls']};a.marks=d['marks'];before=json.dumps(a.members,sort_keys=True)
details=a.partition_head_details()
print(json.dumps({'details':[{'row':a.partition_head_row(x),'gap':x['gap'],'physicalTopY':x['physicalTopY'],'targets':[b['id']for b in x['targets']],'ceiling':[b['id']for b in x['ceilingMembers']],'zones':[z['id']for z in x['zones']],'record':x['record']}for x in details],'unchanged':before==json.dumps(a.members,sort_keys=True)},ensure_ascii=False))
`;
  return JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(report),encoding:'utf8'}));
}
function fixture(){
  return {project:{walls:[{id:'W',kind:'partition',a:{x:1,y:0},b:{x:1,y:3},height:2.75,topAttachment:{target:'roofTieUnderside',gap:.02,mode:'sliding'}}]},marks:{'wall-top':'FG001','actual-tie':'FG002','actual-batten':'FG003','actual-hanger':'FG004'},result:{partitionHeads:{items:[{wallId:'W',level:1,topY:4.235,targetY:4.255,effectiveHeight:3.08,targetSourceMemberIds:['raw-RZ-tie'],targetMemberIds:['actual-tie'],verticalBearing:false}]},timber:{instances:[
    {id:'wall-top',wallId:'W',category:'walls',role:'plate',b:50,h:98,start:[1,4.210,0],end:[1,4.210,3],crossAxis:[0,1,0]},
    {id:'actual-tie',sourceBoardId:'raw-RZ-tie',zoneId:'Z',category:'roof',role:'bottomChord',b:50,h:200,start:[1,4.355,0],end:[1,4.355,6],crossAxis:[-1,0,0]},
    {id:'actual-batten',zoneId:'Z',category:'ceiling',role:'ceilingBatten',b:50,h:100,start:[0,3.93,1],end:[6,3.93,1],crossAxis:[0,1,0]},
    {id:'actual-hanger',zoneId:'Z',category:'ceiling',role:'ceilingHanger',b:50,h:50,start:[1,3.955,1],end:[1,4.255,1],crossAxis:[1,0,0]},
    {id:'different-zone',zoneId:'other',category:'ceiling',role:'ceilingBatten',b:50,h:100,start:[0,3.93,1],end:[6,3.93,1],crossAxis:[0,1,0]}
  ]},roofModel:{zones:[{id:'Z',ceilingDatumY:3.955,ceilingInsulationTopY:4.155}]}}};
}

test('head detail uses effective metadata and canonical roof targets while leaving the ceiling plane unchanged',()=>{
  const out=inspect(fixture());assert.equal(out.details.length,1);const d=out.details[0];
  assert.deepEqual(d.targets,['actual-tie']);assert.deepEqual(d.ceiling,['actual-batten','actual-hanger']);assert.deepEqual(d.zones,['Z']);
  assert.ok(Math.abs(d.gap-.02)<1e-10);assert.ok(Math.abs(d.physicalTopY-4.235)<1e-10);
  assert.equal(d.row[1],'3,080');assert.equal(d.row[2],'+4,235');assert.equal(d.row[3],'+4,255');assert.equal(d.row[4],'20,0');assert.equal(d.row[5],'FG002');
  assert.equal(d.record.verticalBearing,false);assert.equal(out.unchanged,true);
});

test('the renderer never guesses canonical targets from raw roof IDs or supplies a20mm gap for missing metadata',()=>{
  const data=fixture();delete data.result.partitionHeads.items[0].targetMemberIds;delete data.result.partitionHeads.items[0].targetY;
  const d=inspect(data).details[0];assert.deepEqual(d.targets,[]);assert.deepEqual(d.ceiling,[]);assert.equal(d.gap,null);assert.equal(d.row[3],'-');assert.equal(d.row[4],'-');assert.equal(d.row[5],'Не сопоставлены');
});

test('the adopted gap and height come from each item rather than being hardcoded to the new house',()=>{
  const data=fixture();data.result.partitionHeads.items[0].targetY=4.250;data.result.partitionHeads.items[0].effectiveHeight=2.96;
  const d=inspect(data).details[0];assert.equal(d.row[1],'2,960');assert.equal(d.row[4],'15,0');
});

test('legacy reports without explicit partitionHeads do not synthesize raised walls or new details',()=>{
  const data=fixture();delete data.result.partitionHeads;assert.deepEqual(inspect(data).details,[]);
});

function inspectWallFrame(report){
  const code=String.raw`
import runpy,json,sys
A=runpy.run_path('scripts/structural-album.py')['Album'];a=A.__new__(A);d=json.load(sys.stdin);a.members=d['result']['timber']['instances'];w=d['project']['walls'][0];before=json.dumps(a.members,sort_keys=True);v=a.wall_frame_data(w)
print(json.dumps({'members':[m['id']for m in v['members']],'bounds':v['bounds'],'axisLength':v['axisLength'],'height':v['bounds'][3]-v['bounds'][1]if v['bounds']else None,'width':v['bounds'][2]-v['bounds'][0]if v['bounds']else None,'unchanged':before==json.dumps(a.members,sort_keys=True)}))
`;
  return JSON.parse(execFileSync(python,['-c',code],{cwd:root,input:JSON.stringify(report),encoding:'utf8'}));
}
function frameFixture(){
  return {project:{walls:[{id:'W',kind:'partition',a:{x:0,y:0},b:{x:3,y:0},height:2.75}]},result:{timber:{instances:[
    {id:'sole',category:'walls',role:'plate',wallId:'W',b:48,h:98,start:[0,1.179,0],end:[3,1.179,0],crossAxis:[0,1,0]},
    {id:'upper',category:'walls',role:'plate',wallId:'W',b:48,h:98,start:[0,4.211,0],end:[3,4.211,0],crossAxis:[0,1,0]},
    {id:'stud',category:'walls',role:'stud',wallId:'W',b:48,h:98,start:[1,1.203,0],end:[1,4.187,0],crossAxis:[1,0,0]},
    {id:'floor-with-wall-id',category:'floor',role:'rimJoist',wallId:'W',b:50,h:200,start:[0,1.02,0],end:[3,1.02,0],crossAxis:[0,0,1]},
    {id:'floor-with-wall-ids',category:'floor',role:'wallTransferBlocking',wallIds:['W'],b:50,h:200,start:[0,1.02,0],end:[3,1.02,0],crossAxis:[0,0,1]}
  ]}}};
}

test('wall elevations dimension the outside face of the48mm top plate rather than its axis24mm below',()=>{
  const out=inspectWallFrame(frameFixture());
  assert.ok(Math.abs(out.bounds[1]-1.155)<1e-10);assert.ok(Math.abs(out.bounds[3]-4.235)<1e-10);
  assert.ok(Math.abs(out.height-3.08)<1e-10);assert.equal(out.axisLength,3);
  assert.ok(Math.abs(out.bounds[3]-4.211-.024)<1e-10);assert.equal(out.unchanged,true);
});

test('floor boards carrying wallId or wallIds are not counted or drawn as wall-elevation timber',()=>{
  const out=inspectWallFrame(frameFixture());assert.deepEqual(out.members,['sole','upper','stud']);
  assert.ok(out.bounds[1]>1.15);assert.equal(out.unchanged,true);
});

test('physical facade width includes real plate extensions while retaining the separate wall-axis reference',()=>{
  const data=frameFixture();data.result.timber.instances[1].start[0]=-.075;data.result.timber.instances[1].end[0]=3.075;
  const out=inspectWallFrame(data);assert.equal(out.axisLength,3);assert.ok(Math.abs(out.width-3.15)<1e-10);assert.ok(Math.abs(out.bounds[0]+.075)<1e-10);
});

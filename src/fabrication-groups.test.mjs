import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFabricationGroups,partGeometryKey,fabricationPartsToCSV,fabricationStocksToCSV} from './fabrication-groups.js';
const board=(id,extra={})=>({id,b:50,h:150,length:2,cutLength:2,start:[0,0,0],end:[2,0,0],crossAxis:[0,0,1],cutStart:{scheme:'butt',angle:0},cutEnd:{scheme:'miter',angle:30,plane:'height',tiltSign:1},...extra});
const stock=(id,ids)=>({id,section:'50x150',b:50,h:150,length:6,pieces:ids.map((id,i)=>({id,length:2,start:i*2.003,end:i*2.003+2})),used:ids.length*2,consumed:ids.length*2+(ids.length-1)*.003,kerfWaste:(ids.length-1)*.003,remainder:6-ids.length*2-(ids.length-1)*.003,reusable:true});
test('identical geometry merges across IDs, roles, levels and world translation',()=>{
 const a=board('a',{wallId:'w1',floor:1,role:'stud'}),b=board('b',{start:[5,8,9],end:[7,8,9],wallId:'w2',floor:2,role:'joist'});
 const f=buildFabricationGroups({result:{timber:{instances:[a,b]}}});assert.equal(f.partGroups.length,1);assert.equal(f.partGroups[0].count,2);assert.equal(f.partGroups[0].applications.length,2);assert.deepEqual(f.partGroups[0].physicalIds,['a','b']);
});
test('saw plane, tilt sign, angle, lap side and lap length remain distinct',()=>{
 const base=board('a');for(const delta of [{plane:'width'},{tiltSign:-1},{angle:31},{scheme:'halfLap',lapLength:.3,lapSide:'top'},{scheme:'halfLap',lapLength:.3,lapSide:'bottom'}])assert.notEqual(partGeometryKey(base),partGeometryKey({...base,cutEnd:{...base.cutEnd,...delta}}));
 assert.notEqual(partGeometryKey(board('a',{cutEnd:{scheme:'halfLap',lapLength:.3,lapSide:'top'}})),partGeometryKey(board('b',{cutEnd:{scheme:'halfLap',lapLength:.4,lapSide:'top'}})));
});
test('notch polygons normalize rigid translation and rotation but preserve mirrors',()=>{
 const notch={id:'n1',boardId:'a',depth:.02,shape:'polygon',polygon:[[.3,0,.01],[.5,0,.01],[.5,.02,.01],[.3,.02,.01]]};
 const a=board('a',{notches:[notch]});
 const rot=p=>[-p[2]+10,p[1]+5,p[0]+3];
 const b=board('b',{start:rot(a.start),end:rot(a.end),crossAxis:[-1,0,0],notches:[{...notch,id:'other',boardId:'b',polygon:notch.polygon.map(rot)}]});
 assert.equal(partGeometryKey(a),partGeometryKey(b));
 const mirror=board('c',{notches:[{...notch,polygon:notch.polygon.map(([x,y,z])=>[x,y,-z])}]});assert.notEqual(partGeometryKey(a),partGeometryKey(mirror));
 const deeper=board('d',{notches:[{...notch,depth:.025}]});assert.notEqual(partGeometryKey(a),partGeometryKey(deeper));
});
test('unknown notch frame and unfinished cuts never merge by a guessed shape',()=>{
 const extra={start:undefined,end:undefined,notches:[{depth:.02,polygon:[[0,0,0],[1,0,0],[1,1,0]]}]};assert.notEqual(partGeometryKey(board('a',extra)),partGeometryKey(board('b',extra)));
 assert.notEqual(partGeometryKey(board('a',{notches:[{requiresCutBoolean:true}]})),partGeometryKey(board('b',{notches:[{requiresCutBoolean:true}]})));
});
test('patterns group equal ordered FG positions while retaining every physical and stock ID',()=>{
 const ms=['a','b','c','d'].map(id=>board(id));const s1=stock('S1',['a','b']),s2=stock('S2',['c','d']);
 const f=buildFabricationGroups({result:{timber:{instances:ms}},cutting:{kerf:.003,kerfMM:3,stocks:[s1,s2]}});assert.equal(f.patternGroups.length,1);assert.equal(f.patternGroups[0].count,2);assert.deepEqual(f.patternGroups[0].stockIds,['S1','S2']);assert.equal(f.physicalRows.length,4);assert.equal(f.physicalRows.find(x=>x.physicalId==='d').stockId,'S2');assert.equal(f.summary.unmappedParts,0);
 for(const id of ['a','b','c','d'])assert.ok(fabricationPartsToCSV(f).includes('"'+id+'"'));for(const id of ['S1','S2'])assert.ok(fabricationStocksToCSV(f).includes('"'+id+'"'));
});
test('pattern order, positions, kerf and remainder cannot be collapsed',()=>{
 const a=board('a'),b=board('b',{cutEnd:{scheme:'butt',angle:0}}),c=board('c'),d=board('d',{cutEnd:{scheme:'butt',angle:0}});
 const s1=stock('S1',['a','b']),s2=stock('S2',['d','c']);let f=buildFabricationGroups({result:{timber:{instances:[a,b,c,d]}},cutting:{stocks:[s1,s2]}});assert.equal(f.patternGroups.length,2);
 const s3={...stock('S3',['c','d']),remainder:.8};f=buildFabricationGroups({result:{timber:{instances:[a,b,c,d]}},cutting:{stocks:[s1,s3]}});assert.equal(f.patternGroups.length,2);
 const s4=stock('S4',['c','d']);s4.pieces[1].start+=.001;f=buildFabricationGroups({result:{timber:{instances:[a,b,c,d]}},cutting:{stocks:[s1,s4]}});assert.equal(f.patternGroups.length,2);
});
test('CSV quotes separators and quotes, and empty reports are supported',()=>{
 const f=buildFabricationGroups({result:{timber:{instances:[board('a;"b',{wallId:'w;1'})]}}});assert.ok(fabricationPartsToCSV(f).includes('"a;""b"'));assert.deepEqual(buildFabricationGroups().summary,{physicalParts:0,partGroups:0,stockBoards:0,patternGroups:0,unmappedParts:0});
});
test('CSV guards formula-like text without changing negative numeric coordinates',()=>{
 const csv=fabricationPartsToCSV({physicalRows:[{physicalId:' =SUM(1)',wallId:'+wall',voidId:'@void',role:'-role',cutStart:-.1,cutEnd:2,wallIds:[]}]});
 for(const value of [' =SUM(1)','+wall','@void','-role'])assert.ok(csv.includes('"\''+value+'"'));
 assert.ok(csv.includes('"-0.1"'));assert.ok(!csv.includes('"\'-0.1"'));
});
test('installation coordinates and support links stay per physical board while rim edge is compact application context',()=>{
 const a=board('a',{role:'rimJoist',rimEdge:1,start:[-1,3,2],end:[1,3,2],supportStart:{sourceId:'wall-A'},supportEnd:{sourceId:'wall-B'},blockingStation:0,supports:[{memberIds:['J1','J2']},{memberIds:['J2','J3']}],sourceMemberIds:['RAW1']}),b=board('b',{role:'rimJoist',rimEdge:2,start:[4,3,2],end:[6,3,2],sourceMemberIds:['RAW2']});
 const f=buildFabricationGroups({result:{timber:{instances:[a,b]}}});assert.equal(f.partGroups.length,1);assert.deepEqual(f.partGroups[0].applications.map(x=>x.rimEdge),[1,2]);assert.ok(f.partGroups[0].applications.every(x=>!Object.hasOwn(x,'sourceMemberIds')&&!Object.hasOwn(x,'supportMemberIds')));
 const row=f.physicalRows[0];assert.deepEqual(row.start,[-1,3,2]);assert.deepEqual(row.end,[1,3,2]);assert.equal(row.blockingStation,0);assert.equal(row.supportStartId,'wall-A');assert.equal(row.supportEndId,'wall-B');assert.deepEqual(row.supportMemberIds,['J1','J2','J3']);assert.deepEqual(row.sourceMemberIds,['RAW1']);
 const csv=fabricationPartsToCSV(f);for(const header of ['start_x_m','end_z_m','rim_edge','blocking_station_m','support_start_id','support_end_id','support_member_ids','source_member_ids'])assert.ok(csv.includes('"'+header+'"'));for(const value of ['wall-A','wall-B','J1|J2|J3','RAW1','RAW2'])assert.ok(csv.includes(value));assert.ok(csv.includes('"-1"'));assert.ok(!csv.includes('"\'-1"'));
});

test('physical bearing contacts remain distinct from an analytical support-line alias in CSV',()=>{
 const b=board('j',{supportStart:{sourceId:'GB003',sourceIdMeaning:'analytical crossing',contactBeamIds:['GB001']},supportEnd:{sourceId:'GB004',contactBeamIds:['GB004','GB005']}});
 const f=buildFabricationGroups({result:{timber:{instances:[b]}}}),r=f.physicalRows[0];
 assert.equal(r.supportStartId,'GB003');assert.deepEqual(r.supportStartContactIds,['GB001']);assert.deepEqual(r.supportEndContactIds,['GB004','GB005']);
 const csv=fabricationPartsToCSV(f);for(const v of ['support_start_contact_ids','support_end_contact_ids','GB001','GB004|GB005','analytical crossing'])assert.ok(csv.includes(v));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {createHouseEngine} from './house-engine.js';
import {generateHouse} from './house-generator.js';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const root=fileURLToPath(new URL('../',import.meta.url));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function fixture(){
 const {project:p}=generateHouse({width:8,depth:6,levels:[{height:2.8},{height:2.8}],roof:{shape:'gable',pitch:20,framing:'rafters'}});
 const wall=p.walls.find(w=>w.kind==='exterior'&&(w.level??1)===1&&w.a.x===8&&w.b.x===8);
 p.openings.push({id:'ACCESS',type:'door',wallId:wall.id,offset:1,width:1,height:2.1,sill:0,headerSection:'75x248'});
 return {project:p,annex:{id:'A',name:'Терраса',kind:'openTerrace',attachedWallId:wall.id,offset:0,width:4,depth:2.5,floor:{section:'48x198',spacing:.5},foundation:{capacity:40}}};
}

test('annex transactions preserve history, nested settings, independent load balance and exact physical procurement', {timeout:60000},async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'karkas-annex-api-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const engine=createHouseEngine({dataDir}),{project,annex}=fixture(),created=await engine.create(project),id=created.project_id,initial=await engine.get(id),base=await engine.analyze(id);
 await engine.addAnnex(id,1,annex);const open=await engine.analyze(id);
 assert.equal(open.project.annexes[0].kind,'openTerrace');assert.equal(open.result.annexes.items.length,1);assert.ok(open.result.annexes.instances.length>0);
 assert.deepEqual(open.result.geometry.polygon,base.result.geometry.polygon);near(open.result.geometry.totalFloorArea,base.result.geometry.totalFloorArea);
 near(open.result.houseLoads.totalDesign,base.result.loads.totalDesign);near(open.result.piles.reduce((s,p)=>s+p.reaction,0),open.result.loads.totalDesign);
 assert.deepEqual(open.result.housePiles.map(p=>p.reaction),base.result.piles.map(p=>p.reaction));
 const page=await engine.report(id,2,{topic:'members',annexId:'A',limit:100});assert.ok(page.total>0);assert.ok(page.items.every(b=>b.annexId==='A'));
 const frozen=await engine.get(id);await assert.rejects(engine.addAnnex(id,1,{...annex,id:'B'}),e=>e.code==='REVISION_CONFLICT');await assert.rejects(engine.addAnnex(id,2,annex),e=>e.code==='DUPLICATE_ANNEX');
 await assert.rejects(engine.updateAnnex(id,2,'A',{depth:-1}),e=>e.code==='INVALID_PROJECT');await assert.rejects(engine.updateAnnex(id,2,'A',{roof:{typo:1}}),e=>e.code==='INVALID_PROJECT');assert.deepEqual(await engine.get(id),frozen);
 await engine.updateAnnex(id,2,'A',{kind:'coveredTerrace',floor:{spacing:.4},roof:{pitch:12}});let current=await engine.get(id);assert.equal(current.project.annexes[0].floor.section,'48x198');assert.equal(current.project.annexes[0].floor.spacing,.4);
 const covered=await engine.analyze(id);assert.ok(covered.result.annexes.quantities.roofArea>0);assert.equal(covered.result.annexes.quantities.glazingArea,0);assert.ok(covered.estimate.rows.some(r=>r.annexId==='A'&&r.id.endsWith('-roof')));
 await engine.updateAnnex(id,3,'A',{kind:'glazedVeranda'});const glazed=await engine.analyze(id);assert.ok(glazed.result.annexes.quantities.glazingArea>0);assert.ok(glazed.result.annexes.quantities.glazingMass>0);assert.ok(glazed.estimate.rows.some(r=>r.annexId==='A'&&r.id.endsWith('-glazing')));
 near(glazed.result.timber.mass,glazed.result.timber.instances.reduce((s,b)=>s+b.mass,0));assert.equal(new Set(glazed.result.timber.instances.map(b=>b.id)).size,glazed.result.timber.instances.length);
 const beforeVariants=await engine.get(id),variants=await engine.variants(id,4,['openTerrace','coveredTerrace','glazedVeranda'].map(kind=>({name:kind,operations:[{op:'replace',path:'/annexes/0/kind',value:kind}]})));assert.equal(variants.variants.length,3);assert.ok(variants.variants.every(v=>!v.error));assert.deepEqual(await engine.get(id),beforeVariants);
 await engine.removeAnnex(id,4,'A');const removed=await engine.analyze(id);assert.equal(removed.result.annexes.items.length,0);near(removed.summary.timberMass,base.summary.timberMass);assert.deepEqual(await engine.get(id,1),initial);assert.equal((await engine.get(id,2)).project.annexes[0].kind,'openTerrace');
});

test('real MCP exposes strict annex operations and atomic second-light configuration', {timeout:90000},async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'karkas-features-mcp-')),transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],cwd:root,env:{...process.env,KARKAS_DATA_DIR:dataDir},stderr:'pipe'}),client=new Client({name:'spatial-annex-qa',version:'1.0.0'},{capabilities:{}});
 t.after(async()=>{try{await client.close();}finally{await transport.close();await rm(dataDir,{recursive:true,force:true});}});await client.connect(transport);
 const tools=await client.listTools();for(const name of ['add_annex','update_annex','remove_annex','set_second_light'])assert.ok(tools.tools.some(t=>t.name==='karkas_'+name));
 const call=async(name,args={},error)=>{const r=await client.callTool({name:'karkas_'+name,arguments:args});if(error){assert.equal(r.isError,true);return r.structuredContent;}assert.notEqual(r.isError,true,JSON.stringify(r.structuredContent));return r.structuredContent;};
 const catalog=await call('catalog');assert.deepEqual(catalog.parameterGuide.annexes.kinds,['openTerrace','coveredTerrace','glazedVeranda']);
 const {project,annex}=fixture();project.voids=[{id:'OLD-A',level:2,kind:'doubleHeight',polygon:rect(.5,.5,1,1),edgeSection:'75x248'},{id:'OLD-B',level:2,kind:'stair',polygon:rect(2,.5,1,1),edgeSection:'75x248'}];
 project.roomSchedule=[{id:'LIVING',name:'Гостиная',level:1,polygon:rect(.1,.1,7.8,5.8)}];
 const created=await call('import_project',{project}),project_id=created.project_id;
 const configuration={opening:{id:'ATRIUM',level:2,kind:'doubleHeight',polygon:rect(.5,.3,4,2.5),edgeSection:'148x248'},space:{id:'DH',voidId:'ATRIUM',lowerRoomId:'LIVING',galleryPaths:[],daylightOpeningIds:[]},spatialLayout:{guardHeight:1.1},replaceVoidIds:['OLD-A','OLD-B']};
 const configured=await call('set_second_light',{project_id,expected_revision:1,configuration});assert.equal(configured.revision,2);
 const saved=await call('get_project',{project_id});assert.equal(saved.project.voids.length,1);assert.equal(saved.project.voids[0].id,'ATRIUM');assert.equal(saved.project.doubleHeightSpaces[0].voidId,'ATRIUM');
 await call('set_second_light',{project_id,expected_revision:2,configuration:{...configuration,space:{...configuration.space,voidId:'wrong'}}},true);assert.deepEqual(await call('get_project',{project_id}),saved);
 await call('add_annex',{project_id,expected_revision:2,annex});await call('update_annex',{project_id,expected_revision:3,annex_id:'A',changes:{kind:'coveredTerrace'}});await call('remove_annex',{project_id,expected_revision:4,annex_id:'A'});
 assert.equal((await call('get_project',{project_id})).revision,5);assert.equal((await call('get_project',{project_id,revision:3})).project.annexes[0].kind,'openTerrace');
 const spatial=await call('report',{project_id,topic:'spatial_layout'});assert.equal(spatial.data.doubleHeightSpaces.length,1);assert.equal(spatial.data.instances,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {createHouseEngine,evaluateHouse,modelHash} from './house-engine.js';
import {generateHouse} from './house-generator.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const near=(a,b,t=1e-7)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} ≠ ${b}`);

test('report preserves source planning so revision hash remains reproducible after room derivation',()=>{
  const {project,planning}=generateHouse({width:8,depth:4});
  planning.stale=true;planning.rooms=[{id:'old',name:'Старая комната',area:100,level:1}];
  project.roomSchedule=[{id:'room',name:'Актуальная комната',level:1,polygon:[{x:.2,y:.2},{x:3.8,y:.2},{x:3.8,y:3.8},{x:.2,y:3.8}]}];
  const report=evaluateHouse(project,planning);
  assert.equal(report.planning.stale,false);assert.equal(report.sourcePlanning.stale,true);
  assert.equal(report.planning.rooms[0].name,'Актуальная комната');assert.equal(report.sourcePlanning.rooms[0].name,'Старая комната');
  assert.equal(modelHash({project:report.project,planning:report.sourcePlanning}),report.engine.hash);
  assert.match(report.engine.hashBasis,/sourcePlanning/);
});

test('real MCP stdio: immutable revisions, atomic patches, physical reports, unsaved variants and verifiable exports', {timeout:45000}, async t=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'karkas-mcp-qa-'));
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],cwd:root,env:{...process.env,KARKAS_DATA_DIR:dataDir},stderr:'pipe'});
  const client=new Client({name:'karkas-integration-qa',version:'1.0.0'},{capabilities:{}});
  let stderr='';transport.stderr?.on('data',chunk=>{stderr+=chunk.toString();});
  t.after(async()=>{try{await client.close();}finally{await transport.close();await rm(dataDir,{recursive:true,force:true});}});
  await client.connect(transport);
  assert.equal(client.getServerVersion().name,'karkas-engine');assert.ok(client.getServerCapabilities().tools);
  const tools=await client.listTools(),names=tools.tools.map(x=>x.name);
  for(const name of ['catalog','generate','import_project','list_projects','get_project','apply_patch','analyze','report','compare_variants','preview','export'])assert.ok(names.includes('karkas_'+name),name);
  async function call(name,args={},errorCode){
    const response=await client.callTool({name:'karkas_'+name,arguments:args});const data=response.structuredContent;
    assert.ok(data&&typeof data==='object',`${name} must return structuredContent; stderr: ${stderr}`);
    if(errorCode){assert.equal(response.isError,true);assert.equal(data.error?.code,errorCode);return data;}
    assert.notEqual(response.isError,true,`${name}: ${JSON.stringify(data.error)}; stderr: ${stderr}`);return data;
  }
  const catalog=await call('catalog');assert.equal(catalog.stockLength,6);assert.equal(catalog.units.sections,'mm b×h');assert.ok(catalog.sections.length>0);assert.ok(catalog.limits.length>0);
  const generated=await call('generate',{name:'QA MCP mono',width:8,depth:4,roof:{shape:'mono',pitch:20,framing:'rafters'},sections:{roof:'50x200'}});
  const project_id=generated.project_id;assert.match(project_id,/^house-[a-f0-9-]{36}$/);assert.equal(generated.revision,1);assert.match(generated.hash,/^[a-f0-9]{64}$/);assert.equal(generated.summary.certified,false);
  const listed=await call('list_projects');assert.deepEqual(listed.projects.map(q=>[q.project_id,q.revision]),[[project_id,1]]);
  const initial=await call('get_project',{project_id});assert.equal(initial.id,project_id);assert.equal(initial.project.name,'QA MCP mono');assert.equal(initial.revision,1);assert.equal(initial.hash,generated.hash);
  const roof=await call('report',{project_id,topic:'roof'});assert.ok(roof.data.zones.length);assert.ok(roof.data.zones.every(z=>z.shape==='mono'&&z.framing==='rafters'&&z.selectedSection==='50x200'));
  async function members(category){let items=[],offset=0,total;do{const page=await call('report',{project_id,topic:'members',...(category?{category}:{}),offset,limit:7});total=page.total;assert.equal(page.offset,offset);items.push(...page.items);offset=page.nextOffset;}while(offset!==null);assert.equal(items.length,total);assert.equal(new Set(items.map(x=>x.id)).size,total);return items;}
  const foundation=await members('foundation');assert.ok(foundation.length>0);
  for(const b of foundation){assert.equal(b.category,'foundation');assert.equal(b.role,'grillagePly');assert.ok(b.plyIndex>=0&&b.plyIndex<initial.project.foundation.grillage.plies);assert.ok(b.mass>0&&b.cutLength<=6+1e-7);near(b.length,Math.hypot(...b.end.map((x,i)=>x-b.start[i])));near(b.mass,b.volume*initial.project.material.density);}
  const foundationReport=await call('report',{project_id,topic:'foundation'});near(foundationReport.data.piles.reduce((s,p)=>s+p.reaction,0),generated.summary.designVerticalLoad);

  const updated=await call('apply_patch',{project_id,expected_revision:1,operations:[{op:'replace',path:'/floor/section',value:'50x200'}]});assert.equal(updated.revision,2);assert.notEqual(updated.hash,generated.hash);
  const current=await call('get_project',{project_id});assert.equal(current.revision,2);assert.equal(current.project.floor.section,'50x200');assert.ok((await members('floor')).filter(b=>b.role==='joist').every(b=>b.b===50&&b.h===200));
  const conflict=await call('apply_patch',{project_id,expected_revision:1,operations:[{op:'replace',path:'/name',value:'stale write'}]},'REVISION_CONFLICT');assert.equal(conflict.error.retryable,true);
  await call('apply_patch',{project_id,expected_revision:2,operations:[{op:'replace',path:'/name',value:'must not persist'},{op:'replace',path:'/floor/section',value:'broken'}]},'INVALID_PROJECT');
  // A malformed explicit value must never become a successful migration to
  // defaults: that would erase voids/cuts or silently replace material strength.
  for(const field of ['objects','voids','boardCuts','foundation','material','roof','levels']){
    await call('apply_patch',{project_id,expected_revision:2,operations:[{op:'replace',path:'/name',value:'null must not persist'},{op:'replace',path:'/'+field,value:null}]},'INVALID_PROJECT');
    assert.deepEqual(await call('get_project',{project_id}),current,field+' null patch must leave the stored revision intact');
  }
  await call('import_project',{project:{...initial.project,material:null}},'INVALID_PROJECT');
  const afterInvalid=await call('get_project',{project_id});assert.deepEqual(afterInvalid,current);assert.deepEqual(await readdir(path.join(dataDir,'projects',project_id,'revisions')),['000001.json','000002.json']);
  const old=await call('get_project',{project_id,revision:1});assert.deepEqual(old,initial);assert.equal(old.project.floor.section,initial.project.floor.section);
  const analysis=await call('analyze',{project_id,revision:2});assert.equal(analysis.revision,2);assert.equal(analysis.hash,updated.hash);assert.equal(analysis.summary.certified,false);assert.ok(analysis.unverifiedCount>0);
  const preview=await call('preview',{project_id,revision:1}),previewURL=new URL(preview.url);assert.equal(preview.mode,'read_only');assert.equal(preview.revision,1);assert.equal(previewURL.hostname,'127.0.0.1');assert.equal(previewURL.searchParams.get('project'),project_id);assert.equal(previewURL.searchParams.get('revision'),'1');
  const reportURL=new URL('/engine-report.json'+previewURL.search,previewURL),httpReport=await fetch(reportURL);assert.equal(httpReport.status,200);assert.match(httpReport.headers.get('content-type'),/application\/json/);const pinned=await httpReport.json();assert.equal(pinned.engine.revision,1);assert.equal(pinned.engine.hash,initial.hash);assert.equal(pinned.project.floor.section,initial.project.floor.section);
  const head=await fetch(reportURL,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');const denied=await fetch(reportURL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operations:[{op:'replace',path:'/name',value:'HTTP edit'}]})});assert.equal(denied.status,405);assert.equal(denied.headers.get('allow'),'GET, HEAD');assert.deepEqual(await call('get_project',{project_id}),current);
  const variants=await call('compare_variants',{project_id,revision:2,variants:[{name:'200',operations:[{op:'replace',path:'/floor/section',value:'50x200'}]},{name:'250',operations:[{op:'replace',path:'/floor/section',value:'50x250'}]},{name:'invalid',operations:[{op:'replace',path:'/floor/section',value:'wrong'}]}]});
  assert.equal(variants.variants.length,3);assert.ok(variants.variants[2].error);assert.equal(variants.variants[2].score,null);assert.equal(variants.ranking.includes(2),false);assert.notEqual(variants.variants[0].hash,variants.variants[1].hash);assert.deepEqual(await call('get_project',{project_id}),current);assert.equal((await call('list_projects')).projects.length,1);
  // Valid large prices must not defeat the documented "failed checks first"
  // order. A weighted scalar with a fixed 1e9 penalty selected the failed beam.
  const priorities=await call('compare_variants',{project_id,revision:2,variants:[{name:'cheap but failing',operations:[{op:'replace',path:'/floor/section',value:'50x50'},{op:'replace',path:'/prices/timberM3',value:1e9}]},{name:'expensive fewer failures',operations:[{op:'replace',path:'/floor/section',value:'100x600'},{op:'replace',path:'/prices/timberM3',value:1e9}]}]});
  assert.ok(priorities.variants[0].summary.failedChecks>priorities.variants[1].summary.failedChecks);assert.ok(priorities.variants[0].summary.estimateTotal<priorities.variants[1].summary.estimateTotal);assert.equal(priorities.selectedIndex,1);assert.deepEqual(priorities.ranking,[1,0]);assert.deepEqual(await call('get_project',{project_id}),current);

  const formats=['report_json','project_json','plan_svg','boards_csv','cutting_csv','estimate_csv','cutting_html','model_obj'];
  const exported=await call('export',{project_id,revision:2,formats});assert.equal(exported.revision,2);assert.equal(exported.hash,updated.hash);assert.deepEqual(exported.artifacts.map(a=>a.format).sort(),[...formats].sort());
  const files={};for(const artifact of exported.artifacts){const relative=path.relative(dataDir,artifact.path);assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative));const bytes=await readFile(artifact.path);assert.equal(bytes.length,artifact.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);assert.ok(bytes.length>0);files[artifact.format]=bytes.toString('utf8');}
  const full=JSON.parse(files.report_json);assert.equal(full.engine.projectId,project_id);assert.equal(full.engine.revision,2);assert.equal(full.engine.hash,updated.hash);assert.equal(full.project.floor.section,'50x200');assert.deepEqual(JSON.parse(files.project_json).project,full.project);
  assert.match(files.plan_svg,/^<svg\s/);assert.match(files.plan_svg,/<title>QA MCP mono<\/title>/);assert.match(files.cutting_html,/<html[\s>]/i);assert.match(files.cutting_csv,/;/);assert.match(files.estimate_csv,/;/);
  assert.equal(files.boards_csv.trim().split(/\r?\n/).length-1,full.result.timber.instances.length);assert.equal(files.model_obj.split('\n').filter(l=>l.startsWith('o ')).length,full.result.timber.instances.length);assert.match(files.model_obj,/^g foundation$/m);assert.match(files.model_obj,/^v -?\d/m);assert.match(files.model_obj,/^f \d+ \d+ \d+$/m);
  near(full.result.timber.mass,full.result.timber.instances.reduce((s,b)=>s+b.mass,0));near(full.result.foundation.reactionSum,full.result.loads.totalDesign);assert.equal(full.summary.certified,false);
});

test('concurrent independent engines publish exactly one immutable next revision and ignore crash leftovers', {timeout:20000}, async t=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'karkas-revision-race-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const a=createHouseEngine({dataDir}),b=createHouseEngine({dataDir});
  const created=await a.generate({name:'Before race',width:6,depth:4,roof:{shape:'mono',pitch:20,framing:'rafters'},sections:{roof:'50x200'}}),id=created.project_id;
  const initial=await a.get(id),directory=path.join(dataDir,'projects',id),revisions=path.join(directory,'revisions');
  // Model an interrupted old implementation and an incomplete unpublished file.
  // Neither is a committed six-digit revision or a reason to block new writes.
  const staleLock=path.join(directory,'.write-lock'),orphan=path.join(revisions,'.crashed-writer.tmp');
  await writeFile(staleLock,'obsolete lock from stopped process');await writeFile(orphan,'{"revision":999,"project":');
  const settled=await Promise.allSettled([a.patch(id,1,[{op:'replace',path:'/name',value:'Writer A'}]),b.patch(id,1,[{op:'replace',path:'/name',value:'Writer B'}])]);
  const successes=settled.filter(x=>x.status==='fulfilled'),failures=settled.filter(x=>x.status==='rejected');assert.equal(successes.length,1);assert.equal(failures.length,1);assert.equal(failures[0].reason.code,'REVISION_CONFLICT');assert.equal(successes[0].value.revision,2);
  const current=await b.get(id),winner=settled[0].status==='fulfilled'?'Writer A':'Writer B';assert.equal(current.revision,2);assert.equal(current.project.name,winner);assert.equal(current.hash,successes[0].value.hash);assert.deepEqual(await b.get(id,1),initial);
  const published=JSON.parse(await readFile(path.join(revisions,'000002.json'),'utf8'));assert.deepEqual(published,current);assert.equal((await a.list()).projects[0].revision,2);
  const third=await a.patch(id,2,[{op:'replace',path:'/name',value:'Recovered after interrupted writer'}]);assert.equal(third.revision,3);assert.equal((await b.get(id)).project.name,'Recovered after interrupted writer');assert.deepEqual(await a.get(id,2),current);
  const committed=(await readdir(revisions)).filter(f=>/^\d{6}\.json$/.test(f)).sort();assert.deepEqual(committed,['000001.json','000002.json','000003.json']);assert.equal(await readFile(orphan,'utf8'),'{"revision":999,"project":');assert.equal(await readFile(staleLock,'utf8'),'obsolete lock from stopped process');
});

import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,link,readdir,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultDesignerProject,validateDesignerProject,calculateDesigner} from './designer-engine.js';
import {normalizeDesignerState} from './designer-state.js';
import {calculateRoofZones} from './roof-zones.js';
import {checkDesignerMembers} from './designer-mechanics.js';
import {calculateCutting,cuttingRowsToCSV,cuttingToPrintHTML} from './cutting.js';
import {calculateEstimate,estimateRowsToCSV} from './estimate-engine.js';
import {timberSections,sectionCatalogNote} from './catalog.js';
import {generateHouse} from './house-generator.js';
import {exportPlanSVG,exportBoardsCSV,exportModelOBJ} from './house-exports.js';
export const ENGINE_VERSION='4.0.0';
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const modelHash=p=>createHash('sha256').update(JSON.stringify(canonical(p))).digest('hex');
export class EngineError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
export function assertSafeJSON(value,depth=0){if(depth>40)throw new EngineError('INVALID_INPUT','Слишком глубокая структура.');if(typeof value==='number'&&!Number.isFinite(value))throw new EngineError('INVALID_INPUT','Числа должны быть конечными.');if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))throw new EngineError('INVALID_INPUT','Запрещённый ключ объекта.');assertSafeJSON(v,depth+1);}}
function validated(project){
 assertSafeJSON(project);
 // Reject malformed explicit values BEFORE migration/defaults can erase them.
 const raw=validateDesignerProject(project);if(!raw.valid)throw new EngineError('INVALID_PROJECT','Проект не прошёл проверку входных данных.',raw.errors);
 const complete=clone(project);if(Array.isArray(complete.levels)&&complete.levels.length)complete.levels=Array.from({length:complete.floors},(_,i)=>complete.levels.find(l=>l.index===i+1)??{id:'level-'+(i+1),index:i+1,name:(i+1)+' этаж',height:complete.height});
 const p=normalizeDesignerState(complete),v=validateDesignerProject(p);if(!v.valid)throw new EngineError('INVALID_PROJECT','Проект не прошёл проверку входных данных.',v.errors);return p;
}
export function evaluateHouse(project,planning={}){
 const p=validated(project),base=calculateDesigner(p),roofModel=calculateRoofZones(p,base),calculated=calculateDesigner(p,{roofModel}),mechanics=checkDesignerMembers(p,calculated);
 const result={...calculated,checks:[...calculated.checks,...mechanics.checks,...(planning.checks??[])],assumptions:[...calculated.assumptions,...mechanics.assumptions],planning};
 const cutting=calculateCutting(p,result),estimate=calculateEstimate(p,result,cutting),fails=result.checks.filter(c=>c.status==='fail'),unknown=result.checks.filter(c=>['unverified','warning'].includes(c.status));
 const summary={name:p.name,area:result.geometry.totalFloorArea,floors:p.floors,rooms:planning.rooms?.filter(r=>r.kind!=='corridor').length??0,boards:result.timber.boardCount,timberVolume:result.timber.volume,timberMass:result.timber.mass,designVerticalLoad:result.loads?.totalDesign??null,piles:result.piles.length,grillageBoards:result.timber.totals.foundation.count,stockBoards:cutting.summary.boards,unplaced:cutting.overlength.length,estimateRub:estimate.total,status:!result.geometry.areaComplete||!cutting.summary.complete?'incomplete':fails.length?'failed_checks':'requires_engineering',failedChecks:fails.length,unverifiedOrWarningChecks:unknown.length,certified:false};
 return {engine:{name:'КАРКАС ENGINE',version:ENGINE_VERSION,schemaVersion:'1.0',hash:modelHash({project:p,planning}),units:{coordinates:'m',sections:'mm',mass:'kg',force:'kN',stress:'MPa',price:'RUB'},generatedAt:new Date().toISOString()},project:p,planning,result,cutting,estimate,summary};
}
const allowedRoots=new Set(['name','height','floors','grid','levels','walls','openings','objects','voids','roof','floor','material','loads','foundation','bracing','joints','boardCuts','cutting','prices']);
export function applyProjectPatch(project,operations){
 const p=clone(project);if(!Array.isArray(operations)||operations.length<1||operations.length>500)throw new EngineError('INVALID_PATCH','Нужно от 1 до 500 операций.');
 for(const op of operations){
  assertSafeJSON(op);if(!['add','replace','remove'].includes(op.op)||typeof op.path!=='string'||!op.path.startsWith('/'))throw new EngineError('INVALID_PATCH','Используйте add, replace, remove и JSON Pointer path.');
  const keys=op.path.slice(1).split('/').map(k=>k.replaceAll('~1','/').replaceAll('~0','~'));
  if(!allowedRoots.has(keys[0])||keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw new EngineError('INVALID_PATCH','Недоступный путь проекта.',op.path);
  let parent=p;for(const key of keys.slice(0,-1)){if(parent===null||typeof parent!=='object'||!Object.hasOwn(parent,key))throw new EngineError('INVALID_PATCH','Путь не существует.',op.path);parent=parent[key];}
  const key=keys.at(-1);if(parent===null||typeof parent!=='object')throw new EngineError('INVALID_PATCH','Родитель пути не является объектом.',op.path);
  if(Array.isArray(parent)){
   const i=key==='-'&&op.op==='add'?parent.length:/^(0|[1-9]\d*)$/.test(key)?Number(key):-1;
   if(i<0||i>parent.length||(op.op!=='add'&&i===parent.length))throw new EngineError('INVALID_PATCH','Индекс массива вне диапазона.',op.path);
   if(op.op==='remove')parent.splice(i,1);else if(op.op==='add')parent.splice(i,0,clone(op.value));else parent[i]=clone(op.value);
  }else{if(op.op!=='add'&&!Object.hasOwn(parent,key))throw new EngineError('INVALID_PATCH','Заменяемый ключ не существует.',op.path);if(op.op==='remove')delete parent[key];else{if(op.value===undefined)throw new EngineError('INVALID_PATCH','Нужно значение value.');parent[key]=clone(op.value);}}
 }
 // Apply the whole transaction before validation, allowing safe geometry edits.
 return validated(p);
}
export function engineCatalog(){return {engine:'КАРКАС ENGINE',version:ENGINE_VERSION,units:{plan:'m (x,y)',world:'m [x,height,z]',sections:'mm b×h',loads:'kN/m²',forces:'kN',E:'MPa'},sections:timberSections,note:sectionCatalogNote,stockLength:6,templates:['rectangle','l-shape','custom polygon'],roofShapes:['mono','gable','hip'],roofFraming:['auto','rafters','truss'],bracing:['sheathing','letIn','none'],capabilities:['Polygon footprints and independent 1–2 floors','Room program with generated partitions and circulation on rectangular floors','Second light openings in upper platforms','Built-up grillage on real piles, ply boards and supported joints','Inclined rafters / multiple truss schemes and full-height walls','Density, self weight, bending, shear, Euler stability and deflection checks','Stock lengths 6 m, joint geometry, kerf and cut schedules','Procurement estimate from actual cutting, editable prices','Versioned transactions, bounded variants, JSON/CSV/SVG/OBJ/HTML export'],limits:['Not a certified working structural project; normative combinations, soil and engineered connections remain explicit unknowns.','Grillage: nearest-span load transfer and independent simple spans, not a spatial grillage stiffness solution.','Ply load sharing and support connections require design; equal sharing is a stated assumption.','Room generation is deterministic geometric zoning, not a fire/egress or building-code approval.','Timber assortment is nominal; strength values and density must be supplied for the actual product.'],defaults:clone(defaultDesignerProject),workflow:['karkas_generate','karkas_report(checks)','karkas_get_project','karkas_apply_patch(expected_revision)','karkas_compare_variants','karkas_export']};}
const validId=id=>typeof id==='string'&&/^house-[a-f0-9-]{36}$/.test(id);
export function createHouseEngine({dataDir=process.env.KARKAS_DATA_DIR??fileURLToPath(new URL('../work/engine-data/',import.meta.url))}={}){
 const root=path.resolve(dataDir),cache=new Map();
 const projectDir=id=>{if(!validId(id))throw new EngineError('NOT_FOUND','Некорректный ID проекта.');return path.join(root,'projects',id);};
 async function read(id,revision){
  const dir=projectDir(id);let rev=revision;
  if(rev===undefined){let files;try{files=await readdir(path.join(dir,'revisions'));}catch{throw new EngineError('NOT_FOUND','Проект не найден.');}rev=Math.max(0,...files.filter(x=>/^\d{6}\.json$/.test(x)).map(x=>Number(x.slice(0,6))));}
  if(!Number.isInteger(rev)||rev<1)throw new EngineError('NOT_FOUND','Ревизия не найдена.');
  try{return JSON.parse(await readFile(path.join(dir,'revisions',String(rev).padStart(6,'0')+'.json'),'utf8'));}catch{throw new EngineError('NOT_FOUND','Ревизия не найдена.');}
 }
 async function save(record){
  const dir=path.join(projectDir(record.id),'revisions');await mkdir(dir,{recursive:true});
  const destination=path.join(dir,String(record.revision).padStart(6,'0')+'.json'),temp=path.join(dir,'.'+randomUUID()+'.tmp');
  // Publish a completed, synced file by exclusive hard-link creation. Two
  // writers of revision N cannot overwrite each other. A crash leaves only an
  // ignored temporary file; no stale lock can block future transactions.
  const handle=await open(temp,'wx');try{await handle.writeFile(JSON.stringify(record,null,2));await handle.sync();}finally{await handle.close();}
  try{await link(temp,destination);}catch(e){if(e.code==='EEXIST')throw new EngineError('REVISION_CONFLICT','Ревизию уже создал другой запрос. Прочитайте актуальный проект.',{expected:record.revision-1,actual:record.revision});throw e;}finally{await unlink(temp).catch(()=>{});}
 }
 async function create(project,planning={}){const p=validated(project),id='house-'+randomUUID(),record={id,revision:1,project:p,planning,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),hash:modelHash({project:p,planning})};const report=evaluateHouse(p,planning);await save(record);cache.set(record.hash,report);return metadata(record,report);}
 function analyzed(record){let report=cache.get(record.hash);if(!report){report=evaluateHouse(record.project,record.planning);if(cache.size>=6)cache.delete(cache.keys().next().value);cache.set(record.hash,report);}return {...report,engine:{...report.engine,projectId:record.id,revision:record.revision,hash:record.hash}};}
 function metadata(record,report){return {project_id:record.id,revision:record.revision,hash:record.hash,summary:report.summary,next:'Inspect failed and unverified checks using karkas_report before selecting a variant.'};}
 async function analyze(id,revision){return analyzed(await read(id,revision));}
 return {dataDir:root,create,async generate(spec){assertSafeJSON(spec);const {project,planning}=generateHouse(spec);return create(project,planning);},async get(id,revision){return read(id,revision);},analyze,
  async list(){let ids;try{ids=await readdir(path.join(root,'projects'));}catch{return {projects:[]};}const projects=[];for(const id of ids.filter(validId)){const r=await read(id);projects.push({project_id:id,revision:r.revision,name:r.project.name,hash:r.hash,updatedAt:r.updatedAt});}return {projects};},
  async patch(id,expectedRevision,operations){const prior=await read(id);if(prior.revision!==expectedRevision)throw new EngineError('REVISION_CONFLICT','Проект изменился: прочитайте актуальную ревизию.',{expected:expectedRevision,actual:prior.revision});const p=applyProjectPatch(prior.project,operations),geometryChanged=operations.some(o=>/^\/(walls|levels|floors|voids|openings)/.test(o.path)),planning=geometryChanged?{...prior.planning,checks:[],warnings:[...(prior.planning.warnings??[]),'Room-program metadata predates a geometry edit; inspect the actual revised walls and openings.'],stale:true}:prior.planning,record={...prior,project:p,planning,revision:prior.revision+1,updatedAt:new Date().toISOString()};record.hash=modelHash({project:p,planning});const report=evaluateHouse(p,planning);await save(record);cache.set(record.hash,report);return metadata(record,report);},
  async report(id,revision,{topic='summary',offset=0,limit=50,category,wallId,level,status,beamId,memberIds}={}){const report=await analyze(id,revision),r=report.result;let data;
   switch(topic){case'summary':data=report.summary;break;case'geometry':data=r.geometry;break;case'loads':data=r.loads;break;case'foundation':data=r.grillageModel;break;case'roof':data=r.roofModel;break;case'bracing':data=r.bracingModel;break;case'rooms':data=report.planning;break;case'checks':data=r.checks;break;case'members':data=r.timber.instances;break;case'cutting':data=report.cutting.stocks.map(s=>({id:s.id,section:s.section,length:s.length,used:s.used,consumed:s.consumed,remainder:s.remainder,kerfWaste:s.kerfWaste,reusable:s.reusable,pieces:s.pieces.map(q=>({id:q.id,name:q.name,length:q.length,start:q.start,end:q.end,endStart:q.endStart,endEnd:q.endEnd}))}));break;case'estimate':data=report.estimate.rows;break;case'assumptions':data=r.assumptions;break;default:throw new EngineError('INVALID_TOPIC','Неизвестная тема отчёта.');}
   if(['foundation','roof','bracing'].includes(topic)){
    // Return compact subsystem records; physical geometry is paged via members.
    if(topic==='foundation')data={pileHeadY:data.pileHeadY,topY:data.topY,quantities:data.quantities,loadMethod:data.loadMethod,worstSpan:data.worstSpan?{id:data.worstSpan.id,length:data.worstSpan.length,designTotal:data.worstSpan.designTotal,check:data.worstSpan.check}:null,beams:data.beams.map(b=>({id:b.id,a:b.a,b:b.b,length:b.length,section:b.section,stations:b.stations})),piles:data.piles,joints:data.joints,checks:[...data.checks,...(data.loadChecks??[])]};
    if(topic==='roof')data={zones:data.zones.map(z=>({id:z.id,name:z.name,shape:z.shape,framing:z.effectiveFraming,requestedSection:z.requestedSection,selectedSection:z.selectedSection,pitchLeft:z.pitchLeft,pitchRight:z.pitchRight,ridgeAngle:z.ridgeAngle,area:z.surfaceArea,checks:z.rafterAnalysis?.checks,warnings:z.warnings})),checks:data.checks,warnings:data.warnings};
    if(topic==='bracing')data={method:data.method,quantities:data.quantities,wallLines:data.wallLines,checks:data.checks};
   }
   if(Array.isArray(data)){const filtered=data.filter(x=>(!category||x.category===category)&&(!wallId||x.wallId===wallId)&&(!level||(x.level??x.floor)===level)&&(!status||x.status===status)&&(!beamId||x.beamId===beamId)&&(!memberIds||memberIds.includes(x.id)));return {project_id:id,revision:report.engine.revision,hash:report.engine.hash,topic,total:filtered.length,offset,items:filtered.slice(offset,offset+Math.min(100,limit)),nextOffset:offset+limit<filtered.length?offset+limit:null};}
   return {project_id:id,revision:report.engine.revision,hash:report.engine.hash,topic,data};},
  async variants(id,revision,variants){if(!Array.isArray(variants)||!variants.length||variants.length>12)throw new EngineError('INVALID_INPUT','Сравнивайте от 1 до 12 вариантов.');const record=await read(id,revision),baseline=analyzed(record);const outcomes=variants.map((v,index)=>{try{const p=applyProjectPatch(record.project,v.operations),report=evaluateHouse(p,record.planning);return {index,name:v.name,hash:report.engine.hash,summary:report.summary,delta:{cost:report.summary.estimateRub-baseline.summary.estimateRub,mass:report.summary.timberMass-baseline.summary.timberMass},score:report.summary.failedChecks*1e9+report.summary.unplaced*1e9+report.summary.estimateRub,operations:v.operations};}catch(e){return {index,name:v.name,error:{code:e.code??'INVALID_VARIANT',message:e.message},score:null};}});const ranked=outcomes.filter(x=>x.score!==null).sort((a,b)=>a.summary.failedChecks-b.summary.failedChecks||a.summary.unplaced-b.summary.unplaced||a.summary.estimateRub-b.summary.estimateRub);return {project_id:id,revision:record.revision,baseline:baseline.summary,variants:outcomes,ranking:ranked.map(x=>x.index),selectedIndex:ranked[0]?.index??null,rankingCriteria:['failedChecks','unplaced','estimateRub'],method:'Bounded enumeration; lexicographic failed checks first, then unplaced pieces, then illustrative procurement cost. No variant is applied or certified.'};},
  async export(id,revision,formats=['report_json','project_json','plan_svg','boards_csv','cutting_csv','estimate_csv','cutting_html','model_obj']){const report=await analyze(id,revision),destination=path.join(root,'exports',id,'r'+report.engine.revision);await mkdir(destination,{recursive:true});const payloads={report_json:['report.json',()=>JSON.stringify(report)],project_json:['project.json',()=>JSON.stringify({version:2,project:report.project},null,2)],plan_svg:['plan.svg',()=>exportPlanSVG(report)],boards_csv:['boards.csv',()=>exportBoardsCSV(report)],cutting_csv:['cutting.csv',()=>cuttingRowsToCSV(report.cutting)],estimate_csv:['estimate.csv',()=>estimateRowsToCSV(report.estimate,report.project.name)],cutting_html:['cutting.html',()=>cuttingToPrintHTML(report.cutting,report.project.name)],model_obj:['model.obj',()=>exportModelOBJ(report)]};const artifacts=[];for(const format of [...new Set(formats)]){if(!payloads[format])throw new EngineError('INVALID_FORMAT','Неизвестный формат.',format);const [name,fn]=payloads[format],file=path.join(destination,name),text=fn();await writeFile(file,text);artifacts.push({format,path:file,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')});}return {project_id:id,revision:report.engine.revision,hash:report.engine.hash,artifacts};}
 };
}

import React,{useId,useMemo,useState} from 'react';
import './drainage-style.css';

const fmt=(n,d=1)=>Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
const xyz=p=>Array.isArray(p)&&p.length>=3&&p.every(Number.isFinite);
const point=p=>({x:p[0],y:p[2]});
const colors={gutter:'#51978a',valley:'#558ea7',ridge:'#8f9f7a',step:'#b69359','wall-abutment':'#b69359',eave:'#819a78',failed:'#bf6b52',junction:'#b79d71'};
const names={gutter:'Желоб',valley:'Ендова',ridge:'Конёк',step:'Перепад кровли','wall-abutment':'Примыкание к стене',eave:'Карниз',gable:'Фронтонная кромка',junction:'Стык скатов',rake:'Торцевая кромка',verge:'Торцевая кромка',seam:'Граница грани',crease:'Стык скатов',unknown:'Кромка'};
const failed=edge=>edge?.flowIntoWall||['fail','failed','error','blocked','wallBlock','valleyNeedsDrain','unknown'].includes(edge?.status);
const edgeColor=edge=>failed(edge)?colors.failed:colors[edge?.type]??colors.junction;
const validEdge=edge=>xyz(edge?.start)&&xyz(edge?.end);
const pointsPath=points=>points.map(p=>`${p[0]},${p[2]}`).join(' ');

function DrainagePlan({result,roofModel,drainage,selectedId,onSelect}){
  const uid=useId().replaceAll(':','');
  const [showFlow,setShowFlow]=useState(true),[showGutters,setShowGutters]=useState(true),[showEdges,setShowEdges]=useState(true);
  const surfaces=(roofModel?.surfaces??[]).filter(s=>Array.isArray(s.points)&&s.points.length>=3&&s.points.every(xyz));
  const edges=(drainage?.edges??[]).filter(validEdge),gutters=(drainage?.gutters??[]).filter(validEdge),pipes=(drainage?.downpipes??[]).filter(validEdge);
  const all=surfaces.flatMap(s=>s.points).concat(edges.flatMap(e=>[e.start,e.end]));
  const ground=result.geometry?.polygon??[];
  const xs=all.map(p=>p[0]).concat(ground.map(p=>p.x)),ys=all.map(p=>p[2]).concat(ground.map(p=>p.y));
  const minX=xs.length?Math.min(...xs):0,minY=ys.length?Math.min(...ys):0;
  const maxX=xs.length?Math.max(...xs):12,maxY=ys.length?Math.max(...ys):8;
  const w=Math.max(8,maxX-minX),h=Math.max(6,maxY-minY),scale=Math.max(w,h)/12,pad=Math.max(w,h)*.12;
  const zoneIds=[...new Set(surfaces.map(s=>s.zoneId))],fills=['#d4e4b7','#d4ddc3','#c6ded6','#ded4bd','#d2d9b1','#d9d4e4'];
  const arrows=(drainage?.arrows??[]).filter(a=>xyz(a.start)&&xyz(a.end));
  const selected=edges.find(e=>e.id===selectedId);
  return <div className="drainage-plan-card"><div className="drainage-plan-head"><span>ПЛАН ПУТЕЙ ВОДЫ</span><div><button className={showFlow?'active':''} aria-pressed={showFlow} onClick={()=>setShowFlow(!showFlow)}>Сток</button><button className={showGutters?'active':''} aria-pressed={showGutters} onClick={()=>setShowGutters(!showGutters)}>Желоба</button><button className={showEdges?'active':''} aria-pressed={showEdges} onClick={()=>setShowEdges(!showEdges)}>Стыки</button></div></div>
    <svg className="drainage-plan" viewBox={`${minX-pad} ${minY-pad} ${w+2*pad} ${h+2*pad}`} role="group" aria-label="План стока по реальным скатам, примыкания и водосточные трубы">
      <defs><pattern id={`water-grid-${uid}`} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#dce4d2" strokeWidth={.013*scale}/></pattern>
        <marker id={`water-arrow-${uid}`} markerWidth="5" markerHeight="5" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#568ba3"/></marker>
        <marker id={`water-danger-${uid}`} markerWidth="5" markerHeight="5" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#bf6b52"/></marker></defs>
      <rect x={minX-pad} y={minY-pad} width={w+pad*2} height={h+pad*2} fill="#f0f5e9"/>
      <rect x={minX-pad} y={minY-pad} width={w+pad*2} height={h+pad*2} fill={`url(#water-grid-${uid})`}/>
      {ground.length>2&&<polygon points={ground.map(p=>`${p.x},${p.y}`).join(' ')} fill="#fafcf5" stroke="#8d9f7c" strokeWidth={.035*scale}/>}
      {surfaces.map(surface=><polygon key={surface.id} points={pointsPath(surface.points)} fill={fills[Math.max(0,zoneIds.indexOf(surface.zoneId))%fills.length]} stroke="#eef4e6" strokeWidth={.008*scale}><title>{`Зона ${surface.zoneId} · скат ${surface.kind??''} · ${fmt(surface.area)} м²`}</title></polygon>)}
      {(roofModel?.zones??[]).map(zone=><polygon key={zone.id} points={(zone.polygon??[]).map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#9cad8c" strokeWidth={.018*scale} pointerEvents="none"/>)}
      {edges.filter(e=>(showEdges&&e.type!=='seam')||failed(e)||e.id===selectedId).map(edge=>{const active=edge.id===selectedId;return <g key={edge.id} role="button" tabIndex={0} aria-label={`${names[edge.type]??edge.type}: ${fmt(edge.length)} м${failed(edge)?', есть проблема стока':''}`} className="drainage-edge" onClick={()=>onSelect(edge.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(edge.id)}}}>
        <title>{`${names[edge.type]??edge.type} · ${fmt(edge.length)} м\n${edge.note??''}`}</title>
        {active&&<line x1={edge.start[0]} y1={edge.start[2]} x2={edge.end[0]} y2={edge.end[2]} stroke="#fbfff4" strokeWidth={.15*scale}/>}
        <line x1={edge.start[0]} y1={edge.start[2]} x2={edge.end[0]} y2={edge.end[2]} stroke={edgeColor(edge)} strokeWidth={(active?.085:.045)*scale} strokeDasharray={edge.type==='ridge'?`${.14*scale} ${.07*scale}`:undefined} strokeLinecap="round"/>
        <line x1={edge.start[0]} y1={edge.start[2]} x2={edge.end[0]} y2={edge.end[2]} stroke="transparent" strokeWidth={.25*scale}/>
      </g>})}
      {showGutters&&gutters.map(g=><g key={g.id} role="button" tabIndex={0} className="drainage-edge" aria-label={`Предлагаемый желоб ${fmt(g.length)} м`} onClick={()=>onSelect(g.edgeId)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();onSelect(g.edgeId)}}}><line x1={g.start[0]} y1={g.start[2]} x2={g.end[0]} y2={g.end[2]} stroke="#51978a" strokeWidth={.065*scale} strokeLinecap="round"/><line x1={g.start[0]} y1={g.start[2]} x2={g.end[0]} y2={g.end[2]} stroke="transparent" strokeWidth={.25*scale}/></g>)}
      {showFlow&&arrows.map(arrow=>{const path=Array.isArray(arrow.path)&&arrow.path.length>=2&&arrow.path.every(xyz)?arrow.path:[arrow.start,arrow.end];const bad=arrow.resolved===false||['fail','failed','error','blocked','wallBlock','valleyNeedsDrain','unknown'].includes(arrow.status);return <g key={arrow.id} pointerEvents="none"><polyline points={pointsPath(path)} fill="none" stroke={bad?'#bf6b52':'#568ba3'} opacity=".87" strokeWidth={.028*scale} markerEnd={`url(#${bad?'water-danger':'water-arrow'}-${uid})`} strokeLinejoin="round"/><title>{`Уклон ${fmt(arrow.slopeDeg)}°${bad?' · поток к опасному узлу':''}`}</title></g>})}
      {showGutters&&pipes.map((pipe,i)=>{const g=gutters.find(g=>g.id===pipe.gutterId);return <g key={pipe.id} className="drainage-pipe" role="button" tabIndex={0} aria-label={`Водосточная труба ${i+1}, предлагаемый выпуск`} onClick={()=>g&&onSelect(g.edgeId)} onKeyDown={e=>{if(e.key==='Enter'&&g)onSelect(g.edgeId)}}><circle cx={pipe.start[0]} cy={pipe.start[2]} r={.12*scale} fill="#eff9f4" stroke="#4f958a" strokeWidth={.035*scale}/><path d={`M${pipe.start[0]} ${pipe.start[2]-.055*scale}v${.11*scale}m${-.04*scale} ${-.04*scale}l${.04*scale} ${.04*scale} ${.04*scale} ${-.04*scale}`} stroke="#4f958a" fill="none" strokeWidth={.02*scale}/><text x={pipe.start[0]+.17*scale} y={pipe.start[2]-.13*scale} fontSize={.13*scale} fill="#5b8b79" stroke="#f6fbef" strokeWidth={.045*scale} paintOrder="stroke">В{i+1}</text></g>})}
      {(drainage?.issues??[]).filter(issue=>xyz(issue.pointXYZ??issue.point)).map(issue=>{const p=issue.pointXYZ??issue.point;return <g key={issue.id} pointerEvents="none"><circle cx={p[0]} cy={p[2]} r={.15*scale} fill="#faeee5" stroke="#c17c5d" strokeWidth={.025*scale}/><text x={p[0]} y={p[2]+.055*scale} textAnchor="middle" fontSize={.17*scale} fill="#b77555">!</text></g>})}
      {selected&&<g pointerEvents="none"><circle cx={(selected.start[0]+selected.end[0])/2} cy={(selected.start[2]+selected.end[2])/2} r={.10*scale} fill="#fffaf1" stroke={edgeColor(selected)} strokeWidth={.025*scale}/></g>}
    </svg>
    <div className="drainage-legend"><span><i style={{background:'#568ba3'}}/>Направление стока</span><span><i style={{background:colors.gutter}}/>Желоб</span><span><i style={{background:colors.valley}}/>Ендова</span><span><i style={{background:colors.step}}/>Примыкание / перепад</span><span><i style={{background:colors.failed}}/>Проблема стока</span></div>
  </div>;
}

function WallFlashingSection(){
  const uid=useId().replaceAll(':','');
  return <div className="drainage-section-drawing"><svg viewBox="0 0 620 295" role="img" aria-label="Принцип примыкания стены и кровли: мембрана стены перекрывает фартук, сверху контрфартук; вода отводится по покрытию к капельнику и желобу">
    <defs><pattern id={`wall-hatch-${uid}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="9" height="9" fill="#e4d9bc"/><path d="M0 0v9" stroke="#c8b58c" strokeWidth="1"/></pattern><marker id={`lap-arrow-${uid}`} markerWidth="6" markerHeight="6" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#6499ad"/></marker></defs>
    <text x="20" y="24" className="drainage-svg-caption">СТЕНА — КРОВЛЯ · ПРИНЦИП НАХЛЁСТОВ</text>
    <path d="M420 45h54v207h-54Z" fill={`url(#wall-hatch-${uid})`} stroke="#b09b77" strokeWidth="1.3"/>
    <path d="M402 45h14v85h-14Z" fill="#c7ceb9" stroke="#a8b397" strokeWidth="1"/>
    <path d="m58 232 350-91 5 19-350 91Z" fill="#d4bd91" stroke="#ad9369" strokeWidth="1.4"/>
    <path d="m64 231 338-88" stroke="#7b8d70" strokeWidth="7"/>
    <path d="M408 96v48l-101 26" fill="none" stroke="#c19d5d" strokeWidth="7" strokeLinejoin="round"/>
    <path d="M420 82h-9l-10 8v35" fill="none" stroke="#a8854e" strokeWidth="4" strokeLinejoin="round"/>
    <path d="M419 44v41m-2 8v42l-57 15" fill="none" stroke="#7fa8ad" strokeWidth="3" strokeDasharray="5 3"/>
    <path d="m66 228-11 3v16l8 5" stroke="#a99165" strokeWidth="3" fill="none"/>
    <path d="M31 246v8c0 18 55 18 55 0v-8" fill="#dcece3" stroke="#72a28c" strokeWidth="3"/>
    <path d="M77 264v19" stroke="#72a28c" strokeWidth="7" fill="none"/>
    <path d="M392 48v35" stroke="#6499ad" strokeWidth="2" markerEnd={`url(#lap-arrow-${uid})`}/>
    <path d="m373 157-95 25m-31 8-95 25m-28 8-37 10" stroke="#6499ad" strokeWidth="2" markerEnd={`url(#lap-arrow-${uid})`} fill="none"/>
    <g className="drainage-svg-labels"><path d="M423 59h52"/><text x="485" y="63">1 · Мембрана стены</text><path d="M406 100h69"/><text x="485" y="104">2 · Контрфартук</text><path d="M409 145h66"/><text x="485" y="149">3 · Фартук</text><path d="M65 249h68"/><text x="142" y="253">4 · Капельник и желоб</text></g>
    <text x="235" y="277" className="drainage-svg-note">Верхний водоотводящий слой перекрывает нижний</text>
  </svg>
  <div className="drainage-kickout"><svg viewBox="0 0 240 150" role="img" aria-label="Внизу бокового примыкания отводящий фартук направляет воду от стены в желоб"><defs><marker id={`kick-arrow-${uid}`} markerWidth="5" markerHeight="5" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#6499ad"/></marker></defs><path d="M169 20h19v104h-19Z" fill="#dfd5b9" stroke="#b8a47e"/><path d="M40 22h122v90H40Z" fill="#dbe4cc" stroke="#a4b28f"/><path d="M159 24v59l-20 23h-30" fill="none" stroke="#b99558" strokeWidth="7" strokeLinejoin="round"/><path d="M145 33v43l-20 27" fill="none" stroke="#6499ad" strokeWidth="2" markerEnd={`url(#kick-arrow-${uid})`}/><rect x="35" y="115" width="135" height="14" rx="5" fill="#d9ece3" stroke="#7ca88f"/><text x="23" y="146" className="drainage-svg-note">5 · Отвод в желоб в конце примыкания</text></svg><p>Нижний отводящий фартук выводит поток в желоб, сохраняя стену вне пути воды.</p></div></div>;
}

function ValleySection(){
  const uid=useId().replaceAll(':','');
  return <svg className="drainage-valley-section" viewBox="0 0 620 230" role="img" aria-label="Схема ендовы: вода с двух скатов собирается в центральный лоток"><defs><marker id={`valley-flow-${uid}`} markerWidth="6" markerHeight="6" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#6499ad"/></marker></defs><text x="20" y="25" className="drainage-svg-caption">ЕНДОВА · ПОПЕРЕЧНЫЙ РАЗРЕЗ</text><path d="m35 70 245 83h60l245-83v23l-245 83h-60L35 93Z" fill="#d8c5a0" stroke="#ae9871" strokeWidth="1.5"/><path d="m40 65 200 68m340-68-200 68" stroke="#82916e" strokeWidth="8"/><path d="m210 138 70 23h60l70-23" fill="none" stroke="#c29b59" strokeWidth="6"/><path d="m112 72 111 37m285-37-111 37" fill="none" stroke="#6499ad" strokeWidth="2.5" markerEnd={`url(#valley-flow-${uid})`}/><path d="M310 173v26" stroke="#6499ad" strokeWidth="2.5" markerEnd={`url(#valley-flow-${uid})`}/><text x="310" y="220" textAnchor="middle" className="drainage-svg-note">Лоток и подкладочный водоотводящий слой · выпуск проверяется на плане</text></svg>;
}

function GutterSection(){
  const uid=useId().replaceAll(':','');
  return <svg className="drainage-gutter-section" viewBox="0 0 620 230" role="img" aria-label="Схема карниза: капельник переводит воду в желоб и далее в трубу"><defs><marker id={`gutter-flow-${uid}`} markerWidth="6" markerHeight="6" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#6499ad"/></marker></defs><text x="20" y="25" className="drainage-svg-caption">КАРНИЗ · ВЫПУСК ВОДЫ</text><path d="m80 65 280 75v21L80 86Z" fill="#d6c099" stroke="#ac9267" strokeWidth="1.5"/><path d="m80 60 286 76" stroke="#81916e" strokeWidth="7"/><path d="m284 140 80 21v19l8 4" stroke="#ba985d" strokeWidth="4" fill="none"/><path d="M343 172v14c0 26 85 26 85 0v-14" fill="#deeee5" stroke="#6a9d85" strokeWidth="3"/><path d="M414 205v20" stroke="#6a9d85" strokeWidth="10"/><path d="m168 68 103 28m27 7 59 18v43" stroke="#6499ad" strokeWidth="2.5" fill="none" markerEnd={`url(#gutter-flow-${uid})`}/><text x="458" y="184" className="drainage-svg-note">Желоб</text><text x="458" y="213" className="drainage-svg-note">Водосточная труба</text></svg>;
}

function RidgeSection(){
  const uid=useId().replaceAll(':','');
  return <svg className="drainage-valley-section" viewBox="0 0 620 230" role="img" aria-label="Схема конька: потоки расходятся по двум сторонам покрытия"><defs><marker id={`ridge-flow-${uid}`} markerWidth="6" markerHeight="6" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#6499ad"/></marker></defs><text x="20" y="25" className="drainage-svg-caption">КОНЁК · РАЗДЕЛЕНИЕ ПОТОКОВ</text><path d="m50 177 260-95 260 95v20L310 102 50 197Z" fill="#d9c6a2" stroke="#ad956e" strokeWidth="1.5"/><path d="m50 172 235-86m285 86L335 86" fill="none" stroke="#839371" strokeWidth="8"/><path d="m242 103 68-26 68 26" fill="none" stroke="#bf9c61" strokeWidth="7"/><path d="m264 58-98 36m190-36 98 36" fill="none" stroke="#6499ad" strokeWidth="2.5" markerEnd={`url(#ridge-flow-${uid})`}/><text x="310" y="222" textAnchor="middle" className="drainage-svg-note">Коньковый элемент перекрывает кромки скатов · исполнение по кровельной системе</text></svg>;
}

export default function RoofDrainagePanel({project,result,roofModel,drainage,onApplySuggestions}){
  const [picked,setPicked]=useState(null);
  const edges=drainage?.edges??[],issues=drainage?.issues??[],suggestions=drainage?.suggestions??[],q=drainage?.quantities??{};
  const junctions=drainage?.junctions??edges.filter(e=>['valley','step','wall-abutment'].includes(e.type));
  const selected=edges.find(e=>e.id===picked)??edges.find(e=>e.id===issues.find(i=>i.edgeId)?.edgeId)??junctions.find(e=>e.type==='wall-abutment')??junctions[0]??edges[0];
  const selectedIssues=issues.filter(i=>i.edgeId===selected?.id||(i.zoneId&&selected?.zoneIds?.includes(i.zoneId)));
  const errors=issues.filter(i=>i.severity==='error');
  const selectedType=selected?.type;
  const sectionType=selectedType==='valley'?'valley':selectedType==='ridge'?'ridge':['eave','gutter','rake','gable','free-edge'].includes(selectedType)?'gutter':'wall';
  const gutterEdges=useMemo(()=>new Set((drainage?.gutters??[]).map(g=>g.edgeId)),[drainage]);
  const projectedArea=Number.isFinite(q.projectedCatchmentArea)?q.projectedCatchmentArea:Number.isFinite(q.catchmentArea)?q.catchmentArea:Number.isFinite(q.projectedArea)?q.projectedArea:roofModel?.projectedArea;
  const unresolved=q.unresolvedArea??0,hasBalance=Number.isFinite(q.totalResolvedArea)&&Number.isFinite(projectedArea)&&projectedArea>0;
  if(!(roofModel?.surfaces?.length))return <section className="roof-drainage-panel drainage-empty"><h2>Нет скатов для проверки</h2><p>Откройте «Геометрия и фермы» и создайте кровельные зоны по замкнутому контуру дома.</p></section>;
  return <section className="roof-drainage-panel" aria-label="Сток и примыкания кровли">
    <header className="drainage-heading"><div><span>ВОДА ИДЁТ ПО ГЕОМЕТРИИ СКАТОВ</span><h2>Сток и примыкания</h2><p>От ската до желоба и трубы. Выберите кромку на плане, чтобы посмотреть её условие и схему узла.</p></div><div className={`drainage-state ${errors.length||unresolved>1e-6?'danger':''}`}><i/>{unresolved>1e-6?`${fmt(unresolved)} м² без выпуска`:errors.length?`${errors.length} проблем стока`:hasBalance?'Пути до выпуска найдены':issues.length?`${issues.length} условий к решению`:'Проверка геометрии стока'}</div></header>
    <div className="drainage-metrics"><div><span>Желоба · предложено</span><strong>{fmt(q.gutterLength)}<small>м</small></strong></div><div><span>Фартуки примыканий</span><strong>{fmt(q.flashingLength??q.wallAbutmentLength)}<small>м</small></strong></div><div><span>Водосточные трубы</span><strong>{fmt(q.downpipeCount,0)}<small>шт.</small></strong></div><div><span>Водосбор в плане</span><strong>{fmt(projectedArea)}<small>м²</small></strong></div></div>
    {hasBalance&&<div className="drainage-route-balance"><span>До наружного выпуска<strong>{fmt(q.totalResolvedArea)} / {fmt(projectedArea)} м²</strong></span><div><i style={{width:`${Math.max(0,Math.min(100,q.totalResolvedArea/projectedArea*100))}%`}}/></div><span className={unresolved>1e-6?'danger':''}>Неразрешённый сток {fmt(unresolved)} м²</span></div>}
    {suggestions.length>0&&<div className="drainage-suggestions"><div><strong>Изменить направление воды у стен</strong><p>Для {new Set(suggestions.map(s=>s.zoneId)).size} зон найдена схема скатов с отводом от примыкания. Изменятся геометрия, расход досок и водосбор.</p></div><button className="button primary" disabled={!onApplySuggestions} onClick={()=>onApplySuggestions?.(suggestions)}>Направить скаты от стен ↗</button></div>}
    {!roofModel?.surfaces?.length?<div className="drainage-empty">Сначала сформируйте кровельные зоны. Здесь появятся скаты, пути воды и кромки водоотвода.</div>:<DrainagePlan result={result} roofModel={roofModel} drainage={drainage} selectedId={selected?.id} onSelect={setPicked}/>}
    <div className="drainage-lower-grid"><div className="drainage-issues"><div className="drainage-subhead"><h3>Условия модели</h3><span>{issues.length}</span></div>{issues.length?issues.map(issue=>{const target=issue.edgeId??edges.find(e=>e.zoneIds?.includes(issue.zoneId))?.id;const IssueElement=target?'button':'div';return <IssueElement key={issue.id} className={`drainage-issue ${issue.severity==='error'?'danger':''} ${selectedIssues.includes(issue)?'active':''}`} onClick={target?()=>setPicked(target):undefined}><i>{issue.severity==='error'?'!':'·'}</i><span>{issue.message}{issue.zoneId&&<small>{roofModel?.zones?.find(z=>z.id===issue.zoneId)?.name??issue.zoneId}</small>}</span></IssueElement>}):<p className="drainage-issue-empty">Направление потоков проверено по текущей геометрии. Детали покрытия и пропускная способность водостока задаются отдельно.</p>}
      <div className="drainage-secondary-quantities"><span>Ендовы<strong>{fmt(q.valleyLength)} м</strong></span><span>Длина труб<strong>{fmt(q.downpipeLength)} м</strong></span></div></div>
      <div className="drainage-selected"><div className="drainage-subhead"><h3>{selected?names[selected.type]??selected.type:'Выберите примыкание'}</h3>{selected&&<span className={failed(selected)?'danger':''}>{fmt(selected.length)} м</span>}</div>{selected&&<><div className="drainage-selected-id">{selected.id}</div>{selected.note&&<p>{selected.note}</p>}<div className="drainage-selected-tags">{selected.zoneIds?.map(id=><span key={id}>{roofModel?.zones?.find(z=>z.id===id)?.name??id}</span>)}{gutterEdges.has(selected.id)&&<span>Предложен желоб</span>}{selected.flowIntoWall&&<span className="danger">Поток направлен к стене</span>}</div></>}
      <div className="drainage-junction-list">{junctions.map((j,i)=><button key={j.id} className={selected?.id===j.id?'active':''} onClick={()=>setPicked(j.id)} title={j.note??''}><i style={{background:edgeColor(j)}}/>{names[j.type]??j.type} {i+1}<small>{fmt(j.length)} м</small></button>)}</div></div></div>
    <div className="drainage-detail"><div className="drainage-detail-head"><div><span>УЗЕЛ ВЫБРАННОГО ТИПА</span><h3>{sectionType==='valley'?'Вода собирается в ендове':sectionType==='gutter'?'От ската — в водосточную систему':sectionType==='ridge'?'Вода расходится от конька':'Примыкание с непрерывным водоотводом'}</h3></div><small>Схематично · размеры по системе кровли</small></div>
      {sectionType==='valley'?<ValleySection/>:sectionType==='gutter'?<GutterSection/>:sectionType==='ridge'?<RidgeSection/>:<WallFlashingSection/>}
      <div className="drainage-detail-notes">{sectionType==='wall'?<><p>Мембрана стены перекрывает верх фартука. Контрфартук закрывает его верхнюю кромку; вода по нахлёстам выходит на кровлю.</p><p>Для штучной кровли — ступенчатые фартуки, для металла и мембраны — непрерывное примыкание. В конце бокового примыкания нужен отвод в желоб. Герметик не заменяет водоотводящие слои.</p><a href="https://basc.pnnl.gov/resource-guides/step-and-kick-out-flashing-roof-wall-intersections" target="_blank" rel="noreferrer">Принцип нахлёстов: PNNL · Building America ↗</a></>:<p>Профиль, нахлёсты, крепления и размеры подбираются по выбранной кровельной системе. На плане показано направление потока и предлагаемые места сбора воды.</p>}</div>
    </div>
    <details className="drainage-assumptions"><summary>Как читается эта схема</summary><p>Желоба и трубы показаны как предложения по геометрии. Их сечение, уклон желоба, интенсивность дождя, пропускная способность и выпуск на участке требуют исходных данных выбранной системы.</p>{(drainage?.assumptions??[]).map((a,i)=><p key={i}>{a}</p>)}{(drainage?.warnings??[]).map((w,i)=><p key={`w${i}`}>{typeof w==='string'?w:w.message??w.note}</p>)}</details>
  </section>;
}

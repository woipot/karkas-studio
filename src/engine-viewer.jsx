import React,{useEffect,useMemo,useRef,useState} from 'react';
import DesignerModel from './designer-model.jsx';
import Icon from './icons.jsx';
import {parseSection} from './catalog.js';
import {formatEndCut,cuttingToPrintHTML} from './cutting.js';
import './engine-viewer.css';

const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fmt=(n,d=1)=>finite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
const rub=n=>`${fmt(n,0)} ₽`;
const categories={walls:'Стены',floor:'Перекрытия',roof:'Кровля',bracing:'Укосины',objects:'Отдельные элементы',foundation:'Фундамент',grillage:'Ростверк'};
const tabs=[['overview','cube','Обзор'],['checks','check','Проверки'],['materials','table','Материалы'],['cutting','ruler','Раскрой'],['estimate','weight','Смета']];
const defaultLayers={walls:true,floor:true,roof:true,bracing:true,objects:true,foundation:true,grillage:true,piles:true,surfaces:false,sheathing:false,drainage:false};
const statusLabel=status=>status==='fail'?'Превышение':status==='pass'?'В пределах':status==='warning'?'Частная проверка':'Не подтверждено';
const statusClass=status=>status==='fail'?'fail':status==='pass'?'pass':'pending';

function human(text,p){
  let s=String(text??'');
  const replacements=(p.walls??[]).map((w,i)=>({id:w.id,label:`Стена ${i+1}`})).sort((a,b)=>b.id.length-a.id.length);
  for(const {id,label} of replacements)if(id)s=s.replaceAll(id,label);
  return s;
}

function download(name,content,type='application/json'){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function Counter({label,value,unit,note}){return <div className="engine-counter"><span>{label}</span><strong>{value}<small>{unit}</small></strong>{note&&<em>{note}</em>}</div>}

function Pager({page,pages,total,onChange,label='строк'}){
  return <div className="engine-pager"><span>{total} {label} · страница {page} из {pages}</span><div><button disabled={page<=1} onClick={()=>onChange(page-1)} aria-label="Предыдущая страница"><Icon name="arrow" size={15} style={{transform:'rotate(180deg)'}}/>Назад</button><button disabled={page>=pages} onClick={()=>onChange(page+1)} aria-label="Следующая страница">Далее<Icon name="arrow" size={15}/></button></div></div>;
}

function Plan({p,r,level,selected,onSelect,fitKey}){
  const svg=useRef();
  const levelModel=r.geometry.levels?.find(l=>l.index===level);
  const walls=p.walls.filter(w=>(w.level??level)===level),polygon=levelModel?.polygon??r.geometry.polygon??[];
  const endpoints=walls.flatMap(w=>[w.a,w.b]);
  const fit=()=>{
    const points=endpoints.length?endpoints:polygon;
    const x=points.length?Math.min(...points.map(q=>q.x)):0,y=points.length?Math.min(...points.map(q=>q.y)):0;
    const w=points.length?Math.max(6,Math.max(...points.map(q=>q.x))-x):12,h=points.length?Math.max(5,Math.max(...points.map(q=>q.y))-y):8;
    const pad=Math.max(w,h)*.13;return{x:x-pad,y:y-pad,w:w+2*pad,h:h+2*pad};
  };
  const [box,setBox]=useState(fit);
  useEffect(()=>setBox(fit()),[p,r,level,fitKey]);
  const scale=Math.max(box.w,box.h)/15;
  const zoom=factor=>setBox(b=>{const w=Math.min(180,Math.max(3,b.w*factor)),s=w/b.w;return{x:b.x+(b.w-w)/2,y:b.y+(b.h-b.h*s)/2,w,h:b.h*s}});
  return <div className="engine-plan-wrap"><svg ref={svg} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="group" aria-label={`План ${level} этажа. Только просмотр.`}>
    <defs><pattern id="engine-plan-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" stroke="#d7dfce" strokeWidth={.012*scale} fill="none"/></pattern></defs>
    <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#edf1e7"/><rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#engine-plan-grid)"/>
    {polygon.length>2&&<polygon points={polygon.map(q=>`${q.x},${q.y}`).join(' ')} fill="#f8faf3" stroke="none"/>}
    {(r.timber?.instances??[]).filter(b=>b.category==='floor'&&b.role==='joist'&&(b.level??b.floor??1)===level).map(b=><line key={b.id} x1={b.start[0]} y1={b.start[2]} x2={b.end[0]} y2={b.end[2]} stroke="#d8c9ac" strokeWidth={b.b/1000} opacity=".55"/>)}
    {walls.map((wall,i)=>{const dx=wall.b.x-wall.a.x,dy=wall.b.y-wall.a.y,L=Math.hypot(dx,dy);if(L<.01)return null;const n={x:-dy/L,y:dx/L},t=(parseSection(wall.section)?.h??150)/1000,active=selected?.type==='wall'&&selected.id===wall.id;
      return <g key={wall.id} role="button" tabIndex={0} className="engine-plan-object" aria-label={`Стена ${p.walls.indexOf(wall)+1}, ${fmt(L)} м`} onClick={()=>onSelect({type:'wall',id:wall.id})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();onSelect({type:'wall',id:wall.id})}}}>
        <line x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y} stroke={active?'#9ab66e':'#58664e'} strokeWidth={t+.04} strokeLinecap="square"/>
        <line x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y} stroke={active?'#d4e6ad':'#d2bc92'} strokeWidth={Math.max(.04,t-.025)} strokeLinecap="square"/>
        <line x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y} stroke="transparent" strokeWidth={.32*scale}/>
        <text x={(wall.a.x+wall.b.x)/2+n.x*.37*scale} y={(wall.a.y+wall.b.y)/2+n.y*.37*scale} textAnchor="middle" fontSize={.15*scale} fill="#849174" stroke="#f8faf3" strokeWidth={.05*scale} paintOrder="stroke" pointerEvents="none">{fmt(L,2)} м</text>
      </g>;
    })}
    {p.openings.filter(o=>{const w=walls.find(w=>w.id===o.wallId);return w&&(o.floor??w.level??1)===level}).map(o=>{const w=walls.find(w=>w.id===o.wallId),L=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),angle=Math.atan2(w.b.y-w.a.y,w.b.x-w.a.x)*180/Math.PI;const x=w.a.x+(w.b.x-w.a.x)*o.offset/L,y=w.a.y+(w.b.y-w.a.y)*o.offset/L;return <g key={o.id} transform={`translate(${x} ${y}) rotate(${angle})`} role="button" tabIndex={0} className="engine-plan-object" onClick={()=>onSelect({type:'opening',id:o.id})} onKeyDown={e=>{if(e.key==='Enter')onSelect({type:'opening',id:o.id})}} aria-label={o.type==='door'?'Дверной проём':'Оконный проём'}><rect x="0" y="-.13" width={o.width} height=".26" fill="#f8faf3"/>{o.type==='window'?<rect x=".01" y="-.085" width={Math.max(.01,o.width-.02)} height=".17" fill="#c8dfda" stroke="#7ba6a0" strokeWidth=".018"/>:<path d={`M0 0V${o.width}A${o.width} ${o.width} 0 0 0 ${o.width} 0`} stroke="#8da17a" strokeWidth=".02" fill="none"/>}</g>})}
    {p.voids.filter(v=>v.level===level).map(v=><g key={v.id}><polygon points={v.polygon.map(q=>`${q.x},${q.y}`).join(' ')} fill="#edf1e7" stroke="#a8b792" strokeWidth={.02*scale} strokeDasharray={`${.12*scale} ${.07*scale}`}/><text x={v.polygon.reduce((s,q)=>s+q.x,0)/v.polygon.length} y={v.polygon.reduce((s,q)=>s+q.y,0)/v.polygon.length} textAnchor="middle" fontSize={.14*scale} fill="#98a988">ВТОРОЙ СВЕТ</text></g>)}
    {level===1&&(r.piles??[]).map((pile,i)=><circle key={pile.id} cx={pile.x} cy={pile.y} r={.055*scale} fill="#859675" opacity=".65"><title>{`Опора ${i+1}: ${fmt(pile.reaction)} кН`}</title></circle>)}
  </svg><div className="engine-plan-zoom"><button onClick={()=>zoom(1.2)} aria-label="Уменьшить план">−</button><button onClick={()=>zoom(.83)} aria-label="Увеличить план">+</button></div></div>;
}

function SelectionFacts({selected,p,r}){
  const board=r.timber.instances.find(b=>selected?.type==='member'&&b.id===selected.id);
  const wall=p.walls.find(w=>selected?.type==='wall'&&w.id===selected.id);
  const opening=p.openings.find(o=>selected?.type==='opening'&&o.id===selected.id);
  const pile=(r.piles??[]).find(s=>selected?.type==='pile'&&s.id===selected.id);
  const rows=board?[
    ['Сечение',`${board.b} × ${board.h} мм`],['Длина по оси',`${fmt(board.length,3)} м`],['Заготовка',`${fmt(board.cutLength??board.length,3)} м`],['Масса',`${fmt(board.mass,2)} кг`],['Назначение',categories[board.category]??'Элемент каркаса'],
  ]:wall?[
    ['Сечение',wall.section.replace('x',' × ')+' мм'],['Длина',fmt(Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y))+' м'],['Этаж',String(wall.level??1)],['Назначение',wall.kind==='exterior'?'Наружная':wall.kind==='bearing'?'Несущая':'Перегородка'],
  ]:opening?[
    ['Ширина',fmt(opening.width)+' м'],['Высота',fmt(opening.height)+' м'],['От пола',fmt(opening.sill)+' м'],['Этаж',String(opening.floor??1)],
  ]:pile?[
    ['Реакция',fmt(pile.reaction)+' кН'],['Заданный предел',fmt(p.foundation?.capacity)+' кН'],['Координаты',`X ${fmt(pile.x)} · Y ${fmt(pile.y)}`],
  ]:null;
  const title=board?.name??(wall?`Стена ${p.walls.indexOf(wall)+1}`:opening?(opening.type==='door'?'Дверной проём':'Оконный проём'):pile?`Опора ${(r.piles??[]).indexOf(pile)+1}`:'Параметры отчёта');
  return <div className="engine-selection"><div className="engine-eyebrow">{rows?'ВЫБРАННЫЙ ЭЛЕМЕНТ':'МОДЕЛЬ В ЦИФРАХ'}</div><h3>{title}</h3>{rows?rows.map(([label,value])=><div className="engine-fact" key={label}><span>{label}</span><strong>{value}</strong></div>):<>
    <div className="engine-fact"><span>Стен в проекте</span><strong>{p.walls.length}</strong></div><div className="engine-fact"><span>Окон и дверей</span><strong>{p.openings.length}</strong></div><div className="engine-fact"><span>Опор фундамента</span><strong>{r.piles?.length??0}</strong></div><div className="engine-fact"><span>Кровельных зон</span><strong>{r.roofModel?.zones?.length??0}</strong></div><div className="engine-fact"><span>Плиты жёсткости</span><strong>{fmt(r.bracingModel?.quantities?.sheetArea)} м²</strong></div>
  </>}{board&&<details className="engine-small-details"><summary>Торцы и идентификатор</summary><p>Начало: {formatEndCut(board.cutStart)}</p><p>Конец: {formatEndCut(board.cutEnd)}</p><code>{board.id}</code></details>}<p className="engine-view-hint">Выбор элемента раскрывает данные отчёта. Изменение модели выполняется через MCP.</p></div>;
}

function Overview({report}){
  const p=report.project,r=report.result;
  const [view,setView]=useState('3d'),[layers,setLayers]=useState(defaultLayers),[fitKey,setFitKey]=useState(0),[selected,setSelected]=useState(null),[level,setLevel]=useState(1);
  const counts=useMemo(()=>r.timber.instances.reduce((map,b)=>({...map,[b.category]:(map[b.category]??0)+1}),{}),[r]);
  const layerList=[['walls','Стены'],['floor','Перекрытия'],['roof','Кровля'],['grillage','Ростверк'],['piles','Сваи'],['bracing','Связи'],['sheathing','Плиты'],['surfaces','Скаты'],['drainage','Сток']];
  const failCount=(r.checks??[]).filter(c=>c.status==='fail').length,unknownCount=(r.checks??[]).filter(c=>c.status==='unverified'||c.status==='warning').length;
  return <><div className="engine-overview-grid"><div className="engine-model-card"><div className="engine-model-toolbar"><div><span className="engine-live-dot"/>МОДЕЛЬ ИЗ ОТЧЁТА</div><div className="engine-toolbar-actions"><div className="engine-view-switch"><button className={view==='3d'?'active':''} onClick={()=>setView('3d')}>3D</button><button className={view==='plan'?'active':''} onClick={()=>setView('plan')}>План</button></div><button className="engine-icon-button" onClick={()=>setFitKey(k=>k+1)} title="Вписать модель" aria-label="Вписать модель"><Icon name="target" size={18}/></button></div></div>
      <div className="engine-model-stage">{view==='3d'?<DesignerModel project={p} result={r} roofModel={r.roofModel} selected={selected} onSelect={setSelected} layers={layers} fitKey={fitKey}/>:<Plan p={p} r={r} level={level} selected={selected} onSelect={setSelected} fitKey={fitKey}/>}<div className="engine-canvas-tag"><span>{view==='3d'?'КОНСТРУКТИВНАЯ МОДЕЛЬ':`ПЛАН · ${level} ЭТАЖ`}</span><small>{view==='3d'?'Вращение · масштаб · выбор элемента':'Контур, доски и проёмы из одной модели'}</small></div></div>
      {view==='3d'?<div className="engine-layer-bar">{layerList.map(([key,label])=><button key={key} className={layers[key]?'active':''} onClick={()=>setLayers(old=>({...old,[key]:!old[key],...(key==='grillage'?{foundation:!old[key]}:{})}))} aria-pressed={layers[key]}><i/>{label}</button>)}</div>:<div className="engine-layer-bar">{[...Array(p.floors??1)].map((_,i)=><button className={level===i+1?'active':''} key={i} onClick={()=>{setLevel(i+1);setSelected(null)}}>{i+1} этаж</button>)}</div>}
    </div><aside className="engine-facts-panel"><SelectionFacts selected={selected} p={p} r={r}/><div className="engine-level-facts"><div className="engine-eyebrow">УРОВНИ МОДЕЛИ</div>{(r.geometry.levels??[]).map(l=><div key={l.index}><strong>{l.name??`${l.index} этаж`}</strong><span>{fmt(l.netFloorArea??l.area)} м²</span><small>Верх стен {fmt(l.topY,3)} м · высота {fmt(l.height)} м</small></div>)}</div></aside></div>
    <div className="engine-overview-bottom"><div className="engine-summary-note"><div className="engine-eyebrow">ЧАСТНЫЕ ПРОВЕРКИ</div><strong>{failCount?`${failCount} превышений требуют решения`:`${unknownCount} условий требуют проверки`}</strong><p>Проверки элементов и неподтверждённые узлы представлены отдельно. Полный список доступен во вкладке «Проверки».</p></div><div className="engine-summary-note"><div className="engine-eyebrow">ЕДИНЫЙ РЕЕСТР</div><strong>{r.timber.instances.length} физических досок</strong><p>{Object.entries(counts).map(([category,count])=>`${categories[category]??category}: ${count}`).join(' · ')}</p></div><div className="engine-summary-note"><div className="engine-eyebrow">ЗАКУПКА ПО РАСКРОЮ</div><strong>{fmt(report.cutting?.summary?.purchasedVolume,3)} м³ · заготовка 6 м</strong><p>{report.cutting?.summary?.complete===false?'Есть неразмещённые детали. Проверьте ограничения в карте раскроя.':`Остатки и пропилы ${fmt(report.cutting?.summary?.wastePercent)}%. Значения взяты из отчёта движка.`}</p></div></div>
  </>;
}

function ChecksView({report}){
  const [filter,setFilter]=useState('all'),[page,setPage]=useState(1);
  const checks=report.result.checks??[];
  const filtered=checks.filter(c=>filter==='all'||filter==='fail'&&c.status==='fail'||filter==='pass'&&c.status==='pass'||filter==='pending'&&!['fail','pass'].includes(c.status));
  const pages=Math.max(1,Math.ceil(filtered.length/16)),current=Math.min(page,pages);
  const count=key=>key==='all'?checks.length:checks.filter(c=>key==='pending'?!['fail','pass'].includes(c.status):c.status===key).length;
  return <div className="engine-report-section"><div className="engine-section-heading"><div><div className="engine-eyebrow">РАСЧЁТНЫЕ УСЛОВИЯ И УЗЛЫ</div><h2>Проверки модели</h2><p>Статусы и численные результаты получены от движка. Неподтверждённые условия остаются видимыми.</p></div></div><div className="engine-filter-tabs">{[['all','Все'],['fail','Превышения'],['pending','Требует проверки'],['pass','В пределах']].map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>{setFilter(key);setPage(1)}}>{label}<small>{count(key)}</small></button>)}</div>
    <div className="engine-check-list">{filtered.slice((current-1)*16,current*16).map((c,i)=><details key={`${c.id}-${i}`} className={`engine-check ${statusClass(c.status)}`}><summary><span className="engine-check-symbol">{c.status==='fail'?'!':c.status==='pass'?'✓':'·'}</span><span className="engine-check-title">{human(c.label??c.name??c.id,report.project)}{finite(c.value)&&<small>{fmt(c.value,3)}{finite(c.limit)?` / ${fmt(c.limit,3)}`:''} {c.unit??''}</small>}</span><span className={`engine-badge ${statusClass(c.status)}`}>{statusLabel(c.status)}</span></summary><div className="engine-check-body">{c.note&&<p>{human(c.note,report.project)}</p>}{finite(c.utilization)&&<p>Использовано {fmt(c.utilization*100)}% заданного предела.</p>}<code>{c.id}</code></div></details>)}{!filtered.length&&<div className="engine-empty">В выбранной группе нет проверок.</div>}</div>
    <Pager page={current} pages={pages} total={filtered.length} onChange={setPage} label="проверок"/>
    <details className="engine-method-details"><summary>Допущения и замечания отчёта</summary>{(report.result.warnings??[]).map((note,i)=><p key={`w${i}`}>{human(note,report.project)}</p>)}{(report.result.assumptions??[]).map((note,i)=><p key={`a${i}`}>{note}</p>)}</details>
  </div>;
}

function MaterialsView({report}){
  const [category,setCategory]=useState('all'),[page,setPage]=useState(1),[subtab,setSubtab]=useState('boards'),[sheetPage,setSheetPage]=useState(1);
  const r=report.result,rows=r.timber.schedule??[],types=[...new Set(rows.map(row=>row.category))];
  const filtered=rows.filter(row=>category==='all'||row.category===category),pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages);
  const sheets=useMemo(()=>{
    const map=new Map();
    for(const panel of r.bracingModel?.panels??[]){const id=panel.stockSheetId??panel.id,group=map.get(id)??{id,wallId:panel.wallId,level:panel.level,area:0};group.area+=panel.area??0;map.set(id,group);}
    return [...map.values()];
  },[r]);
  const sheetPages=Math.max(1,Math.ceil(sheets.length/20)),sheetCurrent=Math.min(sheetPage,sheetPages);
  return <div className="engine-report-section"><div className="engine-section-heading"><div><div className="engine-eyebrow">ФАКТИЧЕСКИЕ ОБЪЁМЫ</div><h2>Материалы и элементы</h2><p>Доски сгруппированы по назначению, сечению и длине. Листовые материалы показаны по исходным листам.</p></div></div><div className="engine-mini-counters"><Counter label="Древесина в модели" value={fmt(r.timber.volume,3)} unit="м³"/><Counter label="Масса древесины" value={fmt(r.timber.mass,0)} unit="кг"/><Counter label="Плиты к закупке" value={sheets.length} unit="листов"/><Counter label="Масса плит" value={fmt(r.bracingModel?.quantities?.panelMass,0)} unit="кг"/></div>
    <div className="engine-filter-tabs"><button className={subtab==='boards'?'active':''} onClick={()=>setSubtab('boards')}>Доски</button><button className={subtab==='sheets'?'active':''} onClick={()=>setSubtab('sheets')}>Листовые материалы</button></div>
    {subtab==='boards'?<><div className="engine-category-chips">{['all',...types].map(key=><button key={key} className={category===key?'active':''} onClick={()=>{setCategory(key);setPage(1)}}>{key==='all'?'Все элементы':categories[key]??key}</button>)}</div><div className="engine-table-card"><table><thead><tr><th>Элемент</th><th>Сечение</th><th>Длина</th><th>Количество</th><th>Объём</th><th>Масса</th></tr></thead><tbody>{filtered.slice((current-1)*20,current*20).map((row,i)=><tr key={`${row.id}-${i}`}><td>{row.name}<small>{categories[row.category]??row.category}</small></td><td>{row.b&&row.h?`${row.b} × ${row.h}`:row.section} мм</td><td>{fmt(row.length,3)} м</td><td>{row.count} шт.</td><td>{fmt(row.volume,4)} м³</td><td>{fmt(row.mass??row.totalMass)} кг</td></tr>)}</tbody></table></div><Pager page={current} pages={pages} total={filtered.length} onChange={setPage}/></>:<div className="engine-table-card"><table><thead><tr><th>Лист</th><th>Стена</th><th>Этаж</th><th>Чистая площадь</th></tr></thead><tbody>{sheets.slice((sheetCurrent-1)*20,sheetCurrent*20).map((sheet,i)=><tr key={sheet.id}><td title={sheet.id}>Лист {(sheetCurrent-1)*20+i+1}</td><td>Стена {report.project.walls.findIndex(w=>w.id===sheet.wallId)+1}</td><td>{sheet.level}</td><td>{fmt(sheet.area,3)} м²</td></tr>)}</tbody></table><div style={{padding:"0 14px 14px"}}><Pager page={sheetCurrent} pages={sheetPages} total={sheets.length} onChange={setSheetPage} label="листов"/></div></div>}
  </div>;
}

function StockCard({stock,index}){
  return <article className="engine-stock"><div className="engine-stock-head"><h3>Заготовка {index+1}<small>{stock.section.replace('x',' × ')} мм · 6 м</small></h3><span>Остаток {fmt(stock.remainder,3)} м{stock.reusable?' · пригоден от 0,30 м':''}</span></div><div className="engine-stock-bar">{stock.pieces.map((piece,i)=><div key={piece.id} className="engine-stock-piece" style={{left:`${piece.cutStart/6*100}%`,width:`${piece.length/6*100}%`,background:['#d0b68d','#ddcaab','#bda782','#d5c39e'][i%4]}} title={`${piece.id} · ${piece.name} · ${fmt(piece.length,3)} м`}>{piece.length>.45&&<><strong>{piece.id}</strong><small>{fmt(piece.length,3)} м</small></>}</div>)}{stock.remainder>1e-8&&<div className="engine-stock-tail" style={{left:`${stock.consumed/6*100}%`,width:`${stock.remainder/6*100}%`}}/>}</div><div className="engine-stock-foot"><span>Детали {fmt(stock.used,3)} м</span><span>Пропилы {fmt(stock.kerfWaste*1000,0)} мм</span></div><details><summary>Детали, позиции и торцы</summary><div className="engine-stock-detail-table"><table><thead><tr><th>Деталь</th><th>Длина / позиция, м</th><th>Начало</th><th>Конец</th></tr></thead><tbody>{stock.pieces.map(piece=><tr key={piece.id}><td>{piece.id}<small>{piece.name}</small></td><td>{fmt(piece.length,3)}<small>{fmt(piece.cutStart,3)}–{fmt(piece.cutEnd,3)}</small></td><td>{formatEndCut(piece.endStart)}</td><td>{formatEndCut(piece.endEnd)}</td></tr>)}</tbody></table></div></details></article>;
}

function CuttingView({report}){
  const c=report.cutting,[section,setSection]=useState('all'),[page,setPage]=useState(1),[printError,setPrintError]=useState('');
  if(!c)return <div className="engine-empty">Карта раскроя отсутствует в отчёте.</div>;
  const stocks=c.stocks??[],types=[...new Set(stocks.map(s=>s.section))],filtered=stocks.filter(s=>section==='all'||s.section===section),pages=Math.max(1,Math.ceil(filtered.length/8)),current=Math.min(page,pages),s=c.summary??{};
  function print(){const win=window.open('','_blank');if(!win){setPrintError('Браузер заблокировал страницу печати. Разрешите её открытие для полной карты.');return;}win.document.open();win.document.write(cuttingToPrintHTML(c,report.project.name));win.document.close();win.focus();}
  return <div className="engine-report-section"><div className="engine-section-heading"><div><div className="engine-eyebrow">ВСЕ ДЕТАЛИ ИЗ ЗАГОТОВОК 6 М</div><h2>Карта раскроя</h2><p>{s.optimal?'Число заготовок минимально в принятой модели пропила.':'Найденная раскладка; глобальная оптимальность не доказана.'} Пропил между деталями {fmt(c.kerfMM)} мм.</p></div><button className="engine-button" onClick={print}><Icon name="file" size={16}/>Полная карта / печать</button></div><div className="engine-mini-counters"><Counter label="Заготовок по 6 м" value={s.boards??stocks.length} unit="шт."/><Counter label="Объём закупки" value={fmt(s.purchasedVolume,3)} unit="м³"/><Counter label="Остатки и пропилы" value={fmt(s.wastePercent)} unit="%"/><Counter label="Пригодные остатки" value={fmt(s.reusableLength)} unit="м"/></div>
    {(c.overlength?.length>0||c.invalid?.length>0)&&<div className="engine-alert"><strong>Неразмещённых деталей: {(c.overlength?.length??0)+(c.invalid?.length??0)}.</strong> Они не входят в закупочную карту.<details><summary>Показать ограничения</summary>{[...(c.overlength??[]),...(c.invalid??[])].map((piece,i)=><p key={`${piece.id}-${i}`}>{piece.id} · {fmt(piece.length,3)} м · {piece.reason}</p>)}</details></div>}{printError&&<div className="engine-alert" role="status">{printError}</div>}
    <div className="engine-category-chips">{['all',...types].map(key=><button key={key} className={section===key?'active':''} onClick={()=>{setSection(key);setPage(1)}}>{key==='all'?'Все сечения':key.replace('x',' × ')+' мм'}</button>)}</div>
    {filtered.slice((current-1)*8,current*8).map(stock=><StockCard key={stock.id} stock={stock} index={stocks.indexOf(stock)}/>)}<Pager page={current} pages={pages} total={filtered.length} onChange={setPage} label="заготовок"/>
    <details className="engine-method-details"><summary>Допущения карты раскроя</summary>{(c.assumptions??[]).map((note,i)=><p key={i}>{note}</p>)}</details>
  </div>;
}

function EstimateView({report}){
  const e=report.estimate;
  if(!e)return <div className="engine-empty">Смета отсутствует в отчёте.</div>;
  return <div className="engine-report-section"><div className="engine-section-heading"><div><div className="engine-eyebrow">ОБЪЁМЫ И РАСЦЕНКИ ИЗ ОТЧЁТА</div><h2>Смета проекта</h2><p>Количество, цена и итог представлены для просмотра. Расценки и параметры меняются через MCP.</p></div><div className="engine-budget"><span>{e.complete===false?'Учтённая часть сметы':'Итого по отчёту'}</span><strong>{rub(e.total)}</strong></div></div>{e.complete===false&&<div className="engine-alert">Смета неполная. Ограничения геометрии или раскроя перечислены в отчёте; итог относится к учтённым позициям.</div>}<div className="engine-mini-counters"><Counter label="Материалы" value={fmt(e.materialTotal??e.materialsTotal,0)} unit="₽"/><Counter label="Работы" value={fmt(e.laborTotal,0)} unit="₽"/><Counter label="Резерв" value={fmt(e.reserve,0)} unit="₽"/><Counter label="Древесина к закупке" value={fmt(e.procurementTimberVolume,3)} unit="м³"/></div><div className="engine-table-card"><table><thead><tr><th>Позиция</th><th>Количество</th><th>Единица</th><th>Цена, ₽/ед.</th><th>Сумма, ₽</th></tr></thead><tbody>{(e.rows??[]).map(row=><tr key={row.id}><td>{row.name}{row.note&&<small>{row.note}</small>}</td><td>{fmt(row.quantity,3)}</td><td>{row.unit}</td><td>{fmt(row.unitPrice,0)}</td><td className="engine-money">{fmt(row.total,0)}</td></tr>)}</tbody></table></div><div className="engine-estimate-totals"><div><span>Материалы</span><strong>{rub(e.materialTotal??e.materialsTotal)}</strong></div><div><span>Работы</span><strong>{rub(e.laborTotal)}</strong></div><div><span>Резерв</span><strong>{rub(e.reserve)}</strong></div><div><span>Итого</span><strong>{rub(e.total)}</strong></div></div><details className="engine-method-details"><summary>Расценки, состав и допущения сметы</summary>{(e.assumptions??[]).map((note,i)=><p key={i}>{note}</p>)}</details></div>;
}

function readReport(data){
  if(!data||typeof data!=='object'||!data.project||!data.result||!Array.isArray(data.project.walls)||!Array.isArray(data.result.timber?.instances)||!data.result.geometry?.bounds)throw Error('В JSON отсутствуют проект, геометрия или реестр физических досок.');
  const p={...data.project,openings:data.project.openings??[],voids:data.project.voids??[],foundation:data.project.foundation??{},roof:data.project.roof??{}};
  return {...data,project:p};
}

export function EngineViewer(){
  const [report,setReport]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[tab,setTab]=useState('overview');
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError('');
    fetch('/engine-report.json'+window.location.search,{cache:'no-store',signal:abort.signal}).then(response=>{if(!response.ok)throw Error(`Отчёт недоступен: HTTP ${response.status}.`);return response.json()}).then(data=>{setReport(readReport(data));setLoading(false)}).catch(e=>{if(e.name==='AbortError')return;setError(e.message??'Не удалось загрузить отчёт.');setLoading(false)});
    return()=>abort.abort();
  },[revision]);
  const refresh=()=>setRevision(v=>v+1);
  const engine=report?.engine??{},p=report?.project,r=report?.result;
  const generated=engine.generatedAt&&Number.isFinite(new Date(engine.generatedAt).getTime())?new Date(engine.generatedAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}):null;
  const failed=(r?.checks??[]).filter(c=>c.status==='fail').length;
  return <div className="engine-viewer"><header className="engine-topbar"><div className="engine-brand"><svg width="30" height="32" viewBox="0 0 32 34" fill="none" aria-hidden="true"><path d="M4 29V11L16 4l12 7v18M4 11l12 7 12-7M16 18v15M4 29l12-7 12 7" stroke="currentColor" strokeWidth="1.8"/></svg><div>КАРКАС <strong>ENGINE</strong><small>MCP · РАСЧЁТНАЯ МОДЕЛЬ</small></div></div><div className="engine-project-title">{p?.name??'Просмотр инженерного отчёта'}<small>{generated?`Отчёт от ${generated}`:'Источник: engine-report.json'}{engine.revision!==undefined?` · ревизия ${engine.revision}`:''}</small></div><div className="engine-top-actions"><span className="engine-version">{engine.version?`v${engine.version}`:'MCP'}</span>{report&&<button className="engine-top-button" onClick={()=>download('karkas-engine-report.json',JSON.stringify(report,null,2))}><Icon name="file" size={15}/>JSON отчёта</button>}<button className={`engine-top-button ${loading?'loading':''}`} disabled={loading} onClick={refresh}><Icon name="refresh" size={16}/><span>{loading?'Загрузка…':'Обновить отчёт'}</span></button></div></header>
    {report&&<div className="engine-revision-line"><span>СНИМОК МОДЕЛИ</span><strong>{p.name}</strong><span>Ревизия {engine.revision??'—'}</span><code title={engine.hash??''}>{typeof engine.hash==='string'?engine.hash.slice(0,12):'—'}</code></div>}
    <div className="engine-readonly-notice"><span className="engine-lock-icon"><Icon name="info" size={15}/></span><strong>Модель управляется через MCP. Ручное редактирование отключено.</strong><span>Только просмотр отчёта</span></div>
    {!report?<main className="engine-start-screen">{loading?<div className="engine-loading-state" role="status"><div className="engine-loading-cube"><Icon name="cube" size={45}/></div><h1>Загружаю расчётную модель</h1><p>Геометрия, проверки, ведомость и раскрой из отчёта движка.</p><div className="engine-loading-line"/></div>:<div className="engine-error-state" role="alert"><Icon name="file" size={38}/><h1>Не удалось открыть отчёт</h1><p>{error}</p><small>Ожидается локальный файл /engine-report.json с результатом расчёта.</small><button className="engine-button" onClick={refresh}>Повторить загрузку</button></div>}</main>:<>
      <nav className="engine-navigation" aria-label="Разделы отчёта">{tabs.map(([id,icon,label])=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}><Icon name={icon} size={18}/>{label}{id==='checks'&&failed>0&&<small>{failed}</small>}</button>)}<div className="engine-report-state"><i/>{loading?'Обновляю данные':'Снимок расчётного движка'}</div></nav>
      <main className="engine-main">{error&&<div className="engine-alert" role="status">Не удалось обновить отчёт: {error} Показаны ранее загруженные данные.</div>}<div className="engine-top-counters"><Counter label="Площадь этажей" value={fmt(r.geometry.totalFloorArea)} unit="м²"/><Counter label="Этажность" value={p.floors} unit={p.floors===1?'этаж':'этажа'}/><Counter label="Физические доски" value={r.timber.instances.length} unit="шт."/><Counter label="Масса древесины" value={fmt(r.timber.mass,0)} unit="кг"/><Counter label="Вертикальная нагрузка · расч." value={fmt(r.loads?.totalDesign)} unit="кН"/><Counter label="Заготовки по 6 м" value={report.cutting?.summary?.boards??'—'} unit="шт."/></div>
      {tab==='overview'?<Overview key={engine.hash??engine.revision??revision} report={report}/>:tab==='checks'?<ChecksView report={report}/>:tab==='materials'?<MaterialsView report={report}/>:tab==='cutting'?<CuttingView report={report}/>:<EstimateView report={report}/>}</main>
      <footer className="engine-footer"><span>КАРКАС ENGINE {engine.version??'4.0'} <i/> Просмотр результатов MCP</span><span>м · кН · МПа · кг</span><details><summary>Данные отчёта</summary><div><p>Версия схемы: {engine.schemaVersion??'—'}</p><p>Проект: {engine.projectId??'—'}</p><p>Ревизия: {engine.revision??'—'}</p>{engine.hash&&<p className="engine-hash">Контрольная сумма: {engine.hash}</p>}</div></details></footer>
    </>}
  </div>;
}

export default EngineViewer;

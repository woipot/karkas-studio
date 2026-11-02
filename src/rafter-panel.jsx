import React,{useId} from 'react';

const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const value=(...values)=>values.find(finite);
const section=id=>typeof id==='string'?id.replaceAll('x',' × '):id&&finite(id.b)&&finite(id.h)?`${id.b} × ${id.h}`:'—';

const styles=`
.rafter-panel{border:1px solid #dbe5ce;border-radius:8px;background:#fff;overflow:hidden;margin-top:14px;color:#80966a}
.rafter-panel-head{padding:17px 19px;background:#f4f8ec;border-bottom:1px solid #e0e8d5;display:flex;justify-content:space-between;gap:15px;align-items:center}
.rafter-panel-head span{font-size:8px;letter-spacing:1px;color:#a0b38c}.rafter-panel-head h3{font-size:17px;font-weight:500;margin:6px 0 0;color:#7e9b60}
.rafter-status{font-size:9px;line-height:1.6;color:#91aa78;max-width:190px;text-align:right}.rafter-status.fail{color:#b5815d}
.rafter-selection{padding:12px 19px;font-size:10px;line-height:1.8;background:#f8fbf3;border-bottom:1px solid #e4ecd9;color:#9ab084}.rafter-selection strong{font-weight:500;color:#87a269}.rafter-selection.changed{background:#f0f6e3}
.rafter-errors{padding:12px 19px;background:#fbf2e8;color:#b1815e;font-size:10px;line-height:1.7}
.rafter-diagram{display:block;width:100%;height:auto;min-height:220px;max-height:480px;background:#fbfcf8}.rafter-diagram text{font-family:inherit}
.rafter-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e4ecd9;border-top:1px solid #e4ecd9;border-bottom:1px solid #e4ecd9}.rafter-metrics>div{background:#f9fcf5;padding:14px 16px}.rafter-metrics span{display:block;font-size:8px;color:#a3b68f;line-height:1.5}.rafter-metrics strong{display:block;font-size:18px;font-weight:450;color:#87a568;margin-top:7px}.rafter-metrics small{font-size:9px;font-weight:400;color:#a6b991;margin-left:4px}
.rafter-checks{padding:17px 19px;display:grid;grid-template-columns:1fr 1fr;gap:16px 22px}.rafter-check>div:first-child{display:flex;justify-content:space-between;align-items:start;gap:10px}.rafter-check span{font-size:9px;line-height:1.6;color:#9bb085}.rafter-check strong{font-size:11px;font-weight:450;color:#87a366;white-space:nowrap}.rafter-check strong small{font-size:8px;font-weight:400;color:#acbc9a}.rafter-check.fail strong{color:#b77e59}.rafter-check>p{font-size:8px;line-height:1.7;color:#afbd9f;margin:6px 0 0}.rafter-check-bar{height:4px;background:#edf3e3;border-radius:2px;overflow:hidden;margin-top:8px}.rafter-check-bar i{display:block;height:4px;border-radius:2px;background:#adc98d}.rafter-check.fail i{background:#c5906a}
.rafter-summary{display:grid;grid-template-columns:1fr 1fr;gap:7px 20px;border-top:1px solid #e7eddf;padding:14px 19px;font-size:9px;line-height:1.7;color:#a5b698}.rafter-summary>div{display:flex;justify-content:space-between;gap:10px}.rafter-summary strong{font-size:10px;font-weight:450;color:#8da773;white-space:nowrap}
.rafter-notes{padding:13px 19px 17px;border-top:1px solid #e7eddf;background:#fbfcf8;font-size:9px;line-height:1.8;color:#a6b799}.rafter-notes p{margin:0 0 8px}.rafter-notes a{font-size:8px;color:#93ac7a;text-decoration:none;border-bottom:1px solid #d3dfc2;padding-bottom:2px}.rafter-notes details{margin-top:11px}.rafter-notes summary{cursor:pointer;color:#98af80}.rafter-empty{padding:25px 18px;text-align:center;font-size:11px;line-height:1.8;color:#a6b697;background:#f9fbf5;border:1px dashed #dbe6cd;border-radius:7px;margin-top:15px}
@media(max-width:1050px){.rafter-metrics{grid-template-columns:1fr 1fr}.rafter-checks{gap:15px}.rafter-panel-head{align-items:flex-start}}
@media(max-width:650px){.rafter-panel-head{padding:15px;flex-wrap:wrap}.rafter-panel-head h3{font-size:17px}.rafter-status{text-align:left;max-width:none;font-size:10px}.rafter-selection{padding:12px 15px;font-size:10px}.rafter-metrics>div{padding:12px}.rafter-metrics span,.rafter-check span,.rafter-summary,.rafter-notes{font-size:10px}.rafter-metrics strong{font-size:20px}.rafter-checks{grid-template-columns:1fr;padding:15px}.rafter-check strong{font-size:12px}.rafter-check strong small,.rafter-check>p,.rafter-notes a{font-size:9px}.rafter-summary{grid-template-columns:1fr;padding:14px 15px}.rafter-notes{padding:13px 15px 16px}.rafter-diagram{min-height:210px}}
`;

function BeamDiagram({analysis:a,zone}){
  const uid=useId().replaceAll(':','');
  const span=value(a.horizontalSpan,a.span),pitch=value(a.pitch,zone?.pitchLeft,0);
  const slopeLength=value(a.slopeLength,span/Math.cos(pitch*Math.PI/180));
  if(!finite(span)||span<=0||!finite(slopeLength))return null;
  const rise=Math.sqrt(Math.max(0,slopeLength*slopeLength-span*span));
  const scale=Math.min(690/span,155/Math.max(.05,rise)),width=span*scale;
  const ax=(930-width)/2,ay=265,bx=ax+width,by=ay-rise*scale;
  const at=t=>({x:ax+(bx-ax)*t,y:ay+(by-ay)*t});
  const q=value(a.loads?.verticalDesign,a.lineLoadDesign),qn=value(a.loads?.normalDesign);
  const ra=value(a.reactions?.verticalA),rb=value(a.reactions?.verticalB);
  const center=at(.5);
  return <svg className="rafter-diagram" viewBox="0 0 930 425" role="img" aria-label={`Балочная схема стропила ${fmt(a.b,0)} на ${fmt(a.h,0)} миллиметров. Горизонтальный пролёт ${fmt(span)} метра, длина по скату ${fmt(slopeLength)} метра. Две опоры, равномерная вертикальная нагрузка.`}>
    <defs><pattern id={`rafter-grid-${uid}`} width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#e8eedf" strokeWidth=".6"/></pattern><marker id={`rafter-load-${uid}`} markerWidth="6" markerHeight="6" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#8b9c78"/></marker><marker id={`rafter-reaction-${uid}`} markerWidth="6" markerHeight="6" viewBox="0 0 8 8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#6b8b57"/></marker></defs>
    <rect width="930" height="425" fill={`url(#rafter-grid-${uid})`}/>
    <text x="24" y="26" fontSize="10" letterSpacing="1.2" fill="#99ab88">БАЛКА НА ДВУХ ОПОРАХ · ВЕРТИКАЛЬНАЯ НАГРУЗКА</text>
    <text x="24" y="48" fontSize="12" fill="#8ba274">q = {fmt(q,3)} кН/м · q⊥ = {fmt(qn,3)} кН/м</text>
    <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#d6be94" strokeWidth="15" strokeLinecap="butt"/>
    <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#ad8d5d" strokeWidth="1" strokeDasharray="7 4"/>
    {[.07,.2,.33,.46,.59,.72,.85,.96].map(t=>{const p=at(t);return <path key={t} d={`M${p.x} ${p.y-49}v31`} stroke="#8b9c78" strokeWidth="1.3" fill="none" markerEnd={`url(#rafter-load-${uid})`}/>})}
    {[{x:ax,y:ay,label:'A',reaction:ra},{x:bx,y:by,label:'B',reaction:rb}].map((p,i)=><g key={p.label}>
      <path d={`M${p.x} ${p.y+9}l-10 17h20Z`} fill="#e5ecd9" stroke="#8a9e75" strokeWidth="1.2"/>
      {i===1&&<><circle cx={p.x-5} cy={p.y+30} r="2.5" fill="#8a9e75"/><circle cx={p.x+5} cy={p.y+30} r="2.5" fill="#8a9e75"/></>}
      <line x1={p.x-17} y1={p.y+(i===1?36:30)} x2={p.x+17} y2={p.y+(i===1?36:30)} stroke="#adba9b"/>
      <path d={`M${p.x} ${p.y+91}v-44`} stroke="#6b8b57" strokeWidth="1.5" markerEnd={`url(#rafter-reaction-${uid})`}/>
      <text x={p.x+(i?15:-15)} y={p.y+75} textAnchor={i?'start':'end'} fontSize="12" fill="#77955f">R{p.label} = {fmt(p.reaction)} кН</text>
      <text x={p.x+(i?13:-13)} y={p.y+7} textAnchor={i?'start':'end'} fontSize="11" fill="#879e70">{p.label}</text>
    </g>)}
    <text x={center.x} y={center.y+34} textAnchor="middle" fontSize="12" fill="#9a855f" transform={`rotate(${-pitch} ${center.x} ${center.y+34})`}>{fmt(a.b,0)} × {fmt(a.h,0)} мм · {fmt(slopeLength,3)} м по скату</text>
    <g stroke="#afbc9c" strokeWidth="1" fill="none"><path d={`M${ax} ${ay+110}V382M${bx} ${by+110}V382M${ax} 376H${bx}M${ax} 371v10M${bx} 371v10`}/></g>
    <text x="465" y="397" textAnchor="middle" fontSize="12" fill="#81986b">Горизонтальный пролёт {fmt(span,3)} м</text>
    <text x="24" y="416" fontSize="9" fill="#a7b599">Нагрузка на одну балку · опорные соединения и раскрепление проверяются отдельно</text>
  </svg>;
}

export default function RafterPanel({analysis,zone,requestedSection,selectedSection}){
  if(!analysis)return <div className="rafter-empty">Для выбранной зоны ещё нет балочной проверки. Проверьте размеры, нагрузки и геометрию опор.</div>;
  const a=analysis,checks=Array.isArray(a.checks)?a.checks:[];
  const actual=selectedSection??`${a.b}x${a.h}`;
  const requested=requestedSection??zone?.chordSection??actual;
  const changed=typeof actual==='string'&&typeof requested==='string'&&actual!==requested;
  const hasFail=a.status==='fail'||checks.some(c=>c.status==='fail');
  const ratio=value(a.deflectionRatio,300),reactionA=value(a.reactions?.verticalA),reactionB=value(a.reactions?.verticalB);
  return <section className="rafter-panel" aria-label="Расчёт стропильной балки"><style>{styles}</style>
    <header className="rafter-panel-head"><div><span>СТРОПИЛЬНЫЕ БАЛКИ · РАВНОМЕРНАЯ НАГРУЗКА</span><h3>Одна доска между двумя опорами</h3></div><div className={`rafter-status ${hasFail?'fail':''}`}>{hasFail?'Есть превышение заданного предела':'Частные проверки в заданных пределах'}</div></header>
    <div className={`rafter-selection ${changed?'changed':''}`}>{changed?<><strong>Автоподбор: {section(requested)} → {section(actual)} мм.</strong> В модели и раскрое используется выбранное сечение.</>:<><strong>Сечение в модели: {section(actual)} мм.</strong> Шаг {fmt(a.spacing??zone?.spacing)} м.</>}</div>
    {a.errors?.length>0&&<div className="rafter-errors" role="alert">{a.errors.join(' ')}</div>}
    <BeamDiagram analysis={a} zone={zone}/>
    <div className="rafter-metrics"><div><span>Горизонтальный пролёт</span><strong>{fmt(value(a.horizontalSpan,a.span))}<small>м</small></strong></div><div><span>Полная длина по скату</span><strong>{fmt(a.slopeLength,3)}<small>м</small></strong></div><div><span>Изгибающий момент Mmax</span><strong>{fmt(a.moment)}<small>кН·м</small></strong></div><div><span>Вертикальный прогиб</span><strong>{fmt(a.verticalDeflection)}<small>/ {fmt(a.deflectionAllowed)} мм</small></strong></div></div>
    <div className="rafter-checks">{checks.filter(c=>finite(c.value)||finite(c.utilization)).map((check,index)=>{
      const utilization=value(check.utilization,finite(check.limit)&&check.limit>0?check.value/check.limit:undefined);
      const fail=check.status==='fail'||utilization>1;
      return <div key={check.id??index} className={`rafter-check ${fail?'fail':''}`}><div><span>{check.label??check.name??check.id}</span><strong>{finite(check.value)?fmt(check.value):fmt(utilization*100)} <small>{finite(check.limit)?`/ ${fmt(check.limit)} ${check.unit??''}`:finite(utilization)?'%':''}</small></strong></div>{finite(utilization)&&<div className="rafter-check-bar"><i style={{width:`${Math.max(0,Math.min(100,utilization*100))}%`}}/></div>}{check.note&&<p>{check.note}</p>}</div>;
    })}</div>
    <div className="rafter-summary"><div><span>Реакция A / B · вертикально</span><strong>{fmt(reactionA)} / {fmt(reactionB)} кН</strong></div><div><span>Поперечная сила Vmax</span><strong>{fmt(a.shear)} кН</strong></div><div><span>Осевое усилие |N|max</span><strong>{fmt(a.axialMax)} кН</strong></div><div><span>Прогиб поперёк балки</span><strong>{fmt(a.normalDeflection)} мм</strong></div><div><span>Заданный предел Δv</span><strong>Пролёт / {fmt(ratio,0)}</strong></div><div><span>Предельный пролёт этой модели</span><strong>{fmt(a.maxSpan)} м</strong></div></div>
    <div className="rafter-notes"><p>Пролёт — горизонтальное расстояние между опорами. Длина доски считается по скату; предельный вертикальный прогиб сравнивается с горизонтальным пролётом / {fmt(ratio,0)}.</p><p>Проверка относится к заданным нагрузкам, шагу и свойствам древесины. Опирание на стену или опорный брус, крепёж и раскрепление остаются отдельными узлами.</p><a href="https://awc.org/resource-hub/span-table-tutorial/" target="_blank" rel="noreferrer">Принцип выбора стропил по пролёту, нагрузке и жёсткости: AWC ↗</a>
      {Array.isArray(a.assumptions)&&a.assumptions.length>0&&<details><summary>Допущения балочной проверки</summary>{a.assumptions.map((note,i)=><p key={i}>{note}</p>)}</details>}
    </div>
  </section>;
}

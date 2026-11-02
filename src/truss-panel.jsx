import React,{useId,useState} from 'react';

const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
const roles={top:'Верхний пояс',bottom:'Нижний пояс',web:'Решётка'};
const colors={tension:'#3474a3',compression:'#b77649',zero:'#a2aaa1'};
const loadMagnitude=l=>Math.abs(Number.isFinite(l.fyDesign)?l.fyDesign:Number.isFinite(l.design)?l.design:0);

/** Selects a bar by ID; the same nodes and bars can be used in the 3D view. */
export function TrussDiagram({truss,selected,onSelect}){
  const uid=useId().replaceAll(':',''),[localSelected,setLocalSelected]=useState(null),[numbers,setNumbers]=useState(true),[deformed,setDeformed]=useState(false);
  if(!truss)return <div className="unverified">Выберите схему фермы.</div>;
  const t=truss,selectedId=selected===undefined?localSelected:typeof selected==='string'?selected:selected?.id??null;
  const current=t.bars.find(b=>b.id===selectedId);
  const span=t.input?.span||Math.max(1,...t.nodes.map(n=>n.x)),rise=t.input?.rise||Math.max(1,...t.nodes.map(n=>n.y));
  const scale=Math.min(760/span,190/rise),originX=(960-span*scale)/2,baseline=285;
  const x=n=>originX+n.x*scale,y=n=>baseline-n.y*scale;
  const nodes=new Map(t.nodes.map(n=>[n.id,n])),movements=new Map(t.displacements.map(n=>[n.node,n]));
  const maxLoad=Math.max(.001,...(t.loads?.nodal||[]).map(loadMagnitude));
  const maxMovement=Math.max(.001,...t.displacements.map(d=>Math.hypot(d.x,d.y)));
  const deformationScale=Math.min(500,30/(maxMovement/1000*scale));
  const displaced=n=>{const u=movements.get(n.id);return {x:n.x+(u?.x||0)/1000*deformationScale,y:n.y+(u?.y||0)/1000*deformationScale};};
  const pick=id=>{setLocalSelected(id);onSelect?.(id);};
  const forceColor=b=>colors[b.forceType]||colors.zero;
  const buttonStyle=active=>({border:'1px solid '+(active?'#748a5a':'#dfe3d8'),background:active?'#edf2e4':'#fff',color:'#41503b',borderRadius:7,padding:'6px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'});
  return <div className="truss-diagram" style={{border:'1px solid #dfe4d6',borderRadius:12,overflow:'hidden',background:'#fbfcf8'}}>
    <div style={{padding:'15px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',borderBottom:'1px solid #e5e8df'}}>
      <div><div style={{fontSize:10,letterSpacing:1.5,color:'#7c876e',marginBottom:4}}>ФЕРМА / ПЛОСКАЯ РАСЧЁТНАЯ СХЕМА</div><strong style={{fontSize:17,fontWeight:500,color:'#34402d'}}>{t.name}</strong><span style={{fontSize:11,color:'#89927f',marginLeft:12}}>{t.nodes.length} узлов · {t.bars.length} стержней</span></div>
      <div style={{display:'flex',gap:6}}><button type="button" onClick={()=>setNumbers(!numbers)} aria-pressed={numbers} style={buttonStyle(numbers)}>Усилия</button><button type="button" onClick={()=>setDeformed(!deformed)} disabled={!t.stable} aria-pressed={deformed} style={buttonStyle(deformed)}>Деформация</button></div>
    </div>
    {t.errors?.length>0&&<div role="alert" style={{padding:'12px 18px',background:'#fff1e8',color:'#92502b',fontSize:12}}><strong>Расчёт не выполнен.</strong> {t.errors.join(' ')}</div>}
    {t.nodes.length>0&&<svg viewBox="0 0 960 425" style={{display:'block',width:'100%',height:'auto',minHeight:190}} role="group" aria-label={`Ферма ${t.name}. Пролёт ${fmt(span)} метров, подъём ${fmt(rise)} метров. Синим растяжение, охрой сжатие.`}>
      <defs>
        <pattern id={`grid-${uid}`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#e6ecdf" strokeWidth=".65"/></pattern>
        <marker id={`load-${uid}`} viewBox="0 0 8 8" markerWidth="6" markerHeight="6" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#798b66"/></marker>
        <marker id={`reaction-${uid}`} viewBox="0 0 8 8" markerWidth="6" markerHeight="6" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#647e53"/></marker>
      </defs>
      <rect x="0" y="0" width="960" height="425" fill={`url(#grid-${uid})`}/>
      <g fontFamily="inherit">
        {(t.loads.nodal||[]).filter(l=>nodes.get(l.node)?.y>0.01).map(l=>{const n=nodes.get(l.node),magnitude=loadMagnitude(l),height=18+20*magnitude/maxLoad;return <g key={l.node}><path d={`M${x(n)} ${y(n)-14-height}V${y(n)-11}`} stroke="#879a71" strokeWidth="1.3" markerEnd={`url(#load-${uid})`}/><text x={x(n)+8} y={y(n)-22-height} fill="#738165" fontSize="11">{fmt(magnitude)} кН</text></g>;})}
        {t.bars.map(b=>{const a=nodes.get(b.nodeA),z=nodes.get(b.nodeB);if(!a||!z)return null;const active=b.id===selectedId;return <g key={b.id} role="button" tabIndex={0} aria-label={`${b.id}, ${roles[b.role]}, ${fmt(b.force)} килоньютон, длина ${fmt(b.length)} метра`} onClick={()=>pick(b.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(b.id);}}} style={{cursor:'pointer'}}>
          <title>{`${b.id} · ${roles[b.role]}\n${b.b} × ${b.h} мм · ${fmt(b.length,3)} м\nN = ${fmt(b.force,3)} кН\nσ = ${fmt(b.stress,3)} МПа · ${fmt((b.utilization||0)*100,1)}%`}</title>
          <line x1={x(a)} y1={y(a)} x2={x(z)} y2={y(z)} stroke={active?'#e3c08d':'#ecdfc9'} strokeWidth={active?17:12} strokeLinecap="butt"/>
          <line x1={x(a)} y1={y(a)} x2={x(z)} y2={y(z)} stroke={forceColor(b)} strokeWidth={active?4.5:3} strokeLinecap="round"/>
          <line x1={x(a)} y1={y(a)} x2={x(z)} y2={y(z)} stroke="transparent" strokeWidth="22"/>
        </g>;})}
        {deformed&&t.stable&&<g opacity=".75">{t.bars.map(b=>{const a=displaced(nodes.get(b.nodeA)),z=displaced(nodes.get(b.nodeB));return <line key={b.id} x1={x(a)} y1={y(a)} x2={x(z)} y2={y(z)} stroke="#72954f" strokeWidth="1.8" strokeDasharray="5 3" pointerEvents="none"/>;})}<text x="25" y="25" fill="#698448" fontSize="11">Деформация × {fmt(deformationScale,0)} · мгновенная, без податливости узлов</text></g>}
        {numbers&&t.bars.map(b=>{const a=nodes.get(b.nodeA),z=nodes.get(b.nodeB),dx=x(z)-x(a),dy=y(z)-y(a),len=Math.hypot(dx,dy),direction=b.role==='bottom'?1:-1;const cx=(x(a)+x(z))/2+(len?(-dy/len)*12*direction:0),cy=(y(a)+y(z))/2+(len?(dx/len)*12*direction:0);return <text key={b.id} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight={b.id===selectedId?600:400} fill={forceColor(b)} stroke="#fbfcf8" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{b.id} · {b.force>=0?'+':''}{fmt(b.force,1)}</text>;})}
        {t.nodes.map(n=><g key={n.id} pointerEvents="none"><circle cx={x(n)} cy={y(n)} r="4" fill="#fff" stroke="#758169" strokeWidth="1.5"/><text x={x(n)+(n.id==='A'?-13:n.id==='B'?13:0)} y={y(n)+(n.y<.001?20:-11)} fontSize="11" fill="#687260" textAnchor="middle" stroke="#fbfcf8" strokeWidth="3" paintOrder="stroke">{n.id}</text></g>)}
        {['A','B'].map((id,i)=>{const n=nodes.get(id);if(!n)return null;const rx=x(n),ry=y(n);const r=t.reactions.find(r=>r.node===id);return <g key={id}>
          <path d={`M${rx} ${ry+5}l-10 16h20Z`} fill="#e3e9da" stroke="#80916e" strokeWidth="1.2"/>
          {i===1&&<><circle cx={rx-5} cy={ry+25} r="2.5" fill="#80916e"/><circle cx={rx+5} cy={ry+25} r="2.5" fill="#80916e"/></>}
          <line x1={rx-17} x2={rx+17} y1={ry+(i===1?30:24)} y2={ry+(i===1?30:24)} stroke="#9baa8b"/>
          {r&&<><path d={`M${rx} ${ry+66}v-27`} stroke="#718c5e" strokeWidth="1.5" markerEnd={`url(#reaction-${uid})`}/><text x={rx+(i===0?12:-12)} y={ry+61} textAnchor={i===0?'start':'end'} fontSize="11" fill="#657b53">R{String.fromCharCode(65+i)} = {fmt(r.y)} кН</text></>}
        </g>;})}
        <g stroke="#afba9e" strokeWidth="1" fill="none"><path d={`M${originX} 375H${originX+span*scale}M${originX} 370v10M${originX+span*scale} 370v10`}/><path d={`M${originX+span*scale+36} ${baseline}V${baseline-rise*scale}M${originX+span*scale+31} ${baseline}h10M${originX+span*scale+31} ${baseline-rise*scale}h10`}/></g>
        <text x="480" y="396" textAnchor="middle" fill="#6a765d" fontSize="12">Пролёт {fmt(span,3)} м</text>
        <text x={originX+span*scale+51} y={baseline-rise*scale/2} fill="#6a765d" fontSize="11" transform={`rotate(-90 ${originX+span*scale+51} ${baseline-rise*scale/2})`} textAnchor="middle">Подъём {fmt(rise,3)} м</text>
        <text x="23" y="415" fill="#97a08d" fontSize="10">N, кН · геометрия по осям · выберите стержень</text>
      </g>
    </svg>}
    <div style={{padding:'11px 18px',display:'flex',gap:18,flexWrap:'wrap',borderTop:'1px solid #e5e8df',fontSize:11,color:'#6c7860'}}><span><i style={{display:'inline-block',width:16,height:3,background:colors.tension,verticalAlign:'middle',marginRight:6}}/>+ растяжение</span><span><i style={{display:'inline-block',width:16,height:3,background:colors.compression,verticalAlign:'middle',marginRight:6}}/>− сжатие</span><span>Шарниры · EA/L · раскрепление из плоскости не подтверждено</span></div>
    {current&&<div style={{padding:'14px 18px',borderTop:'1px solid #e5e8df',background:'#f1f5ea',display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap',fontSize:12,color:'#4d5d40'}}>
      <strong>{current.id} · {roles[current.role]}</strong><span>{current.b} × {current.h} мм · {fmt(current.length,3)} м · {fmt(current.mass)} кг</span><span>N <b>{fmt(current.force)} кН</b> · σ {fmt(current.stress)} МПа</span><span style={{color:current.utilization>1?'#ae553b':'#65774c'}}>{fmt(current.utilization*100,1)}% расчётного лимита</span>
    </div>}
  </div>;
}

export default TrussDiagram;

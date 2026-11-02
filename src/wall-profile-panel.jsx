import React,{useMemo,useState} from 'react';

const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fmt=(n,d=2)=>finite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
const modes={continuous:'Цельные стойки',stacked:'Составная стена с узлом',blocked:'Переход к цельной стене ограничен'};
const section=s=>typeof s==='string'?s.replaceAll('x',' × '):s&&finite(s.b)&&finite(s.h)?`${s.b} × ${s.h}`:'—';

function profileTitle(profile,project){
  const index=project.walls.findIndex(w=>w.id===profile.wallId),level=profile.level??1;
  const name=project.levels?.find(l=>l.index===level)?.name??`${level} этаж`;
  return `Стена ${index>=0?index+1:profile.wallId} · ${name}`;
}

function wallBoards(profile,result){
  return (result.timber?.instances??[]).filter(board=>
    board.category==='walls'&&(board.wallId===profile.wallId||board.wallIds?.includes(profile.wallId))&&
    (board.level??board.floor??1)===(profile.level??1)&&Array.isArray(board.start)&&Array.isArray(board.end));
}

function WallProfileDrawing({profile,wall,boards,check}){
  const [highlight,setHighlight]=useState(true),[showSeam,setShowSeam]=useState(true);
  if(!wall)return null;
  const length=Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y);
  if(length<.01)return null;
  const direction={x:(wall.b.x-wall.a.x)/length,y:(wall.b.y-wall.a.y)/length};
  const base=profile.baseY??0,low=profile.lowTop??base,high=profile.highTop??low;
  const maxHeight=Math.max(.5,high-base,...boards.flatMap(b=>[b.start[1]-base,b.end[1]-base]));
  const scale=Math.min(580/length,205/maxHeight),width=length*scale,ox=(820-width)/2,oy=286;
  const x=s=>ox+s*scale,y=height=>oy-(height-base)*scale;
  const along=p=>(p[0]-wall.a.x)*direction.x+(p[2]-wall.a.y)*direction.y;
  const samples=(profile.topSamples??[]).map(q=>Array.isArray(q)?{s:q[0],top:q[1]}:{s:q.s??q.distance??(finite(q.t)?q.t*length:undefined),top:q.topY??q.top}).filter(q=>finite(q.s)&&finite(q.top)).sort((a,b)=>a.s-b.s);
  const exact=samples.length>=2;
  const outline=exact?samples:[{s:0,top:high},{s:length,top:high}];
  const maxStud=profile.studMaxLength??check?.maxStudLength??check?.worst?.length;
  const tooLong=profile.stockFits===false||check?.stockFits===false||maxStud>6+1e-7;
  const worstId=check?.worst?.id;
  return <div className="wall-profile-graphic"><div className="wall-profile-graphic-head"><span>ПРОФИЛЬ ПО ФАКТИЧЕСКИМ ДОСКАМ</span><div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{profile.mode==='stacked'&&finite(profile.seamY)&&<button aria-pressed={showSeam} onClick={()=>setShowSeam(!showSeam)}>{showSeam?'Скрыть':'Показать'} узел</button>}<button aria-pressed={highlight} disabled={!worstId} onClick={()=>setHighlight(!highlight)}>{highlight?'Выделена':'Выделить'} критическая стойка</button></div></div>
    <svg viewBox="0 0 820 350" role="img" aria-label={`${modes[profile.mode]??profile.mode}. Высота стены ${fmt(low-base)}–${fmt(high-base)} метра, самая длинная стойка ${fmt(maxStud)} метра.`}>
      <defs><pattern id="wall-profile-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#e7eedf" strokeWidth=".6"/></pattern></defs>
      <rect width="820" height="350" fill="#fafcf6"/><rect width="820" height="350" fill="url(#wall-profile-grid)"/>
      <polygon points={`${x(0)},${y(base)} ${outline.map(q=>`${x(q.s)},${y(q.top)}`).join(' ')} ${x(length)},${y(base)}`} fill="#f2f6e9" stroke="#c8d6b7" strokeWidth="1.2" strokeDasharray={exact?undefined:'5 4'}/>
      {boards.map(board=>{const a={s:along(board.start),top:board.start[1]},b={s:along(board.end),top:board.end[1]};const active=highlight&&board.id===worstId;
        return <line key={board.id} x1={x(a.s)} y1={y(a.top)} x2={x(b.s)} y2={y(b.top)} stroke={active?(check?.utilization>1?'#bc7e58':'#8dae5e'):'#c5a574'} strokeWidth={Math.max(1.4,(board.b??50)/1000*scale)+(active?1.2:0)} strokeLinecap="butt"><title>{`${board.id} · ${board.name}\n${board.b} × ${board.h} мм · ${fmt(board.length,3)} м`}</title></line>;
      })}
      {profile.mode==='stacked'&&finite(profile.seamY)&&showSeam&&<g><line x1={x(0)-8} y1={y(profile.seamY)} x2={x(length)+8} y2={y(profile.seamY)} stroke="#bb8f5e" strokeWidth="1.3" strokeDasharray="6 4"/><text x={x(length)-6} y={y(profile.seamY)-8} textAnchor="end" fill="#b08d60" fontSize="10">Узел составной стены</text></g>}
      <line x1={x(0)-20} y1={y(base)+8} x2={x(length)+20} y2={y(base)+8} stroke="#a7b897" strokeWidth="2"/>
      <g stroke="#acba9b" strokeWidth="1" fill="none"><path d={`M${x(0)} 306H${x(length)}M${x(0)} 301v10M${x(length)} 301v10`}/><path d={`M${x(0)-32} ${y(base)}V${y(high)}M${x(0)-37} ${y(base)}h10M${x(0)-37} ${y(high)}h10`}/></g>
      <text x="410" y="327" textAnchor="middle" fontSize="11" fill="#8a9e75">Длина стены {fmt(length)} м</text>
      <text x={x(0)-44} y={(y(base)+y(high))/2} transform={`rotate(-90 ${x(0)-44} ${(y(base)+y(high))/2})`} textAnchor="middle" fontSize="11" fill="#8a9e75">До {fmt(high-base)} м</text>
      <text x="18" y="22" fontSize="9" letterSpacing="1" fill="#9db18a">{profile.mode==='continuous'?'ЦЕЛЬНЫЕ СТОЙКИ В МОДЕЛИ':profile.mode==='stacked'?'СОСТАВНОЙ УЗЕЛ ТРЕБУЕТ ПРОВЕРКИ':'ПОКАЗАНА ТЕКУЩАЯ ГЕОМЕТРИЯ'}</text>
      <text x="802" y="22" textAnchor="end" fontSize="10" fill={tooLong?'#b9845e':'#9caf86'}>Макс. стойка {fmt(maxStud,3)} / 6 м</text>
      {!exact&&<text x="18" y="341" fontSize="8" fill="#acb99e">Пунктир — диапазон высот. Направление скоса не задано в профиле.</text>}
      {boards.length===0&&<text x="410" y="205" textAnchor="middle" fontSize="11" fill="#a2b48e">Для этого профиля доски ещё не сформированы</text>}
    </svg>
  </div>;
}

const css=`
.wall-profile-panel{border:1px solid #dbe6cc;border-radius:8px;background:#fff;margin:22px 0;overflow:hidden;color:#8aa16f}.wall-profile-panel-head{display:flex;justify-content:space-between;align-items:start;gap:19px;padding:19px;border-bottom:1px solid #e4ecd8;background:#f8fbf3}.wall-profile-panel-head h3{font-size:17px;font-weight:500;color:#809d60;margin:0 0 8px}.wall-profile-panel-head p{font-size:9px;line-height:1.8;color:#a5b695;margin:0;max-width:460px}.wall-profile-mode{width:230px;flex-shrink:0}.wall-profile-mode>span{font-size:8px;color:#a4b692;display:block;margin-bottom:7px}.wall-profile-mode select{width:100%;border:1px solid #dce7ce;border-radius:5px;padding:9px;background:#fff;font-size:10px;color:#8aa66b}.wall-profile-list{display:flex;gap:7px;padding:14px 19px 0;overflow:auto}.wall-profile-list button{border:1px solid #e0e9d4;background:#fbfdf7;border-radius:5px;padding:9px 10px;font-size:9px;text-align:left;min-width:150px;color:#9db387}.wall-profile-list button.active{border-color:#bfd3a4;background:#eff6e2;color:#87a268}.wall-profile-list small{display:block;font-size:7px;color:#b0bfa0;margin-top:5px}.wall-profile-info{padding:14px 19px;display:flex;justify-content:space-between;gap:16px;align-items:start}.wall-profile-info strong{font-size:13px;font-weight:500;color:#88a469}.wall-profile-info p{font-size:9px;color:#a4b595;line-height:1.8;margin:6px 0 0;max-width:650px}.wall-profile-tag{font-size:8px;color:#a0b789;border:1px solid #dfe9d3;background:#f5f9ee;border-radius:4px;padding:5px 7px;white-space:nowrap}.wall-profile-tag.fail{color:#b38860;background:#fcf4e7;border-color:#e9d8b8}.wall-profile-graphic{margin:0 19px 16px;border:1px solid #e0e9d4;border-radius:6px;overflow:hidden}.wall-profile-graphic-head{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid #e7eddf;background:#fbfdf7;align-items:center}.wall-profile-graphic-head>span{font-size:7px;letter-spacing:1px;color:#a5b893}.wall-profile-graphic-head button{font-size:8px;color:#98b27c;padding:4px 6px;border:1px solid #e3ecd8;border-radius:4px}.wall-profile-graphic svg{display:block;width:100%;height:auto;max-height:360px}.wall-profile-graphic text{font-family:inherit}.wall-profile-metrics{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #e4ecd9;border-bottom:1px solid #e4ecd9;background:#e5eddc;gap:1px}.wall-profile-metrics>div{padding:13px 16px;background:#f9fcf5}.wall-profile-metrics span{font-size:8px;color:#a4b792;display:block;line-height:1.6}.wall-profile-metrics strong{font-size:19px;font-weight:450;color:#8aa66d;display:block;margin-top:7px}.wall-profile-metrics strong small{font-size:9px;font-weight:400;margin-left:4px;color:#a6b992}.wall-profile-checks{display:grid;grid-template-columns:1fr 1fr;gap:15px 21px;padding:17px 19px}.wall-profile-check{font-size:9px;line-height:1.7;color:#a0b58c}.wall-profile-check>div:first-child{display:flex;justify-content:space-between;gap:10px}.wall-profile-check strong{font-size:10px;font-weight:450;white-space:nowrap;color:#8ca66e}.wall-profile-check.fail strong{color:#b5865f}.wall-profile-check>small{display:block;font-size:8px;color:#b0bea2;margin-top:5px}.wall-profile-bar{height:4px;border-radius:3px;background:#edf3e4;overflow:hidden;margin-top:7px}.wall-profile-bar i{height:4px;display:block;background:#afc98f;border-radius:3px}.wall-profile-check.fail i{background:#c39168}.wall-profile-stock-warning{padding:12px 19px;background:#fcf4e7;color:#b68c61;font-size:10px;line-height:1.8;border-bottom:1px solid #eddfc7}.wall-profile-notes{padding:13px 19px;border-top:1px solid #e6edde;font-size:9px;color:#a8b799;line-height:1.8;background:#fbfcf8}.wall-profile-notes p{margin:0 0 8px}.wall-profile-notes details{margin-top:8px}.wall-profile-notes summary{cursor:pointer;color:#9ab181}.wall-profile-empty{padding:22px 19px;font-size:10px;line-height:1.8;color:#a5b797}@media(max-width:1150px){.wall-profile-panel-head{flex-wrap:wrap}.wall-profile-mode{width:100%;max-width:350px}.wall-profile-metrics{grid-template-columns:1fr 1fr}}@media(max-width:650px){.wall-profile-panel-head,.wall-profile-info{padding:16px}.wall-profile-panel-head h3{font-size:17px}.wall-profile-panel-head p,.wall-profile-info p,.wall-profile-mode>span,.wall-profile-notes{font-size:10px}.wall-profile-mode select,.wall-profile-list button{font-size:11px}.wall-profile-list{padding:12px 16px 0}.wall-profile-list small,.wall-profile-tag{font-size:9px}.wall-profile-info{flex-wrap:wrap}.wall-profile-graphic{margin:0 12px 14px}.wall-profile-graphic-head{flex-wrap:wrap}.wall-profile-graphic-head>span,.wall-profile-graphic-head button{font-size:9px}.wall-profile-metrics span,.wall-profile-check{font-size:10px}.wall-profile-checks{grid-template-columns:1fr;padding:16px}.wall-profile-check strong{font-size:11px}.wall-profile-check>small{font-size:9px}}
`;

export default function WallProfilePanel({project,result,roofModel,onModeChange}){
  const [picked,setPicked]=useState(null);
  const profiles=roofModel?.wallProfiles??[];
  const profile=profiles.find(p=>`${p.wallId}:${p.level??1}`===picked)??profiles[0];
  const check=result.fullHeightWalls?.walls?.find(w=>w.wallId===profile?.wallId&&(w.level??1)===(profile?.level??1));
  const wall=project.walls.find(w=>w.id===profile?.wallId);
  const boards=useMemo(()=>profile?wallBoards(profile,result):[],[profile,result]);
  const minHeight=profile?(profile.lowTop-profile.baseY):undefined,maxHeight=profile?(profile.highTop-profile.baseY):undefined;
  const maxLength=profile?.studMaxLength??check?.maxStudLength??check?.worst?.length;
  const stockFits=profile?.stockFits??check?.stockFits??(finite(maxLength)?maxLength<=6+1e-7:undefined);
  const checks=check?.checks??[],fails=checks.some(c=>c.status==='fail')||profile?.mode==='blocked';
  const tallStudCount=Array.isArray(check?.studs)?check.studs.length:boards.filter(b=>Math.abs(b.end[1]-b.start[1])>.1&&Math.hypot(b.end[0]-b.start[0],b.end[2]-b.start[2])<.02).length;
  return <section className="wall-profile-panel" aria-label="Стены под односкатной кровлей"><style>{css}</style>
    <header className="wall-profile-panel-head"><div><h3>Стены под односкатной кровлей</h3><p>Высокая стена и скошенные боковые стены формируются по отметкам ската. Выберите способ устройства стоек и проверьте их фактические длины.</p></div><label className="wall-profile-mode"><span>Способ устройства стены</span><select aria-label="Стены под односкатной кровлей" value={project.roof.wallFraming??'auto'} onChange={e=>onModeChange?.(e.target.value)}><option value="auto">Авто · цельные при расчёте</option><option value="continuous">Цельные стойки</option><option value="stacked">Составная стена с узлом</option></select></label></header>
    {!profiles.length?<div className="wall-profile-empty">Профили появятся у стен, которые примыкают к односкатным кровельным зонам.</div>:<>
      <div className="wall-profile-list">{profiles.map(p=>{const key=`${p.wallId}:${p.level??1}`;return <button key={key} className={p===profile?'active':''} onClick={()=>setPicked(key)}>{profileTitle(p,project)}<small>{modes[p.mode]??p.mode} · {section(p.section)} мм</small></button>})}</div>
      <div className="wall-profile-info"><div><strong>{modes[profile.mode]??profile.mode}</strong><p>{profile.reason}</p></div><span className={`wall-profile-tag ${fails||stockFits===false?'fail':''}`}>{profile.mode==='stacked'?'Узел не подтверждён':fails?'Есть ограничение или превышение':check?.capacityPass?'Частные проверки в пределах':'Проверки требуют уточнения'}</span></div>
      {stockFits===false&&<div className="wall-profile-stock-warning">Самая длинная стойка {fmt(maxLength,3)} м выходит за шестиметровую заготовку. Цельная стойка этого профиля требует изменения решения; продольное наращивание не считается автоматически равноценной заменой.</div>}
      <WallProfileDrawing profile={profile} wall={wall} boards={boards} check={check}/>
      <div className="wall-profile-metrics"><div><span>Высота до верха каркаса</span><strong>{fmt(minHeight)}–{fmt(maxHeight)}<small>м</small></strong></div><div><span>Самая длинная стойка</span><strong>{fmt(maxLength,3)}<small>/ 6 м</small></strong></div><div><span>Сечение стоек</span><strong>{section(profile.section??check?.section)}<small>мм</small></strong></div><div><span>Стоек в проверке</span><strong>{tallStudCount}<small>шт.</small></strong></div></div>
      {checks.length>0&&<div className="wall-profile-checks">{checks.map((c,i)=>{const u=finite(c.utilization)?c.utilization:finite(c.value)&&finite(c.limit)&&c.limit>0?c.value/c.limit:undefined;return <div className={`wall-profile-check ${c.status==='fail'||u>1?'fail':''}`} key={c.id??i}><div><span>{c.label??c.name}</span>{finite(c.value)&&<strong>{fmt(c.value)}{finite(c.limit)?` / ${fmt(c.limit)}`:''} {c.unit??''}</strong>}</div>{finite(u)&&<div className="wall-profile-bar"><i style={{width:`${Math.max(0,Math.min(100,u*100))}%`}}/></div>}{c.note&&<small>{c.note}</small>}</div>})}</div>}
    </>}
    <div className="wall-profile-notes"><p>Цельная высокая стойка проверяется по полной высоте и фактическому раскреплению. В составном варианте горизонтальный узел, крепёж и передача усилий рассматриваются отдельно.</p><p>Сортимент — 6 м. Длины и выбранная схема передаются в ведомость и раскрой; цвет результата относится к перечисленным частным проверкам.</p>{result.fullHeightWalls?.assumptions?.length>0&&<details><summary>Допущения проверки высоких стен</summary>{result.fullHeightWalls.assumptions.map((text,i)=><p key={i}>{text}</p>)}</details>}</div>
  </section>;
}

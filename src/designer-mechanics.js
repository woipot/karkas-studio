/** Preliminary member checks for Designer. No hidden stiffness credit for splices. */
const sum=a=>a.reduce((s,x)=>s+x,0);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const dist=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const section=s=>{const m=typeof s==='string'&&s.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/);return m?{b:+m[1],h:+m[2]}:null;};
const safeStatus=u=>u>1?'fail':'pass';

/** Join physical stock pieces back into their original straight logical member. */
export function logicalMembers(instances,role){
  const groups=new Map();
  for(const b of instances.filter(b=>b.role===role&&Array.isArray(b.start)&&Array.isArray(b.end))){
    const id=b.memberId??b.id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(b);
  }
  return [...groups].map(([id,parts])=>{
    const first=parts.find(b=>dist(b.start,b.end)>1e-8)||parts[0],L=dist(first.start,first.end),u=first.end.map((x,i)=>(x-first.start[i])/L);
    const points=parts.flatMap(b=>[b.start,b.end]),projections=points.map(p=>sum(p.map((x,i)=>(x-first.start[i])*u[i]))),min=Math.min(...projections),max=Math.max(...projections);
    return {id,parts,start:first.start.map((x,i)=>x+u[i]*min),end:first.start.map((x,i)=>x+u[i]*max),length:max-min,b:first.b,h:first.h,mass:sum(parts.map(b=>b.mass??0)),spliced:parts.length>1,wallId:first.wallId,floor:first.floor};
  });
}

export function checkDesignerMembers(p,r){
  const assumptions=[
    'Частные проверки элементов — предварительные модели, не нормативный расчёт дома. Пространственная устойчивость, крепёж, ростверк, грунт и передача усилий через реальные узлы не подтверждены.',
    'Балки: каждая логическая длина объединяет ВСЕ физические части с одинаковым memberId. Шестиметровая заготовка или стык не создаёт опору и не уменьшает расчётный пролёт. Линии реальных несущих стен разделяют пролёты в геометрическом ядре.',
    'Балки — шарнирно опёртые, равномерно нагруженные. Вес слоёв и фактической древесины перекрытия плюс полезная нагрузка; изгиб qL²/8, прогиб 5qL⁴/(384EI), предел полного мгновенного прогиба L/300, сдвиг 1,5V/A. Ползучесть, вибрации, местная нагрузка и LTB не проверены.',
    'Стойка — представительная консервативная оценка: крыша, верхние перекрытия и стены сведены к двум линиям по короткой стороне габаритного прямоугольника. Грузовая ширина учитывает половину соседнего проёма. Фактические усилия каждого простенка и перемычек не определены.',
    'Сжатие стойки: минимум введённого Fc×A и идеального Euler по двум осям. Без явно заданного studRestraint слабая ось имеет полную длину стойки; несущая обшивка автоматически не предполагается. Несовершенства, эксцентриситет и совместный изгиб не учтены.',
    'X-связи: в каждом направлении работает одна растянутая диагональ; сжатая диагональ показана диагностически, её сопротивление не засчитывается. Сила ветра поделена максимум на две имеющиеся параллельные наружные стены; жёсткость диафрагм, узлов и анкеров не проверена.',
    'Древесина из единой ведомости учитывается в весе перекрытия. В расчёте балки используется полное номинальное сечение идеального неразрезного элемента; наращивание не подтверждает ни передачу силы, ни жёсткость этого элемента.',
  ];
  const modernBracing=r.bracingModel;
  if(modernBracing){const i=assumptions.findIndex(a=>a.startsWith('X-'));if(i>=0)assumptions.splice(i,1);}
  const checks=[],instances=r?.timber?.instances??[],area=r?.geometry?.area,F=p.floors??1,E=p.material?.E,Fb=p.material?.Fb,Ft=p.material?.Ft,Fc=p.material?.Fc,Fv=p.material?.Fv??1.5,K=p.material?.columnK??1;
  if(![E,Fb,Ft,Fc,Fv,K].every(x=>finite(x)&&x>0)||(p.material.studRestraint!==undefined&&(!finite(p.material.studRestraint)||p.material.studRestraint<=0))||!finite(p.loads?.gammaG)||!finite(p.loads?.gammaQ))return {joist:null,stud:null,bracing:null,checks:[{id:'memberInputs',label:'Материал и коэффициенты элементов',status:'unverified',note:'Нужны положительные E, Fb, Ft, Fc, Fv, K и заданная длина раскрепления.'}],assumptions,status:'unverified'};
  const gammaG=p.loads.gammaG,gammaQ=p.loads.gammaQ,wallMap=new Map((p.walls??[]).map(w=>[w.id,w]));
  const hasArea=finite(area)&&area>0;
  const levels=r?.geometry?.levels??[],netFloorArea=finite(r?.geometry?.totalFloorArea)?r.geometry.totalFloorArea:area*F;
  const floorWoodPressure=hasArea&&netFloorArea>0?(r.timber?.totals?.floor?.weight??0)/netFloorArea:0;
  const spacing=p.floor?.spacing??.6;
  const lineService=((p.loads.floorDead??0)+floorWoodPressure+(p.loads.live??0))*spacing;
  const lineDesign=(((p.loads.floorDead??0)+floorWoodPressure)*gammaG+(p.loads.live??0)*gammaQ)*spacing;
  const joists=hasArea?logicalMembers(instances,'joist').filter(m=>m.length>0&&m.b>0&&m.h>0).map(m=>{
    const I=m.b*m.h**3/12,Z=m.b*m.h**2/6,L=m.length*1000,M=lineDesign*m.length**2/8,V=lineDesign*m.length/2;
    const stress=M*1e6/Z,deflection=5*lineService*L**4/(384*E*I),deflectionAllowed=L/300,shearStress=1.5*V*1000/(m.b*m.h);
    const bendingUtilization=stress/Fb,deflectionUtilization=deflection/deflectionAllowed,shearUtilization=shearStress/Fv;
    const maxSpanBending=lineDesign>0?Math.sqrt(8*Fb*Z/(lineDesign*1e6)):Infinity;
    const maxSpanDeflection=lineService>0?Math.cbrt(384*E*I/(5*lineService*300))/1000:Infinity;
    const maxSpanShear=lineDesign>0?2*Fv*m.b*m.h/(1.5*lineDesign)/1000:Infinity;
    const utilization=Math.max(bendingUtilization,deflectionUtilization,shearUtilization);
    return {...m,span:m.length,I,Z,lineLoadService:lineService,lineLoadDesign:lineDesign,moment:M,shear:V,stress,deflection,deflectionAllowed,shearStress,bendingUtilization,deflectionUtilization,shearUtilization,maxSpanBending,maxSpanDeflection,maxSpanShear,maxSpan:Math.min(maxSpanBending,maxSpanDeflection,maxSpanShear),utilization,status:safeStatus(utilization)};
  }):[];
  const worstJoist=joists.length?joists.reduce((a,b)=>a.utilization>b.utilization?a:b):null;
  const joist=worstJoist?{...worstJoist,members:joists,logicalCount:joists.length,stockPieces:joists.reduce((s,m)=>s+m.parts.length,0),floorWoodPressure,note:'Расчётная длина — полный логический пролёт; стыки не являются опорами.'}:null;
  if(joist)checks.push(
    {id:'designerJoistBending',label:'Балки: изгиб худшего пролёта',value:joist.stress,limit:Fb,unit:'МПа',utilization:joist.bendingUtilization,status:safeStatus(joist.bendingUtilization)},
    {id:'designerJoistDeflection',label:'Балки: мгновенный прогиб',value:joist.deflection,limit:joist.deflectionAllowed,unit:'мм',utilization:joist.deflectionUtilization,status:safeStatus(joist.deflectionUtilization)},
    {id:'designerJoistShear',label:'Балки: сдвиг',value:joist.shearStress,limit:Fv,unit:'МПа',utilization:joist.shearUtilization,status:safeStatus(joist.shearUtilization)},
  );
  else checks.push({id:'designerJoists',label:'Балки перекрытия',status:'unverified',note:'Нет замкнутой площади или сформированных балок.'});
  const measuredWalls=(r.fullHeightWalls?.walls??[]).filter(w=>w.mode==='continuous'&&w.studs?.length),measuredIds=new Set(measuredWalls.map(w=>w.wallId));
  const bearingWalls=(p.walls??[]).filter(w=>w.kind!=='partition'&&!measuredIds.has(w.id)),bounds=r?.geometry?.bounds??{};
  const supportLength=Math.min(bounds.width??0,bounds.height??0);
  let stud=null;
  if(hasArea&&r.loads&&supportLength>0&&bearingWalls.length){
    const roofDesign=(r.loads.roofWeight??0)*gammaG+(r.loads.snow??0)*gammaQ;
    const upperArea=levels.length?sum(levels.slice(1).map(l=>l.closed?(l.netFloorArea??l.area??0):0)):area*Math.max(0,F-1);
    const upperFloor=upperArea*(((p.loads.floorDead??0)+floorWoodPressure)*gammaG+(p.loads.live??0)*gammaQ);
    const wallLayers=(r.loads.rows??[]).filter(row=>['wall-layers','inner-layers','openings','walls-layers','wallLayers','opening-layers','openings-layers'].includes(row.id)).reduce((s,row)=>s+(row.characteristic??0),0);
    const wallWeight=(r.timber?.totals?.walls?.weight??0)+(r.timber?.totals?.bracing?.weight??0)+wallLayers;
    const line=(roofDesign+upperFloor+wallWeight*gammaG)/(2*supportLength);
    const studs=bearingWalls.map(w=>{
      const profile=r.geometry?.wallProfiles?.find(q=>q.wallId===w.id&&q.mode==='continuous'),sec=section(profile?.section??w.section);if(!sec)return null;
      const A=sec.b*sec.h,Iweak=sec.h*sec.b**3/12,Istrong=sec.b*sec.h**3/12,length=profile?profile.studMaxLength:Math.max(p.height,...levels.map(l=>l.height??p.height))-3*sec.b/1000;
      const restraint=!profile&&finite(p.material.studRestraint)&&p.material.studRestraint>0?p.material.studRestraint:length;
      const weakLength=Math.min(length,restraint),openings=(p.openings??[]).filter(o=>o.wallId===w.id);
      const tributaryWidth=Math.max(w.studStep??.6,...openings.map(o=>o.width/2+(w.studStep??.6))),force=line*tributaryWidth;
      const eulerWeak=Math.PI**2*E*Iweak/(K*weakLength*1000)**2/1000,eulerStrong=Math.PI**2*E*Istrong/(K*length*1000)**2/1000,euler=Math.min(eulerWeak,eulerStrong),crushing=Fc*A/1000,capacity=Math.min(euler,crushing);
      return {wallId:w.id,b:sec.b,h:sec.h,area:A,length,unbracedLength:weakLength,strongLength:length,K,force,stress:force*1000/A,Iweak,Istrong,eulerWeak,eulerStrong,euler,crushing,capacity,tributaryWidth,shortening:force*1000*length*1000/(E*A),maxUnbracedLength:force>0?Math.PI*Math.sqrt(E*Iweak/(force*1000))/K/1000:Infinity,utilization:force/capacity,status:force>capacity?'fail':'warning'};
    }).filter(Boolean);
    if(studs.length)stud={...studs.reduce((a,b)=>a.utilization>b.utilization?a:b),walls:studs,equivalentLineLoad:line,supportLength,note:'Представительная стойка по консервативной эквивалентной погонной нагрузке, а не решение каждого простенка.'};
  }
  if(measuredWalls.length){const actual=measuredWalls.flatMap(w=>w.studs.map(s=>({...s,wallId:w.wallId,area:s.A,capacity:s.force>=0?s.compressionCapacity:s.tensionCapacity,stress:s.force*1000/s.A,unbracedLength:s.length,strongLength:s.length,shortening:s.force*1000*s.length*1000/(E*s.A),utilization:Math.max(s.compressionUtilization,s.tensionUtilization),status:s.compressionUtilization>1||s.tensionUtilization>1?'fail':'unverified',measured:true}))),worst=actual.reduce((a,b)=>a.utilization>b.utilization?a:b);if(!stud||worst.utilization>stud.utilization)stud={...worst,walls:actual,note:'Фактическая стойка полной высоты, реакция кровли и собственный вес стены. Распределение по габаритному прямоугольнику для неё не применяется.'};}
  if(stud)checks.push({id:'designerStudCompression',label:stud.measured?'Фактическая цельная стойка: сжатие / Euler':'Представительная стойка: сжатие / Euler',value:stud.force,limit:stud.capacity,unit:'кН',utilization:stud.utilization,status:stud.status});
  else checks.push({id:'designerStuds',label:'Сжатие стоек',status:'unverified',note:'Путь вертикальной нагрузки не задан для открытой или неполной модели.'});
  const floorT=(section(p.floor?.section)?.h??250)/1000+.035,facadeH=(levels.length?sum(levels.map(l=>l.height??p.height)):F*p.height)+Math.max(0,F-1)*floorT;
  const forceX=hasArea?(p.loads.wind??0)*(bounds.height??0)*facadeH:0,forceY=hasArea?(p.loads.wind??0)*(bounds.width??0)*facadeH:0;
  const bays=modernBracing?[]:hasArea?(r.timber?.braceBays??[]).filter(b=>b.available&&wallMap.get(b.wallId)?.kind==='exterior'):[];
  const braceMembers=logicalMembers(instances,'brace');
  const braced=bays.map(bay=>{
    const w=wallMap.get(bay.wallId),len=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),ux=(w.b.x-w.a.x)/len,uy=(w.b.y-w.a.y)/len;
    const parallelCount=bays.filter(q=>q.floor===bay.floor).filter(q=>{const v=wallMap.get(q.wallId),vl=Math.hypot(v.b.x-v.a.x,v.b.y-v.a.y);return Math.abs(ux*(v.b.x-v.a.x)/vl+uy*(v.b.y-v.a.y)/vl)>.99;}).length;
    const share=Math.max(1,Math.min(2,parallelCount)),accumulation=(F-(bay.floor??1)+1)/F;
    const shear=Math.max(forceX*Math.abs(ux),forceY*Math.abs(uy))*gammaQ*accumulation/share;
    const board=braceMembers.find(m=>m.wallId===bay.wallId&&m.floor===bay.floor),b=board?.b??25,h=board?.h??100,length=board?.length??bay.length;
    const cosine=bay.width/length,force=shear/cosine,A=b*h,Imin=Math.max(b,h)*Math.min(b,h)**3/12,euler=Math.PI**2*E*Imin/(length*1000)**2/1000;
    const tensionCapacity=Ft*A/1000,compressionCapacity=Math.min(Fc*A/1000,euler),extension=force*1000*length*1000/(E*A);
    return {...bay,b,h,length,force,shear,area:A,stress:force*1000/A,extension,drift:extension/cosine,euler,tensionCapacity,compressionCapacity,tensionUtilization:force/tensionCapacity,compressionUtilization:force/compressionCapacity,maxCompressionLength:force>0?Math.PI*Math.sqrt(E*Imin/(force*1000))/1000:Infinity};
  }).filter(b=>finite(b.force)&&finite(b.length)&&b.length>0);
  const tension=braced.length?braced.reduce((a,b)=>a.tensionUtilization>b.tensionUtilization?a:b):null;
  const compression=braced.length?braced.reduce((a,b)=>a.compressionUtilization>b.compressionUtilization?a:b):null;
  const missing=(r.timber?.braceBays??[]).filter(b=>!b.available&&wallMap.get(b.wallId)?.kind==='exterior');
  const bracing={bays:braced,tension,compression,missing,windForceX:forceX,windForceY:forceY,status:tension?.tensionUtilization>1?'fail':'unverified',note:'Работа растянутой диагонали; крепёж, диафрагмы, анкеры и устойчивость из плоскости не подтверждены.'};
  if(tension)checks.push({id:'designerBraceTension',label:'Укосина: осевое растяжение',value:tension.stress,limit:Ft,unit:'МПа',utilization:tension.tensionUtilization,status:safeStatus(tension.tensionUtilization)});
  checks.push({id:'designerMemberSystem',label:'Стыки, местные узлы и пространственная работа',status:'unverified',note:'Частные проверки не подтверждают передачу усилий через физические стыки, опорные узлы и диафрагмы.'});
  if(levels.some(l=>(l.voidArea??0)>0)){checks.push({id:'designerVoidLoadPath',label:'Обрамление второго света и проёмов перекрытия',status:'unverified',note:'Обрезка балки у проёма не подтверждает её опирание. Несущая способность обрамления, подвесов и передача нагрузки на соседние балки требуют отдельной модели.'});assumptions.push('Средний вес древесины перекрытия делится на фактическую сумму netFloorArea всех этажей. Для второго света пролёты обрезанных балок показаны геометрически; опирание на обрамление и усиление проёмов не подтверждены.');}
  if(levels.length>1)assumptions.push('Этажи имеют независимую геометрию. Представительная стойка использует суммарную площадь верхних перекрытий и максимальную высоту стен, но не рассчитывает каждый вертикальный путь нагрузки между несовпадающими этажами.');
  return {joist,stud,bracing:modernBracing?{...modernBracing,tension:null,compression:null,missing:[],bays:[]}:bracing,checks,assumptions,status:checks.some(c=>c.status==='fail')?'fail':'unverified'};
}

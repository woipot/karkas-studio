/** Board-built grillage. Plan: x/y m; timber XYZ: x/up/plan-y m; b/h: mm. */
const EPS=1e-7, STOCK=6, STAGGER=.4064, G=9.80665;
const finite=Number.isFinite, sum=a=>a.reduce((s,v)=>s+v,0);
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const dot=(a,b)=>a.x*b.x+a.y*b.y, cross=(a,b)=>a.x*b.y-a.y*b.x;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const at=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const point=q=>q&&finite(q.x)&&finite(q.y);
const key=q=>`${Math.round(q.x*1e7)}:${Math.round(q.y*1e7)}`;
const unique=a=>a.sort((a,b)=>a-b).filter((x,i,s)=>!i||x-s[i-1]>EPS);
const section=s=>{const m=typeof s==='string'&&s.replaceAll(' ','').match(/^(\d+)[x×](\d+)$/);return m?{b:+m[1],h:+m[2]}:null;};
function onSegment(q,a,b){const u=sub(b,a),L=distance(a,b);if(L<EPS)return distance(q,a)<EPS;const t=dot(sub(q,a),u)/(L*L);return t>=-EPS&&t<=1+EPS&&Math.abs(cross(sub(q,a),u))/L<EPS;}
function inside(q,p){if(p.some((a,i)=>onSegment(q,a,p[(i+1)%p.length])))return true;let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function hit(a,b,c,d){const u=sub(b,a),v=sub(d,c),ca=sub(c,a),den=cross(u,v);if(Math.abs(den)<EPS)return null;const t=cross(ca,v)/den,s=cross(ca,u)/den;return t>=-EPS&&t<=1+EPS&&s>=-EPS&&s<=1+EPS?{t:Math.max(0,Math.min(1,t)),s:Math.max(0,Math.min(1,s)),point:at(a,b,Math.max(0,Math.min(1,t)))}:null;}
function clipSegment(a,b,polygon){
  const cuts=[0,1],u=sub(b,a),L2=dot(u,u);
  for(let i=0;i<polygon.length;i++){const c=polygon[i],d=polygon[(i+1)%polygon.length],h=hit(a,b,c,d);if(h)cuts.push(h.t);else if(Math.abs(cross(sub(c,a),u))<EPS*Math.sqrt(L2)){for(const q of [c,d]){const t=dot(sub(q,a),u)/L2;if(t>0&&t<1)cuts.push(t);}}}
  const s=unique(cuts),out=[];for(let i=1;i<s.length;i++)if(s[i]-s[i-1]>EPS&&inside(at(a,b,(s[i]+s[i-1])/2),polygon))out.push([at(a,b,s[i-1]),at(a,b,s[i])]);return out;
}
function mergeLines(lines){
  const groups=[];
  for(const line of lines){let {a,b}=line,L=distance(a,b);if(L<EPS)continue;let u={x:(b.x-a.x)/L,y:(b.y-a.y)/L};if(u.x<-EPS||(Math.abs(u.x)<EPS&&u.y<0)){[a,b]=[b,a];u={x:-u.x,y:-u.y};}
    const offset=cross(u,a);let group=groups.find(g=>Math.abs(cross(g.u,u))<EPS&&Math.abs(g.offset-offset)<EPS);if(!group){group={u,offset,intervals:[]};groups.push(group);}group.intervals.push({lo:dot(a,u),hi:dot(b,u),sources:[line.source],wallIds:line.wallId?[line.wallId]:[],kinds:[line.kind]});
  }
  const merged=[];
  for(const g of groups){const s=g.intervals.sort((a,b)=>a.lo-b.lo),runs=[];for(const x of s){const prev=runs.at(-1);if(prev&&x.lo<=prev.hi+EPS){prev.hi=Math.max(prev.hi,x.hi);prev.sources.push(...x.sources);prev.wallIds.push(...x.wallIds);prev.kinds.push(...x.kinds);}else runs.push({...x,sources:[...x.sources],wallIds:[...x.wallIds],kinds:[...x.kinds]});}
    for(const r of runs){const v={x:-g.u.y,y:g.u.x},pos=t=>({x:g.u.x*t+v.x*g.offset,y:g.u.y*t+v.y*g.offset});merged.push({a:pos(r.lo),b:pos(r.hi),u:g.u,v,length:r.hi-r.lo,sources:[...new Set(r.sources)],wallIds:[...new Set(r.wallIds)],kinds:[...new Set(r.kinds)],kind:r.kinds.includes('perimeter')?'perimeter':r.kinds.includes('bearing')?'bearing':'floorSupport'});}
  }
  return merged.sort((a,b)=>a.a.x-b.a.x||a.a.y-b.a.y||a.b.x-b.b.x||a.b.y-b.b.y);
}

export const grillageSources=[
  {title:'AWC · Connections and supported end joints of built-up beams',url:'https://awc.org/faq/what-are-the-connection-requirements-for-built-up-beams/'},
  {title:'AWC · Beam load tables and equal load per ply',url:'https://awc.org/faq/how-do-i-use-the-beam-load-tables-in-wsdd/'},
  {title:'AWC · LRFD Manual, simple-span instantaneous deflection',url:'https://web-media.awc.org/wp-content/uploads/2021/12/17210520/AWC-LRFD2005-Manual-1007.pdf'},
];

/** Independent UDL benchmark. Does not include the package's self weight: supply it in q. */
export function checkGrillageSpan(input={}){
  const {length,b,h,plies=3,E,Fb,Fv=1.5,deflectionRatio=300,designLineLoad,serviceLineLoad}=input;
  const values={length,b,h,plies,E,Fb,Fv,deflectionRatio,designLineLoad,serviceLineLoad},errors=[];
  for(const [k,v]of Object.entries(values))if(!finite(v)||(k.endsWith('LineLoad')?v<0:v<=0))errors.push(`${k}: требуется ${k.endsWith('LineLoad')?'неотрицательное':'положительное'} конечное число.`);
  if(!Number.isInteger(plies))errors.push('plies: целое число слоёв.');
  if(errors.length)return {status:'fail',capacityPass:false,errors,checks:[{id:'grillage-input',label:'Исходные данные пролёта',status:'fail',note:errors.join(' ')}]};
  const L=length*1000,A=plies*b*h,I=plies*b*h**3/12,W=I/(h/2),M=designLineLoad*L*L/8,V=designLineLoad*L/2;
  const bending=M/W,shear=1.5*V/A,deflection=5*serviceLineLoad*L**4/(384*E*I),allowed=L/deflectionRatio;
  const utilization={bending:bending/Fb,shear:shear/Fv,deflection:deflection/allowed};
  const maxSpanByMode={bending:designLineLoad>0?Math.sqrt(8*Fb*W/designLineLoad)/1000:null,shear:designLineLoad>0?2*Fv*A/(1.5*designLineLoad)/1000:null,deflection:serviceLineLoad>0?Math.cbrt(384*E*I/(5*serviceLineLoad*deflectionRatio))/1000:null};
  const checks=[['bending','Изгиб',bending,Fb,'МПа'],['shear','Поперечный сдвиг',shear,Fv,'МПа'],['deflection','Мгновенный прогиб',deflection,allowed,'мм']].map(([id,label,value,limit,unit])=>({id:`grillage-${id}`,label,value,limit,unit,utilization:utilization[id],status:value<=limit+EPS?'pass':'fail'}));
  const capacityPass=checks.every(c=>c.status==='pass');
  checks.push({id:'grillage-ply-connections',label:'Слои, оголовки и раскрепление',status:'unverified',note:'Равная нагрузка по слоям принята условно. Крепёж пакета, опирание, смятие поперёк волокон и боковая устойчивость не проверены.'});
  return {length,b,h,plies,E,Fb,Fv,deflectionRatio,loads:{designLineLoad,serviceLineLoad},section:{b,h,plies,width:plies*b,A,I,W},I,W,M:M/1e6,V:V/1000,moment:M/1e6,shearForce:V/1000,stress:{bending,shear},deflection:{value:deflection,allowed,ratio:deflection>0?L/deflection:null},reactions:{designA:V/1000,designB:V/1000,serviceA:serviceLineLoad*length/2,serviceB:serviceLineLoad*length/2},utilization,maxUtilization:Math.max(...Object.values(utilization)),maxSpan:Math.min(...Object.values(maxSpanByMode).filter(finite),Infinity)===Infinity?null:Math.min(...Object.values(maxSpanByMode).filter(finite)),maxSpanByMode,capacityPass,checks,status:capacityPass?'unverified':'fail',assumptions:['Шарнирный пролёт между центрами опор, постоянная вертикальная распределённая нагрузка по всей длине. Это не модель неразрезной балки.','I = n·b·h³/12 и W = I/(h/2). Каждая доска работает на ребро; ширина пакета не возводится в куб и клеёный монолит не предполагается.','q в кН/м численно равно Н/мм; E, Fb, Fv заданы пользователем в МПа. Собственный вес добавляет вызывающий код один раз.','Прогиб мгновенный от serviceLineLoad, без ползучести, влажностных поправок и осадки свай. L/ratio — выбранный пользователем критерий, не полная нормативная проверка.'],sources:grillageSources};
}

/** Geometry only. Pile reactions and actual loads are deliberately allocated by the caller. */
export function buildGrillage(project={}, {geometry={},walls=project.walls??[]}={}){
  const options={section:'50x200',plies:3,deflectionRatio:300,capSize:250,...project.foundation?.grillage},sec=section(options.section),spacing=project.foundation?.spacing??2,girderSpacing=options.girderSpacing??spacing,density=project.material?.density??500;
  const out={instances:[],beams:[],spans:[],piles:[],joints:[],checks:[],warnings:[],assumptions:[],sources:grillageSources,pileHeadY:.72,beamBottomY:.72,topY:sec?.h? .72+sec.h/1000:.72,section:options.section,plies:options.plies,capSize:options.capSize,stockLength:STOCK,quantities:{boardCount:0,beamCount:0,spanCount:0,pileCount:0,spliceCount:0,totalBeamLength:0,boardLength:0,volume:0,mass:0,weight:0,maxSpan:0},status:'unverified'};
  const check=(id,label,status,note,extra={})=>out.checks.push({id,label,status,note,...extra});
  if(!sec||sec.b<15||sec.b>300||sec.h<sec.b||sec.h>600)check('grillage-section','Сечение доски ростверка','fail','Сечение b×h в мм: 15≤b≤300, b≤h≤600.');
  for(const [k,v,lo,hi]of [['spacing',spacing,.5,6],['girderSpacing',girderSpacing,.5,6],['plies',options.plies,1,8],['capSize',options.capSize,50,1500],['deflectionRatio',options.deflectionRatio,100,1000],['density',density,100,1500]])if(!finite(v)||v<lo||v>hi)check('grillage-'+k,'Параметры ростверка','fail',`${k}: число от ${lo} до ${hi}.`);
  if(!Number.isInteger(options.plies))check('grillage-plies-integer','Количество досок в пакете','fail','Количество слоёв должно быть целым.');
  if(out.checks.some(c=>c.status==='fail')){out.status='fail';return out;}
  const polygon=geometry.levels?.find(l=>l.index===1)?.polygon??geometry.polygon??[];
  if(geometry.closed===false||polygon.length<3||polygon.length>1000||!polygon.every(point)){check('grillage-footprint','Замкнутый контур основания','unverified','Для построения ростверка нужен корректный замкнутый полигон первого этажа.');return out;}
  const signedArea=sum(polygon.map((q,i)=>cross(q,polygon[(i+1)%polygon.length])))/2;
  if(Math.abs(signedArea)<EPS){check('grillage-footprint-area','Площадь контура основания','fail','Площадь замкнутого контура должна быть положительной.');out.status='fail';return out;}
  const width=sec.b*options.plies/1000,half=width/2,cap=options.capSize/1000,bounds={minX:Math.min(...polygon.map(q=>q.x)),maxX:Math.max(...polygon.map(q=>q.x)),minY:Math.min(...polygon.map(q=>q.y)),maxY:Math.max(...polygon.map(q=>q.y))};
  out.width=width;
  if(width>cap+EPS)check('grillage-cap-width','Ширина пакета на оголовке','fail','Пакет шире оголовка; полное прямое опирание всех досок не обеспечено.',{value:width*1000,limit:options.capSize,unit:'мм'});
  if(width>=girderSpacing-EPS)check('grillage-package-spacing','Ширина пакета и шаг линий','fail','Ширина пакета не должна поглощать заданный шаг опорных линий. Увеличьте шаг или измените сечение/число досок.');
  const lines=[];
  for(let i=0;i<polygon.length;i++)lines.push({a:polygon[i],b:polygon[(i+1)%polygon.length],kind:'perimeter',source:`perimeter-${i+1}`});
  for(const w of walls.filter(w=>w?.kind==='bearing'&&(w.level===undefined||w.level===1)&&point(w.a)&&point(w.b)))for(const [a,b]of clipSegment(w.a,w.b,polygon))lines.push({a,b,kind:'bearing',source:w.id,wallId:w.id});
  const joistAxis=project.floor?.axis??'y',range=joistAxis==='x'?bounds.maxX-bounds.minX:bounds.maxY-bounds.minY,n=Math.max(1,Math.ceil(range/girderSpacing));
  for(let i=1;i<n;i++){const f=(joistAxis==='x'?bounds.minX:bounds.minY)+range*i/n,a=joistAxis==='x'?{x:f,y:bounds.minY}:{x:bounds.minX,y:f},b=joistAxis==='x'?{x:f,y:bounds.maxY}:{x:bounds.maxX,y:f};for(const [c,d]of clipSegment(a,b,polygon))lines.push({a:c,b:d,kind:'floorSupport',source:`floor-line-${i}`});}
  const beams=mergeLines(lines).map((beam,i)=>({...beam,id:`GB${String(i+1).padStart(3,'0')}`,section:{b:sec.b,h:sec.h,plies:options.plies},bMM:sec.b,hMM:sec.h,plies:options.plies,width,stations:[],_critical:[0,beam.length]}));
  if(beams.length>2000){check('grillage-complexity','Размер модели ростверка','fail','Слишком много отдельных линий ростверка.');out.status='fail';return out;}
  for(let i=0;i<beams.length;i++)for(let j=i+1;j<beams.length;j++){const a=beams[i],b=beams[j],h=hit(a.a,a.b,b.a,b.b);if(h){a._critical.push(h.t*a.length);b._critical.push(h.s*b.length);}}
  // Leave room for physical corner extensions while never requiring an unsupported 6 m splice.
  const maxStep=Math.min(spacing,STOCK-width),pileMap=new Map();
  const getPile=q=>{const k=key(q);if(!pileMap.has(k))pileMap.set(k,{x:q.x,y:q.y,capTopY:out.pileHeadY,headY:out.pileHeadY,capSize:options.capSize,beamIds:[],stationRefs:[]});return pileMap.get(k);};
  for(const beam of beams){const critical=unique(beam._critical),stations=[];for(let i=1;i<critical.length;i++){const a=critical[i-1],b=critical[i],count=Math.max(1,Math.ceil((b-a)/maxStep));for(let j=0;j<count;j++)stations.push(a+(b-a)*j/count);}stations.push(beam.length);
    for(const s of unique(stations)){const q=at(beam.a,beam.b,s/beam.length),pile=getPile(q),kind=critical.some(c=>Math.abs(c-s)<EPS)?'node':maxStep<spacing-EPS?'stockSupport':'spacing';const row={station:s,point:q,kind,_pile:pile};beam.stations.push(row);pile.beamIds.push(beam.id);pile.stationRefs.push({beamId:beam.id,station:s});}
  }
  out.piles=[...pileMap.values()].sort((a,b)=>a.x-b.x||a.y-b.y);out.piles.forEach((p,i)=>{p.id=`P${String(i+1).padStart(4,'0')}`;p.beamIds=[...new Set(p.beamIds)];});
  const pilesById=new Map(out.piles.map(p=>[p.id,p]));
  for(const beam of beams)for(const s of beam.stations){s.pileId=s._pile.id;delete s._pile;}
  const byId=new Map(beams.map(b=>[b.id,b])),nodeRules=new Map();
  for(const pile of out.piles){const refs=pile.stationRefs.map(r=>({...r,beam:byId.get(r.beamId)}));if(refs.length<2)continue;
    const score=r=>(r.station>EPS&&r.station<r.beam.length-EPS?100:0)+(r.beam.kind==='perimeter'?10:0)+Math.abs(r.beam.u.x);
    refs.sort((a,b)=>score(b)-score(a)||a.beam.id.localeCompare(b.beam.id));const primary=refs[0];
    for(const r of refs){let trim=0;if(r!==primary){for(const other of refs.filter(o=>o!==r)){const sin=Math.abs(cross(r.beam.u,other.beam.u)),cos=Math.abs(dot(r.beam.u,other.beam.u));if(sin>EPS)trim=Math.max(trim,half*(1+cos)/sin);}}
      nodeRules.set(`${pile.id}/${r.beam.id}`,{primary:r===primary,trim,extension:r===primary?half:0,pile});
    }
    const orthogonal=refs.every(r=>r===primary||Math.abs(dot(r.beam.u,primary.beam.u))<EPS);
    out.joints.push({id:`GJ-${pile.id}`,type:'node',scheme:'butt',pileId:pile.id,point:{x:pile.x,y:pile.y},position:[pile.x,out.pileHeadY+sec.h/2000,pile.y],beamIds:refs.map(r=>r.beam.id),primaryBeamId:primary.beam.id,supported:true,connectionVerified:false,orthogonal});
    if(!orthogonal)check(`grillage-node-${pile.id}`,'Неортогональный узел ростверка','unverified','Пакеты физически разведены торцевой подрезкой. Узел под произвольным углом и его опирание требуют отдельной деталировки.');
  }
  for(const beam of beams){
    for(let i=1;i<beam.stations.length;i++){const a=beam.stations[i-1],b=beam.stations[i];out.spans.push({id:`${beam.id}-S${String(i).padStart(3,'0')}`,beamId:beam.id,start:{...a.point},end:{...b.point},startPileId:a.pileId,endPileId:b.pileId,stationStart:a.station,stationEnd:b.station,length:b.station-a.station,b:sec.b,h:sec.h,plies:options.plies});}
    const breaks=beam.stations.map((s,i)=>({s,i,rule:nodeRules.get(`${s.pileId}/${beam.id}`)})).filter(q=>q.i===0||q.i===beam.stations.length-1||q.rule&&!q.rule.primary),priorByRun=[];
    for(let ply=0;ply<options.plies;ply++)for(let r=1;r<breaks.length;r++){
      const A=breaks[r-1],Z=breaks[r],from=A.s.station+(A.rule?(A.rule.primary?-A.rule.extension:A.rule.trim):0),to=Z.s.station-(Z.rule?(Z.rule.primary?-Z.rule.extension:Z.rule.trim):0);
      if(to-from<EPS){check(`grillage-short-${beam.id}-${r}`,'Подрезки узла поглощают участок балки','fail','Физический пакет не помещается между узлами; нужны другие опоры или специальный узел.');continue;}
      const supports=beam.stations.slice(A.i,Z.i+1),coords=supports.map((s,i)=>i===0?from:i===supports.length-1?to:s.station),prev=priorByRun[r]??[],cost=Array(supports.length).fill(Infinity),next=Array(supports.length).fill(null);cost[cost.length-1]=0;
      for(let i=supports.length-2;i>=0;i--)for(let j=i+1;j<supports.length;j++){const length=coords[j]-coords[i];if(length<=EPS||length>STOCK+EPS)continue;const splice=j<supports.length-1,staggerPenalty=splice&&prev.some(s=>Math.abs(s-supports[j].station)<STAGGER-EPS)?1000:0,value=1+staggerPenalty+.0001*(STOCK-length)**2+cost[j];if(value<cost[i]-EPS){cost[i]=value;next[i]=j;}}
      if(next[0]===null){check(`grillage-stock-${beam.id}-${r}-${ply}`,'Стыки досок на опорах','fail','Не удалось разбить участок на доски до6м со стыками только на существующих сваях.');continue;}
      const thisSplices=[];let i=0,part=0,lastSplice=null;
      while(i<supports.length-1){const j=next[i],s0=coords[i],s1=coords[j],length=s1-s0,offset=(ply-(options.plies-1)/2)*sec.b/1000,position=s=>[beam.a.x+beam.u.x*s+beam.v.x*offset,out.pileHeadY+sec.h/2000,beam.a.y+beam.u.y*s+beam.v.y*offset],a=position(s0),z=position(s1),id=`G-${beam.id}-L${ply+1}-R${r}-B${++part}`,volume=sec.b*sec.h*length/1e6;
        const board={id,name:'Доска пакета ростверка',category:'foundation',role:'grillagePly',beamId:beam.id,plyIndex:ply,floor:1,level:1,b:sec.b,h:sec.h,length,cutLength:length,volume,mass:volume*density,start:a,end:z,crossAxis:[beam.v.x,0,beam.v.y],requireSingleStock:true,memberId:id,stationStart:s0,stationEnd:s1,supportStationStart:supports[i].station,supportStationEnd:supports[j].station,startPileId:supports[i].pileId,endPileId:supports[j].pileId,cutStart:{scheme:'butt',angle:0},cutEnd:{scheme:'butt',angle:0},connectionVerified:false};out.instances.push(board);
        if(lastSplice)lastSplice.boardIds.push(id);
        for(const [p,which,support]of [[a,'start',supports[i]],[z,'end',supports[j]]]){const pile=pilesById.get(support.pileId),dx=p[0]-pile.x,dz=p[2]-pile.y,extent=Math.max(Math.abs(dx+beam.v.x*sec.b/2000),Math.abs(dx-beam.v.x*sec.b/2000),Math.abs(dz+beam.v.y*sec.b/2000),Math.abs(dz-beam.v.y*sec.b/2000));if(extent>cap/2+EPS)check(`grillage-bearing-${id}-${which}`,'Физический торец доски на оголовке','fail','Торец выходит за оголовок после разведения пакетов. Нужен больший оголовок или специально рассчитанный узел.',{value:extent*1000,limit:cap*500,unit:'мм'});}
        if(j<supports.length-1){const station=supports[j].station,near=prev.length?Math.min(...prev.map(s=>Math.abs(s-station))):null,staggered=near===null||near>=STAGGER-EPS;lastSplice={id:`GS-${beam.id}-L${ply+1}-R${r}-${thisSplices.length+1}`,type:'splice',scheme:'butt',beamId:beam.id,plyIndex:ply,runIndex:r,pileId:supports[j].pileId,station,point:{...supports[j].point},position:z,boardId:id,boardIds:[id],supported:true,connectionVerified:false,staggered,adjacentPlyJointDistance:near};out.joints.push(lastSplice);thisSplices.push(station);if(!staggered)out.warnings.push(`${beam.id}: стыки соседних слоёв ближе406мм; доступные опоры не позволяют принятую разбежку.`);}
        i=j;
      }
      priorByRun[r]=thisSplices;
    }
    delete beam._critical;
  }
  out.beams=beams;
  const q=out.quantities;q.boardCount=out.instances.length;q.beamCount=beams.length;q.spanCount=out.spans.length;q.pileCount=out.piles.length;q.spliceCount=out.joints.filter(j=>j.type==='splice').length;q.totalBeamLength=sum(beams.map(b=>b.length));q.boardLength=sum(out.instances.map(b=>b.length));q.volume=sum(out.instances.map(b=>b.volume));q.mass=sum(out.instances.map(b=>b.mass));q.weight=q.mass*G/1000;q.maxSpan=Math.max(0,...out.spans.map(s=>s.length));q.packageWidth=width;q.footprintArea=Math.abs(signedArea);
  check('grillage-spacing','Пролёты между сваями','pass','Опоры расположены на концах, пересечениях и вдоль реальных линий ростверка.',{value:q.maxSpan,limit:spacing,unit:'м'});
  check('grillage-stock-length','Цельные доски до6м','pass','Продольные торцевые стыки каждой доски расположены только над выбранными сваями.',{value:Math.max(0,...out.instances.map(b=>b.cutLength)),limit:STOCK,unit:'м'});
  check('grillage-connections','Соединения пакета и оголовки','unverified','Крепёж слоёв, одинаковая передача нагрузки на каждую доску, анкеровка, смятие, боковое раскрепление и узлы на свайных оголовках требуют расчёта.');
  out.assumptions=['Ростверк сформирован по контуру и несущим стенам первого этажа. Внутренние опорные линии перпендикулярны направлению лаг и обрезаны реальным полигоном основания. Сваи без балки над ними не создаются.','Все ламели находятся рядом на ребре, нижняя грань=.72м, верхняя=.72м+h. Плоские координаты стен являются осями; ширина пакета закономерно выступает по обе стороны оси контура.','Топологические пролёты идут между центрами свай. Физические торцы могут быть подрезаны или выпущены внутри оголовка, поэтому stationStart/End доски могут отличаться от supportStationStart/End.','В ортогональных T/X-узлах главная линия проходит над опорой, поперечная прерывается у грани пакета. В углу один пакет выпускается, другой упирается в его грань. Это торцевое опирание на оголовок без двойного объёма, не непоказанный half-lap.','Доски не длиннее6м, любые продольные стыки только на сваях. Разбежка соседних слоёв выбирается на существующих опорах, при необходимости с дополнительной короткой доской; невозможность406мм разбежки отмечается.','AWC/WCD1 использован как первичный ориентир для расположения стыков на опорах и соседних слоёв. Крепёж не копируется как универсальный рецепт и нормативное соответствие проекта не заявляется.','Нагрузки, реакции, грунт и несущая способность свай не рассчитываются этим геометрическим модулем. Шарнирные span-опоры задают явную концептуальную схему для вызывающего расчёта.'];
  out.warnings=[...new Set(out.warnings)];out.status=out.checks.some(c=>c.status==='fail')?'fail':'unverified';return out;
}

/** Vertical load path through a concept grillage. kN, m, MPa, mm.
 * Each support interval is a simply supported beam; continuity, differential
 * settlement, torsion and ply connections are intentionally not implied.
 */
const EPS=1e-8;
const sum=xs=>xs.reduce((s,n)=>s+n,0);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function solveGrillagePointLoads({length:L,b,h,plies,E,Fb,Fv=1.5,deflectionRatio=300,loads=[]}){
  if(!(L>0&&b>0&&h>0&&plies>0&&E>0&&Fb>0&&Fv>0))throw new Error('Некорректные параметры пролёта ростверка.');
  if(!Number.isFinite(deflectionRatio)||deflectionRatio<=0||![L,b,h,plies,E,Fb,Fv].every(Number.isFinite)||loads.some(q=>![q.at,q.design??q.characteristic??0,q.characteristic??q.service??0].every(Number.isFinite)||(q.design??q.characteristic??0)<0||(q.characteristic??q.service??0)<0))throw new Error('Требуются конечные неотрицательные нагрузки и положительные параметры.');
  const P=loads.map(q=>({at:clamp(q.at,0,L),design:q.design??q.characteristic??0,service:q.characteristic??q.service??0}));
  const reactionStart=sum(P.map(q=>q.design*(L-q.at)/L)),reactionEnd=sum(P.map(q=>q.design*q.at/L));
  const serviceStart=sum(P.map(q=>q.service*(L-q.at)/L)),serviceEnd=sum(P.map(q=>q.service*q.at/L));
  const I=plies*b*h**3/12,W=plies*b*h**2/6,A=plies*b*h;
  const moment=x=>reactionStart*x-sum(P.map(q=>q.design*Math.max(0,x-q.at)));
  const candidates=[0,L,...P.map(q=>q.at)],maxMoment=Math.max(...candidates.map(moment),0),maxShear=Math.max(0,reactionStart-sum(P.filter(q=>q.at<EPS).map(q=>q.design)),reactionEnd-sum(P.filter(q=>L-q.at<EPS).map(q=>q.design)));
  // Macaulay integration: EI*y = R*x³/6 - sum(P*<x-a>³)/6 + C*x.
  const C=(sum(P.map(q=>q.service*(L-q.at)**3))-serviceStart*L**3)/(6*L);
  const EI=E*1000*(I/1e12); // kN m²
  const displacement=x=>(serviceStart*x**3/6-sum(P.map(q=>q.service*Math.max(0,x-q.at)**3))/6+C*x)/EI*1000;
  const xs=[...new Set(candidates)].sort((a,b)=>a-b),positions=[...xs];
  for(let i=1;i<xs.length;i++){
    const left=xs[i-1],right=xs[i],mid=(left+right)/2,active=P.filter(q=>q.at<mid);
    const aa=(serviceStart-sum(active.map(q=>q.service)))/2,bb=sum(active.map(q=>q.service*q.at)),cc=C-sum(active.map(q=>q.service*q.at*q.at))/2;
    const roots=[];
    if(Math.abs(aa)<EPS){if(Math.abs(bb)>EPS)roots.push(-cc/bb);}else{
      const D=bb*bb-4*aa*cc;if(D>=-EPS){const d=Math.sqrt(Math.max(0,D));roots.push((-bb+d)/(2*aa),(-bb-d)/(2*aa));}
    }
    for(const x of roots)if(x>=left-EPS&&x<=right+EPS)positions.push(clamp(x,0,L));
  }
  const deflection=Math.max(0,...positions.map(x=>Math.abs(displacement(x)))),deflectionLimit=L*1000/deflectionRatio;
  const bendingStress=maxMoment*1e6/W,shearStress=1.5*maxShear*1000/A;
  const utilization=Math.max(bendingStress/Fb,shearStress/Fv,deflection/deflectionLimit);
  return {reactionStart,reactionEnd,serviceStart,serviceEnd,designTotal:reactionStart+reactionEnd,serviceTotal:serviceStart+serviceEnd,maxMoment,maxShear,I,W,A,bendingStress,shearStress,deflection,deflectionLimit,utilization,status:utilization>1+EPS?'fail':'pass',partial:true,method:'Шарнирный пролёт, фактические сосредоточенные нагрузки; сумма I отдельных досок при равномерной передаче нагрузки на слои.'};
}

export function analyzeGrillageLoads(p,model,samples=[]){
  const spans=model.spans.map(s=>({...s,pointLoads:[]})),piles=model.piles.map(q=>({...q,reaction:0,reactionCharacteristic:0,tributaryArea:0})),byId=new Map(piles.map(q=>[q.id,q]));
  let unassignedDesign=0,unassignedCharacteristic=0,maxProjectionDistance=0;
  for(const source of samples){
    const q=source.point,candidates=[];let best=Infinity;
    for(let i=0;i<spans.length;i++){
      const s=spans[i];if(source.beamId&&source.beamId!==s.beamId)continue;
      const dx=s.end.x-s.start.x,dy=s.end.y-s.start.y,len2=dx*dx+dy*dy;
      const t=clamp(((q.x-s.start.x)*dx+(q.y-s.start.y)*dy)/len2,0,1),distance=Math.hypot(q.x-s.start.x-t*dx,q.y-s.start.y-t*dy);
      if(distance<best-1e-6){best=distance;candidates.length=0;candidates.push({i,t});}else if(Math.abs(distance-best)<1e-6)candidates.push({i,t});
    }
    if(!candidates.length){unassignedDesign+=source.design;unassignedCharacteristic+=source.characteristic;continue;}
    maxProjectionDistance=Math.max(maxProjectionDistance,best);
    for(const hit of candidates)spans[hit.i].pointLoads.push({at:hit.t*spans[hit.i].length,design:source.design/candidates.length,characteristic:source.characteristic/candidates.length,area:(source.area??0)/candidates.length});
  }
  const g=p.foundation.grillage,sec=g.section.split(/[x×]/).map(Number),loadChecks=[];
  for(const span of spans){
    const check=solveGrillagePointLoads({length:span.length,b:sec[0],h:sec[1],plies:g.plies,E:p.material.E,Fb:p.material.Fb,Fv:p.material.Fv??1.5,deflectionRatio:g.deflectionRatio,loads:span.pointLoads});
    Object.assign(span,{designTotal:check.designTotal,serviceTotal:check.serviceTotal,reactionStart:check.reactionStart,reactionEnd:check.reactionEnd,check});
    const a=byId.get(span.startPileId),b=byId.get(span.endPileId);
    if(a){a.reaction+=check.reactionStart;a.reactionCharacteristic+=check.serviceStart;}
    if(b){b.reaction+=check.reactionEnd;b.reactionCharacteristic+=check.serviceEnd;}
    for(const q of span.pointLoads){if(a)a.tributaryArea+=q.area*(span.length-q.at)/span.length;if(b)b.tributaryArea+=q.area*q.at/span.length;}
  }
  const worst=spans.reduce((a,b)=>!a||b.check.utilization>a.check.utilization?b:a,null),expected=sum(samples.map(q=>q.design)),actual=sum(piles.map(q=>q.reaction));
  if(worst){loadChecks.push({id:'grillage-strength',label:'Ростверк: изгиб, срез и прогиб пролётов',status:worst.check.status,value:worst.check.utilization,limit:1,unit:'коэф.',note:`Критический пролёт ${worst.id}; частная проверка при равномерной передаче на ${g.plies} доски. Узлы, поперечная устойчивость и совместная работа пакета не подтверждены.`});}
  loadChecks.push({id:'grillage-balance',label:'Передача вертикальной нагрузки через ростверк',status:Math.abs(expected-actual)<1e-6&&unassignedDesign<EPS?'pass':'fail',value:Math.abs(expected-actual),limit:1e-6,unit:'кН',note:'Каждая нагрузка учтена один раз в пролётах; реакции направлены на их концевые сваи.'},{id:'grillage-ply-connections',label:'Ростверк: распределение по слоям и крепление оголовков',status:'unverified',note:'Число досок не подтверждает совместную работу. Нужны крепёж пакета, смятие поперёк волокон, длины опирания, удержание от опрокидывания, анкеры и горизонтальная схема.'});
  return {spans,piles,loadChecks,worstSpan:worst,unassignedDesign,unassignedCharacteristic,balanceError:actual-expected,maxProjectionDistance,loadMethod:'Нагрузки распределены по ближайшим пролётам в плане, затем решено равновесие независимых шарнирно опёртых балок. Пространственная жёсткость, многопролётная неразрезность и кручение не рассчитаны.',quantities:{...model.quantities,spanCount:spans.length,pileCount:piles.length,maxSpan:Math.max(0,...spans.map(s=>s.length))}};
}

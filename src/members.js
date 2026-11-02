/** Individual timber takeoff and transparent concept-stage mechanics. */
export const memberDefaults = {
  timberDensity:500,tensionDesign:8,compressionDesign:12,shearDesign:1.5,
  studB:45,braceB:25,braceH:100,braceBay:2.4,bracing:true,
  cornerType:'california2',stockLength:6,lateralRestraint:0.6,studRestraint:1.4,
  columnK:1,rafterB:50,rafterH:200,
};
export const GRAVITY=9.80665;
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const tol=1e-8;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const section=(b,h)=>`${Math.round(b)} × ${Math.round(h)}`;
const status=u=>u>1?'fail':'pass';

export function deriveTimber(input){
  const p={...memberDefaults,...input};
  const instances=[],bracingBays=[],scheduleMap=new Map();
  const B=p.studB/1000,D=p.wallThickness,H=p.height,L=p.length,W=p.width;
  const clear=H-3*B,base=0.72,floorT=p.joistH/1000+0.035,pitch=H+floorT;
  const wallPoint=(wall,s,y)=>wall==='north'?[s,y,D/2]:wall==='south'?[s,y,W-D/2]:wall==='west'?[D/2,y,s]:wall==='east'?[L-D/2,y,s]:[s,y,W/2];
  const wallCross=wall=>['north','south','inner'].includes(wall)?[1,0,0]:[0,0,1];
  function add(name,category,role,b,h,start,end,extras={}){
    const length=Math.hypot(...end.map((v,i)=>v-start[i]));if(length<0.005)return;
    const volume=b*h/1e6*length,mass=volume*p.timberDensity;
    const key=[name,category,role,b,h,length.toFixed(6),extras.angle?.toFixed(3)].join('|');
    let row=scheduleMap.get(key);
    if(!row){row={id:`T${String(scheduleMap.size+1).padStart(3,'0')}`,name,category,role,section:section(b,h),b,h,length,count:0,volumeEach:volume,volume:0,massEach:mass,mass:0,totalMass:0,...(extras.angle===undefined?{}:{angle:extras.angle})};scheduleMap.set(key,row);}
    row.count++;row.volume+=volume;row.mass+=mass;row.totalMass=row.mass;
    instances.push({id:`D${String(instances.length+1).padStart(4,'0')}`,scheduleId:row.id,name,category,role,b,h,section:section(b,h),length,volume,mass,start,end,crossAxis:[1,0,0],...extras});
  }
  function plate(wall,f,y,a,b,role='plate'){
    let x=a;while(x<b-tol){const next=Math.min(b,x+p.stockLength);add(role==='ridge'?'Коньковая доска':'Обвязка',role==='ridge'?'roof':'walls',role,p.studB,D*1000,wallPoint(wall,x,y),wallPoint(wall,next,y),{wall,floor:f,crossAxis:[0,1,0]});x=next;}
  }
  function vertical(wall,f,s,y0,y1,role='stud'){
    const names={stud:'Рядовая стойка',king:'Коренная стойка проёма',jack:'Подперемычечная стойка',cripple:'Короткая стойка',corner:'Стойка углового пакета',gable:'Стойка фронтона'};
    add(names[role],role==='gable'?'roof':'walls',role,p.studB,D*1000,wallPoint(wall,s,y0),wallPoint(wall,s,y1),{wall,floor:f,crossAxis:wallCross(wall)});
  }
  for(let f=0;f<p.floors;f++){
    const y0=base+floorT+f*pitch,low=y0+B,high=y0+H-2*B;
    for(const wall of ['north','south','west','east',...(p.internalBearing?['inner']:[])]){
      const length=['north','south','inner'].includes(wall)?L:W;
      const openings=p.openings.filter(o=>o.wall===wall&&(o.floor??1)===f+1).sort((a,b)=>a.offset-b.offset);
      // Bottom plates are interrupted by door openings. Top plates remain continuous.
      const doors=openings.filter(o=>o.sill<B);
      const endInset=['west','east'].includes(wall)?D:0;
      let from=endInset;for(const o of doors){plate(wall,f+1,y0+B/2,from,o.offset);from=o.offset+o.width;}plate(wall,f+1,y0+B/2,from,length-endInset);
      plate(wall,f+1,y0+H-1.5*B,endInset,length-endInset);plate(wall,f+1,y0+H-B/2,endInset,length-endInset);
      const n=Math.ceil(length/p.studStep);
      for(let i=0;i<=n;i++){
        const s=length*i/n;
        const cornerFootprint=['north','south'].includes(wall)?D+2*B:D;
        if(wall!=='inner'&&(s<cornerFootprint+B/2||s>length-cornerFootprint-B/2))continue; // No duplicated ordinary corner studs.
        const o=openings.find(o=>s>o.offset-2.5*B&&s<o.offset+o.width+2.5*B);
        if(!o){vertical(wall,f+1,s,low,high);continue;}
        if(s<o.offset+B/2||s>o.offset+o.width-B/2)continue; // King/jack already frame the boundary.
        const openingBottom=y0+o.sill,openingTop=y0+o.sill+o.height,headerDepth=0.2;
        if(o.sill>B*2)vertical(wall,f+1,s,low,openingBottom-B,'cripple');
        if(high>openingTop+headerDepth)vertical(wall,f+1,s,openingTop+headerDepth,high,'cripple');
      }
      for(const o of openings){
        const bottom=y0+o.sill,top=y0+o.sill+o.height;
        for(const side of [-1,1]){
          const edge=side<0?o.offset:o.offset+o.width;
          vertical(wall,f+1,edge+side*1.5*B,low,high,'king');
          vertical(wall,f+1,edge+side*B/2,low,top,'jack');
        }
        // Two independent header boards; connections and composite action are not designed.
        const a=wallPoint(wall,o.offset-B,top+0.1),b=wallPoint(wall,o.offset+o.width+B,top+0.1);
        for(const side of [-1,1]){
          const normal=['north','south'].includes(wall)?2:0;
          const aa=[...a],bb=[...b];aa[normal]+=side*(D/2-B/2);bb[normal]+=side*(D/2-B/2);
          add('Доска перемычки','walls','header',p.studB,200,aa,bb,{wall,floor:f+1,crossAxis:['north','south'].includes(wall)?[0,0,1]:[1,0,0],openingId:o.id,angle:0});
        }
        if(o.sill>B*2)add('Подоконная доска','walls','sill',p.studB,D*1000,wallPoint(wall,o.offset,bottom-B/2),wallPoint(wall,o.offset+o.width,bottom-B/2),{wall,floor:f+1,crossAxis:[0,1,0],openingId:o.id});
      }
      if(p.bracing&&wall!=='inner'){
        const margin=Math.max(0.15,D),intervals=[];let previous=margin;
        for(const o of openings){if(o.offset-margin>previous)intervals.push([previous,o.offset-margin]);previous=Math.max(previous,o.offset+o.width+margin);}
        if(length-margin>previous)intervals.push([previous,length-margin]);
        const best=intervals.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
        if(!best||best[1]-best[0]<p.braceBay-tol){bracingBays.push({wall,floor:f+1,available:false,width:0,height:clear,length:0});}
        else{
          const bay=Math.min(p.braceBay,best[1]-best[0]),a=(best[0]+best[1]-bay)/2,b=a+bay,angle=Math.atan2(clear,bay)*180/Math.PI;
          bracingBays.push({wall,floor:f+1,available:true,width:bay,height:clear,length:Math.hypot(bay,clear),angle,start:a,end:b});
          for(const reverse of [false,true]){
            const aa=wallPoint(wall,a,reverse?high:low),bb=wallPoint(wall,b,reverse?low:high);
            // X diagonals occupy separate outside faces; they do not overlap each other.
            const normal=['north','south'].includes(wall)?2:0;
            const offset=(reverse?-1:1)*(D/2+p.braceB/2000);
            aa[normal]+=offset;bb[normal]+=offset;
            add('Диагональная укосина','bracing','brace',p.braceB,p.braceH,aa,bb,{wall,floor:f+1,angle:reverse?-angle:angle,crossAxis:['north','south'].includes(wall)?[0,0,1]:[1,0,0]});
          }
        }
      }
    }
    // Schematic corner packages: boards remain separate, no composite stiffness credited.
    const cornerCount={california2:2,three3:3,closed4:4}[p.cornerType];
    for(const [cx,cz,sx,sz] of [[0,0,1,1],[L,0,-1,1],[0,W,1,-1],[L,W,-1,-1]]){
      for(let i=0;i<cornerCount;i++){
        const x=cx+sx*(i===0?B/2:i===1?B+D/2:i===2?D+1.5*B:B+D/2);
        const z=cz+sz*(i===0?D/2:i===1?B/2:i===2?D/2:D-B/2);
        add('Угловой пакет · доска','walls','corner',p.studB,D*1000,[x,low,z],[x,high,z],{floor:f+1,cornerType:p.cornerType,corner:`${cx===0?'w':'e'}${cz===0?'n':'s'}`,crossAxis:i===1||i===3?[0,0,1]:[1,0,0]});
      }
    }
    const nJoists=Math.ceil(L/p.joistStep);
    for(let i=0;i<=nJoists;i++){
      const edge=p.joistB/1000,x=edge/2+(L-edge)*i/nJoists,y=base+f*pitch+p.joistH/2000;
      for(let bay=0;bay<(p.internalBearing?2:1);bay++){
        const a=p.internalBearing?(bay===0?edge:W/2):edge,b=p.internalBearing?(bay===0?W/2:W-edge):W-edge;
        add('Балка перекрытия','floor','joist',p.joistB,p.joistH,[x,y,a],[x,y,b],{floor:f+1,crossAxis:[1,0,0]});
      }
    }
    // Perimeter rim boards are actual separate pieces; splices are not designed.
    const y=base+f*pitch+p.joistH/2000;
    for(const z of [p.joistB/2000,W-p.joistB/2000])for(let x=0;x<L-tol;){const end=Math.min(L,x+p.stockLength);add('Торцевая обвязка перекрытия','floor','rim',p.joistB,p.joistH,[x,y,z],[end,y,z],{floor:f+1,crossAxis:[0,0,1]});x=end;}
  }
  const eave=base+p.floors*pitch,rise=W/2*Math.tan(p.roofPitch*Math.PI/180),nRafters=Math.ceil(L/p.studStep);
  for(let i=0;i<=nRafters;i++){
    const x=L*i/nRafters;
    add('Стропильная доска','roof','rafter',p.rafterB,p.rafterH,[x,eave,0],[x,eave+rise,W/2],{angle:p.roofPitch,crossAxis:[1,0,0]});
    add('Стропильная доска','roof','rafter',p.rafterB,p.rafterH,[x,eave+rise,W/2],[x,eave,W],{angle:-p.roofPitch,crossAxis:[1,0,0]});
  }
  for(let x=0;x<L-tol;){const end=Math.min(L,x+p.stockLength);add('Коньковая доска','roof','ridge',p.rafterB,p.rafterH,[x,eave+rise,W/2],[end,eave+rise,W/2],{crossAxis:[0,0,1]});x=end;}
  for(const wall of ['west','east']){
    const nGable=Math.ceil(W/p.studStep);
    for(let i=1;i<nGable;i++){
      const s=W*i/nGable;
      const h=Math.max(0,rise*(1-Math.abs(s-W/2)/(W/2))-p.studB/1000);
      if(h>0.05)vertical(wall,p.floors,s,eave,eave+h,'gable');
    }
  }
  const schedule=[...scheduleMap.values()];
  const totals=Object.fromEntries(['walls','floor','roof','bracing'].map(k=>{const parts=instances.filter(x=>x.category===k);const mass=sum(parts.map(x=>x.mass));return[k,{count:parts.length,volume:sum(parts.map(x=>x.volume)),mass,weight:mass*GRAVITY/1000}];}));
  const mass=sum(instances.map(x=>x.mass)),volume=sum(instances.map(x=>x.volume));
  return {schedule,instances,totals,volume,mass,weight:mass*GRAVITY/1000,boardCount:instances.length,bracingBays,overStock:instances.filter(x=>x.length>p.stockLength+tol),density:p.timberDensity,stockLength:p.stockLength,
    assumptions:['Каждая доска имеет геометрическую длину, V=b×h×L и m=ρ×V. Запас закупки не включён в вес дома. Плотность задана пользователем, влажность автоматически не определяется.','Обвязки и конёк разделены по длине сортимента; размещение и несущая способность стыков не рассчитаны. Балки, стропила и укосины не разрезаются: превышения сортимента отмечены.','Перемычки заданы двумя досками 45/пользовательская ширина × 200 мм. Их несущая способность и соединения требуют отдельной проверки. Угловые пакеты — условные схемы 2/3/4 доски, без гарантии нормативного узла.','Длины по осям элементов, без припусков на запилы, нахлёстов и вырезов. Крепёж, опорные узлы, ростверк и несущие коньковые балки в ведомость не включены.']};
}

export function calculateMembers(input,r,timber){
  const p={...memberDefaults,...input};
  const A=p.studB*p.wallThickness*1000;
  const Iweak=(p.wallThickness*1000)*p.studB**3/12;
  const Istrong=p.studB*(p.wallThickness*1000)**3/12;
  const clear=p.height-3*p.studB/1000,weakLength=Math.min(clear,p.studRestraint),strongLength=clear;
  const openingTrib=Math.max(p.studStep,...p.openings.filter(o=>['north','south'].includes(o.wall)).map(o=>o.width/2+p.studStep));
  const roofLine=(r.loads.roofWeight*p.gammaG+r.loads.snow*p.gammaQ)/(2*p.length);
  const floorLine=(p.floors-1)*((p.floorDead+r.loads.timberFloorPressure)*p.gammaG+p.liveLoad*p.gammaQ)*p.width*(p.internalBearing?0.25:0.5);
  const wallWoodLine=(timber.totals.walls.weight+timber.totals.bracing.weight)/(2*(p.length+p.width)+(p.internalBearing?p.length:0));
  const wallLine=p.height*p.floors*p.wallDead*p.gammaG+wallWoodLine*p.gammaG;
  const N=(roofLine+floorLine+wallLine)*openingTrib;
  const eulerWeak=Math.PI**2*p.E*Iweak/(p.columnK*weakLength*1000)**2/1000;
  const eulerStrong=Math.PI**2*p.E*Istrong/(p.columnK*strongLength*1000)**2/1000;
  const euler=Math.min(eulerWeak,eulerStrong),crushing=p.compressionDesign*A/1000,capacity=Math.min(euler,crushing);
  const maxWeakLength=N>0?Math.PI*Math.sqrt(p.E*Iweak/(N*1000))/p.columnK/1000:Infinity;
  const stud={force:N,area:A,Iweak,Istrong,length:clear,unbracedLength:weakLength,strongLength,K:p.columnK,eulerWeak,eulerStrong,euler,crushing,capacity,stress:N*1000/A,shortening:N*1000*clear*1000/(p.E*A),maxUnbracedLength:maxWeakLength,utilization:N/capacity,status:N>capacity?'fail':'warning',tributaryWidth:openingTrib,note:'Идеальная центрально сжатая стойка; минимум Fc×A и Euler по двум осям. Эксцентриситеты, несовершенства, совместный изгиб и узлы не проверены.'};
  const braces=timber.bracingBays.filter(b=>b.available).map(b=>{
    const forceWind=['north','south'].includes(b.wall)?r.loads.windForceX:r.loads.windForceY;
    // Ground storey resists the cumulative wind from all storeys, half to each parallel wall.
    const accumulation=(p.floors-b.floor+1)/p.floors;
    const shear=forceWind*p.gammaQ*accumulation/2;
    const cosine=b.width/b.length,force=shear/cosine,area=p.braceB*p.braceH;
    const I=p.braceH*p.braceB**3/12;
    const euler=Math.PI**2*p.E*I/(p.columnK*b.length*1000)**2/1000;
    const tensionCapacity=p.tensionDesign*area/1000,compressionCapacity=Math.min(p.compressionDesign*area/1000,euler);
    const extension=force*1000*b.length*1000/(p.E*area);
    return {...b,shear,force,area,I,euler,tensionCapacity,compressionCapacity,stress:force*1000/area,extension,drift:extension/cosine,tensionUtilization:force/tensionCapacity,compressionUtilization:force/compressionCapacity,maxCompressionLength:force>0?Math.PI*Math.sqrt(p.E*I/(force*1000))/p.columnK/1000:Infinity};
  });
  const tension=braces.length?braces.reduce((a,b)=>a.tensionUtilization>b.tensionUtilization?a:b):null;
  const compression=braces.length?braces.reduce((a,b)=>a.compressionUtilization>b.compressionUtilization?a:b):null;
  const missing=timber.bracingBays.filter(b=>!b.available);
  const bracing={enabled:p.bracing,bays:braces,missing,tension,compression,utilization:tension?.tensionUtilization??null,status:!p.bracing||missing.length?'unverified':tension&&tension.tensionUtilization>1?'fail':'warning',note:'Основная схема X — работа одной растянутой диагонали на каждое направление ветра. Сжатая диагональ показана отдельно, её устойчивость не засчитывается в сопротивление X. Передача сил крепежом, анкерами и дисками перекрытий не проверена.'};
  const span=p.width/(2*Math.cos(p.roofPitch*Math.PI/180));
  const roofTimberPressure=timber.totals.roof.weight/r.geometry.roofArea;
  const qService=(p.roofDead+roofTimberPressure)*p.studStep*Math.cos(p.roofPitch*Math.PI/180)+(p.snow*r.loads.mu)*p.studStep*Math.cos(p.roofPitch*Math.PI/180)**2;
  const qDesign=(p.roofDead+roofTimberPressure)*p.gammaG*p.studStep*Math.cos(p.roofPitch*Math.PI/180)+(p.snow*r.loads.mu)*p.gammaQ*p.studStep*Math.cos(p.roofPitch*Math.PI/180)**2;
  const Ir=p.rafterB*p.rafterH**3/12,Zr=p.rafterB*p.rafterH**2/6;
  const Mr=qDesign*span**2/8,sigma=Mr*1e6/Zr,deflection=5*qService*(span*1000)**4/(384*p.E*Ir),allowed=span*1000/p.deflectionLimit;
  const rafter={length:span,section:section(p.rafterB,p.rafterH),I:Ir,Z:Zr,lineLoadService:qService,lineLoadDesign:qDesign,moment:Mr,stress:sigma,deflection,deflectionAllowed:allowed,bendingUtilization:sigma/p.bendingDesign,deflectionUtilization:deflection/allowed,utilization:Math.max(sigma/p.bendingDesign,deflection/allowed),status:Math.max(sigma/p.bendingDesign,deflection/allowed)>1?'fail':'unverified',note:'Локальная балочная оценка доски между опорами карниз/конёк. Фактическая схема конька, распор, затяжки и опоры не заданы: кровля как система не проверена.'};
  const shearStress=1.5*r.joist.shear*1000/(p.joistB*p.joistH);
  const shear={stress:shearStress,limit:p.shearDesign,utilization:shearStress/p.shearDesign,status:status(shearStress/p.shearDesign)};
  const maxSpanBending=Math.sqrt(8*p.bendingDesign*r.joist.Z/(r.joist.lineLoadDesign*1e6));
  const maxSpanDeflection=Math.cbrt(384*p.E*r.joist.I/(5*r.joist.lineLoadService*p.deflectionLimit))/1000;
  const maxSpanShear=2*p.shearDesign*(p.joistB*p.joistH)/(1.5*r.joist.lineLoadDesign)/1000;
  const lateral={status:'unverified',restraint:p.lateralRestraint,joistUnbraced:Math.min(p.joistSpan,p.lateralRestraint),rafterUnbraced:Math.min(span,p.lateralRestraint),joistSlenderness:Math.sqrt(Math.min(p.joistSpan,p.lateralRestraint)*1000*p.joistH/p.joistB**2),rafterSlenderness:Math.sqrt(Math.min(span,p.lateralRestraint)*1000*p.rafterH/p.rafterB**2),note:'Шаг раскрепления сжатой кромки задан вручную. Это не автоматическое подтверждение поперечной устойчивости: нужны жёсткость и крепление раскреплений, опорное удержание от поворота и полный LTB-расчёт с нижней оценкой E.'};
  const checks=[
    {id:'joistShear',label:'Сдвиг балки',value:shearStress,limit:p.shearDesign,unit:'МПа',utilization:shear.utilization,status:shear.status},
    {id:'studCompression',label:'Стойка: сжатие / Euler',value:N,limit:capacity,unit:'кН',utilization:stud.utilization,status:stud.status},
    {id:'rafterBending',label:'Стропило: локальный изгиб',value:sigma,limit:p.bendingDesign,unit:'МПа',utilization:rafter.bendingUtilization,status:rafter.bendingUtilization>1?'fail':'warning'},
    {id:'rafterDeflection',label:'Стропило: локальный прогиб',value:deflection,limit:allowed,unit:'мм',utilization:rafter.deflectionUtilization,status:rafter.deflectionUtilization>1?'fail':'warning'},
    ...(tension?[{id:'braceTension',label:'Укосина: растяжение',value:tension.stress,limit:p.tensionDesign,unit:'МПа',utilization:tension.tensionUtilization,status:tension.tensionUtilization>1?'fail':'warning'}]:[]),
    {id:'bracingSystem',label:'Связи и крепёж',status:'unverified',value:null,limit:null,unit:'',note:bracing.note},
    {id:'lateral',label:'Поперечная устойчивость балок',status:'unverified',value:null,limit:null,unit:'',note:lateral.note},
    {id:'rafterSystem',label:'Стропильная система',status:'unverified',value:null,limit:null,unit:'',note:rafter.note},
  ];
  return {stud,tension,rafter,bracing,lateral,shear,joist:{maxSpanBending,maxSpanDeflection,maxSpanShear,maxSpan:Math.min(maxSpanBending,maxSpanDeflection,maxSpanShear)},checks,
    assumptions:['Стойка — идеальная центрально сжатая доска с K пользователя. Euler даёт теоретический порог, а не допускаемую нагрузку реальной древесины. Минимум Euler и FcA не заменяет нормативную кривую устойчивости.','studRestraint задаёт физическое раскрепление слабой оси; обшивка автоматически не считается несущей. Сильная ось проверяется на полную длину стойки.','Стойки углового пакета считаются отдельными досками. Пакет не получает суммарный момент инерции без проверки соединений.','Проверка укосин — идеальная шарнирная стержневая модель X: одна растянутая диагональ активна, вторая при смене ветра. Несущая способность гвоздей, врубок, анкеров и диафрагм не задана.','Упругие деформации мгновенные: ΔL=NL/EA. Ползучесть, влажность, несовершенства, соединительная податливость и пространственные эффекты не учтены.'],
    sources:[{title:'AWC · TR14 Lateral-Torsional Stability',url:'https://web-media.awc.org/wp-content/uploads/2021/12/17210713/AWC-TR14-0312.pdf'},{title:'USDA · Wood Handbook 2021',url:'https://research.fs.usda.gov/treesearch/62200'},{title:'MIT OCW · Euler column buckling',url:'https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf'},{title:'University of Illinois · Axial stress and deformation',url:'https://mechref.engr.illinois.edu/sol/axial.html'},{title:'AWC · Design values for wood',url:'https://awc.org/faq/where-can-i-find-design-values-for-lumber-and-glued-laminated-timber/'}]};
}

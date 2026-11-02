/** Sloping simply supported timber beam under uniform VERTICAL gravity loads.
 * Geometry m; b/h mm; E and strengths MPa; line loads kN/m, deflection mm.
 */
const G=9.80665;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const rafterDefaults={horizontalSpan:4,pitch:25,b:50,h:150,spacing:.6,roofDead:.5,snow:1.5,mu:.8,E:10000,Fb:13,Fv:1.5,Ft:8,Fc:12,density:500,gammaG:1.1,gammaQ:1.4,deflectionRatio:300};
export const defaultRafterSections=['40x150','45x150','50x150','40x200','45x200','50x200','45x250','50x250'];
export const rafterSources=[
  {title:'AWC · Tutorial: horizontal rafter span, loads and bearing',url:'https://awc.org/resource-hub/span-table-tutorial/'},
  {title:'AWC · 2024 Span Tables, Appendix A beam equations',url:'https://web-media.awc.org/wp-content/uploads/2023/11/17210157/AWC_STJR2024_20231127_AWCWebsite.pdf'},
  {title:'University of Illinois · Axial loading',url:'https://mechref.engr.illinois.edu/sol/axial.html'},
];
const assumptions=[
  'Отдельная стропильная доска, не ферма: постоянное прямоугольное сечение, две шарнирные опоры без промежуточных опор и консолей, равномерная вертикальная нагрузка. Расчёт малых упругих перемещений первого порядка.',
  'horizontalSpan — горизонтальный пролёт между расчётными опорами, а L=horizontalSpan/cos(α) — длина по скату. Фактические длины опирания, запилы и стыки должны задаваться отдельно; шестиметровая заготовка не создаёт опору.',
  'Вес слоёв roofDead задан на фактическую площадь ската БЕЗ стропильной древесины: qD=roofDead×spacing+ρ×b×h×g. Снег snow×μ задан на горизонтальную проекцию: qS=snow×μ×spacing×cos(α). Все q сначала действуют вертикально на единицу длины по скату.',
  'Поперечная составляющая q⊥=qvertical×cos(α); продольная составляющая вниз по скату q∥=qvertical×sin(α). Вертикальные реакции обеих опор qvertical×L/2, глобальный горизонтальный распор в этой идеальной схеме равен нулю.',
  'При вертикальных реакциях продольная сила переменна: N(s)=q∥×(s−L/2). Сжатие у нижней опоры, растяжение у верхней; максимум |N|=q∥L/2. Схема не описывает пару стропил с распорным коньком или неизвестным защемлением.',
  'Проверка взаимодействия — прозрачный предварительный линейный критерий |σN|/Fc,t + |σM|/Fb по совпадающим сечениям N(s),M(s), а не полный нормативный расчёт деревянного изгибаемо-сжатого элемента.',
  'Прогиб мгновенный от полной эксплуатационной нагрузки, без ползучести и податливости опор. Вертикальный прогиб включает нормальный изгиб и осевую деформацию. Введённый предел — horizontalSpan/deflectionRatio; он не выбран автоматически по нормам или виду потолка.',
  'Смятие на опорах, длина/возможность опирания, наклонная площадка, вырезы, крепёж, устойчивость из плоскости и раскрепление сжатой кромки не проверены. Ветер, отрыв, заносы и несимметричные случаи снега не входят в эту модель.',
  'capacityPass относится только к показанным расчётам напряжения и прогиба. Он не подтверждает безопасность крыши. Если пределы превышены, возможны большее сечение, меньший шаг, реальная промежуточная опора или отдельная ферма; ферма не назначается обязательной по одному значению пролёта.',
];

export function calculateRafter(input={}){
  if(input===null||typeof input!=='object'||Array.isArray(input))return {valid:false,status:'fail',capacityPass:false,errors:['Параметры стропильной доски должны быть объектом.'],warnings:[],checks:[],assumptions:[...assumptions],sources:rafterSources};
  const p={...rafterDefaults,...input,horizontalSpan:input.horizontalSpan??input.span??rafterDefaults.horizontalSpan,density:input.density??input.timberDensity??rafterDefaults.density,Fb:input.Fb??input.bendingDesign??rafterDefaults.Fb,Fv:input.Fv??input.shearDesign??rafterDefaults.Fv,Ft:input.Ft??input.tensionDesign??rafterDefaults.Ft,Fc:input.Fc??input.compressionDesign??rafterDefaults.Fc};
  const errors=[],warnings=[];
  const bounds={horizontalSpan:[.1,60],b:[15,300],h:[40,1000],spacing:[.1,3],roofDead:[0,30],snow:[0,30],mu:[0,3],E:[1000,50000],Fb:[.1,100],Fv:[.1,30],Ft:[.1,100],Fc:[.1,100],density:[100,1500],gammaG:[1,2],gammaQ:[1,3],deflectionRatio:[100,600]};
  for(const [k,[a,b]] of Object.entries(bounds))if(!finite(p[k])||p[k]<a||p[k]>b)errors.push(`${k}: требуется число от ${a} до ${b}.`);
  if(p.h<p.b)errors.push('Высота h должна быть не меньше ширины b: задана сильная ось изгиба.');
  if(input.rise!==undefined){if(!finite(input.rise)||input.rise<0)errors.push('rise: требуется конечный неотрицательный перепад.');else{p.pitch=Math.atan2(input.rise,p.horizontalSpan)*180/Math.PI;if(input.pitch!==undefined&&finite(input.pitch)&&Math.abs(p.pitch-input.pitch)>.05)warnings.push('Перепад rise имеет приоритет над pitch; угол рассчитан из фактической геометрии.');}}
  if(!finite(p.pitch)||p.pitch<0||p.pitch>70)errors.push('Уклон: задайте угол 0…70° или соответствующий перепад rise.');
  const result={input:p,errors,warnings,valid:errors.length===0,status:'fail',capacityPass:false,checks:[],assumptions:[...assumptions],sources:rafterSources};
  if(errors.length)return result;
  const alpha=p.pitch*Math.PI/180,c=Math.cos(alpha),s=Math.sin(alpha),A=p.b*p.h,I=p.b*p.h**3/12,Z=p.b*p.h**2/6;
  const timberAxis=p.density*A/1e6*G/1000,roofDeadAxis=p.roofDead*p.spacing,snowAxis=p.snow*p.mu*p.spacing*c;
  const deadAxis=roofDeadAxis+timberAxis,qV=deadAxis+snowAxis,qVD=deadAxis*p.gammaG+snowAxis*p.gammaQ;
  const qN=qV*c,qND=qVD*c,qA=qV*s,qAD=qVD*s;
  function interaction(L,F){
    const C=qND*L**2/(2*Z*p.Fb),D=qAD*L/(A*F),x=C>0?clamp((1-D/C)/2,0,.5):0;
    return {utilization:C*x*(1-x)+D*(.5-x),fraction:x,moment:qND*L**2*x*(1-x)/2/1e6,axial:qAD*L*(.5-x)/1000};
  }
  function evaluate(span){
    const L=span/c*1000,M=qND*L**2/8/1e6,V=qND*L/2/1000,N=qAD*L/2/1000;
    const stress=M*1e6/Z,shearStress=1.5*V*1000/A,normalDeflection=5*qN*L**4/(384*p.E*I),axialDisplacement=qA*L**2/(8*p.E*A),verticalDeflection=normalDeflection*c+axialDisplacement*s;
    const compression=interaction(L,p.Fc),tension=interaction(L,p.Ft),interactionUtilization=Math.max(compression.utilization,tension.utilization);
    const bendingUtilization=stress/p.Fb,shearUtilization=shearStress/p.Fv,compressionUtilization=N*1000/(A*p.Fc),tensionUtilization=N*1000/(A*p.Ft),deflectionAllowed=span*1000/p.deflectionRatio,deflectionUtilization=verticalDeflection/deflectionAllowed;
    const utilization=Math.max(bendingUtilization,shearUtilization,compressionUtilization,tensionUtilization,interactionUtilization,deflectionUtilization);
    return {slopeLength:L/1000,moment:M,shear:V,axialMax:N,stress,shearStress,normalDeflection,verticalDeflection,axialDisplacement,deflectionAllowed,normalDeflectionAllowed:L/p.deflectionRatio,bendingUtilization,shearUtilization,compressionUtilization,tensionUtilization,interactionUtilization,deflectionUtilization,utilization,compressionInteraction:compression,tensionInteraction:tension};
  }
  const e=evaluate(p.horizontalSpan),L=e.slopeLength,vertical=qVD*L/2;
  let lo=0,hi=Math.max(1,p.horizontalSpan);while(evaluate(hi).utilization<=1&&hi<1000)hi*=2;for(let i=0;i<65;i++){const mid=(lo+hi)/2;if(evaluate(mid).utilization<=1)lo=mid;else hi=mid;}
  const maxSpan=lo,reactions={verticalA:vertical,verticalB:vertical,horizontalA:0,horizontalB:0,normalA:vertical*c,normalB:vertical*c,axialA:vertical*s,axialB:vertical*s,serviceVerticalA:qV*L/2,serviceVerticalB:qV*L/2};
  const loads={roofDeadAxis,timberAxis,snowAxis,deadAxis,verticalService:qV,verticalDesign:qVD,normalService:qN,normalDesign:qND,axialService:qA,axialDesign:qAD,signedAxialService:-qA,signedAxialDesign:-qAD,totalService:qV*L,totalDesign:qVD*L,roofLayersWeight:roofDeadAxis*L,timberWeight:timberAxis*L,snowWeight:snowAxis*L};
  const checks=[
    {id:'rafter-bending',label:'Изгиб стропильной доски',value:e.stress,limit:p.Fb,unit:'МПа',utilization:e.bendingUtilization},
    {id:'rafter-shear',label:'Сдвиг стропильной доски',value:e.shearStress,limit:p.Fv,unit:'МПа',utilization:e.shearUtilization},
    {id:'rafter-compression',label:'Продольное сжатие',value:e.axialMax*1000/A,limit:p.Fc,unit:'МПа',utilization:e.compressionUtilization},
    {id:'rafter-tension',label:'Продольное растяжение',value:e.axialMax*1000/A,limit:p.Ft,unit:'МПа',utilization:e.tensionUtilization},
    {id:'rafter-interaction',label:'Изгиб с продольной силой · предварительный критерий',value:e.interactionUtilization,limit:1,unit:'доля',utilization:e.interactionUtilization},
    {id:'rafter-deflection',label:`Вертикальный прогиб · горизонтальный пролёт / ${p.deflectionRatio}`,value:e.verticalDeflection,limit:e.deflectionAllowed,unit:'мм',utilization:e.deflectionUtilization},
  ].map(check=>({...check,status:check.utilization>1?'fail':'pass'}));
  checks.push({id:'rafter-bearing',label:'Реальные опоры, опорная площадка и крепёж',status:'unverified',note:'Наличие опор и их смятие не задано. Доска не считается опёртой только по совпадению координат.'},{id:'rafter-lateral',label:'Боковая устойчивость и раскрепление',status:'unverified',note:'Устойчивость из плоскости и закрепление сжатой кромки не проверены.'},{id:'rafter-wind',label:'Ветер, отрыв и особые снеговые случаи',status:'unverified'});
  const capacityPass=e.utilization<=1;
  const diagrams=Array.from({length:17},(_,i)=>{const x=i/16,l=L*1000,station=x*l,normal=qN*station*(l**3-2*l*station**2+station**3)/(24*p.E*I),u=qA*(station**2-l*station)/(2*p.E*A);return {fraction:x,s:station/1000,horizontal:p.horizontalSpan*x,N:qAD*(station-l/2)/1000,V:qND*(l/2-station)/1000,M:qND*station*(l-station)/2/1e6,normalDeflection:normal,verticalDeflection:normal*c-u*s,axialDisplacement:u};});
  return {...result,...e,valid:true,status:capacityPass?'warning':'fail',capacityPass,horizontalSpan:p.horizontalSpan,span:p.horizontalSpan,rise:p.horizontalSpan*Math.tan(alpha),pitch:p.pitch,b:p.b,h:p.h,section:`${p.b}x${p.h}`,spacing:p.spacing,E:p.E,Fb:p.Fb,Fv:p.Fv,Ft:p.Ft,Fc:p.Fc,density:p.density,deflectionRatio:p.deflectionRatio,A,I,Z,loads,reactions,maxSpan,maxSlopeLength:maxSpan/c,maxSpanBasis:'Горизонтальный пролёт при фиксированном уклоне, сечении, шаге и заданных свойствах; без подтверждения опор и LTB.',deflectionBasis:'Вертикальное перемещение / (горизонтальный пролёт ÷ deflectionRatio)',deflection:e.verticalDeflection,lineLoadService:qN,lineLoadDesign:qND,axial:{left:-e.axialMax,right:e.axialMax,maxCompression:e.axialMax,maxTension:e.axialMax,serviceMidShortening:e.axialDisplacement},bending:{stress:e.stress,limit:p.Fb,utilization:e.bendingUtilization},shearCheck:{stress:e.shearStress,limit:p.Fv,utilization:e.shearUtilization},interaction:{compression:{...e.compressionInteraction,location:e.compressionInteraction.fraction*L},tension:{...e.tensionInteraction,location:(1-e.tensionInteraction.fraction)*L},utilization:e.interactionUtilization,note:'Линейный предварительный критерий по совпадающим сечениям, без нормативной кривой устойчивости.'},mass:p.density*A/1e6*L,volume:A/1e6*L,checks,diagrams,recommendations:capacityPass?[]:['Увеличить высоту или ширину сечения с повторным расчётом.','Уменьшить фактический шаг стропил с повторным расчётом.','Предусмотреть реальную промежуточную опору и проверить новый путь передачи нагрузки.','Сравнить отдельную ферму как вариант конструктивной схемы.']};
}

/** Catalog screening, not a prescription or an automatic truss requirement. */
export function evaluateRafterCandidates(input={},catalog=defaultRafterSections){
  const candidates=[];
  for(const item of Array.isArray(catalog)?catalog:[]){let b,h,id;if(typeof item==='string'){const m=item.match(/^(\d+)\s*[x×]\s*(\d+)$/);if(!m)continue;b=+m[1];h=+m[2];id=item;}else if(item&&typeof item==='object'){({b,h}=item);id=item.id??`${b}x${h}`;}else continue;
    const analysis=calculateRafter({...input,b,h});if(!analysis.valid)continue;candidates.push({id,b,h,section:`${b}x${h}`,area:b*h,volume:analysis.volume,mass:analysis.mass,capacityPass:analysis.capacityPass,utilization:analysis.utilization,analysis});
  }
  candidates.sort((a,b)=>Number(b.capacityPass)-Number(a.capacityPass)||a.area-b.area||a.h-b.h||a.b-b.b);
  const acceptable=candidates.filter(c=>c.capacityPass);
  return {candidates,acceptable,recommended:acceptable[0]??null,anyAcceptable:acceptable.length>0,status:acceptable.length?'unverified':'no-candidate',note:'Проверены только перечисленные сечения при введённых нагрузках и свойствах. Нет подходящего сечения — не доказательство необходимости фермы: доступны меньший шаг, другая древесина и промежуточная опора.'};
}
export const evaluateCandidateCatalog=evaluateRafterCandidates;

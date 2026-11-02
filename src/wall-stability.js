/** Full-height wall studs. No automatic restraint at the former storey height.
 * Length m; b/h mm; line forces kN/m; wind kPa; E/F MPa; deflection mm.
 */
const G=9.80665,EPS=1e-8;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sum=a=>a.reduce((s,x)=>s+x,0);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const section=s=>{const m=typeof s==='string'&&s.match(/^(\d+)\s*[x×]\s*(\d+)$/);return m?{b:+m[1],h:+m[2]}:null;};
const allowance=(cut,h)=>cut?.scheme==='miter'?(cut.cutWidthMM??h)/2000*Math.tan(Math.min(85,Math.abs(cut.angle??0))*Math.PI/180):0;
export const wallStabilitySources=[
  {title:'AWC · Design of Tall Walls in Wood Structures',url:'https://web-media.awc.org/wp-content/uploads/2021/12/17210645/StructureMag-NDS2015-EngineersNotebook-1812.pdf'},
  {title:'MIT OCW · Euler column buckling',url:'https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf'},
];
const assumptions=[
  'Проверяется фактическая полная длина каждой цельной стойки. Высота прежнего этажа и p.material.studRestraint не создают раскрепление автоматически. В этой модели обе оси имеют полную нераскреплённую длину L и K=1, если другой K явно не введён.',
  'Euler — теоретическая потеря устойчивости идеальной центрально сжатой прямой доски. Для устойчивости используется явно заданный Emin, иначе введённый E с предупреждением. Средний E не заменяет нормативный нижний модуль и нормативные коэффициенты устойчивости.',
  'Вертикальная сила включает введённую реакцию кровли и дополнительную погонную нагрузку на грузовую ширину, вес слоёв стены и собственный вес самой стойки. Полный нижний N консервативно принят постоянным по длине для проверки устойчивости.',
  'Ветер — введённое давление на фасад, равномерно по грузовой ширине стойки. Доска шарнирно опёрта сверху и снизу, изгиб из плоскости стены вокруг сильной оси I=b×h³/12. Фактические связи верхней и нижней опоры должны быть подтверждены отдельно.',
  'Показаны изгиб, сдвиг и мгновенный прогиб от ветра. Упрощённое увеличение момента и прогиба 1/(1−N/Ncr,strong) использует идеальный Euler сильной оси. Это предварительный расчёт первого/второго порядка, не полный NDS/СП расчёт деревянной стены.',
  'Прозрачный критерий взаимодействия: N/min(FcA,Ncr,weak,Ncr,strong) + σb,увел/Fb при сжатии, либо |N|/FtA + σb/Fb при растяжении. Для полной проверки нужны нормативные сочетания, несовершенства, эксцентриситеты, вырезы, влажность и ползучесть.',
  'MWFRS и C&C — разные ветровые случаи. Здесь одна пользовательская ветровая величина используется как сценарий; оба нормативных набора и особые снеговые случаи автоматически не назначаются.',
  'stockFits относится к полной заготовке с припусками длинных точек, а не к длине одного отрезанного куска. Заготовка более 6 м не одобряется через автоматическое наращивание. Узел составной стены или реальное раскрепление требуют отдельного решения.',
  'Наличие частных проверок не подтверждает работу всего дома, передачу реакции кровли через верхнюю обвязку, анкеры, диафрагмы и узлы. Обшивке и пакету досок не присваивается совместная жёсткость без отдельного расчёта.',
];
function lineLoad(value){if(finite(value))return {design:value,service:value,known:true,serviceAssumed:true};if(value&&typeof value==='object'&&finite(value.design))return {design:value.design,service:finite(value.service)?value.service:value.design,known:true,serviceAssumed:!finite(value.service)};return {design:0,service:0,known:false,serviceAssumed:false};}

export function checkFullHeightWall(input={}){
  const p={wind:0,gammaG:1.1,gammaQ:1.4,E:10000,Fc:12,Ft:8,Fb:13,Fv:1.5,density:500,wallDead:.5,deflectionRatio:200,K:1,stockLength:6,...input};
  const errors=[],warnings=[],roof=lineLoad(p.roofReactionLine??p.roofReactionLineDesign),extra=lineLoad(p.additionalLineLoad);
  if(finite(p.roofReactionLineService))roof.service=p.roofReactionLineService;
  if(!Array.isArray(p.studs)||!p.studs.length||p.studs.length>1000)errors.push('Нужен массив от 1 до 1000 фактических стоек.');
  const ranges={wind:[-20,20],gammaG:[1,2],gammaQ:[1,3],E:[1000,50000],Fc:[.1,100],Ft:[.1,100],Fb:[.1,100],Fv:[.1,30],density:[100,1500],wallDead:[0,20],deflectionRatio:[100,600],K:[.5,2]};
  for(const [key,[a,b]] of Object.entries(ranges))if(!finite(p[key])||p[key]<a||p[key]>b)errors.push(`${key}: требуется число от ${a} до ${b}.`);
  if(p.Emin!==undefined&&(!finite(p.Emin)||p.Emin<=0||p.Emin>p.E))errors.push('Emin должен быть положительным и не превышать E.');
  if(p.spacing!==undefined&&(!finite(p.spacing)||p.spacing<=0||p.spacing>20))errors.push('spacing: требуется положительная грузовая ширина.');
  if((p.roofReactionLine!==undefined||p.roofReactionLineDesign!==undefined)&&!roof.known)errors.push('Реакция кровли должна быть числом или объектом {design,service}.');
  if(p.additionalLineLoad!==undefined&&!extra.known)errors.push('Дополнительная погонная нагрузка должна быть числом или объектом {design,service}.');
  if(p.stockLength!==6)errors.push('Критерий цельной заготовки в этой модели — 6 м.');
  const ids=new Set();for(const [i,s] of (Array.isArray(p.studs)?p.studs:[]).entries()){
    if(!s||typeof s!=='object'){errors.push(`Стойка ${i+1}: требуется объект.`);continue;}
    if(typeof s.id!=='string'||!s.id||ids.has(s.id))errors.push(`Стойка ${i+1}: нужен уникальный ID.`);ids.add(s.id);
    if(!finite(s.length)||s.length<=0||s.length>30||!finite(s.b)||!finite(s.h)||s.b<15||s.h<s.b||s.h>1000)errors.push(`Стойка ${s.id??i+1}: неверная длина или сечение.`);
    if(s.tributaryWidth!==undefined&&(!finite(s.tributaryWidth)||s.tributaryWidth<=0||s.tributaryWidth>20))errors.push(`Стойка ${s.id??i+1}: неверная грузовая ширина.`);
    if(s.cutLength!==undefined&&(!finite(s.cutLength)||s.cutLength<s.length-EPS))errors.push(`Стойка ${s.id??i+1}: длина заготовки меньше осевой длины.`);
    for(const k of ['roofForceDesign','roofForceService'])if(s[k]!==undefined&&!finite(s[k]))errors.push(`Стойка ${s.id??i+1}: ${k} должно быть конечным числом.`);
    for(const cut of [s.cutStart,s.cutEnd])if(cut?.scheme==='miter'&&(!finite(cut.angle)||Math.abs(cut.angle)>85))errors.push(`Стойка ${s.id??i+1}: некорректный угол торца.`);
  }
  const out={wallId:p.wallId,level:p.level,studs:[],worst:null,height:0,maxStudLength:0,stockFits:false,capacityPass:false,utilization:null,checks:[],errors,warnings,assumptions:[...assumptions],sources:wallStabilitySources,status:'fail'};
  if(errors.length)return out;
  const stabilityE=p.Emin??p.E;if(p.Emin===undefined)warnings.push('Emin не задан: Euler показан с E как идеальная оценка, без нижней нормативной жёсткости.');
  if(roof.serviceAssumed)warnings.push('Эксплуатационная реакция кровли не задана отдельно; для прогиба использована введённая расчётная реакция.');
  for(const s of p.studs){
    const width=s.tributaryWidth??p.spacing??.6,L=s.length*1000,A=s.b*s.h,Iweak=s.h*s.b**3/12,Istrong=s.b*s.h**3/12,Z=s.b*s.h**2/6;
    const timberMass=p.density*A/1e6*s.length,timberWeight=timberMass*G/1000,wallWeight=p.wallDead*width*s.length;
    const forceKnown=finite(s.roofForceDesign)||roof.known||p.loadBearing===false;
    const roofDesign=finite(s.roofForceDesign)?s.roofForceDesign:roof.design*width,roofService=finite(s.roofForceService)?s.roofForceService:finite(s.roofForceDesign)?s.roofForceDesign:roof.service*width;
    const force=roofDesign+extra.design*width+(timberWeight+wallWeight)*p.gammaG,serviceForce=roofService+extra.service*width+timberWeight+wallWeight;
    const eulerWeak=Math.PI**2*stabilityE*Iweak/(p.K*L)**2/1000,eulerStrong=Math.PI**2*stabilityE*Istrong/(p.K*L)**2/1000,euler=Math.min(eulerWeak,eulerStrong),crushing=p.Fc*A/1000,compressionCapacity=Math.min(crushing,euler),tensionCapacity=p.Ft*A/1000;
    const compression=Math.max(0,force),tension=Math.max(0,-force),compressionUtilization=compression/compressionCapacity,tensionUtilization=tension/tensionCapacity;
    const windLineService=Math.abs(p.wind)*width,windLineDesign=windLineService*p.gammaQ,windMoment=windLineDesign*s.length**2/8,windShear=windLineDesign*s.length/2;
    const amplification=compression>=eulerStrong?Infinity:1/(1-compression/eulerStrong),serviceCompression=Math.max(0,serviceForce),serviceAmplification=serviceCompression>=eulerStrong?Infinity:1/(1-serviceCompression/eulerStrong);
    const windStressFirstOrder=windMoment*1e6/Z,windStress=windStressFirstOrder>0?windStressFirstOrder*amplification:0,windShearStress=1.5*windShear*1000/A;
    const windDeflectionFirstOrder=5*windLineService*L**4/(384*p.E*Istrong),windDeflection=windDeflectionFirstOrder>0?windDeflectionFirstOrder*serviceAmplification:0,deflectionAllowed=L/p.deflectionRatio;
    const bendingUtilization=windStress/p.Fb,shearUtilization=windShearStress/p.Fv,deflectionUtilization=windDeflection/deflectionAllowed,interactionUtilization=compressionUtilization+tensionUtilization+bendingUtilization;
    const utilization=Math.max(compressionUtilization,tensionUtilization,bendingUtilization,shearUtilization,deflectionUtilization,interactionUtilization);
    const cutLength=s.cutLength??s.length+allowance(s.cutStart,s.h)+allowance(s.cutEnd,s.h),stockFits=cutLength<=6+EPS;
    out.studs.push({...s,tributaryWidth:width,length:s.length,cutLength,A,Iweak,Istrong,Z,stabilityE,unbracedWeakLength:s.length,unbracedStrongLength:s.length,K:p.K,force,compressionForce:compression,tensionForce:tension,serviceForce,forceKnown,roofForceDesign:roofDesign,roofForceService:roofService,timberMass,timberWeight,wallWeight,compressionStress:compression*1000/A,tensionStress:tension*1000/A,eulerWeak,eulerStrong,euler,crushing,compressionCapacity,tensionCapacity,windLineService,windLineDesign,windMoment,windShear,windStressFirstOrder,windStress,windShearStress,amplification,serviceAmplification,windDeflectionFirstOrder,windDeflection,deflectionAllowed,compressionUtilization,tensionUtilization,bendingUtilization,shearUtilization,deflectionUtilization,interactionUtilization,utilization,stockFits,capacityPass:utilization<=1&&stockFits&&forceKnown,status:utilization>1||!stockFits?'fail':'unverified'});
  }
  out.worst=out.studs.reduce((a,b)=>a.utilization>b.utilization?a:b);out.height=out.maxStudLength=Math.max(...out.studs.map(s=>s.length));out.section=`${out.worst.b}x${out.worst.h}`;out.stockFits=out.studs.every(s=>s.stockFits);out.utilization=out.worst.utilization;out.capacityPass=out.studs.every(s=>s.capacityPass);
  const row=(id,label,util,value,limit,unit)=>{const s=out.studs.reduce((a,b)=>a[util]>b[util]?a:b);return {id,label,studId:s.id,utilization:s[util],value:s[value],limit:typeof limit==='string'?s[limit]:limit,unit,status:s[util]>1?'fail':'pass'};};
  out.checks=[row('full-wall-compression','Цельная стойка: полная длина / Euler','compressionUtilization','compressionForce','compressionCapacity','кН'),row('full-wall-tension','Цельная стойка: растяжение','tensionUtilization','tensionStress',p.Ft,'МПа'),row('full-wall-bending','Ветер: изгиб из плоскости','bendingUtilization','windStress',p.Fb,'МПа'),row('full-wall-shear','Ветер: сдвиг','shearUtilization','windShearStress',p.Fv,'МПа'),row('full-wall-interaction','Сжатие / устойчивость + увеличенный изгиб','interactionUtilization','interactionUtilization',1,'доля'),row('full-wall-deflection',`Прогиб от ветра · H/${p.deflectionRatio}`,'deflectionUtilization','windDeflection','deflectionAllowed','мм'),{id:'full-wall-stock',label:'Цельная заготовка с припусками до 6 м',status:out.stockFits?'pass':'fail',value:Math.max(...out.studs.map(s=>s.cutLength)),limit:6,unit:'м'},{id:'full-wall-load-path',label:'Заданная осевая реакция кровли',status:out.studs.every(s=>s.forceKnown)?'pass':'unverified',note:'Без назначенной реакции кровли частные числа не одобряют цельную несущую стену.'},{id:'full-wall-system',label:'Опоры, крепёж, обшивка и нормативные сочетания',status:'unverified',note:'Работа обвязки, анкеров, обшивки, диафрагм и нормативные кривые устойчивости не проверены.'}];
  out.status=out.checks.some(c=>c.status==='fail')?'fail':'unverified';return out;
}

/** Recover complete straight studs before stock splitting, preserving outside cuts. */
function fullStuds(instances){const map=new Map();for(const s of instances){if(!['stud','king','fullHeightStud','full-height-stud','continuousStud'].includes(s.role)||!Array.isArray(s.start)||!Array.isArray(s.end))continue;const id=s.memberId??s.id;if(!map.has(id))map.set(id,[]);map.get(id).push(s);}return [...map].map(([id,parts])=>{const a=parts[0],L=distance(a.start,a.end),u=a.end.map((v,i)=>(v-a.start[i])/L),points=parts.flatMap(b=>[b.start,b.end]),ts=points.map(p=>sum(p.map((v,i)=>(v-a.start[i])*u[i]))),lo=Math.min(...ts),hi=Math.max(...ts),sorted=[...parts].sort((a,b)=>((a.partIndex??0)-(b.partIndex??0)));const length=hi-lo,cs=sorted[0].cutStart,ce=sorted.at(-1).cutEnd;return {id,length,b:a.b,h:a.h,wallId:a.wallId,level:a.level??a.floor,cutStart:cs,cutEnd:ce,cutLength:length+allowance(cs,a.h)+allowance(ce,a.h),partCount:parts.length};}).filter(s=>finite(s.length)&&s.length>0);}

export function checkFullHeightWalls(project,result,roofModel){
  const profiles=roofModel?.wallProfiles??result?.roofModel?.wallProfiles??[],instances=result?.timber?.instances??[],logical=fullStuds(instances),walls=[],checks=[];
  for(const profile of profiles){const studs=logical.filter(s=>s.wallId===profile.wallId&&(profile.level===undefined||s.level===profile.level));
    if(profile.mode!=='continuous'||!studs.length){const check={id:`${profile.wallId}-full-wall-continuity`,label:'Цельная высокая стена',status:'unverified',note:profile.mode==='stacked'?'Составная стена: силовой стык и раскрепление требуют отдельного решения.':'Фактические полноразмерные стойки не найдены.'};walls.push({wallId:profile.wallId,level:profile.level,mode:profile.mode,height:profile.studMaxLength??0,stockFits:false,capacityPass:false,utilization:null,worst:null,studs:[],checks:[check],status:'unverified'});checks.push(check);continue;}
    const original=(project.walls??[]).find(w=>w.id===profile.wallId),trib=original?.studStep??.6;for(const s of studs)s.tributaryWidth=trib;
    let reaction=profile.roofReactionLine;
    if(reaction===undefined&&finite(profile.roofReactionLineDesign))reaction={design:profile.roofReactionLineDesign,service:profile.roofReactionLineService};
    const material=project.material??{},load=project.loads??{};
    const wall=checkFullHeightWall({wallId:profile.wallId,level:profile.level,studs,roofReactionLine:reaction,additionalLineLoad:profile.additionalLineLoad,wind:load.wind??0,gammaG:load.gammaG??1.1,gammaQ:load.gammaQ??1.4,E:material.E??10000,Emin:material.Emin,Fc:material.Fc??12,Ft:material.Ft??8,Fb:material.Fb??13,Fv:material.Fv??1.5,density:material.density??500,wallDead:(load.wallDead??.5)+(result.bracingModel?.method==='sheathing'?(project.bracing?.thickness??12)/1000*(project.bracing?.sheetDensity??650)*G/1000:0),deflectionRatio:material.wallDeflectionRatio??200,K:material.columnK??1});
    wall.mode=profile.mode;wall.reason=profile.reason;walls.push(wall);checks.push(...wall.checks.map(c=>({...c,id:`${profile.wallId}-${profile.level??1}-${c.id}`,wallId:profile.wallId,level:profile.level})));
    const corners=instances.filter(s=>s.role==='corner'&&(s.wallId===profile.wallId||s.wallIds?.includes(profile.wallId))&&(profile.level===undefined||(s.level??s.floor)===profile.level));
    if(corners.length){const over=corners.some(s=>(s.cutLength??s.length)>6+EPS);const check={id:`${profile.wallId}-${profile.level??1}-corner-package`,label:'Угловой пакет высокой стены',status:over?'fail':'unverified',note:'Ориентация досок, распределение реакции и совместная работа углового пакета не подтверждены; стандартная проверка рядовой стойки его не заменяет.'};wall.cornerStuds=corners.map(s=>({id:s.id,length:s.length,cutLength:s.cutLength??s.length,b:s.b,h:s.h}));wall.checks.push(check);checks.push({...check,wallId:profile.wallId,level:profile.level});if(over){wall.stockFits=false;wall.capacityPass=false;wall.status='fail';}}
  }
  return {walls,checks,assumptions:[...assumptions],sources:wallStabilitySources,capacityPass:walls.length>0&&walls.every(w=>w.capacityPass),status:checks.some(c=>c.status==='fail')?'fail':'unverified'};
}

export function evaluateWallSectionCandidates(input,catalog=['50x150','50x200','50x250']){
  const candidates=[];for(const item of catalog){const s=typeof item==='string'?section(item):item;if(!s)continue;const analysis=checkFullHeightWall({...input,studs:(input.studs??[]).map(stud=>({...stud,b:s.b,h:s.h,cutLength:undefined}))});if(analysis.errors.length)continue;candidates.push({section:`${s.b}x${s.h}`,b:s.b,h:s.h,capacityPass:analysis.capacityPass,analysis});}
  candidates.sort((a,b)=>Number(b.capacityPass)-Number(a.capacityPass)||a.b*a.h-b.b*b.h);return {candidates,acceptable:candidates.filter(c=>c.capacityPass),recommended:candidates.find(c=>c.capacityPass)??null,status:'unverified'};
}

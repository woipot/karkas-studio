import { deriveTimber, calculateMembers, memberDefaults, GRAVITY } from './members.js';
/**
 * КАРКАС · Concept-stage vertical load / beam model. All geometry in metres;
 * loads kN, kN/m² (kPa); wood properties N/mm² (MPa). Not a code design.
 */
export const defaultProject = {
  ...memberDefaults,
  name: 'Сканди · 96', length: 12, width: 8, height: 2.8, floors: 1,
  roofPitch: 25, snow: 1.5, wind: 0.3, floorDead: 0.6, liveLoad: 1.5,
  roofDead: 0.5, wallDead: 0.5, openingDead: 0.3,
  gammaG: 1.1, gammaQ: 1.4, pileCapacity: 40, pileSpacing: 2,
  joistB: 50, joistH: 250, E: 10000, bendingDesign: 13,
  joistStep: 0.6, joistSpan: 4, deflectionLimit: 300,
  studStep: 0.6, wallThickness: 0.15, internalBearing: true,
  openings: [
    {id:'o1',wall:'north',offset:1.2,width:1.8,height:1.5,sill:0.8,type:'window'},
    {id:'o2',wall:'north',offset:7.2,width:2.4,height:2.2,sill:0,type:'window'},
    {id:'o3',wall:'south',offset:2,width:1.8,height:1.5,sill:0.8,type:'window'},
    {id:'o4',wall:'south',offset:8.4,width:1,height:2.1,sill:0,type:'door'},
    {id:'o5',wall:'west',offset:3,width:1.5,height:1.5,sill:0.8,type:'window'},
    {id:'o6',wall:'east',offset:3,width:1.5,height:1.5,sill:0.8,type:'window'},
  ],
};

const bounds = {
  length:[3,40],width:[3,24],height:[2,4.5],floors:[1,2],roofPitch:[0,60],
  snow:[0,15],wind:[0,5],floorDead:[0,10],liveLoad:[0,15],roofDead:[0,10],
  wallDead:[0,10],openingDead:[0,10],gammaG:[1,2],gammaQ:[1,3],
  pileCapacity:[1,1000],pileSpacing:[0.5,6],joistB:[25,300],joistH:[75,600],
  E:[1000,30000],bendingDesign:[1,60],joistStep:[0.2,1.2],joistSpan:[0.5,12],
  deflectionLimit:[150,600],studStep:[0.2,1.2],wallThickness:[0.05,0.5],
  timberDensity:[100,1500],tensionDesign:[0.5,60],compressionDesign:[0.5,80],shearDesign:[0.1,20],
  studB:[25,150],braceB:[15,150],braceH:[50,300],braceBay:[0.6,6],stockLength:[2,12],
  lateralRestraint:[0.1,12],studRestraint:[0.2,4.5],columnK:[0.5,2],rafterB:[25,150],rafterH:[100,600],
};
const labels = {length:'Длина',width:'Ширина',height:'Высота этажа',floors:'Этажность',roofPitch:'Угол кровли',snow:'Снег',wind:'Ветер',floorDead:'Вес перекрытия',liveLoad:'Полезная нагрузка',roofDead:'Вес кровли',wallDead:'Вес стены',openingDead:'Вес заполнения проёмов',gammaG:'γG',gammaQ:'γQ',pileCapacity:'Допустимая нагрузка на сваю',pileSpacing:'Шаг свай',joistB:'Ширина балки',joistH:'Высота балки',E:'Модуль E',bendingDesign:'Сопротивление изгибу',joistStep:'Шаг балок',joistSpan:'Пролёт балки',deflectionLimit:'Предел прогиба',studStep:'Шаг стоек',wallThickness:'Толщина стены'};
Object.assign(labels,{timberDensity:'Плотность древесины',tensionDesign:'Сопротивление растяжению',compressionDesign:'Сопротивление сжатию',shearDesign:'Сопротивление сдвигу',studB:'Ширина стойки',braceB:'Толщина укосины',braceH:'Ширина укосины',braceBay:'Ширина ячейки X-связей',stockLength:'Длина сортимента',lateralRestraint:'Шаг раскрепления сжатой кромки',studRestraint:'Раскрепление слабой оси стойки',columnK:'Коэффициент эффективной длины K',rafterB:'Ширина стропила',rafterH:'Высота стропила'});
const finite = n => typeof n === 'number' && Number.isFinite(n);
const sum = xs => xs.reduce((a,b)=>a+b,0);
const between = (n,a,b) => finite(n) && n >= a && n <= b;

export function validateProject(input = {}) {
  const p={...defaultProject,...input};
  const errors=[], warnings=[];
  for(const [key,[min,max]] of Object.entries(bounds)) if(!between(p[key],min,max)) errors.push({field:key,message:`${labels[key]}: введите число от ${min} до ${max}.`});
  if(!Number.isInteger(p.floors)) errors.push({field:'floors',message:'Этажность: допустимы 1 или 2.'});
  if(typeof p.internalBearing!=='boolean') errors.push({field:'internalBearing',message:'Признак внутренней несущей стены должен быть true/false.'});
  if(typeof p.bracing!=='boolean') errors.push({field:'bracing',message:'Признак укосин должен быть true/false.'});
  if(!['california2','three3','closed4'].includes(p.cornerType))errors.push({field:'cornerType',message:'Угол: допустимы california2, three3 или closed4.'});
  if(p.cornerType==='closed4'&&p.wallThickness*1000<2*p.studB)errors.push({field:'cornerType',message:'Пакет из 4 досок требует глубину стены не менее двух толщин доски.'});
  if(p.studB>p.wallThickness*1000)errors.push({field:'studB',message:'Толщина стойки не должна превышать глубину стены: оси устойчивости заданы для доски b ≤ h.'});
  if(p.braceB>p.braceH)errors.push({field:'braceB',message:'Толщина укосины не должна превышать ширину доски.'});
  if(p.joistB>p.joistH)errors.push({field:'joistB',message:'Ширина балки не должна превышать её высоту в заданной схеме.'});
  if(p.rafterB>p.rafterH)errors.push({field:'rafterB',message:'Ширина стропила не должна превышать его высоту.'});
  if(typeof p.name!=='string'||p.name.length>160) errors.push({field:'name',message:'Название проекта: не более 160 символов.'});
  if(p.joistSpan>p.width) errors.push({field:'joistSpan',message:'Пролёт балки больше ширины дома.'});
  if(Math.abs(p.joistSpan-(p.internalBearing?p.width/2:p.width))>0.01) warnings.push('Расчётный пролёт отдельной балки отличается от расстояния между линиями опирания на модели. Эта проверка не подтверждает показанное перекрытие; проверьте направление и дополнительные опоры. Ведомость балок определяется геометрией дома.');
  const openings=Array.isArray(p.openings)?p.openings:[];
  if(!Array.isArray(p.openings)||openings.length>200) errors.push({field:'openings',message:'Проёмы: требуется массив до 200 элементов.'});
  const seen=new Set();
  for(let i=0;i<Math.min(openings.length,200);i++){
    const o=openings[i]; const field=`openings.${i}`;
    if(!o||typeof o!=='object'){errors.push({field,message:'Некорректный проём.'});continue;}
    if(typeof o.id!=='string'||!o.id||seen.has(o.id)) errors.push({field,message:'У каждого проёма должен быть уникальный ID.'});
    seen.add(o.id);
    const wallLength=['north','south'].includes(o.wall)?p.length:p.width;
    if(!['north','south','east','west'].includes(o.wall)) errors.push({field,message:'Неизвестная стена проёма.'});
    if(!['window','door'].includes(o.type)) errors.push({field,message:'Тип проёма: window или door.'});
    const floor=o.floor??1;
    if(!Number.isInteger(floor)||floor<1||floor>p.floors) errors.push({field,message:'Проём расположен на несуществующем этаже.'});
    if(!finite(o.offset)||!finite(o.width)||o.offset<0.1||o.width<0.2||o.offset+o.width>wallLength-0.1+1e-8) errors.push({field,message:`Проём ${i+1}: требуется не менее 0,1 м до углов и положительная ширина.`});
    if(!finite(o.height)||!finite(o.sill)||o.height<0.2||o.sill<0||o.sill+o.height>p.height-0.1+1e-8) errors.push({field,message:`Проём ${i+1}: верх должен быть ниже обвязки на 0,1 м.`});
    if(finite(o.sill)&&finite(o.height)&&o.sill+o.height>p.height-2*p.studB/1000-0.2+1e-8)errors.push({field,message:`Проём ${i+1}: для двух верхних обвязок и перемычки 200 мм недостаточно высоты.`});
    const cornerClearance=p.wallThickness+(['north','south'].includes(o.wall)?4:2)*p.studB/1000+0.01;
    if(finite(o.offset)&&finite(o.width)&&Math.min(o.offset,wallLength-o.offset-o.width)<cornerClearance-1e-8)errors.push({field,message:`Проём ${i+1}: отступ от угла должен быть не менее ${cornerClearance.toFixed(2)} м для пакета и стоек обрамления.`});
    for(let j=0;j<i;j++){
      const q=openings[j];if(!q||q.wall!==o.wall||(q.floor??1)!==floor)continue;
      if(o.offset<q.offset+q.width-1e-8&&o.offset+o.width>q.offset+1e-8&&o.sill<q.sill+q.height-1e-8&&o.sill+o.height>q.sill+1e-8) errors.push({field,message:`Проёмы ${j+1} и ${i+1} пересекаются.`});
      else if(o.offset<q.offset+q.width-1e-8&&o.offset+o.width>q.offset+1e-8)errors.push({field,message:`Проёмы ${j+1} и ${i+1}: несколько проёмов по высоте одного простенка не поддерживаются схемой каркаса.`});
      else if(Math.max(o.offset-q.offset-q.width,q.offset-o.offset-o.width)<4*p.studB/1000-1e-8)errors.push({field,message:`Проёмы ${j+1} и ${i+1}: промежуток должен быть не менее ${(4*p.studB/1000).toFixed(2)} м для двух пар стоек обрамления.`});
    }
  }
  if(p.roofPitch>30) warnings.push('Уменьшение μ допустимо в этой учебной схеме только при свободном сходе снега; снегозадержатели и заносы требуют отдельной модели.');
  if(p.floors===2) warnings.push('Для двух этажей показана предварительная нижняя стойка с накопленными нагрузками; локальные узлы межэтажной передачи усилий и пространственная устойчивость не проверены.');
  if(!p.bracing)warnings.push('X-связи отключены: сопротивление горизонтальным нагрузкам и пространственная устойчивость не подтверждены.');
  warnings.push('Вес слоёв перекрытия, кровли и стен задаётся БЕЗ древесины: масса всех досок из ведомости добавляется автоматически.');
  return {valid:errors.length===0,errors,warnings};
}

export const sources = [
  {title:'AWC · Span tables 2024: балки и прогиб',url:'https://web-media.awc.org/wp-content/uploads/2023/11/17210157/AWC_STJR2024_20231127_AWCWebsite.pdf'},
  {title:'AWC · Loads and span tables',url:'https://awc.org/resource-hub/span-table-tutorial'},
  {title:'JRC · Snow load shape coefficients',url:'https://eurocodes.jrc.ec.europa.eu/sites/default/files/2022-06/1_Views_from_ECEE.pdf'},
  {title:'SFPA · Continuous load path',url:'https://www.southernpine.com/using-southern-pine/residential/raised-wood-floor-foundations/foundation-preparation/'},
];

const assumptions = [
  'Концептуальная модель, не расчёт по СП/Eurocode и не разрешение на строительство. Коэффициенты γG и γQ — вводимые сценарные параметры, а не автоматически выбранные нормативные сочетания.',
  'Прямоугольный дом без консолей; симметричная двускатная кровля, конёк вдоль длины. Вес кровли задан на фактическую площадь, снег — на горизонтальную проекцию.',
  'Высота H задаёт высоту стенового модуля. Шаг этажей H + tпер, где tпер = высота балки + 35 мм настила; стены и верхнее перекрытие не перекрываются. Высота карниза/конька дана над низом нижнего перекрытия, без 0,72 м основания. Для ветра учтены межэтажные торцы, площадь слоёв стен остаётся P×H×этажи.',
  'Учитывается только равномерный сбалансированный снег: μ=0,8 при α≤30°, μ=0,8(60−α)/30 выше 30°. Ce=Ct=1. Заносы, мешки и несимметричные случаи не проверены.',
  'Вертикальные реакции свай: перекрытия распределены по грузовым площадям сетки; кровля и снег переданы на две длинные стены; собственный вес стен — на соответствующие ряды. Это идеализированная передача через ростверк без расчёта его жёсткости.',
  'Допустимую нагрузку на сваю задаёт пользователь по геологии и данным проектировщика. Несущая способность грунта, осадка, групповая работа, морозное пучение и длина свай не определяются.',
  'Ветер показан отдельной горизонтальной силой p×A фасада. Он не включён в вертикальные реакции: отрыв, опрокидывание, анкеры, связи и пространственная жёсткость требуют отдельного расчёта.',
  'Балка перекрытия: шарнирное опирание, равномерная нагрузка, упругий изгиб. Проверяются изгиб, сдвиг и мгновенный прогиб от полной эксплуатационной нагрузки; вибрации, ползучесть, опорное смятие и соединения не проверяются.',
  'Вводимые веса слоёв перекрытия, кровли и стен НЕ содержат древесину. Каждая доска из единой геометрической ведомости добавляет собственный вес ρ×b×h×L×g. Запас закупки не увеличивает вес дома.',
];

const gridAxis=(length,spacing)=>Array.from({length:Math.ceil(length/spacing)+1},(_,i)=>length*i/Math.ceil(length/spacing));
const tributary=(axis,i)=>((i?axis[i]-axis[i-1]:0)+(i<axis.length-1?axis[i+1]-axis[i]:0))/2;

/** Integrate a uniform line load over [a,b] with linear nodal load sharing. */
function lineShare(axis,a,b,load,add){
  for(let i=0;i<axis.length-1;i++){
    const x0=axis[i],x1=axis[i+1],left=Math.max(a,x0),right=Math.min(b,x1);
    if(right<=left)continue;
    const dx=x1-x0;
    const rightWeight=((right-x0)**2-(left-x0)**2)/(2*dx);
    add(i,load*((right-left)-rightWeight));add(i+1,load*rightWeight);
  }
}
function pointShare(axis,position,force,add){
  const s=Math.max(axis[0],Math.min(axis.at(-1),position));
  let i=axis.findIndex((x,j)=>j<axis.length-1&&s<=axis[j+1]+1e-8);
  if(i<0)i=axis.length-2;
  const t=(s-axis[i])/(axis[i+1]-axis[i]);
  add(i,force*(1-t));add(i+1,force*t);
}

export function calculate(input={}){
  const p={...defaultProject,...input};
  const validation=validateProject(p);
  if(!validation.valid){const e=new Error(validation.errors.map(x=>x.message).join('\n'));e.name='ProjectValidationError';e.validation=validation;throw e;}
  const timber=deriveTimber(p);
  const {length:L,width:W,height:H,floors:F}=p;
  const floorThickness=p.joistH/1000+0.035,storeyPitch=H+floorThickness,facadeHeight=F*H+(F-1)*floorThickness;
  const A=L*W,P=2*(L+W),rise=W/2*Math.tan(p.roofPitch*Math.PI/180);
  const roofArea=A/Math.cos(p.roofPitch*Math.PI/180);
  const openingArea=sum(p.openings.map(o=>o.width*o.height));
  const gableArea=W*rise;
  const grossWallArea=P*H*F+gableArea,netWallArea=grossWallArea-openingArea;
  const innerWallArea=p.internalBearing?L*H*F:0;
  const mu=p.roofPitch<=30?0.8:Math.max(0,0.8*(60-p.roofPitch)/30);
  const timberFloorPressure=timber.totals.floor.weight/(A*F);
  const timberGableWeight=sum(timber.instances.filter(x=>x.role==='gable').map(x=>x.mass))*GRAVITY/1000;
  const timberRoofWeight=timber.totals.roof.weight-timberGableWeight;
  const floorWeight=A*F*p.floorDead+timber.totals.floor.weight,roofWeight=roofArea*p.roofDead+timberRoofWeight;
  const wallWeight=netWallArea*p.wallDead,openingWeight=openingArea*p.openingDead;
  const innerWallWeight=innerWallArea*p.wallDead,live=A*F*p.liveLoad,snow=A*p.snow*mu;
  const dead=A*F*p.floorDead+roofArea*p.roofDead+wallWeight+openingWeight+innerWallWeight+timber.weight;
  const totalCharacteristic=dead+live+snow,totalDesign=dead*p.gammaG+(live+snow)*p.gammaQ;
  const rows=[
    {id:'floor',label:'Слои перекрытий без древесины',kind:'dead',area:A*F,value:p.floorDead,characteristic:A*F*p.floorDead,formula:'A × этажи × gпер (без досок)'},
    {id:'roof',label:'Слои кровли без древесины',kind:'dead',area:roofArea,value:p.roofDead,characteristic:roofArea*p.roofDead,formula:'A / cos(α) × gкр (без досок)'},
    {id:'walls',label:'Слои наружных стен без древесины',kind:'dead',area:netWallArea,value:p.wallDead,characteristic:wallWeight,formula:'(P × h × этажи + фронтоны − проёмы) × gст'},
    {id:'openings',label:'Окна и двери',kind:'dead',area:openingArea,value:p.openingDead,characteristic:openingWeight,formula:'Σ(b × h) × gзап'},
    {id:'inner',label:'Внутренняя несущая',kind:'dead',area:innerWallArea,value:p.wallDead,characteristic:innerWallWeight,formula:'L × h × этажи × gст'},
    ...['walls','floor','roof','bracing'].map(category=>({id:`timber-${category}`,label:{walls:'Древесина стен и узлов',floor:'Древесина перекрытий',roof:'Древесина кровли и фронтонов',bracing:'Древесина укосин'}[category],kind:'dead',area:timber.totals[category].volume,value:p.timberDensity*GRAVITY/1000,characteristic:timber.totals[category].weight,formula:'Σ(b × h × L) × ρ × g / 1000'})),
    {id:'live',label:'Полезная нагрузка',kind:'variable',area:A*F,value:p.liveLoad,characteristic:live,formula:'A × этажи × qпол'},
    {id:'snow',label:'Снег на кровле',kind:'variable',area:A,value:p.snow*mu,characteristic:snow,formula:'A × s × μ (Ce=Ct=1)'},
  ].map(r=>({...r,design:r.characteristic*(r.kind==='dead'?p.gammaG:p.gammaQ)}));

  const xs=gridAxis(L,p.pileSpacing),ys=gridAxis(W,p.pileSpacing);
  if(p.internalBearing&&!ys.some(y=>Math.abs(y-W/2)<1e-8))ys.push(W/2);
  ys.sort((a,b)=>a-b);
  const piles=[];
  ys.forEach((y,j)=>xs.forEach((x,i)=>{
    const area=tributary(xs,i)*tributary(ys,j);
    piles.push({id:`С${String(piles.length+1).padStart(2,'0')}`,x,y,i,j,tributaryArea:area,
      reactionCharacteristic:area*F*(p.floorDead+timberFloorPressure+p.liveLoad),reaction:area*F*((p.floorDead+timberFloorPressure)*p.gammaG+p.liveLoad*p.gammaQ)});
  }));
  const add=(i,j,value,gamma)=>{const pile=piles[j*xs.length+i];pile.reactionCharacteristic+=value;pile.reaction+=value*gamma;};
  const addWall=(wall,a,b,q,gamma)=>{
    const isLong=['north','south'].includes(wall),axis=isLong?xs:ys;
    lineShare(axis,a,b,q,(i,v)=>isLong?add(i,wall==='north'?0:ys.length-1,v,gamma):add(wall==='west'?0:xs.length-1,i,v,gamma));
  };
  for(const wall of ['north','south','west','east']){
    const length=['north','south'].includes(wall)?L:W;
    addWall(wall,0,length,H*F*p.wallDead,p.gammaG);
    for(const o of p.openings.filter(o=>o.wall===wall))addWall(wall,o.offset,o.offset+o.width,o.height*(p.openingDead-p.wallDead),p.gammaG);
  }
  // Each gable is a triangular wall; its total weight is smeared along the end beam.
  for(const wall of ['west','east'])addWall(wall,0,W,gableArea*p.wallDead/(2*W),p.gammaG);
  for(const wall of ['north','south']){
    addWall(wall,0,L,roofWeight/(2*L),p.gammaG);
    addWall(wall,0,L,snow/(2*L),p.gammaQ);
  }
  if(p.internalBearing){const j=ys.findIndex(y=>Math.abs(y-W/2)<1e-8);lineShare(xs,0,L,H*F*p.wallDead,(i,v)=>add(i,j,v,p.gammaG));}
  // Each board's own weight follows its location: point loads for studs and
  // uniform projected loads for horizontal/diagonal pieces, via ideal edge beams.
  const timberWall=(wall,a,b,weight)=>{
    const isLong=['north','south'].includes(wall),axis=isLong?xs:ys;
    const apply=(i,v)=>isLong?add(i,wall==='north'?0:ys.length-1,v,p.gammaG):add(wall==='west'?0:xs.length-1,i,v,p.gammaG);
    if(Math.abs(b-a)<1e-8)pointShare(axis,a,weight,apply);
    else lineShare(axis,Math.min(a,b),Math.max(a,b),weight/Math.abs(b-a),apply);
  };
  for(const board of timber.instances.filter(x=>['walls','bracing'].includes(x.category)||x.role==='gable')){
    const weight=board.mass*GRAVITY/1000;
    if(board.wall==='inner'){
      const j=ys.findIndex(y=>Math.abs(y-W/2)<1e-8),a=board.start[0],b=board.end[0];
      if(Math.abs(a-b)<1e-8)pointShare(xs,a,weight,(i,v)=>add(i,j,v,p.gammaG));
      else lineShare(xs,Math.min(a,b),Math.max(a,b),weight/Math.abs(a-b),(i,v)=>add(i,j,v,p.gammaG));
    }else if(board.wall){
      const coordinate=['north','south'].includes(board.wall)?0:2;
      timberWall(board.wall,board.start[coordinate],board.end[coordinate],weight);
    }else if(board.corner){
      for(const wall of [board.corner.includes('w')?'west':'east',board.corner.includes('n')?'north':'south']){
        const s=['north','south'].includes(wall)?board.start[0]:board.start[2];timberWall(wall,s,s,weight/2);
      }
    }
  }
  for(const pile of piles){pile.utilization=pile.reaction/p.pileCapacity;pile.status=pile.utilization>1?'fail':pile.utilization>0.85?'warning':'pass';}
  const maxPile=piles.reduce((a,b)=>a.reaction>b.reaction?a:b);
  const reactionSum=sum(piles.map(x=>x.reaction));
  const characteristicSum=sum(piles.map(x=>x.reactionCharacteristic));
  const balanceError=reactionSum-totalDesign;
  const wService=(p.floorDead+timberFloorPressure+p.liveLoad)*p.joistStep;
  const wDesign=((p.floorDead+timberFloorPressure)*p.gammaG+p.liveLoad*p.gammaQ)*p.joistStep;
  const I=p.joistB*p.joistH**3/12,Z=p.joistB*p.joistH**2/6,spanMM=p.joistSpan*1000;
  const moment=wDesign*p.joistSpan**2/8,stress=moment*1e6/Z;
  const deflection=5*wService*spanMM**4/(384*p.E*I);
  const deflectionLive=5*(p.liveLoad*p.joistStep)*spanMM**4/(384*p.E*I);
  const deflectionAllowed=spanMM/p.deflectionLimit;
  const bendingUtilization=stress/p.bendingDesign,deflectionUtilization=deflection/deflectionAllowed;
  const joist={lineLoadService:wService,lineLoadDesign:wDesign,I,Z,moment,shear:wDesign*p.joistSpan/2,stress,deflection,deflectionLive,deflectionAllowed,bendingUtilization,deflectionUtilization,utilization:Math.max(bendingUtilization,deflectionUtilization),status:Math.max(bendingUtilization,deflectionUtilization)>1?'fail':'pass'};
  const take=roles=>timber.instances.filter(x=>roles.includes(x.role));
  const studs=take(['stud','king','jack','cripple','corner']);
  const studCount=studs.length,studVolume=sum(studs.map(x=>x.volume));
  const plates=take(['plate']),plateLength=sum(plates.map(x=>x.length)),plateVolume=sum(plates.map(x=>x.volume));
  const joists=take(['joist']),joistCount=joists.length,joistLength=sum(joists.map(x=>x.length)),joistVolume=sum(joists.map(x=>x.volume));
  const rafters=take(['rafter']),rafterPairs=rafters.length/2,rafterLength=sum(rafters.map(x=>x.length)),rafterVolume=sum(rafters.map(x=>x.volume));
  const timberVolume=timber.volume;
  const bom={studCount,studVolume,plateLength,plateVolume,joistCount,joistLength,joistVolume,rafterPairs,rafterLength,rafterVolume,timberVolume,timberWithWaste:timberVolume*1.1,sheathingArea:netWallArea+A*F,insulationVolume:netWallArea*p.wallThickness,roofArea,pileCount:piles.length,wasteFactor:1.1,
    rows:[{name:`Стойки ${p.studB} × `+Math.round(p.wallThickness*1000),unit:'шт.',quantity:studCount,note:'Из фактической ведомости рядовых, угловых и проёмных стоек'},
      {name:`Обвязка ${p.studB} × `+Math.round(p.wallThickness*1000),unit:'пог. м',quantity:plateLength,note:'Три пояса на этаж; нижние прерваны в дверях'},
      {name:`Балки ${p.joistB} × ${p.joistH}`,unit:'пог. м',quantity:joistLength,note:'Геометрическая длина между внутренними гранями торцевых досок; при центральной опоре стык в середине. Проверочный пролёт задаётся отдельно.'},
      {name:`Стропила ${p.rafterB} × ${p.rafterH}`,unit:'пог. м',quantity:rafterLength,note:'Длина по геометрии ската, без свесов и припусков'},
      {name:'Древесина с запасом 10%',unit:'м³',quantity:timberVolume*1.1,note:'Все доски из единой ведомости; запас не входит в вес дома'},
      {name:'Обшивка стен и перекрытий',unit:'м²',quantity:netWallArea+A*F,note:'Один слой; без запаса'},
      {name:'Утеплитель наружных стен',unit:'м³',quantity:netWallArea*p.wallThickness,note:'Геометрический объём; без вычета древесины'},
      {name:'Кровельное покрытие',unit:'м²',quantity:roofArea,note:'Без свесов и запаса'},
      {name:'Сваи',unit:'шт.',quantity:piles.length,note:'Длина и тип не определены'}]};
  const checks=[
    {id:'bending',label:'Изгиб балки',utilization:bendingUtilization,status:bendingUtilization<=1?'pass':'fail',value:stress,limit:p.bendingDesign,unit:'МПа'},
    {id:'deflection',label:'Мгновенный прогиб',utilization:deflectionUtilization,status:deflectionUtilization<=1?'pass':'fail',value:deflection,limit:deflectionAllowed,unit:'мм'},
    {id:'piles',label:'Вертикальная нагрузка на сваю',utilization:maxPile.utilization,status:maxPile.utilization<=1?'pass':'fail',value:maxPile.reaction,limit:p.pileCapacity,unit:'кН'},
    {id:'balance',label:'Баланс вертикальных сил',status:Math.abs(balanceError)<1e-7?'pass':'fail',value:Math.abs(balanceError),limit:1e-7,unit:'кН'},
  ];
  const result={
    project:p,validation,geometry:{area:A,totalFloorArea:A*F,perimeter:P,roofArea,ridgeHeight:storeyPitch*F+rise,eaveHeight:storeyPitch*F,facadeHeight,storeyPitch,floorThickness,rise,grossWallArea,netWallArea,openingArea,innerWallArea},
    loads:{rows,dead,live,snow,mu,roofSnow:p.snow*mu,totalCharacteristic,totalDesign,floorWeight,roofWeight,wallWeight,openingWeight,innerWallWeight,timberFloorPressure,timberWeight:timber.weight,windForceX:p.wind*(W*facadeHeight+gableArea/2),windForceY:p.wind*L*facadeHeight,windPressure:p.wind},
    joist,piles,foundation:{count:piles.length,xCount:xs.length,yCount:ys.length,xs,ys,maxPile,maxReaction:maxPile.reaction,minReaction:Math.min(...piles.map(x=>x.reaction)),utilization:maxPile.utilization,reactionSum,characteristicSum,balanceError,actualSpacingX:L/(xs.length-1),actualSpacingY:Math.max(...ys.slice(1).map((y,i)=>y-ys[i])),status:maxPile.utilization<=1?'pass':'fail'},
    bom,timber,checks,assumptions:[...assumptions,...timber.assumptions],sources,status:checks.some(x=>x.status==='fail')?'fail':'warning',
  };
  result.members=calculateMembers(p,result,timber);
  Object.assign(result.joist,result.members.joist,{shearStress:result.members.shear.stress,shearUtilization:result.members.shear.utilization});
  result.joist.utilization=Math.max(result.joist.utilization,result.members.shear.utilization);
  result.joist.status=result.joist.utilization>1?'fail':'pass';
  result.checks.push(...result.members.checks);
  result.assumptions.push(...result.members.assumptions);
  result.sources=[...sources,...result.members.sources];
  if(result.checks.some(x=>x.status==='fail'))result.status='fail';
  if(timber.overStock.length)result.validation.warnings.push(`${timber.overStock.length} досок длиннее сортимента ${p.stockLength} м. Они не разрезаны: требуется другое изделие или расчётный стык.`);
  if(result.members.bracing.missing.length)result.validation.warnings.push('На части стен нет непрерывного простенка заданной ширины для X-связей. Пространственная устойчивость не подтверждена.');
  return result;
}

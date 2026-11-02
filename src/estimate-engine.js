import {parseSection} from './catalog.js';
import {calculateCutting} from './cutting.js';
import {defaultPrices} from './prices.js';
export {defaultPrices} from './prices.js';
const numeric=(v,fallback=0)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:fallback;
const sum=a=>a.reduce((x,y)=>x+y,0);
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const fmt=(n,d=2)=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:d});
export function resolvePrices(input={}){
  const p={};
  for(const [key,fallback] of Object.entries(defaultPrices))if(key!=='sectionPrices'){
    const value=numeric(input?.[key],fallback),maximum=key.endsWith('Percent')?300:1e9;
    p[key]=value<=maximum?value:fallback;
  }
  p.sectionPrices={};
  if(input?.sectionPrices&&typeof input.sectionPrices==='object')for(const [id,value] of Object.entries(input.sectionPrices)){
    if(Number.isFinite(value)&&value>=0&&value<=1e9)p.sectionPrices[id]=value;
  }
  return p;
}

/** Geometry-based preliminary procurement estimate, no market-price claims. */
export function calculateEstimate(project={},result={},precomputedCutting){
  const prices=resolvePrices(project.prices),factor=1+prices.wastePercent/100;
  const geo=result.geometry??{},bom=result.bom??{},timber=result.timber??{};
  const groups=new Map();
  function addTimber(b,h,volume,count=0){
    if(!(numeric(volume)>0))return;
    const dims=Number.isFinite(b)&&Number.isFinite(h)&&b>0&&h>0?[Math.min(b,h),Math.max(b,h)]:null;
    const id=dims?`${Number(dims[0].toFixed(3))}x${Number(dims[1].toFixed(3))}`:'other';
    const group=groups.get(id)??{id,b:dims?.[0],h:dims?.[1],netVolume:0,count:0};
    group.netVolume+=volume;group.count+=numeric(count);groups.set(id,group);
  }
  const source=Array.isArray(timber.instances)?timber.instances:Array.isArray(timber.schedule)?timber.schedule:null;
  if(source){
    for(const board of source){
      const parsed=parseSection(board.section??'');
      const b=board.b??parsed?.b,h=board.h??parsed?.h;
      const count=Array.isArray(timber.instances)?1:numeric(board.count,1);
      const volume=numeric(board.volume,numeric(b)*numeric(h)/1e6*numeric(board.length)*count);
      addTimber(b,h,volume,count);
    }
  }else{
    // Compatibility for older takeoffs without individual pieces. No new boards
    // are invented: only existing category volumes are regrouped by section.
    addTimber(project.studB,project.wallThickness*1000,numeric(bom.studVolume)+numeric(bom.plateVolume));
    addTimber(project.joistB,project.joistH,numeric(bom.joistVolume));
    addTimber(project.rafterB,project.rafterH,numeric(bom.rafterVolume));
    const accounted=sum([...groups.values()].map(g=>g.netVolume));
    addTimber(null,null,Math.max(0,numeric(bom.timberVolume)-accounted));
  }
  const rows=[],density=numeric(project.timberDensity,numeric(project.material?.density,500));
  const cutting=Array.isArray(timber.instances)?(precomputedCutting??calculateCutting(project,result)):null;
  const timberGroups=[...groups.values()].sort((a,b)=>(a.b??Infinity)-(b.b??Infinity)||(a.h??0)-(b.h??0));
  for(const group of timberGroups){
    const unitPrice=prices.sectionPrices[group.id]??prices.timberM3;
    const layout=cutting?.groups.find(g=>g.section===group.id);
    const modelVolume=group.netVolume;
    if(cutting)group.netVolume=layout?.usedVolume??0;
    const quantity=cutting?(layout?.purchasedVolume??0):group.netVolume*factor;
    const unplaced=cutting?.overlength.filter(p=>p.section===group.id).length??0;
    Object.assign(group,{procurementVolume:quantity,modelVolume,mass:modelVolume*density,unitPrice,total:money(quantity*unitPrice),boards:layout?.boards??null});
    rows.push({id:`timber-${group.id}`,name:group.b?`Пиломатериал ${fmt(group.b)} × ${fmt(group.h)} мм`:'Пиломатериал · прочие сечения',
      category:'timber',unit:'м³',netQuantity:group.netVolume,quantity,unitPrice,total:group.total,
      wasteQuantity:quantity-group.netVolume,wasteCost:money((quantity-group.netVolume)*unitPrice),
      editableKey:`sectionPrices.${group.id}`,sectionId:group.id,
      note:cutting?`${layout?.boards??0} досок × 6 м по карте раскроя; заготовки ${fmt(group.netVolume,3)} м³.${unplaced?` Не размещено деталей: ${unplaced}; их стоимость отсутствует.`:''} Процентный запас поверх раскроя не добавляется.`:`Геометрия ${fmt(group.netVolume,3)} м³; закупка с запасом ${fmt(prices.wastePercent)}%. Фактическое сечение уточняется.`});
  }
  const netTimber=sum(timberGroups.map(g=>g.netVolume));
  function add(id,name,unit,netQuantity,key,waste=false,note=''){
    const net=numeric(netQuantity),quantity=net*(waste?factor:1),unitPrice=prices[key];
    rows.push({id,name,category:'material',unit,netQuantity:net,quantity,unitPrice,total:money(quantity*unitPrice),
      editableKey:key,wasteQuantity:quantity-net,wasteCost:money((quantity-net)*unitPrice),note});
  }
  const resultWalls=Array.isArray(result.walls)?result.walls:[];
  const derivedWallArea=sum(resultWalls.filter(w=>w.kind==='exterior').map(w=>Math.max(0,numeric(w.length)*numeric(w.height,numeric(project.height))*numeric(project.floors,1)-numeric(w.openingArea))));
  const netWall=numeric(geo.netWallArea,derivedWallArea);
  const floorArea=numeric(geo.totalFloorArea,numeric(geo.area)*numeric(project.floors,1));
  const sheathing=numeric(bom.sheathingArea,netWall+floorArea);
  const roofArea=numeric(geo.roofArea,numeric(bom.roofArea));
  const openings=Array.isArray(project.openings)?project.openings:[];
  const windowArea=sum(openings.filter(o=>o.type==='window').map(o=>numeric(o.width)*numeric(o.height)));
  const doorCount=openings.filter(o=>o.type==='door').length;
  const pileCount=Array.isArray(result.piles)?result.piles.length:numeric(bom.pileCount);
  const wallPanels=result.bracingModel?.method==='sheathing'||project.bracing?.method==='sheathing'&&result.bracingModel;
  add('sheathing',wallPanels?'Обшивка перекрытий':'Обшивка стен и перекрытий','м²',wallPanels?floorArea:sheathing,'sheathingM2',true,wallPanels?'Один слой перекрытий. Структурные плиты стен посчитаны отдельно по листам.':'Один слой: наружные стены без проёмов + площадь перекрытий.');
  if(wallPanels){const q=result.bracingModel.quantities??{};add('structural-panels','Структурная обшивка стен · листы','м² листа',q.purchasedSheetArea??q.sheetArea,'bracingSheetM2',false,`${q.sheets??0} листов по сетке раскладки. Отходы уже в закупочной площади; процентный запас повторно не добавлен. Крепёж и сертифицированная несущая способность уточняются.`);}

  add('insulation','Утепление наружных стен','м²',netWall,'insulationM2',true,project.wallThickness?`Расценка за м² при толщине ${fmt(numeric(project.wallThickness)*1000,0)} мм; без вычета древесины.`:'Расценка за м² наружной стены; состав и толщину утепления уточните в цене. Без вычета древесины.');
  add('roof','Кровельное покрытие','м²',roofArea,'roofM2',true,'Площадь скатов модели; свесы и подкладочные слои не добавляются. Водоотвод и примыкания вынесены отдельными строками.');
  const drainage=result.roofModel?.drainage??result.drainage;
  if(drainage){const q=drainage.quantities??{};
    add('roof-gutters','Карнизные желоба','м',q.gutterLength,'gutterM',true,'По схеме стока. Профиль, кронштейны и пропускная способность подбираются отдельно.');
    add('roof-downpipes','Водосточные трубы','м',q.downpipeLength,'downpipeM',true,`Геометрические трассы: ${q.downpipeCount??0} шт. Отвод от основания и ливневая сеть оцениваются отдельно.`);
    add('roof-flashing','Фартуки примыкания к стенам','м',q.flashingLength,'flashingM',true,'Развёртка, нахлёсты и крепление по системе кровли. Длина линии примыкания из 3D.');
    add('roof-valleys','Ендовы','м',q.valleyLength,'valleyM',true,'Длина по пересечению скатов. Рабочая ширина, гидроизоляция и подогрев уточняются.');
  }
  add('piles','Сваи','шт.',pileCount,'pileEach',false,'Количество опор из свайного поля. Тип, длина и состав единичной расценки уточняются.');
  add('windows','Окна','м²',windowArea,'windowsM2',false,'Сумма площадей оконных проёмов; конфигурация и монтаж отдельно не моделируются.');
  add('doors','Двери','шт.',doorCount,'doorsEach',false,'Количество дверных проёмов модели.');
  add('fasteners','Крепёж · укрупнённая оценка','м³ каркаса',netTimber,'fastenersM3',false,'Условная расценка на м³ установленной древесины; состав и расчёт соединений отсутствуют.');
  const materialTotal=money(sum(rows.map(r=>r.total)));
  const laborTotal=money(materialTotal*prices.laborPercent/100);
  const reserve=money((materialTotal+laborTotal)*prices.contingencyPercent/100);
  const total=money(materialTotal+laborTotal+reserve);
  const procurementTimberVolume=sum(timberGroups.map(g=>g.procurementVolume));
  return {rows,prices,timberGroups,materialTotal,materialsTotal:materialTotal,laborTotal,reserve,contingencyTotal:reserve,total,
    netTimberVolume:netTimber,procurementTimberVolume,cutting,complete:geo.closed!==false&&(cutting?cutting.summary.complete:true),
    waste:{percent:prices.wastePercent,timberVolume:procurementTimberVolume-netTimber,materialCost:money(sum(rows.map(r=>r.wasteCost)))},
    wasteTotal:money(sum(rows.map(r=>r.wasteCost))),
    assumptions:[
      'Все цены — редактируемый пример, не рыночная котировка и не коммерческое предложение.',
      cutting?'Древесина закупается по полной карте шестиметровых досок. Остатки и пропилы уже входят в её цену; процентный запас повторно не добавляется.':`Запас ${fmt(prices.wastePercent)}% включён в древесину; для старой ведомости без отдельных деталей карта раскроя недоступна.`,
      `Запас ${fmt(prices.wastePercent)}% добавляется к обшивке, утеплению и кровельному покрытию.`,
      `Работы = ${fmt(prices.laborPercent)}% от материалов; резерв = ${fmt(prices.contingencyPercent)}% от материалов и работ.`,
      'Смета ограничена перечисленными позициями. Земля, изыскания, проектирование, доставка, инженерные системы, отделка и специальные узлы отдельно не оценены.',
      'Расценки принимаются конечными в рублях. Налоговые надбавки и индексация автоматически не добавляются.',
    ]};
}

/** Semicolon CSV with BOM, real CRLFs, quoted cells and units for spreadsheet use. */
export function estimateRowsToCSV(estimate,projectName='Проект КАРКАС'){
  const e=Array.isArray(estimate)?{rows:estimate}:estimate;
  const data=[['КАРКАС · предварительная смета',projectName],['Цены примера — замените на ваши'],
    ['Позиция','Количество в модели','Закупочное количество','Единица','Цена, ₽/ед.','Сумма, ₽','Примечание'],
    ...(e.rows??[]).map(r=>[r.name,r.netQuantity??r.quantity,r.quantity,r.unit,r.unitPrice,r.total,r.note??'']),
    [],['Материалы, ₽',e.materialTotal??sum((e.rows??[]).map(r=>r.total))],['Работы, ₽',e.laborTotal??0],['Резерв, ₽',e.reserve??0],['Итого, ₽',e.total??sum((e.rows??[]).map(r=>r.total))],
    ['Ограничение','Предварительная смета по геометрии; не коммерческое предложение']];
  const quote=value=>{
    let text=String(value??'');
    if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return '\uFEFF'+data.map(row=>row.map(quote).join(';')).join('\r\n');
}


/** КАРКАС Designer — geometric concept model, not a code-design or FEA solver.
 * Plan coordinates and lengths: m. Sections: mm. Mass: kg. Forces: kN.
 * Wall coordinates are axes; areas are gross areas enclosed by exterior axes.
 */
const G=9.80665,EPS=1e-7;
const clone=x=>JSON.parse(JSON.stringify(x));
const sum=a=>a.reduce((s,x)=>s+x,0);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const point=p=>object(p)&&finite(p.x)&&finite(p.y);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const coord=x=>Math.round(x*1e6)/1e6;
const nodeKey=p=>`${coord(p.x)}_${coord(p.y)}`;
const sections=/^(\d{2,3})[x×](\d{2,3})$/;
export function parseSection(value){
  const m=typeof value==='string'&&value.replaceAll(' ','').match(sections);
  if(!m)return null;
  const b=Number(m[1]),h=Number(m[2]);
  return b>=15&&b<=300&&h>=b&&h<=600?{b,h}:null;
}
export const defaultDesignerProject={
  version:2,name:'Сканди · свободный план',height:2.8,floors:1,grid:.25,
  walls:[
    {id:'w-north',a:{x:0,y:0},b:{x:12,y:0},kind:'exterior',section:'50x150',studStep:.6},
    {id:'w-east',a:{x:12,y:0},b:{x:12,y:8},kind:'exterior',section:'50x150',studStep:.6},
    {id:'w-south',a:{x:12,y:8},b:{x:0,y:8},kind:'exterior',section:'50x150',studStep:.6},
    {id:'w-west',a:{x:0,y:8},b:{x:0,y:0},kind:'exterior',section:'50x150',studStep:.6},
    {id:'w-inner',a:{x:0,y:4},b:{x:12,y:4},kind:'bearing',section:'50x150',studStep:.6},
  ],
  openings:[
    {id:'o1',wallId:'w-north',offset:1.2,width:1.8,height:1.5,sill:.8,type:'window'},
    {id:'o2',wallId:'w-north',offset:7.2,width:2.4,height:2.2,sill:0,type:'window'},
    {id:'o3',wallId:'w-south',offset:8.2,width:1.8,height:1.5,sill:.8,type:'window'},
    {id:'o4',wallId:'w-south',offset:2.6,width:1,height:2.1,sill:0,type:'door'},
    {id:'o5',wallId:'w-west',offset:3.5,width:1.5,height:1.5,sill:.8,type:'window'},
    {id:'o6',wallId:'w-east',offset:3,width:1.5,height:1.5,sill:.8,type:'window'},
  ],
  roof:{type:'fink',pitch:25,spacing:.6,chordSection:'50x150',webSection:'50x100'},
  floor:{section:'50x250',spacing:.6,axis:'y'},
  material:{density:500,E:10000,Fb:13,Ft:8,Fc:12},
  loads:{floorDead:.6,live:1.5,roofDead:.5,wallDead:.5,openingDead:.3,snow:1.5,wind:.3,gammaG:1.1,gammaQ:1.4},
  foundation:{spacing:2,capacity:40},
  joints:{defaultCorner:'california2',defaultCut:'butt',overrides:{},spliceScheme:'halfLap',spliceLength:.4},
  cutting:{stockLength:6,kerf:3,minReusable:.3},objects:[],boardCuts:{},levels:[],voids:[],
  // The estimate module supplies illustrative editable defaults. Empty here so
  // geometry defaults cannot silently overwrite its current pricing schema.
  prices:{},
};

function normalized(input){
  return {...input,floor:input?.floor===undefined?{...defaultDesignerProject.floor}:object(input.floor)?{...defaultDesignerProject.floor,...input.floor}:input.floor,cutting:input?.cutting===undefined?{...defaultDesignerProject.cutting}:object(input.cutting)?{...defaultDesignerProject.cutting,...input.cutting}:input.cutting,loads:object(input?.loads)?{wallDead:.5,openingDead:.3,...input.loads}:input?.loads,objects:input?.objects===undefined?[]:input.objects,boardCuts:input?.boardCuts===undefined?{}:input.boardCuts,levels:input?.levels===undefined?[]:input.levels,voids:input?.voids===undefined?[]:input.voids,joints:object(input?.joints)?{spliceScheme:'halfLap',spliceLength:.4,...input.joints}:input?.joints};
}
function segmentHit(a,b,c,d){
  const u=sub(b,a),v=sub(d,c),ca=sub(c,a),den=cross(u,v);
  if(Math.abs(den)<EPS)return null;
  const t=cross(ca,v)/den,s=cross(ca,u)/den;
  return t>=-EPS&&t<=1+EPS&&s>=-EPS&&s<=1+EPS?{t:Math.max(0,Math.min(1,t)),s:Math.max(0,Math.min(1,s)),point:lerp(a,b,t)}:null;
}
function parameter(p,a,b){const v=sub(b,a);return dot(sub(p,a),v)/dot(v,v);}
function onSegment(p,a,b,tol=EPS){
  const v=sub(b,a),len=dist(a,b);if(len<EPS)return dist(p,a)<tol;
  const t=parameter(p,a,b);
  return t>=-tol&&t<=1+tol&&Math.abs(cross(sub(p,a),v))/len<tol;
}
function collinearOverlap(a,b,c,d){
  if(!onSegment(c,a,b,1e10))return false;
  const u=sub(b,a),v=sub(d,c);
  if(Math.abs(cross(u,v))>EPS*dist(a,b)*dist(c,d)||Math.abs(cross(sub(c,a),u))>EPS*dist(a,b))return false;
  const t0=parameter(c,a,b),t1=parameter(d,a,b);
  return Math.min(1,Math.max(t0,t1))-Math.max(0,Math.min(t0,t1))>EPS;
}

export function validateDesignerProject(input){
  const errors=[],warnings=[];
  const error=(field,message)=>errors.push({field,message});
  if(!object(input))return {valid:false,errors:[{field:'project',message:'Проект должен быть объектом.'}],warnings};
  const p=normalized(input);
  const range=(v,min,max,key)=>{if(!finite(v)||v<min||v>max)error(key,`${key}: требуется конечное число от ${min} до ${max}.`);};
  if(p.version!==2)error('version','Поддерживается схема проекта версии 2.');
  if(typeof p.name!=='string'||p.name.length>160)error('name','Название: строка до 160 символов.');
  range(p.height,2,5,'height');range(p.floors,1,2,'floors');if(!Number.isInteger(p.floors))error('floors','Этажность: 1 или 2.');
  range(p.grid,.01,2,'grid');
  if(!Array.isArray(p.levels)||p.levels.length>p.floors)error('levels','Этажи: массив не длиннее этажности.');
  else{const indices=new Set(),ids=new Set();for(const [i,l] of p.levels.entries()){const f=`levels.${i}`;if(!object(l)){error(f,'Некорректный этаж.');continue;}if(typeof l.id!=='string'||!l.id||ids.has(l.id))error(f+'.id','ID этажей должны быть уникальными.');ids.add(l.id);if(!Number.isInteger(l.index)||l.index<1||l.index>p.floors||indices.has(l.index))error(f+'.index','Индекс этажа должен быть уникальным от 1 до этажности.');indices.add(l.index);range(l.height,2,5,f+'.height');if(typeof l.name!=='string'||l.name.length>100)error(f+'.name','Имя этажа: строка до 100 символов.');}}
  const wallMap=new Map();
  if(!Array.isArray(p.walls)||p.walls.length>300)error('walls','Стены: массив до 300 элементов.');
  for(const [i,w] of (Array.isArray(p.walls)?p.walls:[]).entries()){
    const f=`walls.${i}`;
    if(!object(w)){error(f,'Некорректная стена.');continue;}
    if(typeof w.id!=='string'||!w.id||w.id.length>100||wallMap.has(w.id))error(f+'.id','ID стен должны быть непустыми и уникальными.');
    wallMap.set(w.id,w);
    if(!point(w.a)||!point(w.b)){error(f,'Обе точки стены должны иметь конечные координаты x/y.');continue;}
    for(const q of [w.a,w.b])if(Math.abs(q.x)>1000||Math.abs(q.y)>1000)error(f,'Координаты должны находиться в пределах ±1000 м.');
    range(dist(w.a,w.b),.2,100,f+'.length');
    if(!['exterior','bearing','partition'].includes(w.kind))error(f+'.kind','Тип стены: exterior, bearing или partition.');
    if(!parseSection(w.section))error(f+'.section','Сечение: b×h в мм; 15≤b≤300, b≤h≤600.');
    range(w.studStep,.2,1.2,f+'.studStep');
    if(w.level!==undefined&&(!Number.isInteger(w.level)||w.level<1||w.level>p.floors))error(f+'.level','Стена задана на несуществующем этаже.');
  }
  const ws=(Array.isArray(p.walls)?p.walls:[]).filter(w=>object(w)&&point(w.a)&&point(w.b)&&dist(w.a,w.b)>EPS);
  if(ws.length){const points=ws.flatMap(w=>[w.a,w.b]);if(Math.max(...points.map(q=>q.x))-Math.min(...points.map(q=>q.x))>100||Math.max(...points.map(q=>q.y))-Math.min(...points.map(q=>q.y))>100)error('walls','Габариты одной модели ограничены 100 × 100 м.');if(sum(ws.map(w=>dist(w.a,w.b)))>2000)error('walls','Суммарная длина стен одной модели ограничена 2000 м.');}
  for(let i=0;i<ws.length;i++)for(let j=0;j<i;j++)if((ws[i].level===undefined||ws[j].level===undefined||ws[i].level===ws[j].level)&&collinearOverlap(ws[i].a,ws[i].b,ws[j].a,ws[j].b))error('walls',`Стены ${ws[j].id} и ${ws[i].id} накладываются на одной прямой одного этажа.`);
  const ids=new Set(),os=Array.isArray(p.openings)?p.openings:[];
  if(!Array.isArray(p.openings)||os.length>300)error('openings','Проёмы: массив до 300 элементов.');
  for(const [i,o] of os.entries()){
    const f=`openings.${i}`;
    if(!object(o)){error(f,'Некорректный проём.');continue;}
    if(typeof o.id!=='string'||!o.id||o.id.length>100||ids.has(o.id))error(f+'.id','ID проёмов должны быть непустыми и уникальными.');ids.add(o.id);
    const w=wallMap.get(o.wallId);if(!w||!point(w.a)||!point(w.b)){error(f+'.wallId','Стена проёма не существует.');continue;}
    const s=parseSection(w.section);if(!s)continue;const B=s.b/1000;
    range(o.offset,.05,100,f+'.offset');range(o.width,.2,20,f+'.width');range(o.height,.2,5,f+'.height');range(o.sill,0,5,f+'.sill');
    if(!['window','door'].includes(o.type))error(f+'.type','Проём: window или door.');
    if(o.floor!==undefined&&(!Number.isInteger(o.floor)||o.floor<1||o.floor>p.floors))error(f+'.floor','Проём расположен на несуществующем этаже.');
    if(w.level!==undefined&&o.floor!==undefined&&o.floor!==w.level)error(f+'.floor','Этаж проёма должен совпадать с этажом его стены.');
    const margin=2*B+.02;
    if(o.offset<margin-EPS||o.offset+o.width>dist(w.a,w.b)-margin+EPS)error(f,'До концов стены требуется место для коренных и подперемычечных стоек.');
    const floorHeight=Array.isArray(p.levels)?p.levels.find(l=>l?.index===(o.floor??w.level??1))?.height??p.height:p.height;
    if(o.sill+o.height>floorHeight-2*B-.2+EPS)error(f,'Над проёмом необходимо место для перемычки 200 мм и двух верхних обвязок.');
    if(o.type==='door'&&o.sill>EPS)warnings.push(`Дверь ${o.id} имеет порог ${o.sill} м: проём показан по заданным размерам.`);
    for(let j=0;j<i;j++){const q=os[j];if(!object(q)||q.wallId!==o.wallId||(q.floor??w.level??1)!==(o.floor??w.level??1))continue;
      if(o.offset<q.offset+q.width+4*B-EPS&&o.offset+o.width>q.offset-4*B+EPS)error(f,`Проёмы ${q.id} и ${o.id}: между краями нужно не менее четырёх толщин стойки; расположение друг над другом не поддерживается.`);
    }
  }
  for(const key of ['roof','material','loads','foundation','joints','prices'])if(!object(p[key]))error(key,`${key}: требуется объект параметров.`);
  if(object(p.roof)){
    if(!['king','queen','fink','mono','gable','none'].includes(p.roof.type))error('roof.type','Тип кровли: king, queen, fink, mono или none.');
    range(p.roof.pitch,0,60,'roof.pitch');range(p.roof.spacing,.2,1.5,'roof.spacing');
    for(const k of ['chordSection','webSection'])if(!parseSection(p.roof[k]))error('roof.'+k,'Некорректное сечение доски.');
    if(p.roof.zones!==undefined){
      if(!Array.isArray(p.roof.zones)||p.roof.zones.length>100)error('roof.zones','Зоны кровли: массив до 100 элементов; отсутствие поля включает автоматические зоны.');
      else{const ids=new Set();for(const [i,z] of p.roof.zones.entries()){
        const f=`roof.zones.${i}`;
        if(!object(z)){error(f,'Зона кровли должна быть объектом.');continue;}
        if(typeof z.id!=='string'||!z.id||z.id.length>100||ids.has(z.id))error(f+'.id','ID зон должны быть непустыми и уникальными, до 100 символов.');ids.add(z.id);
        if(typeof z.name!=='string'||z.name.length>160)error(f+'.name','Название зоны: строка до 160 символов.');
        if(!['gable','mono','hip'].includes(z.shape))error(f+'.shape','Форма зоны: gable, mono или hip.');
        if(!finite(z.ridgeAngle))error(f+'.ridgeAngle','Азимут конька должен быть конечным числом.');
        range(z.pitchLeft,2,60,f+'.pitchLeft');range(z.pitchRight,2,60,f+'.pitchRight');range(z.spacing,.2,3,f+'.spacing');
        for(const key of ['chordSection','webSection'])if(!parseSection(z[key]))error(f+'.'+key,'Некорректное сечение доски зоны.');
        if(z.elevation!==null&&z.elevation!==undefined&&(!finite(z.elevation)||z.elevation<=0||z.elevation>100))error(f+'.elevation','Отметка зоны: null или положительное конечное число до 100 м.');
        if(z.levelIndex!==undefined&&(!Number.isInteger(z.levelIndex)||z.levelIndex<1||z.levelIndex>p.floors))error(f+'.levelIndex','Зона задана на несуществующем этаже.');
        if(!Array.isArray(z.polygon)||z.polygon.length<3||z.polygon.length>200||!z.polygon.every(point)){error(f+'.polygon','Контур зоны: 3–200 конечных точек x/y.');continue;}
        if(polygonArea(z.polygon)<.01)error(f+'.polygon','Площадь зоны должна быть не менее 0,01 м².');
        if(z.polygon.some((q,j)=>dist(q,z.polygon[(j+1)%z.polygon.length])<.01))error(f+'.polygon','Сторона зоны должна быть не короче 0,01 м.');
        for(let a=0;a<z.polygon.length;a++)for(let b=0;b<a;b++){if(Math.abs(a-b)===1||Math.abs(a-b)===z.polygon.length-1)continue;const aa=z.polygon[a],az=z.polygon[(a+1)%z.polygon.length],ba=z.polygon[b],bz=z.polygon[(b+1)%z.polygon.length];if(segmentHit(aa,az,ba,bz)||collinearOverlap(aa,az,ba,bz))error(f+'.polygon','Контур зоны должен быть простым, без самопересечений и наложенных рёбер.');}
      }}
    }
  }
  if(!object(p.floor))error('floor','Параметры перекрытия должны быть объектом.');
  else{if(!parseSection(p.floor.section))error('floor.section','Некорректное сечение балки.');range(p.floor.spacing,.2,1.2,'floor.spacing');if(!['x','y'].includes(p.floor.axis))error('floor.axis','Направление балок: x или y.');}
  if(object(p.material))for(const [k,a,b] of [['density',100,1500],['E',1000,30000],['Fb',.5,80],['Ft',.5,80],['Fc',.5,100]])range(p.material[k],a,b,'material.'+k);
  if(object(p.material))for(const [k,a,b] of [['Fv',.1,20],['studRestraint',.2,5],['columnK',.5,2]])if(p.material[k]!==undefined)range(p.material[k],a,b,'material.'+k);
  if(object(p.loads))for(const [k,a,b] of [['floorDead',0,20],['live',0,20],['roofDead',0,20],['wallDead',0,20],['openingDead',0,20],['snow',0,20],['wind',0,10],['gammaG',1,2],['gammaQ',1,3]])range(p.loads[k],a,b,'loads.'+k);
  if(object(p.foundation)){range(p.foundation.spacing,.5,6,'foundation.spacing');range(p.foundation.capacity,1,1000,'foundation.capacity');}
  if(object(p.prices))for(const [k,v] of Object.entries(p.prices)){
    if(k==='sectionPrices'){
      if(!object(v)||Object.keys(v).length>1000)error('prices.sectionPrices','Цены сечений: объект до 1000 позиций.');
      else for(const [id,price] of Object.entries(v)){if(!id||id.length>100)error('prices.sectionPrices','ID сечения должен быть непустой строкой до 100 символов.');range(price,0,1e9,'prices.sectionPrices.'+id);}
    }else range(v,0,k.endsWith('Percent')?300:1e9,'prices.'+k);
  }
  const types=['california2','three3','closed4'],cuts=['butt','miter','halfLap','half-lap'];
  if(object(p.joints)){
    if(!types.includes(p.joints.defaultCorner))error('joints.defaultCorner','Угол: california2, three3 или closed4.');
    if(!cuts.includes(p.joints.defaultCut))error('joints.defaultCut','Запил: butt, miter или halfLap.');
    if(!['halfLap','scarf','fishplate','none'].includes(p.joints.spliceScheme))error('joints.spliceScheme','Наращивание: halfLap, scarf, fishplate или none.');
    range(p.joints.spliceLength,.1,1,'joints.spliceLength');
    if(!object(p.joints.overrides)||Object.keys(p.joints.overrides).length>1000)error('joints.overrides','Переопределения узлов: объект до 1000 элементов.');
    else for(const [id,v] of Object.entries(p.joints.overrides)){
      if(!object(v)||Object.keys(v).some(k=>!['type','cutScheme'].includes(k))||(v.type!==undefined&&!types.includes(v.type))||(v.cutScheme!==undefined&&!cuts.includes(v.cutScheme)))error('joints.overrides.'+id,'Переопределение узла: {type, cutScheme}.');
    }
    if(p.joints.defaultCorner==='closed4'&&ws.some(w=>{const s=parseSection(w.section);return s&&s.h<2*s.b;}))error('joints.defaultCorner','Закрытый пакет требует глубину стены ≥ двух толщин доски.');
  }
  if(!object(p.cutting))error('cutting','Параметры раскроя должны быть объектом.');
  else{if(p.cutting.stockLength!==6)error('cutting.stockLength','Длина исходной доски в этой схеме фиксирована: 6 м.');range(p.cutting.kerf,0,10,'cutting.kerf');range(p.cutting.minReusable,0,6,'cutting.minReusable');}
  if(!Array.isArray(p.objects)||p.objects.length>300)error('objects','Объекты: массив до 300 элементов.');
  else{const seen=new Set();for(const [i,o] of p.objects.entries()){
    const f=`objects.${i}`;if(!object(o)){error(f,'Некорректный объект.');continue;}
    if(typeof o.id!=='string'||!o.id||seen.has(o.id))error(f+'.id','ID объектов должны быть уникальными.');seen.add(o.id);
    if(!['post','beam'].includes(o.type))error(f+'.type','Объект: post или beam.');
    if(!point(o.a)||(o.type==='beam'&&!point(o.b)))error(f,'Требуются конечные координаты объекта.');
    if(!parseSection(o.section))error(f+'.section','Некорректное сечение объекта.');
    if(o.height!==undefined)range(o.height,.2,20,f+'.height');if(o.elevation!==undefined)range(o.elevation,0,20,f+'.elevation');
    if(o.level!==undefined&&(!Number.isInteger(o.level)||o.level<1||o.level>p.floors))error(f+'.level','Объект расположен на несуществующем этаже.');
    if(point(o.a)&&Object.values(o.a).some(v=>!finite(v)||Math.abs(v)>1000))error(f,'Координаты объекта вне допустимого диапазона.');
    if(o.type==='beam'&&point(o.a)&&point(o.b))range(dist(o.a,o.b),.2,100,f+'.length');
  }}
  if(!object(p.boardCuts)||Object.keys(p.boardCuts).length>10000)error('boardCuts','Запилы досок: объект до 10000 элементов.');
  else for(const [id,v] of Object.entries(p.boardCuts)){
    if(!object(v)||Object.keys(v).some(k=>!['start','end'].includes(k))){error('boardCuts.'+id,'Запилы задаются полями start/end.');continue;}
    for(const side of ['start','end'])if(v[side]!==undefined){const c=v[side];if(!object(c)||!['butt','miter'].includes(c.scheme)||!finite(c.angle)||c.angle<0||c.angle>75)error('boardCuts.'+id+'.'+side,'Запил: butt/miter, угол от 0 до 75° от прямого реза.');}
  }
  if(!Array.isArray(p.voids)||p.voids.length>100)error('voids','Проёмы перекрытий: массив до 100 элементов.');
  else{const ids=new Set();for(const [i,v] of p.voids.entries()){
    const f=`voids.${i}`;if(!object(v)){error(f,'Некорректный проём перекрытия.');continue;}
    if(typeof v.id!=='string'||!v.id||ids.has(v.id))error(f+'.id','ID проёмов перекрытий должны быть уникальными.');ids.add(v.id);
    if(!Number.isInteger(v.level)||v.level<1||v.level>p.floors)error(f+'.level','Проём перекрытия расположен на несуществующем этаже.');
    if(!['doubleHeight','stair','opening'].includes(v.kind))error(f+'.kind','Тип проёма перекрытия: doubleHeight, stair или opening.');
    if(v.kind==='doubleHeight'&&v.level===1)error(f+'.level','Второй свет вырезает перекрытие второго этажа, а не пол первого.');
    if(!parseSection(v.edgeSection))error(f+'.edgeSection','Некорректное сечение обрамления.');
    if(!Array.isArray(v.polygon)||v.polygon.length<3||v.polygon.length>100||!v.polygon.every(point)){error(f+'.polygon','Контур проёма: 3–100 конечных точек x/y.');continue;}
    if(polygonArea(v.polygon)<.04)error(f+'.polygon','Площадь проёма должна быть не менее 0,04 м².');
    if(v.polygon.some((q,i)=>dist(q,v.polygon[(i+1)%v.polygon.length])<.05))error(f+'.polygon','Сторона проёма перекрытия должна быть не короче 0,05 м.');
    for(let a=0;a<v.polygon.length;a++)for(let b=0;b<a;b++){if(Math.abs(a-b)===1||Math.abs(a-b)===v.polygon.length-1)continue;const aa=v.polygon[a],az=v.polygon[(a+1)%v.polygon.length],ba=v.polygon[b],bz=v.polygon[(b+1)%v.polygon.length],hit=segmentHit(aa,az,ba,bz);if(hit||collinearOverlap(aa,az,ba,bz))error(f+'.polygon','Контур проёма перекрытия не должен пересекать себя.');}
  }}
  if(errors.length===0){
    for(const level of deriveLevels(p)){
      const graph=level.graph;
      for(const c of cornerData(p,graph,level.index))if(c.type==='closed4'&&c.wallIds.some(id=>{const s=parseSection(wallMap.get(id).section);return s.h<2*s.b;}))error('joints.overrides.'+c.id,'Закрытый пакет в этом узле требует глубину каждой прилегающей стены не менее двух толщин доски.');
      const voids=p.voids.filter(v=>v.level===level.index);
      for(const v of voids){if(!graph.closed){warnings.push(`Проём ${v.id}: внешний контур этажа ещё не замкнут.`);continue;}if(!polygonContained(v.polygon,graph.polygon))error('voids.'+v.id,'Проём перекрытия должен целиком лежать внутри контура своего этажа.');}
      for(let i=0;i<voids.length;i++)for(let j=0;j<i;j++)if(polygonsOverlap(voids[i].polygon,voids[j].polygon))error('voids','Проёмы одного перекрытия не должны накладываться.');
    }
  }
  return {valid:errors.length===0,errors,warnings};
}

function topology(walls){
  const cuts=walls.map(()=>[0,1]);
  for(let i=0;i<walls.length;i++)for(let j=0;j<i;j++){
    const a=walls[i],b=walls[j],hit=segmentHit(a.a,a.b,b.a,b.b);
    if(hit){cuts[i].push(hit.t);cuts[j].push(hit.s);}
    else for(const [p,k,target] of [[a.a,j,b],[a.b,j,b],[b.a,i,a],[b.b,i,a]])if(onSegment(p,target.a,target.b))cuts[k].push(parameter(p,target.a,target.b));
  }
  const nodes=new Map(),edges=[];
  const get=p=>{const key=nodeKey(p);if(!nodes.has(key))nodes.set(key,{id:'j_'+key,point:{x:coord(p.x),y:coord(p.y)},edges:[],wallIds:new Set()});return nodes.get(key);};
  walls.forEach((w,i)=>{
    const ts=cuts[i].sort((a,b)=>a-b).filter((v,j,a)=>!j||Math.abs(v-a[j-1])>1e-10);
    for(let j=1;j<ts.length;j++){if(ts[j]-ts[j-1]<EPS)continue;const a=get(lerp(w.a,w.b,ts[j-1])),b=get(lerp(w.a,w.b,ts[j]));const edge={id:`${w.id}:${j}`,wallId:w.id,kind:w.kind,a:a.id,b:b.id,length:dist(a.point,b.point)};edges.push(edge);a.edges.push(edge);b.edges.push(edge);a.wallIds.add(w.id);b.wallIds.add(w.id);}
  });
  const byId=new Map([...nodes.values()].map(n=>[n.id,n]));
  const ext=edges.filter(e=>e.kind==='exterior'),adj=new Map();for(const e of ext)for(const id of [e.a,e.b]){if(!adj.has(id))adj.set(id,[]);adj.get(id).push(e);}
  let closed=ext.length>=3&&[...adj.values()].every(a=>a.length===2),polygon=[];
  if(closed){
    const start=[...adj.keys()].sort((a,b)=>{const p=byId.get(a).point,q=byId.get(b).point;return p.x-q.x||p.y-q.y;})[0];
    let current=start,previous=null;const used=new Set();
    for(let i=0;i<=ext.length;i++){
      polygon.push({...byId.get(current).point});const edge=adj.get(current).find(e=>e.id!==previous);
      if(!edge||used.has(edge.id)){closed=false;break;}used.add(edge.id);previous=edge.id;current=edge.a===current?edge.b:edge.a;
      if(current===start)break;
    }
    if(used.size!==ext.length||current!==start)closed=false;
  }
  let signed=closed?sum(polygon.map((p,i)=>cross(p,polygon[(i+1)%polygon.length])))/2:0;
  if(Math.abs(signed)<1e-5)closed=false;
  if(!closed)polygon=[];else if(signed<0){polygon.reverse();signed=-signed;}
  return {nodes:[...nodes.values()].map(n=>({...n,wallIds:[...n.wallIds]})),edges,byId,closed,polygon,area:closed?signed:null};
}

export function pointInPolygon(p,polygon,includeBoundary=true){
  if(polygon.some((a,i)=>onSegment(p,a,polygon[(i+1)%polygon.length],1e-6)))return includeBoundary;
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
function polygonArea(polygon){return Math.abs(sum(polygon.map((p,i)=>cross(p,polygon[(i+1)%polygon.length])))/2);}
function polygonBounds(polygon){const xs=polygon.map(p=>p.x),ys=polygon.map(p=>p.y);const b={minX:xs.length?Math.min(...xs):0,minY:ys.length?Math.min(...ys):0,maxX:xs.length?Math.max(...xs):0,maxY:ys.length?Math.max(...ys):0};return {...b,width:b.maxX-b.minX,height:b.maxY-b.minY};}
function polygonsOverlap(a,b){
  if(a.some(q=>pointInPolygon(q,b,false))||b.some(q=>pointInPolygon(q,a,false)))return true;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){const hit=segmentHit(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]);if(hit&&hit.t>EPS&&hit.t<1-EPS&&hit.s>EPS&&hit.s<1-EPS)return true;}
  for(const [own,other] of [[a,b],[b,a]]){const signed=sum(own.map((q,i)=>cross(q,own[(i+1)%own.length]))),side=signed>=0?1:-1;for(let i=0;i<own.length;i++){const q=own[i],z=own[(i+1)%own.length],length=dist(q,z);if(length<EPS)continue;const mid=lerp(q,z,.5),sample={x:mid.x-(z.y-q.y)/length*side*1e-5,y:mid.y+(z.x-q.x)/length*side*1e-5};if(pointInPolygon(sample,own,false)&&pointInPolygon(sample,other,false))return true;}}
  return false;
}
function polygonContained(inner,outer){
  for(let i=0;i<inner.length;i++){const a=inner[i],b=inner[(i+1)%inner.length];if(!pointInPolygon(a,outer))return false;const ts=[0,1];for(let j=0;j<outer.length;j++){const hit=segmentHit(a,b,outer[j],outer[(j+1)%outer.length]);if(hit)ts.push(hit.t);}ts.sort((a,b)=>a-b);for(let j=1;j<ts.length;j++)if(!pointInPolygon(lerp(a,b,(ts[j]+ts[j-1])/2),outer))return false;}return true;
}
function deriveLevels(p){
  const platform=parseSection(p.floor.section).h/1000+.035;let baseY=.72;
  return Array.from({length:p.floors},(_,i)=>{
    const index=i+1,definition=p.levels.find(l=>l.index===index),height=definition?.height??p.height,walls=p.walls.filter(w=>w.level===undefined||w.level===index),graph=topology(walls),polygon=graph.polygon,voids=p.voids.filter(v=>v.level===index),voidArea=graph.closed?sum(voids.map(v=>polygonArea(v.polygon))):null;
    const level={id:definition?.id??'level-'+index,index,name:definition?.name??index+' этаж',height,baseY,platformBase:baseY,wallBaseY:baseY+platform,elevation:baseY+platform,wallBase:baseY+platform,topY:baseY+platform+height,closed:graph.closed,polygon,area:graph.area,voidArea,netFloorArea:graph.closed?Math.max(0,graph.area-voidArea):null,bounds:polygonBounds(graph.closed?polygon:walls.flatMap(w=>[w.a,w.b])),walls,voids,graph};
    baseY=level.topY;return level;
  });
}
function subtractIntervals(intervals,cutouts){let result=intervals;for(const [a,b] of cutouts){const next=[];for(const [x,y] of result){if(b<=x+EPS||a>=y-EPS)next.push([x,y]);else{if(a>x+EPS)next.push([x,Math.min(a,y)]);if(b<y-EPS)next.push([Math.max(b,x),y]);}}result=next;}return result;}
function interiorIntervals(polygon,line,axis){
  const fixed=axis==='y'?'x':'y',along=axis==='y'?'y':'x',values=polygon.map(p=>p[fixed]);
  const min=Math.min(...values),max=Math.max(...values);let at=line;
  if(Math.abs(at-max)<EPS)at=max-1e-7;
  if(Math.abs(at-min)<EPS)at=min+1e-7;
  const hits=[];
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if((a[fixed]<=at&&at<b[fixed])||(b[fixed]<=at&&at<a[fixed]))hits.push(a[along]+(b[along]-a[along])*(at-a[fixed])/(b[fixed]-a[fixed]));}
  hits.sort((a,b)=>a-b);const intervals=[];for(let i=1;i<hits.length;i+=2)if(hits[i]-hits[i-1]>.01)intervals.push([hits[i-1],hits[i]]);return intervals;
}

function cornerData(p,graph,level=1){
  const walls=new Map(p.walls.map(w=>[w.id,w]));
  return graph.nodes.filter(n=>n.wallIds.length>1).map(n=>{
    const dirs=n.edges.map(e=>{const other=graph.byId.get(e.a===n.id?e.b:e.a).point,v=sub(other,n.point),len=Math.hypot(v.x,v.y);return {x:v.x/len,y:v.y/len};});
    const distinct=dirs.filter((d,i)=>dirs.findIndex(q=>dot(d,q)>1-1e-6)===i);
    let angle=180;if(distinct.length>1)angle=Math.min(...distinct.flatMap((d,i)=>distinct.slice(i+1).map(q=>Math.acos(Math.max(-1,Math.min(1,dot(d,q))))*180/Math.PI)));
    const pi=graph.polygon.findIndex(q=>dist(q,n.point)<1e-6);
    if(distinct.length===2&&pi>=0){const prev=graph.polygon[(pi+graph.polygon.length-1)%graph.polygon.length],next=graph.polygon[(pi+1)%graph.polygon.length];if(cross(sub(n.point,prev),sub(next,n.point))<0)angle=360-angle;}
    const kind=distinct.length>=4?'cross':distinct.length===3?'t':Math.abs(angle-180)<.01?'straight':'corner';
    const id=level===1?n.id:'j_'+level+'_'+nodeKey(n.point),override=p.joints.overrides[id]||{},type=override.type||p.joints.defaultCorner,cutScheme=override.cutScheme||p.joints.defaultCut;
    const principal=Math.min(angle,360-angle),cutAngle=Math.max(0,(180-principal)/2);
    const warning=kind==='t'||kind==='cross'?'Состав и передача усилий в Т/X-стыке условные; крепёж и примыкание обвязок не рассчитаны.':Math.abs(principal-90)>.01&&kind!=='straight'?'Косой угол: пакет и запилы показаны схематично, требуется рабочий узел.':['halfLap','half-lap'].includes(cutScheme)?'Врубка вполдерева обозначена; ослабление сечения и несущая способность не проверены.':null;
    const section=parseSection(walls.get(n.wallIds[0]).section);
    return {id,level,point:n.point,wallIds:n.wallIds,angle,cutAngle,type,cutScheme,kind,warning,section:{...section},directions:distinct};
  });
}

function timberModel(p,graph,corners,bounds,truss,warnings,roofModel){
  const instances=[],scheduleMap=new Map(),braceBays=[],splices=[],wallMap=new Map(p.walls.map(w=>[w.id,w])),duplicateIds=new Map();
  const floorSection=parseSection(p.floor.section),platform=floorSection.h/1000+.035,story=p.height+platform,base=p._baseY??.72;
  const hash=value=>{let n=2166136261;for(const c of value){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return (n>>>0).toString(36);};
  const allowance=(cut,h)=>cut?.scheme==='miter'?h/2000*Math.tan(Math.min(85,Math.abs(cut.angle||0))*Math.PI/180):0;
  function raw(name,category,role,b,h,a,z,extras={}){
    const length=Math.hypot(...a.map((v,i)=>z[i]-v));if(length<.005)return null;
    const id=extras.id||'D'+hash(JSON.stringify([name,role,a.map(coord),z.map(coord),extras.wallId,extras.floor,extras.cornerId,b,h]));
    const overrides=p.boardCuts[id]||{};
    const cs={...(extras.cutStart||{scheme:'butt',angle:0}),...overrides.start},ce={...(extras.cutEnd||{scheme:'butt',angle:0}),...overrides.end};
    if(cs.scheme==='butt')cs.angle=0;if(ce.scheme==='butt')ce.angle=0;
    const cutLength=length+allowance(cs,h)+allowance(ce,h),grossVolume=b*h*cutLength/1e6;
    const removed=b*h/1e6*sum([cs,ce].map(c=>['halfLap','half-lap','scarf'].includes(c.scheme)?(c.lapLength??0)/2:0));
    const volume=Math.max(0,b*h*length/1e6-removed),mass=volume*p.material.density;
    const key=[name,category,b,h,length.toFixed(6),extras.cutStart?.scheme,extras.cutStart?.angle,extras.cutEnd?.scheme,extras.cutEnd?.angle].join('|');
    let row=scheduleMap.get(key);if(!row){row={id:`T${String(scheduleMap.size+1).padStart(3,'0')}`,name,category,role,b,h,section:`${b} × ${h}`,length,count:0,volume:0,mass:0,massEach:mass,volumeEach:volume};scheduleMap.set(key,row);}row.count++;row.volume+=volume;row.mass+=mass;
    const count=duplicateIds.get(id)||0;duplicateIds.set(id,count+1);const uniqueId=count?id+'-'+count:id;
    const board={id:uniqueId,scheduleId:row.id,name,category,role,b,h,length,cutLength,actualCutLength:cutLength,grossVolume,netVolume:volume,volume,mass,start:a,end:z,crossAxis:[1,0,0],...extras,cutStart:cs,cutEnd:ce};instances.push(board);return board;
  }
  function add(name,category,role,b,h,a,z,extras={}){
    const length=Math.hypot(...a.map((v,i)=>z[i]-v));if(length<.005)return;
    const memberId='M'+hash(JSON.stringify([name,role,a.map(coord),z.map(coord),extras.wallId,extras.floor,extras.cornerId,b,h]));
    const overrides=p.boardCuts[memberId]||{},cs={...(extras.cutStart||{scheme:'butt',angle:0}),...overrides.start},ce={...(extras.cutEnd||{scheme:'butt',angle:0}),...overrides.end},stock=p.cutting.stockLength;
    if(cs.scheme==='butt')cs.angle=0;if(ce.scheme==='butt')ce.angle=0;
    if(length+allowance(cs,h)+allowance(ce,h)<=stock+EPS||p.joints.spliceScheme==='none')return raw(name,category,role,b,h,a,z,{...extras,memberId,cutStart:cs,cutEnd:ce});
    const scheme=p.joints.spliceScheme,lap=scheme==='fishplate'?0:p.joints.spliceLength,vector=z.map((v,i)=>(v-a[i])/length),parts=[],joints=[];let from=0,index=0;
    if(length<=2*lap+.02&&length+allowance(cs,h)+allowance(ce,h)>stock){warnings.push(`Косые торцы элемента ${name} не помещаются в заготовку 6 м при выбранном нахлёсте. Элемент оставлен длинным без вымышленного продолжения.`);return raw(name,category,role,b,h,a,z,{...extras,memberId,cutStart:cs,cutEnd:ce});}
    const at=s=>a.map((v,i)=>v+vector[i]*s);
    while(from<length-EPS){
      const startCut=index?{scheme,angle:scheme==='scarf'?Math.atan2(h/1000,p.joints.spliceLength)*180/Math.PI:0,lapLength:lap,lapSide:'top'}:cs;
      const remaining=length-from,canFinish=remaining+allowance(startCut,h)+allowance(ce,h)<=stock+EPS;
      const span=canFinish?remaining:Math.min(stock-allowance(startCut,h),remaining-lap-.02),to=from+span;
      const endCut=canFinish?ce:{scheme,angle:scheme==='scarf'?Math.atan2(h/1000,p.joints.spliceLength)*180/Math.PI:0,lapLength:lap,lapSide:'bottom'};
      const board=raw(name,category,role,b,h,at(from),at(to),{...extras,id:memberId+'-P'+(index+1),memberId,partIndex:index,cutStart:startCut,cutEnd:endCut,spliceIds:[]});parts.push(board);
      if(index){const jointId=memberId+'-J'+index;const prev=parts[index-1];prev.cutEnd.jointId=jointId;board.cutStart.jointId=jointId;prev.spliceIds.push(jointId);board.spliceIds.push(jointId);const q=at(from+lap/2),requiresSupport=['joist','customBeam','truss','bottomChord','chord','rafter'].includes(role)||category==='roof';const joint={id:jointId,role,memberId,scheme,lapLength:scheme==='fishplate'?p.joints.spliceLength:lap,point:q,partIds:[prev.id,board.id],requiresSupport,verified:false};splices.push(joint);joints.push(joint);
        if(scheme==='fishplate')for(const side of [-1,1]){const ext=p.joints.spliceLength,aa=at(from-ext),zz=at(from+ext),axis=extras.crossAxis||[1,0,0];for(let k=0;k<3;k++){aa[k]+=axis[k]*side*(b/2000+.01);zz[k]+=axis[k]*side*(b/2000+.01);}raw('Накладка стыка',category,'fishplate',20,100,aa,zz,{...extras,id:jointId+'-F'+(side<0?1:2),memberId:jointId,jointId,spliceIds:[jointId]});}
      }
      if(canFinish)break;from=to-lap;index++;if(index>1000)throw Error('Не удалось разбить длинный элемент.');
    }
    warnings.push(`Наращивание ${name}: ${parts.length} доски, ${scheme}. Силовая работа стыков не подтверждена${joints.some(j=>j.requiresSupport)?'; расположение стыка требует опоры или отдельного расчёта':''}.`);
  }
  for(const w of p.walls){
    const {b,h}=parseSection(w.section),B=b/1000,D=h/1000,len=dist(w.a,w.b),u={x:(w.b.x-w.a.x)/len,y:(w.b.y-w.a.y)/len},v={x:-u.y,y:u.x};
    const at=(s,y)=>[w.a.x+u.x*s,y,w.a.y+u.y*s],extra={wallId:w.id,crossAxis:[u.x,0,u.y]};
    const wallCorners=corners.filter(c=>c.wallIds.includes(w.id));
    function cutAt(s){const c=wallCorners.find(c=>dist(lerp(w.a,w.b,s/len),c.point)<1e-5);return {scheme:c?.cutScheme||'butt',angle:c?.cutScheme==='miter'?c.cutAngle:0,...(['halfLap','half-lap'].includes(c?.cutScheme)?{recessDepth:B/2}: {})};}
    for(let f=0;f<p.floors;f++){
      const y0=base+platform+f*story,low=y0+B,high=y0+p.height-2*B;
      const os=p.openings.filter(o=>o.wallId===w.id&&(o.floor??1)===f+1).sort((a,b)=>a.offset-b.offset);
      function plate(a,z,y){add('Обвязка стены','walls','plate',b,h,at(a,y),at(z,y),{...extra,floor:f+1,crossAxis:[0,1,0],cutStart:cutAt(a),cutEnd:cutAt(z)});}
      const doors=os.filter(o=>o.type==='door'&&o.sill<EPS);let start=0;for(const o of doors){plate(start,o.offset,y0+B/2);start=o.offset+o.width;}plate(start,len,y0+B/2);plate(0,len,y0+p.height-1.5*B);plate(0,len,y0+p.height-B/2);
      const vertical=(s,a,z,role='stud')=>add({stud:'Рядовая стойка',king:'Коренная стойка',jack:'Подперемычечная стойка',cripple:'Короткая стойка'}[role],'walls',role,b,h,at(s,a),at(s,z),{...extra,floor:f+1});
      const count=Math.ceil(len/w.studStep);
      for(let i=0;i<=count;i++){
        const s=len*i/count;
        if(wallCorners.some(c=>Math.abs(parameter(c.point,w.a,w.b)*len-s)<D+2*B))continue;
        const o=os.find(o=>s>o.offset-2*B-EPS&&s<o.offset+o.width+2*B+EPS);
        if(!o)vertical(s,low,high);
        else if(s>o.offset+EPS&&s<o.offset+o.width-EPS){if(o.sill>2*B)vertical(s,low,y0+o.sill-B,'cripple');if(high>y0+o.sill+o.height+.2)vertical(s,y0+o.sill+o.height+.2,high,'cripple');}
      }
      for(const o of os){
        const bottom=y0+o.sill,top=bottom+o.height;
        for(const side of [-1,1]){const edge=side<0?o.offset:o.offset+o.width;vertical(edge+side*1.5*B,low,high,'king');vertical(edge+side*.5*B,low,top,'jack');}
        for(const side of [-1,1]){const a=at(o.offset-B,top+.1),z=at(o.offset+o.width+B,top+.1),offset=side*(D/2-B/2);a[0]+=v.x*offset;a[2]+=v.y*offset;z[0]+=v.x*offset;z[2]+=v.y*offset;add('Доска перемычки','walls','header',b,200,a,z,{...extra,floor:f+1,openingId:o.id,crossAxis:[v.x,0,v.y]});}
        if(o.sill>2*B)add('Подоконная доска','walls','sill',b,h,at(o.offset,bottom-B/2),at(o.offset+o.width,bottom-B/2),{...extra,floor:f+1,openingId:o.id,crossAxis:[0,1,0]});
        if(wallCorners.some(c=>{const s=parameter(c.point,w.a,w.b)*len;return s>o.offset-D-2*B&&s<o.offset+o.width+D+2*B;}))warnings.push(`Проём ${o.id} близко к узлу: пакет и обрамление могут пересекаться; узел требуется уточнить.`);
      }
      if(w.kind!=='partition'){
        const margin=D+2*B,spaces=[];let from=margin;for(const o of os){if(o.offset-margin>from)spaces.push([from,o.offset-margin]);from=Math.max(from,o.offset+o.width+margin);}if(len-margin>from)spaces.push([from,len-margin]);
        const best=spaces.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
        if(best&&best[1]-best[0]>=.6){const width=Math.min(2.4,best[1]-best[0]),a=best[0],z=a+width;for(const reverse of [false,true]){const aa=at(a,reverse?high:low),zz=at(z,reverse?low:high),offset=(reverse?-1:1)*(D/2+.0125);aa[0]+=v.x*offset;aa[2]+=v.y*offset;zz[0]+=v.x*offset;zz[2]+=v.y*offset;add('Накладная укосина','bracing','brace',25,100,aa,zz,{...extra,floor:f+1,crossAxis:[v.x,0,v.y]});}braceBays.push({wallId:w.id,floor:f+1,available:true,width,height:high-low,length:Math.hypot(width,high-low)});}
        else braceBays.push({wallId:w.id,floor:f+1,available:false});
      }
    }
  }
  for(const c of corners){
    const w=wallMap.get(c.wallIds[0]),{b,h}=parseSection(w.section),B=b/1000,D=h/1000;
    const u=c.directions[0]||{x:1,y:0};let v=c.directions.find(d=>Math.abs(dot(d,u))<.1)||{x:-u.y,y:u.x};
    if(Math.abs(dot(u,v))>.01){v={x:-u.y,y:u.x};warnings.push(`Узел ${c.id}: ориентация пакета показана условно по первой стене.`);}
    const count=c.kind==='straight'?2:{california2:2,three3:3,closed4:4}[c.type];
    for(let f=0;f<p.floors;f++)for(let i=0;i<count;i++){
      const aa=i===0?B/2:i===1?B+D/2:i===2?D+1.5*B:B+D/2,bb=i===0?D/2:i===1?B/2:i===2?D/2:D-B/2;
      const x=c.point.x+u.x*(aa-D/2)+v.x*(bb-D/2),z=c.point.y+u.y*(aa-D/2)+v.y*(bb-D/2),low=base+platform+f*story+B,high=base+platform+f*story+p.height-2*B,axis=i===1||i===3?v:u;
      add(c.kind==='corner'?'Стойка углового пакета':'Стойка пакета стыка','walls','corner',b,h,[x,low,z],[x,high,z],{cornerId:c.id,wallIds:c.wallIds,floor:f+1,crossAxis:[axis.x,0,axis.y],cutStart:{scheme:'butt',angle:0},cutEnd:{scheme:'butt',angle:0}});
    }
  }
  if(graph.closed){
    const axis=p.floor.axis,fixed=axis==='y'?'x':'y',along=axis==='y'?'y':'x',min=fixed==='x'?bounds.minX:bounds.minY,max=fixed==='x'?bounds.maxX:bounds.maxY,n=Math.max(1,Math.ceil((max-min)/p.floor.spacing));
    for(let i=0;i<=n;i++){const line=min+(max-min)*i/n;
      const voidIntervals=(p._voids||[]).flatMap(v=>interiorIntervals(v.polygon,line,axis));
      for(const [a,z] of subtractIntervals(interiorIntervals(graph.polygon,line,axis),voidIntervals)){
        const breaks=[a,z];for(const w of p.walls.filter(w=>w.kind==='bearing')){if(Math.abs(w.b[fixed]-w.a[fixed])<EPS)continue;const t=(line-w.a[fixed])/(w.b[fixed]-w.a[fixed]);if(t>=0&&t<=1){const at=w.a[along]+(w.b[along]-w.a[along])*t;if(at>a+EPS&&at<z-EPS)breaks.push(at);}}
        const sorted=[...new Set(breaks.map(coord))].sort((a,b)=>a-b);for(let j=1;j<sorted.length;j++)for(let f=0;f<p.floors;f++){const aa={x:line,y:sorted[j-1]},zz={x:line,y:sorted[j]};if(axis==='x'){[aa.x,aa.y]=[aa.y,aa.x];[zz.x,zz.y]=[zz.y,zz.x];}const y=base+f*story+floorSection.h/2000;add('Балка перекрытия','floor','joist',floorSection.b,floorSection.h,[aa.x,y,aa.y],[zz.x,y,zz.y],{floor:f+1,crossAxis:axis==='y'?[1,0,0]:[0,0,1]});}
      }
    }
    for(const v of p._voids||[]){const section=parseSection(v.edgeSection),y=base+floorSection.h/1000-section.h/2000;for(let i=0;i<v.polygon.length;i++){const a=v.polygon[i],z=v.polygon[(i+1)%v.polygon.length],length=dist(a,z),dx=(z.x-a.x)/length,dz=(z.y-a.y)/length;add(v.kind==='doubleHeight'?'Обрамление второго света':'Обрамление проёма перекрытия','floor','voidHeader',section.b,section.h,[a.x,y,a.y],[z.x,y,z.y],{voidId:v.id,floor:1,crossAxis:[-dz,0,dx]});}warnings.push(`Обрамление проёма ${v.id}: соединения, опирание и удвоенные балки требуют отдельного расчёта.`);}
  }
  for(const o of p.objects){const {b,h}=parseSection(o.section),y=base+platform+(o.elevation??(o.type==='beam'?p.height:0));if(o.type==='post')add('Отдельная стойка','objects','post',b,h,[o.a.x,y,o.a.y],[o.a.x,y+(o.height??p.height),o.a.y],{objectId:o.id});else{const len=dist(o.a,o.b),dx=(o.b.x-o.a.x)/len,dz=(o.b.y-o.a.y)/len;add('Отдельная балка','objects','customBeam',b,h,[o.a.x,y,o.a.y],[o.b.x,y,o.b.y],{objectId:o.id,crossAxis:[-dz,0,dx]});}}
  if(p.objects.length)warnings.push('Отдельные стойки и балки включены в массу, но не считаются автоматическими опорами перекрытия; передача нагрузки и узлы требуют задания.');
  let roofVerified=false;
  if(roofModel&&Array.isArray(roofModel.instances)){
    let accepted=0;
    for(const board of roofModel.instances){const a=board.start,z=board.end;if(!Array.isArray(a)||!Array.isArray(z)||a.length!==3||z.length!==3||![...a,...z,board.b,board.h].every(finite)||board.b<=0||board.h<=0)continue;add(board.name||'Доска кровли','roof',board.role||'truss',board.b,board.h,a,z,{zoneId:board.zoneId,barId:board.barId,trussRow:board.trussRow,level:board.level??board.floor,floor:board.floor??board.level,crossAxis:board.crossAxis||[1,0,0],cutStart:board.cutStart,cutEnd:board.cutEnd});accepted++;}
    roofVerified=accepted>0&&accepted===roofModel.instances.length;
    if(accepted!==roofModel.instances.length)warnings.push('Некорректные доски зонной кровли пропущены: её масса неполна.');
  }else if(graph.closed&&p.roof.type!=='none'&&truss){
    const nodes=Array.isArray(truss.nodes)?truss.nodes:[],bars=Array.isArray(truss.bars)?truss.bars:[],map=new Map(nodes.map((n,i)=>[n.id??i,n]));
    const get=n=>typeof n==='object'?n:map.get(n),nLines=Math.max(1,Math.ceil(bounds.width/p.roof.spacing)),eave=base+platform+(p.floors-1)*story+p.height;
    let validBars=0;
    for(let row=0;row<=nLines;row++)for(const bar of bars){
      const a=get(bar.nodeA??bar.a??bar.start??bar.from),z=get(bar.nodeB??bar.end??bar.to??(typeof bar.b==='string'?bar.b:undefined));const sec=bar.section?parseSection(bar.section):{b:bar.breadth??bar.width??bar.bmm??(finite(bar.b)?bar.b:parseSection(p.roof.chordSection).b),h:bar.depth??bar.h??parseSection(p.roof.chordSection).h};
      if(!point(a)||!point(z)||!sec||!finite(sec.b)||!finite(sec.h)||sec.b<=0||sec.h<=0)continue;
      const x=bounds.minX+bounds.width*row/nLines;
      add(bar.name||'Доска фермы','roof',bar.role||'truss',sec.b,sec.h,[x,eave+a.y,bounds.minY+a.x],[x,eave+z.y,bounds.minY+z.x],{trussRow:row,crossAxis:[1,0,0],cutStart:bar.cutStart||{scheme:'butt',angle:0},cutEnd:bar.cutEnd||{scheme:'butt',angle:0}});validBars++;
    }
    roofVerified=validBars>0&&validBars===bars.length*(nLines+1);
    if(validBars>0&&!roofVerified)warnings.push('Часть стержней переданной фермы некорректна и пропущена. Древесина кровли и её вес неполны.');
    if(!validBars)warnings.push('Переданная ферма не содержит поддерживаемых узлов/стержней. Древесина кровли не добавлена.');
  }
  if(p.roof.type!=='none'&&!roofVerified)warnings.push('Древесина кровли не сформирована: передайте рассчитанную геометрию фермы. Её масса пока не учтена.');
  const schedule=[...scheduleMap.values()],volume=sum(instances.map(x=>x.volume)),mass=sum(instances.map(x=>x.mass));
  const totals=Object.fromEntries(['walls','floor','roof','bracing','objects'].map(k=>{const a=instances.filter(x=>x.category===k);return [k,{count:a.length,volume:sum(a.map(x=>x.volume)),mass:sum(a.map(x=>x.mass)),weight:sum(a.map(x=>x.mass))*G/1000}];}));
  const overStock=instances.filter(x=>x.cutLength>p.cutting.stockLength+EPS);if(overStock.length)warnings.push(`${overStock.length} досок длиннее 6 м; схема наращивания отключена или геометрия не помещается.`);
  return {instances,schedule,volume,mass,weight:mass*G/1000,totals,boardCount:instances.length,density:p.material.density,braceBays,roofGeometryAvailable:roofVerified,platformHeight:platform,storyHeight:story,splices,overStock,stockLength:p.cutting.stockLength,grossVolume:sum(instances.map(x=>x.grossVolume))};
}
function mergeTimber(models,p){
  const instances=models.flatMap(m=>m.instances),scheduleMap=new Map();
  for(const b of instances){const key=JSON.stringify([b.name,b.category,b.role,b.b,b.h,coord(b.length),b.cutStart,b.cutEnd]);let row=scheduleMap.get(key);if(!row){row={id:'T'+String(scheduleMap.size+1).padStart(4,'0'),name:b.name,category:b.category,role:b.role,b:b.b,h:b.h,section:`${b.b} × ${b.h}`,length:b.length,count:0,volume:0,mass:0,massEach:b.mass,volumeEach:b.volume};scheduleMap.set(key,row);}row.count++;row.volume+=b.volume;row.mass+=b.mass;b.scheduleId=row.id;}
  const mass=sum(instances.map(b=>b.mass)),volume=sum(instances.map(b=>b.volume));
  const totals=Object.fromEntries(['walls','floor','roof','bracing','objects'].map(category=>{const rows=instances.filter(b=>b.category===category),m=sum(rows.map(b=>b.mass));return [category,{count:rows.length,volume:sum(rows.map(b=>b.volume)),mass:m,weight:m*G/1000}];}));
  return {instances,schedule:[...scheduleMap.values()],volume,mass,weight:mass*G/1000,totals,boardCount:instances.length,density:p.material.density,braceBays:models.flatMap(m=>m.braceBays),roofGeometryAvailable:models.some(m=>m.roofGeometryAvailable),platformHeight:parseSection(p.floor.section).h/1000+.035,storyHeight:p.height+parseSection(p.floor.section).h/1000+.035,splices:models.flatMap(m=>m.splices),overStock:models.flatMap(m=>m.overStock),stockLength:6,grossVolume:sum(instances.map(b=>b.grossVolume))};
}

function pileField(p,geometry,walls,timber,loads){
  const polygon=geometry.polygon,b=geometry.baseBounds||geometry.bounds,spacing=p.foundation.spacing,supports=new Map();
  const add=q=>{if(!pointInPolygon(q,polygon))return;const k=nodeKey(q);if(!supports.has(k))supports.set(k,{id:'P'+String(supports.size+1).padStart(4,'0'),x:coord(q.x),y:coord(q.y),reaction:0,reactionCharacteristic:0,tributaryArea:0});};
  const nx=Math.max(1,Math.ceil(b.width/spacing)),ny=Math.max(1,Math.ceil(b.height/spacing));
  for(let i=0;i<=nx;i++)for(let j=0;j<=ny;j++)add({x:b.minX+b.width*i/nx,y:b.minY+b.height*j/ny});
  for(const w of walls.filter(w=>w.kind!=='partition')){const n=Math.ceil(w.length/spacing);for(let i=0;i<=n;i++)add(lerp(w.a,w.b,i/n));}
  const piles=[...supports.values()];
  const buckets=new Map(),bucketKey=(x,y)=>x+'_'+y;
  piles.forEach((q,i)=>{const key=bucketKey(Math.floor((q.x-b.minX)/spacing),Math.floor((q.y-b.minY)/spacing));if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);});
  function distribute(q,characteristic,gamma,area=0){
    if(!piles.length)return;
    const cx=Math.floor((q.x-b.minX)/spacing),cy=Math.floor((q.y-b.minY)/spacing),candidates=new Set();
    for(let radius=1;radius<=3;radius++){for(let i=cx-radius;i<=cx+radius;i++)for(let j=cy-radius;j<=cy+radius;j++)for(const index of buckets.get(bucketKey(i,j))||[])candidates.add(index);if(candidates.size>=4)break;}
    const nearest=(candidates.size?[...candidates]:piles.map((_,i)=>i)).map(i=>({i,d:Math.hypot(piles[i].x-q.x,piles[i].y-q.y)})).sort((a,b)=>a.d-b.d).slice(0,4);
    const hit=nearest.find(x=>x.d<1e-6),weights=hit?[{i:hit.i,w:1}]:nearest.map(x=>({i:x.i,w:1/Math.max(1e-6,x.d)**2}));const norm=sum(weights.map(x=>x.w));
    for(const {i,w} of weights){piles[i].reactionCharacteristic+=characteristic*w/norm;piles[i].reaction+=characteristic*gamma*w/norm;piles[i].tributaryArea+=area*w/norm;}
  }
  // Midpoint quadrature is normalized to the exact polygon area, so equilibrium
  // does not depend on raster resolution. It is an allocation, not grillage FEA.
  const sampleStep=Math.max(.2,Math.min(.75,spacing/2));let sampleCount=0;
  for(const level of geometry.levels.filter(l=>l.closed&&l.netFloorArea>EPS)){
    const bounds=level.bounds,sx=Math.max(1,Math.ceil(bounds.width/sampleStep)),sy=Math.max(1,Math.ceil(bounds.height/sampleStep)),samples=[];
    for(let i=0;i<sx;i++)for(let j=0;j<sy;j++){const q={x:bounds.minX+bounds.width*(i+.5)/sx,y:bounds.minY+bounds.height*(j+.5)/sy};if(pointInPolygon(q,level.polygon)&&!level.voids.some(v=>pointInPolygon(q,v.polygon)))samples.push(q);}
    if(!samples.length){const intervals=interiorIntervals(level.polygon,bounds.minX+Math.min(.01,bounds.width/4),'y');const interval=intervals[0];if(interval)samples.push({x:bounds.minX+.001,y:(interval[0]+interval[1])/2});}
    if(!samples.length)continue;sampleCount+=samples.length;const da=level.netFloorArea/samples.length;
    for(const q of samples){distribute(q,da*p.loads.floorDead,p.loads.gammaG,da);distribute(q,da*p.loads.live,p.loads.gammaQ);}
  }
  const exterior=walls.filter(w=>w.kind==='exterior'),perimeter=sum(exterior.map(w=>w.length));
  // Concept roof load follows the exterior outline; no hidden assumption that
  // every irregular roof has a solved ridge/support scheme.
  for(const w of exterior){const n=Math.max(1,Math.ceil(w.length/.5));for(let i=0;i<n;i++){const q=lerp(w.a,w.b,(i+.5)/n),share=w.length/(perimeter*n);distribute(q,loads.roofWeight*share,p.loads.gammaG);distribute(q,loads.snow*share,p.loads.gammaQ);}}
  for(const row of loads.wallLineLoads){const w=walls.find(w=>w.id===row.wallId);if(!w)continue;const n=Math.max(1,Math.ceil(w.length/.5));for(let i=0;i<n;i++)distribute(lerp(w.a,w.b,(i+.5)/n),row.weight/n,p.loads.gammaG);}
  if(loads.gableWeight)for(const w of exterior){const n=Math.max(1,Math.ceil(w.length/.5));for(let i=0;i<n;i++)distribute(lerp(w.a,w.b,(i+.5)/n),loads.gableWeight*w.length/(perimeter*n),p.loads.gammaG);}
  for(const board of timber.instances){
    // Roof wood is included in roofWeight above; all other boards are allocated
    // once at their own geometric centroid.
    if(board.category==='roof')continue;const q={x:(board.start[0]+board.end[0])/2,y:(board.start[2]+board.end[2])/2};distribute(q,board.mass*G/1000,p.loads.gammaG);
  }
  for(const pile of piles){pile.utilization=pile.reaction/p.foundation.capacity;pile.status=pile.utilization>1?'fail':pile.utilization>.85?'warning':'pass';}
  const maxPile=piles.reduce((a,b)=>!a||b.reaction>a.reaction?b:a,null),reactionSum=sum(piles.map(x=>x.reaction)),characteristicSum=sum(piles.map(x=>x.reactionCharacteristic));
  return {piles,foundation:{count:piles.length,maxPile,maxReaction:maxPile?.reaction??0,utilization:maxPile?.utilization??0,reactionSum,characteristicSum,balanceError:reactionSum-loads.totalDesign,status:maxPile&&maxPile.utilization>1?'fail':'unverified',method:'Нормированное распределение по площади и ближайшим опорам; не расчёт жёсткости ростверка.',sampleCount}};
}

export function calculateDesigner(input,{truss,roofModel}={}){
  const validation=validateDesignerProject(input);if(!validation.valid){const e=new Error(validation.errors.map(x=>x.message).join('\n'));e.name='DesignerValidationError';e.validation=validation;throw e;}
  const p=normalized(clone(input)),warnings=[...validation.warnings],levelModels=deriveLevels(p),base=levelModels[0],graph=base.graph,roofLevel=levelModels.filter(l=>l.closed).at(-1);
  const bounds=polygonBounds(p.walls.flatMap(w=>[w.a,w.b]).concat(p.objects.flatMap(o=>[o.a,...(o.b?[o.b]:[])])));
  const walls=p.walls.map(w=>({...w,length:dist(w.a,w.b),sectionSize:parseSection(w.section),grossArea:dist(w.a,w.b)*sum(levelModels.filter(l=>w.level===undefined||w.level===l.index).map(l=>l.height)),openingArea:sum(p.openings.filter(o=>o.wallId===w.id).map(o=>o.width*o.height))}));
  const geometry={area:graph.area,totalFloorArea:graph.closed?sum(levelModels.filter(l=>l.closed).map(l=>l.netFloorArea)):null,grossFloorArea:graph.closed?sum(levelModels.filter(l=>l.closed).map(l=>l.area)):null,voidArea:sum(levelModels.filter(l=>l.closed).map(l=>l.voidArea)),areaComplete:levelModels.every(l=>l.closed),perimeter:sum(base.walls.filter(w=>w.kind==='exterior').map(w=>dist(w.a,w.b))),bounds,baseBounds:base.bounds,closed:graph.closed,polygon:graph.polygon,roofPolygon:roofLevel?.polygon??[],roofBounds:roofLevel?.bounds??base.bounds,rectangular:false,levels:levelModels.map(({graph,walls,...l})=>l)};
  geometry.rectangular=graph.closed&&Math.abs(graph.area-base.bounds.width*base.bounds.height)<1e-5;
  const exteriorOpeningArea=sum(p.openings.filter(o=>walls.find(w=>w.id===o.wallId)?.kind==='exterior').map(o=>o.width*o.height));
  const openingArea=sum(p.openings.map(o=>o.width*o.height)),innerGross=sum(walls.filter(w=>w.kind!=='exterior').map(w=>w.grossArea));
  const roofRect=roofLevel&&Math.abs(roofLevel.area-roofLevel.bounds.width*roofLevel.bounds.height)<1e-5;
  const gableArea=finite(roofModel?.gableArea)?roofModel.gableArea:roofModel?0:roofLevel&&roofRect&&!['none','mono'].includes(p.roof.type)?roofLevel.bounds.height**2/2*Math.tan(p.roof.pitch*Math.PI/180):0;
  geometry.gableArea=gableArea;geometry.grossWallArea=sum(walls.filter(w=>w.kind==='exterior').map(w=>w.grossArea))+gableArea;geometry.netWallArea=geometry.grossWallArea-exteriorOpeningArea;geometry.openingArea=openingArea;geometry.exteriorOpeningArea=exteriorOpeningArea;geometry.innerWallArea=innerGross-(openingArea-exteriorOpeningArea);
  const corners=levelModels.flatMap(l=>cornerData(p,l.graph,l.index));warnings.push(...corners.filter(c=>c.warning).map(c=>c.warning));
  const timberParts=levelModels.map(level=>{
    const includeRoof=level.index===roofLevel?.index;
    const local={...p,height:level.height,floors:1,_baseY:level.baseY,_voids:level.voids,walls:level.walls,openings:p.openings.filter(o=>{const wall=p.walls.find(w=>w.id===o.wallId);return (o.floor??wall?.level??1)===level.index;}).map(o=>({...o,floor:1})),objects:p.objects.filter(o=>(o.level??1)===level.index),roof:includeRoof?p.roof:{...p.roof,type:'none'}};
    const model=timberModel(local,level.graph,corners.filter(c=>c.level===level.index),level.bounds,includeRoof?truss:undefined,warnings,includeRoof?roofModel:undefined);
    for(const board of model.instances){const ownLevel=board.category==='roof'&&(Number.isInteger(board.floor)||Number.isInteger(board.level))?(board.floor??board.level):level.index;board.level=ownLevel;board.floor=ownLevel;}
    model.braceBays=model.braceBays.map(b=>({...b,floor:level.index,level:level.index}));return model;
  });
  const timber=mergeTimber(timberParts,p),checks=[];
  if(timber.splices.some(s=>s.scheme==='fishplate'&&s.partIds.some(id=>timber.instances.find(b=>b.id===id)?.category==='roof')))warnings.push('Масса накладок на стыках кровли включена в общий вес дома, но локальная идеальная FEM-модель фермы не учитывает добавочный вес этих накладок. Её нагрузки требуют уточнения.');
  if(!graph.closed)warnings.push('Внешний контур не замкнут в один простой полигон. Площадь, площадные нагрузки и свайное поле не рассчитываются.');
  for(const l of levelModels)for(const v of l.voids)for(const w of l.walls.filter(w=>w.kind!=='exterior')){const cuts=[0,1];for(let k=0;k<v.polygon.length;k++){const hit=segmentHit(w.a,w.b,v.polygon[k],v.polygon[(k+1)%v.polygon.length]);if(hit)cuts.push(hit.t)}cuts.sort((a,b)=>a-b);let crosses=false;for(let k=1;k<cuts.length;k++)if(cuts[k]-cuts[k-1]>EPS&&pointInPolygon(lerp(w.a,w.b,(cuts[k]+cuts[k-1])/2),v.polygon,false))crosses=true;if(crosses){const note=`Стена ${w.id} на ${l.index} этаже проходит над зоной второго света ${v.id}. Её опирание не подтверждено: перенесите стену или задайте несущую передаточную конструкцию.`;warnings.push(note);checks.push({id:'wall-over-void-'+w.id+'-'+v.id,label:'Внутренняя стена над вторым светом',status:'unverified',note});}}
  for(const l of levelModels)if(!l.closed&&l.index>1)warnings.push(`Контур ${l.index} этажа не замкнут: его площадные нагрузки не включены, текущая площадь и расчёт неполны.`);
  if(graph.closed&&!geometry.rectangular&&p.roof.type!=='none'&&!roofModel)warnings.push('Непрямоугольный план: без зонной модели кровли покрытие и опирание не подтверждены.');
  for(const level of levelModels.slice(1))if(level.closed&&level.polygon.some(q=>!pointInPolygon(q,graph.polygon)))warnings.push(`Контур ${level.index} этажа выходит за основание: консоли и передаточные конструкции не рассчитаны.`);
  const assumptions=[
    'Концептуальная геометрия и распределение нагрузок, не нормативный рабочий проект и не метод конечных элементов.',
    'Стены заданы осями. Площадь по осям внешнего контура — общая геометрическая площадь, не чистая полезная площадь.',
    'height/levels[].height — высота стенового каркаса. baseY — низ платформы, wallBaseY — верх настила, topY — верх стен; следующий этаж начинается на topY предыдущего. Стены с level заданы независимо, без level — миграционно повторяются по этажам.',
    'Второй свет вырезает только платформу выбранного верхнего этажа. Стены и кровля сохраняются; добавлено геометрическое обрамление проёма, но его опирание, сечения и узлы требуют отдельного расчёта.',
    'Каждый timber.instance — отдельная физическая часть доски. length — длина по оси, cutLength — полная заготовка по длинным точкам косых резов; grossVolume нужен для закупки, netVolume и масса учитывают снятую половину нахлёстов halfLap/scarf.',
    'Угловые пакеты, косые углы, Т/X-узлы и угловые врубки показаны условно. Ослабление угловых врубок и крепёж не рассчитаны. Оптимизацию раскроя и пропил выполняет отдельный модуль, не этот геометрический расчёт.',
    'Слои перекрытия, кровли и стен вводятся без древесины. Вес всех сформированных досок добавляется ровно один раз. Площадь проёмов заменяет слои стены заданным весом заполнения.',
    'Треугольные фронтоны добавлены только для прямоугольного плана с симметричной двускатной кровлей. Для односкатной и нерегулярной кровли высоты фасадов и фронтоны требуют отдельного задания.',
    'Площадки свай формируются внутри полигона и на несущих стенах. Реакции — нормированная концептуальная аллокация по ближайшим опорам, без жёсткости ростверка, осадки, отрыва и геологии.',
    'Снег: только равномерный сбалансированный случай μ=0,8 до 30°, далее линейно до 0 на 60°; Ce=Ct=1. Нормативные сочетания, заносы и снегозадержатели не проверены.',
    'Ветер не добавляется в вертикальные реакции. Пространственная устойчивость, диафрагмы, анкеры и горизонтальные реакции не рассчитаны.',
    'Схема кровли по габаритному прямоугольнику требует проверки покрытия и опирания; отсутствие фермы означает отсутствие её древесины в весе.',
    'Физические стыки длинных досок не добавляют шарниры или жёсткость в расчёт фермы: её FEM-модель остаётся идеальной неразрезной по стержням. Геометрическое наращивание не подтверждает передачу усилий.',
    'При наращивании halfLap/scarf геометрические части перекрываются на lapLength; из массы каждого конца вычитается половина объёма нахлёста. Накладки fishplate — отдельные доски. Закупочный объём считается по полным cutLength, не по чистой массе.',
  ];
  let loads=null,piles=[],foundation=null;
  if(graph.closed){
    const A=graph.area,F=p.floors,mu=p.roof.pitch<=30?.8:.8*(60-p.roof.pitch)/30,roofArea=p.roof.type==='none'?0:finite(roofModel?.area)?roofModel.area:(roofLevel?.area??A)/Math.cos(p.roof.pitch*Math.PI/180),projectedRoofArea=finite(roofModel?.projectedArea)?roofModel.projectedArea:roofLevel?.area??A;
    const floorLayers=geometry.totalFloorArea*p.loads.floorDead,roofLayers=roofArea*p.loads.roofDead,wallWeight=geometry.netWallArea*p.loads.wallDead,innerWallWeight=geometry.innerWallArea*p.loads.wallDead,openingWeight=openingArea*p.loads.openingDead,gableWeight=gableArea*p.loads.wallDead,live=geometry.totalFloorArea*p.loads.live,snow=p.roof.type==='none'?0:p.loads.snow*(finite(roofModel?.snowEffectiveArea)?roofModel.snowEffectiveArea:projectedRoofArea*mu),dead=floorLayers+roofLayers+wallWeight+innerWallWeight+openingWeight+timber.weight;
    const rows=[{id:'floor-layers',label:'Слои перекрытий без древесины',characteristic:floorLayers,kind:'dead'},{id:'roof-layers',label:'Слои кровли без древесины',characteristic:roofLayers,kind:'dead'},{id:'wall-layers',label:'Слои наружных стен без древесины',characteristic:wallWeight,kind:'dead'},{id:'inner-layers',label:'Слои внутренних стен без древесины',characteristic:innerWallWeight,kind:'dead'},{id:'openings',label:'Заполнение проёмов',characteristic:openingWeight,kind:'dead'},...['walls','floor','roof','bracing','objects'].map(k=>({id:'timber-'+k,label:{walls:'Древесина стен и узлов',floor:'Древесина перекрытий',roof:'Древесина кровли',bracing:'Древесина укосин',objects:'Древесина отдельных объектов'}[k],characteristic:timber.totals[k].weight,kind:'dead'})),{id:'live',label:'Полезная нагрузка',characteristic:live,kind:'variable'},{id:'snow',label:'Снег',characteristic:snow,kind:'variable'}].map(r=>({...r,design:r.characteristic*(r.kind==='dead'?p.loads.gammaG:p.loads.gammaQ)}));
    const wallLineLoads=walls.map(w=>({wallId:w.id,weight:(w.grossArea-w.openingArea)*p.loads.wallDead+w.openingArea*p.loads.openingDead}));
    const roofMassIncluded=timber.roofGeometryAvailable||p.roof.type==='none',complete=roofMassIncluded&&geometry.areaComplete;
    loads={rows,dead,live,snow,mu,roofArea,projectedRoofArea,floorArea:geometry.totalFloorArea,roofWeight:roofLayers+timber.totals.roof.weight,wallWeight,innerWallWeight,openingWeight,gableWeight,wallLineLoads,timberWeight:timber.weight,totalCharacteristic:dead+live+snow,totalDesign:dead*p.loads.gammaG+(live+snow)*p.loads.gammaQ,windForceX:p.loads.wind*bounds.height*sum(levelModels.map(l=>l.height)),windForceY:p.loads.wind*bounds.width*sum(levelModels.map(l=>l.height)),complete,roofMassIncluded,missingLoads:[...(!roofMassIncluded?['Древесина кровли не сформирована.']:[]),...(!geometry.areaComplete?['Не все контуры этажей замкнуты.']:[])]};
    ({piles,foundation}=pileField(p,geometry,walls,timber,loads));
    checks.push({id:'verticalBalance',label:'Баланс вертикальных сил',status:Math.abs(foundation.balanceError)<1e-6?'pass':'fail',value:Math.abs(foundation.balanceError),limit:1e-6,unit:'кН'},{id:'pileCapacity',label:'Вертикальная реакция опоры',status:foundation.utilization>1?'fail':'warning',value:foundation.maxReaction,limit:p.foundation.capacity,unit:'кН',utilization:foundation.utilization});
    geometry.roofArea=roofArea;
  }
  if(truss&&!roofModel){
    checks.push(...(Array.isArray(truss.checks)?truss.checks.map(c=>({...c,id:'truss-'+c.id})):[]));
    if(truss.status==='fail'||truss.stable===false)checks.push({id:'trussSolution',label:'Расчётная модель фермы',status:'fail',note:(truss.errors||[]).join(' ')||'Ферма не прошла частные проверки или является механизмом.'});
    if(Array.isArray(truss.assumptions))assumptions.push(...truss.assumptions);
  }
  if(roofModel){if(Array.isArray(roofModel.checks))checks.push(...roofModel.checks.map(c=>({...c,id:'roof-'+c.id})));if(roofModel.status==='fail')checks.push({id:'roofZonesSolution',label:'Зонная модель кровли',status:'fail',note:'Кровля содержит невыполненные частные проверки.'});warnings.push(...(roofModel.warnings||[]));assumptions.push(...(roofModel.assumptions||[]));}
  checks.push({id:'roofSystem',label:'Покрытие и опирание кровли',status:'unverified',note:'Геометрия не подтверждает опирание ферм и устойчивость кровли.'},{id:'lateralStability',label:'Пространственная устойчивость',status:'unverified',note:'Связи, узлы, диафрагмы, ростверк и грунт требуют отдельных проверок.'});
  return {project:p,validation,geometry,walls,corners,graph:{nodes:levelModels.flatMap(l=>l.graph.nodes.map(({edges,...n})=>({...n,id:l.index===1?n.id:'j_'+l.index+'_'+nodeKey(n.point),level:l.index,degree:edges.length}))),edges:levelModels.flatMap(l=>l.graph.edges.map(e=>({...e,level:l.index})))},timber,splices:timber.splices,loads,piles,foundation,checks,warnings:[...new Set(warnings)],assumptions,roofModel:roofModel??null,status:!graph.closed?'open':checks.some(c=>c.status==='fail')?'fail':'unverified'};
}

import {defaultDesignerProject,parseSection,validateDesignerProject} from './designer-engine.js';
import {normalizeDesignerState} from './designer-state.js';

const EPS=1e-7,clone=x=>JSON.parse(JSON.stringify(x)),finite=Number.isFinite;
const object=q=>q!==null&&typeof q==='object'&&!Array.isArray(q);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const signed=p=>p.reduce((s,a,i)=>s+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0)/2;
const area=p=>Math.abs(signed(p));
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const bounds=p=>({minX:Math.min(...p.map(q=>q.x)),maxX:Math.max(...p.map(q=>q.x)),minY:Math.min(...p.map(q=>q.y)),maxY:Math.max(...p.map(q=>q.y))});
function on(q,a,b){return Math.abs(cross(a,b,q))<EPS&&q.x>=Math.min(a.x,b.x)-EPS&&q.x<=Math.max(a.x,b.x)+EPS&&q.y>=Math.min(a.y,b.y)-EPS&&q.y<=Math.max(a.y,b.y)+EPS;}
function inside(q,p){if(p.some((a,i)=>on(q,a,p[(i+1)%p.length])))return true;let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function hit(a,b,c,d){const u={x:b.x-a.x,y:b.y-a.y},v={x:d.x-c.x,y:d.y-c.y},ca={x:c.x-a.x,y:c.y-a.y},den=u.x*v.y-u.y*v.x;if(Math.abs(den)<EPS)return null;const t=(ca.x*v.y-ca.y*v.x)/den,s=(ca.x*u.y-ca.y*u.x)/den;return t>=-EPS&&t<=1+EPS&&s>=-EPS&&s<=1+EPS?{t,s}:null;}
function contained(subject,p){for(let i=0;i<subject.length;i++){const a=subject[i],b=subject[(i+1)%subject.length],cuts=[0,1];if(!inside(a,p))return false;for(let j=0;j<p.length;j++){const h=hit(a,b,p[j],p[(j+1)%p.length]);if(h)cuts.push(Math.max(0,Math.min(1,h.t)));}cuts.sort((a,b)=>a-b);for(let j=1;j<cuts.length;j++){const t=(cuts[j]+cuts[j-1])/2;if(!inside({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},p))return false;}}return true;}
function intersectsArea(a,b){if(a.some(q=>inside(q,b)&&!b.some((x,i)=>on(q,x,b[(i+1)%b.length]))))return true;if(b.some(q=>inside(q,a)&&!a.some((x,i)=>on(q,x,a[(i+1)%a.length]))))return true;for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){const h=hit(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]);if(h&&h.t>EPS&&h.t<1-EPS&&h.s>EPS&&h.s<1-EPS)return true;}const center=p=>({x:p.reduce((s,q)=>s+q.x,0)/p.length,y:p.reduce((s,q)=>s+q.y,0)/p.length});return inside(center(a),b)||inside(center(b),a);}
export class HouseGenerationError extends Error{constructor(field,message){super(message);this.name='HouseGenerationError';this.errors=[{field,message}];}}
const reject=(field,message)=>{throw new HouseGenerationError(field,message);};
function number(v,lo,hi,field){if(!finite(v)||v<lo||v>hi)reject(field,`${field}: требуется число от ${lo} до ${hi}.`);return v;}
function polygon(raw,field){
  if(!Array.isArray(raw)||raw.length<3||raw.length>100)reject(field,'Контур: массив из3–100 точек {x,y}.');
  let p=raw.map((q,i)=>{if(!object(q)||!finite(q.x)||!finite(q.y)||Math.abs(q.x)>1000||Math.abs(q.y)>1000)reject(`${field}.${i}`,'Координаты должны быть конечными числами в пределах±1000м.');return {x:q.x,y:q.y};});
  if(distance(p[0],p.at(-1))<EPS)p.pop();if(p.length<3)reject(field,'Контур должен иметь минимум3 различные вершины.');
  for(let i=0;i<p.length;i++){if(distance(p[i],p[(i+1)%p.length])<.2-EPS)reject(field,'Каждая сторона контура должна быть не короче0.2м.');for(let j=0;j<i;j++){if(Math.abs(i-j)===1||Math.abs(i-j)===p.length-1)continue;if(hit(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length])||on(p[i],p[j],p[(j+1)%p.length])||on(p[(i+1)%p.length],p[j],p[(j+1)%p.length]))reject(field,'Контур должен быть простым, без самопересечений и наложенных сторон.');}}
  const b=bounds(p);if(b.maxX-b.minX>100||b.maxY-b.minY>100||area(p)<.04)reject(field,'Контур: положительная площадь и габариты не более100×100м.');
  let changed=true;while(changed&&p.length>3){changed=false;for(let i=0;i<p.length;i++)if(Math.abs(cross(p[(i+p.length-1)%p.length],p[i],p[(i+1)%p.length]))<EPS){p.splice(i,1);changed=true;break;}}
  if(signed(p)<0)p.reverse();const first=p.reduce((best,q,i)=>q.x<p[best].x-EPS||Math.abs(q.x-p[best].x)<EPS&&q.y<p[best].y?i:best,0);p=p.slice(first).concat(p.slice(0,first));return p;
}
function explicitBounds(q,field){if(!object(q))reject(field,'bounds: {minX,minY,maxX,maxY} или {x,y,width,depth}.');const b=finite(q.minX)?{minX:q.minX,minY:q.minY,maxX:q.maxX,maxY:q.maxY}:{minX:q.x,minY:q.y,maxX:q.x+q.width,maxY:q.y+q.depth};if(!Object.values(b).every(finite)||b.maxX-b.minX<.2||b.maxY-b.minY<.2)reject(field,'bounds должен задавать невырожденный прямоугольник.');return b;}
function addPartition(project,a,b,level){
  let intervals=[[0,1]],dx=b.x-a.x,dy=b.y-a.y,L2=dx*dx+dy*dy;
  for(const w of project.walls.filter(w=>w.level===level)){if(Math.abs(cross(a,b,w.a))>EPS||Math.abs(cross(a,b,w.b))>EPS)continue;const t=q=>((q.x-a.x)*dx+(q.y-a.y)*dy)/L2,lo=Math.max(0,Math.min(t(w.a),t(w.b))),hi=Math.min(1,Math.max(t(w.a),t(w.b)));if(hi-lo<EPS)continue;intervals=intervals.flatMap(([x,y])=>hi<=x+EPS||lo>=y-EPS?[[x,y]]:[...(lo>x+EPS?[[x,lo]]:[]),...(hi<y-EPS?[[hi,y]]:[])]);}
  const ids=[];for(const [lo,hi]of intervals){const aa={x:a.x+dx*lo,y:a.y+dy*lo},zz={x:a.x+dx*hi,y:a.y+dy*hi};if(distance(aa,zz)<.2-EPS)reject('rooms.bounds','Раскладка создаёт отдельный участок перегородки короче0.2м; выровняйте границы помещений.');const id=`GEN-L${level}-P${project.walls.filter(w=>w.level===level&&w.kind==='partition').length+1}`;project.walls.push({id,level,a:aa,b:zz,kind:'partition',section:project._wallSection,studStep:.6});ids.push(id);}return ids;
}
function packSides(items,capacity){
  const order=[...items].sort((a,b)=>b.slot-a.slot||a.index-b.index),used=[0,0],assignment=new Map(),memo=new Set();let nodes=0;
  function place(i){if(i===order.length)return true;if(++nodes>200000)return false;const k=`${i}/${Math.round(used[0]*1e6)}/${Math.round(used[1]*1e6)}`;if(memo.has(k))return false;memo.add(k);for(const side of used[0]<=used[1]?[0,1]:[1,0]){if(side===1&&Math.abs(used[0]-used[1])<EPS)continue;const q=order[i];if(used[side]+q.slot>capacity+EPS)continue;used[side]+=q.slot;assignment.set(q.index,side);if(place(i+1))return true;used[side]-=q.slot;assignment.delete(q.index);}return false;}
  return place(0)?assignment:null;
}

export function generateHouse(spec={}){
  if(!object(spec))reject('spec','Параметры генерации должны быть объектом.');
  for(const k of ['sections','roof','loads','material','foundation','bracing'])if(spec[k]!==undefined&&!object(spec[k]))reject(k,`${k}: требуется объект параметров.`);
  if(spec.foundation?.grillage!==undefined&&!object(spec.foundation.grillage))reject('foundation.grillage','Ростверк задаётся объектом параметров.');
  const shape=spec.template??'rectangle';if(!['rectangle','l-shape'].includes(shape))reject('template','Шаблон: rectangle или l-shape.');
  let basePolygon;
  if(spec.footprint!==undefined)basePolygon=polygon(spec.footprint,'footprint');
  else{const W=number(spec.width??8,2,100,'width'),D=number(spec.depth??6,2,100,'depth');if(shape==='rectangle')basePolygon=rect(0,0,W,D);else{const wingW=number(spec.wingWidth??W/2,.4,W-.4,'wingWidth'),wingD=number(spec.wingDepth??D/2,.4,D-.4,'wingDepth');basePolygon=polygon([{x:0,y:0},{x:W,y:0},{x:W,y:wingD},{x:wingW,y:wingD},{x:wingW,y:D},{x:0,y:D}],'footprint');}}
  const requestedLevels=spec.levels??[{height:2.8}];if(!Array.isArray(requestedLevels)||requestedLevels.length<1||requestedLevels.length>2)reject('levels','Поддерживаются один или два этажа.');
  const levelPolygons=[];for(const [i,l]of requestedLevels.entries()){if(!object(l))reject(`levels.${i}`,'Этаж должен быть объектом.');number(l.height??2.8,2,5,`levels.${i}.height`);levelPolygons.push(l.footprint===undefined?clone(levelPolygons[0]??basePolygon):polygon(l.footprint,`levels.${i}.footprint`));}
  const sections={walls:'50x150',floor:'50x250',roof:'50x200',roofWeb:'50x100',bracing:'25x100',grillage:'50x200',...spec.sections};for(const [k,s]of Object.entries(sections))if(!parseSection(s))reject(`sections.${k}`,'Сечение: b×h в мм, в допустимом диапазоне расчётного ядра.');
  const levels=requestedLevels.map((l,i)=>({id:`GEN-LEVEL-${i+1}`,index:i+1,name:l.name??`${i+1} этаж`,height:l.height??2.8}));
  const roof={shape:'gable',pitch:25,pitchRight:spec.roof?.pitch??25,ridgeAngle:0,framing:'auto',wallFraming:'auto',...spec.roof};if(!['mono','gable','hip'].includes(roof.shape))reject('roof.shape','Форма крыши: mono, gable или hip.');number(roof.pitch,2,60,'roof.pitch');number(roof.pitchRight,2,60,'roof.pitchRight');if(!finite(roof.ridgeAngle))reject('roof.ridgeAngle','Направление крыши должно быть конечным числом градусов.');
  const input={...clone(defaultDesignerProject),name:spec.name??'Дом · параметрическая генерация',floors:levels.length,height:levels[0].height,levels,walls:[],openings:[],voids:[],objects:[],boardCuts:{},floor:{...defaultDesignerProject.floor,...spec.floor,section:spec.floor?.section??sections.floor},material:{...defaultDesignerProject.material,...spec.material},loads:{...defaultDesignerProject.loads,...spec.loads},foundation:{...defaultDesignerProject.foundation,...spec.foundation,grillage:{section:sections.grillage,plies:3,deflectionRatio:300,capSize:250,...spec.foundation?.grillage}},bracing:{...defaultDesignerProject.bracing,section:sections.bracing,...spec.bracing},roof:{...defaultDesignerProject.roof,...roof,type:roof.shape==='mono'?'mono':'fink',pitchLeft:roof.pitch,chordSection:sections.roof,webSection:sections.roofWeb}};
  input.annexes=clone(spec.annexes??[]);
  delete input.roof.zones;
  for(let i=0;i<levelPolygons.length;i++)for(let j=0;j<levelPolygons[i].length;j++)input.walls.push({id:`GEN-L${i+1}-W${j+1}`,level:i+1,a:{...levelPolygons[i][j]},b:{...levelPolygons[i][(j+1)%levelPolygons[i].length]},kind:'exterior',section:sections.walls,studStep:.6});
  const planning={rooms:[],checks:[],warnings:[],template:spec.footprint?'custom':shape,levels:levels.map((l,i)=>({...l,polygon:clone(levelPolygons[i]),area:area(levelPolygons[i])})),assumptions:['Размеры контуров заданы по осям стен. Площади автоматически спланированных комнат — в чистоте между гранями стен, без чистовых отделочных слоёв.','Коридор1.2м и требования программы являются условиями генератора. Эвакуация, инсоляция, доступность, вентиляция и нормативные требования к помещениям не подтверждаются этой раскладкой.']};
  if(levelPolygons.length>1&&!contained(levelPolygons[1],levelPolygons[0]))planning.warnings.push('Верхний этаж выходит за контур основания; консоли и передаточные конструкции не спроектированы.');
  if(spec.secondLight!==undefined){const v=spec.secondLight;if(!object(v)||v.level!==2||levels.length!==2)reject('secondLight','Второй свет задаётся как {level:2,polygon} при двух этажах.');const poly=polygon(v.polygon,'secondLight.polygon');if(!contained(poly,levelPolygons[1]))reject('secondLight.polygon','Контур второго света должен лежать внутри перекрытия второго этажа.');input.voids.push({id:'GEN-VOID-L2',level:2,kind:'doubleHeight',edgeSection:sections.floor,polygon:poly});}
  const rooms=spec.rooms??[];if(!Array.isArray(rooms)||rooms.length>30)reject('rooms','Программа помещений: массив не более30 комнат.');
  rooms.forEach((r,i)=>{if(!object(r)||typeof r.name!=='string'||!r.name||r.name.length>100)reject(`rooms.${i}`,'У каждой комнаты должно быть непустое имя до100 символов.');number(r.area,.5,10000,`rooms.${i}.area`);if(!Number.isInteger(r.level??1)||(r.level??1)<1||(r.level??1)>levels.length)reject(`rooms.${i}.level`,'Комната задана на несуществующем этаже.');for(const k of ['minWidth','minDepth'])if(r[k]!==undefined)number(r[k],.2,100,`rooms.${i}.${k}`);});
  input._wallSection=sections.walls;const wall= parseSection(sections.walls),D=wall.h/1000,B=wall.b/1000,endMargin=.35+D+4*B;
  const addOpening=(w,center,width,type,level,roomId)=>{const L=distance(w.a,w.b),offset=((center.x-w.a.x)*(w.b.x-w.a.x)+(center.y-w.a.y)*(w.b.y-w.a.y))/L-width/2,H=levels[level-1].height,door=type==='door',sill=door?0:Math.min(.8,H*.28),height=door?Math.min(2.1,H-2*B-.2):Math.min(1.4,H-2*B-.2-sill),id=`GEN-L${level}-O${input.openings.filter(o=>o.floor===level).length+1}`;
    if(width<.2||offset<endMargin-EPS||offset+width>L-endMargin+EPS)return null;const opening={id,wallId:w.id,offset,width,height,sill,type,floor:level,roomId};input.openings.push(opening);return id;};
  const reportRoom=(r,i,level,axisBounds,side,doorId=null)=>{const clear={minX:axisBounds.minX+D/2,maxX:axisBounds.maxX-D/2,minY:axisBounds.minY+D/2,maxY:axisBounds.maxY-D/2},poly=rect(clear.minX,clear.minY,clear.maxX,clear.maxY),width=clear.maxX-clear.minX,depth=clear.maxY-clear.minY;
    if(width<=0||depth<=0)reject(`rooms.${i}`,'Толщина стен поглощает размеры комнаты.');if(input.voids.some(v=>v.level===level&&intersectsArea(poly,v.polygon)))reject(`rooms.${i}`,'Комната пересекает второй свет; задайте другую программу или явныеbounds вне проёма.');
    const item={id:`GEN-ROOM-${i+1}`,name:r.name,level,kind:'room',polygon:poly,bounds:clear,axisBounds,area:width*depth,targetArea:r.area,dimensions:{width,depth},side,doorOpeningId:doorId,windowOpeningId:null};
    for(const [id,label,value,limit]of [['area','Площадь комнаты',item.area,r.area],['width','Минимальная ширина',width,r.minWidth],['depth','Минимальная глубина',depth,r.minDepth]]){const pass=limit===undefined||value>=limit-EPS;planning.checks.push({id:`${item.id}-${id}`,label:`${r.name}: ${label}`,status:limit===undefined?'unverified':pass?'pass':'fail',value,limit:limit??null,unit:id==='area'?'м²':'м',...(limit===undefined?{note:'Минимальный размер не задан программой помещений.'}:{})});if(!pass)reject(`rooms.${i}`,`${r.name}: ${label.toLowerCase()} ${value.toFixed(2)} меньше ${limit.toFixed(2)}.`);}
    if(item.area>r.area*1.15+.1)planning.warnings.push(`${r.name}: площадь ${item.area.toFixed(2)}м² больше целевой ${r.area.toFixed(2)}м² из-за минимальной геометрии входа и принятой полосы комнат.`);
    planning.rooms.push(item);return item;};
  for(const l of levels){const requested=rooms.map((r,index)=>({...r,index})).filter(r=>(r.level??1)===l.index);if(!requested.length)continue;const poly=levelPolygons[l.index-1],bb=bounds(poly),axisRectangle=poly.length===4&&Math.abs(area(poly)-(bb.maxX-bb.minX)*(bb.maxY-bb.minY))<EPS;
    if(requested.some(r=>r.bounds!==undefined)){
      if(requested.some(r=>r.bounds===undefined))reject('rooms','На одном этаже задайтеbounds для всех комнат либо для всех используйте автоматическую программу.');
      for(const r of requested){const b=explicitBounds(r.bounds,`rooms.${r.index}.bounds`),rp=rect(b.minX,b.minY,b.maxX,b.maxY);if(!contained(rp,poly))reject(`rooms.${r.index}.bounds`,'Комната выходит за реальный контур этажа.');if(planning.rooms.some(q=>q.level===l.index&&q.kind==='room'&&Math.min(q.axisBounds.maxX,b.maxX)-Math.max(q.axisBounds.minX,b.minX)>EPS&&Math.min(q.axisBounds.maxY,b.maxY)-Math.max(q.axisBounds.minY,b.minY)>EPS))reject(`rooms.${r.index}.bounds`,'Прямоугольники комнат накладываются.');for(let j=0;j<4;j++)addPartition(input,rp[j],rp[(j+1)%4],l.index);reportRoom(r,r.index,l.index,b,'explicit');}
      planning.warnings.push(`${l.index} этаж: явныеbounds сформированы; двери и связь с коридором требуют явного проекта проходов.`);continue;
    }
    if(!axisRectangle)reject('rooms',`Автоматическая программа комнат поддерживает осевой прямоугольник. Для ${l.index} этажа со свободным/L-контуром задайтеbounds каждой комнаты либо генерируйте оболочку безrooms.`);
    const alongX=bb.maxX-bb.minX>=bb.maxY-bb.minY,long=alongX?bb.maxX-bb.minX:bb.maxY-bb.minY,short=alongX?bb.maxY-bb.minY:bb.maxX-bb.minX,shortMin=alongX?bb.minY:bb.minX,shortMax=alongX?bb.maxY:bb.maxX,center=(shortMin+shortMax)/2,c0=center-(1.2+D)/2,c1=center+(1.2+D)/2,clearDepth=(short-1.2-3*D)/2;
    if(clearDepth<=.2)reject('rooms','Дом слишком узок для двух полос комнат и чистого коридора1.2м.');
    const items=requested.map(r=>{const minCross=alongX?r.minDepth:r.minWidth;if((minCross??0)>clearDepth+EPS)reject(`rooms.${r.index}`,'Минимальный поперечный размер не помещается между наружной стеной и коридором.');const minAlong=alongX?r.minWidth:r.minDepth;return {...r,slot:Math.max(r.area/clearDepth+D,(minAlong??0)+D,.6+2*endMargin)};});
    const assignment=packSides(items,long);if(!assignment)reject('rooms',`Программа ${l.index} этажа не размещается в двух полосах вдоль коридора. Уменьшите площади/минимальные размеры, увеличьте контур или задайтеbounds.`);
    const loc=(t,s)=>alongX?{x:bb.minX+t,y:s}:{x:s,y:bb.minY+t},corridorWalls=[0,1].map(side=>{const ids=addPartition(input,loc(0,side?c1:c0),loc(long,side?c1:c0),l.index);return input.walls.find(w=>w.id===ids[0]);});
    const corridorPoly=alongX?rect(bb.minX+D/2,center-.6,bb.maxX-D/2,center+.6):rect(center-.6,bb.minY+D/2,center+.6,bb.maxY-D/2);
    if(input.voids.some(v=>v.level===l.index&&intersectsArea(corridorPoly,v.polygon)))reject('rooms','Автоматический коридор пересекает второй свет; задайте явную планировкуbounds.');
    const corridor={id:`GEN-CORRIDOR-L${l.index}`,name:'Коридор',level:l.index,kind:'corridor',polygon:corridorPoly,area:area(corridorPoly),dimensions:{width:1.2,length:long-D}};planning.rooms.push(corridor);
    if(l.index===1){const c=loc(0,center),entrance=input.walls.find(w=>w.kind==='exterior'&&w.level===1&&on(c,w.a,w.b));if(entrance)corridor.accessOpeningId=addOpening(entrance,c,.9,'door',1,corridor.id);if(!corridor.accessOpeningId)planning.warnings.push('Наружная дверь в коридор не поместилась с принятыми отступами; доступ снаружи не спроектирован.');}else planning.warnings.push(`${l.index} этаж: лестница и доступ в коридор не спроектированы.`);
    for(const side of [0,1]){let cursor=0;for(const r of items.filter(r=>assignment.get(r.index)===side).sort((a,b)=>a.index-b.index)){const start=cursor,end=cursor+r.slot,axisBounds=alongX?{minX:bb.minX+start,maxX:bb.minX+end,minY:side?c1:bb.minY,maxY:side?bb.maxY:c0}:{minX:side?c1:bb.minX,maxX:side?bb.maxX:c0,minY:bb.minY+start,maxY:bb.minY+end};
        if(end<long-EPS)addPartition(input,loc(end,side?c1:shortMin),loc(end,side?shortMax:c0),l.index);
        const centerDoor=loc((start+end)/2,side?c1:c0),doorWidth=Math.min(.9,r.slot-2*endMargin),doorId=addOpening(corridorWalls[side],centerDoor,doorWidth,'door',l.index,`GEN-ROOM-${r.index+1}`);if(!doorId)reject(`rooms.${r.index}`,'Не удалось разместить дверь в коридор с необходимыми отступами от концов стены.');
        const item=reportRoom(r,r.index,l.index,axisBounds,side,doorId);planning.checks.push({id:`${item.id}-adjacency`,label:`${r.name}: дверь в коридор`,status:'pass',note:'Дверной проём расположен на общей границе комнаты и коридора.'});cursor=end;
      }}
  }
  // Place one window on a real exterior segment of each room, without crossing junctions.
  for(const room of planning.rooms.filter(r=>r.kind==='room')){const b=room.axisBounds,rp=rect(b.minX,b.minY,b.maxX,b.maxY),candidates=[];for(const w of input.walls.filter(w=>w.kind==='exterior'&&w.level===room.level))for(let i=0;i<4;i++){const a=rp[i],z=rp[(i+1)%4];if(on(a,w.a,w.b)&&on(z,w.a,w.b)){const len=distance(a,z),windowWidth=Math.min(1.5,len-2*endMargin);if(windowWidth>=.4)candidates.push({w,center:{x:(a.x+z.x)/2,y:(a.y+z.y)/2},width:windowWidth});}}
    candidates.sort((a,b)=>b.width-a.width||a.w.id.localeCompare(b.w.id));for(const q of candidates){const id=addOpening(q.w,q.center,q.width,'window',room.level,room.id);if(id){room.windowOpeningId=id;break;}}
    if(!room.windowOpeningId)planning.warnings.push(`${room.name}: автоматическое наружное окно не помещается; освещение и вентиляция не подтверждены.`);
  }
  delete input._wallSection;
  const project=normalizeDesignerState(input),validation=validateDesignerProject(project);if(!validation.valid){const e=new HouseGenerationError('project','Сгенерированная модель не прошла строгую проверку: '+validation.errors.map(e=>e.message).join(' '));e.errors=validation.errors;throw e;}
  planning.checks.push({id:'generation-project-validation',label:'Геометрия проекта и входные параметры',status:'pass',note:'Итоговый проект прошёл validateDesignerProject.'},{id:'generation-building-design',label:'Архитектура, конструкции и инженерные системы',status:'unverified',note:'Программа помещений и валидный контур не подтверждают полный строительный проект. Выполните расчёт ядра и проработайте узлы/доступ/системы.'});
  planning.warnings=[...new Set([...planning.warnings,...validation.warnings])];return {project,planning};
}

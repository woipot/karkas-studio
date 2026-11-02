import {deriveWallProfiles} from './wall-profiles.js';
import {calculateRafter} from './rafters.js';
import {buildRafterSupports} from './rafter-supports.js';
import {timberSections} from './catalog.js';
import {calculateRoofDrainage,orientRoofsAwayFromWalls} from './roof-drainage.js';
import {buildTruss,trussSources} from './trusses.js';
const EPS=1e-7,G=9.80665;
const sum=a=>a.reduce((s,x)=>s+x,0),finite=Number.isFinite;
const mu=pitch=>pitch<=30?.8:Math.max(0,.8*(60-pitch)/30);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const signedArea=p=>sum(p.map((a,i)=>a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y))/2;
const area=p=>Math.abs(signedArea(p));
const near=(a,b)=>Math.abs(a-b)<EPS;
const sec=s=>{const m=typeof s==='string'&&s.match(/^(\d+)\s*[x×]\s*(\d+)$/);return m?{b:+m[1],h:+m[2]}:null;};
const unique=a=>[...a].sort((a,b)=>a-b).filter((v,i,s)=>!i||!near(v,s[i-1]));
const on=(p,a,b)=>Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;
function inside(p,poly){if(poly.some((a,i)=>on(p,a,poly[(i+1)%poly.length])))return true;let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
function clean(poly){let p=(poly??[]).map(q=>({x:q.x,y:q.y}));if(p.length>1&&Math.hypot(p[0].x-p.at(-1).x,p[0].y-p.at(-1).y)<EPS)p.pop();p=p.filter((q,i)=>i===0||Math.hypot(q.x-p[i-1].x,q.y-p[i-1].y)>EPS);let again=true;while(again&&p.length>3){again=false;for(let i=0;i<p.length;i++)if(Math.abs(cross(p[(i+p.length-1)%p.length],p[i],p[(i+1)%p.length]))<EPS){p.splice(i,1);again=true;break;}}if(signedArea(p)<0)p.reverse();return p;}
function triangulate(poly){const p=clean(poly),indices=p.map((_,i)=>i),out=[];let guard=0;while(indices.length>3&&guard++<p.length*p.length){let found=false;for(let j=0;j<indices.length;j++){const ia=indices[(j+indices.length-1)%indices.length],ib=indices[j],ic=indices[(j+1)%indices.length],a=p[ia],b=p[ib],c=p[ic];if(cross(a,b,c)<=EPS)continue;const blocks=indices.some(k=>k!==ia&&k!==ib&&k!==ic&&cross(a,b,p[k])>=-EPS&&cross(b,c,p[k])>=-EPS&&cross(c,a,p[k])>=-EPS);if(blocks)continue;out.push([a,b,c]);indices.splice(j,1);found=true;break;}if(!found)throw Error('Полигон зоны не является простым невырожденным контуром.');}if(indices.length===3)out.push(indices.map(i=>p[i]));return out;}
function clip(poly,fn){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],fa=fn(a),fb=fn(b),ina=fa>=-EPS,inb=fb>=-EPS;if(ina)out.push(a);if(ina!==inb){const t=fa/(fa-fb);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}}return clean(out);}
function lineIntervals(poly,at){const hits=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(near(a.x,at))hits.push(a.y);if(near(b.x,at))hits.push(b.y);if((a.x-at)*(b.x-at)<-EPS*EPS)hits.push(a.y+(b.y-a.y)*(at-a.x)/(b.x-a.x));}const values=unique(hits),out=[];for(let i=1;i<values.length;i++)if(values[i]-values[i-1]>EPS&&inside({x:at,y:(values[i]+values[i-1])/2},poly))out.push([values[i-1],values[i]]);return out;}
function subtractIntervals(intervals,covers){let out=intervals;for(const [c,d] of covers){const next=[];for(const [a,b] of out){if(d<=a+EPS||c>=b-EPS)next.push([a,b]);else{if(c>a+EPS)next.push([a,c]);if(d<b-EPS)next.push([d,b]);}}out=next;}return out;}
function overlapArea(a,b){let total=0;for(const ta of triangulate(a))for(const tb of triangulate(b)){let part=ta;for(let i=0;i<3&&part.length>=3;i++)part=clip(part,q=>cross(tb[i],tb[(i+1)%3],q));if(part.length>=3)total+=area(part);}return total;}
function subtractConvex(subject,cutter){let remainder=subject;const outside=[];for(let i=0;i<cutter.length&&remainder.length>=3;i++){const a=cutter[i],b=cutter[(i+1)%cutter.length],piece=clip(remainder,q=>-cross(a,b,q));if(piece.length>=3&&area(piece)>EPS)outside.push(piece);remainder=clip(remainder,q=>cross(a,b,q));}return outside;}

/** Exact rectangular partition of an orthogonal polygon; no bounding-box roof. */
export function autoRoofZones(polygon,defaults={}){
  const p=clean(polygon);if(p.length<3||p.some(q=>!finite(q.x)||!finite(q.y)))return [];
  const axisAligned=q=>q.every((a,i)=>{const b=q[(i+1)%q.length];return near(a.x,b.x)||near(a.y,b.y);});
  const orthogonal=axisAligned(p)&&(defaults.excludePolygons??[]).every(q=>axisAligned(clean(q)));
  const base={shape:defaults.type==='mono'?'mono':'gable',ridgeAngle:0,pitchLeft:defaults.pitch??25,pitchRight:defaults.pitch??25,elevation:null,framing:'auto',deflectionRatio:300,trussType:['king','queen','fink','mono'].includes(defaults.type)?defaults.type:'fink',spacing:defaults.spacing??.6,chordSection:defaults.chordSection??'50x150',webSection:defaults.webSection??'50x100',...defaults};delete base.zones;delete base.excludePolygons;
  const excludes=(defaults.excludePolygons??[]).map(clean),xs=unique(p.concat(...excludes).map(q=>q.x)),rects=[];
  if(!orthogonal){
    if(excludes.some(q=>overlapArea(p,q)>=area(p)-1e-5))return [];
    if(!excludes.some(q=>overlapArea(p,q)>EPS))return [{...base,id:defaults.idPrefix??'roof-auto-1',name:'Кровля по контуру',polygon:p,automatic:true,needsClippedFraming:true}];
    let pieces=triangulate(p);for(const excluded of excludes)for(const triangle of triangulate(excluded)){pieces=pieces.flatMap(q=>subtractConvex(q,triangle));if(pieces.length>100)return [];}
    return pieces.filter(q=>area(q)>.01).map((polygon,i)=>({...base,id:`${defaults.idPrefix??'roof-auto'}-${i+1}`,name:`Кровля по контуру ${i+1}`,polygon,automatic:true,needsClippedFraming:true}));
  }
  for(let i=1;i<xs.length;i++){
    const x0=xs[i-1],x1=xs[i];if(x1-x0<EPS)continue;
    const mid=(x0+x1)/2,intervals=subtractIntervals(lineIntervals(p,mid),excludes.flatMap(e=>lineIntervals(e,mid)));
    for(const [a,b] of intervals){const previous=rects.find(r=>near(r.x1,x0)&&near(r.y0,a)&&near(r.y1,b));if(previous)previous.x1=x1;else rects.push({x0,x1,y0:a,y1:b});}
  }
  return rects.map((r,i)=>({...base,id:`${defaults.idPrefix??'roof-auto'}-${i+1}`,name:`Кровля ${i+1}`,polygon:[{x:r.x0,y:r.y0},{x:r.x1,y:r.y0},{x:r.x1,y:r.y1},{x:r.x0,y:r.y1}],automatic:true}));
}

function contained(poly,building){
  if(!building?.length)return true;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],ts=[0,1];
    if(!inside(a,building))return false;
    for(let j=0;j<building.length;j++){const c=building[j],d=building[(j+1)%building.length],vx=b.x-a.x,vy=b.y-a.y,wx=d.x-c.x,wy=d.y-c.y,den=vx*wy-vy*wx;if(Math.abs(den)<EPS)continue;const t=((c.x-a.x)*wy-(c.y-a.y)*wx)/den,s=((c.x-a.x)*vy-(c.y-a.y)*vx)/den;if(t>0&&t<1&&s>=0&&s<=1)ts.push(t);}
    const v=unique(ts);for(let j=1;j<v.length;j++){const t=(v[j-1]+v[j])/2;if(!inside({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},building))return false;}
  }
  return true;
}

export function calculateRoofZones(p,baseResult,{autoOrient=true}={}){
  const r=baseResult??{},geometry=r.geometry??{},levels=(geometry.levels??[]).filter(l=>l.closed&&l.polygon?.length>=3),platform=r.timber?.platformHeight??((sec(p.floor?.section)?.h??250)/1000+.035);
  const levelTop=l=>finite(l.topY)?l.topY:l.elevation+l.height;
  const fallbackEave=.72+(p.floors??1)*((p.height??2.8)+platform),last=levels.at(-1),defaultEave=last?levelTop(last):fallbackEave;
  const building=geometry.roofPolygon??last?.polygon??geometry.polygon??[];
  const out={zones:[],instances:[],surfaces:[],ridges:[],valleys:[],area:0,projectedArea:0,snowEffectiveArea:0,gableArea:0,mass:0,volume:0,checks:[],warnings:[],assumptions:[],sources:[...trussSources,{title:'JRC · Snow load shape coefficients',url:'https://eurocodes.jrc.ec.europa.eu/sites/default/files/2022-06/1_Views_from_ECEE.pdf'}],status:'unverified',complete:true},closures=[];
  if(p.roof?.type==='none')return out;
  let requested;
  if(p.roof?.zones!==undefined&&!Array.isArray(p.roof.zones)){out.status='fail';out.complete=false;out.warnings.push('roof.zones должен быть массивом зон.');out.checks.push({id:'roof-zones-input',label:'Данные зон кровли',status:'fail',note:out.warnings[0]});return out;}
  if(Array.isArray(p.roof?.zones))requested=p.roof.zones;
  else if(levels.length){requested=[];for(let i=0;i<levels.length;i++){const l=levels[i];requested.push(...autoRoofZones(l.polygon,{...p.roof,elevation:null,idPrefix:`roof-level-${l.index??i}`,levelIndex:l.index??i,excludePolygons:levels.slice(i+1).map(l=>l.polygon)}));}}
  else requested=autoRoofZones(building,p.roof??{});
  if(requested.length>100){out.status='fail';out.complete=false;out.warnings.push('Поддерживается не более 100 зон кровли.');out.checks.push({id:'roof-zones-limit',label:'Количество зон кровли',status:'fail',note:out.warnings[0]});return out;}
  const density=p.material?.density??500,E=p.material?.E??10000;
  const add=(zone,role,b,h,a,z,extra={})=>{const length=Math.hypot(...z.map((v,i)=>v-a[i]));if(length<EPS)return;const volume=b*h*length/1e6,mass=volume*density;out.instances.push({id:`${zone.id}-B${String(out.instances.length+1).padStart(4,'0')}`,name:role==='web'?'Решётка фермы':role==='bottom'?'Нижний пояс фермы':'Верхний пояс / стропило',category:'roof',role,b,h,section:`${b} × ${h}`,length,volume,mass,start:a,end:z,crossAxis:[Math.cos(zone.ridgeAngle*Math.PI/180),0,Math.sin(zone.ridgeAngle*Math.PI/180)],zoneId:zone.id,level:zone.levelIndex,floor:zone.levelIndex,cutStart:{scheme:'butt',angle:0},cutEnd:{scheme:'butt',angle:0},...extra});};
  for(let zi=0;zi<requested.length;zi++){
    const input=requested[zi];
    if(!input||typeof input!=='object'||Array.isArray(input)){out.complete=false;out.warnings.push(`Зона ${zi+1}: требуется объект параметров.`);out.checks.push({id:`roof-zone-${zi}-input`,label:`Зона ${zi+1}: данные`,status:'fail'});continue;}
    const z={framing:p.roof?.framing??'auto',deflectionRatio:p.roof?.deflectionRatio??300,shape:p.roof?.type==='mono'?'mono':'gable',ridgeAngle:0,pitchLeft:p.roof?.pitch??25,pitchRight:p.roof?.pitch??25,trussType:p.roof?.type??'fink',spacing:p.roof?.spacing??.6,chordSection:p.roof?.chordSection??'50x150',webSection:p.roof?.webSection??'50x100',...input,id:input.id??`roof-zone-${zi+1}`,warnings:[]};
    try{
      if(!Array.isArray(z.polygon)||z.polygon.length<3||z.polygon.length>200||z.polygon.some(q=>!q||typeof q!=='object'||!finite(q.x)||!finite(q.y)))throw Error('Нужен полигон от 3 до 200 точек с конечными координатами.');
      if(typeof z.id!=='string'||!z.id||out.zones.some(q=>q.id===z.id))throw Error('ID зоны должен быть непустой уникальной строкой.');
      z.polygon=clean(z.polygon);if(area(z.polygon)<.01)throw Error('Площадь зоны слишком мала.');
      if(!['gable','mono','hip'].includes(z.shape))throw Error('Неизвестная форма кровли.');
      if(!['auto','rafters','truss'].includes(z.framing))throw Error('Несущая схема: auto, rafters или truss.');
      if(!finite(z.deflectionRatio)||z.deflectionRatio<150||z.deflectionRatio>600)throw Error('Предел прогиба: L/150…L/600.');
      if(z.framing==='rafters'&&z.shape!=='mono')throw Error('Стропильная балочная схема пока поддерживает только односкатную кровлю.');
      if(!finite(z.ridgeAngle)||![z.pitchLeft,z.pitchRight].every(v=>finite(v)&&v>=2&&v<=60)||!finite(z.spacing)||z.spacing<.2||z.spacing>3)throw Error('Задайте уклоны 2…60°, конечный азимут и шаг 0,2…3 м.');
      if(z.elevation!==null&&z.elevation!==undefined&&(!finite(z.elevation)||z.elevation<0||z.elevation>100))throw Error('Высота зоны должна быть конечной положительной отметкой.');
      let chord=sec(z.chordSection);const web=sec(z.webSection);if(!chord||!web||chord.b<15||chord.h<chord.b||web.b<15||web.h<web.b)throw Error('Некорректное сечение доски.');
      const designated=levels.find(l=>l.index===z.levelIndex);
      z.eave=z.elevation??(designated?levelTop(designated):defaultEave);
      const level=designated??levels.find(l=>Math.abs(levelTop(l)-z.eave)<.01),allowed=level?.polygon??building;
      z.levelIndex=level?.index??z.levelIndex??last?.index??1;
      if(allowed.length&&!contained(z.polygon,allowed))throw Error('Зона выходит за контур своего этажа или перекрывает внешний вырез. Разделите её по реальным крыльям дома.');
      for(const q of out.zones){const overlappingArea=overlapArea(z.polygon,q.polygon);if(overlappingArea>1e-5)throw Error(`Зона перекрывает ${q.name??q.id} на ${overlappingArea.toFixed(2)} м². Перекрытие не учитывается повторно; разделите полигоны.`);}
      const theta=z.ridgeAngle*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta),toLocal=q=>({x:q.x*c+q.y*s,y:-q.x*s+q.y*c}),toWorld=(u,v,h)=>[u*c-v*s,z.eave+(z.rafterAxisLift??0)+h,u*s+v*c];
      const poly=z.polygon.map(toLocal),u0=Math.min(...poly.map(q=>q.x)),u1=Math.max(...poly.map(q=>q.x)),v0=Math.min(...poly.map(q=>q.y)),v1=Math.max(...poly.map(q=>q.y)),S=v1-v0,L=u1-u0;
      if(S<.1||L<.1)throw Error('Нулевая ширина или длина зоны.');
      if(Math.ceil((L-EPS)/z.spacing)>600)throw Error('Слишком много поперечных рам: разделите зону или увеличьте шаг.');
      const tl=Math.tan(z.pitchLeft*Math.PI/180),tr=Math.tan(z.pitchRight*Math.PI/180),rise=z.shape==='mono'?S*tl:S*tl*tr/(tl+tr),ridgeV=z.shape==='mono'?v1:v0+rise/tl;
      z.area=area(poly);z.rise=rise;z.crestRatio=(ridgeV-v0)/S;z.bounds={minU:u0,maxU:u1,minV:v0,maxV:v1,length:L,span:S};
      const planes=z.shape==='mono'?[{a:0,b:tl,d:-tl*v0,kind:'left'}]:[{a:0,b:tl,d:-tl*v0,kind:'left'},{a:0,b:-tr,d:tr*v1,kind:'right'}];
      if(z.shape==='hip'){const th=(tl+tr)/2;planes.push({a:th,b:0,d:-th*u0,kind:'hip-start'},{a:-th,b:0,d:th*u1,kind:'hip-end'});z.warnings.push('Вальмовые скаты сформированы геометрически; накосные стропила, узлы и расчётная решётка не определены.');out.complete=false;}
      const height=(u,v)=>Math.min(...planes.map(p=>p.a*u+p.b*v+p.d));
      const triangles=triangulate(poly);z.surfaceArea=0;z.snowEffectiveArea=0;
      for(let pi=0;pi<planes.length;pi++)for(const triangle of triangles){const plane=planes[pi];let part=triangle;for(let pj=0;pj<planes.length&&part.length>=3;pj++)if(pi!==pj){const other=planes[pj];part=clip(part,q=>(other.a-plane.a)*q.x+(other.b-plane.b)*q.y+other.d-plane.d);}if(part.length<3||area(part)<EPS)continue;const projected=area(part),actual=projected*Math.sqrt(1+plane.a**2+plane.b**2);z.surfaceArea+=actual;z.snowEffectiveArea+=projected*mu(Math.atan(Math.hypot(plane.a,plane.b))*180/Math.PI);out.surfaces.push({id:`${z.id}-S${out.surfaces.length+1}`,zoneId:z.id,kind:plane.kind,points:part.map(q=>toWorld(q.x,q.y,height(q.x,q.y))),area:actual,projectedArea:projected});}
      let ridgeSegments=[];
      if(z.shape==='hip'){
        const th=(tl+tr)/2,run=rise/th;
        if(L>=2*run){ridgeSegments=lineIntervals(poly.map(q=>({x:q.y,y:q.x})),ridgeV).map(([a,b])=>[Math.max(a,u0+run),Math.min(b,u1-run)]).filter(([a,b])=>b-a>EPS).map(([a,b])=>({start:toWorld(a,ridgeV,rise),end:toWorld(b,ridgeV,rise)}));}
        else{const u=(u0+u1)/2,h=th*L/2,a=v0+h/tl,b=v1-h/tr;ridgeSegments=lineIntervals(poly,u).map(([lo,hi])=>[Math.max(lo,a),Math.min(hi,b)]).filter(([a,b])=>b-a>EPS).map(([a,b])=>({start:toWorld(u,a,h),end:toWorld(u,b,h)}));}
      }else if(z.shape!=='mono')ridgeSegments=lineIntervals(poly.map(q=>({x:q.y,y:q.x})),ridgeV).map(([a,b])=>({start:toWorld(a,ridgeV,height(a,ridgeV)),end:toWorld(b,ridgeV,height(b,ridgeV))}));
      z.ridge=ridgeSegments.length?{...ridgeSegments[0],segments:ridgeSegments}:null;
      for(const q of ridgeSegments)out.ridges.push({id:`${z.id}-R${out.ridges.length+1}`,zoneId:z.id,...q});
      const rectangle=poly.length===4&&Math.abs(z.area-L*S)<1e-5;
      const n=Math.max(1,Math.ceil((L-EPS)/z.spacing)),inset=Math.min(chord.b/2000,L/4);
      z.actualSpacing=Math.max((L-2*inset)/n,inset+(L-2*inset)/(2*n));
      z.requestedSection=z.chordSection;z.selectedSection=z.chordSection;
      z.effectiveFraming=z.shape==='hip'?'geometric':'truss';
      z.framingReason=z.shape==='hip'?'Вальмовая геометрия без расчётной пространственной схемы.':'Для двускатной зоны выбрана схема ферм.';
      z.rafterAnalysis=null;
      if(z.shape==='mono'){
        const params={horizontalSpan:S,pitch:z.pitchLeft,b:chord.b,h:chord.h,spacing:z.actualSpacing,roofDead:p.loads?.roofDead??.5,snow:p.loads?.snow??1.5,mu:mu(z.pitchLeft),gammaG:p.loads?.gammaG??1.1,gammaQ:p.loads?.gammaQ??1.4,E,Fb:p.material?.Fb??13,Fv:p.material?.Fv??1.5,Ft:p.material?.Ft??8,Fc:p.material?.Fc??12,density,deflectionRatio:z.deflectionRatio};
        const requestedAnalysis=calculateRafter(params);
        const candidates=[{id:z.chordSection,b:chord.b,h:chord.h},...timberSections.filter(q=>q.category==='board'&&q.b===chord.b&&q.h>chord.h&&q.h<=250).sort((a,b)=>a.h-b.h)];
        let chosen=null;
        if(z.framing==='auto')for(const candidate of candidates){const analysis=calculateRafter({...params,b:candidate.b,h:candidate.h});if(analysis.status!=='fail'&&analysis.slopeLength<=6+EPS){chosen={candidate,analysis};break;}}
        if(z.framing==='rafters'||chosen){
          z.effectiveFraming='rafters';z.rafterAnalysis=chosen?.analysis??requestedAnalysis;
          if(chosen){z.selectedSection=chosen.candidate.id;chord={b:chosen.candidate.b,h:chosen.candidate.h};}
          z.framingReason=z.framing==='rafters'?'Стропильные балки выбраны вручную; превышения выбранного сечения показаны в проверках.':z.selectedSection===z.chordSection?'Стропильная балка проходит частные проверки при заданных нагрузках и шаге.':`Автоподбор: ${z.chordSection.replace('x',' × ')} мм недостаточно; выбрано ${z.selectedSection.replace('x',' × ')} мм по изгибу, сдвигу и прогибу.`;
          if(z.rafterAnalysis.slopeLength>6+EPS){z.warnings.push('Стропило длиннее 6 м: наращивание без промежуточной опоры и расчёта стыка не подтверждено.');out.checks.push({id:`${z.id}-rafter-splice`,zoneId:z.id,label:'Наращивание стропильной балки',status:'unverified',note:'Физический стык не уменьшает расчётный пролёт.'});out.complete=false;}
        }else{
          z.rafterTrial=requestedAnalysis;
          z.framingReason=z.framing==='truss'?'Фермы выбраны вручную.':requestedAnalysis.slopeLength>6+EPS?'Цельное стропило длиннее 6 м. Авто предлагает ферму; альтернативы — промежуточная опора или рассчитанное наращивание.':'В выбранном диапазоне досок стропила не проходят частные проверки. Авто предлагает ферму; можно изменить сечение, шаг или добавить опору.';
        }
      }
      if(z.effectiveFraming==='rafters'){
        z.rafterAxisLift=chord.h/2000/Math.cos(z.pitchLeft*Math.PI/180);
        for(const surface of out.surfaces.filter(q=>q.zoneId===z.id))for(const point of surface.points)point[1]+=z.rafterAxisLift;
      }
      z.effectiveSection=z.selectedSection;
      z.analysis=z.shape==='hip'||z.effectiveFraming==='rafters'?null:buildTruss({type:z.shape==='mono'?'mono':(['king','queen','fink'].includes(z.trussType)?z.trussType:'fink'),span:S,rise,crestRatio:z.shape==='mono'?.5:z.crestRatio,chordB:chord.b,chordH:chord.h,webB:web.b,webH:web.h,spacing:z.actualSpacing,roofDead:p.loads?.roofDead??.5,snow:p.loads?.snow??1.5,mu:.8,muLeft:mu(z.pitchLeft),muRight:mu(z.pitchRight),gammaG:p.loads?.gammaG??1.1,gammaQ:p.loads?.gammaQ??1.4,E,tensionDesign:p.material?.Ft??8,compressionDesign:p.material?.Fc??12,timberDensity:density});
      z.analysisApplicable=rectangle&&(z.effectiveFraming==='rafters'?!!z.rafterAnalysis&&!z.rafterAnalysis.errors?.length:z.shape!=='hip'&&z.analysis?.stable===true);
      if(z.effectiveFraming==='truss'&&!z.analysis?.stable){z.warnings.push('Расчётная ферма не сформирована; показаны только геометрические стропила.');out.complete=false;}
      let partialFrames=0;const zoneMemberStart=out.instances.length;
      for(let row=0;row<=n;row++){
        const inset=Math.min(chord.b/2000,L/4),u=u0+inset+(L-2*inset)*row/n,intervals=lineIntervals(poly,u);if(!intervals.length)continue;
        const full=intervals.length===1&&near(intervals[0][0],v0)&&near(intervals[0][1],v1);if(!full)partialFrames++;
        if(z.effectiveFraming==='rafters'){
          for(const [a,b] of intervals)add(z,'rafter',chord.b,chord.h,toWorld(u,a,height(u,a)),toWorld(u,b,height(u,b)),{name:'Стропильная балка',rafterRow:row,unverified:!full||!z.analysisApplicable});
        }else if(z.shape==='hip'||!z.analysis?.bars?.length){
          for(const [a,b] of intervals){let values=[a,b,ridgeV];for(const plane of planes.filter(p=>Math.abs(p.b)>EPS))for(const other of planes.filter(p=>Math.abs(p.b)<EPS))values.push((other.a*u+other.d-plane.d)/plane.b);values=unique(values.filter(v=>v>=a-EPS&&v<=b+EPS));for(let j=1;j<values.length;j++)add(z,'top',chord.b,chord.h,toWorld(u,values[j-1],height(u,values[j-1])),toWorld(u,values[j],height(u,values[j])),{trussRow:row,unverified:true});add(z,'bottom',chord.b,chord.h,toWorld(u,a,0),toWorld(u,b,0),{trussRow:row,unverified:true});}
        }else{
          const map=new Map(z.analysis.nodes.map(q=>[q.id,q]));
          for(const bar of z.analysis.bars){const a=map.get(bar.nodeA),b=map.get(bar.nodeB),va=v0+a.x,vb=v0+b.x;
            for(const [lo,hi] of intervals){let t0=0,t1=1;if(Math.abs(vb-va)<EPS){if(va<lo-EPS||va>hi+EPS)continue;}else{const ta=(lo-va)/(vb-va),tb=(hi-va)/(vb-va);t0=Math.max(0,Math.min(ta,tb));t1=Math.min(1,Math.max(ta,tb));if(t1-t0<EPS)continue;}const point=t=>toWorld(u,va+(vb-va)*t,a.y+(b.y-a.y)*t);add(z,bar.role,bar.b,bar.h,point(t0),point(t1),{trussRow:row,trussBarId:bar.id,clipped:t0>EPS||t1<1-EPS,force:full&&z.analysisApplicable?bar.force:null,unverified:!full||!z.analysisApplicable});}
          }
        }
      }
      if(z.effectiveFraming==='rafters')out.checks.push(...(z.rafterAnalysis?.checks??[]).map(q=>({...q,id:`${z.id}-${q.id}`,zoneId:z.id})));
      z.partialFrames=partialFrames;if(partialFrames){z.analysisApplicable=false;z.warnings.push('Часть элементов обрезана по контуру. Их узлы и опирание требуют отдельной схемы; типовой расчёт к ним не применяется.');out.complete=false;}
      if(!rectangle)z.warnings.push('Косой или непрямоугольный контур: скаты и доски ограничены полигоном, кромки и пространственная схема не рассчитаны.');
      if(z.analysisApplicable&&z.analysis)out.checks.push(...z.analysis.checks.map(q=>({...q,id:`${z.id}-${q.id}`,zoneId:z.id})));
      out.checks.push({id:`${z.id}-junctions`,label:`${z.name??z.id}: примыкания и раскрепление`,status:'unverified',note:'Опоры, крепление примыканий и связь из плоскости не рассчитаны. Геометрический сток проверяется отдельно.'});
      out.zones.push(z);closures.push({z,toLocal,height,planes});out.area+=z.surfaceArea;out.projectedArea+=z.area;out.snowEffectiveArea+=z.snowEffectiveArea;out.warnings.push(...z.warnings.map(w=>`${z.name??z.id}: ${w}`));
    }catch(error){out.warnings.push(`${z.name??z.id}: ${error.message}`);out.checks.push({id:`${z.id}-geometry`,label:`${z.name??z.id}: геометрия кровли`,status:'fail',note:error.message});out.complete=false;}
  }
  // Vertical roof closures on exterior edges only. Shared zone boundaries are
  // not counted twice as full gables; their structural junction remains unknown.
  for(const data of closures){const {z,toLocal,height,planes}=data;z.gableArea=0;
    for(let i=0;i<z.polygon.length;i++){
      const a=z.polygon[i],b=z.polygon[(i+1)%z.polygon.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),covered=[];
      for(const other of out.zones)if(other!==z)for(let j=0;j<other.polygon.length;j++){const c=other.polygon[j],d=other.polygon[(j+1)%other.polygon.length];if(Math.abs(cross(a,b,c))<EPS&&Math.abs(cross(a,b,d))<EPS){const t0=((c.x-a.x)*dx+(c.y-a.y)*dy)/len**2,t1=((d.x-a.x)*dx+(d.y-a.y)*dy)/len**2;covered.push([Math.max(0,Math.min(t0,t1)),Math.min(1,Math.max(t0,t1))]);}}
      const qa=toLocal(a),qb=toLocal(b),times=[0,1];for(let pi=0;pi<planes.length;pi++)for(let pj=pi+1;pj<planes.length;pj++){const f=q=>(planes[pi].a-planes[pj].a)*q.x+(planes[pi].b-planes[pj].b)*q.y+planes[pi].d-planes[pj].d,fa=f(qa),fb=f(qb);if(Math.abs(fa-fb)>EPS){const t=fa/(fa-fb);if(t>0&&t<1)times.push(t);}}
      for(const [from,to] of subtractIntervals([[0,1]],covered.filter(([a,b])=>b-a>EPS))){const breaks=unique([from,to,...times.filter(t=>t>from&&t<to)]);for(let k=1;k<breaks.length;k++){const q=t=>({x:qa.x+(qb.x-qa.x)*t,y:qa.y+(qb.y-qa.y)*t}),q0=q(breaks[k-1]),q1=q(breaks[k]);z.gableArea+=len*(breaks[k]-breaks[k-1])*(Math.max(0,height(q0.x,q0.y))+Math.max(0,height(q1.x,q1.y)))/2;}}
    }out.gableArea+=z.gableArea;
  }
  // Shared boundaries are joins, not automatically engineered valleys.
  if(out.zones.length>1)out.warnings.push('Несколько зон: сток, перепады и общие кромки проверяются по скатам. Конструктивное исполнение узлов и пространственная работа требуют отдельного решения.');
  out.wallProfiles=deriveWallProfiles(p,r,out);
  const supportBase={...r,wallProfiles:out.wallProfiles};
  for(const z of out.zones.filter(z=>z.effectiveFraming==='rafters')){
    const supports=buildRafterSupports(p,supportBase,z,out.instances.filter(b=>b.zoneId===z.id&&b.role==='rafter'));
    z.rafterSupports=supports.supports;z.supportAssumptions=supports.assumptions;
    for(const b of supports.instances??[])add(z,b.role,b.b,b.h,b.start,b.end,{...b,id:`${z.id}-SUP-${out.instances.length+1}`,zoneId:z.id});
    out.checks.push(...(supports.checks??[]));out.warnings.push(...(supports.warnings??[]));
    if(supports.checks?.some(c=>c.status==='fail'))out.complete=false;
  }
  const profileAreaGain=out.wallProfiles.filter(q=>q.mode==='continuous'&&p.walls.find(w=>w.id===q.wallId)?.kind==='exterior').reduce((sum,q)=>sum+q.topSamples.slice(1).reduce((a,b,i)=>a+(b.s-q.topSamples[i].s)*((b.topY+q.topSamples[i].topY)/2-q.nominalTopY),0),0);
  out.profileAreaGain=profileAreaGain;out.unprofiledGableArea=out.gableArea;
  out.gableArea=Math.max(0,out.gableArea-profileAreaGain);
  for(const profile of out.wallProfiles)if(profile.mode==='blocked')out.checks.push({id:`${profile.wallId}-profile`,label:'Профиль стены под скатом',wallId:profile.wallId,status:'fail',note:profile.reason});
  out.mass=sum(out.instances.map(b=>b.mass));out.volume=sum(out.instances.map(b=>b.volume));
  out.status=out.checks.some(c=>c.status==='fail')?'fail':'unverified';
  out.assumptions=['Кровля задана отдельными полигонами зон; габаритный прямоугольник дома не используется как готовая крыша. Автоматическое разбиение ортогонального контура покрывает его точно, без перекрытия крыльев.','Высоты и координаты абсолютные, включая основание 0,72 м и этажные платформы. Автоматически покрываются открытые сверху части закрытых этажей; второй свет не вырезает внешний скат.','Двускатная асимметрия: h=S×tan(αL)×tan(αR)/(tan(αL)+tan(αR)); положение конька h/tan(αL). Односкатная высота S×tan(αL).','Скаты триангулированы и ограничены полигоном. Оси досок клиппируются по действительным поперечным интервалам, наружные вырезы не перекрываются. Длины по осям, рабочие запилы и узлы не назначены.','Форма скатов отделена от несущей схемы. Односкатный режим Авто сначала проверяет стропильные балки и сечения той же толщины до 250 мм; фермы предлагаются при отсутствии подходящего цельного стропила. Ручной выбор сохраняется.','FEM типовой фермы применён только к полным прямоугольным зонам, согласованным с направлением конька. Обрезанные рамы, вальмы, ендовы и пространственная устойчивость не подтверждены.','Возвращаются неразрезные идеальные доски. Закупочные 6 м и физическое наращивание выполняет геометрическое ядро отдельно; стык не создаёт опору и не уменьшает расчётный пролёт.','Вес кровельных слоёв должен считаться по area (фактические скаты), снег по projectedArea. Древесина mass/volume включается в общий вес один раз.'];
  out.assumptions.push(...new Set(out.zones.flatMap(z=>[...(z.rafterAnalysis?.assumptions??[]),...(z.supportAssumptions??[])])));
  const drainage=calculateRoofDrainage(p,r,out);
  if(autoOrient&&p.roof?.zones===undefined&&drainage.suggestions?.length){
    const fixed=orientRoofsAwayFromWalls(p,r,out);
    if(fixed.suggestions?.length&&fixed.zones?.length){
      const corrected=calculateRoofZones({...p,roof:{...p.roof,zones:fixed.zones}},r,{autoOrient:false});
      corrected.autoDrainageAdjusted=true;
      corrected.assumptions.unshift('Автоматические нижние крылья ориентированы односкатно от высоких стен. Ручные зоны меняются только по команде пользователя.');
      return corrected;
    }
  }
  out.drainage=drainage;
  out.valleys=(drainage.junctions??[]).filter(q=>q.type==='valley');
  out.checks.push(...drainage.checks);out.warnings.push(...drainage.warnings);
  out.assumptions.push(...drainage.assumptions);
  out.sources.push({title:'AWC · Пролёты и нагрузки стропил',url:'https://awc.org/resource-hub/span-table-tutorial/'});
  out.sources.push({title:'PNNL · Водоотвод и фартуки примыкания кровли к стенам',url:'https://basc.pnnl.gov/resource-guides/step-and-kick-out-flashing-roof-wall-intersections'});
  if(drainage.checks.some(c=>c.status==='fail')){out.status='fail';out.complete=false;}
  return out;
}

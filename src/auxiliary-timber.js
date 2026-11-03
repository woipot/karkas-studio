import {solveUniformOverhangBeam} from './rafters.js';
/** Physical service battens and mono-roof secondary timber; metres / mm / kg. */
const EPS=1e-7,G=9.80665,finite=Number.isFinite;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(...a),unit=a=>{const L=norm(a);return L>EPS?a.map(v=>v/L):null;};
const move=(a,d,t)=>a.map((v,i)=>v+d[i]*t),key=x=>Math.round(x*1e6).toString();
const section=s=>{const m=typeof s==='string'&&s.match(/^(\d+)\s*[x×]\s*(\d+)$/);return m&&+m[1]>=15&&+m[2]>=+m[1]&&+m[2]<=600?{b:+m[1],h:+m[2]}:null;};
const inside=(q,p)=>{let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const area=p=>Math.abs(p.reduce((s,a,i)=>s+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0))/2;
const square=()=>({scheme:'butt',angle:0});
const cut=(c,sec)=>c?.scheme==='miter'?{scheme:'miter',angle:c.angle??0,tiltSign:c.tiltSign??1,plane:c.plane??'depth',cutWidthMM:c.plane==='width'?sec.b:sec.h}:square();
const allowance=(c,h)=>c?.scheme==='miter'?(c.cutWidthMM??h)/2000*Math.tan(Math.abs(c.angle)*Math.PI/180):0;
export const auxiliaryTimberDefaults=Object.freeze({enabled:false,wallService:'45x45',roofCounter:'50x50',roofBattens:'25x100',roofInternal:'48x148',roofService:'45x45',roofBattenStep:.35,roofInternalStep:.6,roofAboveRafterGap:0,roofInterior:true,ceilingBattens:false,ceilingSection:'45x45',ceilingStep:.4});
export class AuxiliaryTimberInputError extends Error{constructor(field,message){super(message);this.name='AuxiliaryTimberInputError';this.code='INVALID_AUXILIARY_TIMBER';this.details={field};}}
const invalid=(field,message)=>{throw new AuxiliaryTimberInputError(field,message);};

export function buildAuxiliaryTimber(project,result={}){
  const supplied=project?.auxiliaryTimber;if(supplied!==undefined&&!object(supplied))invalid('auxiliaryTimber','Нужен объект параметров вспомогательной древесины.');
  const p={...auxiliaryTimberDefaults,...supplied},out={enabled:p.enabled,instances:[],roofExtraDeadByZone:{},ceilingExtraDeadByZone:{},checks:[],warnings:[],assumptions:[],quantities:{count:0,length:0,volume:0,mass:0,weight:0,byRole:{},skippedRoofZoneIds:[]},status:'disabled'};
  for(const k of ['roofInterior','ceilingBattens'])if(typeof p[k]!=='boolean')invalid('auxiliaryTimber.'+k,k+' должен быть boolean.');
  if(typeof p.enabled!=='boolean')invalid('auxiliaryTimber.enabled','enabled должен быть boolean.');
  if(!finite(p.roofAboveRafterGap)||p.roofAboveRafterGap<0||p.roofAboveRafterGap>.3)invalid('auxiliaryTimber.roofAboveRafterGap','Надстропильный сплошной слой должен быть конечной толщиной от0 до0.3м.');if(!p.enabled)return out;
  const sections={};for(const k of ['wallService','roofCounter','roofBattens','roofInternal','roofService','ceilingSection']){sections[k]=section(p[k]);if(!sections[k])invalid('auxiliaryTimber.'+k,'Некорректное сечение '+k);}
  for(const k of ['roofBattenStep','roofInternalStep','ceilingStep'])if(!finite(p[k])||p[k]<.05||p[k]>3)invalid('auxiliaryTimber.'+k,'Шаг должен быть от0.05 до3м.');
  const density=project.material?.density;if(!finite(density)||density<=0)invalid('material.density','Нужна конечная положительная плотность древесины.');
  const geometry=result.geometry??{},levels=geometry.levels??[],boards=result.timber?.instances??[],walls=project.walls??result.walls??[],roof=result.roofModel??{};
  if(!Array.isArray(boards)||!Array.isArray(walls))invalid('result','Ожидаются массивы стен и физических досок.');
  const add=(id,name,category,role,sec,a,b,extra={})=>{
    if(![...a,...b].every(finite))invalid('instances','Координаты должны быть конечными.');const length=norm(sub(b,a));if(length<.005)return null;
    const cs=extra.cutStart??square(),ce=extra.cutEnd??square(),cutLength=length+allowance(cs,sec.h)+allowance(ce,sec.h),volume=sec.b*sec.h*length/1e6,mass=volume*density;
    const item={id,name,category,role,b:sec.b,h:sec.h,length,cutLength,actualCutLength:cutLength,volume,netVolume:volume,grossVolume:sec.b*sec.h*cutLength/1e6,mass,start:a,end:b,cutStart:cs,cutEnd:ce,auxiliary:true,requireSingleStock:true,connectionVerified:false,...extra};out.instances.push(item);return item;
  };
  // Copy the actual vertical framing intervals, not an invented full-height
  // stud grid. Overlapping physical stock parts collapse into one service rail.
  for(const w of walls.filter(w=>w.kind==='exterior')){
    const L=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y);if(L<EPS)continue;const u=[(w.b.x-w.a.x)/L,0,(w.b.y-w.a.y)/L],left=[-u[2],0,u[0]];
    const applicable=w.level!==undefined?[w.level]:[...new Set(boards.filter(b=>b.wallId===w.id).map(b=>b.level??b.floor??1))];
    for(const level of applicable){
      const l=levels.find(q=>q.index===level),polygon=l?.polygon??geometry.polygon??[];
      if(!polygon.length){out.warnings.push(`${w.id}: направление тёплой стороны не определено без замкнутого контура.`);continue;}
      const midpoint={x:(w.a.x+w.b.x)/2+left[0]*.02,y:(w.a.y+w.b.y)/2+left[2]*.02},exterior=inside(midpoint,polygon)?left.map(v=>-v):left;
      const profile=geometry.wallProfiles?.find(q=>q.wallId===w.id&&q.level===level&&q.mode==='continuous'),wallSec=section(profile?.section??w.section);if(!wallSec)continue;
      const osb=project.bracing?.method==='sheathing'&&project.bracing?.sheetSide==='interior'?(project.bracing.thickness??12)/1000:0;
      const sec=sections.wallService,offset=-(wallSec.h/2000+osb+sec.h/2000),groups=new Map();
      const owned=boards.filter(b=>b.wallId===w.id&&(b.level??b.floor??1)===level&&['stud','king','jack','cripple','sheathingStud'].includes(b.role)&&Array.isArray(b.start)&&Array.isArray(b.end)&&Math.hypot(b.end[0]-b.start[0],b.end[2]-b.start[2])<1e-5);
      for(const b of owned){const station=dot(sub(b.start,[w.a.x,0,w.a.y]),u),k=key(station);if(!groups.has(k))groups.set(k,{station,intervals:[]});groups.get(k).intervals.push({a:Math.min(b.start[1],b.end[1]),b:Math.max(b.start[1],b.end[1]),startCut:b.start[1]<=b.end[1]?b.cutStart:b.cutEnd,endCut:b.start[1]<=b.end[1]?b.cutEnd:b.cutStart,sourceIds:[b.id]});}
      const openings=(project.openings??[]).filter(o=>o.wallId===w.id&&(o.floor??w.level??1)===level),wallBase=l?.wallBaseY??profile?.baseY;
      for(const {station,intervals} of [...groups.values()].sort((a,b)=>a.station-b.station)){
        const merged=[];for(const q of intervals.sort((a,b)=>a.a-b.a||a.b-b.b)){const last=merged.at(-1);if(last&&q.a<=last.b+EPS){last.sourceIds.push(...q.sourceIds);if(q.b>last.b){last.b=q.b;last.endCut=q.endCut;}}else merged.push({...q,sourceIds:[...q.sourceIds]});}
        for(const interval of merged){let parts=[{...interval}];if(finite(wallBase))for(const o of openings){if(station+sec.b/2000<=o.offset+EPS||station-sec.b/2000>=o.offset+o.width-EPS)continue;const a=wallBase+o.sill,b=a+o.height;parts=parts.flatMap(q=>b<=q.a+EPS||a>=q.b-EPS?[q]:[...(a>q.a+EPS?[{...q,b:a,endCut:square()}]:[]),...(b<q.b-EPS?[{...q,a:b,startCut:square()}]:[])]);}
          for(const q of parts){const at=y=>move([w.a.x+u[0]*station,y,w.a.y+u[2]*station],exterior,offset);add(`AUX-W-${w.id}-L${level}-S${key(station)}-Y${key(q.a)}-${key(q.b)}`,'Сервисная рейка тёплой стороны стены','walls','wallServiceBatten',sec,at(q.a),at(q.b),{wallId:w.id,level,floor:level,crossAxis:u,exteriorNormal:exterior,warmSideOffset:offset,sourceMemberIds:[...new Set(q.sourceIds)],cutStart:cut(q.startCut,sec),cutEnd:cut(q.endCut,sec)});}
        }
      }
    }
  }
  const roofMass=new Map();
  const roofFaces=(roof.zones??[]).flatMap(z=>z.auxiliaryFaces?.length?z.auxiliaryFaces:[z]);
  for(const z of roofFaces){
    const parentId=z.parentZoneId??z.id;
    const rafters=(roof.instances??[]).filter(b=>z.parentZoneId?b.auxiliaryFaceId===z.id:b.zoneId===z.id&&b.role==='rafter');
    const skip=reason=>{out.quantities.skippedRoofZoneIds.push(z.id);out.warnings.push(`${z.name??z.id}: ${reason}`);out.checks.push({id:`auxiliary-${z.id}-geometry`,zoneId:z.id,label:'Вспомогательные доски кровли: геометрия',status:'unverified',note:reason});};
    if(z.shape!=='mono'||z.effectiveFraming!=='rafters'||rafters.length<2){skip('Поддержаны только прямоугольные односкатные зоны с фактическими параллельными стропилами; фермы/вальмы не дополнены вымышленной обрешёткой.');continue;}
    const ref=rafters[0],d=unit(sub(ref.end,ref.start)),c0=ref.crossAxis??[1,0,0],ridge=d&&unit(c0.map((v,i)=>v-dot(c0,d)*d[i]));
    if(!d||!ridge||Math.abs(ridge[1])>1e-5){skip('Не определены ортогональные оси ската и опорных стропил.');continue;}
    let normal=unit(cross(ridge,d));if(normal[1]<0)normal=normal.map(v=>-v);const length=norm(sub(ref.end,ref.start)),planD=unit([d[0],0,d[2]]),polygon=z.polygon??[];
    const projected=polygon.map(q=>({u:q.x*ridge[0]+q.y*ridge[2],v:q.x*planD[0]+q.y*planD[2]}));
    const u0=Math.min(...projected.map(q=>q.u)),u1=Math.max(...projected.map(q=>q.u)),v0=Math.min(...projected.map(q=>q.v)),v1=Math.max(...projected.map(q=>q.v));
    const rectangular=polygon.length===4&&Math.abs(area(polygon)-(u1-u0)*(v1-v0))<1e-5&&projected.every(q=>(Math.abs(q.u-u0)<1e-5||Math.abs(q.u-u1)<1e-5)&&(Math.abs(q.v-v0)<1e-5||Math.abs(q.v-v1)<1e-5));
    const parallel=rafters.every(b=>{const axis=unit(sub(b.end,b.start));return axis&&dot(axis,d)>1-1e-6&&Math.abs(norm(sub(b.end,b.start))-length)<1e-5&&Math.abs(dot(sub(b.start,ref.start),d))<1e-5&&Math.abs(dot(sub(b.start,ref.start),normal))<1e-5&&Math.abs(b.h-ref.h)<EPS;});
    if(!rectangular||!parallel){skip('Косой/частичный скат или неодинаковые стропила: требуется отдельная раскладка по контуру.');continue;}
    const areaActual=finite(z.surfaceArea)&&z.surfaceArea>0?z.surfaceArea:area(polygon)/Math.hypot(d[0],d[2]);if(!(areaActual>0&&finite(areaActual))){skip('Не определена фактическая площадь ската для добавочного собственного веса.');continue;}
    const sorted=rafters.map(b=>({board:b,u:dot(b.start,ridge)})).sort((a,b)=>a.u-b.u).filter((b,i,a)=>!i||Math.abs(b.u-a[i-1].u)>EPS);
    const zoneStart=out.instances.length,level=z.levelIndex??ref.level??ref.floor??1,base={zoneId:parentId,auxiliaryFaceId:z.parentZoneId?z.id:undefined,level,floor:level},hasRidgeJoint=rafters.some(b=>b.rafterJointId)||!!z.coverHighJointId,bearingStart=ref.bearingStart??ref.start,bearingEnd=ref.bearingEnd??ref.end,bearingLength=norm(sub(bearingEnd,bearingStart)),overhangs=z.overhangs??{},hasSideOverhang=(overhangs.start??0)>EPS||(overhangs.end??0)>EPS;
    const counterBoundaries=[];
    const along=(role,label,sec,offset)=>{for(const {board:b}of sorted){
      const inside=role==='roofServiceBatten',sourceStart=inside?(b.bearingStart??b.start):b.start,sourceEnd=inside?(b.bearingEnd??b.end):b.end;let a=move(sourceStart,normal,offset),startCut=inside&&b.overhangLow>0?square():cut(b.cutStart,sec),end=move(sourceEnd,normal,offset),endCut=cut(b.cutEnd,sec),joint={};
      if(!inside&&b.startCutPlane){const N=unit(b.startCutPlane.normal),ratio=dot(unit(cross(ridge,d)),N)/dot(d,N);a=move(a,d,-dot(sub(a,b.startCutPlane.point),N)/dot(d,N));startCut={scheme:'miter',angle:Math.abs(Math.atan(ratio)*180/Math.PI),tiltSign:-(Math.sign(ratio)||1),plane:'depth',cutWidthMM:sec.h};}
      if(b.rafterJointId||!inside&&b.endCutPlane){
        // Every raised cold-side rail must reach its rafter's end plane,
        // including the unshared high edge of a mono roof. Normal offset
        // followed by a copied miter alone leaves that end short of the edge.
        const N=unit(b.endCutPlane?.normal??planD),point=b.endCutPlane?.point??b.end,denominator=dot(d,N),localDepth=unit(cross(ridge,d));
        if(Math.abs(denominator)>EPS){const shift=-dot(sub(end,point),N)/denominator;end=move(end,d,shift);const ratio=dot(localDepth,N)/denominator;endCut={scheme:'miter',angle:Math.abs(Math.atan(ratio)*180/Math.PI),tiltSign:Math.sign(ratio)||1,plane:'depth',cutWidthMM:sec.h};joint={...(b.rafterJointId?{rafterJointId:b.rafterJointId}:{}),endCutPlane:{point:[...point],normal:N}};}
      }else if(inside&&b.bearingEnd&&b.endCutPlane){
        const N=planD,point=b.bearingEnd,ratio=dot(unit(cross(ridge,d)),N)/dot(d,N);end=move(end,d,-dot(sub(end,point),N)/dot(d,N));endCut={scheme:'miter',angle:Math.abs(Math.atan(ratio)*180/Math.PI),tiltSign:Math.sign(ratio)||1,plane:'depth',cutWidthMM:sec.h};joint={endCutPlane:{point:[...point],normal:N}};
      }
      const item=add(`AUX-R-${z.id}-${role}-${b.id}`,label,'roof',role,sec,a,end,{...base,...joint,crossAxis:ridge,sourceMemberIds:[b.id],roofNormal:normal,normalOffset:offset,cutStart:startCut,cutEnd:endCut});
      if(item&&role==='roofCounterBatten')for(const [edge,point,plane,saw,sign]of [['start',a,b.startCutPlane,startCut,1],['end',end,b.endCutPlane,endCut,-1]]){
        if(!plane)continue;
        const N=unit(plane.normal),depth=unit(cross(ridge,d)),tan=saw.scheme==='miter'?Math.tan((saw.angle??0)*Math.PI/180)*(saw.tiltSign??1):0;
        const deviations=[-1,1].flatMap(x=>[-1,1].map(y=>{const width=x*sec.b/2000,height=y*sec.h/2000,shift=saw.plane==='width'?width*tan:sign*height*tan;return Math.abs(dot(sub(move(move(move(point,ridge,width),depth,height),d,shift),plane.point),N));}));
        counterBoundaries.push({memberId:item.id,edge,deviation:Math.max(...deviations)});
      }
    }};
    along('roofCounterBatten','Контробрешётка над стропилом',sections.roofCounter,ref.h/2000+p.roofAboveRafterGap+sections.roofCounter.h/2000);
    if(counterBoundaries.length){const failed=counterBoundaries.filter(q=>q.deviation>1e-6);out.checks.push({id:`auxiliary-${z.id}-counter-end-planes`,zoneId:z.id,label:'Торцы контробрешётки по границам стропильного ската',status:failed.length?'fail':'pass',value:Math.max(...counterBoundaries.map(q=>q.deviation)),limit:1e-6,unit:'м',checkedFaces:counterBoundaries.length,memberIds:[...new Set(failed.map(q=>q.memberId))],note:'Проверены все четыре вершины каждого торца в заданной плоскости края, включая участки без общего конька. Узлы вентиляции, крепёж и покрытие требуют отдельной деталировки.'});}
    if(p.roofInterior)along('roofServiceBatten','Сервисная рейка под перекрёстным утеплением кровли',sections.roofService,-ref.h/2000-sections.roofInternal.h/1000-sections.roofService.h/2000);
    const transverse=(role,label,sec,step,offset,crossAxis,alongWidth)=>{
      const internal=role==='roofInternalBatten',runLength=internal?bearingLength:length,origin=internal?bearingStart:ref.start;
      if(runLength<=alongWidth/1000+EPS){skip('Скат слишком короток для принятой ширины поперечной доски.');return;}
      const margin=alongWidth/2000,depth=unit(cross(crossAxis,ridge)),extent=Math.abs(dot(crossAxis,planD))*sec.b/2000+Math.abs(dot(depth,planD))*sec.h/2000,hasAnyOverhang=Object.values(overhangs).some(v=>v>EPS),lowMargin=!internal&&hasAnyOverhang?Math.max(margin,(extent-dot(normal,planD)*offset)/dot(d,planD)):margin;
      // The last warm-side transverse row must keep its entire section on its
      // own side of a shared ridge, rather than only its centreline.
      const highMargin=hasRidgeJoint||hasAnyOverhang?Math.max(margin,(dot(normal,planD)*offset+extent)/dot(d,planD)):margin;
      const available=runLength-lowMargin-highMargin;if(available<=EPS){skip('Вспомогательный ряд не помещается перед плоскостью конькового стыка.');return;}
      const n=Math.max(1,Math.ceil((available-EPS)/step));if(n>2000)invalid('roof.rows','Слишком много рядов вспомогательных досок.');
      const nodes=sorted.map(q=>({...q,free:false})),side=role==='roofBatten'&&hasSideOverhang,vergeWidth=sections.roofBattens.b/1000;
      if(side&&(overhangs.start??0)>0)nodes.unshift({u:(z.coverBounds?.minU??u0-overhangs.start)+vergeWidth,free:true});
      if(side&&(overhangs.end??0)>0)nodes.push({u:(z.coverBounds?.maxU??u1+overhangs.end)-vergeWidth,free:true});
      for(let row=0;row<=n;row++){const s=lowMargin+available*row/n;let first=0,part=0;
        while(first<nodes.length-1){let last=first+1;while(last+1<nodes.length&&nodes[last+1].u-nodes[first].u<=6+EPS)last++;if(nodes.at(-1).free&&last===nodes.length-2&&last>first+1)last--;if(nodes[first].free&&last<2)last=2;
          const at=u=>move(move(move(origin,d,s),ridge,u-dot(origin,ridge)),normal,offset),a=at(nodes[first].u),b=at(nodes[last].u),startSupport=nodes[first].board?.id??null,endSupport=nodes[last].board?.id??null,memberSupports=nodes.slice(first,last+1).filter(q=>q.board).map(q=>q.board.id),lowCant=nodes[first].free?sorted[0].u-nodes[first].u:0,highCant=nodes[last].free?nodes[last].u-sorted.at(-1).u:0;
          add(`AUX-R-${z.id}-${role}-ROW${row}-P${part++}`,label,'roof',role,sec,a,b,{...base,crossAxis,roofNormal:normal,normalOffset:offset,slopeStation:s,supportRafterIds:memberSupports,startSupportRafterId:startSupport,endSupportRafterId:endSupport,structuralLookout:side,isLookout:lowCant>0||highCant>0,cantileverStart:lowCant,cantileverEnd:highCant,supportedSpliceStart:first>0,supportedSpliceEnd:last<nodes.length-1,cutStart:{...square(),...(startSupport?{supportRafterId:startSupport}:{freeEnd:true})},cutEnd:{...square(),...(endSupport?{supportRafterId:endSupport}:{freeEnd:true})}});first=last;
        }
      }
      if(side){
        const pitchCos=Math.hypot(d[0],d[2]),pitchSin=Math.abs(d[1]),rowStep=available/n,A=sec.b*sec.h,I1=sec.h*sec.b**3/12,Z1=sec.h*sec.b**2/6,I2=sec.b*sec.h**3/12,Z2=sec.b*sec.h**2/6,E=project.material.E??10000,Fb=project.material.Fb??13,Fv=project.material.Fv??1.5,gg=project.loads.gammaG??1.1,gq=project.loads.gammaQ??1.4,sk=(project.loads.snow??1.5)*(z.loadSnowFactor??1)*(z.pitchLeft<=30?.8:Math.max(0,.8*(60-z.pitchLeft)/30)),dead=(project.loads.roofDead??.5)*rowStep+density*A/1e6*G/1000,live=sk*rowStep*pitchCos,qS=dead+live,qD=dead*gg+live*gq,tip=density*sections.roofBattens.b*sections.roofBattens.h/1e6*G/1000*rowStep;
        for(const [end,projection,gap]of [['start',(overhangs.start??0)>0?sorted[0].u-nodes[0].u:0,sorted[1].u-sorted[0].u],['end',(overhangs.end??0)>0?nodes.at(-1).u-sorted.at(-1).u:0,sorted.at(-1).u-sorted.at(-2).u]])if(projection>EPS){
          const span=projection+gap,point=end==='start'?0:span,a=end==='start'?projection:0,b=end==='start'?span:gap,beam=(component,I)=>solveUniformOverhangBeam({length:span,supportA:a,supportB:b,qService:qS*component,qDesign:qD*component,E,I,pointLoads:[{s:point,service:tip*component,design:tip*gg*component}]}),normalBeam=beam(pitchCos,I1),slopeBeam=beam(pitchSin,I2),bending=(normalBeam.maxMoment*1e6/Z1+slopeBeam.maxMoment*1e6/Z2)/Fb,shear=1.5*(normalBeam.maxShear+slopeBeam.maxShear)*1000/A/Fv,deflection=normalBeam.maxDeflection*pitchCos+slopeBeam.maxDeflection*pitchSin,limit=Math.min(gap*1000/300,2*projection*1000/300),u=Math.max(bending,shear,deflection/limit),geometryPass=projection<=gap+EPS;
          out.checks.push({id:`auxiliary-${z.id}-lookout-${end}`,zoneId:z.id,label:`Боковой свес ${end}: поперечная доска на двух крайних стропилах`,status:u<=1&&geometryPass?'pass':'fail',value:u,limit:1,unit:'коэф.',projection,backspan:gap,bendingUtilization:bending,shearUtilization:shear,deflection,deflectionLimit:limit,section:`${sec.b}x${sec.h}`,note:geometryPass?'Частные изгиб/срез/прогиб по двум осям, включая вес торцевой доски; крепёж к контробрешётке/стропилам и отрыв не подтверждены.':'Проекция больше принятого backspan в один шаг: требуется отдельная конструкция.'});
        }
      }
    };
    transverse('roofBatten','Поперечная кровельная обрешётка',sections.roofBattens,p.roofBattenStep,ref.h/2000+p.roofAboveRafterGap+sections.roofCounter.h/1000+sections.roofBattens.b/2000,normal,sections.roofBattens.h);
    if(p.roofInterior)transverse('roofInternalBatten','Перекрёстная доска внутреннего утепления кровли',sections.roofInternal,p.roofInternalStep,-ref.h/2000-sections.roofInternal.h/2000,d,sections.roofInternal.b);
    if(hasSideOverhang){const sec=sections.roofBattens,offset=ref.h/2000+p.roofAboveRafterGap+sections.roofCounter.h/1000+sections.roofBattens.b/1000-sec.h/2000;
      for(const [side,amount,u]of [['start',overhangs.start,(z.coverBounds?.minU??u0-overhangs.start)+sec.b/2000],['end',overhangs.end,(z.coverBounds?.maxU??u1+overhangs.end)-sec.b/2000]])if(amount>0){let a=move(move(ref.start,ridge,u-dot(ref.start,ridge)),normal,offset),end=move(move(ref.end,ridge,u-dot(ref.end,ridge)),normal,offset);const plane=z.coverHighPlane??{point:ref.end,normal:planD},N=unit(plane.normal),ratio=dot(unit(cross(ridge,d)),N)/dot(d,N);end=move(end,d,-dot(sub(end,plane.point),N)/dot(d,N));a=move(a,d,-dot(sub(a,ref.start),planD)/dot(d,planD));const ce={scheme:'miter',angle:Math.abs(Math.atan(ratio)*180/Math.PI),tiltSign:Math.sign(ratio)||1,plane:'depth',cutWidthMM:sec.h},cs={...ce,tiltSign:-(Math.sign(ratio)||1)};
        add(`AUX-R-${z.id}-VERGE-${side}`,'Торцевая доска бокового свеса','roof','roofVergeBoard',sec,a,end,{...base,crossAxis:ridge,roofNormal:normal,normalOffset:offset,side,structuralLookout:true,coverJointId:z.coverHighJointId??null,endCutPlane:plane,supportedBy:'cantilever-roof-battens',cutStart:cs,cutEnd:ce});
      }
    }
    const mass=out.instances.slice(zoneStart).reduce((s,b)=>s+b.mass,0);roofMass.set(parentId,(roofMass.get(parentId)??0)+mass);
  }
  if(p.ceilingBattens)for(const z of roof.zones??[]){
    const bottom=(roof.instances??[]).filter(b=>b.zoneId===z.id&&['bottom','bottomChord'].includes(b.role)&&b.physicalTruss),sec=sections.ceilingSection;
    const ref=bottom[0],spanAxis=ref&&unit(sub(ref.end,ref.start)),ridge=ref?.crossAxis&&unit(ref.crossAxis);
    if(!ref||!spanAxis||!ridge||Math.abs(spanAxis[1])>EPS||Math.abs(ridge[1])>EPS){out.checks.push({id:'ceiling-'+z.id+'-geometry',zoneId:z.id,label:'Обрешётка плоского потолка',status:'unverified',note:'Нужны реальные горизонтальные цельные нижние пояса ферм. Плоская обрешётка не выдумана по габариту.'});continue;}
    const sorted=bottom.map(b=>({board:b,u:dot(b.start,ridge)})).sort((a,b)=>a.u-b.u),length=norm(sub(ref.end,ref.start)),margin=sec.b/2000,available=length-2*margin,n=Math.max(1,Math.ceil(available/p.ceilingStep)),y=ref.start[1]-ref.h/2000-sec.h/2000,startIndex=out.instances.length;
    for(let row=0;row<=n;row++){
      const v=margin+available*row/n,origin=move(ref.start,spanAxis,v);let first=0,part=0;
      while(first<sorted.length-1){let last=first+1;while(last+1<sorted.length&&sorted[last+1].u-sorted[first].u<=6+EPS)last++;const at=u=>[origin[0]+ridge[0]*(u-dot(origin,ridge)),y,origin[2]+ridge[2]*(u-dot(origin,ridge))];
        add(`AUX-C-${z.id}-ROW${row}-P${part++}`,'Обрешётка плоского потолка холодного чердака','roof','ceilingBatten',sec,at(sorted[first].u),at(sorted[last].u),{zoneId:z.id,level:z.levelIndex??1,floor:z.levelIndex??1,crossAxis:[0,1,0],sourceMemberIds:sorted.slice(first,last+1).map(q=>q.board.id),supportBottomChordIds:sorted.slice(first,last+1).map(q=>q.board.id),supportedSpliceStart:first>0,supportedSpliceEnd:last<sorted.length-1});first=last;
      }
    }
    const mass=out.instances.slice(startIndex).reduce((s,b)=>s+b.mass,0);roofMass.set(z.id,(roofMass.get(z.id)??0)+mass);if(z.bearingArea>0)out.ceilingExtraDeadByZone[z.id]=mass*G/1000/z.bearingArea;
    out.checks.push({id:'ceiling-'+z.id+'-connections',zoneId:z.id,label:'Подвес потолка и нижние пояса',status:'unverified',note:'Показаны фактические рейки под нижними гранями ферм, со стыками только на поясах. Крепёж, местный изгиб нижнего пояса, ползучесть и тип потолочной облицовки требуют рабочего расчёта.'});
  }
  for(const [id,mass]of roofMass){const parent=(roof.zones??[]).find(z=>z.id===id),A=parent?.surfaceArea;if(A>0)out.roofExtraDeadByZone[id]=mass*G/1000/A;}
  for(const b of out.instances){const q=out.quantities.byRole[b.role]??{count:0,length:0,volume:0,mass:0};q.count++;q.length+=b.length;q.volume+=b.volume;q.mass+=b.mass;out.quantities.byRole[b.role]=q;out.quantities.count++;out.quantities.length+=b.length;out.quantities.volume+=b.volume;out.quantities.mass+=b.mass;}
  out.quantities.weight=out.quantities.mass*G/1000;out.quantities.roofMassByZone=Object.fromEntries(roofMass);
  const tooLong=out.instances.filter(b=>b.cutLength>6+EPS);out.checks.push({id:'auxiliary-stock',label:'Вспомогательная древесина: шестиметровые заготовки',status:tooLong.length?'fail':'pass',value:tooLong.length,limit:0,unit:'шт.',note:tooLong.length?'Цельные длинные детали оставлены неразрезанными: опора не выдумана.':'Поперечные доски разорваны только на фактических стропилах; соединения требуют крепёжного решения.'},{id:'auxiliary-connections',label:'Крепление реек и обрешётки',status:'unverified',note:'Саморезы, пролёты самих реек, ветровой отрыв, примыкания у проёмов/углов и опирание обрешётки требуют проектирования.'});
  if(tooLong.length)out.warnings.push(`${tooLong.length} детали вспомогательной древесины не помещаются в6м без нового опорного решения.`);
  if(p.roofAboveRafterGap>0){out.checks.push({id:'auxiliary-counter-through-insulation',label:'Контробрешётка над сплошным надстропильным слоем',status:'unverified',note:`Слой ${Math.round(p.roofAboveRafterGap*1000)}мм учтён в положении досок. Смятие слоя, длинные крепления, сдвиг и ветровой отрыв не проверены; непосредственное опирание на стропило не предполагается.`});out.warnings.push('Контробрешётка отделена от стропил сплошным слоем; требуется рассчитанное крепление через этот слой.');}
  out.assumptions=['roofInterior=false отключает доски внутреннего утепления по скатам. ceilingBattens=true строит плоскую обрешётку только под реальными нижними поясами ферм; её масса включена один раз.','Ведомость включает сервисные рейки наружных стен по существующим вертикальным элементам, контробрешётку, поперечную обрешётку, внутренние перекрёстные доски и сервисные рейки прямоугольных односкатных зон и скатов физических двускатных ферм.','Сервисные рейки стен находятся с тёплой стороны, за внутренней OSB при interior. Проёмы вычтены; угловые пакеты и внутренние стены не скопированы как вымышленные рейки.','Стыки поперечных досок расположены только по осям реальных стропил. Обычный торцевой стык не подтверждает передачу усилий или ветрового отрыва.','roofExtraDeadByZone — только вес добавленной кровельной древесины/фактическая площадь ската. Он нужен для частных расчётов кровли; глобально доски уже входят в общий вес, повторно прибавлять его к roofDead нельзя.'];
  out.status=out.checks.some(c=>c.status==='fail')?'fail':'unverified';return out;
}

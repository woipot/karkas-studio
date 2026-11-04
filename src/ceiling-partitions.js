/** Keep the lowered ceiling suspended from roof framing around tall partitions.
 * Geometry and timber mass only; side hangers, joints and lateral wall clips
 * remain unverified. No ceiling/roof bearing is assigned to a partition. */
const EPS=1e-7,G=9.80665,dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),norm=a=>Math.hypot(...a),unit=a=>{const L=norm(a);return a.map(v=>v/L);},add=(a,b,k)=>a.map((v,i)=>v+b[i]*k),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],sum=a=>a.reduce((s,v)=>s+v,0);
const square={scheme:'butt',angle:0},section=s=>{const m=String(s).match(/^(\d+)x(\d+)$/);return m?{b:+m[1],h:+m[2]}:null;};
function basis(b){const Y=unit(sub(b.end,b.start)),raw=b.crossAxis??[1,0,0],X=unit(raw.map((v,i)=>v-dot(raw,Y)*Y[i]));return{X,Y,Z:unit(cross(X,Y))};}
function half(b,axis){const {X,Z}=basis(b);return Math.abs(dot(X,axis))*b.b/2000+Math.abs(dot(Z,axis))*b.h/2000;}
function overlapInterval(b,w){
 const d=unit(sub(b.end,b.start)),L=norm(sub(b.end,b.start)),W=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),u=[(w.b.x-w.a.x)/W,0,(w.b.y-w.a.y)/W],n=[-u[2],0,u[0]],origin=[w.a.x,0,w.a.y],a=sub(b.start,origin);let lo=0,hi=L;
 for(const [axis,min,max]of[[u,-half(b,u),W+half(b,u)],[n,-w.depth/2-half(b,n),w.depth/2+half(b,n)],[[0,1,0],w.baseY-half(b,[0,1,0]),w.topY+half(b,[0,1,0])]]){
  const q=dot(a,axis),v=dot(d,axis);if(Math.abs(v)<EPS){if(q<=min+EPS||q>=max-EPS)return null;}else{const x=(min-q)/v,z=(max-q)/v;lo=Math.max(lo,Math.min(x,z));hi=Math.min(hi,Math.max(x,z));if(hi-lo<=EPS)return null;}
 }return hi-lo>EPS?{from:lo,to:hi,wallId:w.id}:null;
}
function fragments(b,blocked,density){
 let ranges=[[0,b.length]];for(const q of blocked){const next=[];for(const[a,z]of ranges){if(q.to<=a+EPS||q.from>=z-EPS)next.push([a,z]);else{if(q.from>a+EPS)next.push([a,q.from]);if(q.to<z-EPS)next.push([q.to,z]);}}ranges=next;}
 const d=unit(sub(b.end,b.start));return ranges.filter(([a,z])=>z-a>=.005).map(([a,z],i)=>{const L=z-a,volume=b.b*b.h*L/1e6;return{...b,id:b.id+'-WP'+(i+1),start:add(b.start,d,a),end:add(b.start,d,z),length:L,cutLength:L,actualCutLength:L,volume,netVolume:volume,grossVolume:volume,mass:volume*density,cutStart:a>EPS?{...square}:b.cutStart,cutEnd:z<b.length-EPS?{...square}:b.cutEnd,sourceAuxiliaryId:b.id,supportedSpliceStart:a<=EPS&&b.supportedSpliceStart,supportedSpliceEnd:z>=b.length-EPS&&b.supportedSpliceEnd,ceilingCutStartWallIds:blocked.filter(q=>Math.abs(q.to-a)<2*EPS).map(q=>q.wallId),ceilingCutEndWallIds:blocked.filter(q=>Math.abs(q.from-z)<2*EPS).map(q=>q.wallId)};});
}
// Actual horizontal bottom-chord profile at a world station, including taper.
function chordDepthAt(b,point){
 const {Y,Z}=basis(b),center=b.start.map((v,i)=>(v+b.end[i])/2),s=dot(sub(point,center),Y),poly=b.shape?.points;if(!poly?.length)return{bottom:center[1]-b.h/2000,top:center[1]+b.h/2000};
 const hits=[];for(let i=0;i<poly.length;i++){const a=poly[i],z=poly[(i+1)%poly.length];if(Math.abs(a[0]-s)<EPS)hits.push(center[1]+Z[1]*a[1]);if((a[0]-s)*(z[0]-s)<-EPS*EPS){const t=(s-a[0])/(z[0]-a[0]);hits.push(center[1]+Z[1]*(a[1]+t*(z[1]-a[1])));}}
 return hits.length?{bottom:Math.min(...hits),top:Math.max(...hits)}:null;
}
export function adaptCeilingToPartitions(project,{geometry,walls=project.walls??[],roofModel}={},original=[]){
 const out={instances:original,checks:[],assumptions:[],details:{removedHangerIds:[],trimmedMemberIds:[],headers:[],endSupports:[],unresolved:[]}};
 const obstacles=walls.filter(w=>w.kind==='partition').map(w=>{const l=geometry?.levels?.find(l=>l.index===(w.level??1)),s=section(w.section);return s&&l?{...w,level:w.level??1,depth:s.h/1000,baseY:l.wallBaseY,topY:l.wallBaseY+(w.height??l.height)}:null;}).filter(Boolean);
 if(!obstacles.length)return out;
 const density=project.material.density,instances=[],trimmed=[];
 for(const b of original){if(!String(b.role).startsWith('ceiling')){instances.push(b);continue;}const blocked=obstacles.filter(w=>w.level===(b.level??b.floor??1)).map(w=>overlapInterval(b,w)).filter(Boolean);if(!blocked.length){instances.push(b);continue;}out.details.trimmedMemberIds.push(b.id);
  if(b.role==='ceilingHanger'){out.details.removedHangerIds.push(b.id);continue;}const parts=fragments(b,blocked,density);instances.push(...parts);if(b.role==='ceilingBatten')trimmed.push(...parts);
 }
 const create=(id,name,role,sec,a,z,extra={})=>{const length=norm(sub(z,a)),volume=sec.b*sec.h*length/1e6,b={id,name,role,category:'roof',...sec,start:a,end:z,length,cutLength:length,actualCutLength:length,volume,netVolume:volume,grossVolume:volume,mass:volume*density,cutStart:{...square},cutEnd:{...square},auxiliary:true,requireSingleStock:true,connectionVerified:false,...extra};instances.push(b);return b;};
 const headerSection=section(project.auxiliaryTimber?.ceilingTransferSection??'50x100'),hangerSection={b:50,h:50},headers=new Map();
 for(const part of trimmed)for(const[end,wallIds]of[['start',part.ceilingCutStartWallIds],['end',part.ceilingCutEndWallIds]]){
  if(!wallIds?.length)continue;const z=roofModel?.zones?.find(z=>z.id===part.zoneId),bottom=(roofModel?.instances??[]).filter(b=>b.zoneId===part.zoneId&&b.physicalTruss&&['bottom','bottomChord'].includes(b.role));
  try{
   if(!z||bottom.length<2||!headerSection)throw Error('Нет фактических затяжек или сечения поперечины.');const ridge=unit(bottom[0].crossAxis),span=unit(sub(bottom[0].end,bottom[0].start)),d=unit(sub(part.end,part.start));if(Math.abs(dot(d,ridge))<.99999)throw Error('Рейка не направлена поперёк затяжек.');
   const toward=end==='start'?d:d.map(v=>-v),point=add(part[end],toward,Math.min(.05,part.length/2)),u=dot(point,ridge),v=dot(point,span),level=part.level??part.floor??1;
   const candidates=instances.filter(b=>b.role==='ceilingHanger'&&b.zoneId===part.zoneId&&Math.abs(dot(b.start,span)-v)<EPS&&norm(sub([b.start[0],0,b.start[2]],[point[0],0,point[2]]))<.05-EPS&&dot(sub(b.start,part.start),d)>=-.001&&dot(sub(b.start,part.end),d)<=.001);
   let hanger=candidates[0],header=null;
   if(!hanger){
    const sorted=bottom.map(b=>({b,u:dot(b.start,ridge)})).sort((a,b)=>a.u-b.u),direct=sorted.find(q=>Math.abs(q.u-u)+.025<=q.b.b/2000+EPS);let topY,sources;
    if(direct){const depth=chordDepthAt(direct.b,point);if(!depth)throw Error('Точка подвеса вне действительного профиля затяжки.');topY=depth.bottom;sources=[direct.b.id];}
    else{
     const left=[...sorted].reverse().find(q=>q.u+q.b.b/2000<u-EPS),right=sorted.find(q=>q.u-q.b.b/2000>u+EPS);if(!left||!right)throw Error('Для конца рейки нет двух реальных соседних затяжек.');
     const depthA=chordDepthAt(left.b,point),depthB=chordDepthAt(right.b,point);if(!depthA||!depthB||Math.abs(depthA.bottom-depthB.bottom)>EPS)throw Error('Нижние грани соседних затяжек не образуют одну плоскость.');topY=depthA.bottom;
     if(Math.min(depthA.top,depthB.top)-topY<headerSection.h/1000-EPS)throw Error('У скошенного конца затяжки недостаточно высоты для торца поперечины.');
     const id=`AUX-CT-${part.zoneId}-${Math.round(v*1e6)}-${left.b.id}-${right.b.id}`,from=left.u+left.b.b/2000,to=right.u-right.b.b/2000,at=(U,Y)=>[ridge[0]*U+span[0]*v,Y,ridge[2]*U+span[2]*v];header=headers.get(id);
     if(!header){header=create(id,'Межбалочная поперечина подвесного потолка','ceilingTransferHeader',headerSection,at(from,topY+headerSection.h/2000),at(to,topY+headerSection.h/2000),{zoneId:part.zoneId,level,floor:level,crossAxis:span,sourceMemberIds:[left.b.id,right.b.id],supportBottomChordIds:[left.b.id,right.b.id],partitionWallIds:[],endSupportMode:'side-hanger-required-unverified',bottomY:topY,verticalBearingOnPartitions:false});headers.set(id,header);out.details.headers.push({id,sourceMemberIds:header.sourceMemberIds,partitionWallIds:header.partitionWallIds});}
     header.partitionWallIds=[...new Set(header.partitionWallIds.concat(wallIds))];const detail=out.details.headers.find(q=>q.id===id);detail.partitionWallIds=header.partitionWallIds;sources=[header.id];
    }
    if(topY<=part.ceilingDatumY+EPS)throw Error('Недостаточно места по высоте для подвеса.');const a=[point[0],part.ceilingDatumY,point[2]],b=[point[0],topY,point[2]],candidate={b:50,h:50,start:a,end:b,crossAxis:ridge};
    if(obstacles.some(w=>w.level===level&&overlapInterval(candidate,w)))throw Error('Новый подвес пересекает полосу перегородки.');
    hanger=create(`AUX-CHW-${part.id}-${end}`,'Подвес конца потолочной рейки у перегородки','ceilingHanger',hangerSection,a,b,{zoneId:part.zoneId,level,floor:level,crossAxis:ridge,ceilingDatumY:part.ceilingDatumY,sourceMemberIds:sources,supportBottomChordIds:header?header.supportBottomChordIds:sources,partitionWallIds:wallIds,verticalBearingOnPartitions:false});
   }
   const record={memberId:part.id,end,hangerId:hanger.id,headerId:header?.id??null,wallIds,overhang:norm(sub(part[end],[hanger.start[0],part[end][1],hanger.start[2]])),connectionVerified:false};(part.ceilingEndSupports??=[]).push(record);out.details.endSupports.push(record);
  }catch(e){out.details.unresolved.push({memberId:part.id,end,wallIds,reason:e.message});}
 }
 out.instances=instances;
 out.checks.push({id:'ceiling-partition-coordination',label:'Потолочный каркас у высоких перегородок',status:out.details.unresolved.length?'fail':'pass',value:out.details.unresolved.length,limit:0,failIds:out.details.unresolved.map(q=>q.memberId),note:'Рейки разорваны у полных полос стен. Их концы подвешены к фактическим затяжкам или межбалочным поперечинам; потолок не получает вертикальные опоры на перегородках.'},{id:'ceiling-transfer-connections',label:'Поперечины и подвесы потолка: торцевые соединения',status:'unverified',note:'Поперечины опираются торцами в боковые грани затяжек. Нужны рассчитанные подвесы/крепёж, проверки самих реек, поперечин, местных усилий и перемещений. Геометрический контакт не означает подтверждённую несущую способность.'});
 out.assumptions.push('Высокая перегородка не превращена в опору потолка или кровли. Новые подвесы и межбалочные поперечины сохраняют путь потолочной нагрузки к затяжкам. Их масса включается в потолочную древесину ровно один раз; локальные сосредоточенные реакции и крепёж не подтверждены.');return out;
}

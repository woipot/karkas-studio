import * as THREE from 'three';
import {cutGeometry} from './board-geometry.js';
const xml=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const csv=x=>'"'+String(typeof x==='string'&&/^[\s]*[=+@-]/.test(x)?"'"+x:x??'').replaceAll('"','""')+'"';

const pointInside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const goodPolygon=p=>Array.isArray(p)&&p.length>=3&&p.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y));
const edgeDistance=(p,a,b)=>{const L=(b.x-a.x)**2+(b.y-a.y)**2,t=Math.max(0,Math.min(1,((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/Math.max(1e-12,L)));return Math.hypot(p.x-a.x-(b.x-a.x)*t,p.y-a.y-(b.y-a.y)*t);};

/** Annotation geometry only: no physical member, weight or engineering claim. */
export function fixturePlanGeometry(fixture){
 const polygon=fixture?.polygon;if(!goodPolygon(polygon))return null;
 const centroid=polygon.reduce((s,p)=>({x:s.x+p.x/polygon.length,y:s.y+p.y/polygon.length}),{x:0,y:0}),i=Number.isInteger(fixture.frontEdge)?((fixture.frontEdge%polygon.length)+polygon.length)%polygon.length:0,a=polygon[i],b=polygon[(i+1)%polygon.length],width=Math.hypot(b.x-a.x,b.y-a.y);if(width<1e-8)return null;
 const u={x:(b.x-a.x)/width,y:(b.y-a.y)/width},sign=((centroid.x-a.x)*(-u.y)+(centroid.y-a.y)*u.x)>=0?1:-1,v={x:-u.y*sign,y:u.x*sign},depth=Math.max(...polygon.map(p=>(p.x-a.x)*v.x+(p.y-a.y)*v.y)),at=(x,y)=>({x:a.x+x*u.x+y*v.x,y:a.y+x*u.y+y*v.y}),lines=[],circles=[],polygons=[];
 const segment=(x1,y1,x2,y2)=>lines.push([at(x1,y1),at(x2,y2)]),rect=(x,y,w,h)=>polygons.push([at(x,y),at(x+w,y),at(x+w,y+h),at(x,y+h)]),ellipse=(x,y,rx,ry)=>circles.push({center:at(x,y),rx,ry,angle:Math.atan2(u.y,u.x)*180/Math.PI});
 const kind=fixture.kind;
 if(kind==='bed'){rect(width*.07,depth*.08,width*.86,depth*.17);segment(width*.05,depth*.34,width*.95,depth*.34);segment(width*.5,depth*.08,width*.5,depth*.25);}
 else if(kind==='sofa'){rect(width*.08,depth*.67,width*.84,depth*.25);segment(width*.08,depth*.1,width*.08,depth*.65);segment(width*.92,depth*.1,width*.92,depth*.65);segment(width*.5,depth*.1,width*.5,depth*.65);}
 else if(kind==='wardrobe'||kind==='kitchenRun'){const count=Math.max(1,Math.round(width/.6));for(let j=1;j<count;j++)segment(width*j/count,0,width*j/count,depth);if(kind==='wardrobe')segment(0,depth*.13,width,depth*.13);}
 else if(kind==='table'){rect(width*.08,depth*.08,width*.84,depth*.84);}
 else if(kind==='chair'){rect(width*.1,depth*(Number.isInteger(fixture.frontEdge)?.75:.1),width*.8,depth*(Number.isInteger(fixture.frontEdge)?.2:.8));}
 else if(kind==='hob'){for(const x of [.29,.71])for(const y of [.3,.7])ellipse(width*x,depth*y,Math.min(width,depth)*.12,Math.min(width,depth)*.12);}
 else if(kind==='sink'||kind==='washbasin'){ellipse(width*.5,depth*.47,width*.34,depth*.32);ellipse(width*.5,depth*.47,Math.min(width,depth)*.035,Math.min(width,depth)*.035);segment(width*.5,depth*.75,width*.5,depth*.95);}
 else if(kind==='wc'){rect(width*.08,depth*.73,width*.84,depth*.23);ellipse(width*.5,depth*.39,width*.34,depth*.28);}
 else if(kind==='shower'){segment(0,0,width,depth);segment(0,depth,width,0);ellipse(width*.78,depth*.78,Math.min(width,depth)*.035,Math.min(width,depth)*.035);}
 else if(kind==='washer'||kind==='dryer'){ellipse(width*.5,depth*.52,width*.3,depth*.3);segment(0,depth*.15,width,depth*.15);}
 else if(kind==='fridge'){segment(0,depth*.25,width,depth*.25);segment(width*.12,depth*.32,width*.12,depth*.7);}
 return {id:fixture.id,kind,label:fixture.label,stackGroup:fixture.stackGroup,polygon,lines,circles,polygons,center:centroid,width,depth,fill:['shower','wc','sink','washbasin','washer','dryer'].includes(kind)?'#e1eceb':['bed','sofa','wardrobe'].includes(kind)?'#e8dfcf':'#ede9dc'};
}

export function planRoomCaption(room){
 return [room?.planLabel,room?.shortName,room?.name].find(s=>typeof s==='string'&&s.trim())??'';
}

export function planLabelLines(room,fontSize){
 const limit=Math.max(10,Math.floor((room.width??2)*.85/Math.max(.001,fontSize*.55))),words=planRoomCaption(room).split(/\s+/),lines=[];let current='';
 for(const word of words){if(current&&(current+' '+word).length>limit){lines.push(current);current=word;}else current+=(current?' ':'')+word;}if(current)lines.push(current);return lines;
}

export function planAnnotations(report,level){
 const rooms=(report.planning?.rooms??report.project?.roomSchedule??[]).filter(r=>(r.level??1)===level&&goodPolygon(r.polygon)),fixtures=[],stackGroups=new Map(),doors=[],seenDoors=new Set();
 for(const room of rooms)for(const input of Array.isArray(room.fixtures)?room.fixtures:[]){const f=fixturePlanGeometry(input);if(!f)continue;f.roomId=room.id;if(f.stackGroup){const stackKey=String(room.id)+'::'+f.stackGroup,prev=stackGroups.get(stackKey);if(prev){prev.stackDescription=[prev.label??prev.kind,f.label??f.kind].join(' + ');prev.label=[prev.kind,f.kind].includes('washer')&&[prev.kind,f.kind].includes('dryer')?'СМ + СШ':prev.stackDescription;prev.sourceIds.push(f.id);continue;}f.sourceIds=[f.id];stackGroups.set(stackKey,f);}fixtures.push(f);}
 for(const room of rooms)for(const swing of Array.isArray(room.doorSwings)?room.doorSwings:[]){if(seenDoors.has(swing.openingId))continue;const opening=report.project?.openings?.find(o=>o.id===swing.openingId&&o.type==='door'),wall=report.project?.walls?.find(w=>w.id===opening?.wallId);if(!wall||!['start','end'].includes(swing.hinge)||![1,-1].includes(swing.normal)||!(opening.width>0))continue;const L=Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y);if(L<1e-8)continue;const angle=swing.angle??90;if(!Number.isFinite(angle)||angle<=0||angle>180)continue;const u={x:(wall.b.x-wall.a.x)/L,y:(wall.b.y-wall.a.y)/L},n={x:-u.y*swing.normal,y:u.x*swing.normal},fromEnd=swing.hinge==='end',station=opening.offset+(fromEnd?opening.width:0),hinge={x:wall.a.x+station*u.x,y:wall.a.y+station*u.y},along={x:u.x*(fromEnd?-1:1),y:u.y*(fromEnd?-1:1)},arc=Array.from({length:25},(_,i)=>{const t=angle*Math.PI/180*i/24;return{x:hinge.x+opening.width*(along.x*Math.cos(t)+n.x*Math.sin(t)),y:hinge.y+opening.width*(along.y*Math.cos(t)+n.y*Math.sin(t))};});doors.push({openingId:opening.id,hinge,closedTip:arc[0],openTip:arc.at(-1),arc,width:opening.width});seenDoors.add(opening.id);}
 const labels=rooms.map(room=>{const poly=room.polygon,ps=poly,center=ps.reduce((s,p)=>({x:s.x+p.x/ps.length,y:s.y+p.y/ps.length}),{x:0,y:0}),holes=[...fixtures.filter(f=>f.roomId===room.id).map(f=>f.polygon),...(report.project?.voids??[]).filter(v=>v.level===level).map(v=>v.polygon),...(report.result?.spatialLayout?.staircases??[]).filter(s=>[s.levelFrom,s.levelTo].includes(level)).map(s=>s.polygon)],xs=ps.map(p=>p.x),ys=ps.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),candidates=[center,...Array.from({length:225},(_,i)=>({x:minX+(i%15+.5)*(maxX-minX)/15,y:minY+(Math.floor(i/15)+.5)*(maxY-minY)/15}))].filter(p=>pointInside(p,ps)&&!holes.some(h=>goodPolygon(h)&&pointInside(p,h))),clearance=p=>Math.min(...[ps,...holes.filter(goodPolygon)].flatMap(poly=>poly.map((a,i)=>edgeDistance(p,a,poly[(i+1)%poly.length]))));const supplied=room.labelPoint,labelPoint=supplied&&Number.isFinite(supplied.x)&&Number.isFinite(supplied.y)&&pointInside(supplied,poly)?supplied:candidates.sort((a,b)=>clearance(b)-clearance(a))[0]??center;return{...room,labelPoint,width:maxX-minX,depth:maxY-minY};});
 return {rooms:labels,fixtures,doors};
}

const annotationSVG=(annotation,dx,dy,scale=1)=>{
 const at=p=>`${p.x+dx},${p.y+dy}`,line=p=>`<polyline points="${p.map(at).join(' ')}" fill="none" stroke="#7d8a7b" stroke-width=".014"/>`;
 return annotation.fixtures.map(f=>`<g data-fixture-id="${xml(f.id)}" data-fixture-kind="${xml(f.kind)}"><polygon points="${f.polygon.map(at).join(' ')}" fill="${f.fill}" stroke="#84917e" stroke-width=".018"/>${f.polygons.map(p=>`<polygon points="${p.map(at).join(' ')}" fill="none" stroke="#84917e" stroke-width=".012"/>`).join('')}${f.lines.map(line).join('')}${f.circles.map(c=>`<ellipse cx="${c.center.x+dx}" cy="${c.center.y+dy}" rx="${c.rx}" ry="${c.ry}" transform="rotate(${c.angle} ${c.center.x+dx} ${c.center.y+dy})" fill="none" stroke="#84917e" stroke-width=".012"/>`).join('')}${f.label?`<text x="${f.center.x+dx}" y="${f.center.y+dy}" text-anchor="middle" font-size="${.1*scale}" fill="#687c72">${xml(f.label)}</text>`:''}</g>`).join('')+annotation.doors.map(d=>`<g data-door-swing="${xml(d.openingId)}">${line(d.arc)}${line([d.hinge,d.openTip])}</g>`).join('');
};
export function exportBoardsCSV(report){const rows=[['ID','Конструкция','Роль','Сечение, мм','Длина оси, м','Заготовка, м','Чистый объём, м³','Масса, кг','Этаж','Балка ростверка','Слой пакета','X1','Y1','Z1','X2','Y2','Z2','Начальный рез','Конечный рез'],...report.result.timber.instances.map(b=>[b.id,b.category,b.role,`${b.b}x${b.h}`,b.length,b.cutLength,b.volume,b.mass,b.level??b.floor,b.beamId,b.plyIndex,...b.start,...b.end,JSON.stringify(b.cutStart),JSON.stringify(b.cutEnd)])];return '\uFEFF'+rows.map(r=>r.map(csv).join(';')).join('\r\n');}
export function exportPlanSVG(report){
 const levels=report.result.geometry.levels;
 const annexes=report.result.annexes?.items??[],spatial=report.result.spatialLayout??{};
 const all=levels.flatMap(l=>[...(l.platformPolygon??l.polygon),...l.polygon]).concat(annexes.flatMap(a=>a.polygon??[]));
 const b={minX:Math.min(...all.map(p=>p.x)),minY:Math.min(...all.map(p=>p.y)),maxX:Math.max(...all.map(p=>p.x)),maxY:Math.max(...all.map(p=>p.y))};
 const W=Math.max(1,b.maxX-b.minX),H=Math.max(1,b.maxY-b.minY),gap=1.7,pad=1.2,scale=Math.max(W,H)/14,extentW=levels.length*(W+gap)+2*pad,extentH=H+3.8*pad;
 const shapes=levels.map((l,index)=>{
  const dx=pad+index*(W+gap)-b.minX,dy=pad-b.minY,at=p=>`${p.x+dx},${p.y+dy}`,platform=l.platformPolygon??l.polygon;
  const xs=l.polygon.map(p=>p.x),ys=l.polygon.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const line=(a,z,extra)=>`<line x1="${a.x+dx}" y1="${a.y+dy}" x2="${z.x+dx}" y2="${z.y+dy}" ${extra}/>`;
  const walls=report.project.walls.filter(w=>(w.level??1)===l.index),annotations=planAnnotations(report,l.index);
  const wallDepth=w=>(Number(String(report.result.geometry.wallProfiles?.find(q=>q.wallId===w.id&&q.mode==='continuous')?.section??w.section).split(/[x×]/)[1])||150)/1000;
  const labelCenter=q=>{const ps=q.polygon,center=ps.reduce((s,p)=>({x:s.x+p.x/ps.length,y:s.y+p.y/ps.length}),{x:0,y:0}),holes=[...(l.voids??[]).map(v=>v.polygon),...(spatial.staircases??[]).filter(st=>[st.levelFrom,st.levelTo].includes(l.index)).map(st=>st.polygon)],inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};if(!holes.some(h=>inside(center,h)))return center;const xs=ps.map(p=>p.x),ys=ps.map(p=>p.y),loX=Math.min(...xs),loY=Math.min(...ys),w=Math.max(...xs)-loX,h=Math.max(...ys)-loY;const candidates=Array.from({length:81},(_,i)=>({x:loX+(i%9+.5)*w/9,y:loY+(Math.floor(i/9)+.5)*h/9})).filter(p=>inside(p,ps)&&!holes.some(v=>inside(p,v)));const edgeDistance=(p,a,b)=>{const L=(b.x-a.x)**2+(b.y-a.y)**2,t=Math.max(0,Math.min(1,((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/Math.max(1e-12,L)));return Math.hypot(p.x-a.x-(b.x-a.x)*t,p.y-a.y-(b.y-a.y)*t);};const clearance=p=>Math.min(...[ps,...holes].flatMap(poly=>poly.map((a,i)=>edgeDistance(p,a,poly[(i+1)%poly.length]))));return candidates.sort((a,b)=>clearance(b)-clearance(a))[0]??center;};
  return `<g data-level="${l.index}"><text x="${pad+index*(W+gap)}" y="${pad-.5}" font-size="${.3*scale}" fill="#334536">${xml(l.name)} · по осям без проёмов ${l.netFloorArea?.toFixed(2)??'—'} м²</text>
   <polygon data-reference="platform-outer-face" points="${platform.map(at).join(' ')}" fill="#f4f0e7" stroke="#3c735d" stroke-width=".035"/>
   ${annexes.filter(a=>(a.level??1)===l.index).map(a=>{const center=(a.polygon??[]).reduce((s,p)=>({x:s.x+p.x/a.polygon.length,y:s.y+p.y/a.polygon.length}),{x:0,y:0});const names={openTerrace:'Открытая терраса',coveredTerrace:'Крытая веранда',glazedVeranda:'Холодная остеклённая веранда'};return `<polygon data-annex-id="${xml(a.id)}" points="${a.polygon.map(at).join(' ')}" fill="#e8e1cc" stroke="#87936f" stroke-width=".035"/><text x="${center.x+dx}" y="${center.y+dy}" text-anchor="middle" font-size="${.16*scale}" fill="#6e7b58">${xml(a.name??names[a.kind]??'Пристройка')}</text>${(a.foundation?.piles??[]).map(p=>`<circle cx="${p.x+dx}" cy="${p.y+dy}" r=".055" fill="#71866d"/>`).join('')}`;}).join('')}
   ${annotations.rooms.map(q=>{const center=q.labelPoint??labelCenter(q);return `<polygon points="${q.polygon.map(at).join(' ')}" fill="#dce7cd" fill-opacity=".45"/><text x="${center.x+dx}" y="${center.y+dy}" text-anchor="middle" font-size="${.18*scale}" fill="#52614c">${xml(planRoomCaption(q))}<tspan x="${center.x+dx}" dy="${.21*scale}" font-size="${.14*scale}">${Number.isFinite(q.area)?q.area.toFixed(2)+' м²':''}</tspan></text>`;}).join('')}
   ${walls.map(w=>line(w.a,w.b,`stroke="${w.kind==='partition'?'#9b987f':'#c4aa7e'}" stroke-width="${wallDepth(w)}"`)).join('')}
   ${report.project.openings.filter(o=>{const w=walls.find(w=>w.id===o.wallId);return w&&(o.floor??w.level??1)===l.index}).map(o=>{const w=walls.find(w=>w.id===o.wallId),len=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),u={x:(w.b.x-w.a.x)/len,y:(w.b.y-w.a.y)/len};return line({x:w.a.x+u.x*o.offset,y:w.a.y+u.y*o.offset},{x:w.a.x+u.x*(o.offset+o.width),y:w.a.y+u.y*(o.offset+o.width)},`stroke="${o.type==='door'?'#f4f0e7':'#7caab2'}" stroke-width="${wallDepth(w)+.015}"`)}).join('')}
   ${annotationSVG(annotations,dx,dy,scale)}
   <polygon data-reference="wall-axes" points="${l.polygon.map(at).join(' ')}" fill="none" stroke="#53665b" stroke-width=".016" stroke-dasharray=".13 .08"/>
   ${(l.voids??[]).map(v=>`<polygon points="${v.polygon.map(at).join(' ')}" fill="#fcf9ee" stroke="#b39772" stroke-width=".035" stroke-dasharray=".15 .1"/>`).join('')}
   ${(spatial.surfaces??[]).filter(s=>['stairTread','stairLanding','tread','landing'].includes(s.kind)).map(s=>`<polygon data-spatial-surface="${xml(s.id)}" points="${(s.pointsXYZ??s.points??s.polygon??[]).map(p=>at({x:p[0],y:p[2]})).join(' ')}" fill="#ceb487" stroke="#93784e" stroke-width=".015"/>`).join('')}
   ${(spatial.guards??[]).filter(g=>g.kind==='flightGuard'||(g.level??2)===l.index).map(g=>line({x:g.start[0],y:g.start[2]},{x:g.end[0],y:g.end[2]},`data-guard-id="${xml(g.id)}" stroke="#496e64" stroke-width=".055"`)).join('')}
   ${(l.voids??[]).filter(v=>v.kind==='doubleHeight').map(v=>{const minX=Math.min(...v.polygon.map(p=>p.x)),maxX=Math.max(...v.polygon.map(p=>p.x)),midY=v.polygon.reduce((s,p)=>s+p.y,0)/v.polygon.length,stair=report.project.staircase?.polygon,stairLeft=stair?.length?Math.min(...stair.map(p=>p.x)):maxX;return `<text x="${dx+(minX+Math.max(minX,Math.min(stairLeft,maxX)))/2}" y="${dy+midY}" text-anchor="middle" font-size="${.2*scale}" fill="#a07746">ВТОРОЙ СВЕТ</text>`;}).join('')}
   ${line({x:minX,y:maxY+.35},{x:maxX,y:maxY+.35},'stroke="#68736e" stroke-width=".012"')}
   <text x="${dx+(minX+maxX)/2}" y="${dy+maxY+.62}" text-anchor="middle" font-size="${.17*scale}" fill="#53665b">${(maxX-minX).toFixed(3)} м · между осями стен</text>
   ${line({x:minX-.35,y:minY},{x:minX-.35,y:maxY},'stroke="#68736e" stroke-width=".012"')}
   <text transform="translate(${dx+minX-.48} ${dy+(minY+maxY)/2}) rotate(-90)" text-anchor="middle" font-size="${.17*scale}" fill="#53665b">${(maxY-minY).toFixed(3)} м · между осями стен</text>
   <text x="${dx+minX}" y="${dy+maxY+1.45}" font-size="${.15*scale}" fill="#3c735d">Платформа по наружной грани: ${l.platformNetArea?.toFixed(2)??'—'} м² без проёмов</text>
   <text x="${dx+(minX+maxX)/2}" y="${dy+maxY+1.05}" text-anchor="middle" font-size="${.17*scale}" fill="#3c735d">${(Math.max(...platform.map(p=>p.x))-Math.min(...platform.map(p=>p.x))).toFixed(3)} × ${(Math.max(...platform.map(p=>p.y))-Math.min(...platform.map(p=>p.y))).toFixed(3)} м · наружные грани каркаса</text>
  </g>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extentW} ${extentH}" width="1400" height="${Math.round(1400*extentH/extentW)}"><rect width="100%" height="100%" fill="#faf9f5"/><title>${xml(report.project.name)}</title>${shapes}<text x="${pad}" y="${H+3.4*pad}" font-family="sans-serif" font-size="${.16*scale}" fill="#6e7569">КАРКАС ENGINE ${report.engine.version} · зелёный контур: наружная грань платформы; пунктир: оси стен · узлы и влагозащита не подтверждены</text></svg>`;
}
export function exportModelOBJ(report){
 const lines=[`# KARKAS ENGINE ${report.engine.version}`,`# metres; x,y(up),z; same cut geometry as the read-only viewer`,`# Polygon notches flagged requiresCutBoolean are schematic; engineered connections not certified`];let offset=1;
 for(const board of report.result.timber.instances){
  const geo=cutGeometry(board),a=new THREE.Vector3(...board.start),b=new THREE.Vector3(...board.end),dir=b.clone().sub(a).normalize();let x=new THREE.Vector3(...(board.crossAxis??[1,0,0]));x.addScaledVector(dir,-x.dot(dir)).normalize();if(x.length()<.1)x=new THREE.Vector3(0,0,1).cross(dir).normalize();const z=new THREE.Vector3().crossVectors(x,dir).normalize(),basis=new THREE.Matrix4().makeBasis(x,dir,z),mid=a.clone().add(b).multiplyScalar(.5),positions=geo.getAttribute('position'),index=geo.index;
  lines.push(`o ${board.id.replace(/[^a-zA-Z0-9_-]/g,'_')}`,`g ${board.category}`);
  for(let i=0;i<positions.count;i++){const v=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(basis).add(mid);lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);}
  const count=index?.count??positions.count;for(let i=0;i<count;i+=3){const ids=[i,i+1,i+2].map(n=>(index?index.getX(n):n)+offset);lines.push('f '+ids.join(' '));}offset+=positions.count;geo.dispose();
 }
 return lines.join('\n')+'\n';
}

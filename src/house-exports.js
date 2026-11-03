import * as THREE from 'three';
import {cutGeometry} from './board-geometry.js';
const xml=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const csv=x=>'"'+String(typeof x==='string'&&/^[\s]*[=+@-]/.test(x)?"'"+x:x??'').replaceAll('"','""')+'"';
export function exportBoardsCSV(report){const rows=[['ID','Конструкция','Роль','Сечение, мм','Длина оси, м','Заготовка, м','Чистый объём, м³','Масса, кг','Этаж','Балка ростверка','Слой пакета','X1','Y1','Z1','X2','Y2','Z2','Начальный рез','Конечный рез'],...report.result.timber.instances.map(b=>[b.id,b.category,b.role,`${b.b}x${b.h}`,b.length,b.cutLength,b.volume,b.mass,b.level??b.floor,b.beamId,b.plyIndex,...b.start,...b.end,JSON.stringify(b.cutStart),JSON.stringify(b.cutEnd)])];return '\uFEFF'+rows.map(r=>r.map(csv).join(';')).join('\r\n');}
export function exportPlanSVG(report){
 const levels=report.result.geometry.levels;
 const all=levels.flatMap(l=>[...(l.platformPolygon??l.polygon),...l.polygon]);
 const b={minX:Math.min(...all.map(p=>p.x)),minY:Math.min(...all.map(p=>p.y)),maxX:Math.max(...all.map(p=>p.x)),maxY:Math.max(...all.map(p=>p.y))};
 const W=Math.max(1,b.maxX-b.minX),H=Math.max(1,b.maxY-b.minY),gap=1.7,pad=1.2,scale=Math.max(W,H)/14,extentW=levels.length*(W+gap)+2*pad,extentH=H+3.8*pad;
 const shapes=levels.map((l,index)=>{
  const dx=pad+index*(W+gap)-b.minX,dy=pad-b.minY,at=p=>`${p.x+dx},${p.y+dy}`,platform=l.platformPolygon??l.polygon;
  const xs=l.polygon.map(p=>p.x),ys=l.polygon.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const line=(a,z,extra)=>`<line x1="${a.x+dx}" y1="${a.y+dy}" x2="${z.x+dx}" y2="${z.y+dy}" ${extra}/>`;
  const walls=report.project.walls.filter(w=>(w.level??1)===l.index);
  const wallDepth=w=>(Number(String(report.result.geometry.wallProfiles?.find(q=>q.wallId===w.id&&q.mode==='continuous')?.section??w.section).split(/[x×]/)[1])||150)/1000;
  return `<g data-level="${l.index}"><text x="${pad+index*(W+gap)}" y="${pad-.5}" font-size="${.3*scale}" fill="#334536">${xml(l.name)} · по осям без проёмов ${l.netFloorArea?.toFixed(2)??'—'} м²</text>
   <polygon data-reference="platform-outer-face" points="${platform.map(at).join(' ')}" fill="#f4f0e7" stroke="#3c735d" stroke-width=".035"/>
   ${(report.planning.rooms??[]).filter(q=>(q.level??1)===l.index&&q.polygon).map(q=>{const center=q.polygon.reduce((a,p)=>({x:a.x+p.x/q.polygon.length,y:a.y+p.y/q.polygon.length}),{x:0,y:0});return `<polygon points="${q.polygon.map(at).join(' ')}" fill="#dce7cd" fill-opacity=".45"/><text x="${center.x+dx}" y="${center.y+dy}" text-anchor="middle" font-size="${.18*scale}" fill="#52614c">${xml(q.name)}</text>`;}).join('')}
   ${walls.map(w=>line(w.a,w.b,`stroke="${w.kind==='partition'?'#9b987f':'#c4aa7e'}" stroke-width="${wallDepth(w)}"`)).join('')}
   ${report.project.openings.filter(o=>{const w=walls.find(w=>w.id===o.wallId);return w&&(o.floor??w.level??1)===l.index}).map(o=>{const w=walls.find(w=>w.id===o.wallId),len=Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y),u={x:(w.b.x-w.a.x)/len,y:(w.b.y-w.a.y)/len};return line({x:w.a.x+u.x*o.offset,y:w.a.y+u.y*o.offset},{x:w.a.x+u.x*(o.offset+o.width),y:w.a.y+u.y*(o.offset+o.width)},`stroke="${o.type==='door'?'#f4f0e7':'#7caab2'}" stroke-width="${wallDepth(w)+.015}"`)}).join('')}
   <polygon data-reference="wall-axes" points="${l.polygon.map(at).join(' ')}" fill="none" stroke="#53665b" stroke-width=".016" stroke-dasharray=".13 .08"/>
   ${(l.voids??[]).map(v=>`<polygon points="${v.polygon.map(at).join(' ')}" fill="white" stroke="#b39772" stroke-width=".035" stroke-dasharray=".15 .1"/>`).join('')}
   ${line({x:minX,y:maxY+.35},{x:maxX,y:maxY+.35},'stroke="#68736e" stroke-width=".012"')}
   <text x="${dx+(minX+maxX)/2}" y="${dy+maxY+.62}" text-anchor="middle" font-size="${.17*scale}" fill="#53665b">${(maxX-minX).toFixed(3)} м · между осями стен</text>
   ${line({x:minX-.35,y:minY},{x:minX-.35,y:maxY},'stroke="#68736e" stroke-width=".012"')}
   <text transform="translate(${dx+minX-.48} ${dy+(minY+maxY)/2}) rotate(-90)" text-anchor="middle" font-size="${.17*scale}" fill="#53665b">${(maxY-minY).toFixed(3)} м · между осями стен</text>
   <text x="${dx+minX}" y="${dy+maxY+.95}" font-size="${.15*scale}" fill="#3c735d">Платформа по наружной грани: ${l.platformNetArea?.toFixed(2)??'—'} м² без проёмов</text>
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

/** Physical butt joints at orthogonal wall corners. Coordinates describe wall
 * axes; a through board must reach the adjacent outside face, while the butt
 * board stops at the through board's inside face. Alternate the double top
 * plate so its upper layer bridges the lower layer's corner joint.
 * This geometry does not specify fasteners or an airtight membrane detail. */
export function wallPlateEnds(wall,corners,walls,{position='top',layer=0}={}){
 const length=Math.hypot(wall.b.x-wall.a.x,wall.b.y-wall.a.y),ends={start:0,end:length,joints:[]};
 const depth=w=>Number(String(w.section).replaceAll(' ','').split(/[x×]/)[1])/1000;
 for(const c of corners){
  if(c.kind!=='corner'||c.cutScheme!=='butt'||Math.abs(Math.min(c.angle,360-c.angle)-90)>1e-5||c.wallIds.length!==2)continue;
  const start=Math.hypot(c.point.x-wall.a.x,c.point.y-wall.a.y)<1e-6,end=Math.hypot(c.point.x-wall.b.x,c.point.y-wall.b.y)<1e-6;if(!start&&!end)continue;
  const ids=[...c.wallIds].sort(),neighbor=walls.get(ids.find(id=>id!==wall.id));if(!neighbor)continue;
  // Different board thicknesses put the layers at different elevations; a
  // plan-only trim cannot establish a valid 3D bearing/lap in that case.
  const thickness=w=>Number(String(w.section).replaceAll(' ','').split(/[x×]/)[0]);
  if(thickness(wall)!==thickness(neighbor))continue;
  const primary=ids[position==='top'&&layer===1?1:0],through=wall.id===primary,offset=through?-depth(neighbor)/2:depth(neighbor)/2;
  if(start)ends.start=offset;else ends.end=length-offset;
  ends.joints.push({cornerId:c.id,end:start?'start':'end',wallId:wall.id,neighborWallId:neighbor.id,through,offset,connectionVerified:false});
 }
 return ends;
}

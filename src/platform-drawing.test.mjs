import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPlanSVG,fixturePlanGeometry,planAnnotations,planRoomCaption,planLabelLines} from './house-exports.js';

test('SVG keeps wall-axis dimensions separate from the physical platform face',()=>{
 const axis=[{x:0,y:0},{x:8,y:0},{x:8,y:4},{x:0,y:4}],outer=[{x:-.099,y:-.099},{x:8.099,y:-.099},{x:8.099,y:4.099},{x:-.099,y:4.099}];
 const report={engine:{version:'test'},project:{name:'Грани & оси',walls:[],openings:[]},planning:{rooms:[]},result:{geometry:{levels:[{index:1,name:'Этаж 1',polygon:axis,platformPolygon:outer,netFloorArea:32,platformNetArea:34.415204,voids:[]}]}}};
 const svg=exportPlanSVG(report),points=reference=>svg.match(new RegExp(`data-reference="${reference}" points="([^"]+)"`))[1].split(' ').map(p=>p.split(',').map(Number));
 const physical=points('platform-outer-face'),axes=points('wall-axes');
 assert.ok(Math.abs(physical[0][0]-axes[0][0]+.099)<1e-9);assert.ok(Math.abs(physical[0][1]-axes[0][1]+.099)<1e-9);
 assert.ok(Math.abs(physical[1][0]-physical[0][0]-8.198)<1e-9);assert.ok(Math.abs(axes[1][0]-axes[0][0]-8)<1e-9);
 assert.match(svg,/8\.000 м · между осями стен/);assert.match(svg,/по осям без проёмов 32\.00 м²/);assert.match(svg,/Платформа по наружной грани: 34\.42 м²/);assert.match(svg,/Грани &amp; оси/);
 assert.equal(JSON.stringify(report.result.geometry.levels[0].polygon),JSON.stringify(axis),'Rendering must not alter the wall axes');
});

test('legacy reports retain their axis polygon without fabricating a physical area',()=>{
 const polygon=[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}];
 const report={engine:{version:'test'},project:{name:'Legacy',walls:[],openings:[]},planning:{rooms:[]},result:{geometry:{levels:[{index:1,name:'Этаж',polygon,netFloorArea:4,voids:[]}]}}};
 const svg=exportPlanSVG(report);assert.match(svg,/Платформа по наружной грани: — м²/);assert.ok(!svg.includes('NaN'));assert.ok(!svg.includes('undefined'));
});

test('SVG traces actual stair surfaces, guards and an annex without inventing step divisions',()=>{
 const polygon=[{x:0,y:0},{x:8,y:0},{x:8,y:5},{x:0,y:5}],annexPolygon=[{x:8.13,y:1},{x:10.63,y:1},{x:10.63,y:4},{x:8.13,y:4}];
 const report={engine:{version:'4.3.0'},project:{name:'Пространство',walls:[],openings:[],staircase:{polygon:[{x:3,y:.5},{x:6.2,y:.5},{x:6.2,y:2.7},{x:3,y:2.7}]}},planning:{rooms:[]},result:{geometry:{levels:[{index:2,name:'Этаж 2',polygon,netFloorArea:25,voids:[{id:'one-void',kind:'doubleHeight',polygon:[{x:.6,y:.2},{x:6.2,y:.2},{x:6.2,y:2.8},{x:.6,y:2.8}]}]}]},spatialLayout:{surfaces:[{id:'real-tread',kind:'stairTread',points:[[4,2,.5],[4.275,2,.5],[4.275,2,1.5],[4,2,1.5]]},{id:'real-landing',kind:'stairLanding',pointsXYZ:[[3,2,.5],[4,2,.5],[4,2,2.7],[3,2,2.7]]},{id:'glass',kind:'daylightGlazing',points:[[1,4,0],[2,4,0],[2,5,0],[1,5,0]]}],guards:[{id:'real-flight-guard',kind:'flightGuard',level:1,start:[4,2,.5],end:[6.2,3,.5]}]},annexes:{items:[{id:'annex-exact',name:'Крытая веранда',kind:'coveredTerrace',level:2,polygon:annexPolygon,foundation:{piles:[{id:'pile-A',x:8.5,y:1.5}]}}]}}};
 const before=JSON.stringify(report),svg=exportPlanSVG(report);
 assert.match(svg,/data-spatial-surface="real-tread"/);assert.match(svg,/data-spatial-surface="real-landing"/);assert.match(svg,/data-guard-id="real-flight-guard"/);assert.match(svg,/data-annex-id="annex-exact"/);assert.match(svg,/Крытая веранда/);assert.match(svg,/ВТОРОЙ СВЕТ/);
 assert.equal((svg.match(/data-spatial-surface=/g)||[]).length,2,'Only source tread and landing polygons are drawn; no arbitrary staircase mesh');
 assert.equal(JSON.stringify(report),before,'A read-only drawing must preserve its report');assert.ok(!svg.includes('NaN'));
});

test('architectural annotations use real opening width and explicit handedness; furniture remains non-physical',()=>{
 const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],p={name:'Новый дом',walls:[{id:'front',level:1,a:{x:.099,y:.099},b:{x:7.901,y:.099},section:'48x198'}],openings:[{id:'entry',type:'door',wallId:'front',offset:2.701,width:1,floor:1}],roomSchedule:[{id:'entry-room',name:'Тёплая прихожая',level:1,area:2.7,polygon:rect(2.249,.198,1.702,1.553),fixtures:[{id:'cabinet',kind:'wardrobe',polygon:rect(2.3,1.1,1.2,.6)}],doorSwings:[{openingId:'entry',hinge:'start',normal:-1,angle:90}]},{id:'bath',name:'Санузел',level:1,area:6,polygon:rect(5.849,.198,1.953,3.153),fixtures:[{id:'wash',kind:'washer',label:'СМ',stackGroup:'column',polygon:rect(7.1,.3,.6,.65)},{id:'dry',kind:'dryer',label:'СШ',stackGroup:'column',polygon:rect(7.1,.3,.6,.65)}]}]},report={engine:{version:'4.4'},project:p,planning:{rooms:p.roomSchedule},result:{geometry:{levels:[{index:1,name:'1 этаж',polygon:rect(.099,.099,7.802,5.802),platformPolygon:rect(0,0,8,6),netFloorArea:45.267204,platformNetArea:48,voids:[]}]},timber:{instances:[]}}},before=JSON.stringify(report),annotations=planAnnotations(report,1),door=annotations.doors[0];
 assert.equal(annotations.fixtures.length,2,'Stacked appliances occupy one annotated footprint');assert.deepEqual(annotations.fixtures[1].sourceIds,['wash','dry']);assert.equal(annotations.fixtures[1].label,'СМ + СШ');assert.equal(door.width,1);assert.ok(Math.abs(door.hinge.x-2.8)<1e-10);assert.ok(Math.abs(door.openTip.y+.901)<1e-10,'Outward normal opens the leaf outside the front facade');
 for(const point of door.arc)assert.ok(Math.abs(Math.hypot(point.x-door.hinge.x,point.y-door.hinge.y)-1)<1e-9);
 const svg=exportPlanSVG(report);assert.match(svg,/data-fixture-id="wash"/);assert.equal(svg.includes('data-fixture-id="dry"'),false);assert.match(svg,/data-door-swing="entry"/);assert.match(svg,/8\.000 × 6\.000 м · наружные грани каркаса/);assert.match(svg,/7\.802 м · между осями стен/);assert.match(svg,/Тёплая прихожая/);assert.equal(JSON.stringify(report),before);assert.equal(report.result.timber.instances.length,0);
 p.roomSchedule[0].doorSwings=[];assert.equal(planAnnotations(report,1).doors.length,0,'No hinge metadata means no invented swing');assert.equal(fixturePlanGeometry({id:'bad',polygon:[]}),null);
 const wc=fixturePlanGeometry({id:'WC',kind:'wc',frontEdge:3,polygon:rect(7.02,1.5,.7,.45)}),tankX=wc.polygons[0].reduce((s,p)=>s+p.x/4,0);assert.ok(tankX>wc.circles[0].center.x,'A west-facing toilet has the bowl toward its front edge and the tank at the rear');
 const sofa=fixturePlanGeometry({id:'sofa',kind:'sofa',frontEdge:1,polygon:rect(.35,3.45,.9,2.2)});assert.ok(sofa.polygons[0].reduce((s,p)=>s+p.x/4,0)<sofa.center.x,'An east-facing sofa has its back on the west side');
});

test('a short plan label does not replace the full room name in the report or schedule',()=>{
 const room={id:'bath',level:1,name:'Ванная / WC / постирочная',planLabel:'Санузел',area:6.081,polygon:[{x:5.85,y:.2},{x:7.8,y:.2},{x:7.8,y:3.4},{x:5.85,y:3.4}],labelPoint:{x:6.8,y:2.12}},report={engine:{version:'4.4'},project:{name:'Ногинск',walls:[],openings:[],roomSchedule:[room]},planning:{rooms:[room]},result:{geometry:{levels:[{index:1,name:'Этаж 1',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],voids:[]}]}}};
 const before=JSON.stringify(report),annotations=planAnnotations(report,1);assert.equal(planRoomCaption(room),'Санузел');assert.deepEqual(planLabelLines({...annotations.rooms[0],width:1.95},.2),['Санузел']);assert.match(exportPlanSVG(report),/>Санузел<tspan/);assert.equal(annotations.rooms[0].name,'Ванная / WC / постирочная');assert.equal(JSON.stringify(report),before);assert.equal(planRoomCaption({name:'Полное',planLabel:' '}),'Полное');assert.equal(planRoomCaption({name:'Полное',shortName:'Кратко'}),'Кратко');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPlanSVG} from './house-exports.js';

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

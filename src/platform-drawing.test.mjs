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

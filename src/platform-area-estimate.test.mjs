import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateEstimate} from './estimate-engine.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('floor sheathing and envelope layer procurement use physical platform area, preserving axial planning area',()=>{
 const project={floors:2,openings:[],prices:{wastePercent:0,sheathingM2:10,laborPercent:0,contingencyPercent:0},envelope:{costItems:[{id:'ground',name:'Ground deck',basis:'groundFloor',rate:20},{id:'floors',name:'All decks',basis:'allFloors',rate:30}]}};
 const geometry={closed:true,totalFloorArea:145.68,totalPlatformArea:153.678408,netWallArea:0,levels:[{area:80,platformNetArea:83.999204},{area:80,platformNetArea:69.679204}]};
 const result={geometry,timber:{instances:[]},piles:[],bracingModel:{method:'sheathing',quantities:{}}};
 const e=calculateEstimate(project,result),row=id=>e.rows.find(r=>r.id===id);
 near(row('sheathing').netQuantity,153.678408);near(row('envelope-ground').netQuantity,83.999204);near(row('envelope-floors').netQuantity,153.678408);near(geometry.totalFloorArea,145.68);
});

test('legacy results without physical platform metadata retain their original estimate basis',()=>{
 const project={floors:1,openings:[],prices:{wastePercent:0},envelope:{costItems:[{id:'ground',name:'Ground deck',basis:'groundFloor',rate:1}]}};
 const e=calculateEstimate(project,{geometry:{area:80,totalFloorArea:72,netWallArea:0,levels:[{area:80}]},timber:{instances:[]},piles:[]});
 near(e.rows.find(r=>r.id==='sheathing').netQuantity,72);near(e.rows.find(r=>r.id==='envelope-ground').netQuantity,80);
});

test('an invalid physical platform makes procurement explicitly incomplete',()=>{
 const e=calculateEstimate({floors:1,openings:[]},{geometry:{closed:true,area:20,totalFloorArea:20,totalPlatformArea:0,platformAreaComplete:false},timber:{instances:[]},piles:[]});
 assert.equal(e.complete,false);
});

import {defaultDesignerProject} from './designer-engine.js';import {defaultPrices} from './prices.js';
const clone=x=>JSON.parse(JSON.stringify(x));
export function normalizeDesignerState(input={}){const raw=clone(input),d=clone(defaultDesignerProject);let p={...d,...raw,roof:{...d.roof,...raw.roof},floor:{...d.floor,...raw.floor},material:{...d.material,Fv:1.5,studRestraint:raw.height??2.8,columnK:1,...raw.material},loads:{...d.loads,...raw.loads},foundation:{...d.foundation,...raw.foundation},joints:{...d.joints,spliceScheme:'halfLap',spliceLength:.4,...raw.joints,overrides:raw.joints?.overrides||{}},cutting:{stockLength:6,kerf:3,minReusable:.3,...raw.cutting},objects:raw.objects||[],voids:raw.voids||[],boardCuts:raw.boardCuts||{},prices:{...defaultPrices,...raw.prices,sectionPrices:{...raw.prices?.sectionPrices}}};
 const F=p.floors||1;p.levels=(raw.levels===undefined||(Array.isArray(raw.levels)&&raw.levels.length===0))?Array.from({length:F},(_,i)=>({id:'level-'+(i+1),index:i+1,name:`${i+1} этаж`,height:p.height})):raw.levels.map(l=>({...l}));
 if(p.levels.length){p.floors=p.levels.length;p.height=p.levels[0].height}
 const oldWalls=p.walls,all=[],openingMap=new Map();for(const w of oldWalls){if(w.level!==undefined){all.push(w);openingMap.set(w.id,[w]);continue}const copies=[];for(let level=1;level<=p.floors;level++){const c={...clone(w),id:level===1?w.id:w.id+'-L'+level,level};all.push(c);copies.push(c)}openingMap.set(w.id,copies)}p.walls=all;
 p.openings=p.openings.map(o=>{const candidates=openingMap.get(o.wallId)||[],wall=candidates.find(w=>w.level===(o.floor??1))||candidates[0];return {...o,wallId:wall?.id||o.wallId,floor:wall?.level??o.floor??1}});
 p.objects=p.objects.map(o=>({...o,level:o.level??1}));return p;
}

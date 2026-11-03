import {calculateDesigner} from './designer-engine.js';
import {calculateRoofZones} from './roof-zones.js';
import {checkDesignerMembers} from './designer-mechanics.js';
const clone=x=>JSON.parse(JSON.stringify(x));
/** Fixed-section load-case checks. No auto resizing between cases. */
export function analyzeSnowCases(p,baseline){
 const requested=p.snowDesign?.cases??[];if(!Array.isArray(requested)||requested.length>12)throw new Error('Снеговые случаи: не более 12.');
 const cases=[],checks=[];
 for(const item of requested){
  if(typeof item.id!=='string'||!item.id||typeof item.name!=='string'||!item.zoneFactors||typeof item.zoneFactors!=='object'||Array.isArray(item.zoneFactors))throw new Error('Снеговой случай: id, name и zoneFactors обязательны.');
  const q=clone(p),zones=baseline.roofModel?.zones??[];
  for(const [id,factor]of Object.entries(item.zoneFactors))if(!zones.some(z=>z.id===id)||!Number.isFinite(factor)||factor<0||factor>4)throw new Error('Множитель снеговой зоны: существующий zoneId и 0…4.');
  q.roof.zones=zones.map(z=>({id:z.id,name:z.name,polygon:z.polygon,shape:z.shape,ridgeAngle:z.ridgeAngle,pitchLeft:z.pitchLeft,pitchRight:z.pitchRight,elevation:z.elevation??null,levelIndex:z.levelIndex,spacing:z.spacing,chordSection:z.selectedSection??z.chordSection,webSection:z.webSection,framing:z.effectiveFraming==='rafters'?'rafters':'truss',deflectionRatio:z.deflectionRatio??300,loadSnowFactor:item.zoneFactors[z.id]??1}));
  const base=calculateDesigner(q),roof=calculateRoofZones(q,base,{roofExtraDeadByZone:baseline.auxiliaryTimber?.roofExtraDeadByZone??{}}),r=calculateDesigner(q,{roofModel:roof}),mechanics=checkDesignerMembers(q,r),all=[...r.checks,...mechanics.checks],failures=all.filter(c=>c.status==='fail');
  const rafters=roof.zones.filter(z=>z.rafterAnalysis).map(z=>({zoneId:z.id,section:z.selectedSection,analysis:z.rafterAnalysis}));
  const candidate={id:item.id,name:item.name,kind:item.kind??'load_arrangement',zoneFactors:item.zoneFactors,snowCharacteristic:r.loads?.snow??0,totalDesign:r.loads?.totalDesign??null,maxPileReaction:r.foundation?.maxReaction??null,maxGrillageUtilization:r.grillageModel?.worstSpan?.check?.utilization??null,rafters,failures,status:failures.length?'fail':'screen_pass',sectionsFixed:true};cases.push(candidate);
  checks.push({id:'snow-case-'+item.id,label:'Снег: '+item.name,status:failures.length?'fail':'pass',note:failures.length?failures.map(c=>c.label).join('; '):'Частные проверки фиксированных сечений без автоподбора между случаями; нормативная полнота отдельно не подтверждена.'});
 }
 if(cases.length)checks.push({id:'snow-scope',label:'Снег: местные заносы, сползание и нормативные сочетания',status:'unverified',note:'Проверены явно заданные распределения. Локальные снеговые мешки требуют геометрии препятствий и полного нормативного задания; равномерный множитель зоны не заменяет треугольную/трапецеидальную нагрузку заноса.'});
 const highest=cases.reduce((a,b)=>!a||b.totalDesign>a.totalDesign?b:a,null);
 return {groundSnow:p.loads.snow,coefficientMethod:'s = mu(alpha) × Ce × Ct × sk; Ce=Ct=1 in this concept model',basis:p.snowDesign?.basis??'User-specified load cases',cases,checks,worstTotalDesignCase:highest?.id??null,certified:false,assumptions:['Сечения и несущая схема зафиксированы по базовой модели. Нагрузки не приводят к скрытой замене досок между случаями.','Множитель по зоне применяется к её снеговой нагрузке, локальному расчёту стропил/ферм, вертикальным реакциям стены, суммарной нагрузке и реакциям свай.','Полное совместное действие ветра/снега и понижающие psi-коэффициенты EN1990 не реализованы; текущие gammaG/gammaQ описывают одну заданную огибающую.']};
}

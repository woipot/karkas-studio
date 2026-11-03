/** Preliminary technology screening, not geotechnical sizing or a price model. */
export const foundationOptionTypes=Object.freeze(['reinforced_concrete_driven_250','steel_driven_RR','steel_drilled_RD','steel_helical']);
const profiles=new Set(['unknown','soft-over-bearing','dense-granular','shallow-bedrock']);
const flags=['vibrationSensitive','boulders','largeRigAccess','geotechnicalVerified'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export class FoundationOptionsInputError extends Error {
  constructor(field,message){super(message);this.name='FoundationOptionsInputError';this.code='INVALID_FOUNDATION_OPTIONS';this.details={field};}
}
const invalid=(field,message)=>{throw new FoundationOptionsInputError(field,message);};
export const foundationOptionSources=Object.freeze([
  {id:'ssab-rr-rd',title:'SSAB RR/RD: Design and installation manual',url:'https://www.ssab.com/-/media/files/en/infra/ssab-rr-and-rd-piles---design-and-installation-manual.pdf?m=20231017063016',scope:'Sections 4–6: soil, installation, geotechnical investigations and resistance; Finnish application.'},
  {id:'finland-rc',title:'Elementtisuunnittelu: Paalut',url:'https://www.elementtisuunnittelu.fi/runkorakenteet/perustukset-ja-vaestonsuojat/paalut',scope:'Finnish precast concrete pile types and nominal 250×250 mm section.'},
  {id:'lujabetoni',title:'Lujabetoni: Paalut',url:'https://lujabetoni.fi/tuotteet/betonituotteet/paalut/',scope:'Producer product families; no site-specific resistance inferred.'},
  {id:'keller-helical',title:'Keller: Helical piles (screw piles)',url:'https://www.keller-na.com/expertise/techniques/helical-piles-screw-piles',scope:'Soil information, monitored installation torque and load-testing/settlement verification; not Finnish design values.'},
]);

export function compareFoundationOptions(project,result,site={}) {
  if(!object(project)||!object(project.foundation))invalid('project.foundation','Нужны исходные параметры фундамента проекта.');
  if(!object(result)||!object(result.foundation))invalid('result.foundation','Нужен результат расчёта реакций свай.');
  if(!object(site))invalid('site','Участок должен быть объектом параметров.');
  for(const key of Object.keys(site))if(!['soilProfile',...flags].includes(key))invalid('site.'+key,'Неизвестный параметр участка: '+key);
  const profile=site.soilProfile===undefined?'unknown':site.soilProfile;if(!profiles.has(profile))invalid('site.soilProfile','Неизвестный профиль грунтов.');
  for(const key of flags)if(site[key]!==undefined&&typeof site[key]!=='boolean')invalid('site.'+key,key+': требуется boolean.');
  let maxDesignReaction=result.foundation.maxReaction;
  if(!finite(maxDesignReaction)||maxDesignReaction<0)invalid('result.foundation.maxReaction','Максимальная расчётная реакция должна быть конечной и неотрицательной, кН.');
  const pileCount=result.foundation.count??result.piles?.length;
  if(!Number.isInteger(pileCount)||pileCount<0)invalid('result.foundation.count','Число свай должно быть неотрицательным целым.');
  if(pileCount===0&&maxDesignReaction>0)invalid('result.foundation','При ненулевой реакции нужны реальные опоры.');
  if(result.piles!==undefined){
    if(!Array.isArray(result.piles)||result.piles.length!==pileCount)invalid('result.piles','Количество опор не совпадает с расчётным результатом.');
    for(const pile of result.piles)if(!object(pile)||!finite(pile.reaction)||pile.reaction<0)invalid('result.piles.reaction','Реакции всех опор должны быть конечными и неотрицательными.');
    if(Math.abs(Math.max(0,...result.piles.map(p=>p.reaction))-maxDesignReaction)>1e-6)invalid('result.foundation.maxReaction','Максимальная реакция не совпадает с фактическими опорами.');
  }
  const baselineMaxReaction=maxDesignReaction;let governingCase={id:'baseline',name:'Базовая схема',kind:'baseline'};
  const snowCases=result.snowAssessment?.cases??[];
  if(!Array.isArray(snowCases))invalid('result.snowAssessment.cases','Снеговые случаи должны быть массивом расчётных результатов.');
  for(const item of snowCases){if(!object(item)||!finite(item.maxPileReaction)||item.maxPileReaction<0)invalid('result.snowAssessment.cases.maxPileReaction','Реакция снегового случая должна быть конечной и неотрицательной.');if(item.maxPileReaction>maxDesignReaction){maxDesignReaction=item.maxPileReaction;governingCase={id:item.id??null,name:item.name??null,kind:item.kind??'load_arrangement'};}}
  const capacity=project.foundation.capacity;
  if(capacity!==undefined&&(!finite(capacity)||capacity<=0))invalid('project.foundation.capacity','Введённая несущая способность должна быть конечной и положительной.');
  const evidence=project.foundation.capacityEvidence;
  if(evidence!==undefined&&(!object(evidence)||typeof evidence.reference!=='string'||!evidence.reference.trim()||evidence.reference.length>2000))invalid('project.foundation.capacityEvidence','Для документированного исходного значения нужен непустой reference.');
  const capacityInput={value:capacity??null,unit:'kN',status:evidence?'documented-input':'assumed-example',evidenceReference:evidence?.reference??null,usedForCandidateApproval:false,geotechnicalResistanceVerified:false,note:evidence?'Ссылка на документ сохранена; её область действия и сопротивление этим сравнением не проверены.':'Введённая capacity — допущение/пример, а не доказательство сопротивления грунта или сваи.'};
  const common={status:'conditional',certified:false,maxDesignReaction,pileCount,designResistance:null,pileLength:null,steelDiameter:null,estimatedPrice:null,capacityStatus:'unverified',checks:[{id:'geotechnical-resistance',status:'unverified'},{id:'structural-resistance',status:'unverified'},{id:'settlement-and-group',status:'unverified'},{id:'pile-cap-and-grillage-connection',status:'unverified'}]};
  const candidate=(type,name,installation,notes,sourceIds)=>({...common,type,id:type,name,installation,notes,sourceIds,exclusions:[],conditions:['Изыскания, расчёт сопротивления и осадок, подтверждение монтажа и узла оголовка.'],checks:common.checks.map(c=>({...c}))});
  const candidates=[
    candidate('reinforced_concrete_driven_250','Железобетонная забивная свая · 250×250 мм','driven',['250×250 мм — номинальный типоразмер; длина и сопротивление не назначены.','Для передачи нагрузки через слабые слои на подтверждённый несущий слой; нужны площадка для установки и оценка вибрации.'],project.site?.country==='RU'?['ru-piles','ru-investigations']:['finland-rc','lujabetoni']),
    candidate('steel_driven_RR','Стальная забивная свая RR','driven',['Забивка требует оценки проходимости слоёв и воздействия на соседние сооружения.','Валуны увеличивают риск отклонения/отказа; диаметр, башмак и длина определяются проектом.'],['ssab-rr-rd']),
    candidate('steel_drilled_RD','Стальная буровая свая RD','drilled',['Предварительный вариант при препятствиях, близкой скале или чувствительных соседних сооружениях.','Возможность бурения не подтверждает сопротивление, доступ установки или безопасность производства работ.'],['ssab-rr-rd']),
    candidate('steel_helical','Стальная винтовая свая','screwed',['В этой ограниченной модели рассматривается при подтверждённом плотном зернистом грунте; это не универсальная классификация применимости технологии.','Нужны проект конкретного изделия, данные грунтов, контроль момента установки и программа испытаний/приёмки.'],['keller-helical']),
  ];
  candidates[0].nominalSectionMM=[250,250];
  const byType=new Map(candidates.map(c=>[c.type,c])),rc=candidates[0],rr=candidates[1],rd=candidates[2],screw=candidates[3];
  function exclude(c,reason){c.status='excluded';c.exclusions.push(reason);}
  if(site.largeRigAccess===false)exclude(rc,'Не подтверждён доступ принятой крупной забивной установки; этот стандартный ЖБ-сценарий исключён из текущего сравнения.');
  if(site.vibrationSensitive===true){exclude(rc,'Обычная забивка ЖБ-сваи не принята при указанной чувствительности к вибрации.');rr.conditions.push('Забивка RR допустима только после отдельной оценки вибрации; низкое воздействие не предполагается автоматически.');}
  if(site.boulders===true)rr.conditions.push('Нужны проверка проходимости и контроль отклонений в валунных слоях.');
  if(site.largeRigAccess===false)rd.conditions.push('Подтвердить наличие и доступ подходящей буровой установки; компактная установка не назначена автоматически.');
  if(site.boulders===true||profile==='shallow-bedrock')exclude(screw,'Обычный винтовой сценарий не принят при валунах/близкой скале; специальное решение требует отдельного проекта.');
  else if(profile!=='unknown'&&(profile!=='dense-granular'||site.geotechnicalVerified!==true))exclude(screw,'В этой модели винтовой вариант допускается к сравнению только при подтверждённом плотном зернистом профиле.');
  screw.conditions.push('Нет подтверждённого испытания конкретной сваи на этом участке: одобрение и сопротивление не выдаются.');
  if(profile==='unknown')for(const c of candidates)c.conditions.push('Профиль грунта неизвестен; длину и несущий слой нельзя получить из названия города или типа сваи.');
  if(site.geotechnicalVerified===true)for(const c of candidates)c.conditions.push('Флаг geotechnicalVerified не заменяет параметры слоёв, расчётное сопротивление или протокол испытаний.');
  let selected=rd,reason='При неизвестных исходных данных RD выбран только как сценарий для дальнейшей проверки; это не оптимум и не выбор к строительству.';
  if(site.boulders===true||site.vibrationSensitive===true||profile==='shallow-bedrock')reason='Для дальнейшей проработки принят буровой RD из-за препятствий, близкой скалы или чувствительности к вибрации; условия монтажа ещё проверяются.';
  else if(profile==='soft-over-bearing'&&site.largeRigAccess===true&&site.vibrationSensitive===false&&site.boulders===false){selected=rc;reason='Сценарий ЖБ-забивки рассмотрен при слабом слое над несущим, доступной установке и заявленном отсутствии вибрационных ограничений/валунов.';}
  else if(profile==='dense-granular'&&site.geotechnicalVerified===true&&site.largeRigAccess===false&&site.boulders===false){selected=screw;reason='Винтовой вариант выделен для проверки при заявленном подтверждённом плотном зернистом профиле и ограниченном доступе; испытания отсутствуют, одобрения нет.';}
  else if(['soft-over-bearing','dense-granular'].includes(profile)&&site.vibrationSensitive===false&&site.boulders===false){selected=rr;reason='RR выделен для проверки при заявленных проходимых слоях и допустимой забивке; диаметр и сопротивление не рассчитаны.';}
  if(byType.get(selected.type).status==='excluded'){selected=rd;reason='Остальные сценарии ограничены исходными условиями; RD оставлен для проверки доступности и устройства, без одобрения.';}
  const requiredInvestigations=['Инженерно-геологические выработки/зондирование до несущего слоя или скалы: мощности, прочность, валуны и уровень воды.','Расчёт сопротивления и осадок, группового эффекта, негативного трения, горизонтальных усилий и выдёргивания.','Морозное пучение, коррозионная агрессивность и требуемый срок службы.','Коммуникации, соседние фундаменты, вибрация и доступ/несущая способность рабочей площадки.','Подбор конкретной сваи, длины, монтажного критерия и программы испытаний/исполнительного контроля.','Расчёт узла свая–оголовок–ростверк, крепежа пакета и передачи горизонтальных сил.'];
  return {method:'preliminary-technology-screening',certified:false,maxDesignReaction,pileCount,demand:{maxDesignReaction,baselineMaxReaction,governingCase,pileCount,unit:'kN',source:'calculated-pile-reactions-and-explicit-snow-cases',note:'Максимум базовой схемы и всех явно рассчитанных снеговых случаев, включая анализ чувствительности. Полный набор геотехнических воздействий и нормативных сочетаний не подтверждён.'},site:{soilProfile:profile,...Object.fromEntries(flags.map(k=>[k,site[k]??null]))},capacityInput,candidates:project.site?.country==='RU'?[rc,screw]:candidates,provisionalChoice:project.site?.country==='RU'&&profile==='unknown'?{type:null,id:null,name:'Технология свай не выбрана',status:'unverified',certified:false,reason:'Без изысканий для участка не выбираются тип, длина и сопротивление сваи. Международные технологические сценарии ниже даны только для сравнения; это не подбор изделия для Ногинска.'}:{type:selected.type,id:selected.id,status:'conditional',certified:false,reason},requiredInvestigations,sources:project.site?.country==='RU'?[{id:'ru-piles',title:'СП24.13330.2021 · свайные фундаменты; полный расчёт в этом отборе не выполнен',url:'https://protect.gost.ru/sp/details/1e90a34c-6379-4236-8256-38be93e29766'},{id:'ru-investigations',title:'СП47.13330.2016 · инженерные изыскания',url:'https://protect.gost.ru/sp/details/43541aa6-a35d-430a-86ca-55600fb1b4ee'},foundationOptionSources[3]]:foundationOptionSources.map(s=>({...s})),assumptions:['Это качественный отбор технологии, не подбор длины, диаметра, сопротивления или стоимости.','Ни capacity проекта, ни флаг геологии, ни название населённого пункта не доказывают несущую способность.','При смене технологии фактическая схема свай, оголовков и распределение нагрузок требуют повторного проектирования.']};
}

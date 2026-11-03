/** Steady 1D diffusion/heat screening; not an annual moisture simulation. */
const EPS=1e-7,finite=Number.isFinite,sum=a=>a.reduce((s,v)=>s+v,0);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export const hygrothermalSources=[
  {title:'Tampere University · Indoor air design conditions and moisture performance',url:'https://research.tuni.fi/buildingphysics/analysis-method-for-moisture-performance/indoor-air-design-conditions/'},
  {title:'Finnish Ministry of the Environment · Decree782/2017, moisture performance of buildings',url:'https://www.edilex.fi/data/rakentamismaaraykset/YMa_20170782_en.pdf'},
  {title:'National Physical Laboratory · Magnus saturation pressure over water/ice and dew/frost point',url:'https://www.npl.co.uk/resources/q-a/dew-point-and-relative-humidity'},
];
export class HygrothermalInputError extends Error{constructor(field,message){super(message);this.name='HygrothermalInputError';this.errors=[{field,message}];}}
const invalid=(field,message)=>{throw new HygrothermalInputError(field,message);};
function positive(v,field,zero=false){if(!finite(v)||(zero?v<0:v<=0))invalid(field,`${field}: требуется ${zero?'неотрицательное':'положительное'} конечное число.`);return v;}
function air(q,field){if(!object(q))invalid(field,`${field}: задайте температуру°C и RH в%.`);if(!finite(q.temperature)||q.temperature< -65||q.temperature>60)invalid(field+'.temperature','Температура должна быть конечным числом в диапазоне−65…60°C применённой формулы.');if(!finite(q.rh)||q.rh<0||q.rh>100)invalid(field+'.rh','Относительная влажностьRH задаётся числом от0 до100%.');return {temperature:q.temperature,rh:q.rh};}
export function saturationPressure(temperature){if(!finite(temperature)||temperature< -65||temperature>60)invalid('temperature','Формула насыщения применима при−65…60°C.');const a=temperature<0?22.46:17.62,b=temperature<0?272.62:243.12;return 611.2*Math.exp(a*temperature/(b+temperature));}
function saturationDerivative(t){const a=t<0?22.46:17.62,b=t<0?272.62:243.12;return saturationPressure(t)*a*b/(b+t)**2;}
export function dewPointTemperature(temperature,rh){const q=air({temperature,rh},'air');if(q.rh===0)return null;const log=Math.log(saturationPressure(q.temperature))+Math.log(q.rh)-Math.log(100)-Math.log(611.2),a=log<0?22.46:17.62,b=log<0?272.62:243.12;return b*log/(a-log);}

function normalized(input){
  if(!object(input))invalid('input','Тепловлажностный расчёт ожидает объект параметров.');
  const indoor=air(input.indoor,'indoor'),outdoor=air(input.outdoor,'outdoor'),Rsi=positive(input.Rsi??.13,'Rsi',true),Rse=positive(input.Rse??.04,'Rse',true);
  if(!Array.isArray(input.layers)||input.layers.length<1||input.layers.length>100)invalid('layers','Задайте от1 до100 слоёв в порядке изнутри наружу.');
  const ids=new Set(),layers=input.layers.map((raw,i)=>{
    const field=`layers.${i}`;if(!object(raw))invalid(field,'Слой должен быть объектом.');const id=raw.id??`layer-${i+1}`;if(typeof id!=='string'||!id||ids.has(id))invalid(field+'.id','IDслоёв должны быть непустыми уникальными строками.');ids.add(id);
    if(raw.name!==undefined&&typeof raw.name!=='string')invalid(field+'.name','Имя слоя должно быть строкой.');
    const thickness=positive(raw.thickness,field+'.thickness'),lambda=positive(raw.lambda,field+'.lambda');
    if(raw.mu===undefined&&raw.sd===undefined)invalid(field+'.sd','Для каждого слоя задайтеmu (безразмерный) либоsd вметрах.');
    if(raw.mu!==undefined)positive(raw.mu,field+'.mu',true);if(raw.sd!==undefined)positive(raw.sd,field+'.sd',true);
    const sd=raw.sd??raw.mu*thickness,R=thickness/lambda;if(!finite(sd)||!finite(R))invalid(field,'Расчётное сопротивление слоя выходит за конечный числовой диапазон.');
    return {id,name:raw.name??id,thickness,lambda,mu:raw.mu??null,sd,R,sdSource:raw.sd!==undefined?'explicit_sd':'mu_times_thickness'};
  });
  const Rtotal=Rsi+Rse+sum(layers.map(l=>l.R)),totalSd=sum(layers.map(l=>l.sd));if(!finite(Rtotal)||Rtotal<=0||!finite(totalSd)||!finite(sum(layers.map(l=>l.thickness))))invalid('layers','Суммарные сопротивления и толщина должны быть конечными; тепловое сопротивление положительным.');
  const pi=saturationPressure(indoor.temperature)*indoor.rh/100,pe=saturationPressure(outdoor.temperature)*outdoor.rh/100;
  if(totalSd===0&&Math.abs(pi-pe)>EPS)invalid('layers.sd','Суммарноеsd равно0 при разных парциальных давлениях. Диффузионный профиль не определён; задайте сопротивления слоёв.');
  const hasFraming=input.framingFraction!==undefined||input.framingLayerIds!==undefined||input.framingLambda!==undefined;
  let framing=null;
  if(hasFraming){const fraction=input.framingFraction??.15,lambda=positive(input.framingLambda??.13,'framingLambda');if(!finite(fraction)||fraction<0||fraction>1)invalid('framingFraction','Доля каркаса должна быть числом от0 до1.');if(!Array.isArray(input.framingLayerIds)||!input.framingLayerIds.length||input.framingLayerIds.some(id=>typeof id!=='string'||!ids.has(id)))invalid('framingLayerIds','Задайте существующиеIDслоёв, в которых утеплитель заменяется древесиной.');framing={fraction,lambda,layerIds:[...new Set(input.framingLayerIds)]};}
  return {indoor,outdoor,Rsi,Rse,layers,Rtotal,totalSd,pi,pe,framing};
}

function evaluate(n){
  const {indoor,outdoor,Rsi,Rse,layers,Rtotal,totalSd,pi,pe}=n,deltaT=indoor.temperature-outdoor.temperature,heatFlux=deltaT/Rtotal,samples=[],interfaces=[];if(!finite(heatFlux)||!finite(1/Rtotal))invalid('layers.R','Слишком малое тепловое сопротивление выводит теплопередачу за конечный числовой диапазон.');
  let cumulativeR=Rsi,cumulativeSd=0,x=0;
  const state=(R,sd,position,extra={})=>{const temperature=Math.max(Math.min(indoor.temperature,outdoor.temperature),Math.min(Math.max(indoor.temperature,outdoor.temperature),indoor.temperature-deltaT*(R/Rtotal))),pVapor=totalSd>0?pi-(pi-pe)*Math.max(0,Math.min(1,sd/totalSd)):pi,pSat=saturationPressure(temperature),rh=100*pVapor/pSat;return {x:position,temperature,pVapor,pSat,rh,condensation:pVapor>pSat+EPS,excessPressure:pVapor-pSat,phase:temperature<0?'ice':'water',...extra};};
  interfaces.push(state(cumulativeR,0,0,{id:'internal-surface',name:'Внутренняя поверхность',kind:'surface'}));
  for(const [index,layer]of layers.entries()){
    const R0=cumulativeR,sd0=cumulativeSd,x0=x,t0=indoor.temperature-deltaT*(R0/Rtotal),dt=-deltaT*(layer.R/Rtotal),dp=totalSd>0?-(pi-pe)*(layer.sd/totalSd):0;
    const fractions=Array.from({length:33},(_,i)=>i/32),phaseBreak=dt!==0?-t0/dt:null,regions=[0,1];if(phaseBreak>EPS&&phaseBreak<1-EPS){fractions.push(phaseBreak);regions.splice(1,0,phaseBreak);}
    // Within each phase, p_free - p_sat(T) is concave. Find its interior
    // maximum as well as sampling: boundary-only checks can miss condensation.
    for(let i=1;i<regions.length;i++){
      const a=regions[i-1],b=regions[i],derivative=f=>dp-saturationDerivative(t0+dt*f)*dt,epsilon=Math.min(1e-8,(b-a)/100),da=derivative(a+epsilon),db=derivative(b-epsilon);
      if(da>0&&db<0){let lo=a+epsilon,hi=b-epsilon;for(let k=0;k<55;k++){const m=(lo+hi)/2;if(derivative(m)>0)lo=m;else hi=m;}fractions.push((lo+hi)/2);}
    }
    const unique=[...new Set(fractions)].sort((a,b)=>a-b);
    for(const f of unique)samples.push(state(R0+layer.R*f,sd0+layer.sd*f,x0+layer.thickness*f,{layerId:layer.id,layerName:layer.name,layerIndex:index,fraction:f,insideLayer:f>EPS&&f<1-EPS}));
    cumulativeR+=layer.R;cumulativeSd+=layer.sd;x+=layer.thickness;interfaces.push(state(cumulativeR,cumulativeSd,x,{id:`after-${layer.id}`,layerId:layer.id,name:`После слоя: ${layer.name}`,kind:'interface'}));
  }
  const worst=samples.reduce((a,b)=>!a||b.excessPressure>a.excessPressure?b:a,null),surface=interfaces[0];
  return {Rtotal,U:1/Rtotal,totalSd,totalThickness:x,heatFlux,internalSurfaceTemp:surface.temperature,externalSurfaceTemp:interfaces.at(-1).temperature,surfaceRH:surface.rh,interfaces,samples,worst,condensationLocations:samples.filter(s=>s.condensation),surfaceCondensation:surface.condensation,surfaceMouldRisk:surface.rh>80+EPS};
}

export function analyzeEnvelope(input){
  const n=normalized(input),base=evaluate(n),dewPointIndoor=dewPointTemperature(n.indoor.temperature,n.indoor.rh),checks=[],warnings=[];
  const check=(id,label,bad,value,limit,unit,note)=>checks.push({id,label,status:bad?'fail':'pass',value,limit,unit,note});
  check('envelope-surface-condensation','Конденсация на внутренней поверхности',base.surfaceCondensation,base.surfaceRH,100,'%', 'RH>100% указывает на риск поверхностной конденсации при заданной стационарной паре условий.');
  check('envelope-surface-rh80','RHповерхности: индикатор риска плесени',base.surfaceMouldRisk,base.surfaceRH,80,'%', 'Порог80% — предварительный индикатор; рост плесени зависит от материала, времени и температуры и здесь не моделируется.');
  check('envelope-interstitial-condensation','Пересечение профилей pᵥ и pₛₐₜ внутри конструкции',base.condensationLocations.length>0,base.worst?.excessPressure??0,0,'Па','Проверены интерфейсы,32подынтервала каждого слоя и внутренние экстремумы pᵥ−pₛₐₜ, включая переход через0°C. Положительное превышение — риск, не масса конденсата.');
  let thermalBridges=null,framingPath=null;
  if(n.framing){const woodLayers=n.layers.map(l=>n.framing.layerIds.includes(l.id)?{...l,lambda:n.framing.lambda,R:l.thickness/n.framing.lambda}:l),Rwood=n.Rsi+n.Rse+sum(woodLayers.map(l=>l.R));if(!finite(Rwood)||Rwood<=0)invalid('framingLambda','Сопротивление пути древесины должно быть конечным и положительным.');
    const T=n.indoor.temperature-(n.indoor.temperature-n.outdoor.temperature)*(n.Rsi/Rwood),surfaceRH=100*n.pi/saturationPressure(T),Uframing=1/Rwood,Ueffective=(1-n.framing.fraction)*base.U+n.framing.fraction*Uframing;
    if(!finite(Ueffective))invalid('framingLambda','Эффективный коэффициент теплопередачи вышел за числовой диапазон.');
    thermalBridges={method:'parallel_1d_paths',framingFraction:n.framing.fraction,framingLambda:n.framing.lambda,framingLayerIds:n.framing.layerIds,Rframing:Rwood,Uframing,Ueffective};
    framingPath={Rtotal:Rwood,U:Uframing,internalSurfaceTemp:T,surfaceRH,vaporModel:'not_evaluated',note:'Влажностное сопротивление древесины не задано. Оценены тепло иRHтолько внутренней поверхности; межслойная диффузия каркасного пути не подтверждена.'};
    if(n.framing.fraction>0){check('envelope-framing-surface-condensation','Внутренняя поверхность над каркасом: конденсация',surfaceRH>100+EPS,surfaceRH,100,'%','Оценка температур по параллельному1Dпути; двумерный угол/крепёж этим не моделируется.');check('envelope-framing-surface-rh80','Внутренняя поверхность над каркасом: RH80%',surfaceRH>80+EPS,surfaceRH,80,'%','Частный индикатор риска без расчёта времени роста плесени.');}
  }
  checks.push({id:'envelope-annual-moisture',label:'Годовой тепловлажностный режим',status:'unverified',note:'Нет климатического года, накопления/высыхания, сорбции, дождя, солнечного нагрева, капиллярного переноса и переменных свойств; расчёт не заменяетWUFI/EN15026.'},{id:'envelope-air-sealing',label:'Воздухопроницание и конвективная влага',status:'unverified',note:'Дефекты паро-/воздухозащиты и перенос влаги потоком воздуха не рассчитываются. sdне подтверждает герметичность.'},{id:'envelope-real-bridges',label:'Узлы и пространственные мостики холода',status:'unverified',note:'Примыкания, углы, стойки/ригелипересечения, стальные крепления и2D/3Dтемпературные поля не рассчитаны.'});
  if(base.condensationLocations.length)warnings.push('Свободный диффузионный профиль превышает насыщение; стационарный риск требует изменения слоёв или детального нестационарного анализа.');
  if(n.layers.some(l=>l.sdSource==='explicit_sd'&&l.mu!==null))warnings.push('Для слоёв, где заданы иmu, иsd, использовано явноеsd.');
  if(dewPointIndoor!==null&&dewPointIndoor< -65)warnings.push('Расчётная точка инея ниже−65°C: обратная формула экстраполирована за проверенный диапазон.');
  const assumptions=['Слои заданы изнутри наружу. Теплопроводность стационарная1D: R=Rsi+Σ(d/λ)+Rse, U=1/R. Точка росы не является отдельным неподвижным слоем конструкции.','Насыщение: Magnus поNPL, вода приT≥0°C и лёд приT<0°C. При отрицательной точке насыщения возвращается точка инея. Давления вПа, RHв%, Rвм²К/Вт, UвВт/(м²К).','RHграниц интерпретируется относительно тойже фазы насыщения. МетеоданныеRHотносительно воды приT<0°C требуют согласования перед вводом.','pᵥ линейно меняется по накопленномуsd=µd (либо явномуsd), без поверхностных сопротивлений паропереносу. СопротивленияRsi/Rse относятся только к теплопередаче.','pᵥ — свободный диффузионный профиль, не ограниченный насыщением. Его превышениеpₛₐₜ обозначает возможность конденсации/инея; количество влаги и последующее высыхание не вычисляются.','Пара21°C/40% — только заданный режим. Tampereрекомендует21°C для обычных помещений, но расчётная влажность выбирается по влаговой нагрузке и наружному климату, а не автоматически40% весьгод.','Порог поверхностногоRH80% не подтверждает биологическое отсутствие плесени. Время, чувствительность материалов и годовая история неизвестны.','Uэффективное с долей каркаса — сумма проводимостей двух независимых1Dпутей. Основные Rtotal/U и межслойные интерфейсы относятся к однородному полю; влажностное сопротивление древесины не подменяется сопротивлением утеплителя.','screen_pass означает лишь отсутствие выбранных рисков в этой стационарной постановке. Это не сертификация конструкции, полная проверкаENISO13788/EN15026 или подтверждение финского влагозащитного требования.'];
  return {...base,dewPointIndoor,dewPointKind:dewPointIndoor===null?'none':dewPointIndoor<0?'frost':'dew',thermalBridges,framingPath,Ueffective:thermalBridges?.Ueffective??base.U,checks,warnings,assumptions,sources:input.country==='RU'?[hygrothermalSources[2],{title:'СП50.13330.2024 · область применения и требования тепловой защиты; полный нормативный расчёт не реализован',url:'https://protect.gost.ru/sp/details/5081dae9-9ee9-455f-80e8-d093d495361c'}]:hygrothermalSources,status:checks.some(c=>c.status==='fail')?'risk':'screen_pass',certified:false,method:'steady_1d_diffusion_screen',boundaryConditions:{indoor:n.indoor,outdoor:n.outdoor,Rsi:n.Rsi,Rse:n.Rse},layers:n.layers};
}

import {parseSection} from './catalog.js';
import {fabricationToPrintHTML} from './fabrication-print.js';

export const STOCK_LENGTH=6;
export const DEFAULT_KERF_MM=3;
const EPS=1e-8;
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const clean=n=>Math.abs(n)<EPS?0:n;
const fmt=(n,d=3)=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:d});
const compare=(a,b)=>b.length-a.length||a.id.localeCompare(b.id,'en');

function randomGenerator(seed){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};
}

function greedy(order,capacity,mode='best'){
  const bins=[];
  for(const piece of order){
    let index=-1,left=Infinity;
    for(let i=0;i<bins.length;i++){
      const remaining=capacity-bins[i].load-piece.demand;
      if(remaining>=-EPS&&(mode==='first'||remaining<left-EPS)){
        index=i;left=remaining;if(mode==='first')break;
      }
    }
    if(index<0){bins.push({load:piece.demand,pieces:[piece]});}
    else{bins[index].pieces.push(piece);bins[index].load+=piece.demand;}
  }
  return bins;
}

// A feasible evacuation of one bin improves board count without changing cuts.
function evacuate(input,capacity){
  let bins=input.map(b=>({load:b.load,pieces:[...b.pieces]}));
  let changed=true;
  while(changed&&bins.length>1){
    changed=false;
    const candidates=bins.map((b,i)=>({i,load:b.load})).sort((a,b)=>a.load-b.load||a.i-b.i);
    for(const candidate of candidates){
      const remaining=bins.filter((_,i)=>i!==candidate.i).map(b=>({load:b.load,pieces:[...b.pieces]}));
      let feasible=true;
      for(const piece of [...bins[candidate.i].pieces].sort(compare)){
        let best=-1,slack=Infinity;
        for(let i=0;i<remaining.length;i++){
          const available=capacity-remaining[i].load-piece.demand;
          if(available>=-EPS&&available<slack-EPS){best=i;slack=available;}
        }
        if(best<0){feasible=false;break;}
        remaining[best].load+=piece.demand;remaining[best].pieces.push(piece);
      }
      if(feasible){bins=remaining;changed=true;break;}
    }
  }
  return bins;
}

function layoutScore(bins){
  // Equal board count: concentrate unused capacity in a larger reusable tail.
  return sum(bins.map(b=>b.load*b.load));
}

function exactFit(pieces,count,capacity,budget){
  const loads=Array(count).fill(0),bins=Array.from({length:count},()=>[]);
  let nodes=0,aborted=false;
  const tail=Array(pieces.length+1).fill(0);
  for(let i=pieces.length-1;i>=0;i--)tail[i]=tail[i+1]+pieces[i].demand;
  function visit(index){
    if(++nodes>budget){aborted=true;return false;}
    if(index===pieces.length)return true;
    if(tail[index]>count*capacity-sum(loads)+EPS)return false;
    const p=pieces[index];
    const order=loads.map((load,i)=>({load,i})).sort((a,b)=>b.load-a.load||a.i-b.i);
    const seen=[];
    for(const {load,i} of order){
      if(load+p.demand>capacity+EPS||seen.some(v=>Math.abs(v-load)<EPS))continue;
      seen.push(load);loads[i]+=p.demand;bins[i].push(p);
      if(visit(index+1))return true;
      loads[i]-=p.demand;bins[i].pop();
      if(aborted)return false;
      if(load<EPS)break; // Empty bins are interchangeable.
    }
    return false;
  }
  const found=visit(0);
  return {found,aborted,nodes,bins:found?bins.filter(b=>b.length).map((p,i)=>({pieces:[...p],load:loads[i]})):null};
}

function packGroup(pieces,kerf){
  const capacity=STOCK_LENGTH+kerf;
  const sorted=pieces.map(p=>({...p,demand:p.length+kerf})).sort(compare);
  const demand=sum(sorted.map(p=>p.demand));
  let lowerBound=Math.max(1,Math.ceil((demand-EPS)/capacity));
  // Cardinality bounds strengthen the volume bound. A piece > C−t cannot
  // share a bin with any piece > t; the remaining >t pieces fit at most k
  // per bin for t=C/(k+1). This can prove long beam groups immediately.
  for(let k=1;k<=Math.min(12,sorted.length);k++){
    const threshold=capacity/(k+1);
    const high=sorted.filter(p=>p.demand>capacity-threshold+EPS).length;
    const middle=sorted.filter(p=>p.demand>threshold+EPS&&p.demand<=capacity-threshold+EPS).length;
    lowerBound=Math.max(lowerBound,high+Math.ceil(middle/k));
  }
  let best=greedy(sorted,capacity),bestScore=layoutScore(best);
  const random=randomGenerator(921731+pieces.length);
  let attempts=1;
  // Deterministic multistart: descending, first-fit and gently perturbed orders.
  for(let iteration=0;iteration<32&&best.length>lowerBound;iteration++){
    const order=iteration===0?sorted:[...sorted].map(p=>({p,key:p.length*(.82+.36*random())})).sort((a,b)=>b.key-a.key||a.p.id.localeCompare(b.p.id)).map(a=>a.p);
    const candidate=evacuate(greedy(order,capacity,iteration%3===0?'first':'best'),capacity);
    const score=layoutScore(candidate);attempts++;
    if(candidate.length<best.length||(candidate.length===best.length&&score>bestScore+EPS)){best=candidate;bestScore=score;}
  }
  best=evacuate(best,capacity);
  let optimal=best.length===lowerBound,proof=optimal?'lower-bound':'not-proved',nodes=0,searchComplete=false;
  if(!optimal&&pieces.length<=20){
    let provenLower=lowerBound;
    for(let target=lowerBound;target<best.length;target++){
      const exact=exactFit(sorted,target,capacity,250000);nodes+=exact.nodes;
      if(exact.found){best=exact.bins;optimal=true;proof='exact-search';searchComplete=true;break;}
      if(exact.aborted){proof='search-limit';break;}
      provenLower=target+1;
    }
    if(provenLower===best.length){optimal=true;proof='exact-search';searchComplete=true;}
  }
  // Pieces are listed in one clear deterministic saw order on every stock.
  best=best.map(bin=>({...bin,pieces:[...bin.pieces].sort(compare)}));
  best.sort((a,b)=>b.load-a.load||a.pieces[0].id.localeCompare(b.pieces[0].id));
  return {bins:best,lowerBound,optimal,proof,attempts,nodes,searchComplete};
}

/**
 * 1D cutting stock. Every purchased board is exactly 6 m. Kerf is in mm in the
 * project and applied ONLY between consecutive pieces, as an explicit model.
 * Cut lengths are full blanks, not net installed length or reduced joint mass.
 */
export function calculateCutting(project={},result={}){
  const input=Array.isArray(result)?result:result.timber?.instances??result.instances??[];
  const kerfMM=Number.isFinite(project.cutting?.kerf)&&project.cutting.kerf>=0&&project.cutting.kerf<=30?project.cutting.kerf:DEFAULT_KERF_MM;
  const kerf=kerfMM/1000,groupMap=new Map(),overlength=[],invalid=[];
  const ids=new Map();
  for(let i=0;i<input.length;i++){
    const board=input[i],parsed=parseSection(board.section??'');
    const b=board.b??parsed?.b,h=board.h??parsed?.h;
    const length=board.cutLength??board.cuttingLength??board.length;
    let id=String(board.id??`D${String(i+1).padStart(4,'0')}`);
    const occur=ids.get(id)??0;ids.set(id,occur+1);if(occur)id+=`-${occur+1}`;
    const dims=Number.isFinite(b)&&Number.isFinite(h)?[Math.min(b,h),Math.max(b,h)]:null;
    const section=dims?`${Number(dims[0].toFixed(3))}x${Number(dims[1].toFixed(3))}`:'unknown';
    const piece={id,sourceId:board.id??id,name:board.name??'Деталь',length,
      b:dims?.[0],h:dims?.[1],section,angle:board.angle??0,
      endStart:board.cutStart??null,endEnd:board.cutEnd??null,
      sourceStart:board.start,sourceEnd:board.end,source:board,
      lengthBasis:board.cutLength!=null||board.cuttingLength!=null?'blank':'axis'};
    if(!dims||dims[0]<=0||dims[1]<=0||!Number.isFinite(length)||length<=0){invalid.push({...piece,reason:'Нужны положительные сечение и длина детали.'});continue;}
    if(length>STOCK_LENGTH+EPS){overlength.push({...piece,reason:'Цельная заготовка длиннее 6 м. Нужна другая конструкция или рассчитанный стык; автоматически не разрезана.'});continue;}
    const group=groupMap.get(section)??{section,b:dims[0],h:dims[1],pieces:[]};
    group.pieces.push(piece);groupMap.set(section,group);
  }
  const stocks=[],groups=[];
  for(const group of [...groupMap.values()].sort((a,b)=>a.b-b.b||a.h-b.h)){
    const packed=packGroup(group.pieces,kerf),area=group.b*group.h/1e6;
    const groupStocks=[];
    for(let i=0;i<packed.bins.length;i++){
      let cursor=0;
      const pieces=packed.bins[i].pieces.map((piece,index)=>{
        if(index>0)cursor+=kerf;
        const start=cursor,end=start+piece.length;cursor=end;
        return {...piece,cutStart:start,cutEnd:end,start,end};
      });
      const used=sum(pieces.map(p=>p.length)),kerfWaste=Math.max(0,pieces.length-1)*kerf;
      const remainder=Math.max(0,clean(STOCK_LENGTH-used-kerfWaste));
      const stock={id:`S${String(stocks.length+1).padStart(4,'0')}`,section:group.section,b:group.b,h:group.h,length:STOCK_LENGTH,pieces,
        used,consumed:used+kerfWaste,kerfWaste,remainder,reusable:remainder>=.3-EPS,
        purchasedVolume:area*STOCK_LENGTH,usedVolume:area*used,kerfVolume:area*kerfWaste,remainderVolume:area*remainder};
      stocks.push(stock);groupStocks.push(stock);
    }
    const purchasedVolume=groupStocks.length*STOCK_LENGTH*area,usedVolume=sum(group.pieces.map(p=>p.length))*area;
    groups.push({section:group.section,b:group.b,h:group.h,pieceCount:group.pieces.length,boards:groupStocks.length,
      stocks:groupStocks,usedVolume,purchasedVolume,wasteVolume:clean(purchasedVolume-usedVolume),
      lowerBound:packed.lowerBound,optimal:packed.optimal,proof:packed.proof,attempts:packed.attempts,searchNodes:packed.nodes});
  }
  const purchasedVolume=sum(stocks.map(s=>s.purchasedVolume)),usedVolume=sum(stocks.map(s=>s.usedVolume));
  const kerfLoss=sum(stocks.map(s=>s.kerfWaste));
  const knownJointIds=new Set();let unnamedJointEnds=0;
  for(const stock of stocks)for(const piece of stock.pieces)for(const end of [piece.endStart,piece.endEnd]){
    if(end&&(end.jointId!=null||end.spliceId!=null||(['halfLap','half-lap','scarf','fishplate'].includes(end.scheme)&&end.lapLength>0))){
      const jointId=end.jointId??end.spliceId;
      if(jointId!=null)knownJointIds.add(String(jointId));else unnamedJointEnds++;
    }
  }
  const explicitSplices=Array.isArray(result.splices)?result.splices:null;
  const summary={boards:stocks.length,pieces:sum(stocks.map(s=>s.pieces.length)),purchasedVolume,usedVolume,
    wasteVolume:clean(purchasedVolume-usedVolume),wastePercent:purchasedVolume?(purchasedVolume-usedVolume)/purchasedVolume*100:0,
    reusableLength:sum(stocks.filter(s=>s.reusable).map(s=>s.remainder)),
    reusableVolume:sum(stocks.filter(s=>s.reusable).map(s=>s.remainderVolume)),
    unusableLength:sum(stocks.filter(s=>!s.reusable).map(s=>s.remainder)),
    kerfLoss,kerfVolume:sum(stocks.map(s=>s.kerfVolume)),lowerBound:sum(groups.map(g=>g.lowerBound)),
    optimal:overlength.length===0&&invalid.length===0&&groups.every(g=>g.optimal),
    complete:overlength.length===0&&invalid.length===0,
    spliceCount:explicitSplices?new Set(explicitSplices.map((s,i)=>s.id??`splice-${i}`)).size:knownJointIds.size+Math.ceil(unnamedJointEnds/2),spliceCountExact:explicitSplices!==null||unnamedJointEnds===0,
    overlengthCount:overlength.length,invalidCount:invalid.length};
  return {stockLength:STOCK_LENGTH,kerfMM,kerf,stocks,groups,overlength,invalid,summary,
    assumptions:[
      'Закупка — доски ровно 6 м. Сечения группируются по паре размеров; поворот сечения в модели не создаёт другой сортимент.',
      `Ширина пропила ${fmt(kerfMM)} мм учтена только между соседними деталями. Торцовка концов и дополнительный пропил перед хвостовым остатком в эту модель не включены.`,
      input.some(p=>p.cutLength==null&&p.cuttingLength==null)?'Для части деталей доступны только длины по осям. Припуски на запил и торцовку не добавляются; карта требует уточнения перед производством.':'Используются полные длины заготовок cutLength, включая заданные конструктором припуски и нахлёсты.',
      'Геометрия торцевых соединений показана по исходной модели. Их несущая способность, крепёж и возможность исполнения станком не проверены.',
      'Остатки от 0,30 м показаны как потенциально пригодные; в текущую раскладку повторно не включаются.',
      'Оптимальность относится только к числу шестиметровых досок в данной одномерной модели пропила. Совпадение с нижней границей или полный точный поиск доказывают этот результат; остальные раскладки — найденные, без доказательства глобального минимума.',
    ]};
}

export function formatEndCut(end){
  if(!end||!end.scheme||['none','square','butt'].includes(end.scheme))return 'Прямой торец';
  const names={halfLap:'Вполдерева','half-lap':'Вполдерева',scarf:'Косой стык',fishplate:'С накладками',miter:'Ус'};
  const parts=[names[end.scheme]??end.scheme];
  if(Number.isFinite(end.angle))parts.push(`${fmt(end.angle,1)}°`);
  if(Number.isFinite(end.lapLength)&&end.lapLength>0)parts.push(`нахлёст ${fmt(end.lapLength*1000,0)} мм`);
  if(Number.isFinite(end.recessDepth)&&end.recessDepth>0)parts.push(`выборка ${fmt(end.recessDepth*1000,0)} мм`);
  if(end.lapSide==='top')parts.push('выборка сверху');
  if(end.lapSide==='bottom')parts.push('выборка снизу');
  if(end.jointId!=null)parts.push(`стык ${end.jointId}`);
  return parts.join(' · ');
}

const csvCell=value=>{
  let text=String(value??'');
  if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};

export function cuttingRowsToCSV(cutting,projectName='Проект КАРКАС'){
  const rows=[['КАРКАС · полная карта раскроя',projectName],['Сортимент, м',6],['Пропил между деталями, мм',cutting.kerfMM],
    ['Доска','Сечение, мм','Деталь','Название','Длина заготовки, м','От начала доски, м','До конца детали, м','Начальный торец','Конечный торец','Угол детали, °','Остаток доски, м','Пропилы доски, м']];
  for(const stock of cutting.stocks)for(const piece of stock.pieces)rows.push([stock.id,stock.section,piece.id,piece.name,piece.length,piece.cutStart,piece.cutEnd,formatEndCut(piece.endStart),formatEndCut(piece.endEnd),piece.angle,stock.remainder,stock.kerfWaste]);
  rows.push([],['Досок 6 м, шт.',cutting.summary.boards],['К закупке, м³',cutting.summary.purchasedVolume],['Длина пропилов, м',cutting.summary.kerfLoss],['Остатки от 0,3 м, м',cutting.summary.reusableLength],['Продольные стыки, шт.',cutting.summary.spliceCount],
    ['Оптимальность',cutting.summary.optimal?'Число досок доказано минимальным в принятой модели':'Найденная раскладка; оптимальность не доказана']);
  if(cutting.overlength.length){rows.push([],['НЕ РАЗМЕЩЕНЫ: длиннее 6 м']);for(const p of cutting.overlength)rows.push([p.id,p.section,p.length,p.reason]);}
  if(cutting.invalid.length){rows.push([],['ОШИБКИ ДАННЫХ']);for(const p of cutting.invalid)rows.push([p.id,p.reason]);}
  rows.push([],['ДОПУЩЕНИЯ']);for(const note of cutting.assumptions)rows.push([note]);
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
}

const escapeHTML=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function cuttingToPrintHTML(cutting,projectName='Проект КАРКАС',fabrication=null){
  if(fabrication)return fabricationToPrintHTML(cutting,projectName,fabrication,formatEndCut);
  const colors=['#d3e2b5','#d9cead','#c6d9cc','#e4d0ad','#bcccdf','#d5c5d7'];
  const map=cutting.stocks.map(stock=>{
    const segments=stock.pieces.map((p,i)=>`<div class="piece" style="left:${p.cutStart/6*100}%;width:${p.length/6*100}%;background:${colors[i%colors.length]}" title="${escapeHTML(p.id)}"><b>${escapeHTML(p.id)}</b><span>${fmt(p.length,3)} м</span></div>`).join('');
    const tail=stock.remainder>0?`<div class="tail" style="left:${stock.consumed/6*100}%;width:${stock.remainder/6*100}%">${fmt(stock.remainder,3)}</div>`:'';
    return `<section class="stock"><h2>${escapeHTML(stock.id)} <small>${escapeHTML(stock.section.replace('x',' × '))} мм · доска 6 м</small></h2><div class="bar">${segments}${tail}</div><p>Пропилы: ${fmt(stock.kerfWaste*1000,0)} мм · остаток: ${fmt(stock.remainder,3)} м${stock.reusable?' · потенциально пригоден от 0,30 м':''}</p><table><thead><tr><th>Деталь</th><th>Длина, м</th><th>Позиция, м</th><th>Начальный торец</th><th>Конечный торец</th></tr></thead><tbody>${stock.pieces.map(p=>`<tr><td><b>${escapeHTML(p.id)}</b><br>${escapeHTML(p.name)}</td><td>${fmt(p.length,3)}</td><td>${fmt(p.cutStart,3)}–${fmt(p.cutEnd,3)}</td><td>${escapeHTML(formatEndCut(p.endStart))}</td><td>${escapeHTML(formatEndCut(p.endEnd))}</td></tr>`).join('')}</tbody></table></section>`;
  }).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHTML(projectName)} · полная карта раскроя</title><style>body{font:12px Arial,sans-serif;color:#27352d;margin:30px}h1{font-size:26px;margin:0 0 8px}h2{font-size:15px;margin:0 0 10px}h2 small{font-size:12px;font-weight:normal;color:#718269}.intro{padding:16px;background:#f0f4e8;margin:20px 0;line-height:1.7}.stock{break-inside:avoid;border:1px solid #cad5be;padding:16px;margin:0 0 18px;border-radius:4px}.stock p{font-size:10px;color:#76876d}.bar{position:relative;height:44px;border:1px solid #9cac8d;background:#fff;overflow:hidden}.piece{position:absolute;top:0;bottom:0;border-right:1px solid #718269;display:flex;flex-direction:column;justify-content:center;text-align:center;overflow:hidden;box-sizing:border-box;font-size:10px}.piece span{font-size:9px;margin-top:4px}.tail{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(45deg,#eef0e9,#eef0e9 4px,#dce4d4 4px,#dce4d4 5px);font-size:9px;text-align:center;padding-top:16px;box-sizing:border-box}table{width:100%;border-collapse:collapse;font-size:10px}td,th{padding:7px 6px;border-bottom:1px solid #e1e8da;text-align:left;vertical-align:top}th{font-size:9px;color:#728267}.notes{font-size:10px;line-height:1.7}.warning{padding:12px;border:1px solid #bf8a68;color:#9c6541;margin-bottom:16px}.print{padding:10px 16px;border:0;background:#31452d;color:white;cursor:pointer}@media print{body{margin:0}.print{display:none}@page{size:A4;margin:15mm}}</style></head><body><button class="print" onclick="window.print()">Печать / Сохранить PDF</button><h1 style="margin-top:20px">Полная карта раскроя</h1><p>${escapeHTML(projectName)}</p><div class="intro">Доски: <b>${cutting.summary.boards} шт. × 6 м</b> · объём закупки: <b>${fmt(cutting.summary.purchasedVolume,3)} м³</b> · детали: ${cutting.summary.pieces} шт.<br>Пропил между деталями: ${fmt(cutting.kerfMM)} мм · остатки от 0,30 м: ${fmt(cutting.summary.reusableLength,3)} м · продольные стыки: ${cutting.summary.spliceCount}${cutting.summary.spliceCountExact?'':' (по парам концов)'}<br>${cutting.summary.optimal?'Число досок доказано минимальным в принятой модели.':'Найденная раскладка; оптимальность не доказана.'}</div>${cutting.overlength.length||cutting.invalid.length?`<div class="warning"><b>Не размещено деталей: ${cutting.overlength.length+cutting.invalid.length}.</b><br>${[...cutting.overlength,...cutting.invalid].map(p=>`${escapeHTML(p.id)} · ${fmt(p.length??0)} м · ${escapeHTML(p.reason)}`).join('<br>')}</div>`:''}${map}<section class="notes"><h2>Допущения карты</h2>${cutting.assumptions.map(n=>`<p>${escapeHTML(n)}</p>`).join('')}</section></body></html>`;
}

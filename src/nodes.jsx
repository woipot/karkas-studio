import React, {useId} from 'react';

// These names identify the illustrative configurations below, not a certified
// regional construction detail. All dimensions and coordinates are millimetres.
export const cornerTypes = [
  {id:'california2',label:'Открытый угол · 2 стойки',boards:2,
    description:'Условная схема California: две стойки образуют Г-образный пакет. Опора внутренней обшивки решается отдельно.'},
  {id:'three3',label:'П-образный угол · 3 стойки',boards:3,
    description:'Три полноразмерные стойки, открытая внутрь полость. Пакет длиннее по северной стене; это показанный вариант, не универсальный типовой узел.'},
  {id:'closed4',label:'Закрытый угол · 4 стойки',boards:4,
    description:'Четыре полноразмерные стойки окружают полость. Утеплитель устанавливается до закрытия пакета.'},
];

const aliases = {california:'california2',open2:'california2','three-stud':'three3',three:'three3','four-stud':'closed4',four:'closed4'};
const resolveType = type => aliases[type] || type || 'california2';

/**
 * Exact non-overlapping plan rectangles for the NW corner.
 * Origin: external NW corner; +x east along north wall; +y south.
 * North wall occupies y=[0,h]. West wall returns from y=h, x=[0,h].
 * Every rectangle is a full b×h stud section, rotated if necessary.
 * Adjacent rectangles touch only along their boundaries. No connectors,
 * sheathing, gaps for tolerances or load transfer checks are represented.
 */
export function getCornerBoards(type='california2', b=45, h=150) {
  const id=resolveType(type);
  if(!cornerTypes.some(t=>t.id===id)) throw new RangeError('Неизвестная схема угла');
  if(!Number.isFinite(b)||!Number.isFinite(h)||b<=0||h<b||(id==='closed4'&&h<2*b)) {
    throw new RangeError('Нужно h ≥ b; для закрытого угла h ≥ 2b');
  }
  const boards=[
    {id:'A',x:0,y:0,width:b,depth:h},
    {id:'B',x:b,y:0,width:h,depth:b},
  ];
  if(id!=='california2') boards.push({id:'C',x:b+h,y:0,width:b,depth:h});
  if(id==='closed4') boards.push({id:'D',x:b,y:h-b,width:h,depth:b});
  return boards;
}

const fmt = v => Number(v).toLocaleString('ru-RU',{maximumFractionDigits:1});

function Dimension({x1,y1,x2,y2,label,vertical=false}) {
  const color='#7a866e';
  return <g fill="none" stroke={color} strokeWidth=".8">
    <path d={`M${x1} ${y1}L${x2} ${y2}M${x1-3} ${y1+3}L${x1+3} ${y1-3}M${x2-3} ${y2+3}L${x2+3} ${y2-3}`}/>
    <text x={(x1+x2)/2+(vertical?-9:0)} y={(y1+y2)/2+(vertical?0:-6)}
      transform={vertical?`rotate(-90 ${(x1+x2)/2-9} ${(y1+y2)/2})`:undefined}
      textAnchor="middle" fill={color} stroke="none" fontSize="10">{label}</text>
  </g>;
}

export default function CornerDiagram({type='california2',b=45,h=150}) {
  const uid=useId().replace(/:/g,'');
  const id=resolveType(type);
  let boards;
  try { boards=getCornerBoards(id,b,h); }
  catch(error) { return <div role="status" style={{padding:12,color:'#a75d43',fontSize:12}}>{error.message}</div>; }
  const info=cornerTypes.find(t=>t.id===id);
  const extent=Math.max(...boards.map(a=>a.x+a.width));
  const maxX=extent+80,maxY=h+110;
  const scale=Math.min(250/maxX,164/maxY);
  const ox=64,oy=47;
  const px=x=>ox+x*scale,py=y=>oy+y*scale;
  const boardStyle={fill:`url(#wood-${uid})`,stroke:'#9c7748',strokeWidth:1.4};
  return <figure className="corner-diagram" style={{margin:0}}>
    <svg viewBox="0 0 350 245" role="img" aria-labelledby={`corner-title-${uid}`} style={{display:'block',width:'100%',height:'auto',background:'#f7f8f3',border:'1px solid #e2e6da',borderRadius:8,fontFamily:'inherit'}}>
      <title id={`corner-title-${uid}`}>{info.label}. Вид сверху. Сечение стоек {fmt(b)} на {fmt(h)} миллиметров. Условная геометрия без расчёта крепежа.</title>
      <defs>
        <pattern id={`wood-${uid}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="8" height="8" fill="#ead8b3"/>
          <path d="M0 0V8" stroke="#d4b987" strokeWidth=".7"/>
        </pattern>
        <pattern id={`insulation-${uid}`} width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="#edf1e5"/>
          <circle cx="2" cy="2" r=".65" fill="#c6d0b9"/>
        </pattern>
      </defs>
      <text x="15" y="18" fontSize="9" letterSpacing="1.2" fill="#829073">ВИД СВЕРХУ · СЗ</text>
      <text x="335" y="18" textAnchor="end" fontSize="9" fill="#829073">мм</text>
      <path d={`M${px(0)} ${py(maxY)}V${py(0)}H${px(maxX)}M${px(h)} ${py(maxY)}V${py(h)}H${px(maxX)}`}
        fill="none" stroke="#c4cdb9" strokeWidth="1"/>
      <path d={`M${px(0)} ${py(0)}H${px(maxX)}V${py(h)}H${px(h)}V${py(maxY)}H${px(0)}Z`}
        fill={`url(#insulation-${uid})`} stroke="none"/>
      <path d={`M${px(maxX-6)} ${py(0)}V${py(h)}M${px(0)} ${py(maxY-6)}H${px(h)}`}
        stroke="#c0cab5" strokeWidth="1" strokeDasharray="3 3" fill="none"/>
      {boards.map((board,index)=><g key={board.id}>
        <rect x={px(board.x)} y={py(board.y)} width={board.width*scale} height={board.depth*scale} {...boardStyle}/>
        <text x={px(board.x+board.width/2)} y={py(board.y+board.depth/2)+3} textAnchor="middle" fontSize="10" fontWeight="600" fill="#74552f">{index+1}</text>
      </g>)}
      <path d={`M${px(0)} ${py(0)-3}V30M${px(extent)} ${py(0)-3}V30M${px(0)-3} ${py(0)}H43M${px(0)-3} ${py(h)}H43`}
        stroke="#bbc5af" strokeWidth=".7" fill="none"/>
      <Dimension x1={px(0)} y1={32} x2={px(extent)} y2={32} label={`${fmt(extent)} мм`}/>
      <Dimension x1={45} y1={py(0)} x2={45} y2={py(h)} label={`${fmt(h)} мм`} vertical/>
      <text x={px(extent)+13} y={py(h*.56)} fontSize="9" fill="#89947e">С</text>
      <text x={px(h*.5)} y={py(maxY)+14} textAnchor="middle" fontSize="9" fill="#89947e">З</text>
      <path d={`M${px(h)+12} ${py(h)+12}h22m-5-3 5 3-5 3`} stroke="#9da98f" strokeWidth=".8" fill="none"/>
      <text x={px(h)+12} y={py(h)+28} fontSize="9" fill="#89947e">Внутри</text>
      <text x="15" y="232" fontSize="10" fill="#64715a">{boards.length} стойки · {fmt(b)} × {fmt(h)} мм · без крепежа</text>
    </svg>
    <figcaption style={{fontSize:11,lineHeight:1.55,color:'#7a866e',marginTop:8}}>{info.description} Сечения соприкасаются гранями; допуски, крепёж и передача усилий не рассчитаны.</figcaption>
  </figure>;
}

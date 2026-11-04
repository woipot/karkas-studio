import React from 'react';
import './appearance-view.css';

const formatArea=value=>typeof value==='number'?value.toLocaleString('ru-RU',{maximumFractionDigits:2})+' м²':'—';

export default function AppearanceView({report,design}){
  if(!design)return <section className="appearance-empty"><span className="engine-eyebrow">ВНЕШНИЙ ОБЛИК</span><h2>Эскиз пока недоступен</h2><p>Обновите страницу, чтобы загрузить архитектурный вариант.</p></section>;
  const engine=report?.engine??{};
  const matches=design.baseProjectId===engine.projectId&&design.baseRevision===engine.revision&&design.baseHash===engine.hash;
  if(!matches)return <section className="appearance-empty"><span className="engine-eyebrow">ВНЕШНИЙ ОБЛИК</span><h2>Эскиз относится к другой ревизии</h2><p>Архитектурный вариант подготовлен для R{design.baseRevision}. Для текущей планировки его нужно обновить.</p></section>;
  const imageUrl=typeof design.imageUrl==='string'&&design.imageUrl.startsWith('/appearance/')?design.imageUrl:null;
  const rooms=report.planning?.rooms??report.project?.roomSchedule??[];
  const bedroom=rooms.find(r=>r.id==='BED');
  const features=Array.isArray(design.features)?design.features.slice(0,3):[];
  const palette=Array.isArray(design.palette)?design.palette.slice(0,4):[];
  return <section className="appearance-view" aria-label="Архитектурный облик дома">
    <header className="appearance-heading">
      <div><div className="engine-eyebrow">ВНЕШНИЙ ОБЛИК · ВАРИАНТ 01</div><h2>{design.title}</h2><p>{design.subtitle}</p></div>
      <span className="appearance-badge">Архитектурный эскиз</span>
    </header>
    <div className="appearance-scene">
      <figure className="appearance-figure">
        {imageUrl?<a href={imageUrl} target="_blank" rel="noreferrer" aria-label="Открыть эскиз дома в полном размере"><img src={imageUrl} alt={design.imageAlt??design.title} width={design.imageWidth??1536} height={design.imageHeight??1024} decoding="async"/></a>:<div className="appearance-image-empty">Изображение недоступно</div>}
        <figcaption><span>Вид со стороны входа и спальни</span><span>Концепция фасада · ImageGen</span></figcaption>
      </figure>
      <aside className="appearance-materials" aria-label="Предлагаемая палитра фасада">
        <div className="engine-eyebrow">ПАЛИТРА И МАТЕРИАЛЫ</div><h3>Четыре спокойных тона</h3>
        <div className="appearance-swatches">{palette.map((item,index)=><div className="appearance-swatch" key={item.name??index}><span className="appearance-color" style={{backgroundColor:/^#[\da-f]{6}$/i.test(item.color??'')?item.color:'#ddd'}} aria-hidden="true"/><div><strong>{item.name}</strong><small>{item.material}</small></div></div>)}</div>
        <p className="appearance-reference">На основе вашей планировки R{engine.revision}</p>
        {imageUrl&&<div className="appearance-downloads"><a href={imageUrl} download="noginsk-60-chinese-v1.png">Скачать эскиз PNG ↓</a><a href={imageUrl} target="_blank" rel="noreferrer">Открыть в полном размере ↗</a></div>}
      </aside>
    </div>
    <dl className="appearance-facts"><div><dt>Коробка дома</dt><dd>{formatArea(report.summary?.platformArea)}</dd></div><div><dt>Этажность</dt><dd>{report.project.floors} этаж</dd></div><div><dt>Спальня</dt><dd>{formatArea(bedroom?.area)}</dd></div><div><dt>Веранда</dt><dd>{formatArea(report.summary?.annexArea)}</dd></div></dl>
    <div className="appearance-features">{features.map((item,index)=><article key={item.title??index}><span className="appearance-number">0{index+1}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
    <p className="appearance-scope">{design.scopeNote}</p>
  </section>;
}

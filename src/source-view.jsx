import React from 'react';
import './source-view.css';

export default function SourceView({report,source}){
  if(!source||source.projectId!==report.engine.projectId||source.hash!==report.engine.hash)return <div className="engine-empty">Описание переноса для этой ревизии отсутствует.</div>;
  return <section className="source-view" aria-label="Перенос исходного проекта">
    <div className="source-heading"><div><div className="engine-eyebrow">ОТ ЧЕРТЕЖА К МОДЕЛИ</div><h1>{source.title}</h1><p>{source.description}</p></div><a className="engine-button" href={source.pdfUrl} target="_blank" rel="noreferrer">Исходный КР · PDF ↗</a></div>
    <div className="source-facts">{source.facts.map(f=><article key={f.label}><span>{f.label}</span><strong>{f.value}</strong><small>{f.note}</small></article>)}</div>
    <div className="source-status" role="note"><strong>Реконструкция по чертежам</strong><p>{source.scopeNote}</p></div>
    <div className="source-comparison"><div><h2>Что перенесено</h2>{source.transferred.map((s,i)=><p key={i}><span>0{i+1}</span>{s}</p>)}</div><div><h2>Что требует сверки</h2>{source.differences.map((s,i)=><p key={i}><span>0{i+1}</span>{s}</p>)}</div></div>
    <div className="source-drawings">{source.sheets.map(sheet=><figure key={sheet.image}><a href={sheet.image} target="_blank" rel="noreferrer"><img src={sheet.image} alt={sheet.alt} loading="lazy"/></a><figcaption><strong>{sheet.title}</strong><span>{sheet.note}</span></figcaption></figure>)}</div>
    <details className="engine-method-details"><summary>Связь модели с исходным документом</summary><p>Проект MCP: {source.projectId} · ревизия {report.engine.revision}</p><p>Исходный PDF · SHA256: {source.sourceSha256}</p><p>Расчётные исходные данные · SHA256: {source.hash}</p></details>
  </section>;
}

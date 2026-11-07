const escape = (x) =>
  String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const fmt = (n, d = 3) =>
  Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—";
const place = (a) =>
  [
    a.level && `${a.level} этаж`,
    a.rimEdge && `ребро контура ${a.rimEdge}`,
    a.wallId,
    a.wallIds?.length ? a.wallIds.join(", ") : null,
    a.zoneId,
    a.beamId,
    a.voidId,
    a.objectId,
  ]
    .filter(Boolean)
    .join(" · ") ||
  a.name ||
  a.role ||
  "Каркас";
export function fabricationToPrintHTML(cutting, name, fabrication, endLabel) {
  const colors = ["#d3e2b5", "#d9cead", "#c6d9cc", "#e4d0ad", "#bcccdf", "#d5c5d7"],
    parts = new Map(fabrication.partGroups.map((p) => [p.id, p]));
  const patterns = fabrication.patternGroups
    .map((g) => {
      const segments = g.pieces
        .map(
          (p, i) =>
            `<div class="piece" style="left:${(p.start / 6) * 100}%;width:${(p.length / 6) * 100}%;background:${colors[i % colors.length]}"><b>${escape(p.partGroupId)}</b><small>${fmt(p.length)} м</small></div>`,
        )
        .join("");
      const consumed = g.consumed ?? 6 - g.remainder,
        tail =
          g.remainder > 0
            ? `<div class="tail" style="left:${(consumed / 6) * 100}%;width:${(g.remainder / 6) * 100}%">${fmt(g.remainder)}</div>`
            : "";
      return `<section class="card"><h2>${escape(g.id)} <span>${escape(g.section)} мм · 6 000 мм</span><strong>× ${g.count}</strong></h2><div class="bar">${segments}${tail}</div><p>Пропилы: ${fmt(g.kerfWaste * 1000, 1)} мм · остаток на доску: ${fmt(g.remainder)} м</p><table><thead><tr><th>Деталь</th><th>Длина, м</th><th>Начало, м</th><th>Конец, м</th><th>Торцы</th></tr></thead><tbody>${g.pieces
        .map((p) => {
          const part = parts.get(p.partGroupId);
          return `<tr><td>${escape(p.partGroupId)}</td><td>${fmt(p.length)}</td><td>${fmt(p.start)}</td><td>${fmt(p.end)}</td><td>${escape(endLabel(part?.geometry.cutStart))} / ${escape(endLabel(part?.geometry.cutEnd))}</td></tr>`;
        })
        .join(
          "",
        )}</tbody></table><details><summary>Заготовки этой схемы (${g.count})</summary><p class="ids">${g.stockIds.map(escape).join(", ")}</p></details></section>`;
    })
    .join("");
  const shapes = fabrication.partGroups
    .map(
      (g) =>
        `<section class="card part"><h2>${escape(g.id)} <span>${escape(g.section)} мм</span><strong>× ${g.count}</strong></h2><div class="part-shape"><span>${escape(endLabel(g.geometry.cutStart))}</span><b>${fmt(g.cutLength)} м</b><span>${escape(endLabel(g.geometry.cutEnd))}</span></div><p>Длина по оси ${fmt(g.axisLength)} м. Выборок: ${g.geometry.notches?.length ?? 0}. Точные локальные размеры и плоскости — в report.json.</p><table><thead><tr><th>Где используется</th><th>Количество</th></tr></thead><tbody>${g.applications.map((a) => `<tr><td>${escape(place(a))}<small>${escape(a.name ?? a.role)}</small></td><td>${a.count}</td></tr>`).join("")}</tbody></table><details><summary>Физические детали (${g.count})</summary><p class="ids">${g.physicalIds.map(escape).join(", ")}</p></details></section>`,
    )
    .join("");
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(name)} · групповой раскрой</title><style>body{font:13px/1.5 Arial,sans-serif;color:#29372d;background:#f6f6ee;margin:28px}main{max-width:1200px;margin:auto}h1{font-size:30px;line-height:1.2}h2{font-size:15px;margin:0 0 12px;display:flex;gap:16px;align-items:baseline}h2 span{font-size:12px;font-weight:normal;color:#75836d}h2 strong{margin-left:auto;font-size:20px}h3{font-size:23px;margin-top:36px}.intro{background:#e8efda;padding:18px;line-height:1.8}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:white;border:1px solid #d2dcc6;border-radius:6px;padding:18px;break-inside:avoid;min-width:0}.bar{height:48px;position:relative;border:1px solid #92a57c;overflow:hidden}.piece{position:absolute;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;text-align:center;border-right:1px solid #8d9c7c;box-sizing:border-box;overflow:hidden}.tail{position:absolute;top:0;bottom:0;background:#e5e7dd;text-align:center;padding-top:15px;box-sizing:border-box}.card p{font-size:11px;color:#748067}table{width:100%;border-collapse:collapse;font-size:10px;margin-top:14px}td,th{padding:7px;border-bottom:1px solid #e1e6da;text-align:left;vertical-align:top}small{display:block;color:#748067;font-size:10px}.ids{font-family:monospace;overflow-wrap:anywhere}.part-shape{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#ddc79f;border:1px solid #a58b61;min-height:48px;padding:8px;font-size:10px}.part-shape b{font-size:14px}summary{cursor:pointer;font-size:11px;margin-top:13px}button{background:#354b2e;border:0;color:white;padding:12px 20px;cursor:pointer}.notes{font-size:11px;line-height:1.7;margin-top:30px}@media(max-width:800px){.grid{grid-template-columns:1fr}}@media print{body{background:white;margin:0}.grid{display:block}.card{margin-bottom:14px}button,details{display:none}@page{size:A4;margin:13mm}}</style><main><button onclick="window.print()">Печать / сохранить PDF</button><h1>Раскрой по повторяющимся схемам</h1><p>${escape(name)}</p><div class="intro"><b>${cutting.summary.boards} досок по 6 м → ${cutting.summary.pieces} деталей</b><br>${fabrication.patternGroups.length} разных схем раскладки · ${fabrication.partGroups.length} типов деталей. Одинаковые схемы показаны один раз с количеством.<br>Пропил ${fmt(cutting.kerfMM, 1)} мм · закупка ${fmt(cutting.summary.purchasedVolume)} м³ · ${cutting.summary.optimal ? "Число заготовок минимально в принятой модели." : "Глобальная оптимальность раскладки не доказана."}</div><h3>Схемы шестиметровых заготовок</h3><div class="grid">${patterns}</div><h3>Одинаковые детали и применение</h3><p>Разные торцы, зеркальные резы, выборки и плоскости обработки в одну группу не объединяются. Полная поштучная привязка сохраняется в fabrication-parts.csv и fabrication-stocks.csv.</p><div class="grid">${shapes}</div><section class="notes">${(cutting.assumptions ?? []).map((a) => `<p>${escape(a)}</p>`).join("")}</section></main></html>`;
}

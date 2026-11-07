import { humanLabel } from "./materials-data.js";
import React, { useMemo } from "react";
import { calculateInsulation } from "./insulation.js";
const fmt = (n) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
export function useInsulation(report) {
  return useMemo(
    () => report.result.insulation ?? calculateInsulation(report.project, report.result),
    [report],
  );
}
export default function InsulationTable({ insulation, project }) {
  const t = insulation.totals;
  const warnings = insulation.checks.filter((c) => c.status === "warning");
  return (
    <section className="insulation-panel" id="insulation" aria-label="Объём утепления">
      <style>{`
        .insulation-panel{margin:20px 0 28px;color:#41533c}
        .insulation-panel h3{font-size:20px;margin:0 0 8px;font-weight:500}
        .insulation-panel p{font-size:12px;line-height:1.6;margin:8px 0 14px}
        .insulation-summary{display:flex;flex-wrap:wrap;gap:12px 24px;background:#edf3e6;padding:16px;border-radius:8px;margin-bottom:14px}
        .insulation-summary strong{font-size:21px;font-weight:500;display:block}
        .insulation-summary span{font-size:11px}
        .insulation-table{width:100%;border-collapse:collapse;font-size:12px;background:white;border:1px solid #dce5d4}
        .insulation-table th,.insulation-table td{padding:11px 12px;text-align:right;border-bottom:1px solid #e5ebdf}
        .insulation-table th{background:#f1f5ec;font-size:11px;font-weight:500}
        .insulation-table th:first-child,.insulation-table td:first-child{text-align:left}
        .insulation-table td small{display:block;color:#76846c;margin-top:5px}
        .insulation-pack-list{font-size:12px;line-height:1.8;padding:12px 0}
      `}</style>
      <h3>Утеплитель · объём по каркасу</h3>
      <p>Из слоя вычтены проёмы и пересечения с реальными досками. Чистый объём — установленный материал.</p>
      {!insulation.complete && (
        <p role="status">Учтённая часть: геометрия утепления неполная. Ограничения указаны в допущениях.</p>
      )}
      <div className="insulation-summary">
        <div>
          <strong>{fmt(t.netVolume)} м³</strong>
          <span>Чистый объём</span>
        </div>
        <div>
          <strong>{t.packs.reduce((s, p) => s + p.packs, 0)} уп.</strong>
          <span>Закупка с запасом</span>
        </div>
        <div>
          <strong>{fmt(t.mass)} кг</strong>
          <span>Масса в конструкции</span>
        </div>
      </div>
      {warnings.length > 0 && (
        <p role="status">
          Нагрузка слоёв ниже расчётного веса: ограждений {warnings.length}. Уточните нагрузки в проекте.
        </p>
      )}
      <div className="engine-table-card">
        <table className="insulation-table">
          <thead>
            <tr>
              <th>Ограждение</th>
              <th>Брутто, м³</th>
              <th>Проёмы, м³</th>
              <th>Древесина, м³</th>
              <th>Чистый, м³</th>
              <th>Упаковки*</th>
            </tr>
          </thead>
          <tbody>
            {insulation.assemblies.map((a) => (
              <tr key={a.id}>
                <td>
                  {humanLabel(a, { type: "assembly", project })}
                  <small>{fmt(a.thickness * 1000)} мм</small>
                </td>
                <td data-label="Брутто, м³">{fmt(a.grossVolume)}</td>
                <td data-label="Проёмы, м³">{fmt(a.openingVolume)}</td>
                <td data-label="Древесина, м³">{fmt(a.timberVolume)}</td>
                <td data-label="Чистый, м³">{fmt(a.netVolume)}</td>
                <td data-label="Упаковки*">{a.packs.map((p) => p.packs).join(" + ") || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="insulation-pack-list">
        {t.packs.map((p) => (
          <div key={p.product}>
            {p.name}: <strong>{p.packs} уп.</strong> × {fmt(p.packVolume)} м³ = {fmt(p.purchasedVolume)} м³
          </div>
        ))}
      </div>
      <p>
        * По ограждению — ориентир при отдельной закупке. Итог округлён один раз на продукт: упаковки строк не
        суммируются. Форматы и запас иллюстративные; транспортное сжатие не уменьшает объём.
      </p>
      <details>
        <summary>Допущения утепления</summary>
        {insulation.assumptions.map((a) => (
          <p key={a}>{a}</p>
        ))}
      </details>
    </section>
  );
}

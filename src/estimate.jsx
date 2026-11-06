import { calculateEstimate, resolvePrices, estimateRowsToCSV } from "./estimate-engine.js";
export { calculateEstimate, resolvePrices, estimateRowsToCSV } from "./estimate-engine.js";
import React, { useEffect, useMemo, useState } from "react";
import { timberSections, parseSection, sectionCatalogNote } from "./catalog.js";
import { calculateCutting } from "./cutting.js";

// Illustration only. These are editable inputs, not researched market prices.
import { defaultPrices } from "./prices.js";
export { defaultPrices } from "./prices.js";

const numeric = (v, fallback = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n, d = 2) => Number(n).toLocaleString("ru-RU", { maximumFractionDigits: d });
const rub = (n) => `${fmt(n, 0)} ₽`;

export function SectionSelect({ value, onChange, label = "Сечение", filter, disabled = false }) {
  const options = timberSections.filter((s) =>
    typeof filter === "function"
      ? filter(s)
      : Array.isArray(filter)
        ? filter.includes(s.id)
        : typeof filter === "string"
          ? s.category === filter
          : true,
  );
  const current = options.find((s) => s.id === value);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        aria-label={label}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) =>
          onChange?.(
            e.target.value,
            timberSections.find((s) => s.id === e.target.value),
          )
        }
      >
        {!current && (
          <option value={value ?? ""}>
            {value ? `${value.replaceAll("x", " × ")} мм · вручную` : "Выберите сечение"}
          </option>
        )}
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <small style={{ fontSize: 9, lineHeight: 1.5, color: "#94a181", display: "block", marginTop: 5 }}>
        Номинальные размеры; подбор прочности отдельно.
      </small>
    </label>
  );
}

function PriceInput({ value, onCommit, label, suffix, max = 1e9 }) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setError(false);
  }, [value]);
  function commit() {
    const next = Number(draft.replace(",", "."));
    if (!draft.trim() || !Number.isFinite(next) || next < 0 || next > max) {
      setError(true);
      return;
    }
    setError(false);
    setDraft(String(next));
    if (next !== value) onCommit?.(next);
  }
  return (
    <div className={`estimate-input ${error ? "invalid" : ""}`}>
      <input
        aria-label={label}
        aria-invalid={error}
        value={draft}
        inputMode="decimal"
        onChange={(e) => {
          setDraft(e.target.value);
          setError(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(String(value));
            setError(false);
          }
        }}
      />
      {suffix && <span>{suffix}</span>}
      {error && <small role="status">От 0 до {fmt(max, 0)}</small>}
    </div>
  );
}

const styles = `
.estimate-panel{height:100%;min-height:0;overflow:auto;padding:28px 30px 35px;background:#f8faf3;color:#73865e;box-sizing:border-box}.estimate-panel *{box-sizing:border-box}.estimate-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:15px;margin-bottom:22px}.estimate-heading h2{margin:0;font-size:22px;font-weight:500;color:#76925a}.estimate-heading p{font-size:10px;margin:8px 0 0;color:#a2af93}.estimate-demo{padding:10px 13px;border:1px solid #e8dec5;background:#faf5e8;color:#a18a56;border-radius:6px;font-size:10px;line-height:1.6;margin-bottom:20px}.estimate-cards{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:12px;margin-bottom:20px}.estimate-card{border:1px solid #dde8cf;border-radius:8px;background:#fff;padding:18px}.estimate-card.total{background:#ecf3df;border-color:#d4e3bd}.estimate-card>span{font-size:9px;display:block;color:#97a786}.estimate-card>strong{display:block;font-size:26px;font-weight:500;letter-spacing:-.6px;margin:10px 0;color:#739153;white-space:nowrap}.estimate-card small{font-size:9px;color:#a4b392;line-height:1.5}.estimate-controls{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:12px;padding:16px;border:1px solid #e0e8d5;background:#fff;border-radius:7px;margin-bottom:20px}.estimate-control>span{display:block;font-size:9px;color:#98aa83;line-height:1.5;margin-bottom:6px}.estimate-input{display:flex;align-items:center;border:1px solid #dfe8d2;border-radius:5px;background:#fafcf6;position:relative;min-width:0}.estimate-input input{border:0;background:transparent;padding:9px 8px;width:100%;min-width:0;text-align:right;font-size:11px;color:#76945a;outline:0}.estimate-input>span{font-size:9px;white-space:nowrap;padding-right:8px;color:#a4b692}.estimate-input.invalid{border-color:#c68f70}.estimate-input.invalid>small{position:absolute;left:0;top:100%;font-size:8px;background:#fff6eb;color:#ac7959;z-index:2;padding:3px}.estimate-input:focus-within{border-color:#9eb979}.estimate-table-wrap{overflow:auto;border:1px solid #e0e8d5;border-radius:7px;background:#fff}.estimate-table{width:100%;border-collapse:collapse;min-width:620px;font-size:10px}.estimate-table th{padding:13px 12px;font-size:8px;color:#a0af90;text-align:left;white-space:nowrap;font-weight:450;background:#f4f8ed;border-bottom:1px solid #e0e8d5}.estimate-table th:nth-child(n+2),.estimate-table td:nth-child(n+2){text-align:right}.estimate-table td{padding:12px;border-bottom:1px solid #edf1e5;vertical-align:top;color:#849a6c}.estimate-table tr:last-child td{border-bottom:0}.estimate-table td:first-child{min-width:205px;max-width:340px}.estimate-table td:first-child strong{font-weight:450;font-size:11px;display:block;color:#7c9661}.estimate-table td:first-child small{display:block;font-size:8px;line-height:1.6;color:#a9b59c;margin-top:5px}.estimate-table td:nth-child(2){white-space:nowrap;padding-top:19px}.estimate-table td:last-child{white-space:nowrap;padding-top:19px;font-size:12px;color:#76925a}.estimate-table .estimate-input{width:120px;margin-left:auto}.estimate-rate small{display:block;font-size:7px;color:#b1bea3;margin-top:5px}.estimate-rate button{font-size:8px;color:#91a878;padding:4px 0}.estimate-footer{display:grid;grid-template-columns:1.4fr 1fr;gap:22px;margin-top:23px}.estimate-assumptions{font-size:9px;line-height:1.7;color:#a0ad92}.estimate-assumptions p{margin:0 0 9px}.estimate-sums{padding:16px;border:1px solid #dce6ce;background:#fff;border-radius:7px;align-self:start}.estimate-sums>div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:10px;color:#93a67e}.estimate-sums strong{font-weight:450;white-space:nowrap;color:#7d985f}.estimate-sums .grand-total{border-top:1px solid #e5ecdd;margin-top:7px;padding-top:14px;font-size:12px}.estimate-sums .grand-total strong{font-size:17px;color:#71914f}.estimate-allocation{display:flex;height:7px;border-radius:4px;overflow:hidden;margin-top:15px}.estimate-allocation i{display:block}.estimate-catalog-note{margin-top:20px;font-size:9px;line-height:1.7;color:#a6b399}@media(max-width:1100px){.estimate-panel{padding:22px}.estimate-cards{grid-template-columns:1fr 1fr}.estimate-card.total{grid-column:1/-1}.estimate-controls{grid-template-columns:1fr 1fr}.estimate-footer{grid-template-columns:1fr}}@media(max-width:650px){.estimate-panel{height:auto;min-height:500px;overflow:visible;padding:19px}.estimate-heading{flex-wrap:wrap}.estimate-heading h2{font-size:23px}.estimate-heading p,.estimate-demo{font-size:11px}.estimate-card{padding:15px}.estimate-card>strong{font-size:23px}.estimate-card>span,.estimate-card small,.estimate-control>span,.estimate-assumptions,.estimate-catalog-note{font-size:10px}.estimate-controls{padding:12px;gap:14px}.estimate-input input{font-size:12px}.estimate-sums>div{font-size:11px}.estimate-table td:first-child small{font-size:9px}}
`;

export default function EstimatePanel({
  project,
  result,
  estimate: precomputedEstimate,
  cutting: precomputedCutting,
  onPricesChange,
  onExport,
}) {
  const e = useMemo(
    () => precomputedEstimate ?? calculateEstimate(project, result, precomputedCutting),
    [project, result, precomputedEstimate, precomputedCutting],
  );
  const p = e.prices;
  const update = (key, value) => {
    const next = { ...p, sectionPrices: { ...p.sectionPrices } };
    if (key.startsWith("sectionPrices.")) next.sectionPrices[key.slice(14)] = value;
    else next[key] = value;
    onPricesChange?.(next);
  };
  const resetSection = (id) => {
    const next = { ...p, sectionPrices: { ...p.sectionPrices } };
    delete next.sectionPrices[id];
    onPricesChange?.(next);
  };
  const exportCSV = () => {
    const csv = estimateRowsToCSV(e, project.name);
    if (onExport) {
      onExport(e, csv);
      return;
    }
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "karkas-estimate.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="estimate-panel" aria-label="Предварительная смета">
      <style>{styles}</style>
      <header className="estimate-heading">
        <div>
          <h2>Смета проекта</h2>
          <p>Материалы по модели · цены в рублях · редактируемые расценки</p>
        </div>
        <button className="button secondary" onClick={exportCSV}>
          Скачать CSV ↗
        </button>
      </header>
      <div className="estimate-demo">
        <strong>Цены примера — замените на ваши.</strong> Это расчёт по введённым расценкам, без проверки
        рыночных цен. Изменение цены не меняет нагрузки и геометрию.
      </div>
      {!e.complete && (
        <div className="estimate-demo" role="status">
          <strong>Смета неполная.</strong>{" "}
          {e.cutting && !e.cutting.summary.complete
            ? `${e.cutting.overlength.length + e.cutting.invalid.length} деталей не размещены в раскрое: их стоимость в итог не входит. `
            : ""}
          {result.geometry?.closed === false ? "Контур не замкнут: площадные материалы не определены. " : ""}
          Итог относится к учтённой части модели.
        </div>
      )}
      <div className="estimate-cards">
        <div className="estimate-card total">
          <span>{e.complete ? "Предварительный бюджет" : "Учтённая часть · смета неполная"}</span>
          <strong>{rub(e.total)}</strong>
          <small>Материалы, работы и резерв по заданным правилам</small>
        </div>
        <div className="estimate-card">
          <span>Материалы с запасом</span>
          <strong>{rub(e.materialTotal)}</strong>
          <small>Древесина к закупке {fmt(e.procurementTimberVolume, 3)} м³</small>
        </div>
        <div className="estimate-card">
          <span>Работы + резерв</span>
          <strong>{rub(e.laborTotal + e.reserve)}</strong>
          <small>Укрупнённо, по редактируемым процентам</small>
        </div>
      </div>
      <div className="estimate-controls">
        {[
          ["timberM3", "Базовая цена древесины", "₽/м³", 1e9],
          ["wastePercent", e.cutting ? "Запас листов и утепления" : "Закупочный запас", "%", 300],
          ["laborPercent", "Работы от материалов", "%", 300],
          ["contingencyPercent", "Резерв от материалов и работ", "%", 300],
        ].map(([key, label, suffix, max]) => (
          <label className="estimate-control" key={key}>
            <span>{label}</span>
            <PriceInput
              label={label}
              value={p[key]}
              suffix={suffix}
              max={max}
              onCommit={(value) => update(key, value)}
            />
          </label>
        ))}
      </div>
      <div className="estimate-table-wrap">
        <table className="estimate-table">
          <thead>
            <tr>
              <th>Материал / изделие</th>
              <th>К закупке</th>
              <th>Расценка, ₽/ед.</th>
              <th>Сумма, ₽</th>
            </tr>
          </thead>
          <tbody>
            {e.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  <small>{row.note}</small>
                </td>
                <td>
                  {fmt(row.quantity, row.unit === "шт." ? 0 : 3)} <span>{row.unit}</span>
                </td>
                <td className="estimate-rate">
                  <PriceInput
                    value={row.unitPrice}
                    label={`Цена: ${row.name}, рублей за ${row.unit}`}
                    onCommit={(value) => update(row.editableKey, value)}
                  />
                  {row.sectionId &&
                    (Object.hasOwn(p.sectionPrices, row.sectionId) ? (
                      <button onClick={() => resetSection(row.sectionId)}>Вернуть базовую цену</button>
                    ) : (
                      <small>По базовой цене древесины</small>
                    ))}
                </td>
                <td>{fmt(row.total, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="estimate-footer">
        <div className="estimate-assumptions">
          {e.assumptions.map((a) => (
            <p key={a}>{a}</p>
          ))}
          <p>
            Остатки древесины и запас материалов: {rub(e.wasteTotal)}. Эта сумма уже входит в материалы и
            повторно не добавляется.
          </p>
        </div>
        <div className="estimate-sums">
          <div>
            <span>Материалы</span>
            <strong>{rub(e.materialTotal)}</strong>
          </div>
          <div>
            <span>Работы · {fmt(p.laborPercent)}%</span>
            <strong>{rub(e.laborTotal)}</strong>
          </div>
          <div>
            <span>Резерв · {fmt(p.contingencyPercent)}%</span>
            <strong>{rub(e.reserve)}</strong>
          </div>
          <div className="grand-total">
            <span>Итого</span>
            <strong>{rub(e.total)}</strong>
          </div>
          <div className="estimate-allocation" aria-hidden="true">
            {[
              [e.materialTotal, "#a6c879"],
              [e.laborTotal, "#c8dca8"],
              [e.reserve, "#e5edda"],
            ].map(([value, color], i) => (
              <i key={i} style={{ width: `${e.total ? (value / e.total) * 100 : 0}%`, background: color }} />
            ))}
          </div>
        </div>
      </div>
      <p className="estimate-catalog-note">{sectionCatalogNote}</p>
    </section>
  );
}

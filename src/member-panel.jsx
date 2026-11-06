import React, { useMemo, useState } from "react";
import { memberInsight } from "./member-insight.js";
import "./member-panel.css";

const num = (v, digits = 2) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits })
    : "—";
const statusText = {
  fail: "превышение",
  warning: "внимание",
  unverified: "не проверено",
  pass: "в пределах",
};

function Rows({ rows }) {
  return rows.map((r) => (
    <div className="mp-row" key={r.label}>
      <span>{r.label}</span>
      <strong>{r.text ?? `${num(r.value, r.digits)}${r.unit ? " " + r.unit : ""}`}</strong>
    </div>
  ));
}

function Utilization({ value, status }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const pct = Math.min(100, value * 100),
    tone = status === "fail" || value > 1 ? "fail" : value > 0.85 ? "warn" : "ok";
  return (
    <div className={`mp-util ${tone}`}>
      <div className="mp-util-head">
        <span>Загрузка</span>
        <strong>{num(value * 100, 0)}%</strong>
      </div>
      <div className="mp-util-bar">
        <i style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}

function StockBar({ cutting }) {
  const L = cutting.stockLength || 6;
  return (
    <div className="mp-stock">
      <div className="mp-stock-bar">
        {cutting.pieces.map((p) => (
          <div
            key={p.id}
            className={"mp-stock-piece" + (p.current ? " current" : "")}
            style={{ left: (p.offset / L) * 100 + "%", width: (p.length / L) * 100 + "%" }}
            title={`${p.name} · ${num(p.length, 3)} м`}
          >
            <small>{num(p.length, 2)}</small>
          </div>
        ))}
        {cutting.remainder > 0 && (
          <div
            className="mp-stock-tail"
            style={{
              left: ((L - cutting.remainder) / L) * 100 + "%",
              width: (cutting.remainder / L) * 100 + "%",
            }}
            title={`Остаток ${num(cutting.remainder, 3)} м`}
          />
        )}
      </div>
      <div className="mp-stock-scale">
        <span>0</span>
        <span>{num(L, 1)} м</span>
      </div>
    </div>
  );
}

export function MemberPanel({ report, id, onClose }) {
  const insight = useMemo(() => memberInsight(report, id), [report, id]);
  const [tab, setTab] = useState("loads");
  if (!insight) return null;
  const { board, facts, cutting, analysis, checks } = insight;
  const failed = checks.filter((c) => c.status === "fail").length;
  return (
    <aside className="mp-panel" aria-label="Параметры доски">
      <header className="mp-head">
        <div>
          <div className="mp-eyebrow">ДОСКА · {board.id}</div>
          <h3>{board.name ?? "Элемент каркаса"}</h3>
          <small>
            {board.b} × {board.h} мм
          </small>
        </div>
        <button className="mp-close" onClick={onClose} aria-label="Закрыть панель">
          ×
        </button>
      </header>
      <nav className="mp-tabs">
        {[
          ["loads", "Нагрузки"],
          ["cutting", "Раскрой"],
          ["checks", `Проверки${checks.length ? " · " + checks.length : ""}`],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
            {key === "checks" && failed > 0 && <em>{failed}</em>}
          </button>
        ))}
      </nav>
      <div className="mp-body">
        {tab === "loads" && (
          <>
            {analysis ? (
              <section>
                <div className="mp-eyebrow">{analysis.title}</div>
                <Utilization value={analysis.utilization} status={analysis.status} />
                <Rows rows={analysis.rows} />
                {analysis.note && <p className="mp-note">{analysis.note}</p>}
              </section>
            ) : (
              <p className="mp-note">
                Для этого элемента движок не ведёт отдельного расчёта усилий: он работает как связь, вставка
                или часть узла. Собственный вес учтён в общей нагрузке; связанные проверки — во вкладке
                «Проверки».
              </p>
            )}
            <section>
              <div className="mp-eyebrow">ГЕОМЕТРИЯ И ВЕС</div>
              <Rows rows={facts} />
            </section>
          </>
        )}
        {tab === "cutting" &&
          (cutting ? (
            <section>
              <div className="mp-eyebrow">
                ЗАГОТОВКА {cutting.stockId} · {cutting.section?.replace("x", " × ")}
              </div>
              <StockBar cutting={cutting} />
              <Rows
                rows={[
                  {
                    label: "Позиция на заготовке",
                    text: `${cutting.pieceIndex + 1} из ${cutting.pieces.length}`,
                  },
                  {
                    label: "Отступ от торца",
                    text: `${num(cutting.pieces[cutting.pieceIndex].offset, 3)} м`,
                  },
                  { label: "Длина заготовки", value: cutting.stockLength, unit: "м", digits: 2 },
                  { label: "Использовано", value: cutting.used, unit: "м", digits: 3 },
                  { label: "Пропилы", value: cutting.kerfWaste, unit: "м", digits: 3 },
                  {
                    label: "Остаток",
                    text: `${num(cutting.remainder, 3)} м${cutting.reusable ? " · пригоден" : ""}`,
                  },
                  ...(cutting.cutStart || cutting.cutEnd
                    ? [
                        {
                          label: "Торцы",
                          text: [cutting.cutStart, cutting.cutEnd].filter(Boolean).join(" / "),
                        },
                      ]
                    : []),
                  ...(cutting.partGroupId
                    ? [
                        {
                          label: "Марка детали",
                          text: `${cutting.partGroupId}${cutting.partGroupCount ? ` · ${cutting.partGroupCount} шт.` : ""}`,
                        },
                      ]
                    : []),
                  ...(cutting.patternGroupId
                    ? [
                        {
                          label: "Схема раскроя",
                          text: `${cutting.patternGroupId}${cutting.patternCount ? ` · ${cutting.patternCount} заг.` : ""}`,
                        },
                      ]
                    : []),
                ]}
              />
              <div className="mp-eyebrow mp-gap">ДЕТАЛИ НА ЭТОЙ ЗАГОТОВКЕ</div>
              {cutting.pieces.map((p, i) => (
                <div className={"mp-row" + (p.current ? " current" : "")} key={p.id}>
                  <span>
                    {i + 1}. {p.name}
                    <small>{p.id}</small>
                  </span>
                  <strong>{num(p.length, 3)} м</strong>
                </div>
              ))}
            </section>
          ) : (
            <p className="mp-note">Деталь не входит в карту раскроя (лист, крепёж или вне закупки).</p>
          ))}
        {tab === "checks" &&
          (checks.length ? (
            <section>
              {checks.map((c) => (
                <div className={`mp-check ${c.status}`} key={c.id}>
                  <i />
                  <span>
                    {c.label}
                    <small>
                      {statusText[c.status] ?? c.status}
                      {c.utilization !== null ? ` · ${num(c.utilization * 100, 0)}%` : ""}
                      {c.direct ? " · по этой доске" : ""}
                    </small>
                  </span>
                </div>
              ))}
            </section>
          ) : (
            <p className="mp-note">Проверок, ссылающихся на эту доску, её стену или зону, нет.</p>
          ))}
      </div>
    </aside>
  );
}

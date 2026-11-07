import React, { useEffect, useId, useMemo, useState } from "react";
import { parseSection } from "./catalog.js";
import { SectionSelect } from "./estimate.jsx";
import "./grillage-workspace.css";

const defaults = { section: "50x200", plies: 3, deflectionRatio: 300, capSize: 250 };
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const fmt = (n, d = 2) => (finite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—");
const validPoint = (p) => p && finite(p.x) && finite(p.y);
const beamName = (beam, beams) => `Балка ${beams.findIndex((b) => b.id === beam?.id) + 1}`;
const colors = ["#cfb587", "#d9c59f", "#c1a476", "#dfcead", "#c7b38c", "#d6bf92"];
const fail = (check) => check?.status === "fail" || check?.utilization > 1;

function NumberField({ label, value, onChange, unit, min = 0, max = 1000, integer = false, help }) {
  const [text, setText] = useState(String(value ?? "")),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(value ?? ""));
    setInvalid(false);
  }, [value]);
  const valid = (n) => finite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
  function edit(next) {
    setText(next);
    setInvalid(false);
    const n = Number(next.replace(",", "."));
    if (next.trim() && valid(n) && n !== value) onChange(n);
  }
  function commit() {
    const n = Number(text.replace(",", "."));
    if (!text.trim() || !valid(n)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (n !== value) onChange(n);
  }
  return (
    <label className="grillage-field">
      <span>{label}</span>
      <div className={invalid ? "invalid" : ""}>
        <input
          aria-label={label}
          inputMode="decimal"
          aria-invalid={invalid}
          value={text}
          onChange={(e) => edit(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              setText(String(value));
              setInvalid(false);
            }
          }}
        />
        {unit && <i>{unit}</i>}
      </div>
      {invalid ? (
        <small className="error" role="status">
          {integer ? "Целое число" : "Число"} от {min} до {max}
        </small>
      ) : (
        help && <small>{help}</small>
      )}
    </label>
  );
}

function FoundationPlan({
  p,
  r,
  model,
  selectedBeam,
  selectedSpan,
  onSelectBeam,
  onSelectPile,
  selectedPile,
  settings,
}) {
  const uid = useId().replaceAll(":", ""),
    [labels, setLabels] = useState("numbers");
  const polygon = r.geometry?.polygon ?? [],
    beams = (model.beams ?? []).filter((b) => validPoint(b.a) && validPoint(b.b));
  const piles = model.piles ?? r.piles ?? [],
    spans = model.spans ?? [];
  const all = [...polygon, ...beams.flatMap((b) => [b.a, b.b]), ...piles.filter(validPoint)];
  const minX = all.length ? Math.min(...all.map((q) => q.x)) : 0,
    minY = all.length ? Math.min(...all.map((q) => q.y)) : 0;
  const maxX = all.length ? Math.max(...all.map((q) => q.x)) : 12,
    maxY = all.length ? Math.max(...all.map((q) => q.y)) : 8;
  const w = Math.max(8, maxX - minX),
    h = Math.max(6, maxY - minY),
    scale = Math.max(w, h) / 12,
    pad = Math.max(w, h) * 0.13;
  const section = parseSection(settings.section),
    packageWidth = ((section?.b ?? 50) * settings.plies) / 1000,
    cap = settings.capSize / 1000;
  return (
    <div className="grillage-plan-card">
      <header className="grillage-plan-head">
        <span>ПЛАН РОСТВЕРКА И ОПОР</span>
        <div>
          <button
            className={labels === "numbers" ? "active" : ""}
            onClick={() => setLabels("numbers")}
            aria-pressed={labels === "numbers"}
          >
            Номера опор
          </button>
          <button
            className={labels === "loads" ? "active" : ""}
            onClick={() => setLabels("loads")}
            aria-pressed={labels === "loads"}
          >
            Реакции
          </button>
        </div>
      </header>
      <svg
        viewBox={`${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`}
        className="grillage-plan"
        role="group"
        aria-label="Фундамент по фактическому контуру дома, балки ростверка и свайное поле"
      >
        <defs>
          <pattern id={`foundation-grid-${uid}`} width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M1 0H0V1" fill="none" stroke="#dbe4d0" strokeWidth={0.012 * scale} />
          </pattern>
        </defs>
        <rect x={minX - pad} y={minY - pad} width={w + 2 * pad} height={h + 2 * pad} fill="#eff4e7" />
        <rect
          x={minX - pad}
          y={minY - pad}
          width={w + 2 * pad}
          height={h + 2 * pad}
          fill={`url(#foundation-grid-${uid})`}
        />
        {polygon.length >= 3 && (
          <polygon
            points={polygon.map((q) => `${q.x},${q.y}`).join(" ")}
            fill="#f8fbf2"
            stroke="#afbf9a"
            strokeWidth={0.025 * scale}
          />
        )}
        {piles.filter(validPoint).map((pile, i) => (
          <rect
            key={`cap-${pile.id}`}
            x={pile.x - cap / 2}
            y={pile.y - cap / 2}
            width={cap}
            height={cap}
            fill="#d9e1cf"
            stroke="#8d9f7c"
            strokeWidth={0.012 * scale}
          >
            <title>{`Оголовок опоры ${i + 1} · ${settings.capSize} × ${settings.capSize} мм`}</title>
          </rect>
        ))}
        {beams.map((beam, i) => {
          const active = beam.id === selectedBeam?.id,
            bad = spans.some((s) => s.beamId === beam.id && fail(s.check));
          return (
            <g
              key={beam.id}
              className="grillage-selectable"
              role="button"
              tabIndex={0}
              aria-label={`Балка ${i + 1}, ${fmt(beam.length)} м${bad ? ", есть превышение частного предела" : ""}`}
              onClick={() => onSelectBeam(beam.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectBeam(beam.id);
                }
              }}
            >
              <line
                x1={beam.a.x}
                y1={beam.a.y}
                x2={beam.b.x}
                y2={beam.b.y}
                stroke={active ? "#91ae68" : bad ? "#c29a70" : "#c3ad82"}
                strokeWidth={Math.max(0.075 * scale, packageWidth)}
                strokeLinecap="butt"
              />
              <line
                x1={beam.a.x}
                y1={beam.a.y}
                x2={beam.b.x}
                y2={beam.b.y}
                stroke={active ? "#e6f1cd" : "#efe7d0"}
                strokeWidth={0.018 * scale}
                strokeDasharray={`${0.13 * scale} ${0.07 * scale}`}
              />
              <line
                x1={beam.a.x}
                y1={beam.a.y}
                x2={beam.b.x}
                y2={beam.b.y}
                stroke="transparent"
                strokeWidth={0.34 * scale}
              />
              <text
                x={(beam.a.x + beam.b.x) / 2}
                y={(beam.a.y + beam.b.y) / 2 - 0.18 * scale}
                textAnchor="middle"
                fontSize={0.14 * scale}
                fill={active ? "#668344" : "#9bae87"}
                stroke="#f8fbf1"
                strokeWidth={0.045 * scale}
                paintOrder="stroke"
              >
                Б{i + 1}
              </text>
            </g>
          );
        })}
        {selectedSpan && validPoint(selectedSpan.start) && validPoint(selectedSpan.end) && (
          <line
            x1={selectedSpan.start.x}
            y1={selectedSpan.start.y}
            x2={selectedSpan.end.x}
            y2={selectedSpan.end.y}
            stroke={fail(selectedSpan.check) ? "#bf7d59" : "#5e8c79"}
            strokeWidth={0.045 * scale}
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {piles.filter(validPoint).map((pile, i) => {
          const active = pile.id === selectedPile?.id,
            bad = pile.status === "fail" || pile.utilization > 1;
          return (
            <g
              key={pile.id}
              className="grillage-selectable"
              role="button"
              tabIndex={0}
              aria-label={`Опора ${i + 1}, реакция ${fmt(pile.reaction)} кН`}
              onClick={() => onSelectPile(pile.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectPile(pile.id);
                }
              }}
            >
              <circle
                cx={pile.x}
                cy={pile.y}
                r={(active ? 0.135 : 0.105) * scale}
                fill={bad ? "#c0835b" : active ? "#678b54" : "#859e6d"}
                stroke="#f9fcf4"
                strokeWidth={0.025 * scale}
              />
              {labels === "numbers" ? (
                <text
                  x={pile.x}
                  y={pile.y + 0.045 * scale}
                  textAnchor="middle"
                  fontSize={0.12 * scale}
                  fill="#f9fff1"
                >
                  {i + 1}
                </text>
              ) : (
                <text
                  x={pile.x + 0.15 * scale}
                  y={pile.y - 0.1 * scale}
                  fontSize={0.14 * scale}
                  fill={bad ? "#b17f57" : "#7c9764"}
                  stroke="#f8fbf1"
                  strokeWidth={0.04 * scale}
                  paintOrder="stroke"
                >
                  {fmt(pile.reaction, 1)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="grillage-plan-legend">
        <span>
          <i className="package" />
          Пакет досок на ребро
        </span>
        <span>
          <i className="cap" />
          Оголовок
        </span>
        <span>
          <i className="pile" />
          Свая
        </span>
        <span>Нажмите балку или опору</span>
      </div>
    </div>
  );
}

function PliesLayout({ beam, model, settings }) {
  const pieces = (model.instances ?? []).filter(
    (b) => b.beamId === beam?.id && finite(b.stationStart) && finite(b.stationEnd),
  );
  const joints = (model.joints ?? []).filter((j) => j.beamId === beam?.id && finite(j.station));
  const stations = (beam?.stations ?? []).filter((s) => finite(s.station));
  const piles = model.piles ?? [];
  const pileLabel = (id) => {
    const i = piles.findIndex((p) => p.id === id);
    return i >= 0 ? `Свая ${i + 1}` : id ? "Опора" : "Опора не задана";
  };
  const actualPlies = Math.max(settings.plies, ...pieces.map((b) => (b.plyIndex ?? 0) + 1));
  const length = beam?.length ?? 0;
  if (!beam || !(length > 0)) return null;
  const width = 700,
    ox = 98,
    scale = width / length,
    rowHeight = 40,
    oy = 45,
    height = oy + actualPlies * rowHeight + 68;
  return (
    <div className="grillage-plies">
      <div className="grillage-subhead">
        <h3>Доски по слоям пакета</h3>
        <span>
          {actualPlies} слоёв · {pieces.length} физических досок · заготовка 6 м
        </span>
      </div>
      {pieces.length ? (
        <div className="grillage-plies-scroll">
          <svg
            viewBox={`0 0 830 ${height}`}
            role="img"
            aria-label="Раскладка реальных досок по слоям ростверка; стыки и связанные сваи"
          >
            {[...Array(actualPlies)].map((_, ply) => {
              const parts = pieces
                  .filter((b) => (b.plyIndex ?? 0) === ply)
                  .sort((a, b) => a.stationStart - b.stationStart),
                y = oy + ply * rowHeight;
              return (
                <g key={ply}>
                  <text x="80" y={y + 17} textAnchor="end" fontSize="10" fill="#a0b68b">
                    Слой {ply + 1}
                  </text>
                  <rect
                    x={ox}
                    y={y}
                    width={width}
                    height="27"
                    fill="#f0f5e6"
                    stroke="#dbe5cd"
                    strokeWidth=".7"
                  />
                  {parts.map((piece, i) => {
                    const x = ox + piece.stationStart * scale,
                      w = (piece.stationEnd - piece.stationStart) * scale;
                    return (
                      <g key={piece.id}>
                        <rect
                          x={x}
                          y={y}
                          width={Math.max(0, w)}
                          height="27"
                          fill={colors[(ply + i) % colors.length]}
                          stroke="#a48a5f"
                          strokeWidth=".9"
                        />
                        {w > 50 && (
                          <text x={x + w / 2} y={y + 17} textAnchor="middle" fontSize="9" fill="#826c49">
                            Доска {i + 1} · {fmt(piece.cutLength ?? piece.length, 3)} м
                          </text>
                        )}
                        <title>{`${piece.id}\nДеталь ${fmt(piece.length, 3)} м · заготовка ${fmt(piece.cutLength ?? piece.length, 3)} м\nПозиция ${fmt(piece.stationStart, 3)}–${fmt(piece.stationEnd, 3)} м`}</title>
                      </g>
                    );
                  })}
                  {joints
                    .filter((j) => (j.plyIndex ?? 0) === ply)
                    .map((j) => (
                      <g key={j.id}>
                        <line
                          x1={ox + j.station * scale}
                          y1={y - 3}
                          x2={ox + j.station * scale}
                          y2={y + 31}
                          stroke={j.pileId ? "#8e7049" : "#bd704f"}
                          strokeWidth="1.7"
                        />
                        <circle
                          cx={ox + j.station * scale}
                          cy={y - 5}
                          r="2.7"
                          fill={j.pileId ? "#9ab37c" : "#c1855c"}
                        />
                        <title>{`Стык слоя ${ply + 1} · ${pileLabel(j.pileId)} · ${fmt(j.station, 3)} м`}</title>
                      </g>
                    ))}
                </g>
              );
            })}
            {stations.map((station, i) => {
              const x = ox + station.station * scale;
              return (
                <g key={`${station.pileId}-${i}`}>
                  <line
                    x1={x}
                    y1={oy - 15}
                    x2={x}
                    y2={oy + actualPlies * rowHeight - 5}
                    stroke="#87a58c"
                    strokeWidth=".8"
                    strokeDasharray="3 4"
                    opacity=".7"
                  />
                  <path d={`M${x} ${oy + actualPlies * rowHeight + 2}l-6 10h12Z`} fill="#99b481" />
                  <text
                    x={x}
                    y={oy + actualPlies * rowHeight + 29}
                    textAnchor="middle"
                    fontSize="8"
                    fill="#9db48a"
                  >
                    {pileLabel(station.pileId)}
                  </text>
                </g>
              );
            })}
            <text x={ox} y="20" fontSize="8" fill="#a6b992">
              0 м
            </text>
            <text x={ox + width} y="20" textAnchor="end" fontSize="8" fill="#a6b992">
              {fmt(length, 3)} м
            </text>
            <text x="18" y={height - 7} fontSize="8" fill="#a8b99a">
              Метки стыков взяты из модели. Скрепление досок пакета и передача усилий через оголовки
              проверяются отдельно.
            </text>
          </svg>
        </div>
      ) : (
        <div className="grillage-detail-empty">
          Физические доски по слоям ещё не сформированы. Условная раскладка вместо них не подставляется.
        </div>
      )}
      {joints.length > 0 && (
        <div className="grillage-joint-tags">
          {joints.map((j) => (
            <span key={j.id} title={j.id}>
              Слой {(j.plyIndex ?? 0) + 1} · {pileLabel(j.pileId)} · {fmt(j.station)} м
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FoundationSection({ p, r, model, settings }) {
  const uid = useId().replaceAll(":", ""),
    section = parseSection(settings.section) ?? { b: 50, h: 200 };
  const floorSection = parseSection(p.floor?.section ?? "50x250") ?? { b: 50, h: 250 };
  const first = r.geometry?.levels?.find((l) => l.index === 1);
  const headY = model.pileHeadY,
    topY = model.topY;
  const floorBase = first?.platformBase ?? first?.baseY ?? topY;
  const floorTop = finite(floorBase) ? floorBase + floorSection.h / 1000 : undefined;
  const wallBase = first?.wallBaseY ?? first?.elevation;
  if (![headY, topY, floorBase, floorTop, wallBase].every(finite))
    return (
      <div className="grillage-detail-empty">Уровни пакета и платформы появятся после расчёта модели.</div>
    );
  const bottom = headY - 0.23,
    top = wallBase + 0.31,
    vScale = 205 / Math.max(0.5, top - bottom),
    y = (level) => 265 - (level - bottom) * vScale;
  const cx = 250,
    hScale = 0.56,
    packageWidth = section.b * settings.plies * hScale,
    capWidth = settings.capSize * hScale;
  const left = cx - packageWidth / 2,
    right = cx + packageWidth / 2;
  const levels = [
    ["Верх оголовка", headY],
    ["Верх пакета", topY],
    ["Верх лаг", floorTop],
    ["Платформа / низ стены", wallBase],
  ];
  const wallSection = parseSection(
    (p.walls ?? []).find((w) => w.kind === "exterior")?.section ?? "50x150",
  ) ?? { b: 50, h: 150 };
  const wallWidth = wallSection.h * hScale;
  return (
    <div className="grillage-section-card">
      <div className="grillage-subhead">
        <h3>Опора, пакет и платформа</h3>
        <span>Схема узла · отметки из модели</span>
      </div>
      <svg
        viewBox="0 0 770 320"
        role="img"
        aria-label="Разрез: свая, оголовок, пакет досок на ребро, лаги, настил платформы и стена"
      >
        <defs>
          <pattern
            id={`grillage-wood-${uid}`}
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <rect width="9" height="9" fill="#ddc59d" />
            <path d="M0 0v9" stroke="#c2a16d" strokeWidth=".8" />
          </pattern>
        </defs>
        <rect x={cx - 16} y={y(headY)} width="32" height={y(bottom) - y(headY)} rx="3" fill="#83917a" />
        <rect x={cx - capWidth / 2} y={y(headY) - 2} width={capWidth} height="5" fill="#63725b" />
        {[...Array(settings.plies)].map((_, i) => (
          <rect
            key={i}
            x={left + i * section.b * hScale}
            y={y(topY)}
            width={section.b * hScale}
            height={Math.max(1, y(headY) - y(topY))}
            fill={`url(#grillage-wood-${uid})`}
            stroke="#a98d5e"
            strokeWidth="1.1"
          />
        ))}
        <rect
          x={left - 46}
          y={y(floorTop)}
          width={packageWidth + 92}
          height={Math.max(1, y(floorBase) - y(floorTop))}
          fill="#c8b28a"
          stroke="#a38a60"
          strokeWidth="1.2"
        />
        <path
          d={`M${left - 40} ${y(floorTop) + 7}H${right + 40}M${left - 40} ${y(floorBase) - 7}H${right + 40}`}
          stroke="#dfcfaf"
          strokeWidth="1.1"
        />
        <rect
          x={left - 53}
          y={y(wallBase)}
          width={packageWidth + 106}
          height={Math.max(2, y(floorTop) - y(wallBase))}
          fill="#abb892"
          stroke="#91a578"
          strokeWidth="1"
        />
        <rect
          x={cx - wallWidth / 2}
          y={y(wallBase + wallSection.b / 1000)}
          width={wallWidth}
          height={Math.max(3, y(wallBase) - y(wallBase + wallSection.b / 1000))}
          fill={`url(#grillage-wood-${uid})`}
          stroke="#a98d5e"
          strokeWidth="1"
        />
        <rect
          x={cx - wallWidth / 2}
          y={y(top)}
          width={wallSection.b * hScale}
          height={y(wallBase + wallSection.b / 1000) - y(top)}
          fill="#dac098"
          stroke="#a98d5e"
          strokeWidth="1"
        />
        <rect
          x={cx + wallWidth / 2 - wallSection.b * hScale}
          y={y(top)}
          width={wallSection.b * hScale}
          height={y(wallBase + wallSection.b / 1000) - y(top)}
          fill="#dac098"
          stroke="#a98d5e"
          strokeWidth="1"
        />
        <path
          d={`M${cx - wallWidth / 2 - 3} ${y(top) + 2}l8-5 8 5 8-5M${cx + wallWidth / 2 - 26} ${y(top) + 2}l8-5 8 5 8-5`}
          stroke="#b29a71"
          fill="none"
          strokeWidth="1"
        />
        <g fontFamily="inherit" fontSize="10" fill="#9caf88">
          <text x="40" y={y(topY) + (y(headY) - y(topY)) / 2 + 3}>
            Пакет {settings.plies} × {section.b} × {section.h} мм
          </text>
          <text x="40" y={y(floorTop) + (y(floorBase) - y(floorTop)) / 2 + 3}>
            Лаги {floorSection.b} × {floorSection.h} мм
          </text>
          <text x="40" y={y(headY) + 28}>
            Оголовок {settings.capSize} × {settings.capSize} мм
          </text>
          <text x="40" y={y(wallBase) - 18}>
            Стена и нижняя обвязка
          </text>
        </g>
        {levels.map(([label, level], i) => (
          <g key={label}>
            <path
              d={`M${right + 66} ${y(level)}H475`}
              fill="none"
              stroke="#b4c3a5"
              strokeWidth=".9"
              strokeDasharray="4 3"
            />
            <circle cx="480" cy={y(level)} r="2" fill="#97ad7f" />
            <text x="494" y={y(level) + 3} fontSize="10" fill="#91a977">
              {label} · {fmt(level, 3)} м
            </text>
          </g>
        ))}
        <text x="20" y="304" fontSize="9" fill="#a7b997">
          Размеры элементов подписаны; толщина металла, крепёж, гидроизоляция и опирание требуют рабочего
          узла.
        </text>
      </svg>
    </div>
  );
}

export default function GrillageWorkspace({ p, r, onChange, onView3D }) {
  const settings = { ...defaults, ...p.foundation?.grillage },
    model = r.grillageModel ?? {};
  const beams = model.beams ?? [],
    spans = model.spans ?? [],
    piles = model.piles ?? r.piles ?? [],
    checks = model.checks ?? [],
    q = model.quantities ?? {};
  const [beamId, setBeamId] = useState(null),
    [spanId, setSpanId] = useState(null),
    [pileId, setPileId] = useState(null);
  const beam = beams.find((b) => b.id === beamId) ?? beams[0],
    beamSpans = spans.filter((s) => s.beamId === beam?.id);
  const span = beamSpans.find((s) => s.id === spanId) ?? beamSpans[0],
    pile = piles.find((s) => s.id === pileId);
  const section = parseSection(settings.section) ?? { b: 50, h: 200 },
    failed = checks.filter((c) => c.status === "fail");
  const pileLabel = (id) => {
    const index = piles.findIndex((p) => p.id === id);
    return index >= 0 ? `С${index + 1}` : "—";
  };
  const updateFoundation = (key, value) =>
    onChange?.((old) => ({ ...old, foundation: { ...old.foundation, [key]: value } }));
  const updateGrillage = (key, value) =>
    onChange?.((old) => ({
      ...old,
      foundation: { ...old.foundation, grillage: { ...defaults, ...old.foundation?.grillage, [key]: value } },
    }));
  const selectBeam = (id) => {
    setBeamId(id);
    setSpanId(null);
  };
  return (
    <section className="grillage-workspace" aria-label="Свайный фундамент и пакетный ростверк">
      <header className="grillage-heading">
        <div>
          <span>НЕПРЕРЫВНЫЙ ПУТЬ ВЕРТИКАЛЬНЫХ НАГРУЗОК</span>
          <h2>Фундамент и ростверк</h2>
          <p>
            Пакет типовых досок на ребро опирается на сваи. Настройте сечение и опоры, затем проверьте пролёты
            и раскладку каждого слоя.
          </p>
        </div>
        {onView3D && (
          <button className="button secondary" onClick={onView3D}>
            Ростверк в 3D ↗
          </button>
        )}
      </header>
      <div className="grillage-metrics">
        <div>
          <span>Свай в модели</span>
          <strong>
            {q.pileCount ?? piles.length}
            <small>шт.</small>
          </strong>
        </div>
        <div>
          <span>Линий ростверка</span>
          <strong>
            {beams.length}
            <small>шт.</small>
          </strong>
        </div>
        <div>
          <span>Древесина пакета</span>
          <strong>
            {fmt(q.volume, 3)}
            <small>м³</small>
          </strong>
        </div>
        <div>
          <span>Максимальный пролёт</span>
          <strong>
            {fmt(q.maxSpan)}
            <small>м</small>
          </strong>
        </div>
      </div>
      <div className="grillage-settings">
        <div className="grillage-settings-title">
          <h3>Пакет и опоры</h3>
          <span>Параметры сразу пересчитывают проект</span>
        </div>
        <div className="grillage-field-grid">
          <SectionSelect
            label="Сечение одной доски · на ребро"
            value={settings.section}
            filter={(s) => s.category === "board"}
            onChange={(value) => updateGrillage("section", value)}
          />
          <label className="grillage-select">
            <span>Досок в пакете</span>
            <select
              aria-label="Количество досок в пакете ростверка"
              value={settings.plies}
              onChange={(e) => updateGrillage("plies", Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} доски · ширина {n * section.b} мм
                </option>
              ))}
            </select>
            <small>Высота пакета {section.h} мм; слои расположены рядом.</small>
          </label>
          <NumberField
            label="Максимальный шаг свай"
            value={p.foundation?.spacing}
            unit="м"
            min={0.5}
            max={6}
            onChange={(v) => updateFoundation("spacing", v)}
          />
          <NumberField
            label="Предел нагрузки на сваю"
            value={p.foundation?.capacity}
            unit="кН"
            min={1}
            max={1000}
            onChange={(v) => updateFoundation("capacity", v)}
            help="По внешним проектным и геологическим данным."
          />
          <NumberField
            label="Размер оголовка в плане"
            value={settings.capSize}
            unit="мм"
            min={100}
            max={1000}
            integer
            onChange={(v) => updateGrillage("capSize", v)}
          />
          <NumberField
            label="Предел прогиба · L /"
            value={settings.deflectionRatio}
            min={150}
            max={600}
            integer
            onChange={(v) => updateGrillage("deflectionRatio", v)}
            help="Число задаётся пользователем для частной проверки."
          />
        </div>
      </div>
      {failed.length > 0 && (
        <div className="grillage-warning" role="alert">
          {failed.map((c, i) => (
            <p key={c.id ?? i}>
              <strong>{c.label}.</strong>{" "}
              {c.note ??
                (finite(c.value) && finite(c.limit)
                  ? `${fmt(c.value)} / ${fmt(c.limit)} ${c.unit ?? ""}`
                  : "Проверьте параметры модели.")}
            </p>
          ))}
        </div>
      )}
      {!r.geometry?.closed && (
        <div className="grillage-warning">
          Для свайного поля и нагрузок замкните внешний контур дома. Геометрия фундамента формируется по
          действительному полигону.
        </div>
      )}
      <FoundationPlan
        p={p}
        r={r}
        model={model}
        selectedBeam={beam}
        selectedSpan={span}
        onSelectBeam={selectBeam}
        onSelectPile={setPileId}
        selectedPile={pile}
        settings={settings}
      />
      {pile && (
        <div className="grillage-pile-detail">
          <strong>Опора {piles.findIndex((s) => s.id === pile.id) + 1}</strong>
          <span>
            Реакция {fmt(pile.reaction)} / {fmt(p.foundation?.capacity)} кН
          </span>
          <span>
            X {fmt(pile.x)} · Y {fmt(pile.y)} м
          </span>
          <small>Вертикальная реакция; грунт, осадка и отрыв требуют отдельной проверки.</small>
        </div>
      )}
      <div className="grillage-beam-selector">
        <label>
          <span>Выбранная балка</span>
          <select
            aria-label="Балка пакетного ростверка"
            value={beam?.id ?? ""}
            onChange={(e) => selectBeam(e.target.value)}
          >
            {!beams.length && <option value="">Балки пока не сформированы</option>}
            {beams.map((b, i) => (
              <option key={b.id} value={b.id}>
                Балка {i + 1} · {fmt(b.length)} м
              </option>
            ))}
          </select>
        </label>
        <span>
          {settings.plies} × {section.b} × {section.h} мм · заготовки 6 м
        </span>
      </div>
      {beam ? (
        <>
          <PliesLayout beam={beam} model={model} settings={settings} />
          <div className="grillage-span-table">
            <div className="grillage-subhead">
              <h3>Пролёты {beamName(beam, beams).toLowerCase()}</h3>
              <span>Нагрузка на пролёт · расчётная / эксплуатационная</span>
            </div>
            <div className="grillage-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Пролёт</th>
                    <th>Опоры</th>
                    <th>Длина</th>
                    <th>Нагрузка, кН</th>
                    <th>Прогиб, мм</th>
                    <th>Частные пределы</th>
                  </tr>
                </thead>
                <tbody>
                  {beamSpans.map((s, i) => (
                    <tr
                      key={s.id}
                      className={`${span?.id === s.id ? "selected" : ""} ${fail(s.check) ? "fail" : ""}`}
                      onClick={() => setSpanId(s.id)}
                    >
                      <td title={s.id}>Пролёт {i + 1}</td>
                      <td>
                        {pileLabel(s.startPileId)} → {pileLabel(s.endPileId)}
                      </td>
                      <td>{fmt(s.length, 3)} м</td>
                      <td>
                        {fmt(s.designTotal)}
                        <small>/ {fmt(s.serviceTotal)}</small>
                      </td>
                      <td>
                        {fmt(s.check?.deflection)}
                        <small>/ {fmt(s.check?.deflectionLimit)}</small>
                      </td>
                      <td>
                        {fail(s.check) ? "Превышены" : "Частная проверка"}
                        {finite(s.check?.utilization) && (
                          <small>{fmt(s.check.utilization * 100, 0)}% заданного предела</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {span?.check && (
            <div className="grillage-span-details">
              <div>
                <span>Напряжение изгиба</span>
                <strong>{fmt(span.check.bendingStress)} МПа</strong>
              </div>
              <div>
                <span>Напряжение сдвига</span>
                <strong>{fmt(span.check.shearStress)} МПа</strong>
              </div>
              <div>
                <span>Реакция начала / конца</span>
                <strong>
                  {fmt(span.reactionStart)} / {fmt(span.reactionEnd)} кН
                </strong>
              </div>
              <div>
                <span>Прогиб выбранного пролёта</span>
                <strong>
                  {fmt(span.check.deflection)} / {fmt(span.check.deflectionLimit)} мм
                </strong>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="grillage-empty">
          После расчёта появятся линии ростверка, опорные пролёты и физические доски пакета.
        </div>
      )}
      <FoundationSection p={p} r={r} model={model} settings={settings} />
      <div className="grillage-scope">
        <strong>Частные проверки элементов</strong>
        <p>
          Изгиб, сдвиг и прогиб относятся к указанной расчётной схеме. Скрепление досок пакета, стыки,
          оголовки, анкеровка, грунт и осадка требуют отдельных проверок.
        </p>
        {checks
          .filter((c) => c.status === "unverified")
          .map((c, i) => (
            <p key={c.id ?? i}>
              <b>{c.label}.</b> {c.note}
            </p>
          ))}
        <details>
          <summary>Допущения и условия модели</summary>
          {(model.assumptions ?? []).map((note, i) => (
            <p key={i}>{note}</p>
          ))}
          {(model.warnings ?? []).map((w, i) => (
            <p key={`w${i}`}>{typeof w === "string" ? w : (w.note ?? w.message)}</p>
          ))}
        </details>
      </div>
    </section>
  );
}

import React, { useEffect, useId, useMemo, useState } from "react";
import { SectionSelect } from "./estimate.jsx";
import "./bracing-workspace.css";

const defaults = {
  method: "sheathing",
  section: "25x100",
  sheetWidth: 1.25,
  sheetHeight: 2.5,
  thickness: 12,
  edgeNailSpacing: 150,
  fieldNailSpacing: 300,
  designShear: null,
  sheetDensity: 650,
};
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const fmt = (n, d = 2) => (finite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—");
const xyz = (p) => Array.isArray(p) && p.length === 3 && p.every(finite);
const lineKey = (line) => `${line.wallId}:${line.level ?? 1}`;
const methodNames = { sheathing: "Диафрагма из плит", letIn: "Врезные укосины", none: "Не задана" };

function NumberField({ label, value, onCommit, unit, min = 0, max = 1000, optional = false, help }) {
  const [text, setText] = useState(value == null ? "" : String(value)),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(value == null ? "" : String(value));
    setInvalid(false);
  }, [value]);
  function commit() {
    if (optional && !text.trim()) {
      setInvalid(false);
      if (value !== null) onCommit(null);
      return;
    }
    const next = Number(text.replace(",", "."));
    if (!text.trim() || !finite(next) || next < min || next > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value) onCommit(next);
  }
  return (
    <label className="bracing-field">
      <span>{label}</span>
      <div className={invalid ? "invalid" : ""}>
        <input
          aria-label={label}
          aria-invalid={invalid}
          inputMode="decimal"
          value={text}
          placeholder={optional ? "Не задано" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              setText(value == null ? "" : String(value));
              setInvalid(false);
            }
          }}
        />
        {unit && <i>{unit}</i>}
      </div>
      {invalid ? (
        <small className="error" role="status">
          От {min} до {max}
          {optional ? " или пустое поле" : ""}
        </small>
      ) : (
        help && <small>{help}</small>
      )}
    </label>
  );
}

function MethodIcon({ method }) {
  return (
    <svg viewBox="0 0 95 60" aria-hidden="true">
      <path
        d="M8 52V8h78v44H8Zm0-39h78M8 47h78M28 13v34m19-34v34m19-34v34"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {method === "sheathing" ? (
        <>
          <path d="M10 14h36v32H10Zm38 0h36v32H48Z" fill="currentColor" opacity=".14" />
          <path
            d="M13 17h29v26H13Zm38 0h29v26H51Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        </>
      ) : method === "letIn" ? (
        <path d="m29 46 32-32" fill="none" stroke="currentColor" strokeWidth="4" />
      ) : (
        <path d="m22 27 48 8" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" opacity=".35" />
      )}
    </svg>
  );
}

function wallName(line, project) {
  const i = project.walls.findIndex((w) => w.id === line.wallId),
    level = project.levels?.find((l) => l.index === (line.level ?? 1));
  return `Стена${i >= 0 ? ` ${i + 1}` : ""} · ${level?.name ?? `${line.level ?? 1} этаж`}`;
}

function humanWallText(text, project) {
  let value = String(text ?? "");
  const walls = project.walls
    .map((wall, i) => ({ id: wall.id, label: `Стена ${i + 1}` }))
    .sort((a, b) => b.id.length - a.id.length);
  for (const wall of walls) value = value.replaceAll(wall.id, wall.label);
  return value;
}

function panelBounds(panel, wall) {
  if (!wall || !Array.isArray(panel.polygon) || !panel.polygon.every(xyz)) return null;
  const L = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  if (L < 0.01) return null;
  const dx = (wall.b.x - wall.a.x) / L,
    dz = (wall.b.y - wall.a.y) / L;
  const ss = panel.polygon.map((p) => (p[0] - wall.a.x) * dx + (p[2] - wall.a.y) * dz),
    yy = panel.polygon.map((p) => p[1]);
  return { width: Math.max(...ss) - Math.min(...ss), height: Math.max(...yy) - Math.min(...yy) };
}

function groupSheets(panels, wall) {
  const groups = new Map();
  for (const panel of panels) {
    const id = panel.stockSheetId ?? panel.id,
      sheet = groups.get(id) ?? { id, parts: [], area: 0, openingIds: new Set() };
    sheet.parts.push(panel);
    sheet.area += finite(panel.area) ? panel.area : 0;
    for (const openingId of panel.openingIds ?? []) sheet.openingIds.add(openingId);
    groups.set(id, sheet);
  }
  return [...groups.values()].map((sheet, index) => ({
    ...sheet,
    name: `Лист ${index + 1}`,
    bounds: panelBounds({ polygon: sheet.parts.flatMap((p) => p.polygon) }, wall),
    openingIds: [...sheet.openingIds],
  }));
}

function openingName(id, project) {
  const opening = project.openings.find((o) => o.id === id);
  if (!opening) return "Проём";
  const index = project.openings.findIndex((o) => o.id === id);
  return `${opening.type === "door" ? "Дверь" : "Окно"} ${index + 1}`;
}

function nailingEdges(edges, step, maxPoints = 500) {
  if (!finite(step) || step <= 0) return [];
  const out = [];
  for (const [a, b] of edges) {
    const len = Math.hypot(b.s - a.s, b.y - a.y),
      count = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < count && out.length < maxPoints; j++)
      out.push({ s: a.s + ((b.s - a.s) * j) / count, y: a.y + ((b.y - a.y) * j) / count });
  }
  return out;
}

// A sheet can be represented by many clipped polygon pieces. Cancel their
// shared (including partially shared) edges before drawing seams or nail rows.
function sheetBoundary(polygons) {
  const lines = new Map(),
    eps = 1e-7;
  const round = (n) => Math.round(n * 1e6);
  for (const polygon of polygons)
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        len = Math.hypot(b.s - a.s, b.y - a.y);
      if (len < eps) continue;
      let dx = (b.s - a.s) / len,
        dy = (b.y - a.y) / len;
      if (dx < -eps || (Math.abs(dx) < eps && dy < 0)) {
        dx = -dx;
        dy = -dy;
      }
      const nx = -dy,
        ny = dx,
        c = nx * a.s + ny * a.y,
        key = `${round(dx)}:${round(dy)}:${round(c)}`;
      const line = lines.get(key) ?? { dx, dy, nx, ny, c, intervals: [] };
      const ta = dx * a.s + dy * a.y,
        tb = dx * b.s + dy * b.y;
      line.intervals.push([Math.min(ta, tb), Math.max(ta, tb)]);
      lines.set(key, line);
    }
  const edges = [];
  for (const line of lines.values()) {
    const values = [...new Set(line.intervals.flat().map((t) => Math.round(t * 1e8) / 1e8))].sort(
        (a, b) => a - b,
      ),
      ranges = [];
    for (let i = 1; i < values.length; i++) {
      const from = values[i - 1],
        to = values[i],
        mid = (from + to) / 2;
      if (to - from < eps) continue;
      const cover = line.intervals.filter(([a, b]) => mid > a - eps && mid < b + eps).length;
      if (cover !== 1) continue;
      const previous = ranges.at(-1);
      if (previous && Math.abs(previous[1] - from) < eps) previous[1] = to;
      else ranges.push([from, to]);
    }
    for (const [from, to] of ranges) {
      const at = (t) => ({ s: line.dx * t + line.nx * line.c, y: line.dy * t + line.ny * line.c });
      edges.push([at(from), at(to)]);
    }
  }
  return edges;
}

function edgeDistance(p, [a, b]) {
  const dx = b.s - a.s,
    dy = b.y - a.y,
    L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.s - a.s) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.s - a.s - t * dx, p.y - a.y - t * dy);
}

function insidePanel(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    const dx = b.s - a.s,
      dy = b.y - a.y,
      L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.s - a.s) * dx + (p.y - a.y) * dy) / L2)) : 0;
    if (Math.hypot(p.s - a.s - t * dx, p.y - a.y - t * dy) < 1e-8) return true;
    if (a.y > p.y !== b.y > p.y && p.s < ((b.s - a.s) * (p.y - a.y)) / (b.y - a.y) + a.s) inside = !inside;
  }
  return inside;
}

function WallDiagram({ project, result, line, panels, braces, notches, settings }) {
  const uid = useId().replaceAll(":", ""),
    [showNails, setShowNails] = useState(true),
    [showFrame, setShowFrame] = useState(true);
  const wall = project.walls.find((w) => w.id === line?.wallId);
  if (!wall) return null;
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  if (length < 0.01) return null;
  const ux = (wall.b.x - wall.a.x) / length,
    uz = (wall.b.y - wall.a.y) / length;
  const along = (p) => (p[0] - wall.a.x) * ux + (p[2] - wall.a.y) * uz;
  const level = result.geometry?.levels?.find((l) => l.index === (line.level ?? 1));
  const profile = result.geometry?.wallProfiles?.find(
    (p) => p.wallId === line.wallId && p.level === (line.level ?? 1),
  );
  const boards = (result.timber?.instances ?? []).filter(
    (b) =>
      b.category === "walls" &&
      (b.wallId === line.wallId || b.wallIds?.includes(line.wallId)) &&
      (b.level ?? b.floor ?? 1) === (line.level ?? 1) &&
      xyz(b.start) &&
      xyz(b.end),
  );
  const base =
    profile?.baseY ??
    level?.wallBaseY ??
    level?.elevation ??
    Math.min(0, ...boards.map((b) => Math.min(b.start[1], b.end[1])));
  const maxY = Math.max(
    base + 2.8,
    profile?.highTop ?? 0,
    ...panels.flatMap((p) => p.polygon.map((q) => q[1])),
    ...boards.flatMap((b) => [b.start[1], b.end[1]]),
  );
  const scale = Math.min(690 / length, 220 / Math.max(0.5, maxY - base)),
    width = length * scale,
    ox = (870 - width) / 2,
    oy = 300;
  const x = (s) => ox + s * scale,
    y = (h) => oy - (h - base) * scale;
  const panelPolys = panels.map((panel) => ({
    panel,
    points: panel.polygon.map((p) => ({ s: along(p), y: p[1] })),
  }));
  const stockMap = new Map();
  for (const piece of panelPolys) {
    const id = piece.panel.stockSheetId ?? piece.panel.id,
      stock = stockMap.get(id) ?? { id, pieces: [] };
    stock.pieces.push(piece);
    stockMap.set(id, stock);
  }
  const stocks = [...stockMap.values()].map((stock) => ({
    ...stock,
    edges: sheetBoundary(stock.pieces.map((p) => p.points)),
  }));
  const openings = project.openings.filter(
    (o) => o.wallId === wall.id && (o.floor ?? 1) === (line.level ?? 1),
  );
  const notched = new Set(notches.map((n) => n.boardId));
  const fallbackTop = level?.topY ?? base + (finite(line.height) ? line.height : (project.height ?? 2.8));
  const samples = profile?.topSamples ?? [
    { s: 0, topY: fallbackTop },
    { s: length, topY: fallbackTop },
  ];
  const outline = [{ s: 0, y: base }, ...samples.map((q) => ({ s: q.s, y: q.topY })), { s: length, y: base }];
  const fieldDots = [],
    seen = new Set(),
    fieldStep = settings.fieldNailSpacing / 1000;
  if (settings.method === "sheathing" && showNails && fieldStep > 0) {
    for (const board of boards) {
      if (Math.hypot(board.start[0] - board.end[0], board.start[2] - board.end[2]) > 0.02) continue;
      const s = along(board.start),
        lo = Math.min(board.start[1], board.end[1]),
        hi = Math.max(board.start[1], board.end[1]);
      for (let yy = lo + fieldStep / 2; yy < hi && fieldDots.length < 1200; yy += fieldStep) {
        const p = { s, y: yy },
          key = `${Math.round(s * 1000)}:${Math.round(yy * 1000)}`;
        if (
          !seen.has(key) &&
          stocks.some(
            (stock) =>
              stock.pieces.some((q) => insidePanel(p, q.points)) &&
              stock.edges.every((edge) => edgeDistance(p, edge) > 0.02),
          )
        ) {
          seen.add(key);
          fieldDots.push(p);
        }
      }
      if (fieldDots.length >= 1200) break;
    }
  }
  return (
    <div className="bracing-diagram-card">
      <div className="bracing-diagram-head">
        <span>
          {settings.method === "sheathing"
            ? "РАСКЛАДКА ПЛИТ И РЯДЫ КРЕПЕЖА"
            : settings.method === "letIn"
              ? "ВРЕЗНАЯ ДИАГОНАЛЬ В ПЛОСКОСТИ КАРКАСА"
              : "КАРКАС БЕЗ ЗАДАННОЙ ПОСТОЯННОЙ СХЕМЫ"}
        </span>
        <div>
          <button
            className={showFrame ? "active" : ""}
            aria-pressed={showFrame}
            onClick={() => setShowFrame(!showFrame)}
          >
            Каркас
          </button>
          {settings.method === "sheathing" && (
            <button
              className={showNails ? "active" : ""}
              aria-pressed={showNails}
              onClick={() => setShowNails(!showNails)}
            >
              Крепёж
            </button>
          )}
        </div>
      </div>
      <svg
        viewBox="0 0 870 375"
        role="group"
        aria-label={`${wallName(line, project)}, ${methodNames[settings.method]}, раскладка по фактическим элементам`}
      >
        <defs>
          <pattern id={`brace-grid-${uid}`} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" stroke="#e5edde" strokeWidth=".6" fill="none" />
          </pattern>
          <pattern id={`osb-${uid}`} width="19" height="19" patternUnits="userSpaceOnUse">
            <rect width="19" height="19" fill="#dce5c8" />
            <path d="m2 4 5 2m4 4 5-2m-13 7 5-2m5-10 3 1" stroke="#c2cfa9" strokeWidth=".8" />
          </pattern>
        </defs>
        <rect width="870" height="375" fill="#f8fbf3" />
        <rect width="870" height="375" fill={`url(#brace-grid-${uid})`} />
        <polygon
          points={outline.map((p) => `${x(p.s)},${y(p.y)}`).join(" ")}
          fill="#eef4e5"
          stroke="#c5d4b5"
          strokeWidth="1"
        />
        {settings.method === "sheathing" &&
          panelPolys.map(({ panel, points }) => {
            const index = stocks.findIndex((s) => s.id === (panel.stockSheetId ?? panel.id));
            return (
              <polygon
                key={panel.id}
                points={points.map((p) => `${x(p.s)},${y(p.y)}`).join(" ")}
                fill={`url(#osb-${uid})`}
                stroke="none"
              >
                <title>{`Лист ${index + 1} · ${panel.stockSheetId ?? panel.id}`}</title>
              </polygon>
            );
          })}
        {showFrame &&
          boards.map((board) => (
            <line
              key={board.id}
              x1={x(along(board.start))}
              y1={y(board.start[1])}
              x2={x(along(board.end))}
              y2={y(board.end[1])}
              stroke={notched.has(board.id) ? "#b28e61" : "#bdab82"}
              opacity={settings.method === "sheathing" ? ".50" : ".90"}
              strokeWidth={Math.max(1.2, ((board.b ?? 50) / 1000) * scale)}
            >
              <title>{`${board.id} · ${board.name}${notched.has(board.id) ? " · есть выборка под укосину" : ""}`}</title>
            </line>
          ))}
        {settings.method === "sheathing" &&
          stocks.map((stock, index) => {
            const largest = [...stock.pieces].sort((a, b) => b.panel.area - a.panel.area)[0],
              center = {
                s: largest.points.reduce((v, p) => v + p.s, 0) / largest.points.length,
                y: largest.points.reduce((v, p) => v + p.y, 0) / largest.points.length,
              };
            return (
              <g key={stock.id}>
                <path
                  d={stock.edges.map(([a, b]) => `M${x(a.s)} ${y(a.y)}L${x(b.s)} ${y(b.y)}`).join(" ")}
                  fill="none"
                  stroke="#a8ba8e"
                  strokeWidth="1"
                />
                {showNails &&
                  nailingEdges(stock.edges, settings.edgeNailSpacing / 1000).map((p, i) => (
                    <circle key={i} cx={x(p.s)} cy={y(p.y)} r="1.35" fill="#899b70" />
                  ))}
                <text x={x(center.s)} y={y(center.y)} textAnchor="middle" fontSize="8" fill="#899f6e">
                  Л{index + 1}
                </text>
                <title>{`Л${index + 1} · ${stock.id}`}</title>
              </g>
            );
          })}
        {showNails &&
          fieldDots.map((p, i) => (
            <circle key={`field-${i}`} cx={x(p.s)} cy={y(p.y)} r="1.1" fill="#7f9b9b" />
          ))}
        {openings.map((o) => (
          <g key={o.id}>
            <rect
              x={x(o.offset)}
              y={y(base + o.sill + o.height)}
              width={o.width * scale}
              height={o.height * scale}
              fill="#f9fbf5"
              stroke="#9fb2a0"
              strokeWidth="1.2"
            />
            {o.type === "window" && (
              <line
                x1={x(o.offset + o.width / 2)}
                y1={y(base + o.sill + o.height)}
                x2={x(o.offset + o.width / 2)}
                y2={y(base + o.sill)}
                stroke="#c1d4cd"
                strokeWidth="1"
              />
            )}
            <text
              x={x(o.offset + o.width / 2)}
              y={y(base + o.sill + o.height / 2) + 3}
              textAnchor="middle"
              fontSize="9"
              fill="#a5b9ab"
            >
              {o.type === "window" ? "ОКНО" : "ДВЕРЬ"}
            </text>
          </g>
        ))}
        {settings.method === "letIn" &&
          braces.map((brace) => (
            <g key={brace.id}>
              <line
                x1={x(along(brace.start))}
                y1={y(brace.start[1])}
                x2={x(along(brace.end))}
                y2={y(brace.end[1])}
                stroke="#9a8056"
                strokeWidth={Math.max(3, ((brace.h ?? 100) / 1000) * scale + 1.3)}
                strokeLinecap="butt"
              />
              <line
                x1={x(along(brace.start))}
                y1={y(brace.start[1])}
                x2={x(along(brace.end))}
                y2={y(brace.end[1])}
                stroke="#d7bd8e"
                strokeWidth={Math.max(2, ((brace.h ?? 100) / 1000) * scale)}
                strokeLinecap="butt"
              />
              <title>{`${brace.id} · ${brace.b} × ${brace.h} мм · ${fmt(brace.length, 3)} м · ${fmt((Math.atan2(Math.abs(brace.end[1] - brace.start[1]), Math.hypot(brace.end[0] - brace.start[0], brace.end[2] - brace.start[2])) * 180) / Math.PI, 1)}°`}</title>
            </g>
          ))}
        {settings.method === "letIn" &&
          notches
            .filter((n) => Array.isArray(n.polygon) && n.polygon.every(xyz))
            .map((notch, i) => (
              <polygon
                key={`${notch.boardId}-${i}`}
                points={notch.polygon.map((p) => `${x(along(p))},${y(p[1])}`).join(" ")}
                fill="#b58a5350"
                stroke="#a07b4f"
                strokeWidth=".8"
              >
                <title>{`${notch.boardId} · глубина выборки ${fmt(notch.depth * 1000, 1)} мм${notch.requiresCutBoolean ? " · объём требует уточнения при пересечении со стыком" : ""}`}</title>
              </polygon>
            ))}
        <path d={`M${x(0) - 16} ${oy + 8}H${x(length) + 16}`} stroke="#a1b58e" strokeWidth="2" />
        <path
          d={`M${x(0)} 326H${x(length)}M${x(0)} 320v12M${x(length)} 320v12`}
          stroke="#adbd9c"
          strokeWidth="1"
          fill="none"
        />
        <text x="435" y="347" textAnchor="middle" fontSize="11" fill="#8ea675">
          Стена {fmt(length)} м · доступные простенки {fmt(line.availableLength)} м
        </text>
        <text x="18" y="23" fontSize="9" fill="#a0b48b" letterSpacing="1">
          {wallName(line, project).toUpperCase()}
        </text>
        <text x="18" y="366" fontSize="8" fill="#a8b99a">
          {settings.method === "sheathing"
            ? "Ряды крепежа показаны по введённому шагу; опоры кромок и соединения требуют проверки."
            : settings.method === "letIn"
              ? "Укосины показаны по фактическим доскам; выборки ослабляют стойки и требуют проверки."
              : "Постоянная схема сопротивления горизонтальным нагрузкам не задана."}
        </text>
      </svg>
      {settings.method === "sheathing" && (
        <div className="bracing-diagram-legend">
          <span>
            <i />
            Кромки: шаг {fmt(settings.edgeNailSpacing, 0)} мм
          </span>
          <span>
            <i className="field" />
            Промежуточные стойки: шаг {fmt(settings.fieldNailSpacing, 0)} мм
          </span>
          <span>Схема рядов крепежа</span>
        </div>
      )}
    </div>
  );
}

function LoadPath() {
  return (
    <div className="bracing-loadpath">
      <div className="bracing-loadpath-title">НЕПРЕРЫВНЫЙ ПУТЬ ГОРИЗОНТАЛЬНОЙ НАГРУЗКИ</div>
      <div className="bracing-loadpath-nodes">
        {[
          ["Диск кровли / перекрытия", "Сбор горизонтальных усилий"],
          ["Стены жёсткости", "Плиты или врезные укосины"],
          ["Анкеры и удерживающие связи", "Сдвиг и отрыв по краям"],
          ["Фундамент", "Передача в основание"],
        ].map(([title, note], i) => (
          <React.Fragment key={title}>
            <div>
              <strong>{title}</strong>
              <small>{note}</small>
            </div>
            {i < 3 && <span>→</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function BracingWorkspace({ project, result, onChange }) {
  const settings = { ...defaults, ...project.bracing };
  const model = result.bracingModel ?? {},
    lines = model.wallLines ?? [];
  const [picked, setPicked] = useState(null),
    [allPanels, setAllPanels] = useState(false);
  const line = lines.find((w) => lineKey(w) === picked) ?? lines[0];
  const panels = useMemo(
    () =>
      (model.panels ?? []).filter(
        (p) =>
          p.wallId === line?.wallId &&
          (p.level ?? 1) === (line?.level ?? 1) &&
          Array.isArray(p.polygon) &&
          p.polygon.every(xyz),
      ),
    [model, line],
  );
  const braces = (model.braces ?? []).filter(
    (b) =>
      b.wallId === line?.wallId &&
      (b.level ?? b.floor ?? 1) === (line?.level ?? 1) &&
      xyz(b.start) &&
      xyz(b.end),
  );
  const notches = (model.notches ?? []).filter((n) => n.wallId === line?.wallId);
  const checks = model.checks ?? [],
    q = model.quantities ?? {},
    hasCapacity = finite(settings.designShear),
    fails = checks.filter((c) => c.status === "fail");
  const update = (key, value) => onChange?.({ ...settings, [key]: value });
  const angles = (model.braces ?? [])
    .filter((b) => xyz(b.start) && xyz(b.end))
    .map(
      (b) =>
        (Math.atan2(
          Math.abs(b.end[1] - b.start[1]),
          Math.hypot(b.end[0] - b.start[0], b.end[2] - b.start[2]),
        ) *
          180) /
        Math.PI,
    );
  const angleRange = angles.length ? `${fmt(Math.min(...angles), 1)}–${fmt(Math.max(...angles), 1)}°` : "—";
  const wall = project.walls.find((w) => w.id === line?.wallId);
  const sheets = useMemo(() => groupSheets(panels, wall), [panels, wall]);
  const visibleSheets = allPanels ? sheets : sheets.slice(0, 12),
    sheetArea = sheets.reduce((sum, s) => sum + s.area, 0);
  return (
    <section className="bracing-workspace" aria-label="Постоянная жёсткость каркасных стен">
      <header className="bracing-heading">
        <div>
          <span>ГОРИЗОНТАЛЬНЫЕ НАГРУЗКИ · ПОСТОЯННАЯ СХЕМА</span>
          <h2>Жёсткость стен</h2>
          <p>
            Выберите систему, посмотрите простенки и назначьте параметры соединений. Геометрия панелей и досок
            связана с текущим каркасом.
          </p>
        </div>
        <div className={`bracing-status ${fails.length || settings.method === "none" ? "danger" : ""}`}>
          {settings.method === "none"
            ? "Постоянная схема не задана"
            : fails.length
              ? `Есть превышения: ${fails.length}`
              : !hasCapacity
                ? "Несущая способность не задана"
                : "Проверены отдельные условия"}
        </div>
      </header>
      <div className="bracing-methods">
        {[
          ["sheathing", "Диафрагма из плит", "Конструкционная обшивка и крепёж"],
          ["letIn", "Врезные укосины", "Диагонали в плоскости каркаса"],
          ["none", "Не задана", "Показать каркас без постоянных связей"],
        ].map(([id, title, note]) => (
          <button
            className={settings.method === id ? "active" : ""}
            key={id}
            aria-pressed={settings.method === id}
            onClick={() => update("method", id)}
          >
            <MethodIcon method={id} />
            <span>
              <strong>{title}</strong>
              <small>{note}</small>
            </span>
            <i />
          </button>
        ))}
      </div>
      <div className="bracing-metrics">
        {settings.method === "sheathing" ? (
          <>
            <div>
              <span>Площадь плит по модели</span>
              <strong>
                {fmt(q.sheetArea)}
                <small>м²</small>
              </strong>
            </div>
            <div>
              <span>Листов в раскладке</span>
              <strong>
                {fmt(q.sheets, 0)}
                <small>шт.</small>
              </strong>
            </div>
            <div>
              <span>Масса обшивки</span>
              <strong>
                {fmt(q.panelMass, 0)}
                <small>кг</small>
              </strong>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>Врезных укосин</span>
              <strong>
                {model.braces?.length ?? 0}
                <small>шт.</small>
              </strong>
            </div>
            <div>
              <span>Сумма длин по модели</span>
              <strong>
                {fmt(q.bracesLength)}
                <small>м</small>
              </strong>
            </div>
            <div>
              <span>Углы фактических укосин</span>
              <strong>{angleRange}</strong>
            </div>
          </>
        )}
        <div>
          <span>Линий стен</span>
          <strong>
            {lines.length}
            <small>шт.</small>
          </strong>
        </div>
      </div>
      {settings.method === "sheathing" && finite(q.purchasedSheetArea) && (
        <div className="bracing-sheet-balance">
          <span>
            Площадь в закупке <strong>{fmt(q.purchasedSheetArea)} м²</strong>
          </span>
          <span>
            Остатки <strong>{fmt(q.wasteArea)} м²</strong>
          </span>
          <small>Модульная раскладка; минимум отходов листового раскроя не доказан.</small>
        </div>
      )}
      <div className="bracing-settings">
        <div className="bracing-settings-main">
          <h3>Параметры выбранной системы</h3>
          {settings.method === "sheathing" ? (
            <div className="bracing-field-grid">
              <NumberField
                label="Ширина листа"
                value={settings.sheetWidth}
                min={0.3}
                max={4}
                unit="м"
                onCommit={(v) => update("sheetWidth", v)}
              />
              <NumberField
                label="Высота листа"
                value={settings.sheetHeight}
                min={0.3}
                max={6}
                unit="м"
                onCommit={(v) => update("sheetHeight", v)}
              />
              <NumberField
                label="Толщина плиты"
                value={settings.thickness}
                min={6}
                max={40}
                unit="мм"
                onCommit={(v) => update("thickness", v)}
              />
              <NumberField
                label="Плотность плиты"
                value={settings.sheetDensity}
                min={100}
                max={1500}
                unit="кг/м³"
                onCommit={(v) => update("sheetDensity", v)}
              />
              <NumberField
                label="Гвозди по кромкам · шаг"
                value={settings.edgeNailSpacing}
                min={25}
                max={500}
                unit="мм"
                onCommit={(v) => update("edgeNailSpacing", v)}
              />
              <NumberField
                label="Гвозди в поле · шаг"
                value={settings.fieldNailSpacing}
                min={25}
                max={1000}
                unit="мм"
                onCommit={(v) => update("fieldNailSpacing", v)}
              />
            </div>
          ) : settings.method === "letIn" ? (
            <>
              <SectionSelect
                label="Сечение врезной укосины"
                value={settings.section}
                onChange={(v) => update("section", v)}
                filter={(s) => s.category === "board"}
              />
              <p className="bracing-control-note">
                Диагональ 45–60° проходит от нижней до верхней обвязки в свободном простенке. Пересечения со
                стойками дают выборки; крепёж и ослабленное сечение проверяются отдельно.
              </p>
              <div className="bracing-inline-result">
                <span>Выборок в модели</span>
                <strong>{model.notches?.length ?? 0}</strong>
              </div>
            </>
          ) : (
            <p className="bracing-control-note">
              Геометрия каркаса остаётся доступной. Постоянная система восприятия горизонтальных усилий в этой
              конфигурации не задана.
            </p>
          )}
        </div>
        <div className="bracing-capacity">
          <h3>Несущая способность системы</h3>
          <NumberField
            label="Расчётная погонная несущая способность"
            value={settings.designShear}
            optional
            min={0.01}
            max={1000}
            unit="кН/м"
            onCommit={(v) => update("designShear", v)}
            help="Значение из расчёта или документации принятой системы. Пустое поле — проверка не выполнена."
          />
          {hasCapacity && (
            <button className="bracing-clear-capacity" onClick={() => update("designShear", null)}>
              Очистить значение
            </button>
          )}
          <p>
            Шаг гвоздей сам по себе не назначает сопротивление. Нужны тип и размер плиты, крепёж, опоры
            кромок, анкеры и удерживающие связи.
          </p>
          <span className={hasCapacity ? "" : "unverified"}>
            {hasCapacity
              ? "Введённое значение используется только в перечисленных частных проверках."
              : "Статус системы: не подтверждена"}
          </span>
        </div>
      </div>
      <LoadPath />
      {fails.length > 0 && (
        <div className="bracing-warning" role="alert">
          {fails.map((c, i) => (
            <p key={c.id ?? i}>
              <strong>{humanWallText(c.label, project)}.</strong>{" "}
              {humanWallText(
                c.note ??
                  (finite(c.value) && finite(c.limit)
                    ? `${fmt(c.value)} / ${fmt(c.limit)} ${c.unit ?? ""}`
                    : "Проверьте параметры системы."),
                project,
              )}
            </p>
          ))}
        </div>
      )}
      <div className="bracing-wall-selector">
        <span>Выбранная линия стены</span>
        <select
          aria-label="Линия стены жёсткости"
          value={line ? lineKey(line) : ""}
          onChange={(e) => {
            setPicked(e.target.value);
            setAllPanels(false);
          }}
        >
          {!lines.length && <option value="">Линии не сформированы</option>}
          {lines.map((w) => (
            <option key={lineKey(w)} value={lineKey(w)}>
              {wallName(w, project)} · {fmt(w.length)} м
            </option>
          ))}
        </select>
      </div>
      {line && settings.method === "letIn" && braces.length === 0 && (
        <div className="bracing-warning">
          На этой стене врезная диагональ не сформирована. Проверьте свободные простенки для укосины 45–60° от
          нижней до верхней обвязки.
        </div>
      )}
      {line ? (
        <>
          <WallDiagram
            project={project}
            result={result}
            line={line}
            panels={panels}
            braces={braces}
            notches={notches}
            settings={settings}
          />
          <div className="bracing-wall-results">
            <div>
              <span>Доступная длина простенков</span>
              <strong>{fmt(line.availableLength)} м</strong>
            </div>
            <div>
              <span>Расчётный сдвиг линии</span>
              <strong>{fmt(line.demandShear)} кН</strong>
            </div>
            <div>
              <span>Погонная несущая способность</span>
              <strong>{finite(line.designShear) ? `${fmt(line.designShear)} кН/м` : "Не задана"}</strong>
            </div>
            <div>
              <span>Несущая способность линии</span>
              <strong>{finite(line.capacity) ? `${fmt(line.capacity)} кН` : "Не подтверждена"}</strong>
            </div>
          </div>
          {line.checks?.length > 0 && (
            <div className="bracing-line-checks">
              {line.checks.map((c, i) => (
                <div key={c.id ?? i} className={c.status === "fail" ? "fail" : ""}>
                  <strong>{humanWallText(c.label, project)}</strong>
                  {c.note && <p>{humanWallText(c.note, project)}</p>}
                  {finite(c.value) && (
                    <span>
                      {fmt(c.value)}
                      {finite(c.limit) ? ` / ${fmt(c.limit)}` : ""} {c.unit ?? ""}
                    </span>
                  )}
                  {c.status === "unverified" && <small>Не подтверждено</small>}
                </div>
              ))}
            </div>
          )}
          {settings.method === "sheathing" && (
            <div className="bracing-panel-schedule">
              <div>
                <h3>Листы выбранной стены</h3>
                <span>
                  {sheets.length} листов · {fmt(sheetArea)} м² по модели
                </span>
              </div>
              <div className="bracing-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Лист</th>
                      <th>Габарит к установке</th>
                      <th>Чистая площадь</th>
                      <th>Проёмы / вырезы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSheets.map((sheet) => (
                      <tr key={sheet.id}>
                        <td title={sheet.id} style={{ fontFamily: "inherit", fontSize: "inherit" }}>
                          {sheet.name}
                        </td>
                        <td title="Габарит объединённого контура после подрезки">
                          {sheet.bounds
                            ? `${fmt(sheet.bounds.width, 3)} × ${fmt(sheet.bounds.height, 3)} м`
                            : "—"}
                        </td>
                        <td>{fmt(sheet.area, 3)} м²</td>
                        <td>
                          {sheet.openingIds.length
                            ? sheet.openingIds.map((id) => (
                                <span key={id} title={id}>
                                  {openingName(id, project)}{" "}
                                </span>
                              ))
                            : "Без проёмов"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sheets.length > 12 && (
                <button className="bracing-more-panels" onClick={() => setAllPanels(!allPanels)}>
                  {allPanels ? "Показать первые 12" : `Показать все ${sheets.length} листов`}
                </button>
              )}
              <p>
                Каждая строка — один исходный лист. Проёмы и подрезка входят в чистую площадь; габарит
                относится к объединённому контуру установленной части.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="bracing-empty">
          {settings.method === "none"
            ? "Постоянная схема отключена. Выберите плиты или врезные укосины, чтобы сформировать раскладку."
            : "После расчёта модели здесь появятся линии стен, панели или врезные укосины."}
        </div>
      )}
      <div className="bracing-erection">
        <span>НА ЭТАПЕ СБОРКИ</span>
        <h3>Монтажное раскрепление</h3>
        <p>
          Временные раскосы удерживают геометрию при монтаже. Их схема и крепления задаются отдельно; вклад в
          постоянную жёсткость здания здесь не подставляется.
        </p>
      </div>
      <details className="bracing-notes">
        <summary>Кромки, анкеры и основания расчёта</summary>
        <p>
          Кромки расчётной плитной диафрагмы опираются на каркас или блокинг, если не принято специально
          рассчитанное решение без него. Соединения передают усилия от плит к обвязкам и далее к основанию.
        </p>
        <p>
          Марка плиты, тип и размер крепежа, краевые расстояния и анкеры должны соответствовать принятой
          системе. Начальные параметры интерфейса не являются универсальным нормативным решением.
        </p>
        {(model.warnings ?? []).map((w, i) => (
          <p key={`w${i}`}>{typeof w === "string" ? w : (w.message ?? w.note)}</p>
        ))}
        {(model.assumptions ?? []).map((note, i) => (
          <p key={`a${i}`}>{note}</p>
        ))}
        <div className="bracing-source-links">
          <a
            href="https://www.apawood.org/applications-systems/fully-sheathed-wall-systems/wall-bracing/"
            target="_blank"
            rel="noreferrer"
          >
            Основы стеновой жёсткости · APA ↗
          </a>
          <a
            href="https://help.apawood.org/portal/en/kb/articles/wall-sheathing-axis"
            target="_blank"
            rel="noreferrer"
          >
            Ориентация плит и опоры кромок · APA ↗
          </a>
        </div>
      </details>
    </section>
  );
}

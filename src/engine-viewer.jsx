import React, { useEffect, useMemo, useRef, useState } from "react";
import DesignerModel from "./designer-model.jsx";
import AppearanceView from "./appearance-view.jsx";
import SourceView from "./source-view.jsx";
import Icon from "./icons.jsx";
import { parseSection } from "./catalog.js";
import { formatEndCut, cuttingToPrintHTML } from "./cutting.js";
import { planAnnotations, planLabelLines } from "./house-exports.js";
import "./engine-viewer.css";

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const fmt = (n, d = 1) => (finite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—");
const rub = (n) => `${fmt(n, 0)} ₽`;
const categories = {
  walls: "Стены",
  floor: "Перекрытия",
  roof: "Кровля",
  bracing: "Укосины",
  objects: "Отдельные элементы",
  foundation: "Фундамент",
  grillage: "Ростверк",
  spatial: "Лестница и ограждения",
};
const tabs = [
  ["overview", "cube", "Обзор"],
  ["appearance", "home", "Облик"],
  ["checks", "check", "Проверки"],
  ["materials", "table", "Материалы"],
  ["cutting", "ruler", "Раскрой"],
  ["estimate", "weight", "Смета"],
];
const defaultLayers = {
  auxiliary: false,
  ceiling: false,
  walls: true,
  floor: true,
  roof: true,
  bracing: true,
  objects: true,
  foundation: true,
  grillage: true,
  piles: true,
  surfaces: false,
  sheathing: false,
  drainage: false,
  stairs: true,
  guards: true,
  annexes: true,
  glass: true,
  space: false,
};
const annexNames = {
  openTerrace: "Открытая терраса",
  coveredTerrace: "Крытая открытая веранда",
  glazedVeranda: "Остеклённая неотапливаемая веранда",
  terrace: "Открытая терраса",
  covered: "Крытая открытая веранда",
  glazed: "Остеклённая неотапливаемая веранда",
};
const statusLabel = (status) =>
  status === "fail"
    ? "Превышение"
    : status === "pass"
      ? "В пределах"
      : status === "warning"
        ? "Частная проверка"
        : "Не подтверждено";
const statusClass = (status) => (status === "fail" ? "fail" : status === "pass" ? "pass" : "pending");

function human(text, p) {
  let s = String(text ?? "");
  const replacements = (p.walls ?? [])
    .map((w, i) => ({ id: w.id, label: `Стена ${i + 1}` }))
    .sort((a, b) => b.id.length - a.id.length);
  for (const { id, label } of replacements) if (id) s = s.replaceAll(id, label);
  return s;
}

export function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Counter({ label, value, unit, note }) {
  return (
    <div className="engine-counter">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      {note && <em>{note}</em>}
    </div>
  );
}

function Pager({ page, pages, total, onChange, label = "строк" }) {
  return (
    <div className="engine-pager">
      <span>
        {total} {label} · страница {page} из {pages}
      </span>
      <div>
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Предыдущая страница">
          <Icon name="arrow" size={15} style={{ transform: "rotate(180deg)" }} />
          Назад
        </button>
        <button disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Следующая страница">
          Далее
          <Icon name="arrow" size={15} />
        </button>
      </div>
    </div>
  );
}

function Plan({ p, r, planning, level, selected, onSelect, fitKey, mode = "framing" }) {
  const svg = useRef();
  const architectural = mode === "architecture",
    annotations = planAnnotations({ project: p, result: r, planning }, level);
  const levelModel = r.geometry.levels?.find((l) => l.index === level);
  const walls = p.walls.filter((w) => (w.level ?? level) === level),
    axisPolygon = levelModel?.polygon ?? r.geometry.polygon ?? [],
    polygon = levelModel?.platformPolygon ?? axisPolygon;
  const endpoints = walls.flatMap((w) => [w.a, w.b]),
    outerBounds = polygon.length
      ? {
          minX: Math.min(...polygon.map((q) => q.x)),
          maxX: Math.max(...polygon.map((q) => q.x)),
          minY: Math.min(...polygon.map((q) => q.y)),
          maxY: Math.max(...polygon.map((q) => q.y)),
        }
      : null;
  const fit = () => {
    const points = [...endpoints, ...polygon, ...(r.annexes?.items ?? []).flatMap((a) => a.polygon ?? [])];
    const x = points.length ? Math.min(...points.map((q) => q.x)) : 0,
      y = points.length ? Math.min(...points.map((q) => q.y)) : 0;
    const w = points.length ? Math.max(6, Math.max(...points.map((q) => q.x)) - x) : 12,
      h = points.length ? Math.max(5, Math.max(...points.map((q) => q.y)) - y) : 8;
    const pad = Math.max(w, h) * 0.13;
    return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad };
  };
  const [box, setBox] = useState(fit);
  useEffect(() => setBox(fit()), [p, r, level, fitKey]);
  const scale = Math.max(box.w, box.h) / 15;
  const zoom = (factor) =>
    setBox((b) => {
      const w = Math.min(180, Math.max(3, b.w * factor)),
        s = w / b.w;
      return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - b.h * s) / 2, w, h: b.h * s };
    });
  return (
    <div className="engine-plan-wrap">
      <svg
        ref={svg}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        role="group"
        aria-label={`План ${level} этажа. Только просмотр.`}
      >
        <defs>
          <pattern id="engine-plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M1 0H0V1" stroke="#d7dfce" strokeWidth={0.012 * scale} fill="none" />
          </pattern>
        </defs>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#edf1e7" />
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#engine-plan-grid)" />
        {polygon.length > 2 && (
          <polygon
            data-reference="platform-outer-face"
            points={polygon.map((q) => `${q.x},${q.y}`).join(" ")}
            fill="#f8faf3"
            stroke="#3c735d"
            strokeWidth={0.025 * scale}
          />
        )}
        {(r.annexes?.items ?? [])
          .filter((a) => (a.level ?? a.levelIndex ?? 1) === level)
          .map((a) => (
            <g key={a.id}>
              <polygon
                points={(a.polygon ?? []).map((q) => `${q.x},${q.y}`).join(" ")}
                fill="#e8e2cf"
                stroke="#8d966d"
                strokeWidth={0.035 * scale}
              />
              <text
                x={(a.polygon ?? []).reduce((s, p) => s + p.x, 0) / Math.max(1, a.polygon?.length ?? 0)}
                y={(a.polygon ?? []).reduce((s, p) => s + p.y, 0) / Math.max(1, a.polygon?.length ?? 0)}
                textAnchor="middle"
                fontSize={0.15 * scale}
                fill="#697954"
              >
                {a.name ?? annexNames[a.kind] ?? "Пристройка"}
              </text>
            </g>
          ))}
        {architectural &&
          annotations.rooms.map((room) => (
            <polygon
              key={room.id}
              points={room.polygon.map((q) => `${q.x},${q.y}`).join(" ")}
              fill={
                /санузел|ванн|тех/i.test(room.name)
                  ? "#eef4ef"
                  : /спаль/i.test(room.name)
                    ? "#f0f1e7"
                    : "#f6f2e8"
              }
              stroke="none"
            />
          ))}
        {!architectural &&
          (r.timber?.instances ?? [])
            .filter(
              (b) =>
                b.category === "floor" &&
                [
                  "joist",
                  "rimJoist",
                  "floorBlocking",
                  "wallTransferBlocking",
                  "openingTrimmer",
                  "openingHeader",
                ].includes(b.role) &&
                (b.level ?? b.floor ?? 1) === level,
            )
            .map((b) => (
              <line
                key={b.id}
                x1={b.start[0]}
                y1={b.start[2]}
                x2={b.end[0]}
                y2={b.end[2]}
                stroke={
                  b.role === "rimJoist"
                    ? "#698654"
                    : b.role === "wallTransferBlocking" || b.wallSupportWallIds?.length
                      ? "#3f8c75"
                      : b.role === "floorBlocking"
                        ? "#789b9c"
                        : b.role.startsWith("opening")
                          ? "#bc9363"
                          : "#d8c9ac"
                }
                strokeWidth={b.b / 1000}
                opacity={b.role === "joist" ? ".55" : ".9"}
              />
            ))}
        {walls.map((wall, i) => {
          const dx = wall.b.x - wall.a.x,
            dy = wall.b.y - wall.a.y,
            L = Math.hypot(dx, dy);
          if (L < 0.01) return null;
          const n = { x: -dy / L, y: dx / L },
            t =
              (parseSection(
                r.geometry.wallProfiles?.find((q) => q.wallId === wall.id && q.mode === "continuous")
                  ?.section ?? wall.section,
              )?.h ?? 150) / 1000,
            active = selected?.type === "wall" && selected.id === wall.id;
          return (
            <g
              key={wall.id}
              role="button"
              tabIndex={0}
              className="engine-plan-object"
              aria-label={`Стена ${p.walls.indexOf(wall) + 1}, ${fmt(L)} м`}
              onClick={() => onSelect({ type: "wall", id: wall.id })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSelect({ type: "wall", id: wall.id });
                }
              }}
            >
              <line
                x1={wall.a.x}
                y1={wall.a.y}
                x2={wall.b.x}
                y2={wall.b.y}
                stroke={active ? "#9ab66e" : "#58664e"}
                strokeWidth={t}
                strokeLinecap="square"
              />
              <line
                x1={wall.a.x}
                y1={wall.a.y}
                x2={wall.b.x}
                y2={wall.b.y}
                stroke={active ? "#d4e6ad" : architectural ? "#707b66" : "#d2bc92"}
                strokeWidth={Math.max(0.04, t - 0.025)}
                strokeLinecap="square"
              />
              <line
                x1={wall.a.x}
                y1={wall.a.y}
                x2={wall.b.x}
                y2={wall.b.y}
                stroke="transparent"
                strokeWidth={0.32 * scale}
              />
              {!architectural && (
                <text
                  x={(wall.a.x + wall.b.x) / 2 + n.x * 0.37 * scale}
                  y={(wall.a.y + wall.b.y) / 2 + n.y * 0.37 * scale}
                  textAnchor="middle"
                  fontSize={0.15 * scale}
                  fill="#849174"
                  stroke="#f8faf3"
                  strokeWidth={0.05 * scale}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {fmt(L, 2)} м
                </text>
              )}
            </g>
          );
        })}
        {p.openings
          .filter((o) => {
            const w = walls.find((w) => w.id === o.wallId);
            return w && (o.floor ?? w.level ?? 1) === level;
          })
          .map((o) => {
            const w = walls.find((w) => w.id === o.wallId),
              L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
              angle = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
            const x = w.a.x + ((w.b.x - w.a.x) * o.offset) / L,
              y = w.a.y + ((w.b.y - w.a.y) * o.offset) / L,
              depth = (parseSection(w.section)?.h ?? 150) / 1000;
            return (
              <g
                key={o.id}
                transform={`translate(${x} ${y}) rotate(${angle})`}
                role="button"
                tabIndex={0}
                className="engine-plan-object"
                onClick={() => onSelect({ type: "opening", id: o.id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect({ type: "opening", id: o.id });
                }}
                aria-label={o.type === "door" ? "Дверной проём" : "Оконный проём"}
              >
                <rect x="0" y={-depth / 2 - 0.005} width={o.width} height={depth + 0.01} fill="#f8faf3" />
                {o.type === "window" ? (
                  <rect
                    x=".01"
                    y={-depth * 0.32}
                    width={Math.max(0.01, o.width - 0.02)}
                    height={depth * 0.64}
                    fill="#c8dfda"
                    stroke="#7ba6a0"
                    strokeWidth=".018"
                  />
                ) : (
                  <line x1="0" y1="0" x2={o.width} y2="0" stroke="#b3b99e" strokeWidth=".012" />
                )}
              </g>
            );
          })}
        {!architectural &&
          (r.timber?.instances ?? [])
            .filter((b) => b.role === "rimJoist" && (b.level ?? b.floor ?? 1) === level)
            .map((b) => (
              <line
                key={"rim-overlay-" + b.id}
                x1={b.start[0]}
                y1={b.start[2]}
                x2={b.end[0]}
                y2={b.end[2]}
                stroke="#698654"
                strokeWidth={b.b / 1000}
                pointerEvents="none"
              />
            ))}
        {architectural &&
          annotations.fixtures.map((f) => (
            <g key={f.id} data-fixture-id={f.id}>
              <polygon
                points={f.polygon.map((q) => `${q.x},${q.y}`).join(" ")}
                fill={f.fill}
                stroke="#879483"
                strokeWidth={0.018}
              />
              {f.polygons.map((poly, i) => (
                <polygon
                  key={"p" + i}
                  points={poly.map((q) => `${q.x},${q.y}`).join(" ")}
                  fill="none"
                  stroke="#879483"
                  strokeWidth={0.012}
                />
              ))}
              {f.lines.map((ps, i) => (
                <polyline
                  key={"l" + i}
                  points={ps.map((q) => `${q.x},${q.y}`).join(" ")}
                  fill="none"
                  stroke="#879483"
                  strokeWidth={0.012}
                />
              ))}
              {f.circles.map((c, i) => (
                <ellipse
                  key={"c" + i}
                  cx={c.center.x}
                  cy={c.center.y}
                  rx={c.rx}
                  ry={c.ry}
                  transform={`rotate(${c.angle} ${c.center.x} ${c.center.y})`}
                  fill="none"
                  stroke="#879483"
                  strokeWidth={0.012}
                />
              ))}
              {f.label && (
                <text
                  x={f.center.x}
                  y={f.center.y}
                  textAnchor="middle"
                  fontSize={0.095 * scale}
                  fill="#678274"
                >
                  {f.label}
                </text>
              )}
            </g>
          ))}
        {annotations.doors.map((d) => (
          <g key={d.openingId} data-door-swing={d.openingId}>
            <polyline
              points={d.arc.map((q) => `${q.x},${q.y}`).join(" ")}
              fill="none"
              stroke="#849779"
              strokeWidth={0.016}
            />
            <line
              x1={d.hinge.x}
              y1={d.hinge.y}
              x2={d.openTip.x}
              y2={d.openTip.y}
              stroke="#718569"
              strokeWidth={0.025}
            />
          </g>
        ))}
        {architectural &&
          annotations.rooms.map((room) => {
            const lines = planLabelLines(room, 0.28 * scale),
              y = room.labelPoint.y - 0.18 * scale - (lines.length - 1) * 0.16 * scale;
            return (
              <text
                key={"name" + room.id}
                x={room.labelPoint.x}
                y={y}
                textAnchor="middle"
                fontSize={0.28 * scale}
                fill="#526b50"
                fontWeight="500"
                stroke="#f8faf3"
                strokeWidth={0.025 * scale}
                paintOrder="stroke"
              >
                {lines.map((label, i) => (
                  <tspan key={i} x={room.labelPoint.x} dy={i ? 0.31 * scale : 0}>
                    {label}
                  </tspan>
                ))}
                <tspan x={room.labelPoint.x} dy={0.31 * scale} fontSize={0.23 * scale} fontWeight="400">
                  {fmt(room.area, 2)} м²
                </tspan>
              </text>
            );
          })}
        {axisPolygon.length > 2 && (
          <polygon
            data-reference="wall-axes"
            points={axisPolygon.map((q) => `${q.x},${q.y}`).join(" ")}
            fill="none"
            stroke="#4f6258"
            strokeWidth={0.012 * scale}
            strokeDasharray={`${0.12 * scale} ${0.08 * scale}`}
            pointerEvents="none"
          />
        )}
        {p.voids
          .filter((v) => v.level === level)
          .map((v) => {
            const xs = v.polygon.map((q) => q.x),
              ys = v.polygon.map((q) => q.y),
              stairs = (r.spatialLayout?.staircases ?? []).find((s) => s.voidId === v.id),
              stairMin = stairs?.polygon?.length
                ? Math.min(...stairs.polygon.map((q) => q.x))
                : Math.max(...xs),
              x = (Math.min(...xs) + stairMin) / 2,
              y = (Math.min(...ys) + Math.max(...ys)) / 2;
            return (
              <g key={v.id}>
                <polygon
                  points={v.polygon.map((q) => `${q.x},${q.y}`).join(" ")}
                  fill="#f5efdf"
                  stroke="#a8b792"
                  strokeWidth={0.02 * scale}
                  strokeDasharray={`${0.12 * scale} ${0.07 * scale}`}
                />
                <text x={x} y={y} textAnchor="middle" fontSize={0.14 * scale} fill="#8d794d">
                  {v.kind === "stair" ? "ЛЕСТНИЧНЫЙ ПРОЁМ" : "ВТОРОЙ СВЕТ"}
                </text>
                <text x={x} y={y + 0.22 * scale} textAnchor="middle" fontSize={0.1 * scale} fill="#9a8b6c">
                  {v.kind === "doubleHeight" ? "единый объём двух этажей" : ""}
                </text>
              </g>
            );
          })}
        {(r.spatialLayout?.surfaces ?? [])
          .filter((s) => ["stairTread", "stairLanding", "tread", "landing"].includes(s.kind))
          .map((s) => (
            <polygon
              key={s.id}
              points={(s.pointsXYZ ?? s.points ?? s.polygon ?? []).map((q) => `${q[0]},${q[2]}`).join(" ")}
              fill="#c8a676"
              stroke="#8b6e49"
              strokeWidth={0.012 * scale}
            />
          ))}
        {(r.spatialLayout?.guards ?? [])
          .filter((g) => g.kind === "flightGuard" || (g.level ?? 2) === level)
          .map((g) => (
            <line
              key={g.id}
              x1={g.start[0]}
              y1={g.start[2]}
              x2={g.end[0]}
              y2={g.end[2]}
              stroke="#506d61"
              strokeWidth={0.055 * scale}
            />
          ))}
        {!architectural &&
          level === 1 &&
          (r.piles ?? []).map((pile, i) => (
            <circle key={pile.id} cx={pile.x} cy={pile.y} r={0.055 * scale} fill="#859675" opacity=".65">
              <title>{`Опора ${i + 1}: ${fmt(pile.reaction)} кН`}</title>
            </circle>
          ))}
        {architectural && outerBounds && (
          <g fill="#637d5b" stroke="#8ea27d" strokeWidth={0.012 * scale}>
            <line
              x1={outerBounds.minX}
              y1={outerBounds.maxY + 0.35 * scale}
              x2={outerBounds.maxX}
              y2={outerBounds.maxY + 0.35 * scale}
            />
            <line
              x1={outerBounds.minX}
              y1={outerBounds.maxY + 0.23 * scale}
              x2={outerBounds.minX}
              y2={outerBounds.maxY + 0.47 * scale}
            />
            <line
              x1={outerBounds.maxX}
              y1={outerBounds.maxY + 0.23 * scale}
              x2={outerBounds.maxX}
              y2={outerBounds.maxY + 0.47 * scale}
            />
            <text
              x={(outerBounds.minX + outerBounds.maxX) / 2}
              y={outerBounds.maxY + 0.61 * scale}
              textAnchor="middle"
              fontSize={0.16 * scale}
              stroke="none"
            >
              {fmt((outerBounds.maxX - outerBounds.minX) * 1000, 0)} мм · наружные грани
            </text>
            <text
              transform={`translate(${outerBounds.minX - 0.35 * scale} ${(outerBounds.minY + outerBounds.maxY) / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={0.16 * scale}
              stroke="none"
            >
              {fmt((outerBounds.maxY - outerBounds.minY) * 1000, 0)} мм · наружные грани
            </text>
          </g>
        )}
        <text
          x={box.x + 0.25 * scale}
          y={box.y + box.h - 0.28 * scale}
          fontSize={0.17 * scale}
          fill="#526b5b"
          pointerEvents="none"
        >
          {architectural
            ? "Расстановка — аннотации · размеры по фактическим граням"
            : "Наружная грань платформы · пунктир: оси стен"}
        </text>
      </svg>
      <div className="engine-plan-zoom">
        <button onClick={() => zoom(1.2)} aria-label="Уменьшить план">
          −
        </button>
        <button onClick={() => zoom(0.83)} aria-label="Увеличить план">
          +
        </button>
      </div>
    </div>
  );
}

function SelectionFacts({ selected, p, r }) {
  const board = r.timber.instances.find((b) => selected?.type === "member" && b.id === selected.id);
  const wall = p.walls.find((w) => selected?.type === "wall" && w.id === selected.id);
  const floorCheck = board && (r.floorPlatform?.joistChecks ?? []).find((j) => j.partIds?.includes(board.id));
  const partitionHead = wall && (r.partitionHeads?.items ?? []).find((h) => h.wallId === wall.id);
  const wallTransfer =
    wall && (r.floorPlatform?.wallLoadTransfers?.walls ?? []).find((w) => w.wallId === wall.id);
  const opening = p.openings.find((o) => selected?.type === "opening" && o.id === selected.id);
  const pile = (r.piles ?? []).find((s) => selected?.type === "pile" && s.id === selected.id);
  const rows = board
    ? [
        ["Сечение", `${board.b} × ${board.h} мм`],
        ["Длина по оси", `${fmt(board.length, 3)} м`],
        ["Заготовка", `${fmt(board.cutLength ?? board.length, 3)} м`],
        ["Масса", `${fmt(board.mass, 2)} кг`],
        ["Назначение", categories[board.category] ?? "Элемент каркаса"],
        ...(floorCheck
          ? [
              ["Расчётный пролёт", fmt(floorCheck.span, 3) + " м"],
              ["Нагрузки перегородок", String(floorCheck.wallLoads?.length ?? 0)],
              ["Изгиб · частная проверка", fmt(floorCheck.stress, 2) + " МПа"],
              [
                "Прогиб",
                fmt(floorCheck.deflection, 2) + " / " + fmt(floorCheck.deflectionAllowed, 2) + " мм",
              ],
            ]
          : []),
        ...(board.wallSupportWallIds?.length
          ? [
              [
                "Под стенами",
                board.wallSupportWallIds
                  .map((id) => "№" + (p.walls.findIndex((w) => w.id === id) + 1))
                  .join(", "),
              ],
              ["Опорная роль", board.wallLoadTransfer ? "Вставка между лагами" : "Лага пакета усиления"],
              ["Крепёж", "Не рассчитан"],
            ]
          : []),
        ...(board.collarConnection === "faceLap"
          ? [
              ["Соединение", "Нахлёст на широкие грани"],
              ["Смещение осей", `${fmt(board.outOfPlaneOffset * 1000, 1)} мм`],
              ["Крепёж", "Не рассчитан"],
            ]
          : []),
        ...(board.platePosition
          ? [
              [
                "Слой обвязки",
                board.platePosition === "bottom"
                  ? "Нижняя"
                  : `Верхняя · ${Number(board.plateLayer ?? 0) + 1}`,
              ],
            ]
          : []),
        ...(board.cornerEndJoints ?? []).map((j) => [
          j.end === "start" ? "Начало в углу" : "Конец в углу",
          j.through ? "Проходная доска" : "Примыкание в торец",
        ]),
      ]
    : wall
      ? [
          [
            "Сечение по модели",
            (
              r.geometry.wallProfiles?.find((q) => q.wallId === wall.id && q.mode === "continuous")
                ?.section ?? wall.section
            ).replace("x", " × ") + " мм",
          ],
          ["Длина", fmt(Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)) + " м"],
          ["Этаж", String(wall.level ?? 1)],
          [
            "Назначение",
            wall.kind === "exterior" ? "Наружная" : wall.kind === "bearing" ? "Несущая" : "Перегородка",
          ],
          [
            "Высота каркаса",
            fmt(
              partitionHead?.effectiveHeight ??
                r.walls?.find((w) => w.id === wall.id)?.height ??
                wall.height ??
                p.height,
              3,
            ) + " м",
          ],
          ...(partitionHead?.status === "resolved"
            ? [
                ["Верх перегородки", fmt(partitionHead.topY, 3) + " м"],
                ["Зазор до затяжек", fmt(partitionHead.gap * 1000, 0) + " мм · принят"],
                ["Верхнее примыкание", "Скользящее · узел не рассчитан"],
              ]
            : []),
          ...(wallTransfer?.status === "routed"
            ? [
                ["Собственный вес", fmt(wallTransfer.expected?.force, 2) + " кН"],
                ["Передача веса", "Через лаги на ростверк"],
              ]
            : []),
          ...(r.floorPlatform?.wallSupports ?? [])
            .filter((s) => s.wallId === wall.id)
            .flatMap((s) => [
              ["Древесина под основанием", fmt(s.coverageRatio * 100, 1) + "%"],
              [
                "Опирание",
                s.orientation === "parallel"
                  ? "Пакет продольных лаг"
                  : s.orientation === "perpendicular"
                    ? "Лаги и поперечные вставки"
                    : "Требует отдельного решения",
              ],
              ["Узел", "Не подтверждён"],
            ]),
        ]
      : opening
        ? [
            ["Ширина", fmt(opening.width) + " м"],
            ["Высота", fmt(opening.height) + " м"],
            ["От пола", fmt(opening.sill) + " м"],
            ["Этаж", String(opening.floor ?? 1)],
          ]
        : pile
          ? [
              ["Реакция", fmt(pile.reaction) + " кН"],
              ["Заданный предел", fmt(p.foundation?.capacity) + " кН"],
              ["Координаты", `X ${fmt(pile.x)} · Y ${fmt(pile.y)}`],
            ]
          : null;
  const title =
    board?.name ??
    (wall
      ? `Стена ${p.walls.indexOf(wall) + 1}`
      : opening
        ? opening.type === "door"
          ? "Дверной проём"
          : "Оконный проём"
        : pile
          ? `Опора ${(r.piles ?? []).indexOf(pile) + 1}`
          : "Параметры отчёта");
  return (
    <div className="engine-selection">
      <div className="engine-eyebrow">{rows ? "ВЫБРАННЫЙ ЭЛЕМЕНТ" : "МОДЕЛЬ В ЦИФРАХ"}</div>
      <h3>{title}</h3>
      {rows ? (
        rows.map(([label, value]) => (
          <div className="engine-fact" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))
      ) : (
        <>
          <div className="engine-fact">
            <span>Стен в проекте</span>
            <strong>{p.walls.length}</strong>
          </div>
          <div className="engine-fact">
            <span>Окон и дверей</span>
            <strong>{p.openings.length}</strong>
          </div>
          <div className="engine-fact">
            <span>Опор фундамента</span>
            <strong>{r.piles?.length ?? 0}</strong>
          </div>
          <div className="engine-fact">
            <span>{r.roofModel?.sourceMode ? "Импортированных скатов" : "Кровельных зон"}</span>
            <strong>
              {r.roofModel?.sourceMode ? r.roofModel.surfaces.length : (r.roofModel?.zones?.length ?? 0)}
            </strong>
          </div>
          <div className="engine-fact">
            <span>Обвязка платформ</span>
            <strong>{fmt(r.floorPlatform?.quantities?.rimLength)} м</strong>
          </div>
          <div className="engine-fact">
            <span>Поперечные распорки</span>
            <strong>{r.timber.instances.filter((b) => b.role === "floorBlocking").length} шт.</strong>
          </div>
          <div className="engine-fact">
            <span>Плиты жёсткости</span>
            <strong>{fmt(r.bracingModel?.quantities?.sheetArea)} м²</strong>
          </div>
        </>
      )}
      {board && (
        <details className="engine-small-details">
          <summary>{board.shape ? "Профиль и идентификатор" : "Торцы и идентификатор"}</summary>
          {board.shape ? (
            <p>
              Запилы заданы фактическим контуром детали:{" "}
              {board.shape.points?.length ?? board.shape.layers?.reduce((n, l) => n + l.points.length, 0)}{" "}
              точек. Профиль и размеры приведены в альбоме КР и ведомости раскроя.
            </p>
          ) : (
            <>
              <p>Начало: {formatEndCut(board.cutStart)}</p>
              <p>Конец: {formatEndCut(board.cutEnd)}</p>
            </>
          )}
          <code>{board.id}</code>
        </details>
      )}
      <p className="engine-view-hint">
        Выбор элемента раскрывает данные отчёта. Изменение модели выполняется через MCP.
      </p>
    </div>
  );
}

function SpatialSummary({ report }) {
  const r = report.result,
    spatial = r.spatialLayout,
    annexes = r.annexes?.items ?? [],
    spaces = spatial?.doubleHeightSpaces ?? [];
  if (!spatial && !r.annexes) return null;
  const modes = [
    ["openTerrace", "Открытая терраса", "Площадка с настилом. Основание задаётся проектом."],
    [
      "coveredTerrace",
      "Крытая открытая веранда",
      "Односкатная кровля на стойках. Ростверк может быть общим с домом.",
    ],
    [
      "glazedVeranda",
      "Холодная остеклённая веранда",
      "Неотапливаемое остекление; тепловой контур дома сохраняется.",
    ],
  ];
  return (
    <section className="engine-spatial-story">
      {spaces.length > 0 && (
        <div className="engine-space-story">
          <div>
            <div className="engine-eyebrow">ПРОСТРАНСТВО ДОМА</div>
            <h3>Второй свет · единый объём двух этажей</h3>
            <p>
              {spaces.some((s) => s.lowerRoomId) ? "Нижнее помещение связано с общим объёмом. " : ""}
              {spaces.some((s) => s.staircaseId) ? "Лестница находится внутри проёма. " : ""}
              {spaces.some((s) => s.galleryIds?.length) ? "На верхнем уровне — галерея с ограждением. " : ""}
              {spaces.some((s) => s.daylightOpeningIds?.length)
                ? "Свет поступает через окна верхнего яруса."
                : ""}
            </p>
          </div>
          <div className="engine-space-values">
            <span>
              <strong>{spaces.length}</strong>общий объём
            </span>
            <span>
              <strong>{spatial.staircases?.length ?? 0}</strong>лестница
            </span>
            <span>
              <strong>{spatial.guards?.length ?? 0}</strong>участков ограждения
            </span>
          </div>
        </div>
      )}
      <div className="engine-annex-heading">
        <div>
          <div className="engine-eyebrow">ПРИСТРОЙКИ · МОДЕЛЬ ЧЕРЕЗ MCP</div>
          <h3>Три конструктивных варианта</h3>
        </div>
        <span>Геометрия, опоры, материалы и проверки включаются в общий отчёт.</span>
      </div>
      <div className="engine-annex-types">
        {modes.map(([kind, name, description]) => (
          <article key={kind}>
            <span className="engine-mode-symbol">
              {kind === "openTerrace" ? "01" : kind === "coveredTerrace" ? "02" : "03"}
            </span>
            <h4>{name}</h4>
            <p>{description}</p>
          </article>
        ))}
      </div>
      {annexes.length > 0 && (
        <div className="engine-annex-results">
          {annexes.map((a) => (
            <article key={a.id}>
              <div>
                <strong>{a.name ?? annexNames[a.kind] ?? "Пристройка"}</strong>
                <small>
                  {annexNames[a.kind] ?? a.kind} ·{" "}
                  {a.foundation?.shared ? "Общий ростверк с домом" : "Самостоятельное основание"}
                </small>
              </div>
              <span>{fmt(a.area, 2)} м²</span>
              <span>
                {a.foundation?.shared ? "Опоры общей рамы" : "Сваи"}: {a.foundation?.piles?.length ?? 0}
              </span>
              <span>{r.timber.instances.filter((b) => b.annexId === a.id).length} досок</span>
              <span>
                {(a.roof?.surfaces?.length ?? 0) > 0
                  ? "Кровля есть"
                  : r.roofModel?.sourceMode
                    ? "Скаты — в общей модели"
                    : "Без кровли"}{" "}
                · {(a.glazing?.length ?? 0) > 0 ? "с остеклением" : "открытая"}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function Overview({ report }) {
  const p = report.project,
    r = report.result;
  const hasSpaces = (r.spatialLayout?.doubleHeightSpaces?.length ?? 0) > 0,
    hasArchitecture = (report.planning?.rooms ?? p.roomSchedule ?? []).some((q) => q.fixtures?.length > 0);
  const [view, setView] = useState(hasArchitecture ? "plan" : "3d"),
    [planMode, setPlanMode] = useState("architecture"),
    [layers, setLayers] = useState(() => ({ ...defaultLayers, space: hasSpaces })),
    [fitKey, setFitKey] = useState(0),
    [selected, setSelected] = useState(null),
    [level, setLevel] = useState(1),
    [preset, setPreset] = useState(hasSpaces ? "secondLight" : "structure");
  const counts = useMemo(
    () => r.timber.instances.reduce((map, b) => ({ ...map, [b.category]: (map[b.category] ?? 0) + 1 }), {}),
    [r],
  );
  const layerList = [
    ["walls", "Стены"],
    ["floor", "Перекрытия"],
    ["roof", "Кровля"],
    ["stairs", "Лестница"],
    ["guards", "Ограждения"],
    ["annexes", "Пристройки"],
    ["glass", "Стекло"],
    ["auxiliary", "Сервисные рейки"],
    ["ceiling", "Потолочный каркас"],
    ["grillage", "Ростверк"],
    ["piles", "Сваи"],
    ["bracing", "Связи"],
    ["sheathing", "Плиты"],
    ["surfaces", "Скаты"],
    ["space", "Объём второго света"],
    ["drainage", "Сток"],
  ];
  const failCount = (r.checks ?? []).filter((c) => c.status === "fail").length,
    unknownCount = (r.checks ?? []).filter((c) => c.status === "unverified" || c.status === "warning").length;
  const frameZone = r.roofModel?.zones?.find((z) => z.tiedRafters),
    inspection = preset === "roofFrame",
    floorInspection = preset === "floorSupports",
    headInspection = preset === "partitionHeads",
    hasRoofEdge = r.roofModel?.sourceMode && r.roofModel.instances.some((b) => b.role === "roofOutlooker"),
    edgeInspection = preset === "roofEdge" && hasRoofEdge,
    hasGables = (r.roofModel?.instances ?? []).some((b) => b.zoneId?.startsWith("ORION-GABLE")),
    gableInspection = ["gableWest", "gableEast"].includes(preset) && hasGables;
  const lapDemands = [
      ...(r.roofModel?.zones ?? []).flatMap((z) => z.frameAnalysis?.connections ?? []),
      ...(r.snowAssessment?.cases ?? []).flatMap((c) => (c.frames ?? []).flatMap((f) => f.connections ?? [])),
    ],
    worstLap = lapDemands.reduce((a, b) => (!a || (b.demandKN ?? 0) > (a.demandKN ?? 0) ? b : a), null);
  const displayLayers = gableInspection
    ? {
        ...layers,
        walls: true,
        floor: false,
        roof: true,
        bracing: false,
        annexes: false,
        foundation: false,
        piles: false,
        surfaces: false,
        glass: false,
        sheathing: false,
        ceiling: false,
        space: false,
        stairs: false,
        guards: false,
        drainage: false,
      }
    : edgeInspection
      ? {
          ...layers,
          walls: false,
          floor: false,
          roof: true,
          bracing: false,
          annexes: false,
          foundation: false,
          piles: false,
          surfaces: false,
          glass: false,
          sheathing: false,
          ceiling: false,
          space: false,
          stairs: false,
          guards: false,
          drainage: false,
        }
      : headInspection
        ? {
            ...layers,
            walls: true,
            floor: false,
            roof: true,
            bracing: false,
            annexes: false,
            foundation: false,
            piles: false,
            surfaces: false,
            glass: false,
            sheathing: false,
            ceiling: false,
          }
        : floorInspection
          ? {
              ...layers,
              walls: true,
              floor: true,
              roof: false,
              bracing: false,
              annexes: true,
              foundation: true,
              piles: true,
              surfaces: false,
              glass: false,
              sheathing: false,
            }
          : inspection
            ? {
                ...layers,
                walls: false,
                floor: false,
                roof: true,
                annexes: false,
                piles: false,
                sheathing: false,
                surfaces: false,
                drainage: false,
                bracing: false,
                space: false,
                stairs: false,
                guards: false,
              }
            : layers;
  return (
    <>
      {worstLap && (
        <div className="engine-alert" role="note">
          <strong>Накладной ригель: узел не рассчитан.</strong> Усилие до {fmt(worstLap.demandKN, 2)}кН ·
          смещение осей {fmt(worstLap.eccentricityM * 1000, 1)}мм. Показаны боковой нахлёст и прямые торцы;
          гвозди, боковой изгиб, кручение и расщепление требуют расчёта соединения.
        </div>
      )}
      <div className="engine-overview-grid">
        <div className="engine-model-card">
          <div className="engine-model-toolbar">
            <div>
              <span className="engine-live-dot" />
              МОДЕЛЬ ИЗ ОТЧЁТА
            </div>
            <div className="engine-toolbar-actions">
              <div className="engine-view-switch">
                <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>
                  3D
                </button>
                <button className={view === "plan" ? "active" : ""} onClick={() => setView("plan")}>
                  План
                </button>
              </div>
              <button
                className="engine-icon-button"
                onClick={() => setFitKey((k) => k + 1)}
                title="Вписать модель"
                aria-label="Вписать модель"
              >
                <Icon name="target" size={18} />
              </button>
            </div>
          </div>
          {view === "3d" && hasSpaces && (
            <div className="engine-presets">
              {[
                ["secondLight", "Второй свет · пространственный разрез"],
                ["structure", "Общий каркас"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={preset === id ? "active" : ""}
                  onClick={() => {
                    setPreset(id);
                    setLayers((old) => ({ ...old, stairs: true, guards: true, space: id === "secondLight" }));
                    setFitKey((k) => k + 1);
                  }}
                >
                  {label}
                </button>
              ))}
              <span>
                {preset === "secondLight"
                  ? "Ближние стены и кровля прозрачны для обзора. Геометрия проекта сохранена."
                  : "Все конструкции показаны в общем контексте."}
              </span>
            </div>
          )}
          {view === "3d" && (frameZone || hasRoofEdge || r.floorPlatform?.wallSupports?.length > 0) && (
            <div className="engine-presets">
              {[
                ["structure", "Дом целиком"],
                ...(hasRoofEdge ? [["roofEdge", "Фронтонный свес"]] : []),
                ...(hasGables
                  ? [
                      ["gableWest", "Фронтон Ст-19"],
                      ["gableEast", "Фронтон Ст-20"],
                    ]
                  : []),
                ...(frameZone ? [["roofFrame", "Стропильная рама"]] : []),
                ...((r.floorPlatform?.wallSupports?.length ?? 0) > 0
                  ? [["floorSupports", "Опоры стен"]]
                  : []),
                ...((r.partitionHeads?.items ?? []).some((h) => h.status === "resolved")
                  ? [["partitionHeads", "Верх перегородок"]]
                  : []),
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={preset === id ? "active" : ""}
                  onClick={() => {
                    setPreset(id);
                    setSelected(null);
                    setFitKey((k) => k + 1);
                  }}
                >
                  {label}
                </button>
              ))}
              <span>
                {gableInspection
                  ? "Наклонная обвязка выделена зелёным. Показаны стойки, укосины и примыкание к стропилам."
                  : edgeInspection
                    ? "Поперечины выделены зелёным: доска 40×150 плашмя в пазах стропил."
                    : headInspection
                      ? "Нижние затяжки выделены синим. Перегородки имеют отдельный принятый зазор; потолок сохранён ниже."
                      : floorInspection
                        ? "Усиления выделены зелёным; стены показаны нижними обвязками. Настил 35 мм полупрозрачный."
                        : inspection
                          ? `Одна из ${frameZone.frameRows.length} рам · пролёт ${fmt(frameZone.bounds.span, 2)}м · реальные доски и запилы`
                          : r.roofModel?.sourceMode
                            ? "Геометрия кровли из исходного чертежа. Опоры и соединения требуют сверки."
                            : "Выберите раму, чтобы рассмотреть её без остальных конструкций."}
              </span>
            </div>
          )}
          <div className="engine-model-stage">
            {view === "3d" ? (
              <DesignerModel
                project={p}
                result={r}
                roofModel={r.roofModel}
                selected={selected}
                onSelect={setSelected}
                layers={displayLayers}
                fitKey={fitKey}
                viewPreset={preset}
              />
            ) : (
              <Plan
                p={p}
                r={r}
                planning={report.planning}
                mode={planMode}
                level={level}
                selected={selected}
                onSelect={setSelected}
                fitKey={fitKey}
              />
            )}
            <div className="engine-canvas-tag">
              <span>
                {view === "3d"
                  ? gableInspection
                    ? (preset === "gableWest" ? "ФРОНТОН СТ-19" : "ФРОНТОН СТ-20") +
                      " · РЕВИЗИЯ " +
                      report.engine.revision
                    : edgeInspection
                      ? "ФРОНТОННЫЙ СВЕС · РЕВИЗИЯ " + report.engine.revision
                      : headInspection
                        ? "ВЕРХ ПЕРЕГОРОДОК · РЕВИЗИЯ " + report.engine.revision
                        : floorInspection
                          ? "ОПИРАНИЕ СТЕН · РЕВИЗИЯ " + report.engine.revision
                          : inspection
                            ? "СТРОПИЛЬНАЯ РАМА · РЕВИЗИЯ " + report.engine.revision
                            : preset === "secondLight"
                              ? "ВТОРОЙ СВЕТ · ЛЕСТНИЦА · ГАЛЕРЕЯ"
                              : "КОНСТРУКТИВНАЯ МОДЕЛЬ"
                  : `${planMode === "architecture" ? "ПЛАНИРОВКА" : "КАРКАС"} · ${level} ЭТАЖ`}
              </span>
              <small>
                {view === "3d"
                  ? "Вращение · масштаб · выбор элемента"
                  : planMode === "architecture"
                    ? "Помещения, мебель и оборудование из отчёта"
                    : "Контур, доски и проёмы из одной модели"}
              </small>
            </div>
          </div>
          {view === "3d" &&
          !inspection &&
          !floorInspection &&
          !headInspection &&
          !edgeInspection &&
          !gableInspection ? (
            <div className="engine-layer-bar">
              {layerList.map(([key, label]) => (
                <button
                  key={key}
                  className={layers[key] ? "active" : ""}
                  onClick={() =>
                    setLayers((old) => ({
                      ...old,
                      [key]: !old[key],
                      ...(key === "grillage" ? { foundation: !old[key] } : {}),
                    }))
                  }
                  aria-pressed={layers[key]}
                >
                  <i />
                  {label}
                </button>
              ))}
            </div>
          ) : view === "3d" ? (
            <div className="engine-layer-bar">
              <span>
                {gableInspection
                  ? "Фронтон стоит на существующей верхней обвязке стены. Пазы под укосины учтены в модели; крепёж и силовая работа требуют расчёта."
                  : edgeInspection
                    ? "Показан один фронтонный свес. Поперечины В-075 лежат плашмя в пазах глубиной 40 мм; прочность ослабленных стропил и крепёж требуют расчёта."
                    : headInspection
                      ? "Показаны внутренние стены и нижние затяжки кровли. Принятый зазор и скользящие крепления требуют расчёта; перегородки остаются ненесущими."
                      : floorInspection
                        ? "Показаны ростверк, лаги, вставки и нижние обвязки стен. Зелёный цвет — усиления; настил 35 мм условный, его прочность и узлы требуют расчёта."
                        : "Показаны шесть физических деталей одной рамы. Крепёж и пространственные связи требуют проектирования."}
              </span>
            </div>
          ) : (
            <div className="engine-layer-bar">
              <div className="engine-plan-modes">
                {[
                  ["architecture", "Планировка"],
                  ["framing", "Каркас"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={planMode === id ? "active" : ""}
                    onClick={() => setPlanMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {[...Array(p.floors ?? 1)].map((_, i) => (
                <button
                  className={level === i + 1 ? "active" : ""}
                  key={i}
                  onClick={() => {
                    setLevel(i + 1);
                    setSelected(null);
                  }}
                >
                  {i + 1} этаж
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="engine-facts-panel">
          {view === "plan" && planMode === "architecture" ? (
            <div className="engine-selection">
              <div className="engine-eyebrow">ЭКСПЛИКАЦИЯ · {level} ЭТАЖ</div>
              <h3>Помещения и расстановка</h3>
              {planAnnotations(report, level).rooms.map((room) => (
                <div className="engine-plan-room" key={room.id}>
                  <span>{room.name}</span>
                  <strong>{fmt(room.area, 2)} м²</strong>
                </div>
              ))}
              <p className="engine-view-hint">
                Чистые полигоны помещений и расстановка заданы в отчёте. Мебель и оборудование — аннотации, их
                масса не включена в расчёт.
              </p>
            </div>
          ) : (
            <SelectionFacts selected={selected} p={p} r={r} />
          )}
          <div className="engine-level-facts">
            <div className="engine-eyebrow">УРОВНИ МОДЕЛИ</div>
            {(r.geometry.levels ?? []).map((l) => (
              <div key={l.index}>
                <strong>{l.name ?? `${l.index} этаж`}</strong>
                <span>{fmt(l.netFloorArea ?? l.area)} м²</span>
                <small>
                  Верх стен {fmt(l.topY, 3)} м · высота {fmt(l.height)} м
                </small>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <SpatialSummary report={report} />
      <div className="engine-overview-bottom">
        <div className="engine-summary-note">
          <div className="engine-eyebrow">ЧАСТНЫЕ ПРОВЕРКИ</div>
          <strong>
            {failCount
              ? `${failCount} превышений требуют решения`
              : `${unknownCount} условий требуют проверки`}
          </strong>
          <p>
            Проверки элементов и неподтверждённые узлы представлены отдельно. Полный список доступен во
            вкладке «Проверки».
          </p>
        </div>
        <div className="engine-summary-note">
          <div className="engine-eyebrow">ЕДИНЫЙ РЕЕСТР</div>
          <strong>{r.timber.instances.length} физических досок</strong>
          <p>
            {Object.entries(counts)
              .map(([category, count]) => `${categories[category] ?? category}: ${count}`)
              .join(" · ")}
          </p>
        </div>
        <div className="engine-summary-note">
          <div className="engine-eyebrow">ЗАКУПКА ПО РАСКРОЮ</div>
          <strong>{fmt(report.cutting?.summary?.purchasedVolume, 3)} м³ · заготовка 6 м</strong>
          <p>
            {report.cutting?.summary?.complete === false
              ? "Есть неразмещённые детали. Проверьте ограничения в карте раскроя."
              : `Остатки и пропилы ${fmt(report.cutting?.summary?.wastePercent)}%. Значения взяты из отчёта движка.`}
          </p>
        </div>
      </div>
    </>
  );
}

export function ChecksView({ report }) {
  const [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1);
  const checks = report.result.checks ?? [];
  const filtered = checks.filter(
    (c) =>
      filter === "all" ||
      (filter === "fail" && c.status === "fail") ||
      (filter === "pass" && c.status === "pass") ||
      (filter === "pending" && !["fail", "pass"].includes(c.status)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 16)),
    current = Math.min(page, pages);
  const count = (key) =>
    key === "all"
      ? checks.length
      : checks.filter((c) => (key === "pending" ? !["fail", "pass"].includes(c.status) : c.status === key))
          .length;
  return (
    <div className="engine-report-section">
      <div className="engine-section-heading">
        <div>
          <div className="engine-eyebrow">РАСЧЁТНЫЕ УСЛОВИЯ И УЗЛЫ</div>
          <h2>Проверки модели</h2>
          <p>
            Статусы и численные результаты получены от движка. Неподтверждённые условия остаются видимыми.
          </p>
        </div>
      </div>
      <div className="engine-filter-tabs">
        {[
          ["all", "Все"],
          ["fail", "Превышения"],
          ["pending", "Требует проверки"],
          ["pass", "В пределах"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            onClick={() => {
              setFilter(key);
              setPage(1);
            }}
          >
            {label}
            <small>{count(key)}</small>
          </button>
        ))}
      </div>
      <div className="engine-check-list">
        {filtered.slice((current - 1) * 16, current * 16).map((c, i) => (
          <details key={`${c.id}-${i}`} className={`engine-check ${statusClass(c.status)}`}>
            <summary>
              <span className="engine-check-symbol">
                {c.status === "fail" ? "!" : c.status === "pass" ? "✓" : "·"}
              </span>
              <span className="engine-check-title">
                {human(c.label ?? c.name ?? c.id, report.project)}
                {finite(c.value) && (
                  <small>
                    {fmt(c.value, 3)}
                    {finite(c.limit) ? ` / ${fmt(c.limit, 3)}` : ""} {c.unit ?? ""}
                  </small>
                )}
              </span>
              <span className={`engine-badge ${statusClass(c.status)}`}>{statusLabel(c.status)}</span>
            </summary>
            <div className="engine-check-body">
              {c.note && <p>{human(c.note, report.project)}</p>}
              {finite(c.utilization) && <p>Использовано {fmt(c.utilization * 100)}% заданного предела.</p>}
              <code>{c.id}</code>
            </div>
          </details>
        ))}
        {!filtered.length && <div className="engine-empty">В выбранной группе нет проверок.</div>}
      </div>
      <Pager page={current} pages={pages} total={filtered.length} onChange={setPage} label="проверок" />
      <details className="engine-method-details">
        <summary>Допущения и замечания отчёта</summary>
        {(report.result.warnings ?? []).map((note, i) => (
          <p key={`w${i}`}>{human(note, report.project)}</p>
        ))}
        {(report.result.assumptions ?? []).map((note, i) => (
          <p key={`a${i}`}>{note}</p>
        ))}
      </details>
    </div>
  );
}

export function MaterialsView({ report }) {
  const [category, setCategory] = useState("all"),
    [page, setPage] = useState(1),
    [subtab, setSubtab] = useState("boards"),
    [sheetPage, setSheetPage] = useState(1);
  const r = report.result,
    rows = r.timber.schedule ?? [],
    types = [...new Set(rows.map((row) => row.category))];
  const filtered = rows.filter((row) => category === "all" || row.category === category),
    pages = Math.max(1, Math.ceil(filtered.length / 20)),
    current = Math.min(page, pages);
  const sheets = useMemo(() => {
    const map = new Map();
    for (const panel of r.bracingModel?.panels ?? []) {
      const id = panel.stockSheetId ?? panel.id,
        group = map.get(id) ?? { id, wallId: panel.wallId, level: panel.level, area: 0 };
      group.area += panel.area ?? 0;
      map.set(id, group);
    }
    return [...map.values()];
  }, [r]);
  const sheetPages = Math.max(1, Math.ceil(sheets.length / 20)),
    sheetCurrent = Math.min(sheetPage, sheetPages);
  return (
    <div className="engine-report-section">
      <div className="engine-section-heading">
        <div>
          <div className="engine-eyebrow">ФАКТИЧЕСКИЕ ОБЪЁМЫ</div>
          <h2>Материалы и элементы</h2>
          <p>
            Доски сгруппированы по назначению, сечению и длине. Листовые материалы показаны по исходным
            листам.
          </p>
        </div>
      </div>
      <div className="engine-mini-counters">
        <Counter label="Древесина в модели" value={fmt(r.timber.volume, 3)} unit="м³" />
        <Counter label="Масса древесины" value={fmt(r.timber.mass, 0)} unit="кг" />
        <Counter label="Плиты к закупке" value={sheets.length} unit="листов" />
        <Counter label="Масса плит" value={fmt(r.bracingModel?.quantities?.panelMass, 0)} unit="кг" />
      </div>
      <div className="engine-filter-tabs">
        <button className={subtab === "boards" ? "active" : ""} onClick={() => setSubtab("boards")}>
          Доски
        </button>
        <button className={subtab === "sheets" ? "active" : ""} onClick={() => setSubtab("sheets")}>
          Листовые материалы
        </button>
      </div>
      {subtab === "boards" ? (
        <>
          <div className="engine-category-chips">
            {["all", ...types].map((key) => (
              <button
                key={key}
                className={category === key ? "active" : ""}
                onClick={() => {
                  setCategory(key);
                  setPage(1);
                }}
              >
                {key === "all" ? "Все элементы" : (categories[key] ?? key)}
              </button>
            ))}
          </div>
          <div className="engine-table-card">
            <table>
              <thead>
                <tr>
                  <th>Элемент</th>
                  <th>Сечение</th>
                  <th>Длина</th>
                  <th>Количество</th>
                  <th>Объём</th>
                  <th>Масса</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((current - 1) * 20, current * 20).map((row, i) => (
                  <tr key={`${row.id}-${i}`}>
                    <td>
                      {row.name}
                      <small>{categories[row.category] ?? row.category}</small>
                    </td>
                    <td>{row.b && row.h ? `${row.b} × ${row.h}` : row.section} мм</td>
                    <td>{fmt(row.length, 3)} м</td>
                    <td>{row.count} шт.</td>
                    <td>{fmt(row.volume, 4)} м³</td>
                    <td>{fmt(row.mass ?? row.totalMass)} кг</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={current} pages={pages} total={filtered.length} onChange={setPage} />
        </>
      ) : (
        <div className="engine-table-card">
          <table>
            <thead>
              <tr>
                <th>Лист</th>
                <th>Стена</th>
                <th>Этаж</th>
                <th>Чистая площадь</th>
              </tr>
            </thead>
            <tbody>
              {sheets.slice((sheetCurrent - 1) * 20, sheetCurrent * 20).map((sheet, i) => (
                <tr key={sheet.id}>
                  <td title={sheet.id}>Лист {(sheetCurrent - 1) * 20 + i + 1}</td>
                  <td>Стена {report.project.walls.findIndex((w) => w.id === sheet.wallId) + 1}</td>
                  <td>{sheet.level}</td>
                  <td>{fmt(sheet.area, 3)} м²</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "0 14px 14px" }}>
            <Pager
              page={sheetCurrent}
              pages={sheetPages}
              total={sheets.length}
              onChange={setSheetPage}
              label="листов"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FabricationParts({ report }) {
  const [page, setPage] = useState(1),
    [section, setSection] = useState("all"),
    groups = report.fabrication.partGroups,
    types = [...new Set(groups.map((g) => g.section))],
    filtered = groups.filter((g) => section === "all" || g.section === section),
    pages = Math.max(1, Math.ceil(filtered.length / 12)),
    current = Math.min(page, pages);
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
    a.role;
  return (
    <div className="engine-fabrication-parts">
      <div className="engine-section-heading">
        <div>
          <div className="engine-eyebrow">ОДНА СХЕМА НА ОДИНАКОВЫЕ ДЕТАЛИ</div>
          <h2>Типы деталей и применение</h2>
          <p>
            {groups.length} типов на {report.fabrication.summary.physicalParts} физических деталей. Разные
            запилы и выборки остаются разными типами.
          </p>
        </div>
      </div>
      <div className="engine-category-chips">
        {["all", ...types].map((type) => (
          <button
            key={type}
            className={section === type ? "active" : ""}
            onClick={() => {
              setSection(type);
              setPage(1);
            }}
          >
            {type === "all" ? "Все сечения" : type.replace("x", " × ") + " мм"}
          </button>
        ))}
      </div>
      <div className="engine-table-card">
        <table>
          <thead>
            <tr>
              <th>Марка / сечение</th>
              <th>Заготовка / ось</th>
              <th>Количество</th>
              <th>Запилы</th>
              <th>Где используется</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice((current - 1) * 12, current * 12).map((group) => (
              <tr key={group.id}>
                <td>
                  <strong>{group.id}</strong>
                  <small>{group.section.replace("x", " × ")} мм</small>
                </td>
                <td>
                  {fmt(group.cutLength, 3)} м<small>ось {fmt(group.axisLength, 3)} м</small>
                </td>
                <td>{group.count} шт.</td>
                <td>
                  {formatEndCut(group.geometry.cutStart)}
                  <small>
                    {formatEndCut(group.geometry.cutEnd)} · выборок {group.geometry.notches?.length ?? 0}
                  </small>
                </td>
                <td>
                  <details>
                    <summary>Применение · {group.applications.length} поз.</summary>
                    {group.applications.map((application, i) => (
                      <p key={i}>
                        {human(place(application), report.project)} · {application.count} шт.
                        <small>{application.name ?? application.role}</small>
                      </p>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={current} pages={pages} total={filtered.length} onChange={setPage} label="типов деталей" />
    </div>
  );
}

function StockCard({ stock, index }) {
  return (
    <article className="engine-stock">
      <div className="engine-stock-head">
        <h3>
          {stock.pattern ? `Схема ${stock.id} · × ${stock.count}` : `Заготовка ${index + 1}`}
          <small>{stock.section.replace("x", " × ")} мм · 6 м</small>
        </h3>
        <span>
          Остаток {fmt(stock.remainder, 3)} м{stock.reusable ? " · пригоден от 0,30 м" : ""}
        </span>
      </div>
      <div className="engine-stock-bar">
        {stock.pieces.map((piece, i) => (
          <div
            key={piece.id}
            className="engine-stock-piece"
            style={{
              left: `${(piece.cutStart / 6) * 100}%`,
              width: `${(piece.length / 6) * 100}%`,
              background: ["#d0b68d", "#ddcaab", "#bda782", "#d5c39e"][i % 4],
            }}
            title={`${piece.id} · ${piece.name} · ${fmt(piece.length, 3)} м`}
          >
            {piece.length > 0.45 && (
              <>
                <strong>{piece.displayId ?? piece.id}</strong>
                <small>{fmt(piece.length, 3)} м</small>
              </>
            )}
          </div>
        ))}
        {stock.remainder > 1e-8 && (
          <div
            className="engine-stock-tail"
            style={{ left: `${(stock.consumed / 6) * 100}%`, width: `${(stock.remainder / 6) * 100}%` }}
          />
        )}
      </div>
      <div className="engine-stock-foot">
        <span>Детали {fmt(stock.used, 3)} м</span>
        <span>Пропилы {fmt(stock.kerfWaste * 1000, 0)} мм</span>
      </div>
      {stock.pattern && <p className="engine-pattern-uses">Заготовки: {stock.stockIds.join(", ")}</p>}
      <details>
        <summary>Детали, позиции и торцы</summary>
        <div className="engine-stock-detail-table">
          <table>
            <thead>
              <tr>
                <th>Деталь</th>
                <th>Длина / позиция, м</th>
                <th>Начало</th>
                <th>Конец</th>
              </tr>
            </thead>
            <tbody>
              {stock.pieces.map((piece) => (
                <tr key={piece.id}>
                  <td>
                    {piece.displayId ?? piece.id}
                    <small>{piece.name}</small>
                  </td>
                  <td>
                    {fmt(piece.length, 3)}
                    <small>
                      {fmt(piece.cutStart, 3)}–{fmt(piece.cutEnd, 3)}
                    </small>
                  </td>
                  <td>{formatEndCut(piece.endStart)}</td>
                  <td>{formatEndCut(piece.endEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export function CuttingView({ report }) {
  const c = report.cutting,
    [section, setSection] = useState("all"),
    [page, setPage] = useState(1),
    [printError, setPrintError] = useState("");
  if (!c) return <div className="engine-empty">Карта раскроя отсутствует в отчёте.</div>;
  const patterns = report.fabrication?.patternGroups,
    partMap = new Map((report.fabrication?.partGroups ?? []).map((g) => [g.id, g]));
  const stocks = patterns
      ? patterns.map((g) => ({
          ...g,
          pattern: true,
          pieces: g.pieces.map((piece, i) => {
            const p = partMap.get(piece.partGroupId);
            return {
              ...piece,
              id: piece.partGroupId + "-" + i,
              displayId: piece.partGroupId,
              name: piece.partGroupId,
              cutStart: piece.start,
              cutEnd: piece.end,
              endStart: p?.geometry.cutStart,
              endEnd: p?.geometry.cutEnd,
            };
          }),
        }))
      : (c.stocks ?? []),
    types = [...new Set(stocks.map((s) => s.section))],
    filtered = stocks.filter((s) => section === "all" || s.section === section),
    pages = Math.max(1, Math.ceil(filtered.length / 8)),
    current = Math.min(page, pages),
    s = c.summary ?? {};
  function print() {
    const win = window.open("", "_blank");
    if (!win) {
      setPrintError("Браузер заблокировал страницу печати. Разрешите её открытие для полной карты.");
      return;
    }
    win.document.open();
    win.document.write(cuttingToPrintHTML(c, report.project.name, report.fabrication));
    win.document.close();
    win.focus();
  }
  return (
    <div className="engine-report-section">
      <div className="engine-section-heading">
        <div>
          <div className="engine-eyebrow">ВСЕ ДЕТАЛИ ИЗ ЗАГОТОВОК 6 М</div>
          <h2>Карта раскроя по схемам</h2>
          <p>
            {s.optimal
              ? "Число заготовок минимально в принятой модели пропила."
              : "Найденная раскладка; глобальная оптимальность не доказана."}{" "}
            Пропил между деталями {fmt(c.kerfMM)} мм.
          </p>
        </div>
        <button className="engine-button" onClick={print}>
          <Icon name="file" size={16} />
          Полная карта / печать
        </button>
      </div>
      <div className="engine-mini-counters">
        <Counter label="Заготовок по 6 м" value={s.boards ?? stocks.length} unit="шт." />
        <Counter label="Объём закупки" value={fmt(s.purchasedVolume, 3)} unit="м³" />
        <Counter label="Остатки и пропилы" value={fmt(s.wastePercent)} unit="%" />
        <Counter label="Пригодные остатки" value={fmt(s.reusableLength)} unit="м" />
      </div>
      {(c.overlength?.length > 0 || c.invalid?.length > 0) && (
        <div className="engine-alert">
          <strong>Неразмещённых деталей: {(c.overlength?.length ?? 0) + (c.invalid?.length ?? 0)}.</strong>{" "}
          Они не входят в закупочную карту.
          <details>
            <summary>Показать ограничения</summary>
            {[...(c.overlength ?? []), ...(c.invalid ?? [])].map((piece, i) => (
              <p key={`${piece.id}-${i}`}>
                {piece.id} · {fmt(piece.length, 3)} м · {piece.reason}
              </p>
            ))}
          </details>
        </div>
      )}
      {printError && (
        <div className="engine-alert" role="status">
          {printError}
        </div>
      )}
      <div className="engine-category-chips">
        {["all", ...types].map((key) => (
          <button
            key={key}
            className={section === key ? "active" : ""}
            onClick={() => {
              setSection(key);
              setPage(1);
            }}
          >
            {key === "all" ? "Все сечения" : key.replace("x", " × ") + " мм"}
          </button>
        ))}
      </div>
      {filtered.slice((current - 1) * 8, current * 8).map((stock) => (
        <StockCard key={stock.id} stock={stock} index={stocks.indexOf(stock)} />
      ))}
      <Pager
        page={current}
        pages={pages}
        total={filtered.length}
        onChange={setPage}
        label={patterns ? "схем раскроя" : "заготовок"}
      />
      {report.fabrication && <FabricationParts report={report} />}
      <details className="engine-method-details">
        <summary>Допущения карты раскроя</summary>
        {(c.assumptions ?? []).map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </details>
    </div>
  );
}

export function EstimateView({ report }) {
  const e = report.estimate,
    symbol = e?.currency === "EUR" ? "€" : e?.currency === "USD" ? "$" : "₽",
    amount = (n) => `${fmt(n, 0)} ${symbol}`;
  if (!e) return <div className="engine-empty">Смета отсутствует в отчёте.</div>;
  return (
    <div className="engine-report-section">
      <div className="engine-section-heading">
        <div>
          <div className="engine-eyebrow">ОБЪЁМЫ И РАСЦЕНКИ ИЗ ОТЧЁТА</div>
          <h2>Смета проекта</h2>
          <p>Количество, цена и итог представлены для просмотра. Расценки и параметры меняются через MCP.</p>
        </div>
        <div className="engine-budget">
          <span>{e.complete === false ? "Учтённая часть сметы" : "Итого по отчёту"}</span>
          <strong>{amount(e.total)}</strong>
        </div>
      </div>
      {e.complete === false && (
        <div className="engine-alert">
          Смета неполная. Ограничения геометрии или раскроя перечислены в отчёте; итог относится к учтённым
          позициям.
        </div>
      )}
      <div className="engine-mini-counters">
        <Counter label="Материалы" value={fmt(e.materialTotal ?? e.materialsTotal, 0)} unit={symbol} />
        <Counter label="Работы" value={fmt(e.laborTotal, 0)} unit={symbol} />
        <Counter label="Резерв" value={fmt(e.reserve, 0)} unit={symbol} />
        <Counter label="Древесина к закупке" value={fmt(e.procurementTimberVolume, 3)} unit="м³" />
      </div>
      <div className="engine-table-card">
        <table>
          <thead>
            <tr>
              <th>Позиция</th>
              <th>Количество</th>
              <th>Единица</th>
              <th>Цена, {symbol}/ед.</th>
              <th>Сумма, {symbol}</th>
            </tr>
          </thead>
          <tbody>
            {(e.rows ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  {row.name}
                  {row.note && <small>{row.note}</small>}
                </td>
                <td>{fmt(row.quantity, 3)}</td>
                <td>{row.unit}</td>
                <td>{fmt(row.unitPrice, 0)}</td>
                <td className="engine-money">{fmt(row.total, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="engine-estimate-totals">
        <div>
          <span>Материалы</span>
          <strong>{amount(e.materialTotal ?? e.materialsTotal)}</strong>
        </div>
        <div>
          <span>Работы</span>
          <strong>{amount(e.laborTotal)}</strong>
        </div>
        <div>
          <span>Резерв</span>
          <strong>{amount(e.reserve)}</strong>
        </div>
        <div>
          <span>Итого</span>
          <strong>{amount(e.total)}</strong>
        </div>
      </div>
      <details className="engine-method-details">
        <summary>Расценки, состав и допущения сметы</summary>
        {(e.assumptions ?? []).map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </details>
    </div>
  );
}

export function readReport(data) {
  if (
    !data ||
    typeof data !== "object" ||
    !data.project ||
    !data.result ||
    !Array.isArray(data.project.walls) ||
    !Array.isArray(data.result.timber?.instances) ||
    !data.result.geometry?.bounds
  )
    throw Error("В JSON отсутствуют проект, геометрия или реестр физических досок.");
  const p = {
    ...data.project,
    openings: data.project.openings ?? [],
    voids: data.project.voids ?? [],
    foundation: data.project.foundation ?? {},
    roof: data.project.roof ?? {},
  };
  return { ...data, project: p };
}

export function EngineViewer() {
  const [report, setReport] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [tab, setTab] = useState(() =>
      ["#appearance", "#source"].includes(window.location.hash) ? window.location.hash.slice(1) : "overview",
    );
  const [projectIndex, setProjectIndex] = useState(null),
    [source, setSource] = useState(null);
  const projectKey = new URLSearchParams(window.location.search).get("project") ?? "noginsk";
  const currentProject = projectIndex?.projects?.find((p) => p.key === projectKey);
  const assetBase = currentProject?.assetBase ?? "";
  const [publication, setPublication] = useState(null);
  const [appearance, setAppearance] = useState(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/appearance/chinese-v1.json", { signal: abort.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setAppearance)
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/projects/index.json", { signal: abort.signal, cache: "no-store" })
      .then((r) =>
        r.ok ? r.json() : { projects: [{ key: "noginsk", name: "Ногинск · 6×10", assetBase: "" }] },
      )
      .then(setProjectIndex)
      .catch((e) => {
        if (e.name !== "AbortError")
          setProjectIndex({ projects: [{ key: "noginsk", name: "Ногинск · 6×10", assetBase: "" }] });
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!currentProject) return;
    const abort = new AbortController();
    fetch(assetBase + "/release-manifest.json", { signal: abort.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setPublication)
      .catch(() => {});
    if (currentProject.sourceUrl)
      fetch(currentProject.sourceUrl, { signal: abort.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then(setSource)
        .catch(() => {});
    else setSource(null);
    return () => abort.abort();
  }, [currentProject, assetBase]);
  useEffect(() => {
    if (!projectIndex) return;
    if (!currentProject) {
      setError("Такого проекта нет в каталоге. Выберите проект из списка.");
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError("");
    fetch(assetBase + "/engine-report.json", { cache: "no-store", signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw Error(`Отчёт недоступен: HTTP ${response.status}.`);
        return response.json();
      })
      .then((data) => {
        const checked = readReport(data);
        if (currentProject.projectId && checked.engine.projectId !== currentProject.projectId)
          throw Error("Отчёт не соответствует выбранному проекту.");
        setReport(checked);
        setLoading(false);
        if (currentProject.key !== "noginsk" && tab === "appearance") setTab("overview");
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e.message ?? "Не удалось загрузить отчёт.");
        setLoading(false);
      });
    return () => abort.abort();
  }, [revision, projectIndex, currentProject, assetBase]);
  const refresh = () => setRevision((v) => v + 1);
  const engine = report?.engine ?? {},
    p = report?.project,
    r = report?.result;
  const generated =
    engine.generatedAt && Number.isFinite(new Date(engine.generatedAt).getTime())
      ? new Date(engine.generatedAt).toLocaleString("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "Europe/Moscow",
        })
      : null;
  const failed = (r?.checks ?? []).filter((c) => c.status === "fail").length;
  return (
    <div className="engine-viewer">
      <header className="engine-topbar">
        <div className="engine-brand">
          <svg width="30" height="32" viewBox="0 0 32 34" fill="none" aria-hidden="true">
            <path
              d="M4 29V11L16 4l12 7v18M4 11l12 7 12-7M16 18v15M4 29l12-7 12 7"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
          <div>
            КАРКАС <strong>ENGINE</strong>
            <small>MCP · РАСЧЁТНАЯ МОДЕЛЬ</small>
          </div>
        </div>
        <div className="engine-project-title">
          {p?.name ?? "Просмотр инженерного отчёта"}
          <small>
            {generated ? `Отчёт от ${generated}` : "Источник: engine-report.json"}
            {engine.revision !== undefined ? ` · ревизия ${engine.revision}` : ""}
          </small>
        </div>
        <div className="engine-top-actions">
          <span className="engine-version">{engine.version ? `v${engine.version}` : "MCP"}</span>
          {report && (
            <button
              className="engine-top-button"
              onClick={() => download("karkas-engine-report.json", JSON.stringify(report, null, 2))}
            >
              <Icon name="file" size={15} />
              JSON отчёта
            </button>
          )}
          <button
            className={`engine-top-button ${loading ? "loading" : ""}`}
            disabled={loading}
            onClick={refresh}
          >
            <Icon name="refresh" size={16} />
            <span>{loading ? "Загрузка…" : "Обновить отчёт"}</span>
          </button>
        </div>
      </header>
      {projectIndex?.projects?.length > 1 && (
        <div className="engine-project-picker">
          <label htmlFor="house-project">Проект дома</label>
          <select
            id="house-project"
            value={projectKey}
            onChange={(e) =>
              window.location.assign(
                e.target.value === "noginsk" ? "/" : "/?project=" + encodeURIComponent(e.target.value),
              )
            }
          >
            {projectIndex.projects.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
          </select>
          <span>Каждый вариант хранится отдельно</span>
        </div>
      )}
      {report && (
        <div className="engine-revision-line">
          <span>СНИМОК МОДЕЛИ</span>
          <strong>{p.name}</strong>
          <span>Ревизия {engine.revision ?? "—"}</span>
          <code title={engine.hash ?? ""}>
            {typeof engine.hash === "string" ? engine.hash.slice(0, 12) : "—"}
          </code>
        </div>
      )}
      <div className="engine-readonly-notice">
        <span className="engine-lock-icon">
          <Icon name="info" size={15} />
        </span>
        <strong>Модель управляется через MCP. Ручное редактирование отключено.</strong>
        <span>Только просмотр отчёта</span>
      </div>
      {source && source.hash === engine.hash && (
        <div className="engine-source-notice">
          <strong>ПЕРЕНОС ПО КР</strong>
          <span>{source.shortNote}</span>
          <button onClick={() => setTab("source")}>Исходник и точность переноса ↗</button>
        </div>
      )}
      {publication && engine.hash && publication.hash === engine.hash && (
        <div className="engine-release-files">
          <span>
            {publication.pdfPages ? "ВЫПУСК КР" : "ЭКСПОРТ МОДЕЛИ"} · R{engine.revision}
          </span>
          {publication.pdfPages && (
            <a
              href={assetBase + "/structural-album.pdf?revision=" + engine.revision}
              target="_blank"
              rel="noreferrer"
            >
              Альбом КР{publication.pdfPages ? ` · ${publication.pdfPages} листов` : ""} · PDF ↗
            </a>
          )}
          <a href={assetBase + "/mcp-session.html"} target="_blank" rel="noreferrer">
            Как MCP создал этот дом ↗
          </a>
          <a href={assetBase + "/fabrication-parts.csv"} download>
            Применение деталей · CSV
          </a>
          <small>Тот же проект и контрольная сумма, что в модели</small>
        </div>
      )}
      {!report ? (
        <main className="engine-start-screen">
          {loading ? (
            <div className="engine-loading-state" role="status">
              <div className="engine-loading-cube">
                <Icon name="cube" size={45} />
              </div>
              <h1>Загружаю расчётную модель</h1>
              <p>Геометрия, проверки, ведомость и раскрой из отчёта движка.</p>
              <div className="engine-loading-line" />
            </div>
          ) : (
            <div className="engine-error-state" role="alert">
              <Icon name="file" size={38} />
              <h1>Не удалось открыть отчёт</h1>
              <p>{error}</p>
              <small>Ожидается локальный файл /engine-report.json с результатом расчёта.</small>
              <button className="engine-button" onClick={refresh}>
                Повторить загрузку
              </button>
            </div>
          )}
        </main>
      ) : (
        <>
          <nav className="engine-navigation" aria-label="Разделы отчёта">
            {[
              ...tabs.filter((t) => t[0] !== "appearance" || projectKey === "noginsk"),
              ...(source ? [["source", "file", "Исходник"]] : []),
            ].map(([id, icon, label]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
              >
                <Icon name={icon} size={18} />
                {label}
                {id === "checks" && failed > 0 && <small>{failed}</small>}
              </button>
            ))}
            <div className="engine-report-state">
              <i />
              {tab === "appearance"
                ? "Архитектурный эскиз"
                : loading
                  ? "Обновляю данные"
                  : "Снимок расчётного движка"}
            </div>
          </nav>
          <main className="engine-main">
            {error && (
              <div className="engine-alert" role="status">
                Не удалось обновить отчёт: {error} Показаны ранее загруженные данные.
              </div>
            )}
            {!["appearance", "source"].includes(tab) && (
              <div className="engine-top-counters">
                <Counter
                  label="Площадь по осям"
                  value={fmt(r.geometry.totalFloorArea, 2)}
                  unit="м²"
                  note={
                    finite(report.summary?.platformArea ?? r.geometry.totalPlatformArea)
                      ? `Настил по граням каркаса: ${fmt(report.summary?.platformArea ?? r.geometry.totalPlatformArea, 2)} м²`
                      : undefined
                  }
                />
                <Counter label="Этажность" value={p.floors} unit={p.floors === 1 ? "этаж" : "этажа"} />
                <Counter label="Физические доски" value={r.timber.instances.length} unit="шт." />
                <Counter label="Масса древесины" value={fmt(r.timber.mass, 0)} unit="кг" />
                <Counter label="Вертикальная нагрузка · расч." value={fmt(r.loads?.totalDesign)} unit="кН" />
                <Counter label="Заготовки по 6 м" value={report.cutting?.summary?.boards ?? "—"} unit="шт." />
              </div>
            )}
            {tab === "overview" ? (
              <Overview key={engine.hash ?? engine.revision ?? revision} report={report} />
            ) : tab === "appearance" ? (
              <AppearanceView report={report} design={appearance} />
            ) : tab === "source" ? (
              <SourceView report={report} source={source} />
            ) : tab === "checks" ? (
              <ChecksView report={report} />
            ) : tab === "materials" ? (
              <MaterialsView report={report} />
            ) : tab === "cutting" ? (
              <CuttingView report={report} />
            ) : (
              <EstimateView report={report} />
            )}
          </main>
          <footer className="engine-footer">
            <span>
              КАРКАС ENGINE {engine.version ?? "4.0"} <i /> Просмотр результатов MCP
            </span>
            <span>м · кН · МПа · кг</span>
            <details>
              <summary>Данные отчёта</summary>
              <div>
                <p>Версия схемы: {engine.schemaVersion ?? "—"}</p>
                <p>Проект: {engine.projectId ?? "—"}</p>
                <p>Ревизия: {engine.revision ?? "—"}</p>
                {engine.hash && <p className="engine-hash">Контрольная сумма: {engine.hash}</p>}
              </div>
            </details>
          </footer>
        </>
      )}
    </div>
  );
}

// Report body (tabs + counters + views) for an in-memory report, used by the
// «Новый дом» wizard and the JSON import. The published-project viewer above keeps
// its own layout with catalog, release files and source tabs.
export function ReportSections({ report, extraTabs = [], renderExtra, stateLabel = "Расчёт в браузере" }) {
  const [tab, setTab] = useState("overview");
  const p = report.project,
    r = report.result;
  const failed = (r?.checks ?? []).filter((c) => c.status === "fail").length;
  const list = [...tabs.filter((t) => t[0] !== "appearance"), ...extraTabs];
  const extra = extraTabs.some((t) => t[0] === tab);
  return (
    <>
      <nav className="engine-navigation" aria-label="Разделы отчёта">
        {list.map(([id, icon, label, badge]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={18} />
            {label}
            {id === "checks" && failed > 0 && <small>{failed}</small>}
            {badge > 0 && <small>{badge}</small>}
          </button>
        ))}
        <div className="engine-report-state">
          <i />
          {stateLabel}
        </div>
      </nav>
      <main className="engine-main">
        {!extra && (
          <div className="engine-top-counters">
            <Counter
              label="Площадь по осям"
              value={fmt(r.geometry.totalFloorArea, 2)}
              unit="м²"
              note={
                finite(report.summary?.platformArea ?? r.geometry.totalPlatformArea)
                  ? `Настил по граням каркаса: ${fmt(report.summary?.platformArea ?? r.geometry.totalPlatformArea, 2)} м²`
                  : undefined
              }
            />
            <Counter label="Этажность" value={p.floors} unit={p.floors === 1 ? "этаж" : "этажа"} />
            <Counter label="Физические доски" value={r.timber.instances.length} unit="шт." />
            <Counter label="Масса древесины" value={fmt(r.timber.mass, 0)} unit="кг" />
            <Counter label="Вертикальная нагрузка · расч." value={fmt(r.loads?.totalDesign)} unit="кН" />
            <Counter label="Заготовки по 6 м" value={report.cutting?.summary?.boards ?? "—"} unit="шт." />
          </div>
        )}
        {extra ? (
          renderExtra?.(tab)
        ) : tab === "overview" ? (
          <Overview key={report.engine?.hash} report={report} />
        ) : tab === "checks" ? (
          <ChecksView report={report} />
        ) : tab === "materials" ? (
          <MaterialsView report={report} />
        ) : tab === "cutting" ? (
          <CuttingView report={report} />
        ) : (
          <EstimateView report={report} />
        )}
      </main>
    </>
  );
}

export default EngineViewer;

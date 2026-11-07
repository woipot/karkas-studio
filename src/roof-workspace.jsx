import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { autoRoofZones } from "./roof-zones.js";
import { trussTypes } from "./trusses.js";
import TrussDiagram from "./truss-panel.jsx";
import RafterPanel from "./rafter-panel.jsx";
import WallProfilePanel from "./wall-profile-panel.jsx";
import { SectionSelect } from "./estimate.jsx";

const fmt = (n, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—";
const palette = ["#a1c679", "#d5b47f", "#83b5b4", "#b3a2c5", "#b9c782", "#b29a7c"];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const polygonArea = (points) =>
  Math.abs(
    points.reduce((v, p, i) => {
      const q = points[(i + 1) % points.length];
      return v + p.x * q.y - p.y * q.x;
    }, 0),
  ) / 2;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function validPolygon(points) {
  if (points.length < 3 || polygonArea(points) < 0.1) return false;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) if (distance(points[i], points[j]) < 0.05) return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (distance(a, b) < 0.05) return false;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (cross(a, b, c) * cross(a, b, d) < -1e-10 && cross(c, d, a) * cross(c, d, b) < -1e-10) return false;
    }
  }
  return true;
}
const newId = () =>
  `roof-${globalThis.crypto?.randomUUID?.().slice(0, 10) ?? Math.random().toString(36).slice(2, 12)}`;

function zoneDefinition(zone, roof, index = 0) {
  const shape = zone.shape ?? "gable";
  const requestedType = zone.trussType ?? roof.type;
  const trussType = ["king", "queen", "fink", "mono"].includes(requestedType) ? requestedType : "fink";
  return {
    id: zone.id ?? `roof-zone-${index + 1}`,
    name: zone.name ?? `Зона ${index + 1}`,
    polygon: (zone.polygon ?? []).map((q) => ({ x: q.x, y: q.y })),
    shape,
    ridgeAngle: zone.ridgeAngle ?? 0,
    pitchLeft: zone.pitchLeft ?? roof.pitch ?? 25,
    pitchRight: zone.pitchRight ?? roof.pitch ?? 25,
    elevation: zone.elevation ?? null,
    trussType,
    framing: zone.framing ?? "auto",
    deflectionRatio: zone.deflectionRatio ?? 300,
    ...(zone.levelIndex === undefined ? {} : { levelIndex: zone.levelIndex }),
    spacing: zone.spacing ?? roof.spacing ?? 0.6,
    chordSection: zone.chordSection ?? roof.chordSection ?? "50x150",
    webSection: zone.webSection ?? roof.webSection ?? "50x100",
  };
}

function RoofNumber({ label, value, onCommit, unit, min = 0, max = 1000, disabled = false }) {
  const [text, setText] = useState(String(value ?? "")),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(value ?? ""));
    setInvalid(false);
  }, [value]);
  function commit() {
    const next = Number(text.replace(",", "."));
    if (!text.trim() || !Number.isFinite(next) || next < min || next > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value && onCommit?.(next) === false) setText(String(value));
  }
  return (
    <label className={`roof-field ${disabled ? "disabled" : ""}`}>
      <span>{label}</span>
      <div className={invalid ? "invalid" : ""}>
        <input
          aria-label={label}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              setText(String(value ?? ""));
              setInvalid(false);
            }
          }}
        />
        {unit && <i>{unit}</i>}
      </div>
      {invalid && (
        <small role="status">
          От {min} до {max}
        </small>
      )}
    </label>
  );
}

function ZonePlan({
  project,
  result,
  zones,
  model,
  selected,
  drawing,
  draft,
  onSelect,
  onPoint,
  onClose,
  cursor,
  setCursor,
  showPoints,
}) {
  const svg = useRef();
  const clipId = useId().replaceAll(":", "");
  const house = result.geometry?.polygon ?? [];
  const levels = (result.geometry?.levels ?? []).filter((l) => l.closed && l.polygon?.length >= 3);
  const all = [
    ...house,
    ...levels.flatMap((l) => l.polygon),
    ...zones.flatMap((z) => z.polygon ?? []),
    ...draft,
  ];
  const minX = all.length ? Math.min(...all.map((q) => q.x)) : 0,
    minY = all.length ? Math.min(...all.map((q) => q.y)) : 0;
  const maxX = all.length ? Math.max(...all.map((q) => q.x)) : 12,
    maxY = all.length ? Math.max(...all.map((q) => q.y)) : 8;
  const w = Math.max(8, maxX - minX),
    h = Math.max(6, maxY - minY),
    pad = Math.max(w, h) * 0.12;
  const scale = Math.max(w, h) / 12;
  const points = (poly) => poly.map((q) => `${q.x},${q.y}`).join(" ");
  const modelZones = model?.zones ?? [];
  function point(e) {
    const q = svg.current.createSVGPoint();
    q.x = e.clientX;
    q.y = e.clientY;
    const pt = q.matrixTransform(svg.current.getScreenCTM().inverse());
    const grid = project.grid || 0.25;
    let at = { x: Math.round(pt.x / grid) * grid, y: Math.round(pt.y / grid) * grid };
    const candidates = [...house, ...draft];
    const nearest = candidates
      .filter((p) => distance(p, at) < 0.2 * scale)
      .sort((a, b) => distance(a, at) - distance(b, at))[0];
    if (nearest) at = { ...nearest };
    return { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 };
  }
  return (
    <div className={`roof-plan-wrap ${drawing ? "drawing" : ""}`}>
      <div className="roof-plan-caption">
        <span>{drawing ? "НОВАЯ ЗОНА · НАЖМИТЕ ВЕРШИНЫ" : "ПЛАН КРОВЕЛЬНЫХ ЗОН"}</span>
        <small>
          {drawing
            ? "Enter — завершить · Esc — отмена"
            : "Цвет — зона · пунктир — конёк · стрелка — его направление"}
        </small>
      </div>
      <svg
        ref={svg}
        viewBox={`${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`}
        role="group"
        aria-label="Кровельные зоны на контуре дома"
        className="roof-zone-plan"
        onPointerDown={(e) => {
          if (!drawing || e.button !== 0) return;
          e.preventDefault();
          const p = point(e);
          if (draft.length >= 3 && distance(p, draft[0]) < 0.15 * scale) onClose();
          else onPoint(p);
        }}
        onPointerMove={(e) => {
          if (drawing) setCursor(point(e));
        }}
        onPointerLeave={() => setCursor(null)}
      >
        <defs>
          <pattern id={`roof-grid-${clipId}`} width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M1 0H0V1" stroke="#dae2d0" strokeWidth={0.012 * scale} fill="none" />
          </pattern>
          <marker
            id={`roof-arrow-${clipId}`}
            markerWidth="5"
            markerHeight="5"
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 8 4 0 8Z" fill="#526d44" />
          </marker>
          {zones.map((z) => (
            <clipPath id={`${clipId}-${z.id}`} key={z.id}>
              <polygon points={points(z.polygon)} />
            </clipPath>
          ))}
        </defs>
        <rect x={minX - pad} y={minY - pad} width={w + 2 * pad} height={h + 2 * pad} fill="#f0f4e9" />
        <rect
          x={minX - pad}
          y={minY - pad}
          width={w + 2 * pad}
          height={h + 2 * pad}
          fill={`url(#roof-grid-${clipId})`}
        />
        {house.length > 2 && (
          <polygon points={points(house)} fill="#fafcf6" stroke="#667e52" strokeWidth={0.045 * scale} />
        )}
        {levels.slice(1).map((l, i) => (
          <polygon
            key={l.index ?? i}
            points={points(l.polygon)}
            fill="none"
            stroke="#719b98"
            strokeWidth={0.035 * scale}
            strokeDasharray={`${0.12 * scale} ${0.07 * scale}`}
            pointerEvents="none"
          />
        ))}
        {zones.map((zone, index) => {
          const active = zone.id === selected,
            color = palette[index % palette.length];
          const xs = zone.polygon.map((p) => p.x),
            ys = zone.polygon.map((p) => p.y);
          const center = {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
          };
          const angle = (zone.ridgeAngle * Math.PI) / 180,
            len = Math.max(
              1,
              Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.58,
            );
          const actual = modelZones.find((z) => z.id === zone.id),
            ridges = (model?.ridges ?? []).filter((r) => r.zoneId === zone.id);
          if (!ridges.length && actual?.ridge?.start) ridges.push(actual.ridge);
          return (
            <g
              key={zone.id}
              className="roof-zone-click"
              role="button"
              aria-label={`${zone.name}, зона кровли`}
              tabIndex={drawing ? -1 : 0}
              onPointerDown={(e) => {
                if (!drawing) {
                  e.stopPropagation();
                  onSelect(zone.id);
                }
              }}
              onKeyDown={(e) => {
                if (!drawing && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(zone.id);
                }
              }}
            >
              <polygon
                points={points(zone.polygon)}
                fill={color + (active ? "80" : "43")}
                stroke={active ? "#5b803f" : color}
                strokeWidth={(active ? 0.07 : 0.035) * scale}
                strokeLinejoin="round"
              />
              <g clipPath={`url(#${clipId}-${zone.id})`} pointerEvents="none">
                {ridges.map((ridge, i) => (
                  <line
                    key={i}
                    x1={ridge.start[0]}
                    y1={ridge.start[2]}
                    x2={ridge.end[0]}
                    y2={ridge.end[2]}
                    stroke="#5d7749"
                    strokeWidth={0.035 * scale}
                    strokeDasharray={`${0.12 * scale} ${0.06 * scale}`}
                  />
                ))}
                <line
                  x1={center.x - (Math.cos(angle) * len) / 2}
                  y1={center.y - (Math.sin(angle) * len) / 2}
                  x2={center.x + (Math.cos(angle) * len) / 2}
                  y2={center.y + (Math.sin(angle) * len) / 2}
                  stroke="#526d44"
                  strokeWidth={0.018 * scale}
                  markerEnd={`url(#roof-arrow-${clipId})`}
                />
              </g>
              <text
                x={center.x}
                y={center.y - 0.2 * scale}
                textAnchor="middle"
                fontSize={0.2 * scale}
                fill="#4c6740"
                stroke="#f6f9ee"
                strokeWidth={0.065 * scale}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {zone.name}
              </text>
              <text
                x={center.x}
                y={center.y + 0.27 * scale}
                textAnchor="middle"
                fontSize={0.15 * scale}
                fill="#70875c"
                stroke="#f6f9ee"
                strokeWidth={0.055 * scale}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {fmt(zone.ridgeAngle, 0)}° · {fmt(zone.pitchLeft, 0)}°
                {zone.shape === "gable" ? ` / ${fmt(zone.pitchRight, 0)}°` : ""}
              </text>
              {active &&
                showPoints &&
                zone.polygon.map((p, i) => (
                  <g key={i} pointerEvents="none">
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={0.09 * scale}
                      fill="#f9fff1"
                      stroke="#68894b"
                      strokeWidth={0.025 * scale}
                    />
                    <text
                      x={p.x + 0.14 * scale}
                      y={p.y - 0.14 * scale}
                      fontSize={0.15 * scale}
                      fill="#66834a"
                    >
                      {i + 1}
                    </text>
                  </g>
                ))}
            </g>
          );
        })}
        {result.walls
          ?.filter((w) => w.kind === "exterior")
          .map((wall) => (
            <line
              key={wall.id}
              x1={wall.a.x}
              y1={wall.a.y}
              x2={wall.b.x}
              y2={wall.b.y}
              stroke="#617a4f"
              strokeWidth={0.055 * scale}
              pointerEvents="none"
            />
          ))}
        {draft.length > 0 && (
          <g pointerEvents="none">
            <polyline
              points={points([...draft, ...(cursor ? [cursor] : [])])}
              fill="#b5d58c3b"
              stroke="#71964c"
              strokeWidth={0.05 * scale}
              strokeDasharray={`${0.13 * scale} ${0.06 * scale}`}
            />
            {draft.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={0.08 * scale} fill="#73994a" />
                <text x={p.x + 0.13 * scale} y={p.y - 0.13 * scale} fontSize={0.16 * scale} fill="#59773b">
                  {i + 1}
                </text>
              </g>
            ))}
          </g>
        )}
        {drawing && cursor && (
          <g pointerEvents="none" stroke="#648743" strokeWidth={0.02 * scale}>
            <path
              d={`M${cursor.x - 0.17 * scale} ${cursor.y}h${0.34 * scale}M${cursor.x} ${cursor.y - 0.17 * scale}v${0.34 * scale}`}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

const css = `
.roof-workspace-v3{padding:25px 26px 32px;min-height:0;height:100%;overflow:auto;color:#7f956a;background:#f7faf2}.roof-zone-header{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:19px}.roof-zone-header h2{font-size:22px;font-weight:500;color:#78955b;margin:0}.roof-zone-header p{font-size:10px;line-height:1.7;color:#a0b18e;margin:7px 0 0;max-width:460px}.roof-zone-actions{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}.roof-zone-actions .button{font-size:9px;padding:9px 11px}.roof-zone-summary{display:flex;gap:20px;flex-wrap:wrap;padding:14px 16px;background:#eef5e2;border:1px solid #dce9c9;border-radius:6px;margin-bottom:17px;font-size:9px;color:#a0b38c}.roof-zone-summary strong{font-size:14px;font-weight:500;color:#839e64;margin-left:7px}.roof-zone-layout{display:grid;grid-template-columns:180px minmax(0,1fr);gap:14px;align-items:start;margin-bottom:20px}.roof-zone-list{display:flex;flex-direction:column;gap:7px}.roof-zone-card{padding:12px 11px;text-align:left;display:flex;gap:9px;background:#fff;border:1px solid #e1e9d6;border-radius:6px;width:100%}.roof-zone-card.active{background:#edf5df;border-color:#b7cf95}.roof-zone-card i{height:9px;width:9px;border-radius:3px;display:block;flex-shrink:0;margin-top:3px}.roof-zone-card strong{display:block;font-size:10px;color:#829c65;font-weight:500}.roof-zone-card small{display:block;font-size:8px;line-height:1.7;color:#a8b798;margin-top:4px}.roof-zone-list-note{font-size:8px;color:#abb99d;line-height:1.8;padding:7px}.roof-plan-wrap{border:1px solid #dae6cb;border-radius:7px;overflow:hidden;background:#eff4e7}.roof-plan-caption{padding:12px 14px;background:#f9fbf6;border-bottom:1px solid #e0e9d5;display:flex;flex-wrap:wrap;gap:7px;justify-content:space-between;color:#8ea778}.roof-plan-caption>span{font-size:8px;letter-spacing:1px}.roof-plan-caption small{font-size:8px;color:#aaba99}.roof-zone-plan{width:100%;height:350px;display:block;touch-action:none}.roof-zone-click{cursor:pointer;outline:none}.roof-zone-click:focus-visible polygon{stroke:#526f3d;stroke-width:.1}.roof-plan-wrap.drawing .roof-zone-plan,.roof-plan-wrap.drawing .roof-zone-click{cursor:crosshair}.roof-zone-editor{border:1px solid #dce7cd;background:white;border-radius:7px;padding:20px;margin-bottom:19px}.roof-zone-editor-head{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:17px}.roof-zone-editor-head h3{font-size:16px;font-weight:500;color:#809a64;margin:0}.roof-zone-editor-head span{font-size:8px;color:#a6b796}.roof-zone-remove{font-size:9px;color:#af8b67;padding:6px 0}.roof-zone-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:17px 19px}.roof-field>span,.roof-select>span{display:block;font-size:9px;color:#9eb18a;line-height:1.6;margin-bottom:6px}.roof-field>div{display:flex;border:1px solid #dfe8d5;background:#fafcf7;border-radius:5px;align-items:center}.roof-field input{width:100%;min-width:0;border:0;background:transparent;padding:9px;font-size:11px;color:#809d60;outline:0}.roof-field i{font-size:9px;color:#a5b891;font-style:normal;white-space:nowrap;padding-right:9px}.roof-field>div:focus-within{border-color:#adc88b}.roof-field>div.invalid{border-color:#c89d76}.roof-field>small{font-size:8px;color:#b4835a}.roof-field.disabled{opacity:.5}.roof-select select,.roof-name input{width:100%;border:1px solid #dfe8d5;background:#fafcf7;border-radius:5px;padding:9px;font-size:11px;color:#809d60}.roof-direction{display:flex;gap:5px;margin-top:8px}.roof-direction button{flex:1;padding:5px;border:1px solid #e0ead4;border-radius:4px;font-size:9px;color:#a4b98c}.roof-direction button.active{background:#edf5df;border-color:#b8cf96;color:#829f60}.roof-control-note{font-size:8px;color:#a8b99a;line-height:1.7;margin:7px 0 0}.roof-editor-section{border-top:1px solid #e7eedf;padding-top:16px;margin-top:18px}.roof-editor-section>h4{font-size:10px;font-weight:500;color:#8ba572;margin:0 0 13px}.roof-auto-level{display:flex;align-items:center;gap:7px;font-size:9px;color:#99ae85;margin-top:10px}.roof-auto-level input{accent-color:#93af6e}.roof-zone-warning{font-size:10px;line-height:1.75;border:1px solid #e7dbbf;background:#faf6e9;border-radius:5px;padding:12px 14px;color:#ae9465;margin-bottom:16px}.roof-zone-warning strong{font-weight:550}.roof-drawing-message{font-size:10px;line-height:1.7;padding:13px 15px;background:#edf5df;border:1px solid #d7e7bf;border-radius:5px;margin-bottom:16px;color:#91aa73;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.roof-drawing-message>div{display:flex;gap:8px}.roof-empty{font-size:11px;text-align:center;border:1px dashed #d9e5ca;padding:45px 20px;color:#a4b594;border-radius:6px;line-height:1.8;margin-bottom:20px}.roof-point-toggle{font-size:9px;color:#91aa77;padding:6px 0}.roof-points-table{display:grid;grid-template-columns:28px 1fr 1fr 25px;gap:8px;align-items:end;margin-top:11px}.roof-points-table>b{font-size:9px;font-weight:400;padding-bottom:12px;color:#a0b18f}.roof-points-table button{font-size:16px;color:#b29d7b;padding:8px 0}.roof-analysis-heading{font-size:14px;font-weight:500;color:#809c62;margin:25px 0 13px}.roof-analysis-note{font-size:9px;color:#a5b596;line-height:1.8;margin:9px 0 0}.roof-global-notes{border-top:1px solid #e0e8d5;margin-top:21px;padding-top:15px;font-size:9px;line-height:1.8;color:#a6b596}.roof-global-notes summary{cursor:pointer;color:#8fa977;font-size:10px}.roof-global-notes p{margin:9px 0}.roof-zone-title-input{border:0;background:transparent;font-size:16px;color:#809a64;width:100%;min-width:80px;max-width:300px;padding:0;outline:0}.roof-zone-title-input:focus{border-bottom:1px solid #b8ca9e}.roof-ui-scheme-card{display:flex;gap:6px;margin-top:10px}.roof-ui-scheme-card button{flex:1;font-size:8px;color:#a0b48a;padding:7px 4px;border:1px solid #e1ead5;border-radius:4px;background:#fbfdf7}.roof-ui-scheme-card button.active{background:#edf5df;border-color:#b8cf96;color:#7e9b5e}@media(max-width:1150px){.roof-zone-header{flex-wrap:wrap}.roof-zone-actions{justify-content:flex-start}.roof-zone-layout{grid-template-columns:150px minmax(0,1fr)}.roof-workspace-v3{padding:21px}.roof-zone-plan{height:300px}.roof-zone-editor-grid{gap:13px}}@media(max-width:850px){.roof-zone-layout{grid-template-columns:1fr}.roof-zone-list{display:flex;flex-direction:row;overflow:auto;padding-bottom:3px}.roof-zone-card{min-width:145px}.roof-zone-list-note{display:none}.roof-zone-editor{padding:16px}.roof-zone-plan{height:325px}}@media(max-width:650px){.roof-workspace-v3{height:auto;overflow:visible;padding:19px}.roof-zone-header h2{font-size:22px}.roof-zone-header p,.roof-zone-warning,.roof-drawing-message{font-size:11px}.roof-zone-actions .button{font-size:10px}.roof-zone-summary{font-size:10px;gap:13px}.roof-zone-card strong{font-size:11px}.roof-zone-card small,.roof-plan-caption small{font-size:9px}.roof-field>span,.roof-select>span{font-size:10px}.roof-field input,.roof-select select{font-size:12px}.roof-control-note,.roof-global-notes,.roof-analysis-note{font-size:10px}.roof-zone-editor-grid{grid-template-columns:1fr 1fr}.roof-zone-title-input{font-size:16px}.roof-auto-level{font-size:10px}.roof-point-toggle{font-size:10px}.roof-zone-plan{height:310px}}
`;

const framingCss = `.roof-framing-result{border:1px solid #dfe9d2;border-radius:6px;padding:13px 14px;background:#f3f8ea}.roof-framing-result>span{font-size:7px;letter-spacing:1px;color:#a5b893;display:block}.roof-framing-result>strong{font-size:15px;font-weight:500;color:#7f9c61;display:block;margin-top:7px}.roof-framing-result p{font-size:9px;color:#9eb18a;line-height:1.8;margin:7px 0 0}.roof-framing-result small{display:block;font-size:8px;color:#aab99a;line-height:1.7;margin-top:7px}.roof-framing-trusses{border-top:1px solid #e6edde;margin-top:16px;padding-top:15px;max-width:500px}.roof-framing-trusses .roof-ui-scheme-card{margin-top:9px}@media(max-width:650px){.roof-framing-result>span{font-size:8px}.roof-framing-result p,.roof-framing-result small{font-size:10px}}`;

export default function RoofWorkspace({
  project,
  result,
  roofModel,
  selectedZone,
  onSelectZone,
  onRoofChange,
  onSelectBar,
}) {
  const roof = project.roof ?? {};
  const zones = useMemo(() => {
    const raw = Array.isArray(roof.zones) ? roof.zones : (roofModel?.zones ?? []);
    return raw
      .filter(
        (z) =>
          z &&
          Array.isArray(z.polygon) &&
          z.polygon.length >= 3 &&
          z.polygon.every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y)),
      )
      .map((z, i) => zoneDefinition(z, roof, i));
  }, [roof, roofModel]);
  const [localSelected, setLocalSelected] = useState(null),
    [drawing, setDrawing] = useState(false),
    [draft, setDraft] = useState([]),
    [cursor, setCursor] = useState(null),
    [message, setMessage] = useState(""),
    [showPoints, setShowPoints] = useState(false),
    [selectedBar, setSelectedBar] = useState(null);
  const externalId = typeof selectedZone === "string" ? selectedZone : selectedZone?.id;
  const selectedId = zones.some((z) => z.id === externalId)
    ? externalId
    : zones.some((z) => z.id === localSelected)
      ? localSelected
      : zones[0]?.id;
  const zone = zones.find((z) => z.id === selectedId),
    computed = roofModel?.zones?.find((z) => z.id === selectedId),
    closed = result.geometry?.closed === true;
  const levels = (result.geometry?.levels ?? []).filter((l) => l.closed && l.polygon?.length >= 3);
  const select = (id) => {
    setLocalSelected(id);
    setSelectedBar(null);
    onSelectZone?.(id);
  };
  function commitZones(next) {
    return onRoofChange?.({
      ...roof,
      type: roof.type === "none" ? "fink" : (roof.type ?? "fink"),
      zones: next.map((z, i) => zoneDefinition(z, roof, i)),
    });
  }
  function updateZone(patch) {
    if (!zone) return false;
    if (patch.polygon && !validPolygon(patch.polygon)) {
      setMessage("Нужен простой полигон из трёх или более вершин без пересечений, площадь от 0,1 м².");
      return false;
    }
    setMessage("");
    return commitZones(zones.map((z) => (z.id === zone.id ? { ...z, ...patch } : z))) !== false;
  }
  const defaults = {
    shape: zone?.shape ?? (roof.type === "mono" ? "mono" : "gable"),
    ridgeAngle: 0,
    pitchLeft: roof.pitch ?? 25,
    pitchRight: roof.pitch ?? 25,
    trussType: roof.type === "none" ? "fink" : (roof.type ?? "fink"),
    framing: "auto",
    deflectionRatio: 300,
    spacing: roof.spacing ?? 0.6,
    chordSection: roof.chordSection ?? "50x150",
    webSection: roof.webSection ?? "50x100",
    elevation: null,
  };
  function auto() {
    try {
      const next = levels.length
        ? levels.flatMap((l, i) =>
            autoRoofZones(l.polygon, {
              ...defaults,
              elevation: null,
              levelIndex: l.index ?? i,
              idPrefix: `roof-level-${l.index ?? i}`,
              excludePolygons: levels.slice(i + 1).map((q) => q.polygon),
            }),
          )
        : autoRoofZones(result.geometry.polygon, defaults);
      commitZones(next);
      if (next[0]) select(next[0].id);
      setDrawing(false);
      setDraft([]);
      setMessage("");
    } catch (error) {
      setMessage(error.message || "Не удалось разбить контур. Нарисуйте зоны вручную.");
    }
  }
  function finish() {
    if (!validPolygon(draft)) {
      setMessage(
        "Укажите минимум три вершины простого полигона. Для завершения нажмите начальную точку или Enter.",
      );
      return;
    }
    const next = zoneDefinition(
      { ...defaults, id: newId(), name: `Зона ${zones.length + 1}`, polygon: draft },
      roof,
      zones.length,
    );
    commitZones([...zones, next]);
    select(next.id);
    setDraft([]);
    setDrawing(false);
    setCursor(null);
    setMessage("");
  }
  useEffect(() => {
    if (!drawing) return;
    const handler = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        finish();
      }
      if (e.key === "Escape") {
        setDrawing(false);
        setDraft([]);
        setMessage("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawing, draft, zones, roof]);
  const shapeNames = { gable: "Двускатная", mono: "Односкатная", hip: "Вальмовая" };
  const analysis = computed?.analysis;
  const safeAnalysis =
    analysis &&
    Array.isArray(analysis.nodes) &&
    Array.isArray(analysis.bars) &&
    Array.isArray(analysis.displacements) &&
    Array.isArray(analysis.reactions)
      ? analysis
      : null;
  const effectiveFraming =
    computed?.effectiveFraming ?? (zone?.shape === "mono" && zone?.framing !== "truss" ? "rafters" : "truss");
  const useRafters = effectiveFraming === "rafters" && zone?.shape === "mono";
  const trussControls = !useRafters && zone?.shape !== "hip";
  const shownTrussType =
    zone?.shape === "mono" ? "mono" : zone?.trussType === "mono" ? "fink" : zone?.trussType;
  const selectedSection =
    computed?.selectedSection ??
    computed?.effectiveSection ??
    (computed?.rafterAnalysis
      ? `${computed.rafterAnalysis.b}x${computed.rafterAnalysis.h}`
      : zone?.chordSection);
  const failures = (roofModel?.checks ?? []).filter((c) => c.status === "fail");
  const invalidRaw = Array.isArray(roof.zones) ? roof.zones.length - zones.length : 0;
  return (
    <section className="roof-workspace-v3" aria-label="Кровля по зонам">
      <style>
        {css}
        {framingCss}
      </style>
      <header className="roof-zone-header">
        <div>
          <h2>Крыша повторяет план</h2>
          <p>
            Разбейте сложный контур на зоны. Направление конька, уклоны двух сторон и отметка карниза задаются
            для каждой отдельно.
          </p>
        </div>
        <div className="roof-zone-actions">
          <button className="button secondary" disabled={!closed} onClick={auto}>
            Разбить крышу по контуру
          </button>
          <button
            className="button lime"
            disabled={!closed || drawing}
            onClick={() => {
              setDrawing(true);
              setDraft([]);
              setMessage("");
            }}
          >
            + Добавить зону
          </button>
        </div>
      </header>
      {!closed && (
        <div className="roof-zone-warning">
          <strong>Сначала замкните наружный контур.</strong> После этого появится разбиение кровли по реальной
          форме дома.
        </div>
      )}
      <div className="roof-zone-summary">
        <span>
          Зон <strong>{zones.length}</strong>
        </span>
        <span>
          Площадь скатов <strong>{fmt(roofModel?.area)} м²</strong>
        </span>
        <span>
          Досок кровли <strong>{roofModel?.instances?.length ?? 0}</strong>
        </span>
        <span>
          Объём <strong>{fmt(roofModel?.volume, 3)} м³</strong>
        </span>
      </div>
      {message && (
        <div className="roof-zone-warning" role="status">
          {message}
        </div>
      )}
      {invalidRaw > 0 && (
        <div className="roof-zone-warning" role="alert">
          Некорректных полигонов зон: {invalidRaw}. Исправьте данные проекта или выполните разбиение по
          контуру заново.
        </div>
      )}
      {failures.length > 0 && (
        <details className="roof-zone-warning">
          <summary>Замечания к кровле: {failures.length} · раскрыть</summary>
          {failures.map((c, i) => (
            <p key={c.id ?? i} style={{ margin: i ? "7px 0 0" : 0 }}>
              <strong>{c.label}.</strong>{" "}
              {c.note ??
                (Number.isFinite(c.value) && Number.isFinite(c.limit)
                  ? `${fmt(c.value)} / ${fmt(c.limit)} ${c.unit ?? ""}`
                  : "Проверьте параметры зоны.")}
            </p>
          ))}
        </details>
      )}
      {drawing && (
        <div className="roof-drawing-message">
          <span>
            Нажимайте вершины зоны на плане · выбрано {draft.length}. Замкните в первой точке или нажмите
            Enter.
          </span>
          <div>
            <button
              className="button secondary"
              onClick={() => setDraft((q) => q.slice(0, -1))}
              disabled={!draft.length}
            >
              Убрать точку
            </button>
            <button className="button lime" onClick={finish} disabled={draft.length < 3}>
              Завершить
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setDrawing(false);
                setDraft([]);
                setMessage("");
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      {zone && (
        <div className="roof-zone-summary">
          <label>
            Активная зона{" "}
            <select
              aria-label="Быстрый выбор кровельной зоны"
              value={zone.id}
              onChange={(e) => select(e.target.value)}
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Форма{" "}
            <select
              aria-label="Быстрая форма кровли"
              value={zone.shape}
              onChange={(e) => updateZone({ shape: e.target.value, framing: "auto" })}
            >
              <option value="mono">Односкатная</option>
              <option value="gable">Двускатная</option>
              <option value="hip">Вальмовая</option>
            </select>
          </label>
          <span>
            Задано / факт{" "}
            <strong>
              {zone.chordSection.replace("x", " × ")} / {selectedSection?.replace("x", " × ")} мм
            </strong>
          </span>
        </div>
      )}
      <div className="roof-zone-layout">
        <div className="roof-zone-list">
          {zones.map((z, i) => {
            const c = roofModel?.zones?.find((q) => q.id === z.id);
            return (
              <button
                className={`roof-zone-card ${z.id === selectedId ? "active" : ""}`}
                key={z.id}
                onClick={() => select(z.id)}
              >
                <i style={{ background: palette[i % palette.length] }} />
                <span>
                  <strong>{z.name}</strong>
                  <small>
                    {shapeNames[z.shape] ?? z.shape} · {fmt(c?.surfaceArea)} м²
                    <br />
                    Конёк {fmt(z.ridgeAngle, 0)}° · скаты {fmt(z.pitchLeft, 0)}°
                    {z.shape === "gable" ? ` / ${fmt(z.pitchRight, 0)}°` : ""}
                  </small>
                </span>
              </button>
            );
          })}
          <p className="roof-zone-list-note">
            Зоны можно рисовать вручную и редактировать по вершинам. Авторазбиение заменяет текущий набор зон.
          </p>
        </div>
        <ZonePlan
          project={project}
          result={result}
          zones={zones}
          model={roofModel}
          selected={selectedId}
          drawing={drawing}
          draft={draft}
          onSelect={select}
          onPoint={(p) => {
            setDraft((v) => (v.length && distance(v[v.length - 1], p) < 0.05 ? v : [...v, p]));
            setMessage("");
          }}
          onClose={finish}
          cursor={cursor}
          setCursor={setCursor}
          showPoints={showPoints}
        />
      </div>
      {!zones.length && !drawing && (
        <div className="roof-empty">
          Кровельных зон пока нет.
          <br />
          Разбейте замкнутый контур автоматически или нарисуйте полигон новой зоны.
        </div>
      )}
      {zone && (
        <div className="roof-zone-editor">
          <header className="roof-zone-editor-head">
            <div>
              <input
                key={`${zone.id}-${zone.name}`}
                className="roof-zone-title-input"
                aria-label="Название кровельной зоны"
                defaultValue={zone.name}
                maxLength={80}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== zone.name) updateZone({ name: next });
                  else e.target.value = zone.name;
                }}
              />
              <span>
                {fmt(computed?.area ?? polygonArea(zone.polygon))} м² в плане · {zone.polygon.length} вершин
              </span>
            </div>
            <button
              className="roof-zone-remove"
              onClick={() => {
                commitZones(zones.filter((z) => z.id !== zone.id));
                setLocalSelected(null);
                onSelectZone?.(null);
              }}
            >
              Удалить зону ×
            </button>
          </header>
          <div className="roof-zone-editor-grid">
            <label className="roof-select">
              <span>Форма кровли</span>
              <select
                aria-label="Форма кровельной зоны"
                value={zone.shape}
                onChange={(e) => updateZone({ shape: e.target.value, framing: "auto" })}
              >
                <option value="gable">Двускатная</option>
                <option value="mono">Односкатная</option>
                <option value="hip">Вальмовая · геометрия</option>
              </select>
              <p className="roof-control-note">
                {zone.shape === "hip"
                  ? "Скаты и стропила; несущая система вальмового покрытия не рассчитывается."
                  : "Контур скатов ограничен полигоном. Стороны определяются по направлению стрелки конька."}
              </p>
            </label>
            <div>
              <RoofNumber
                label={zone.shape === "mono" ? "Направление высокой кромки" : "Направление конька в плане"}
                value={zone.ridgeAngle}
                min={0}
                max={359.9}
                unit="°"
                onCommit={(ridgeAngle) => updateZone({ ridgeAngle })}
              />
              <div className="roof-direction">
                {[0, 45, 90, 135].map((angle) => (
                  <button
                    className={zone.ridgeAngle === angle ? "active" : ""}
                    key={angle}
                    onClick={() => updateZone({ ridgeAngle: angle })}
                  >
                    {angle}°
                  </button>
                ))}
              </div>
              <p className="roof-control-note">
                0° — вдоль X; 90° — вдоль Y. Стрелка на плане показывает направление.
              </p>
            </div>
            {levels.length > 1 && (
              <label className="roof-select" style={{ gridColumn: "1 / -1" }}>
                <span>Этаж опирания кровельной зоны</span>
                <select
                  aria-label="Этаж кровельной зоны"
                  value={zone.levelIndex ?? levels.at(-1)?.index ?? levels.length - 1}
                  onChange={(e) => updateZone({ levelIndex: Number(e.target.value), elevation: null })}
                >
                  {levels.map((l, i) => (
                    <option key={l.index ?? i} value={l.index ?? i}>
                      {l.name ?? `Этаж ${l.index ?? i + 1}`} · верх стен{" "}
                      {fmt(l.topY ?? l.elevation + l.height)} м
                    </option>
                  ))}
                </select>
                <p className="roof-control-note">
                  Нижние крылья дома могут иметь свою кровлю. Полигон зоны должен находиться внутри выбранного
                  этажа.
                </p>
              </label>
            )}
            <RoofNumber
              label={zone.shape === "mono" ? "Уклон ската" : "Уклон слева от конька"}
              value={zone.pitchLeft}
              min={2}
              max={60}
              unit="°"
              onCommit={(pitchLeft) => updateZone({ pitchLeft })}
            />
            <RoofNumber
              label="Уклон справа от конька"
              value={zone.pitchRight}
              min={2}
              max={60}
              unit="°"
              disabled={zone.shape === "mono"}
              onCommit={(pitchRight) => updateZone({ pitchRight })}
            />
            <div>
              <RoofNumber
                label="Отметка карниза от земли"
                value={zone.elevation ?? computed?.eave ?? project.height * project.floors + 0.72}
                min={0.2}
                max={30}
                unit="м"
                disabled={zone.elevation === null}
                onCommit={(elevation) => updateZone({ elevation })}
              />
              <label className="roof-auto-level">
                <input
                  type="checkbox"
                  checked={zone.elevation === null}
                  onChange={(e) =>
                    updateZone({
                      elevation: e.target.checked
                        ? null
                        : (computed?.eave ?? project.height * project.floors + 0.72),
                    })
                  }
                />
                Автоматически по этажу
              </label>
            </div>
            <RoofNumber
              label={useRafters ? "Максимальный шаг стропильных балок" : "Максимальный шаг ферм / стропил"}
              value={zone.spacing}
              min={0.2}
              max={1.5}
              unit="м"
              onCommit={(spacing) => updateZone({ spacing })}
            />
          </div>
          <div className="roof-editor-section">
            <h4>Несущая схема выбранной зоны</h4>
            <div className="roof-zone-editor-grid">
              <label className="roof-select">
                <span>Несущая схема</span>
                <select
                  aria-label="Несущая схема кровельной зоны"
                  value={zone.framing}
                  disabled={zone.shape === "hip"}
                  onChange={(e) => updateZone({ framing: e.target.value })}
                >
                  <option value="auto">Авто · по пролёту и проверкам</option>
                  <option value="rafters" disabled={zone.shape !== "mono"}>
                    Стропильные балки
                  </option>
                  <option value="truss">Фермы</option>
                </select>
                <p className="roof-control-note">
                  {zone.shape === "mono"
                    ? "Односкатная форма может опираться на отдельные доски или на фермы. Автовыбор проверяет нагрузки и сечение."
                    : zone.shape === "hip"
                      ? "Вальмовая зона пока задаёт геометрию; её несущая система требует отдельной схемы."
                      : "Балочная схема здесь доступна для односкатных зон. Для двускатной формы используются фермы."}
                </p>
              </label>
              <div className="roof-framing-result">
                <span>{zone.framing === "auto" ? "РЕЗУЛЬТАТ АВТОВЫБОРА" : "ВЫБРАНО ВРУЧНУЮ"}</span>
                <strong>
                  {zone.shape === "hip" ? "Геометрия вальм" : useRafters ? "Стропильные балки" : "Фермы"}
                </strong>
                <p>
                  {computed?.framingReason ??
                    (zone.shape === "hip"
                      ? "Накосные стропила и узлы покрытия не рассчитаны."
                      : "Выбор зависит от пролёта, нагрузки, жёсткости и доступных сечений.")}
                </p>
                {Number.isFinite(computed?.actualSpacing) && (
                  <small>
                    Расчётный шаг {fmt(computed.actualSpacing, 3)} м · задано не более {fmt(zone.spacing)} м
                  </small>
                )}
              </div>
              <div>
                <SectionSelect
                  label={
                    useRafters
                      ? "Заданное сечение стропильной балки"
                      : zone.shape === "hip"
                        ? "Сечение стропил · геометрия"
                        : "Сечение поясов фермы"
                  }
                  value={zone.chordSection}
                  onChange={(chordSection) => updateZone({ chordSection })}
                />
                <p className="roof-control-note">
                  Задано {zone.chordSection.replace("x", " × ")} мм · фактически{" "}
                  {selectedSection?.replace("x", " × ")} мм
                  {zone.framing === "auto" ? " · автоподбор по нагрузке" : ""}.
                </p>
                {useRafters && zone.framing === "auto" && (
                  <button className="button secondary" onClick={() => updateZone({ framing: "rafters" })}>
                    Использовать заданное сечение без автоподбора
                  </button>
                )}
              </div>
              {useRafters ? (
                <div>
                  <RoofNumber
                    label="Предел вертикального прогиба · L /"
                    value={zone.deflectionRatio}
                    min={150}
                    max={600}
                    onCommit={(deflectionRatio) => {
                      if (!Number.isInteger(deflectionRatio)) {
                        setMessage("Предел прогиба задаётся целым числом от 150 до 600.");
                        return false;
                      }
                      return updateZone({ deflectionRatio });
                    }}
                  />
                  <p className="roof-control-note">
                    L — горизонтальный пролёт. Проверка сравнивает вертикальный прогиб с L /{" "}
                    {zone.deflectionRatio}.
                  </p>
                </div>
              ) : trussControls ? (
                <SectionSelect
                  label="Сечение решётки фермы"
                  value={zone.webSection}
                  onChange={(webSection) => updateZone({ webSection })}
                />
              ) : null}
            </div>
            {trussControls && (
              <div className="roof-framing-trusses">
                <label className="roof-select">
                  <span>Решётка плоской фермы</span>
                  <select
                    aria-label="Тип фермы кровельной зоны"
                    value={shownTrussType}
                    onChange={(e) => updateZone({ trussType: e.target.value })}
                  >
                    {trussTypes
                      .filter((t) => (zone.shape === "mono" ? t.id === "mono" : t.id !== "mono"))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="roof-ui-scheme-card">
                  {trussTypes.map((t) => (
                    <button
                      disabled={zone.shape === "mono" ? t.id !== "mono" : t.id === "mono"}
                      key={t.id}
                      className={shownTrussType === t.id ? "active" : ""}
                      onClick={() => updateZone({ trussType: t.id })}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {zone.framing === "rafters" && zone.shape !== "mono" && (
              <div className="roof-zone-warning" style={{ marginTop: 12, marginBottom: 0 }}>
                Стропильная балочная схема сейчас доступна для односкатной формы. Выберите односкатную зону
                или режим ферм.
              </div>
            )}
          </div>
          <div className="roof-editor-section">
            <button className="roof-point-toggle" onClick={() => setShowPoints(!showPoints)}>
              {showPoints ? "Скрыть" : "Редактировать"} вершины полигона {showPoints ? "−" : "+"}
            </button>
            {showPoints && (
              <>
                <p className="roof-control-note">
                  Координаты в метрах. Порядок точек идёт по границе зоны; пересечения недопустимы.
                </p>
                {zone.polygon.map((p, i) => (
                  <div className="roof-points-table" key={`${zone.id}-${i}`}>
                    <b>{i + 1}</b>
                    <RoofNumber
                      label={`Вершина ${i + 1} · X`}
                      value={p.x}
                      min={-1000}
                      max={1000}
                      unit="м"
                      onCommit={(x) =>
                        updateZone({ polygon: zone.polygon.map((q, j) => (j === i ? { ...q, x } : q)) })
                      }
                    />
                    <RoofNumber
                      label={`Вершина ${i + 1} · Y`}
                      value={p.y}
                      min={-1000}
                      max={1000}
                      unit="м"
                      onCommit={(y) =>
                        updateZone({ polygon: zone.polygon.map((q, j) => (j === i ? { ...q, y } : q)) })
                      }
                    />
                    <button
                      aria-label={`Удалить вершину ${i + 1}`}
                      disabled={zone.polygon.length <= 3}
                      onClick={() => updateZone({ polygon: zone.polygon.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      <WallProfilePanel
        project={project}
        result={result}
        roofModel={roofModel}
        onModeChange={(wallFraming) => onRoofChange?.({ ...roof, wallFraming })}
      />
      {computed?.warnings?.length > 0 && (
        <div className="roof-zone-warning">
          {computed.warnings.map((w, i) => (
            <p key={i} style={{ margin: i ? "7px 0 0" : 0 }}>
              {typeof w === "string" ? w : (w.message ?? w.note)}
            </p>
          ))}
        </div>
      )}
      {zone && (
        <>
          <h3 className="roof-analysis-heading">
            {useRafters
              ? "Балочная проверка стропила"
              : computed?.analysisApplicable
                ? "Расчёт фермы выбранной зоны"
                : "Типовая схема для выбранной зоны"}
          </h3>
          {!useRafters && computed?.analysisApplicable === false && (
            <div className="roof-zone-warning">
              <strong>К обрезанным или нерегулярным элементам типовой расчёт не применяется.</strong>{" "}
              Опирание, пересечения зон, ендовы и соединения требуют отдельного расчёта. Геометрия в 3D и
              ведомости формируется по контуру.
            </div>
          )}
          {useRafters ? (
            <RafterPanel
              analysis={computed?.rafterAnalysis}
              zone={zone}
              requestedSection={computed?.requestedSection ?? zone.chordSection}
              selectedSection={selectedSection}
            />
          ) : safeAnalysis ? (
            <TrussDiagram
              truss={safeAnalysis}
              selected={selectedBar}
              onSelect={(id) => {
                setSelectedBar(id);
                onSelectBar?.(id, zone.id);
              }}
            />
          ) : (
            <div className="roof-empty">
              {zone.shape === "hip"
                ? "Для вальмовой зоны показана геометрия скатов и стропил. Расчёт несущей системы пока не задан."
                : "Для этой зоны расчёт фермы пока недоступен. Проверьте размеры и замечания геометрии."}
            </div>
          )}
          <p className="roof-analysis-note">
            {useRafters
              ? "Длина, фактическое сечение и шаг стропильных балок входят в модель и шестиметровый раскрой. Опорные узлы и соединения требуют отдельной проверки."
              : "Физические доски, продольные стыки и шестиметровый раскрой учитываются отдельно. Линейная схема фермы не подтверждает несущую способность её реальных соединений."}
          </p>
        </>
      )}
      <details className="roof-global-notes">
        <summary>Контуры, сопряжения и ограничения кровли</summary>
        <p>
          Авторазбиение создаёт зоны по фактическому контуру. Их направление и уклоны можно менять независимо;
          при пересечении зон нужны согласованные отметки и отдельное решение сопряжения.
        </p>
        {(roofModel?.warnings ?? []).map((n, i) => (
          <p key={`w${i}`}>{typeof n === "string" ? n : (n.message ?? n.note)}</p>
        ))}
        {(roofModel?.assumptions ?? []).map((n, i) => (
          <p key={`a${i}`}>{n}</p>
        ))}
      </details>
    </section>
  );
}

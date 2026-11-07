import React, { useRef, useState, useEffect } from "react";
const fmt = (v, d = 2) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export default function DesignerCanvas({
  project: p,
  result: r,
  tool,
  selected,
  onSelect,
  onWall,
  onOpening,
  onObject,
  onVoid,
  onMoveNode,
  ortho = true,
  snap = true,
  dimensions = true,
  layer = "model",
  fitKey = 0,
  cancelKey = 0,
  defaultSection = "50x150",
  wallKind = "exterior",
  level = 1,
}) {
  const svg = useRef(),
    [anchor, setAnchor] = useState(null),
    [cursor, setCursor] = useState(null),
    [drag, setDrag] = useState(null),
    [pan, setPan] = useState(null),
    [box, setBox] = useState({ x: -2, y: -2, w: 16, h: 12 });
  useEffect(() => {
    setAnchor(null);
    setDrag(null);
  }, [tool, cancelKey]);
  useEffect(() => {
    const b = r.geometry.bounds;
    if (b && Number.isFinite(b.minX)) {
      const w = Math.max(8, b.maxX - b.minX),
        h = Math.max(6, b.maxY - b.minY);
      setBox({ x: b.minX - 1.7, y: b.minY - 1.7, w: w + 3.4, h: h + 3.4 });
    } else setBox({ x: -2, y: -2, w: 16, h: 12 });
  }, [fitKey]);
  useEffect(() => {
    const key = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key === "Escape" || e.key === "Enter") {
        setAnchor(null);
        setDrag(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function raw(e) {
    const q = svg.current.createSVGPoint();
    q.x = e.clientX;
    q.y = e.clientY;
    const pt = q.matrixTransform(svg.current.getScreenCTM().inverse());
    return { x: pt.x, y: pt.y };
  }
  function snapped(q, e, base = anchor) {
    let pt = { ...q };
    if (base && ortho && !e.shiftKey && tool !== "void") {
      if (Math.abs(pt.x - base.x) > Math.abs(pt.y - base.y)) pt.y = base.y;
      else pt.x = base.x;
    }
    if (snap) {
      pt = { x: Math.round(pt.x / p.grid) * p.grid, y: Math.round(pt.y / p.grid) * p.grid };
      const endpoints = p.walls.flatMap((w) => [w.a, w.b]);
      let nearest = null;
      for (const v of endpoints) {
        if (distance(v, pt) < 0.24 && (!nearest || distance(v, pt) < distance(nearest, pt))) nearest = v;
      }
      if (nearest) pt = { ...nearest, node: true };
    }
    return { x: Math.round(pt.x * 1000) / 1000, y: Math.round(pt.y * 1000) / 1000, node: pt.node };
  }
  function wallAt(pt) {
    let best = null;
    for (const w of p.walls) {
      const dx = w.b.x - w.a.x,
        dy = w.b.y - w.a.y,
        L2 = dx * dx + dy * dy,
        t = Math.max(0, Math.min(1, ((pt.x - w.a.x) * dx + (pt.y - w.a.y) * dy) / L2));
      const at = { x: w.a.x + t * dx, y: w.a.y + t * dy },
        d = distance(pt, at);
      if (d < 0.4 && (!best || d < best.d)) best = { wall: w, d, offset: t * Math.sqrt(L2) };
    }
    return best;
  }
  function click(e) {
    if (drag) return;
    if (e.button === 1 || e.altKey || (tool === "select" && e.button === 0)) {
      e.preventDefault();
      const rect = svg.current.getBoundingClientRect(),
        scale = Math.min(rect.width / box.w, rect.height / box.h);
      setPan({ x: e.clientX, y: e.clientY, box: { ...box }, scale });
      svg.current.setPointerCapture(e.pointerId);
      onSelect(null);
      return;
    }
    if (e.button !== 0) return;
    const pt = snapped(raw(e), e);
    if (tool === "wall" || tool === "beam" || tool === "void") {
      if (!anchor) {
        setAnchor(pt);
        setCursor(pt);
        return;
      }
      if (distance(anchor, pt) < 0.2) return;
      if (tool === "void") {
        const minX = Math.min(anchor.x, pt.x),
          maxX = Math.max(anchor.x, pt.x),
          minY = Math.min(anchor.y, pt.y),
          maxY = Math.max(anchor.y, pt.y);
        if (maxX - minX < 0.3 || maxY - minY < 0.3) return;
        onVoid([
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ]);
        setAnchor(null);
        return;
      }
      if (tool === "wall")
        onWall({
          a: { x: anchor.x, y: anchor.y },
          b: { x: pt.x, y: pt.y },
          section: defaultSection,
          kind: wallKind,
        });
      else onObject({ type: "beam", a: anchor, b: pt, section: defaultSection });
      if (pt.node || tool === "beam") setAnchor(null);
      else setAnchor(pt);
      return;
    }
    if (tool === "window" || tool === "door") {
      const hit = wallAt(raw(e));
      if (hit) onOpening(hit.wall.id, hit.offset, tool);
      return;
    }
    if (tool === "post") {
      onObject({ type: "post", a: pt, section: defaultSection });
      return;
    }
    onSelect(null);
  }
  function move(e) {
    if (pan) {
      setBox({
        ...pan.box,
        x: pan.box.x - (e.clientX - pan.x) / pan.scale,
        y: pan.box.y - (e.clientY - pan.y) / pan.scale,
      });
      return;
    }
    const pt = snapped(raw(e), e, drag ? null : anchor);
    setCursor(pt);
    if (drag) setDrag((v) => ({ ...v, to: pt }));
  }
  function up(e) {
    if (pan) {
      setPan(null);
      if (svg.current.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
      return;
    }
    if (drag) {
      e.stopPropagation();
      onMoveNode(drag.from, drag.to);
      setDrag(null);
      svg.current.releasePointerCapture?.(e.pointerId);
    }
  }
  const walls = drag
    ? p.walls.map((w) => ({
        ...w,
        a: distance(w.a, drag.from) < 0.0001 ? drag.to : w.a,
        b: distance(w.b, drag.from) < 0.0001 ? drag.to : w.b,
      }))
    : p.walls;
  const selectedWall = p.walls.find((w) => selected?.type === "wall" && w.id === selected.id);
  const polygon = r.geometry.polygon || [];
  const path = polygon.length ? polygon.map((q) => `${q.x},${q.y}`).join(" ") : "";
  useEffect(() => {
    const el = svg.current;
    const wheel = (e) => {
      e.preventDefault();
      const pt = raw(e),
        factor = Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.002);
      setBox((v) => {
        const w = Math.max(3, Math.min(150, v.w * factor)),
          k = w / v.w;
        return { x: pt.x - (pt.x - v.x) * k, y: pt.y - (pt.y - v.y) * k, w, h: v.h * k };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const activeDrawing = ["wall", "beam", "window", "door", "post", "void"].includes(tool);
  const s = 0.018;
  return (
    <svg
      ref={svg}
      className={`designer-svg ${activeDrawing ? "drawing" : ""}`}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      onPointerDown={click}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => {
        if (!drag) setCursor(null);
      }}
      aria-label="Редактор плана: рисование стен и объектов"
    >
      <defs>
        <pattern id="d-grid" width={p.grid} height={p.grid} patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r=".008" fill="#c4cfb9" />
        </pattern>
        <pattern id="d-major" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0H0V1" fill="none" stroke="#d7dfce" strokeWidth=".012" />
        </pattern>
      </defs>
      <rect x={box.x - 100} y={box.y - 100} width={box.w + 200} height={box.h + 200} fill="#eff2e9" />
      <rect x={box.x - 100} y={box.y - 100} width={box.w + 200} height={box.h + 200} fill="url(#d-major)" />
      <rect x={box.x - 100} y={box.y - 100} width={box.w + 200} height={box.h + 200} fill="url(#d-grid)" />
      {r.geometry.closed && <polygon points={path} fill="#fafcf5" stroke="none" />}
      {layer === "floor" &&
        r.timber.instances
          .filter((i) => i.role === "joist")
          .map((i) => (
            <line
              key={i.id}
              x1={i.start[0]}
              y1={i.start[2]}
              x2={i.end[0]}
              y2={i.end[2]}
              stroke="#baa16e"
              strokeWidth={i.b / 1000}
            />
          ))}
      {walls.map((w, i) => {
        const L = distance(w.a, w.b),
          dx = w.b.x - w.a.x,
          dy = w.b.y - w.a.y,
          nx = -dy / L,
          ny = dx / L,
          t = Number(w.section.split("x")[1] || 150) / 1000,
          sel = selected?.type === "wall" && selected.id === w.id;
        return (
          <g
            key={w.id}
            className="wall-select"
            onPointerDown={(e) => {
              if (!activeDrawing) {
                e.stopPropagation();
                onSelect({ type: "wall", id: w.id });
              }
            }}
            role="button"
            aria-label={`Стена ${i + 1}, ${fmt(L)} м`}
          >
            <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="transparent" strokeWidth=".35" />
            <line
              x1={w.a.x}
              y1={w.a.y}
              x2={w.b.x}
              y2={w.b.y}
              stroke={sel ? "#82a354" : w.kind === "partition" ? "#9cae8b" : "#41583f"}
              strokeWidth={t + 0.04}
              strokeLinecap="square"
            />
            <line
              x1={w.a.x}
              y1={w.a.y}
              x2={w.b.x}
              y2={w.b.y}
              stroke={sel ? "#d2e9a0" : "#d0bd92"}
              strokeWidth={Math.max(0.04, t - 0.02)}
              strokeLinecap="square"
            />
            {dimensions && (
              <g pointerEvents="none">
                <line
                  x1={w.a.x + nx * 0.52}
                  y1={w.a.y + ny * 0.52}
                  x2={w.b.x + nx * 0.52}
                  y2={w.b.y + ny * 0.52}
                  stroke="#a7b496"
                  strokeWidth=".012"
                />
                <text
                  className="plan-dimension-text"
                  x={(w.a.x + w.b.x) / 2 + nx * 0.65}
                  y={(w.a.y + w.b.y) / 2 + ny * 0.65}
                  transform={`rotate(${(Math.atan2(dy, dx) * 180) / Math.PI > 90 || (Math.atan2(dy, dx) * 180) / Math.PI < -90 ? (Math.atan2(dy, dx) * 180) / Math.PI + 180 : (Math.atan2(dy, dx) * 180) / Math.PI} ${(w.a.x + w.b.x) / 2 + nx * 0.65} ${(w.a.y + w.b.y) / 2 + ny * 0.65})`}
                  textAnchor="middle"
                >
                  {fmt(L)} м
                </text>
              </g>
            )}
          </g>
        );
      })}
      {p.openings
        .filter((o) => (o.floor ?? 1) === level)
        .map((o, i) => {
          const w = walls.find((w) => w.id === o.wallId);
          if (!w) return null;
          const L = distance(w.a, w.b),
            ang = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
          const x = w.a.x + ((w.b.x - w.a.x) * o.offset) / L,
            y = w.a.y + ((w.b.y - w.a.y) * o.offset) / L;
          const sel = selected?.type === "opening" && selected.id === o.id;
          return (
            <g
              key={o.id}
              transform={`translate(${x} ${y}) rotate(${ang})`}
              onPointerDown={(e) => {
                if (tool === "select") {
                  e.stopPropagation();
                  onSelect({ type: "opening", id: o.id });
                }
              }}
              role="button"
              aria-label={`${o.type === "window" ? "Окно" : "Дверь"} ${i + 1}`}
              className="wall-select"
            >
              <rect x="0" y="-.13" width={o.width} height=".26" fill="#fafcf5" />
              {o.type === "window" ? (
                <>
                  <rect
                    x=".01"
                    y="-.09"
                    width={o.width - 0.02}
                    height=".18"
                    fill={sel ? "#d2e9a0" : "#d4e9e8"}
                    stroke="#71a4a4"
                    strokeWidth=".02"
                  />
                  <path d={`M0 0H${o.width}`} stroke="#88b7b3" strokeWidth=".015" />
                </>
              ) : (
                <>
                  <path
                    d={`M0 0V${o.width}A${o.width} ${o.width} 0 0 0 ${o.width} 0`}
                    fill="none"
                    stroke={sel ? "#7e9c4f" : "#91a080"}
                    strokeWidth=".02"
                  />
                  <path d={`M0 0V${o.width}`} stroke="#5f7c4e" strokeWidth=".035" />
                </>
              )}
            </g>
          );
        })}
      {(p.objects || []).map((o, i) => {
        const wh = o.section.split("x").map(Number);
        return (
          <g
            key={o.id}
            role="button"
            aria-label={`${o.type === "post" ? "Стойка" : "Балка"} ${i + 1}`}
            onPointerDown={(e) => {
              if (tool === "select") {
                e.stopPropagation();
                onSelect({ type: "object", id: o.id });
              }
            }}
          >
            {o.type === "post" ? (
              <rect
                x={o.a.x - wh[0] / 2000}
                y={o.a.y - wh[1] / 2000}
                width={wh[0] / 1000}
                height={wh[1] / 1000}
                fill="#a68a59"
                stroke={selected?.id === o.id ? "#8dae55" : "#7d704d"}
                strokeWidth=".04"
              />
            ) : (
              <line
                x1={o.a.x}
                y1={o.a.y}
                x2={o.b.x}
                y2={o.b.y}
                stroke={selected?.id === o.id ? "#84a950" : "#b49664"}
                strokeWidth={Math.max(0.1, wh[0] / 1000)}
              />
            )}
          </g>
        );
      })}
      {layer === "foundation" &&
        r.piles?.map((pi, i) => (
          <g
            key={pi.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect({ type: "pile", id: pi.id });
            }}
            role="button"
            aria-label={`Свая ${i + 1}`}
            className="wall-select"
          >
            <circle
              cx={pi.x}
              cy={pi.y}
              r=".17"
              fill={pi.utilization > 1 ? "#c78864" : "#7b9860"}
              stroke={selected?.id === pi.id ? "#344a2c" : "#fff"}
              strokeWidth=".035"
            />
            <text x={pi.x} y={pi.y + 0.055} textAnchor="middle" fontSize=".14" fill="#fff">
              {i + 1}
            </text>
          </g>
        ))}
      {r.corners
        ?.filter((c) => c.kind !== "straight")
        .map((c, i) => {
          const point = c.point || c;
          return (
            <g
              key={c.id}
              role="button"
              aria-label={`Узел ${i + 1}`}
              className="corner-select"
              onPointerDown={(e) => {
                if (tool === "select") {
                  e.stopPropagation();
                  onSelect({ type: "corner", id: c.id });
                }
              }}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={selected?.id === c.id ? 0.21 : 0.12}
                fill={selected?.id === c.id ? "#ccdf9e" : "#fafcf5"}
                stroke="#80966a"
                strokeWidth=".02"
              />
              <text x={point.x + 0.21} y={point.y - 0.19} fontSize=".21" fill="#8b9e76">
                У{i + 1}
              </text>
            </g>
          );
        })}
      {r.geometry.closed && layer !== "foundation" && (
        <g pointerEvents="none">
          <rect
            x={(r.geometry.bounds.minX + r.geometry.bounds.maxX) / 2 - 1.05}
            y={(r.geometry.bounds.minY + r.geometry.bounds.maxY) / 2 - 0.42}
            width="2.1"
            height=".84"
            rx=".12"
            fill="#f8fbf0e6"
          />
          <text
            x={(r.geometry.bounds.minX + r.geometry.bounds.maxX) / 2}
            y={(r.geometry.bounds.minY + r.geometry.bounds.maxY) / 2 - 0.06}
            textAnchor="middle"
            fontSize=".13"
            letterSpacing=".03"
            fill="#a6b396"
          >
            ЗАМКНУТЫЙ КОНТУР
          </text>
          <text
            x={(r.geometry.bounds.minX + r.geometry.bounds.maxX) / 2}
            y={(r.geometry.bounds.minY + r.geometry.bounds.maxY) / 2 + 0.24}
            textAnchor="middle"
            fontSize=".3"
            fill="#788f5c"
          >
            {fmt(r.geometry.area, 1)} м²
          </text>
        </g>
      )}
      {(p.voids || [])
        .filter((v) => v.level === level)
        .map((v, i) => (
          <g
            key={v.id}
            className="void-select"
            role="button"
            aria-label={`Второй свет ${i + 1}`}
            onPointerDown={(e) => {
              if (tool === "select") {
                e.stopPropagation();
                onSelect({ type: "void", id: v.id });
              }
            }}
          >
            <polygon
              points={v.polygon.map((q) => `${q.x},${q.y}`).join(" ")}
              fill="#e2ead7d9"
              stroke={selected?.id === v.id ? "#819d5c" : "#a8bb91"}
              strokeWidth=".04"
              strokeDasharray=".13 .07"
            />
            <text
              x={v.polygon.reduce((s, q) => s + q.x, 0) / v.polygon.length}
              y={v.polygon.reduce((s, q) => s + q.y, 0) / v.polygon.length}
              textAnchor="middle"
              fontSize=".19"
              fill="#91a875"
              pointerEvents="none"
            >
              ВТОРОЙ СВЕТ
            </text>
          </g>
        ))}
      {selectedWall &&
        tool === "select" &&
        [selectedWall.a, selectedWall.b].map((v, i) => (
          <circle
            key={i}
            cx={v.x}
            cy={v.y}
            r=".14"
            fill="#cde494"
            stroke="#6f8e49"
            strokeWidth=".025"
            className="drag-handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              setDrag({ from: v, to: v });
              svg.current.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      {anchor && cursor && tool === "void" && (
        <rect
          className="void-drawing"
          x={Math.min(anchor.x, cursor.x)}
          y={Math.min(anchor.y, cursor.y)}
          width={Math.abs(cursor.x - anchor.x)}
          height={Math.abs(cursor.y - anchor.y)}
          pointerEvents="none"
        />
      )}
      {anchor && cursor && tool !== "void" && (
        <g pointerEvents="none">
          <line
            x1={anchor.x}
            y1={anchor.y}
            x2={cursor.x}
            y2={cursor.y}
            stroke="#88a751"
            strokeWidth=".15"
            strokeDasharray=".16 .06"
          />
          <circle cx={anchor.x} cy={anchor.y} r=".09" fill="#6c8c43" />
          <rect
            x={(anchor.x + cursor.x) / 2 - 0.65}
            y={(anchor.y + cursor.y) / 2 - 0.47}
            width="1.3"
            height=".35"
            fill="#e0edc1"
            rx=".06"
          />
          <text
            x={(anchor.x + cursor.x) / 2}
            y={(anchor.y + cursor.y) / 2 - 0.23}
            textAnchor="middle"
            fontSize=".16"
            fill="#627e3d"
          >
            {fmt(distance(anchor, cursor))} м
          </text>
        </g>
      )}
      {activeDrawing && cursor && (
        <g pointerEvents="none">
          <line
            x1={cursor.x - 0.2}
            y1={cursor.y}
            x2={cursor.x + 0.2}
            y2={cursor.y}
            stroke="#70914c"
            strokeWidth=".015"
          />
          <line
            x1={cursor.x}
            y1={cursor.y - 0.2}
            x2={cursor.x}
            y2={cursor.y + 0.2}
            stroke="#70914c"
            strokeWidth=".015"
          />
          {cursor.node && (
            <circle cx={cursor.x} cy={cursor.y} r=".16" fill="none" stroke="#8fac62" strokeWidth=".02" />
          )}
        </g>
      )}
    </svg>
  );
}

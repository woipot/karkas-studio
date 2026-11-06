import React from "react";
const fmt = (n, d = 1) => Number(n).toLocaleString("ru-RU", { maximumFractionDigits: d });
export default function Plan({
  project: p,
  result: r,
  section,
  selected,
  onSelect,
  layers,
  zoom = 1,
  level = 1,
}) {
  const S = 44,
    L = p.length * S,
    W = p.width * S,
    pad = 86,
    wall = p.wallThickness * S;
  const isPile = section === "foundation",
    isFloor = section === "floor",
    isLoads = section === "loads";
  const vbW = L + pad * 2,
    vbH = W + pad * 2;
  const vx = -pad + (vbW - vbW / zoom) / 2,
    vy = -pad + (vbH - vbH / zoom) / 2;
  function lineWall(id, x1, y1, x2, y2) {
    return (
      <g
        key={id}
        className="svg-select"
        role="button"
        aria-label={`Стена ${id}`}
        onClick={() => onSelect({ type: "wall", id })}
      >
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={selected?.id === id ? "#74942b" : "#37433a"}
          strokeWidth={wall + 4}
        />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d1bc92" strokeWidth={Math.max(wall, 4)} />
      </g>
    );
  }
  function dim(x1, y1, x2, y2, text, vertical = false) {
    return (
      <g className="dimension">
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        {[0, 1].map((k) => (
          <line
            key={k}
            x1={(k ? x2 : x1) - 4}
            y1={(k ? y2 : y1) + 4}
            x2={(k ? x2 : x1) + 4}
            y2={(k ? y2 : y1) - 4}
          />
        ))}
        <text
          x={(x1 + x2) / 2 + (vertical ? -10 : 0)}
          y={(y1 + y2) / 2 - 7}
          textAnchor="middle"
          transform={vertical ? `rotate(-90 ${(x1 + x2) / 2 - 10} ${(y1 + y2) / 2 - 7})` : undefined}
        >
          {text}
        </text>
      </g>
    );
  }
  const ns = Math.ceil(p.length / p.joistStep);
  return (
    <svg
      id="house-plan"
      className="house-plan"
      viewBox={`${vx} ${vy} ${vbW / zoom} ${vbH / zoom}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="План каркасного дома"
      style={{ maxHeight: "100%" }}
    >
      <defs>
        <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse">
          <path d="M0 7 7 0" stroke="#c8d0c0" strokeWidth=".7" />
        </pattern>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
          <path d="M0 0 6 3 0 6Z" fill="#ba8348" />
        </marker>
      </defs>
      <rect
        x="0"
        y="0"
        width={L}
        height={W}
        fill={isPile ? "#e4e9de" : "#f9faf4"}
        stroke="#b3bda8"
        strokeWidth=".8"
      />
      {(layers.floor || isFloor) && (
        <g opacity={isFloor ? 1 : 0.38}>
          {Array.from({ length: ns + 1 }, (_, i) => (
            <rect
              key={i}
              x={(i * L) / ns - 1}
              y="2"
              width={isFloor ? 3 : 1.3}
              height={W - 4}
              fill="#b69a6c"
            />
          ))}
        </g>
      )}
      {isPile && (
        <g stroke="#aab99c" strokeWidth="1" strokeDasharray="5 5">
          {[...new Set(r.piles.map((x) => x.x))].map((x) => (
            <line key={x} x1={x * S} y1={-16} x2={x * S} y2={W + 16} />
          ))}
          {[...new Set(r.piles.map((x) => x.y))].map((y) => (
            <line key={y} x1={-16} y1={y * S} x2={L + 16} y2={y * S} />
          ))}
        </g>
      )}
      {layers.walls && (
        <g>
          {lineWall("north", 0, 0, L, 0)}
          {lineWall("south", 0, W, L, W)}
          {lineWall("west", 0, 0, 0, W)}
          {lineWall("east", L, 0, L, W)}
          {p.internalBearing && (
            <g
              role="button"
              aria-label="Внутренняя несущая стена"
              className="svg-select"
              onClick={() => onSelect({ type: "internal" })}
            >
              <line x1="0" y1={W / 2} x2={L} y2={W / 2} stroke="#485646" strokeWidth={wall} />
              <line
                x1="0"
                y1={W / 2}
                x2={L}
                y2={W / 2}
                stroke="#ccb78d"
                strokeWidth={Math.max(wall - 3, 2)}
              />
            </g>
          )}
        </g>
      )}
      {layers.openings &&
        p.openings
          .filter((o) => (o.floor ?? 1) === level)
          .map((o) => {
            const horiz = o.wall === "north" || o.wall === "south";
            const a = o.offset * S,
              b = o.width * S;
            const pos =
              o.wall === "north"
                ? `translate(${a} 0)`
                : o.wall === "south"
                  ? `translate(${a} ${W})`
                  : o.wall === "west"
                    ? `translate(0 ${a}) rotate(90)`
                    : `translate(${L} ${a}) rotate(90)`;
            return (
              <g
                key={o.id}
                transform={pos}
                className="svg-select"
                onClick={() => onSelect({ type: "opening", id: o.id })}
                role="button"
                aria-label={`${o.type === "window" ? "Окно" : "Дверь"} ${o.id}`}
              >
                <rect y={-wall / 2 - 2} width={b} height={wall + 4} fill="#f9faf4" />
                {o.type === "window" ? (
                  <>
                    <rect
                      x="1"
                      y={-wall / 2}
                      width={b - 2}
                      height={wall}
                      fill={selected?.id === o.id ? "#d7f36a" : "#d7eced"}
                      stroke="#639aa0"
                      strokeWidth="1.4"
                    />
                    <line x1="0" y1="0" x2={b} y2="0" stroke="#72a5ab" strokeWidth="1" />
                  </>
                ) : (
                  <>
                    <path
                      d={`M0 0V${-b}A${b} ${b} 0 0 1 ${b} 0`}
                      fill="none"
                      stroke={selected?.id === o.id ? "#74942b" : "#83927e"}
                      strokeWidth="1.2"
                    />
                    <line x1="0" y1="0" x2="0" y2={-b} stroke="#4b5b45" strokeWidth="2" />
                  </>
                )}
              </g>
            );
          })}
      {!isPile && !isLoads && !isFloor && (
        <g className="room-label">
          <text x={L / 2} y={W * (p.internalBearing ? 0.25 : 0.45) - 7}>
            ПЛАН {level === 1 ? "ПЕРВОГО" : "ВТОРОГО"} ЭТАЖА
          </text>
          <text className="room-area" x={L / 2} y={W * (p.internalBearing ? 0.25 : 0.45) + 17}>
            {fmt((p.length * p.width) / (p.internalBearing ? 2 : 1))} м²
          </text>
          {p.internalBearing && (
            <>
              <text x={L / 2} y={W * 0.75 - 7}>
                СВОБОДНАЯ ПЛАНИРОВКА
              </text>
              <text className="room-area" x={L / 2} y={W * 0.75 + 17}>
                {fmt((p.length * p.width) / 2)} м²
              </text>
            </>
          )}
        </g>
      )}
      {isFloor && (
        <g className="room-label">
          <rect x={L / 2 - 91} y={W / 4 - 32} width="182" height="65" rx="6" fill="#f9faf4" opacity=".95" />
          <text x={L / 2} y={W / 4 - 8}>
            БАЛКИ ПЕРЕКРЫТИЯ
          </text>
          <text className="room-area" x={L / 2} y={W / 4 + 16}>
            {p.joistB} × {p.joistH} · шаг {fmt(p.joistStep * 1000, 0)}
          </text>
        </g>
      )}
      {isLoads && (
        <g>
          {Array.from({ length: 7 }, (_, i) => {
            const x = 30 + (i * (L - 60)) / 6;
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={-46}
                  x2={x}
                  y2={-14}
                  stroke="#ba8348"
                  strokeWidth="1.8"
                  markerEnd="url(#arrowhead)"
                />
                <line
                  x1={x}
                  y1={W / 2 - 40}
                  x2={x}
                  y2={W / 2 - 8}
                  stroke="#ba8348"
                  strokeWidth="1.8"
                  markerEnd="url(#arrowhead)"
                />
              </g>
            );
          })}
          <g className="room-label">
            <rect
              x={L / 2 - 100}
              y={W * 0.7 - 20}
              width="200"
              height="50"
              fill="#f9faf4"
              opacity=".95"
              rx="5"
            />
            <text x={L / 2} y={W * 0.7}>
              ВЕРТИКАЛЬНАЯ НАГРУЗКА
            </text>
            <text className="room-area" x={L / 2} y={W * 0.7 + 22}>
              {fmt(r.loads.totalDesign, 1)} кН
            </text>
          </g>
        </g>
      )}
      {(layers.piles || isPile) &&
        r.piles.map((pile, i) => {
          const selectedPile = selected?.type === "pile" && selected.id === pile.id;
          const color = pile.utilization > 1 ? "#c15f47" : pile.utilization > 0.75 ? "#be9342" : "#66824e";
          return (
            <g
              key={pile.id ?? i}
              className="svg-select"
              role="button"
              aria-label={`Свая ${i + 1}, ${fmt(pile.reaction)} кН`}
              onClick={() => onSelect({ type: "pile", id: pile.id })}
            >
              <circle
                cx={pile.x * S}
                cy={pile.y * S}
                r={isPile ? 11 : 5}
                fill={isPile ? color : "#f4f7ee"}
                stroke={selectedPile ? "#202b1b" : color}
                strokeWidth={selectedPile ? 3 : 1.5}
              />
              {isPile && (
                <>
                  <text
                    x={pile.x * S}
                    y={pile.y * S + 3}
                    textAnchor="middle"
                    fontSize="7"
                    fill="#fff"
                    fontWeight="600"
                  >
                    {i + 1}
                  </text>
                  <text x={pile.x * S} y={pile.y * S + 24} textAnchor="middle" fontSize="9" fill="#59684f">
                    {fmt(pile.reaction, 1)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      {layers.dimensions && (
        <g>
          {dim(0, W + 46, L, W + 46, `${fmt(p.length * 1000, 0)}`)}
          {dim(-46, 0, -46, W, `${fmt(p.width * 1000, 0)}`, true)}
          <g className="extension">
            <line x1="0" y1={W + 12} x2="0" y2={W + 57} />
            <line x1={L} y1={W + 12} x2={L} y2={W + 57} />
            <line x1="-12" y1="0" x2="-58" y2="0" />
            <line x1="-12" y1={W} x2="-58" y2={W} />
          </g>
        </g>
      )}
      <g className="axes">
        {["А", "Б", ...(p.internalBearing ? ["В"] : [])].map((v, i, a) => (
          <g key={v}>
            <circle cx={L + 47} cy={(W * i) / (a.length - 1)} r="11" />
            <text x={L + 47} y={(W * i) / (a.length - 1) + 3.5}>
              {v}
            </text>
          </g>
        ))}
        {["1", "2", "3"].map((v, i) => (
          <g key={v}>
            <circle cx={(L * i) / 2} cy={-35} r="11" />
            <text x={(L * i) / 2} y={-31.5}>
              {v}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

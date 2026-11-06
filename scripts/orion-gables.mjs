const EPS = 1e-8,
  dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit = (a) => a.map((v) => v / Math.hypot(...a));
function hull(P) {
  const q = [...new Map(P.map((p) => [p.join(","), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (q) => {
    const h = [];
    for (const p of q) {
      while (h.length > 1 && cr(h.at(-2), h.at(-1), p) <= EPS) h.pop();
      h.push(p);
    }
    return h;
  };
  return [...half(q).slice(0, -1), ...half(q.toReversed()).slice(0, -1)];
}
function clip(P, minY) {
  const R = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i],
      b = P[(i + 1) % P.length],
      fa = a[1] - minY,
      fb = b[1] - minY;
    if (fa >= -EPS) R.push(a);
    if (fa >= -EPS !== fb >= -EPS) {
      const t = fa / (fa - fb);
      R.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return R;
}
const defs = {
  41: {
    id: "Ст-19",
    wallId: "Ст-03",
    sign: -1,
    plates: [
      [15, 16],
      [2, 3],
    ],
    studs: [
      [4],
      [5, 6],
      [7],
      [8],
      [9],
      [10],
      [11],
      [13],
      [14],
      [17],
      [18, 19],
      [20],
      [21],
      [22],
      [23],
      [24],
      [26],
      [27],
      [33],
      [35],
    ],
    headers: [[34], [36]],
    blocks: [[28, 29], [30, 31], [38], [39]],
    braces: [[12], [25]],
    bottoms: 2,
  },
  42: {
    id: "Ст-20",
    wallId: "Ст-01",
    sign: 1,
    plates: [[1, 2], [24, 25], [23], [26]],
    studs: [
      [3, 4],
      [5, 6],
      [7],
      [8],
      [9],
      [10],
      [12, 13],
      [14, 15],
      [16],
      [17],
      [18],
      [19],
      [21],
      [22],
      [27],
      [28],
      [29],
      [30],
      [31],
      [32],
    ],
    headers: [],
    blocks: [],
    braces: [[11], [33]],
    bottoms: 3,
  },
};
export function restoreOrionGables(input, vectors) {
  const p = structuredClone(input),
    members = p.roof.sourceModel.members;
  if (members.some((b) => b.zoneId?.startsWith("ORION-GABLE"))) throw Error("Gables already restored.");
  const wallBase = 0.72 + 0.2 + 0.2 + 0.035,
    top = wallBase + p.height,
    base = top - 0.04,
    scale = 88.5828125,
    notes = [];
  for (const source of vectors) {
    const def = defs[source.pdfPage];
    if (!def) throw Error("Wrong source panel.");
    const shapes = source.shapes,
      x0 = Math.min(...shapes.map((s) => s.bbox[0])),
      y0 = Math.min(...shapes.map((s) => s.bbox[1])),
      wall = p.walls.find((w) => w.id === def.wallId);
    if (!wall || Math.abs(wall.a.x - wall.b.x) > 0.001) throw Error("Expected short exterior wall.");
    const poly = (i) => shapes[i].points.map(([x, y]) => [(x - x0) / scale, (y - y0) / scale]);
    let serial = 0;
    for (const [kind, groups] of Object.entries({
      plates: def.plates,
      studs: def.studs,
      headers: def.headers,
      blocks: def.blocks,
      braces: def.braces,
    }))
      for (const group of groups) {
        const visible = group.map(poly),
          all = visible.flat();
        let back = hull(all);
        if (kind === "studs" && Math.min(...all.map((q) => q[1])) < 0.3) {
          const xs = all.map((q) => q[0]);
          back = hull([...all, [Math.min(...xs), 0.04], [Math.max(...xs), 0.04]]);
        }
        if (kind === "blocks") {
          const xs = all.map((q) => q[0]),
            ys = all.map((q) => q[1]);
          back = [
            [Math.min(...xs), Math.min(...ys)],
            [Math.max(...xs), Math.min(...ys)],
            [Math.max(...xs), Math.max(...ys)],
            [Math.min(...xs), Math.max(...ys)],
          ];
        }
        let longest = [0, 0, 0];
        for (let i = 0; i < back.length; i++) {
          const a = back[i],
            b = back[(i + 1) % back.length],
            len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len > longest[2]) longest = [b[0] - a[0], b[1] - a[1], len];
        }
        let angle = Math.atan2(longest[1], longest[0]);
        angle = ((((angle + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
        const angles = [-90, -45, -20, 0, 20, 45, 90, 135, 160, 180, 200, 225, 270].map(
            (a) => (a * Math.PI) / 180,
          ),
          exact = angles.reduce((a, b) => (Math.abs(b - angle) < Math.abs(a - angle) ? b : a));
        if (Math.abs(exact - angle) > 0.001) throw Error("Unexpected source angle " + angle);
        angle = exact;
        const u = [Math.cos(angle), Math.sin(angle)],
          n = [-u[1], u[0]],
          ss = back.map((q) => dot(q, u)),
          ws = back.map((q) => dot(q, n)),
          cs = (Math.max(...ss) + Math.min(...ss)) / 2,
          cw = (Math.max(...ws) + Math.min(...ws)) / 2,
          C = [u[0] * cs + n[0] * cw, u[1] * cs + n[1] * cw],
          L = Math.max(...ss) - Math.min(...ss),
          D = [0, u[1], u[0]],
          wide = kind === "braces" || kind === "blocks";
        const X = wide ? [def.sign, 0, 0] : [0, def.sign * n[1], def.sign * n[0]],
          N = cross(X, D),
          face = wide ? N : X,
          face2 = [face[2], face[1]],
          limit = wide ? 0.075 : 0.02;
        const local = (Q) => {
          const P = Q.map((q) => [dot(q, u) - cs, dot([q[0] - C[0], q[1] - C[1]], face2)]).map(([s, w]) => {
            if (Math.abs(w) > limit + 0.00015)
              throw Error(`${def.id}/${kind}: face exceeds nominal section ${w}`);
            return [s, Math.max(-limit, Math.min(limit, w))];
          });
          return P.filter(
            (q, i) =>
              Math.hypot(
                q[0] - P[(i + P.length - 1) % P.length][0],
                q[1] - P[(i + P.length - 1) % P.length][1],
              ) > 1e-7,
          );
        };
        const offset = wide ? def.sign * (kind === "braces" ? 0.055 : -0.055) : 0,
          center = [wall.a.x + offset, base + C[1], 0.15 + C[0]],
          start = center.map((v, k) => v - (D[k] * L) / 2),
          end = center.map((v, k) => v + (D[k] * L) / 2),
          finished = clip(back, 0.04);
        const shape = wide
          ? { type: "rippedBoard", points: local(finished) }
          : {
              type: "layeredProfile",
              plane: "width",
              layers: [
                { from: -0.075, to: 0.035, points: local(finished) },
                ...visible
                  .map((v) => ({ from: 0.035, to: 0.075, points: local(clip(v, 0.04)) }))
                  .filter((l) => l.points.length >= 3),
              ],
            };
        const id = def.id + "-G" + String(++serial).padStart(2, "0");
        members.push({
          id,
          name:
            def.id +
            " · " +
            {
              plates: "наклонная верхняя обвязка",
              studs: "стойка фронтона",
              headers: "перемычка проёма",
              blocks: "распорка фронтона",
              braces: "укосина фронтона",
            }[kind],
          role: {
            plates: "gableTopPlate",
            studs: "gableStud",
            headers: "gableHeader",
            blocks: "gableBlocking",
            braces: "gableBrace",
          }[kind],
          zoneId: "ORION-GABLE-" + def.id,
          section: "40x150",
          sourceMark: def.id,
          sourcePage: source.pdfPage,
          level: 1,
          start,
          end,
          crossAxis: X,
          cutStart: { scheme: "butt", angle: 0 },
          cutEnd: { scheme: "butt", angle: 0 },
          blankLength: L,
          shape,
          note: "Контур из векторной развёртки. Пазы40мм под укосины учтены слоями; нижняя обвязка повторно не добавлена. Крепёж и несущая работа не рассчитаны.",
        });
      }
    notes.push({
      panel: def.id,
      pdfPage: source.pdfPage,
      wallId: def.wallId,
      count: serial,
      reusedBottomBoards: def.bottoms,
      baseY: base,
      wallTopY: top,
    });
  }
  const source = p.roof.sourceModel;
  source.missingItems = source.missingItems.map((s) =>
    s.includes("Точные фронтонные стойки")
      ? "Исходные потолочные распорки и часть верхних обвязок ещё требуют поштучной сверки; фронтонные панели Ст-19/20 восстановлены геометрически."
      : s,
  );
  source.assumptions.push(
    "Фронтонные панели Ст-19/20 извлечены из векторных развёрток:56новых досок40×150мм, включая6наклонных обвязок,40стоек,4укосины,4распорки и2перемычки. Пять нижних досок источника не дублируются: основание панелей использует существующую верхнюю обвязку стен. Нижние торцы укосин подрезаны по её верхней грани. Стойки/обвязки имеют реальные40мм пазы со стороны укосин; распорки расположены у противоположной грани. Крепёж, опирание и силовая работа требуют отдельного расчёта.",
  );
  return { project: p, panels: notes };
}

import { physicalTrussBoards } from "./physical-truss.js";
import { axialCompression } from "./timber-design.js";
/**
 * Plane pin-jointed timber trusses. Coordinates m, sections mm, E/F MPa,
 * nodal loads / member forces kN, returned displacements mm. N>0 tension.
 * Geometry is on member centre-lines, not a fabrication drawing.
 */
export const trussTypes = [
  {
    id: "king",
    name: "King post",
    description: "Центральная стойка и два подкоса; четыре треугольные панели.",
  },
  {
    id: "queen",
    name: "Queen post",
    description: "Две стойки, верхняя распорка и диагонали к центру нижнего пояса.",
  },
  { id: "fink", name: "Fink · W", description: "W-образная решётка с двумя узлами на нижнем поясе." },
  {
    id: "mono",
    name: "Односкатная",
    description: "Односкатная треугольная решётка с тремя вертикальными стойками.",
  },
];

export const trussDefaults = {
  type: "fink",
  span: 8,
  rise: 1.865,
  crestRatio: 0.5,
  chordB: 50,
  chordH: 150,
  webB: 50,
  webH: 100,
  spacing: 0.6,
  roofDead: 0.5,
  snow: 1.5,
  mu: 0.8,
  gammaG: 1.1,
  gammaQ: 1.4,
  E: 10000,
  tensionDesign: 8,
  compressionDesign: 12,
  timberDensity: 500,
  deflectionLimit: 300,
  stockLength: 6,
  overhangLow: 0,
  overhangHigh: 0,
  heelHeight: 0,
  ceilingDead: 0,
  ceilingSpacing: null,
  /** Out-of-plane restraint spacing of chords (roof battens / ceiling lining), m. */
  chordRestraint: 0.6,
};
const g = 9.80665;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const zeros = (n) => Array(n).fill(0);
const matrix = (n) => Array.from({ length: n }, () => zeros(n));
const finite = (n) => typeof n === "number" && Number.isFinite(n);

export const trussSources = [
  {
    title: "Purdue / N. Zabaras · Direct stiffness truss analysis",
    url: "https://web.ics.purdue.edu/~ibilion/www.zabaras.com/Courses/MAE4700/LECTURES/DirectMethod-TrussAnalysis.pdf",
  },
  {
    title: "MIT OCW · Euler column buckling",
    url: "https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf",
  },
  {
    title: "University of Illinois · Axial stress and deformation",
    url: "https://mechref.engr.illinois.edu/sol/axial.html",
  },
  {
    title: "USDA · Wood Handbook: Structural analysis equations",
    url: "https://research.fs.usda.gov/treesearch/62251",
  },
];
const assumptions = [
  "Плоская шарнирно-стержневая модель: каждый стержень работает только на осевую силу, E×A/L. Линейная упругость, малые перемещения, идеальные узлы без эксцентриситетов. Это не полный нормативный расчёт деревянной фермы.",
  "Слева неподвижный шарнир (X,Y), справа подвижный шарнир (Y). Выбранные варианты — идеализированные триангулированные схемы. Название типа не означает сертифицированную заводскую конструкцию.",
  "Нагрузка слоёв кровли задана на фактическую площадь ската БЕЗ древесины. Снег s×μ — на горизонтальную проекцию. Нагрузка кровли передаётся в узлы верхнего пояса по грузовым участкам; отдельная ceilingDead — в узлы нижнего пояса. Общая FEM-модель не проверяет изгиб между узлами; отдельный physical-chord screen при наличии не заменяет расчёт рамы.",
  "Собственный вес каждого стержня ρ×b×h×L×g делится поровну на его два узла и учитывается один раз. Шаг spacing задаёт грузовую ширину одной внутренней фермы; для крайней фермы её нужно задать отдельно.",
  "Знак N: плюс — растяжение, минус — сжатие. Для растяжения σ=N/A сравнивается с введённым Ft. Для сжатия — СП 64.13330.2017 / СНиП II-25-80 п. 4.2–4.3: N/(φ·Rc·A) ≤ 1 по обеим осям, φ = 1 − 0.8(λ/100)² при λ ≤ 70, φ = 3000/λ² при λ > 70. В плоскости фермы l0 — длина между узлами; из плоскости решётка имеет полную длину, пояса — шаг раскрепления chordRestraint (по умолчанию 0.6 м: обрешётка верхнего пояса и подшивка нижнего, закреплённые к связям). Предельная гибкость: 120 для поясов и опорных элементов, 150 для прочей решётки (СНиП II-25-80 табл. 14). Идеальный Euler показан только для справки.",
  "Раскрепление поясов из плоскости принято с шагом chordRestraint; связи, к которым крепится обрешётка, и их жёсткость не рассчитаны. Даже при малых осевых напряжениях требуется отдельная проверка пространственной устойчивости, несовершенств, совместного изгиба, ползучести, влажности и качества древесины.",
  "Модель не проверяет крепёж, накладки, зубчатые пластины, врубки, смятие, опорные узлы и крепление фермы к стенам. Ветер, отрыв, заносы и несимметричный снег в данный сценарий не входят.",
  "Длины и углы относятся к осям стержней. В raised-heel physicalReference заданы геометрические подрезки и цельные пояса; они не подтверждают прочность врубок, накладок, зазоров и совместную работу пакетов. Для изготовления нужен проверенный рабочий узел.",
];

/** Gaussian elimination with partial pivoting. A singular mechanism is an error. */
function solveLinear(A, b) {
  const n = b.length,
    M = A.map((r, i) => [...r, b[i]]),
    scale = Math.max(...A.flat().map(Math.abs));
  if (!finite(scale) || scale === 0)
    throw new Error("Сингулярная матрица жёсткости: конструкция является механизмом.");
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[pivot][k])) pivot = i;
    if (Math.abs(M[pivot][k]) < scale * 1e-11)
      throw new Error(
        "Сингулярная или плохо обусловленная матрица жёсткости: проверьте триангуляцию и опоры.",
      );
    [M[k], M[pivot]] = [M[pivot], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      M[i][k] = 0;
      for (let j = k + 1; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = zeros(n);
  for (let i = n - 1; i >= 0; i--) {
    let v = M[i][n];
    for (let j = i + 1; j < n; j++) v -= M[i][j] * x[j];
    x[i] = v / M[i][i];
  }
  if (x.some((v) => !finite(v))) throw new Error("Не удалось получить конечное решение системы жёсткости.");
  return x;
}

/**
 * Reusable solver for benchmark tests / future custom topology.
 * loads: [{node,fx,fy}] kN; supports:[{node,x:boolean,y:boolean}].
 * bars require nodeA/nodeB IDs, b/h mm, E MPa. Returned u is in metres.
 */
export function solvePlanarTruss(nodes, bars, loads, supports) {
  if (!Array.isArray(nodes) || nodes.length < 2 || !Array.isArray(bars) || !bars.length)
    throw new Error("Нет узлов или стержней для расчёта.");
  const ids = new Map(nodes.map((n, i) => [n.id, i]));
  if (ids.size !== nodes.length || nodes.some((n) => !finite(n.x) || !finite(n.y)))
    throw new Error("Некорректные или повторяющиеся узлы.");
  const n = nodes.length * 2,
    K = matrix(n),
    F = zeros(n),
    fixed = new Set();
  const elements = bars.map((bar) => {
    const i = ids.get(bar.nodeA),
      j = ids.get(bar.nodeB);
    if (i === undefined || j === undefined || i === j)
      throw new Error("Стержень ссылается на неверные узлы.");
    const dx = nodes[j].x - nodes[i].x,
      dy = nodes[j].y - nodes[i].y,
      L = Math.hypot(dx, dy);
    if (L < 1e-8 || ![bar.b, bar.h, bar.E].every((v) => finite(v) && v > 0))
      throw new Error("Нулевая длина, площадь или жёсткость стержня.");
    const c = dx / L,
      s = dy / L,
      k = (bar.E * bar.b * bar.h) / (1000 * L),
      v = [-c, -s, c, s],
      dof = [2 * i, 2 * i + 1, 2 * j, 2 * j + 1];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) K[dof[a]][dof[b]] += k * v[a] * v[b];
    return { i, j, L, c, s, k, v, dof };
  });
  for (const load of loads) {
    const i = ids.get(load.node);
    if (i === undefined || !finite(load.fx ?? 0) || !finite(load.fy ?? 0))
      throw new Error("Некорректная узловая нагрузка.");
    F[2 * i] += load.fx ?? 0;
    F[2 * i + 1] += load.fy ?? 0;
  }
  for (const support of supports) {
    const i = ids.get(support.node);
    if (i === undefined) throw new Error("Опора ссылается на неверный узел.");
    if (support.x) fixed.add(2 * i);
    if (support.y) fixed.add(2 * i + 1);
  }
  const free = Array.from({ length: n }, (_, i) => i).filter((i) => !fixed.has(i));
  if (!free.length) throw new Error("Нет свободных степеней свободы.");
  const reduced = free.map((i) => free.map((j) => K[i][j])),
    solution = solveLinear(
      reduced,
      free.map((i) => F[i]),
    ),
    u = zeros(n);
  free.forEach((dof, i) => (u[dof] = solution[i]));
  const residual = K.map((row, i) => sum(row.map((x, j) => x * u[j])) - F[i]);
  const forces = elements.map((e) => e.k * sum(e.v.map((x, i) => x * u[e.dof[i]])));
  return {
    u,
    forces,
    reactions: supports.map((s) => {
      const i = ids.get(s.node);
      return { node: s.node, x: s.x ? residual[2 * i] : 0, y: s.y ? residual[2 * i + 1] : 0 };
    }),
    residual: Math.max(...free.map((i) => Math.abs(residual[i]))),
    fixed: [...fixed],
    freeCount: free.length,
  };
}

function topology(type, S, H) {
  let coords, top, bottom, web;
  if (type === "king") {
    coords = [
      ["A", 0, 0],
      ["B", S, 0],
      ["C", S / 2, 0],
      ["D", S / 4, H / 2],
      ["R", S / 2, H],
      ["E", (3 * S) / 4, H / 2],
    ];
    top = [
      ["A", "D"],
      ["D", "R"],
      ["R", "E"],
      ["E", "B"],
    ];
    bottom = [
      ["A", "C"],
      ["C", "B"],
    ];
    web = [
      ["C", "D"],
      ["C", "R"],
      ["C", "E"],
    ];
  } else if (type === "queen") {
    coords = [
      ["A", 0, 0],
      ["B", S, 0],
      ["C", S / 3, 0],
      ["D", S / 2, 0],
      ["E", (2 * S) / 3, 0],
      ["U", S / 3, (2 * H) / 3],
      ["R", S / 2, H],
      ["V", (2 * S) / 3, (2 * H) / 3],
    ];
    top = [
      ["A", "U"],
      ["U", "R"],
      ["R", "V"],
      ["V", "B"],
    ];
    bottom = [
      ["A", "C"],
      ["C", "D"],
      ["D", "E"],
      ["E", "B"],
    ];
    web = [
      ["C", "U"],
      ["E", "V"],
      ["U", "V"],
      ["U", "D"],
      ["D", "V"],
    ];
  } else if (type === "fink") {
    coords = [
      ["A", 0, 0],
      ["B", S, 0],
      ["C", S / 3, 0],
      ["D", (2 * S) / 3, 0],
      ["U", S / 4, H / 2],
      ["R", S / 2, H],
      ["V", (3 * S) / 4, H / 2],
    ];
    top = [
      ["A", "U"],
      ["U", "R"],
      ["R", "V"],
      ["V", "B"],
    ];
    bottom = [
      ["A", "C"],
      ["C", "D"],
      ["D", "B"],
    ];
    web = [
      ["U", "C"],
      ["C", "R"],
      ["R", "D"],
      ["D", "V"],
    ];
  } else if (type === "mono") {
    coords = [
      ["A", 0, 0],
      ["B", S, 0],
      ["C", S / 3, 0],
      ["D", (2 * S) / 3, 0],
      ["U", S / 3, H / 3],
      ["V", (2 * S) / 3, (2 * H) / 3],
      ["R", S, H],
    ];
    top = [
      ["A", "U"],
      ["U", "V"],
      ["V", "R"],
    ];
    bottom = [
      ["A", "C"],
      ["C", "D"],
      ["D", "B"],
    ];
    web = [
      ["C", "U"],
      ["D", "V"],
      ["B", "R"],
      ["C", "V"],
      ["D", "R"],
    ];
  } else throw new Error("Неизвестный тип фермы.");
  const nodes = coords.map(([id, x, y]) => ({ id, x, y }));
  const raw = [
    ...top.map(([nodeA, nodeB]) => ({ nodeA, nodeB, role: "top" })),
    ...bottom.map(([nodeA, nodeB]) => ({ nodeA, nodeB, role: "bottom" })),
    ...web.map(([nodeA, nodeB]) => ({ nodeA, nodeB, role: "web" })),
  ];
  return { nodes, raw };
}

export function buildTruss(input = {}) {
  const p = { ...trussDefaults, ...input };
  const result = {
    input: p,
    type: p.type,
    name: trussTypes.find((t) => t.id === p.type)?.name ?? "Ферма",
    nodes: [],
    bars: [],
    loads: { nodal: [], totalCharacteristic: 0, totalDesign: 0 },
    reactions: [],
    displacements: [],
    checks: [],
    errors: [],
    status: "fail",
    stable: false,
    assumptions: [...assumptions],
    sources: trussSources,
    totals: { volume: 0, mass: 0, length: 0, count: 0 },
  };
  const bounds = {
    span: [0.3, 60],
    rise: [0.01, 30],
    crestRatio: [0.01, 0.99],
    chordB: [25, 300],
    chordH: [50, 600],
    webB: [25, 300],
    webH: [50, 600],
    spacing: [0.001, 3],
    roofDead: [0, 15],
    snow: [0, 15],
    mu: [0, 3],
    gammaG: [1, 2],
    gammaQ: [1, 3],
    E: [1000, 30000],
    tensionDesign: [0.5, 60],
    compressionDesign: [0.5, 80],
    timberDensity: [100, 1500],
    deflectionLimit: [150, 600],
    stockLength: [2, 18],
    overhangLow: [0, 2],
    overhangHigh: [0, 2],
    heelHeight: [0, 2],
    ceilingDead: [0, 15],
    chordRestraint: [0.05, 60],
  };
  for (const [key, [min, max]] of Object.entries(bounds))
    if (!finite(p[key]) || p[key] < min || p[key] > max)
      result.errors.push(`${key}: требуется число от ${min} до ${max}.`);
  for (const key of ["muLeft", "muRight"])
    if (p[key] !== undefined && (!finite(p[key]) || p[key] < 0 || p[key] > 3))
      result.errors.push(`${key}: требуется число от 0 до 3.`);
  if (
    p.ceilingSpacing !== null &&
    (!finite(p.ceilingSpacing) || p.ceilingSpacing < 0 || p.ceilingSpacing > 3)
  )
    result.errors.push("ceilingSpacing: 0..3 m or null.");
  if (!trussTypes.some((t) => t.id === p.type)) result.errors.push("Неизвестный тип фермы.");
  if (p.rise > p.span * 1.5) result.errors.push("Подъём превышает 1,5 пролёта: схема вне диапазона.");
  if (result.errors.length) return result;
  try {
    const { nodes, raw } = topology(p.type, p.span, p.rise);
    if (p.type !== "mono" && Math.abs(p.crestRatio - 0.5) > 1e-10)
      for (const n of nodes) {
        const q = n.x / p.span;
        n.x = p.span * (q <= 0.5 ? q * 2 * p.crestRatio : p.crestRatio + (q - 0.5) * 2 * (1 - p.crestRatio));
      }
    if (p.heelHeight > 0) {
      if (p.type === "mono") throw new Error("Raised heel is supported for pitched trusses only.");
      for (const n of nodes) if (n.y > 1e-9) n.y += p.heelHeight;
      nodes.push({ id: "HA", x: 0, y: p.heelHeight }, { id: "HB", x: p.span, y: p.heelHeight });
      const left = raw.find((b) => b.role === "top" && b.nodeA === "A"),
        right = raw.find((b) => b.role === "top" && b.nodeB === "B"),
        leftPanel = left.nodeB,
        rightPanel = right.nodeA;
      left.nodeA = "HA";
      right.nodeB = "HB";
      raw.push(
        { nodeA: "A", nodeB: "HA", role: "web" },
        { nodeA: "B", nodeB: "HB", role: "web" },
        { nodeA: "A", nodeB: leftPanel, role: "web" },
        { nodeA: "B", nodeB: rightPanel, role: "web" },
      );
    }
    const map = new Map(nodes.map((n) => [n.id, n]));
    const bars = raw.map((bar, i) => {
      const a = map.get(bar.nodeA),
        z = map.get(bar.nodeB),
        length = Math.hypot(z.x - a.x, z.y - a.y),
        b = bar.role === "web" ? p.webB : p.chordB,
        h = bar.role === "web" ? p.webH : p.chordH,
        volume = ((b * h) / 1e6) * length;
      return {
        ...bar,
        a: bar.nodeA,
        end: bar.nodeB,
        id: `F${String(i + 1).padStart(2, "0")}`,
        b,
        h,
        E: p.E,
        length,
        angle: (Math.atan2(z.y - a.y, z.x - a.x) * 180) / Math.PI,
        volume,
        mass: volume * p.timberDensity,
      };
    });
    result.nodes = nodes;
    result.bars = bars;
    if (p.heelHeight > 0) {
      const physical = physicalTrussBoards({ input: p, nodes, bars }),
        bySource = new Map(physical.filter((b) => b.role === "web").map((b) => [b.sourceBarIds[0], b]));
      for (const b of bars)
        if (bySource.has(b.id)) {
          const actual = bySource.get(b.id);
          b.referenceVolume = b.volume;
          b.volume = actual.volume;
          b.mass = actual.mass;
          b.physicalJointCuts = true;
        }
      result.physicalReference = physical;
    }
    const nodal = new Map(
      nodes.map((n) => [n.id, { node: n.id, dead: 0, snow: 0, timber: 0, roofDead: 0, ceilingDead: 0 }]),
    );
    for (const bar of bars) {
      const a = map.get(bar.nodeA),
        b = map.get(bar.nodeB),
        self = (bar.mass * g) / 1000 / 2;
      for (const id of [bar.nodeA, bar.nodeB]) {
        nodal.get(id).dead += self;
        nodal.get(id).timber += self;
      }
      if (bar.role === "top") {
        const localMu =
          p.type === "mono" || (a.x + b.x) / 2 <= p.span * p.crestRatio
            ? (p.muLeft ?? p.mu)
            : (p.muRight ?? p.mu);
        const dead = (p.roofDead * p.spacing * bar.length) / 2,
          snow = (p.snow * localMu * p.spacing * Math.abs(b.x - a.x)) / 2;
        for (const id of [bar.nodeA, bar.nodeB]) {
          const n = nodal.get(id);
          n.dead += dead;
          n.roofDead += dead;
          n.snow += snow;
        }
      }
    }
    for (const bar of bars.filter((b) => b.role === "bottom")) {
      const a = map.get(bar.nodeA),
        b = map.get(bar.nodeB),
        W = (p.ceilingDead * (p.ceilingSpacing ?? p.spacing) * Math.abs(b.x - a.x)) / 2;
      for (const id of [bar.nodeA, bar.nodeB]) {
        nodal.get(id).dead += W;
        nodal.get(id).ceilingDead += W;
      }
    }
    const tails = [];
    for (const [side, e] of [
      ["low", p.overhangLow],
      ["high", p.overhangHigh],
    ])
      if (e > 0) {
        if (p.type === "mono") throw new Error("Truss tails are supported for pitched trusses only.");
        const supportId = side === "low" ? (p.heelHeight > 0 ? "HA" : "A") : p.heelHeight > 0 ? "HB" : "B",
          support = map.get(supportId),
          bar = bars.find((b) => b.role === "top" && (b.nodeA === supportId || b.nodeB === supportId)),
          panel = map.get(bar.nodeA === supportId ? bar.nodeB : bar.nodeA),
          horizontal = Math.abs(panel.x - support.x),
          slopeLength = (e * bar.length) / horizontal,
          cos = horizontal / bar.length,
          localMu = side === "low" ? (p.muLeft ?? p.mu) : (p.muRight ?? p.mu),
          roofDead = p.roofDead * p.spacing * slopeLength,
          timber = (((p.chordB * p.chordH) / 1e6) * slopeLength * p.timberDensity * g) / 1000,
          snow = p.snow * localMu * p.spacing * e,
          a = Math.abs(panel.x - support.x);
        const apply = (field, W) => {
          const pair = (W * e) / (2 * a);
          nodal.get(supportId)[field] += W + pair;
          nodal.get(panel.id)[field] -= pair;
        };
        apply("dead", roofDead + timber);
        apply("roofDead", roofDead);
        apply("timber", timber);
        apply("snow", snow);
        tails.push({
          side,
          horizontal: e,
          slopeLength,
          supportNode: supportId,
          panelNode: panel.id,
          panelDistance: a,
          roofDead,
          timber,
          snow,
          characteristic: roofDead + timber + snow,
          design: (roofDead + timber) * p.gammaG + snow * p.gammaQ,
          characteristicMoment: ((roofDead + timber + snow) * e) / 2,
          designMoment: (((roofDead + timber) * p.gammaG + snow * p.gammaQ) * e) / 2,
          resultantX: support.x + (side === "low" ? -e / 2 : e / 2),
          pairNote:
            "End resultant plus equal/opposite vertical nodal pair. This matches global force and moment, not a rotational frame-element stiffness.",
        });
      }
    result.tails = tails;
    const loads = [...nodal.values()].map((n) => ({
      ...n,
      characteristic: n.dead + n.snow,
      design: n.dead * p.gammaG + n.snow * p.gammaQ,
      fyCharacteristic: -(n.dead + n.snow),
      fyDesign: -(n.dead * p.gammaG + n.snow * p.gammaQ),
    }));
    result.loads = {
      nodal: loads,
      roofDead: sum(loads.map((n) => n.roofDead)),
      ceilingDead: sum(loads.map((n) => n.ceilingDead)),
      ceilingArea: p.span * (p.ceilingSpacing ?? p.spacing),
      snow: sum(loads.map((n) => n.snow)),
      timber: sum(loads.map((n) => n.timber)),
      totalCharacteristic: sum(loads.map((n) => n.characteristic)),
      totalDesign: sum(loads.map((n) => n.design)),
      projectedArea: (p.span + p.overhangLow + p.overhangHigh) * p.spacing,
      roofArea:
        (sum(bars.filter((b) => b.role === "top").map((b) => b.length)) +
          sum(tails.map((t) => t.slopeLength))) *
        p.spacing,
      tails,
    };
    result.totals = {
      volume: sum(bars.map((b) => b.volume)) + (sum(tails.map((t) => t.timber)) * 1000) / g / p.timberDensity,
      mass: sum(bars.map((b) => b.mass)) + (sum(tails.map((t) => t.timber)) * 1000) / g,
      length: sum(bars.map((b) => b.length)) + sum(tails.map((t) => t.slopeLength)),
      count: bars.length,
      overStock: bars.filter((b) => b.length > p.stockLength + 1e-8).map((b) => b.id),
    };
    const supports = [
      { node: "A", x: true, y: true },
      { node: "B", x: false, y: true },
    ];
    const design = solvePlanarTruss(
      nodes,
      bars,
      loads.map((n) => ({ node: n.node, fy: n.fyDesign })),
      supports,
    );
    const service = solvePlanarTruss(
      nodes,
      bars,
      loads.map((n) => ({ node: n.node, fy: n.fyCharacteristic })),
      supports,
    );
    const supportNodes = new Set(["A", "B", "HA", "HB"]);
    result.bars = bars.map((b, i) => {
      const force = Math.abs(design.forces[i]) < 1e-8 ? 0 : design.forces[i],
        forceCharacteristic = service.forces[i],
        area = b.b * b.h,
        Imin = (Math.max(b.b, b.h) * Math.min(b.b, b.h) ** 3) / 12;
      // Ideal Euler kept for reference only (E, K=1, full length). It is NOT a capacity.
      const euler = (Math.PI ** 2 * p.E * Imin) / (b.length * 1000) ** 2 / 1000;
      // СП 64 / СНиП II-25-80 п. 4.2–4.3: in-plane l0 = node-to-node length (h in plane);
      // out of plane (b): chords restrained by battens/ceiling at chordRestraint,
      // web members unrestrained over their full length.
      const chord = b.role !== "web",
        kind = chord
          ? "chord"
          : supportNodes.has(b.nodeA) || supportNodes.has(b.nodeB)
            ? "supportStrut"
            : "web",
        l0InPlane = b.length,
        l0OutOfPlane = chord ? Math.min(b.length, p.chordRestraint) : b.length,
        buckling = axialCompression({
          N: Math.max(0, -force),
          b: b.b,
          h: b.h,
          l0Strong: l0InPlane,
          l0Weak: l0OutOfPlane,
          Fc: p.compressionDesign,
          kind,
        });
      const tensionCapacity = (p.tensionDesign * area) / 1000,
        compressionCapacity = buckling.capacity;
      const capacity = force >= 0 ? tensionCapacity : compressionCapacity,
        utilization = Math.abs(force) / capacity,
        slendernessFail = force < 0 && buckling.lambda > buckling.lambdaLimit;
      return {
        ...b,
        force,
        forceCharacteristic,
        stress: (force * 1000) / area,
        area,
        Imin,
        euler,
        idealEulerReferenceOnly: true,
        memberKind: kind,
        l0InPlane,
        l0OutOfPlane,
        lambdaInPlane: buckling.lambdaStrong,
        lambdaOutOfPlane: buckling.lambdaWeak,
        lambda: buckling.lambda,
        lambdaLimit: buckling.lambdaLimit,
        phi: buckling.phi,
        phiInPlane: buckling.phiStrong,
        phiOutOfPlane: buckling.phiWeak,
        tensionCapacity,
        compressionCapacity,
        capacity,
        utilization,
        forceType: force > 0 ? "tension" : force < 0 ? "compression" : "zero",
        status: utilization > 1 || slendernessFail ? "fail" : force < 0 ? "warning" : "pass",
        extension: (forceCharacteristic * 1000 * b.length * 1000) / (p.E * area),
      };
    });
    result.reactions = design.reactions.map((r, i) => ({
      ...r,
      characteristicX: service.reactions[i].x,
      characteristicY: service.reactions[i].y,
    }));
    result.displacements = nodes.map((n, i) => ({
      node: n.id,
      x: service.u[2 * i] * 1000,
      y: service.u[2 * i + 1] * 1000,
      designX: design.u[2 * i] * 1000,
      designY: design.u[2 * i + 1] * 1000,
    }));
    const maxDeflection = Math.max(...result.displacements.map((d) => Math.abs(d.y))),
      deflectionAllowed = (p.span * 1000) / p.deflectionLimit;
    const balanceY = sum(result.reactions.map((r) => r.y)) - result.loads.totalDesign,
      balanceX = sum(result.reactions.map((r) => r.x));
    const balanceMoment =
      sum(result.reactions.map((r) => map.get(r.node).x * r.y - map.get(r.node).y * r.x)) -
      sum(loads.map((l) => map.get(l.node).x * l.design));
    result.checks = [
      ...result.bars.map((b) => ({
        id: b.id,
        label: `${b.id} · ${b.forceType === "compression" ? "сжатие / устойчивость φ (СП 64)" : b.forceType === "tension" ? "растяжение" : "нулевое усилие"}`,
        value: Math.abs(b.force),
        limit: b.capacity,
        unit: "кН",
        utilization: b.utilization,
        status: b.utilization > 1 ? "fail" : b.status === "fail" ? "warning" : b.status,
        phi: b.phi,
        lambda: b.lambda,
      })),
      ...result.bars
        .filter((b) => b.forceType === "compression")
        .map((b) => ({
          id: `${b.id}-slenderness`,
          label: `${b.id} · предельная гибкость λ ≤ ${b.lambdaLimit} (СНиП II-25-80 табл. 14)`,
          value: b.lambda,
          limit: b.lambdaLimit,
          unit: "",
          utilization: b.lambda / b.lambdaLimit,
          status: b.lambda > b.lambdaLimit ? "fail" : "pass",
        })),
      {
        id: "deflection",
        label: "Вертикальное перемещение узлов",
        value: maxDeflection,
        limit: deflectionAllowed,
        unit: "мм",
        utilization: maxDeflection / deflectionAllowed,
        status: maxDeflection > deflectionAllowed ? "fail" : "warning",
      },
      {
        id: "equilibrium",
        label: "Баланс вертикальных сил",
        value: Math.abs(balanceY),
        limit: 1e-6,
        unit: "кН",
        status: Math.abs(balanceY) < 1e-6 ? "pass" : "fail",
      },
      {
        id: "connections",
        label: "Узлы, крепёж и устойчивость из плоскости",
        status: "unverified",
        note: "Не проверены; численное решение плоской фермы не подтверждает её пространственную устойчивость.",
      },
      {
        id: "chordBending",
        label: "Местный изгиб верхнего пояса",
        status: "unverified",
        note: "Нагрузка идеализирована узловой. Реальная обрешётка и прогоны между узлами требуют расчёта изгиба пояса.",
      },
    ];
    result.analysis = {
      method: "2D pin-jointed linear elastic stiffness EA/L",
      freeDofs: design.freeCount,
      memberCount: bars.length,
      nodeCount: nodes.length,
      staticDeterminacy: bars.length + 3 - 2 * nodes.length,
      residual: design.residual,
      balanceY,
      balanceX,
      balanceMoment,
      maxDeflection,
      deflectionAllowed,
      maxUtilization: Math.max(...result.bars.map((b) => b.utilization), maxDeflection / deflectionAllowed),
    };
    if (tails.length)
      result.assumptions.push(
        "Eave tails have real area and timber self-weight. Each uniformly loaded tail is represented by its resultant at the end node and a statically equivalent vertical force couple using the adjacent upper panel node. Separate chord bending, heel joints and out-of-plane stability remain required.",
      );
    if (p.heelHeight > 0)
      result.assumptions.push(
        "Raised heel nodes, verticals and diagonals are included in the pin-jointed topology. Physical seat offsets and gusset force transfer are not connection approval.",
      );
    result.stable = true;
    result.status = result.checks.some((c) => c.status === "fail") ? "fail" : "warning";
    return result;
  } catch (error) {
    result.errors.push(error.message);
    result.stable = false;
    result.status = "fail";
    return result;
  }
}

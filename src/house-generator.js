import { resolveDressedProject } from "./lumber-standards.js";
import { defaultDesignerProject, parseSection, validateDesignerProject } from "./designer-engine.js";
import { normalizeDesignerState } from "./designer-state.js";
import { autoRoofZones } from "./roof-zones.js";
import { siteLoads } from "./site-loads.js";

const EPS = 1e-7,
  clone = (x) => JSON.parse(JSON.stringify(x)),
  finite = Number.isFinite;
const object = (q) => q !== null && typeof q === "object" && !Array.isArray(q);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const signed = (p) =>
  p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0) / 2;
const area = (p) => Math.abs(signed(p));
const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const bounds = (p) => ({
  minX: Math.min(...p.map((q) => q.x)),
  maxX: Math.max(...p.map((q) => q.x)),
  minY: Math.min(...p.map((q) => q.y)),
  maxY: Math.max(...p.map((q) => q.y)),
});
function on(q, a, b) {
  return (
    Math.abs(cross(a, b, q)) < EPS &&
    q.x >= Math.min(a.x, b.x) - EPS &&
    q.x <= Math.max(a.x, b.x) + EPS &&
    q.y >= Math.min(a.y, b.y) - EPS &&
    q.y <= Math.max(a.y, b.y) + EPS
  );
}
function inside(q, p) {
  if (p.some((a, i) => on(q, a, p[(i + 1) % p.length]))) return true;
  let yes = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i],
      b = p[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}
function hit(a, b, c, d) {
  const u = { x: b.x - a.x, y: b.y - a.y },
    v = { x: d.x - c.x, y: d.y - c.y },
    ca = { x: c.x - a.x, y: c.y - a.y },
    den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < EPS) return null;
  const t = (ca.x * v.y - ca.y * v.x) / den,
    s = (ca.x * u.y - ca.y * u.x) / den;
  return t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS ? { t, s } : null;
}
function contained(subject, p) {
  for (let i = 0; i < subject.length; i++) {
    const a = subject[i],
      b = subject[(i + 1) % subject.length],
      cuts = [0, 1];
    if (!inside(a, p)) return false;
    for (let j = 0; j < p.length; j++) {
      const h = hit(a, b, p[j], p[(j + 1) % p.length]);
      if (h) cuts.push(Math.max(0, Math.min(1, h.t)));
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) {
      const t = (cuts[j] + cuts[j - 1]) / 2;
      if (!inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, p)) return false;
    }
  }
  return true;
}
function intersectsArea(a, b) {
  if (a.some((q) => inside(q, b) && !b.some((x, i) => on(q, x, b[(i + 1) % b.length])))) return true;
  if (b.some((q) => inside(q, a) && !a.some((x, i) => on(q, x, a[(i + 1) % a.length])))) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const h = hit(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]);
      if (h && h.t > EPS && h.t < 1 - EPS && h.s > EPS && h.s < 1 - EPS) return true;
    }
  const center = (p) => ({
    x: p.reduce((s, q) => s + q.x, 0) / p.length,
    y: p.reduce((s, q) => s + q.y, 0) / p.length,
  });
  return inside(center(a), b) || inside(center(b), a);
}
export class HouseGenerationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "HouseGenerationError";
    this.errors = [{ field, message }];
  }
}
const reject = (field, message) => {
  throw new HouseGenerationError(field, message);
};
function number(v, lo, hi, field) {
  if (!finite(v) || v < lo || v > hi) reject(field, `${field}: требуется число от ${lo} до ${hi}.`);
  return v;
}
function polygon(raw, field) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 100)
    reject(field, "Контур: массив из3–100 точек {x,y}.");
  let p = raw.map((q, i) => {
    if (!object(q) || !finite(q.x) || !finite(q.y) || Math.abs(q.x) > 1000 || Math.abs(q.y) > 1000)
      reject(`${field}.${i}`, "Координаты должны быть конечными числами в пределах±1000м.");
    return { x: q.x, y: q.y };
  });
  if (distance(p[0], p.at(-1)) < EPS) p.pop();
  if (p.length < 3) reject(field, "Контур должен иметь минимум3 различные вершины.");
  for (let i = 0; i < p.length; i++) {
    if (distance(p[i], p[(i + 1) % p.length]) < 0.2 - EPS)
      reject(field, "Каждая сторона контура должна быть не короче0.2м.");
    for (let j = 0; j < i; j++) {
      if (Math.abs(i - j) === 1 || Math.abs(i - j) === p.length - 1) continue;
      if (
        hit(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length]) ||
        on(p[i], p[j], p[(j + 1) % p.length]) ||
        on(p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])
      )
        reject(field, "Контур должен быть простым, без самопересечений и наложенных сторон.");
    }
  }
  const b = bounds(p);
  if (b.maxX - b.minX > 100 || b.maxY - b.minY > 100 || area(p) < 0.04)
    reject(field, "Контур: положительная площадь и габариты не более100×100м.");
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length; i++)
      if (Math.abs(cross(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length])) < EPS) {
        p.splice(i, 1);
        changed = true;
        break;
      }
  }
  if (signed(p) < 0) p.reverse();
  const first = p.reduce(
    (best, q, i) =>
      q.x < p[best].x - EPS || (Math.abs(q.x - p[best].x) < EPS && q.y < p[best].y) ? i : best,
    0,
  );
  p = p.slice(first).concat(p.slice(0, first));
  return p;
}
function explicitBounds(q, field) {
  if (!object(q)) reject(field, "bounds: {minX,minY,maxX,maxY} или {x,y,width,depth}.");
  const b = finite(q.minX)
    ? { minX: q.minX, minY: q.minY, maxX: q.maxX, maxY: q.maxY }
    : { minX: q.x, minY: q.y, maxX: q.x + q.width, maxY: q.y + q.depth };
  if (!Object.values(b).every(finite) || b.maxX - b.minX < 0.2 || b.maxY - b.minY < 0.2)
    reject(field, "bounds должен задавать невырожденный прямоугольник.");
  return b;
}

// ---------------------------------------------------------------------------
// Structure-aware layout generation.
//
// Order of decisions: structure first (joist direction, bearing lines that keep
// joist spans under a target, ridge along the long side), then rooms are packed
// into "bins" bounded by those lines. A bin is a rectangle whose door edge lies
// on circulation; rooms subdivide the bin along that edge, so every room reaches
// circulation through a real door. No structural evaluation runs here.
// ---------------------------------------------------------------------------

export const LAYOUT_STRATEGIES = Object.freeze({
  corridor: "Коридор 1.2 м вдоль длинной оси, две полосы комнат; стены коридора несущие на нижних этажах.",
  "central-hall":
    "Холл поперёк дома в середине длинной оси, комнаты в торцевых зонах; несущий хребет по середине пролёта.",
  "side-corridor": "Коридор вдоль одной длинной стены и одна полоса комнат (узкий дом).",
  "open-plan":
    "Открытая гостиная/кухня во всю глубину в одном торце и приватное крыло с коридором; хребет проходит над широким проёмом.",
  "l-corridor":
    "L-контур: коридор вдоль внутренней линии сопряжения крыльев, комнаты обоих крыльев выходят в коридор.",
  "l-corridor-alt": "L-контур: то же, при другой разрезке крыльев и другом направлении лаг.",
});
const RECT_STRATEGIES = ["corridor", "central-hall", "side-corridor", "open-plan"],
  L_STRATEGIES = ["l-corridor", "l-corridor-alt"];
const HALL_POSITIONS = [0.5, 0.4, 0.6, 0.3, 0.7],
  VARIANTS = { "central-hall": HALL_POSITIONS.length };
const MIN_ROOM_DEPTH = 1.8;
const CORRIDOR = 1.2,
  PUBLIC_ROOM = /кухн|гостин|столов|холл|living|kitchen|dining/i;

const misfit = (field, message) => {
  const e = new HouseGenerationError(field, message);
  e.misfit = true;
  throw e;
};
const round = (v, k = 1000) => Math.round(v * k) / k;

/** Orthogonal polygon → maximal rectangles by cuts perpendicular to `axis` ("x" | "y"). */
function orthogonalRectangles(poly, axis) {
  const axisAligned = poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS;
  });
  if (!axisAligned) return null;
  // axis "y": joists run along y, cut lines run along x (y = const).
  const along = axis === "y" ? "y" : "x",
    other = along === "y" ? "x" : "y",
    cuts = [...new Set(poly.map((q) => round(q[along], 1e6)))].sort((a, b) => a - b),
    rects = [];
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1],
      hi = cuts[i],
      mid = (lo + hi) / 2,
      xs = [];
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j],
        b = poly[(j + 1) % poly.length];
      if (a[along] > mid !== b[along] > mid && Math.abs(a[other] - b[other]) < EPS) xs.push(a[other]);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const prev = rects.find(
        (r) => Math.abs(r.hi - lo) < EPS && Math.abs(r.a - xs[k]) < EPS && Math.abs(r.b - xs[k + 1]) < EPS,
      );
      if (prev) prev.hi = hi;
      else rects.push({ lo, hi, a: xs[k], b: xs[k + 1] });
    }
  }
  return rects.map((r) =>
    along === "y"
      ? { minX: r.a, maxX: r.b, minY: r.lo, maxY: r.hi }
      : { minX: r.lo, maxX: r.hi, minY: r.a, maxY: r.b },
  );
}
const extent = (b, axis) => (axis === "x" ? b.maxX - b.minX : b.maxY - b.minY);
function joistAxisFor(poly) {
  const score = (axis) => {
    const rects = orthogonalRectangles(poly, axis);
    if (rects) return Math.max(...rects.map((r) => extent(r, axis)));
    const b = bounds(poly);
    return extent(b, axis);
  };
  return score("x") < score("y") - EPS ? "x" : "y";
}
/** Joist span target from serviceability L/300 of a simply supported joist; a pre-sizing screen only. */
function joistSpanTarget(sectionName, spacing, loads, material) {
  const s = parseSection(resolveDressedProject({ material, section: sectionName }).section),
    q = ((loads.floorDead ?? 0.6) + (loads.live ?? 1.5)) * spacing, // kN/m = N/mm
    E = material.E ?? 10000,
    I = (s.b * s.h ** 3) / 12,
    L = Math.cbrt((384 * E * I) / (5 * Math.max(q, 0.05) * 300)) / 1000;
  return Math.max(2, Math.min(6.5, Math.floor(L * 0.95 * 20) / 20));
}
function ridgeFor(polygons, defaults) {
  let best = null;
  for (const angle of [0, 90]) {
    let span = 0;
    for (const p of polygons) {
      const zones = autoRoofZones(p, { ...defaults, ridgeAngle: angle });
      const rects =
        zones.length && zones.every((z) => z.polygon.length === 4)
          ? zones.map((z) => bounds(z.polygon))
          : [bounds(p)];
      for (const r of rects) span = Math.max(span, angle === 0 ? r.maxY - r.minY : r.maxX - r.minX);
    }
    if (!best || span < best.span - EPS) best = { angle, span };
  }
  return best;
}

function prepare(spec) {
  if (!object(spec)) reject("spec", "Параметры генерации должны быть объектом.");
  for (const k of ["sections", "roof", "loads", "material", "foundation", "bracing", "site", "structure"])
    if (spec[k] !== undefined && !object(spec[k])) reject(k, `${k}: требуется объект параметров.`);
  if (spec.foundation?.grillage !== undefined && !object(spec.foundation.grillage))
    reject("foundation.grillage", "Ростверк задаётся объектом параметров.");
  if (spec.strategy !== undefined && !LAYOUT_STRATEGIES[spec.strategy] && spec.strategy !== "explicit")
    reject("strategy", `Стратегия планировки: ${Object.keys(LAYOUT_STRATEGIES).join(", ")}.`);
  if (spec.stair !== undefined && typeof spec.stair !== "boolean")
    reject("stair", "stair: true/false (автоматическая лестница для двух этажей).");
  const studStep = number(spec.studStep ?? 0.6, 0.2, 1.2, "studStep");
  const shape = spec.template ?? "rectangle";
  if (!["rectangle", "l-shape"].includes(shape)) reject("template", "Шаблон: rectangle или l-shape.");
  let basePolygon;
  if (spec.footprint !== undefined) basePolygon = polygon(spec.footprint, "footprint");
  else {
    const W = number(spec.width ?? 8, 2, 100, "width"),
      D = number(spec.depth ?? 6, 2, 100, "depth");
    if (shape === "rectangle") basePolygon = rect(0, 0, W, D);
    else {
      const wingW = number(spec.wingWidth ?? W / 2, 0.4, W - 0.4, "wingWidth"),
        wingD = number(spec.wingDepth ?? D / 2, 0.4, D - 0.4, "wingDepth");
      basePolygon = polygon(
        [
          { x: 0, y: 0 },
          { x: W, y: 0 },
          { x: W, y: wingD },
          { x: wingW, y: wingD },
          { x: wingW, y: D },
          { x: 0, y: D },
        ],
        "footprint",
      );
    }
  }
  const requestedLevels = spec.levels ?? [{ height: 2.8 }];
  if (!Array.isArray(requestedLevels) || requestedLevels.length < 1 || requestedLevels.length > 2)
    reject("levels", "Поддерживаются один или два этажа.");
  const levelPolygons = [];
  for (const [i, l] of requestedLevels.entries()) {
    if (!object(l)) reject(`levels.${i}`, "Этаж должен быть объектом.");
    number(l.height ?? 2.8, 2, 5, `levels.${i}.height`);
    levelPolygons.push(
      l.footprint === undefined
        ? clone(levelPolygons[0] ?? basePolygon)
        : polygon(l.footprint, `levels.${i}.footprint`),
    );
  }
  const sections = {
    walls: "50x150",
    floor: "50x250",
    roof: "50x200",
    roofWeb: "50x100",
    bracing: "25x100",
    grillage: "50x200",
    ...spec.sections,
  };
  for (const [k, s] of Object.entries(sections))
    if (!parseSection(s))
      reject(`sections.${k}`, "Сечение: b×h в мм, в допустимом диапазоне расчётного ядра.");
  const levels = requestedLevels.map((l, i) => ({
    id: `GEN-LEVEL-${i + 1}`,
    index: i + 1,
    name: l.name ?? `${i + 1} этаж`,
    height: l.height ?? 2.8,
  }));
  // Site → normative loads; explicit spec.loads always win.
  let site = null;
  if (spec.site !== undefined) {
    try {
      site = siteLoads(spec.site);
    } catch (e) {
      reject(`site.${e.errors?.[0]?.field ?? ""}`, e.message);
    }
  }
  const loads = { ...defaultDesignerProject.loads },
    loadOrigin = {};
  for (const k of ["snow", "wind", "terrain"]) {
    if (spec.loads?.[k] !== undefined) {
      loads[k] = spec.loads[k];
      loadOrigin[k] = "explicit";
    } else if (site && site[k] !== null && site[k] !== undefined) {
      loads[k] = site[k];
      loadOrigin[k] = "site";
    } else if (loads[k] !== undefined) loadOrigin[k] = "default";
  }
  Object.assign(loads, spec.loads);
  if (loads.terrain !== undefined && !["A", "B", "C"].includes(loads.terrain))
    reject("loads.terrain", "Тип местности: A, B или C.");
  const material = { ...defaultDesignerProject.material, ...spec.material };
  const explicitAxis = spec.floor?.axis;
  if (explicitAxis !== undefined && !["x", "y"].includes(explicitAxis))
    reject("floor.axis", "Направление лаг: x или y.");
  const joistSpacing = number(spec.joistSpacing ?? spec.floor?.spacing ?? 0.6, 0.2, 1.2, "joistSpacing"),
    floorSection = spec.floor?.section ?? sections.floor;
  if (!parseSection(floorSection)) reject("floor.section", "Сечение лаг: b×h в мм.");
  const structure = spec.structure ?? {};
  if (structure.bearingWalls !== undefined && typeof structure.bearingWalls !== "boolean")
    reject("structure.bearingWalls", "structure.bearingWalls: true/false.");
  const targetFromSection = joistSpanTarget(floorSection, joistSpacing, loads, material),
    maxJoistSpan =
      structure.maxJoistSpan === undefined
        ? targetFromSection
        : number(structure.maxJoistSpan, 1.5, 12, "structure.maxJoistSpan");
  const roofInput = {
    shape: "gable",
    pitch: 25,
    pitchRight: spec.roof?.pitch ?? 25,
    framing: "auto",
    wallFraming: "auto",
    ...spec.roof,
  };
  if (!["mono", "gable", "hip"].includes(roofInput.shape))
    reject("roof.shape", "Форма крыши: mono, gable или hip.");
  number(roofInput.pitch, 2, 60, "roof.pitch");
  number(roofInput.pitchRight, 2, 60, "roof.pitchRight");
  if (roofInput.ridgeAngle !== undefined && !finite(roofInput.ridgeAngle))
    reject("roof.ridgeAngle", "Направление крыши должно быть конечным числом градусов.");
  const roofPolygons = [levelPolygons.at(-1), ...(levelPolygons.length > 1 ? [levelPolygons[0]] : [])],
    ridge = ridgeFor(roofPolygons, { type: roofInput.shape === "mono" ? "mono" : "fink" });
  const roofExplicitRidge = roofInput.ridgeAngle !== undefined;
  if (!roofExplicitRidge) roofInput.ridgeAngle = ridge.angle;
  const rooms = spec.rooms ?? [];
  if (!Array.isArray(rooms) || rooms.length > 30)
    reject("rooms", "Программа помещений: массив не более30 комнат.");
  rooms.forEach((r, i) => {
    if (!object(r) || typeof r.name !== "string" || !r.name || r.name.length > 100)
      reject(`rooms.${i}`, "У каждой комнаты должно быть непустое имя до100 символов.");
    number(r.area, 0.5, 10000, `rooms.${i}.area`);
    if (!Number.isInteger(r.level ?? 1) || (r.level ?? 1) < 1 || (r.level ?? 1) > levels.length)
      reject(`rooms.${i}.level`, "Комната задана на несуществующем этаже.");
    for (const k of ["minWidth", "minDepth"])
      if (r[k] !== undefined) number(r[k], 0.2, 100, `rooms.${i}.${k}`);
  });
  const wall = parseSection(sections.walls),
    D = wall.h / 1000,
    B = wall.b / 1000;
  return {
    spec,
    shape,
    basePolygon,
    levelPolygons,
    levels,
    sections,
    site,
    loads,
    loadOrigin,
    material,
    studStep,
    joistSpacing,
    floorSection,
    explicitAxis,
    joistAxis: explicitAxis ?? joistAxisFor(basePolygon),
    maxJoistSpan,
    maxJoistSpanBasis:
      structure.maxJoistSpan === undefined
        ? `Предварительный ориентир: прогиб L/300 однопролётной лаги ${floorSection} шаг ${joistSpacing} м при (floorDead+live)=${round((loads.floorDead ?? 0.6) + (loads.live ?? 1.5), 100)} кПа, E=${material.E} МПа, ×0.95. Не заменяет расчёт ядра.`
        : "Задано structure.maxJoistSpan.",
    bearingWalls: structure.bearingWalls ?? true,
    roofInput,
    roofExplicitRidge,
    ridge,
    rooms,
    D,
    B,
    endMargin: 0.35 + D + 4 * B,
    minSlot: 0.6 + 2 * (0.35 + D + 4 * B),
  };
}

// Local frame: t along the spine/corridor (perpendicular to joists), s across (along joists).
function frame(spineAlongX) {
  const P = (t, s) => (spineAlongX ? { x: t, y: s } : { x: s, y: t });
  const R = (t0, t1, s0, s1) =>
    spineAlongX
      ? { minX: Math.min(t0, t1), maxX: Math.max(t0, t1), minY: Math.min(s0, s1), maxY: Math.max(s0, s1) }
      : { minX: Math.min(s0, s1), maxX: Math.max(s0, s1), minY: Math.min(t0, t1), maxY: Math.max(t0, t1) };
  const T = (b) => (spineAlongX ? [b.minX, b.maxX] : [b.minY, b.maxY]),
    S = (b) => (spineAlongX ? [b.minY, b.maxY] : [b.minX, b.maxX]);
  return { P, R, T, S, spineAlongX };
}
// Bin: rectangle with a door edge. map "ts": run r = t, depth d = s; "st": r = s, d = t.
function bin(F, map, r0, r1, d0, d1, doorD, extra = {}) {
  const point = (r, d) => (map === "ts" ? F.P(r, d) : F.P(d, r)),
    box = (a, b) => (map === "ts" ? F.R(a, b, d0, d1) : F.R(d0, d1, a, b));
  return { map, r0, r1, d0, d1, doorD, point, box, rIsX: (map === "ts") === F.spineAlongX, ...extra };
}

function stairGeometry(ctx) {
  const rise = ctx.levels[0].height + parseSection(ctx.floorSection).h / 1000 + 0.035,
    risers = Math.min(40, Math.max(8, 2 * Math.ceil(rise / 0.18 / 2))),
    going = 0.275,
    landing = 1,
    flightWidth = 1,
    gap = 0.2,
    length = landing + going * (risers / 2 - 1),
    width = 2 * flightWidth + gap,
    plies = 2,
    frameHalf = (parseSection(ctx.floorSection).b * plies) / 2000,
    clearance = 0.25;
  return { rise, risers, going, landing, flightWidth, gap, length, width, plies, frameHalf, clearance };
}
const exitName = (u) => (Math.abs(u.x) > 0.5 ? (u.x > 0 ? "east" : "west") : u.y > 0 ? "south" : "north");

/** Try to reserve a stair cell at the start of a bin. Returns {cell, stair} or null. */
function placeStair(ctx, b, st) {
  const { D } = ctx,
    f = st.frameHalf,
    clearDepth = b.d1 - b.d0 - D,
    exitClear = 1.2,
    c = st.clearance,
    dir = Math.sign(b.doorD - (b.d0 + b.d1) / 2) || 1;
  // A: flights perpendicular to the door edge, exit faces the door edge.
  const aLen = D + 2 * f + 2 * c + st.width,
    farD = b.doorD === b.d1 ? b.d0 : b.d1;
  if (
    clearDepth >= st.length + 2 * f + c + exitClear - EPS &&
    b.r1 - b.r0 >= Math.max(aLen, ctx.minSlot) - EPS
  ) {
    const len = Math.max(aLen, ctx.minSlot),
      r0 = b.r0 + D / 2 + f + c + (len - aLen) / 2,
      dFar = farD + dir * (D / 2 + f + c),
      dNear = dFar + dir * st.length,
      poly = [
        b.point(r0, dFar),
        b.point(r0 + st.width, dFar),
        b.point(r0 + st.width, dNear),
        b.point(r0, dNear),
      ],
      U = (() => {
        const a = b.point(0, 0),
          z = b.point(0, dir);
        return { x: z.x - a.x, y: z.y - a.y };
      })();
    return { len, polygon: poly, exit: exitName(U), doorR: b.r0 + len / 2, orientation: "across" };
  }
  // B: flights parallel to the door edge, exit landing beside the stair.
  const cr = c,
    bLen = D + 2 * f + cr + st.length + exitClear;
  if (clearDepth >= st.width + 2 * f + c - EPS && b.r1 - b.r0 >= bLen - EPS) {
    const r0 = b.r0 + D / 2 + f + cr,
      dFar = farD + dir * (D / 2 + f + c),
      dNear = dFar + dir * st.width,
      poly = [
        b.point(r0, dFar),
        b.point(r0 + st.length, dFar),
        b.point(r0 + st.length, dNear),
        b.point(r0, dNear),
      ],
      a = b.point(0, 0),
      z = b.point(1, 0);
    return {
      len: bLen,
      polygon: poly,
      exit: exitName({ x: z.x - a.x, y: z.y - a.y }),
      doorR: b.r0 + D / 2 + 2 * f + cr + st.length + exitClear / 2,
      doorWidth: 0.8,
      orientation: "along",
    };
  }
  return null;
}

/** Pack rooms into bins; returns array of placed cells (rooms + spare) per bin. */
function packBins(ctx, bins, requested, level) {
  const { D, minSlot } = ctx;
  const items = requested.map((r) => ({ ...r, slots: [] }));
  for (const r of items)
    for (const b of bins) {
      const clear = b.d1 - b.d0 - D,
        minAlong = b.rIsX ? r.minWidth : r.minDepth,
        minCross = b.rIsX ? r.minDepth : r.minWidth;
      r.slots.push(
        clear <= 0.2 || (minCross ?? 0) > clear + EPS
          ? Infinity
          : Math.max(r.area / clear + D, (minAlong ?? 0) + D, minSlot),
      );
    }
  for (const r of items)
    if (r.slots.every((s) => !finite(s)))
      misfit(
        `rooms.${r.index}`,
        `${r.name}: минимальный поперечный размер не помещается между наружной стеной и коридором/холлом.`,
      );
  const order = [...items].sort((a, b) => Math.min(...b.slots) - Math.min(...a.slots) || a.index - b.index),
    used = bins.map(() => 0),
    cap = bins.map((b) => b.r1 - b.r0),
    assignment = new Map(),
    memo = new Set();
  let nodes = 0;
  const place = (i) => {
    if (i === order.length) return true;
    if (++nodes > 200000) return false;
    const k = `${i}/${used.map((u) => Math.round(u * 1000)).join(",")}`;
    if (memo.has(k)) return false;
    memo.add(k);
    const q = order[i],
      tried = new Set();
    for (const j of bins.map((_, j) => j).sort((a, b) => used[a] / cap[a] - used[b] / cap[b] || a - b)) {
      const s = q.slots[j];
      if (!finite(s) || used[j] + s > cap[j] + EPS) continue;
      const sig = `${Math.round(used[j] * 1000)}/${Math.round(cap[j] * 1000)}/${Math.round(s * 1000)}`;
      if (tried.has(sig)) continue;
      tried.add(sig);
      used[j] += s;
      assignment.set(q.index, j);
      if (place(i + 1)) return true;
      used[j] -= s;
      assignment.delete(q.index);
    }
    return false;
  };
  if (!place(0))
    misfit(
      "rooms",
      `Программа ${level} этажа не размещается в зонах этой планировки. Уменьшите площади/минимальные размеры, увеличьте контур или задайте bounds.`,
    );
  const cells = [];
  bins.forEach((b, j) => {
    const mine = items.filter((r) => assignment.get(r.index) === j).sort((a, b) => a.index - b.index);
    let cursor = b.r0;
    const placed = mine.map((r) => {
      const c = { kind: "room", req: r, r0: cursor, r1: cursor + r.slots[j], bin: b };
      cursor = c.r1;
      return c;
    });
    const leftover = b.r1 - cursor;
    if (leftover > EPS) {
      if (leftover >= minSlot - EPS || !placed.length)
        placed.push({ kind: "spare", r0: cursor, r1: b.r1, bin: b });
      else {
        // Distribute a sliver over the strip instead of inflating one room.
        const used = cursor - b.r0;
        let at = b.r0;
        for (const c of placed) {
          const w = ((c.r1 - c.r0) / used) * (b.r1 - b.r0);
          c.r0 = at;
          c.r1 = at + w;
          at = c.r1;
        }
        placed.at(-1).r1 = b.r1;
      }
    }
    cells.push(...placed);
  });
  return cells;
}

/**
 * Strategy geometry for one level polygon. Returns
 * {bins, circulation:[{name,kind,box,polyBox,entrance?}], lines:[{a,b,bearing,openings:[]}], joistAxis}
 */
function strategyGeometry(ctx, strategy, poly, levelIndex, requested) {
  const { D, endMargin } = ctx,
    CW = CORRIDOR + D;
  const axisRect =
    poly.length === 4 && Math.abs(area(poly) - extent(bounds(poly), "x") * extent(bounds(poly), "y")) < EPS;
  if (RECT_STRATEGIES.includes(strategy)) {
    if (!axisRect)
      misfit(
        "rooms",
        `Стратегия ${strategy} работает на осевом прямоугольнике; для L-контура используются l-corridor, для свободного контура задайте bounds.`,
      );
    const joistAxis = ctx.joistAxis,
      F = frame(joistAxis === "y"),
      bb = bounds(poly),
      [t0, t1] = F.T(bb),
      [s0, s1] = F.S(bb),
      L = t1 - t0,
      S = s1 - s0,
      sc = (s0 + s1) / 2;
    const corridorGeometry = (ta, tb, open) => {
      const c0 = sc - CW / 2,
        c1 = sc + CW / 2;
      if (c0 - s0 - D < MIN_ROOM_DEPTH)
        misfit("rooms", "Дом слишком узок для двух полос комнат и чистого коридора1.2м.");
      return {
        bins: [bin(F, "ts", ta, tb, s0, c0, c0), bin(F, "ts", ta, tb, c1, s1, c1)],
        circulation: [
          {
            name: "Коридор",
            kind: "corridor",
            box: F.R(ta, tb, c0, c1),
            clear: F.R(ta + (open ? 0 : D / 2), tb - D / 2, sc - CORRIDOR / 2, sc + CORRIDOR / 2),
            entrances: open
              ? [[F.P(tb, c0), F.P(tb, c1)]]
              : [
                  [F.P(ta, c0), F.P(ta, c1)],
                  [F.P(tb, c0), F.P(tb, c1)],
                ],
            dimensions: { width: CORRIDOR, length: tb - ta - (open ? D / 2 : D) },
          },
        ],
        lines: [
          { a: F.P(ta, c0), b: F.P(tb, c0), bearing: true, role: "corridor", openings: [] },
          { a: F.P(ta, c1), b: F.P(tb, c1), bearing: true, role: "corridor", openings: [] },
        ],
        c0,
        c1,
      };
    };
    if (strategy === "corridor") return { ...corridorGeometry(t0, t1), joistAxis, F };
    if (strategy === "side-corridor") {
      const c0 = s1 - CW;
      if (c0 - s0 - D <= 0.2)
        misfit("rooms", "Дом слишком узок даже для коридора вдоль стены и одной полосы комнат.");
      return {
        joistAxis,
        F,
        bins: [bin(F, "ts", t0, t1, s0, c0, c0)],
        circulation: [
          {
            name: "Коридор",
            kind: "corridor",
            box: F.R(t0, t1, c0, s1),
            clear: F.R(t0 + D / 2, t1 - D / 2, c0 + D / 2, s1 - D / 2),
            entrances: [
              [F.P(t0, c0), F.P(t0, s1)],
              [F.P(t1, c0), F.P(t1, s1)],
            ],
            dimensions: { width: CORRIDOR, length: L - D },
          },
        ],
        lines: [{ a: F.P(t0, c0), b: F.P(t1, c0), bearing: true, role: "corridor", openings: [] }],
      };
    }
    if (strategy === "central-hall") {
      const HL = Math.max(2.6, CORRIDOR + 2 * endMargin + D),
        h0 = Math.max(
          t0 + D + 2,
          Math.min(t1 - D - 2 - HL, t0 + (L - HL) * HALL_POSITIONS[ctx.variant ?? 0]),
        ),
        h1 = h0 + HL;
      if (h0 - t0 - D < 2) misfit("rooms", "Дом слишком короток для центрального холла и двух торцевых зон.");
      const spine = ctx.levels.length > 1 && S > ctx.maxJoistSpan + EPS,
        sm = sc,
        bins = spine
          ? [
              bin(F, "st", s0, sm, t0, h0, h0),
              bin(F, "st", sm, s1, t0, h0, h0),
              bin(F, "st", s0, sm, h1, t1, h1),
              bin(F, "st", sm, s1, h1, t1, h1),
            ]
          : [bin(F, "st", s0, s1, t0, h0, h0), bin(F, "st", s0, s1, h1, t1, h1)];
      return {
        joistAxis,
        F,
        bins,
        circulation: [
          {
            name: "Холл",
            kind: "hall",
            box: F.R(h0, h1, s0, s1),
            clear: F.R(h0 + D / 2, h1 - D / 2, s0 + D / 2, s1 - D / 2),
            entrances: [
              [F.P(h0, s0), F.P(h1, s0)],
              [F.P(h0, s1), F.P(h1, s1)],
            ],
            dimensions: { width: HL - D, length: S - D },
          },
        ],
        lines: spine
          ? [
              {
                a: F.P(t0, sm),
                b: F.P(t1, sm),
                bearing: true,
                role: "spine",
                openings: [
                  { center: F.P((h0 + h1) / 2, sm), width: HL - 2 * endMargin, kind: "casedOpening" },
                ],
              },
            ]
          : [],
      };
    }
    if (strategy === "open-plan") {
      const open = requested.filter((r) => PUBLIC_ROOM.test(r.name));
      const chosen = open.length
        ? open
        : requested.length > 1
          ? [requested.reduce((a, b) => (b.area > a.area ? b : a))]
          : [];
      if (!chosen.length) misfit("rooms", "Открытая планировка требует хотя бы двух помещений на этаже.");
      const clearS = S - D,
        openArea = chosen.reduce((s, r) => s + r.area, 0),
        lenOpen = Math.max(
          3.3,
          openArea / clearS + D,
          ...chosen.map((r) => (F.spineAlongX ? r.minWidth : r.minDepth) ?? 0).map((v) => v + D),
          2.4,
        ),
        o1 = t0 + lenOpen;
      if (t1 - o1 < ctx.minSlot + D)
        misfit("rooms", "После открытой зоны не остаётся места для приватного крыла.");
      const wing = corridorGeometry(o1, t1, true);
      // Open rooms side by side across the full depth, no partitions between them.
      let cursor = s0;
      const openCells = chosen.map((r, i) => {
        const w = i === chosen.length - 1 ? s1 - cursor : (r.area / openArea) * S,
          c = { kind: "room", open: true, req: r, box: F.R(t0, o1, cursor, cursor + w) };
        cursor += w;
        return c;
      });
      const needsSpine = levelIndex < ctx.levels.length;
      // Upper floor over the open zone: both corridor lines continue as bearing walls over wide cased openings.
      if (needsSpine)
        for (const [k, c] of [
          [0, wing.c0],
          [1, wing.c1],
        ])
          wing.lines[k] = {
            ...wing.lines[k],
            a: F.P(t0, c),
            openings: [
              {
                center: F.P((t0 + o1) / 2, c),
                width: Math.max(0.6, lenOpen - 2 * endMargin),
                kind: "casedOpening",
              },
            ],
          };
      return {
        ...wing,
        joistAxis,
        F,
        openCells,
        openRoomIndexes: chosen.map((r) => r.index),
        openLength: lenOpen,
      };
    }
  }
  if (L_STRATEGIES.includes(strategy)) {
    if (poly.length !== 6)
      misfit("rooms", "Стратегии l-corridor работают на L-контуре из шести осевых сторон.");
    const preferred = ctx.explicitAxis ?? joistAxisFor(poly),
      joistAxis = strategy === "l-corridor" ? preferred : preferred === "x" ? "y" : "x";
    if (strategy === "l-corridor-alt" && ctx.explicitAxis)
      misfit("floor.axis", "Направление лаг задано явно; альтернативная разрезка L-контура не применяется.");
    const rects = orthogonalRectangles(poly, joistAxis);
    if (!rects || rects.length !== 2)
      misfit("rooms", "Контур не раскладывается на два прямоугольника крыльев.");
    const F = frame(joistAxis === "y"),
      [ra, rb] = rects,
      lenT = (r) => F.T(r)[1] - F.T(r)[0],
      A = lenT(ra) >= lenT(rb) ? ra : rb,
      W = A === ra ? rb : ra,
      [at0, at1] = F.T(A),
      [as0, as1] = F.S(A),
      [wt0, wt1] = F.T(W),
      [ws0, ws1] = F.S(W),
      cut = Math.abs(as1 - ws0) < EPS ? as1 : as0,
      wingFar = cut === as1 ? ws1 : ws0,
      dirIn = cut === as1 ? -1 : 1,
      c = cut + dirIn * CW,
      aFar = cut === as1 ? as0 : as1;
    if (Math.abs(c - aFar) - D <= 0.2)
      misfit("rooms", "Основное крыло L-контура слишком узкое для коридора и полосы комнат.");
    return {
      joistAxis,
      F,
      bins: [
        bin(F, "ts", at0, at1, Math.min(aFar, c), Math.max(aFar, c), c),
        bin(F, "ts", wt0, wt1, Math.min(cut, wingFar), Math.max(cut, wingFar), cut),
      ],
      circulation: [
        {
          name: "Коридор",
          kind: "corridor",
          box: F.R(at0, at1, Math.min(c, cut), Math.max(c, cut)),
          clear: F.R(at0 + D / 2, at1 - D / 2, Math.min(c, cut) + D / 2, Math.max(c, cut) - D / 2),
          entrances: [
            [F.P(at0, c), F.P(at0, cut)],
            [F.P(at1, c), F.P(at1, cut)],
          ],
          dimensions: { width: CORRIDOR, length: at1 - at0 - D },
        },
      ],
      lines: [
        { a: F.P(at0, c), b: F.P(at1, c), bearing: true, role: "corridor", openings: [] },
        { a: F.P(wt0, cut), b: F.P(wt1, cut), bearing: true, role: "wing-junction", openings: [] },
      ],
    };
  }
  misfit("strategy", `Неизвестная стратегия ${strategy}.`);
}

/** Shell (no room program): bearing spines only where the upper floor needs them. */
function shellLines(ctx, poly, joistAxis) {
  const rects = orthogonalRectangles(poly, joistAxis);
  if (!rects) return [];
  const spineAlongX = joistAxis === "y",
    lines = [];
  const key = new Set();
  // Interior junction lines between rectangles of the decomposition (re-entrant corners).
  for (let i = 0; i < rects.length; i++)
    for (let j = 0; j < i; j++) {
      const A = rects[i],
        B = rects[j];
      for (const [p, q] of spineAlongX
        ? [
            [A.maxY, B.minY],
            [A.minY, B.maxY],
          ]
        : [
            [A.maxX, B.minX],
            [A.minX, B.maxX],
          ]) {
        if (Math.abs(p - q) > EPS) continue;
        const lo = spineAlongX ? Math.max(A.minX, B.minX) : Math.max(A.minY, B.minY),
          hi = spineAlongX ? Math.min(A.maxX, B.maxX) : Math.min(A.maxY, B.maxY);
        if (hi - lo < 0.2) continue;
        const a = spineAlongX ? { x: lo, y: p } : { x: p, y: lo },
          b = spineAlongX ? { x: hi, y: p } : { x: p, y: hi };
        lines.push({ a, b, bearing: true, role: "wing-junction", openings: [] });
      }
    }
  for (const r of rects) {
    const span = extent(r, joistAxis),
      n = Math.ceil(span / ctx.maxJoistSpan - 1e-9);
    for (let k = 1; k < n; k++) {
      const s = (spineAlongX ? r.minY : r.minX) + (span * k) / n,
        a = spineAlongX ? { x: r.minX, y: s } : { x: s, y: r.minY },
        b = spineAlongX ? { x: r.maxX, y: s } : { x: s, y: r.maxY },
        id = `${round(a.x)},${round(a.y)},${round(b.x)},${round(b.y)}`;
      if (!key.has(id)) {
        key.add(id);
        lines.push({ a, b, bearing: true, role: "spine", openings: [] });
      }
    }
  }
  return lines;
}

function addWall(project, a, b, level, kind, studStep, section) {
  let intervals = [[0, 1]],
    dx = b.x - a.x,
    dy = b.y - a.y,
    L2 = dx * dx + dy * dy;
  for (const w of project.walls.filter((w) => w.level === level)) {
    if (Math.abs(cross(a, b, w.a)) > EPS || Math.abs(cross(a, b, w.b)) > EPS) continue;
    const t = (q) => ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2,
      lo = Math.max(0, Math.min(t(w.a), t(w.b))),
      hi = Math.min(1, Math.max(t(w.a), t(w.b)));
    if (hi - lo < EPS) continue;
    intervals = intervals.flatMap(([x, y]) =>
      hi <= x + EPS || lo >= y - EPS
        ? [[x, y]]
        : [...(lo > x + EPS ? [[x, lo]] : []), ...(hi < y - EPS ? [[hi, y]] : [])],
    );
  }
  const ids = [];
  for (const [lo, hi] of intervals) {
    const aa = { x: a.x + dx * lo, y: a.y + dy * lo },
      zz = { x: a.x + dx * hi, y: a.y + dy * hi };
    if (distance(aa, zz) < 0.2 - EPS)
      misfit(
        "rooms.bounds",
        "Раскладка создаёт отдельный участок перегородки короче0.2м; выровняйте границы помещений.",
      );
    const prefix = kind === "bearing" ? "B" : "P",
      id = `GEN-L${level}-${prefix}${project.walls.filter((w) => w.level === level && w.kind === kind).length + 1}`;
    project.walls.push({ id, level, a: aa, b: zz, kind, section, studStep });
    ids.push(id);
  }
  return ids;
}
const boxEdges = (b) => {
  const p = rect(b.minX, b.minY, b.maxX, b.maxY);
  return p.map((q, i) => [q, p[(i + 1) % 4]]);
};
const segmentOverlap = (a, b, c, d) => {
  // Collinear overlap of segment ab with cd, or null.
  if (Math.abs(cross(a, b, c)) > EPS || Math.abs(cross(a, b, d)) > EPS) return null;
  const L = distance(a, b),
    u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L },
    t = (q) => (q.x - a.x) * u.x + (q.y - a.y) * u.y,
    lo = Math.max(0, Math.min(t(c), t(d))),
    hi = Math.min(L, Math.max(t(c), t(d)));
  return hi - lo > EPS
    ? [
        { x: a.x + u.x * lo, y: a.y + u.y * lo },
        { x: a.x + u.x * hi, y: a.y + u.y * hi },
      ]
    : null;
};

/** Max joist span of upper platforms between real lower supports (exterior and bearing walls). */
export function measureJoistSpans(project) {
  const axis = project.floor?.axis ?? "y",
    out = { axis, levels: [], max: 0 };
  for (const level of (project.levels ?? []).filter((l) => l.index > 1)) {
    const poly = polygonOfLevel(project, level.index);
    if (!poly) continue;
    const supports = project.walls.filter((w) => w.level === level.index - 1 && w.kind !== "partition"),
      b = bounds(poly),
      lo = axis === "y" ? b.minX : b.minY,
      hi = axis === "y" ? b.maxX : b.maxY;
    let max = 0;
    for (let u = lo + 0.15; u <= hi - 0.15 + EPS; u += 0.1) {
      const A = axis === "y" ? { x: u, y: b.minY - 1 } : { x: b.minX - 1, y: u },
        Z = axis === "y" ? { x: u, y: b.maxY + 1 } : { x: b.maxX + 1, y: u },
        ts = [];
      for (let i = 0; i < poly.length; i++) {
        const h = hit(A, Z, poly[i], poly[(i + 1) % poly.length]);
        if (h) ts.push(h.t);
      }
      const sup = [];
      for (const w of supports) {
        const h = hit(A, Z, w.a, w.b);
        if (h) sup.push(h.t);
      }
      ts.sort((a, b) => a - b);
      const len = distance(A, Z);
      for (let k = 0; k + 1 < ts.length; k += 2) {
        const pts = [ts[k], ts[k + 1], ...sup.filter((s) => s > ts[k] + EPS && s < ts[k + 1] - EPS)].sort(
          (a, b) => a - b,
        );
        for (let j = 1; j < pts.length; j++) max = Math.max(max, (pts[j] - pts[j - 1]) * len);
      }
    }
    out.levels.push({ level: level.index, maxSpan: round(max) });
    out.max = Math.max(out.max, round(max));
  }
  return out;
}
function polygonOfLevel(project, index) {
  const walls = project.walls.filter((w) => w.level === index && w.kind === "exterior");
  if (walls.length < 3) return null;
  return walls.map((w) => w.a);
}

/** Choose grillage line spacing so floor-support lines never sit within a cap of a bearing line. */
function grillageSpacing(ctx, project, bearingWalls) {
  const g = project.foundation.grillage;
  if (g.girderSpacing !== undefined || !bearingWalls.length) return null;
  const axis = project.floor.axis,
    poly = ctx.levelPolygons[0],
    b = bounds(poly),
    min = axis === "x" ? b.minX : b.minY,
    range = axis === "x" ? b.maxX - b.minX : b.maxY - b.minY,
    base = project.foundation.spacing ?? 2,
    clearance = (g.capSize ?? 250) / 1000 + 0.1,
    coords = bearingWalls
      .filter((w) => (axis === "x" ? Math.abs(w.a.x - w.b.x) : Math.abs(w.a.y - w.b.y)) < EPS)
      .map((w) => (axis === "x" ? w.a.x : w.a.y)),
    n0 = Math.max(1, Math.ceil(range / base - 1e-9));
  for (let n = n0; n <= n0 + 8; n++) {
    const ok = Array.from({ length: n - 1 }, (_, i) => min + (range * (i + 1)) / n).every((f) =>
      coords.every((c) => Math.abs(f - c) < 1e-6 || Math.abs(f - c) >= clearance),
    );
    if (ok && range / n >= 0.5) return range / n + 1e-9;
  }
  return null;
}

function buildAny(ctx, strategy) {
  let first = null;
  // Hall positions × stair positions; the stair-less layout is the last resort.
  for (const stairChoice of [0, 1, 2, 3, 4, 5, -1])
    for (let v = 0; v < (VARIANTS[strategy] ?? 1); v++)
      try {
        return build({ ...ctx, variant: v, stairChoice }, strategy);
      } catch (e) {
        if (!(e instanceof HouseGenerationError) || !e.misfit) throw e;
        if (!e.noMoreStair) first ??= e;
      }
  throw first;
}
function build(ctx, strategy) {
  const { spec, levels, levelPolygons, sections, D, B, endMargin } = ctx;
  const explicitRooms = ctx.rooms.some((r) => r.bounds !== undefined);
  const levelHasRooms = levels.map((l) => ctx.rooms.some((r) => (r.level ?? 1) === l.index));
  let joistAxis = ctx.joistAxis;
  // ----- geometry per level
  const geo = levels.map((l, i) => {
    if (!levelHasRooms[i] || explicitRooms) return null;
    const requested = ctx.rooms
      .map((r, index) => ({ ...r, index }))
      .filter((r) => (r.level ?? 1) === l.index);
    const lp = levelPolygons[i];
    // Upper levels of open-plan reuse the corridor layout.
    const s =
      strategy === "open-plan" && !requested.some((r) => PUBLIC_ROOM.test(r.name)) && i > 0
        ? "corridor"
        : strategy;
    return { ...strategyGeometry(ctx, s, lp, l.index, requested), requested, strategy: s };
  });
  const axes = new Set(geo.filter(Boolean).map((g) => g.joistAxis));
  if (axes.size > 1) misfit("floor.axis", "Этажи требуют разного направления лаг; задайте floor.axis.");
  if (axes.size === 1) joistAxis = [...axes][0];
  const project = {
    ...clone(defaultDesignerProject),
    ...(spec.insulation !== undefined ? { insulation: clone(spec.insulation) } : {}),
    name: spec.name ?? "Дом · параметрическая генерация",
    floors: levels.length,
    height: levels[0].height,
    levels,
    walls: [],
    openings: [],
    voids: [],
    objects: [],
    boardCuts: {},
    floor: {
      ...defaultDesignerProject.floor,
      wallSupportFraming: true,
      ...spec.floor,
      axis: joistAxis,
      spacing: ctx.joistSpacing,
      section: ctx.floorSection,
    },
    material: ctx.material,
    loads: ctx.loads,
    foundation: {
      ...defaultDesignerProject.foundation,
      ...spec.foundation,
      grillage: {
        section: sections.grillage,
        plies: 3,
        deflectionRatio: 300,
        capSize: 250,
        ...spec.foundation?.grillage,
      },
    },
    bracing: { ...defaultDesignerProject.bracing, section: sections.bracing, ...spec.bracing },
    roof: {
      ...defaultDesignerProject.roof,
      ...ctx.roofInput,
      type: ctx.roofInput.shape === "mono" ? "mono" : "fink",
      pitchLeft: ctx.roofInput.pitch,
      chordSection: sections.roof,
      webSection: sections.roofWeb,
    },
  };
  if (ctx.site)
    project.site = {
      country: "RU",
      city: ctx.site.site.city,
      snowRegion: ctx.site.site.snowRegion,
      windRegion: ctx.site.site.windRegion,
      frostDepth: ctx.site.site.frostDepth,
      source: ctx.site.site.source,
    };
  project.annexes = clone(spec.annexes ?? []);
  delete project.roof.zones;
  for (let i = 0; i < levelPolygons.length; i++)
    for (let j = 0; j < levelPolygons[i].length; j++)
      project.walls.push({
        id: `GEN-L${i + 1}-W${j + 1}`,
        level: i + 1,
        a: { ...levelPolygons[i][j] },
        b: { ...levelPolygons[i][(j + 1) % levelPolygons[i].length] },
        kind: "exterior",
        section: sections.walls,
        studStep: ctx.studStep,
      });
  const planning = {
    rooms: [],
    checks: [],
    warnings: [],
    template: spec.footprint ? "custom" : ctx.shape,
    strategy: explicitRooms ? "explicit" : levelHasRooms.some(Boolean) ? strategy : "shell",
    strategyDescription: explicitRooms
      ? "Явные bounds помещений."
      : levelHasRooms.some(Boolean)
        ? LAYOUT_STRATEGIES[strategy]
        : "Оболочка без программы помещений; несущие линии только там, где их требует пролёт перекрытия.",
    levels: levels.map((l, i) => ({ ...l, polygon: clone(levelPolygons[i]), area: area(levelPolygons[i]) })),
    assumptions: [
      "Размеры контуров заданы по осям стен. Площади автоматически спланированных комнат — в чистоте между гранями стен, без чистовых отделочных слоёв.",
      "Коридор1.2м и требования программы являются условиями генератора. Эвакуация, инсоляция, доступность, вентиляция и нормативные требования к помещениям не подтверждаются этой раскладкой.",
      "Несущие внутренние стены назначены генератором как опоры лаг верхнего перекрытия и линии ростверка; узлы опирания и прочность проверяет расчётное ядро.",
    ],
  };
  if (levelPolygons.length > 1 && !contained(levelPolygons[1], levelPolygons[0]))
    planning.warnings.push(
      "Верхний этаж выходит за контур основания; консоли и передаточные конструкции не спроектированы.",
    );
  if (spec.secondLight !== undefined) {
    const v = spec.secondLight;
    if (!object(v) || v.level !== 2 || levels.length !== 2)
      reject("secondLight", "Второй свет задаётся как {level:2,polygon} при двух этажах.");
    const poly = polygon(v.polygon, "secondLight.polygon");
    if (!contained(poly, levelPolygons[1]))
      reject("secondLight.polygon", "Контур второго света должен лежать внутри перекрытия второго этажа.");
    project.voids.push({
      id: "GEN-VOID-L2",
      level: 2,
      kind: "doubleHeight",
      edgeSection: ctx.floorSection,
      polygon: poly,
    });
  }
  const top = levels.length;
  const bearingOn = (levelIndex) => ctx.bearingWalls && levelIndex < top;
  // ----- stair (two storeys, room layout present)
  let stair = null;
  const stairWanted = top > 1 && spec.stair !== false && spec.secondLight === undefined && !explicitRooms;
  const st = stairWanted ? stairGeometry(ctx) : null;
  if (stairWanted && geo.some(Boolean)) {
    const g0 = geo.find(Boolean);
    const candidates = [];
    for (const b of g0.bins) {
      const p = placeStair(ctx, b, st);
      if (!p) continue;
      // The same bin line must exist on every level that has a layout.
      const box = b.box(b.r0, b.r0 + p.len),
        ok = geo.every(
          (g) =>
            !g ||
            g.bins.some(
              (q) =>
                q.map === b.map &&
                Math.abs(q.doorD - b.doorD) < EPS &&
                Math.abs(q.d0 - b.d0) < EPS &&
                Math.abs(q.d1 - b.d1) < EPS &&
                q.r0 <= b.r0 + EPS &&
                q.r1 >= b.r0 + p.len - EPS,
            ),
        );
      if (ok) candidates.push({ ...p, bin: b, box, r0: b.r0, r1: b.r0 + p.len });
    }
    const choice = ctx.stairChoice ?? 0;
    if (choice >= 0) {
      if (choice > 0 && choice >= candidates.length) {
        const e = new HouseGenerationError("stair", "Других положений лестницы нет.");
        e.misfit = true;
        e.noMoreStair = true;
        throw e;
      }
      stair = candidates[choice] ?? null;
    }
    if (!stair)
      planning.warnings.push(
        "Лестница на второй этаж не поместилась ни в одну зону этой планировки (нужно около 2.4×4.5 м); проём и марши не созданы.",
      );
  } else if (top > 1 && spec.secondLight !== undefined)
    planning.warnings.push(
      "При втором свете лестницу задайте через karkas_set_second_light (U-лестница внутри проёма).",
    );
  else if (top > 1 && spec.stair !== false && !explicitRooms)
    planning.warnings.push(
      "Лестница создаётся только вместе с программой помещений; в оболочке без rooms проём не вырезан.",
    );
  // ----- walls: structural lines first, then room cells
  const lineSets = levels.map((l, i) => {
    if (geo[i]) return geo[i].lines;
    // Shell level: bearing spines only if a floor rests on it.
    if (l.index < top && ctx.bearingWalls) {
      const upper = geo.slice(i + 1).find(Boolean);
      return upper
        ? upper.lines.map((q) => ({ ...q, openings: [] }))
        : shellLines(ctx, levelPolygons[i + 1] ?? levelPolygons[i], joistAxis);
    }
    return [];
  });
  const casedOpenings = [];
  levels.forEach((l, i) => {
    for (const line of lineSets[i]) {
      const kind = line.bearing && bearingOn(l.index) ? "bearing" : "partition";
      // A double-height room below a second-light opening keeps its volume: no wall through it.
      let pieces = [[0, 1]];
      const L = distance(line.a, line.b),
        at = (t) => ({ x: line.a.x + (line.b.x - line.a.x) * t, y: line.a.y + (line.b.y - line.a.y) * t });
      for (const v of project.voids.filter((v) => v.kind === "doubleHeight" && v.level === l.index + 1)) {
        const vb = bounds(v.polygon),
          ts = [];
        for (let k = 0; k <= 200; k++) {
          const q = at(k / 200);
          if (q.x > vb.minX - 0.3 && q.x < vb.maxX + 0.3 && q.y > vb.minY - 0.3 && q.y < vb.maxY + 0.3)
            ts.push(k / 200);
        }
        if (!ts.length) continue;
        const lo = Math.min(...ts),
          hi = Math.max(...ts);
        pieces = pieces.flatMap(([a, b]) =>
          hi <= a || lo >= b ? [[a, b]] : [...(lo > a ? [[a, lo]] : []), ...(hi < b ? [[hi, b]] : [])],
        );
      }
      for (const [a, b] of pieces) {
        if ((b - a) * L < 0.6) continue;
        const ids = addWall(project, at(a), at(b), l.index, kind, ctx.studStep, sections.walls);
        for (const o of line.openings ?? []) casedOpenings.push({ ...o, level: l.index, ids });
      }
    }
  });
  const addOpening = (w, center, width, type, level, roomId) => {
    const L = distance(w.a, w.b),
      offset = ((center.x - w.a.x) * (w.b.x - w.a.x) + (center.y - w.a.y) * (w.b.y - w.a.y)) / L - width / 2,
      H = levels[level - 1].height,
      door = type === "door",
      sill = door ? 0 : Math.min(0.8, H * 0.28),
      height = door ? Math.min(2.1, H - 2 * B - 0.2) : Math.min(1.4, H - 2 * B - 0.2 - sill),
      id = `GEN-L${level}-O${project.openings.filter((o) => o.floor === level).length + 1}`;
    if (width < 0.2 || offset < endMargin - EPS || offset + width > L - endMargin + EPS) return null;
    if (
      project.openings.some(
        (o) =>
          o.wallId === w.id &&
          offset < o.offset + o.width + 2 * B - EPS &&
          offset + width > o.offset - 2 * B + EPS,
      )
    )
      return null;
    project.openings.push({ id, wallId: w.id, offset, width, height, sill, type, floor: level, roomId });
    return id;
  };
  const wallAt = (level, q, kinds = ["bearing", "partition", "exterior"]) =>
    project.walls.find((w) => w.level === level && kinds.includes(w.kind) && on(q, w.a, w.b));
  for (const o of casedOpenings) {
    const w = wallAt(o.level, o.center, ["bearing", "partition"]);
    if (w && o.width >= 0.6) addOpening(w, o.center, o.width, "door", o.level, null);
  }
  // ----- room report
  const reportRoom = (r, i, level, axisBounds, side, doorId = null, kind = "room") => {
    const clear = {
        minX: axisBounds.minX + D / 2,
        maxX: axisBounds.maxX - D / 2,
        minY: axisBounds.minY + D / 2,
        maxY: axisBounds.maxY - D / 2,
      },
      poly = rect(clear.minX, clear.minY, clear.maxX, clear.maxY),
      width = clear.maxX - clear.minX,
      depth = clear.maxY - clear.minY;
    if (width <= 0 || depth <= 0) misfit(`rooms.${i}`, "Толщина стен поглощает размеры комнаты.");
    if (
      project.voids.some(
        (v) => v.level === level && v.kind === "doubleHeight" && intersectsArea(poly, v.polygon),
      )
    )
      misfit(
        `rooms.${i}`,
        "Комната пересекает второй свет; задайте другую программу или явныеbounds вне проёма.",
      );
    const item = {
      id: `GEN-ROOM-${i + 1}`,
      name: r.name,
      level,
      kind,
      polygon: poly,
      bounds: clear,
      axisBounds,
      area: width * depth,
      targetArea: r.area,
      dimensions: { width, depth },
      side,
      doorOpeningId: doorId,
      windowOpeningId: null,
    };
    for (const [id, label, value, limit] of [
      ["area", "Площадь комнаты", item.area, r.area],
      ["width", "Минимальная ширина", width, r.minWidth],
      ["depth", "Минимальная глубина", depth, r.minDepth],
    ]) {
      const pass = limit === undefined || value >= limit - EPS;
      planning.checks.push({
        id: `${item.id}-${id}`,
        label: `${r.name}: ${label}`,
        status: limit === undefined ? "unverified" : pass ? "pass" : "fail",
        value,
        limit: limit ?? null,
        unit: id === "area" ? "м²" : "м",
        ...(limit === undefined ? { note: "Минимальный размер не задан программой помещений." } : {}),
      });
      if (!pass)
        misfit(
          `rooms.${i}`,
          `${r.name}: ${label.toLowerCase()} ${value.toFixed(2)} меньше ${limit.toFixed(2)}.`,
        );
    }
    if (item.area > r.area * 1.15 + 0.1)
      planning.warnings.push(
        `${r.name}: площадь ${item.area.toFixed(2)}м² больше целевой ${r.area.toFixed(2)}м² из-за минимальной геометрии входа и принятой полосы комнат.`,
      );
    planning.rooms.push(item);
    return item;
  };
  // ----- explicit bounds (unchanged contract)
  if (explicitRooms)
    for (const l of levels) {
      const requested = ctx.rooms
        .map((r, index) => ({ ...r, index }))
        .filter((r) => (r.level ?? 1) === l.index);
      if (!requested.length) continue;
      const poly = levelPolygons[l.index - 1];
      if (requested.some((r) => r.bounds === undefined))
        reject(
          "rooms",
          "На одном этаже задайтеbounds для всех комнат либо для всех используйте автоматическую программу.",
        );
      for (const r of requested) {
        const b = explicitBounds(r.bounds, `rooms.${r.index}.bounds`),
          rp = rect(b.minX, b.minY, b.maxX, b.maxY);
        if (!contained(rp, poly))
          reject(`rooms.${r.index}.bounds`, "Комната выходит за реальный контур этажа.");
        if (
          planning.rooms.some(
            (q) =>
              q.level === l.index &&
              q.kind === "room" &&
              Math.min(q.axisBounds.maxX, b.maxX) - Math.max(q.axisBounds.minX, b.minX) > EPS &&
              Math.min(q.axisBounds.maxY, b.maxY) - Math.max(q.axisBounds.minY, b.minY) > EPS,
          )
        )
          reject(`rooms.${r.index}.bounds`, "Прямоугольники комнат накладываются.");
        for (let j = 0; j < 4; j++)
          addWall(project, rp[j], rp[(j + 1) % 4], l.index, "partition", ctx.studStep, sections.walls);
        reportRoom(r, r.index, l.index, b, "explicit");
      }
      planning.warnings.push(
        `${l.index} этаж: явныеbounds сформированы; двери и связь с коридором требуют явного проекта проходов.`,
      );
    }
  // ----- automatic layouts
  let spareCount = 0;
  levels.forEach((l, i) => {
    const g = geo[i];
    if (!g) return;
    // Circulation report + void check.
    for (const c of g.circulation) {
      const poly = rect(c.clear.minX, c.clear.minY, c.clear.maxX, c.clear.maxY);
      if (project.voids.some((v) => v.level === l.index && intersectsArea(poly, v.polygon)))
        misfit(
          "rooms",
          "Автоматический коридор/холл пересекает второй свет; задайте явную планировкуbounds.",
        );
      c.report = {
        id: `GEN-${c.kind === "hall" ? "HALL" : "CORRIDOR"}-L${l.index}`,
        name: c.name,
        level: l.index,
        kind: "corridor",
        circulationKind: c.kind,
        polygon: poly,
        area: area(poly),
        dimensions: c.dimensions,
      };
      planning.rooms.push(c.report);
    }
    // Bins split around the stair cell.
    let bins = g.bins;
    const cells = [];
    if (stair) {
      bins = bins.flatMap((q) => {
        if (
          q.map !== stair.bin.map ||
          Math.abs(q.doorD - stair.bin.doorD) > EPS ||
          Math.abs(q.d0 - stair.bin.d0) > EPS ||
          q.r0 > stair.r0 + EPS ||
          q.r1 < stair.r1 - EPS
        )
          return [q];
        let r0 = stair.r0,
          r1 = stair.r1;
        const parts = [];
        if (stair.r0 - q.r0 > EPS) {
          if (stair.r0 - q.r0 < ctx.minSlot) r0 = q.r0;
          else parts.push({ ...q, r1: stair.r0 });
        }
        if (q.r1 - stair.r1 > EPS) {
          if (q.r1 - stair.r1 < ctx.minSlot) r1 = q.r1;
          else parts.push({ ...q, r0: stair.r1 });
        }
        cells.push({ kind: "stair", r0, r1, bin: q });
        return parts;
      });
    }
    cells.push(
      ...packBins(
        ctx,
        bins,
        g.requested.filter((r) => !(g.openRoomIndexes ?? []).includes(r.index)),
        l.index,
      ),
    );
    const levelCells = cells.map((c) => ({ ...c, box: c.box ?? c.bin.box(c.r0, c.r1) }));
    // Walls of every enclosed cell (rooms, spare, stair).
    for (const c of levelCells)
      for (const [a, b] of boxEdges(c.box))
        addWall(project, a, b, l.index, "partition", ctx.studStep, sections.walls);
    // Open-plan rooms (no own partitions) are reported directly.
    for (const c of g.openCells ?? []) {
      const item = reportRoom(c.req, c.req.index, l.index, c.box, "open");
      item.open = true;
      planning.checks.push({
        id: `${item.id}-adjacency`,
        label: `${c.req.name}: связь с коридором`,
        status: "pass",
        note: "Открытая зона без перегородки примыкает к коридору приватного крыла.",
      });
    }
    for (const c of levelCells) {
      const b = c.bin,
        doorR = c.kind === "stair" ? stair.doorR : (c.r0 + c.r1) / 2,
        center = b.point(doorR, b.doorD),
        wall = wallAt(l.index, center, ["bearing", "partition"]),
        doorWidth =
          c.kind === "stair" && stair.doorWidth
            ? stair.doorWidth
            : Math.min(0.9, c.r1 - c.r0 - 2 * endMargin);
      const target =
        c.kind === "room"
          ? `GEN-ROOM-${c.req.index + 1}`
          : c.kind === "stair"
            ? `GEN-STAIR-L${l.index}`
            : `GEN-SPARE-L${l.index}-${spareCount + 1}`;
      const doorId = wall ? addOpening(wall, center, doorWidth, "door", l.index, target) : null;
      if (!doorId)
        misfit(
          c.req ? `rooms.${c.req.index}` : "rooms",
          `${c.req?.name ?? "Помещение"}: не удалось разместить дверь в коридор/холл с необходимыми отступами от концов стены.`,
        );
      if (c.kind === "room") {
        const item = reportRoom(
          c.req,
          c.req.index,
          l.index,
          c.box,
          g.bins.indexOf(b) >= 0 ? g.bins.indexOf(b) : 0,
          doorId,
        );
        planning.checks.push({
          id: `${item.id}-adjacency`,
          label: `${c.req.name}: дверь в коридор`,
          status: "pass",
          note: "Дверной проём расположен на общей границе комнаты и коридора/холла.",
        });
      } else {
        const clear = {
            minX: c.box.minX + D / 2,
            maxX: c.box.maxX - D / 2,
            minY: c.box.minY + D / 2,
            maxY: c.box.maxY - D / 2,
          },
          poly = rect(clear.minX, clear.minY, clear.maxX, clear.maxY);
        planning.rooms.push({
          id: target,
          name: c.kind === "stair" ? "Лестница" : "Резерв (кладовая/гардероб)",
          level: l.index,
          kind: c.kind,
          polygon: poly,
          bounds: clear,
          axisBounds: c.box,
          area: area(poly),
          doorOpeningId: doorId,
          windowOpeningId: null,
        });
        if (c.kind === "spare") spareCount++;
      }
    }
    // Front door on the ground floor.
    if (l.index === 1) {
      const main = g.circulation[0];
      let entranceId = null;
      for (const [a, z] of main.entrances) {
        const mid = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 },
          ext = project.walls.find((w) => w.kind === "exterior" && w.level === 1 && on(mid, w.a, w.b));
        if (!ext) continue;
        entranceId = addOpening(ext, mid, Math.min(0.9, distance(a, z) - D - 0.1), "door", 1, main.report.id);
        if (entranceId) break;
      }
      if (entranceId) main.report.accessOpeningId = entranceId;
      else
        planning.warnings.push(
          "Наружная дверь в коридор не поместилась с принятыми отступами; доступ снаружи не спроектирован.",
        );
    }
  });
  // ----- stair objects
  if (stair) {
    const f = st.frameHalf,
      sb = bounds(stair.polygon);
    project.voids.push({
      id: "GEN-STAIR-VOID",
      level: 2,
      kind: "stair",
      edgeSection: ctx.floorSection,
      edgePlies: st.plies,
      polygon: rect(sb.minX - f, sb.minY - f, sb.maxX + f, sb.maxY + f),
    });
    project.staircase = {
      id: "GEN-STAIR",
      kind: "u-turn",
      polygon: stair.polygon.map((q) => ({ x: round(q.x, 1e6), y: round(q.y, 1e6) })),
      levelFrom: 1,
      levelTo: 2,
      risers: st.risers,
      tread: st.going,
      landingLength: st.landing,
      flightWidth: st.flightWidth,
      flightGap: st.gap,
      exit: stair.exit,
      voidId: "GEN-STAIR-VOID",
    };
    project.spatialLayout = {};
    planning.stair = {
      kind: "u-turn",
      orientation: stair.orientation,
      polygon: project.staircase.polygon,
      voidId: "GEN-STAIR-VOID",
      risers: st.risers,
      riser: round(st.rise / st.risers),
      tread: st.going,
      exit: stair.exit,
      note: "Ядро поддерживает U-лестницу (два марша и площадка); прямой/L-марш пока не моделируется.",
    };
    planning.checks.push({
      id: "generation-stair",
      label: "Лестница на второй этаж",
      status: "unverified",
      note: "Проём перекрытия и U-лестница сформированы; статика маршей, ограждения и эвакуация проверяются ядром/проектом.",
    });
  } else if (stairWanted && geo.some(Boolean))
    planning.checks.push({
      id: "generation-stair",
      label: "Лестница на второй этаж",
      status: "fail",
      note: "Лестница не размещена в этой планировке.",
    });
  // ----- windows on a real exterior segment of each room
  for (const room of planning.rooms.filter((r) => r.kind === "room")) {
    const b = room.axisBounds,
      rp = rect(b.minX, b.minY, b.maxX, b.maxY),
      candidates = [];
    for (const w of project.walls.filter((w) => w.kind === "exterior" && w.level === room.level))
      for (let i = 0; i < 4; i++) {
        const seg = segmentOverlap(rp[i], rp[(i + 1) % 4], w.a, w.b);
        if (!seg) continue;
        const len = distance(seg[0], seg[1]),
          windowWidth = Math.min(1.5, len - 2 * endMargin);
        if (windowWidth >= 0.4)
          candidates.push({
            w,
            center: { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 },
            width: windowWidth,
          });
      }
    candidates.sort((a, b) => b.width - a.width || a.w.id.localeCompare(b.w.id));
    for (const q of candidates) {
      const id = addOpening(q.w, q.center, q.width, "window", room.level, room.id);
      if (id) {
        room.windowOpeningId = id;
        break;
      }
    }
    if (!room.windowOpeningId)
      planning.warnings.push(
        `${room.name}: автоматическое наружное окно не помещается; освещение и вентиляция не подтверждены.`,
      );
  }
  // ----- structure summary
  const bearing = project.walls.filter((w) => w.kind === "bearing"),
    gs = grillageSpacing(
      ctx,
      project,
      bearing.filter((w) => w.level === 1),
    );
  if (gs) project.foundation.grillage.girderSpacing = gs;
  const spans = measureJoistSpans(project);
  planning.structure = {
    joistAxis,
    joistSpacing: ctx.joistSpacing,
    studStep: ctx.studStep,
    maxJoistSpanTarget: ctx.maxJoistSpan,
    maxJoistSpanBasis: ctx.maxJoistSpanBasis,
    maxJoistSpan: top > 1 ? spans.max : null,
    joistSpansByLevel: spans.levels,
    bearingWallIds: bearing.map((w) => w.id),
    stackedPartitionIds: project.walls
      .filter(
        (w) =>
          w.kind === "partition" &&
          w.level > 1 &&
          bearing.some((q) => q.level === w.level - 1 && segmentOverlap(q.a, q.b, w.a, w.b)),
      )
      .map((w) => w.id),
    ridgeAngle: project.roof.ridgeAngle,
    ridgeAuto: !ctx.roofExplicitRidge,
    trussSpan: ctx.roofExplicitRidge ? null : round(ctx.ridge.span),
    grillageGirderSpacing: gs ?? project.foundation.grillage.girderSpacing ?? null,
  };
  if (top > 1 && spans.max > ctx.maxJoistSpan + 0.05)
    planning.warnings.push(
      `Пролёт лаг перекрытия ${spans.max.toFixed(2)} м больше ориентира ${ctx.maxJoistSpan.toFixed(2)} м: добавьте несущую стену/балку или увеличьте сечение.`,
    );
  if (ctx.site)
    planning.site = {
      ...ctx.site.site,
      terrain: ctx.loads.terrain,
      basis: ctx.site.basis,
      warnings: ctx.site.warnings,
      applied: ctx.loadOrigin,
    };
  for (const w of ctx.site?.warnings ?? []) planning.warnings.push(w);
  const project2 = normalizeDesignerState(project),
    validation = validateDesignerProject(project2);
  if (!validation.valid) {
    const e = new HouseGenerationError(
      "project",
      "Сгенерированная модель не прошла строгую проверку: " +
        validation.errors.map((e) => e.message).join(" "),
    );
    e.errors = validation.errors;
    e.misfit = true;
    throw e;
  }
  planning.checks.push(
    {
      id: "generation-project-validation",
      label: "Геометрия проекта и входные параметры",
      status: "pass",
      note: "Итоговый проект прошёл validateDesignerProject.",
    },
    {
      id: "generation-building-design",
      label: "Архитектура, конструкции и инженерные системы",
      status: "unverified",
      note: "Программа помещений и валидный контур не подтверждают полный строительный проект. Выполните расчёт ядра и проработайте узлы/доступ/системы.",
    },
  );
  planning.warnings = [...new Set([...planning.warnings, ...validation.warnings])];
  planning.score = scoreLayout(project2, planning);
  return { project: project2, planning };
}

/** Cheap geometric score components (no structural evaluation). */
export function scoreLayout(project, planning) {
  const rooms = planning.rooms.filter((r) => r.kind === "room"),
    circulation = planning.rooms.filter((r) => r.kind === "corridor"),
    spare = planning.rooms.filter((r) => r.kind === "spare"),
    floorArea = planning.levels.reduce((s, l) => s + l.area, 0),
    interior = project.walls.filter((w) => w.kind !== "exterior"),
    errors = rooms.map((r) => Math.abs(r.area - r.targetArea) / r.targetArea);
  const daylight = rooms.map((r) => {
    const w = project.openings.find((o) => o.id === r.windowOpeningId);
    return {
      roomId: r.id,
      name: r.name,
      level: r.level,
      windowArea: w ? round(w.width * w.height, 100) : 0,
      ratio: w ? round((w.width * w.height) / r.area, 1000) : 0,
    };
  });
  return {
    strategy: planning.strategy,
    maxJoistSpan: planning.structure?.maxJoistSpan ?? null,
    maxJoistSpanTarget: planning.structure?.maxJoistSpanTarget ?? null,
    trussSpan: planning.structure?.trussSpan ?? null,
    bearingWalls: project.walls.filter((w) => w.kind === "bearing").length,
    totalWallLength: round(
      interior.reduce((s, w) => s + distance(w.a, w.b), 0),
      100,
    ),
    bearingWallLength: round(
      interior.filter((w) => w.kind === "bearing").reduce((s, w) => s + distance(w.a, w.b), 0),
      100,
    ),
    circulationAreaPercent: round((100 * circulation.reduce((s, r) => s + r.area, 0)) / floorArea, 10),
    spareArea: round(
      spare.reduce((s, r) => s + r.area, 0),
      100,
    ),
    roomAreaErrorPercent: errors.length
      ? round((100 * errors.reduce((s, e) => s + e, 0)) / errors.length, 10)
      : 0,
    maxRoomAreaErrorPercent: errors.length ? round(100 * Math.max(...errors), 10) : 0,
    roomsWithoutWindow: daylight.filter((d) => !d.windowArea).length,
    minDaylightRatio: daylight.length ? Math.min(...daylight.map((d) => d.ratio)) : null,
    daylight,
    stair: planning.stair ? true : project.floors > 1 ? false : null,
  };
}
const penalty = (s) =>
  (s.stair === false ? 1000 : 0) +
  s.roomsWithoutWindow * 300 +
  (s.maxJoistSpan !== null && s.maxJoistSpanTarget !== null
    ? Math.max(0, s.maxJoistSpan - s.maxJoistSpanTarget) * 200
    : 0) +
  s.roomAreaErrorPercent * 2 +
  s.spareArea * 3 +
  s.circulationAreaPercent;

function strategiesFor(ctx) {
  if (ctx.spec.strategy) return [ctx.spec.strategy];
  if (ctx.rooms.some((r) => r.bounds !== undefined)) return ["explicit"];
  const poly = ctx.levelPolygons[0],
    b = bounds(poly),
    axisRect = poly.length === 4 && Math.abs(area(poly) - extent(b, "x") * extent(b, "y")) < EPS;
  if (axisRect) return RECT_STRATEGIES;
  if (poly.length === 6 && orthogonalRectangles(poly, "x")) return L_STRATEGIES;
  return ["corridor"];
}

export function generateHouse(spec = {}) {
  const ctx = prepare(spec);
  if (!ctx.rooms.length) return build(ctx, "corridor");
  const failures = [];
  for (const s of strategiesFor(ctx)) {
    try {
      return buildAny(ctx, s);
    } catch (e) {
      if (!(e instanceof HouseGenerationError) || !e.misfit) throw e;
      failures.push({ strategy: s, field: e.errors[0]?.field ?? "rooms", message: e.message });
    }
  }
  if (failures.length === 1) {
    const e = new HouseGenerationError(failures[0].field, failures[0].message);
    e.errors = failures.map((f) => ({ field: f.field, message: f.message, strategy: f.strategy }));
    throw e;
  }
  const e = new HouseGenerationError(
    "rooms",
    "Программа помещений не размещается ни одной стратегией планировки. " +
      failures.map((f) => `${f.strategy}: ${f.message}`).join(" "),
  );
  e.errors = failures.map((f) => ({ field: f.field, message: f.message, strategy: f.strategy }));
  throw e;
}

/**
 * Up to `count` distinct generated options (no structural evaluation). Each option:
 * {strategy, project, planning, score, rank}. Strategies that do not fit are listed in `rejected`.
 */
export function generateHouseOptions(spec = {}, { count = 4 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 6) reject("count", "count: целое 1…6.");
  const ctx = prepare(spec),
    names = spec.strategy ? [spec.strategy] : ctx.rooms.length ? strategiesFor(ctx) : ["corridor"],
    options = [],
    rejected = [],
    seen = new Set();
  for (const s of names) {
    try {
      const r = buildAny(ctx, s),
        signature = JSON.stringify(
          r.project.walls.map((w) => [
            w.level,
            w.kind,
            round(w.a.x),
            round(w.a.y),
            round(w.b.x),
            round(w.b.y),
          ]),
        );
      if (seen.has(signature)) {
        rejected.push({ strategy: s, reason: "Совпадает с уже найденным вариантом." });
        continue;
      }
      seen.add(signature);
      options.push({
        strategy: s,
        description: LAYOUT_STRATEGIES[s] ?? r.planning.strategyDescription,
        ...r,
        score: r.planning.score,
      });
    } catch (e) {
      if (!(e instanceof HouseGenerationError) || !e.misfit) throw e;
      rejected.push({ strategy: s, reason: e.message });
    }
  }
  if (!options.length) {
    const e = new HouseGenerationError(
      "rooms",
      "Программа помещений не размещается ни одной стратегией планировки. " +
        rejected.map((f) => `${f.strategy}: ${f.reason}`).join(" "),
    );
    e.errors = rejected.map((f) => ({ field: "rooms", message: f.reason, strategy: f.strategy }));
    throw e;
  }
  options.sort((a, b) => penalty(a.score) - penalty(b.score));
  options.forEach((o, i) => (o.rank = i + 1));
  return {
    options: options.slice(0, count),
    rejected,
    rankingBasis:
      "Геометрический предварительный ранг: лестница, окна, превышение ориентира пролёта лаг, ошибка площадей, резервные площади, доля коммуникаций. Прочность не оценивается.",
  };
}

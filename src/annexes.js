import {
  loadFactors,
  loadProfile,
  snowBasis,
  snowShapeMu,
  windK,
  windTerrain,
  monoRoofUpliftCoefficient,
} from "./load-profile.js";
import { buildGrillage } from "./grillage.js";
import { analyzeGrillageLoads, solveGrillagePointLoads } from "./grillage-loads.js";
import { calculateRafter, solveUniformOverhangBeam } from "./rafters.js";
import { axialCompression } from "./timber-design.js";
const EPS = 1e-7,
  G = 9.80665,
  sum = (a) => a.reduce((s, x) => s + x, 0),
  finite = Number.isFinite,
  object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const sec = (s) => {
  const m = typeof s === "string" && s.replaceAll(" ", "").match(/^(\d{2,3})[x×](\d{2,3})$/);
  if (!m) return null;
  const b = +m[1],
    h = +m[2];
  return b >= 15 && b <= 300 && h >= b && h <= 600 ? { b, h } : null;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  signed = (p) => sum(p.map((q, i) => q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y)) / 2,
  area = (p) => Math.abs(signed(p));
const rect = (a, b, c, d) => [
  { x: a, y: b },
  { x: c, y: b },
  { x: c, y: d },
  { x: a, y: d },
];
function inside(q, p) {
  if (
    p.some(
      (a, i) =>
        Math.abs(cross(a, p[(i + 1) % p.length], q)) < EPS &&
        q.x >= Math.min(a.x, p[(i + 1) % p.length].x) - EPS &&
        q.x <= Math.max(a.x, p[(i + 1) % p.length].x) + EPS &&
        q.y >= Math.min(a.y, p[(i + 1) % p.length].y) - EPS &&
        q.y <= Math.max(a.y, p[(i + 1) % p.length].y) + EPS,
    )
  )
    return true;
  let h = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i],
      b = p[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) h = !h;
  }
  return h;
}
function clip(poly, a, b) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const q = poly[i],
      r = poly[(i + 1) % poly.length],
      f = cross(a, b, q),
      g = cross(a, b, r);
    if (f >= -EPS) out.push(q);
    if (f >= -EPS !== g >= -EPS) {
      const t = f / (f - g);
      out.push({ x: q.x + (r.x - q.x) * t, y: q.y + (r.y - q.y) * t });
    }
  }
  return out;
}
function overlap(a, b) {
  let p = a;
  if (signed(b) < 0) b = [...b].reverse();
  for (let i = 0; i < b.length && p.length >= 3; i++) p = clip(p, b[i], b[(i + 1) % b.length]);
  return p.length >= 3 ? area(p) : 0;
}
export const annexKinds = ["openTerrace", "coveredTerrace", "glazedVeranda"];
export function annexDefaults(project = {}) {
  return {
    name: "Пристройка",
    kind: "openTerrace",
    offset: 0,
    width: 4,
    depth: 2.5,
    gap: 0.03,
    deckTopY: null,
    foundation: {
      mode: "independent",
      spacing: 2,
      capacity: 40,
      edgeInset: 0.35,
      pileHeadY: null,
      grillage: { section: "75x248", plies: 3, capSize: 250, deflectionRatio: 300 },
    },
    floor: { section: "48x198", spacing: 0.5, deckThickness: 0.028, blockingStep: 1.2 },
    roof: {
      pitch: 10,
      lowEaveHeight: 2.35,
      section: "75x248",
      spacing: 0.5,
      beamSection: "98x248",
      beamPlies: 1,
      postSection: "98x98",
      battenSection: "50x100",
      battenStep: 0.6,
      overhangs: { low: 0.3, high: 0, start: 0.2, end: 0.2 },
    },
    glazing: {
      section: "48x98",
      panelWidth: 1,
      dead: 0.3,
      doorSide: "front",
      doorOffset: 1,
      doorWidth: 0.9,
      doorHeight: 2.1,
    },
    loads: {
      floorDead: 0.25,
      live: 2.5,
      roofDead: 0.3,
      // Sg × ce × ct of the house site; µ for the low annex slope per СП 20 прил. Б.
      snow: snowBasis(project.loads).base,
      wind: project.loads?.wind ?? 0.3,
      // One γG/γQ pair per annex: the larger profile factors of each family
      // (layers 1,2 vs timber 1,1; snow 1,4 vs live 1,3/1,2), ψ = 1.
      gammaG: loadFactors(project.loads ?? {}).equivalentG,
      gammaQ: Math.max(loadFactors(project.loads ?? {}).snow, loadFactors(project.loads ?? {}).live),
      snowMu: snowShapeMu(10, loadProfile(project.loads)),
      deckSnowFactor: 1,
    },
  };
}
function normalized(a, p) {
  const d = annexDefaults(p);
  if (a.foundation?.mode === "shared") {
    d.foundation.capacity = p.foundation?.capacity ?? d.foundation.capacity;
    for (const field of ["section", "plies", "capSize", "deflectionRatio"])
      if (p.foundation?.grillage?.[field] !== undefined)
        d.foundation.grillage[field] = p.foundation.grillage[field];
  }
  return {
    ...d,
    ...a,
    foundation: {
      ...d.foundation,
      ...a.foundation,
      grillage: { ...d.foundation.grillage, ...a.foundation?.grillage },
    },
    floor: { ...d.floor, ...a.floor },
    roof: { ...d.roof, ...a.roof, overhangs: { ...d.roof.overhangs, ...a.roof?.overhangs } },
    glazing: { ...d.glazing, ...a.glazing },
    loads: {
      ...d.loads,
      // µ of the real annex slope (СП 20.13330.2016 прил. Б, схема Б.1) unless given.
      snowMu: snowShapeMu(a.roof?.pitch ?? d.roof.pitch, loadProfile(p.loads)),
      ...a.loads,
    },
  };
}
export function validateAnnexes(project = {}, onError) {
  const errors = [],
    warnings = [],
    out = [],
    err = (field, message) => {
      errors.push({ field, message });
      onError?.(field, message);
    };
  if (project.annexes === undefined) return { valid: true, errors, warnings, annexes: [] };
  if (!Array.isArray(project.annexes) || project.annexes.length > 10) {
    err("annexes", "Пристройки: массив не более10элементов.");
    return { valid: false, errors, warnings, annexes: [] };
  }
  if (project.annexes.length)
    for (const [key, value] of Object.entries(project.material ?? {}))
      if (["E", "Fb", "Fv", "Ft", "Fc", "density"].includes(key) && (!finite(value) || value <= 0))
        err("material." + key, "Annex material values must be finite and positive.");
  const ids = new Set();
  for (let i = 0; i < project.annexes.length; i++) {
    const raw = project.annexes[i],
      key = `annexes.${i}`;
    if (!object(raw)) {
      err(key, "Параметры пристройки должны быть объектом.");
      continue;
    }
    const d = annexDefaults(project);
    for (const [path, source, allowed] of [
      [key, raw, ["id", "attachedWallId", ...Object.keys(d)]],
      [key + ".foundation", raw.foundation, Object.keys(d.foundation)],
      [key + ".foundation.grillage", raw.foundation?.grillage, Object.keys(d.foundation.grillage)],
      [key + ".floor", raw.floor, Object.keys(d.floor)],
      [key + ".roof", raw.roof, Object.keys(d.roof)],
      [key + ".roof.overhangs", raw.roof?.overhangs, Object.keys(d.roof.overhangs)],
      [key + ".glazing", raw.glazing, Object.keys(d.glazing)],
      [key + ".loads", raw.loads, Object.keys(d.loads)],
    ]) {
      if (source !== undefined && !object(source)) {
        err(path, "Ожидается объект.");
        continue;
      }
      for (const k of Object.keys(source ?? {}))
        if (!allowed.includes(k)) err(path + "." + k, "Неизвестный параметр пристройки.");
    }
    const a = normalized(raw, project);
    out.push(a);
    const range = (v, lo, hi, f) => {
      if (!finite(v) || v < lo || v > hi) err(key + "." + f, `Требуется конечное число${lo}…${hi}.`);
    };
    if (typeof a.id !== "string" || !a.id.length || a.id.length > 80 || ids.has(a.id))
      err(key + ".id", "Нужен уникальныйid длиной1…80символов.");
    ids.add(a.id);
    if (typeof a.name !== "string" || a.name.length > 160) err(key + ".name", "Название до160символов.");
    if (!annexKinds.includes(a.kind))
      err(key + ".kind", "Тип: openTerrace, coveredTerrace или glazedVeranda.");
    const wall = (Array.isArray(project.walls) ? project.walls : []).find((w) => w?.id === a.attachedWallId);
    if (
      !wall ||
      !wall.a ||
      !wall.b ||
      ![wall.a.x, wall.a.y, wall.b.x, wall.b.y].every(finite) ||
      wall.kind !== "exterior" ||
      (wall.level !== undefined && wall.level !== 1)
    )
      err(key + ".attachedWallId", "Нужна внешняя стена первого этажа.");
    range(a.offset, 0, 100, "offset");
    range(a.width, 0.8, 12, "width");
    range(a.depth, 0.8, 8, "depth");
    range(a.gap, 0, 1, "gap");
    if (wall?.a && wall?.b && a.offset + a.width > dist(wall.a, wall.b) + EPS)
      err(key + ".width", "Интервал пристройки выходит за концы выбранной стены.");
    if (a.deckTopY !== null) range(a.deckTopY, 0.1, 6, "deckTopY");
    if (a.foundation.pileHeadY !== null) range(a.foundation.pileHeadY, 0.05, 4, "foundation.pileHeadY");
    for (const [v, lo, hi, f] of [
      [a.foundation.spacing, 0.5, 3.5, "foundation.spacing"],
      [a.foundation.capacity, 1, 2000, "foundation.capacity"],
      [a.foundation.edgeInset, 0.1, 2, "foundation.edgeInset"],
      [a.foundation.grillage.plies, 1, 6, "foundation.grillage.plies"],
      [a.foundation.grillage.capSize, 100, 1000, "foundation.grillage.capSize"],
      [a.foundation.grillage.deflectionRatio, 100, 600, "foundation.grillage.deflectionRatio"],
      [a.floor.spacing, 0.2, 1.2, "floor.spacing"],
      [a.floor.deckThickness, 0.015, 0.1, "floor.deckThickness"],
      [a.floor.blockingStep, 0.3, 3, "floor.blockingStep"],
      [a.roof.pitch, 2, 45, "roof.pitch"],
      [a.roof.lowEaveHeight, 1.8, 4.5, "roof.lowEaveHeight"],
      [a.roof.spacing, 0.2, 1.2, "roof.spacing"],
      [a.roof.beamPlies, 1, 6, "roof.beamPlies"],
      [a.roof.battenStep, 0.2, 1.2, "roof.battenStep"],
      [a.glazing.panelWidth, 0.3, 2, "glazing.panelWidth"],
      [a.glazing.dead, 0.01, 3, "glazing.dead"],
      [a.glazing.doorOffset, 0.1, 12, "glazing.doorOffset"],
      [a.glazing.doorWidth, 0.6, 1.4, "glazing.doorWidth"],
      [a.glazing.doorHeight, 1.8, 2.5, "glazing.doorHeight"],
    ])
      range(v, lo, hi, f);
    for (const f of ["foundation.grillage.plies", "roof.beamPlies"]) {
      const v = f === "roof.beamPlies" ? a.roof.beamPlies : a.foundation.grillage.plies;
      if (!Number.isInteger(v)) err(key + "." + f, "Нужно целое число досок.");
    }
    for (const [path, s] of [
      ["foundation.grillage.section", a.foundation.grillage.section],
      ["floor.section", a.floor.section],
      ...["section", "beamSection", "postSection", "battenSection"].map((f) => ["roof." + f, a.roof[f]]),
      ["glazing.section", a.glazing.section],
    ])
      if (!sec(s)) err(key + "." + path, "Некорректное сечениеb×hмм.");
    if (!["independent", "shared"].includes(a.foundation.mode))
      err(key + ".foundation.mode", "Режим основания: independent или shared.");
    if (a.foundation.mode === "shared") {
      if (wall?.a && wall?.b && Math.abs(wall.a.x - wall.b.x) > EPS && Math.abs(wall.a.y - wall.b.y) > EPS)
        err(key + ".attachedWallId", "Общий ростверк пока поддерживает ортогональные стены дома.");
      const pg = project.foundation?.grillage ?? {};
      for (const field of ["section", "plies", "capSize", "deflectionRatio"])
        if (a.foundation.grillage[field] !== pg[field])
          err(
            key + ".foundation.grillage." + field,
            "Общий ростверк требует одинаковых сечения, слоёв, оголовка и критерия прогиба с домом.",
          );
      if (a.foundation.capacity !== project.foundation?.capacity)
        err(
          key + ".foundation.capacity",
          "Общая сеть использует один заданный предел опор; значение должно совпадать с домом.",
        );
      if (a.foundation.pileHeadY !== null && Math.abs(a.foundation.pileHeadY - 0.72) > EPS)
        err(key + ".foundation.pileHeadY", "Общий ростверк должен лежать в общей отметке оголовков0.72м.");
      const floorS = sec(a.floor.section),
        grS = sec(a.foundation.grillage.section);
      if (
        a.deckTopY !== null &&
        floorS &&
        grS &&
        Math.abs(a.deckTopY - (0.72 + grS.h / 1000 + floorS.h / 1000 + a.floor.deckThickness)) > EPS
      )
        err(key + ".deckTopY", "Заданный настил несовместим с общей отметкой ростверка и выбранными лагами.");
    }
    const g = sec(a.foundation.grillage.section);
    if (g && a.foundation.edgeInset < (g.b * a.foundation.grillage.plies) / 2000 - EPS)
      err(
        key + ".foundation.edgeInset",
        "Ось ростверка должна быть отнесена от края минимум на половину ширины пакета.",
      );
    if (a.foundation.edgeInset * 2 >= Math.min(a.width, a.depth) - 0.2)
      err(key + ".foundation.edgeInset", "Недостаточная глубина/ширина между опорными линиями.");
    for (const [f, v] of Object.entries(a.roof.overhangs)) range(v, 0, 1, "roof.overhangs." + f);
    if (a.kind !== "openTerrace" && a.roof.overhangs.high > a.gap + EPS)
      err(key + ".roof.overhangs.high", "Верхний свес не должен проникать через наружную грань стены дома.");
    const roofBeam = sec(a.roof.beamSection),
      post = sec(a.roof.postSection);
    if (a.kind !== "openTerrace" && roofBeam && post && roofBeam.b * a.roof.beamPlies > post.h + EPS)
      err(key + ".roof.postSection", "Ширина пакета балки должна целиком помещаться на сечении стойки.");
    if (a.kind !== "openTerrace" && post && g && post.h > g.b * a.foundation.grillage.plies + EPS)
      err(key + ".roof.postSection", "Основание стойки шире реального пакета ростверка под опорным рядом.");
    if (a.glazing.doorSide !== "front")
      err(key + ".glazing.doorSide", "Поддерживается дверь на передней сторонеfront.");
    if (a.kind === "glazedVeranda" && a.glazing.doorOffset + a.glazing.doorWidth > a.width - 0.1)
      err(key + ".glazing.doorOffset", "Дверь должна помещаться на передней стороне.");
    for (const [f, v] of Object.entries(a.loads))
      range(
        v,
        f.startsWith("gamma") ? 1 : 0,
        f === "gammaG" ? 2 : f === "gammaQ" ? 3 : ["snowMu", "deckSnowFactor"].includes(f) ? 3 : 20,
        "loads." + f,
      );
  }
  return { valid: errors.length === 0, errors, warnings, annexes: out };
}
export const annexSources = [
  {
    title: "Finland Ministry of the Environment · actions and snow national annexes",
    url: "https://www.edilex.fi/data/rakentamismaaraykset/Actions_on_structures_instructions_rev_2019.pdf",
  },
  {
    title: "AWC · built-up beam end joints on supports",
    url: "https://awc.org/faq/what-are-the-connection-requirements-for-built-up-beams/",
  },
];

/** Canonical shared grillage geometry; floors and roof remain outside the house footprint. */
export function sharedAnnexGrillageLines(project = {}, { geometry = {} } = {}) {
  const polygon = geometry.levels?.find((l) => l.index === 1)?.polygon ?? geometry.polygon ?? [],
    lines = [];
  if (polygon.length < 3) return lines;
  for (const raw of project.annexes ?? []) {
    const a = normalized(raw, project);
    if (a.foundation.mode !== "shared") continue;
    const wall = project.walls.find((w) => w.id === a.attachedWallId);
    if (!wall) continue;
    const wallS = sec(
        geometry.wallProfiles?.find((q) => q.wallId === wall.id && q.level === 1)?.section ?? wall.section,
      ),
      L = dist(wall.a, wall.b),
      u = { x: (wall.b.x - wall.a.x) / L, y: (wall.b.y - wall.a.y) / L };
    let n = { x: u.y, y: -u.x };
    const mid = { x: (wall.a.x + wall.b.x) / 2 + n.x * 0.001, y: (wall.a.y + wall.b.y) / 2 + n.y * 0.001 };
    if (inside(mid, polygon)) n = { x: -n.x, y: -n.y };
    const origin = {
        x: wall.a.x + u.x * a.offset + n.x * (wallS.h / 2000 + a.gap),
        y: wall.a.y + u.y * a.offset + n.y * (wallS.h / 2000 + a.gap),
      },
      plan = (q) => ({ x: origin.x + u.x * q.x + n.x * q.y, y: origin.y + u.y * q.x + n.y * q.y }),
      inset = a.foundation.edgeInset,
      local = buildGrillage(
        { foundation: a.foundation, material: project.material, floor: { axis: "y" }, walls: [] },
        {
          geometry: { closed: true, polygon: rect(inset, inset, a.width - inset, a.depth - inset) },
          walls: [],
        },
      );
    for (const b of local.beams)
      lines.push({
        a: plan(b.a),
        b: plan(b.b),
        kind: "annex",
        source: `annex:${a.id}:${b.id}`,
        annexId: a.id,
        pileSpacing: a.foundation.spacing,
      });
    for (const [side, U] of [
      ["start", inset],
      ["end", a.width - inset],
    ])
      lines.push({
        a: plan({ x: U, y: inset }),
        b: { x: wall.a.x + u.x * (a.offset + U), y: wall.a.y + u.y * (a.offset + U) },
        kind: "annexConnector",
        source: `annex:${a.id}:connector:${side}`,
        annexId: a.id,
        pileSpacing: project.foundation.spacing,
      });
  }
  return lines;
}

export function buildAnnexes(project = {}, base = {}) {
  const v = validateAnnexes(project),
    out = {
      items: [],
      instances: [],
      piles: [],
      checks: [],
      warnings: [],
      assumptions: [],
      sources:
        project.site?.country === "RU"
          ? [
              {
                title: "СП20.13330.2016 · нагрузки, региональное задание и снеговые схемы",
                url: "https://mchs.gov.ru/uploads/document/2025-04-18/8816d4293b285b2e72e149f6cea13cf2.pdf",
              },
              annexSources[1],
            ]
          : annexSources,
      quantities: {
        floorArea: 0,
        roofArea: 0,
        roofProjectedArea: 0,
        glazingArea: 0,
        glazingMass: 0,
        woodVolume: 0,
        woodMass: 0,
        pileCount: 0,
        gutterLength: 0,
        downpipeLength: 0,
        flashingLength: 0,
      },
      loads: { rows: [], dead: 0, live: 0, snow: 0, totalCharacteristic: 0, totalDesign: 0 },
      status: "unverified",
      certified: false,
    };
  if (!v.valid) {
    out.checks = v.errors.map((e) => ({
      id: e.field,
      label: "Исходные данные пристройки",
      status: "fail",
      note: e.message,
    }));
    out.status = "fail";
    return out;
  }
  const house = base.geometry?.levels?.find((l) => l.index === 1);
  if (v.annexes.length && !house?.closed) {
    out.checks.push({
      id: "annex-house-contour",
      label: "Примыкание пристройки",
      fail: true,
      status: "fail",
      note: "Нужен замкнутый первый этаж для определения наружного направления.",
    });
    out.status = "fail";
    return out;
  }
  for (const a of v.annexes) {
    const prefix = `AN-${a.id}-`,
      wall = (project.walls ?? []).find((w) => w.id === a.attachedWallId),
      wallS = sec(
        base.geometry?.wallProfiles?.find((q) => q.wallId === wall.id && q.level === 1)?.section ??
          wall.section,
      ),
      length = dist(wall.a, wall.b),
      u = { x: (wall.b.x - wall.a.x) / length, y: (wall.b.y - wall.a.y) / length };
    let n = { x: u.y, y: -u.x };
    const mid = { x: (wall.a.x + wall.b.x) / 2 + n.x * 0.001, y: (wall.a.y + wall.b.y) / 2 + n.y * 0.001 };
    if (inside(mid, house.polygon)) n = { x: -n.x, y: -n.y };
    const origin = {
        x: wall.a.x + u.x * a.offset + n.x * (wallS.h / 2000 + a.gap),
        y: wall.a.y + u.y * a.offset + n.y * (wallS.h / 2000 + a.gap),
      },
      plan = (q) => ({ x: origin.x + u.x * q.x + n.x * q.y, y: origin.y + u.y * q.x + n.y * q.y }),
      f = sec(a.floor.section),
      g = sec(a.foundation.grillage.section),
      rs = sec(a.roof.section),
      bs = sec(a.roof.beamSection),
      ps = sec(a.roof.postSection),
      bat = sec(a.roof.battenSection),
      gs = sec(a.glazing.section),
      density = project.material?.density ?? 500,
      material = {
        E: project.material?.E ?? 10000,
        Fb: project.material?.Fb ?? 13,
        Fv: project.material?.Fv ?? 1.5,
        Ft: project.material?.Ft ?? 8,
        Fc: project.material?.Fc ?? 12,
        density,
      },
      roofed = a.kind !== "openTerrace",
      angle = (a.roof.pitch * Math.PI) / 180,
      c = Math.cos(angle),
      tan = Math.tan(angle),
      inset = a.foundation.edgeInset;
    const shared = a.foundation.mode === "shared",
      nominalDeck = a.deckTopY ?? house.wallBaseY - 0.02,
      pileHead = shared
        ? base.grillageModel.pileHeadY
        : (a.foundation.pileHeadY ?? nominalDeck - a.floor.deckThickness - f.h / 1000 - g.h / 1000),
      grillageTop = pileHead + g.h / 1000,
      deck = grillageTop + f.h / 1000 + a.floor.deckThickness,
      beamY = (q) => deck + a.roof.lowEaveHeight + (a.depth - q) * tan;
    const item = {
        id: a.id,
        name: a.name,
        kind: a.kind,
        input: a,
        frame: { origin, u, outward: n },
        polygon: rect(0, 0, a.width, a.depth).map(plan),
        area: a.width * a.depth,
        deckTopY: deck,
        instances: [],
        glazing: [],
        checks: [],
        warnings: [],
        assumptions: [],
        floor: { surfaces: [], members: [] },
        roof: {
          surfaces: [],
          rafters: [],
          beams: [],
          posts: [],
          analyses: [],
          gutters: [],
          downpipes: [],
          quantities: {},
        },
        access: null,
        loads: { rows: [] },
        quantities: { ...out.quantities },
        status: "unverified",
        certified: false,
      },
      local = [];
    for (const k of Object.keys(item.quantities)) item.quantities[k] = 0;
    const check = (id, label, status, note, extra = {}) =>
      item.checks.push({ id: prefix + id, annexId: a.id, label, status, note, ...extra });
    if (pileHead < 0.05 || (Math.abs(deck - nominalDeck) > 0.005 && a.deckTopY !== null))
      check(
        "datum",
        "Отметки платформы и свай",
        "fail",
        "Введённые отметки оголовка/платформы несовместимы или оголовок ниже принятой поверхности.",
      );
    const xyz = (x, Y, z) => {
      const q = plan({ x, y: z });
      return [q.x, Y, q.y];
    };
    const add = (id, name, category, role, s, start, end, meta = {}) => {
      const L = Math.hypot(...end.map((x, i) => x - start[i]));
      if (L < 0.005) return null;
      const b = {
        id: prefix + id,
        name,
        category,
        role,
        b: s.b,
        h: s.h,
        length: L,
        volume: (s.b * s.h * L) / 1e6,
        mass: ((s.b * s.h * L) / 1e6) * density,
        start,
        end,
        crossAxis: [1, 0, 0],
        annexId: a.id,
        level: 1,
        floor: 1,
        requireSingleStock: true,
        cutStart: { scheme: "butt", angle: 0 },
        cutEnd: { scheme: "butt", angle: 0 },
        ...meta,
      };
      local.push(b);
      return b;
    };
    const axisPoly = rect(inset, inset, a.width - inset, a.depth - inset),
      localProject = { foundation: a.foundation, material, floor: { axis: "y" }, walls: [], loads: a.loads };
    const foundation = buildGrillage(localProject, {
      geometry: { closed: true, polygon: axisPoly },
      walls: [],
    });
    const commonPileId = (localId) => {
        const lp = foundation.piles.find((p) => p.id === localId),
          q = plan(lp),
          cp = base.grillageModel.piles.find((p) => dist(p, q) < 1e-6);
        return cp?.id ?? prefix + localId;
      },
      commonBeamId = (id) =>
        base.grillageModel.beams.find((b) => b.sources.includes(`annex:${a.id}:${id}`))?.id ?? prefix + id;
    if (!shared)
      for (const b of foundation.instances)
        add(
          b.id,
          b.name,
          "foundation",
          "grillagePly",
          b,
          b.start.map((v, i) => (i === 1 ? v + pileHead - 0.72 : v)),
          b.end.map((v, i) => (i === 1 ? v + pileHead - 0.72 : v)),
          {
            ...b,
            id: prefix + b.id,
            annexId: a.id,
            localBeamId: b.beamId,
            beamId: prefix + b.beamId,
            requireSingleStock: true,
            start: b.start.map((v, i) => (i === 1 ? v + pileHead - 0.72 : v)),
            end: b.end.map((v, i) => (i === 1 ? v + pileHead - 0.72 : v)),
          },
        );
    if (!shared)
      item.checks.push(...foundation.checks.map((q) => ({ ...q, id: prefix + q.id, annexId: a.id })));
    else item.foundationMode = "shared";
    const B = f.b / 1000,
      H = f.h / 1000,
      Y = grillageTop + H / 2,
      rimCoords = [
        [
          [B / 2, B / 2],
          [a.width - B / 2, B / 2],
        ],
        [
          [a.width - B / 2, B / 2],
          [a.width - B / 2, a.depth - B / 2],
        ],
        [
          [a.width - B / 2, a.depth - B / 2],
          [B / 2, a.depth - B / 2],
        ],
        [
          [B / 2, a.depth - B / 2],
          [B / 2, B / 2],
        ],
      ];
    for (const [i, [A, Z]] of rimCoords.entries())
      add(
        "rim" + i,
        "Обвязка платформы пристройки",
        "floor",
        "annexRim",
        f,
        [A[0], Y, A[1]],
        [Z[0], Y, Z[1]],
        {
          crossAxis: [
            -(Z[1] - A[1]) / Math.hypot(Z[0] - A[0], Z[1] - A[1]),
            0,
            (Z[0] - A[0]) / Math.hypot(Z[0] - A[0], Z[1] - A[1]),
          ],
          cutStart: { scheme: "miter", plane: "width", angle: 45, tiltSign: 1, cutWidthMM: f.b },
          cutEnd: { scheme: "miter", plane: "width", angle: 45, tiltSign: -1, cutWidthMM: f.b },
        },
      );
    const N = Math.max(2, Math.ceil((a.width - B) / a.floor.spacing)),
      step = (a.width - B) / N,
      joistU = Array.from({ length: N + 1 }, (_, i) => B / 2 + i * step),
      supportV = [
        ...new Set(foundation.beams.filter((b) => Math.abs(b.a.y - b.b.y) < EPS).map((b) => b.a.y)),
      ].sort((x, y) => x - y);
    for (let i = 1; i < N; i++) {
      const segments = [B, ...supportV.slice(1, -1), a.depth - B];
      for (let j = 1; j < segments.length; j++) {
        const start = segments[j - 1],
          end = segments[j],
          supports = supportV.filter((v) => v >= start - EPS && v <= end + EPS),
          A = supports[0],
          Z = supports.at(-1);
        const b = add(
          `joist-${i}-${j}`,
          "Лага пристройки",
          "floor",
          "annexJoist",
          f,
          [joistU[i], Y, start],
          [joistU[i], Y, end],
          {
            analyticalSpan: Z - A,
            supportStart: [joistU[i], A],
            supportEnd: [joistU[i], Z],
            loadWidth: step,
            crossAxis: [1, 0, 0],
            localSupports: [A, Z],
          },
        );
        if (b) item.floor.members.push(b);
      }
    }
    const blockRows = [
      ...new Set([
        ...Array.from(
          { length: Math.ceil(a.depth / a.floor.blockingStep) - 1 },
          (_, i) => (a.depth * (i + 1)) / Math.ceil(a.depth / a.floor.blockingStep),
        ),
        ...(roofed ? [inset, a.depth - inset] : []),
      ]),
    ].sort((x, y) => x - y);
    for (const [row, V] of blockRows.entries()) {
      if (
        roofed &&
        ![inset, a.depth - inset].some((v) => Math.abs(v - V) < EPS) &&
        [inset, a.depth - inset].some((v) => Math.abs(v - V) < (Math.max(f.b, ps.h) + f.b) / 2000 - EPS)
      )
        continue;
      const bearing = roofed && (Math.abs(V - inset) < EPS || Math.abs(V - (a.depth - inset)) < EPS),
        s = { b: bearing ? Math.max(f.b, ps.h) : f.b, h: f.h };
      for (let i = 1; i < joistU.length; i++)
        add(
          `block-${row}-${i}`,
          bearing ? "Опорный ряд под стойками крыши" : "Поперечная связь лаг пристройки",
          "floor",
          bearing ? "annexPostBearingBlock" : "annexBlocking",
          s,
          [joistU[i - 1] + B / 2, Y, V],
          [joistU[i] - B / 2, Y, V],
          {
            crossAxis: [0, 0, 1],
            verticalSupport: bearing,
            lateralRestraintOnly: !bearing,
            connectionVerified: false,
          },
        );
    }
    item.floor.surfaces = [
      {
        id: prefix + "deck",
        annexId: a.id,
        kind: "deck",
        points: rect(0, 0, a.width, a.depth).map((q) => xyz(q.x, deck, q.y)),
        area: item.area,
      },
    ];
    const postRows = roofed ? [inset, a.depth - inset] : [],
      roofBeamPieces = [];
    for (const [side, V] of postRows.entries()) {
      const pileRow = foundation.piles.filter((p) => Math.abs(p.y - V) < EPS).sort((x, y) => x.x - y.x),
        posts = pileRow.map((p) => ({ u: p.x, pileId: p.id }));
      for (const [i, p] of posts.entries()) {
        const post = add(
          `post-${side}-${i}`,
          "Стойка крыши пристройки",
          "roof",
          "annexRoofPost",
          ps,
          [p.u, deck, V],
          [p.u, beamY(V) - bs.h / 1000 / c, V],
          {
            crossAxis: [1, 0, 0],
            cutEnd: { scheme: "miter", angle: a.roof.pitch, tiltSign: 1 },
            supportedPileId: prefix + p.pileId,
            bearingBlockRow: V,
            connectionVerified: false,
          },
        );
        if (post) item.roof.posts.push(post);
      }
      const beamInset = a.kind === "glazedVeranda" ? gs.h / 1000 : 0,
        cuts = [beamInset, ...posts.slice(1, -1).map((p) => p.u), a.width - beamInset];
      for (let j = 1; j < cuts.length; j++) {
        const A = posts[j - 1],
          Z = posts[j],
          members = [];
        for (let ply = 0; ply < a.roof.beamPlies; ply++) {
          const off = (((ply - (a.roof.beamPlies - 1) / 2) * bs.b) / 1000) * c;
          const b = add(
            `roofbeam-${side}-${j}-${ply}`,
            "Опорная балка крыши пристройки",
            "roof",
            "annexRoofBeam",
            bs,
            [cuts[j - 1], beamY(V + off) - bs.h / 2000 / c, V + off],
            [cuts[j], beamY(V + off) - bs.h / 2000 / c, V + off],
            {
              crossAxis: [0, -Math.sin(angle), c],
              plyIndex: ply,
              localSupports: [A.u, Z.u],
              startPileId: prefix + A.pileId,
              endPileId: prefix + Z.pileId,
              connectionVerified: false,
            },
          );
          if (b) members.push(b);
        }
        roofBeamPieces.push({ side, V, from: cuts[j - 1], to: cuts[j], A, Z, members });
      }
    }
    let rafterRows = [],
      coverTopWood = [];
    if (roofed) {
      const o = a.roof.overhangs,
        L = (a.depth + o.low + o.high) / c,
        rafterInset = (a.kind === "glazedVeranda" ? gs.h / 1000 : 0) + rs.b / 2000,
        ns = Math.max(2, Math.ceil((a.width - 2 * rafterInset) / a.roof.spacing)),
        us = Array.from({ length: ns + 1 }, (_, i) => rafterInset + ((a.width - 2 * rafterInset) * i) / ns),
        widths = us.map(
          (U, i) =>
            (i === ns ? a.width + o.end : (U + us[i + 1]) / 2) - (i === 0 ? -o.start : (us[i - 1] + U) / 2),
        );
      for (const end of ["start", "end"]) {
        const i = end === "start" ? 0 : ns,
          j = end === "start" ? 1 : ns - 1,
          edge = end === "start" ? -o.start : a.width + o.end,
          delta = Math.abs(us[i] - edge),
          transfer = delta ** 2 / (2 * Math.abs(us[i] - us[j]));
        widths[i] += transfer;
        widths[j] -= transfer;
      }
      if (widths.some((w) => w <= 0))
        check(
          "roof-side-uplift",
          "Боковой свес крыши",
          "fail",
          "Грузовая ширина второго стропила отрицательна: нужен иной несущий узел бокового свеса.",
        );
      for (const [i, U] of us.entries()) {
        const lift = rs.h / 2000 / c,
          b = add(
            "rafter-" + i,
            "Стропило пристройки",
            "roof",
            "annexRafter",
            rs,
            [U, beamY(a.depth + o.low) + lift, a.depth + o.low],
            [U, beamY(-o.high) + lift, -o.high],
            {
              crossAxis: [1, 0, 0],
              bearingStart: [U, beamY(a.depth - inset) + lift, a.depth - inset],
              bearingEnd: [U, beamY(inset) + lift, inset],
              tributaryWidth: widths[i],
              cutStart: { scheme: "miter", angle: a.roof.pitch, tiltSign: 1 },
              cutEnd: { scheme: "miter", angle: a.roof.pitch, tiltSign: -1 },
              connectionVerified: false,
            },
          );
        rafterRows.push({ U, width: widths[i], board: b });
        if (b) coverTopWood.push(b);
      }
      const rows = Math.max(1, Math.ceil((a.depth + o.low + o.high) / a.roof.battenStep));
      for (let k = 0; k <= rows; k++) {
        const insetV = (bat.b / 2000) * c + (bat.h / 2000) * Math.sin(angle),
          V = -o.high + insetV + ((a.depth + o.low + o.high - 2 * insetV) * k) / rows,
          lift = rs.h / 1000 / c + bat.h / 2000 / c;
        coverTopWood.push(
          add(
            "batten-" + k,
            "Обрешётка с боковыми консолями",
            "roof",
            "annexRoofBatten",
            bat,
            [-o.start, beamY(V) + lift, V],
            [a.width + o.end, beamY(V) + lift, V],
            { crossAxis: [0, -Math.sin(angle), c], supportStations: us, connectionVerified: false },
          ),
        );
      }
      item.roof.surfaces = [
        {
          id: prefix + "roof",
          annexId: a.id,
          kind: "mono",
          points: [
            [-o.start, -o.high],
            [a.width + o.end, -o.high],
            [a.width + o.end, a.depth + o.low],
            [-o.start, a.depth + o.low],
          ].map(([U, V]) => xyz(U, beamY(V) + rs.h / 1000 / c, V)),
          area: ((a.width + o.start + o.end) * (a.depth + o.low + o.high)) / c,
        },
      ];
      item.roof.rafters = rafterRows.map((r) => r.board);
      item.roof.roofProjectedArea = (a.width + o.start + o.end) * (a.depth + o.low + o.high);
      item.roof.area = item.roof.surfaces[0].area;
      const gutterY = beamY(a.depth + o.low) + rs.h / 1000 / c,
        gutter = [xyz(-o.start, gutterY, a.depth + o.low), xyz(a.width + o.end, gutterY, a.depth + o.low)];
      item.roof.gutters = [
        {
          id: prefix + "gutter",
          path: gutter,
          start: gutter[0],
          end: gutter[1],
          length: a.width + o.start + o.end,
        },
      ];
      item.roof.downpipes = [0, 1].map((i) => ({
        id: prefix + "downpipe" + i,
        path: [gutter[i], [gutter[i][0], 0, gutter[i][2]]],
        start: gutter[i],
        end: [gutter[i][0], 0, gutter[i][2]],
        length: gutterY,
      }));
      item.roof.flashing = {
        id: prefix + "flashing",
        start: xyz(0, beamY(0), 0),
        end: xyz(a.width, beamY(0), 0),
        length: a.width,
        wallId: wall.id,
        verified: false,
      };
    }
    if (a.kind === "glazedVeranda") {
      const D = gs.h / 1000,
        W = gs.b / 1000,
        frontInner = a.depth - D / 2 - (D * c + W * Math.sin(angle)) / 2,
        sideDefs = [
          { id: "front", A: { x: 0, y: a.depth - D / 2 }, Z: { x: a.width, y: a.depth - D / 2 } },
          { id: "left", A: { x: D / 2, y: 0 }, Z: { x: D / 2, y: frontInner } },
          { id: "right", A: { x: a.width - D / 2, y: 0 }, Z: { x: a.width - D / 2, y: frontInner } },
        ];
      for (const side of sideDefs) {
        const len = dist(side.A, side.Z),
          su = { x: (side.Z.x - side.A.x) / len, y: (side.Z.y - side.A.y) / len },
          at = (s) => ({ x: side.A.x + su.x * s, y: side.A.y + su.y * s }),
          top = (s) => beamY(at(s).y),
          scale = 1 / c,
          count = Math.max(1, Math.ceil((len - W) / a.glazing.panelWidth)),
          door =
            side.id === "front"
              ? { from: a.glazing.doorOffset, to: a.glazing.doorOffset + a.glazing.doorWidth }
              : null,
          positions = Array.from({ length: count + 1 }, (_, i) => W / 2 + ((len - W) * i) / count);
        if (door) {
          for (let i = positions.length - 1; i >= 0; i--)
            if (positions[i] > door.from - W && positions[i] < door.to + W) positions.splice(i, 1);
          positions.push(door.from - W / 2, door.to + W / 2);
        }
        positions.sort((x, y) => x - y);
        for (const [i, s] of positions.entries()) {
          const q = at(s);
          add(
            `glass-stud-${side.id}-${i}`,
            "Стойка холодного остекления",
            "walls",
            "annexGlazingStud",
            gs,
            [q.x, deck + W, q.y],
            [q.x, top(s) - W * scale, q.y],
            {
              crossAxis: [su.x, 0, su.y],
              cutEnd:
                side.id === "front"
                  ? { scheme: "miter", angle: a.roof.pitch, tiltSign: 1 }
                  : { scheme: "miter", plane: "width", angle: a.roof.pitch, tiltSign: -1, cutWidthMM: gs.b },
              connectionVerified: false,
            },
          );
        }
        const sillRanges = door
          ? [
              [0, door.from],
              [door.to, len],
            ]
          : [[0, len]];
        for (const [i, [lo, hi]] of sillRanges.entries()) {
          const A = at(lo),
            Z = at(hi);
          add(
            `glass-sill-${side.id}-${i}`,
            "Нижний брус остекления",
            "walls",
            "annexGlazingSill",
            gs,
            [A.x, deck + W / 2, A.y],
            [Z.x, deck + W / 2, Z.y],
            { crossAxis: [0, 1, 0], connectionVerified: false },
          );
        }
        const addGlass = (id, kind, A, Z, bottom, topA, topZ) => {
          const panelArea = dist(A, Z) * ((topA + topZ) / 2 - bottom);
          if (panelArea < EPS) return;
          item.glazing.push({
            id: prefix + id,
            annexId: a.id,
            side: side.id,
            kind,
            polygon: [
              [A.x, bottom, A.y],
              [Z.x, bottom, Z.y],
              [Z.x, topZ, Z.y],
              [A.x, topA, A.y],
            ].map((q) => xyz(q[0], q[1], q[2])),
            area: panelArea,
            mass: ((panelArea * a.glazing.dead) / G) * 1000,
            designPressure: a.loads.wind,
            windForce: panelArea * a.loads.wind,
            verified: false,
          });
        };
        for (let i = 1; i < positions.length; i++) {
          const lo = positions[i - 1] + W / 2,
            hi = positions[i] - W / 2;
          if (hi - lo < EPS) continue;
          const A = at(lo),
            Z = at(hi),
            isDoor = !!door && lo >= door.from - EPS && hi <= door.to + EPS,
            topA = top(lo) - W * scale,
            topZ = top(hi) - W * scale;
          if (isDoor) {
            if (Math.min(topA, topZ) < deck + a.glazing.doorHeight + W)
              check(
                "glass-door-height",
                "Высота двери холодной веранды",
                "fail",
                "Дверь с перемычкой не помещается под верхней обвязкой.",
              );
            addGlass(
              `door-${side.id}-${i}`,
              "door",
              A,
              Z,
              deck,
              deck + a.glazing.doorHeight,
              deck + a.glazing.doorHeight,
            );
            addGlass(`transom-${side.id}-${i}`, "glass", A, Z, deck + a.glazing.doorHeight + W, topA, topZ);
            add(
              `door-head-${side.id}-${i}`,
              "Брус над дверью веранды",
              "walls",
              "annexGlazingDoorHead",
              gs,
              [A.x, deck + a.glazing.doorHeight + W / 2, A.y],
              [Z.x, deck + a.glazing.doorHeight + W / 2, Z.y],
              { crossAxis: [0, 1, 0], connectionVerified: false },
            );
          } else addGlass(`glass-${side.id}-${i}`, "glass", A, Z, deck + W, topA, topZ);
        }
        const A = at(0),
          Z = at(len),
          cut =
            side.id === "front"
              ? { scheme: "butt", angle: 0 }
              : { scheme: "miter", plane: "width", angle: a.roof.pitch, tiltSign: -1, cutWidthMM: gs.b };
        add(
          "glass-head-" + side.id,
          "Верхний брус холодного остекления",
          "walls",
          "annexGlazingHead",
          gs,
          [A.x, top(0) - (W / 2) * scale, A.y],
          [Z.x, top(len) - (W / 2) * scale, Z.y],
          { crossAxis: [0, c, Math.sin(angle)], cutStart: cut, cutEnd: cut, connectionVerified: false },
        );
      }
      check(
        "unheated-envelope",
        "Холодная остеклённая веранда",
        "unverified",
        "Пристройка не включена в отапливаемый контур дома. Тепловлажностный режим, стекло/профили, герметичность и тепловые мостики требуют отдельного расчёта.",
      );
    }
    // The private floor screen includes all actual platform wood. Roof forces are
    // applied above dedicated full-depth bearing rows over real grillage lines.
    const floorWood =
        (sum(local.filter((b) => b.category === "floor").map((b) => b.mass)) * G) / 1000 / item.area,
      floorService =
        a.loads.floorDead + floorWood + a.loads.live + (roofed ? 0 : a.loads.snow * a.loads.deckSnowFactor),
      floorDesign =
        (a.loads.floorDead + floorWood) * a.loads.gammaG +
        (a.loads.live + (roofed ? 0 : a.loads.snow * a.loads.deckSnowFactor)) * a.loads.gammaQ;
    for (const b of item.floor.members) {
      const A = b.localSupports[0] - b.start[2],
        Z = b.localSupports[1] - b.start[2];
      if (!(Z > A && A >= 0 && Z <= b.length + EPS)) {
        check(
          "floor-support-" + b.id,
          "Опоры лаг пристройки",
          "fail",
          "Лага не имеет двух реальных опор внутри физической доски.",
        );
        continue;
      }
      const I = (f.b * f.h ** 3) / 12,
        s = solveUniformOverhangBeam({
          length: b.length,
          supportA: A,
          supportB: Z,
          qService: floorService * b.loadWidth,
          qDesign: floorDesign * b.loadWidth,
          E: material.E,
          I,
        }),
        stress = (s.maxMoment * 1e6) / ((f.b * f.h ** 2) / 6),
        shear = (1.5 * s.maxShear * 1000) / (f.b * f.h),
        limit = ((Z - A) * 1000) / 300;
      b.analysis = {
        ...s,
        bendingStress: stress,
        shearStress: shear,
        deflectionLimit: limit,
        utilization: Math.max(stress / material.Fb, shear / material.Fv, s.maxDeflection / limit),
        status: s.reactionA < 0 || s.reactionB < 0 ? "fail" : "unverified",
      };
    }
    const worstFloor = item.floor.members
      .filter((b) => b.analysis)
      .reduce((x, y) => (!x || y.analysis.utilization > x.analysis.utilization ? y : x), null);
    if (worstFloor)
      check(
        "floor-capacity",
        "Лаги пристройки: изгиб, срез и прогиб",
        worstFloor.analysis.utilization > 1 ? "fail" : "pass",
        shared
          ? "Шарнирные пролёты по реальным линиям общего ростверка, с фактическими консолями. Полное действие введённых нагрузок; крепления и устойчивость не подтверждены."
          : "Шарнирные пролёты по реальным линиям независимого ростверка, с фактическими консолями. Полное действие введённых нагрузок; крепления и устойчивость не подтверждены.",
        { value: worstFloor.analysis.utilization, limit: 1, memberId: worstFloor.id },
      );
    const samples = [],
      sample = (q, characteristic, design, source, beamId) =>
        samples.push({ point: q, characteristic, design, source, beamId });
    const floorSnow = roofed ? 0 : item.area * a.loads.snow * a.loads.deckSnowFactor,
      glazingWeight = (sum(item.glazing.map((g) => g.mass)) * G) / 1000;
    const xyCount = 10;
    for (let i = 0; i < xyCount; i++)
      for (let j = 0; j < xyCount; j++) {
        const q = { x: (a.width * (i + 0.5)) / xyCount, y: (a.depth * (j + 0.5)) / xyCount },
          D = (a.loads.floorDead * item.area) / xyCount ** 2,
          Q = (a.loads.live * item.area + floorSnow) / xyCount ** 2;
        sample(q, D + Q, D * a.loads.gammaG + Q * a.loads.gammaQ, "deck-layers-live-snow");
      }
    for (const b of local.filter(
      (b) => !["annexRafter", "annexRoofBatten", "annexRoofBeam"].includes(b.role),
    )) {
      const n = Math.max(1, Math.ceil(b.length / 0.4));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n,
          q = { x: b.start[0] + (b.end[0] - b.start[0]) * t, y: b.start[2] + (b.end[2] - b.start[2]) * t },
          W = (b.mass * G) / 1000 / n;
        sample(q, W, W * a.loads.gammaG, "wood-" + b.id, b.localBeamId);
      }
    }
    for (const panel of item.glazing) {
      const points = panel.polygon.map((P) => {
          const dx = P[0] - origin.x,
            dz = P[2] - origin.y;
          return { x: dx * u.x + dz * u.y, y: dx * n.x + dz * n.y };
        }),
        q = {
          x: sum(points.map((p) => p.x)) / points.length,
          y: sum(points.map((p) => p.y)) / points.length,
        },
        W = (panel.mass * G) / 1000;
      sample(q, W, W * a.loads.gammaG, "glazing-" + panel.id);
    }
    let roofSnow = 0,
      roofLayers = 0;
    if (roofed) {
      const o = a.roof.overhangs,
        coverWidth = a.width + o.start + o.end,
        slopeLength = (a.depth + o.low + o.high) / c,
        topWood = coverTopWood.filter(Boolean),
        otherTopWeight = (sum(topWood.filter((b) => b.role !== "annexRafter").map((b) => b.mass)) * G) / 1000,
        extraRoofDead = otherTopWeight / item.roof.area,
        params = {
          horizontalSpan: a.depth - 2 * inset,
          pitch: a.roof.pitch,
          b: rs.b,
          h: rs.h,
          overhangLow: inset + o.low,
          overhangHigh: inset + o.high,
          roofDead: a.loads.roofDead + extraRoofDead,
          snow: a.loads.snow,
          mu: a.loads.snowMu,
          gammaG: a.loads.gammaG,
          gammaQ: a.loads.gammaQ,
          ...material,
          deflectionRatio: 300,
        };
      for (const row of rafterRows) {
        const analysis = calculateRafter({ ...params, spacing: Math.max(0.1, row.width) });
        item.roof.analyses.push({ rafterId: row.board.id, ...analysis });
        row.reactions = analysis.reactions;
      }
      const worst = item.roof.analyses.reduce((x, y) => (!x || y.utilization > x.utilization ? y : x), null);
      item.roof.analysis = worst;
      check(
        "rafter-capacity",
        "Стропила пристройки: частные проверки",
        worst?.capacityPass ? "pass" : "fail",
        "Стропило имеет две реальные опоры на самостоятельных стойках/балках, свободные концы и введённые снег/слои; крыша направлена от дома.",
        { value: worst?.utilization, limit: 1 },
      );
      const battenI =
          1 / ((c * c) / ((bat.b * bat.h ** 3) / 12) + Math.sin(angle) ** 2 / ((bat.h * bat.b ** 3) / 12)),
        battens = local.filter((b) => b.role === "annexRoofBatten");
      let maxBatten = 0;
      for (const b of battens) {
        const deadQ =
            (a.loads.roofDead * a.roof.battenStep) / c + (((bat.b * bat.h) / 1e6) * density * G) / 1000,
          snowQ = a.loads.snow * a.loads.snowMu * a.roof.battenStep,
          q = deadQ + snowQ,
          qd = deadQ * a.loads.gammaG + snowQ * a.loads.gammaQ,
          U = rafterRows.map((r) => r.U),
          pieces = [
            { from: -o.start, to: U[1], A: U[0], Z: U[1] },
            { from: U.at(-2), to: a.width + o.end, A: U.at(-2), Z: U.at(-1) },
            ...U.slice(1, -2).map((x, i) => ({ from: x, to: U[i + 2], A: x, Z: U[i + 2] })),
          ];
        for (const piece of pieces) {
          const sol = solveUniformOverhangBeam({
              length: piece.to - piece.from,
              supportA: piece.A - piece.from,
              supportB: piece.Z - piece.from,
              qService: q,
              qDesign: qd,
              E: material.E,
              I: battenI,
            }),
            stress =
              sol.maxMoment *
              1e6 *
              (c / ((bat.b * bat.h ** 2) / 6) + Math.sin(angle) / ((bat.h * bat.b ** 2) / 6));
          maxBatten = Math.max(
            maxBatten,
            stress / material.Fb,
            (1.5 * sol.maxShear * 1000) / (bat.b * bat.h) / material.Fv,
            sol.maxDeflection / (((piece.Z - piece.A) * 1000) / 300),
          );
        }
      }
      check(
        "lookout-capacity",
        "Обрешётка: локальные пролёты и консоли",
        maxBatten > 1 ? "fail" : "pass",
        "Рассмотрены крайние консоли на двух ближайших реальных стропилах и внутренние простые пролёты. Учтён поворот сечения: изгиб по обеим осям. Неразрезная работа и крепления требуют отдельного расчёта.",
        { value: maxBatten, limit: 1 },
      );
      for (const piece of roofBeamPieces) {
        const points = [];
        for (const row of rafterRows) {
          if (row.U < piece.from - EPS || row.U > piece.to + EPS) continue;
          const share =
              (Math.abs(row.U - piece.from) < EPS && piece.from > 0) ||
              (Math.abs(row.U - piece.to) < EPS && piece.to < a.width)
                ? 0.5
                : 1,
            reaction = piece.side === 1 ? "A" : "B",
            R = row.reactions;
          points.push({
            s: row.U - piece.from,
            service: (R?.["serviceVertical" + reaction] ?? 0) * share,
            design: (R?.["vertical" + reaction] ?? 0) * share,
          });
        }
        const b = piece.members[0],
          q = ((((bs.b * bs.h) / 1e6) * density * G) / 1000) * a.roof.beamPlies,
          L = piece.to - piece.from,
          sol = solveUniformOverhangBeam({
            length: L,
            supportA: piece.A.u - piece.from,
            supportB: piece.Z.u - piece.from,
            qService: q,
            qDesign: q * a.loads.gammaG,
            E: material.E,
            I:
              a.roof.beamPlies /
              ((c * c) / ((bs.b * bs.h ** 3) / 12) + Math.sin(angle) ** 2 / ((bs.h * bs.b ** 3) / 12)),
            pointLoads: points,
          }),
          stress =
            ((sol.maxMoment * 1e6) / a.roof.beamPlies) *
            (c / ((bs.b * bs.h ** 2) / 6) + Math.sin(angle) / ((bs.h * bs.b ** 2) / 6)),
          shear = (1.5 * sol.maxShear * 1000) / (a.roof.beamPlies * bs.b * bs.h),
          eta = Math.max(
            stress / material.Fb,
            shear / material.Fv,
            sol.maxDeflection / (((piece.Z.u - piece.A.u) * 1000) / 300),
          );
        item.roof.beams.push({
          memberIds: piece.members.map((b) => b.id),
          ...sol,
          utilization: eta,
          bendingStress: stress,
          shearStress: shear,
        });
        if (sol.reactionA < 0 || sol.reactionB < 0)
          check(
            "roof-beam-uplift-" + b.id,
            "Отрыв опоры крыши",
            "fail",
            "Есть отрицательная реакция: удержание не рассчитано, в положительный ростверк отрыв не подменён.",
          );
        else {
          sample({ x: piece.A.u, y: piece.V }, sol.serviceReactionA, sol.reactionA, "roof-post-reaction");
          sample({ x: piece.Z.u, y: piece.V }, sol.serviceReactionB, sol.reactionB, "roof-post-reaction");
        }
      }
      const postResults = item.roof.posts.map((b) => {
        const q = { x: b.start[0], y: b.start[2] },
          force =
            sum(
              samples
                .filter((s) => s.source === "roof-post-reaction" && dist(s.point, q) < EPS)
                .map((s) => s.design),
            ) +
            ((b.mass * G) / 1000) * a.loads.gammaG,
          A = ps.b * ps.h,
          I = (Math.max(ps.b, ps.h) * Math.min(ps.b, ps.h) ** 3) / 12,
          euler = (Math.PI ** 2 * (project.material?.Emin ?? material.E) * I) / (b.length * 1000) ** 2 / 1000,
          // СП 64.13330.2017 / СНиП II-25-80 п. 4.2–4.3: φ by λ about both axes, full length.
          buckling = axialCompression({
            N: force,
            b: Math.min(ps.b, ps.h),
            h: Math.max(ps.b, ps.h),
            l0Strong: b.length,
            l0Weak: b.length,
            Fc: material.Fc,
            kind: "column",
          }),
          capacity = buckling.capacity;
        return {
          memberId: b.id,
          length: b.length,
          force,
          euler,
          idealEulerReferenceOnly: true,
          lambda: buckling.lambda,
          lambdaLimit: buckling.lambdaLimit,
          phi: buckling.phi,
          capacity,
          utilization: Math.max(force / capacity, buckling.lambda / buckling.lambdaLimit),
          unbracedLength: b.length,
        };
      });
      item.roof.postChecks = postResults;
      const postEta = Math.max(0, ...postResults.map((p) => p.utilization));
      check(
        "post-compression",
        "Стойки пристройки: сжатие с φ и λ ≤ 120 (СП 64)",
        postEta > 1 ? "fail" : "pass",
        "Полная фактическая длина без скрытого раскрепления. N/(φ·Rc·A) ≤ 1 и λ ≤ 120 по СП 64.13330.2017 / СНиП II-25-80 п. 4.2–4.3, табл. 14; изгиб от ветра и узлы не подтверждены.",
        { value: postEta, limit: 1 },
      );
      const maxBeam = Math.max(0, ...item.roof.beams.map((b) => b.utilization));
      check(
        "roof-beams",
        "Опорные балки крыши: изгиб/срез/прогиб",
        maxBeam > 1 ? "fail" : "pass",
        "Реальные стропильные реакции приложены к балкам между независимыми стойками; собственный вес балок добавлен один раз.",
        { value: maxBeam, limit: 1 },
      );
      roofSnow = a.loads.snow * a.loads.snowMu * item.roof.roofProjectedArea;
      roofLayers = a.loads.roofDead * item.roof.area;
    }
    const analyzed = analyzeGrillageLoads(localProject, foundation, samples);
    Object.assign(foundation, analyzed);
    if (!shared)
      item.checks.push(...analyzed.loadChecks.map((q) => ({ ...q, id: prefix + q.id, annexId: a.id })));
    else {
      item.sharedLoadSamples = [];
      for (const span of foundation.spans) {
        const common = base.grillageModel.beams.find((b) =>
          b.sources.includes(`annex:${a.id}:${span.beamId}`),
        );
        if (!common) {
          check(
            "shared-beam-" + span.beamId,
            "Связь пристройки с общей балкой",
            "fail",
            "Нет канонической балки для локальной нагрузки.",
          );
          continue;
        }
        for (const q of span.pointLoads) {
          const t = q.at / span.length,
            P = {
              x: span.start.x + (span.end.x - span.start.x) * t,
              y: span.start.y + (span.end.y - span.start.y) * t,
            };
          item.sharedLoadSamples.push({
            point: plan(P),
            characteristic: q.characteristic,
            design: q.design,
            beamId: common.id,
            annexId: a.id,
            localSpanId: span.id,
          });
        }
      }
    }
    const localWoodWeight = (sum(local.map((b) => b.mass)) * G) / 1000,
      dead = a.loads.floorDead * item.area + roofLayers + glazingWeight + localWoodWeight,
      live = a.loads.live * item.area,
      snow = floorSnow + roofSnow,
      expected = dead * a.loads.gammaG + (live + snow) * a.loads.gammaQ,
      actual = sum(foundation.piles.map((p) => p.reaction));
    check(
      "load-balance",
      shared ? "Баланс нагрузки пристройки в общем основании" : "Баланс независимых опор пристройки",
      Math.abs(actual - expected) < 1e-6 ? "pass" : "fail",
      shared
        ? "Слои и надземная древесина пристройки сформированы без повторной массы общего ростверка. Нагрузки передаются в каноническую общую сеть."
        : "Все слои, стекло и физическая древесина включены один раз. Реакции этой пристройки остаются на её собственных сваях.",
      { value: actual - expected, limit: 1e-6, unit: "кН" },
    );
    if (roofed && item.roof.roofProjectedArea > 0) {
      // B4: wind uplift of the light annex roof, 1,4·W − 0,9·G (СП 20.13330.2016 п. 7.2, 11.1).
      const profile = loadProfile(project.loads),
        f = loadFactors(project.loads ?? {}),
        w = (a.loads.wind ?? 0) * windK(5, windTerrain(project.loads), profile),
        c = monoRoofUpliftCoefficient(a.roof.pitch, { open: a.kind === "coveredTerrace" }, profile),
        roofWood = (sum(local.filter((b) => b.category === "roof").map((b) => b.mass)) * G) / 1000,
        up = w * c * item.roof.roofProjectedArea,
        net = f.wind * up - f.favourable * (roofLayers + roofWood),
        posts = Math.max(1, item.roof.posts?.length ?? 0);
      check(
        "wind-uplift",
        "Ветровой отрыв крыши пристройки: анкеровка стоек",
        net > 0 ? "warning" : "pass",
        net > 0
          ? `Расчётный отрыв ${net.toFixed(2)} кН на крышу (${(net / posts).toFixed(2)} кН на стойку при ${posts} стойках, c = ${c.toFixed(2)}). Анкеровка стоек и крыши не моделируется: требуется крепёж на это усилие.`
          : `Вес крыши 0,9·G удерживает её от отрыва 1,4·W (c = ${c.toFixed(2)}); крепление от сдвига не проверено.`,
        { value: Math.max(0, net / posts), limit: 0, unit: "кН" },
      );
    }
    check(
      "pile-capacity",
      "Реакции свай пристройки",
      foundation.piles.some((p) => p.reaction > a.foundation.capacity) ? "fail" : "pass",
      "Несущая способность задана пользователем; грунт, осадки, отрыв и горизонтальная работа не подтверждены.",
      {
        value: Math.max(0, ...foundation.piles.map((p) => p.reaction)),
        limit: a.foundation.capacity,
        unit: "кН",
      },
    );
    const doors = (project.openings ?? []).filter(
      (o) =>
        o.wallId === wall.id &&
        o.type === "door" &&
        (o.floor ?? wall.level ?? 1) === 1 &&
        o.offset >= a.offset - EPS &&
        o.offset + o.width <= a.offset + a.width + EPS &&
        o.sill < EPS,
    );
    item.access = {
      wallId: wall.id,
      houseDoorIds: doors.map((o) => o.id),
      thresholdDifference: deck - house.wallBaseY,
      status: doors.length ? "unverified" : "missing",
    };
    check(
      "house-access",
      "Доступ из дома в пристройку",
      doors.length ? "unverified" : "fail",
      doors.length
        ? "Существующий дверной проём попадает в интервал пристройки. Порог, направление полотна, гидроизоляция и несущая перемычка требуют проверки."
        : "В выбранном интервале нет дверного проёма дома: функциональный проход не создан и не подменён окном.",
    );
    const over = local.filter((b) => {
      const allowance = (cut) =>
        cut?.scheme === "miter"
          ? ((cut.cutWidthMM ?? b.h) / 2000) * Math.tan((Math.abs(cut.angle) * Math.PI) / 180)
          : 0;
      b.cutLength = b.length + allowance(b.cutStart) + allowance(b.cutEnd);
      return b.cutLength > 6 + EPS;
    });
    check(
      "stock",
      "Цельные заготовки пристройки до6м",
      over.length ? "fail" : "pass",
      "Наращивание не создаёт опору. Длинные непрерывные элементы оставлены с явным превышением; ростверк имеет стыки только на своих сваях.",
      { value: over.length, limit: 0, memberIds: over.map((b) => b.id) },
    );
    check(
      "weather-load-cases",
      "Снег, ветер и пространственная работа",
      "unverified",
      roofed
        ? "Рассчитан равномерный снег на кровле (µ по СП 20.13330.2016 прил. Б) и отрыв крыши ветром. Снеговой мешок у стены дома при перепаде высот (прил. Б, схема Б.8), сход снега с кровли дома и снег на полу под навесом не рассчитаны."
        : "Открытая платформа несёт введённые полезную нагрузку и снег одновременно. Сугробы у стены, горизонтальные нагрузки, ограждения и сосредоточенные нагрузки требуют отдельных случаев.",
    );
    check(
      "exposure-material",
      "Древесина наружной конструкции",
      "unverified",
      "Применены введённые свойства материала проекта. Влажностный режим, длительность нагрузки, защита от воды и пригодность расчётных сопротивлений для наружной службы отдельно не подтверждены.",
    );
    check(
      "connections",
      shared ? "Узлы пристройки в общей раме" : "Узлы независимой пристройки",
      "unverified",
      "Крепёж слоёв, оголовки, смятие, опорные блоки под стойками, раскрепление, анкеры и поперечная устойчивость не рассчитаны. Фартук не передаёт вертикальную нагрузку на дом.",
    );
    if (roofed)
      check(
        "drainage",
        "Сток от дома",
        "unverified",
        "Моноскат направлен от стены к наружному желобу и трубам. Указаны геометрические трассы и нетто-длины; гидравлика, слив на грунт, обмерзание и примыкание фартука не рассчитаны.",
      );
    if (deck > 0.5)
      check(
        "guards",
        "Край платформы и наружные ступени",
        "unverified",
        "Перепад до принятого грунта требует ограждений и безопасного выхода. Их несущая способность и наружная лестница автоматически не подтверждены.",
      );
    // Rotate every physical board once from local U/V into world coordinates.
    const handedness = u.x * n.y - u.y * n.x,
      mapCut = (cut) =>
        cut?.scheme === "miter" && cut.plane !== "width"
          ? { ...cut, tiltSign: (cut.tiltSign ?? 1) * handedness }
          : cut;
    item.instances = local.map((b) => ({
      ...b,
      ...(shared
        ? Object.fromEntries(
            ["supportedPileId", "startPileId", "endPileId"]
              .filter((k) => b[k])
              .map((k) => [k, commonPileId(b[k].startsWith(prefix) ? b[k].slice(prefix.length) : b[k])]),
          )
        : {}),
      cutStart: mapCut(b.cutStart),
      cutEnd: mapCut(b.cutEnd),
      start: xyz(b.start[0], b.start[1], b.start[2]),
      end: xyz(b.end[0], b.end[1], b.end[2]),
      crossAxis: [
        u.x * b.crossAxis[0] + n.x * b.crossAxis[2],
        b.crossAxis[1],
        u.y * b.crossAxis[0] + n.y * b.crossAxis[2],
      ],
      bearingStart: b.bearingStart ? xyz(...b.bearingStart) : undefined,
      bearingEnd: b.bearingEnd ? xyz(...b.bearingEnd) : undefined,
    }));
    const physicalById = new Map(item.instances.map((b) => [b.id, b]));
    item.floor.members = item.floor.members.map((b) => physicalById.get(b.id));
    item.roof.rafters = item.roof.rafters.map((b) => physicalById.get(b.id));
    item.roof.posts = item.roof.posts.map((b) => physicalById.get(b.id));
    const mapPoint = (q) => plan(q),
      mapPile = (p) => {
        const q = mapPoint(p);
        return {
          ...p,
          ...q,
          id: shared ? commonPileId(p.id) : prefix + p.id,
          annexId: a.id,
          capTopY: pileHead,
          headY: pileHead,
          capacity: a.foundation.capacity,
          utilization: p.reaction / a.foundation.capacity,
          beamIds: p.beamIds.map((id) => (shared ? commonBeamId(id) : prefix + id)),
          shared,
        };
      };
    item.foundation = {
      ...foundation,
      shared,
      pileHeadY: pileHead,
      topY: grillageTop,
      beamBottomY: pileHead,
      instances: item.instances.filter((b) => b.category === "foundation"),
      piles: foundation.piles.map(mapPile),
      beams: foundation.beams.map((b) => ({
        ...b,
        id: shared ? commonBeamId(b.id) : prefix + b.id,
        a: mapPoint(b.a),
        b: mapPoint(b.b),
        stations: b.stations.map((s) => ({
          ...s,
          point: mapPoint(s.point),
          pileId: shared ? commonPileId(s.pileId) : prefix + s.pileId,
        })),
      })),
      joints: foundation.joints.map((j) => ({
        ...j,
        id: shared
          ? (base.grillageModel.joints.find((k) => k.type === j.type && k.pileId === commonPileId(j.pileId))
              ?.id ?? prefix + j.id)
          : prefix + j.id,
        componentJointId: prefix + j.id,
        pileId: shared ? commonPileId(j.pileId) : prefix + j.pileId,
        point: j.point ? mapPoint(j.point) : undefined,
        position: j.position ? xyz(j.position[0], j.position[1] + pileHead - 0.72, j.position[2]) : undefined,
        beamId: j.beamId ? (shared ? commonBeamId(j.beamId) : prefix + j.beamId) : undefined,
        beamIds: j.beamIds?.map((id) => (shared ? commonBeamId(id) : prefix + id)),
        primaryBeamId: j.primaryBeamId
          ? shared
            ? commonBeamId(j.primaryBeamId)
            : prefix + j.primaryBeamId
          : undefined,
      })),
      spans: foundation.spans.map((s) => ({
        ...s,
        id: shared
          ? (base.grillageModel.spans.find(
              (q) =>
                q.beamId === commonBeamId(s.beamId) &&
                q.startPileId === commonPileId(s.startPileId) &&
                q.endPileId === commonPileId(s.endPileId),
            )?.id ?? prefix + s.id)
          : prefix + s.id,
        componentSpanId: prefix + s.id,
        beamId: shared ? commonBeamId(s.beamId) : prefix + s.beamId,
        start: mapPoint(s.start),
        end: mapPoint(s.end),
        startPileId: shared ? commonPileId(s.startPileId) : prefix + s.startPileId,
        endPileId: shared ? commonPileId(s.endPileId) : prefix + s.endPileId,
      })),
    };
    if (!shared)
      for (const pile of item.foundation.piles)
        for (const housePile of base.piles ?? base.grillageModel?.piles ?? []) {
          const size = (pile.capSize ?? 250) / 2000,
            hsize = (housePile.capSize ?? project.foundation?.grillage?.capSize ?? 250) / 2000,
            cap = rect(-size, -size, size, size).map((q) => ({
              x: pile.x + u.x * q.x + n.x * q.y,
              y: pile.y + u.y * q.x + n.y * q.y,
            })),
            houseCap = rect(
              housePile.x - hsize,
              housePile.y - hsize,
              housePile.x + hsize,
              housePile.y + hsize,
            );
          if (overlap(cap, houseCap) > 1e-7)
            check(
              "pile-conflict-" + pile.id + "-" + housePile.id,
              "Пересечение оголовков дома и пристройки",
              "fail",
              "Независимые оголовки физически пересекаются. Нужны иной отступ/сетка или отдельный проект общего узла.",
              { pileIds: [pile.id, housePile.id] },
            );
        }
    // Exact convex annex polygon versus all house triangles is not inferred from
    // bbox. Sample its corners/centre and crossing edge intersections explicitly.
    if (overlap(house.polygon, item.polygon) > 1e-7)
      check(
        "house-overlap",
        "Контур пристройки входит в дом",
        "fail",
        "Пристройка пересекает фактический контур основного дома.",
      );
    const wallOpenings = (project.openings ?? []).filter(
      (o) =>
        o.wallId === wall.id &&
        (o.floor ?? wall.level ?? 1) === 1 &&
        o.offset < a.offset + a.width &&
        o.offset + o.width > a.offset,
    );
    if (roofed)
      for (const o of wallOpenings) {
        const h0 = house.wallBaseY + o.sill,
          h1 = h0 + o.height,
          roofY = beamY(0);
        if (roofY > h0 - EPS && roofY < h1 + EPS)
          check(
            "roof-over-opening-" + o.id,
            "Примыкание кровли через проём",
            "fail",
            "Линия фартука/кровли попадает в существующий дверной или оконный проём дома.",
            { openingId: o.id },
          );
      }
    item.loads = {
      rows: [
        {
          id: prefix + "timber",
          label: "Древесина пристройки",
          characteristic: localWoodWeight,
          design: localWoodWeight * a.loads.gammaG,
          kind: "dead",
        },
        {
          id: prefix + "floor-layers",
          label: "Слои платформы пристройки",
          characteristic: a.loads.floorDead * item.area,
          design: a.loads.floorDead * item.area * a.loads.gammaG,
          kind: "dead",
        },
        {
          id: prefix + "roof-layers",
          label: "Слои крыши пристройки",
          characteristic: roofLayers,
          design: roofLayers * a.loads.gammaG,
          kind: "dead",
        },
        {
          id: prefix + "glazing",
          label: "Холодное остекление",
          characteristic: glazingWeight,
          design: glazingWeight * a.loads.gammaG,
          kind: "dead",
        },
        {
          id: prefix + "live",
          label: "Полезная нагрузка пристройки",
          characteristic: live,
          design: live * a.loads.gammaQ,
          kind: "variable",
        },
        {
          id: prefix + "snow",
          label: roofed ? "Снег на крыше пристройки" : "Снег на открытой платформе",
          characteristic: snow,
          design: snow * a.loads.gammaQ,
          kind: "variable",
        },
      ]
        .filter((r) => r.characteristic > 0)
        .map((r) => ({ ...r, annexId: a.id })),
      dead,
      live,
      snow,
      totalCharacteristic: dead + live + snow,
      totalDesign: expected,
      reactionSum: actual,
      balanceError: actual - expected,
      complete: !item.checks.some((c) => c.status === "fail"),
    };
    item.quantities = {
      floorArea: item.area,
      roofArea: item.roof.area ?? 0,
      roofProjectedArea: item.roof.roofProjectedArea ?? 0,
      glazingArea: sum(item.glazing.map((g) => g.area)),
      glazingMass: sum(item.glazing.map((g) => g.mass)),
      woodVolume: sum(local.map((b) => b.volume)),
      woodMass: sum(local.map((b) => b.mass)),
      pileCount: item.foundation.piles.length,
      gutterLength: sum(item.roof.gutters.map((g) => g.length)),
      downpipeLength: sum(item.roof.downpipes.map((g) => g.length)),
      flashingLength: item.roof.flashing?.length ?? 0,
    };
    item.status = item.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
    item.warnings = item.checks.filter((c) => c.status === "fail").map((c) => c.note);
    item.assumptions = [
      shared
        ? "Пристройка соединена с домом общим ростверком, каноническими балками и опорнымиID. Древесина основания включена в общую модель один раз. Каждый пролёт считается шарнирным; пространственная жёсткость общей рамы и разность осадок не подтверждены."
        : "Пристройка имеет собственный ростверк и сваи. Основной дом не используется как неявная вертикальная опора; стена задаёт только геометрию примыкания.",
      "В равномерном предварительном случае снег на открытой платформе принят по полной введённой площади, на крыше — по её горизонтальной проекции с введённымμ. Сочетания, заносы и сход снега с дома требуют отдельного расчёта.",
      "Лаги и стропила рассчитаны как балки с фактическими опорами и консолями. Стропильные реакции переданы балкам над самостоятельными стойками; низ стойки стоит над отдельным опорным рядом блоков и реальной линией ростверка.",
      "Опорные балки крыши повёрнуты сечением к скату; оголовки стоек имеют реальный косой торец. Для вертикальной нагрузки учтены изгиб по обеим осям и соответствующая вертикальная податливость. Это проектное геометрическое решение с непроверенными анкерами и боковым удержанием, а не типовой сертифицированный узел.",
      "Общая вертикальная нагрузка не включает неизвестные узловые сопротивления. Непроверенные смятие, анкеры, устойчивость, ветровой отрыв и грунт остаютсяunknown;certified=false.",
    ];
    out.items.push(item);
    out.instances.push(...item.instances);
    if (!shared) out.piles.push(...item.foundation.piles);
    out.checks.push(...item.checks);
    out.warnings.push(...item.warnings);
    out.assumptions.push(...item.assumptions);
    out.loads.rows.push(...item.loads.rows);
    for (const k of ["dead", "live", "snow", "totalCharacteristic", "totalDesign"])
      out.loads[k] += item.loads[k];
    for (const k of Object.keys(out.quantities)) out.quantities[k] += item.quantities[k];
  }
  for (let i = 0; i < out.items.length; i++)
    for (let j = 0; j < i; j++) {
      const a = out.items[i],
        b = out.items[j];
      if (overlap(a.polygon, b.polygon) > 1e-6)
        out.checks.push({
          id: `annex-overlap-${a.id}-${b.id}`,
          label: "Пересечение пристроек",
          status: "fail",
          note: "Две пристройки пересекаются в плане; их независимые конструкции не объединяются автоматически.",
          annexIds: [a.id, b.id],
        });
    }
  for (let i = 0; i < out.items.length; i++)
    for (let j = 0; j < i; j++) {
      const a = out.items[i],
        b = out.items[j],
        roofA = a.roof.surfaces[0]?.points.map((p) => ({ x: p[0], y: p[2] })),
        roofB = b.roof.surfaces[0]?.points.map((p) => ({ x: p[0], y: p[2] }));
      if (roofA && roofB && overlap(roofA, roofB) > 1e-6)
        out.checks.push({
          id: "annex-roof-overlap-" + a.id + "-" + b.id,
          label: "Пересечение крыш независимых пристроек",
          status: "fail",
          note: "Покрытия пристроек пересекаются. Общий узел, ендова или подрезка не создаются автоматически.",
          annexIds: [a.id, b.id],
        });
      const cap = (p, item) => {
        const h = p.capSize / 2000,
          U = item.frame.u,
          N = item.frame.outward;
        return rect(-h, -h, h, h).map((q) => ({
          x: p.x + U.x * q.x + N.x * q.y,
          y: p.y + U.y * q.x + N.y * q.y,
        }));
      };
      for (const pa of a.foundation.piles)
        for (const pb of b.foundation.piles)
          if (
            !(a.foundation.shared && b.foundation.shared && pa.id === pb.id) &&
            overlap(cap(pa, a), cap(pb, b)) > 1e-7
          )
            out.checks.push({
              id: "annex-cap-overlap-" + pa.id + "-" + pb.id,
              label: "Пересечение оголовков независимых пристроек",
              status: "fail",
              note: "Оголовки разных пристроек физически пересекаются; независимые основания требуют изменения сетки или рассчитанного общего узла.",
              pileIds: [pa.id, pb.id],
            });
    }
  out.warnings = [
    ...new Set([...out.warnings, ...out.checks.filter((c) => c.status === "fail").map((c) => c.note)]),
  ];
  out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  out.loads.reactionSum = sum(out.items.map((a) => a.loads.reactionSum));
  out.loads.balanceError = out.loads.reactionSum - out.loads.totalDesign;
  out.loads.complete = out.status !== "fail";
  return out;
}

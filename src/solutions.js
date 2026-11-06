/**
 * SOLUTIONS: verified fix proposals and a bounded deterministic optimizer.
 *
 * The engine is treated as a black box: project JSON → evaluateHouse → checks.
 * Every rule below only proposes JSON-Patch operations on documented project
 * fields; a proposal is reported only after it was applied to a copy and the
 * whole house was re-evaluated. Formulas for loads and resistance live elsewhere
 * and may change freely without touching this module.
 */
import { evaluateHouse, applyProjectPatch } from "./house-engine.js";
import { timberSections, parseSection } from "./catalog.js";
import { evaluateRafterCandidates } from "./rafters.js";
import { evaluateWallSectionCandidates } from "./wall-stability.js";
import {
  checkUtilization,
  checkSeverity,
  indexChecks,
  evaluationMetrics,
  compareMetrics,
} from "./check-metrics.js";

const EPS = 1e-9,
  G = 9.81,
  finite = Number.isFinite,
  clone = (x) => JSON.parse(JSON.stringify(x)),
  round = (x, d = 3) => (finite(x) ? Math.round(x * 10 ** d) / 10 ** d : x),
  mm = (id) => String(id).replace(/x/i, "×"),
  object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

const boards = timberSections.filter((s) => s.category === "board");
const SPACING_LADDER = [1.2, 1, 0.8, 0.6, 0.5, 0.4, 0.3];
const STUD_STEP_LADDER = [0.6, 0.5, 0.4, 0.3];
const PILE_SPACING_LADDER = [3, 2.5, 2, 1.75, 1.5, 1.25, 1];
const PILE_CAPACITY_LADDER = [20, 30, 40, 60, 80, 100, 150, 200, 300];
const SHEET_THICKNESS_LADDER = [9, 12, 15, 18, 22];
const NAIL_SPACING_LADDER = [150, 100, 75, 50];
const TRUSS_TYPES = ["fink", "queen", "king"];
/** System-level roll-up checks: they clear when member checks clear, so they are not targets themselves. */
const DERIVED_CHECKS = new Set([
  "roofZonesSolution",
  "trussSolution",
  "roofSystem",
  "designerMemberSystem",
  "generation-building-design",
]);

function deeperSections(id, n = 2) {
  const s = parseSection(id);
  if (!s) return [];
  return boards
    .filter((q) => q.b === s.b && q.h > s.h)
    .sort((a, b) => a.h - b.h)
    .slice(0, n)
    .map((q) => q.id);
}
function shallowerSection(id, minH = 100) {
  const s = parseSection(id);
  if (!s) return null;
  return (
    boards
      .filter((q) => q.b === s.b && q.h < s.h && q.h >= minH)
      .sort((a, b) => b.h - a.h)
      .map((q) => q.id)[0] ?? null
  );
}
const below = (ladder, v, n = 1) =>
  ladder
    .filter((x) => x < v - EPS)
    .sort((a, b) => b - a)
    .slice(0, n);
const above = (ladder, v, max = Infinity) =>
  ladder
    .filter((x) => x > v + EPS && x <= max + EPS)
    .sort((a, b) => a - b)
    .slice(0, 1);

/** JSON-Pointer helpers on the source project (the one that will be patched). */
const escapeKey = (k) => String(k).replaceAll("~", "~0").replaceAll("/", "~1");
function lookup(project, path) {
  let v = project;
  for (const key of path
    .slice(1)
    .split("/")
    .map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (v === null || typeof v !== "object" || !Object.hasOwn(v, key)) return { exists: false };
    v = v[key];
  }
  return { exists: true, value: v };
}
function setOp(project, path, value) {
  return { op: lookup(project, path).exists ? "replace" : "add", path, value };
}
const wallIndex = (project, id) => (project.walls ?? []).findIndex((w) => w.id === id);

/** Planning metadata becomes stale after geometry edits — mirror engine.patch exactly. */
export function planningAfterPatch(planning = {}, operations = []) {
  const geometryChanged = operations.some(
    (o) =>
      /^\/(walls|levels|floors|voids|openings)/.test(o.path) &&
      !/^\/(walls|levels)\/\d+\/height$/.test(o.path),
  );
  return geometryChanged
    ? {
        ...planning,
        checks: [],
        warnings: [
          ...(planning.warnings ?? []),
          "Room-program metadata predates a geometry edit; inspect the actual revised walls and openings.",
        ],
        stale: true,
      }
    : planning;
}

/** keep: exact JSON pointers or prefixes; "*" matches one path segment. */
function keepMatcher(keep = []) {
  const rules = (Array.isArray(keep) ? keep : [])
    .filter((k) => typeof k === "string" && k.startsWith("/"))
    .map((k) => {
      const body = k
        .replace(/\/+$/, "")
        .split("/")
        .map((seg) => (seg === "*" ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("/");
      return new RegExp("^" + body + "(/|$)");
    });
  return (path) => rules.some((r) => r.test(path));
}

/* ------------------------------------------------------------------ */
/* Rule table: check → member group → candidate patches                */
/* ------------------------------------------------------------------ */

function floorLevelOf(check, ctx) {
  if (Number.isInteger(check.level)) return check.level;
  const m = /-L(\d+)$/.exec(check.id);
  if (m) return Number(m[1]);
  const joists = (ctx.result.floorPlatform?.joistChecks ?? []).filter((j) => finite(j.utilization));
  if (joists.length) {
    const worst = joists.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    if (Number.isInteger(worst.floor ?? worst.level)) return worst.floor ?? worst.level;
  }
  return ctx.p.floors ?? 1;
}

const RULES = [
  {
    name: "floor",
    match: (c) =>
      /^designerJoist(Bending|Deflection|FinalDeflection|Shear|Bearing)$/.test(c.id) ||
      /^floor-(stock|supports)-L\d+$/.test(c.id) ||
      c.id === "floorJoistEndConsoles",
    group: (c, ctx) => ({ key: "floor", label: "Балки перекрытия", levels: [floorLevelOf(c, ctx)] }),
    candidates: floorCandidates,
  },
  {
    name: "studs",
    match: (c) => /^designerStud(Compression|PlateBearing|Slenderness)$/.test(c.id),
    group: () => ({ key: "studs", label: "Стойки несущих стен" }),
    candidates: studCandidates,
  },
  {
    name: "full-height-wall",
    match: (c) =>
      typeof c.wallId === "string" &&
      /-full-wall-(compression|tension|bending|shear|interaction|deflection|stock)$/.test(c.id),
    group: (c) => ({
      key: `wall:${c.wallId}:${c.level ?? 1}`,
      label: `Высокая стена ${c.wallId}`,
      wallId: c.wallId,
      level: c.level ?? 1,
    }),
    candidates: fullWallCandidates,
  },
  {
    name: "roof",
    match: (c) => typeof c.zoneId === "string" || (/^truss-/.test(c.id) && c.id !== "truss-connections"),
    group: (c) =>
      c.zoneId
        ? { key: `roof:${c.zoneId}`, label: `Кровля, зона ${c.zoneId}`, zoneId: c.zoneId }
        : { key: "roof:*", label: "Стропильная система", zoneId: null },
    candidates: roofCandidates,
  },
  {
    name: "piles",
    match: (c) =>
      c.id === "pileCapacity" || c.id === "grillage-spacing" || c.id === "designerGrillagePileBearing",
    group: () => ({ key: "piles", label: "Сваи" }),
    candidates: pileCandidates,
  },
  {
    name: "grillage",
    match: (c) =>
      /^grillage-/.test(c.id) &&
      ![
        "grillage-connections",
        "grillage-ply-connections",
        "grillage-cap-conflicts",
        "grillage-balance",
      ].includes(c.id),
    group: () => ({ key: "grillage", label: "Ростверк" }),
    candidates: grillageCandidates,
  },
  {
    name: "bracing",
    match: (c) =>
      /-(shear-capacity|sheet-edges|let-in-fit)$/.test(c.id) ||
      ["designerBraceTension", "lateralStability", "bracing-none"].includes(c.id),
    group: () => ({ key: "bracing", label: "Жёсткость стен (раскрепление)" }),
    candidates: bracingCandidates,
  },
];

function floorSectionOps(ctx, section) {
  const f = ctx.p.floor,
    h = parseSection(section).h,
    ops = [setOp(ctx.project, "/floor/section", section)];
  for (const k of ["rimSection", "blockingSection"]) {
    const s = parseSection(f[k]);
    if (f[k] !== null && f[k] !== undefined && s) ops.push(setOp(ctx.project, "/floor/" + k, `${s.b}x${h}`));
  }
  return ops;
}

function floorCandidates(ctx, group) {
  const f = ctx.p.floor,
    out = [];
  const deeper = deeperSections(f.section, 2);
  if (deeper[0])
    out.push({
      title: `Лаги перекрытия ${mm(deeper[0])} мм вместо ${mm(f.section)}`,
      ops: floorSectionOps(ctx, deeper[0]),
      dim: "floor.section",
    });
  // Intermediate bearing line under the worst span.
  const level = Math.max(...(group.levels ?? [ctx.p.floors ?? 1]));
  out.push(...bearingLineCandidates(ctx, level));
  if (deeper[1])
    out.push({
      title: `Лаги перекрытия ${mm(deeper[1])} мм вместо ${mm(f.section)}`,
      ops: floorSectionOps(ctx, deeper[1]),
      dim: "floor.section",
    });
  const [spacing] = below(SPACING_LADDER, f.spacing);
  if (spacing)
    out.push({
      title: `Шаг лаг ${spacing} м вместо ${f.spacing}`,
      ops: [setOp(ctx.project, "/floor/spacing", spacing)],
      dim: "floor.spacing",
    });
  out.push({
    title: `Повернуть лаги: направление ${f.axis === "x" ? "y" : "x"} вместо ${f.axis}`,
    ops: [setOp(ctx.project, "/floor/axis", f.axis === "x" ? "y" : "x")],
    dim: "floor.axis",
  });
  const strongest = deeper.at(-1),
    [tight] = below(SPACING_LADDER, Math.min(f.spacing, 0.5));
  if (strongest && tight)
    out.push({
      title: `Лаги ${mm(strongest)} мм с шагом ${tight} м`,
      ops: [...floorSectionOps(ctx, strongest), setOp(ctx.project, "/floor/spacing", tight)],
      dim: "floor.section",
    });
  return out;
}

function bearingLineCandidates(ctx, level) {
  const { p, project } = ctx,
    out = [];
  if (level <= 1) {
    const g = p.foundation?.grillage ?? {},
      current = g.girderSpacing ?? p.foundation?.spacing;
    if (finite(current)) {
      const next = Math.max(0.5, Math.round((current / 2) * 20) / 20);
      if (next < current - EPS)
        out.push({
          title: `Промежуточные прогоны ростверка под лагами: шаг ${next} м вместо ${round(current, 2)}`,
          ops: [setOp(project, "/foundation/grillage/girderSpacing", next)],
          dim: "grillage.girderSpacing",
          sideEffects: ["Добавляет балки ростверка и, возможно, сваи под ними."],
        });
    }
    return out;
  }
  const along = p.floor?.axis === "x" ? "x" : "y",
    across = along === "x" ? "y" : "x";
  const lower = (p.walls ?? []).filter((w) => (w.level ?? 1) === level - 1);
  if (!lower.length) return out;
  const lo = Math.min(...lower.flatMap((w) => [w.a[along], w.b[along]])),
    hi = Math.max(...lower.flatMap((w) => [w.a[along], w.b[along]])),
    mid = (lo + hi) / 2;
  // Walls that run perpendicular to the joists can carry them.
  const supports = lower
    .filter((w) => w.kind === "partition" && Math.abs(w.a[along] - w.b[along]) < 1e-6)
    .sort((a, b) => Math.abs(a.a[along] - mid) - Math.abs(b.a[along] - mid) || (a.id < b.id ? -1 : 1));
  const convert = (w) => {
    const i = wallIndex(project, w.id),
      ops = [setOp(project, `/walls/${i}/kind`, "bearing")];
    for (const k of ["height", "topAttachment", "endpointMode"])
      if (project.walls[i] && Object.hasOwn(project.walls[i], k))
        ops.push({ op: "remove", path: `/walls/${i}/${k}` });
    return ops;
  };
  const line = supports.length ? supports[0].a[along] : null;
  const sameLine = supports.filter((w) => line !== null && Math.abs(w.a[along] - line) < 1e-6);
  if (sameLine.length && sameLine.every((w) => wallIndex(project, w.id) >= 0))
    out.push({
      title: `Сделать несущими перегородки ${sameLine.map((w) => w.id).join(", ")} (${level - 1} этаж) — промежуточная опора лаг ${level} этажа`,
      ops: sameLine.flatMap(convert),
      dim: "floor.bearingLine",
      sideEffects: [
        "Перегородка становится несущей стеной: нагрузка передаётся на нижнее перекрытие и ростверк.",
      ],
    });
  if (!supports.length) {
    const ext = lower.filter((w) => w.kind !== "partition"),
      a0 = Math.min(...ext.flatMap((w) => [w.a[across], w.b[across]])),
      a1 = Math.max(...ext.flatMap((w) => [w.a[across], w.b[across]])),
      pos = Math.round(mid * 100) / 100,
      ref = ext[0] ?? lower[0];
    if (finite(a0) && finite(a1) && a1 - a0 > 0.4) {
      const pt = (u) => (along === "x" ? { x: pos, y: u } : { x: u, y: pos });
      let n = 1;
      while ((project.walls ?? []).some((w) => w.id === `FIX-L${level - 1}-B${n}`)) n++;
      out.push({
        title: `Добавить несущую стену по оси ${along}=${pos} м на ${level - 1} этаже под пролётом лаг`,
        ops: [
          {
            op: "add",
            path: "/walls/-",
            value: {
              id: `FIX-L${level - 1}-B${n}`,
              level: level - 1,
              a: pt(a0),
              b: pt(a1),
              kind: "bearing",
              section: ref.section,
              studStep: ref.studStep ?? 0.6,
            },
          },
        ],
        dim: "floor.bearingLine",
        sideEffects: ["Новая стена меняет планировку нижнего этажа; проверьте помещения и проходы."],
      });
    }
  }
  return out;
}

const bearingWalls = (ctx) =>
  (ctx.project.walls ?? [])
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.kind !== "partition" && parseSection(w.section));

function wallsSectionOps(ctx, list, section) {
  return list.map(({ i }) => setOp(ctx.project, `/walls/${i}/section`, section));
}

function studCandidates(ctx) {
  const list = bearingWalls(ctx),
    out = [];
  if (!list.length) return out;
  const current = list[0].w.section,
    deeper = deeperSections(current, 2),
    step = Math.max(...list.map(({ w }) => w.studStep ?? 0.6));
  if (deeper[0])
    out.push({
      title: `Стойки несущих стен ${mm(deeper[0])} мм вместо ${mm(current)}`,
      ops: wallsSectionOps(ctx, list, deeper[0]),
      dim: "walls.section",
      sideEffects: ["Меняется толщина стен и контур платформы; пересчитываются утепление и смета."],
    });
  const [s] = below(STUD_STEP_LADDER, step);
  if (s)
    out.push({
      title: `Шаг стоек несущих стен ${s} м вместо ${step}`,
      ops: list.map(({ i }) => setOp(ctx.project, `/walls/${i}/studStep`, s)),
      dim: "walls.studStep",
    });
  if (deeper[1])
    out.push({
      title: `Стойки несущих стен ${mm(deeper[1])} мм вместо ${mm(current)}`,
      ops: wallsSectionOps(ctx, list, deeper[1]),
      dim: "walls.section",
      sideEffects: ["Меняется толщина стен и контур платформы; пересчитываются утепление и смета."],
    });
  const restraint = ctx.p.material?.studRestraint;
  if (!finite(restraint) || restraint > 1.2 + EPS)
    out.push({
      title: "Раскрепить слабую ось стоек распорками/обшивкой через 1,2 м (material.studRestraint)",
      ops: [setOp(ctx.project, "/material/studRestraint", 1.2)],
      kind: "assumption",
      dim: "material.studRestraint",
      sideEffects: [
        "Это допущение о раскреплении: распорки или обшивка должны быть фактически установлены и закреплены; в модели досок они не создаются.",
      ],
    });
  return out;
}

function fullWallInput(ctx, analysis) {
  const m = ctx.p.material ?? {},
    l = ctx.p.loads ?? {},
    b = ctx.p.bracing ?? {};
  return {
    wallId: analysis.wallId,
    level: analysis.level,
    studs: analysis.studs.map((s) => ({
      id: s.id,
      length: s.length,
      b: s.b,
      h: s.h,
      wallId: s.wallId,
      level: s.level,
      cutStart: s.cutStart,
      cutEnd: s.cutEnd,
      tributaryWidth: s.tributaryWidth,
      roofForceDesign: s.roofForceDesign,
      roofForceService: s.roofForceService,
    })),
    wind: l.wind ?? 0,
    gammaG: l.gammaG ?? 1.1,
    gammaQ: l.gammaQ ?? 1.4,
    E: m.E ?? 10000,
    Emin: m.Emin,
    Fc: m.Fc ?? 12,
    Ft: m.Ft ?? 8,
    Fb: m.Fb ?? 13,
    Fv: m.Fv ?? 1.5,
    density: m.density ?? 500,
    wallDead:
      (l.wallDead ?? 0.5) +
      (ctx.result.bracingModel?.method === "sheathing"
        ? (((b.thickness ?? 12) / 1000) * (b.sheetDensity ?? 650) * G) / 1000
        : 0),
    deflectionRatio: m.wallDeflectionRatio ?? 200,
    K: m.columnK ?? 1,
  };
}

function fullWallCandidates(ctx, group) {
  const i = wallIndex(ctx.project, group.wallId),
    wall = ctx.project.walls?.[i],
    out = [];
  if (!wall) return out;
  const current = wall.section,
    cur = parseSection(current);
  const analysis = (ctx.result.fullHeightWalls?.walls ?? []).find(
    (w) => w.wallId === group.wallId && (w.level ?? 1) === group.level && w.studs?.length,
  );
  let screened = null;
  if (analysis && cur) {
    // Screening with the library selector, then verified by a full evaluation below.
    const catalog = boards.filter((q) => q.h > cur.h && q.b >= cur.b).map((q) => q.id),
      res = evaluateWallSectionCandidates(fullWallInput(ctx, analysis), catalog);
    screened = res.recommended?.section ?? res.candidates.at(-1)?.section ?? null;
    if (screened)
      out.push({
        title: `Стойки стены ${group.wallId} ${mm(screened)} мм (подбор по цельной высоте)`,
        ops: [setOp(ctx.project, `/walls/${i}/section`, screened)],
        dim: "walls.section",
        screening: { method: "evaluateWallSectionCandidates", recommended: res.recommended?.section ?? null },
      });
  }
  for (const s of deeperSections(current, 2))
    if (s !== screened)
      out.push({
        title: `Стойки стены ${group.wallId} ${mm(s)} мм вместо ${mm(current)}`,
        ops: [setOp(ctx.project, `/walls/${i}/section`, s)],
        dim: "walls.section",
      });
  const [step] = below(STUD_STEP_LADDER, wall.studStep ?? 0.6);
  if (step)
    out.push({
      title: `Шаг стоек стены ${group.wallId} ${step} м вместо ${wall.studStep ?? 0.6}`,
      ops: [setOp(ctx.project, `/walls/${i}/studStep`, step)],
      dim: "walls.studStep",
    });
  return out;
}

function roofTarget(ctx, zoneId) {
  const zones = ctx.project.roof?.zones,
    zi = Array.isArray(zones) && zoneId ? zones.findIndex((z) => z.id === zoneId) : -1,
    base = zi >= 0 ? `/roof/zones/${zi}` : "/roof",
    source = zi >= 0 ? zones[zi] : (ctx.p.roof ?? {}),
    model = (ctx.result.roofModel?.zones ?? []).find((z) => z.id === zoneId) ?? null;
  return { base, source, model, explicit: zi >= 0 };
}

function roofCandidates(ctx, group) {
  const { base, source, model, explicit } = roofTarget(ctx, group.zoneId),
    out = [],
    chord = source.chordSection ?? model?.chordSection,
    spacing = source.spacing ?? model?.spacing ?? ctx.p.roof?.spacing ?? 0.6,
    maxSpacing = explicit ? 3 : 1.5;
  if (!chord) return out;
  const cur = parseSection(chord);
  const input = model?.rafterAnalysis?.input;
  if (input && cur) {
    // Rafters: library selector screens the catalog, full evaluation verifies it.
    const catalog = boards.filter((q) => q.h > cur.h || (q.h === cur.h && q.b > cur.b)).map((q) => q.id),
      res = evaluateRafterCandidates(input, catalog),
      pick = res.recommended?.section ?? res.candidates.sort((a, b) => b.h - a.h || b.b - a.b)[0]?.section;
    if (pick)
      out.push({
        title: `Стропила ${mm(pick)} мм вместо ${mm(chord)}${res.recommended ? " (подбор по изгибу, сдвигу и прогибу)" : " (максимальное из каталога)"}`,
        ops: [setOp(ctx.project, base + "/chordSection", pick)],
        dim: "roof.chordSection",
        screening: {
          method: "evaluateRafterCandidates",
          recommended: res.recommended?.section ?? null,
          utilization: round(res.recommended?.utilization ?? null),
        },
      });
    const steps = below(SPACING_LADDER, Math.min(spacing, maxSpacing), 3);
    const passing = steps.find(
      (s) => evaluateRafterCandidates({ ...input, spacing: s }, [chord]).anyAcceptable,
    );
    const s = passing ?? steps.at(-1);
    if (s)
      out.push({
        title: `Шаг стропил ${s} м вместо ${spacing}`,
        ops: [setOp(ctx.project, base + "/spacing", s)],
        dim: "roof.spacing",
      });
    if ((source.framing ?? ctx.p.roof?.framing) === "rafters")
      out.push({
        title: "Автоподбор несущей схемы кровли (framing=auto: сечение стропил или ферма)",
        ops: [setOp(ctx.project, base + "/framing", "auto")],
        dim: "roof.framing",
      });
    return out;
  }
  const deeper = deeperSections(chord, 2);
  if (deeper[0])
    out.push({
      title: `Пояса ферм/стропила ${mm(deeper[0])} мм вместо ${mm(chord)}`,
      ops: [setOp(ctx.project, base + "/chordSection", deeper[0])],
      dim: "roof.chordSection",
    });
  const [s] = below(SPACING_LADDER, Math.min(spacing, maxSpacing));
  if (s)
    out.push({
      title: `Шаг ферм/стропил ${s} м вместо ${spacing}`,
      ops: [setOp(ctx.project, base + "/spacing", s)],
      dim: "roof.spacing",
    });
  const web = source.webSection ?? model?.webSection,
    [deeperWeb] = web ? deeperSections(web, 1) : [];
  if (deeperWeb)
    out.push({
      title: `Решётка ферм ${mm(deeperWeb)} мм вместо ${mm(web)}`,
      ops: [setOp(ctx.project, base + "/webSection", deeperWeb)],
      dim: "roof.webSection",
    });
  if (deeper[1])
    out.push({
      title: `Пояса ферм/стропила ${mm(deeper[1])} мм вместо ${mm(chord)}`,
      ops: [setOp(ctx.project, base + "/chordSection", deeper[1])],
      dim: "roof.chordSection",
    });
  const type = ctx.p.roof?.type;
  if (TRUSS_TYPES.includes(type))
    for (const t of TRUSS_TYPES.filter((t) => t !== type))
      out.push({
        title: `Тип фермы ${t} вместо ${type}`,
        ops: [setOp(ctx.project, "/roof/type", t)],
        dim: "roof.type",
      });
  return out;
}

function pileCandidates(ctx) {
  const f = ctx.p.foundation ?? {},
    out = [],
    [s1, s2] = below(PILE_SPACING_LADDER, f.spacing, 2);
  if (s1)
    out.push({
      title: `Шаг свай ${s1} м вместо ${f.spacing}`,
      ops: [setOp(ctx.project, "/foundation/spacing", s1)],
      dim: "foundation.spacing",
    });
  const plies = f.grillage?.plies;
  if (Number.isInteger(plies) && plies < 6)
    out.push({
      title: `Ростверк из ${plies + 1} досок в пакете вместо ${plies} (распределение на сваи)`,
      ops: [setOp(ctx.project, "/foundation/grillage/plies", plies + 1)],
      dim: "grillage.plies",
    });
  if (s2)
    out.push({
      title: `Шаг свай ${s2} м вместо ${f.spacing}`,
      ops: [setOp(ctx.project, "/foundation/spacing", s2)],
      dim: "foundation.spacing",
    });
  const [cap] = above(PILE_CAPACITY_LADDER, f.capacity ?? 0);
  if (cap)
    out.push({
      title: `Сваи с несущей способностью ${cap} кН вместо ${f.capacity} (другой тип/длина сваи)`,
      ops: [setOp(ctx.project, "/foundation/capacity", cap)],
      kind: "assumption",
      dim: "foundation.capacity",
      sideEffects: [
        "Меняет принятую несущую способность сваи: нужен конкретный тип сваи и подтверждение изысканиями (karkas_compare_foundations).",
      ],
    });
  return out;
}

function grillageCandidates(ctx) {
  const g = ctx.p.foundation?.grillage ?? {},
    out = [];
  if (Number.isInteger(g.plies) && g.plies < 6)
    out.push({
      title: `Ростверк из ${g.plies + 1} досок в пакете вместо ${g.plies}`,
      ops: [setOp(ctx.project, "/foundation/grillage/plies", g.plies + 1)],
      dim: "grillage.plies",
    });
  const [deeper] = deeperSections(g.section, 1);
  if (deeper)
    out.push({
      title: `Доски ростверка ${mm(deeper)} мм вместо ${mm(g.section)}`,
      ops: [setOp(ctx.project, "/foundation/grillage/section", deeper)],
      dim: "grillage.section",
    });
  const [s] = below(PILE_SPACING_LADDER, ctx.p.foundation?.spacing ?? 2);
  if (s)
    out.push({
      title: `Шаг свай ${s} м вместо ${ctx.p.foundation?.spacing} (короче пролёты ростверка)`,
      ops: [setOp(ctx.project, "/foundation/spacing", s)],
      dim: "foundation.spacing",
    });
  if (Number.isInteger(g.plies) && g.plies < 5)
    out.push({
      title: `Ростверк из ${g.plies + 2} досок в пакете вместо ${g.plies}`,
      ops: [setOp(ctx.project, "/foundation/grillage/plies", g.plies + 2)],
      dim: "grillage.plies",
    });
  return out;
}

function bracingCandidates(ctx) {
  const b = ctx.p.bracing ?? {},
    out = [];
  if (b.method !== "sheathing")
    out.push({
      title:
        "Жёсткость стен обшивкой листами вместо " +
        (b.method === "letIn" ? "врезных раскосов" : "отсутствующей"),
      ops: [setOp(ctx.project, "/bracing/method", "sheathing")],
      dim: "bracing.method",
    });
  const [t] = above(SHEET_THICKNESS_LADDER, b.thickness ?? 12);
  if (t)
    out.push({
      title: `Обшивка толщиной ${t} мм вместо ${b.thickness ?? 12}`,
      ops: [setOp(ctx.project, "/bracing/thickness", t)],
      dim: "bracing.thickness",
    });
  const [n] = below(NAIL_SPACING_LADDER, b.edgeNailSpacing ?? 150);
  if (n)
    out.push({
      title: `Шаг крепежа по кромкам листов ${n} мм вместо ${b.edgeNailSpacing ?? 150}`,
      ops: [setOp(ctx.project, "/bracing/edgeNailSpacing", n)],
      dim: "bracing.edgeNailSpacing",
    });
  return out;
}

/* ------------------------------------------------------------------ */
/* Evaluation plumbing                                                  */
/* ------------------------------------------------------------------ */

function makeEvaluator(maxEvaluations) {
  let count = 0;
  const cache = new Map();
  return {
    get count() {
      return count;
    },
    get exhausted() {
      return count >= maxEvaluations;
    },
    /** Apply ops to `project`, evaluate, and return {project, planning, report, metrics} or {error}. */
    run(project, planning, ops) {
      const key = JSON.stringify([project, ops]);
      if (cache.has(key)) return cache.get(key);
      if (count >= maxEvaluations) return { skipped: true };
      count++;
      let out;
      try {
        const next = applyProjectPatch(project, ops),
          nextPlanning = planningAfterPatch(planning, ops),
          report = evaluateHouse(next, nextPlanning);
        out = { project: next, planning: nextPlanning, report, metrics: evaluationMetrics(report) };
      } catch (e) {
        out = { error: { code: e.code ?? "INVALID_VARIANT", message: e.message } };
      }
      cache.set(key, out);
      return out;
    },
  };
}

function compactCheck(c) {
  if (!c) return { status: "absent", utilization: null, severity: 0 };
  return {
    status: c.status,
    utilization: round(checkUtilization(c), 4),
    value: round(c.value, 4),
    limit: round(c.limit, 4),
    severity: round(checkSeverity(c), 4),
  };
}

function targetChecks(report, { includeWarnings = false, warningThreshold = 0.9, checkIds } = {}) {
  const only = Array.isArray(checkIds) && checkIds.length ? new Set(checkIds) : null;
  return [...indexChecks(report.result?.checks ?? []).values()].filter(
    (c) =>
      (!only || only.has(c.id)) &&
      !DERIVED_CHECKS.has(c.id) &&
      (c.status === "fail" ||
        (includeWarnings &&
          c.status === "warning" &&
          finite(c.utilization) &&
          c.utilization > warningThreshold)),
  );
}

function buildGroups(ctx, targets) {
  const groups = new Map(),
    unmatched = [];
  for (const c of targets) {
    const rule = RULES.find((r) => r.match(c));
    if (!rule) {
      unmatched.push(c.id);
      continue;
    }
    const g = rule.group(c, ctx),
      prior = groups.get(g.key);
    if (prior) {
      prior.checks.push(c);
      if (g.levels) prior.levels = [...new Set([...(prior.levels ?? []), ...g.levels])];
    } else groups.set(g.key, { ...g, rule, checks: [c] });
  }
  for (const g of groups.values()) {
    g.checks.sort((a, b) => checkSeverity(b) - checkSeverity(a) || (a.id < b.id ? -1 : 1));
    g.worst = g.checks[0];
  }
  const ordered = [...groups.values()].sort(
    (a, b) => checkSeverity(b.worst) - checkSeverity(a.worst) || (a.key < b.key ? -1 : 1),
  );
  return { groups: ordered, unmatched };
}

function groupCandidates(ctx, group, { blocked, allowAssumptions = true, limit = 4 }) {
  const seen = new Set(),
    out = [];
  let raw = [];
  try {
    raw = group.rule.candidates(ctx, group);
  } catch {
    // A rule that cannot read an unusual result shape proposes nothing instead of failing the call.
    raw = [];
  }
  for (const c of raw) {
    if (!c?.ops?.length) continue;
    if (!allowAssumptions && c.kind === "assumption") continue;
    if (c.ops.some((o) => blocked(o.path))) continue;
    const key = JSON.stringify(c.ops);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "structural", sideEffects: [], ...c });
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* proposeFixes                                                         */
/* ------------------------------------------------------------------ */

/**
 * Propose verified JSON-Patch fixes for failed (and optionally near-limit) checks.
 * @param project   source project (the one a patch will be applied to)
 * @param evaluation report from evaluateHouse/engine.analyze for that project, or null
 * @param opts {planning, maxEvaluations=24, perGroup=4, perCheck=3, includeWarnings=false,
 *              warningThreshold=0.9, checkIds, keep:[json pointers], allowAssumptions=true}
 */
export function proposeFixes(project, evaluation = null, opts = {}) {
  const planning = opts.planning ?? {},
    maxEvaluations = Math.max(0, Math.min(200, opts.maxEvaluations ?? 24)),
    perGroup = Math.max(1, Math.min(8, opts.perGroup ?? 5)),
    perCheck = Math.max(1, Math.min(10, opts.perCheck ?? 3));
  const report = evaluation ?? evaluateHouse(project, planning),
    baseline = evaluationMetrics(report),
    baseChecks = indexChecks(report.result?.checks ?? []),
    baseFailed = new Set([...baseChecks.values()].filter((c) => c.status === "fail").map((c) => c.id));
  const ctx = { project, p: report.project ?? project, result: report.result ?? {} },
    blocked = keepMatcher(opts.keep),
    targets = targetChecks(report, opts),
    { groups, unmatched } = buildGroups(ctx, targets),
    evaluator = makeEvaluator(maxEvaluations);
  const queues = groups.map((g) => ({
    group: g,
    items: groupCandidates(ctx, g, {
      blocked,
      allowAssumptions: opts.allowAssumptions ?? true,
      limit: perGroup,
    }),
  }));
  const rejected = [],
    fixes = [];
  let attempted = 0;
  // Round-robin across groups so every failing member group gets evaluations.
  for (let round_ = 0; round_ < perGroup && !evaluator.exhausted; round_++)
    for (const q of queues) {
      const cand = q.items[round_];
      if (!cand || evaluator.exhausted) continue;
      attempted++;
      const res = evaluator.run(project, planning, cand.ops);
      if (res.skipped) continue;
      if (res.error) {
        rejected.push({ title: cand.title, patch: cand.ops, reason: res.error.message });
        continue;
      }
      const after = indexChecks(res.report.result?.checks ?? []),
        improved = q.group.checks.filter((c) => checkSeverity(after.get(c.id)) < checkSeverity(c) - 1e-6);
      if (!improved.length) {
        rejected.push({
          title: cand.title,
          patch: cand.ops,
          reason: "Не снижает загрузку целевой проверки.",
        });
        continue;
      }
      const target = improved[0],
        afterTarget = after.get(target.id),
        fixesTarget = afterTarget
          ? afterTarget.status !== "fail" &&
            (target.status === "fail" || !(afterTarget.utilization > (opts.warningThreshold ?? 0.9)))
          : true;
      const nowFailed = [...after.values()].filter((c) => c.status === "fail"),
        newFailed = nowFailed.filter((c) => !baseFailed.has(c.id)),
        resolved = [...baseFailed].filter((id) => after.get(id)?.status !== "fail");
      const worsened = [...after.values()]
        .filter((c) => {
          const b = baseChecks.get(c.id);
          return (
            b &&
            c.status !== "fail" &&
            finite(c.utilization) &&
            finite(b.utilization) &&
            c.utilization > b.utilization + 0.05
          );
        })
        .sort((a, b) => b.utilization - a.utilization)
        .slice(0, 3);
      const m = res.metrics,
        sideEffects = [
          ...(cand.sideEffects ?? []),
          ...newFailed.slice(0, 5).map((c) => `Новая невыполненная проверка: ${c.label ?? c.id}`),
          ...worsened.map(
            (c) =>
              `Растёт загрузка «${c.label ?? c.id}»: ${round(baseChecks.get(c.id).utilization, 2)} → ${round(c.utilization, 2)}`,
          ),
        ];
      if (m.unplaced !== baseline.unplaced)
        sideEffects.push(`Деталей длиннее заготовки: ${baseline.unplaced} → ${m.unplaced}`);
      fixes.push({
        title: cand.title,
        kind: cand.kind,
        group: q.group.key,
        patch: cand.ops,
        targetCheckId: target.id,
        targetLabel: target.label ?? target.id,
        improvedCheckIds: improved.map((c) => c.id),
        before: compactCheck(target),
        after: compactCheck(afterTarget),
        fixesTarget,
        newFailedChecks: newFailed.map((c) => c.id),
        resolvedChecks: resolved,
        failedDelta: m.failedChecks - baseline.failedChecks,
        excessDelta: round(m.excessUtilization - baseline.excessUtilization, 4),
        costDelta: round(m.estimateTotal - baseline.estimateTotal, 2),
        massDelta: round((res.report.summary?.timberMass ?? 0) - (report.summary?.timberMass ?? 0), 1),
        metrics: m,
        sideEffects,
        verified: true,
        ...(cand.screening ? { screening: cand.screening } : {}),
      });
    }
  fixes.sort(
    (a, b) =>
      Number(b.fixesTarget) - Number(a.fixesTarget) ||
      Number(a.newFailedChecks.length === 0 ? 0 : 1) - Number(b.newFailedChecks.length === 0 ? 0 : 1) ||
      Number(a.kind === "assumption") - Number(b.kind === "assumption") ||
      a.costDelta - b.costDelta ||
      a.after.severity - b.after.severity ||
      (a.title < b.title ? -1 : 1),
  );
  fixes.forEach((f, i) => (f.id = "fix-" + (i + 1)));
  const byCheck = {};
  for (const c of targets) {
    const list = fixes.filter((f) => f.improvedCheckIds.includes(c.id)).slice(0, perCheck);
    byCheck[c.id] = list.map((f) => f.id);
  }
  return {
    baseline,
    targets: targets.map((c) => ({
      checkId: c.id,
      label: c.label ?? c.id,
      ...compactCheck(c),
      group: groups.find((g) => g.checks.includes(c))?.key ?? null,
    })),
    fixes,
    byCheck,
    unmatched,
    rejected,
    evaluations: evaluator.count,
    budgetExhausted: attempted < queues.reduce((s, q) => s + q.items.length, 0),
    method:
      "Rule table per member group; every candidate patch was applied to a copy and the full house re-evaluated. Sorted by: fixes target, no new failed checks, structural before assumption, cost delta.",
    certified: false,
  };
}

/* ------------------------------------------------------------------ */
/* optimize                                                             */
/* ------------------------------------------------------------------ */

/** One-step-cheaper moves per member dimension for the cost phase. */
function downsizeMoves(ctx) {
  const { p, project } = ctx,
    out = [],
    f = p.floor ?? {};
  const fs = shallowerSection(f.section, 150);
  if (fs) out.push({ dim: "floor.section", title: `Лаги ${mm(fs)} мм`, ops: floorSectionOps(ctx, fs) });
  const [fsp] = above(SPACING_LADDER, f.spacing, 0.6);
  if (fsp)
    out.push({
      dim: "floor.spacing",
      title: `Шаг лаг ${fsp} м`,
      ops: [setOp(project, "/floor/spacing", fsp)],
    });
  const list = bearingWalls(ctx);
  if (list.length && list.every(({ w }) => w.section === list[0].w.section)) {
    // Exterior wall depth also carries insulation: never thinner than the source project.
    const originalH = Math.min(
        ...bearingWalls({ project: ctx.original ?? project }).map(({ w }) => parseSection(w.section).h),
      ),
      ws = shallowerSection(list[0].w.section, Math.max(100, finite(originalH) ? originalH : 100));
    if (ws)
      out.push({ dim: "walls.section", title: `Стойки ${mm(ws)} мм`, ops: wallsSectionOps(ctx, list, ws) });
  }
  if (list.length) {
    const step = Math.min(...list.map(({ w }) => w.studStep ?? 0.6)),
      [next] = above(STUD_STEP_LADDER, step, 0.6);
    if (next)
      out.push({
        dim: "walls.studStep",
        title: `Шаг стоек ${next} м`,
        ops: list.map(({ i }) => setOp(project, `/walls/${i}/studStep`, next)),
      });
  }
  const zones = Array.isArray(project.roof?.zones)
    ? project.roof.zones.map((z, i) => [z, `/roof/zones/${i}`])
    : [];
  for (const [src, base] of zones.length ? zones : [[p.roof ?? {}, "/roof"]]) {
    if (!src.chordSection) continue;
    const rs = shallowerSection(src.chordSection, 100);
    if (rs)
      out.push({
        dim: "roof.chordSection",
        title: `Пояса/стропила ${mm(rs)} мм`,
        ops: [setOp(project, base + "/chordSection", rs)],
      });
    const [rsp] = above(SPACING_LADDER, src.spacing ?? 0.6, 0.6);
    if (rsp)
      out.push({
        dim: "roof.spacing",
        title: `Шаг стропил/ферм ${rsp} м`,
        ops: [setOp(project, base + "/spacing", rsp)],
      });
  }
  const g = p.foundation?.grillage ?? {};
  if (Number.isInteger(g.plies) && g.plies > 2)
    out.push({
      dim: "grillage.plies",
      title: `Ростверк ${g.plies - 1} доски`,
      ops: [setOp(project, "/foundation/grillage/plies", g.plies - 1)],
    });
  const gs = shallowerSection(g.section, 150);
  if (gs)
    out.push({
      dim: "grillage.section",
      title: `Ростверк ${mm(gs)} мм`,
      ops: [setOp(project, "/foundation/grillage/section", gs)],
    });
  const [ps] = above(PILE_SPACING_LADDER, p.foundation?.spacing ?? 2, 3);
  if (ps)
    out.push({
      dim: "foundation.spacing",
      title: `Шаг свай ${ps} м`,
      ops: [setOp(project, "/foundation/spacing", ps)],
    });
  return out.map((m) => ({ kind: "structural", ...m }));
}

/** Collapse a sequential patch: drop earlier replace/add on a path later replaced again. */
function compactPatch(ops) {
  const out = [];
  for (const op of ops) {
    if (op.op === "replace" || (op.op === "add" && !op.path.endsWith("/-"))) {
      const j = out.findIndex((o) => o.path === op.path && (o.op === "replace" || o.op === "add"));
      if (j >= 0) {
        const kept = out[j].op === "add" ? "add" : "replace";
        out.splice(j, 1);
        out.push({ ...op, op: kept });
        continue;
      }
    }
    out.push(op);
  }
  return out;
}

const metricsView = (m) => ({
  failedChecks: m.failedChecks,
  excessUtilization: m.excessUtilization,
  maxUtilization: m.maxUtilization,
  unplaced: m.unplaced,
  estimateTotal: round(m.estimateTotal, 2),
});

/**
 * Deterministic greedy / coordinate-descent search: first remove failed checks
 * (objective: failed count, Σ max(0,u−1), unplaced, cost), then try one-step
 * cheaper member dimensions while keeping the failed count and excess.
 * @param opts {planning, evaluation, maxEvaluations=40, maxSteps=12, maxCost, keep, allowAssumptions=false, costPhase=true}
 */
export function optimize(project, opts = {}) {
  const maxEvaluations = Math.max(1, Math.min(300, opts.maxEvaluations ?? 40)),
    maxSteps = Math.max(1, Math.min(50, opts.maxSteps ?? 12)),
    blocked = keepMatcher(opts.keep),
    evaluator = makeEvaluator(maxEvaluations);
  const baseReport = opts.evaluation ?? evaluateHouse(project, opts.planning ?? {});
  let state = {
    project: clone(project),
    planning: opts.planning ?? {},
    report: baseReport,
    metrics: evaluationMetrics(baseReport),
  };
  const baseline = state.metrics,
    applied = [],
    trace = [],
    touched = new Set();
  let stopReason = null;
  // Phase 1: repair.
  while (state.metrics.failedChecks > 0 && trace.length < maxSteps) {
    if (evaluator.exhausted) {
      stopReason = "budget";
      break;
    }
    const ctx = {
        project: state.project,
        p: state.report.project ?? state.project,
        result: state.report.result ?? {},
      },
      { groups } = buildGroups(ctx, targetChecks(state.report));
    let best = null;
    for (const g of groups) {
      for (const cand of groupCandidates(ctx, g, {
        blocked,
        allowAssumptions: opts.allowAssumptions ?? false,
        limit: opts.perGroup ?? 4,
      })) {
        const res = evaluator.run(state.project, state.planning, cand.ops);
        if (res.skipped || res.error) continue;
        if (compareMetrics(res.metrics, state.metrics) >= 0) continue;
        if (!best || compareMetrics(res.metrics, best.res.metrics) < 0) best = { cand, res, group: g };
      }
      if (best) break; // coordinate descent: fix the worst improvable group first
      if (evaluator.exhausted) break;
    }
    if (!best) {
      stopReason = evaluator.exhausted ? "budget" : "no-improving-move";
      break;
    }
    trace.push({
      step: trace.length + 1,
      phase: "repair",
      title: best.cand.title,
      group: best.group.key,
      targetCheckId: best.group.worst.id,
      patch: best.cand.ops,
      before: metricsView(state.metrics),
      after: metricsView(best.res.metrics),
    });
    applied.push(...best.cand.ops);
    touched.add(best.cand.dim);
    state = {
      project: best.res.project,
      planning: best.res.planning,
      report: best.res.report,
      metrics: best.res.metrics,
    };
  }
  // Phase 2: cheapen while keeping the safety objective.
  if (opts.costPhase !== false && !evaluator.exhausted) {
    const rejectedMoves = new Set();
    for (let accepted = true, n = 0; accepted && !evaluator.exhausted && n < maxSteps * 2; n++) {
      accepted = false;
      const ctx = {
          project: state.project,
          p: state.report.project ?? state.project,
          result: state.report.result ?? {},
          original: project,
        },
        moves = downsizeMoves(ctx)
          .filter((m) => !m.ops.some((o) => blocked(o.path)))
          .sort((a, b) => Number(touched.has(b.dim)) - Number(touched.has(a.dim)));
      for (const move of moves) {
        if (evaluator.exhausted) break;
        const moveKey = JSON.stringify(move.ops);
        if (rejectedMoves.has(moveKey)) continue;
        const res = evaluator.run(state.project, state.planning, move.ops);
        if (res.skipped) continue;
        if (res.error) {
          rejectedMoves.add(moveKey);
          continue;
        }
        const m = res.metrics,
          s = state.metrics;
        if (
          m.failedChecks <= s.failedChecks &&
          m.excessUtilization <= s.excessUtilization + 1e-6 &&
          m.unplaced <= s.unplaced &&
          m.estimateTotal < s.estimateTotal - 0.5
        ) {
          trace.push({
            step: trace.length + 1,
            phase: "cost",
            title: move.title,
            group: move.dim,
            patch: move.ops,
            before: metricsView(s),
            after: metricsView(m),
          });
          applied.push(...move.ops);
          state = { project: res.project, planning: res.planning, report: res.report, metrics: m };
          accepted = true;
          break; // regenerate moves from the new state
        }
        rejectedMoves.add(moveKey);
      }
    }
  }
  const patch = compactPatch(applied);
  let verified = true;
  if (patch.length)
    try {
      verified = JSON.stringify(applyProjectPatch(project, patch)) === JSON.stringify(state.project);
    } catch {
      verified = false;
    }
  const final = state.metrics,
    remaining = (state.report.result?.checks ?? [])
      .filter((c) => c.status === "fail")
      .map((c) => ({ checkId: c.id, label: c.label ?? c.id, utilization: round(checkUtilization(c), 4) }));
  const maxCost = finite(opts.maxCost) ? opts.maxCost : null;
  return {
    status:
      final.failedChecks === 0
        ? baseline.failedChecks === 0 && !patch.length
          ? "unchanged"
          : "solved"
        : compareMetrics(final, baseline) < 0
          ? "improved"
          : "unchanged",
    patch,
    verified,
    baseline: metricsView(baseline),
    final: {
      ...metricsView(final),
      summary: {
        status: state.report.summary?.status,
        boards: state.report.summary?.boards,
        timberVolume: state.report.summary?.timberVolume,
        timberMass: state.report.summary?.timberMass,
        piles: state.report.summary?.piles,
        currency: state.report.summary?.currency,
      },
    },
    costDelta: round(final.estimateTotal - baseline.estimateTotal, 2),
    goals: {
      maxCost,
      withinMaxCost: maxCost === null ? null : final.estimateTotal <= maxCost + EPS,
      keep: Array.isArray(opts.keep) ? opts.keep : [],
    },
    trace,
    remainingFailed: remaining,
    evaluations: evaluator.count,
    stopReason: stopReason ?? (final.failedChecks === 0 ? "no-failed-checks" : "max-steps"),
    method:
      "Deterministic coordinate descent over member groups (floor, studs, tall walls, roof zones, piles, grillage, bracing). Objective: failed checks, Σ max(0,u−1), unplaced parts, cost. Assumption-type changes (pile capacity, stud restraint) are excluded unless allowAssumptions. Not a global optimum and not a certification.",
    certified: false,
  };
}

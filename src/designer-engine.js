import {
  classifySection,
  projectSections,
  resolveDressedProject,
  lumberAssumptions,
} from "./lumber-standards.js";
import { validateInsulation } from "./insulation.js";
import { isBeamWall, wallFrameSection, resolveBeam } from "./profiled-beam-catalog.js";
import { buildProfiledBeam, validateBeamWalls, beamOpeningEnvelope } from "./profiled-beam.js";
import { analyzeProfiledBeam } from "./profiled-beam-mechanics.js";
import { validateSourceRoofModel } from "./source-roof.js";
import { buildAuxiliaryTimber } from "./auxiliary-timber.js";
import { buildAnnexes, validateAnnexes, sharedAnnexGrillageLines } from "./annexes.js";
import { buildSpatialLayout, validateSpatialLayoutInput } from "./spatial-layout.js";
import { buildFloorOpenings } from "./floor-openings.js";
import { prepareFloorContours } from "./floor-platform-contour.js";
import { buildFloorPlatform } from "./floor-platform.js";
import { attachFloorWallLoads } from "./floor-wall-loads.js";
import { resolvePartitionHeads } from "./partition-heads.js";
import { buildGrillage, validateGrillageExtensions } from "./grillage.js";
import { analyzeGrillageLoads } from "./grillage-loads.js";
import { buildWallBracing } from "./wall-bracing.js";
import { wallProfileTop } from "./wall-profiles.js";
import { checkFullHeightWalls } from "./wall-stability.js";
import { wallPlateEnds } from "./wall-plate-joints.js";
import {
  LOAD_PROFILES,
  TERRAIN_TYPES,
  loadFactors,
  loadProfile,
  snowBasis,
  snowShapeMu,
  governingCombination,
  basicCombinations,
  combineDesign,
  kindFactor,
  windStoreyForces,
  roofUpliftCases,
  profileAssumptions,
  memberLoadProject,
} from "./load-profile.js";
/** КАРКАС Designer — geometric concept model, not a code-design or FEA solver.
 * Plan coordinates and lengths: m. Sections: mm. Mass: kg. Forces: kN.
 * Wall coordinates are axes; areas are gross areas enclosed by exterior axes.
 */
const G = 9.80665,
  EPS = 1e-7;
const clone = (x) => JSON.parse(JSON.stringify(x));
const sum = (a) => a.reduce((s, x) => s + x, 0);
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const point = (p) => object(p) && finite(p.x) && finite(p.y);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const coord = (x) => Math.round(x * 1e6) / 1e6;
const nodeKey = (p) => `${coord(p.x)}_${coord(p.y)}`;
const sections = /^(\d{2,3})[x×](\d{2,3})$/;
export function parseSection(value) {
  const m = typeof value === "string" && value.replaceAll(" ", "").match(sections);
  if (!m) return null;
  const b = Number(m[1]),
    h = Number(m[2]);
  return b >= 15 && b <= 300 && h >= b && h <= 600 ? { b, h } : null;
}
export const defaultDesignerProject = {
  bracing: {
    method: "sheathing",
    section: "25x100",
    sheetWidth: 1.25,
    sheetHeight: 2.5,
    thickness: 12,
    sheetDensity: 650,
    edgeNailSpacing: 150,
    fieldNailSpacing: 300,
    designShear: null,
  },
  version: 2,
  name: "Сканди · свободный план",
  height: 2.8,
  floors: 1,
  grid: 0.25,
  walls: [
    {
      id: "w-north",
      a: { x: 0, y: 0 },
      b: { x: 12, y: 0 },
      kind: "exterior",
      section: "50x150",
      studStep: 0.6,
    },
    {
      id: "w-east",
      a: { x: 12, y: 0 },
      b: { x: 12, y: 8 },
      kind: "exterior",
      section: "50x150",
      studStep: 0.6,
    },
    {
      id: "w-south",
      a: { x: 12, y: 8 },
      b: { x: 0, y: 8 },
      kind: "exterior",
      section: "50x150",
      studStep: 0.6,
    },
    {
      id: "w-west",
      a: { x: 0, y: 8 },
      b: { x: 0, y: 0 },
      kind: "exterior",
      section: "50x150",
      studStep: 0.6,
    },
    {
      id: "w-inner",
      a: { x: 0, y: 4 },
      b: { x: 12, y: 4 },
      kind: "bearing",
      section: "50x150",
      studStep: 0.6,
    },
  ],
  openings: [
    { id: "o1", wallId: "w-north", offset: 1.2, width: 1.8, height: 1.5, sill: 0.8, type: "window" },
    { id: "o2", wallId: "w-north", offset: 7.2, width: 2.4, height: 2.2, sill: 0, type: "window" },
    { id: "o3", wallId: "w-south", offset: 8.2, width: 1.8, height: 1.5, sill: 0.8, type: "window" },
    { id: "o4", wallId: "w-south", offset: 2.6, width: 1, height: 2.1, sill: 0, type: "door" },
    { id: "o5", wallId: "w-west", offset: 3.5, width: 1.5, height: 1.5, sill: 0.8, type: "window" },
    { id: "o6", wallId: "w-east", offset: 3, width: 1.5, height: 1.5, sill: 0.8, type: "window" },
  ],
  roof: { type: "fink", pitch: 25, spacing: 0.6, chordSection: "50x150", webSection: "50x100" },
  floor: {
    section: "50x250",
    spacing: 0.6,
    axis: "y",
    rimSection: null,
    blocking: true,
    blockingSection: null,
    blockingStep: 1.2,
  },
  material: { density: 500, E: 10000, Fb: 13, Ft: 8, Fc: 12 },
  loads: {
    floorDead: 0.6,
    live: 1.5,
    roofDead: 0.5,
    wallDead: 0.5,
    openingDead: 0.3,
    snow: 1.5,
    wind: 0.3,
    terrain: "B",
  },
  foundation: {
    spacing: 2,
    capacity: 40,
    grillage: { section: "50x200", plies: 3, deflectionRatio: 300, capSize: 250 },
  },
  joints: {
    defaultCorner: "california2",
    defaultCut: "butt",
    overrides: {},
    spliceScheme: "halfLap",
    spliceLength: 0.4,
  },
  cutting: { stockLength: 6, kerf: 3, minReusable: 0.3 },
  objects: [],
  boardCuts: {},
  levels: [],
  voids: [],
  annexes: [],
  // The estimate module supplies illustrative editable defaults. Empty here so
  // geometry defaults cannot silently overwrite its current pricing schema.
  prices: {},
};

function normalized(input) {
  return {
    ...input,
    // Reuse existing frame defaults for roof extensions above beam walls, reported by profiled-beam.js.
    walls: Array.isArray(input?.walls)
      ? input.walls.map((w) =>
          isBeamWall(w)
            ? {
                ...w,
                section: w.section ?? defaultDesignerProject.walls[0].section,
                studStep: w.studStep ?? defaultDesignerProject.walls[0].studStep,
              }
            : w,
        )
      : input?.walls,
    annexes: input?.annexes === undefined ? [] : input.annexes,
    foundation: object(input?.foundation)
      ? {
          ...input.foundation,
          grillage:
            input.foundation.grillage === undefined
              ? { ...defaultDesignerProject.foundation.grillage }
              : object(input.foundation.grillage)
                ? { ...defaultDesignerProject.foundation.grillage, ...input.foundation.grillage }
                : input.foundation.grillage,
        }
      : input?.foundation,
    bracing:
      input?.bracing === undefined
        ? { ...defaultDesignerProject.bracing }
        : object(input.bracing)
          ? { ...defaultDesignerProject.bracing, ...input.bracing }
          : input.bracing,
    floor:
      input?.floor === undefined
        ? { ...defaultDesignerProject.floor }
        : object(input.floor)
          ? { ...defaultDesignerProject.floor, ...input.floor }
          : input.floor,
    cutting:
      input?.cutting === undefined
        ? { ...defaultDesignerProject.cutting }
        : object(input.cutting)
          ? { ...defaultDesignerProject.cutting, ...input.cutting }
          : input.cutting,
    loads: object(input?.loads) ? { wallDead: 0.5, openingDead: 0.3, ...input.loads } : input?.loads,
    objects: input?.objects === undefined ? [] : input.objects,
    boardCuts: input?.boardCuts === undefined ? {} : input.boardCuts,
    levels: input?.levels === undefined ? [] : input.levels,
    voids: input?.voids === undefined ? [] : input.voids,
    joints: object(input?.joints)
      ? { spliceScheme: "halfLap", spliceLength: 0.4, ...input.joints }
      : input?.joints,
  };
}
function segmentHit(a, b, c, d) {
  const u = sub(b, a),
    v = sub(d, c),
    ca = sub(c, a),
    den = cross(u, v);
  if (Math.abs(den) < EPS) return null;
  const t = cross(ca, v) / den,
    s = cross(ca, u) / den;
  return t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS
    ? { t: Math.max(0, Math.min(1, t)), s: Math.max(0, Math.min(1, s)), point: lerp(a, b, t) }
    : null;
}
function parameter(p, a, b) {
  const v = sub(b, a);
  return dot(sub(p, a), v) / dot(v, v);
}
function onSegment(p, a, b, tol = EPS) {
  const v = sub(b, a),
    len = dist(a, b);
  if (len < EPS) return dist(p, a) < tol;
  const t = parameter(p, a, b);
  return t >= -tol && t <= 1 + tol && Math.abs(cross(sub(p, a), v)) / len < tol;
}
function collinearOverlap(a, b, c, d) {
  if (!onSegment(c, a, b, 1e10)) return false;
  const u = sub(b, a),
    v = sub(d, c);
  if (
    Math.abs(cross(u, v)) > EPS * dist(a, b) * dist(c, d) ||
    Math.abs(cross(sub(c, a), u)) > EPS * dist(a, b)
  )
    return false;
  const t0 = parameter(c, a, b),
    t1 = parameter(d, a, b);
  return Math.min(1, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > EPS;
}

export function validateDesignerProject(input) {
  const errors = [],
    warnings = [];
  const error = (field, message) => errors.push({ field, message });
  if (!object(input))
    return {
      valid: false,
      errors: [{ field: "project", message: "Проект должен быть объектом." }],
      warnings,
    };
  const p = normalized(input);
  if (p.material?.dressed !== undefined && typeof p.material.dressed !== "boolean")
    error("material.dressed", "material.dressed: требуется логическое значение.");
  for (const { field, id } of projectSections(p)) {
    const standard = classifySection(id);
    if (!standard.gost) warnings.push(`${field}: ${id}. ${standard.note} ${standard.source}`);
  }
  const range = (v, min, max, key) => {
    if (!finite(v) || v < min || v > max) error(key, `${key}: требуется конечное число от ${min} до ${max}.`);
  };
  const overhangs = (value, key) => {
    if (value === undefined) return;
    if (!object(value)) {
      error(key, "Свесы: объект low/high/start/end в метрах горизонтальной проекции.");
      return;
    }
    for (const field of Object.keys(value)) {
      if (!["low", "high", "start", "end"].includes(field))
        error(key + "." + field, "Неизвестная сторона свеса.");
      else range(value[field], 0, 2, key + "." + field);
    }
  };
  if (p.version !== 2) error("version", "Поддерживается схема проекта версии 2.");
  if (typeof p.name !== "string" || p.name.length > 160) error("name", "Название: строка до 160 символов.");
  range(p.height, 2, 5, "height");
  range(p.floors, 1, 2, "floors");
  if (!Number.isInteger(p.floors)) error("floors", "Этажность: 1 или 2.");
  range(p.grid, 0.01, 2, "grid");
  if (!Array.isArray(p.levels) || p.levels.length > p.floors)
    error("levels", "Этажи: массив не длиннее этажности.");
  else {
    const indices = new Set(),
      ids = new Set();
    for (const [i, l] of p.levels.entries()) {
      const f = `levels.${i}`;
      if (!object(l)) {
        error(f, "Некорректный этаж.");
        continue;
      }
      if (typeof l.id !== "string" || !l.id || ids.has(l.id))
        error(f + ".id", "ID этажей должны быть уникальными.");
      ids.add(l.id);
      if (!Number.isInteger(l.index) || l.index < 1 || l.index > p.floors || indices.has(l.index))
        error(f + ".index", "Индекс этажа должен быть уникальным от 1 до этажности.");
      indices.add(l.index);
      range(l.height, 2, 5, f + ".height");
      if (typeof l.name !== "string" || l.name.length > 100)
        error(f + ".name", "Имя этажа: строка до 100 символов.");
    }
  }
  validateBeamWalls(p, error);
  const wallMap = new Map();
  if (!Array.isArray(p.walls) || p.walls.length > 300) error("walls", "Стены: массив до 300 элементов.");
  for (const [i, w] of (Array.isArray(p.walls) ? p.walls : []).entries()) {
    const f = `walls.${i}`;
    if (!object(w)) {
      error(f, "Некорректная стена.");
      continue;
    }
    if (typeof w.id !== "string" || !w.id || w.id.length > 100 || wallMap.has(w.id))
      error(f + ".id", "ID стен должны быть непустыми и уникальными.");
    wallMap.set(w.id, w);
    if (!point(w.a) || !point(w.b)) {
      error(f, "Обе точки стены должны иметь конечные координаты x/y.");
      continue;
    }
    for (const q of [w.a, w.b])
      if (Math.abs(q.x) > 1000 || Math.abs(q.y) > 1000)
        error(f, "Координаты должны находиться в пределах ±1000 м.");
    range(dist(w.a, w.b), 0.2, 100, f + ".length");
    if (!["exterior", "bearing", "partition"].includes(w.kind))
      error(f + ".kind", "Тип стены: exterior, bearing или partition.");
    if (w.height !== undefined) {
      range(w.height, 2, 5, f + ".height");
      if (w.kind !== "partition")
        error(f + ".height", "Независимая высота разрешена только ненесущей перегородке.");
      const levelHeight =
        (Array.isArray(p.levels) ? p.levels.find((l) => l.index === (w.level ?? 1))?.height : undefined) ??
        p.height;
      if (w.height > levelHeight + EPS)
        error(f + ".height", "Перегородка не должна выступать над верхом своего этажа.");
    }
    if (w.topAttachment !== undefined) {
      const a = w.topAttachment;
      if (
        w.kind !== "partition" ||
        !object(a) ||
        !["roofTieUnderside", "ceilingFrameUnderside"].includes(a?.target) ||
        a?.mode !== "sliding"
      )
        error(
          f + ".topAttachment",
          "Нужна привязка ненесущей перегородки к roofTieUnderside/ceilingFrameUnderside с mode sliding.",
        );
      else {
        if (a.gap !== undefined) range(a.gap, 0.005, 0.1, f + ".topAttachment.gap");
        if (a.zoneId !== undefined && (typeof a.zoneId !== "string" || !a.zoneId || a.zoneId.length > 100))
          error(f + ".topAttachment.zoneId", "Нужен ID кровельной зоны.");
      }
    }
    if (!parseSection(w.section)) error(f + ".section", "Сечение: b×h в мм; 15≤b≤300, b≤h≤600.");
    range(w.studStep, 0.2, 1.2, f + ".studStep");
    if (
      w.endpointMode !== undefined &&
      (!["axes", "faces"].includes(w.endpointMode) || (w.endpointMode === "faces" && w.kind !== "partition"))
    )
      error(
        f + ".endpointMode",
        "endpointMode faces допускается только для ненесущей перегородки; иначе axes.",
      );
    if (w.level !== undefined && (!Number.isInteger(w.level) || w.level < 1 || w.level > p.floors))
      error(f + ".level", "Стена задана на несуществующем этаже.");
  }
  const ws = (Array.isArray(p.walls) ? p.walls : []).filter(
    (w) => object(w) && point(w.a) && point(w.b) && dist(w.a, w.b) > EPS,
  );
  if (ws.length) {
    const points = ws.flatMap((w) => [w.a, w.b]);
    if (
      Math.max(...points.map((q) => q.x)) - Math.min(...points.map((q) => q.x)) > 100 ||
      Math.max(...points.map((q) => q.y)) - Math.min(...points.map((q) => q.y)) > 100
    )
      error("walls", "Габариты одной модели ограничены 100 × 100 м.");
    if (sum(ws.map((w) => dist(w.a, w.b))) > 2000)
      error("walls", "Суммарная длина стен одной модели ограничена 2000 м.");
  }
  for (let i = 0; i < ws.length; i++)
    for (let j = 0; j < i; j++)
      if (
        (ws[i].level === undefined || ws[j].level === undefined || ws[i].level === ws[j].level) &&
        collinearOverlap(ws[i].a, ws[i].b, ws[j].a, ws[j].b)
      )
        error("walls", `Стены ${ws[j].id} и ${ws[i].id} накладываются на одной прямой одного этажа.`);
  const ids = new Set(),
    os = Array.isArray(p.openings) ? p.openings : [];
  if (!Array.isArray(p.openings) || os.length > 300) error("openings", "Проёмы: массив до 300 элементов.");
  for (const [i, o] of os.entries()) {
    const f = `openings.${i}`;
    if (!object(o)) {
      error(f, "Некорректный проём.");
      continue;
    }
    if (typeof o.id !== "string" || !o.id || o.id.length > 100 || ids.has(o.id))
      error(f + ".id", "ID проёмов должны быть непустыми и уникальными.");
    ids.add(o.id);
    const w = wallMap.get(o.wallId);
    if (!w || !point(w.a) || !point(w.b)) {
      error(f + ".wallId", "Стена проёма не существует.");
      continue;
    }
    const s = parseSection(w.section);
    if (!s) continue;
    const B = s.b / 1000;
    range(o.offset, 0.05, 100, f + ".offset");
    range(o.width, 0.2, 20, f + ".width");
    range(o.height, 0.2, 5, f + ".height");
    range(o.sill, 0, 5, f + ".sill");
    if (!["window", "door"].includes(o.type)) error(f + ".type", "Проём: window или door.");
    if (o.floor !== undefined && (!Number.isInteger(o.floor) || o.floor < 1 || o.floor > p.floors))
      error(f + ".floor", "Проём расположен на несуществующем этаже.");
    if (w.level !== undefined && o.floor !== undefined && o.floor !== w.level)
      error(f + ".floor", "Этаж проёма должен совпадать с этажом его стены.");
    const margin = 2 * B + 0.02;
    if (!isBeamWall(w) && (o.offset < margin - EPS || o.offset + o.width > dist(w.a, w.b) - margin + EPS))
      error(f, "До концов стены требуется место для коренных и подперемычечных стоек.");
    const floorHeight =
      w.height ??
      (Array.isArray(p.levels)
        ? (p.levels.find((l) => l?.index === (o.floor ?? w.level ?? 1))?.height ?? p.height)
        : p.height);
    if (!isBeamWall(w) && o.sill + o.height > floorHeight - 2 * B - 0.2 + EPS)
      error(f, "Над проёмом необходимо место для перемычки 200 мм и двух верхних обвязок.");
    if (isBeamWall(w)) {
      const beam = resolveBeam(w),
        rough = beamOpeningEnvelope(o, beam.moisture);
      if (
        rough.roughFrom < -EPS ||
        rough.roughTo > dist(w.a, w.b) + EPS ||
        rough.roughTop > floorHeight - beam.courseHeight + EPS
      )
        error(f, "Обсада с усадочным зазором не помещается: нужны простенки и цельный верхний венец.");
    }
    if (o.type === "door" && o.sill > EPS)
      warnings.push(`Дверь ${o.id} имеет порог ${o.sill} м: проём показан по заданным размерам.`);
    for (let j = 0; j < i; j++) {
      const q = os[j];
      if (!object(q) || q.wallId !== o.wallId || (q.floor ?? w.level ?? 1) !== (o.floor ?? w.level ?? 1))
        continue;
      if (o.offset < q.offset + q.width + 4 * B - EPS && o.offset + o.width > q.offset - 4 * B + EPS)
        error(
          f,
          `Проёмы ${q.id} и ${o.id}: между краями нужно не менее четырёх толщин стойки; расположение друг над другом не поддерживается.`,
        );
    }
  }
  for (const key of ["roof", "material", "loads", "foundation", "joints", "prices"])
    if (!object(p[key])) error(key, `${key}: требуется объект параметров.`);
  if (object(p.roof)) {
    if (p.roof.sourceModel !== undefined) {
      const sourceRoof = validateSourceRoofModel(p.roof.sourceModel, {
        floors: p.floors,
        density: p.material?.density ?? 500,
        snowMu: p.roof.snowMu,
      });
      for (const e of sourceRoof.errors) error(e.field, e.message);
      if (p.roof.type === "none") error("roof.sourceModel", "sourceModel несовместим с roof.type none.");
      if (p.roof.zones !== undefined)
        error("roof.zones", "sourceModel заменяет зоны: удалите одновременно заданные roof.zones.");
    }
    if (!["king", "queen", "fink", "mono", "gable", "none"].includes(p.roof.type))
      error("roof.type", "Тип кровли: king, queen, fink, mono или none.");
    if (p.roof.wallFraming !== undefined && !["auto", "continuous", "stacked"].includes(p.roof.wallFraming))
      error("roof.wallFraming", "Схема стен: auto, continuous или stacked.");
    overhangs(p.roof.overhangs, "roof.overhangs");
    if (p.roof.framing !== undefined && !["auto", "rafters", "truss", "tiedRafters"].includes(p.roof.framing))
      error("roof.framing", "Несущая схема кровли: auto, rafters или truss.");
    if (p.roof.heelClearance !== undefined) range(p.roof.heelClearance, 0, 1, "roof.heelClearance");
    for (const [k, lo, hi] of [
      ["ceilingDrop", 0, 1],
      ["kneeRun", 0.4, 1],
      ["collarHeightRatio", 0.4, 0.9],
    ])
      if (p.roof[k] !== undefined) range(p.roof[k], lo, hi, "roof." + k);
    if (p.roof.collarConnection !== undefined && !["inPlane", "faceLap"].includes(p.roof.collarConnection))
      error("roof.collarConnection", "Соединение ригеля: inPlane либо faceLap.");
    if (p.roof.collarEndInset !== undefined) range(p.roof.collarEndInset, 0, 0.2, "roof.collarEndInset");
    for (const k of ["tieSection", "kneeSection", "collarSection"])
      if (p.roof[k] !== undefined && !parseSection(p.roof[k]))
        error("roof." + k, "Некорректное сечение стропильной рамы.");
    if (p.roof.snowMu !== undefined) range(p.roof.snowMu, 0, 3, "roof.snowMu");
    if (p.roof.ceilingDead !== undefined) range(p.roof.ceilingDead, 0, 5, "roof.ceilingDead");
    if (p.roof.deflectionRatio !== undefined) range(p.roof.deflectionRatio, 150, 600, "roof.deflectionRatio");
    range(p.roof.pitch, 0, 60, "roof.pitch");
    range(p.roof.spacing, 0.2, 1.5, "roof.spacing");
    for (const k of ["chordSection", "webSection"])
      if (!parseSection(p.roof[k])) error("roof." + k, "Некорректное сечение доски.");
    if (p.roof.zones !== undefined) {
      if (!Array.isArray(p.roof.zones) || p.roof.zones.length > 100)
        error(
          "roof.zones",
          "Зоны кровли: массив до 100 элементов; отсутствие поля включает автоматические зоны.",
        );
      else {
        const ids = new Set();
        for (const [i, z] of p.roof.zones.entries()) {
          const f = `roof.zones.${i}`;
          if (!object(z)) {
            error(f, "Зона кровли должна быть объектом.");
            continue;
          }
          if (typeof z.id !== "string" || !z.id || z.id.length > 100 || ids.has(z.id))
            error(f + ".id", "ID зон должны быть непустыми и уникальными, до 100 символов.");
          ids.add(z.id);
          if (typeof z.name !== "string" || z.name.length > 160)
            error(f + ".name", "Название зоны: строка до 160 символов.");
          if (!["gable", "mono", "hip"].includes(z.shape))
            error(f + ".shape", "Форма зоны: gable, mono или hip.");
          if (z.framing !== undefined && !["auto", "rafters", "truss", "tiedRafters"].includes(z.framing))
            error(f + ".framing", "Несущая схема: auto, rafters или truss.");
          if (z.loadSnowFactor !== undefined) range(z.loadSnowFactor, 0, 4, f + ".loadSnowFactor");
          overhangs(z.overhangs, f + ".overhangs");
          if (z.heelClearance !== undefined) range(z.heelClearance, 0, 1, f + ".heelClearance");
          for (const [k, lo, hi] of [
            ["ceilingDrop", 0, 1],
            ["kneeRun", 0.4, 1],
            ["collarHeightRatio", 0.4, 0.9],
          ])
            if (z[k] !== undefined) range(z[k], lo, hi, f + "." + k);
          if (z.collarConnection !== undefined && !["inPlane", "faceLap"].includes(z.collarConnection))
            error(f + ".collarConnection", "Соединение ригеля: inPlane либо faceLap.");
          if (z.collarEndInset !== undefined) range(z.collarEndInset, 0, 0.2, f + ".collarEndInset");
          for (const k of ["tieSection", "kneeSection", "collarSection"])
            if (z[k] !== undefined && !parseSection(z[k]))
              error(f + "." + k, "Некорректное сечение стропильной рамы.");
          if (z.snowMu !== undefined) range(z.snowMu, 0, 3, f + ".snowMu");
          if (z.ceilingDead !== undefined) range(z.ceilingDead, 0, 5, f + ".ceilingDead");
          if (z.deflectionRatio !== undefined) range(z.deflectionRatio, 150, 600, f + ".deflectionRatio");
          if (!finite(z.ridgeAngle)) error(f + ".ridgeAngle", "Азимут конька должен быть конечным числом.");
          range(z.pitchLeft, 2, 60, f + ".pitchLeft");
          range(z.pitchRight, 2, 60, f + ".pitchRight");
          range(z.spacing, 0.2, 3, f + ".spacing");
          for (const key of ["chordSection", "webSection"])
            if (!parseSection(z[key])) error(f + "." + key, "Некорректное сечение доски зоны.");
          if (
            z.elevation !== null &&
            z.elevation !== undefined &&
            (!finite(z.elevation) || z.elevation <= 0 || z.elevation > 100)
          )
            error(f + ".elevation", "Отметка зоны: null или положительное конечное число до 100 м.");
          if (
            z.levelIndex !== undefined &&
            (!Number.isInteger(z.levelIndex) || z.levelIndex < 1 || z.levelIndex > p.floors)
          )
            error(f + ".levelIndex", "Зона задана на несуществующем этаже.");
          if (
            !Array.isArray(z.polygon) ||
            z.polygon.length < 3 ||
            z.polygon.length > 200 ||
            !z.polygon.every(point)
          ) {
            error(f + ".polygon", "Контур зоны: 3–200 конечных точек x/y.");
            continue;
          }
          if (polygonArea(z.polygon) < 0.01)
            error(f + ".polygon", "Площадь зоны должна быть не менее 0,01 м².");
          if (z.polygon.some((q, j) => dist(q, z.polygon[(j + 1) % z.polygon.length]) < 0.01))
            error(f + ".polygon", "Сторона зоны должна быть не короче 0,01 м.");
          for (let a = 0; a < z.polygon.length; a++)
            for (let b = 0; b < a; b++) {
              if (Math.abs(a - b) === 1 || Math.abs(a - b) === z.polygon.length - 1) continue;
              const aa = z.polygon[a],
                az = z.polygon[(a + 1) % z.polygon.length],
                ba = z.polygon[b],
                bz = z.polygon[(b + 1) % z.polygon.length];
              if (segmentHit(aa, az, ba, bz) || collinearOverlap(aa, az, ba, bz))
                error(
                  f + ".polygon",
                  "Контур зоны должен быть простым, без самопересечений и наложенных рёбер.",
                );
            }
        }
      }
    }
  }
  if (!object(p.floor)) error("floor", "Параметры перекрытия должны быть объектом.");
  else {
    const sec = parseSection(p.floor.section);
    if (!sec) error("floor.section", "Некорректное сечение балки.");
    range(p.floor.spacing, 0.2, 1.2, "floor.spacing");
    if (!["x", "y"].includes(p.floor.axis)) error("floor.axis", "Направление балок: x или y.");
    for (const field of ["rimSection", "blockingSection"])
      if (p.floor[field] !== null && p.floor[field] !== undefined) {
        const s = parseSection(p.floor[field]);
        if (!s || (sec && s.h !== sec.h))
          error(
            "floor." + field,
            "Сечение должно иметь ту же полную высоту, что и лаги; null означает сечение лаг.",
          );
      }
    if (typeof p.floor.blocking !== "boolean") error("floor.blocking", "Блокинг: true или false.");
    range(p.floor.blockingStep, 0.3, 3, "floor.blockingStep");
    if (p.floor.wallSupportFraming !== undefined && typeof p.floor.wallSupportFraming !== "boolean")
      error("floor.wallSupportFraming", "Усиления под стенами: true или false.");
  }
  if (!object(p.bracing)) error("bracing", "Жёсткость стен: требуется объект параметров.");
  else {
    if (p.bracing.sheetSide !== undefined && !["interior", "exterior"].includes(p.bracing.sheetSide))
      error("bracing.sheetSide", "Сторона обшивки: interior/exterior.");
    if (!["sheathing", "letIn", "none"].includes(p.bracing.method))
      error("bracing.method", "Схема жёсткости: sheathing, letIn или none.");
    if (!parseSection(p.bracing.section)) error("bracing.section", "Некорректное сечение укосины.");
    for (const [k, a, b] of [
      ["sheetWidth", 0.3, 4],
      ["sheetHeight", 0.3, 6],
      ["thickness", 6, 40],
      ["sheetDensity", 100, 1500],
      ["edgeNailSpacing", 25, 500],
      ["fieldNailSpacing", 25, 1000],
    ])
      range(p.bracing[k], a, b, "bracing." + k);
    if (p.bracing.designShear !== null && p.bracing.designShear !== undefined)
      range(p.bracing.designShear, 0.01, 100, "bracing.designShear");
  }
  if (object(p.material)) {
    if (
      p.material.Emin !== undefined &&
      (!finite(p.material.Emin) || p.material.Emin <= 0 || p.material.Emin > p.material.E)
    )
      error("material.Emin", "Emin должен быть положительным и не превышать E.");
    if (p.material.Fc90Full !== undefined) range(p.material.Fc90Full, 0.1, 20, "material.Fc90Full");
    if (p.material.wallDeflectionRatio !== undefined)
      range(p.material.wallDeflectionRatio, 100, 600, "material.wallDeflectionRatio");
  }
  if (object(p.material))
    for (const [k, a, b] of [
      ["density", 100, 1500],
      ["E", 1000, 30000],
      ["Fb", 0.5, 80],
      ["Ft", 0.5, 80],
      ["Fc", 0.5, 100],
    ])
      range(p.material[k], a, b, "material." + k);
  if (!object(p.bracing)) error("bracing", "Жёсткость стен: требуется объект параметров.");
  else {
    if (p.bracing.sheetSide !== undefined && !["interior", "exterior"].includes(p.bracing.sheetSide))
      error("bracing.sheetSide", "Сторона обшивки: interior/exterior.");
    if (!["sheathing", "letIn", "none"].includes(p.bracing.method))
      error("bracing.method", "Схема жёсткости: sheathing, letIn или none.");
    if (!parseSection(p.bracing.section)) error("bracing.section", "Некорректное сечение укосины.");
    for (const [k, a, b] of [
      ["sheetWidth", 0.3, 4],
      ["sheetHeight", 0.3, 6],
      ["thickness", 6, 40],
      ["sheetDensity", 100, 1500],
      ["edgeNailSpacing", 25, 500],
      ["fieldNailSpacing", 25, 1000],
    ])
      range(p.bracing[k], a, b, "bracing." + k);
    if (p.bracing.designShear !== null && p.bracing.designShear !== undefined)
      range(p.bracing.designShear, 0.01, 100, "bracing.designShear");
  }
  if (object(p.material)) {
    if (
      p.material.Emin !== undefined &&
      (!finite(p.material.Emin) || p.material.Emin <= 0 || p.material.Emin > p.material.E)
    )
      error("material.Emin", "Emin должен быть положительным и не превышать E.");
    if (p.material.wallDeflectionRatio !== undefined)
      range(p.material.wallDeflectionRatio, 100, 600, "material.wallDeflectionRatio");
  }
  if (object(p.material))
    for (const [k, a, b] of [
      ["Fv", 0.1, 20],
      ["studRestraint", 0.2, 5],
      ["columnK", 0.5, 2],
    ])
      if (p.material[k] !== undefined) range(p.material[k], a, b, "material." + k);
  if (object(p.loads))
    for (const [k, a, b] of [
      ["floorDead", 0, 20],
      ["live", 0, 20],
      ["roofDead", 0, 20],
      ["wallDead", 0, 20],
      ["openingDead", 0, 20],
      ["snow", 0, 20],
      ["wind", 0, 10],
    ])
      range(p.loads[k], a, b, "loads." + k);
  if (object(p.loads)) {
    // Explicit partial factors stay accepted as overrides of the code profile.
    for (const [k, a, b] of [
      ["gammaG", 1, 2],
      ["gammaQ", 1, 3],
      ["snowCe", 0.1, 2],
      ["snowCt", 0.1, 2],
    ])
      if (p.loads[k] !== undefined) range(p.loads[k], a, b, "loads." + k);
    if (p.loads.terrain !== undefined && !TERRAIN_TYPES.includes(p.loads.terrain))
      error("loads.terrain", "Тип местности: A, B или C (СП 20.13330.2016 п. 11.1.6).");
    if (p.loads.code !== undefined && !LOAD_PROFILES[p.loads.code])
      error("loads.code", "Профиль норм: " + Object.keys(LOAD_PROFILES).join(", ") + ".");
  }
  if (object(p.foundation)) {
    range(p.foundation.spacing, 0.5, 6, "foundation.spacing");
    range(p.foundation.capacity, 1, 1000, "foundation.capacity");
    const g = p.foundation.grillage;
    if (!object(g)) error("foundation.grillage", "Ростверк: требуется объект параметров.");
    else {
      if (g.girderSpacing !== undefined) range(g.girderSpacing, 0.5, 6, "foundation.grillage.girderSpacing");
      if (!parseSection(g.section))
        error("foundation.grillage.section", "Некорректное сечение доски ростверка.");
      range(g.plies, 2, 6, "foundation.grillage.plies");
      if (!Number.isInteger(g.plies)) error("foundation.grillage.plies", "Число досок в пакете — целое.");
      range(g.deflectionRatio, 100, 600, "foundation.grillage.deflectionRatio");
      range(g.capSize, 100, 1000, "foundation.grillage.capSize");
    }
  }
  if (object(p.prices))
    for (const [k, v] of Object.entries(p.prices)) {
      if (k === "currency") {
        if (!["RUB", "EUR", "USD"].includes(v)) error("prices.currency", "Валюта: RUB, EUR или USD.");
        continue;
      }
      if (k === "sectionPrices") {
        if (!object(v) || Object.keys(v).length > 1000)
          error("prices.sectionPrices", "Цены сечений: объект до 1000 позиций.");
        else
          for (const [id, price] of Object.entries(v)) {
            if (!id || id.length > 100)
              error("prices.sectionPrices", "ID сечения должен быть непустой строкой до 100 символов.");
            range(price, 0, 1e9, "prices.sectionPrices." + id);
          }
      } else range(v, 0, k.endsWith("Percent") ? 300 : 1e9, "prices." + k);
    }
  const types = ["california2", "three3", "closed4"],
    cuts = ["butt", "miter", "halfLap", "half-lap"];
  if (object(p.joints)) {
    if (!types.includes(p.joints.defaultCorner))
      error("joints.defaultCorner", "Угол: california2, three3 или closed4.");
    if (!cuts.includes(p.joints.defaultCut)) error("joints.defaultCut", "Запил: butt, miter или halfLap.");
    if (!["halfLap", "scarf", "fishplate", "none"].includes(p.joints.spliceScheme))
      error("joints.spliceScheme", "Наращивание: halfLap, scarf, fishplate или none.");
    range(p.joints.spliceLength, 0.1, 1, "joints.spliceLength");
    if (!object(p.joints.overrides) || Object.keys(p.joints.overrides).length > 1000)
      error("joints.overrides", "Переопределения узлов: объект до 1000 элементов.");
    else
      for (const [id, v] of Object.entries(p.joints.overrides)) {
        if (
          !object(v) ||
          Object.keys(v).some((k) => !["type", "cutScheme"].includes(k)) ||
          (v.type !== undefined && !types.includes(v.type)) ||
          (v.cutScheme !== undefined && !cuts.includes(v.cutScheme))
        )
          error("joints.overrides." + id, "Переопределение узла: {type, cutScheme}.");
      }
    if (
      p.joints.defaultCorner === "closed4" &&
      ws.some((w) => {
        const s = parseSection(w.section);
        return s && s.h < 2 * s.b;
      })
    )
      error("joints.defaultCorner", "Закрытый пакет требует глубину стены ≥ двух толщин доски.");
  }
  if (!object(p.cutting)) error("cutting", "Параметры раскроя должны быть объектом.");
  else {
    if (p.cutting.stockLength !== 6)
      error("cutting.stockLength", "Длина исходной доски в этой схеме фиксирована: 6 м.");
    range(p.cutting.kerf, 0, 10, "cutting.kerf");
    range(p.cutting.minReusable, 0, 6, "cutting.minReusable");
  }
  if (!Array.isArray(p.objects) || p.objects.length > 300)
    error("objects", "Объекты: массив до 300 элементов.");
  else {
    const seen = new Set();
    for (const [i, o] of p.objects.entries()) {
      const f = `objects.${i}`;
      if (!object(o)) {
        error(f, "Некорректный объект.");
        continue;
      }
      if (typeof o.id !== "string" || !o.id || seen.has(o.id))
        error(f + ".id", "ID объектов должны быть уникальными.");
      seen.add(o.id);
      if (!["post", "beam"].includes(o.type)) error(f + ".type", "Объект: post или beam.");
      if (!point(o.a) || (o.type === "beam" && !point(o.b)))
        error(f, "Требуются конечные координаты объекта.");
      if (!parseSection(o.section)) error(f + ".section", "Некорректное сечение объекта.");
      if (o.height !== undefined) range(o.height, 0.2, 20, f + ".height");
      if (o.elevation !== undefined) range(o.elevation, 0, 20, f + ".elevation");
      if (o.level !== undefined && (!Number.isInteger(o.level) || o.level < 1 || o.level > p.floors))
        error(f + ".level", "Объект расположен на несуществующем этаже.");
      if (point(o.a) && Object.values(o.a).some((v) => !finite(v) || Math.abs(v) > 1000))
        error(f, "Координаты объекта вне допустимого диапазона.");
      if (o.type === "beam" && point(o.a) && point(o.b)) range(dist(o.a, o.b), 0.2, 100, f + ".length");
    }
  }
  if (!object(p.boardCuts) || Object.keys(p.boardCuts).length > 10000)
    error("boardCuts", "Запилы досок: объект до 10000 элементов.");
  else
    for (const [id, v] of Object.entries(p.boardCuts)) {
      if (!object(v) || Object.keys(v).some((k) => !["start", "end"].includes(k))) {
        error("boardCuts." + id, "Запилы задаются полями start/end.");
        continue;
      }
      for (const side of ["start", "end"])
        if (v[side] !== undefined) {
          const c = v[side];
          if (
            !object(c) ||
            !["butt", "miter"].includes(c.scheme) ||
            !finite(c.angle) ||
            c.angle < 0 ||
            c.angle > 75
          )
            error("boardCuts." + id + "." + side, "Запил: butt/miter, угол от 0 до 75° от прямого реза.");
        }
    }
  if (!Array.isArray(p.voids) || p.voids.length > 100)
    error("voids", "Проёмы перекрытий: массив до 100 элементов.");
  else {
    const ids = new Set();
    for (const [i, v] of p.voids.entries()) {
      const f = `voids.${i}`;
      if (!object(v)) {
        error(f, "Некорректный проём перекрытия.");
        continue;
      }
      if (typeof v.id !== "string" || !v.id || ids.has(v.id))
        error(f + ".id", "ID проёмов перекрытий должны быть уникальными.");
      ids.add(v.id);
      if (!Number.isInteger(v.level) || v.level < 1 || v.level > p.floors)
        error(f + ".level", "Проём перекрытия расположен на несуществующем этаже.");
      if (!["doubleHeight", "stair", "opening"].includes(v.kind))
        error(f + ".kind", "Тип проёма перекрытия: doubleHeight, stair или opening.");
      if (v.kind === "doubleHeight" && v.level === 1)
        error(f + ".level", "Второй свет вырезает перекрытие второго этажа, а не пол первого.");
      if (!parseSection(v.edgeSection)) error(f + ".edgeSection", "Некорректное сечение обрамления.");
      if (v.edgePlies !== undefined && (!Number.isInteger(v.edgePlies) || v.edgePlies < 1 || v.edgePlies > 6))
        error(f + ".edgePlies", "Количество досок обрамления: целое1…6.");
      if (
        !Array.isArray(v.polygon) ||
        v.polygon.length < 3 ||
        v.polygon.length > 100 ||
        !v.polygon.every(point)
      ) {
        error(f + ".polygon", "Контур проёма: 3–100 конечных точек x/y.");
        continue;
      }
      if (polygonArea(v.polygon) < 0.04)
        error(f + ".polygon", "Площадь проёма должна быть не менее 0,04 м².");
      if (v.polygon.some((q, i) => dist(q, v.polygon[(i + 1) % v.polygon.length]) < 0.05))
        error(f + ".polygon", "Сторона проёма перекрытия должна быть не короче 0,05 м.");
      for (let a = 0; a < v.polygon.length; a++)
        for (let b = 0; b < a; b++) {
          if (Math.abs(a - b) === 1 || Math.abs(a - b) === v.polygon.length - 1) continue;
          const aa = v.polygon[a],
            az = v.polygon[(a + 1) % v.polygon.length],
            ba = v.polygon[b],
            bz = v.polygon[(b + 1) % v.polygon.length],
            hit = segmentHit(aa, az, ba, bz);
          if (hit || collinearOverlap(aa, az, ba, bz))
            error(f + ".polygon", "Контур проёма перекрытия не должен пересекать себя.");
        }
    }
  }
  if (errors.length === 0) {
    for (const level of deriveLevels(p)) {
      const graph = level.graph;
      for (const c of cornerData(p, graph, level.index))
        if (
          c.type === "closed4" &&
          c.wallIds.some((id) => {
            const s = parseSection(wallMap.get(id).section);
            return s.h < 2 * s.b;
          })
        )
          error(
            "joints.overrides." + c.id,
            "Закрытый пакет в этом узле требует глубину каждой прилегающей стены не менее двух толщин доски.",
          );
      const voids = p.voids.filter((v) => v.level === level.index);
      for (const v of voids) {
        if (!graph.closed) {
          warnings.push(`Проём ${v.id}: внешний контур этажа ещё не замкнут.`);
          continue;
        }
        if (!polygonContained(v.polygon, graph.polygon))
          error("voids." + v.id, "Проём перекрытия должен целиком лежать внутри контура своего этажа.");
      }
      for (let i = 0; i < voids.length; i++)
        for (let j = 0; j < i; j++)
          if (polygonsOverlap(voids[i].polygon, voids[j].polygon))
            error("voids", "Проёмы одного перекрытия не должны накладываться.");
    }
  }
  for (const e of validateGrillageExtensions(p).errors) error(e.field, e.message);
  validateInsulation(p, error);
  validateAnnexes(p, error);
  for (const e of validateSpatialLayoutInput(p)) error(e.field, e.message);
  return { valid: errors.length === 0, errors, warnings };
}

function topology(walls) {
  const cuts = walls.map(() => [0, 1]);
  for (let i = 0; i < walls.length; i++)
    for (let j = 0; j < i; j++) {
      const a = walls[i],
        b = walls[j],
        hit = segmentHit(a.a, a.b, b.a, b.b);
      if (hit) {
        cuts[i].push(hit.t);
        cuts[j].push(hit.s);
      } else
        for (const [p, k, target] of [
          [a.a, j, b],
          [a.b, j, b],
          [b.a, i, a],
          [b.b, i, a],
        ])
          if (onSegment(p, target.a, target.b)) cuts[k].push(parameter(p, target.a, target.b));
    }
  const nodes = new Map(),
    edges = [];
  const get = (p) => {
    const key = nodeKey(p);
    if (!nodes.has(key))
      nodes.set(key, {
        id: "j_" + key,
        point: { x: coord(p.x), y: coord(p.y) },
        edges: [],
        wallIds: new Set(),
      });
    return nodes.get(key);
  };
  walls.forEach((w, i) => {
    const ts = cuts[i].sort((a, b) => a - b).filter((v, j, a) => !j || Math.abs(v - a[j - 1]) > 1e-10);
    for (let j = 1; j < ts.length; j++) {
      if (ts[j] - ts[j - 1] < EPS) continue;
      const a = get(lerp(w.a, w.b, ts[j - 1])),
        b = get(lerp(w.a, w.b, ts[j]));
      const edge = {
        id: `${w.id}:${j}`,
        wallId: w.id,
        kind: w.kind,
        a: a.id,
        b: b.id,
        length: dist(a.point, b.point),
      };
      edges.push(edge);
      a.edges.push(edge);
      b.edges.push(edge);
      a.wallIds.add(w.id);
      b.wallIds.add(w.id);
    }
  });
  const byId = new Map([...nodes.values()].map((n) => [n.id, n]));
  const ext = edges.filter((e) => e.kind === "exterior"),
    adj = new Map();
  for (const e of ext)
    for (const id of [e.a, e.b]) {
      if (!adj.has(id)) adj.set(id, []);
      adj.get(id).push(e);
    }
  let closed = ext.length >= 3 && [...adj.values()].every((a) => a.length === 2),
    polygon = [];
  if (closed) {
    const start = [...adj.keys()].sort((a, b) => {
      const p = byId.get(a).point,
        q = byId.get(b).point;
      return p.x - q.x || p.y - q.y;
    })[0];
    let current = start,
      previous = null;
    const used = new Set();
    for (let i = 0; i <= ext.length; i++) {
      polygon.push({ ...byId.get(current).point });
      const edge = adj.get(current).find((e) => e.id !== previous);
      if (!edge || used.has(edge.id)) {
        closed = false;
        break;
      }
      used.add(edge.id);
      previous = edge.id;
      current = edge.a === current ? edge.b : edge.a;
      if (current === start) break;
    }
    if (used.size !== ext.length || current !== start) closed = false;
  }
  let signed = closed ? sum(polygon.map((p, i) => cross(p, polygon[(i + 1) % polygon.length]))) / 2 : 0;
  if (Math.abs(signed) < 1e-5) closed = false;
  if (!closed) polygon = [];
  else if (signed < 0) {
    polygon.reverse();
    signed = -signed;
  }
  return {
    nodes: [...nodes.values()].map((n) => ({ ...n, wallIds: [...n.wallIds] })),
    edges,
    byId,
    closed,
    polygon,
    area: closed ? signed : null,
  };
}

export function pointInPolygon(p, polygon, includeBoundary = true) {
  if (polygon.some((a, i) => onSegment(p, a, polygon[(i + 1) % polygon.length], 1e-6)))
    return includeBoundary;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function polygonArea(polygon) {
  return Math.abs(sum(polygon.map((p, i) => cross(p, polygon[(i + 1) % polygon.length]))) / 2);
}
function polygonBounds(polygon) {
  const xs = polygon.map((p) => p.x),
    ys = polygon.map((p) => p.y);
  const b = {
    minX: xs.length ? Math.min(...xs) : 0,
    minY: ys.length ? Math.min(...ys) : 0,
    maxX: xs.length ? Math.max(...xs) : 0,
    maxY: ys.length ? Math.max(...ys) : 0,
  };
  return { ...b, width: b.maxX - b.minX, height: b.maxY - b.minY };
}
function polygonsOverlap(a, b) {
  if (a.some((q) => pointInPolygon(q, b, false)) || b.some((q) => pointInPolygon(q, a, false))) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const hit = segmentHit(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]);
      if (hit && hit.t > EPS && hit.t < 1 - EPS && hit.s > EPS && hit.s < 1 - EPS) return true;
    }
  for (const [own, other] of [
    [a, b],
    [b, a],
  ]) {
    const signed = sum(own.map((q, i) => cross(q, own[(i + 1) % own.length]))),
      side = signed >= 0 ? 1 : -1;
    for (let i = 0; i < own.length; i++) {
      const q = own[i],
        z = own[(i + 1) % own.length],
        length = dist(q, z);
      if (length < EPS) continue;
      const mid = lerp(q, z, 0.5),
        sample = {
          x: mid.x - ((z.y - q.y) / length) * side * 1e-5,
          y: mid.y + ((z.x - q.x) / length) * side * 1e-5,
        };
      if (pointInPolygon(sample, own, false) && pointInPolygon(sample, other, false)) return true;
    }
  }
  return false;
}
function polygonContained(inner, outer) {
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i],
      b = inner[(i + 1) % inner.length];
    if (!pointInPolygon(a, outer)) return false;
    const ts = [0, 1];
    for (let j = 0; j < outer.length; j++) {
      const hit = segmentHit(a, b, outer[j], outer[(j + 1) % outer.length]);
      if (hit) ts.push(hit.t);
    }
    ts.sort((a, b) => a - b);
    for (let j = 1; j < ts.length; j++)
      if (!pointInPolygon(lerp(a, b, (ts[j] + ts[j - 1]) / 2), outer)) return false;
  }
  return true;
}
function deriveLevels(p) {
  const platform = parseSection(p.floor.section).h / 1000 + 0.035;
  let baseY = 0.72 + parseSection(p.foundation.grillage.section).h / 1000;
  return Array.from({ length: p.floors }, (_, i) => {
    const index = i + 1,
      definition = p.levels.find((l) => l.index === index),
      height = definition?.height ?? p.height,
      walls = p.walls.filter((w) => w.level === undefined || w.level === index),
      graph = topology(walls),
      polygon = graph.polygon,
      voids = p.voids.filter((v) => v.level === index),
      voidArea = graph.closed ? sum(voids.map((v) => polygonArea(v.polygon))) : null;
    const level = {
      id: definition?.id ?? "level-" + index,
      index,
      name: definition?.name ?? index + " этаж",
      height,
      baseY,
      platformBase: baseY,
      wallBaseY: baseY + platform,
      elevation: baseY + platform,
      wallBase: baseY + platform,
      topY: baseY + platform + height,
      closed: graph.closed,
      polygon,
      area: graph.area,
      voidArea,
      netFloorArea: graph.closed ? Math.max(0, graph.area - voidArea) : null,
      bounds: polygonBounds(graph.closed ? polygon : walls.flatMap((w) => [w.a, w.b])),
      walls,
      voids,
      graph,
    };
    baseY = level.topY;
    return level;
  });
}
function subtractIntervals(intervals, cutouts) {
  let result = intervals;
  for (const [a, b] of cutouts) {
    const next = [];
    for (const [x, y] of result) {
      if (b <= x + EPS || a >= y - EPS) next.push([x, y]);
      else {
        if (a > x + EPS) next.push([x, Math.min(a, y)]);
        if (b < y - EPS) next.push([Math.max(b, x), y]);
      }
    }
    result = next;
  }
  return result;
}
function interiorIntervals(polygon, line, axis) {
  const fixed = axis === "y" ? "x" : "y",
    along = axis === "y" ? "y" : "x",
    values = polygon.map((p) => p[fixed]);
  const min = Math.min(...values),
    max = Math.max(...values);
  let at = line;
  if (Math.abs(at - max) < EPS) at = max - 1e-7;
  if (Math.abs(at - min) < EPS) at = min + 1e-7;
  const hits = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if ((a[fixed] <= at && at < b[fixed]) || (b[fixed] <= at && at < a[fixed]))
      hits.push(a[along] + ((b[along] - a[along]) * (at - a[fixed])) / (b[fixed] - a[fixed]));
  }
  hits.sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < hits.length; i += 2)
    if (hits[i] - hits[i - 1] > 0.01) intervals.push([hits[i - 1], hits[i]]);
  return intervals;
}

function cornerData(p, graph, level = 1) {
  const walls = new Map(p.walls.map((w) => [w.id, w]));
  return graph.nodes
    .filter((n) => n.wallIds.length > 1)
    .map((n) => {
      const dirs = n.edges.map((e) => {
        const other = graph.byId.get(e.a === n.id ? e.b : e.a).point,
          v = sub(other, n.point),
          len = Math.hypot(v.x, v.y);
        return { x: v.x / len, y: v.y / len };
      });
      const distinct = dirs.filter((d, i) => dirs.findIndex((q) => dot(d, q) > 1 - 1e-6) === i);
      let angle = 180;
      if (distinct.length > 1)
        angle = Math.min(
          ...distinct.flatMap((d, i) =>
            distinct
              .slice(i + 1)
              .map((q) => (Math.acos(Math.max(-1, Math.min(1, dot(d, q)))) * 180) / Math.PI),
          ),
        );
      const pi = graph.polygon.findIndex((q) => dist(q, n.point) < 1e-6);
      if (distinct.length === 2 && pi >= 0) {
        const prev = graph.polygon[(pi + graph.polygon.length - 1) % graph.polygon.length],
          next = graph.polygon[(pi + 1) % graph.polygon.length];
        if (cross(sub(n.point, prev), sub(next, n.point)) < 0) angle = 360 - angle;
      }
      const kind =
        distinct.length >= 4
          ? "cross"
          : distinct.length === 3
            ? "t"
            : Math.abs(angle - 180) < 0.01
              ? "straight"
              : "corner";
      const id = level === 1 ? n.id : "j_" + level + "_" + nodeKey(n.point),
        override = p.joints.overrides[id] || {},
        type = override.type || p.joints.defaultCorner,
        cutScheme = override.cutScheme || p.joints.defaultCut;
      const principal = Math.min(angle, 360 - angle),
        cutAngle = Math.max(0, (180 - principal) / 2);
      const warning =
        kind === "t" || kind === "cross"
          ? "Состав и передача усилий в Т/X-стыке условные; крепёж и примыкание обвязок не рассчитаны."
          : Math.abs(principal - 90) > 0.01 && kind !== "straight"
            ? "Косой угол: пакет и запилы показаны схематично, требуется рабочий узел."
            : ["halfLap", "half-lap"].includes(cutScheme)
              ? "Врубка вполдерева обозначена; ослабление сечения и несущая способность не проверены."
              : new Set(n.wallIds.map((id) => parseSection(walls.get(id).section).b)).size > 1
                ? "Угол с разной толщиной досок: отметки слоёв и 3D-примыкание обвязок требуют отдельного узла."
                : null;
      const section = parseSection(walls.get(n.wallIds[0]).section);
      return {
        id,
        level,
        point: n.point,
        wallIds: n.wallIds,
        angle,
        cutAngle,
        type,
        cutScheme,
        kind,
        warning,
        section: { ...section },
        directions: distinct,
      };
    });
}

function timberModel(p, graph, corners, bounds, truss, warnings, roofModel) {
  const instances = [],
    scheduleMap = new Map(),
    braceBays = [],
    splices = [],
    wallMap = new Map(p.walls.map((w) => [w.id, w])),
    duplicateIds = new Map();
  const floorSection = parseSection(p.floor.section),
    platform = floorSection.h / 1000 + 0.035,
    story = p.height + platform,
    base = p._baseY ?? 0.72;
  const hash = (value) => {
    let n = 2166136261;
    for (const c of value) {
      n ^= c.charCodeAt(0);
      n = Math.imul(n, 16777619);
    }
    return (n >>> 0).toString(36);
  };
  const allowance = (cut, h) =>
    cut?.scheme === "miter"
      ? ((cut.cutWidthMM ?? h) / 2000) * Math.tan((Math.min(85, Math.abs(cut.angle || 0)) * Math.PI) / 180)
      : 0;
  function raw(name, category, role, b, h, a, z, extras = {}) {
    const length = Math.hypot(...a.map((v, i) => z[i] - v));
    if (length < 0.005) return null;
    const id =
      extras.id ||
      "D" +
        hash(
          JSON.stringify([
            name,
            role,
            a.map(coord),
            z.map(coord),
            extras.wallId,
            extras.floor,
            extras.cornerId,
            b,
            h,
          ]),
        );
    const overrides = p.boardCuts[id] || {};
    const cs = { ...(extras.cutStart || { scheme: "butt", angle: 0 }), ...overrides.start },
      ce = { ...(extras.cutEnd || { scheme: "butt", angle: 0 }), ...overrides.end };
    if (cs.scheme === "butt") cs.angle = 0;
    if (ce.scheme === "butt") ce.angle = 0;
    const cutLength = length + allowance(cs, h) + allowance(ce, h),
      grossVolume = (b * h * cutLength) / 1e6;
    const removed =
      ((b * h) / 1e6) *
      sum(
        [cs, ce].map((c) =>
          ["halfLap", "half-lap", "scarf"].includes(c.scheme) ? (c.lapLength ?? 0) / 2 : 0,
        ),
      );
    const volume = Math.max(0, (b * h * length) / 1e6 - removed),
      mass = volume * p.material.density;
    const key = [
      name,
      category,
      b,
      h,
      length.toFixed(6),
      extras.cutStart?.scheme,
      extras.cutStart?.angle,
      extras.cutEnd?.scheme,
      extras.cutEnd?.angle,
    ].join("|");
    let row = scheduleMap.get(key);
    if (!row) {
      row = {
        id: `T${String(scheduleMap.size + 1).padStart(3, "0")}`,
        name,
        category,
        role,
        b,
        h,
        section: `${b} × ${h}`,
        length,
        count: 0,
        volume: 0,
        mass: 0,
        massEach: mass,
        volumeEach: volume,
      };
      scheduleMap.set(key, row);
    }
    row.count++;
    row.volume += volume;
    row.mass += mass;
    const count = duplicateIds.get(id) || 0;
    duplicateIds.set(id, count + 1);
    const uniqueId = count ? id + "-" + count : id;
    const board = {
      id: uniqueId,
      scheduleId: row.id,
      name,
      category,
      role,
      b,
      h,
      length,
      cutLength,
      actualCutLength: cutLength,
      grossVolume,
      netVolume: volume,
      volume,
      mass,
      start: a,
      end: z,
      crossAxis: [1, 0, 0],
      ...extras,
      cutStart: cs,
      cutEnd: ce,
    };
    instances.push(board);
    return board;
  }
  function add(name, category, role, b, h, a, z, extras = {}) {
    const length = Math.hypot(...a.map((v, i) => z[i] - v));
    if (length < 0.005) return;
    const memberId =
      "M" +
      hash(
        JSON.stringify([
          name,
          role,
          a.map(coord),
          z.map(coord),
          extras.wallId,
          extras.floor,
          extras.cornerId,
          b,
          h,
        ]),
      );
    const overrides = p.boardCuts[memberId] || {},
      cs = { ...(extras.cutStart || { scheme: "butt", angle: 0 }), ...overrides.start },
      ce = { ...(extras.cutEnd || { scheme: "butt", angle: 0 }), ...overrides.end },
      stock = p.cutting.stockLength;
    if (cs.scheme === "butt") cs.angle = 0;
    if (ce.scheme === "butt") ce.angle = 0;
    if (
      length + allowance(cs, h) + allowance(ce, h) <= stock + EPS ||
      p.joints.spliceScheme === "none" ||
      extras.requireSingleStock
    )
      return raw(name, category, role, b, h, a, z, { ...extras, memberId, cutStart: cs, cutEnd: ce });
    const scheme = p.joints.spliceScheme,
      lap = scheme === "fishplate" ? 0 : p.joints.spliceLength,
      vector = z.map((v, i) => (v - a[i]) / length),
      parts = [],
      joints = [];
    let from = 0,
      index = 0;
    if (length <= 2 * lap + 0.02 && length + allowance(cs, h) + allowance(ce, h) > stock) {
      warnings.push(
        `Косые торцы элемента ${name} не помещаются в заготовку 6 м при выбранном нахлёсте. Элемент оставлен длинным без вымышленного продолжения.`,
      );
      return raw(name, category, role, b, h, a, z, { ...extras, memberId, cutStart: cs, cutEnd: ce });
    }
    const at = (s) => a.map((v, i) => v + vector[i] * s);
    while (from < length - EPS) {
      const startCut = index
        ? {
            scheme,
            angle: scheme === "scarf" ? (Math.atan2(h / 1000, p.joints.spliceLength) * 180) / Math.PI : 0,
            lapLength: lap,
            lapSide: "top",
          }
        : cs;
      const remaining = length - from,
        canFinish = remaining + allowance(startCut, h) + allowance(ce, h) <= stock + EPS;
      const span = canFinish ? remaining : Math.min(stock - allowance(startCut, h), remaining - lap - 0.02),
        to = from + span;
      const endCut = canFinish
        ? ce
        : {
            scheme,
            angle: scheme === "scarf" ? (Math.atan2(h / 1000, p.joints.spliceLength) * 180) / Math.PI : 0,
            lapLength: lap,
            lapSide: "bottom",
          };
      const board = raw(name, category, role, b, h, at(from), at(to), {
        ...extras,
        ...(extras.cornerEndJoints
          ? {
              cornerEndJoints: extras.cornerEndJoints.filter((j) =>
                j.end === "start" ? index === 0 : canFinish,
              ),
            }
          : {}),
        id: memberId + "-P" + (index + 1),
        memberId,
        partIndex: index,
        cutStart: startCut,
        cutEnd: endCut,
        spliceIds: [],
      });
      parts.push(board);
      if (index) {
        const jointId = memberId + "-J" + index;
        const prev = parts[index - 1];
        prev.cutEnd.jointId = jointId;
        board.cutStart.jointId = jointId;
        prev.spliceIds.push(jointId);
        board.spliceIds.push(jointId);
        const q = at(from + lap / 2),
          requiresSupport =
            ["joist", "customBeam", "truss", "bottomChord", "chord", "rafter"].includes(role) ||
            category === "roof";
        const joint = {
          id: jointId,
          role,
          memberId,
          scheme,
          lapLength: scheme === "fishplate" ? p.joints.spliceLength : lap,
          point: q,
          partIds: [prev.id, board.id],
          requiresSupport,
          verified: false,
        };
        splices.push(joint);
        joints.push(joint);
        if (scheme === "fishplate")
          for (const side of [-1, 1]) {
            const ext = p.joints.spliceLength,
              aa = at(from - ext),
              zz = at(from + ext),
              axis = extras.crossAxis || [1, 0, 0];
            for (let k = 0; k < 3; k++) {
              aa[k] += axis[k] * side * (b / 2000 + 0.01);
              zz[k] += axis[k] * side * (b / 2000 + 0.01);
            }
            raw("Накладка стыка", category, "fishplate", 20, 100, aa, zz, {
              ...extras,
              id: jointId + "-F" + (side < 0 ? 1 : 2),
              memberId: jointId,
              jointId,
              spliceIds: [jointId],
            });
          }
      }
      if (canFinish) break;
      from = to - lap;
      index++;
      if (index > 1000) throw Error("Не удалось разбить длинный элемент.");
    }
    warnings.push(
      `Наращивание ${name}: ${parts.length} доски, ${scheme}. Силовая работа стыков не подтверждена${joints.some((j) => j.requiresSupport) ? "; расположение стыка требует опоры или отдельного расчёта" : ""}.`,
    );
  }
  for (const w of p.walls) {
    if (isBeamWall(w)) continue;
    const profile = p._wallProfiles?.find((q) => q.wallId === w.id && q.mode === "continuous"),
      { b, h } = parseSection(profile?.section ?? w.section),
      B = b / 1000,
      D = h / 1000,
      len = dist(w.a, w.b),
      u = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len },
      v = { x: -u.y, y: u.x };
    const at = (s, y) => [w.a.x + u.x * s, y, w.a.y + u.y * s],
      extra = { wallId: w.id, crossAxis: [u.x, 0, u.y] };
    const wallCorners = corners.filter((c) => c.wallIds.includes(w.id));
    function cutAt(s) {
      const c = wallCorners.find((c) => dist(lerp(w.a, w.b, s / len), c.point) < 1e-5);
      return {
        scheme: c?.cutScheme || "butt",
        angle: c?.cutScheme === "miter" ? c.cutAngle : 0,
        ...(["halfLap", "half-lap"].includes(c?.cutScheme) ? { recessDepth: B / 2 } : {}),
      };
    }
    for (let f = 0; f < p.floors; f++) {
      const y0 = base + platform + f * story,
        low = y0 + B;
      const wallHeight = w.height ?? p.height,
        topAt = (s) => (profile ? wallProfileTop(profile, s) : y0 + wallHeight);
      const slopeAt = (s) => {
        if (!profile) return 0;
        const points = profile.topSamples;
        for (let i = 1; i < points.length; i++)
          if (s <= points[i].s + EPS)
            return (points[i].topY - points[i - 1].topY) / (points[i].s - points[i - 1].s);
        return 0;
      };
      const highAt = (s) => topAt(s) - 2 * B * Math.sqrt(1 + slopeAt(s) ** 2),
        high = highAt(len / 2);
      const os = p.openings
        .filter((o) => o.wallId === w.id && (o.floor ?? 1) === f + 1)
        .sort((a, b) => a.offset - b.offset);
      function plate(a, z, y, position = "top", layer = 0) {
        const layout = wallPlateEnds(w, wallCorners, wallMap, { position, layer }),
          from = Math.abs(a) < EPS ? layout.start : a,
          to = Math.abs(z - len) < EPS ? layout.end : z;
        add("Обвязка стены", "walls", "plate", b, h, at(from, y), at(to, y), {
          ...extra,
          floor: f + 1,
          crossAxis: [0, 1, 0],
          cutStart: cutAt(a),
          cutEnd: cutAt(z),
          platePosition: position,
          plateLayer: layer,
          cornerEndJoints: layout.joints.filter((j) =>
            j.end === "start" ? Math.abs(a) < EPS : Math.abs(z - len) < EPS,
          ),
        });
      }
      const doors = os.filter((o) => o.type === "door" && o.sill < EPS);
      let start = 0;
      for (const o of doors) {
        plate(start, o.offset, y0 + B / 2, "bottom");
        start = o.offset + o.width;
      }
      plate(start, len, y0 + B / 2, "bottom");
      if (profile) {
        for (let i = 1; i < profile.topSamples.length; i++) {
          const a = profile.topSamples[i - 1],
            z = profile.topSamples[i],
            slope = (z.topY - a.topY) / (z.s - a.s),
            scale = Math.sqrt(1 + slope * slope);
          for (const layer of [0.5, 1.5])
            add(
              "Верхняя обвязка цельной стены",
              "walls",
              "plate",
              b,
              h,
              at(a.s, a.topY - layer * B * scale),
              at(z.s, z.topY - layer * B * scale),
              {
                ...extra,
                floor: f + 1,
                crossAxis: [0, 1, 0],
                cutStart: cutAt(a.s),
                cutEnd: cutAt(z.s),
                fullHeightWall: true,
                platePosition: "top",
              },
            );
        }
      } else {
        plate(0, len, y0 + wallHeight - 1.5 * B, "top", 0);
        plate(0, len, y0 + wallHeight - B / 2, "top", 1);
      }
      const vertical = (s, a, z, role = "stud") => {
        const slope = profile && Math.abs(z - highAt(s)) < 0.001 ? slopeAt(s) : 0;
        add(
          {
            stud: "Рядовая стойка",
            king: "Коренная стойка",
            jack: "Подперемычечная стойка",
            cripple: "Короткая стойка",
          }[role],
          "walls",
          role,
          b,
          h,
          at(s, a),
          at(s, z),
          {
            ...extra,
            floor: f + 1,
            fullHeightWall: !!profile,
            requireSingleStock: !!profile,
            cutEnd:
              Math.abs(slope) > EPS
                ? {
                    scheme: "miter",
                    angle: Math.abs((Math.atan(slope) * 180) / Math.PI),
                    tiltSign: Math.sign(slope),
                    plane: "width",
                    cutWidthMM: b,
                  }
                : { scheme: "butt", angle: 0 },
          },
        );
      };
      const firstStud = w.endpointMode === "faces" ? B / 2 : 0,
        lastStud = w.endpointMode === "faces" ? len - B / 2 : len,
        count = Math.max(1, Math.ceil((lastStud - firstStud) / w.studStep));
      for (let i = 0; i <= count; i++) {
        const s = firstStud + ((lastStud - firstStud) * i) / count;
        if (wallCorners.some((c) => Math.abs(parameter(c.point, w.a, w.b) * len - s) < D + 2 * B)) continue;
        const o = os.find((o) => s > o.offset - 2 * B - EPS && s < o.offset + o.width + 2 * B + EPS);
        if (!o) vertical(s, low, highAt(s));
        else if (s > o.offset + EPS && s < o.offset + o.width - EPS) {
          if (o.sill > 2 * B) vertical(s, low, y0 + o.sill - B, "cripple");
          if (highAt(s) > y0 + o.sill + o.height + 0.2)
            vertical(s, y0 + o.sill + o.height + 0.2, highAt(s), "cripple");
        }
      }
      for (const o of os) {
        const bottom = y0 + o.sill,
          top = bottom + o.height;
        for (const side of [-1, 1]) {
          const edge = side < 0 ? o.offset : o.offset + o.width;
          vertical(edge + side * 1.5 * B, low, highAt(edge + side * 1.5 * B), "king");
          vertical(edge + side * 0.5 * B, low, top, "jack");
        }
        for (const side of [-1, 1]) {
          const a = at(o.offset - B, top + 0.1),
            z = at(o.offset + o.width + B, top + 0.1),
            offset = side * (D / 2 - B / 2);
          a[0] += v.x * offset;
          a[2] += v.y * offset;
          z[0] += v.x * offset;
          z[2] += v.y * offset;
          add("Доска перемычки", "walls", "header", b, 200, a, z, {
            ...extra,
            floor: f + 1,
            openingId: o.id,
            crossAxis: [v.x, 0, v.y],
          });
        }
        if (o.sill > 2 * B)
          add(
            "Подоконная доска",
            "walls",
            "sill",
            b,
            h,
            at(o.offset, bottom - B / 2),
            at(o.offset + o.width, bottom - B / 2),
            { ...extra, floor: f + 1, openingId: o.id, crossAxis: [0, 1, 0] },
          );
        if (
          wallCorners.some((c) => {
            const s = parameter(c.point, w.a, w.b) * len;
            return s > o.offset - D - 2 * B && s < o.offset + o.width + D + 2 * B;
          })
        )
          warnings.push(
            `Проём ${o.id} близко к узлу: пакет и обрамление могут пересекаться; узел требуется уточнить.`,
          );
      }
    }
  }
  for (const c of corners) {
    if (c.wallIds.some((id) => isBeamWall(wallMap.get(id)))) continue;
    const w = wallMap.get(c.wallIds[0]),
      profiles = (p._wallProfiles ?? []).filter(
        (q) => q.mode === "continuous" && c.wallIds.includes(q.wallId),
      ),
      cornerSection = profiles.map((q) => parseSection(q.section)).sort((a, b) => b.h - a.h)[0],
      { b, h } = cornerSection ?? parseSection(w.section),
      B = b / 1000,
      D = h / 1000;
    const u = c.directions[0] || { x: 1, y: 0 };
    let v = c.directions.find((d) => Math.abs(dot(d, u)) < 0.1) || { x: -u.y, y: u.x };
    if (Math.abs(dot(u, v)) > 0.01) {
      v = { x: -u.y, y: u.x };
      warnings.push(`Узел ${c.id}: ориентация пакета показана условно по первой стене.`);
    }
    const count = c.kind === "straight" ? 2 : { california2: 2, three3: 3, closed4: 4 }[c.type];
    for (let f = 0; f < p.floors; f++)
      for (let i = 0; i < count; i++) {
        const aa = i === 0 ? B / 2 : i === 1 ? B + D / 2 : i === 2 ? D + 1.5 * B : B + D / 2,
          bb = i === 0 ? D / 2 : i === 1 ? B / 2 : i === 2 ? D / 2 : D - B / 2;
        const x = c.point.x + u.x * (aa - D / 2) + v.x * (bb - D / 2),
          z = c.point.y + u.y * (aa - D / 2) + v.y * (bb - D / 2),
          low = base + platform + f * story + B,
          high =
            Math.max(
              base +
                platform +
                f * story +
                Math.max(...c.wallIds.map((id) => wallMap.get(id)?.height ?? p.height)),
              ...profiles.map((q) => {
                const wall = wallMap.get(q.wallId);
                return wallProfileTop(
                  q,
                  Math.max(0, Math.min(q.length, parameter(c.point, wall.a, wall.b) * q.length)),
                );
              }),
            ) -
            2 * B,
          axis = i === 1 || i === 3 ? v : u;
        add(
          c.kind === "corner" ? "Стойка углового пакета" : "Стойка пакета стыка",
          "walls",
          "corner",
          b,
          h,
          [x, low, z],
          [x, high, z],
          {
            cornerId: c.id,
            wallIds: c.wallIds,
            fullHeightWall: profiles.length > 0,
            requireSingleStock: profiles.length > 0,
            floor: f + 1,
            crossAxis: [axis.x, 0, axis.y],
            cutStart: { scheme: "butt", angle: 0 },
            cutEnd: { scheme: "butt", angle: 0 },
          },
        );
      }
  }
  if (graph.closed) {
    // Physical platform boards are generated once by buildFloorPlatform.
    for (const v of p._voids || []) {
      if ((p._floorOpenings ?? []).some((o) => o.voidId === v.id && o.replaceLegacy)) continue;
      const section = parseSection(v.edgeSection),
        y = base + floorSection.h / 1000 - section.h / 2000;
      for (let i = 0; i < v.polygon.length; i++) {
        const a = v.polygon[i],
          z = v.polygon[(i + 1) % v.polygon.length],
          length = dist(a, z),
          dx = (z.x - a.x) / length,
          dz = (z.y - a.y) / length;
        add(
          v.kind === "doubleHeight" ? "Обрамление второго света" : "Обрамление проёма перекрытия",
          "floor",
          "voidHeader",
          section.b,
          section.h,
          [a.x, y, a.y],
          [z.x, y, z.y],
          { voidId: v.id, floor: 1, crossAxis: [-dz, 0, dx] },
        );
      }
      warnings.push(
        `Обрамление проёма ${v.id}: соединения, опирание и удвоенные балки требуют отдельного расчёта.`,
      );
    }
  }
  for (const o of p.objects) {
    const { b, h } = parseSection(o.section),
      y = base + platform + (o.elevation ?? (o.type === "beam" ? p.height : 0));
    if (o.type === "post")
      add(
        "Отдельная стойка",
        "objects",
        "post",
        b,
        h,
        [o.a.x, y, o.a.y],
        [o.a.x, y + (o.height ?? p.height), o.a.y],
        { objectId: o.id },
      );
    else {
      const len = dist(o.a, o.b),
        dx = (o.b.x - o.a.x) / len,
        dz = (o.b.y - o.a.y) / len;
      add("Отдельная балка", "objects", "customBeam", b, h, [o.a.x, y, o.a.y], [o.b.x, y, o.b.y], {
        objectId: o.id,
        crossAxis: [-dz, 0, dx],
      });
    }
  }
  if (p.objects.length)
    warnings.push(
      "Отдельные стойки и балки включены в массу, но не считаются автоматическими опорами перекрытия; передача нагрузки и узлы требуют задания.",
    );
  let roofVerified = false;
  if (roofModel && Array.isArray(roofModel.instances)) {
    let accepted = 0;
    for (const board of roofModel.instances) {
      const a = board.start,
        z = board.end;
      if (
        !Array.isArray(a) ||
        !Array.isArray(z) ||
        a.length !== 3 ||
        z.length !== 3 ||
        ![...a, ...z, board.b, board.h].every(finite) ||
        board.b <= 0 ||
        board.h <= 0
      )
        continue;
      const before = instances.length;
      add(board.name || "Доска кровли", "roof", board.role || "truss", board.b, board.h, a, z, {
        zoneId: board.zoneId,
        barId: board.barId,
        trussRow: board.trussRow,
        rafterRow: board.rafterRow,
        bearingStart: board.bearingStart,
        bearingEnd: board.bearingEnd,
        supportStart: board.supportStart,
        supportEnd: board.supportEnd,
        supportLowStation: board.supportLowStation,
        supportHighStation: board.supportHighStation,
        tributaryWidth: board.tributaryWidth,
        supportGeometry: board.supportGeometry,
        wallId: board.wallId,
        connectionVerified: board.connectionVerified,
        reason: board.reason,
        sourceBoardId: board.id,
        ...Object.fromEntries(
          [
            "shape",
            "shapeNetVolume",
            "shapeGrossVolume",
            "shapeCutLength",
            "massCenter",
            "collarConnection",
            "outOfPlaneOffset",
            "connectionIds",
            "frameMemberId",
            "frameElementIds",
            "tiedRafters",
            "physicalTruss",
            "requireSingleStock",
            "auxiliaryFaceId",
            "trussBarId",
            "trussBarIds",
            "force",
            "axialForce",
            "physicalDatum",
            "rafterJointId",
            "startCutPlane",
            "endCutPlane",
            "overhangLow",
            "overhangHigh",
          ]
            .filter((k) => board[k] !== undefined)
            .map((k) => [k, board[k]]),
        ),
        level: board.level ?? board.floor,
        floor: board.floor ?? board.level,
        crossAxis: board.crossAxis || [1, 0, 0],
        cutStart: board.cutStart,
        cutEnd: board.cutEnd,
      });
      if (finite(board.shapeNetVolume) && board.shapeNetVolume >= 0)
        for (const part of instances.slice(before)) {
          part.volume = part.netVolume = board.shapeNetVolume;
          part.mass = part.volume * p.material.density;
          if (finite(board.shapeGrossVolume)) part.grossVolume = board.shapeGrossVolume;
          if (finite(board.shapeCutLength)) part.cutLength = part.actualCutLength = board.shapeCutLength;
        }
      accepted++;
    }
    roofVerified = accepted > 0 && accepted === roofModel.instances.length;
    if (accepted !== roofModel.instances.length)
      warnings.push("Некорректные доски зонной кровли пропущены: её масса неполна.");
  } else if (graph.closed && p.roof.type !== "none" && truss) {
    const nodes = Array.isArray(truss.nodes) ? truss.nodes : [],
      bars = Array.isArray(truss.bars) ? truss.bars : [],
      map = new Map(nodes.map((n, i) => [n.id ?? i, n]));
    const get = (n) => (typeof n === "object" ? n : map.get(n)),
      nLines = Math.max(1, Math.ceil(bounds.width / p.roof.spacing)),
      eave = base + platform + (p.floors - 1) * story + p.height;
    let validBars = 0;
    for (let row = 0; row <= nLines; row++)
      for (const bar of bars) {
        const a = get(bar.nodeA ?? bar.a ?? bar.start ?? bar.from),
          z = get(bar.nodeB ?? bar.end ?? bar.to ?? (typeof bar.b === "string" ? bar.b : undefined));
        const sec = bar.section
          ? parseSection(bar.section)
          : {
              b:
                bar.breadth ??
                bar.width ??
                bar.bmm ??
                (finite(bar.b) ? bar.b : parseSection(p.roof.chordSection).b),
              h: bar.depth ?? bar.h ?? parseSection(p.roof.chordSection).h,
            };
        if (!point(a) || !point(z) || !sec || !finite(sec.b) || !finite(sec.h) || sec.b <= 0 || sec.h <= 0)
          continue;
        const x = bounds.minX + (bounds.width * row) / nLines;
        add(
          bar.name || "Доска фермы",
          "roof",
          bar.role || "truss",
          sec.b,
          sec.h,
          [x, eave + a.y, bounds.minY + a.x],
          [x, eave + z.y, bounds.minY + z.x],
          {
            trussRow: row,
            crossAxis: [1, 0, 0],
            cutStart: bar.cutStart || { scheme: "butt", angle: 0 },
            cutEnd: bar.cutEnd || { scheme: "butt", angle: 0 },
          },
        );
        validBars++;
      }
    roofVerified = validBars > 0 && validBars === bars.length * (nLines + 1);
    if (validBars > 0 && !roofVerified)
      warnings.push(
        "Часть стержней переданной фермы некорректна и пропущена. Древесина кровли и её вес неполны.",
      );
    if (!validBars)
      warnings.push(
        "Переданная ферма не содержит поддерживаемых узлов/стержней. Древесина кровли не добавлена.",
      );
  }
  for (const item of p._extraInstances ?? []) {
    const {
      id,
      name,
      category,
      role,
      b,
      h,
      start,
      end,
      length,
      volume,
      mass,
      grossVolume,
      netVolume,
      cutLength,
      actualCutLength,
      section,
      scheduleId,
      ...meta
    } = item;
    const before = instances.length;
    add(name ?? "Элемент жёсткости", category ?? "bracing", role ?? "brace", b, h, start, end, {
      ...meta,
      id,
    });
    if (finite(meta.shapeNetVolume) && meta.shapeNetVolume >= 0)
      for (const board of instances.slice(before)) {
        board.volume = board.netVolume = meta.shapeNetVolume;
        board.mass = board.volume * p.material.density;
        if (finite(meta.shapeGrossVolume)) board.grossVolume = meta.shapeGrossVolume;
        if (finite(meta.shapeCutLength)) board.cutLength = board.actualCutLength = meta.shapeCutLength;
      }
  }
  if (p.roof.type !== "none" && !roofVerified)
    warnings.push(
      "Древесина кровли не сформирована: передайте рассчитанную геометрию фермы. Её масса пока не учтена.",
    );
  const schedule = [...scheduleMap.values()],
    volume = sum(instances.map((x) => x.volume)),
    mass = sum(instances.map((x) => x.mass));
  const totals = Object.fromEntries(
    ["foundation", "walls", "floor", "roof", "bracing", "objects", "spatial"].map((k) => {
      const a = instances.filter((x) => x.category === k);
      return [
        k,
        {
          count: a.length,
          volume: sum(a.map((x) => x.volume)),
          mass: sum(a.map((x) => x.mass)),
          weight: (sum(a.map((x) => x.mass)) * G) / 1000,
        },
      ];
    }),
  );
  const overStock = instances.filter((x) => x.cutLength > p.cutting.stockLength + EPS);
  if (overStock.length)
    warnings.push(
      `${overStock.length} досок длиннее 6 м; схема наращивания отключена или геометрия не помещается.`,
    );
  return {
    instances,
    schedule,
    volume,
    mass,
    weight: (mass * G) / 1000,
    totals,
    boardCount: instances.length,
    density: p.material.density,
    braceBays,
    roofGeometryAvailable: roofVerified,
    platformHeight: platform,
    storyHeight: story,
    splices,
    overStock,
    stockLength: p.cutting.stockLength,
    grossVolume: sum(instances.map((x) => x.grossVolume)),
  };
}
function mergeTimber(models, p) {
  const instances = models.flatMap((m) => m.instances),
    scheduleMap = new Map();
  for (const b of instances) {
    const key = JSON.stringify([b.name, b.category, b.role, b.b, b.h, coord(b.length), b.cutStart, b.cutEnd]);
    let row = scheduleMap.get(key);
    if (!row) {
      row = {
        id: "T" + String(scheduleMap.size + 1).padStart(4, "0"),
        name: b.name,
        category: b.category,
        role: b.role,
        b: b.b,
        h: b.h,
        section: `${b.b} × ${b.h}`,
        length: b.length,
        count: 0,
        volume: 0,
        mass: 0,
        massEach: b.mass,
        volumeEach: b.volume,
      };
      scheduleMap.set(key, row);
    }
    row.count++;
    row.volume += b.volume;
    row.mass += b.mass;
    b.scheduleId = row.id;
  }
  const mass = sum(instances.map((b) => b.mass)),
    volume = sum(instances.map((b) => b.volume));
  const totals = Object.fromEntries(
    ["foundation", "walls", "floor", "roof", "bracing", "objects", "spatial"].map((category) => {
      const rows = instances.filter((b) => b.category === category),
        m = sum(rows.map((b) => b.mass));
      return [
        category,
        { count: rows.length, volume: sum(rows.map((b) => b.volume)), mass: m, weight: (m * G) / 1000 },
      ];
    }),
  );
  return {
    instances,
    schedule: [...scheduleMap.values()],
    volume,
    mass,
    weight: (mass * G) / 1000,
    totals,
    boardCount: instances.length,
    density: p.material.density,
    braceBays: models.flatMap((m) => m.braceBays),
    roofGeometryAvailable: models.some((m) => m.roofGeometryAvailable),
    platformHeight: parseSection(p.floor.section).h / 1000 + 0.035,
    storyHeight: p.height + parseSection(p.floor.section).h / 1000 + 0.035,
    splices: models.flatMap((m) => m.splices),
    overStock: models.flatMap((m) => m.overStock),
    stockLength: 6,
    grossVolume: sum(instances.map((b) => b.grossVolume)),
  };
}

/** Rows of whole trusses that bear on two eave lines. Physical trusses keep
 * their solved rows; idealised FEM trusses (default fink/king/queen/mono) get
 * one row per frame position at the zone bearing lines. */
function trussRoutingRows(z) {
  if (z.physicalTruss && z.trussRows?.length) return { rows: z.trussRows, kind: "physical" };
  if (
    z.effectiveFraming !== "truss" ||
    !z.analysis?.stable ||
    !z.analysisApplicable ||
    z.partialFrames ||
    !["gable", "mono"].includes(z.shape) ||
    !z.rafterRowLoads?.length
  )
    return null;
  const theta = (z.ridgeAngle * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta),
    world = (u, v) => [u * c - v * s, z.eave ?? 0, u * s + v * c];
  return {
    kind: "fem",
    rows: z.rafterRowLoads.map((r) => ({
      row: r.row,
      u: r.u,
      tributaryWidth: r.tributaryWidth,
      bearingStart: world(r.u, z.bounds.minV),
      bearingEnd: world(r.u, z.bounds.maxV),
    })),
  };
}

function pileField(p, geometry, walls, timber, loads, grillageModel, wallLoadTransfers, floorPlatform) {
  const factors = loads.factors ?? loadFactors(p.loads),
    snowBase = snowBasis(p.loads).base,
    profile = loadProfile(p.loads),
    spacing = p.foundation.spacing,
    samples = [];
  const routedWalls = new Set(wallLoadTransfers?.routedWallLayerIds ?? []),
    routedBoards = new Set(wallLoadTransfers?.routedBoardIds ?? []);
  // kind: timber | layers | live | snow. Design values are assigned per
  // load combination at the end, so every sample carries characteristic only.
  function distribute(q, characteristic, kind, area = 0, beamId, extra = {}) {
    if (!characteristic && !area) return;
    samples.push({ point: q, characteristic, kind, area, beamId, ...extra });
  }
  // ---- Floors (A2): joist support reactions, not nearest-span area sampling.
  const sampleStep = Math.max(0.2, Math.min(0.75, spacing / 2));
  let sampleCount = 0;
  const axisKey = (p.floor?.axis ?? "y") === "x" ? "x" : "y",
    station = (q) => q[axisKey],
    platformSpans = floorPlatform?.spans ?? [],
    joistParts = new Map(),
    floorRouting = { method: "joist-reactions", levels: [] },
    routedJoistBoards = new Set();
  for (const b of timber.instances)
    if (b.role === "joist" && b.category === "floor" && !b.annexId) {
      const id = b.platformSpanId ?? b.memberId;
      if (!id) continue;
      if (!joistParts.has(id)) joistParts.set(id, []);
      joistParts.get(id).push(b);
    }
  const supportBeam = (support) => (support?.kind === "grillage" ? support.sourceId : undefined);
  function joistRoute(level) {
    const spans = platformSpans.filter((s) => s.level === level.index);
    if (!spans.length) return { reason: "Нет лаг перекрытия этого этажа." };
    const entries = [];
    for (const span of spans) {
      if (span.supportStatus === "fail")
        return { reason: `Лага ${span.memberId} не имеет двух подтверждённых опор.` };
      const parts = joistParts.get(span.id) ?? [],
        trib = parts[0]?.tributaryWidth ?? parts[0]?.actualSpacing ?? p.floor.spacing,
        a = station(span.physicalStart),
        z = station(span.physicalEnd),
        lo = Math.min(a, z),
        hi = Math.max(a, z),
        sA = station(span.start),
        sZ = station(span.end),
        A = span.supportStart,
        Z = span.supportEnd;
      if (!(hi - lo > EPS) || !(trib > EPS) || Math.abs(sZ - sA) < EPS)
        return { reason: `Лага ${span.memberId}: нулевой пролёт или грузовая ширина.` };
      const lever = (c) => {
        const fA = (sZ - c) / (sZ - sA);
        return [
          { point: span.start, f: fA, beamId: supportBeam(A), sourceId: A?.sourceId, kind: A?.kind },
          { point: span.end, f: 1 - fA, beamId: supportBeam(Z), sourceId: Z?.sourceId, kind: Z?.kind },
        ];
      };
      // A perimeter joist lying on one continuous grillage beam: uniform contact.
      const backed =
        span.supportStatus !== "pass" &&
        A?.kind === "grillage" &&
        Z?.kind === "grillage" &&
        A.sourceId === Z.sourceId;
      let points;
      if (backed) {
        const n = Math.max(1, Math.ceil((hi - lo) / 0.5));
        points = Array.from({ length: n }, (_, i) => ({
          point: lerp(span.physicalStart, span.physicalEnd, (i + 0.5) / n),
          f: 1 / n,
          beamId: A.sourceId,
          sourceId: A.sourceId,
          kind: A.kind,
        }));
      } else points = lever((lo + hi) / 2);
      if (points.some((q) => q.f < -EPS))
        return { reason: `Лага ${span.memberId}: консоль даёт отрыв опоры.` };
      entries.push({
        span,
        parts,
        trib,
        length: hi - lo,
        lo,
        hi,
        points,
        lever: backed ? null : lever,
        backed,
      });
    }
    const raw = sum(entries.map((e) => e.trib * e.length)),
      deadArea = level.platformNetArea ?? level.netFloorArea,
      liveArea = level.netFloorArea,
      ratio = deadArea / raw;
    if (!(raw > EPS) || ratio < 0.75 || ratio > 1.33)
      return {
        reason: `Грузовые площади лаг (${raw.toFixed(2)} м²) не согласуются с площадью платформы (${deadArea.toFixed(2)} м²).`,
      };
    return { entries, raw, deadArea, liveArea };
  }
  for (const level of geometry.levels.filter((l) => l.closed && l.netFloorArea > EPS)) {
    const route = joistRoute(level);
    if (route.entries) {
      const deadScale = route.deadArea / route.raw,
        liveScale = route.liveArea / route.raw,
        supportTotals = {};
      for (const e of route.entries) {
        const tributary = e.trib * e.length,
          dead = p.loads.floorDead * tributary * deadScale,
          live = p.loads.live * tributary * liveScale,
          area = tributary * liveScale;
        for (const q of e.points) {
          const extra = { floorLevel: level.index, joistSpanId: e.span.id };
          distribute(q.point, dead * q.f, "layers", 0, q.beamId, extra);
          distribute(q.point, live * q.f, "live", area * q.f, q.beamId, extra);
          const key = (q.kind ?? "support") + ":" + (q.sourceId ?? "?");
          supportTotals[key] = (supportTotals[key] ?? 0) + (dead + live) * q.f;
        }
        sampleCount += e.points.length;
        // Joist self-weight follows the same two supports.
        for (const board of e.parts) {
          if (routedBoards.has(board.id)) continue;
          const W = (board.mass * G) / 1000,
            c =
              (station({ x: board.start[0], y: board.start[2] }) +
                station({ x: board.end[0], y: board.end[2] })) /
              2,
            pts = e.lever ? e.lever(c) : e.points.map((q) => ({ ...q, f: 1 / e.points.length }));
          if (pts.some((q) => q.f < -EPS)) continue;
          for (const q of pts) distribute(q.point, W * q.f, "timber", 0, q.beamId, { boardId: board.id });
          routedJoistBoards.add(board.id);
        }
      }
      floorRouting.levels.push({
        level: level.index,
        method: "joist-reactions",
        spans: route.entries.length,
        tributaryArea: route.raw,
        platformArea: route.deadArea,
        floorArea: route.liveArea,
        dead: p.loads.floorDead * route.deadArea,
        live: p.loads.live * route.liveArea,
        // characteristic floor layers + live delivered to each real support (kind:id)
        supportTotals,
      });
      continue;
    }
    // Fallback: legacy area quadrature to the nearest grillage span.
    floorRouting.levels.push({ level: level.index, method: "area-nearest-span", reason: route.reason });
    for (const surface of [
      {
        polygon: level.platformPolygon ?? level.polygon,
        bounds: level.platformBounds ?? level.bounds,
        area: level.platformNetArea ?? level.netFloorArea,
        pressure: p.loads.floorDead,
        kind: "layers",
        countArea: false,
      },
      {
        polygon: level.polygon,
        bounds: level.bounds,
        area: level.netFloorArea,
        pressure: p.loads.live,
        kind: "live",
        countArea: true,
      },
    ]) {
      const bounds = surface.bounds,
        sx = Math.max(1, Math.ceil(bounds.width / sampleStep)),
        sy = Math.max(1, Math.ceil(bounds.height / sampleStep)),
        points = [];
      for (let i = 0; i < sx; i++)
        for (let j = 0; j < sy; j++) {
          const q = {
            x: bounds.minX + (bounds.width * (i + 0.5)) / sx,
            y: bounds.minY + (bounds.height * (j + 0.5)) / sy,
          };
          if (pointInPolygon(q, surface.polygon) && !level.voids.some((v) => pointInPolygon(q, v.polygon)))
            points.push(q);
        }
      if (!points.length) {
        const intervals = interiorIntervals(
            surface.polygon,
            bounds.minX + Math.min(0.01, bounds.width / 4),
            "y",
          ),
          interval = intervals[0];
        if (interval) points.push({ x: bounds.minX + 0.001, y: (interval[0] + interval[1]) / 2 });
      }
      if (!points.length) continue;
      sampleCount += points.length;
      const da = surface.area / points.length;
      for (const q of points) distribute(q, da * surface.pressure, surface.kind, surface.countArea ? da : 0);
    }
  }
  const exterior = walls.filter((w) => w.kind === "exterior"),
    perimeter = sum(exterior.map((w) => w.length));
  const windPressure = loads.windPressure?.wm ?? 0,
    upliftCases = (pl, pr) => roofUpliftCases(pl, pr, profile),
    uplift = [];
  // For rectangular standalone rafter zones, transfer vertical gravity at the
  // real rafter ends with actual edge tributaries. Asymmetric snow therefore
  // follows its own zone instead of being spread around the entire perimeter.
  let assignedLayers = 0,
    assignedTimber = 0,
    assignedSnow = 0;
  const routedZoneIds = new Set();
  for (const z of loads.roofZones ?? []) {
    const rafters = (loads.rawRoofInstances ?? []).filter((b) => b.zoneId === z.id && b.role === "rafter");
    if (z.effectiveFraming !== "rafters" || !z.analysisApplicable || !rafters.length) continue;
    const theta = (z.ridgeAngle * Math.PI) / 180,
      u = (q) => q[0] * Math.cos(theta) + q[2] * Math.sin(theta),
      rows = rafters.map((b) => ({ b, at: (u(b.start) + u(b.end)) / 2 })).sort((a, b) => a.at - b.at),
      min = z.bounds.minU,
      max = z.bounds.maxU;
    const reaction = z.rafterAnalysis?.reactions,
      RA = reaction?.serviceVerticalA ?? reaction?.verticalA,
      RB = reaction?.serviceVerticalB ?? reaction?.verticalB,
      ratio = finite(RA) && finite(RB) && RA + RB > EPS ? RA / (RA + RB) : 0.5;
    // The grillage screen accepts downward loads only. Never clamp uplift into
    // a fictitious bearing reaction; preserve a diagnostic and use its existing
    // perimeter allocation without pretending an uplift load path was solved.
    if (ratio < 0 || ratio > 1) {
      (loads.roofSupportRoutingIssues ??= []).push(z.id);
      continue;
    }
    const rowWidths = rows.map(
        (r, i) =>
          r.b.tributaryWidth ??
          (i < rows.length - 1 ? (rows[i].at + rows[i + 1].at) / 2 : max) -
            (i ? (rows[i - 1].at + rows[i].at) / 2 : min),
      ),
      width = sum(rowWidths);
    const wood =
        (sum(timber.instances.filter((b) => b.category === "roof" && b.zoneId === z.id).map((b) => b.mass)) *
          G) /
        1000,
      layers = z.surfaceArea * p.loads.roofDead,
      snow = snowBase * z.snowEffectiveArea,
      windUp =
        windPressure *
        factors.wind *
        Math.max(0, ...upliftCases(z.pitchLeft, z.pitchLeft).map((c) => c.left)) *
        (z.coverBounds?.length ?? z.bounds.length) *
        (z.coverBounds?.span ?? z.bounds.span);
    let worst = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const share = rowWidths[i] / width,
        ends = [rows[i].b.bearingStart ?? rows[i].b.start, rows[i].b.bearingEnd ?? rows[i].b.end];
      for (let k = 0; k < 2; k++) {
        const end = ends[k],
          q = { x: end[0], y: end[2] },
          r = k === 0 ? ratio : 1 - ratio;
        distribute(q, layers * share * r, "layers", 0, undefined, { roofZoneId: z.id });
        distribute(q, wood * share * r, "timber", 0, undefined, { roofZoneId: z.id });
        distribute(q, snow * share * r, "snow", 0, undefined, { roofZoneId: z.id });
        worst = Math.max(worst, windUp * share * 0.5 - factors.favourable * (layers + wood) * share * r);
      }
    }
    uplift.push({ zoneId: z.id, framing: "rafters", rows: rows.length, netUpliftPerSupport: worst });
    assignedLayers += layers;
    assignedTimber += wood;
    assignedSnow += snow;
    routedZoneIds.add(z.id);
  }
  // Whole trusses have two real eave bearings. Eave weight/snow remain outside
  // the support span, so their moments change the reactions. Idealised FEM
  // trusses (default fink, no overhang) use the same two-bearing statics.
  for (const z of loads.roofZones ?? []) {
    const routing = trussRoutingRows(z);
    if (!routing || !z.analysisApplicable) continue;
    const theta = (z.ridgeAngle * Math.PI) / 180,
      c = Math.cos(theta),
      sn = Math.sin(theta),
      U = (q) => q[0] * c + q[2] * sn,
      V = (q) => -q[0] * sn + q[2] * c,
      b = z.bounds,
      supportMinV = z.frameSupportBounds?.minV ?? b.minV,
      supportMaxV = z.frameSupportBounds?.maxV ?? b.maxV,
      S = supportMaxV - supportMinV,
      roofSpan = b.maxV - b.minV,
      coverWidth = z.coverBounds.length,
      crest = b.minV + z.crestRatio * roofSpan,
      o = z.overhangs,
      shape = (pitch) => z.snowMu ?? snowShapeMu(pitch, profile),
      pitchRight = z.shape === "mono" ? z.pitchLeft : z.pitchRight,
      leftSpan = crest - (b.minV - o.low),
      rightSpan = Math.max(0, b.maxV + o.high - crest),
      leftArea = (coverWidth * leftSpan) / Math.cos((z.pitchLeft * Math.PI) / 180),
      rightArea = (coverWidth * rightSpan) / Math.cos((pitchRight * Math.PI) / 180),
      leftCenter = (b.minV - o.low + crest) / 2,
      rightCenter = (crest + b.maxV + o.high) / 2;
    const rows = [...routing.rows]
        .sort((a, b) => a.u - b.u)
        .map((r) => ({ ...r, layersA: 0, layersB: 0, timberA: 0, timberB: 0, snowA: 0, snowB: 0 })),
      roofWidth = sum(rows.map((r) => r.tributaryWidth)),
      ceilingWidth = sum(rows.map((r) => r.ceilingWidth ?? 0)),
      ceiling = (z.ceilingLoadSplit?.inputFlat ?? 0) * z.bearingArea,
      topLayers = p.loads.roofDead * z.surfaceArea - ceiling,
      topLeft = (topLayers * leftArea) / (leftArea + rightArea),
      topRight = topLayers - topLeft,
      snowLeft = snowBase * (z.loadSnowFactor ?? 1) * shape(z.pitchLeft) * coverWidth * leftSpan,
      snowRight = snowBase * (z.loadSnowFactor ?? 1) * shape(pitchRight) * coverWidth * rightSpan;
    if (rows.length < 2 || !(S > EPS)) continue;
    const load = (r, W, v, kind) => {
      r[kind + "A"] += (W * (supportMaxV - v)) / S;
      r[kind + "B"] += (W * (v - supportMinV)) / S;
    };
    for (const row of rows) {
      const share = row.tributaryWidth / roofWidth,
        ceilShare = ceilingWidth > 0 ? (row.ceilingWidth ?? 0) / ceilingWidth : share;
      load(row, topLeft * share, leftCenter, "layers");
      load(row, topRight * share, rightCenter, "layers");
      load(row, ceiling * ceilShare, (b.minV + b.maxV) / 2, "layers");
      load(row, snowLeft * share, leftCenter, "snow");
      load(row, snowRight * share, rightCenter, "snow");
    }
    const indices = (u) => {
      let i = 0;
      if (u >= rows.at(-1).u) i = rows.length - 2;
      else if (u > rows[0].u) {
        while (i < rows.length - 2 && u > rows[i + 1].u) i++;
      }
      const a = rows[i],
        b = rows[i + 1],
        t = (u - a.u) / (b.u - a.u);
      return [
        [a, 1 - t],
        [b, t],
      ];
    };
    const roofBoards = timber.instances.filter((t) => t.category === "roof" && t.zoneId === z.id);
    for (const board of roofBoards) {
      const centered =
          Array.isArray(board.massCenter) && board.massCenter.length === 3 && board.massCenter.every(finite),
        n = centered ? 1 : Math.max(1, Math.ceil(board.length / 0.5));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n,
          q = centered ? board.massCenter : board.start.map((x, i) => x + (board.end[i] - x) * t),
          W = (board.mass * G) / 1000 / n;
        for (const [row, factor] of indices(U(q))) load(row, W * factor, V(q), "timber");
      }
    }
    const dead = (r, e) => r["layers" + e] + r["timber" + e];
    const invalid = rows.some((r) =>
      ["A", "B"].some(
        (e) =>
          dead(r, e) + r["snow" + e] < -EPS ||
          (loads.combinations ?? [{ psi: { snow: 1 } }]).some(
            (combo) =>
              combineDesign(
                { layers: r["layers" + e], timber: r["timber" + e], snow: r["snow" + e] },
                factors,
                combo,
              ) < -EPS,
          ),
      ),
    );
    if (invalid) {
      (loads.roofSupportRoutingIssues ??= []).push(z.id);
      continue;
    }
    for (const row of rows)
      for (const [end, point] of [
        ["A", row.bearingStart],
        ["B", row.bearingEnd],
      ]) {
        // One bearing sample with its components: eave tails may make a single
        // component negative while the combined downward reaction stays valid.
        const components = {
          layers: row["layers" + end],
          timber: row["timber" + end],
          snow: row["snow" + end],
        };
        samples.push({
          point: { x: point[0], y: point[2] },
          characteristic: components.layers + components.timber + components.snow,
          components,
          area: 0,
          roofZoneId: z.id,
          trussRow: row.row,
        });
      }
    // Wind uplift (B4): suction on each slope plan projection + internal
    // pressure against 0,9 × permanent heel reaction (СП 20 п. 7.2).
    let worst = { net: -Infinity };
    for (const wc of upliftCases(z.pitchLeft, pitchRight))
      for (const row of rows) {
        const share = row.tributaryWidth / roofWidth,
          r = { upA: 0, upB: 0 };
        const add = (W, v) => {
          r.upA += (W * (supportMaxV - v)) / S;
          r.upB += (W * (v - supportMinV)) / S;
        };
        add(windPressure * wc.left * coverWidth * leftSpan * share, leftCenter);
        add(windPressure * wc.right * coverWidth * rightSpan * share, rightCenter);
        for (const e of ["A", "B"]) {
          const net = r["up" + e] * factors.wind - factors.favourable * dead(row, e);
          if (net > worst.net) worst = { net, row: row.row, end: e, case: wc.id, up: r["up" + e] };
        }
      }
    uplift.push({
      zoneId: z.id,
      framing: routing.kind === "physical" ? "physicalTruss" : "truss",
      rows: rows.length,
      netUpliftPerSupport: worst.net,
      governingCase: worst.case,
      row: worst.row,
      end: worst.end,
      characteristicUplift: worst.up,
    });
    const wood = (sum(roofBoards.map((b) => b.mass)) * G) / 1000,
      snow = snowLeft + snowRight;
    assignedLayers += p.loads.roofDead * z.surfaceArea;
    assignedTimber += wood;
    assignedSnow += snow;
    routedZoneIds.add(z.id);
    (loads.roofSupportRouting ??= []).push({
      zoneId: z.id,
      method:
        routing.kind === "physical"
          ? "Two-bearing whole-truss equilibrium; roof layers and real wood, flat ceiling and asymmetric snow projection. Not a spatial frame stiffness solution."
          : "Two-bearing equilibrium of each idealised FEM truss row at the zone eave lines; roof layers, real wood and snow projection per slope. Not a spatial frame stiffness solution.",
      dead: p.loads.roofDead * z.surfaceArea + wood,
      snow,
      ceiling,
      rows: rows.map((r) => ({
        row: r.row,
        u: r.u,
        bearingStart: r.bearingStart,
        bearingEnd: r.bearingEnd,
        characteristicA: dead(r, "A") + r.snowA,
        characteristicB: dead(r, "B") + r.snowB,
        designA: r.layersA * factors.layers + r.timberA * factors.timber + r.snowA * factors.snow,
        designB: r.layersB * factors.layers + r.timberB * factors.timber + r.snowB * factors.snow,
      })),
    });
  }
  const roofLayersTotal = loads.roofWeight - (loads.roofTimberWeight ?? 0),
    remainingLayers = roofLayersTotal - assignedLayers,
    remainingTimber = (loads.roofTimberWeight ?? 0) - assignedTimber,
    remainingSnow = loads.snow - assignedSnow,
    remaining = remainingLayers + remainingTimber + remainingSnow;
  loads.roofLoadPath = {
    routedZoneIds: [...routedZoneIds],
    unroutedZoneIds: (loads.roofZones ?? []).filter((z) => !routedZoneIds.has(z.id)).map((z) => z.id),
    perimeterFallback: { layers: remainingLayers, timber: remainingTimber, snow: remainingSnow },
  };
  if (Math.abs(remainingLayers) > EPS || Math.abs(remainingTimber) > EPS || Math.abs(remainingSnow) > EPS)
    for (const w of exterior) {
      const n = Math.max(1, Math.ceil(w.length / 0.5));
      for (let i = 0; i < n; i++) {
        const q = lerp(w.a, w.b, (i + 0.5) / n),
          share = w.length / (perimeter * n),
          extra = { roofFallback: true };
        distribute(q, remainingLayers * share, "layers", 0, undefined, extra);
        distribute(q, remainingTimber * share, "timber", 0, undefined, extra);
        distribute(q, remainingSnow * share, "snow", 0, undefined, extra);
      }
    }
  loads.roofLoadPath.perimeterFallbackTotal = remaining;
  loads.windUplift = uplift;
  for (const row of loads.wallLineLoads) {
    if (routedWalls.has(row.wallId)) continue;
    const w = walls.find((w) => w.id === row.wallId);
    if (!w) continue;
    const n = Math.max(1, Math.ceil(w.length / 0.5));
    for (let i = 0; i < n; i++) distribute(lerp(w.a, w.b, (i + 0.5) / n), row.weight / n, "layers");
  }
  if (loads.gableWeight) {
    // Gable triangles stand on the gable walls of their roof zone (walls at the
    // zone ends, parallel to the truss span). Fallback: whole perimeter.
    const gableWalls = [];
    for (const z of loads.roofZones ?? []) {
      if (!(z.gableArea > EPS) || !z.bounds) continue;
      const t = (z.ridgeAngle * Math.PI) / 180,
        c = Math.cos(t),
        s = Math.sin(t),
        U = (q) => q.x * c + q.y * s,
        list = exterior.filter(
          (w) =>
            (w.level === undefined || w.level === z.levelIndex) &&
            Math.abs(U(w.a) - U(w.b)) < 1e-6 &&
            [z.bounds.minU, z.bounds.maxU].some((u) => Math.abs(U(w.a) - u) < 1e-6),
        );
      if (list.length) gableWalls.push({ area: z.gableArea, walls: list });
    }
    const gableTotal = sum(gableWalls.map((g) => g.area));
    if (gableTotal > EPS)
      for (const g of gableWalls) {
        const length = sum(g.walls.map((w) => w.length));
        for (const w of g.walls) {
          const n = Math.max(1, Math.ceil(w.length / 0.5));
          for (let i = 0; i < n; i++)
            distribute(
              lerp(w.a, w.b, (i + 0.5) / n),
              (((loads.gableWeight * g.area) / gableTotal) * w.length) / (length * n),
              "layers",
            );
        }
      }
    else
      for (const w of exterior) {
        const n = Math.max(1, Math.ceil(w.length / 0.5));
        for (let i = 0; i < n; i++)
          distribute(
            lerp(w.a, w.b, (i + 0.5) / n),
            (loads.gableWeight * w.length) / (perimeter * n),
            "layers",
          );
      }
  }
  const panels = loads.structuralPanels ?? [],
    panelArea = sum(panels.map((q) => q.area ?? 0));
  if (panelArea > EPS)
    for (const panel of panels) {
      const points = panel.polygon ?? panel.polygonXYZ ?? [];
      if (!points.length) continue;
      const q = {
        x: sum(points.map((p) => p[0])) / points.length,
        y: sum(points.map((p) => p[2])) / points.length,
      };
      distribute(q, (loads.structuralPanelWeight * (panel.area ?? 0)) / panelArea, "timber");
    }
  for (const board of timber.instances) {
    // All wood except roof wood (already in roofWeight) enters once. Spread long
    // pieces along their real axes; foundation plies stay on their own beam.
    if (board.category === "roof" || routedBoards.has(board.id) || routedJoistBoards.has(board.id)) continue;
    const n = Math.max(1, Math.ceil(board.length / 0.5));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n,
        q = {
          x: board.start[0] + (board.end[0] - board.start[0]) * t,
          y: board.start[2] + (board.end[2] - board.start[2]) * t,
        };
      distribute(
        q,
        (board.mass * G) / 1000 / n,
        "timber",
        0,
        board.category === "foundation" ? board.beamId : undefined,
        { boardId: board.id, wallId: board.wallId, level: board.level },
      );
    }
  }
  // Only sources with a complete wall -> floor -> real grillage route replace
  // the legacy direct samples. Their weight is never added a second time.
  for (const s of wallLoadTransfers?.foundationSamples ?? [])
    samples.push({ ...s, kind: s.kind ?? (s.sourceBoardId ? "timber" : "layers") });
  // ---- Basic combinations: evaluate the grillage for each leading action.
  const combos = (loads.combinations?.length ? loads.combinations : [{ id: "permanent", psi: {} }]).map(
      (c) => ({ ...c, psi: c.psi ?? {} }),
    ),
    governingId = loads.governingCombination ?? combos[0].id,
    designOf = (s, combo) => combineDesign(s.components ?? { [s.kind]: s.characteristic }, factors, combo);
  const runs = combos.map((combo) => {
    const local = samples.map((s) => ({ ...s, design: designOf(s, combo) }));
    return { combo, samples: local, analyzed: analyzeGrillageLoads(p, grillageModel, local) };
  });
  const main = runs.find((r) => r.combo.id === governingId) ?? runs[0],
    analyzed = main.analyzed;
  // Grillage bending envelope over combinations.
  const worstRun = runs.reduce((a, b) =>
    (b.analyzed.worstSpan?.check?.utilization ?? 0) > (a.analyzed.worstSpan?.check?.utilization ?? 0) ? b : a,
  );
  if (worstRun !== main) {
    const strength = worstRun.analyzed.loadChecks.find((c) => c.id === "grillage-strength"),
      i = analyzed.loadChecks.findIndex((c) => c.id === "grillage-strength");
    if (strength && i >= 0) analyzed.loadChecks[i] = { ...strength, combination: worstRun.combo.id };
  }
  Object.assign(grillageModel, analyzed);
  const piles = analyzed.piles;
  for (const pile of piles) {
    const values = runs.map((r) => ({
      id: r.combo.id,
      reaction: r.analyzed.piles.find((q) => q.id === pile.id)?.reaction ?? 0,
    }));
    const max = values.reduce((a, b) => (b.reaction > a.reaction ? b : a));
    pile.reactionByCombination = Object.fromEntries(values.map((v) => [v.id, v.reaction]));
    pile.reactionEnvelope = max.reaction;
    pile.governingCombination = max.id;
    pile.utilization = pile.reactionEnvelope / p.foundation.capacity;
    pile.status = pile.utilization > 1 ? "fail" : pile.utilization > 0.85 ? "warning" : "pass";
  }
  const maxPile = piles.reduce((a, b) => (!a || b.reactionEnvelope > a.reactionEnvelope ? b : a), null),
    reactionSum = sum(piles.map((x) => x.reaction)),
    characteristicSum = sum(piles.map((x) => x.reactionCharacteristic));
  return {
    samples: main.samples,
    piles,
    floorRouting,
    foundation: {
      count: piles.length,
      maxPile,
      maxReaction: maxPile?.reactionEnvelope ?? 0,
      utilization: maxPile?.utilization ?? 0,
      reactionSum,
      characteristicSum,
      balanceError: reactionSum - loads.totalDesign,
      combination: main.combo.id,
      combinations: runs.map((r) => ({
        id: r.combo.id,
        reactionSum: sum(r.analyzed.piles.map((q) => q.reaction)),
        maxReaction: Math.max(0, ...r.analyzed.piles.map((q) => q.reaction)),
      })),
      status: maxPile && maxPile.utilization > 1 ? "fail" : "unverified",
      method:
        "Перекрытия — опорные реакции лаг (однопролётные балки) на ростверк или стены нижнего этажа; кровля — реакции рядов ферм/стропил на опорные стены; затем ближайший пролёт ростверка и равновесие шарнирных балок. Без пространственной жёсткости и грунта.",
      sampleCount,
    },
  };
}

/** Building wind resultants per storey (СП 20.13330.2016 п. 11.1, прил. В). */
function houseWindForces(p, geometry, roofModel) {
  const levels = (geometry.levels ?? [])
    .filter((l) => l.closed && l.bounds)
    .map((l) => {
      const top = finite(l.topY) ? l.topY : (l.elevation ?? 0) + (l.height ?? p.height);
      return {
        index: l.index,
        bounds: l.bounds,
        top,
        height: finite(l.baseY) ? top - l.baseY : (l.height ?? p.height),
      };
    });
  const zones = (roofModel?.zones ?? []).filter((z) => z.bounds && finite(z.rise));
  let synthetic = [];
  const roofLevel = levels.at(-1);
  if (!roofModel && roofLevel && !["none"].includes(p.roof?.type)) {
    const mono = p.roof.type === "mono",
      span = roofLevel.bounds.height,
      t = Math.tan(((p.roof.pitch ?? 25) * Math.PI) / 180);
    synthetic = [
      {
        shape: mono ? "mono" : "gable",
        ridgeAngle: 0,
        bounds: { length: roofLevel.bounds.width, span },
        rise: mono ? span * t : (span / 2) * t,
        pitchLeft: p.roof.pitch,
        pitchRight: p.roof.pitch,
      },
    ];
  }
  const roofTop = Math.max(
      -Infinity,
      ...(roofModel?.surfaces ?? []).flatMap((s) => s.points.map((q) => q[1]).filter(finite)),
    ),
    levelTop = Math.max(0, ...levels.map((l) => l.top)),
    ze = Math.max(levelTop + (synthetic[0]?.rise ?? 0), Number.isFinite(roofTop) ? roofTop : 0);
  return windStoreyForces({ loads: p.loads, levels, zones: zones.length ? zones : synthetic, ze });
}

export function calculateDesigner(input, { truss, roofModel } = {}) {
  const validation = validateDesignerProject(input);
  if (!validation.valid) {
    const e = new Error(validation.errors.map((x) => x.message).join("\n"));
    e.name = "DesignerValidationError";
    e.validation = validation;
    throw e;
  }
  const p = resolveDressedProject(normalized(clone(input))),
    warnings = [...validation.warnings],
    levelModels = deriveLevels(p),
    base = levelModels[0],
    graph = base.graph,
    roofLevel = levelModels.filter((l) => l.closed).at(-1);
  const partitionHeads = resolvePartitionHeads(p, { levels: levelModels, roofModel });
  p.walls = partitionHeads.walls;
  const effectiveWallMap = new Map(p.walls.map((w) => [w.id, w]));
  for (const l of levelModels) l.walls = l.walls.map((w) => effectiveWallMap.get(w.id) ?? w);
  warnings.push(...partitionHeads.warnings);
  const bounds = polygonBounds(
    p.walls.flatMap((w) => [w.a, w.b]).concat(p.objects.flatMap((o) => [o.a, ...(o.b ? [o.b] : [])])),
  );
  const wallProfiles = roofModel?.wallProfiles ?? [];
  const wallGross = (w, l) => {
    const profile = wallProfiles.find(
      (q) => q.wallId === w.id && q.level === l.index && q.mode === "continuous",
    );
    return !isBeamWall(w) && profile
      ? profile.topSamples
          .slice(1)
          .reduce(
            (a, b, i) =>
              a +
              (b.s - profile.topSamples[i].s) * ((b.topY + profile.topSamples[i].topY) / 2 - profile.baseY),
            0,
          )
      : dist(w.a, w.b) * (w.height ?? l.height);
  };
  const walls = p.walls.map((w) => ({
    ...w,
    length: dist(w.a, w.b),
    sectionSize: wallFrameSection(w, parseSection),
    grossArea: sum(
      levelModels.filter((l) => w.level === undefined || w.level === l.index).map((l) => wallGross(w, l)),
    ),
    openingArea: sum(p.openings.filter((o) => o.wallId === w.id).map((o) => o.width * o.height)),
  }));
  const geometry = {
    area: graph.area,
    totalFloorArea: graph.closed ? sum(levelModels.filter((l) => l.closed).map((l) => l.netFloorArea)) : null,
    grossFloorArea: graph.closed ? sum(levelModels.filter((l) => l.closed).map((l) => l.area)) : null,
    voidArea: sum(levelModels.filter((l) => l.closed).map((l) => l.voidArea)),
    areaComplete: levelModels.every((l) => l.closed),
    perimeter: sum(base.walls.filter((w) => w.kind === "exterior").map((w) => dist(w.a, w.b))),
    bounds,
    baseBounds: base.bounds,
    closed: graph.closed,
    polygon: graph.polygon,
    roofPolygon: roofLevel?.polygon ?? [],
    roofBounds: roofLevel?.bounds ?? base.bounds,
    rectangular: false,
    levels: levelModels.map(({ graph, walls, ...l }) => l),
  };
  geometry.wallProfiles = wallProfiles;
  geometry.rectangular = graph.closed && Math.abs(graph.area - base.bounds.width * base.bounds.height) < 1e-5;
  const exteriorOpeningArea = sum(
    p.openings
      .filter((o) => walls.find((w) => w.id === o.wallId)?.kind === "exterior")
      .map((o) => o.width * o.height),
  );
  const openingArea = sum(p.openings.map((o) => o.width * o.height)),
    innerGross = sum(walls.filter((w) => w.kind !== "exterior").map((w) => w.grossArea));
  const roofRect =
    roofLevel && Math.abs(roofLevel.area - roofLevel.bounds.width * roofLevel.bounds.height) < 1e-5;
  const gableArea = finite(roofModel?.gableArea)
    ? roofModel.gableArea
    : roofModel
      ? 0
      : roofLevel && roofRect && !["none", "mono"].includes(p.roof.type)
        ? (roofLevel.bounds.height ** 2 / 2) * Math.tan((p.roof.pitch * Math.PI) / 180)
        : 0;
  geometry.gableArea = gableArea;
  geometry.grossWallArea =
    sum(walls.filter((w) => w.kind === "exterior").map((w) => w.grossArea)) + gableArea;
  geometry.netWallArea = geometry.grossWallArea - exteriorOpeningArea;
  geometry.openingArea = openingArea;
  geometry.exteriorOpeningArea = exteriorOpeningArea;
  geometry.innerWallArea = innerGross - (openingArea - exteriorOpeningArea);
  const grillageModel = buildGrillage(p, {
    geometry,
    walls,
    extraLines: sharedAnnexGrillageLines(p, { geometry }),
  });
  geometry.platformContours = prepareFloorContours(p, { geometry, walls });
  geometry.platformAreaComplete =
    geometry.platformContours.length === geometry.levels.filter((l) => l.closed).length &&
    geometry.platformContours.every((c) => c.valid);
  for (const level of geometry.levels) {
    const c = geometry.platformContours.find((c) => c.index === level.index);
    if (c?.valid) {
      level.platformPolygon = c.outerPolygon;
      level.platformGrossArea = c.grossArea;
      level.platformNetArea = c.netArea;
      level.platformBounds = c.outerBounds;
    }
  }
  geometry.totalPlatformArea = sum(geometry.platformContours.filter((c) => c.valid).map((c) => c.netArea));
  geometry.grossPlatformArea = sum(geometry.platformContours.filter((c) => c.valid).map((c) => c.grossArea));
  geometry.platformRimWidth = parseSection(p.floor.rimSection ?? p.floor.section).b / 1000;
  let floorOpenings = buildFloorOpenings(p, { geometry, walls });
  const floorPlatform = buildFloorPlatform(p, { geometry, walls, grillageModel, floorOpenings });
  geometry.platformTimberPressureByLevel = Object.fromEntries(
    floorPlatform.levels.map((l) => [
      l.index,
      (l.quantities.mass * G) / 1000 / (geometry.levels.find((q) => q.index === l.index)?.netFloorArea || 1),
    ]),
  );
  floorOpenings = buildFloorOpenings(p, { geometry, walls });
  const corners = levelModels.flatMap((l) => cornerData(p, l.graph, l.index));
  warnings.push(...corners.filter((c) => c.warning).map((c) => c.warning));
  const timberParts = levelModels.map((level) => {
    const includeRoof = level.index === roofLevel?.index;
    const local = {
      ...p,
      height: level.height,
      floors: 1,
      _baseY: level.baseY,
      _levelIndex: level.index,
      _wallProfiles: wallProfiles.filter((q) => q.level === level.index),
      _voids: level.voids,
      _grillageBeams: level.index === 1 ? grillageModel.beams : [],
      _floorOpenings: floorOpenings.openings.filter((o) => o.level === level.index),
      walls: level.walls,
      openings: p.openings
        .filter((o) => {
          const wall = p.walls.find((w) => w.id === o.wallId);
          return (o.floor ?? wall?.level ?? 1) === level.index;
        })
        .map((o) => ({ ...o, floor: 1 })),
      objects: p.objects.filter((o) => (o.level ?? 1) === level.index),
      roof: includeRoof ? p.roof : { ...p.roof, type: "none" },
    };
    const model = timberModel(
      local,
      level.graph,
      corners.filter((c) => c.level === level.index),
      level.bounds,
      includeRoof ? truss : undefined,
      warnings,
      includeRoof ? roofModel : undefined,
    );
    for (const board of model.instances) {
      const ownLevel =
        board.category === "roof" && (Number.isInteger(board.floor) || Number.isInteger(board.level))
          ? (board.floor ?? board.level)
          : level.index;
      board.level = ownLevel;
      board.floor = ownLevel;
    }
    model.braceBays = model.braceBays.map((b) => ({ ...b, floor: level.index, level: level.index }));
    return model;
  });
  const grillageTimber = timberModel(
    {
      ...p,
      walls: [],
      openings: [],
      objects: [],
      floors: 1,
      roof: { ...p.roof, type: "none" },
      _extraInstances: grillageModel.instances,
    },
    { closed: false },
    [],
    bounds,
    undefined,
    warnings,
    undefined,
  );
  const profiledBeam = buildProfiledBeam(p, geometry.levels);
  const beamTimber = timberModel(
    {
      ...p,
      walls: [],
      openings: [],
      objects: [],
      roof: { ...p.roof, type: "none" },
      _extraInstances: profiledBeam.instances,
    },
    { closed: false },
    [],
    bounds,
    undefined,
    warnings,
    undefined,
  );
  beamTimber.splices.push(...profiledBeam.splices);
  let timber = mergeTimber([...timberParts, grillageTimber, beamTimber], p);
  const checks = [...(grillageModel.checks ?? []), ...partitionHeads.checks];
  warnings.push(...(grillageModel.warnings ?? []));
  const houseWind = houseWindForces(p, geometry, roofModel);
  const bracingModel = buildWallBracing(p, { geometry, walls, timber, roofModel, wind: houseWind });
  for (const notch of bracingModel.notches ?? []) {
    const board = timber.instances.find((b) => b.id === notch.boardId);
    if (!board) continue;
    const removed = Math.min(board.volume, Math.max(0, notch.volume ?? 0));
    board.volume -= removed;
    board.netVolume = board.volume;
    board.mass = board.volume * p.material.density;
    (board.notches ??= []).push(
      ...(notch.cuts ?? [notch]).map((c) => ({ ...c, removedVolume: c.volume ?? 0 })),
    );
  }
  const added = timberModel(
    {
      ...p,
      walls: [],
      openings: [],
      objects: [],
      floors: 1,
      roof: { ...p.roof, type: "none" },
      _extraInstances: [
        ...(bracingModel.instances ?? []),
        ...(floorOpenings.instances ?? []),
        ...(floorPlatform.instances ?? []),
      ],
    },
    { closed: false },
    [],
    bounds,
    undefined,
    warnings,
    undefined,
  );
  timber = mergeTimber([{ ...timber, braceBays: [] }, added], p);
  checks.push(...(floorOpenings.checks ?? []), ...(floorPlatform.checks ?? []));
  warnings.push(...(floorOpenings.warnings ?? []), ...(floorPlatform.warnings ?? []));
  checks.push(...(bracingModel.checks ?? []));
  warnings.push(...(bracingModel.warnings ?? []));
  const auxiliaryTimber = buildAuxiliaryTimber(p, { geometry, walls, timber, roofModel });
  if (auxiliaryTimber.instances.length) {
    const extra = timberModel(
      {
        ...p,
        walls: [],
        openings: [],
        objects: [],
        floors: 1,
        roof: { ...p.roof, type: "none" },
        _extraInstances: auxiliaryTimber.instances,
      },
      { closed: false },
      [],
      bounds,
      undefined,
      warnings,
      undefined,
    );
    timber = mergeTimber([timber, extra], p);
  }
  checks.push(...(auxiliaryTimber.checks ?? []));
  warnings.push(...(auxiliaryTimber.warnings ?? []));
  const spatialLayout = buildSpatialLayout(p, { geometry, walls, timber });
  if (spatialLayout.instances.length) {
    const extra = timberModel(
      {
        ...p,
        walls: [],
        openings: [],
        objects: [],
        floors: 1,
        roof: { ...p.roof, type: "none" },
        _extraInstances: spatialLayout.instances,
      },
      { closed: false },
      [],
      bounds,
      undefined,
      warnings,
      undefined,
    );
    timber = mergeTimber([timber, extra], p);
  }
  checks.push(...(spatialLayout.checks ?? []));
  warnings.push(...(spatialLayout.warnings ?? []));
  if (spatialLayout.instances.length)
    checks.push({
      id: "spatial-local-load-path",
      label: "Локальные реакции лестницы и ограждений",
      status: "unverified",
      note: "Фактическая масса добавлена один раз. Сосредоточенные реакции лестничных опор и ограждений в лагах, обрамлении проёмов и креплениях отдельно не решены.",
    });
  const physicalRoofIds = new Map();
  for (const board of timber.instances)
    if (board.sourceBoardId) {
      const ids = physicalRoofIds.get(board.sourceBoardId) ?? [];
      ids.push(board.id);
      physicalRoofIds.set(board.sourceBoardId, ids);
    }
  for (const item of partitionHeads.items) {
    item.targetMemberIds = item.targetSourceMemberIds.flatMap((id) => physicalRoofIds.get(id) ?? []);
    item.lateralTrimmerIds = timber.instances
      .filter((b) => b.role === "ceilingTransferHeader" && b.partitionWallIds?.includes(item.wallId))
      .map((b) => b.id);
  }
  for (const zone of roofModel?.zones ?? [])
    for (const row of zone.frameRows ?? [])
      for (const joint of row.lapConnections ?? [])
        joint.memberWorldIds = (joint.memberSourceBoardIds ?? []).flatMap(
          (id) => physicalRoofIds.get(id) ?? [],
        );
  const fullHeightWalls = checkFullHeightWalls(
    memberLoadProject(p, houseWind),
    { timber, geometry, bracingModel },
    roofModel,
  );
  checks.push(...fullHeightWalls.checks);
  warnings.push(...fullHeightWalls.walls.flatMap((w) => w.warnings ?? []));
  if (bracingModel.notches?.length) {
    fullHeightWalls.capacityPass = false;
    checks.push({
      id: "full-wall-notches",
      label: "Вырезы стоек под врезные укосины",
      status: "unverified",
      note: "Масса выборок учтена. Несущая способность ослабленных сечений и крепления укосин требуют отдельного расчёта.",
    });
  }

  if (
    timber.splices.some(
      (s) =>
        s.scheme === "fishplate" &&
        s.partIds.some((id) => timber.instances.find((b) => b.id === id)?.category === "roof"),
    )
  )
    warnings.push(
      "Масса накладок на стыках кровли включена в общий вес дома, но локальная идеальная FEM-модель фермы не учитывает добавочный вес этих накладок. Её нагрузки требуют уточнения.",
    );
  if (!graph.closed)
    warnings.push(
      "Внешний контур не замкнут в один простой полигон. Площадь, площадные нагрузки и свайное поле не рассчитываются.",
    );
  for (const l of levelModels)
    for (const v of l.voids)
      for (const w of l.walls.filter((w) => w.kind !== "exterior")) {
        const cuts = [0, 1];
        for (let k = 0; k < v.polygon.length; k++) {
          const hit = segmentHit(w.a, w.b, v.polygon[k], v.polygon[(k + 1) % v.polygon.length]);
          if (hit) cuts.push(hit.t);
        }
        cuts.sort((a, b) => a - b);
        let crosses = false;
        for (let k = 1; k < cuts.length; k++)
          if (
            cuts[k] - cuts[k - 1] > EPS &&
            pointInPolygon(lerp(w.a, w.b, (cuts[k] + cuts[k - 1]) / 2), v.polygon, false)
          )
            crosses = true;
        if (crosses) {
          const note = `Стена ${w.id} на ${l.index} этаже проходит над зоной второго света ${v.id}. Её опирание не подтверждено: перенесите стену или задайте несущую передаточную конструкцию.`;
          warnings.push(note);
          checks.push({
            id: "wall-over-void-" + w.id + "-" + v.id,
            label: "Внутренняя стена над вторым светом",
            status: "unverified",
            note,
          });
        }
      }
  for (const l of levelModels)
    if (!l.closed && l.index > 1)
      warnings.push(
        `Контур ${l.index} этажа не замкнут: его площадные нагрузки не включены, текущая площадь и расчёт неполны.`,
      );
  if (graph.closed && !geometry.rectangular && p.roof.type !== "none" && !roofModel)
    warnings.push("Непрямоугольный план: без зонной модели кровли покрытие и опирание не подтверждены.");
  for (const level of levelModels.slice(1))
    if (level.closed && level.polygon.some((q) => !pointInPolygon(q, graph.polygon)))
      warnings.push(
        `Контур ${level.index} этажа выходит за основание: консоли и передаточные конструкции не рассчитаны.`,
      );
  const assumptions = [
    ...lumberAssumptions(input),
    "Концептуальная геометрия и распределение нагрузок, не нормативный рабочий проект и не метод конечных элементов.",
    "Стены заданы осями. Площадь по осям внешнего контура — общая геометрическая площадь, не чистая полезная площадь.",
    "height/levels[].height — высота стенового каркаса. baseY — низ платформы, wallBaseY — верх настила, topY — верх стен; следующий этаж начинается на topY предыдущего. Стены с level заданы независимо, без level — миграционно повторяются по этажам.",
    "Второй свет вырезает только платформу выбранного верхнего этажа. Стены и кровля сохраняются; добавлено геометрическое обрамление проёма, но его опирание, сечения и узлы требуют отдельного расчёта.",
    "Каждый timber.instance — отдельная физическая часть доски. length — длина по оси, cutLength — полная заготовка по длинным точкам косых резов; grossVolume нужен для закупки, netVolume и масса учитывают снятую половину нахлёстов halfLap/scarf.",
    "Угловые пакеты, косые углы, Т/X-узлы и угловые врубки показаны условно. Ослабление угловых врубок и крепёж не рассчитаны. Оптимизацию раскроя и пропил выполняет отдельный модуль, не этот геометрический расчёт.",
    "Площади планировки и полезная нагрузка сохраняются по осевому контуру. Масса слоёв платформы считается по её фактической наружной грани каркаса за вычетом неизменённых проёмов; физическая древесина добавляется отдельно. Передача наружной полосы на оси ростверка — концептуальное вертикальное распределение, не проверка эксцентриситета, смятия или кручения.",
    "Слои перекрытия, кровли и стен вводятся без древесины и отдельно учитываемых плит жёсткости стен. Вес всех сформированных досок добавляется ровно один раз. Площадь проёмов заменяет слои стены заданным весом заполнения.",
    "Треугольные фронтоны добавлены только для прямоугольного плана с симметричной двускатной кровлей. Для односкатной и нерегулярной кровли высоты фасадов и фронтоны требуют отдельного задания.",
    "Сваи стоят на линиях пакетного ростверка. Перекрытия передаются опорными реакциями однопролётных лаг на ростверк (1 этаж) или на стены нижнего этажа (верхние этажи, далее по вертикали стены), кровля — реакциями рядов ферм/стропил на опорные стены. Затем нагрузка идёт на ближайший пролёт ростверка и через равновесие шарнирно опёртых балок — на концевые сваи. Жёсткость пространственной решётки, неразрезность ростверка, осадки, отрыв и грунт не решены.",
    roofModel
      ? "Снег S0 = ce·ct·µ·Sg по кровельным зонам и проекции покрытия со свесами (СП 20.13330.2016 п. 10.1, прил. Б). loads.mu — средневзвешенное snowEffectiveArea/projectedRoofArea, включая зонные множители; отдельные коэффициенты приведены по зонам. Несимметричный вариант 2 проверяется для ферм в зонной модели; снеговые мешки не рассчитаны."
      : p.roof.snowMu !== undefined
        ? "Снег: явно заданный roof.snowMu, S0 = ce·ct·µ·Sg. Заносы и снегозадержатели не проверены."
        : "Снег: µ = 1 до 30°, далее линейно до 0 на 60° (СП 20.13330.2016 прил. Б, схема Б.1), S0 = ce·ct·µ·Sg. Заносы не проверены.",
    "Ветер не добавляется в вертикальные реакции свай. Горизонтальные равнодействующие wm = w0·k(ze)·c по этажам (loads.windStoreys) передаются в проверку раскрепления стен; диафрагмы, анкеры стен и горизонтальные реакции свай не рассчитаны.",
    "Схема кровли по габаритному прямоугольнику требует проверки покрытия и опирания; отсутствие фермы означает отсутствие её древесины в весе.",
    "Физические стыки длинных досок не добавляют шарниры или жёсткость в расчёт фермы: её FEM-модель остаётся идеальной неразрезной по стержням. Геометрическое наращивание не подтверждает передачу усилий.",
    "При наращивании halfLap/scarf геометрические части перекрываются на lapLength; из массы каждого конца вычитается половина объёма нахлёста. Накладки fishplate — отдельные доски. Закупочный объём считается по полным cutLength, не по чистой массе.",
  ];
  assumptions.push(
    ...profileAssumptions(p.loads),
    ...partitionHeads.assumptions,
    ...(spatialLayout.assumptions ?? []),
    ...(auxiliaryTimber.assumptions ?? []),
    ...(floorOpenings.assumptions ?? []),
    ...(floorPlatform.assumptions ?? []),
    ...(grillageModel.assumptions ?? []),
    ...fullHeightWalls.assumptions,
    ...(bracingModel.assumptions ?? []),
  );
  const floorWallLoads = attachFloorWallLoads(p, { geometry, walls, timber, floorPlatform });
  checks.push(...floorWallLoads.checks);
  warnings.push(...floorWallLoads.warnings);
  assumptions.push(...floorWallLoads.assumptions);
  let loads = null,
    piles = [],
    foundation = null,
    foundationSamples = [];
  if (graph.closed) {
    const A = graph.area,
      F = p.floors,
      profile = loadProfile(p.loads),
      factors = loadFactors(p.loads),
      snowBase = snowBasis(p.loads),
      mu =
        finite(roofModel?.snowEffectiveArea) && roofModel.projectedArea > 0
          ? roofModel.snowEffectiveArea / roofModel.projectedArea
          : (p.roof.snowMu ?? snowShapeMu(p.roof.pitch, profile)),
      roofArea =
        p.roof.type === "none"
          ? 0
          : finite(roofModel?.area)
            ? roofModel.area
            : (roofLevel?.area ?? A) / Math.cos((p.roof.pitch * Math.PI) / 180),
      projectedRoofArea = finite(roofModel?.projectedArea) ? roofModel.projectedArea : (roofLevel?.area ?? A);
    const structuralPanelWeight = ((bracingModel.quantities?.panelMass ?? 0) * G) / 1000;
    const floorLayers = geometry.totalPlatformArea * p.loads.floorDead,
      roofLayers = roofArea * p.loads.roofDead,
      wallWeight =
        (geometry.netWallArea -
          sum(
            walls
              .filter((w) => isBeamWall(w) && w.kind === "exterior")
              .map((w) => w.grossArea - w.openingArea),
          )) *
        p.loads.wallDead,
      innerWallWeight =
        (geometry.innerWallArea -
          sum(
            walls
              .filter((w) => isBeamWall(w) && w.kind !== "exterior")
              .map((w) => w.grossArea - w.openingArea),
          )) *
        p.loads.wallDead,
      openingWeight = openingArea * p.loads.openingDead,
      gableWeight = gableArea * p.loads.wallDead,
      live = geometry.totalFloorArea * p.loads.live,
      // S0 = ce·ct·µ·Sg (СП 20.13330.2016 п. 10.1); µ is inside snowEffectiveArea.
      snow =
        p.roof.type === "none"
          ? 0
          : snowBase.base *
            (finite(roofModel?.snowEffectiveArea) ? roofModel.snowEffectiveArea : projectedRoofArea * mu),
      beamAccessoryWeight = (profiledBeam.juteMass * G) / 1000,
      dead =
        beamAccessoryWeight +
        floorLayers +
        roofLayers +
        wallWeight +
        innerWallWeight +
        openingWeight +
        timber.weight +
        structuralPanelWeight;
    const rawRows = [
      ...(profiledBeam.walls.length
        ? [
            {
              id: "beam-jute",
              label: "Джут брусовых стен",
              characteristic: beamAccessoryWeight,
              kind: "dead",
              loadKind: "layers",
            },
          ]
        : []),
      {
        id: "structural-panels",
        label: "Плиты жёсткости стен",
        characteristic: structuralPanelWeight,
        kind: "dead",
        loadKind: "timber",
      },
      {
        id: "floor-layers",
        label: "Слои перекрытий без древесины",
        characteristic: floorLayers,
        kind: "dead",
        loadKind: "layers",
      },
      {
        id: "roof-layers",
        label: "Слои кровли без древесины",
        characteristic: roofLayers,
        kind: "dead",
        loadKind: "layers",
      },
      {
        id: "wall-layers",
        label: "Слои наружных стен без древесины",
        characteristic: wallWeight,
        kind: "dead",
        loadKind: "layers",
      },
      {
        id: "inner-layers",
        label: "Слои внутренних стен без древесины",
        characteristic: innerWallWeight,
        kind: "dead",
        loadKind: "layers",
      },
      {
        id: "openings",
        label: "Заполнение проёмов",
        characteristic: openingWeight,
        kind: "dead",
        loadKind: "layers",
      },
      ...["foundation", "walls", "floor", "roof", "bracing", "objects", "spatial"].map((k) => ({
        id: "timber-" + k,
        label: {
          foundation: "Древесина пакетного ростверка",
          walls: "Древесина стен и узлов",
          floor: "Древесина перекрытий",
          roof: "Древесина кровли",
          bracing: "Древесина укосин",
          objects: "Древесина отдельных объектов",
          spatial: "Древесина лестницы и ограждений",
        }[k],
        characteristic: timber.totals[k].weight,
        kind: "dead",
        loadKind: "timber",
      })),
      { id: "live", label: "Полезная нагрузка", characteristic: live, kind: "variable", loadKind: "live" },
      { id: "snow", label: "Снег", characteristic: snow, kind: "variable", loadKind: "snow" },
    ];
    // Basic combinations (СП 20 п. 6.2, 6.4): each temporary action leads once.
    const components = { timber: 0, layers: 0, live, snow };
    for (const r of rawRows) if (r.kind === "dead") components[r.loadKind] += r.characteristic;
    const combination = governingCombination(components, factors),
      governing = combination.governing;
    const rows = rawRows.map((r) => {
      const gamma = kindFactor(factors, r.loadKind),
        psi = r.kind === "dead" ? 1 : (governing.psi[r.loadKind] ?? 0);
      return { ...r, gamma, psi, design: r.characteristic * gamma * psi };
    });
    const wallLineLoads = walls.map((w) => ({
      wallId: w.id,
      weight:
        (isBeamWall(w)
          ? (sum(profiledBeam.walls.filter((q) => q.wallId === w.id).map((q) => q.juteMass)) * G) / 1000
          : (w.grossArea - w.openingArea) * p.loads.wallDead) +
        w.openingArea * p.loads.openingDead,
    }));
    const roofMassIncluded = timber.roofGeometryAvailable || p.roof.type === "none",
      complete = roofMassIncluded && geometry.areaComplete && geometry.platformAreaComplete;
    loads = {
      rows,
      roofZones: roofModel?.zones ?? [],
      rawRoofInstances: roofModel?.instances ?? [],
      structuralPanelWeight,
      structuralPanels: bracingModel.panels ?? [],
      dead,
      live,
      snow,
      mu,
      muBasis: roofModel
        ? "Area-weighted snowEffectiveArea / projectedRoofArea including zone factors (SP 20.13330.2016 App. B)"
        : p.roof.snowMu !== undefined
          ? "Explicit roof.snowMu"
          : "SP 20.13330.2016 App. B scheme B.1: mu=1 up to 30 deg, 0 at 60 deg",
      snowGround: snowBase.Sg,
      snowCe: snowBase.ce,
      snowCt: snowBase.ct,
      profile: profile.id,
      factors,
      combinations: combination.combinations.map((c) => ({
        id: c.id,
        leading: c.leading,
        psi: c.psi,
        totalDesign: c.total,
      })),
      governingCombination: governing.id,
      roofArea,
      projectedRoofArea,
      floorArea: geometry.totalFloorArea,
      platformArea: geometry.totalPlatformArea,
      roofWeight: roofLayers + timber.totals.roof.weight,
      roofTimberWeight: timber.totals.roof.weight,
      wallWeight,
      innerWallWeight,
      openingWeight,
      gableWeight,
      wallLineLoads,
      timberWeight: timber.weight,
      totalCharacteristic: dead + live + snow,
      totalDesign: governing.total,
      // Horizontal wind resultants on the whole building (bottom storey shear),
      // characteristic values: w0·k(ze)·(0,8+0,5)·projected area incl. gables/roof.
      windForceX: houseWind.forceX,
      windForceY: houseWind.forceY,
      windDesignX: houseWind.forceX * factors.wind,
      windDesignY: houseWind.forceY * factors.wind,
      windStoreys: houseWind.storeys,
      windPressure: {
        w0: houseWind.w0,
        terrain: houseWind.terrain,
        ze: houseWind.ze,
        k: houseWind.k,
        wm: houseWind.pressure,
        coefficient: houseWind.coefficient,
        roofAreas: houseWind.roofAreas,
      },
      complete,
      roofMassIncluded,
      missingLoads: [
        ...(!roofMassIncluded ? ["Древесина кровли не сформирована."] : []),
        ...(profiledBeam.walls.length
          ? ["Масса нагелей принята замещением древесины; крепёж и гидроизоляция брусовых стен не заданы."]
          : []),
        ...(!geometry.areaComplete ? ["Не все контуры этажей замкнуты."] : []),
        ...(!geometry.platformAreaComplete
          ? [
              "Наружный контур платформы пересекается или не подтверждён; физические площади и объёмы платформы неполны.",
            ]
          : []),
      ],
    };
    const field = pileField(
      p,
      geometry,
      walls,
      timber,
      loads,
      grillageModel,
      floorPlatform.wallLoadTransfers,
      floorPlatform,
    );
    piles = field.piles;
    foundation = field.foundation;
    foundationSamples = field.samples;
    loads.floorRouting = field.floorRouting;
    const fallbackLevels = field.floorRouting.levels.filter((l) => l.method !== "joist-reactions");
    checks.push({
      id: "floor-load-path",
      label: "Передача нагрузок перекрытий через лаги",
      status: fallbackLevels.length ? "unverified" : "pass",
      levels: field.floorRouting.levels.map((l) => l.level),
      note: fallbackLevels.length
        ? "Для этажей " +
          fallbackLevels.map((l) => l.level + " (" + l.reason + ")").join("; ") +
          " постоянная и полезная нагрузка распределены по площади на ближайший пролёт ростверка, минуя лаги и стены."
        : "Постоянная и полезная нагрузка каждого этажа переданы опорными реакциями лаг на реальные опоры: ростверк или стены нижнего этажа.",
    });
    const fallback = loads.roofLoadPath?.perimeterFallbackTotal ?? 0;
    if (Math.abs(fallback) > 1e-3)
      checks.push({
        id: "roof-load-path-fallback",
        label: "Кровля: нагрузка без расчётного пути на опорные стены",
        status: "unverified",
        value: fallback,
        unit: "кН",
        zoneIds: loads.roofLoadPath.unroutedZoneIds,
        note: "Часть постоянной нагрузки и снега кровли не имеет решённых опорных реакций (вальма, обрезанные рамы, неустойчивая схема или неучтённые доски). Она условно распределена по длине всех наружных стен, включая фронтонные; реакции опор под ней не подтверждены.",
      });
    for (const u of loads.windUplift ?? [])
      checks.push({
        id: "wind-uplift-" + u.zoneId,
        label: "Ветровой отрыв опор кровли: анкеровка",
        status: u.netUpliftPerSupport > 0 ? "warning" : "pass",
        value: Math.max(0, u.netUpliftPerSupport),
        limit: 0,
        unit: "кН",
        zoneId: u.zoneId,
        governingCase: u.governingCase,
        note:
          u.netUpliftPerSupport > 0
            ? `Расчётный отрыв ${u.netUpliftPerSupport.toFixed(2)} кН на опору (1,4·W − 0,9·G, ${u.governingCase}). Анкеровка пяты к обвязке не моделируется: требуется крепёж не менее ${u.netUpliftPerSupport.toFixed(2)} кН на каждую опору.`
            : `Постоянная нагрузка 0,9·G удерживает опоры от отрыва 1,4·W (запас ${(-u.netUpliftPerSupport).toFixed(2)} кН на опору). Крепление от сдвига и опрокидывания не проверено.`,
      });
    checks.push({
      id: "load-combinations",
      label: "Сочетания нагрузок",
      status: "pass",
      value: loads.totalDesign,
      unit: "кН",
      governingCombination: loads.governingCombination,
      note:
        "Основные сочетания СП 20.13330.2016 п. 6.2, 6.4: " +
        loads.combinations.map((c) => `${c.id} = ${c.totalDesign.toFixed(1)} кН`).join("; ") +
        ". Определяющее по сумме — " +
        loads.governingCombination +
        "; реакции свай — огибающая сочетаний.",
    });
    checks.push(...(grillageModel.loadChecks ?? []));
    if (loads.roofSupportRoutingIssues?.length)
      checks.push({
        id: "roof-uplift-routing",
        label: "Передача отрыва стропильных опор",
        status: "unverified",
        zoneIds: loads.roofSupportRoutingIssues,
        note: "Есть отрицательная опорная реакция. Положительные нагрузки распределены условно по периметру; отрыв и удерживающие анкеры ростверком не рассчитаны.",
      });
    checks.push(
      {
        id: "verticalBalance",
        label: "Баланс вертикальных сил",
        status: Math.abs(foundation.balanceError) < 1e-6 ? "pass" : "fail",
        value: Math.abs(foundation.balanceError),
        limit: 1e-6,
        unit: "кН",
      },
      {
        id: "pileCapacity",
        label: "Вертикальная реакция опоры",
        status: foundation.utilization > 1 ? "fail" : "warning",
        value: foundation.maxReaction,
        limit: p.foundation.capacity,
        unit: "кН",
        utilization: foundation.utilization,
      },
    );
    geometry.roofArea = roofArea;
    delete loads.roofZones;
    delete loads.rawRoofInstances;
  }
  const houseLoads = loads ? clone(loads) : null,
    houseTimberTotals = clone(timber.totals),
    houseFoundation = foundation ? clone(foundation) : null,
    housePiles = clone(piles);
  const annexes = buildAnnexes(p, { geometry, walls, timber, grillageModel, piles });
  if (annexes.instances.length) {
    const extra = timberModel(
      {
        ...p,
        walls: [],
        openings: [],
        objects: [],
        floors: 1,
        roof: { ...p.roof, type: "none" },
        _extraInstances: annexes.instances,
      },
      { closed: false },
      [],
      bounds,
      undefined,
      warnings,
      undefined,
    );
    timber = mergeTimber([timber, extra], p);
  }
  checks.push(...annexes.checks);
  warnings.push(...annexes.warnings);
  assumptions.push(...annexes.assumptions);
  if (annexes.items.length) {
    geometry.annexArea = annexes.quantities.floorArea;
    geometry.compositeBounds = polygonBounds([
      ...p.walls.flatMap((w) => [w.a, w.b]),
      ...annexes.items.flatMap((a) => [
        ...a.polygon,
        ...a.roof.surfaces.flatMap((s) => s.points.map((p) => ({ x: p[0], y: p[2] }))),
      ]),
      ...(roofModel?.surfaces ?? []).flatMap((s) => s.points.map((p) => ({ x: p[0], y: p[2] }))),
    ]);
    if (loads) {
      loads = {
        ...loads,
        rows: [...loads.rows, ...annexes.loads.rows],
        dead: loads.dead + annexes.loads.dead,
        live: loads.live + annexes.loads.live,
        snow: loads.snow + annexes.loads.snow,
        timberWeight: timber.weight,
        totalCharacteristic: loads.totalCharacteristic + annexes.loads.totalCharacteristic,
        totalDesign: loads.totalDesign + annexes.loads.totalDesign,
        complete: loads.complete && annexes.loads.complete,
        annexLoads: annexes.loads,
      };
      const sharedItems = annexes.items.filter((a) => a.foundation.shared);
      if (sharedItems.length) {
        const sharedSamples = sharedItems.flatMap((a) => a.sharedLoadSamples ?? []),
          unified = analyzeGrillageLoads(p, grillageModel, [...foundationSamples, ...sharedSamples]);
        Object.assign(grillageModel, unified);
        piles = unified.piles;
        for (const pile of piles) {
          pile.capacity = p.foundation.capacity;
          pile.utilization = pile.reaction / p.foundation.capacity;
          pile.status = pile.utilization > 1 ? "fail" : pile.utilization > 0.85 ? "warning" : "pass";
        }
        const obsolete = new Set([
          "grillage-strength",
          "grillage-balance",
          "grillage-ply-connections",
          "verticalBalance",
          "pileCapacity",
        ]);
        for (let i = checks.length - 1; i >= 0; i--) if (obsolete.has(checks[i].id)) checks.splice(i, 1);
        checks.push(...unified.loadChecks);
        const max = piles.reduce((a, b) => (!a || b.reaction > a.reaction ? b : a), null);
        checks.push(
          {
            id: "pileCapacity",
            label: "Общая рама: вертикальная реакция опоры",
            status: max?.utilization > 1 ? "fail" : "warning",
            value: max?.reaction ?? 0,
            limit: p.foundation.capacity,
            unit: "кН",
            utilization: max?.utilization ?? 0,
          },
          {
            id: "shared-foundation-connections",
            label: "Общий ростверк: соединения и пространственная работа",
            status: "unverified",
            note: "Дом и пристройка имеют общие физические балки и опорныеID. Нагрузки решены в одной сети простых пролётов. Гвозди/болты, смятие, горизонтальные усилия, неразрезность и разность осадок требуют отдельного расчёта.",
          },
        );
        grillageModel.sharedAnnexIds = sharedItems.map((a) => a.id);
        grillageModel.loadComponents = {
          houseSampleCount: foundationSamples.length,
          annexSampleCount: sharedSamples.length,
        };
      }
      piles = [...piles, ...annexes.piles];
      const maxPile = piles.reduce((x, y) => (!x || y.reaction > x.reaction ? y : x), null),
        reactionSum = sum(piles.map((p) => p.reaction)),
        characteristicSum = sum(piles.map((p) => p.reactionCharacteristic));
      foundation = {
        ...foundation,
        sharedGrillage: sharedItems.length > 0,
        connectedAnnexIds: sharedItems.map((a) => a.id),
        count: piles.length,
        maxPile,
        maxReaction: maxPile?.reaction ?? 0,
        utilization: Math.max(0, ...piles.map((p) => p.utilization ?? 0)),
        reactionSum,
        characteristicSum,
        balanceError: reactionSum - loads.totalDesign,
        status: piles.some((p) => (p.utilization ?? 0) > 1) ? "fail" : "unverified",
        components: [
          {
            id: "house",
            pileIds: housePiles.map((p) => p.id),
            reactionSum: houseFoundation?.reactionSum ?? 0,
          },
          ...annexes.items.map((a) => ({
            id: a.id,
            pileIds: a.foundation.piles.map((p) => p.id),
            reactionSum: a.loads.reactionSum,
          })),
        ],
      };
      checks.push({
        id: "combined-vertical-balance",
        label: sharedItems.length
          ? "Общая рама дома и пристройки: баланс"
          : "Дом и независимые пристройки: общий баланс",
        status: Math.abs(foundation.balanceError) < 1e-6 ? "pass" : "fail",
        value: foundation.balanceError,
        limit: 1e-6,
        unit: "кН",
      });
    }
  }
  if (truss && !roofModel) {
    checks.push(
      ...(Array.isArray(truss.checks) ? truss.checks.map((c) => ({ ...c, id: "truss-" + c.id })) : []),
    );
    if (truss.status === "fail" || truss.stable === false)
      checks.push({
        id: "trussSolution",
        label: "Расчётная модель фермы",
        status: "fail",
        note: (truss.errors || []).join(" ") || "Ферма не прошла частные проверки или является механизмом.",
      });
    if (Array.isArray(truss.assumptions)) assumptions.push(...truss.assumptions);
  }
  if (roofModel) {
    if (Array.isArray(roofModel.checks))
      checks.push(...roofModel.checks.map((c) => ({ ...c, id: "roof-" + c.id })));
    if (roofModel.status === "fail")
      checks.push({
        id: "roofZonesSolution",
        label: "Зонная модель кровли",
        status: "fail",
        note: "Кровля содержит невыполненные частные проверки.",
      });
    warnings.push(...(roofModel.warnings || []));
    assumptions.push(...(roofModel.assumptions || []));
  }
  analyzeProfiledBeam(p, { timber, loads, roofModel }, profiledBeam, foundationSamples);
  checks.push(...profiledBeam.checks);
  assumptions.push(...profiledBeam.assumptions);
  checks.push(
    {
      id: "roofSystem",
      label: "Покрытие и опирание кровли",
      status: "unverified",
      note: "Геометрия не подтверждает опирание ферм и устойчивость кровли.",
    },
    {
      id: "lateralStability",
      label: "Пространственная устойчивость",
      status: "unverified",
      note: "Связи, узлы, диафрагмы, ростверк и грунт требуют отдельных проверок.",
    },
  );
  return {
    project: p,
    validation,
    geometry,
    walls,
    corners,
    annexes,
    spatialLayout,
    houseLoads,
    houseTimberTotals,
    houseFoundation,
    housePiles,
    grillageModel,
    floorOpenings,
    floorPlatform,
    partitionHeads,
    auxiliaryTimber,
    fullHeightWalls,
    profiledBeam,
    bracingModel,
    graph: {
      nodes: levelModels.flatMap((l) =>
        l.graph.nodes.map(({ edges, ...n }) => ({
          ...n,
          id: l.index === 1 ? n.id : "j_" + l.index + "_" + nodeKey(n.point),
          level: l.index,
          degree: edges.length,
        })),
      ),
      edges: levelModels.flatMap((l) => l.graph.edges.map((e) => ({ ...e, level: l.index }))),
    },
    timber,
    splices: timber.splices,
    loads,
    piles,
    foundation,
    checks,
    warnings: [...new Set(warnings)],
    assumptions,
    roofModel: roofModel ?? null,
    status: !graph.closed ? "open" : checks.some((c) => c.status === "fail") ? "fail" : "unverified",
  };
}

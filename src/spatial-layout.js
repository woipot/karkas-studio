/** Spatial study: plan m, world [x,height,z], sections mm. No connection certification. */
const EPS = 1e-7,
  G = 9.80665,
  finite = Number.isFinite;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0),
  dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scalar = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  norm = (a) => Math.hypot(...a),
  unit = (a) => a.map((v) => v / norm(a));
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const signed = (p) => sum(p.map((a, i) => a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y)) / 2,
  area = (p) => Math.abs(signed(p));
const section = (s) => {
  const m = typeof s === "string" && s.replaceAll(" ", "").match(/^(\d+)[x×](\d+)$/);
  return m ? { b: +m[1], h: +m[2] } : null;
};
const frameWidth = (v) => (section(v.edgeSection)?.b ?? 0) * (v.edgePlies ?? 1);
const bounds = (p) => ({
  minX: Math.min(...p.map((q) => q.x)),
  maxX: Math.max(...p.map((q) => q.x)),
  minY: Math.min(...p.map((q) => q.y)),
  maxY: Math.max(...p.map((q) => q.y)),
});
const rect = (b) => [
  { x: b.minX, y: b.minY },
  { x: b.maxX, y: b.minY },
  { x: b.maxX, y: b.maxY },
  { x: b.minX, y: b.maxY },
];
function on(p, a, b) {
  return (
    Math.abs(cross(a, b, p)) < EPS &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
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
function overlap(A, B) {
  let p = A;
  const b = signed(B) > 0 ? B : [...B].reverse();
  for (let i = 0; i < b.length && p.length >= 3; i++) p = clip(p, b[i], b[(i + 1) % b.length]);
  return p.length >= 3 ? area(p) : 0;
}
function simple(p) {
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length],
        den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < EPS) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den,
        u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) return false;
    }
  return true;
}
const isPoly = (p) =>
  Array.isArray(p) &&
  p.length >= 3 &&
  p.length <= 200 &&
  p.every((q) => q && finite(q.x) && finite(q.y)) &&
  area(p) > EPS &&
  p.every((q, i) => dist(q, p[(i + 1) % p.length]) > EPS) &&
  simple(p);
const isRect = (p) =>
  isPoly(p) &&
  Math.abs(area(p) - (bounds(p).maxX - bounds(p).minX) * (bounds(p).maxY - bounds(p).minY)) < 1e-6;
const enabled = (p) => p?.spatialLayout !== undefined || (p?.doubleHeightSpaces?.length ?? 0) > 0;
export const spatialLayoutSources = [
  {
    title:
      "Finlex 1007/2017 · stairs, landings, guards, handrails and headroom; applicability requires design",
    url: "https://data.finlex.fi/fi/lainsaadanto/saadoskokoelma/2017/1007",
  },
];
export function validateSpatialLayoutInput(p = {}) {
  if (!p || typeof p !== "object" || Array.isArray(p))
    return [{ field: "project", message: "Нужен объект проекта." }];
  const errors = [],
    error = (field, message) => errors.push({ field, message }),
    object = (x) => x && typeof x === "object" && !Array.isArray(x),
    range = (v, a, b, f) => {
      if (v !== undefined && (!finite(v) || v < a || v > b)) error(f, `Конечное число ${a}…${b}.`);
    };
  if (p.spatialLayout !== undefined && !object(p.spatialLayout))
    error("spatialLayout", "Нужен объект критериев.");
  if (
    p.doubleHeightSpaces !== undefined &&
    (!Array.isArray(p.doubleHeightSpaces) || p.doubleHeightSpaces.length > 20)
  )
    error("doubleHeightSpaces", "Массив до20 пространств; null не является отключением.");
  if (!enabled(p)) return errors;
  const unknown = (o, keys, f) => {
    for (const k of Object.keys(o))
      if (!keys.includes(k)) error(f + "." + k, "Неизвестное поле; проверьте написание.");
  };
  const c = object(p.spatialLayout) ? p.spatialLayout : {};
  unknown(
    c,
    ["guardHeight", "maxGuardGap", "maxPostSpacing", "minGalleryWidth", "minStairClearWidth"],
    "spatialLayout",
  );
  if (p.voids !== undefined && !Array.isArray(p.voids)) error("voids", "Нужен массив проёмов.");
  for (const [i, v] of (Array.isArray(p.voids) ? p.voids : []).entries()) {
    if (!object(v) || !isPoly(v.polygon)) {
      error(`voids[${i}]`, "Нужен проём с простым полигоном.");
      continue;
    }
    if (v.edgePlies !== undefined && (!Number.isInteger(v.edgePlies) || v.edgePlies < 1 || v.edgePlies > 6))
      error(`voids[${i}].edgePlies`, "Число досок пакета1…6.");
  }
  for (const [k, a, b] of [
    ["guardHeight", 0.5, 1.8],
    ["maxGuardGap", 0.02, 0.2],
    ["maxPostSpacing", 0.3, 2],
    ["minGalleryWidth", 0.5, 3],
    ["minStairClearWidth", 0.5, 2],
  ])
    range(c[k], a, b, "spatialLayout." + k);
  const ids = new Set();
  for (const [i, s] of (Array.isArray(p.doubleHeightSpaces) ? p.doubleHeightSpaces : []).entries()) {
    const f = `doubleHeightSpaces[${i}]`;
    if (!object(s)) {
      error(f, "Нужен объект.");
      continue;
    }
    unknown(s, ["id", "voidId", "lowerRoomId", "galleryPaths", "daylightOpeningIds", "name", "note"], f);
    for (const k of ["id", "voidId", "lowerRoomId"])
      if (typeof s[k] !== "string" || !s[k].length || s[k].length > 160)
        error(f + "." + k, "Нужна непустая строка до160символов.");
    if (ids.has(s.id)) error(f + ".id", "Повторный ID.");
    ids.add(s.id);
    if (!Array.isArray(s.galleryPaths) || s.galleryPaths.length > 20)
      error(f + ".galleryPaths", "Нужен массив до20 явно заданных маршрутов.");
    for (const [j, g] of (Array.isArray(s.galleryPaths) ? s.galleryPaths : []).entries()) {
      if (!object(g) || typeof g.id !== "string" || !isRect(g.polygon))
        error(`${f}.galleryPaths[${j}]`, "Маршрут: id и прямоугольный полигон.");
      else {
        unknown(g, ["id", "polygon", "minWidth", "name", "note"], `${f}.galleryPaths[${j}]`);
        range(g.minWidth, 0.5, 3, `${f}.galleryPaths[${j}].minWidth`);
      }
    }
    if (
      s.daylightOpeningIds !== undefined &&
      (!Array.isArray(s.daylightOpeningIds) ||
        s.daylightOpeningIds.length > 100 ||
        s.daylightOpeningIds.some((id) => typeof id !== "string") ||
        new Set(s.daylightOpeningIds).size !== s.daylightOpeningIds.length)
    )
      error(f + ".daylightOpeningIds", "Нужен массив уникальных ID окон.");
  }
  const s = p.staircase;
  if (s !== undefined) {
    if (!object(s)) {
      error("staircase", "Нужен объект лестницы.");
      return errors;
    }
    if (!isRect(s.polygon)) error("staircase.polygon", "Пока поддержана прямоугольная U-лестница.");
    if (s.kind !== undefined && !["u-turn", "u"].includes(s.kind))
      error("staircase.kind", "Поддержана U-лестница.");
    for (const k of ["levelFrom", "levelTo"])
      if (!Number.isInteger(s[k]) || s[k] < 1 || s[k] > (p.floors ?? 2))
        error("staircase." + k, "Нужен номер существующего этажа.");
    if (s.levelTo !== s.levelFrom + 1) error("staircase.levelTo", "Лестница связывает соседние этажи.");
    if (
      !Number.isInteger(s.risers ?? 18) ||
      (s.risers ?? 18) < 8 ||
      (s.risers ?? 18) > 40 ||
      (s.risers ?? 18) % 2
    )
      error("staircase.risers", "Нужно чётное число подъёмов8…40.");
    if (s.exit !== undefined && !["east", "north", "west", "south"].includes(s.exit))
      error("staircase.exit", "east, north, west или south.");
    for (const [k, a, b] of [
      ["flightWidth", 0.6, 2],
      ["clearFlightWidth", 0.6, 2],
      ["flightGap", 0, 1],
      ["landingLength", 0.6, 3],
      ["tread", 0.15, 0.4],
      ["riserThickness", 10, 40],
    ])
      range(s[k], a, b, "staircase." + k);
    for (const k of [
      "treadSection",
      "stringerSection",
      "postSection",
      "railSection",
      "balusterSection",
      "landingBeamSection",
      "landingPostSection",
    ])
      if (s[k] !== undefined && (!section(s[k]) || section(s[k]).b < 10 || section(s[k]).h > 600))
        error("staircase." + k, "Некорректное сечение.");
    for (const k of ["postSection", "landingPostSection"]) {
      const sec = section(s[k]);
      if (sec && sec.b !== sec.h)
        error("staircase." + k, "Для текущей раскладки поддержаны квадратные стойки.");
    }
    const guardPost = section(s.postSection ?? "75x75");
    if (guardPost && (s.flightGap ?? 0.2) + EPS < (2 * guardPost.h) / 1000)
      error("staircase.flightGap", "Зазор между маршами должен вмещать две реальные внутренние линии стоек.");
    if (s.voidId !== undefined && typeof s.voidId !== "string") error("staircase.voidId", "Нужен ID проёма.");
  }
  return errors;
}

export function buildSpatialLayout(
  project,
  { geometry = {}, walls = project.walls ?? [], timber = {} } = {},
) {
  const out = {
    enabled: enabled(project),
    instances: [],
    staircases: [],
    guards: [],
    doubleHeightSpaces: [],
    galleries: [],
    surfaces: [],
    checks: [],
    warnings: [],
    assumptions: [],
    sources: spatialLayoutSources,
    quantities: {
      count: 0,
      volume: 0,
      mass: 0,
      weight: 0,
      treadArea: 0,
      landingArea: 0,
      guardLength: 0,
      daylightArea: 0,
    },
    status: "disabled",
    certified: false,
  };
  const errors = validateSpatialLayoutInput(project);
  if (errors.length) {
    out.checks = errors.map((e, i) => ({
      id: `spatial-input-${i}`,
      label: "Исходные данные пространственной модели",
      status: "fail",
      note: e.message,
      field: e.field,
    }));
    out.status = "fail";
    return out;
  }
  if (!out.enabled) return out;
  const c = {
      guardHeight: 1.1,
      maxGuardGap: 0.1,
      maxPostSpacing: 1,
      minGalleryWidth: 0.9,
      minStairClearWidth: 0.9,
      ...project.spatialLayout,
    },
    density = project.material?.density ?? 500;
  const check = (id, label, status, note, extra = {}) =>
    out.checks.push({ id, label, status, note, ...extra });
  const add = (id, name, role, sec, start, end, extra = {}) => {
    const length = norm(sub(end, start));
    if (!(length > EPS)) return null;
    const volume = (sec.b * sec.h * length) / 1e6,
      b = {
        id,
        name,
        role,
        category: "spatial",
        spatial: true,
        spatialRole: role,
        b: sec.b,
        h: sec.h,
        start,
        end,
        length,
        cutLength: length,
        actualCutLength: length,
        volume,
        netVolume: volume,
        mass: volume * density,
        grossVolume: volume,
        requireSingleStock: true,
        connectionVerified: false,
        cutStart: { scheme: "butt", angle: 0 },
        cutEnd: { scheme: "butt", angle: 0 },
        ...extra,
      };
    out.instances.push(b);
    return b;
  };
  const profileNet = (board, points, type = "rippedBoard") => {
    const A =
        Math.abs(
          sum(
            points.map(
              (p, i) => p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1],
            ),
          ),
        ) / 2,
      cut = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));
    board.shape = { type, points };
    board.shapeNetVolume = (A * board.b) / 1000;
    board.shapeGrossVolume = (cut * board.b * board.h) / 1e6;
    board.shapeCutLength = board.cutLength = board.actualCutLength = cut;
    board.volume = board.netVolume = board.shapeNetVolume;
    board.grossVolume = board.shapeGrossVolume;
    board.mass = board.volume * density;
    return board;
  };
  const at = (p, y) => [p.x, y, p.y],
    postCache = new Map();
  const guardPost = (id, p, low, high, sec, extra) => {
    const key = `${p.x.toFixed(6)}:${p.y.toFixed(6)}:${sec.b}:${sec.h}`,
      old = postCache.get(key);
    if (old) {
      old.start[1] = Math.min(old.start[1], low);
      old.end[1] = Math.max(old.end[1], high);
      old.length = old.cutLength = old.actualCutLength = old.end[1] - old.start[1];
      old.volume = old.netVolume = old.grossVolume = (sec.b * sec.h * old.length) / 1e6;
      old.mass = old.volume * density;
      old.guardIds = [...new Set([...(old.guardIds ?? []), extra.guardId])];
      return old;
    }
    const member = add(id, "Стойка ограждения", "guardPost", sec, at(p, low), at(p, high), {
      ...extra,
      guardIds: [extra.guardId],
    });
    postCache.set(key, member);
    return member;
  };
  const guard = (id, A, B, baseY, level, spatialId, omit = []) => {
    const L = dist(A, B);
    if (L < EPS) return;
    const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L },
      post = section(project.staircase?.postSection ?? "75x75"),
      rail = section(project.staircase?.railSection ?? "45x95"),
      bal = section(project.staircase?.balusterSection ?? "30x45");
    let intervals = [[0, L]];
    for (const [x, z] of omit) {
      intervals = intervals.flatMap(([a, b]) =>
        z <= a + EPS || x >= b - EPS
          ? [[a, b]]
          : [...(x > a + EPS ? [[a, x]] : []), ...(z < b - EPS ? [[z, b]] : [])],
      );
    }
    const ids = [];
    for (const [a, b] of intervals) {
      const n = Math.max(1, Math.ceil((b - a) / c.maxPostSpacing)),
        positions = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n),
        axis = (t) => ({ x: A.x + u.x * t, y: A.y + u.y * t });
      for (const [i, s] of positions.entries()) {
        const member = guardPost(
          `${id}-POST-${a.toFixed(4)}-${i}`,
          axis(s),
          baseY,
          baseY + c.guardHeight,
          post,
          { spatialId, guardId: id, level, floor: level, crossAxis: [u.x, 0, u.y] },
        );
        ids.push(member.id);
      }
      for (let i = 1; i < positions.length; i++) {
        const from = positions[i - 1] + post.b / 2000,
          to = positions[i] - post.b / 2000,
          clear = to - from;
        if (clear <= 0) continue;
        const A = axis(from),
          B = axis(to),
          normal = [-u.y, 0, u.x];
        for (const [name, y] of [
          ["TOP", baseY + c.guardHeight - rail.h / 2000],
          ["BASE", baseY + rail.h / 2000],
        ]) {
          const member = add(
            `${id}-${a.toFixed(4)}-RAIL-${i}-${name}`,
            "Доска ограждения",
            "guardRail",
            rail,
            at(A, y),
            at(B, y),
            { spatialId, level, floor: level, crossAxis: normal, position: name.toLowerCase() },
          );
          ids.push(member.id);
        }
        const count = Math.max(0, Math.ceil((clear - c.maxGuardGap) / (c.maxGuardGap + bal.b / 1000))),
          gap = (clear - (count * bal.b) / 1000) / (count + 1);
        for (let j = 0; j < count; j++) {
          const p = axis(from + gap + bal.b / 2000 + j * (gap + bal.b / 1000)),
            member = add(
              `${id}-${a.toFixed(4)}-BAL-${i}-${j}`,
              "Вертикальная балясина",
              "guardBaluster",
              bal,
              at(p, baseY + rail.h / 1000),
              at(p, baseY + c.guardHeight - rail.h / 1000),
              { spatialId, level, floor: level, crossAxis: [u.x, 0, u.y] },
            );
          ids.push(member.id);
        }
        check(
          `${id}-gap-${a.toFixed(4)}-${i}`,
          "Просвет вертикального заполнения",
          gap <= c.maxGuardGap + EPS ? "pass" : "fail",
          "Геометрический критерий проекта; прочность ограждения и применимость нормативных требований не подтверждены.",
          { value: gap, limit: c.maxGuardGap, unit: "м" },
        );
      }
    }
    out.guards.push({
      id,
      spatialId,
      level,
      start: at(A, baseY),
      end: at(B, baseY),
      height: c.guardHeight,
      boardIds: [...new Set(ids)],
      exitIntervals: omit,
      kind: "levelGuard",
      connectionVerified: false,
    });
    out.quantities.guardLength += sum(intervals, (q) => q[1] - q[0]);
  };
  const flightGuard = ({
    id,
    spatialId,
    level,
    A,
    D,
    length,
    surfaceAt,
    gradeAt,
    outer,
    extendEnd = 0,
    extendStart = 0,
  }) => {
    const post = section(project.staircase?.postSection ?? "75x75"),
      rail = section(project.staircase?.railSection ?? "45x95"),
      bal = section(project.staircase?.balusterSection ?? "30x45"),
      postWidth = post.b / 1000,
      n = Math.max(1, Math.ceil(length / c.maxPostSpacing)),
      stations = Array.from({ length: n + 1 }, (_, i) => (length * i) / n);
    stations[0] += extendStart;
    stations[stations.length - 1] += extendEnd;
    const point = (t) => ({ x: A.x + D.x * t, y: A.y + D.y * t }),
      ids = [],
      slope = (gradeAt(length) - gradeAt(0)) / length,
      angle = Math.atan(slope),
      cos = Math.cos(angle),
      axisY = (t) => gradeAt(t) + c.guardHeight - rail.h / 2000 / cos,
      topCut = {
        scheme: "miter",
        angle: (Math.abs(angle) * 180) / Math.PI,
        plane: "depth",
        cutWidthMM: rail.h,
      };
    for (const [i, t] of stations.entries()) {
      const base = outer
          ? surfaceAt(t + postWidth / 2)
          : Math.max(geometry.levels.find((l) => l.index === level)?.wallBaseY ?? 0, surfaceAt(t) - 0.25),
        top = gradeAt(Math.min(length, t + postWidth / 2)) + c.guardHeight,
        member = guardPost(`${id}-POST-${i}`, point(t), base, top, post, {
          spatialId,
          guardId: id,
          level,
          floor: level,
          crossAxis: [D.x, 0, D.y],
          sideMounted: !outer,
        });
      ids.push(member.id);
    }
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1] + postWidth / 2,
        b = Math.min(length, stations[i] - postWidth / 2),
        L = b - a;
      if (L < EPS) continue;
      const member = add(
        `${id}-RAIL-${i}`,
        "Наклонный поручень марша",
        "stairHandrail",
        rail,
        at(point(a), axisY(a)),
        at(point(b), axisY(b)),
        {
          spatialId,
          guardId: id,
          level,
          floor: level,
          crossAxis: [-D.y, 0, D.x],
          cutStart: { ...topCut, tiltSign: 1 },
          cutEnd: { ...topCut, tiltSign: -1 },
        },
      );
      member.cutLength = member.actualCutLength = member.length + (rail.h / 1000) * Math.tan(Math.abs(angle));
      member.grossVolume = (member.cutLength * member.b * member.h) / 1e6;
      ids.push(member.id);
      const count = Math.max(0, Math.ceil((L - c.maxGuardGap) / (c.maxGuardGap + bal.b / 1000))),
        gap = (L - (count * bal.b) / 1000) / (count + 1);
      for (let j = 0; j < count; j++) {
        const t = a + gap + bal.b / 2000 + j * (gap + bal.b / 1000),
          bottom = surfaceAt(t + bal.b / 2000),
          top = gradeAt(t) + c.guardHeight - rail.h / 1000 / cos,
          member = add(
            `${id}-BAL-${i}-${j}`,
            "Вертикальное заполнение марша",
            "stairBaluster",
            bal,
            at(point(t), bottom),
            at(point(t), top),
            {
              spatialId,
              guardId: id,
              level,
              floor: level,
              crossAxis: [D.x, 0, D.y],
              sideMounted: !outer,
              cutEnd: {
                scheme: "miter",
                plane: "width",
                angle: (Math.abs(angle) * 180) / Math.PI,
                tiltSign: 1,
                cutWidthMM: bal.b,
              },
            },
          );
        if (member) {
          member.cutLength = member.actualCutLength =
            member.length + (bal.b / 2000) * Math.tan(Math.abs(angle));
          member.grossVolume = (member.cutLength * member.b * member.h) / 1e6;
          ids.push(member.id);
        }
      }
      check(
        `${id}-gap-${i}`,
        "Просвет заполнения марша",
        gap <= c.maxGuardGap + EPS ? "pass" : "fail",
        "Проверен горизонтальный просвет вертикальных элементов; угловые и нижние щели, нагрузка, захват и непрерывность поручня требуют рабочего узла.",
        { value: gap, limit: c.maxGuardGap, unit: "м" },
      );
    }
    out.guards.push({
      id,
      spatialId,
      level,
      kind: "flightGuard",
      start: at(point(0), surfaceAt(0)),
      end: at(point(length), surfaceAt(length)),
      height: c.guardHeight,
      boardIds: [...new Set(ids)],
      connectionVerified: false,
    });
    out.quantities.guardLength += length;
  };
  let stair = null;
  const s = project.staircase;
  if (s) {
    const id = s.id ?? "STAIR",
      from = geometry.levels?.find((l) => l.index === s.levelFrom),
      to = geometry.levels?.find((l) => l.index === s.levelTo),
      voids = project.voids ?? [],
      hole =
        voids.find((v) => v.id === s.voidId) ??
        voids.find((v) => v.level === s.levelTo && s.polygon.every((q) => inside(q, v.polygon)));
    if (!from || !to || !hole) {
      check(
        "spatial-stair-reference",
        "Этажи и единый проём лестницы",
        "fail",
        "Нужны существующие этажи и проём, содержащий лестницу.",
      );
    } else {
      const exit = s.exit ?? "east",
        U = { east: { x: 1, y: 0 }, north: { x: 0, y: -1 }, west: { x: -1, y: 0 }, south: { x: 0, y: 1 } }[
          exit
        ],
        V = { x: -U.y, y: U.x },
        local = s.polygon.map((p) => ({ x: p.x * U.x + p.y * U.y, y: p.x * V.x + p.y * V.y })),
        b = bounds(local),
        W = s.flightWidth ?? s.clearFlightWidth ?? 1,
        gap = s.flightGap ?? 0.2,
        landing = s.landingLength ?? 1,
        risers = s.risers ?? 18,
        per = risers / 2,
        rise = to.wallBaseY - from.wallBaseY,
        riser = rise / risers,
        going = s.tread ?? 0.275,
        run = going * (per - 1),
        expectedLength = landing + run,
        width = 2 * W + gap,
        point = (u, v) => ({ x: U.x * u + V.x * v, y: U.y * u + V.y * v }),
        world = (u, v, y) => at(point(u, v), y),
        plan = (u0, v0, u1, v1) => [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)],
        treadSec = section(s.treadSection ?? "40x275"),
        T = treadSec.b / 1000,
        stringer = section(s.stringerSection ?? "75x300"),
        SB = stringer.b / 1000,
        landingBeam = section(s.landingBeamSection ?? "75x300"),
        post = section(s.landingPostSection ?? "100x100"),
        ids = [],
        treads = [],
        flightModels = [];
      const frameHalf = frameWidth(hole) / 2000,
        holeLocal = hole.polygon.map((p) => ({ x: p.x * U.x + p.y * U.y, y: p.x * V.x + p.y * V.y })),
        holeBounds = bounds(holeLocal),
        clearBounds = {
          minX: holeBounds.minX + frameHalf,
          maxX: holeBounds.maxX - frameHalf,
          minY: holeBounds.minY + frameHalf,
          maxY: holeBounds.maxY - frameHalf,
        },
        fit =
          isRect(hole.polygon) &&
          Math.abs(b.maxX - b.minX - expectedLength) < 0.005 &&
          Math.abs(b.maxY - b.minY - width) < 0.005 &&
          local.every(
            (q) =>
              q.x >= clearBounds.minX - EPS &&
              q.x <= clearBounds.maxX + EPS &&
              q.y >= clearBounds.minY - EPS &&
              q.y <= clearBounds.maxY + EPS,
          );
      check(
        `${id}-fit`,
        "Лестница внутри чистого проёма",
        fit ? "pass" : "fail",
        "Пока поддержан прямоугольный проём: проверены внутренние грани реального обрамления, а не оси voidpolygon. Верхний выход получает явный настил на внутренней половине опорной балки.",
        { expectedLength, expectedWidth: width, voidId: hole.id, frameHalfWidth: frameHalf, clearBounds },
      );
      check(
        `${id}-step`,
        "Геометрия подъёмов и проступей",
        riser > 0 && riser <= 0.19 && going >= 0.25 ? "pass" : "fail",
        "Частное сравнение с принятым ориентиром для внутренней лестницы квартиры; не подтверждает общую безопасность или согласование.",
        { riser, tread: going, risers, source: spatialLayoutSources[0].url },
      );
      const actualClear = W - section(s.postSection ?? "75x75").b / 1000;
      check(
        `${id}-clear`,
        "Принятая ширина марша",
        actualClear >= c.minStairClearWidth ? "pass" : "fail",
        "flightWidth — номинальная ширина досок ступени. Приведён консервативный резерв под стойки; поручни и точная ширина прохода ещё не спроектированы.",
        { value: actualClear, limit: c.minStairClearWidth, unit: "м" },
      );
      if (fit && rise > 0) {
        for (let flight = 0; flight < 2; flight++) {
          const direction = flight ? U : { x: -U.x, y: -U.y },
            v0 = b.minY + flight * (W + gap),
            v1 = v0 + W,
            startU = flight ? b.minX + landing : b.maxX,
            startY = from.wallBaseY + flight * per * riser,
            dir = flight ? 1 : -1,
            stepPoint = (t, v, y) => world(startU + dir * t, v, y),
            flightId = `${id}-F${flight + 1}`;
          for (let n = 1; n < per; n++) {
            const a = (n - 1) * going,
              z = n * going,
              top = startY + n * riser,
              mid = (a + z) / 2,
              member = add(
                `${flightId}-T${n}`,
                "Доска ступени",
                "stairTread",
                { b: treadSec.b, h: Math.round(going * 1000) },
                stepPoint(mid, v0, top - T / 2),
                stepPoint(mid, v1, top - T / 2),
                {
                  spatialId: id,
                  staircaseId: id,
                  flight: flight + 1,
                  step: n,
                  level: s.levelFrom,
                  floor: s.levelFrom,
                  crossAxis: [0, 1, 0],
                },
              );
            ids.push(member.id);
            const points = plan(startU + dir * a, v0, startU + dir * z, v1).map((p) => at(p, top));
            out.surfaces.push({
              id: `${member.id}-SURFACE`,
              kind: "stairTread",
              points,
              sourceBoardIds: [member.id],
            });
            treads.push({ id: member.id, flight: flight + 1, step: n, height: top, points });
          }
          for (let n = 1; n <= per; n++) {
            const t = (n - 1) * going,
              lo = startY + (n - 1) * riser,
              hi = startY + n * riser - T,
              th = (s.riserThickness ?? 20) / 1000,
              center = t + ((n === per ? -1 : 1) * th) / 2,
              member = add(
                `${flightId}-R${n}`,
                "Доска подступенка",
                "stairRiser",
                { b: Math.round(th * 1000), h: Math.ceil(((hi - lo) * 1000) / 25) * 25 },
                stepPoint(center, v0 + SB, (lo + hi) / 2),
                stepPoint(center, v1 - SB, (lo + hi) / 2),
                {
                  spatialId: id,
                  staircaseId: id,
                  flight: flight + 1,
                  step: n,
                  level: s.levelFrom,
                  floor: s.levelFrom,
                  crossAxis: [direction.x, 0, direction.y],
                },
              );
            if (member) {
              profileNet(member, [
                [-member.length / 2, -(hi - lo) / 2],
                [member.length / 2, -(hi - lo) / 2],
                [member.length / 2, (hi - lo) / 2],
                [-member.length / 2, (hi - lo) / 2],
              ]);
              ids.push(member.id);
            }
          }
          const q = riser / going,
            theta = Math.atan(q),
            cos = Math.cos(theta),
            sin = Math.sin(theta),
            axisStartY = startY + riser - T - stringer.h / 2000 / cos,
            axisEndY = axisStartY + q * run,
            upper = (t) => startY + riser - T + q * t,
            lower = (t) => upper(t) - stringer.h / 1000 / cos,
            foot = Math.max(0, Math.min(run, (startY - lower(0)) / q)),
            shape2 = [];
          shape2.push({ t: 0, y: startY });
          if (foot > EPS) shape2.push({ t: foot, y: startY });
          shape2.push({ t: run, y: lower(run) });
          for (let n = per - 1; n >= 1; n--) {
            shape2.push({ t: n * going, y: startY + n * riser - T });
            shape2.push({ t: (n - 1) * going, y: startY + n * riser - T });
          }
          const localShape = shape2.map((p) => {
              const dt = p.t - run / 2,
                dy = p.y - (axisStartY + axisEndY) / 2;
              return [dt * cos + dy * sin, -dt * sin + dy * cos];
            }),
            polygonArea =
              Math.abs(
                sum(
                  localShape.map(
                    (p, i) =>
                      p[0] * localShape[(i + 1) % localShape.length][1] -
                      localShape[(i + 1) % localShape.length][0] * p[1],
                  ),
                ),
              ) / 2,
            cutLength = Math.max(...localShape.map((p) => p[0])) - Math.min(...localShape.map((p) => p[0]));
          for (const [i, v] of [v0 + SB / 2, v1 - SB / 2].entries()) {
            const member = add(
              `${flightId}-STRINGER-${i + 1}`,
              "Пильный косоур",
              "stairStringer",
              stringer,
              stepPoint(0, v, axisStartY),
              stepPoint(run, v, axisEndY),
              {
                spatialId: id,
                staircaseId: id,
                flight: flight + 1,
                level: s.levelFrom,
                floor: s.levelFrom,
                crossAxis: [-direction.y, 0, direction.x],
                shape: { type: "stairStringer", points: localShape },
                shapeNetVolume: polygonArea * SB,
                shapeGrossVolume: (cutLength * stringer.b * stringer.h) / 1e6,
                shapeCutLength: cutLength,
                cutLength,
                actualCutLength: cutLength,
              },
            );
            member.volume = member.netVolume = member.shapeNetVolume;
            member.mass = member.volume * density;
            member.grossVolume = member.shapeGrossVolume;
            ids.push(member.id);
          }
          const guardSection = section(s.postSection ?? "75x75"),
            postHalf = guardSection.h / 2000,
            surfaceAt = (t) => startY + Math.min(per, Math.max(1, Math.ceil((t + EPS) / going))) * riser,
            gradeAt = (t) => startY + riser + (riser / going) * Math.max(0, Math.min(run, t));
          const guardLines = flight
            ? [
                {
                  name: "INNER",
                  v: v0 - postHalf,
                  outer: false,
                  start: guardSection.b / 2000,
                  end: -guardSection.b / 2000,
                },
                {
                  name: "OUTER",
                  v: v1 - postHalf,
                  outer: true,
                  start: -guardSection.b / 2000,
                  end: guardSection.b / 2000,
                },
              ]
            : [
                { name: "OUTER", v: v0 + postHalf, outer: true, start: 0, end: 0 },
                { name: "INNER", v: v1 + postHalf, outer: false, start: 0, end: -guardSection.b / 2000 },
              ];
          for (const line of guardLines)
            flightGuard({
              id: `${flightId}-GUARD-${line.name}`,
              spatialId: id,
              level: s.levelFrom,
              A: point(startU, line.v),
              D: direction,
              length: run,
              surfaceAt,
              gradeAt,
              outer: line.outer,
              extendStart: line.start,
              extendEnd: line.end,
            });
          flightModels.push({
            id: flightId,
            polygon: plan(startU, v0, startU + dir * run, v1),
            startHeight: startY,
            endHeight: startY + per * riser,
            direction: [direction.x, 0, direction.y],
            treadCount: per - 1,
          });
        }
        const landingY = from.wallBaseY + per * riser,
          landingPolygon = plan(b.minX, b.minY, b.minX + landing, b.minY + width),
          beamHalf = landingBeam.b / 2000,
          beamBottom = landingY - T - landingBeam.h / 1000;
        for (const [i, u] of [b.minX + beamHalf, b.minX + landing - beamHalf].entries()) {
          const member = add(
            `${id}-LAND-BEAM-${i}`,
            "Балка промежуточной площадки",
            "stairLandingJoist",
            landingBeam,
            world(u, b.minY, landingY - T - landingBeam.h / 2000),
            world(u, b.minY + width, landingY - T - landingBeam.h / 2000),
            {
              spatialId: id,
              staircaseId: id,
              level: s.levelFrom,
              floor: s.levelFrom,
              crossAxis: [U.x, 0, U.y],
            },
          );
          ids.push(member.id);
          for (const [j, v] of [b.minY + post.h / 2000, b.minY + width - post.h / 2000].entries()) {
            const member = add(
              `${id}-LAND-POST-${i}-${j}`,
              "Стойка площадки лестницы",
              "stairLandingPost",
              post,
              world(u, v, from.wallBaseY),
              world(u, v, beamBottom),
              {
                spatialId: id,
                staircaseId: id,
                level: s.levelFrom,
                floor: s.levelFrom,
                crossAxis: [U.x, 0, U.y],
              },
            );
            ids.push(member.id);
          }
        }
        const count = Math.ceil(width / (treadSec.h / 1000));
        for (let i = 0; i < count; i++) {
          const deckWidth = Math.min(treadSec.h / 1000, width - (i * treadSec.h) / 1000),
            v = b.minY + (i * treadSec.h) / 1000 + deckWidth / 2,
            member = add(
              `${id}-LAND-DECK-${i}`,
              "Доска настила площадки",
              "stairLandingDeck",
              treadSec,
              world(b.minX, v, landingY - T / 2),
              world(b.minX + landing, v, landingY - T / 2),
              {
                spatialId: id,
                staircaseId: id,
                level: s.levelFrom,
                floor: s.levelFrom,
                crossAxis: [0, 1, 0],
              },
            );
          if (deckWidth < treadSec.h / 1000 - EPS)
            profileNet(member, [
              [-member.length / 2, -deckWidth / 2],
              [member.length / 2, -deckWidth / 2],
              [member.length / 2, deckWidth / 2],
              [-member.length / 2, deckWidth / 2],
            ]);
          ids.push(member.id);
        }
        out.surfaces.push({
          id: `${id}-LAND-SURFACE`,
          kind: "stairLanding",
          points: landingPolygon.map((p) => at(p, landingY)),
          sourceBoardIds: ids.filter((id) => id.includes("LAND-DECK")),
        });
        out.quantities.treadArea += 2 * (per - 1) * going * W;
        out.quantities.landingArea += landing * width;
        const thresholdLength = Math.max(0, holeBounds.maxX - b.maxX),
          thresholdStock = {
            b: 35,
            h:
              [98, 148, 198, 248, 298, 348, 398, 448, 498, 598].find((h) => h + EPS >= frameWidth(hole)) ??
              Math.ceil(frameWidth(hole) / 25) * 25,
          };
        if (thresholdLength > EPS) {
          const u = (b.maxX + holeBounds.maxX) / 2,
            member = add(
              `${id}-EXIT-THRESHOLD`,
              "Настил выхода над внутренней половиной обрамления",
              "stairExitThreshold",
              thresholdStock,
              world(u, b.minY + W + gap, to.wallBaseY - 0.0175),
              world(u, b.minY + width, to.wallBaseY - 0.0175),
              {
                spatialId: id,
                staircaseId: id,
                level: s.levelTo,
                floor: s.levelTo,
                crossAxis: [0, 1, 0],
                onOpeningFrameId: hole.id,
                replacesManualFloorLayers: false,
              },
            );
          profileNet(member, [
            [-member.length / 2, -thresholdLength / 2],
            [member.length / 2, -thresholdLength / 2],
            [member.length / 2, thresholdLength / 2],
            [-member.length / 2, thresholdLength / 2],
          ]);
          ids.push(member.id);
          out.surfaces.push({
            id: `${id}-EXIT-SURFACE`,
            kind: "stairExitThreshold",
            points: plan(b.maxX, b.minY + W + gap, holeBounds.maxX, b.minY + width).map((p) =>
              at(p, to.wallBaseY),
            ),
            sourceBoardIds: [member.id],
          });
        }
        const exitA = point(holeBounds.maxX, b.minY + W + gap),
          exitB = point(holeBounds.maxX, b.minY + width),
          entry = point(b.maxX, b.minY + W / 2),
          exitPoint = point(holeBounds.maxX, b.minY + W + gap + W / 2),
          arrival = point(
            holeBounds.maxX + frameHalf + section(s.postSection ?? "75x75").h / 1000,
            b.minY + W + gap + W / 2,
          );
        const inset = section(s.postSection ?? "75x75").b / 2000,
          westA = point(b.minX + inset, b.minY + inset),
          westB = point(b.minX + inset, b.minY + width - inset);
        guard(`${id}-LAND-GUARD-W`, westA, westB, landingY, s.levelFrom, id);
        guard(
          `${id}-LAND-GUARD-N`,
          westA,
          point(b.minX + landing, b.minY + inset),
          landingY,
          s.levelFrom,
          id,
        );
        guard(
          `${id}-LAND-GUARD-S`,
          westB,
          point(b.minX + landing - inset, b.minY + width - inset),
          landingY,
          s.levelFrom,
          id,
        );
        guard(
          `${id}-EXIT-INNER-GUARD`,
          point(b.maxX - inset, b.minY + W + gap - inset),
          point(holeBounds.maxX + frameHalf + inset, b.minY + W + gap - inset),
          to.wallBaseY,
          s.levelTo,
          id,
        );
        stair = {
          id,
          voidId: hole.id,
          levelFrom: s.levelFrom,
          levelTo: s.levelTo,
          baseY: from.wallBaseY,
          topY: to.wallBaseY,
          rise,
          risers,
          riser,
          tread: going,
          run,
          flightWidth: W,
          actualClearWidth: actualClear,
          flightGap: gap,
          landingLength: landing,
          landingPolygon,
          landingHeight: landingY,
          polygon: s.polygon,
          flights: flightModels,
          treads,
          boardIds: ids,
          entry: { point: at(entry, from.wallBaseY), direction: [-U.x, 0, -U.y] },
          exit: {
            point: at(exitPoint, to.wallBaseY),
            clearGalleryArrival: at(arrival, to.wallBaseY),
            approachKind: "existing upper floor beyond the threshold",
            direction: [U.x, 0, U.y],
            edge: [exitA, exitB],
          },
          handrailsVerified: false,
          connectionVerified: false,
        };
        out.staircases.push(stair);
      }
      check(
        `${id}-connections`,
        "Опоры лестницы и местные реакции",
        "unverified",
        "Косоуры показаны с реальными пильными выборками, площадка — с досками и стойками. Кронштейны, болты, смятие, ослабленные сечения, местные реакции на нижний пол/обрамление и прочность лестницы не рассчитаны.",
      );
      check(
        `${id}-handrails`,
        "Поручни и защитное ограждение маршей",
        "unverified",
        "Деревянные поручни и вертикальное заполнение показаны с обеих сторон маршей. Захват, непрерывность в переходах, все нижние/угловые щели, крепления и совместный узел с галереей требуют рабочего проекта.",
      );
      check(
        `${id}-headroom`,
        "Высота прохода над ступенями",
        "unverified",
        "Нужна проверка фактического потолка/скатов и всех кромок перекрытия по линии движения. Форма проёма сама по себе не подтверждает высоту прохода.",
      );
    }
  }
  for (const space of project.doubleHeightSpaces ?? []) {
    const hole = (project.voids ?? []).find((v) => v.id === space.voidId),
      upper = geometry.levels?.find((l) => l.index === hole?.level),
      lower = geometry.levels?.find((l) => l.index === hole?.level - 1),
      room = (project.roomSchedule ?? []).find((r) => r.id === space.lowerRoomId);
    if (!hole || hole.kind !== "doubleHeight" || !upper || !lower) {
      check(
        `${space.id}-reference`,
        "Единый проём второго света",
        "fail",
        "Нужен один существующий doubleHeight проём верхнего этажа.",
      );
      continue;
    }
    const attached = room && room.level === lower.index ? overlap(hole.polygon, room.polygon) : 0;
    check(
      `${space.id}-room`,
      "Связь второго света с нижней комнатой",
      attached > EPS ? "pass" : "fail",
      "Проверено пересечение фактического проёма с явно указанной нижней комнатой.",
      { value: attached, unit: "м²", lowerRoomId: space.lowerRoomId },
    );
    const galleries = [];
    for (const path of space.galleryPaths) {
      const b = bounds(path.polygon),
        hb = bounds(hole.polygon),
        grossWidth = Math.min(b.maxX - b.minX, b.maxY - b.minY),
        vertical = b.maxY - b.minY > b.maxX - b.minX,
        band = frameWidth(hole) / 2000 + section(project.staircase?.postSection ?? "75x75").h / 1000,
        guardIntrusion = Math.min(
          grossWidth,
          Math.max(
            0,
            ...(vertical
              ? [
                  b.minX >= hb.maxX - EPS ? hb.maxX + band - b.minX : 0,
                  b.maxX <= hb.minX + EPS ? b.maxX - (hb.minX - band) : 0,
                ]
              : [
                  b.minY >= hb.maxY - EPS ? hb.maxY + band - b.minY : 0,
                  b.maxY <= hb.minY + EPS ? b.maxY - (hb.minY - band) : 0,
                ]),
          ),
        ),
        width = Math.max(0, grossWidth - guardIntrusion),
        threshold = path.minWidth ?? c.minGalleryWidth,
        contained = path.polygon.every((q) => inside(q, upper.polygon)),
        holeOverlap = sum(
          (project.voids ?? []).filter((v) => v.level === upper.index),
          (v) => overlap(path.polygon, v.polygon),
        ),
        blockers = walls
          .filter((w) => (w.level ?? 1) === upper.index)
          .filter((w) => {
            const L = dist(w.a, w.b),
              sec = section(w.section);
            if (!sec || L < EPS) return false;
            const nx = ((-(w.b.y - w.a.y) / L) * sec.h) / 2000,
              ny = (((w.b.x - w.a.x) / L) * sec.h) / 2000,
              poly = [
                { x: w.a.x + nx, y: w.a.y + ny },
                { x: w.b.x + nx, y: w.b.y + ny },
                { x: w.b.x - nx, y: w.a.y - ny },
                { x: w.a.x - nx, y: w.a.y - ny },
              ];
            return overlap(path.polygon, poly) > 1e-6;
          })
          .map((w) => w.id),
        status =
          width + EPS >= threshold && contained && holeOverlap < EPS && !blockers.length ? "pass" : "fail";
      const g = {
        id: path.id,
        spaceId: space.id,
        level: upper.index,
        polygon: path.polygon,
        width,
        grossWidth,
        guardIntrusion,
        minWidth: threshold,
        area: area(path.polygon),
        status,
        blockedByWallIds: blockers,
        explicitRoute: true,
      };
      galleries.push(g);
      out.galleries.push(g);
      check(
        `${space.id}-${path.id}-width`,
        "Явный маршрут галереи",
        status,
        "Из ширины вычтено выступание реальных стоек ограждения на настил. Узкие остаточные полосы у стен не считаются маршрутами; проверены проёмы и полосы стен.",
        { value: width, limit: threshold, unit: "м", blockedByWallIds: blockers },
      );
    }
    const exitPoint = stair ? { x: stair.exit.point[0], y: stair.exit.point[2] } : null,
      approach = stair
        ? Array.from({ length: 31 }, (_, i) => ({
            x: exitPoint.x + stair.exit.direction[0] * i * 0.01,
            y: exitPoint.y + stair.exit.direction[2] * i * 0.01,
          })).filter((q) => inside(q, upper.polygon) && !inside(q, hole.polygon))
        : [],
      reached = new Set(
        galleries
          .map((g, i) => (exitPoint && [exitPoint, ...approach].some((q) => inside(q, g.polygon)) ? i : -1))
          .filter((i) => i >= 0),
      );
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < galleries.length; i++)
        if (!reached.has(i))
          for (const j of reached) {
            const a = bounds(galleries[i].polygon),
              b = bounds(galleries[j].polygon),
              ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
              oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
            if (ox >= -EPS && oy >= -EPS && (ox > EPS || oy > EPS)) {
              reached.add(i);
              changed = true;
              break;
            }
          }
    }
    const connected =
      stair && stair.voidId === hole.id && galleries.length > 0 && reached.size === galleries.length;
    check(
      `${space.id}-exit`,
      "Выход лестницы на галерею",
      connected ? "pass" : "fail",
      "Выход верхнего марша и все явно заданные участки маршрута должны соединяться проходом, а не единственной точкой.",
      { staircaseId: stair?.id ?? null, reachableGalleryIds: [...reached].map((i) => galleries[i].id) },
    );
    const polygon = signed(hole.polygon) > 0 ? hole.polygon : [...hole.polygon].reverse(),
      inset = section(project.staircase?.postSection ?? "75x75").b / 2000,
      frame = frameWidth(hole) / 2000,
      offset = frame + inset;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        L = dist(a, b),
        u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L },
        normal = { x: -u.y, y: u.x },
        A = { x: a.x - u.x * offset - normal.x * offset, y: a.y - u.y * offset - normal.y * offset },
        B = { x: b.x + u.x * offset - normal.x * offset, y: b.y + u.y * offset - normal.y * offset },
        omit = [];
      if (stair?.voidId === hole.id && stair.exit.edge.every((p) => Math.abs(cross(a, b, p)) / L < 0.005)) {
        const station = (p) => (p.x - A.x) * u.x + (p.y - A.y) * u.y;
        omit.push([
          Math.max(0, Math.min(...stair.exit.edge.map(station)) - inset),
          Math.min(dist(A, B), Math.max(...stair.exit.edge.map(station)) + inset),
        ]);
      }
      guard(`${space.id}-G${i + 1}`, A, B, upper.wallBaseY, upper.index, space.id, omit);
    }
    const crossing = walls
      .filter((w) => (w.level ?? 1) === upper.index)
      .filter((w) => {
        const L = dist(w.a, w.b),
          sec = section(w.section);
        if (!sec || L < EPS) return false;
        const nx = ((-(w.b.y - w.a.y) / L) * sec.h) / 2000,
          ny = (((w.b.x - w.a.x) / L) * sec.h) / 2000;
        return (
          overlap(hole.polygon, [
            { x: w.a.x + nx, y: w.a.y + ny },
            { x: w.b.x + nx, y: w.b.y + ny },
            { x: w.b.x - nx, y: w.b.y - ny },
            { x: w.a.x - nx, y: w.a.y - ny },
          ]) > EPS
        );
      })
      .map((w) => w.id);
    check(
      `${space.id}-walls`,
      "Верхние стены над открытым объёмом",
      crossing.length ? "fail" : "pass",
      "Проверено пересечение полосы реальной стены с открытым проёмом. Вымышленная опора над вторым светом не добавляется.",
      { wallIds: crossing },
    );
    const daylight = [];
    for (const id of space.daylightOpeningIds ?? []) {
      const o = (project.openings ?? []).find((o) => o.id === id),
        w = walls.find((w) => w.id === o?.wallId);
      if (!o || !w || o.type !== "window" || (o.floor ?? w.level ?? 1) !== upper.index) {
        check(
          `${space.id}-daylight-${id}`,
          "Верхнее окно второго света",
          "fail",
          "Нужен существующий оконный проём верхнего этажа.",
        );
        continue;
      }
      const L = dist(w.a, w.b),
        u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L },
        p0 = { x: w.a.x + u.x * o.offset, y: w.a.y + u.y * o.offset },
        p1 = { x: p0.x + u.x * o.width, y: p0.y + u.y * o.width },
        bottom = upper.wallBaseY + o.sill,
        points = [at(p0, bottom), at(p1, bottom), at(p1, bottom + o.height), at(p0, bottom + o.height)];
      out.surfaces.push({
        id: `${space.id}-GLASS-${id}`,
        kind: "daylightGlazing",
        openingId: id,
        points,
        existingOpening: true,
        massIncludedBy: "global opening layers",
      });
      daylight.push(id);
      out.quantities.daylightArea += o.width * o.height;
    }
    check(
      `${space.id}-daylight`,
      "Свет из верхних окон",
      "unverified",
      "Показаны существующие верхние окна. Освещённость, коэффициент естественного освещения, затенение и прозрачность ограждений не рассчитаны.",
      { openingIds: daylight },
    );
    out.doubleHeightSpaces.push({
      id: space.id,
      voidId: hole.id,
      polygon: hole.polygon,
      lowerLevel: lower.index,
      upperLevel: upper.index,
      baseY: lower.wallBaseY,
      upperFloorY: upper.wallBaseY,
      topY: upper.topY,
      lowerRoomId: space.lowerRoomId,
      lowerRoomOverlapArea: attached,
      galleryIds: galleries.map((g) => g.id),
      daylightOpeningIds: daylight,
      staircaseId: stair?.voidId === hole.id ? stair.id : null,
      sectionSuggestion: { axis: "z", value: (bounds(hole.polygon).minY + bounds(hole.polygon).maxY) / 2 },
      certified: false,
    });
  }
  for (const b of out.instances)
    if (!finite(b.mass) || !finite(b.volume) || b.cutLength > 6 + EPS)
      check(
        `spatial-stock-${b.id}`,
        "Цельная заготовка пространственной конструкции",
        "fail",
        "Есть некорректная или превышающая6м деталь; скрытый стык не вставляется.",
        { memberId: b.id, value: b.cutLength, limit: 6, unit: "м" },
      );
  const collisions = [];
  for (const b of out.instances.filter((b) => /guard|baluster|handrail/i.test(b.role))) {
    const u = unit(sub(b.end, b.start)),
      width = unit(b.crossAxis.map((v, i) => v - scalar(b.crossAxis, u) * u[i])),
      depth = cross3(width, u),
      mid = b.start.map((v, i) => (v + b.end[i]) / 2),
      points = [];
    for (const start of [true, false])
      for (const x of [-b.b / 2000, b.b / 2000])
        for (const z of [-b.h / 2000, b.h / 2000]) {
          const c = start ? b.cutStart : b.cutEnd,
            t = Math.tan(((c?.angle ?? 0) * Math.PI) / 180) * (c?.tiltSign ?? 1),
            s =
              ((start ? -1 : 1) * b.length) / 2 +
              (c?.scheme === "miter" ? (c.plane === "width" ? x * t : (start ? 1 : -1) * z * t) : 0);
          points.push(mid.map((v, i) => v + width[i] * x + u[i] * s + depth[i] * z));
        }
    const pb = bounds(points.map((p) => ({ x: p[0], y: p[2] }))),
      guardPoly = rect(pb),
      minY = Math.min(...points.map((p) => p[1])),
      maxY = Math.max(...points.map((p) => p[1]));
    for (const w of walls) {
      const level = geometry.levels?.find((l) => l.index === (w.level ?? 1)),
        sec = section(w.section),
        L = dist(w.a, w.b);
      if (!level || !sec || L < EPS) continue;
      const profile = geometry.wallProfiles?.find((p) => p.wallId === w.id && p.level === level.index),
        low = level.wallBaseY,
        top = Math.max(level.topY ?? low + (level.height ?? 2.8), profile?.highTop ?? 0);
      if (Math.min(maxY, top) - Math.max(minY, low) <= EPS) continue;
      const nx = ((-(w.b.y - w.a.y) / L) * sec.h) / 2000,
        ny = (((w.b.x - w.a.x) / L) * sec.h) / 2000,
        wallPoly = [
          { x: w.a.x + nx, y: w.a.y + ny },
          { x: w.b.x + nx, y: w.b.y + ny },
          { x: w.b.x - nx, y: w.b.y - ny },
          { x: w.a.x - nx, y: w.a.y - ny },
        ];
      if (overlap(guardPoly, wallPoly) > 1e-7) collisions.push({ memberId: b.id, wallId: w.id });
    }
  }
  check(
    "spatial-guard-wall-clearance",
    "Ограждения и фактические полосы стен",
    collisions.length ? "fail" : "pass",
    "Проверено отсутствие пересечения габаритов ограждений с объёмом стены на соответствующих отметках. Для косых деталей это консервативная проверка огибающей; прочность креплений не подтверждается.",
    { collisionPairs: collisions },
  );
  out.quantities.count = out.instances.length;
  out.quantities.volume = sum(out.instances, (b) => b.volume);
  out.quantities.mass = sum(out.instances, (b) => b.mass);
  out.quantities.weight = (out.quantities.mass * G) / 1000;
  out.assumptions = [
    "Пространственная модель включается только явной spatialLayout/doubleHeightSpaces конфигурацией; старые проекты не получают новых деталей автоматически.",
    "Ровно одна ведомость физических деревянных деталей: доски ступеней, подступенки, пильные косоуры, площадка и верхние ограждения. Стекло ссылается на существующие оконные проёмы; повторной массы стекла здесь нет.",
    "Пильный профиль косоура и его чистый объём заданы явно. Не проверены остаточное сечение, прочность древесины поперёк волокон, опорные башмаки/кронштейны и крепёж.",
    "Площадка имеет реальные деревянные стойки, но их местные реакции на нижний пол и дальнейший путь нагрузки не подтверждены. Равновесие общего веса не заменяет этот расчёт.",
    "Критерии ширины/подъёма/просвета являются отдельными геометрическими проверками. Поручни, устойчивость ограждений, эвакуация, безопасность детей, высота прохода, акустика, огнестойкость и освещение требуют проектирования.",
  ];
  out.warnings = out.checks.filter((c) => c.status === "fail").map((c) => c.note);
  out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  return out;
}
export default buildSpatialLayout;

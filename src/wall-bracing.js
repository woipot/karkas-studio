import { loadFactors } from "./load-profile.js";
/** Actual wall bracing geometry. Shear capacity is never inferred from a picture. */
const EPS = 1e-7;
const sum = (a) => a.reduce((s, x) => s + x, 0),
  finite = Number.isFinite;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const signed = (p) => sum(p.map((a, i) => a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y)) / 2;
const area = (p) => Math.abs(signed(p));
const uniq = (a) => a.sort((a, b) => a - b).filter((v, i, s) => !i || Math.abs(v - s[i - 1]) > EPS);
const parse = (s) => {
  const m = typeof s === "string" && s.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  return m ? { b: +m[1], h: +m[2] } : null;
};
function clean(poly) {
  let p = poly.filter((q, i) => !i || Math.hypot(q.x - poly[i - 1].x, q.y - poly[i - 1].y) > EPS);
  if (p.length > 1 && Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y) < EPS) p.pop();
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
  if (signed(p) < 0) p = p.reverse();
  return p;
}
function clip(poly, fn) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      fa = fn(a),
      fb = fn(b);
    if (fa >= -EPS) out.push(a);
    if (fa >= -EPS !== fb >= -EPS) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return clean(out);
}
function triangulate(poly) {
  const p = clean(poly),
    ix = p.map((_, i) => i),
    out = [];
  let count = 0;
  while (ix.length > 3 && count++ < p.length * p.length) {
    let ok = false;
    for (let j = 0; j < ix.length; j++) {
      const a = ix[(j + ix.length - 1) % ix.length],
        b = ix[j],
        c = ix[(j + 1) % ix.length];
      if (cross(p[a], p[b], p[c]) <= EPS) continue;
      if (
        ix.some(
          (k) =>
            k !== a &&
            k !== b &&
            k !== c &&
            cross(p[a], p[b], p[k]) >= -EPS &&
            cross(p[b], p[c], p[k]) >= -EPS &&
            cross(p[c], p[a], p[k]) >= -EPS,
        )
      )
        continue;
      out.push([p[a], p[b], p[c]]);
      ix.splice(j, 1);
      ok = true;
      break;
    }
    if (!ok) throw Error("Профиль стены не допускает простую триангуляцию.");
  }
  if (ix.length === 3) out.push(ix.map((i) => p[i]));
  return out;
}
const rectangle = (a, b, c, d) => [
  { x: a, y: b },
  { x: c, y: b },
  { x: c, y: d },
  { x: a, y: d },
];
function intersect(a, b) {
  let p = a;
  for (let i = 0; i < b.length && p.length >= 3; i++)
    p = clip(p, (q) => cross(b[i], b[(i + 1) % b.length], q));
  return p;
}
function subtract(poly, hole) {
  let remainder = poly;
  const out = [];
  for (let i = 0; i < hole.length && remainder.length >= 3; i++) {
    const a = hole[i],
      b = hole[(i + 1) % hole.length],
      outside = clip(remainder, (q) => -cross(a, b, q));
    if (outside.length >= 3 && area(outside) > EPS) out.push(outside);
    remainder = clip(remainder, (q) => cross(a, b, q));
  }
  return out;
}
function minus(intervals, holes) {
  let a = intervals;
  for (const [c, d] of holes) {
    const out = [];
    for (const [l, r] of a) {
      if (c >= r - EPS || d <= l + EPS) out.push([l, r]);
      else {
        if (c > l + EPS) out.push([l, c]);
        if (d < r - EPS) out.push([d, r]);
      }
    }
    a = out;
  }
  return a;
}
function inside(q, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function horizontalIntervals(poly, y) {
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y))
      hits.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
  }
  const x = uniq(hits),
    out = [];
  for (let i = 1; i < x.length; i += 2) if (x[i] - x[i - 1] > EPS) out.push([x[i - 1], x[i]]);
  return out;
}
const defaults = {
  method: "sheathing",
  section: "25x100",
  sheetWidth: 1.25,
  sheetHeight: 2.5,
  thickness: 12,
  edgeNailSpacing: 150,
  fieldNailSpacing: 300,
  designShear: null,
  sheetDensity: 650,
};
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function boardAxes(b) {
  const d = b.end.map((v, i) => v - b.start[i]),
    L = Math.hypot(...d),
    axis = d.map((v) => v / L),
    width = b.crossAxis ?? [1, 0, 0],
    projection = dot(width, axis),
    orthogonal = width.map((v, i) => v - projection * axis[i]),
    m = Math.hypot(...orthogonal),
    x = m > EPS ? orthogonal.map((v) => v / m) : [1, 0, 0],
    z = cross3(x, axis);
  return { axis, x, z };
}
function projectedSection(b, tangent, normal) {
  const { x, z } = boardAxes(b),
    T = [tangent[0], 0, tangent[1]],
    N = [normal[0], 0, normal[1]];
  return {
    along: (Math.abs(dot(x, T)) * b.b + Math.abs(dot(z, T)) * b.h) / 1000,
    vertical: (Math.abs(x[1]) * b.b + Math.abs(z[1]) * b.h) / 1000,
    depth: (Math.abs(dot(x, N)) * b.b + Math.abs(dot(z, N)) * b.h) / 1000,
    normalAxis: z,
    aligned: Math.max(Math.abs(dot(x, N)), Math.abs(dot(z, N))) > 1 - 1e-6,
  };
}
function projectedBody(b, toLocal, u) {
  const a = toLocal(b.start),
    z = toLocal(b.end),
    L = Math.hypot(z.x - a.x, z.y - a.y);
  if (L < EPS) return null;
  const n = [-(z.y - a.y) / L, (z.x - a.x) / L],
    { x: width, z: depth } = boardAxes(b),
    N = [n[0] * u[0], n[1], n[0] * u[1]],
    w = (Math.abs(dot(width, N)) * b.b + Math.abs(dot(depth, N)) * b.h) / 2000;
  return clean([
    { x: a.x + n[0] * w, y: a.y + n[1] * w },
    { x: z.x + n[0] * w, y: z.y + n[1] * w },
    { x: z.x - n[0] * w, y: z.y - n[1] * w },
    { x: a.x - n[0] * w, y: a.y - n[1] * w },
  ]);
}
export const wallBracingSources = [
  {
    title: "APA · Wall bracing and continuously sheathed wall systems",
    url: "https://www.apawood.org/applications-systems/fully-sheathed-wall-systems/wall-bracing/",
  },
  {
    title: "APA · Force transfer around openings",
    url: "https://www.apawood.org/applications-systems/fully-sheathed-wall-systems/force-transfer-around-openings-ftao/",
  },
  {
    title: "ICC · 2021 IRC Table R602.10.4, LIB and WSP methods",
    url: "https://codes.iccsafe.org/s/IRC2021P3/chapter-6-wall-construction/IRC2021P3-Pt03-Ch06-SecR602.10.4",
  },
  {
    title: "ICC · Structural concerns and wall bracing, 2024 training",
    url: "https://www.iccsafe.org/wp-content/uploads/Session-80-and-115-2021-IRC_Structural-Concerns-Braced-Walls.pdf",
  },
];

export function buildWallBracing(project, result = {}) {
  const p = { ...defaults, ...project.bracing },
    geometry = result.geometry ?? {},
    levels = geometry.levels ?? [],
    existing = result.timber?.instances ?? [],
    material = project.material ?? {},
    density = material.density ?? 500;
  const out = {
    method: p.method,
    instances: [],
    panels: [],
    braces: [],
    notches: [],
    wallLines: [],
    checks: [],
    warnings: [],
    assumptions: [],
    sources: wallBracingSources,
    quantities: {
      sheetArea: 0,
      sheets: 0,
      purchasedSheetArea: 0,
      wasteArea: 0,
      panelMass: 0,
      bracesLength: 0,
      notchVolume: 0,
      blockingLength: 0,
    },
    status: "unverified",
  };
  const fail = (id, label, note) => out.checks.push({ id, label, status: "fail", note });
  if (!["sheathing", "letIn", "none"].includes(p.method)) {
    fail("bracing-method", "Метод пространственных связей", "Допустимы sheathing, letIn или none.");
    out.status = "fail";
    return out;
  }
  if (p.method === "none") {
    out.checks.push({
      id: "bracing-none",
      label: "Постоянные стеновые связи отключены",
      status: "unverified",
      note: "Сопротивление перекосу не назначено.",
    });
    return out;
  }
  for (const [k, min, max] of [
    ["sheetWidth", 0.3, 4],
    ["sheetHeight", 0.3, 6],
    ["thickness", 6, 40],
    ["sheetDensity", 100, 1500],
    ["edgeNailSpacing", 25, 500],
    ["fieldNailSpacing", 25, 1000],
  ])
    if (!finite(p[k]) || p[k] < min || p[k] > max)
      fail("bracing-" + k, "Параметры обшивки", `${k}: число от ${min} до ${max}.`);
  if (p.designShear !== null && (!finite(p.designShear) || p.designShear <= 0))
    fail(
      "bracing-capacity",
      "Введённая сдвиговая несущая способность",
      "designShear задаётся положительной кН/м либо null.",
    );
  const braceSection = parse(p.section);
  if (!braceSection || braceSection.b < 15 || braceSection.h < braceSection.b)
    fail("bracing-section", "Сечение врезной укосины", "Требуется корректное b×h в мм.");
  if (out.checks.some((c) => c.status === "fail")) {
    out.status = "fail";
    return out;
  }
  const board = (name, category, role, b, h, a, z, extra = {}) => {
    const length = Math.hypot(...z.map((v, i) => v - a[i]));
    if (length < 0.01) return null;
    const volume = (b * h * length) / 1e6,
      mass = volume * density,
      id = `BR-${extra.wallId ?? "w"}-${extra.level ?? 1}-${out.instances.length + 1}`;
    const item = {
      id,
      name,
      category,
      role,
      b,
      h,
      length,
      volume,
      mass,
      start: a,
      end: z,
      crossAxis: [1, 0, 0],
      cutStart: { scheme: "butt", angle: 0 },
      cutEnd: { scheme: "butt", angle: 0 },
      ...extra,
    };
    out.instances.push(item);
    return item;
  };
  const walls = project.walls ?? result.walls ?? [],
    contexts = [];
  for (const w of walls.filter((w) => w.kind !== "partition" && w.system !== "profiledBeam")) {
    const applicable = w.level !== undefined ? levels.filter((l) => l.index === w.level) : levels;
    for (const l of applicable.length
      ? applicable
      : [
          {
            index: w.level ?? 1,
            wallBaseY: 0.72 + (result.timber?.platformHeight ?? 0.285),
            topY: 0.72 + (result.timber?.platformHeight ?? 0.285) + (project.height ?? 2.8),
            height: project.height ?? 2.8,
            polygon: geometry.polygon,
          },
        ]) {
      const profile = (result.roofModel?.wallProfiles ?? result.wallProfiles ?? []).find(
        (q) => q.wallId === w.id && q.level === l.index && q.mode === "continuous",
      );
      const section = parse(profile?.section ?? w.section);
      if (!section) continue;
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (L < EPS) continue;
      const u = [(w.b.x - w.a.x) / L, (w.b.y - w.a.y) / L],
        v = [-u[1], u[0]],
        B = section.b / 1000,
        D = section.h / 1000,
        baseY = l.wallBaseY ?? l.elevation ?? 1.005;
      const samples = profile?.topSamples?.length
        ? profile.topSamples
        : [
            { s: 0, topY: l.topY ?? baseY + l.height },
            { s: L, topY: l.topY ?? baseY + l.height },
          ];
      const top = (s) => {
        for (let i = 1; i < samples.length; i++)
          if (s <= samples[i].s + EPS) {
            const a = samples[i - 1],
              b = samples[i];
            return a.topY + ((b.topY - a.topY) * (s - a.s)) / (b.s - a.s || 1);
          }
        return samples.at(-1).topY;
      };
      const slopeAt = (s) => {
        for (let i = 1; i < samples.length; i++)
          if (s <= samples[i].s + EPS)
            return (samples[i].topY - samples[i - 1].topY) / (samples[i].s - samples[i - 1].s);
        return 0;
      };
      const frame = clean([
        { x: 0, y: baseY },
        { x: L, y: baseY },
        ...samples
          .slice()
          .reverse()
          .map((q) => ({ x: q.s, y: q.topY })),
      ]);
      const os = (project.openings ?? []).filter(
          (o) => o.wallId === w.id && (o.floor ?? w.level ?? 1) === l.index,
        ),
        holes = os.map((o) =>
          rectangle(o.offset, baseY + o.sill, o.offset + o.width, baseY + o.sill + o.height),
        );
      const owned = existing.filter(
          (b) => (b.wallId === w.id || b.wallIds?.includes(w.id)) && (b.level ?? b.floor ?? 1) === l.index,
        ),
        toLocal = (q) => ({ x: (q[0] - w.a.x) * u[0] + (q[2] - w.a.y) * u[1], y: q[1] }),
        at = (s, y, n = 0) => [w.a.x + u[0] * s + v[0] * n, y, w.a.y + u[1] * s + v[1] * n];
      let exteriorNormal = 1;
      const outline = (l.polygon ?? geometry.polygon ?? []).map((q) => ({ x: q.x, y: q.y })),
        mid = { x: (w.a.x + w.b.x) / 2 + v[0] * 0.02, y: (w.a.y + w.b.y) / 2 + v[1] * 0.02 };
      if (w.kind === "exterior" && inside(mid, outline)) exteriorNormal = -1;
      const vertical = owned
        .filter((b) => Math.hypot(b.end[0] - b.start[0], b.end[2] - b.start[2]) < 1e-5)
        .map((b) => ({
          board: b,
          s: toLocal(b.start).x,
          y0: Math.min(b.start[1], b.end[1]),
          y1: Math.max(b.start[1], b.end[1]),
          b: projectedSection(b, u, v).along * 1000,
        }));
      const horizontal = owned
        .filter((b) => Math.abs(b.end[1] - b.start[1]) < 1e-5)
        .map((b) => ({
          board: b,
          s0: Math.min(toLocal(b.start).x, toLocal(b.end).x),
          s1: Math.max(toLocal(b.start).x, toLocal(b.end).x),
          y: b.start[1],
          b: projectedSection(b, u, v).vertical * 1000,
        }));
      contexts.push({
        w,
        l,
        L,
        u,
        v,
        B,
        D,
        section,
        baseY,
        top,
        slopeAt,
        samples,
        frame,
        os,
        holes,
        owned,
        toLocal,
        at,
        vertical,
        horizontal,
        exteriorNormal,
      });
    }
  }
  const sheetIds = new Set(),
    notchById = new Map();
  for (const c of contexts) {
    const {
      w,
      l,
      L,
      u,
      v,
      B,
      D,
      section,
      baseY,
      top,
      slopeAt,
      samples,
      frame,
      os,
      holes,
      owned,
      toLocal,
      at,
      vertical,
      horizontal,
      exteriorNormal,
    } = c;
    const label = `${w.id} · ${l.index} этаж`,
      lineChecks = [],
      height = Math.max(...frame.map((q) => q.y)) - baseY;
    const clearIntervals = minus(
      [[D + 2 * B, L - D - 2 * B]],
      os.map((o) => [o.offset - 2 * B, o.offset + o.width + 2 * B]),
    ).filter(([a, b]) => b - a > 0.05);
    const availableLength = sum(clearIntervals.map(([a, b]) => b - a));
    const above = levels.length ? levels.filter((q) => q.index >= l.index) : [l],
      windHeight = (q) =>
        Math.max(
          q.height ?? project.height ?? 2.8,
          ...contexts
            .filter((c) => c.l.index === q.index)
            .map((c) => Math.max(...c.frame.map((p) => p.y)) - c.baseY),
        ),
      // Storey shear from the code profile (СП 20 п. 11.1: w0·k(ze)·(0,8+0,5), gables and
      // roof projection included). Legacy facade × w0 only without a wind model.
      storey = result.wind?.storeys?.find((q) => q.level === l.index),
      windX = storey
        ? storey.forceX
        : sum(above.map((q) => (q.bounds?.height ?? geometry.bounds?.height ?? 0) * windHeight(q))) *
          (project.loads?.wind ?? 0),
      windY = storey
        ? storey.forceY
        : sum(above.map((q) => (q.bounds?.width ?? geometry.bounds?.width ?? 0) * windHeight(q))) *
          (project.loads?.wind ?? 0);
    const parallel = contexts.filter(
      (q) =>
        q.l.index === l.index && q.w.kind === "exterior" && Math.abs(q.u[0] * u[0] + q.u[1] * u[1]) > 0.99,
    ).length;
    const demandShear =
      (Math.max(Math.abs(windX * u[0]), Math.abs(windY * u[1])) * loadFactors(project.loads).wind) /
      Math.max(1, Math.min(2, parallel));
    const capacity = p.designShear === null ? null : p.designShear * availableLength;
    const wallLine = {
      wallId: w.id,
      level: l.index,
      length: L,
      height,
      method: p.method,
      availableLength,
      clearIntervals,
      demandShear,
      designShear: p.designShear,
      capacity,
      utilization: capacity > 0 ? demandShear / capacity : null,
      checks: lineChecks,
    };
    if (p.method === "sheathing") {
      const xs = [0];
      while (xs.at(-1) < L - EPS) {
        const from = xs.at(-1),
          target = Math.min(L, from + p.sheetWidth),
          snap = vertical
            .map((q) => q.s)
            .filter((s) => s > from + 0.25 && s <= target + EPS)
            .sort((a, b) => b - a)[0],
          end = target >= L - EPS ? L : (snap ?? target);
        xs.push(end);
        if (xs.length > 500) break;
      }
      const ys = [baseY],
        maxY = baseY + height;
      while (ys.at(-1) < maxY - EPS) {
        const from = ys.at(-1),
          target = Math.min(maxY, from + p.sheetHeight),
          snap = horizontal
            .map((q) => q.y)
            .filter((y) => y > from + 0.25 && y <= target + EPS && y >= target - 0.2)
            .sort((a, b) => b - a)[0];
        ys.push(target >= maxY - EPS ? maxY : (snap ?? target));
        if (ys.length > 200) break;
      }
      const triangles = triangulate(frame),
        face = exteriorNormal * (p.sheetSide === "interior" ? -1 : 1) * (D / 2 + p.thickness / 2000),
        wallPanelStart = out.panels.length;
      for (let ix = 1; ix < xs.length; ix++)
        for (let iy = 1; iy < ys.length; iy++) {
          const tile = rectangle(xs[ix - 1], ys[iy - 1], xs[ix], ys[iy]),
            stockSheetId = `SHEET-${w.id}-${l.index}-${ix}-${iy}`;
          let pieces = [];
          for (const triangle of triangles) {
            const q = intersect(triangle, tile);
            if (q.length >= 3 && area(q) > EPS) pieces.push(q);
          }
          for (const hole of holes) pieces = pieces.flatMap((q) => subtract(q, hole));
          if (!pieces.length) continue;
          sheetIds.add(stockSheetId);
          for (const poly of pieces) {
            const A = area(poly);
            if (A < EPS) continue;
            out.panels.push({
              id: `PANEL-${out.panels.length + 1}`,
              wallId: w.id,
              level: l.index,
              stockSheetId,
              polygon: poly.map((q) => at(q.x, q.y, face)),
              localPolygon: poly,
              area: A,
              thickness: p.thickness,
              mass: ((A * p.thickness) / 1000) * p.sheetDensity,
              openingIds: os
                .filter(
                  (o) =>
                    o.offset < xs[ix] &&
                    o.offset + o.width > xs[ix - 1] &&
                    baseY + o.sill < ys[iy] &&
                    baseY + o.sill + o.height > ys[iy - 1],
                )
                .map((o) => o.id),
              sheetColumn: ix,
              sheetRow: iy,
              sheetSide: p.sheetSide ?? "exterior",
            });
          }
        }
      // Vertical sheet seams follow real stud axes where possible. Add short
      // backing studs only in clear space; do not duplicate adjacent framing.
      let unsupported = 0;
      for (const s of xs.slice(1, -1)) {
        const high = top(s) - 2 * B * Math.sqrt(1 + slopeAt(s) ** 2),
          needed = minus(
            [[baseY + B, high]],
            os
              .filter((o) => s + B / 2 > o.offset && s - B / 2 < o.offset + o.width)
              .map((o) => [baseY + o.sill - B, baseY + o.sill + o.height + 0.2]),
          );
        const supported = vertical
          .filter((q) => Math.abs(q.s - s) <= q.b / 2000 - 0.008 + EPS)
          .map((q) => [q.y0, q.y1]);
        for (const [a, b] of minus(needed, [
          ...supported,
          ...horizontal
            .filter((q) => s >= q.s0 - EPS && s <= q.s1 + EPS)
            .map((q) => [q.y - q.b / 2000, q.y + q.b / 2000]),
        ])) {
          if (b - a < 0.05) continue;
          const collision = vertical.some(
            (q) => Math.abs(q.s - s) < (q.b + section.b) / 2000 - EPS && q.y0 < b - EPS && q.y1 > a + EPS,
          );
          if (collision) {
            unsupported++;
            continue;
          }
          const slope = slopeAt(s),
            added = board(
              "Стойка под стык обшивки",
              "walls",
              "sheathingStud",
              section.b,
              section.h,
              at(s, a),
              at(s, b),
              {
                wallId: w.id,
                level: l.index,
                floor: l.index,
                crossAxis: [u[0], 0, u[1]],
                jointSupport: true,
                requireSingleStock: true,
                cutEnd:
                  Math.abs(b - high) < EPS && Math.abs(slope) > EPS
                    ? {
                        scheme: "miter",
                        angle: Math.abs((Math.atan(slope) * 180) / Math.PI),
                        tiltSign: Math.sign(slope),
                        plane: "width",
                        cutWidthMM: section.b,
                      }
                    : { scheme: "butt", angle: 0 },
              },
            );
          if (added) vertical.push({ board: added, s, y0: a, y1: b, b: section.b });
        }
      }
      // Horizontal seams are backed between actual stud faces, outside openings.
      for (const y of ys.slice(1, -1)) {
        const safe = horizontalIntervals(frame, y + B / 2).flatMap(([a, b]) =>
          horizontalIntervals(frame, y - B / 2)
            .map(([c, d]) => [Math.max(a, c), Math.min(b, d)])
            .filter(([a, b]) => b - a > 0.02),
        );
        const needed = minus(
          safe,
          os
            .filter((o) => baseY + o.sill < y + B / 2 && baseY + o.sill + o.height > y - B / 2)
            .map((o) => [o.offset, o.offset + o.width]),
        );
        const supportBands = vertical
          .filter((q) => q.y0 <= y - B / 2 + EPS && q.y1 >= y + B / 2 - EPS)
          .map((q) => [q.s - q.b / 2000, q.s + q.b / 2000]);
        const sameHeight = horizontal
          .filter((q) => Math.abs(q.y - y) <= q.b / 2000 - 0.008 + EPS)
          .map((q) => [q.s0, q.s1]);
        for (const [a, b] of minus(needed, [...supportBands, ...sameHeight])) {
          if (b - a < 0.04) continue;
          const left = supportBands.some(([lo, hi]) => Math.abs(hi - a) < 0.012) || a <= EPS,
            right = supportBands.some(([lo, hi]) => Math.abs(lo - b) < 0.012) || b >= L - EPS;
          const collision = horizontal.some(
            (q) => Math.abs(q.y - y) < (q.b + section.b) / 2000 - EPS && q.s0 < b - EPS && q.s1 > a + EPS,
          );
          if (!left || !right || collision) {
            unsupported++;
            continue;
          }
          const added = board(
            "Блокинг под кромку обшивки",
            "walls",
            "sheathingBlocking",
            section.b,
            section.h,
            at(a, y),
            at(b, y),
            { wallId: w.id, level: l.index, floor: l.index, crossAxis: [0, 1, 0], jointSupport: true },
          );
          if (added) out.quantities.blockingLength += added.length;
        }
      }
      const wallPanels = out.panels.slice(wallPanelStart),
        backing = [...owned, ...out.instances.filter((b) => b.wallId === w.id && b.level === l.index)]
          .map((b) => projectedBody(b, toLocal, u))
          .filter(Boolean);
      // Check actual panel perimeters, including jambs and the rake. Internal
      // triangulation edges within the same purchased sheet are not joints.
      let unsupportedBoundary = 0;
      for (const panel of wallPanels) {
        const poly = panel.localPolygon;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i],
            b = poly[(i + 1) % poly.length],
            len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < EPS) continue;
          const inward = [-(b.y - a.y) / len, (b.x - a.x) / len],
            steps = Math.max(1, Math.ceil(len / 0.15));
          let missing = false;
          for (let j = 0; j < steps; j++) {
            const t = (j + 0.5) / steps,
              mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
              outside = { x: mid.x - inward[0] * 0.004, y: mid.y - inward[1] * 0.004 };
            if (
              wallPanels.some(
                (q) =>
                  q !== panel && q.stockSheetId === panel.stockSheetId && inside(outside, q.localPolygon),
              )
            )
              continue;
            const nail = { x: mid.x + inward[0] * 0.008, y: mid.y + inward[1] * 0.008 };
            if (!backing.some((q) => inside(nail, q))) {
              missing = true;
              break;
            }
          }
          if (missing) unsupportedBoundary++;
        }
      }
      wallLine.panelArea = sum(wallPanels.map((q) => q.area));
      wallLine.unsupportedEdges = Math.max(unsupported, unsupportedBoundary);
      wallLine.unsupportedBoundarySegments = unsupportedBoundary;
      unsupported = wallLine.unsupportedEdges;
      lineChecks.push({
        id: `${w.id}-${l.index}-sheet-edges`,
        label: `${label}: кромки листов`,
        status: "unverified",
        note: unsupported
          ? `${unsupported} участка кромок требуют дополнительной стойки, блокинга или изменения раскроя; дублирующая древесина не выдумана.`
          : "Добавлены геометрические подкладные элементы; крепёж кромок и их связь с каркасом требуют расчёта.",
      });
      if (unsupported)
        out.warnings.push(`${label}: ${unsupported} участка стыков обшивки без подтверждённого опирания.`);
    } else {
      const stockLength = project.cutting?.stockLength ?? 6,
        angles = [
          50,
          ...Array.from({ length: 20 }, (_, i) => 50 + (i + 1) / 2),
          ...Array.from({ length: 10 }, (_, i) => 50 - (i + 1) / 2),
        ];
      function fitBrace(a, b, reverse) {
        const startS = reverse ? b : a,
          sign = reverse ? -1 : 1,
          runMax = b - a,
          lower = baseY + B / 2,
          candidates = [runMax];
        for (const angle of angles)
          for (let i = 1; i < samples.length; i++) {
            const A = samples[i - 1],
              C = samples[i],
              m = (C.topY - A.topY) / (C.s - A.s),
              intercept = A.topY - m * A.s,
              denom = Math.tan((angle * Math.PI) / 180) - m * sign,
              run = (intercept + m * startS - B / 2 - lower) / denom,
              end = startS + sign * run;
            if (finite(run) && run > EPS && run <= runMax + EPS && end >= A.s - EPS && end <= C.s + EPS)
              candidates.push(run);
          }
        return (
          candidates
            .map((run) => {
              const upper = top(startS + sign * run) - B / 2,
                rise = upper - lower,
                angle = (Math.atan2(rise, run) * 180) / Math.PI,
                length = Math.hypot(run, rise),
                cutLength = length + braceSection.h / 1000 / Math.tan((angle * Math.PI) / 180);
              return { a: startS, b: startS + sign * run, lower, upper, angle, cutLength };
            })
            .filter((q) => q.angle >= 45 - EPS && q.angle <= 60 + EPS && q.cutLength <= stockLength + EPS)
            .sort(
              (x, y) =>
                Math.abs(y.b - y.a) - Math.abs(x.b - x.a) || Math.abs(x.angle - 50) - Math.abs(y.angle - 50),
            )[0] ?? null
        );
      }
      const chosenBraces = [];
      for (const [a, b] of clearIntervals) {
        // Lay out a sequence across each available pier, rather than one
        // diagonal at an arbitrary wall end. Separate end cuts so their
        // notches do not overlap. Every brace still connects both plates.
        let best = [],
          score = -1;
        const minRise = Math.max(0.1, Math.min(top(a), top(b)) - baseY - B),
          maxCount = Math.min(40, Math.max(1, Math.floor((b - a) / (minRise / Math.tan(Math.PI / 3))))),
          gap = (braceSection.h / 1000) * 1.7;
        for (let n = 1; n <= maxCount; n++) {
          const segment = (b - a) / n,
            trial = [];
          for (let j = 0; j < n; j++) {
            const left = a + j * segment + (j ? gap / 2 : 0),
              right = a + (j + 1) * segment - (j < n - 1 ? gap / 2 : 0);
            const item = fitBrace(left, right, j % 2 === 1) ?? fitBrace(left, right, j % 2 === 0);
            if (item) trial.push(item);
          }
          const covered = sum(trial.map((q) => Math.abs(q.b - q.a))),
            merit = covered - trial.length * 0.001;
          if (merit > score + EPS) {
            best = trial;
            score = merit;
          }
        }
        chosenBraces.push(...best);
      }
      wallLine.braceIds = [];
      wallLine.braceCount = chosenBraces.length;
      wallLine.coveredLength = sum(chosenBraces.map((q) => Math.abs(q.b - q.a)));
      const chosen = chosenBraces[0];
      if (!chosen) {
        lineChecks.push({
          id: `${w.id}-${l.index}-let-in-fit`,
          label: `${label}: непрерывная врезная укосина`,
          status: "fail",
          note: `Нет чистого простенка для цельной доски 45–60° от нижней до верхней обвязки в заготовке ${stockLength} м с припусками косых торцов. Укороченная декоративная X-связь не подставляется.`,
        });
        out.warnings.push(
          `${label}: цельная врезная укосина 45–60° не помещается без пересечения проёмов или превышения заготовки ${stockLength} м.`,
        );
        wallLine.braceAvailable = false;
      } else {
        for (const chosen of chosenBraces) {
          const normal = exteriorNormal * (D / 2 - braceSection.b / 2000),
            aa = { x: chosen.a, y: chosen.lower },
            bb = { x: chosen.b, y: chosen.upper },
            dx = bb.x - aa.x,
            dy = bb.y - aa.y,
            Lb = Math.hypot(dx, dy),
            half = braceSection.h / 2000;
          const endHalf = half / (Math.abs(dy) / Lb),
            bracePoly = clean([
              { x: aa.x - endHalf, y: aa.y },
              { x: bb.x - endHalf, y: bb.y },
              { x: bb.x + endHalf, y: bb.y },
              { x: aa.x + endHalf, y: aa.y },
            ]);
          const cutAngle = 90 - chosen.angle,
            item = board(
              "Врезная диагональная укосина",
              "bracing",
              "letInBrace",
              braceSection.b,
              braceSection.h,
              at(aa.x, aa.y, normal),
              at(bb.x, bb.y, normal),
              {
                wallId: w.id,
                level: l.index,
                floor: l.index,
                angle: chosen.angle,
                crossAxis: [v[0], 0, v[1]],
                insetDepth: braceSection.b / 1000,
                cutLength: chosen.cutLength,
                requireSingleStock: true,
                cutStart: { scheme: "miter", angle: cutAngle, tiltSign: -Math.sign(dx) },
                cutEnd: { scheme: "miter", angle: cutAngle, tiltSign: Math.sign(dx) },
                connectedPlates: true,
              },
            );
          if (item) {
            out.braces.push(item);
            out.quantities.bracesLength += item.length;
            wallLine.braceAvailable = true;
            wallLine.angle = chosen.angle;
            wallLine.braceId ??= item.id;
            wallLine.braceIds.push(item.id);
            for (const timber of owned) {
              if (
                ![
                  "stud",
                  "king",
                  "jack",
                  "cripple",
                  "corner",
                  "plate",
                  "fullHeightStud",
                  "continuousStud",
                ].includes(timber.role)
              )
                continue;
              const a = toLocal(timber.start),
                b = toLocal(timber.end),
                dx = b.x - a.x,
                dy = b.y - a.y,
                Lm = Math.hypot(dx, dy);
              if (Lm < EPS) continue;
              const sec = projectedSection(timber, u, v),
                width =
                  Math.hypot(dx, dy) < EPS
                    ? 0
                    : Math.abs(dx) < EPS
                      ? sec.along
                      : Math.abs(dy) < EPS
                        ? sec.vertical
                        : timber.b / 1000,
                n = [-dy / Lm, dx / Lm],
                poly = clean([
                  { x: a.x + (n[0] * width) / 2, y: a.y + (n[1] * width) / 2 },
                  { x: b.x + (n[0] * width) / 2, y: b.y + (n[1] * width) / 2 },
                  { x: b.x - (n[0] * width) / 2, y: b.y - (n[1] * width) / 2 },
                  { x: a.x - (n[0] * width) / 2, y: a.y - (n[1] * width) / 2 },
                ]);
              const overlap = intersect(bracePoly, poly);
              if (overlap.length < 3 || area(overlap) < EPS) continue;
              const frameDepth = sec.depth,
                centerN = (timber.start[0] - w.a.x) * v[0] + (timber.start[2] - w.a.y) * v[1],
                n0 = Math.max(centerN - frameDepth / 2, normal - braceSection.b / 2000),
                n1 = Math.min(centerN + frameDepth / 2, normal + braceSection.b / 2000),
                depth = Math.max(0, n1 - n0);
              if (depth < EPS) continue;
              const cutUnknown =
                !sec.aligned ||
                [timber.cutStart, timber.cutEnd].some((q) =>
                  ["halfLap", "half-lap", "scarf"].includes(q?.scheme),
                );
              const rawVolume = area(overlap) * depth,
                volume = cutUnknown ? 0 : rawVolume;
              const slope = (bb.y - aa.y) / (bb.x - aa.x),
                s = toLocal(timber.start).x,
                grooveY = aa.y + slope * (s - aa.x),
                alignment = dot(boardAxes(timber).x, [u[0], 0, u[1]]),
                isVertical = Math.abs(dx) < EPS && Math.abs(alignment) > 0.99,
                faceSign = Math.sign(exteriorNormal * dot(sec.normalAxis, [v[0], 0, v[1]])) || 1;
              const record = {
                boardId: timber.id,
                braceId: item.id,
                wallId: w.id,
                level: l.index,
                volume,
                depth,
                intersectionArea: area(overlap),
                polygon: overlap.map((q) => at(q.x, q.y, (n0 + n1) / 2)),
                grossIntersectionVolume: rawVolume,
                requiresCutBoolean: cutUnknown,
                shape: isVertical ? "verticalStudGroove" : "polygon",
                slope,
                localSlope: slope * alignment,
                normalSide: exteriorNormal,
                faceSign,
                face: faceSign > 0 ? "front" : "back",
                positionXYZ: at(s, grooveY, (n0 + n1) / 2),
                ...(isVertical
                  ? {
                      station: (grooveY - timber.start[1]) * Math.sign(timber.end[1] - timber.start[1]),
                      length: braceSection.h / 1000 / (Math.abs(bb.x - aa.x) / Lb),
                    }
                  : {}),
              };
              if (cutUnknown)
                out.warnings.push(
                  `${label}: выборка укосины пересекает элемент со стыком или повёрнутым сечением; дополнительный вычет массы не назначен без точного объединения вырезов.`,
                );
              const k = timber.id;
              if (!notchById.has(k)) notchById.set(k, { ...record, braceIds: [item.id], cuts: [record] });
              else {
                const prev = notchById.get(k);
                prev.volume += volume;
                prev.grossIntersectionVolume += rawVolume;
                prev.intersectionArea += record.intersectionArea;
                prev.braceIds.push(item.id);
                prev.cuts.push(record);
              }
            }
          }
        }
        lineChecks.push({
          id: `${w.id}-${l.index}-let-in-connections`,
          label: `${label}: узлы врезной доски`,
          status: "unverified",
          note: "Показана серия диагоналей по доступной длине стены с врезкой в реальные стойки и обвязки. Крепление к каждой пересечённой стойке и обоим поясам, сдвиг, устойчивость сжатой диагонали и обратное направление ветра требуют расчёта.",
        });
        if ((w.studStep ?? 0.6) > 0.4064 + EPS)
          out.warnings.push(
            `${label}: шаг стоек больше 406 мм; это не прескриптивный метод IRC2021 LIB, необходим инженерный расчёт.`,
          );
      }
    }
    lineChecks.push({
      id: `${w.id}-${l.index}-shear-capacity`,
      label: `${label}: сдвиговая несущая способность`,
      status:
        capacity !== null && demandShear > capacity
          ? "fail"
          : p.designShear === null
            ? "unverified"
            : "warning",
      value: demandShear,
      limit: capacity,
      unit: "кН",
      note:
        p.designShear === null
          ? "Несущая способность не задана. Изображение панели или укосины не подтверждает сопротивление сдвигу."
          : "Предварительное сравнение введённой кН/м с грузовой длиной, без подтверждения анкеров, аспектного отношения и крепежа.",
    });
    lineChecks.push({
      id: `${w.id}-${l.index}-load-path`,
      label: `${label}: путь горизонтальной нагрузки`,
      status: "unverified",
      note: "Диски крыши/перекрытий, коллекторы, обвязки, анкеры и соединения со свайным ростверком не рассчитаны.",
    });
    out.wallLines.push(wallLine);
    out.checks.push(...lineChecks);
  }
  out.notches = [...notchById.values()];
  out.quantities.notchVolume = sum(out.notches.map((n) => n.volume));
  out.quantities.sheetArea = sum(out.panels.map((p) => p.area));
  out.quantities.sheets = sheetIds.size;
  out.quantities.purchasedSheetArea = sheetIds.size * p.sheetWidth * p.sheetHeight;
  out.quantities.wasteArea = Math.max(0, out.quantities.purchasedSheetArea - out.quantities.sheetArea);
  out.quantities.panelMass = sum(out.panels.map((p) => p.mass));
  out.assumptions = [
    "Постоянная стеновая связь выбрана явно: конструкционная обшивка, врезная доска или отсутствие связи. Внешние декоративные X автоматически не добавляются.",
    "Панели представлены реальными полигонами с физически вырезанными окнами/дверями. Части одного stockSheetId относятся к одному закупочному листу; внутренняя триангуляция не является дополнительным швом.",
    "Листы подрезаются к фактическим осям стоек там, где возможно; под неподдержанными кромками добавляется геометрический блокинг или стойка. Неразрешённые стыки помечены, а пересекающая существующие доски древесина не выдумывается.",
    "Количество листов — по принятой сетке раскладки без повторного использования остатков; это не доказанный оптимальный раскрой. Масса панели = чистая площадь × толщина × плотность; выбранная панель должна быть исключена из прочих вводимых слоёв стены.",
    "Серия врезных укосин распределена по длине каждого подходящего чистого простенка в плоскости каркаса под углом 45–60°, от нижней до верхней обвязки. Выборки получены по пересечениям с реальными досками; они ослабляют сечения, которые требуют повторного расчёта.",
    "Объём выборок вычитается из уже существующих досок один раз. При пересечении с ранее заданным силовым стыком дополнительный вычет откладывается до точного объединения вырезов.",
    "Крепёж кромок/поля, сорт и свойства плиты, анкеры и работа диафрагм не выводятся из геометрии. При designShear=null сдвиговая несущая способность неизвестна. Введённые кН/м дают только предварительное сравнение, не полное нормативное подтверждение.",
    "Ориентиры APA/ICC относятся к определённым методам и областям применения. Они не означают автоматического соответствия проекта нормам; для свайных оснований и высоких стен нужен отдельный путь передачи горизонтальной нагрузки.",
  ];
  out.assumptions.push(
    "Предварительный сдвиг от ветра оценён по габаритам каждого этажа и максимальной фактической высоте профиля стены на этаже; это консервативная огибающая, а не пространственное распределение жёсткости. Врезная доска остаётся цельной, включая припуски косых торцов в длине заготовки; сжатие и обратное направление ветра не подтверждаются автоматически.",
  );
  out.warnings = [...new Set(out.warnings)];
  out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  return out;
}

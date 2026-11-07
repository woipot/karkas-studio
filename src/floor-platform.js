import { wallFrameSection } from "./profiled-beam-catalog.js";
import { floorDeckThickness } from "./sheet-catalog.js";
import { prepareFloorContours } from "./floor-platform-contour.js";
/** Physical platform framing. m / mm / kg. Transfer blocks can carry walls;
 * no transverse block is an extra vertical prop for a joist. */
const EPS = 1e-7,
  G = 9.80665,
  finite = Number.isFinite,
  sum = (a) => a.reduce((s, x) => s + x, 0);
const parse = (s) => {
  const m = typeof s === "string" && s.replaceAll(" ", "").match(/^(\d+)[x×](\d+)$/);
  return m ? { b: +m[1], h: +m[2] } : null;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const signed = (p) => sum(p.map((a, i) => a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y)) / 2;
const unique = (a) => a.sort((a, b) => a - b).filter((x, i, s) => !i || x - s[i - 1] > EPS);
function clean(raw) {
  let p = raw.map((q) => ({ ...q }));
  if (p.length > 1 && dist(p[0], p.at(-1)) < EPS) p.pop();
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
  return p;
}
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
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i],
      b = p[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function intervals(poly, fixed, axis) {
  const along = axis === "y" ? "y" : "x",
    other = axis === "y" ? "x" : "y",
    hits = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    if (Math.abs(a[other] - fixed) < EPS) hits.push(a[along]);
    if (Math.abs(b[other] - fixed) < EPS) hits.push(b[along]);
    if ((a[other] - fixed) * (b[other] - fixed) < -EPS * EPS)
      hits.push(a[along] + ((b[along] - a[along]) * (fixed - a[other])) / (b[other] - a[other]));
  }
  const v = unique(hits),
    out = [];
  for (let i = 1; i < v.length; i++) {
    const q = axis === "y" ? { x: fixed, y: (v[i] + v[i - 1]) / 2 } : { x: (v[i] + v[i - 1]) / 2, y: fixed };
    if (v[i] - v[i - 1] > EPS && inside(q, poly)) out.push([v[i - 1], v[i]]);
  }
  return out;
}
function minus(base, holes) {
  let out = base;
  for (const [a, b] of holes) {
    const next = [];
    for (const [x, z] of out) {
      if (b <= x + EPS || a >= z - EPS) next.push([x, z]);
      else {
        if (a > x + EPS) next.push([x, a]);
        if (b < z - EPS) next.push([b, z]);
      }
    }
    out = next;
  }
  return out;
}
function hull(points) {
  const p = [...points]
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .filter((q, i, s) => !i || dist(q, s[i - 1]) > EPS),
    half = (list) => {
      const h = [];
      for (const q of list) {
        while (h.length > 1 && cross(h.at(-2), h.at(-1), q) <= EPS) h.pop();
        h.push(q);
      }
      return h;
    };
  return half(p)
    .slice(0, -1)
    .concat(half([...p].reverse()).slice(0, -1));
}
function dilate(poly, axis, half) {
  return hull(
    poly.flatMap((p) =>
      axis === "y"
        ? [
            { x: p.x - half, y: p.y },
            { x: p.x + half, y: p.y },
          ]
        : [
            { x: p.x, y: p.y - half },
            { x: p.x, y: p.y + half },
          ],
    ),
  );
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
  for (let i = 0; i < b.length && p.length >= 3; i++) p = clip(p, b[i], b[(i + 1) % b.length]);
  return p.length >= 3 ? Math.abs(signed(p)) : 0;
}
function uncovered(poly, supports) {
  let pieces = [poly];
  for (const support of supports) {
    const next = [];
    for (const subject of pieces) {
      if (overlap(subject, support) < 1e-10) {
        next.push(subject);
        continue;
      }
      let remain = subject;
      for (let i = 0; i < support.length && remain.length >= 3; i++) {
        const a = support[i],
          b = support[(i + 1) % support.length],
          outside = clip(remain, b, a);
        if (outside.length >= 3 && Math.abs(signed(outside)) > 1e-11) next.push(outside);
        remain = clip(remain, a, b);
      }
    }
    pieces = next;
    if (!pieces.length) break;
  }
  return sum(pieces.map((p) => Math.abs(signed(p))));
}
function planBody(board) {
  const a = { x: board.start[0], y: board.start[2] },
    z = { x: board.end[0], y: board.end[2] },
    L = dist(a, z),
    u = { x: (z.x - a.x) / L, y: (z.y - a.y) / L },
    v = { x: board.crossAxis[0], y: board.crossAxis[2] },
    half = board.b / 2000,
    k = (c) =>
      c?.scheme === "miter" && c.plane === "width"
        ? Math.tan((c.angle * Math.PI) / 180) * (c.tiltSign ?? 1)
        : 0;
  return hull(
    [-1, 1].flatMap((sign) => {
      const x = sign * half;
      return [
        { x: a.x + v.x * x + u.x * k(board.cutStart) * x, y: a.y + v.y * x + u.y * k(board.cutStart) * x },
        { x: z.x + v.x * x + u.x * k(board.cutEnd) * x, y: z.y + v.y * x + u.y * k(board.cutEnd) * x },
      ];
    }),
  );
}
function segmentInside(a, b, p) {
  if (!inside(a, p) || !inside(b, p)) return false;
  const d = { x: b.x - a.x, y: b.y - a.y },
    cuts = [0, 1];
  for (let i = 0; i < p.length; i++) {
    const c = p[i],
      z = p[(i + 1) % p.length],
      v = { x: z.x - c.x, y: z.y - c.y },
      den = d.x * v.y - d.y * v.x;
    if (Math.abs(den) < EPS) continue;
    const t = ((c.x - a.x) * v.y - (c.y - a.y) * v.x) / den,
      s = ((c.x - a.x) * d.y - (c.y - a.y) * d.x) / den;
    if (t > 0 && t < 1 && s >= -EPS && s <= 1 + EPS) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    const t = (cuts[i] + cuts[i - 1]) / 2;
    if (!inside({ x: a.x + d.x * t, y: a.y + d.y * t }, p)) return false;
  }
  return true;
}
const zero = { scheme: "butt", angle: 0 };
const allowance = (c, s) =>
  c?.scheme === "miter" ? ((c.cutWidthMM ?? s.h) / 2000) * Math.tan((Math.abs(c.angle) * Math.PI) / 180) : 0;
export const floorPlatformSources = [
  {
    title: "СП31-105-2002 ·6.3: черный пол, распорки под перегородками и опоры несущих стен",
    url: "https://www.pkb-titan.ru/upload/library/SP/SP%2031-105-2002.pdf",
  },
  {
    title: "Puuinfo · Timber floor transverse stiffness and vibration",
    url: "https://puuinfo.fi/wp-content/uploads/2020/07/Puupalkit-Suomessa.pdf",
  },
  {
    title: "APA · Lateral restraint versus load-bearing blocking",
    url: "https://www.apawood.org/guides-tools-training/technical-document-library/technical-topics/holes-in-blocking-used-in-engineered-wood-construction/",
  },
];

export function buildFloorPlatform(
  project,
  { geometry, walls = project.walls ?? [], grillageModel, floorOpenings } = {},
) {
  const f = project.floor ?? {},
    section = parse(f.section),
    rim = parse(f.rimSection ?? f.section),
    blocking = parse(f.blockingSection ?? f.section),
    density = project.material?.density ?? 500,
    axis = f.axis ?? "y",
    along = axis === "y" ? "y" : "x",
    fixed = axis === "y" ? "x" : "y",
    blockStep = f.blockingStep ?? 1.2,
    enabled = f.blocking !== false,
    wallFraming = f.wallSupportFraming === true;
  const contours = geometry?.platformContours ?? prepareFloorContours(project, { geometry, walls });
  const out = {
    instances: [],
    levels: [],
    spans: [],
    supports: [],
    wallSupports: [],
    checks: [],
    warnings: [],
    assumptions: [],
    sources: floorPlatformSources,
    quantities: {
      count: 0,
      mass: 0,
      volume: 0,
      rimLength: 0,
      joistLength: 0,
      blockingLength: 0,
      wallTransferLength: 0,
      maxSpan: 0,
      maxGeometricUnbraced: 0,
    },
    status: "unverified",
  };
  const check = (id, label, status, note, extra = {}) =>
    out.checks.push({ id, label, status, note, ...extra });
  if (
    !geometry?.levels ||
    !["x", "y"].includes(axis) ||
    (f.blocking !== undefined && typeof f.blocking !== "boolean") ||
    (f.wallSupportFraming !== undefined && typeof f.wallSupportFraming !== "boolean") ||
    !section ||
    !rim ||
    !blocking ||
    ![section, rim, blocking].every((s) => s.b > 0 && s.h >= s.b) ||
    rim.h !== section.h ||
    blocking.h !== section.h ||
    !finite(f.spacing) ||
    f.spacing <= 0 ||
    !finite(blockStep) ||
    blockStep < 0.3 ||
    blockStep > 3 ||
    !finite(density) ||
    density <= 0
  ) {
    check(
      "floor-platform-input",
      "Параметры платформы",
      "fail",
      "Нужны корректные полноглубинные сечения, шаг лаг и blockingStep0.3…3м.",
    );
    out.status = "fail";
    return out;
  }
  const at = (u, v) => (axis === "y" ? { x: u, y: v } : { x: v, y: u });
  const board = (id, name, role, s, a, z, level, extra = {}) => {
    const L = dist(a, z);
    if (L < EPS) return null;
    const u = { x: (z.x - a.x) / L, y: (z.y - a.y) / L },
      Y = level.baseY + section.h / 1000 - s.h / 2000,
      cs = extra.cutStart ?? { ...zero },
      ce = extra.cutEnd ?? { ...zero },
      volume = (s.b * s.h * L) / 1e6,
      mass = volume * density;
    const b = {
      id,
      name,
      role,
      category: "floor",
      b: s.b,
      h: s.h,
      level: level.index,
      floor: level.index,
      length: L,
      volume,
      mass,
      cutLength: L + allowance(cs, s) + allowance(ce, s),
      start: [a.x, Y, a.y],
      end: [z.x, Y, z.y],
      crossAxis: [-u.y, 0, u.x],
      requireSingleStock: true,
      cutStart: cs,
      cutEnd: ce,
      ...extra,
    };
    out.instances.push(b);
    return b;
  };
  for (const level of geometry.levels.filter((l) => l.closed && l.polygon?.length >= 3)) {
    const contour = contours.find((c) => c.index === level.index);
    if (!contour || contour.valid === false) {
      check(
        `floor-contour-L${level.index}`,
        "Наружная геометрия платформы",
        "fail",
        "Наружное смещение каркаса образует пересечение, обратный участок или чрезмерный острый угол; платформа автоматически не сформирована.",
        { level: level.index },
      );
      continue;
    }
    const startIndex = out.instances.length,
      axisPolygon = clean(level.polygon),
      polygon = contour.outerPolygon,
      bounds = {
        minX: Math.min(...axisPolygon.map((p) => p.x)),
        maxX: Math.max(...axisPolygon.map((p) => p.x)),
        minY: Math.min(...axisPolygon.map((p) => p.y)),
        maxY: Math.max(...axisPolygon.map((p) => p.y)),
      },
      lower = geometry.levels.find((l) => l.index === level.index - 1),
      lines = [];
    if (level.index === 1)
      for (const b of grillageModel?.beams ?? [])
        lines.push({
          id: b.id,
          kind: "grillage",
          a: b.a,
          b: b.b,
          width: b.width,
          stations: b.stations ?? [],
          verifiedGeometry: true,
        });
    else
      for (const w of walls.filter(
        (w) => w.kind !== "partition" && (w.level === undefined || w.level === level.index - 1),
      )) {
        const s = wallFrameSection(w, parse);
        if (s)
          lines.push({
            id: w.id,
            kind: "lowerWall",
            a: w.a,
            b: w.b,
            width: s.h / 1000,
            wallLevel: level.index - 1,
            verifiedGeometry: true,
          });
      }
    // Explicit beams become supports only at their actual elevation and with
    // geometrically present end supports. A floating user object is not a prop.
    if (lower)
      for (const o of (project.objects ?? []).filter(
        (o) => o.type === "beam" && (o.level ?? 1) === lower.index,
      )) {
        const s = parse(o.section),
          cy = lower.wallBaseY + (o.elevation ?? lower.height),
          top = cy + (s?.h ?? 0) / 2000,
          bottom = cy - (s?.h ?? 0) / 2000;
        if (!s || Math.abs(top - level.baseY) > 0.01) continue;
        const supported = (q) =>
          (project.objects ?? []).some((p) => {
            if (p.type !== "post" || (p.level ?? 1) !== lower.index) return false;
            const ps = parse(p.section),
              height = lower.wallBaseY + (p.elevation ?? 0) + (p.height ?? lower.height);
            return ps && dist(p.a, q) <= ps.h / 2000 + EPS && Math.abs(height - bottom) < 0.01;
          }) || lines.some((l) => on(q, l.a, l.b) && Math.abs((lower.topY ?? Infinity) - bottom) < 0.01);
        if (supported(o.a) && supported(o.b))
          lines.push({
            id: o.id,
            kind: "explicitBeam",
            a: o.a,
            b: o.b,
            width: s.b / 1000,
            verifiedGeometry: true,
          });
        else
          check(
            `floor-floating-beam-${o.id}`,
            "Балка под перекрытием: реальные опоры",
            "unverified",
            "Явная балка не уменьшает пролёт: у её концов не подтверждены геометрические опоры на нужной отметке.",
            { objectId: o.id, level: level.index },
          );
      }
    lines.forEach((l) => out.supports.push({ ...l, level: level.index }));
    const openingsAt = (line, q) => {
      if (line.kind !== "lowerWall") return [];
      const w = walls.find((w) => w.id === line.id),
        L = dist(w.a, w.b),
        station = ((q.x - w.a.x) * (w.b.x - w.a.x) + (q.y - w.a.y) * (w.b.y - w.a.y)) / L;
      return (project.openings ?? [])
        .filter(
          (o) =>
            o.wallId === w.id &&
            (o.floor ?? w.level ?? 1) === level.index - 1 &&
            station > o.offset - EPS &&
            station < o.offset + o.width + EPS,
        )
        .map((o) => o.id);
    };
    const crossings = (u) => {
      const direct = lines.flatMap((l) => {
        const df = l.b[fixed] - l.a[fixed];
        if (Math.abs(df) < EPS) return [];
        const t = (u - l.a[fixed]) / df;
        if (t < -EPS || t > 1 + EPS) return [];
        const v = l.a[along] + (l.b[along] - l.a[along]) * t,
          L = dist(l.a, l.b);
        return [
          {
            kind: l.kind,
            sourceId: l.id,
            point: at(u, v),
            station: v,
            halfBearing: ((l.width / 2) * L) / Math.abs(df),
            sourceWallOpeningIds: openingsAt(l, at(u, v)),
            verifiedGeometry: true,
          },
        ];
      });
      if (!wallFraming || level.index !== 1 || direct.length >= 2)
        return direct.sort((a, b) => a.station - b.station);
      // A perimeter package may have a ply outside the wall-axis rectangle but
      // fully above a longitudinal grillage. Its physical stock joints may sit
      // above that real continuous backing. Do not certify a two-prop joist
      // model: grillage flexure, eccentricity and coupled action are unknown.
      const backed = lines
        .filter(
          (l) =>
            l.kind === "grillage" &&
            Math.abs(l.b[fixed] - l.a[fixed]) < EPS &&
            Math.abs(u - l.a[fixed]) + section.b / 2000 <= l.width / 2 + EPS,
        )
        .flatMap((l) => {
          const length = dist(l.a, l.b),
            sign = Math.sign(l.b[along] - l.a[along]),
            stations = (l.stations?.length ? l.stations.map((s) => s.station) : [0, length]).filter(finite);
          return stations.map((s) => {
            const v = l.a[along] + sign * s;
            return {
              kind: "grillage",
              sourceId: l.id,
              point: at(u, v),
              station: v,
              halfBearing: l.width / 2,
              sourceWallOpeningIds: [],
              continuousBacking: true,
              verifiedGeometry: false,
            };
          });
        });
      return direct.concat(backed).sort((a, b) => a.station - b.station);
    };
    const lowerContour = contours.find((c) => c.index === level.index - 1),
      physicalSupportBodies = (grillageModel?.instances ?? []).map((b) => ({
        beamId: b.beamId,
        boardId: b.id,
        poly: planBody(b),
      })),
      supportPolys =
        level.index === 1
          ? physicalSupportBodies.map((b) => b.poly)
          : (lowerContour?.rimSegments ?? []).map((s) => s.wallFootprint);
    const rims = [],
      rimSegments = [];
    for (let i = 0; i < contour.rimSegments.length; i++) {
      const edge = contour.rimSegments[i],
        a = edge.centerStart,
        z = edge.centerEnd,
        L = dist(a, z),
        u = edge.u,
        v = edge.inwardNormal,
        prev = contour.rimSegments[(i + contour.rimSegments.length - 1) % contour.rimSegments.length],
        next = contour.rimSegments[(i + 1) % contour.rimSegments.length];
      const miter = (other, start) => {
        if (Math.abs(u.x * other.u.y - u.y * other.u.x) < EPS) return { ...zero };
        const ray = start ? { x: -other.u.x, y: -other.u.y } : { x: -u.x, y: -u.y },
          ray2 = start ? u : other.u,
          bis = { x: ray.x + ray2.x, y: ray.y + ray2.y },
          N = { x: -bis.y, y: bis.x },
          den = N.x * u.x + N.y * u.y,
          k = Math.abs(den) > EPS ? -(N.x * v.x + N.y * v.y) / den : 0;
        return Math.abs(k) < EPS
          ? { ...zero }
          : {
              scheme: "miter",
              plane: "width",
              angle: (Math.atan(Math.abs(k)) * 180) / Math.PI,
              tiltSign: Math.sign(k),
              cutWidthMM: rim.b,
            };
      };
      const cs = miter(prev, true),
        ce = miter(next, false),
        body = planBody({
          start: [a.x, 0, a.y],
          end: [z.x, 0, z.y],
          b: rim.b,
          crossAxis: [v.x, 0, v.y],
          cutStart: cs,
          cutEnd: ce,
        }),
        bodyArea = Math.abs(signed(body)),
        unbacked = uncovered(body, supportPolys),
        coverage = bodyArea > EPS ? Math.max(0, Math.min(1, 1 - unbacked / bodyArea)) : 0,
        whole = unbacked < 1e-8;
      const center = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 },
        parallel = lines.filter(
          (l) => Math.abs((l.b.x - l.a.x) * u.y - (l.b.y - l.a.y) * u.x) / dist(l.a, l.b) < EPS,
        ),
        bands = parallel.filter((l) => {
          const t =
            ((center.x - l.a.x) * (l.b.x - l.a.x) + (center.y - l.a.y) * (l.b.y - l.a.y)) /
            dist(l.a, l.b) ** 2;
          return t >= -EPS && t <= 1 + EPS;
        }),
        transverseOverlap = (l) => {
          const d = (l.a.x - center.x) * v.x + (l.a.y - center.y) * v.y;
          return Math.max(
            0,
            Math.min(rim.b / 2000, d + l.width / 2) - Math.max(-rim.b / 2000, d - l.width / 2),
          );
        },
        minWidth = Math.min(rim.b / 1000, sum(bands.map(transverseOverlap))),
        bearing = {
          status: whole ? "pass" : coverage < EPS ? "fail" : "unverified",
          coverageRatio: coverage,
          uncoveredArea: unbacked,
          minWidth,
          requiredWidth: rim.b / 1000,
          supportIds: bands.map((l) => l.id),
          cornerContactVerified: false,
          model: level.index === 1 ? "physical-grillage-plies" : "lower-wall-frame-envelope",
        };
      const reveal =
          level.index === 1 && bands.length
            ? Math.max(0, ...bands.map((l) => l.width / 2 - edge.wallDepth / 2))
            : null,
        segment = {
          ...edge,
          bearing,
          alignments: { wallExterior: edge.outerStart, platformExterior: edge.outerStart, error: 0 },
          grillageReveal: reveal,
          rimInnerStart: { x: a.x + (v.x * rim.b) / 2000, y: a.y + (v.y * rim.b) / 2000 },
          rimInnerEnd: { x: z.x + (v.x * rim.b) / 2000, y: z.y + (v.y * rim.b) / 2000 },
          boardIds: [],
        };
      rimSegments.push(segment);
      const N = whole ? Math.ceil((L + allowance(cs, rim) + allowance(ce, rim)) / 6) : 1,
        cuts = Array.from({ length: N + 1 }, (_, j) => (L * j) / N);
      for (let j = 1; j < cuts.length; j++) {
        const pa = { x: a.x + u.x * cuts[j - 1], y: a.y + u.y * cuts[j - 1] },
          pz = { x: a.x + u.x * cuts[j], y: a.y + u.y * cuts[j] },
          r = board(
            `FP-L${level.index}-R${i + 1}-P${j}`,
            "Торцевая доска круговой обвязки",
            "rimJoist",
            rim,
            pa,
            pz,
            level,
            {
              rimEdge: i + 1,
              wallId: edge.wallId,
              rimSegmentId: edge.id,
              continuousBacking: whole,
              bearing,
              cutStart: j === 1 ? cs : { ...zero },
              cutEnd: j === cuts.length - 1 ? ce : { ...zero },
              supportedSpliceStart: j > 1 && whole,
              supportedSpliceEnd: j < cuts.length - 1 && whole,
            },
          );
        if (r) {
          rims.push(r);
          segment.boardIds.push(r.id);
        }
      }
    }
    const partial = rimSegments.filter((s) => s.bearing.status === "unverified"),
      unsupported = rimSegments.filter((s) => s.bearing.status === "fail");
    check(
      `floor-rim-bearing-L${level.index}`,
      "Полоса опирания смещённой обвязки",
      unsupported.length ? "fail" : partial.length ? "unverified" : "pass",
      "Проверено геометрическое перекрытие ширины обвязки реальным ростверком либо огибающей нижнего каркаса. Центр смещённой доски не становится новой опорной осью. Смятие, поперечный момент и реальные угловые узлы не подтверждены.",
      {
        level: level.index,
        failIds: unsupported.map((s) => s.id),
        unverifiedIds: partial.map((s) => s.id),
        minimumCoverage: Math.min(...rimSegments.map((s) => s.bearing.coverageRatio)),
      },
    );
    const steps = rimSegments.filter((s) => s.thicknessStepStart);
    if (steps.length)
      check(
        `floor-thickness-steps-L${level.index}`,
        "Ступенчатый стык обвязки при смене толщины стен",
        "unverified",
        "Сегменты разной толщины сохранены отдельно. Торцевой контакт смещённых досок и передача усилий в ступени не считаются подтверждённым узлом.",
        { level: level.index, segmentIds: steps.map((s) => s.id) },
      );
    if (level.index > 1)
      check(
        `floor-rim-corners-L${level.index}`,
        "Контакт обвязки в углах нижнего каркаса",
        "unverified",
        "Полоса нижней стены — огибающая каркаса. Наружные угловые квадранты над торцами верхних обвязок требуют рабочего опорного узла; огибающая не доказывает наличие древесины в каждой точке угла.",
        { level: level.index, segmentIds: rimSegments.map((s) => s.id) },
      );
    const frame = (floorOpenings?.instances ?? []).filter((b) => b.level === level.index),
      legacy = [];
    for (const hole of level.voids ?? [])
      if (!(floorOpenings?.openings ?? []).some((o) => o.voidId === hole.id && o.replaceLegacy))
        for (let i = 0; i < hole.polygon.length; i++) {
          const a = hole.polygon[i],
            z = hole.polygon[(i + 1) % hole.polygon.length],
            s = parse(hole.edgeSection),
            L = dist(a, z);
          if (s && L > EPS)
            legacy.push({
              id: "legacy-" + hole.id + "-" + i,
              role: "legacyHeader",
              voidId: hole.id,
              b: s.b,
              h: s.h,
              start: [a.x, level.baseY + s.h / 2000, a.y],
              end: [z.x, level.baseY + s.h / 2000, z.y],
              crossAxis: [-(z.y - a.y) / L, 0, (z.x - a.x) / L],
            });
        }
    const hard = [...rims, ...frame, ...legacy].map((b) => ({ board: b, poly: planBody(b) })),
      holes = (level.voids ?? []).map((v) => v.polygon),
      min = bounds[axis === "y" ? "minX" : "minY"],
      max = bounds[axis === "y" ? "maxX" : "maxY"],
      count = Math.max(1, Math.ceil((max - min) / f.spacing)),
      step = (max - min) / count,
      joists = [];
    const endSupport = (u, v) => {
      const trueSupports = crossings(u)
        .filter((s) => Math.abs(s.station - v) <= s.halfBearing + EPS)
        .sort((a, b) => Math.abs(a.station - v) - Math.abs(b.station - v));
      if (trueSupports.length)
        return { ...trueSupports[0], status: trueSupports[0].continuousBacking ? "unverified" : "pass" };
      for (const h of hard) {
        if (
          !intervals(dilate(h.poly, axis, section.b / 2000), u, axis).some(
            ([a, b]) => Math.abs(a - v) < 2e-6 || Math.abs(b - v) < 2e-6,
          )
        )
          continue;
        const b = h.board;
        if (b.role === "openingHeader") {
          const station = b.start[axis === "y" ? 2 : 0];
          return {
            kind: "openingHeader",
            sourceId: b.id,
            point: at(u, station),
            station,
            halfBearing: b.b / 2000,
            status: "pass",
            verifiedGeometry: true,
          };
        }
        if (b.role === "legacyHeader")
          return {
            kind: "legacyHeader",
            sourceId: b.id,
            point: at(u, v),
            station: v,
            status: "unverified",
            verifiedGeometry: false,
          };
      }
      return { kind: "missing", point: at(u, v), station: v, status: "fail", verifiedGeometry: false };
    };
    const parallelEdges = contour.rimSegments.filter((s) => Math.abs(s.u[fixed]) < EPS),
      edgeRows = [];
    for (const e of parallelEdges) {
      const u = e.axisStart[fixed] + e.inwardNormal[fixed] * (e.wallDepth / 2 - section.b / 2000);
      const existing = edgeRows.find((r) => Math.abs(r.u - u) < section.b / 1000 - EPS);
      if (existing) existing.edgeWallIds.push(e.wallId);
      else edgeRows.push({ u, edgeJoist: true, edgeWallIds: [e.wallId] });
    }
    const levelWalls = walls.filter((w) => w.level === undefined || w.level === level.index);
    const wallRows = [];
    if (wallFraming)
      for (const w of levelWalls) {
        const L = dist(w.a, w.b),
          s = wallFrameSection(w, parse);
        if (!s || Math.abs(w.b[fixed] - w.a[fixed]) > EPS || L < EPS) continue;
        const edge = w.kind === "exterior" ? rimSegments.find((e) => e.wallId === w.id) : null,
          n = edge ? Math.max(0, Math.ceil((s.h - rim.b) / section.b)) : Math.ceil(s.h / section.b),
          width = (n * section.b) / 1000;
        for (let k = 0; k < n; k++) {
          const u = edge
            ? edge.axisStart[fixed] +
              (edge.outwardNormal[fixed] * s.h) / 2000 +
              (edge.inwardNormal[fixed] * (rim.b + (k + 0.5) * section.b)) / 1000
            : w.a[fixed] - width / 2 + ((k + 0.5) * section.b) / 1000;
          if (
            rims.some(
              (r) =>
                Math.abs(r.start[axis === "y" ? 0 : 2] - u) < EPS &&
                Math.abs(r.end[axis === "y" ? 0 : 2] - u) < EPS,
            )
          )
            continue;
          const existing = wallRows.find((r) => Math.abs(r.u - u) < EPS);
          if (existing) existing.wallSupportWallIds.push(w.id);
          else
            wallRows.push({
              u,
              edgeJoist: w.kind === "exterior",
              edgeWallIds: w.kind === "exterior" ? [w.id] : [],
              wallSupportWallIds: [w.id],
            });
        }
      }
    // Close parallel packages are merged as actual touching plies. Never draw
    // two intersecting boards or assume composite stiffness from their contact.
    wallRows.sort((a, b) => a.u - b.u);
    for (let i = 1; i < wallRows.length; i++)
      if (wallRows[i].u - wallRows[i - 1].u < section.b / 1000 - EPS) {
        // A row needed by another, nearly collinear wall is shifted to touch its neighbour
        // instead of being dropped: dropping it left an unbacked strip under that wall.
        if (wallRows[i].wallSupportWallIds.some((id) => !wallRows[i - 1].wallSupportWallIds.includes(id))) {
          wallRows[i].u = wallRows[i - 1].u + section.b / 1000;
          continue;
        }
        wallRows[i - 1].wallSupportWallIds.push(...wallRows[i].wallSupportWallIds);
        wallRows[i - 1].edgeWallIds.push(...wallRows[i].edgeWallIds);
        wallRows.splice(i--, 1);
      }
    const reserved = wallFraming ? wallRows : edgeRows;
    const grid = Array.from({ length: count + 1 }, (_, i) => ({ u: min + step * i, edgeJoist: false }))
      .filter(
        (r) =>
          !parallelEdges.some((e) => Math.abs(e.axisStart[fixed] - r.u) < EPS) &&
          !reserved.some((e) => Math.abs(e.u - r.u) < section.b / 1000 + (wallFraming ? 0.04 : 0) - EPS),
      )
      .concat(reserved)
      .sort((a, b) => a.u - b.u);
    if (wallFraming)
      for (let i = 1; i < grid.length; i++) {
        const gap = grid[i].u - grid[i - 1].u,
          n = Math.ceil((gap - EPS) / f.spacing);
        if (n > 1) {
          const low = grid[i - 1].u,
            fill = Array.from({ length: n - 1 }, (_, k) => ({
              u: low + (gap * (k + 1)) / n,
              edgeJoist: false,
            }));
          grid.splice(i, 0, ...fill);
          i += fill.length;
        }
      }
    if (wallFraming)
      for (let i = 0; i < grid.length; i++)
        grid[i].tributaryWidth = Math.max(
          0,
          (i < grid.length - 1 ? (grid[i].u + grid[i + 1].u) / 2 : max) -
            (i ? (grid[i - 1].u + grid[i].u) / 2 : min),
        );
    for (let i = 0; i < grid.length; i++) {
      const u = grid[i].u,
        collisionIntervals = (poly) => {
          const expanded = dilate(poly, axis, section.b / 2000),
            lo = Math.min(...expanded.map((p) => p[fixed])),
            hi = Math.max(...expanded.map((p) => p[fixed]));
          return wallFraming && (u <= lo + EPS || u >= hi - EPS) ? [] : intervals(expanded, u, axis);
        },
        avoid = hard.flatMap((h) => collisionIntervals(h.poly)).concat(holes.flatMap(collisionIntervals)),
        physical = minus(intervals(polygon, u, axis), avoid),
        source = crossings(u);
      let part = 0;
      for (const [a, z] of physical) {
        const cuts = unique([
          a,
          z,
          ...source
            .filter((s) => s.station > a + s.halfBearing + EPS && s.station < z - s.halfBearing - EPS)
            .map((s) => s.station),
        ]);
        for (let j = 1; j < cuts.length; j++) {
          const from = cuts[j - 1],
            to = cuts[j];
          if (to - from < 0.005) continue;
          const A = endSupport(u, from),
            Z = endSupport(u, to),
            supportStatus =
              A.status === "fail" || Z.status === "fail" || Z.station - A.station <= EPS
                ? "fail"
                : A.status === "unverified" || Z.status === "unverified"
                  ? "unverified"
                  : "pass",
            spanId = `FP-L${level.index}-J${i}-S${++part}`,
            analyticalSpan = supportStatus === "pass" ? Z.station - A.station : null,
            b = board(
              spanId,
              grid[i].wallSupportWallIds?.length ? "Лага усиления под стеной" : "Балки перекрытия",
              "joist",
              section,
              at(u, from),
              at(u, to),
              level,
              {
                platformSpanId: spanId,
                gridIndex: i,
                edgeJoist: grid[i].edgeJoist,
                edgeWallIds: grid[i].edgeWallIds,
                wallSupportWallIds: grid[i].wallSupportWallIds,
                actualSpacing: step,
                tributaryWidth: grid[i].tributaryWidth ?? step,
                physicalOverhangStart: Math.max(0, A.station - from),
                physicalOverhangEnd: Math.max(0, to - Z.station),
                analyticalSpan,
                supportStart: A,
                supportEnd: Z,
                supportStatus,
                connectionVerified: false,
              },
            );
          if (!b) continue;
          if (level.index === 1)
            for (const support of [A, Z]) {
              const half = Math.max(0.001, support.halfBearing ?? 0.001),
                seat = planBody({
                  start: [at(u, support.station - half).x, 0, at(u, support.station - half).y],
                  end: [at(u, support.station + half).x, 0, at(u, support.station + half).y],
                  b: section.b,
                  crossAxis: b.crossAxis,
                }),
                body = planBody(b);
              let contactSeat = seat;
              for (let k = 0; k < body.length && contactSeat.length >= 3; k++)
                contactSeat = clip(contactSeat, body[k], body[(k + 1) % body.length]);
              const contacts = physicalSupportBodies.filter(
                (s) => contactSeat.length >= 3 && overlap(contactSeat, s.poly) > 1e-10,
              );
              support.analyticalSourceId = support.sourceId;
              support.sourceIdMeaning = "analytical support-line crossing; physical timber in contactBeamIds";
              support.contactBeamIds = [...new Set(contacts.map((s) => s.beamId))];
              support.contactSourceIds = support.contactBeamIds;
              support.contactBoardIds = contacts.map((s) => s.boardId);
              support.sourceDirectContact = support.contactBeamIds.includes(support.sourceId);
              support.nodeTransferVerified = false;
              support.contactModel = "physical joist bearing seat intersected with physical grillage plies";
            }
          if (level.index > 1)
            for (const support of [A, Z]) {
              support.analyticalSourceId = support.sourceId;
              support.sourceIdMeaning =
                support.kind === "openingHeader"
                  ? "opening frame member; connection not verified"
                  : "lower wall frame-envelope crossing; actual plate/corner contact not certified";
              support.contactSourceIds = support.sourceId ? [support.sourceId] : [];
              support.contactWallIds = support.kind === "lowerWall" ? support.contactSourceIds : [];
              support.contactBeamIds = [];
              support.nodeTransferVerified = false;
              support.contactModel =
                support.kind === "openingHeader"
                  ? "physical frame face with unverified connection"
                  : "nominal lower-wall frame envelope";
            }
          joists.push(b);
          out.spans.push({
            id: spanId,
            memberId: b.id,
            level: level.index,
            physicalStart: at(u, from),
            physicalEnd: at(u, to),
            start: A.point,
            end: Z.point,
            analyticalSpan,
            clearSpan:
              supportStatus === "pass"
                ? Math.max(0, analyticalSpan - (A.halfBearing ?? 0) - (Z.halfBearing ?? 0))
                : null,
            supportStart: A,
            supportEnd: Z,
            supportStatus,
          });
        }
      }
    }
    const blockStart = out.instances.length,
      parallel = [...rims, ...frame, ...joists].filter(
        (b) => Math.abs(b.end[axis === "y" ? 0 : 2] - b.start[axis === "y" ? 0 : 2]) < EPS,
      ),
      sides = [];
    for (const b of parallel) {
      const fixedCoord = b.start[axis === "y" ? 0 : 2],
        a = Math.min(b.start[axis === "y" ? 2 : 0], b.end[axis === "y" ? 2 : 0]),
        z = Math.max(b.start[axis === "y" ? 2 : 0], b.end[axis === "y" ? 2 : 0]);
      let side = sides.find((s) => Math.abs(s.fixed - fixedCoord) < EPS && s.b === b.b);
      if (!side) {
        side = { fixed: fixedCoord, b: b.b, parts: [] };
        sides.push(side);
      }
      side.parts.push({ a, z, id: b.id });
    }
    const from = contour.outerBounds[axis === "y" ? "minY" : "minX"],
      to = contour.outerBounds[axis === "y" ? "maxY" : "maxX"],
      rows = Math.max(1, Math.ceil((to - from) / blockStep));
    const transferRows = [];
    if (wallFraming)
      for (const w of levelWalls) {
        const s = wallFrameSection(w, parse);
        if (!s || Math.abs(w.b[along] - w.a[along]) > EPS) continue;
        const edge = w.kind === "exterior" ? rimSegments.find((e) => e.wallId === w.id) : null,
          n = edge ? Math.max(0, Math.ceil((s.h - rim.b) / blocking.b)) : Math.ceil(s.h / blocking.b),
          width = (n * blocking.b) / 1000;
        for (let k = 0; k < n; k++)
          transferRows.push({
            v: edge
              ? edge.axisStart[along] +
                (edge.outwardNormal[along] * s.h) / 2000 +
                (edge.inwardNormal[along] * (rim.b + (k + 0.5) * blocking.b)) / 1000
              : w.a[along] - width / 2 + ((k + 0.5) * blocking.b) / 1000,
            wall: w,
          });
      }
    const blockRows = transferRows
      .map((q, i) => ({ ...q, row: "W" + (i + 1) }))
      .concat(
        enabled
          ? Array.from({ length: rows - 1 }, (_, i) => ({
              v: from + ((to - from) * (i + 1)) / rows,
              row: i + 1,
            }))
          : [],
      );
    for (const { v, row, wall } of blockRows) {
      const candidates = sides
        .filter(
          (s) =>
            minus(
              [[v - blocking.b / 2000, v + blocking.b / 2000]],
              s.parts.map((p) => [p.a, p.z]),
            ).length === 0,
        )
        .sort((a, b) => a.fixed - b.fixed);
      for (let k = 1; k < candidates.length; k++) {
        const left = candidates[k - 1],
          right = candidates[k],
          a = left.fixed + left.b / 2000,
          z = right.fixed - right.b / 2000;
        if (z - a < 0.04) continue;
        const A = at(a, v),
          Z = at(z, v),
          shape =
            axis === "y"
              ? [
                  { x: a, y: v - blocking.b / 2000 },
                  { x: z, y: v - blocking.b / 2000 },
                  { x: z, y: v + blocking.b / 2000 },
                  { x: a, y: v + blocking.b / 2000 },
                ]
              : [
                  { x: v - blocking.b / 2000, y: a },
                  { x: v + blocking.b / 2000, y: a },
                  { x: v + blocking.b / 2000, y: z },
                  { x: v - blocking.b / 2000, y: z },
                ],
          poly = clean(shape);
        if (
          wall &&
          (z < Math.min(wall.a[fixed], wall.b[fixed]) - EPS ||
            a > Math.max(wall.a[fixed], wall.b[fixed]) + EPS)
        )
          continue;
        if (
          !poly.every((p) => inside(p, polygon)) ||
          !poly.every((p, i) => segmentInside(p, poly[(i + 1) % poly.length], polygon)) ||
          holes.some((h) => overlap(poly, clean(h)) > EPS)
        )
          continue;
        const sideIds = new Set(
            [...left.parts, ...right.parts].filter((p) => p.a <= v + EPS && p.z >= v - EPS).map((p) => p.id),
          ),
          colliders = [
            ...hard,
            ...joists.map((b) => ({ board: b, poly: planBody(b) })),
            ...out.instances.slice(blockStart).map((b) => ({ board: b, poly: planBody(b) })),
          ];
        if (colliders.some((h) => !sideIds.has(h.board.id) && overlap(poly, h.poly) > EPS)) continue;
        board(
          `FP-L${level.index}-BL${row}-${k}`,
          wall ? "Поперечная опорная вставка под стеной" : "Полноразмерный поперечный блокинг",
          wall ? "wallTransferBlocking" : "floorBlocking",
          blocking,
          A,
          Z,
          level,
          {
            blockingRow: row,
            blockingStation: v,
            wallSupportWallIds: wall ? [wall.id] : undefined,
            wallLoadTransfer: !!wall,
            verticalLoadTransfer: !!wall,
            supportsJoist: false,
            lateralRestraintOnly: !wall,
            verticalSupport: false,
            supports: [
              {
                memberIds: [...left.parts.filter((p) => p.a <= v + EPS && p.z >= v - EPS).map((p) => p.id)],
                point: A,
              },
              {
                memberIds: [...right.parts.filter((p) => p.a <= v + EPS && p.z >= v - EPS).map((p) => p.id)],
                point: Z,
              },
            ],
            connectionVerified: false,
          },
        );
      }
    }
    const blocks = out.instances
      .slice(blockStart)
      .filter((b) => ["floorBlocking", "wallTransferBlocking"].includes(b.role));
    for (const j of joists) {
      const low = j.start[axis === "y" ? 2 : 0],
        high = j.end[axis === "y" ? 2 : 0],
        restraints = unique([
          low,
          high,
          ...blocks
            .filter((b) => b.supports.some((s) => s.memberIds.includes(j.id)))
            .map((b) => b.blockingStation),
        ]);
      j.geometricUnbracedLength = Math.max(...restraints.slice(1).map((v, i) => v - restraints[i]));
      j.geometricRestraintStations = restraints;
    }
    const raw = out.instances.slice(startIndex),
      missing = joists.filter((j) => j.supportStatus === "fail"),
      unverified = joists.filter((j) => j.supportStatus === "unverified"),
      maxU = Math.max(0, ...joists.map((j) => j.geometricUnbracedLength)),
      tooLong = raw.filter((b) => b.cutLength > 6 + EPS),
      numeric = joists.filter((j) => finite(j.analyticalSpan));
    const timberPolys = [...raw, ...frame].map(planBody);
    if (wallFraming)
      for (const w of levelWalls) {
        const L = dist(w.a, w.b),
          s = wallFrameSection(w, parse);
        if (!s || L < EPS) continue;
        const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L },
          n = { x: -u.y, y: u.x },
          d = s.h / 2000,
          edge = rimSegments.find((e) => e.wallId === w.id),
          footprint =
            edge?.wallFootprint ??
            clean([
              { x: w.a.x + n.x * d, y: w.a.y + n.y * d },
              { x: w.b.x + n.x * d, y: w.b.y + n.y * d },
              { x: w.b.x - n.x * d, y: w.b.y - n.y * d },
              { x: w.a.x - n.x * d, y: w.a.y - n.y * d },
            ]),
          area = Math.abs(signed(footprint)),
          gap = uncovered(footprint, timberPolys),
          contact = raw.filter((b) => overlap(footprint, planBody(b)) > 1e-9),
          orientation =
            Math.abs(w.b[fixed] - w.a[fixed]) < EPS
              ? "parallel"
              : Math.abs(w.b[along] - w.a[along]) < EPS
                ? "perpendicular"
                : "oblique";
        out.wallSupports.push({
          wallId: w.id,
          level: level.index,
          kind: w.kind,
          orientation,
          footprint,
          wallDepth: s.h,
          boardIds: contact.map((b) => b.id),
          joistIds: contact.filter((b) => b.role === "joist").map((b) => b.id),
          transferBoardIds: contact.filter((b) => b.role === "wallTransferBlocking").map((b) => b.id),
          coverageRatio: area > EPS ? Math.max(0, 1 - gap / area) : 0,
          uncoveredArea: gap,
          geometryComplete: gap < 1e-7,
          deckThickness: floorDeckThickness(project),
          layerBasis: {
            thickness: floorDeckThickness(project),
            source: project.sheathing?.floors ? "sheathing.floors" : "legacy-platform-offset",
            material: project.sheathing?.floors?.product ?? null,
            structuralVerified: false,
            visualRepresentation: project.sheathing?.floors
              ? "sheetModel polygons"
              : "nominal deck solid; not fabricated timber",
            massBasis: project.sheathing?.floors
              ? "sheetModel self weight; floorDead excludes deck"
              : "included in supplied floorDead; no extra self weight",
          },
          wallBaseY: level.wallBaseY,
          framingTopY: level.baseY + section.h / 1000,
          connectionsVerified: false,
          loadSpreadingVerified: false,
        });
      }
    const wallSupports = out.wallSupports.filter((w) => w.level === level.index);
    if (wallFraming)
      check(
        `floor-wall-framing-L${level.index}`,
        "Древесина под полной шириной основания стен",
        wallSupports.some((w) => !w.geometryComplete) ? "fail" : "pass",
        "Проверено покрытие полной полосы стены физическими гранями лаг и поперечных вставок. Вдоль лаг добавлены отдельные доски, поперёк — вставки между лагами. Контакт через настил, несущая способность и крепёж не следуют из геометрии.",
        {
          level: level.index,
          value: Math.min(...wallSupports.map((w) => w.coverageRatio)),
          limit: 1,
          unit: "доля",
          failIds: wallSupports.filter((w) => !w.geometryComplete).map((w) => w.wallId),
        },
      );
    for (const edge of rimSegments) {
      const footprint = edge.wallFootprint,
        baseArea = Math.abs(signed(footprint)),
        deckContainsWallBase =
          footprint.every((q) => inside(q, polygon)) &&
          !holes.some((h) => overlap(footprint, clean(h)) > EPS),
        edgeJoistIds = joists
          .filter((j) => j.edgeJoist && j.edgeWallIds?.includes(edge.wallId))
          .map((j) => j.id),
        bridgeIds = blocks
          .filter(
            (b) =>
              b.supports.some((s) => s.memberIds.some((id) => edge.boardIds.includes(id))) &&
              b.supports.some((s) => s.memberIds.some((id) => edgeJoistIds.includes(id))),
          )
          .map((b) => b.id),
        parallelToJoists = Math.abs(edge.u[fixed]) < EPS;
      edge.wallBase = {
        deckContainsWallBase,
        area: baseArea,
        timberContactArea: baseArea - uncovered(footprint, timberPolys),
        timberContactRatio: baseArea > EPS ? 1 - uncovered(footprint, timberPolys) / baseArea : 0,
        parallelToJoists,
        edgeJoistIds,
        blockingIds: bridgeIds,
        geometryArrangementComplete: !parallelToJoists || (edgeJoistIds.length > 0 && bridgeIds.length > 0),
        loadSpreadingVerified: false,
      };
    }
    const outsideBase = rimSegments.filter((e) => !e.wallBase.deckContainsWallBase),
      missingBase = rimSegments.filter((e) => !e.wallBase.geometryArrangementComplete);
    check(
      `floor-wall-base-L${level.index}`,
      "Основание стены, настил и краевое обрамление",
      outsideBase.length ? "fail" : "unverified",
      "Настил сформирован по полной наружной огибающей стен. Для стен вдоль лаг добавлены внутренние краевые лаги и блокинг; площадь контакта с древесиной показана отдельно. Передача нагрузки через настил/обвязки, поперечный изгиб и местное смятие не подтверждены.",
      {
        level: level.index,
        failIds: outsideBase.map((e) => e.id),
        unverifiedIds: missingBase.map((e) => e.id),
        minimumTimberContactRatio: Math.min(...rimSegments.map((e) => e.wallBase.timberContactRatio)),
      },
    );
    const nodeTransfers =
      level.index === 1
        ? joists.filter((j) =>
            [j.supportStart, j.supportEnd].some((s) => s.contactBeamIds?.length && !s.sourceDirectContact),
          )
        : [];
    if (nodeTransfers.length)
      check(
        `floor-grillage-node-transfer-L${level.index}`,
        "Контакт лаг с древесиной в узле ростверка",
        "unverified",
        "Аналитическая поперечная опорная линия отличается от непосредственно контактирующей продольной балки. Реальная древесина присутствует в bearingseat; sourceId — аналитическая линия, точные contactBeamIds указаны отдельно. Передача в узле, эксцентриситет и смятие не рассчитаны.",
        {
          level: level.index,
          memberIds: nodeTransfers.map((j) => j.id),
          unverifiedIds: nodeTransfers.map((j) => j.id),
        },
      );
    check(
      `floor-supports-L${level.index}`,
      "Опоры лаг платформы",
      "" + (missing.length ? "fail" : unverified.length ? "unverified" : "pass"),
      missing.length
        ? "Есть концы без реальной опоры: обвязка или граница проёма не становится автоматически несущей балкой."
        : unverified.length
          ? "Часть концов имеет контурное обрамление либо непрерывное опирание на продольный ростверк. Совместная деформация балки и лаги не решена; такая доска не получает численную проверку как балка на двух жёстких опорах."
          : "Пролёты разделены только реальными ростверками, стенами или подтверждёнными геометрическими балками.",
      {
        level: level.index,
        missing: missing.length,
        unverified: unverified.length,
        failIds: missing.map((j) => j.id),
        unverifiedIds: unverified.map((j) => j.id),
      },
    );
    const aboveOpenings = joists.filter((j) =>
      [j.supportStart, j.supportEnd].some((s) => s.sourceWallOpeningIds?.length),
    );
    if (aboveOpenings.length)
      check(
        `floor-bearing-openings-L${level.index}`,
        "Опоры лаг над проёмами нижних стен",
        "unverified",
        "Стена геометрически существует, но реакции проходят через нижнюю перемычку/обвязку. Её работа, стойки и узлы под этими реакциями не рассчитаны.",
        {
          level: level.index,
          value: aboveOpenings.length,
          unit: "шт.",
          memberIds: aboveOpenings.map((j) => j.id),
          sourceWallOpeningIds: [
            ...new Set(
              aboveOpenings.flatMap((j) =>
                [j.supportStart, j.supportEnd].flatMap((s) => s.sourceWallOpeningIds ?? []),
              ),
            ),
          ],
        },
      );
    const unrestrained = joists.filter((j) => j.geometricUnbracedLength > blockStep + EPS),
      packageUnknown = unrestrained.filter((j) => j.wallSupportWallIds?.length),
      missingRestraint = unrestrained.filter((j) => !j.wallSupportWallIds?.length);
    check(
      `floor-blocking-L${level.index}`,
      "Геометрическое поперечное раскрепление лаг",
      !enabled
        ? "unverified"
        : missingRestraint.length
          ? "fail"
          : packageUnknown.length
            ? "unverified"
            : "pass",
      !enabled
        ? "Блокинг отключён; расчётная длина лаг не уменьшена."
        : packageUnknown.length
          ? "Часть досок пакетов соприкасается продольными гранями и не имеет отдельной распорки в каждом ряду. Скрепление пакета и его устойчивость требуют расчёта; соприкосновение не сокращает расчётную длину."
          : "Полноразмерные поперечные доски связывают соседние реальные элементы. Они не являются вертикальными опорами и не уменьшают пролёт.",
      {
        level: level.index,
        value: maxU,
        limit: blockStep,
        unit: "м",
        failIds: enabled ? missingRestraint.map((j) => j.id) : [],
        unverifiedIds: enabled ? packageUnknown.map((j) => j.id) : joists.map((j) => j.id),
      },
    );
    check(
      `floor-stock-L${level.index}`,
      "Цельные доски платформы и стыки на опорах",
      tooLong.length ? "fail" : "pass",
      tooLong.length
        ? "Есть доски длиннее6м; неподдержанный стык автоматически не вставляется."
        : "Лаги разделены по реальным опорам; стыки обвязки расположены над непрерывной нижней несущей линией.",
      { level: level.index, value: tooLong.length, limit: 0, unit: "шт.", failIds: tooLong.map((b) => b.id) },
    );
    out.levels.push({
      ...contour,
      rimSegments,
      index: level.index,
      polygon,
      actualSpacing: step,
      nonUniformSpacing: wallFraming,
      wallSupports,
      rimIds: rims.map((b) => b.id),
      joistIds: joists.map((b) => b.id),
      blockingIds: blocks.map((b) => b.id),
      wallTransferIds: blocks.filter((b) => b.wallLoadTransfer).map((b) => b.id),
      maxGeometricUnbraced: maxU,
      quantities: {
        count: raw.length,
        mass: sum(raw.map((b) => b.mass)),
        volume: sum(raw.map((b) => b.volume)),
        rimLength: sum(rims.map((b) => b.length)),
        joistLength: sum(joists.map((b) => b.length)),
        blockingLength: sum(blocks.map((b) => b.length)),
        wallTransferLength: sum(blocks.filter((b) => b.wallLoadTransfer).map((b) => b.length)),
        maxSpan: Math.max(0, ...numeric.map((b) => b.analyticalSpan)),
      },
    });
  }
  const q = out.quantities;
  q.count = out.instances.length;
  q.mass = sum(out.instances.map((b) => b.mass));
  q.volume = sum(out.instances.map((b) => b.volume));
  for (const role of ["rimLength", "joistLength", "blockingLength", "wallTransferLength"])
    q[role] = sum(out.levels.map((l) => l.quantities[role]));
  q.maxSpan = Math.max(0, ...out.levels.map((l) => l.quantities.maxSpan));
  q.maxGeometricUnbraced = Math.max(0, ...out.levels.map((l) => l.maxGeometricUnbraced));
  check(
    "floor-platform-connections",
    "Крепления обвязки, лаг и блокинга",
    "unverified",
    "Смятие, гвозди/шурупы/подвесы, передача горизонтальных усилий, кручение и вибрация требуют расчёта. Наличие блокинга не подтверждает численно LTB или работу диафрагмы.",
  );
  out.assumptions = [
    "Оси стен сохранены отдельно. Наружная грань платформы совпадает с наружной гранью реального сечения стен; центр обвязки смещён наружу на (толщина стены−ширина обвязки)/2. Митровые торцы в углах согласованы в плоскости ширины; масса считается по реальным доскам один раз.",
    "Лаги физически заканчиваются у граней обвязки/обрамления, а аналитический пролёт сохраняется между настоящими опорами. Сваи и блокинг сами по себе не дают дополнительных опор лагам.",
    "Платформа1опирается на реальные линии ростверка; платформа2 — на exterior/bearingстены нижнего этажа и только геометрически поддержанные балки нужной отметки. Верхняя перегородка не является опорой нижнего перекрытия.",
    "Шестиметровая заготовка не сокращает пролёт. Длинная лага без промежуточной реальной опоры остаётся цельной и получаетstockfail. Стыки обвязки допускаются только над непрерывной нижней линией; их крепёж не рассчитан.",
    "Вдоль стен, параллельных лагам, добавлены внутренние краевые лаги и связывающий их с обвязкой блокинг. Настил перекрывает полную огибающую стенового основания; распределение нагрузки поперёк настила и плоской обвязки, смятие и крепёж требуют расчёта.",
    "Опция floor.wallSupportFraming формирует отдельные продольные доски и поперечные опорные вставки под полную толщину ортогональных стен. Косые стены и отверстия проверяются на непокрытые участки; наличие древесины не подтверждает крепёж и несущую способность. Настил35мм сохраняется между верхом балок и нижней обвязкой стены.",
    "Блокинг полной глубины поставлен между фактическими гранями соседних лаг/обвязки/продольных балок проёмов. Ряды не проходят через проёмы и не пересекают существующие доски.",
    "geometricUnbracedLength — расстояние между показанными связями, а не подтверждённая расчётная длина устойчивости. Податливость креплений и прочность распорок, работа настила и вибрационный комфорт не проверены.",
  ];
  out.warnings = out.checks.filter((c) => c.status === "fail").map((c) => c.note);
  out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  return out;
}

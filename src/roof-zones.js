import { calculateSourceRoof } from "./source-roof.js";
import { calculateTiedRafters } from "./tied-rafters.js";
import { physicalTrussBoards, checkPhysicalTrussChords } from "./physical-truss.js";
import { deriveWallProfiles } from "./wall-profiles.js";
import { calculateRafter } from "./rafters.js";
import { buildRafterSupports } from "./rafter-supports.js";
import { timberSections } from "./catalog.js";
import { calculateRoofDrainage, orientRoofsAwayFromWalls } from "./roof-drainage.js";
import { buildTruss, trussSources } from "./trusses.js";
import { loadProfile, loadFactors, snowBasis, snowShapeMu, unbalancedSnow } from "./load-profile.js";
const EPS = 1e-7,
  G = 9.80665;
const sum = (a) => a.reduce((s, x) => s + x, 0),
  finite = Number.isFinite;
// µ(α) per the active code profile (СП 20.13330.2016 прил. Б, схема Б.1).
// Explicit project/zone coefficients override the profile rule everywhere.
const snowMu = (zone, pitch, profile) => zone.snowMu ?? snowShapeMu(pitch, profile);
/**
 * Envelope of one symmetric truss solution and its unbalanced snow cases: each
 * bar keeps the forces of the case with the highest utilisation, deflection
 * the maximum. Geometry, nodes and reactions stay those of the symmetric case.
 */
function envelopeTruss(base, cases) {
  const all = [{ id: "symmetric", analysis: base }, ...cases.filter((c) => c.analysis?.stable)];
  if (all.length < 2) return base;
  const bars = base.bars.map((bar, i) => {
    const options = all.map((c) => ({ id: c.id, bar: c.analysis.bars[i] })),
      gov = options.reduce((a, b) => (b.bar.utilization > a.bar.utilization + 1e-12 ? b : a));
    return {
      ...gov.bar,
      snowCase: gov.id,
      utilizationByCase: Object.fromEntries(options.map((o) => [o.id, o.bar.utilization])),
    };
  });
  const barById = new Map(bars.map((b) => [b.id, b])),
    deflection = all
      .map((c) => ({ id: c.id, check: c.analysis.checks.find((q) => q.id === "deflection") }))
      .reduce((a, b) => ((b.check?.value ?? 0) > (a.check?.value ?? 0) ? b : a));
  const checks = base.checks.map((q) => {
    if (barById.has(q.id)) {
      const bar = barById.get(q.id),
        source = all.find((c) => c.id === bar.snowCase).analysis.checks.find((x) => x.id === q.id);
      return { ...source, snowCase: bar.snowCase };
    }
    if (q.id === "deflection") return { ...deflection.check, snowCase: deflection.id };
    return q;
  });
  const summary = all.map((c) => ({
      id: c.id,
      muLeft: c.muLeft,
      muRight: c.muRight,
      maxUtilization: c.analysis.analysis?.maxUtilization ?? null,
      maxBarUtilization: Math.max(0, ...c.analysis.bars.map((b) => b.utilization)),
      governedBars: bars.filter((b) => b.snowCase === c.id).map((b) => b.id),
    })),
    governing = summary.reduce((a, b) => (b.maxBarUtilization > a.maxBarUtilization ? b : a));
  return {
    ...base,
    bars,
    checks,
    reactionsByCase: Object.fromEntries(all.map((c) => [c.id, c.analysis.reactions])),
    snowCases: summary,
    governingSnowCase: governing.id,
    analysis: {
      ...base.analysis,
      maxUtilization: Math.max(...all.map((c) => c.analysis.analysis?.maxUtilization ?? 0)),
    },
    status: checks.some((c) => c.status === "fail") ? "fail" : base.status,
  };
}
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const signedArea = (p) =>
  sum(p.map((a, i) => a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y)) / 2;
const area = (p) => Math.abs(signedArea(p));
const near = (a, b) => Math.abs(a - b) < EPS;
const sec = (s) => {
  const m = typeof s === "string" && s.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  return m ? { b: +m[1], h: +m[2] } : null;
};
const unique = (a) => [...a].sort((a, b) => a - b).filter((v, i, s) => !i || !near(v, s[i - 1]));
const projectAuxDisabled = (p) => p.auxiliaryTimber?.enabled !== true;
const on = (p, a, b) =>
  Math.abs(cross(a, b, p)) < EPS &&
  p.x >= Math.min(a.x, b.x) - EPS &&
  p.x <= Math.max(a.x, b.x) + EPS &&
  p.y >= Math.min(a.y, b.y) - EPS &&
  p.y <= Math.max(a.y, b.y) + EPS;
function inside(p, poly) {
  if (poly.some((a, i) => on(p, a, poly[(i + 1) % poly.length]))) return true;
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function clean(poly) {
  let p = (poly ?? []).map((q) => ({ x: q.x, y: q.y }));
  if (p.length > 1 && Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y) < EPS) p.pop();
  p = p.filter((q, i) => i === 0 || Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y) > EPS);
  let again = true;
  while (again && p.length > 3) {
    again = false;
    for (let i = 0; i < p.length; i++)
      if (Math.abs(cross(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length])) < EPS) {
        p.splice(i, 1);
        again = true;
        break;
      }
  }
  if (signedArea(p) < 0) p.reverse();
  return p;
}
function triangulate(poly) {
  const p = clean(poly),
    indices = p.map((_, i) => i),
    out = [];
  let guard = 0;
  while (indices.length > 3 && guard++ < p.length * p.length) {
    let found = false;
    for (let j = 0; j < indices.length; j++) {
      const ia = indices[(j + indices.length - 1) % indices.length],
        ib = indices[j],
        ic = indices[(j + 1) % indices.length],
        a = p[ia],
        b = p[ib],
        c = p[ic];
      if (cross(a, b, c) <= EPS) continue;
      const blocks = indices.some(
        (k) =>
          k !== ia &&
          k !== ib &&
          k !== ic &&
          cross(a, b, p[k]) >= -EPS &&
          cross(b, c, p[k]) >= -EPS &&
          cross(c, a, p[k]) >= -EPS,
      );
      if (blocks) continue;
      out.push([a, b, c]);
      indices.splice(j, 1);
      found = true;
      break;
    }
    if (!found) throw Error("Полигон зоны не является простым невырожденным контуром.");
  }
  if (indices.length === 3) out.push(indices.map((i) => p[i]));
  return out;
}
function clip(poly, fn) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      fa = fn(a),
      fb = fn(b),
      ina = fa >= -EPS,
      inb = fb >= -EPS;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return clean(out);
}
function lineIntervals(poly, at) {
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    if (near(a.x, at)) hits.push(a.y);
    if (near(b.x, at)) hits.push(b.y);
    if ((a.x - at) * (b.x - at) < -EPS * EPS) hits.push(a.y + ((b.y - a.y) * (at - a.x)) / (b.x - a.x));
  }
  const values = unique(hits),
    out = [];
  for (let i = 1; i < values.length; i++)
    if (values[i] - values[i - 1] > EPS && inside({ x: at, y: (values[i] + values[i - 1]) / 2 }, poly))
      out.push([values[i - 1], values[i]]);
  return out;
}
function subtractIntervals(intervals, covers) {
  let out = intervals;
  for (const [c, d] of covers) {
    const next = [];
    for (const [a, b] of out) {
      if (d <= a + EPS || c >= b - EPS) next.push([a, b]);
      else {
        if (c > a + EPS) next.push([a, c]);
        if (d < b - EPS) next.push([d, b]);
      }
    }
    out = next;
  }
  return out;
}
function overlapArea(a, b) {
  let total = 0;
  for (const ta of triangulate(a))
    for (const tb of triangulate(b)) {
      let part = ta;
      for (let i = 0; i < 3 && part.length >= 3; i++)
        part = clip(part, (q) => cross(tb[i], tb[(i + 1) % 3], q));
      if (part.length >= 3) total += area(part);
    }
  return total;
}
function subtractConvex(subject, cutter) {
  let remainder = subject;
  const outside = [];
  for (let i = 0; i < cutter.length && remainder.length >= 3; i++) {
    const a = cutter[i],
      b = cutter[(i + 1) % cutter.length],
      piece = clip(remainder, (q) => -cross(a, b, q));
    if (piece.length >= 3 && area(piece) > EPS) outside.push(piece);
    remainder = clip(remainder, (q) => cross(a, b, q));
  }
  return outside;
}

/** Exact rectangular partition of an orthogonal polygon; no bounding-box roof. */
export function autoRoofZones(polygon, defaults = {}) {
  const p = clean(polygon);
  if (p.length < 3 || p.some((q) => !finite(q.x) || !finite(q.y))) return [];
  const axisAligned = (q) =>
    q.every((a, i) => {
      const b = q[(i + 1) % q.length];
      return near(a.x, b.x) || near(a.y, b.y);
    });
  const orthogonal = axisAligned(p) && (defaults.excludePolygons ?? []).every((q) => axisAligned(clean(q)));
  const base = {
    shape: defaults.type === "mono" ? "mono" : "gable",
    ridgeAngle: 0,
    pitchLeft: defaults.pitch ?? 25,
    pitchRight: defaults.pitch ?? 25,
    elevation: null,
    framing: "auto",
    deflectionRatio: 300,
    trussType: ["king", "queen", "fink", "mono"].includes(defaults.type) ? defaults.type : "fink",
    spacing: defaults.spacing ?? 0.6,
    chordSection: defaults.chordSection ?? "50x150",
    webSection: defaults.webSection ?? "50x100",
    ...defaults,
  };
  delete base.zones;
  delete base.excludePolygons;
  const excludes = (defaults.excludePolygons ?? []).map(clean),
    xs = unique(p.concat(...excludes).map((q) => q.x)),
    rects = [];
  if (!orthogonal) {
    if (excludes.some((q) => overlapArea(p, q) >= area(p) - 1e-5)) return [];
    if (!excludes.some((q) => overlapArea(p, q) > EPS))
      return [
        {
          ...base,
          id: defaults.idPrefix ?? "roof-auto-1",
          name: "Кровля по контуру",
          polygon: p,
          automatic: true,
          needsClippedFraming: true,
        },
      ];
    let pieces = triangulate(p);
    for (const excluded of excludes)
      for (const triangle of triangulate(excluded)) {
        pieces = pieces.flatMap((q) => subtractConvex(q, triangle));
        if (pieces.length > 100) return [];
      }
    return pieces
      .filter((q) => area(q) > 0.01)
      .map((polygon, i) => ({
        ...base,
        id: `${defaults.idPrefix ?? "roof-auto"}-${i + 1}`,
        name: `Кровля по контуру ${i + 1}`,
        polygon,
        automatic: true,
        needsClippedFraming: true,
      }));
  }
  for (let i = 1; i < xs.length; i++) {
    const x0 = xs[i - 1],
      x1 = xs[i];
    if (x1 - x0 < EPS) continue;
    const mid = (x0 + x1) / 2,
      intervals = subtractIntervals(
        lineIntervals(p, mid),
        excludes.flatMap((e) => lineIntervals(e, mid)),
      );
    for (const [a, b] of intervals) {
      const previous = rects.find((r) => near(r.x1, x0) && near(r.y0, a) && near(r.y1, b));
      if (previous) previous.x1 = x1;
      else rects.push({ x0, x1, y0: a, y1: b });
    }
  }
  return rects.map((r, i) => ({
    ...base,
    id: `${defaults.idPrefix ?? "roof-auto"}-${i + 1}`,
    name: `Кровля ${i + 1}`,
    polygon: [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
    ],
    automatic: true,
  }));
}

function contained(poly, building) {
  if (!building?.length) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ts = [0, 1];
    if (!inside(a, building)) return false;
    for (let j = 0; j < building.length; j++) {
      const c = building[j],
        d = building[(j + 1) % building.length],
        vx = b.x - a.x,
        vy = b.y - a.y,
        wx = d.x - c.x,
        wy = d.y - c.y,
        den = vx * wy - vy * wx;
      if (Math.abs(den) < EPS) continue;
      const t = ((c.x - a.x) * wy - (c.y - a.y) * wx) / den,
        s = ((c.x - a.x) * vy - (c.y - a.y) * vx) / den;
      if (t > 0 && t < 1 && s >= 0 && s <= 1) ts.push(t);
    }
    const v = unique(ts);
    for (let j = 1; j < v.length; j++) {
      const t = (v[j - 1] + v[j]) / 2;
      if (!inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, building)) return false;
    }
  }
  return true;
}

// Two supported mono slopes can meet at a ridge without making a truss.
// Their high ends must terminate in the SAME vertical plan plane. Square cuts
// normal to the sloped axes otherwise occupy the same wedge below the ridge.
function supportedRidgeCuts(out) {
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0),
    cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    tolerance = 1e-6;
  const edge = (z) => {
    const theta = (z.ridgeAngle * Math.PI) / 180,
      v = (p) => -p.x * Math.sin(theta) + p.y * Math.cos(theta);
    for (let i = 0; i < z.polygon.length; i++) {
      const a = z.polygon[i],
        b = z.polygon[(i + 1) % z.polygon.length];
      if (Math.abs(v(a) - z.bounds.maxV) < tolerance && Math.abs(v(b) - z.bounds.maxV) < tolerance)
        return { a, b };
    }
    return null;
  };
  const eligible = out.zones.filter(
    (z) =>
      z.shape === "mono" && z.effectiveFraming === "rafters" && z.analysisApplicable && z.partialFrames === 0,
  );
  out.rafterJoints = [];
  for (let i = 0; i < eligible.length; i++)
    for (let j = 0; j < i; j++) {
      const a = eligible[i],
        b = eligible[j];
      if (
        a.levelIndex !== b.levelIndex ||
        Math.abs(Math.cos(((a.ridgeAngle - b.ridgeAngle) * Math.PI) / 180) + 1) > tolerance
      )
        continue;
      const ea = edge(a),
        eb = edge(b);
      if (!ea || !eb) continue;
      const length = Math.hypot(ea.b.x - ea.a.x, ea.b.y - ea.a.y),
        u = { x: (ea.b.x - ea.a.x) / length, y: (ea.b.y - ea.a.y) / length };
      if (
        Math.abs(cross(ea.a, ea.b, eb.a)) / length > tolerance ||
        Math.abs(cross(ea.a, ea.b, eb.b)) / length > tolerance
      )
        continue;
      const station = (p) => (p.x - ea.a.x) * u.x + (p.y - ea.a.y) * u.y,
        lo = Math.max(0, Math.min(station(eb.a), station(eb.b))),
        hi = Math.min(length, Math.max(station(eb.a), station(eb.b)));
      if (hi - lo < tolerance) continue;
      const highA = a.eave + a.rise + (a.rafterAxisLift ?? 0),
        highB = b.eave + b.rise + (b.rafterAxisLift ?? 0);
      if (Math.abs(highA - highB) > tolerance) continue;
      if ((a.overhangs?.high ?? 0) > EPS || (b.overhangs?.high ?? 0) > EPS) {
        out.checks.push({
          id: `${a.id}-${b.id}-ridge-overhang`,
          label: "Свес в общем коньке",
          status: "fail",
          note: "Высокий свес на общей кромке встречных скатов запрещён: доски и покрытия пересекутся.",
        });
        out.complete = false;
        continue;
      }
      const coverEdge = (z) => {
          const theta = (z.ridgeAngle * Math.PI) / 180,
            v = (p) => -p.x * Math.sin(theta) + p.y * Math.cos(theta);
          const P = z.coverPolygon ?? z.polygon;
          for (let i = 0; i < P.length; i++)
            if (
              Math.abs(v(P[i]) - z.bounds.maxV) < tolerance &&
              Math.abs(v(P[(i + 1) % P.length]) - z.bounds.maxV) < tolerance
            )
              return { a: P[i], b: P[(i + 1) % P.length] };
          return null;
        },
        ca = coverEdge(a),
        cb = coverEdge(b);
      if (ca && cb) {
        const from = Math.max(Math.min(station(ca.a), station(ca.b)), Math.min(station(cb.a), station(cb.b))),
          to = Math.min(Math.max(station(ca.a), station(ca.b)), Math.max(station(cb.a), station(cb.b)));
        if (to > from + tolerance) {
          const coverId = `COVER-RIDGE-${b.id}-${a.id}`,
            start = [ea.a.x + u.x * from, highA, ea.a.y + u.y * from],
            end = [ea.a.x + u.x * to, highA, ea.a.y + u.y * to];
          (out.coverRidgeJoints ??= []).push({
            id: coverId,
            zoneIds: [b.id, a.id],
            start,
            end,
            connectionVerified: false,
          });
          for (const z of [a, b]) {
            const t = (z.ridgeAngle * Math.PI) / 180;
            z.coverHighJointId = coverId;
            z.coverHighPlane = { point: start, normal: [-Math.sin(t), 0, Math.cos(t)] };
          }
        }
      }
      const members = [a, b].map((z) =>
        out.instances.filter(
          (m) =>
            m.zoneId === z.id &&
            m.role === "rafter" &&
            Math.abs(cross(ea.a, ea.b, { x: m.end[0], y: m.end[2] })) / length < tolerance &&
            station({ x: m.end[0], y: m.end[2] }) >= lo - tolerance &&
            station({ x: m.end[0], y: m.end[2] }) <= hi + tolerance,
        ),
      );
      if (
        members.some((ms) => !ms.length) ||
        members.some((ms, k) =>
          ms.some(
            (m) =>
              ![a, b][k].rafterSupports?.some(
                (s) =>
                  s.rafterId === m.id &&
                  s.end === "high" &&
                  s.mode === "wallBearing" &&
                  s.wallId &&
                  s.status !== "fail",
              ),
          ),
        )
      )
        continue;
      const id = `RIDGE-CUT-${b.id}-${a.id}`,
        cutIds = [];
      for (const board of members.flat()) {
        const dir = board.end.map((v, k) => (v - board.start[k]) / board.length),
          horizontal = Math.hypot(dir[0], dir[2]),
          normal = [dir[0] / horizontal, 0, dir[2] / horizontal],
          raw = board.crossAxis ?? [1, 0, 0],
          projection = dot(raw, dir),
          width = raw.map((v, k) => v - projection * dir[k]),
          magnitude = Math.hypot(...width),
          x = width.map((v) => v / magnitude),
          z = cross3(x, dir),
          ratio = dot(z, normal) / dot(dir, normal),
          angle = (Math.atan(Math.abs(ratio)) * 180) / Math.PI;
        board.cutEnd = {
          scheme: "miter",
          angle,
          plane: "depth",
          cutWidthMM: board.h,
          tiltSign: Math.sign(ratio) || 1,
        };
        const allowance = (cut) =>
          cut?.scheme === "miter"
            ? ((cut.cutWidthMM ?? board.h) / 2000) * Math.tan((Math.abs(cut.angle ?? 0) * Math.PI) / 180)
            : 0;
        board.cutLength = board.length + allowance(board.cutStart) + allowance(board.cutEnd);
        board.rafterJointId = id;
        board.endCutPlane = { point: [...board.end], normal };
        cutIds.push(board.id);
      }
      out.rafterJoints.push({
        id,
        type: "supportedRidge",
        zoneIds: [b.id, a.id],
        start: [ea.a.x + u.x * lo, highA, ea.a.y + u.y * lo],
        end: [ea.a.x + u.x * hi, highA, ea.a.y + u.y * hi],
        boardIds: cutIds,
        cutType: "vertical_plumb_miter",
        connectionVerified: false,
      });
      out.checks.push({
        id: id + "-geometry",
        label: "Общий поддержанный конёк: вертикальные торцы стропил",
        status: "pass",
        note: "Встречные стропила обрезаны в общей вертикальной плоскости по реальному базису доски. Силовое соединение, опорный запил и анкеры этим не подтверждаются.",
      });
    }
}

export function calculateRoofZones(
  p,
  baseResult,
  { autoOrient = true, roofExtraDeadByZone = {}, ceilingExtraDeadByZone = {} } = {},
) {
  if (p.roof?.sourceModel !== undefined) return calculateSourceRoof(p);
  const r = baseResult ?? {},
    geometry = r.geometry ?? {},
    levels = (geometry.levels ?? []).filter((l) => l.closed && l.polygon?.length >= 3),
    platform = r.timber?.platformHeight ?? (sec(p.floor?.section)?.h ?? 250) / 1000 + 0.035;
  const levelTop = (l) => (finite(l.topY) ? l.topY : l.elevation + l.height);
  const fallbackEave = 0.72 + (p.floors ?? 1) * ((p.height ?? 2.8) + platform),
    last = levels.at(-1),
    defaultEave = last ? levelTop(last) : fallbackEave;
  const building = geometry.roofPolygon ?? last?.polygon ?? geometry.polygon ?? [];
  const out = {
      zones: [],
      instances: [],
      surfaces: [],
      ridges: [],
      valleys: [],
      area: 0,
      projectedArea: 0,
      snowEffectiveArea: 0,
      gableArea: 0,
      mass: 0,
      volume: 0,
      checks: [],
      warnings: [],
      assumptions: [],
      sources: [
        ...trussSources,
        {
          title: "СП 20.13330.2016 · Нагрузки и воздействия (снег — прил. Б, ветер — прил. В)",
          url: "https://mchs.gov.ru/uploads/document/2025-04-18/8816d4293b285b2e72e149f6cea13cf2.pdf",
        },
      ],
      status: "unverified",
      complete: true,
    },
    closures = [];
  if (p.roof?.type === "none") return out;
  let requested;
  if (p.roof?.zones !== undefined && !Array.isArray(p.roof.zones)) {
    out.status = "fail";
    out.complete = false;
    out.warnings.push("roof.zones должен быть массивом зон.");
    out.checks.push({
      id: "roof-zones-input",
      label: "Данные зон кровли",
      status: "fail",
      note: out.warnings[0],
    });
    return out;
  }
  if (Array.isArray(p.roof?.zones)) requested = p.roof.zones;
  else if (levels.length) {
    requested = [];
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      requested.push(
        ...autoRoofZones(l.polygon, {
          ...p.roof,
          elevation: null,
          idPrefix: `roof-level-${l.index ?? i}`,
          levelIndex: l.index ?? i,
          excludePolygons: levels.slice(i + 1).map((l) => l.polygon),
        }),
      );
    }
  } else requested = autoRoofZones(building, p.roof ?? {});
  if (requested.length > 100) {
    out.status = "fail";
    out.complete = false;
    out.warnings.push("Поддерживается не более 100 зон кровли.");
    out.checks.push({
      id: "roof-zones-limit",
      label: "Количество зон кровли",
      status: "fail",
      note: out.warnings[0],
    });
    return out;
  }
  const density = p.material?.density ?? 500,
    E = p.material?.E ?? 10000,
    profile = loadProfile(p.loads),
    factors = loadFactors(p.loads),
    // S = ce·ct·Sg, multiplied by µ of each slope (СП 20.13330.2016 п. 10.1).
    snowBase = snowBasis(p.loads).base,
    // Roof members carry layers (γf 1,2) and own timber (1,1) through one γG:
    // the larger value keeps the member checks on the safe side.
    gammaG = factors.equivalentG,
    gammaQ = factors.snow;
  const add = (zone, role, b, h, a, z, extra = {}) => {
    const length = Math.hypot(...z.map((v, i) => v - a[i]));
    if (length < EPS) return;
    const volume = (b * h * length) / 1e6,
      mass = volume * density,
      item = {
        id: `${zone.id}-B${String(out.instances.length + 1).padStart(4, "0")}`,
        name:
          role === "web"
            ? "Решётка фермы"
            : role === "bottom"
              ? "Нижний пояс фермы"
              : "Верхний пояс / стропило",
        category: "roof",
        role,
        b,
        h,
        section: `${b} × ${h}`,
        length,
        volume,
        mass,
        start: a,
        end: z,
        crossAxis: [
          Math.cos((zone.ridgeAngle * Math.PI) / 180),
          0,
          Math.sin((zone.ridgeAngle * Math.PI) / 180),
        ],
        zoneId: zone.id,
        level: zone.levelIndex,
        floor: zone.levelIndex,
        cutStart: { scheme: "butt", angle: 0 },
        cutEnd: { scheme: "butt", angle: 0 },
        ...extra,
      };
    item.cutLength =
      item.length +
      [item.cutStart, item.cutEnd].reduce(
        (s, c) =>
          s +
          (c?.scheme === "miter"
            ? ((c.cutWidthMM ?? item.h) / 2000) * Math.tan((Math.abs(c.angle ?? 0) * Math.PI) / 180)
            : 0),
        0,
      );
    if (finite(item.shapeCutLength)) item.cutLength = item.shapeCutLength;
    out.instances.push(item);
  };
  for (let zi = 0; zi < requested.length; zi++) {
    const input = requested[zi];
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      out.complete = false;
      out.warnings.push(`Зона ${zi + 1}: требуется объект параметров.`);
      out.checks.push({ id: `roof-zone-${zi}-input`, label: `Зона ${zi + 1}: данные`, status: "fail" });
      continue;
    }
    const z = {
      snowMu: p.roof?.snowMu,
      framing: p.roof?.framing ?? "auto",
      deflectionRatio: p.roof?.deflectionRatio ?? 300,
      shape: p.roof?.type === "mono" ? "mono" : "gable",
      ridgeAngle: 0,
      pitchLeft: p.roof?.pitch ?? 25,
      pitchRight: p.roof?.pitch ?? 25,
      trussType: p.roof?.type ?? "fink",
      spacing: p.roof?.spacing ?? 0.6,
      chordSection: p.roof?.chordSection ?? "50x150",
      webSection: p.roof?.webSection ?? "50x100",
      ...input,
      id: input.id ?? `roof-zone-${zi + 1}`,
      warnings: [],
    };
    const surfaceStart = out.surfaces.length,
      instanceStart = out.instances.length;
    try {
      if (
        !Array.isArray(z.polygon) ||
        z.polygon.length < 3 ||
        z.polygon.length > 200 ||
        z.polygon.some((q) => !q || typeof q !== "object" || !finite(q.x) || !finite(q.y))
      )
        throw Error("Нужен полигон от 3 до 200 точек с конечными координатами.");
      if (typeof z.id !== "string" || !z.id || out.zones.some((q) => q.id === z.id))
        throw Error("ID зоны должен быть непустой уникальной строкой.");
      z.polygon = clean(z.polygon);
      if (area(z.polygon) < 0.01) throw Error("Площадь зоны слишком мала.");
      if (!["gable", "mono", "hip"].includes(z.shape)) throw Error("Неизвестная форма кровли.");
      if (z.snowMu !== undefined && (!finite(z.snowMu) || z.snowMu < 0 || z.snowMu > 3))
        throw Error("snowMu: конечный коэффициент снега от0 до3.");
      z.snowCoefficients = {
        method: z.snowMu === undefined ? profile.id : "manual",
        clause: profile.snow.clause,
        left: snowMu(z, z.pitchLeft, profile),
        right: snowMu(z, z.pitchRight, profile),
      };
      if (!["auto", "rafters", "truss", "tiedRafters"].includes(z.framing))
        throw Error("Несущая схема: auto, rafters, truss или tiedRafters.");
      if (!finite(z.deflectionRatio) || z.deflectionRatio < 150 || z.deflectionRatio > 600)
        throw Error("Предел прогиба: L/150…L/600.");
      if (z.framing === "rafters" && z.shape !== "mono")
        throw Error("Стропильная балочная схема пока поддерживает только односкатную кровлю.");
      if (
        !finite(z.ridgeAngle) ||
        ![z.pitchLeft, z.pitchRight].every((v) => finite(v) && v >= 2 && v <= 60) ||
        !finite(z.spacing) ||
        z.spacing < 0.2 ||
        z.spacing > 3
      )
        throw Error("Задайте уклоны 2…60°, конечный азимут и шаг 0,2…3 м.");
      if (
        z.elevation !== null &&
        z.elevation !== undefined &&
        (!finite(z.elevation) || z.elevation < 0 || z.elevation > 100)
      )
        throw Error("Высота зоны должна быть конечной положительной отметкой.");
      let chord = sec(z.chordSection);
      const web = sec(z.webSection);
      if (!chord || !web || chord.b < 15 || chord.h < chord.b || web.b < 15 || web.h < web.b)
        throw Error("Некорректное сечение доски.");
      const designated = levels.find((l) => l.index === z.levelIndex);
      const extraDead = roofExtraDeadByZone[z.id] ?? 0;
      if (!finite(extraDead) || extraDead < 0)
        throw Error("Добавочный вес кровельных досок должен быть конечным и неотрицательным.");
      z.extraRoofDead = extraDead;
      z.eave = z.elevation ?? (designated ? levelTop(designated) : defaultEave);
      const level = designated ?? levels.find((l) => Math.abs(levelTop(l) - z.eave) < 0.01),
        allowed = level?.polygon ?? building;
      z.levelIndex = level?.index ?? z.levelIndex ?? last?.index ?? 1;
      if (allowed.length && !contained(z.polygon, allowed))
        throw Error(
          "Зона выходит за контур своего этажа или перекрывает внешний вырез. Разделите её по реальным крыльям дома.",
        );
      for (const q of out.zones) {
        const overlappingArea = overlapArea(z.polygon, q.polygon);
        if (overlappingArea > 1e-5)
          throw Error(
            `Зона перекрывает ${q.name ?? q.id} на ${overlappingArea.toFixed(2)} м². Перекрытие не учитывается повторно; разделите полигоны.`,
          );
      }
      const theta = (z.ridgeAngle * Math.PI) / 180,
        c = Math.cos(theta),
        s = Math.sin(theta),
        toLocal = (q) => ({ x: q.x * c + q.y * s, y: -q.x * s + q.y * c }),
        toWorld = (u, v, h) => [u * c - v * s, z.eave + (z.rafterAxisLift ?? 0) + h, u * s + v * c];
      const poly = z.polygon.map(toLocal),
        u0 = Math.min(...poly.map((q) => q.x)),
        u1 = Math.max(...poly.map((q) => q.x)),
        v0 = Math.min(...poly.map((q) => q.y)),
        v1 = Math.max(...poly.map((q) => q.y)),
        S = v1 - v0,
        L = u1 - u0;
      if (S < 0.1 || L < 0.1) throw Error("Нулевая ширина или длина зоны.");
      if (Math.ceil((L - EPS) / z.spacing) > 600)
        throw Error("Слишком много поперечных рам: разделите зону или увеличьте шаг.");
      const tl = Math.tan((z.pitchLeft * Math.PI) / 180),
        tr = Math.tan((z.pitchRight * Math.PI) / 180),
        rise = z.shape === "mono" ? S * tl : (S * tl * tr) / (tl + tr),
        ridgeV = z.shape === "mono" ? v1 : v0 + rise / tl;
      if (
        z.loadSnowFactor !== undefined &&
        (!finite(z.loadSnowFactor) || z.loadSnowFactor < 0 || z.loadSnowFactor > 4)
      )
        throw Error("Множитель снега: 0…4.");
      const overhangs = { low: 0, high: 0, start: 0, end: 0, ...z.overhangs };
      if (
        z.overhangs !== undefined &&
        (!z.overhangs || typeof z.overhangs !== "object" || Array.isArray(z.overhangs))
      )
        throw Error("Свесы задаются объектом low/high/start/end.");
      for (const [key, value] of Object.entries(overhangs))
        if (!["low", "high", "start", "end"].includes(key) || !finite(value) || value < 0 || value > 2)
          throw Error("Каждый независимый свес: конечное число от0 до2м.");
      const hasOverhang = Object.values(overhangs).some((x) => x > EPS),
        rectangle =
          poly.length === 4 &&
          Math.abs(area(poly) - L * S) < 1e-5 &&
          poly.every((q) => (near(q.x, u0) || near(q.x, u1)) && (near(q.y, v0) || near(q.y, v1)));
      if (
        hasOverhang &&
        (!rectangle || !["mono", "gable"].includes(z.shape) || (z.shape === "mono" && z.framing === "truss"))
      )
        throw Error(
          "Свесы поддержаны у прямоугольных mono-стропил и gable-ферм; для других схем требуется отдельная опорная конструкция.",
        );
      const physicalGable = hasOverhang && z.shape === "gable";
      if (physicalGable && Math.abs(z.pitchLeft - z.pitchRight) > 0.001)
        throw Error("Свесы физической двускатной фермы пока требуют одинаковых уклонов слева и справа.");
      if (physicalGable) {
        z.heelClearance = z.heelClearance ?? p.roof?.heelClearance ?? 0.2;
        if (!finite(z.heelClearance) || z.heelClearance < 0 || z.heelClearance > 1)
          throw Error("heelClearance: высота свободного пяточного зазора0…1м.");
        z.heelHeight =
          chord.h / 2000 + chord.h / 2000 / Math.cos((z.pitchLeft * Math.PI) / 180) + z.heelClearance;
        z.physicalTruss = true;
        z.bottomChordAxisY = z.eave + chord.h / 2000;
        z.bottomChordSeatY = z.eave;
        z.bottomChordBottomY = z.eave;
      }
      if ((overhangs.start > EPS || overhangs.end > EPS) && projectAuxDisabled(p))
        throw Error(
          "Для боковых свесов нужна включённая реальная обрешётка auxiliaryTimber: консольные поперечные доски и торцевые доски.",
        );
      const coverPoly = hasOverhang
        ? [
            { x: u0 - overhangs.start, y: v0 - overhangs.low },
            { x: u1 + overhangs.end, y: v0 - overhangs.low },
            { x: u1 + overhangs.end, y: v1 + overhangs.high },
            { x: u0 - overhangs.start, y: v1 + overhangs.high },
          ]
        : poly;
      z.overhangs = overhangs;
      z.overhangBasis = {
        u: [c, s],
        v: [-s, c],
        units: "horizontal metres",
        low: "minV",
        high: "maxV",
        start: "minU",
        end: "maxU",
      };
      z.bearingPolygon = z.polygon.map((q) => ({ ...q }));
      z.bearingArea = area(poly);
      z.area = area(coverPoly);
      z.rise = rise;
      z.crestRatio = (ridgeV - v0) / S;
      z.bounds = { minU: u0, maxU: u1, minV: v0, maxV: v1, length: L, span: S };
      z.bearingBounds = { ...z.bounds };
      z.coverBounds = {
        minU: u0 - overhangs.start,
        maxU: u1 + overhangs.end,
        minV: v0 - overhangs.low,
        maxV: v1 + overhangs.high,
        length: L + overhangs.start + overhangs.end,
        span: S + overhangs.low + overhangs.high,
      };
      z.coverPolygon = coverPoly.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c }));
      const planes =
        z.shape === "mono"
          ? [{ a: 0, b: tl, d: -tl * v0, kind: "left" }]
          : [
              { a: 0, b: tl, d: -tl * v0, kind: "left" },
              { a: 0, b: -tr, d: tr * v1, kind: "right" },
            ];
      if (z.shape === "hip") {
        const th = (tl + tr) / 2;
        planes.push(
          { a: th, b: 0, d: -th * u0, kind: "hip-start" },
          { a: -th, b: 0, d: th * u1, kind: "hip-end" },
        );
        z.warnings.push(
          "Вальмовые скаты сформированы геометрически; накосные стропила, узлы и расчётная решётка не определены.",
        );
        out.complete = false;
      }
      const height = (u, v) => Math.min(...planes.map((p) => p.a * u + p.b * v + p.d));
      const triangles = triangulate(coverPoly);
      z.surfaceArea = 0;
      z.snowEffectiveArea = 0;
      for (let pi = 0; pi < planes.length; pi++)
        for (const triangle of triangles) {
          const plane = planes[pi];
          let part = triangle;
          for (let pj = 0; pj < planes.length && part.length >= 3; pj++)
            if (pi !== pj) {
              const other = planes[pj];
              part = clip(
                part,
                (q) => (other.a - plane.a) * q.x + (other.b - plane.b) * q.y + other.d - plane.d,
              );
            }
          if (part.length < 3 || area(part) < EPS) continue;
          const projected = area(part),
            actual = projected * Math.sqrt(1 + plane.a ** 2 + plane.b ** 2);
          z.surfaceArea += actual;
          z.snowEffectiveArea +=
            projected *
            (z.loadSnowFactor ?? 1) *
            snowMu(z, (Math.atan(Math.hypot(plane.a, plane.b)) * 180) / Math.PI, profile);
          out.surfaces.push({
            id: `${z.id}-S${out.surfaces.length + 1}`,
            zoneId: z.id,
            kind: plane.kind,
            points: part.map((q) => toWorld(q.x, q.y, height(q.x, q.y))),
            area: actual,
            projectedArea: projected,
          });
        }
      let ridgeSegments = [];
      if (z.shape === "hip") {
        const th = (tl + tr) / 2,
          run = rise / th;
        if (L >= 2 * run) {
          ridgeSegments = lineIntervals(
            poly.map((q) => ({ x: q.y, y: q.x })),
            ridgeV,
          )
            .map(([a, b]) => [Math.max(a, u0 + run), Math.min(b, u1 - run)])
            .filter(([a, b]) => b - a > EPS)
            .map(([a, b]) => ({ start: toWorld(a, ridgeV, rise), end: toWorld(b, ridgeV, rise) }));
        } else {
          const u = (u0 + u1) / 2,
            h = (th * L) / 2,
            a = v0 + h / tl,
            b = v1 - h / tr;
          ridgeSegments = lineIntervals(poly, u)
            .map(([lo, hi]) => [Math.max(lo, a), Math.min(hi, b)])
            .filter(([a, b]) => b - a > EPS)
            .map(([a, b]) => ({ start: toWorld(u, a, h), end: toWorld(u, b, h) }));
        }
      } else if (z.shape !== "mono")
        ridgeSegments = lineIntervals(
          poly.map((q) => ({ x: q.y, y: q.x })),
          ridgeV,
        ).map(([a, b]) => ({
          start: toWorld(a, ridgeV, height(a, ridgeV)),
          end: toWorld(b, ridgeV, height(b, ridgeV)),
        }));
      z.ridge = ridgeSegments.length ? { ...ridgeSegments[0], segments: ridgeSegments } : null;
      for (const q of ridgeSegments)
        out.ridges.push({ id: `${z.id}-R${out.ridges.length + 1}`, zoneId: z.id, ...q });
      const n = Math.max(1, Math.ceil((L - EPS) / z.spacing)),
        inset = Math.min(chord.b / 2000, L / 4);
      z.actualSpacing = Math.max((L - 2 * inset) / n, inset + (L - 2 * inset) / (2 * n));
      const rowU = Array.from({ length: n + 1 }, (_, i) => u0 + inset + ((L - 2 * inset) * i) / n),
        widths = rowU.map(
          (u, i) =>
            (i === n ? u1 + overhangs.end : (u + rowU[i + 1]) / 2) -
            (i === 0 ? u0 - overhangs.start : (rowU[i - 1] + u) / 2),
        );
      const ceilingWidths = rowU.map(
        (u, i) => (i === n ? u1 : (u + rowU[i + 1]) / 2) - (i === 0 ? u0 : (rowU[i - 1] + u) / 2),
      );
      if (overhangs.start > EPS) {
        const delta = rowU[0] - (u0 - overhangs.start),
          transfer = (delta * delta) / (2 * (rowU[1] - rowU[0]));
        widths[0] += transfer;
        widths[1] -= transfer;
      }
      if (overhangs.end > EPS) {
        const delta = u1 + overhangs.end - rowU[n],
          transfer = (delta * delta) / (2 * (rowU[n] - rowU[n - 1]));
        widths[n] += transfer;
        widths[n - 1] -= transfer;
      }
      if (widths.some((w) => w <= EPS) || Math.max(...widths) > 3)
        throw Error(
          "Боковой свес требует отдельного удерживающего/несущего решения: недопустимая реакция или грузовая ширина крайних стропил.",
        );
      z.rafterRowLoads = rowU.map((u, row) => ({
        row,
        u,
        tributaryWidth: widths[row],
        loadPath:
          overhangs.start || overhangs.end ? "cantilever-battens-to-two-edge-rafters" : "tributary-strip",
      }));
      z.analysisSpacing = hasOverhang ? Math.max(...widths) : z.actualSpacing;
      if (z.framing === "tiedRafters") {
        if (!rectangle || z.shape !== "gable" || Math.abs(z.pitchLeft - z.pitchRight) > 0.001)
          throw Error(
            "tiedRafters: пока только полная прямоугольная двускатная зона с одинаковыми уклонами.",
          );
        const parameter = (k) => z[k] ?? p.roof?.[k],
          depthAt = (v) => {
            const matches = (p.walls ?? []).filter(
                (w) =>
                  w.kind === "exterior" &&
                  (w.level ?? 1) === z.levelIndex &&
                  Math.abs(toLocal(w.a).y - v) < 1e-5 &&
                  Math.abs(toLocal(w.b).y - v) < 1e-5 &&
                  Math.max(toLocal(w.a).x, toLocal(w.b).x) > u0 + EPS &&
                  Math.min(toLocal(w.a).x, toLocal(w.b).x) < u1 - EPS,
              ),
              depths = [...new Set(matches.map((w) => sec(w.section)?.h).filter(finite))];
            if (depths.length !== 1)
              throw Error(
                "tiedRafters: нужна реальная наружная опорная стена одной толщины на каждом карнизе.",
              );
            return depths[0] / 1000;
          };
        z.ceilingDrop = parameter("ceilingDrop") ?? 0.3;
        z.kneeRun = parameter("kneeRun") ?? 0.8;
        z.collarHeightRatio = parameter("collarHeightRatio") ?? 0.75;
        z.tieSection = parameter("tieSection") ?? z.chordSection;
        z.kneeSection = parameter("kneeSection") ?? z.webSection;
        z.collarSection = parameter("collarSection") ?? z.webSection;
        z.collarConnection = parameter("collarConnection") ?? "inPlane";
        z.collarEndInset = parameter("collarEndInset") ?? 0.025;
        const ceilingInput = z.ceilingDead ?? p.roof?.ceilingDead ?? 0,
          ceilingExtra = ceilingExtraDeadByZone[z.id] ?? 0,
          nonWoodTop = (p.loads?.roofDead ?? 0.5) - (ceilingInput * z.bearingArea) / z.surfaceArea,
          extraTop = extraDead - (ceilingExtra * z.bearingArea) / z.surfaceArea;
        if (
          !finite(ceilingInput) ||
          ceilingInput < 0 ||
          !finite(ceilingExtra) ||
          ceilingExtra < 0 ||
          nonWoodTop < -EPS ||
          extraTop < -1e-6
        )
          throw Error("Полный вес кровли должен включать введённую отдельную потолочную нагрузку.");
        z.ceilingLoadSplit = {
          inputFlat: ceilingInput,
          extraFlat: ceilingExtra,
          flatPressure: ceilingInput + ceilingExtra,
          flatArea: z.bearingArea,
          topPressure: Math.max(0, nonWoodTop + extraTop),
        };
        const params = {
          span: S,
          pitch: z.pitchLeft,
          chordSection: z.chordSection,
          webSection: z.webSection,
          tieSection: z.tieSection,
          kneeSection: z.kneeSection,
          collarSection: z.collarSection,
          collarConnection: z.collarConnection,
          collarEndInset: z.collarEndInset,
          kneeRun: z.kneeRun,
          collarHeightRatio: z.collarHeightRatio,
          ceilingDrop: z.ceilingDrop,
          wallDepthLow: depthAt(v0),
          wallDepthHigh: depthAt(v1),
          overhangLow: overhangs.low,
          overhangHigh: overhangs.high,
          spacing: z.analysisSpacing,
          ceilingSpacing: Math.max(...ceilingWidths),
          roofDead: z.ceilingLoadSplit.topPressure,
          ceilingDead: z.ceilingLoadSplit.flatPressure,
          snow: snowBase * (z.loadSnowFactor ?? 1),
          mu: snowMu(z, z.pitchLeft, profile),
          gammaG,
          gammaQ,
          E,
          Emin: p.material?.Emin,
          Fb: p.material?.Fb ?? 13,
          Ft: p.material?.Ft ?? 8,
          Fc: p.material?.Fc ?? 12,
          Fv: p.material?.Fv ?? 1.5,
          density,
          deflectionRatio: z.deflectionRatio,
        };
        const frame = calculateTiedRafters(params);
        z.frameAnalysis = frame;
        z.analysis = null;
        z.tiedRafters = true;
        delete z.heelHeight;
        z.heelClearanceApplied = false;
        z.physicalTruss = true;
        z.effectiveFraming = "tiedRafters";
        z.effectiveSection = z.selectedSection = z.chordSection;
        z.requestedSection = z.chordSection;
        z.framingReason =
          "Непрерывные стропила EA/EI, нижняя затяжка, верхний ригель и внутренние стойки. Геометрия и соединения проверяются отдельно.";
        z.analysisApplicable = frame.stable;
        z.frameRows = [];
        z.trussRows = z.frameRows;
        z.partialFrames = 0;
        out.checks.push(...frame.checks.map((q) => ({ ...q, id: z.id + "-" + q.id, zoneId: z.id })));
        if (unbalancedSnow(z.pitchLeft, z.pitchRight, { override: z.snowMu, profile }))
          out.checks.push({
            id: `${z.id}-snow-unbalanced`,
            zoneId: z.id,
            label: `${z.name ?? z.id}: несимметричный снег стропильной рамы`,
            status: "unverified",
            note: "СП 20.13330.2016 прил. Б.2, вариант 2 (0,75µ / 1,25µ) для рамы с затяжкой не рассчитан: решатель стропильной рамы принимает один µ на оба ската. Рассчитан только равномерный вариант.",
          });
        out.sources.push(...frame.sources);
        if (!frame.stable) throw Error(frame.errors.join("; "));
        z.roofSurfaceLift = frame.geometry.roofSurfaceLift;
        z.bottomChordAxisY = z.eave + frame.geometry.bottomAxis;
        z.bottomChordSeatY = z.eave;
        z.bottomChordBottomY = z.eave;
        z.ceilingDatumY = z.eave - z.ceilingDrop;
        z.ceilingInsulationTopY = z.ceilingDatumY + 0.2;
        z.tieTaperLength = frame.geometry.tieTaperLength;
        z.frameSupportBounds = {
          minV: v0 + frame.geometry.bearingX[0],
          maxV: v0 + frame.geometry.bearingX[1],
        };
        const ceilingAssembly = p.envelope?.assemblies?.find(
            (a) => a.id === "ceiling" || a.appliesTo === "ceiling",
          ),
          serviceIndex = ceilingAssembly?.layers?.findIndex((l) => l.id === "service");
        if (serviceIndex >= 0) {
          z.finishedCeilingY =
            z.ceilingDatumY - sum(ceilingAssembly.layers.slice(0, serviceIndex + 1).map((l) => l.thickness));
          z.finishedCeilingBasis = "Actual envelope layers through ceiling service/batten layer.";
        }
        for (const surface of out.surfaces.filter((q) => q.zoneId === z.id))
          for (const point of surface.points) point[1] += z.roofSurfaceLift;
        for (const segment of out.ridges.filter((q) => q.zoneId === z.id)) {
          segment.start[1] += z.roofSurfaceLift;
          segment.end[1] += z.roofSurfaceLift;
        }
        for (let row = 0; row <= n; row++) {
          const u = rowU[row],
            rowFrame = calculateTiedRafters({
              ...params,
              spacing: widths[row],
              ceilingSpacing: ceilingWidths[row],
            });
          if (!rowFrame.stable) throw Error(rowFrame.errors.join("; "));
          for (const board of rowFrame.boards) {
            const memberU = u + (board.outOfPlaneOffset ?? 0),
              a = toWorld(memberU, v0 + board.start.x, board.start.y),
              b = toWorld(memberU, v0 + board.end.x, board.end.y),
              side = board.id === "RAFTER-LOW" ? "LOW" : board.id === "RAFTER-HIGH" ? "HIGH" : undefined,
              high = side === "HIGH",
              bearing = side ? frame.geometry.bearingX[high ? 1 : 0] : null,
              member = rowFrame.members.find((m) => m.id === board.id);
            add(z, board.role, board.b, board.h, a, b, {
              name:
                board.role === "topChord"
                  ? "Непрерывное стропило с опорным запилом"
                  : board.role === "bottomChord"
                    ? "Нижняя затяжка стропильной рамы"
                    : board.role === "kneePost"
                      ? "Внутренняя стойка стропильной рамы"
                      : "Верхний ригель стропильной рамы",
              physicalTruss: true,
              tiedRafters: true,
              trussRow: row,
              frameRow: row,
              frameMemberId: board.id,
              frameElementIds: member?.elementIds,
              shape: board.shape,
              shapeNetVolume: board.shapeNetVolume,
              shapeGrossVolume: board.shapeGrossVolume,
              shapeCutLength: board.shapeCutLength,
              volume: board.volume,
              mass: board.mass,
              massCenter: toWorld(memberU, v0 + board.massCenter.x, board.massCenter.y),
              collarConnection: board.collarConnection,
              outOfPlaneOffset: board.outOfPlaneOffset,
              connectionIds: board.connectionIds,
              cutStart: board.cutStart,
              cutEnd: board.cutEnd,
              crossAxis: [board.widthSign * c, 0, board.widthSign * s],
              requireSingleStock: true,
              connectionVerified: false,
              auxiliaryFaceId: side ? z.id + "-" + side : undefined,
              bearingStart: side
                ? toWorld(
                    u,
                    v0 + bearing,
                    chord.h / 2000 / Math.cos((z.pitchLeft * Math.PI) / 180) +
                      Math.tan((z.pitchLeft * Math.PI) / 180) * Math.min(bearing, S - bearing),
                  )
                : undefined,
              bearingEnd: side
                ? toWorld(u, ridgeV, chord.h / 2000 / Math.cos((z.pitchLeft * Math.PI) / 180) + rise)
                : undefined,
              startCutPlane: side ? { point: a, normal: [-s, 0, c] } : undefined,
              endCutPlane: side ? { point: b, normal: [-s, 0, c] } : undefined,
              rafterJointId: side ? z.id + "-RIDGE" : undefined,
            });
          }
          const lapConnections = (rowFrame.connections ?? []).map((q) => ({
            ...q,
            row,
            zoneId: z.id,
            worldContactPolygon: (q.contactPolygonXY ?? []).map((pt) =>
              toWorld(u + chord.b / 2000, v0 + pt.x, pt.y),
            ),
            worldContactNormal: [c, 0, s],
            worldContactPlaneU: u + chord.b / 2000,
            memberSourceBoardIds: q.members
              .map(
                (id) =>
                  out.instances.find((b) => b.zoneId === z.id && b.trussRow === row && b.frameMemberId === id)
                    ?.id,
              )
              .filter(Boolean),
          }));
          const reactions = rowFrame.design.reactions,
            service = rowFrame.service.reactions,
            A = reactions.find((r) => r.node === "BEARING-LOW"),
            B = reactions.find((r) => r.node === "BEARING-HIGH");
          z.frameRows.push({
            row,
            u,
            lapConnections,
            tributaryWidth: widths[row],
            ceilingWidth: ceilingWidths[row],
            bearingStart: toWorld(u, z.frameSupportBounds.minV, 0),
            bearingEnd: toWorld(u, z.frameSupportBounds.maxV, 0),
            reactions,
            serviceReactions: service,
            loads: {
              ...rowFrame.loads,
              totalCharacteristic: sum(Object.values(rowFrame.loads)),
              totalDesign:
                (rowFrame.loads.timber + rowFrame.loads.roofDead + rowFrame.loads.ceilingDead) *
                  params.gammaG +
                rowFrame.loads.snow * params.gammaQ,
            },
            designA: A?.fy,
            designB: B?.fy,
            forceStable: true,
          });
        }
        const world = (U, V) => ({ x: U * c - V * s, y: U * s + V * c }),
          axisLift = chord.h / 2000 / Math.cos((z.pitchLeft * Math.PI) / 180),
          face = (high) => {
            const cu = high
                ? { minU: -u1, maxU: -u0, minV: -v1, maxV: -ridgeV }
                : { minU: u0, maxU: u1, minV: v0, maxV: ridgeV },
              o = {
                low: high ? overhangs.high : overhangs.low,
                high: 0,
                start: high ? overhangs.end : overhangs.start,
                end: high ? overhangs.start : overhangs.end,
              },
              polygon = high
                ? [world(u0, ridgeV), world(u1, ridgeV), world(u1, v1), world(u0, v1)]
                : [world(u0, v0), world(u1, v0), world(u1, ridgeV), world(u0, ridgeV)],
              bounds = { ...cu, length: L, span: S / 2 },
              coverBounds = {
                minU: cu.minU - o.start,
                maxU: cu.maxU + o.end,
                minV: cu.minV - o.low,
                maxV: cu.maxV,
                length: L + o.start + o.end,
                span: S / 2 + o.low,
              };
            return {
              id: z.id + (high ? "-HIGH" : "-LOW"),
              parentZoneId: z.id,
              zoneId: z.id,
              shape: "mono",
              effectiveFraming: "rafters",
              physicalTrussFace: true,
              polygon,
              bearingPolygon: polygon,
              bounds,
              bearingBounds: bounds,
              coverBounds,
              overhangs: o,
              pitchLeft: z.pitchLeft,
              pitchRight: z.pitchLeft,
              ridgeAngle: z.ridgeAngle + (high ? 180 : 0),
              levelIndex: z.levelIndex,
              eave: z.eave + axisLift,
              bearingArea: (L * S) / 2,
              spacing: z.spacing,
              actualSpacing: z.actualSpacing,
              surfaceArea: (coverBounds.length * coverBounds.span) / Math.cos((z.pitchLeft * Math.PI) / 180),
              coverHighJointId: z.id + "-RIDGE",
              coverHighPlane: { point: toWorld(u0, ridgeV, axisLift + rise), normal: [-s, 0, c] },
            };
          };
        z.auxiliaryFaces = [face(false), face(true)];
        out.zones.push(z);
        closures.push({ z, toLocal, height, planes });
        out.area += z.surfaceArea;
        out.projectedArea += z.area;
        out.snowEffectiveArea += z.snowEffectiveArea;
        continue;
      }
      z.requestedSection = z.chordSection;
      z.selectedSection = z.chordSection;
      z.effectiveFraming = z.shape === "hip" ? "geometric" : "truss";
      z.framingReason =
        z.shape === "hip"
          ? "Вальмовая геометрия без расчётной пространственной схемы."
          : "Для двускатной зоны выбрана схема ферм.";
      z.rafterAnalysis = null;
      if (z.shape === "mono") {
        const params = {
          horizontalSpan: S,
          pitch: z.pitchLeft,
          b: chord.b,
          h: chord.h,
          spacing: z.analysisSpacing,
          overhangLow: overhangs.low,
          overhangHigh: overhangs.high,
          roofDead: (p.loads?.roofDead ?? 0.5) + extraDead,
          snow: snowBase * (z.loadSnowFactor ?? 1),
          mu: snowMu(z, z.pitchLeft, profile),
          gammaG,
          gammaQ,
          E,
          Fb: p.material?.Fb ?? 13,
          Fv: p.material?.Fv ?? 1.5,
          Ft: p.material?.Ft ?? 8,
          Fc: p.material?.Fc ?? 12,
          density,
          deflectionRatio: z.deflectionRatio,
        };
        const requestedAnalysis = calculateRafter(params);
        const candidates = [
          { id: z.chordSection, b: chord.b, h: chord.h },
          ...timberSections
            .filter((q) => q.category === "board" && q.b === chord.b && q.h > chord.h && q.h <= 250)
            .sort((a, b) => a.h - b.h),
        ];
        let chosen = null;
        if (z.framing === "auto")
          for (const candidate of candidates) {
            const analysis = calculateRafter({ ...params, b: candidate.b, h: candidate.h }),
              cutAllowance = hasOverhang ? (candidate.h / 1000) * Math.tan((z.pitchLeft * Math.PI) / 180) : 0;
            if (analysis.status !== "fail" && analysis.slopeLength + cutAllowance <= 6 + EPS) {
              chosen = { candidate, analysis };
              break;
            }
          }
        if (z.framing === "rafters" || chosen) {
          z.effectiveFraming = "rafters";
          z.rafterAnalysis = chosen?.analysis ?? requestedAnalysis;
          if (chosen) {
            z.selectedSection = chosen.candidate.id;
            chord = { b: chosen.candidate.b, h: chosen.candidate.h };
          }
          z.framingReason =
            z.framing === "rafters"
              ? "Стропильные балки выбраны вручную; превышения выбранного сечения показаны в проверках."
              : z.selectedSection === z.chordSection
                ? "Стропильная балка проходит частные проверки при заданных нагрузках и шаге."
                : `Автоподбор: ${z.chordSection.replace("x", " × ")} мм недостаточно; выбрано ${z.selectedSection.replace("x", " × ")} мм по изгибу, сдвигу и прогибу.`;
          if (z.rafterAnalysis.slopeLength > 6 + EPS) {
            z.warnings.push(
              "Стропило длиннее 6 м: наращивание без промежуточной опоры и расчёта стыка не подтверждено.",
            );
            out.checks.push({
              id: `${z.id}-rafter-splice`,
              zoneId: z.id,
              label: "Наращивание стропильной балки",
              status: "unverified",
              note: "Физический стык не уменьшает расчётный пролёт.",
            });
            out.complete = false;
          }
        } else {
          z.rafterTrial = requestedAnalysis;
          z.framingReason =
            z.framing === "truss"
              ? "Фермы выбраны вручную."
              : requestedAnalysis.slopeLength > 6 + EPS
                ? "Цельное стропило длиннее 6 м. Авто предлагает ферму; альтернативы — промежуточная опора или рассчитанное наращивание."
                : "В выбранном диапазоне досок стропила не проходят частные проверки. Авто предлагает ферму; можно изменить сечение, шаг или добавить опору.";
        }
        if (hasOverhang && z.effectiveFraming !== "rafters")
          throw Error(
            "С указанными свесами стропильная схема не подобрана; автоматическая подмена фермой без конструкции свесов запрещена.",
          );
      }
      if (z.effectiveFraming === "rafters") {
        z.rafterAxisLift = chord.h / 2000 / Math.cos((z.pitchLeft * Math.PI) / 180);
        for (const surface of out.surfaces.filter((q) => q.zoneId === z.id))
          for (const point of surface.points) point[1] += z.rafterAxisLift;
      }
      z.effectiveSection = z.selectedSection;
      if (physicalGable) {
        const ceilingInput = z.ceilingDead ?? p.roof?.ceilingDead ?? 0,
          ceilingExtra = ceilingExtraDeadByZone[z.id] ?? 0;
        if (
          !finite(ceilingInput) ||
          ceilingInput < 0 ||
          ceilingInput > 5 ||
          !finite(ceilingExtra) ||
          ceilingExtra < 0
        )
          throw Error("Invalid flat ceiling load.");
        const flat = ceilingInput + ceilingExtra,
          converted = (flat * z.bearingArea) / z.surfaceArea,
          nonWoodTop = (p.loads?.roofDead ?? 0.5) - (ceilingInput * z.bearingArea) / z.surfaceArea,
          extraTop = extraDead - (ceilingExtra * z.bearingArea) / z.surfaceArea,
          top = nonWoodTop + extraTop;
        if (nonWoodTop < -EPS || extraTop < -1e-6)
          throw Error("Total roof dead pressure does not include the requested flat ceiling load.");
        z.ceilingLoadSplit = {
          inputFlat: ceilingInput,
          extraFlat: ceilingExtra,
          flatPressure: flat,
          flatArea: z.bearingArea,
          convertedToRoof: converted,
          topPressure: Math.max(0, top),
          totalRoofDeadInput: (p.loads?.roofDead ?? 0.5) + extraDead,
        };
      }
      z.analysis =
        z.shape === "hip" || z.effectiveFraming === "rafters"
          ? null
          : buildTruss({
              type:
                z.shape === "mono"
                  ? "mono"
                  : ["king", "queen", "fink"].includes(z.trussType)
                    ? z.trussType
                    : "fink",
              span: S,
              rise,
              crestRatio: z.shape === "mono" ? 0.5 : z.crestRatio,
              chordB: chord.b,
              chordH: chord.h,
              webB: web.b,
              webH: web.h,
              spacing: physicalGable ? z.analysisSpacing : z.actualSpacing,
              heelHeight: physicalGable ? z.heelHeight : 0,
              overhangLow: physicalGable ? overhangs.low : 0,
              overhangHigh: physicalGable ? overhangs.high : 0,
              ceilingDead: physicalGable ? z.ceilingLoadSplit.flatPressure : 0,
              ceilingSpacing: physicalGable ? Math.max(...ceilingWidths) : null,
              roofDead: physicalGable
                ? z.ceilingLoadSplit.topPressure
                : (p.loads?.roofDead ?? 0.5) + extraDead,
              snow: snowBase * (z.loadSnowFactor ?? 1),
              mu: snowMu(z, z.pitchLeft, profile),
              muLeft: snowMu(z, z.pitchLeft, profile),
              muRight: snowMu(z, z.pitchRight, profile),
              gammaG,
              gammaQ,
              // A6: the zone deflection limit, not the builder default L/300.
              deflectionLimit: z.deflectionRatio,
              E,
              tensionDesign: p.material?.Ft ?? 8,
              compressionDesign: p.material?.Fc ?? 12,
              timberDensity: density,
            });
      if (physicalGable && z.analysis?.stable) {
        const topShift =
          chord.h / 2000 + z.heelHeight + chord.h / 2000 / Math.cos((z.pitchLeft * Math.PI) / 180);
        z.roofSurfaceLift = topShift;
        for (const face of out.surfaces.filter((s) => s.zoneId === z.id))
          for (const point of face.points) point[1] += topShift;
        for (const segment of out.ridges.filter((s) => s.zoneId === z.id)) {
          segment.start[1] += topShift;
          segment.end[1] += topShift;
        }
        z.chordAnalysis = checkPhysicalTrussChords(z.analysis, {
          Fb: p.material?.Fb ?? 13,
          Fv: p.material?.Fv ?? 1.5,
          Ft: p.material?.Ft ?? 8,
          Fc: p.material?.Fc ?? 12,
          E,
        });
        out.checks.push(
          ...z.chordAnalysis.checks.map((q) => ({ ...q, id: z.id + "-" + q.id, zoneId: z.id })),
        );
        z.trussRows = [];
      }
      // B2: unbalanced snow (СП 20.13330.2016 прил. Б.2, вариант 2) for gable trusses.
      if (z.shape === "gable" && z.analysis?.stable && z.effectiveFraming === "truss") {
        const unbalanced = unbalancedSnow(z.pitchLeft, z.pitchRight, { override: z.snowMu, profile });
        if (unbalanced) {
          const symmetric = z.analysis,
            cases = unbalanced.cases.map((c) => ({
              ...c,
              analysis: buildTruss({ ...symmetric.input, muLeft: c.muLeft, muRight: c.muRight }),
            }));
          z.analysis = envelopeTruss(symmetric, cases);
          z.analysis.symmetricInput = symmetric.input;
          z.snowCaseSummary = {
            clause: "СП 20.13330.2016 прил. Б.2, вариант 2",
            factors: unbalanced.factors,
            range: unbalanced.range,
            coefficientsVerified: unbalanced.verified,
            cases: z.analysis.snowCases,
            governing: z.analysis.governingSnowCase,
          };
        } else
          z.snowCaseSummary = {
            clause: "СП 20.13330.2016 прил. Б.2, вариант 2",
            governing: "symmetric",
            note: "Уклон вне диапазона варианта 2; принят равномерный снег.",
          };
      }
      z.analysisApplicable =
        rectangle &&
        (z.effectiveFraming === "rafters"
          ? !!z.rafterAnalysis && !z.rafterAnalysis.errors?.length
          : z.shape !== "hip" && z.analysis?.stable === true);
      if (z.effectiveFraming === "truss" && !z.analysis?.stable) {
        z.warnings.push("Расчётная ферма не сформирована; показаны только геометрические стропила.");
        out.complete = false;
      }
      let partialFrames = 0;
      const zoneMemberStart = out.instances.length;
      for (let row = 0; row <= n; row++) {
        const inset = Math.min(chord.b / 2000, L / 4),
          u = u0 + inset + ((L - 2 * inset) * row) / n,
          intervals = lineIntervals(poly, u);
        if (!intervals.length) continue;
        const full = intervals.length === 1 && near(intervals[0][0], v0) && near(intervals[0][1], v1);
        if (!full) partialFrames++;
        if (z.effectiveFraming === "rafters") {
          for (const [a, b] of intervals) {
            const bearingStart = toWorld(u, a, height(u, a)),
              bearingEnd = toWorld(u, b, height(u, b)),
              start = toWorld(u, a - overhangs.low, height(u, a - overhangs.low)),
              end = toWorld(u, b + overhangs.high, height(u, b + overhangs.high)),
              N = [-s, 0, c],
              plumb = { scheme: "miter", angle: z.pitchLeft, plane: "depth", cutWidthMM: chord.h };
            add(z, "rafter", chord.b, chord.h, start, end, {
              name: "Стропильная балка",
              rafterRow: row,
              tributaryWidth: widths[row],
              bearingStart,
              bearingEnd,
              supportStart: bearingStart,
              supportEnd: bearingEnd,
              supportLowStation: overhangs.low / Math.cos((z.pitchLeft * Math.PI) / 180),
              supportHighStation: (overhangs.low + S) / Math.cos((z.pitchLeft * Math.PI) / 180),
              overhangLow: overhangs.low,
              overhangHigh: overhangs.high,
              requireSingleStock: hasOverhang,
              ...(hasOverhang
                ? {
                    cutStart: { ...plumb, tiltSign: -1 },
                    startCutPlane: { point: start, normal: N },
                    cutEnd: { ...plumb, tiltSign: 1 },
                    endCutPlane: { point: end, normal: N },
                  }
                : {}),
              unverified: !full || !z.analysisApplicable,
            });
          }
        } else if (z.shape === "hip" || !z.analysis?.bars?.length) {
          for (const [a, b] of intervals) {
            let values = [a, b, ridgeV];
            for (const plane of planes.filter((p) => Math.abs(p.b) > EPS))
              for (const other of planes.filter((p) => Math.abs(p.b) < EPS))
                values.push((other.a * u + other.d - plane.d) / plane.b);
            values = unique(values.filter((v) => v >= a - EPS && v <= b + EPS));
            for (let j = 1; j < values.length; j++)
              add(
                z,
                "top",
                chord.b,
                chord.h,
                toWorld(u, values[j - 1], height(u, values[j - 1])),
                toWorld(u, values[j], height(u, values[j])),
                { trussRow: row, unverified: true },
              );
            add(z, "bottom", chord.b, chord.h, toWorld(u, a, 0), toWorld(u, b, 0), {
              trussRow: row,
              unverified: true,
            });
          }
        } else if (physicalGable && z.analysis?.stable && full) {
          const rowAnalysis = buildTruss({
              ...z.analysis.input,
              spacing: widths[row],
              ceilingSpacing: ceilingWidths[row],
            }),
            physical = rowAnalysis.physicalReference ?? physicalTrussBoards(rowAnalysis),
            forceMap = new Map(rowAnalysis.bars.map((b) => [b.id, b.force]));
          for (const board of physical) {
            const a = toWorld(u, v0 + board.start.x, board.start.y + chord.h / 2000),
              b = toWorld(u, v0 + board.end.x, board.end.y + chord.h / 2000),
              forces = board.sourceBarIds.map((id) => forceMap.get(id) ?? 0),
              force = forces.reduce((a, b) => (Math.abs(a) > Math.abs(b) ? a : b), 0),
              side = board.side,
              faceId = side ? z.id + (side === "low" ? "-LOW" : "-HIGH") : undefined,
              crossAxis = side === "high" ? [-c, 0, -s] : [c, 0, s],
              bearingStart = board.bearingStart
                ? toWorld(u, v0 + board.bearingStart.x, board.bearingStart.y + chord.h / 2000)
                : undefined,
              bearingEnd = board.bearingEnd
                ? toWorld(u, v0 + board.bearingEnd.x, board.bearingEnd.y + chord.h / 2000)
                : undefined;
            add(z, board.role, board.b, board.h, a, b, {
              name:
                board.role === "bottomChord"
                  ? "Неразрезной нижний пояс фермы"
                  : board.role === "topChord"
                    ? "Неразрезной верхний пояс и хвост свеса"
                    : "Решётка / пятка фермы",
              physicalTruss: true,
              trussRow: row,
              trussPhysicalId: board.id,
              trussBarIds: board.sourceBarIds,
              trussBarId: board.sourceBarIds.length === 1 ? board.sourceBarIds[0] : undefined,
              force,
              axialForceEnvelope: { min: Math.min(...forces), max: Math.max(...forces) },
              volume: board.volume,
              mass: board.mass,
              shape: board.shape,
              shapeNetVolume: board.shapeNetVolume,
              shapeGrossVolume: board.shapeGrossVolume,
              shapeCutLength: board.shapeCutLength,
              cutStart: board.cutStart,
              cutEnd: board.cutEnd,
              crossAxis,
              requireSingleStock: true,
              auxiliaryFaceId: faceId,
              bearingStart,
              bearingEnd,
              side,
              rafterJointId: side ? z.id + "-RIDGE" : undefined,
              startCutPlane: side ? { point: a, normal: [-s, 0, c] } : undefined,
              endCutPlane: side ? { point: b, normal: [-s, 0, c] } : undefined,
              connectionVerified: false,
              unverified: false,
            });
          }
          const A = toWorld(u, v0, 0),
            B = toWorld(u, v1, 0);
          z.trussRows.push({
            row,
            u,
            tributaryWidth: widths[row],
            ceilingWidth: ceilingWidths[row],
            bearingStart: A,
            bearingEnd: B,
            axisStart: toWorld(u, v0, chord.h / 2000),
            axisEnd: toWorld(u, v1, chord.h / 2000),
            reactions: rowAnalysis.reactions,
            loads: {
              totalCharacteristic: rowAnalysis.loads.totalCharacteristic,
              totalDesign: rowAnalysis.loads.totalDesign,
              snow: rowAnalysis.loads.snow,
              roofDead: rowAnalysis.loads.roofDead,
              ceilingDead: rowAnalysis.loads.ceilingDead,
              timber: rowAnalysis.loads.timber,
            },
            forceStable: rowAnalysis.stable,
          });
        } else {
          const map = new Map(z.analysis.nodes.map((q) => [q.id, q]));
          for (const bar of z.analysis.bars) {
            const a = map.get(bar.nodeA),
              b = map.get(bar.nodeB),
              va = v0 + a.x,
              vb = v0 + b.x;
            for (const [lo, hi] of intervals) {
              let t0 = 0,
                t1 = 1;
              if (Math.abs(vb - va) < EPS) {
                if (va < lo - EPS || va > hi + EPS) continue;
              } else {
                const ta = (lo - va) / (vb - va),
                  tb = (hi - va) / (vb - va);
                t0 = Math.max(0, Math.min(ta, tb));
                t1 = Math.min(1, Math.max(ta, tb));
                if (t1 - t0 < EPS) continue;
              }
              const point = (t) => toWorld(u, va + (vb - va) * t, a.y + (b.y - a.y) * t);
              add(z, bar.role, bar.b, bar.h, point(t0), point(t1), {
                trussRow: row,
                trussBarId: bar.id,
                clipped: t0 > EPS || t1 < 1 - EPS,
                force: full && z.analysisApplicable ? bar.force : null,
                unverified: !full || !z.analysisApplicable,
              });
            }
          }
        }
      }
      if (physicalGable && z.analysis?.stable) {
        const world = (U, V) => ({ x: U * c - V * s, y: U * s + V * c }),
          face = (side) => {
            const high = side === "high",
              angle = z.ridgeAngle + (high ? 180 : 0),
              cu = high
                ? { minU: -u1, maxU: -u0, minV: -v1, maxV: -ridgeV }
                : { minU: u0, maxU: u1, minV: v0, maxV: ridgeV },
              o = {
                low: high ? overhangs.high : overhangs.low,
                high: 0,
                start: high ? overhangs.end : overhangs.start,
                end: high ? overhangs.start : overhangs.end,
              },
              polygon = high
                ? [world(u0, ridgeV), world(u1, ridgeV), world(u1, v1), world(u0, v1)]
                : [world(u0, v0), world(u1, v0), world(u1, ridgeV), world(u0, ridgeV)],
              bounds = { ...cu, length: cu.maxU - cu.minU, span: cu.maxV - cu.minV },
              coverBounds = {
                minU: cu.minU - o.start,
                maxU: cu.maxU + o.end,
                minV: cu.minV - o.low,
                maxV: cu.maxV,
                length: bounds.length + o.start + o.end,
                span: bounds.span + o.low,
              },
              apex = toWorld(u0, ridgeV, chord.h / 2000 + z.heelHeight + rise);
            return {
              id: z.id + (high ? "-HIGH" : "-LOW"),
              parentZoneId: z.id,
              zoneId: z.id,
              name: z.name,
              shape: "mono",
              effectiveFraming: "rafters",
              physicalTrussFace: true,
              polygon,
              bearingPolygon: polygon,
              bounds,
              bearingBounds: bounds,
              coverBounds,
              overhangs: o,
              pitchLeft: high ? z.pitchRight : z.pitchLeft,
              pitchRight: high ? z.pitchRight : z.pitchLeft,
              ridgeAngle: angle,
              levelIndex: z.levelIndex,
              eave: z.eave + chord.h / 2000 + z.heelHeight,
              bearingArea: bounds.length * bounds.span,
              actualSpacing: z.actualSpacing,
              spacing: z.spacing,
              surfaceArea: (coverBounds.length * coverBounds.span) / Math.cos((z.pitchLeft * Math.PI) / 180),
              coverHighJointId: z.id + "-RIDGE",
              coverHighPlane: { point: apex, normal: [-s, 0, c] },
            };
          };
        z.auxiliaryFaces = [face("low"), face("high")];
        const stock = out.instances.slice(zoneMemberStart).filter((b) => b.cutLength > 6 + EPS);
        out.checks.push({
          id: z.id + "-physical-stock",
          zoneId: z.id,
          label: "Цельные пояса и детали фермы до6м",
          status: stock.length ? "fail" : "pass",
          value: stock.length,
          limit: 0,
          memberIds: stock.map((b) => b.id),
          note: "FEM-панели не являются физическими стыками. Пояс длиннее6м не разрезается на неподдержанные части автоматически.",
        });
        if (stock.length) out.complete = false;
        out.checks.push({
          id: z.id + "-raised-heel-joints",
          zoneId: z.id,
          label: "Поднятая пятка и узлы фермы",
          status: "unverified",
          note: "Нижняя грань цельного нижнего пояса совпадает с верхом стены. Поднятая пятка имеет реальные стойки/раскосы и нетто-профили; пластины, смятие, эксцентриситет, податливость и раскрепление не подтверждены.",
        });
      }
      if (z.effectiveFraming === "rafters")
        out.checks.push(
          ...(z.rafterAnalysis?.checks ?? []).map((q) => ({ ...q, id: `${z.id}-${q.id}`, zoneId: z.id })),
        );
      z.partialFrames = partialFrames;
      if (partialFrames) {
        z.analysisApplicable = false;
        z.warnings.push(
          "Часть элементов обрезана по контуру. Их узлы и опирание требуют отдельной схемы; типовой расчёт к ним не применяется.",
        );
        out.complete = false;
      }
      if (!rectangle)
        z.warnings.push(
          "Косой или непрямоугольный контур: скаты и доски ограничены полигоном, кромки и пространственная схема не рассчитаны.",
        );
      if (z.analysisApplicable && z.analysis)
        out.checks.push(...z.analysis.checks.map((q) => ({ ...q, id: `${z.id}-${q.id}`, zoneId: z.id })));
      if (z.analysisApplicable && z.snowCaseSummary) {
        const sc = z.snowCaseSummary,
          gov = sc.cases?.find((c) => c.id === sc.governing),
          names = {
            symmetric: "равномерный (вариант 1)",
            "unbalanced-left": "несимметричный, больше на левом скате",
            "unbalanced-right": "несимметричный, больше на правом скате",
          };
        out.checks.push({
          id: `${z.id}-snow-cases`,
          zoneId: z.id,
          label: `${z.name ?? z.id}: снег — равномерный и несимметричный варианты`,
          status: sc.cases ? (sc.coefficientsVerified ? "pass" : "warning") : "pass",
          value: gov?.maxBarUtilization ?? null,
          governingCase: sc.governing,
          cases: sc.cases?.map((c) => ({
            id: c.id,
            maxBarUtilization: c.maxBarUtilization,
            governedBars: c.governedBars,
          })),
          note: sc.cases
            ? `${sc.clause}: ${sc.factors.low}µ / ${sc.factors.high}µ при ${sc.range[0]}°…${sc.range[1]}°. Огибающая стержней фермы; определяющий случай — ${names[sc.governing] ?? sc.governing}${gov?.governedBars?.length ? " (стержни " + gov.governedBars.join(", ") + ")" : ""}.${sc.coefficientsVerified ? "" : " Коэффициенты варианта 2 приняты по СНиП 2.01.07-85 и требуют сверки с действующей редакцией СП 20."}`
            : sc.note,
        });
      }
      out.checks.push({
        id: `${z.id}-junctions`,
        label: `${z.name ?? z.id}: примыкания и раскрепление`,
        status: "unverified",
        note: "Опоры, крепление примыканий и связь из плоскости не рассчитаны. Геометрический сток проверяется отдельно.",
      });
      out.zones.push(z);
      closures.push({ z, toLocal, height, planes });
      out.area += z.surfaceArea;
      out.projectedArea += z.area;
      out.snowEffectiveArea += z.snowEffectiveArea;
      out.warnings.push(...z.warnings.map((w) => `${z.name ?? z.id}: ${w}`));
    } catch (error) {
      out.surfaces.splice(surfaceStart);
      out.instances.splice(instanceStart);
      out.warnings.push(`${z.name ?? z.id}: ${error.message}`);
      out.checks.push({
        id: `${z.id}-geometry`,
        label: `${z.name ?? z.id}: геометрия кровли`,
        status: "fail",
        note: error.message,
      });
      out.complete = false;
    }
  }
  for (let i = 0; i < out.zones.length; i++)
    for (let j = 0; j < i; j++) {
      const a = out.zones[i],
        b = out.zones[j];
      if (
        !Object.values(a.overhangs ?? {}).some((v) => v > EPS) &&
        !Object.values(b.overhangs ?? {}).some((v) => v > EPS)
      )
        continue;
      const overlap = overlapArea(a.coverPolygon ?? a.polygon, b.coverPolygon ?? b.polygon);
      if (overlap > 1e-5) {
        out.complete = false;
        out.checks.push({
          id: `${a.id}-${b.id}-cover-overlap`,
          label: "Пересечение зон покрытия со свесами",
          status: "fail",
          value: overlap,
          limit: 0,
          unit: "м²",
          note: "Покрытия со свесами наложились в плане. Каскад над нижним скатом и узел пересечения не поддержаны этой раскладкой.",
        });
      }
    }
  // Vertical roof closures on exterior edges only. Shared zone boundaries are
  // not counted twice as full gables; their structural junction remains unknown.
  for (const data of closures) {
    const { z, toLocal, height, planes } = data;
    z.gableArea = 0;
    for (let i = 0; i < z.polygon.length; i++) {
      const a = z.polygon[i],
        b = z.polygon[(i + 1) % z.polygon.length],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy),
        covered = [];
      for (const other of out.zones)
        if (other !== z)
          for (let j = 0; j < other.polygon.length; j++) {
            const c = other.polygon[j],
              d = other.polygon[(j + 1) % other.polygon.length];
            if (Math.abs(cross(a, b, c)) < EPS && Math.abs(cross(a, b, d)) < EPS) {
              const t0 = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len ** 2,
                t1 = ((d.x - a.x) * dx + (d.y - a.y) * dy) / len ** 2;
              covered.push([Math.max(0, Math.min(t0, t1)), Math.min(1, Math.max(t0, t1))]);
            }
          }
      const qa = toLocal(a),
        qb = toLocal(b),
        times = [0, 1];
      for (let pi = 0; pi < planes.length; pi++)
        for (let pj = pi + 1; pj < planes.length; pj++) {
          const f = (q) =>
              (planes[pi].a - planes[pj].a) * q.x +
              (planes[pi].b - planes[pj].b) * q.y +
              planes[pi].d -
              planes[pj].d,
            fa = f(qa),
            fb = f(qb);
          if (Math.abs(fa - fb) > EPS) {
            const t = fa / (fa - fb);
            if (t > 0 && t < 1) times.push(t);
          }
        }
      for (const [from, to] of subtractIntervals(
        [[0, 1]],
        covered.filter(([a, b]) => b - a > EPS),
      )) {
        const breaks = unique([from, to, ...times.filter((t) => t > from && t < to)]);
        for (let k = 1; k < breaks.length; k++) {
          const q = (t) => ({ x: qa.x + (qb.x - qa.x) * t, y: qa.y + (qb.y - qa.y) * t }),
            q0 = q(breaks[k - 1]),
            q1 = q(breaks[k]);
          z.gableArea +=
            (len *
              (breaks[k] - breaks[k - 1]) *
              (Math.max(0, height(q0.x, q0.y) + (z.roofSurfaceLift ?? 0)) +
                Math.max(0, height(q1.x, q1.y) + (z.roofSurfaceLift ?? 0)))) /
            2;
        }
      }
    }
    out.gableArea += z.gableArea;
  }
  // Shared boundaries are joins, not automatically engineered valleys.
  if (out.zones.length > 1)
    out.warnings.push(
      "Несколько зон: сток, перепады и общие кромки проверяются по скатам. Конструктивное исполнение узлов и пространственная работа требуют отдельного решения.",
    );
  // B3: local drifts at roof steps and valleys (СП 20.13330.2016 прил. Б, схемы Б.4, Б.8)
  // are not modelled; a multi-zone roof states them explicitly instead of passing.
  if (out.zones.length > 1) {
    const eaves = out.zones.map((z) => z.eave).filter(finite),
      step = eaves.length ? Math.max(...eaves) - Math.min(...eaves) : 0;
    out.checks.push({
      id: "snow-drift-roof-steps",
      label: "Снеговые мешки у перепадов высот и в ендовах",
      status: "unverified",
      value: step,
      unit: "м",
      note: `Зон кровли: ${out.zones.length}, перепад карнизов до ${step.toFixed(2)} м. Повышенные µ у перепадов высот (СП 20.13330.2016 прил. Б, схема Б.8) и в ендовах/примыканиях (схема Б.4) не рассчитаны; принят равномерный снег каждой зоны.`,
    });
  }
  out.wallProfiles = deriveWallProfiles(p, r, out);
  const supportBase = { ...r, wallProfiles: out.wallProfiles };
  for (const z of out.zones.filter((z) => z.effectiveFraming === "rafters")) {
    const supports = buildRafterSupports(
      p,
      supportBase,
      z,
      out.instances.filter((b) => b.zoneId === z.id && b.role === "rafter"),
    );
    z.rafterSupports = supports.supports;
    z.supportAssumptions = supports.assumptions;
    for (const b of supports.instances ?? [])
      add(z, b.role, b.b, b.h, b.start, b.end, {
        ...b,
        id: `${z.id}-SUP-${out.instances.length + 1}`,
        zoneId: z.id,
      });
    out.checks.push(...(supports.checks ?? []));
    out.warnings.push(...(supports.warnings ?? []));
    if (supports.checks?.some((c) => c.status === "fail")) out.complete = false;
  }
  supportedRidgeCuts(out);
  const profileAreaGain = out.wallProfiles
    .filter((q) => q.mode === "continuous" && p.walls.find((w) => w.id === q.wallId)?.kind === "exterior")
    .reduce(
      (sum, q) =>
        sum +
        q.topSamples
          .slice(1)
          .reduce(
            (a, b, i) =>
              a + (b.s - q.topSamples[i].s) * ((b.topY + q.topSamples[i].topY) / 2 - q.nominalTopY),
            0,
          ),
      0,
    );
  out.profileAreaGain = profileAreaGain;
  out.unprofiledGableArea = out.gableArea;
  out.gableArea = Math.max(0, out.gableArea - profileAreaGain);
  for (const profile of out.wallProfiles)
    if (profile.mode === "blocked")
      out.checks.push({
        id: `${profile.wallId}-profile`,
        label: "Профиль стены под скатом",
        wallId: profile.wallId,
        status: "fail",
        note: profile.reason,
      });
  out.mass = sum(out.instances.map((b) => b.mass));
  out.volume = sum(out.instances.map((b) => b.volume));
  out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  out.assumptions = [
    "Кровля задана отдельными полигонами зон; габаритный прямоугольник дома не используется как готовая крыша. Автоматическое разбиение ортогонального контура покрывает его точно, без перекрытия крыльев.",
    "Высоты и координаты абсолютные, включая основание 0,72 м и этажные платформы. Автоматически покрываются открытые сверху части закрытых этажей; второй свет не вырезает внешний скат.",
    "Двускатная асимметрия: h=S×tan(αL)×tan(αR)/(tan(αL)+tan(αR)); положение конька h/tan(αL). Односкатная высота S×tan(αL).",
    "Скаты триангулированы и ограничены полигоном. Оси досок клиппируются по действительным поперечным интервалам, наружные вырезы не перекрываются. Длины по осям, рабочие запилы и узлы не назначены.",
    "Форма скатов отделена от несущей схемы. Односкатный режим Авто сначала проверяет стропильные балки и сечения той же толщины до 250 мм; фермы предлагаются при отсутствии подходящего цельного стропила. Ручной выбор сохраняется.",
    "FEM типовой фермы применён только к полным прямоугольным зонам, согласованным с направлением конька. Обрезанные рамы, вальмы, ендовы и пространственная устойчивость не подтверждены.",
    "Возвращаются неразрезные идеальные доски. Закупочные 6 м и физическое наращивание выполняет геометрическое ядро отдельно; стык не создаёт опору и не уменьшает расчётный пролёт.",
    "Вес кровельных слоёв должен считаться по area (фактические скаты), снег по projectedArea. Древесина mass/volume включается в общий вес один раз.",
  ];
  out.assumptions.push(
    ...new Set(
      out.zones.flatMap((z) => [
        ...(z.rafterAnalysis?.assumptions ?? []),
        ...(z.analysis?.assumptions ?? []),
        ...(z.frameAnalysis?.assumptions ?? []),
        ...(z.supportAssumptions ?? []),
      ]),
    ),
  );
  out.assumptions.push(
    "snowMu зоны имеет приоритет над roof.snowMu. Явный коэффициент применяется к проекции всех скатов и свесов, FEM, балочным проверкам и реакциям; без ввода µ принимается по СП 20.13330.2016 прил. Б (1 до 30°, линейно до 0 при 60°), снег S0 = ce·ct·µ·Sg. Для двускатных ферм дополнительно проверяется несимметричный вариант 2; снеговые мешки и сползание не рассчитаны.",
  );
  if (out.zones.some((z) => z.snowMu !== undefined))
    out.sources.push({
      title: "СП20.13330.2016 · Нагрузки и воздействия, опубликовано МЧС",
      url: "https://mchs.gov.ru/uploads/document/2025-04-18/8816d4293b285b2e72e149f6cea13cf2.pdf",
    });
  if (out.zones.some((z) => z.physicalTruss))
    out.assumptions.push(
      "Физические двускатные фермы имеют цельный нижний пояс и цельный верхний пояс каждого ската. FEM-узлы не являются физическими стыками. Нетто-профили решётки, свесы и собственный вес учтены один раз; узлы, ослабленные сечения и пространственное раскрепление не подтверждены. Вертикальные закрытия включают поднятый карнизный пояс.",
    );
  if (out.rafterJoints.length)
    out.assumptions.push(
      "Исключение для запилов: на общей высокой кромке двух противоположных прямоугольных односкатных зон с найденными стеновыми опорами назначены вертикальные торцы стропил. Осевые длины и статическая модель сохранены; заготовка увеличена на припуск h/2·tan(угла). Остальные опорные запилы и крепления требуют рабочего узла.",
    );
  const drainage = calculateRoofDrainage(p, r, out);
  if (autoOrient && p.roof?.zones === undefined && drainage.suggestions?.length) {
    const fixed = orientRoofsAwayFromWalls(p, r, out);
    if (fixed.suggestions?.length && fixed.zones?.length) {
      const corrected = calculateRoofZones({ ...p, roof: { ...p.roof, zones: fixed.zones } }, r, {
        autoOrient: false,
        roofExtraDeadByZone,
        ceilingExtraDeadByZone,
      });
      corrected.autoDrainageAdjusted = true;
      corrected.assumptions.unshift(
        "Автоматические нижние крылья ориентированы односкатно от высоких стен. Ручные зоны меняются только по команде пользователя.",
      );
      return corrected;
    }
  }
  out.drainage = drainage;
  out.valleys = (drainage.junctions ?? []).filter((q) => q.type === "valley");
  out.checks.push(...drainage.checks);
  out.warnings.push(...drainage.warnings);
  out.assumptions.push(...drainage.assumptions);
  out.sources.push({
    title: "AWC · Пролёты и нагрузки стропил",
    url: "https://awc.org/resource-hub/span-table-tutorial/",
  });
  out.sources.push({
    title: "PNNL · Водоотвод и фартуки примыкания кровли к стенам",
    url: "https://basc.pnnl.gov/resource-guides/step-and-kick-out-flashing-roof-wall-intersections",
  });
  if (drainage.checks.some((c) => c.status === "fail")) {
    out.status = "fail";
    out.complete = false;
  }
  return out;
}

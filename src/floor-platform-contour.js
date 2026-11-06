/** Wall axes are immutable. Platform exterior = actual exterior frame face.
 * Pure geometry, m; no frame/connection capacity is inferred from this envelope. */
const EPS = 1e-7,
  dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const parse = (s) => {
  const m = typeof s === "string" && s.replaceAll(" ", "").match(/^(\d+)[x×](\d+)$/);
  return m ? { b: +m[1] / 1000, h: +m[2] / 1000 } : null;
};
const signed = (p) =>
  p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0) / 2;
const area = (p) => Math.abs(signed(p)),
  add = (a, n, d) => ({ x: a.x + n.x * d, y: a.y + n.y * d });
function clean(raw) {
  const p = raw.map((q) => ({ ...q }));
  if (p.length > 1 && dist(p[0], p.at(-1)) < EPS) p.pop();
  if (signed(p) < 0) p.reverse();
  return p;
}
function lineHit(a, u, b, v) {
  const den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((b.x - a.x) * v.y - (b.y - a.y) * v.x) / den;
  return { x: a.x + u.x * t, y: a.y + u.y * t };
}
function outline(segments, offset) {
  const edges = segments.map((s) => ({
    a: add(s.axisStart, s.outwardNormal, offset(s)),
    b: add(s.axisEnd, s.outwardNormal, offset(s)),
    u: s.u,
  }));
  return edges.map((e, i) => {
    const before = edges[(i + edges.length - 1) % edges.length],
      after = edges[(i + 1) % edges.length];
    return {
      start: lineHit(before.a, before.u, e.a, e.u) ?? e.a,
      end: lineHit(e.a, e.u, after.a, after.u) ?? e.b,
    };
  });
}
function bounds(p) {
  const minX = Math.min(...p.map((q) => q.x)),
    maxX = Math.max(...p.map((q) => q.x)),
    minY = Math.min(...p.map((q) => q.y)),
    maxY = Math.max(...p.map((q) => q.y));
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}
function invalidContour(p, segments) {
  if (p.length < 3 || area(p) < EPS || !p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)))
    return true;
  for (const s of segments) {
    const dot = (a, b) => (b.x - a.x) * s.u.x + (b.y - a.y) * s.u.y;
    if (
      dot(s.outerStart, s.outerEnd) <= EPS ||
      dot(s.centerStart, s.centerEnd) <= EPS ||
      dist(s.outerStart, s.axisStart) > Math.max(0.1, s.wallDepth) * 10 ||
      dist(s.outerEnd, s.axisEnd) > Math.max(0.1, s.wallDepth) * 10
    )
      return true;
  }
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < i; j++) {
      if (j === i - 1 || (i === p.length - 1 && j === 0)) continue;
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length],
        u = { x: b.x - a.x, y: b.y - a.y },
        v = { x: d.x - c.x, y: d.y - c.y },
        den = u.x * v.y - u.y * v.x;
      if (Math.abs(den) < EPS) {
        if (Math.abs(cross(a, b, c)) < EPS) {
          const L = Math.hypot(u.x, u.y);
          if (L < EPS) return true;
          const station = (q) => ((q.x - a.x) * u.x + (q.y - a.y) * u.y) / L,
            lo = Math.max(0, Math.min(station(c), station(d))),
            hi = Math.min(L, Math.max(station(c), station(d)));
          if (hi >= lo - EPS) return true;
        }
        continue;
      }
      const t = ((c.x - a.x) * v.y - (c.y - a.y) * v.x) / den,
        q = ((c.x - a.x) * u.y - (c.y - a.y) * u.x) / den;
      if (t >= -EPS && t <= 1 + EPS && q >= -EPS && q <= 1 + EPS) return true;
    }
  return false;
}
export function prepareFloorContours(project, { geometry, walls = project.walls ?? [] } = {}) {
  const rim = parse(project.floor?.rimSection ?? project.floor?.section);
  if (!rim) return [];
  return (geometry?.levels ?? [])
    .filter((l) => l.closed && l.polygon?.length >= 3)
    .map((level) => {
      const axisPolygon = clean(level.polygon),
        exterior = walls.filter(
          (w) => w.kind === "exterior" && (w.level === undefined || w.level === level.index),
        ),
        segments = [],
        warnings = [];
      for (let i = 0; i < axisPolygon.length; i++) {
        const a = axisPolygon[i],
          b = axisPolygon[(i + 1) % axisPolygon.length],
          L = dist(a, b),
          u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L },
          n = { x: u.y, y: -u.x },
          station = (q) => (q.x - a.x) * u.x + (q.y - a.y) * u.y;
        const candidates = exterior.filter(
            (w) => Math.abs(cross(a, b, w.a)) / L < EPS && Math.abs(cross(a, b, w.b)) / L < EPS,
          ),
          cuts = [
            0,
            L,
            ...candidates.flatMap((w) => [station(w.a), station(w.b)]).filter((t) => t > EPS && t < L - EPS),
          ]
            .sort((x, y) => x - y)
            .filter((x, i, s) => !i || x - s[i - 1] > EPS);
        for (let j = 1; j < cuts.length; j++) {
          const mid = (cuts[j - 1] + cuts[j]) / 2,
            w = candidates.find(
              (w) =>
                mid >= Math.min(station(w.a), station(w.b)) - EPS &&
                mid <= Math.max(station(w.a), station(w.b)) + EPS,
            ),
            profile = geometry.wallProfiles?.find(
              (q) => q.wallId === w?.id && q.level === level.index && q.mode === "continuous",
            ),
            section = parse(profile?.section ?? w?.section),
            depth = section?.h ?? rim.b;
          if (!w || !section)
            warnings.push(
              "Для части внешней оси не найдено фактическое сечение каркаса; узел требует уточнения.",
            );
          segments.push({
            id: `FC-L${level.index}-E${segments.length + 1}`,
            wallId: w?.id ?? null,
            level: level.index,
            axisStart: add(a, u, cuts[j - 1]),
            axisEnd: add(a, u, cuts[j]),
            u,
            outwardNormal: n,
            inwardNormal: { x: -n.x, y: -n.y },
            wallDepth: depth,
            rimWidth: rim.b,
            outwardOffset: (depth - rim.b) / 2,
            wallSection: profile?.section ?? w?.section,
            geometryKnown: !!w && !!section,
          });
        }
      }
      const outside = outline(segments, (s) => s.wallDepth / 2),
        centers = outline(segments, (s) => s.outwardOffset),
        inside = outline(segments, (s) => -s.wallDepth / 2),
        outerPolygon = [];
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i],
          prev = segments[(i + segments.length - 1) % segments.length],
          step =
            Math.abs(prev.u.x * s.u.y - prev.u.y * s.u.x) < EPS &&
            Math.abs(prev.wallDepth - s.wallDepth) > EPS;
        s.outerStart = outside[i].start;
        s.outerEnd = outside[i].end;
        s.centerStart = centers[i].start;
        s.centerEnd = centers[i].end;
        s.innerWallStart = inside[i].start;
        s.innerWallEnd = inside[i].end;
        s.wallFootprint = [s.outerStart, s.outerEnd, s.innerWallEnd, s.innerWallStart];
        if (signed(s.wallFootprint) < 0) s.wallFootprint.reverse();
        s.alignmentError = 0;
        s.thicknessStepStart = step;
        s.thicknessStepEnd = false;
        for (const q of [s.outerStart, s.outerEnd])
          if (!outerPolygon.length || dist(q, outerPolygon.at(-1)) > EPS) outerPolygon.push(q);
      }
      if (dist(outerPolygon[0], outerPolygon.at(-1)) < EPS) outerPolygon.pop();
      for (let i = 0; i < segments.length; i++)
        segments[i].thicknessStepEnd = segments[(i + 1) % segments.length].thicknessStepStart;
      const valid = !invalidContour(outerPolygon, segments),
        grossArea = valid ? area(outerPolygon) : null,
        voidArea = (level.voids ?? []).reduce((s, v) => s + area(v.polygon), 0);
      return {
        valid,
        index: level.index,
        level: level.index,
        axisPolygon,
        axisArea: area(axisPolygon),
        outerPolygon,
        outerBounds: bounds(outerPolygon),
        grossArea,
        netArea: valid ? Math.max(0, grossArea - voidArea) : null,
        rimSegments: segments,
        baseY: level.baseY,
        topY: level.baseY + rim.h,
        warnings,
      };
    });
}
/** Centre-line crossing of a physical rim inner face, used by opening trimmers.
 * Return the current fallback only when a matching exterior segment is absent. */
export function platformInnerFaceStation(contour, point, axis, fallback) {
  if (!contour) return fallback;
  const along = axis === "y" ? "y" : "x",
    fixed = axis === "y" ? "x" : "y";
  for (const s of contour.rimSegments) {
    const a = add(s.axisStart, s.outwardNormal, s.wallDepth / 2 - s.rimWidth),
      b = add(s.axisEnd, s.outwardNormal, s.wallDepth / 2 - s.rimWidth),
      df = b[fixed] - a[fixed];
    if (Math.abs(df) < EPS) continue;
    const t = (point[fixed] - a[fixed]) / df;
    if (t < -EPS || t > 1 + EPS) continue;
    const axisAt = s.axisStart[along] + (s.axisEnd[along] - s.axisStart[along]) * t;
    if (Math.abs(axisAt - point[along]) > 0.01) continue;
    return a[along] + (b[along] - a[along]) * t;
  }
  return fallback;
}

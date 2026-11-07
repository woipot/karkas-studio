/** Geometric drainage audit. Coordinates [X,Y,Z] m; no hydraulic sizing. */
const EPS = 1e-7,
  HEIGHT_TOL = 0.001,
  CONTACT = 0.025;
const sum = (a) => a.reduce((s, x) => s + x, 0),
  finite = Number.isFinite;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1],
  cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
  len = (a) => Math.hypot(...a),
  mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const key = (n) => Math.round(n * 1e5),
  xy = (p) => [p[0], p[2]],
  area = (p) => Math.abs(sum(p.map((a, i) => cross(a, p[(i + 1) % p.length]))) / 2);
const signed = (p) => sum(p.map((a, i) => cross(a, p[(i + 1) % p.length]))) / 2;
const unique = (a) => a.sort((a, b) => a - b).filter((v, i, s) => !i || Math.abs(v - s[i - 1]) > EPS);
function on(p, a, b, tol = CONTACT) {
  const u = sub(b, a),
    L = len(u);
  return (
    L > EPS &&
    Math.abs(cross(u, sub(p, a))) / L < tol &&
    dot(sub(p, a), u) >= -tol * L &&
    dot(sub(p, b), u) <= tol * L
  );
}
function inside(p, poly) {
  if (poly.some((a, i) => on(p, a, poly[(i + 1) % poly.length], 1e-6))) return true;
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      hit = !hit;
  }
  return hit;
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
      out.push(mix(a, b, t));
    }
  }
  return out;
}
function centroid(poly) {
  let A = 0,
    x = 0,
    z = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      c = cross(a, b);
    A += c;
    x += (a[0] + b[0]) * c;
    z += (a[1] + b[1]) * c;
  }
  return Math.abs(A) > EPS ? [x / (3 * A), z / (3 * A)] : poly[0];
}
function plane(points) {
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[0],
      q = points[i],
      r = points[i + 1],
      dx = q[0] - p[0],
      dz = q[2] - p[2],
      ex = r[0] - p[0],
      ez = r[2] - p[2],
      den = dx * ez - dz * ex;
    if (Math.abs(den) < EPS) continue;
    const a = ((q[1] - p[1]) * ez - (r[1] - p[1]) * dz) / den,
      b = (dx * (r[1] - p[1]) - ex * (q[1] - p[1])) / den,
      c = p[1] - a * p[0] - b * p[2];
    return { a, b, c, y: (p) => a * p[0] + b * p[1] + c };
  }
  return null;
}
function line(a, b) {
  let d = sub(b, a),
    L = len(d);
  if (L < EPS) return null;
  d = d.map((x) => x / L);
  if (d[0] < -EPS || (Math.abs(d[0]) < EPS && d[1] < 0)) d = d.map((x) => -x);
  const n = [-d[1], d[0]],
    c = dot(n, a);
  return {
    d,
    n,
    c,
    id: `${key(d[0])}_${key(d[1])}_${key(c)}`,
    at: (t) => [d[0] * t + n[0] * c, d[1] * t + n[1] * c],
  };
}
function wallSegments(project, base) {
  const levels = base?.geometry?.levels ?? [],
    walls = project?.walls ?? base?.walls ?? [],
    out = [];
  for (const w of walls) {
    if (!w?.a || !w?.b || w.kind === "partition") continue;
    let applicable = w.level !== undefined ? levels.filter((l) => l.index === w.level) : levels;
    if (!applicable.length) {
      const H = project.height ?? 2.8,
        t = base?.timber?.platformHeight ?? 0.285;
      applicable = Array.from({ length: project.floors ?? 1 }, (_, i) => ({
        index: i + 1,
        baseY: 0.72 + i * (H + t),
        topY: 0.72 + (i + 1) * (H + t),
      }));
    }
    for (const l of applicable) {
      const bottom = l.baseY ?? l.platformBase ?? l.wallBaseY ?? l.elevation,
        top = l.topY ?? (l.elevation ?? 0) + (l.height ?? project.height ?? 2.8);
      if (finite(bottom) && finite(top))
        out.push({ id: w.id, level: l.index, a: [w.a.x, w.a.y], b: [w.b.x, w.b.y], bottom, top });
    }
  }
  return out;
}

export function calculateRoofDrainage(project, baseResult, roofModel) {
  const out = {
    arrows: [],
    flows: [],
    surfaces: [],
    edges: [],
    junctions: [],
    gutters: [],
    downpipes: [],
    issues: [],
    checks: [],
    warnings: [],
    suggestions: [],
    quantities: {
      gutterLength: 0,
      downpipeLength: 0,
      flashingLength: 0,
      valleyLength: 0,
      downpipeCount: 0,
      projectedCatchmentArea: 0,
      totalResolvedArea: 0,
      unresolvedArea: 0,
    },
    assumptions: [],
    status: "unverified",
  };
  const issue = (code, message, data = {}) => {
    const id = `drain-issue-${out.issues.length + 1}`;
    out.issues.push({ id, code, severity: "error", message, ...data });
  };
  const source = Array.isArray(roofModel?.surfaces) ? roofModel.surfaces : [],
    surfaces = [],
    byId = new Map(),
    groups = new Map(),
    walls = wallSegments(project, baseResult);
  const ground = (baseResult?.geometry?.polygon ?? []).map((p) => [p.x, p.y]);
  const getGroup = (a, b) => {
    const l = line(a, b);
    if (!l) return null;
    if (!groups.has(l.id)) groups.set(l.id, { ...l, raw: [], walls: [], times: [] });
    return groups.get(l.id);
  };
  for (const input of source) {
    if (
      !input ||
      !Array.isArray(input.points) ||
      input.points.length < 3 ||
      input.points.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((x) => !finite(x)))
    ) {
      issue("invalid-surface", "Некорректная поверхность кровли пропущена.");
      continue;
    }
    const P = plane(input.points);
    if (!P || input.points.some((p) => Math.abs(P.y(xy(p)) - p[1]) > HEIGHT_TOL)) {
      issue("nonplanar-surface", "Неплоский скат: направление стока не определено.", {
        surfaceId: input.id,
        zoneId: input.zoneId,
      });
      continue;
    }
    let poly = input.points.map(xy);
    if (signed(poly) < 0) poly = poly.reverse();
    const slope = Math.hypot(P.a, P.b),
      d = slope > EPS ? [-P.a / slope, -P.b / slope] : [0, 0];
    const s = {
      id: input.id ?? `surface-${surfaces.length}`,
      zoneId: input.zoneId,
      poly,
      plane: P,
      slope,
      d,
      edges: [],
      area: area(poly),
    };
    surfaces.push(s);
    byId.set(s.id, s);
    out.surfaces.push({
      id: s.id,
      zoneId: s.zoneId,
      gradient: [P.a, P.b],
      direction:
        slope > EPS
          ? [
              d[0] / Math.sqrt(1 + slope * slope),
              -slope / Math.sqrt(1 + slope * slope),
              d[1] / Math.sqrt(1 + slope * slope),
            ]
          : [0, 0, 0],
      slope,
      slopeDeg: (Math.atan(slope) * 180) / Math.PI,
      projectedArea: s.area,
    });
    if (slope < EPS)
      issue("flat-surface", "У ската нулевой уклон: самотечный выход не подтверждён.", {
        surfaceId: s.id,
        zoneId: s.zoneId,
      });
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        g = getGroup(a, b);
      if (!g) continue;
      const t0 = dot(g.d, a),
        t1 = dot(g.d, b),
        v = sub(b, a),
        L = len(v),
        normal = [v[1] / L, -v[0] / L];
      g.raw.push({ surface: s, min: Math.min(t0, t1), max: Math.max(t0, t1), normal });
      g.times.push(t0, t1);
    }
  }
  for (const w of walls) {
    const g = getGroup(w.a, w.b);
    if (!g) continue;
    const a = dot(g.d, w.a),
      b = dot(g.d, w.b);
    g.walls.push({ ...w, min: Math.min(a, b), max: Math.max(a, b) });
    g.times.push(a, b);
  }
  // A wall crossing the interior of a facet is a model collision, not an eave.
  for (const s of surfaces)
    for (const w of walls) {
      const v = sub(w.b, w.a),
        ts = [0, 1],
        heightAt = (t) => s.plane.y(mix(w.a, w.b, t));
      for (let i = 0; i < s.poly.length; i++) {
        const a = s.poly[i],
          b = s.poly[(i + 1) % s.poly.length],
          e = sub(b, a),
          den = cross(v, e);
        if (Math.abs(den) < EPS) continue;
        const t = cross(sub(a, w.a), e) / den,
          u = cross(sub(a, w.a), v) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
      for (const Y of [w.bottom, w.top]) {
        const a = heightAt(0) - Y,
          b = heightAt(1) - Y;
        if (a * b < -EPS) ts.push(a / (a - b));
      }
      const values = unique(ts);
      for (let i = 1; i < values.length; i++) {
        const t = (values[i - 1] + values[i]) / 2,
          q = mix(w.a, w.b, t),
          Y = heightAt(t);
        if (
          inside(q, s.poly) &&
          !s.poly.some((a, j) => on(q, a, s.poly[(j + 1) % s.poly.length], 1e-5)) &&
          w.bottom <= Y + CONTACT &&
          w.top > Y + CONTACT
        ) {
          s.invalidInterior = true;
          issue(
            "interior-roof-wall-crossing",
            "Скат пересекает высокую стену внутри своей поверхности. Требуется изменить контуры и геометрию крыши; направление одного желоба не устраняет пересечение.",
            { surfaceId: s.id, zoneId: s.zoneId, wallId: w.id, point: [q[0], Y, q[1]] },
          );
          break;
        }
      }
    }
  // Split collinear edges at T-junctions, height crossings and wall/platform limits.
  for (const g of groups.values()) {
    if (!g.raw.length) continue;
    const times = [...g.times];
    const h = (r, t) => r.surface.plane.y(g.at(t));
    for (let i = 0; i < g.raw.length; i++)
      for (let j = 0; j < i; j++) {
        const a = g.raw[i],
          b = g.raw[j],
          lo = Math.max(a.min, b.min),
          hi = Math.min(a.max, b.max);
        if (hi - lo < EPS) continue;
        const f0 = h(a, lo) - h(b, lo),
          f1 = h(a, hi) - h(b, hi);
        if (f0 * f1 < -EPS) times.push(lo + ((hi - lo) * f0) / (f0 - f1));
      }
    for (const r of g.raw)
      for (const w of g.walls) {
        const lo = Math.max(r.min, w.min),
          hi = Math.min(r.max, w.max);
        if (hi - lo < EPS) continue;
        for (const Y of [w.bottom, w.top]) {
          const f0 = h(r, lo) - Y,
            f1 = h(r, hi) - Y;
          if (f0 * f1 < -EPS) times.push(lo + ((hi - lo) * f0) / (f0 - f1));
        }
      }
    const ts = unique(times);
    for (let i = 1; i < ts.length; i++) {
      const lo = ts[i - 1],
        hi = ts[i],
        mid = (lo + hi) / 2;
      if (hi - lo < EPS) continue;
      const raw = g.raw.filter((r) => r.min <= mid + EPS && r.max >= mid - EPS);
      if (!raw.length) continue;
      const parts = [...new Map(raw.map((r) => [r.surface.id, r])).values()],
        heights = parts.map((r) => h(r, mid)),
        highest = Math.max(...heights),
        lowest = Math.min(...heights);
      const barriers = g.walls.filter(
        (w) =>
          w.min <= mid + EPS &&
          w.max >= mid - EPS &&
          w.top > lowest + CONTACT &&
          w.bottom <= lowest + CONTACT,
      );
      const sameHeight = highest - lowest <= HEIGHT_TOL,
        clusters = [];
      if (barriers.length && !sameHeight) {
        for (const part of parts) {
          let cluster = clusters.find((q) => Math.abs(h(q[0], mid) - h(part, mid)) <= HEIGHT_TOL);
          if (!cluster) {
            cluster = [];
            clusters.push(cluster);
          }
          cluster.push(part);
        }
      } else clusters.push(parts);
      for (const own of clusters) {
        const ownH = Math.max(...own.map((r) => h(r, mid))),
          ownWalls = g.walls.filter(
            (w) =>
              w.min <= mid + EPS &&
              w.max >= mid - EPS &&
              w.top > ownH + CONTACT &&
              w.bottom <= ownH + CONTACT,
          ),
          flux = own.map((r) => ({
            surfaceId: r.surface.id,
            value: dot(r.surface.d, r.normal),
            height: h(r, mid),
          }));
        const samePlane = own.every(
          (r) =>
            Math.abs(r.surface.plane.a - own[0].surface.plane.a) < EPS &&
            Math.abs(r.surface.plane.b - own[0].surface.plane.b) < EPS,
        );
        const type = ownWalls.length
          ? "wall-abutment"
          : !sameHeight
            ? "step"
            : own.length === 1
              ? flux[0].value > EPS
                ? "eave"
                : "verge"
              : samePlane
                ? "seam"
                : flux.every((f) => f.value >= -EPS) && flux.some((f) => f.value > EPS)
                  ? "valley"
                  : flux.every((f) => f.value <= EPS) && flux.some((f) => f.value < -EPS)
                    ? "ridge"
                    : "crease";
        const reference = own.reduce((a, b) => (h(a, mid) > h(b, mid) ? a : b)),
          a = g.at(lo),
          b = g.at(hi),
          start = [a[0], reference.surface.plane.y(a), a[1]],
          end = [b[0], reference.surface.plane.y(b), b[1]],
          into = ownWalls.length && flux.some((f) => f.value > EPS);
        const edge = {
          id: `drain-edge-${out.edges.length + 1}`,
          type,
          start,
          end,
          length: Math.hypot(...sub3(end, start)),
          surfaceIds: own.map((r) => r.surface.id),
          neighborSurfaceIds: parts.filter((r) => !own.includes(r)).map((r) => r.surface.id),
          zoneIds: [...new Set(own.map((r) => r.surface.zoneId))],
          flux,
          wallId: ownWalls[0]?.id,
          wallLevel: ownWalls[0]?.level,
          flowIntoWall: !!into,
          wallTop: ownWalls[0]?.top,
          wallBottom: ownWalls[0]?.bottom,
          outlet: type === "eave",
          status: into ? "fail" : "unverified",
          heightDrop: highest - lowest,
          stepRole: !sameHeight ? (Math.abs(ownH - highest) < HEIGHT_TOL ? "upper" : "lower") : undefined,
          note:
            type === "seam"
              ? "Внутренняя граница одной плоскости."
              : !sameHeight
                ? "Перепад высоты: требуется контролируемый водоприём."
                : undefined,
        };
        if (!sameHeight && type !== "step") edge.secondaryType = "step";
        edge._parts = own;
        out.edges.push(edge);
        for (const r of own) r.surface.edges.push(edge);
        if (into)
          issue(
            "wall-inflow",
            "Уклон направляет воду в стык с высокой стеной или торцом межэтажной платформы. Фартук не исправляет направление стока.",
            {
              edgeId: edge.id,
              zoneId: byId.get(flux.find((f) => f.value > EPS)?.surfaceId)?.zoneId,
              wallId: edge.wallId,
              point: mix(start, end, 0.5),
            },
          );
      }
    }
  }
  const edgeAt = (s, q) => s.edges.find((e) => on(q, xy(e.start), xy(e.end), 1e-5));
  function ray(s, p) {
    let best = null;
    for (let i = 0; i < s.poly.length; i++) {
      const a = s.poly[i],
        b = s.poly[(i + 1) % s.poly.length],
        v = sub(b, a),
        den = cross(s.d, v);
      if (Math.abs(den) < EPS) continue;
      const t = cross(sub(a, p), v) / den,
        u = cross(sub(a, p), s.d) / den;
      if (t > 1e-6 && u >= -EPS && u <= 1 + EPS && (!best || t < best.t))
        best = { t, q: [p[0] + s.d[0] * t, p[1] + s.d[1] * t] };
    }
    return best;
  }
  function receiver(s, q, edge, visited) {
    return surfaces
      .filter(
        (v) =>
          v.id !== s.id &&
          !visited.has(v.id) &&
          inside(q, v.poly) &&
          v.plane.y(q) <= s.plane.y(q) + HEIGHT_TOL,
      )
      .sort((a, b) => b.plane.y(q) - a.plane.y(q))
      .find((v) => inside([q[0] + v.d[0] * 1e-4, q[1] + v.d[1] * 1e-4], v.poly));
  }
  function valleyRoute(edge, path, seen) {
    if (seen.has(edge.id)) return { status: "valleyNeedsDrain", resolved: false, path, edgeId: edge.id };
    seen.add(edge.id);
    const drop = edge.end[1] - edge.start[1];
    if (Math.abs(drop) < HEIGHT_TOL) {
      issue(
        "flat-valley",
        "Вода собирается в горизонтальной ендове без заданного продольного уклона и выпуска.",
        { edgeId: edge.id, point: mix(edge.start, edge.end, 0.5) },
      );
      return { status: "valleyNeedsDrain", resolved: false, path, edgeId: edge.id };
    }
    const low = drop > 0 ? edge.start : edge.end;
    path.push(low);
    const connected = out.edges.filter(
      (e) => e.id !== edge.id && [e.start, e.end].some((p) => Math.hypot(...sub3(p, low)) < 0.01),
    );
    const free = connected.find((e) => e.type === "eave");
    if (free) return { status: "freeExterior", resolved: true, path, edgeId: free.id };
    const next = connected.find(
      (e) => e.type === "valley" && Math.min(e.start[1], e.end[1]) < low[1] - HEIGHT_TOL,
    );
    if (next) return valleyRoute(next, path, seen);
    const wall = connected.find((e) => e.type === "wall-abutment" && e.flowIntoWall);
    if (wall) return { status: "wallBlock", resolved: false, path, edgeId: wall.id };
    issue("closed-valley", "Низкий конец ендовы не связан с подтверждённым наружным карнизом или выпуском.", {
      edgeId: edge.id,
      point: low,
    });
    return { status: "valleyNeedsDrain", resolved: false, path, edgeId: edge.id };
  }
  function trace(s, p, visited = new Set(), path = [], transfers = []) {
    if (s.invalidInterior)
      return {
        status: "unknown",
        resolved: false,
        path: path.length ? path : [[p[0], s.plane.y(p), p[1]]],
        transfers,
      };
    if (visited.has(s.id) || visited.size > surfaces.length + 2 || s.slope < EPS)
      return { status: "unknown", resolved: false, path, transfers };
    visited.add(s.id);
    const start = [p[0], s.plane.y(p), p[1]];
    if (!path.length) path.push(start);
    const hit = ray(s, p);
    if (!hit) return { status: "unknown", resolved: false, path, transfers };
    const edge = edgeAt(s, hit.q),
      exit = [hit.q[0], s.plane.y(hit.q), hit.q[1]];
    path.push(exit);
    if (!edge) return { status: "unknown", resolved: false, path, transfers };
    const ownWall = walls.find(
      (w) => on(hit.q, w.a, w.b) && w.bottom <= exit[1] + CONTACT && w.top > exit[1] + CONTACT,
    );
    if (ownWall)
      return { status: "wallBlock", resolved: false, path, edgeId: edge.id, transfers, wallId: ownWall.id };
    if (edge.type === "valley") return { ...valleyRoute(edge, path, new Set()), transfers };
    const recv = receiver(s, hit.q, edge, visited);
    if (recv) {
      const Y = recv.plane.y(hit.q);
      if (Y < exit[1] - HEIGHT_TOL) {
        path.push([hit.q[0], Y, hit.q[1]]);
        transfers.push(recv.id);
      }
      const point = [hit.q[0] + recv.d[0] * 1e-4, hit.q[1] + recv.d[1] * 1e-4];
      const result = trace(recv, point, visited, path, transfers);
      return { ...result, status: result.resolved && transfers.length ? "roofTransfer" : result.status };
    }
    if (edge.type === "eave")
      return { status: "freeExterior", resolved: true, path, edgeId: edge.id, transfers };
    if (edge.type === "step") {
      issue(
        "step-obstruction",
        "Перепад скатов не имеет установленного принимающего пути и контролируемого выпуска.",
        { edgeId: edge.id, point: exit },
      );
      return { status: "unknown", resolved: false, path, edgeId: edge.id, transfers };
    }
    return { status: "unknown", resolved: false, path, edgeId: edge.id, transfers };
  }
  // Exact first-facet catchment partition by strips perpendicular to downhill.
  for (const s of surfaces) {
    out.quantities.projectedCatchmentArea += s.area;
    const n = [-s.d[1], s.d[0]],
      patches = [];
    if (s.slope > EPS)
      for (const e of s.edges) {
        const part = e._parts.find((p) => p.surface.id === s.id);
        if (!part || dot(s.d, part.normal) <= EPS) continue;
        const q0 = dot(n, xy(e.start)),
          q1 = dot(n, xy(e.end)),
          lo = Math.min(q0, q1),
          hi = Math.max(q0, q1);
        let patch = clip(s.poly, (q) => dot(n, q) - lo);
        patch = clip(patch, (q) => hi - dot(n, q));
        if (patch.length >= 3 && area(patch) > EPS) patches.push(patch);
      }
    if (!patches.length) patches.push(s.poly);
    const total = sum(patches.map(area));
    for (const patch of patches) {
      const A = area(patch) * (total > 0 ? s.area / total : 1),
        p = centroid(patch),
        route = trace(s, p);
      const start = [p[0], s.plane.y(p), p[1]],
        end = route.path[1] ?? start;
      const arrow = {
        id: `drain-flow-${out.arrows.length + 1}`,
        surfaceId: s.id,
        zoneId: s.zoneId,
        start,
        end,
        direction: out.surfaces.find((v) => v.id === s.id).direction,
        horizontalDirection: s.d,
        slope: s.slope,
        slopeDeg: (Math.atan(s.slope) * 180) / Math.PI,
        catchmentArea: A,
        path: route.path,
        status: route.status,
        resolved: route.resolved,
        outletEdgeId: route.edgeId,
        transferSurfaceIds: route.transfers ?? [],
        wallId: route.wallId,
      };
      out.arrows.push(arrow);
      if (route.resolved) out.quantities.totalResolvedArea += A;
      else out.quantities.unresolvedArea += A;
    }
  }
  // Gutters intercept exterior eaves and higher edges above a lower roof.
  const candidates = out.edges.filter(
    (e) =>
      e.type === "eave" ||
      (e.stepRole !== "lower" &&
        e.heightDrop > HEIGHT_TOL &&
        e.flux.some(
          (f) => f.value > EPS && f.height >= Math.max(...e.flux.map((q) => q.height)) - HEIGHT_TOL,
        )),
  );
  function pipeAt(point) {
    if (ground.length < 3) return null;
    const q = xy(point),
      orientation = signed(ground) >= 0 ? 1 : -1;
    if (!inside(q, ground)) {
      // A real overhanging eave is already outside the wall footprint. Keep the
      // downpipe at that exterior outlet; do not invent a wall at the roof edge.
      const collision = surfaces.some(
        (s) => inside(q, s.poly) && s.plane.y(q) < point[1] - CONTACT && s.plane.y(q) > 0.1,
      );
      if (collision) return null;
      return {
        start: [q[0], point[1], q[1]],
        end: [q[0], 0.1, q[1]],
        path: [[...point], [q[0], 0.1, q[1]]],
        standOffFromWall: true,
      };
    }
    for (let i = 0; i < ground.length; i++) {
      const a = ground[i],
        b = ground[(i + 1) % ground.length];
      if (!on(q, a, b, 0.04)) continue;
      const d = sub(b, a),
        L = len(d),
        normal = [(orientation * d[1]) / L, (-orientation * d[0]) / L],
        anchor = [q[0] + normal[0] * 0.18, q[1] + normal[1] * 0.18];
      if (inside(anchor, ground)) continue;
      const collision = surfaces.some(
        (s) => inside(anchor, s.poly) && s.plane.y(anchor) < point[1] - CONTACT && s.plane.y(anchor) > 0.1,
      );
      if (collision) continue;
      return {
        start: [anchor[0], point[1], anchor[1]],
        end: [anchor[0], 0.1, anchor[1]],
        path: [point, [anchor[0], point[1], anchor[1]], [anchor[0], 0.1, anchor[1]]],
      };
    }
    return null;
  }
  const gutterRuns = new Map();
  for (const e of candidates) {
    const l = line(xy(e.start), xy(e.end)),
      t0 = dot(l.d, xy(e.start)),
      t1 = dot(l.d, xy(e.end)),
      m = (e.end[1] - e.start[1]) / (t1 - t0),
      c = e.start[1] - m * t0,
      k = l.id + "_" + key(m) + "_" + key(c);
    if (!gutterRuns.has(k)) gutterRuns.set(k, { ...l, m, Y: c, pieces: [] });
    gutterRuns.get(k).pieces.push({ lo: Math.min(t0, t1), hi: Math.max(t0, t1), id: e.id });
  }
  const merged = [];
  for (const g of gutterRuns.values()) {
    let run = null;
    for (const p of g.pieces.sort((a, b) => a.lo - b.lo)) {
      if (run && p.lo <= run.hi + EPS) {
        run.hi = Math.max(run.hi, p.hi);
        run.ids.push(p.id);
      } else {
        run = { lo: p.lo, hi: p.hi, ids: [p.id], g };
        merged.push(run);
      }
    }
  }
  for (const run of merged) {
    const { g } = run,
      a = g.at(run.lo),
      b = g.at(run.hi),
      e = { id: run.ids[0], start: [a[0], g.m * run.lo + g.Y, a[1]], end: [b[0], g.m * run.hi + g.Y, b[1]] };
    e.length = Math.hypot(...sub3(e.end, e.start));
    const gutter = {
      id: `gutter-${out.gutters.length + 1}`,
      edgeId: e.id,
      edgeIds: run.ids,
      start: e.start,
      end: e.end,
      path: [e.start, e.end],
      length: e.length,
      slope: null,
      proposed: true,
      status: "unverified",
      note: "Геометрическая трасса желоба; его продольный уклон и пропускная способность не рассчитаны.",
    };
    out.gutters.push(gutter);
    const lowY = Math.min(e.start[1], e.end[1]);
    const endpoint = [e.start, e.end]
      .filter((p) => p[1] <= lowY + HEIGHT_TOL)
      .sort((a, b) => a[1] - b[1])
      .map((p) => ({ p, route: pipeAt(p) }))
      .find((v) => v.route);
    if (endpoint) {
      const prior = out.downpipes.find(
        (d) =>
          Math.hypot(d.start[0] - endpoint.route.start[0], d.start[2] - endpoint.route.start[2]) < 0.05 &&
          Math.abs(d.start[1] - endpoint.route.start[1]) < 0.05,
      );
      if (prior) gutter.downpipeId = prior.id;
      else {
        const d = {
          id: `downpipe-${out.downpipes.length + 1}`,
          gutterId: gutter.id,
          ...endpoint.route,
          verticalLength: Math.hypot(...sub3(endpoint.route.end, endpoint.route.start)),
          length: sum(
            endpoint.route.path.slice(1).map((p, i) => Math.hypot(...sub3(p, endpoint.route.path[i]))),
          ),
          proposed: true,
          status: "unverified",
          note: "Наружная трасса с верхним отводом, без прохода через нижние скаты. Длина включает отвод; диаметр и водоприёмник у земли не рассчитаны.",
        };
        out.downpipes.push(d);
        gutter.downpipeId = d.id;
      }
    } else {
      gutter.outletMissing = true;
      issue(
        "gutter-outlet-unresolved",
        "Для желоба не найдена наружная трасса трубы: концы внутри контура или над нижними скатами. Нужен отдельный выпуск.",
        { edgeId: e.id, point: e.start },
      );
    }
  }
  // A roof edge inside the building is not an exterior outlet by itself.
  for (const f of out.arrows.filter((f) => f.resolved)) {
    const gutter = out.gutters.find((g) => g.edgeIds.includes(f.outletEdgeId));
    if (!gutter?.downpipeId) {
      f.resolved = false;
      f.status = "unknown";
      out.quantities.totalResolvedArea -= f.catchmentArea;
      out.quantities.unresolvedArea += f.catchmentArea;
      issue(
        "interior-outlet",
        "Конец пути находится внутри контура или не связан с наружным выпуском. Свободный карниз и отвод от здания не подтверждены.",
        { edgeId: f.outletEdgeId, zoneId: f.zoneId, point: f.path.at(-1) },
      );
    }
  }
  out.flows = out.arrows;
  out.junctions = out.edges.filter((e) =>
    ["wall-abutment", "valley", "ridge", "step", "crease"].includes(e.type),
  );
  out.quantities.gutterLength = sum(out.gutters.map((e) => e.length));
  out.quantities.downpipeCount = out.downpipes.length;
  out.quantities.downpipeLength = sum(out.downpipes.map((d) => d.length));
  out.quantities.flashingLength = sum(
    out.edges.filter((e) => e.type === "wall-abutment").map((e) => e.length),
  );
  out.quantities.valleyLength = sum(out.edges.filter((e) => e.type === "valley").map((e) => e.length));
  out.quantities.wallAbutmentLength = out.quantities.flashingLength;
  out.quantities.catchmentBalanceError =
    out.quantities.projectedCatchmentArea - out.quantities.totalResolvedArea - out.quantities.unresolvedArea;
  out.suggestions = makeSuggestions(project, baseResult, roofModel, out);
  for (const e of out.edges) {
    delete e._parts;
    delete e._g;
    delete e._lo;
    delete e._hi;
  }
  out.warnings = [...new Set(out.issues.map((i) => i.message))];
  out.checks = [
    {
      id: "drainage-surfaces",
      label: "Геометрия скатов и стен",
      status: out.issues.some((i) =>
        ["invalid-surface", "nonplanar-surface", "interior-roof-wall-crossing"].includes(i.code),
      )
        ? "fail"
        : "pass",
    },
    {
      id: "drainage-wall-inflow",
      label: "Сток в высокую стену",
      status: out.arrows.some((f) => f.status === "wallBlock") ? "fail" : "pass",
      note: "Проверяется направление воды, а не только наличие фартука.",
    },
    {
      id: "drainage-paths",
      label: "Геометрические пути до выпуска",
      status: out.quantities.unresolvedArea > 1e-5 ? "fail" : "warning",
      value: out.quantities.unresolvedArea,
      limit: 0,
      unit: "м²",
    },
    {
      id: "drainage-gutter-outlet",
      label: "Наружные выпуски желобов",
      status: out.gutters.some((g) => g.outletMissing) ? "fail" : "warning",
      note: "Каждый предлагаемый желоб должен иметь геометрически доступную наружную трассу.",
    },
    {
      id: "drainage-cascade",
      label: "Перепады и передача воды на нижний скат",
      status: out.arrows.some((f) => f.transferSurfaceIds.length) ? "unverified" : "pass",
      note: "Каскадный путь не подтверждает узел водоприёма: нужны желоб или согласованная передача, защита нижнего покрытия и расчёт гидравлики.",
    },
    {
      id: "drainage-hydraulics",
      label: "Гидравлика желобов, труб и водоприёмников",
      status: "unverified",
      note: "Интенсивность дождя, размеры водостока, снег и лёд, аварийный перелив и отвод от фундамента не рассчитаны.",
    },
  ];
  out.assumptions = [
    "Скаты рассматриваются как плоскости Y=aX+bZ+c. Вектор стока направлен по наибольшему понижению высоты; границы пересекаются лучом в действительном полигоне ската.",
    "Площадь первого ската делится на полосы по выходным граням. На переходах через разные плоскости дальнейший маршрут прослеживается по представительной линии потока; это геометрический аудит, не распределённая гидравлическая модель.",
    "Нулевая продольная отметка ендовы не создаёт выпуска сама по себе. Сток в высокую стену считается дефектом направления, который нельзя устранить одной пометкой фартука.",
    "Препятствие высокой стены включает торец межэтажной платформы от baseY до topY. Собственная опорная стена под карнизом не считается барьером на его уровне.",
    "Желоба и трубы — предлагаемые геометрические трассы без подбора диаметра и уклона. Труба размещается только у наружной границы основания и проверяется на пересечение нижних кровель; у земли нужен отдельный водоприёмник.",
    "Длины приведены по фактическим осям без закупочного запаса. Наличие геометрического выхода не подтверждает водонепроницаемость, пропускную способность, снеговую безопасность или работоспособность узлов.",
  ];
  out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  return out;
}
const sub3 = (a, b) => a.map((v, i) => v - b[i]);

function makeSuggestions(project, base, roof, audit) {
  const suggestions = [];
  for (const z of roof?.zones ?? []) {
    const blocked = audit.edges.filter(
      (e) => e.type === "wall-abutment" && e.flowIntoWall && e.zoneIds.includes(z.id),
    );
    if (!blocked.length || !Array.isArray(z.polygon) || z.polygon.length !== 4) continue;
    const c = centroid(z.polygon.map((q) => [q.x, q.y])),
      normals = [];
    for (const e of blocked) {
      const a = xy(e.start),
        b = xy(e.end),
        d = sub(b, a),
        L = len(d);
      if (L < EPS) continue;
      let n = [-d[1] / L, d[0] / L];
      const to = sub(mix(a, b, 0.5), c);
      if (dot(n, to) < 0) n = n.map((v) => -v);
      normals.push({ n, length: e.length, wallTop: e.wallTop, wallId: e.wallId });
    }
    let v = [sum(normals.map((q) => q.n[0] * q.length)), sum(normals.map((q) => q.n[1] * q.length))],
      V = len(v);
    if (V < EPS) continue;
    v = v.map((q) => q / V);
    if (normals.some((q) => dot(v, q.n) < 0.1)) continue;
    const values = z.polygon.map((q) => dot([q.x, q.y], v)),
      S = Math.max(...values) - Math.min(...values),
      available = Math.min(...normals.map((q) => q.wallTop)) - z.eave - 0.1;
    const limit = (Math.atan2(available, S) * 180) / Math.PI,
      pitch = Math.min(z.pitchLeft ?? 25, Math.max(0, limit));
    if (pitch < 2) continue;
    const angle = ((Math.atan2(-v[0], v[1]) * 180) / Math.PI + 360) % 360;
    suggestions.push({
      id: `drain-away-${z.id}`,
      zoneId: z.id,
      wallId: normals[0]?.wallId,
      reason:
        "Перенаправить нижний скат от высокой стены к наружному карнизу. Фартук остаётся необходимым узлом, но не заменяет правильный уклон.",
      changes: {
        shape: "mono",
        trussType: "mono",
        ridgeAngle: Math.round(angle * 1e6) / 1e6,
        pitchLeft: pitch,
        pitchRight: pitch,
      },
      requiresRecheck: true,
    });
  }
  return suggestions;
}

export function orientRoofsAwayFromWalls(project, baseResult, roofModel) {
  const audit = calculateRoofDrainage(project, baseResult, roofModel),
    suggestions = audit.suggestions,
    source = Array.isArray(project.roof?.zones) ? project.roof.zones : (roofModel?.zones ?? []);
  const fields = [
    "framing",
    "deflectionRatio",
    "id",
    "name",
    "polygon",
    "shape",
    "ridgeAngle",
    "pitchLeft",
    "pitchRight",
    "elevation",
    "levelIndex",
    "trussType",
    "spacing",
    "chordSection",
    "webSection",
  ];
  const zones = source.map((z) => {
    if (!z || typeof z !== "object") return z;
    const out = Object.fromEntries(
      fields
        .filter((k) => z[k] !== undefined)
        .map((k) => [k, k === "polygon" ? z[k].map((q) => ({ ...q })) : z[k]]),
    );
    const suggestion = suggestions.find((q) => q.zoneId === z.id);
    return suggestion ? { ...out, ...suggestion.changes } : out;
  });
  const appliedZoneIds = suggestions.map((s) => s.zoneId),
    blockedZoneIds = [
      ...new Set([
        ...audit.arrows.filter((f) => f.status === "wallBlock").map((f) => f.zoneId),
        ...audit.issues.filter((i) => i.code === "interior-roof-wall-crossing").map((i) => i.zoneId),
      ]),
    ];
  return {
    zones,
    suggestions,
    appliedZoneIds,
    unresolved: blockedZoneIds.filter((id) => !appliedZoneIds.includes(id)),
  };
}

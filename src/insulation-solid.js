import { ShapeUtils, Vector2, Vector3 } from "three";
import { cutGeometry } from "./board-geometry.js";

// Numerical geometry tolerances in metres, not material/design constants.
const EPS = 1e-8;
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = (a) => mul(a.reduce(add, [0, 0, 0]), 1 / a.length);
const unique = (a) => a.filter((v, i) => !a.slice(0, i).some((p) => Math.hypot(...sub(p, v)) < EPS));
export function solid(faces) {
  faces = faces
    .map((f) =>
      unique(f).filter(
        (p, i, a) =>
          Math.hypot(...cross(sub(p, a[(i + a.length - 1) % a.length]), sub(a[(i + 1) % a.length], p))) >
          EPS * EPS,
      ),
    )
    .filter((f) => f.length >= 3);
  const vertices = faces.flat(),
    center = mean(vertices);
  const planes = faces
    .map((f) => {
      let n = cross(sub(f[1], f[0]), sub(f[2], f[0]));
      const L = Math.hypot(...n);
      if (L < EPS) return null;
      n = mul(n, 1 / L);
      if (dot(n, sub(center, f[0])) > 0) n = mul(n, -1);
      return { n, d: dot(n, f[0]) };
    })
    .filter(Boolean);
  return {
    faces,
    planes,
    bounds: [0, 1, 2].map((i) => [
      Math.min(...vertices.map((p) => p[i])),
      Math.max(...vertices.map((p) => p[i])),
    ]),
  };
}
export function volume(s) {
  if (!s) return 0;
  const c = mean(s.faces.flat());
  return s.faces.reduce(
    (v, f) =>
      v +
      f
        .slice(2)
        .reduce((a, p, i) => a + Math.abs(dot(sub(f[0], c), cross(sub(f[i + 1], c), sub(p, c)))) / 6, 0),
    0,
  );
}
export function clip(s, { n, d }) {
  if (!s) return null;
  const values = s.faces.flat().map((p) => dot(n, p) - d);
  if (Math.max(...values) <= EPS) return s;
  if (Math.min(...values) >= -EPS) return null;
  const cap = [],
    faces = [];
  for (const f of s.faces) {
    const out = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i],
        b = f[(i + 1) % f.length],
        da = dot(n, a) - d,
        db = dot(n, b) - d;
      if (da <= EPS) out.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const hit = add(a, mul(sub(b, a), da / (da - db)));
        out.push(hit);
        cap.push(hit);
      } else if (Math.abs(da) <= EPS) cap.push(a);
    }
    const cleaned = unique(out);
    if (cleaned.length >= 3) faces.push(cleaned);
  }
  const points = unique(cap);
  if (points.length >= 3) {
    const c = mean(points),
      u = sub(points[0], c),
      v = cross(n, u);
    points.sort(
      (a, b) =>
        Math.atan2(dot(sub(a, c), v), dot(sub(a, c), u)) - Math.atan2(dot(sub(b, c), v), dot(sub(b, c), u)),
    );
    faces.push(points);
  }
  return faces.length >= 4 ? solid(faces) : null;
}
const overlaps = (a, b) =>
  a.bounds.every(([lo, hi], i) => hi > b.bounds[i][0] + EPS && lo < b.bounds[i][1] - EPS);
export function intersect(a, b) {
  if (!a || !b || !overlaps(a, b)) return null;
  for (const p of b.planes) {
    a = clip(a, p);
    if (!a) break;
  }
  return a;
}
export function subtract(a, b) {
  if (!a || !b || !overlaps(a, b)) return a ? [a] : [];
  const out = [];
  for (const p of b.planes) {
    const outside = clip(a, { n: mul(p.n, -1), d: -p.d });
    if (outside) out.push(outside);
    a = clip(a, p);
    if (!a) break;
  }
  return out;
}
export function subtractAll(cells, cuts) {
  for (const cut of cuts) cells = cells.flatMap((c) => subtract(c, cut));
  return cells;
}
function prism(a, b) {
  return solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % a.length], b[(i + 1) % a.length], b[i]])]);
}
export function surfaceNormal(points) {
  for (let i = 1; i < points.length - 1; i++) {
    const n = cross(sub(points[i], points[0]), sub(points[i + 1], points[0])),
      length = Math.hypot(...n);
    if (length > EPS) return mul(n, (n[1] < 0 ? -1 : 1) / length);
  }
  return null;
}
export function slab(points, normal, from, to) {
  const origin = points[0],
    u = sub(points[1], origin),
    v = cross(normal, u);
  const flat = points.map((p) => new Vector2(dot(sub(p, origin), u), dot(sub(p, origin), v)));
  return ShapeUtils.triangulateShape(flat, []).map((t) =>
    prism(
      t.map((i) => add(points[i], mul(normal, from))),
      t.map((i) => add(points[i], mul(normal, to))),
    ),
  );
}
export function boardSolids(board) {
  const a = new Vector3(...board.start),
    end = new Vector3(...board.end),
    dir = end.clone().sub(a).normalize();
  let x = new Vector3(...(board.crossAxis ?? [1, 0, 0]));
  x.addScaledVector(dir, -x.dot(dir)).normalize();
  if (x.length() < 0.1) x = new Vector3(0, 0, 1).cross(dir).normalize();
  const z = x.clone().cross(dir).normalize(),
    center = a.clone().add(end).multiplyScalar(0.5);
  const world = (p) =>
    center.clone().addScaledVector(x, p[0]).addScaledVector(dir, p[1]).addScaledVector(z, p[2]).toArray();
  if (
    !board.shape &&
    !board.notches?.length &&
    ![board.cutStart, board.cutEnd].some((c) => ["halfLap", "half-lap", "scarf"].includes(c?.scheme))
  ) {
    const face = (end) =>
      [-1, 1].flatMap((w) =>
        [-1, 1].map((d) => {
          const bx = (w * board.b) / 2000,
            hz = (d * board.h) / 2000,
            cut = end ? board.cutEnd : board.cutStart;
          let station = ((end ? 1 : -1) * board.length) / 2;
          if (cut?.scheme === "miter") {
            const slope = Math.tan(((cut.angle ?? 0) * Math.PI) / 180) * (cut.tiltSign ?? 1);
            station += cut.plane === "width" ? bx * slope : hz * slope * (end ? -1 : 1);
          }
          return world([bx, station, hz]);
        }),
      );
    const a = face(false),
      b = face(true),
      order = [0, 1, 3, 2];
    return [
      prism(
        order.map((i) => a[i]),
        order.map((i) => b[i]),
      ),
    ];
  }
  if (board.shape?.type === "layeredProfile" || board.shape?.plane === "width") {
    const width = board.shape.plane === "width";
    const layers = board.shape.layers ?? [
      { from: -board.h / 2000, to: board.h / 2000, points: board.shape.points },
    ];
    return layers.flatMap((l) => {
      const points = l.points.map(([s, v]) => world(width ? [v, s, l.from] : [l.from, s, v]));
      return slab(points, (width ? z : x).toArray(), 0, l.to - l.from);
    });
  }
  // Reuse the viewer's physical profile (mitres, laps, seats and stud grooves),
  // decomposing the extrusion's negative-width cap into convex triangular prisms.
  const geo = cutGeometry(board),
    pos = geo.attributes.position,
    cells = [],
    half = board.b / 2000;
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [0, 1, 2].map((j) => [pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j)]);
    // cutGeometry stores Float32 positions; tolerance is numerical, not a construction allowance.
    if (!tri.every((p) => Math.abs(p[0] + half) < 1e-6)) continue;
    const other = tri.map((p) => {
      let s = p[1];
      for (const [cut, station] of [
        [board.cutStart, -board.length / 2],
        [board.cutEnd, board.length / 2],
      ]) {
        if (cut?.scheme !== "miter" || cut.plane !== "width") continue;
        const slope = Math.tan(((cut.angle ?? 0) * Math.PI) / 180) * (cut.tiltSign ?? 1);
        if (Math.abs(s - (station - half * slope)) < 1e-6) s += 2 * half * slope;
      }
      return [half, s, p[2]];
    });
    cells.push(prism(tri.map(world), other.map(world)));
  }
  geo.dispose();
  return cells;
}

// Union within the assembly, including overlaps between members, is removed once.
export function timberInside(cavities, boards) {
  const used = [];
  for (const board of boards)
    for (const b of board)
      for (const cavity of cavities) {
        const hit = intersect(b, cavity);
        if (hit) used.push(...subtractAll([hit], used));
      }
  return used.reduce((s, c) => s + volume(c), 0);
}

import assert from "node:assert/strict";
import * as T from "three";
import { cutGeometry } from "../src/board-geometry.js";
const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0),
  sub = (a, b) => a.map((v, k) => v - b[k]),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit = (a) => a.map((v) => v / Math.hypot(...a)),
  area = (P) =>
    Math.abs(
      P.reduce((s, q, i) => s + q[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * q[1], 0) / 2,
    );
function intersect(A, B) {
  let P = A;
  const signed = B.reduce((s, a, i) => s + a[0] * B[(i + 1) % 3][1] - B[(i + 1) % 3][0] * a[1], 0);
  if (signed < 0) B = B.toReversed();
  for (let i = 0; i < 3 && P.length; i++) {
    const a = B[i],
      b = B[(i + 1) % 3],
      side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]),
      R = [];
    for (let j = 0; j < P.length; j++) {
      const q = P[j],
        z = P[(j + 1) % P.length],
        f = side(q),
        g = side(z);
      if (f >= 0) R.push(q);
      if (f >= 0 !== g >= 0) {
        const t = f / (f - g);
        R.push(q.map((v, k) => v + (z[k] - v) * t));
      }
    }
    P = R;
  }
  return P.length >= 3 ? area(P) : 0;
}
function prisms(b) {
  const d = unit(sub(b.end, b.start)),
    x = unit(b.crossAxis),
    n = cross(x, d),
    C = b.start.map((v, k) => (v + b.end[k]) / 2),
    plane = b.shape?.plane ?? "depth",
    face = plane === "width" ? x : n,
    extrude = plane === "width" ? n : x,
    layers =
      b.shape?.type === "layeredProfile"
        ? b.shape.layers
        : [{ from: -b.b / 2000, to: b.b / 2000, points: b.shape?.points }];
  if (!layers[0].points) {
    const g = cutGeometry(b),
      p = g.getAttribute("position"),
      tri = [];
    for (let i = 0; i < p.count; i += 3) {
      if ([0, 1, 2].every((j) => Math.abs(p.getX(i + j) + b.b / 2000) < 1e-6))
        tri.push(
          [0, 1, 2].map((j) => {
            const s = p.getY(i + j),
              w = p.getZ(i + j);
            return [C[1] + d[1] * s + n[1] * w, C[2] + d[2] * s + n[2] * w];
          }),
        );
    }
    g.dispose();
    return [{ a: C[0] - b.b / 2000, z: C[0] + b.b / 2000, tri }];
  }
  assert.ok(Math.abs(extrude[0]) > 0.99999);
  return layers.map((l) => {
    const P = l.points.map(([s, w]) => [C[1] + d[1] * s + face[1] * w, C[2] + d[2] * s + face[2] * w]),
      ids = T.ShapeUtils.triangulateShape(
        P.map((q) => new T.Vector2(...q)),
        [],
      ),
      a = C[0] + extrude[0] * l.from,
      z = C[0] + extrude[0] * l.to;
    return { a: Math.min(a, z), z: Math.max(a, z), tri: ids.map((t) => t.map((i) => P[i])) };
  });
}
const overlap = (A, B) =>
  A.reduce(
    (v, a) =>
      v +
      B.reduce((s, b) => {
        const w = Math.min(a.z, b.z) - Math.max(a.a, b.a);
        return (
          s +
          (w > 1e-8
            ? w * a.tri.reduce((sum, ta) => sum + b.tri.reduce((r, tb) => r + intersect(ta, tb), 0), 0)
            : 0)
        );
      }, 0),
    0,
  );
export function checkGables(report) {
  const all = report.result.timber.instances,
    gables = all.filter((b) => b.zoneId?.startsWith("ORION-GABLE")),
    rafters = all.filter((b) => b.category === "roof" && b.role === "rafter");
  assert.equal(gables.length, 56);
  const pieces = gables.map(prisms),
    roof = rafters.map(prisms);
  let collision = 0,
    roofCollision = 0,
    meshError = 0,
    minY = Infinity,
    maxRoofIntrusion = -Infinity;
  for (let i = 0; i < gables.length; i++) {
    for (let j = 0; j < i; j++) collision += overlap(pieces[i], pieces[j]);
    for (const r of roof) roofCollision += overlap(pieces[i], r);
    const b = gables[i],
      g = cutGeometry(b),
      p = g.getAttribute("position"),
      d = unit(sub(b.end, b.start)),
      x = unit(b.crossAxis),
      n = cross(x, d),
      C = b.start.map((v, k) => (v + b.end[k]) / 2);
    let v = 0;
    for (let k = 0; k < p.count; k += 3) {
      const a = [p.getX(k), p.getY(k), p.getZ(k)],
        bb = [p.getX(k + 1), p.getY(k + 1), p.getZ(k + 1)],
        c = [p.getX(k + 2), p.getY(k + 2), p.getZ(k + 2)];
      v += dot(a, cross(bb, c)) / 6;
    }
    meshError = Math.max(meshError, Math.abs(v - b.volume));
    for (let k = 0; k < p.count; k++) {
      const w = C.map((v, j) => v + x[j] * p.getX(k) + d[j] * p.getY(k) + n[j] * p.getZ(k));
      minY = Math.min(minY, w[1]);
      maxRoofIntrusion = Math.max(
        maxRoofIntrusion,
        w[1] -
          (report.result.geometry.levels[0].topY + Math.min(w[2], 9 - w[2]) * Math.tan((20 * Math.PI) / 180)),
      );
    }
    g.dispose();
  }
  assert.ok(collision < 1e-6, `Gable overlap ${collision}m3`);
  assert.ok(roofCollision < 1e-6, `Rafter overlap ${roofCollision}m3`);
  assert.ok(meshError < 1e-7);
  assert.ok(Math.abs(minY - report.result.geometry.levels[0].topY) < 1e-6);
  assert.ok(maxRoofIntrusion < 0.00002);
  return {
    newPhysicalBoards: gables.length,
    mainRafters: rafters.length,
    gableOverlapM3: collision,
    rafterOverlapM3: roofCollision,
    maxMeshVolumeErrorM3: meshError,
    minimumY: minY,
    maxRoofIntrusionM: maxRoofIntrusion,
    geometryToleranceM: 0.00002,
    structurallyVerified: false,
  };
}

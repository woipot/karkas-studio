import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesignerProject } from "./designer-engine.js";
import { evaluateHouse } from "./house-engine.js";
import { cutGeometry } from "./board-geometry.js";

const EPS = 1e-6,
  rad = Math.PI / 180;
const near = (a, b, t = EPS) =>
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} != ${b}`);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0),
  sub = (a, b) => a.map((x, i) => x - b[i]);
const unit = (a) => a.map((x) => x / Math.hypot(...a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
function project(twoSlopes = false, angle = 0) {
  const p = structuredClone(defaultDesignerProject),
    poly = twoSlopes
      ? [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 4 },
          { x: 8, y: 4 },
          { x: 8, y: 8 },
          { x: 0, y: 8 },
        ]
      : rect(0, 0, 8, 4);
  p.floors = 1;
  p.levels = [];
  p.objects = [];
  p.openings = [];
  p.voids = [];
  p.bracing.method = "none";
  p.floor.section = "48x248";
  p.foundation.grillage = { ...p.foundation.grillage, section: "75x248", plies: 4, capSize: 350 };
  p.walls = poly.map((a, i) => ({
    id: `W${i}`,
    level: 1,
    a: { ...a },
    b: { ...poly[(i + 1) % poly.length] },
    kind: "exterior",
    section: "75x198",
    studStep: 0.6,
  }));
  if (twoSlopes)
    p.walls.push({
      id: "RIDGE",
      level: 1,
      a: { x: 0, y: 4 },
      b: { x: 8, y: 4 },
      kind: "bearing",
      section: "75x198",
      studStep: 0.6,
    });
  p.auxiliaryTimber = {
    enabled: true,
    roofCounter: "50x50",
    roofBattens: "50x100",
    roofInternal: "48x148",
    roofService: "45x45",
    roofAboveRafterGap: 0.075,
  };
  p.roof.type = "mono";
  p.roof.wallFraming = "continuous";
  const zone = {
    id: "N",
    name: "Counter end-plane QA",
    polygon: twoSlopes ? rect(0, 0, 12, 4) : rect(0, 0, 8, 4),
    shape: "mono",
    ridgeAngle: 0,
    pitchLeft: 25,
    pitchRight: 25,
    levelIndex: 1,
    elevation: null,
    spacing: 0.5,
    framing: "rafters",
    chordSection: "75x300",
    webSection: "48x98",
    overhangs: twoSlopes
      ? { low: 0.6, high: 0, start: 0.35, end: 0.45 }
      : { low: 0.2, high: 0.3, start: 0, end: 0 },
  };
  p.roof.zones = [zone];
  if (twoSlopes)
    p.roof.zones.push({
      ...structuredClone(zone),
      id: "S",
      name: "Opposing QA",
      polygon: rect(0, 4, 8, 8),
      ridgeAngle: 180,
      overhangs: { low: 0.4, high: 0, start: 0.35, end: 0.35 },
    });
  if (angle) {
    const c = Math.cos(angle * rad),
      s = Math.sin(angle * rad),
      rotate = (q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c });
    p.walls = p.walls.map((w) => ({ ...w, a: rotate(w.a), b: rotate(w.b) }));
    for (const z of p.roof.zones) {
      z.polygon = z.polygon.map(rotate);
      z.ridgeAngle = (z.ridgeAngle + angle) % 360;
    }
  }
  return p;
}
// Use the production mesh, including the actual miter, in its real world basis.
function vertices(board) {
  const axis = unit(sub(board.end, board.start)),
    width = unit(board.crossAxis.map((v, i) => v - dot(board.crossAxis, axis) * axis[i])),
    depth = cross(width, axis),
    mid = board.start.map((v, i) => (v + board.end[i]) / 2),
    geometry = cutGeometry(board),
    position = geometry.getAttribute("position"),
    out = [];
  for (let i = 0; i < position.count; i++)
    out.push(
      mid.map(
        (v, j) => v + width[j] * position.getX(i) + axis[j] * position.getY(i) + depth[j] * position.getZ(i),
      ),
    );
  geometry.dispose();
  return out;
}
function assertEndFace(board, plane, end) {
  assert.ok(plane, `${board.id}: missing ${end} reference plane`);
  const n = unit(plane.normal),
    points = vertices(board),
    signed = points.map((p) => dot(sub(p, plane.point), n)),
    extreme = end === "high" ? Math.max(...signed) : Math.min(...signed);
  near(extreme, 0); // Containment alone cannot detect a short but still inside rail.
  assert.ok(end === "high" ? Math.max(...signed) <= EPS : Math.min(...signed) >= -EPS, board.id);
  let faceArea = 0;
  for (let i = 0; i < points.length; i += 3)
    if (signed.slice(i, i + 3).every((s) => Math.abs(s) < EPS))
      faceArea += Math.hypot(...cross(sub(points[i + 1], points[i]), sub(points[i + 2], points[i]))) / 2;
  const axis = unit(sub(board.end, board.start)),
    expected = (board.b * board.h) / 1e6 / Math.abs(dot(axis, n));
  near(faceArea, expected, 1e-7); // A single touching edge is not a complete end face.
}
function auditCounters(report) {
  const sources = new Map(
      report.result.roofModel.instances.filter((b) => b.role === "rafter").map((b) => [b.id, b]),
    ),
    counters = report.result.timber.instances.filter((b) => b.role === "roofCounterBatten");
  assert.equal(counters.length, sources.size);
  for (const b of counters) {
    const source = sources.get(b.sourceMemberIds[0]);
    assert.ok(source, b.id);
    assertEndFace(b, source.startCutPlane, "low");
    assertEndFace(b, source.endCutPlane, "high");
    assert.ok(b.endCutPlane, `${b.id}: retain the explicit external boundary plane`);
    if (!source.rafterJointId)
      assert.equal(
        b.rafterJointId,
        undefined,
        "A plain roof boundary must not invent a supported ridge joint.",
      );
    near(b.length, Math.hypot(...sub(b.end, b.start)));
    near(b.mass, b.volume * report.project.material.density);
    assert.ok(b.cutLength > b.length);
    assert.equal(
      report.cutting.stocks.flatMap((s) => s.pieces).filter((p) => p.sourceId === b.id).length,
      1,
      b.id,
    );
  }
  return { sources, counters };
}

test("partial common ridge: every counter reaches both individual planes, including the eight unjoined northern rafters", () => {
  const report = evaluateHouse(project(true)),
    { sources, counters } = auditCounters(report),
    unjoined = counters.filter((b) => !sources.get(b.sourceMemberIds[0]).rafterJointId);
  assert.equal(counters.length, 42);
  assert.equal(unjoined.length, 8);
  assert.ok(unjoined.every((b) => b.zoneId === "N" && b.end[0] > 8));
  near(report.result.roofModel.projectedArea, 97.16);
  near(report.result.roofModel.area, 97.16 / Math.cos(25 * rad));
  for (const b of unjoined) near(b.end[2], 4);
});

test("standalone mono with a high overhang retains a real external end cut without a fictional ridge connection", () => {
  const report = evaluateHouse(project()),
    { counters } = auditCounters(report);
  assert.ok(counters.every((b) => b.rafterJointId === undefined));
  for (const b of counters) {
    near(b.start[2], -0.2);
    near(b.end[2], 4.3);
  }
  near(report.result.roofModel.projectedArea, 8 * 4.5);
  near(report.result.roofModel.area, (8 * 4.5) / Math.cos(25 * rad));
  const sources = new Map(
    report.result.roofModel.instances.filter((b) => b.role === "rafter").map((b) => [b.id, b]),
  );
  for (const b of report.result.timber.instances.filter((b) => b.role === "roofServiceBatten")) {
    const source = sources.get(b.sourceMemberIds[0]),
      axis = unit(sub(source.end, source.start)),
      normal = unit([axis[0], 0, axis[2]]);
    assertEndFace(b, { point: source.bearingEnd, normal }, "high");
    near(b.end[2], 4);
  }
});

for (const angle of [90, 180])
  test(`individual counter end planes remain correct after a ${angle} degree plan rotation`, () => {
    const report = evaluateHouse(project(false, angle)),
      { counters } = auditCounters(report),
      v = [-Math.sin(angle * rad), 0, Math.cos(angle * rad)];
    for (const b of counters) {
      near(dot(b.start, v), -0.2);
      near(dot(b.end, v), 4.3);
    }
    near(report.result.foundation.reactionSum, report.result.loads.totalDesign);
    assert.equal(report.cutting.summary.complete, true);
  });

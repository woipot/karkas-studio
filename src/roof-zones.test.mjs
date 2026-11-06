import test from "node:test";
import assert from "node:assert/strict";
import { calculateRoofZones, autoRoofZones } from "./roof-zones.js";
import { buildTruss } from "./trusses.js";
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const poly = (a) => a.map(([x, y]) => ({ x, y })),
  rect = (x0, y0, x1, y1) =>
    poly([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
const A = (p) =>
  Math.abs(p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0) / 2);
const P = rect(0, 0, 12, 8),
  L = poly([
    [0, 0],
    [12, 0],
    [12, 4],
    [8, 4],
    [8, 8],
    [0, 8],
  ]);
function inside(q, p) {
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length],
      c = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    if (
      Math.abs(c) < 1e-6 &&
      q.x >= Math.min(a.x, b.x) - 1e-6 &&
      q.x <= Math.max(a.x, b.x) + 1e-6 &&
      q.y >= Math.min(a.y, b.y) - 1e-6 &&
      q.y <= Math.max(a.y, b.y) + 1e-6
    )
      return true;
  }
  let t = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i],
      b = p[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) t = !t;
  }
  return t;
}
const project = () => ({
  height: 2.8,
  floors: 1,
  roof: { type: "fink", pitch: 25, spacing: 0.6, chordSection: "50x150", webSection: "50x100" },
  floor: { section: "50x250" },
  material: { density: 500, E: 10000, Ft: 8, Fc: 12 },
  loads: { roofDead: 0.5, snow: 1.5, gammaG: 1.1, gammaQ: 1.4 },
});
const run = (p = project(), polygon = P, extra = {}) =>
  calculateRoofZones(p, { geometry: { polygon, ...extra }, timber: { platformHeight: 0.285 } });

test("orthogonal L and T decomposition exactly covers the footprint without its missing wings", () => {
  for (const shape of [
    L,
    poly([
      [0, 0],
      [12, 0],
      [12, 4],
      [8, 4],
      [8, 9],
      [4, 9],
      [4, 4],
      [0, 4],
    ]),
  ]) {
    const z = autoRoofZones(shape);
    near(
      z.reduce((s, q) => s + A(q.polygon), 0),
      A(shape),
    );
    for (let x = 0.125; x < 12; x += 0.25)
      for (let y = 0.125; y < 9; y += 0.25)
        assert.equal(z.filter((q) => inside({ x, y }, q.polygon)).length, inside({ x, y }, shape) ? 1 : 0);
  }
});
test("symmetric rectangular gable has exact slope area, snow area, fascia, and board mass", () => {
  const r = run();
  assert.equal(r.zones.length, 1);
  near(r.projectedArea, 96);
  near(r.area, 96 / Math.cos((25 * Math.PI) / 180));
  near(r.snowEffectiveArea, 96 * 0.8);
  near(r.gableArea, 8 * 4 * Math.tan((25 * Math.PI) / 180));
  near(
    r.mass,
    r.instances.reduce((s, b) => s + b.volume * 500, 0),
  );
  near(
    r.volume,
    r.instances.reduce((s, b) => s + ((b.b * b.h) / 1e6) * b.length, 0),
  );
  assert.equal(r.zones[0].analysisApplicable, true);
});
test("different left/right slopes move the crest and produce weighted snow and actual roof area", () => {
  const p = project();
  p.roof.zones = [{ id: "asym", polygon: P, shape: "gable", ridgeAngle: 0, pitchLeft: 20, pitchRight: 40 }];
  const r = run(p),
    z = r.zones[0],
    tl = Math.tan((20 * Math.PI) / 180),
    tr = Math.tan((40 * Math.PI) / 180),
    h = (8 * tl * tr) / (tl + tr),
    left = h / tl;
  near(z.rise, h);
  near(z.crestRatio, left / 8);
  near(z.ridge.start[2], left);
  near(
    r.area,
    (12 * left) / Math.cos((20 * Math.PI) / 180) + (12 * (8 - left)) / Math.cos((40 * Math.PI) / 180),
  );
  near(r.snowEffectiveArea, 12 * (left * 0.8 + ((8 - left) * 0.8 * (60 - 40)) / 30));
  near(z.analysis.nodes.find((n) => n.id === "R").x, left);
  near(z.analysis.analysis.balanceMoment, 0);
});
test("mono keeps the real full-span pitch and has a genuinely different truss geometry", () => {
  const p = project();
  p.roof.zones = [{ id: "mono", polygon: P, shape: "mono", framing: "truss", pitchLeft: 15, pitchRight: 40 }];
  const r = run(p),
    z = r.zones[0];
  near(z.rise, 8 * Math.tan((15 * Math.PI) / 180));
  near(r.area, 96 / Math.cos((15 * Math.PI) / 180));
  assert.equal(z.analysis.type, "mono");
  assert.equal(z.analysisApplicable, true);
});
test("L plan auto roofing never emits surfaces or framing across the missing rectangle", () => {
  const r = run(project(), L);
  near(r.projectedArea, 80);
  assert.ok(r.zones.length > 1);
  for (const s of r.surfaces) for (const q of s.points) assert.ok(inside({ x: q[0], y: q[2] }, L));
  for (const b of r.instances)
    for (const t of [0, 0.25, 0.5, 0.75, 1])
      assert.ok(
        inside(
          { x: b.start[0] + (b.end[0] - b.start[0]) * t, y: b.start[2] + (b.end[2] - b.start[2]) * t },
          L,
        ),
      );
});
test("lower exposed wings get a lower roof, upper floor keeps its independent footprint", () => {
  const p = project();
  p.floors = 2;
  const upper = rect(0, 0, 8, 8),
    levels = [
      { index: 0, closed: true, polygon: P, topY: 3.805, height: 2.8 },
      { index: 1, closed: true, polygon: upper, topY: 6.89, height: 2.8 },
    ];
  const r = run(p, P, { levels, roofPolygon: upper });
  near(r.projectedArea, 96);
  const low = r.zones.filter((z) => nearValue(z.eave, 3.805)),
    high = r.zones.filter((z) => nearValue(z.eave, 6.89));
  assert.ok(low.length && high.length);
  near(
    low.reduce((s, z) => s + z.area, 0),
    32,
  );
  near(
    high.reduce((s, z) => s + z.area, 0),
    64,
  );
  for (const z of low) assert.ok(z.polygon.every((q) => q.x >= 8 - 1e-6));
});
function nearValue(a, b) {
  return Math.abs(a - b) < 1e-6;
}
test("explicit levelIndex binds null elevation to that floor, not the top floor", () => {
  const p = project();
  p.floors = 2;
  p.roof.zones = [{ id: "lower", polygon: rect(8, 0, 12, 8), levelIndex: 0, elevation: null }];
  const r = run(p, P, {
    levels: [
      { index: 0, closed: true, polygon: P, topY: 3.8 },
      { index: 1, closed: true, polygon: rect(0, 0, 8, 8), topY: 6.9 },
    ],
  });
  near(r.zones[0].eave, 3.8);
});
test("arbitrary ridge azimuth clips every physical axis and surface to the chosen polygon", () => {
  const p = project();
  p.roof.zones = [{ id: "diagonal", polygon: P, ridgeAngle: 33, pitchLeft: 25, pitchRight: 35 }];
  const r = run(p);
  assert.ok(r.instances.length > 0);
  assert.equal(r.zones[0].analysisApplicable, false);
  assert.equal(r.complete, false);
  near(
    r.surfaces.reduce((s, q) => s + q.projectedArea, 0),
    96,
  );
  for (const b of r.instances)
    for (const t of [0, 0.5, 1])
      assert.ok(
        inside(
          { x: b.start[0] + (b.end[0] - b.start[0]) * t, y: b.start[2] + (b.end[2] - b.start[2]) * t },
          P,
        ),
      );
});
test("rotated rectangle aligned to its ridge still has a full applicable truss", () => {
  const theta = 0.4,
    rot = P.map((q) => ({
      x: q.x * Math.cos(theta) - q.y * Math.sin(theta),
      y: q.x * Math.sin(theta) + q.y * Math.cos(theta),
    })),
    p = project();
  p.roof.zones = [{ id: "rotated", polygon: rot, ridgeAngle: (theta * 180) / Math.PI }];
  const r = run(p, rot);
  near(r.projectedArea, 96);
  near(r.zones[0].bounds.span, 8);
  assert.equal(r.zones[0].analysisApplicable, true);
});
test("overlapping manual zones fail explicitly and are not double-counted", () => {
  const p = project();
  p.roof.zones = [
    { id: "a", polygon: P },
    { id: "b", polygon: rect(4, 0, 12, 8) },
  ];
  const r = run(p),
    single = run();
  near(r.mass, single.mass);
  near(r.projectedArea, 96);
  assert.equal(r.zones.length, 1);
  assert.equal(r.complete, false);
  assert.equal(r.status, "fail");
  assert.ok(r.warnings.some((w) => w.includes("64.00")));
});
test("manual bounding-box roof spanning an L void is rejected instead of bridged", () => {
  const p = project();
  p.roof.zones = [{ id: "bad", polygon: P }];
  const r = run(p, L);
  assert.equal(r.instances.length, 0);
  assert.equal(r.status, "fail");
  assert.ok(r.warnings.some((w) => w.includes("вырез")));
});
test("hip has four actual planes and ridge at the real peak but stays structurally unverified", () => {
  const p = project();
  p.roof.zones = [{ id: "hip", polygon: P, shape: "hip" }];
  const r = run(p),
    z = r.zones[0];
  assert.equal(new Set(r.surfaces.map((s) => s.kind)).size, 4);
  near(r.gableArea, 0);
  assert.ok(r.instances.length > 0);
  near(z.ridge.start[1], z.eave + z.rise);
  near(z.ridge.end[1], z.eave + z.rise);
  assert.equal(z.analysisApplicable, false);
  assert.equal(r.complete, false);
});
test("explicit empty zones stays empty; corrupted zone records never throw", () => {
  const p = project();
  p.roof.zones = [];
  assert.equal(run(p).zones.length, 0);
  for (const zones of [
    [null],
    [42],
    [{ id: "x", polygon: [null, null, null] }],
    null,
    Array(101).fill({ id: "x", polygon: P }),
  ]) {
    p.roof.zones = zones;
    const r = run(p);
    assert.equal(r.status, "fail");
    assert.equal(r.complete, false);
    assert.ok(r.warnings.length > 0);
  }
});
test("crestRatio and per-slope snow retain finite FEM equilibrium for every pitched type", () => {
  for (const type of ["king", "queen", "fink"]) {
    const t = buildTruss({ type, crestRatio: 0.65, muLeft: 0.8, muRight: 0.4 });
    assert.equal(t.stable, true);
    near(t.nodes.find((n) => n.id === "R").x, 8 * 0.65);
    near(t.loads.snow, 1.5 * 0.6 * 8 * (0.65 * 0.8 + 0.35 * 0.4));
    near(t.analysis.balanceY, 0);
    near(t.analysis.balanceMoment, 0);
  }
});
test("nonorthogonal upper footprint is subtracted exactly from lower roofs", () => {
  const lower = poly([
      [0, 0],
      [12, 0],
      [0, 8],
    ]),
    upper = poly([
      [0, 0],
      [6, 0],
      [0, 4],
    ]),
    p = project();
  p.floors = 2;
  const r = run(p, lower, {
    levels: [
      { index: 1, closed: true, polygon: lower, topY: 3.8 },
      { index: 2, closed: true, polygon: upper, topY: 6.9 },
    ],
    roofPolygon: upper,
  });
  near(r.projectedArea, 48);
  near(
    r.zones.filter((z) => nearValue(z.eave, 3.8)).reduce((s, z) => s + z.area, 0),
    36,
  );
  near(
    r.zones.filter((z) => nearValue(z.eave, 6.9)).reduce((s, z) => s + z.area, 0),
    12,
  );
  assert.ok(!r.checks.some((c) => c.status === "fail" && !String(c.id).startsWith("drainage")));
});

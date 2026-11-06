import test from "node:test";
import assert from "node:assert/strict";
import { buildFloorPlatform } from "./floor-platform.js";
import { calculateDesigner, defaultDesignerProject, validateDesignerProject } from "./designer-engine.js";
import { checkDesignerMembers } from "./designer-mechanics.js";
import { calculateCutting } from "./cutting.js";
import { cutGeometry } from "./board-geometry.js";
const clone = structuredClone,
  near = (a, b, t = 1e-6) =>
    assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} ≠ ${b}`),
  sum = (a) => a.reduce((s, x) => s + x, 0);
const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
function make(poly = rect(0, 0, 12, 8), floors = 2) {
  const p = clone(defaultDesignerProject);
  p.floor = { ...p.floor, section: "48x248" };
  p.foundation.grillage = { ...p.foundation.grillage, section: "75x248", plies: 4, capSize: 350 };
  p.openings = [];
  p.roof.type = "none";
  p.objects = [];
  p.floors = floors;
  p.bracing.method = "none";
  p.walls = [];
  for (let level = 1; level <= floors; level++)
    p.walls.push(
      ...poly.map((a, i) => ({
        id: `L${level}-W${i}`,
        level,
        a,
        b: poly[(i + 1) % poly.length],
        kind: "exterior",
        section: "48x198",
        studStep: 0.6,
      })),
    );
  return p;
}
function bearing(p, level, y = 4, end = 12) {
  p.walls.push({
    id: "L" + level + "-B",
    level,
    a: { x: 0, y },
    b: { x: end, y },
    kind: "bearing",
    section: "48x198",
    studStep: 0.6,
  });
}
function makeL() {
  const p = make([
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 4 },
    { x: 8, y: 4 },
    { x: 8, y: 8 },
    { x: 0, y: 8 },
  ]);
  bearing(p, 1, 4, 8);
  bearing(p, 2, 4, 8);
  p.voids = [
    { id: "LIGHT", level: 2, kind: "doubleHeight", polygon: rect(0.6, 0.4, 3.4, 3), edgeSection: "75x248" },
    { id: "STAIR", level: 2, kind: "stair", polygon: rect(3.8, 0.8, 7, 3), edgeSection: "75x248" },
  ];
  return p;
}
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  signed = (p) => sum(p.map((a, i) => a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y)) / 2;
function hull(points) {
  const p = points.sort((a, b) => a.x - b.x || a.y - b.y),
    half = (p) => {
      const h = [];
      for (const q of p) {
        while (h.length > 1 && cross(h.at(-2), h.at(-1), q) < 1e-8) h.pop();
        h.push(q);
      }
      return h;
    };
  return half(p)
    .slice(0, -1)
    .concat(half([...p].reverse()).slice(0, -1));
}
// Use the actual renderer's cut geometry, not the platform generator's clipping.
function meshPlan(b) {
  const g = cutGeometry(b),
    p = g.attributes.position,
    u = b.end.map((x, i) => (x - b.start[i]) / b.length),
    v = b.crossAxis,
    points = [];
  for (let i = 0; i < p.count; i++)
    points.push({
      x: (b.start[0] + b.end[0]) / 2 + v[0] * p.getX(i) + u[0] * p.getY(i),
      y: (b.start[2] + b.end[2]) / 2 + v[2] * p.getX(i) + u[2] * p.getY(i),
    });
  g.dispose();
  return hull(points);
}
function overlap(A, B) {
  let p = A;
  for (let j = 0; j < B.length; j++) {
    const a = B[j],
      b = B[(j + 1) % B.length],
      next = [];
    for (let i = 0; i < p.length; i++) {
      const q = p[i],
        r = p[(i + 1) % p.length],
        f = cross(a, b, q),
        g = cross(a, b, r);
      if (f >= 0) next.push(q);
      if (f >= 0 !== g >= 0) {
        const t = f / (f - g);
        next.push({ x: q.x + (r.x - q.x) * t, y: q.y + (r.y - q.y) * t });
      }
    }
    p = next;
    if (p.length < 3) return 0;
  }
  return Math.abs(signed(p));
}
const physical = (r) =>
  r.timber.instances.filter((b) =>
    ["rimJoist", "joist", "floorBlocking", "openingTrimmer", "openingHeader"].includes(b.role),
  );

test("nullable auto sections and 0.3…3m blocking rows validate; missing legacy fields migrate", () => {
  const p = make();
  assert.equal(validateDesignerProject(p).valid, true);
  for (const [key, value] of [
    ["blockingStep", 0.299],
    ["blockingStep", 3.001],
    ["blocking", 1],
    ["rimSection", "50x200"],
    ["blockingSection", "25x100"],
  ]) {
    const q = clone(p);
    q.floor[key] = value;
    assert.equal(validateDesignerProject(q).valid, false, `${key}:${value}`);
  }
  delete p.floor.rimSection;
  delete p.floor.blockingSection;
  delete p.floor.blocking;
  delete p.floor.blockingStep;
  const r = calculateDesigner(p);
  assert.equal(r.project.floor.blocking, true);
  near(r.project.floor.blockingStep, 1.2);
  assert.equal(r.floorPlatform.levels.length, 2);
});

test("both L platforms have one closed rim with real width mitres and no frame/joist/block overlaps", () => {
  const p = makeL(),
    r = calculateDesigner(p),
    boards = physical(r).map((b) => ({ ...b, poly: meshPlan(b) }));
  assert.equal(r.floorPlatform.levels.length, 2);
  for (const l of r.floorPlatform.levels) near(l.quantities.rimLength, 40.6);
  near(r.floorPlatform.quantities.rimLength, 81.2);
  assert.ok(
    boards.some(
      (b) => b.role === "rimJoist" && b.cutStart.scheme === "miter" && b.cutStart.plane === "width",
    ),
  );
  for (let i = 0; i < boards.length; i++)
    for (let j = 0; j < i; j++)
      if (boards[i].level === boards[j].level)
        assert.ok(
          overlap(boards[i].poly, boards[j].poly) < 1e-6,
          `${boards[i].id} intersects ${boards[j].id}`,
        );
  for (const b of boards) {
    const level = r.geometry.levels.find((l) => l.index === b.level);
    near(b.start[1] + b.h / 2000, level.baseY + 0.248);
    near(b.volume, (b.b * b.h * b.length) / 1e6);
    near(b.mass, b.volume * p.material.density);
  }
  assert.equal(
    r.floorPlatform.checks.some((c) => c.status === "fail"),
    false,
  );
});

test("physical joist ends meet rim faces while bending uses real support axes", () => {
  const p = make();
  bearing(p, 1);
  const r = calculateDesigner(p),
    j = r.floorPlatform.instances.find((b) => b.role === "joist" && b.level === 2 && b.start[2] < 0.1);
  assert.ok(j);
  near(j.start[2], -0.051);
  near(j.end[2], 4);
  near(j.length, 4.051);
  near(j.analyticalSpan, 4);
  near(j.supportStart.point.y, 0);
  near(j.supportEnd.point.y, 4);
  const m = checkDesignerMembers(p, r).joist.members.find((m) => m.platformSpanId === j.id);
  near(m.span, 4);
  near(m.length, 4.051);
  const M = (m.lineLoadDesign * 4 ** 2) / 8;
  near(m.moment, M);
  assert.ok(m.moment < (m.lineLoadDesign * j.length ** 2) / 8);
  assert.ok(j.physicalOverhangStart > 0);
});

test("only lower-floor bearing walls support upper joists; current upper wall never creates a prop", () => {
  const p = make();
  bearing(p, 2);
  const r = calculateDesigner(p),
    upper = r.floorPlatform.spans.filter((s) => s.level === 2);
  assert.ok(upper.length);
  assert.ok(upper.every((s) => Math.abs(s.analyticalSpan - 8) < 1e-7));
  assert.ok(r.floorPlatform.supports.filter((s) => s.level === 2).every((s) => s.wallLevel === 1));
  assert.ok(!r.floorPlatform.supports.some((s) => s.id === "L2-B"));
  bearing(p, 1);
  const q = calculateDesigner(p);
  assert.ok(q.floorPlatform.spans.filter((s) => s.level === 2).every((s) => s.analyticalSpan <= 4 + 1e-7));
  assert.ok(
    q.floorPlatform.spans
      .filter((s) => s.level === 1)
      .every((s) => s.analyticalSpan <= p.foundation.spacing + 1e-7),
  );
});

test("six-metre stock and blocking do not split a real unsupported eight-metre upper span", () => {
  const p = make(),
    r = calculateDesigner(p),
    upper = r.timber.instances.filter((b) => b.role === "joist" && b.level === 2);
  assert.ok(upper.every((b) => b.analyticalSpan === 8 && b.length > 6 && b.requireSingleStock));
  assert.ok(upper.every((b) => !b.spliceIds?.length));
  assert.ok(r.floorPlatform.checks.find((c) => c.id === "floor-stock-L2").failIds.length);
  const a = checkDesignerMembers(p, r).joist;
  p.floor.blockingStep = 0.5;
  const s = calculateDesigner(p),
    b = checkDesignerMembers(p, s).joist;
  near(a.span, 8);
  near(b.span, 8);
  assert.ok(s.floorPlatform.quantities.blockingLength > r.floorPlatform.quantities.blockingLength);
  assert.ok(b.moment >= a.moment);
  assert.ok(b.geometricUnbracedLength < a.geometricUnbracedLength);
  assert.ok(
    s.floorPlatform.checks.some((c) => c.id === "floor-platform-connections" && c.status === "unverified"),
  );
});

test("full-depth blocking connects actual neighboring faces, avoids holes, and is never a vertical support", () => {
  const p = makeL(),
    r = calculateDesigner(p),
    blocks = r.floorPlatform.instances.filter((b) => b.role === "floorBlocking"),
    all = new Map(physical(r).map((b) => [b.id, b]));
  assert.ok(blocks.length > 60);
  for (const b of blocks) {
    assert.equal(b.h, 248);
    assert.equal(b.lateralRestraintOnly, true);
    assert.equal(b.verticalSupport, false);
    const left = all.get(b.supports[0].memberIds[0]),
      right = all.get(b.supports[1].memberIds[0]);
    assert.ok(left && right);
    near(b.start[0], left.start[0] + left.b / 2000);
    near(b.end[0], right.start[0] - right.b / 2000);
    for (const v of p.voids.filter((v) => v.level === b.level))
      assert.ok(overlap(meshPlan(b), v.polygon) < 1e-7);
  }
  assert.ok(
    r.floorPlatform.spans.every(
      (s) =>
        !["floorBlocking", "blocking"].includes(s.supportStart.kind) &&
        !["floorBlocking", "blocking"].includes(s.supportEnd.kind),
    ),
  );
  assert.ok(r.floorPlatform.levels.every((l) => l.maxGeometricUnbraced <= p.floor.blockingStep + 1e-7));
});

test("disabling blocking leaves identical support spans and removes only its actual mass", () => {
  const p = make();
  bearing(p, 1);
  const a = calculateDesigner(p);
  p.floor.blocking = false;
  const b = calculateDesigner(p);
  assert.deepEqual(a.floorPlatform.spans, b.floorPlatform.spans);
  assert.equal(b.floorPlatform.instances.filter((b) => b.role === "floorBlocking").length, 0);
  const removed = sum(a.floorPlatform.instances.filter((b) => b.role === "floorBlocking").map((b) => b.mass));
  near(a.timber.mass - b.timber.mass, removed);
  near(a.loads.totalCharacteristic - b.loads.totalCharacteristic, (removed * 9.80665) / 1000);
  assert.equal(b.floorPlatform.checks.find((c) => c.id === "floor-blocking-L2").status, "unverified");
});

test("a floating beam at the platform elevation is excluded; actual supported beam can divide a span", () => {
  const p = make();
  p.objects = [
    {
      id: "BEAM",
      type: "beam",
      level: 1,
      a: { x: 0, y: 4 },
      b: { x: 12, y: 4 },
      section: "50x250",
      elevation: p.height - 0.125,
    },
  ];
  let r = calculateDesigner(p);
  assert.ok(r.floorPlatform.checks.some((c) => c.id === "floor-floating-beam-BEAM"));
  assert.ok(r.floorPlatform.spans.filter((s) => s.level === 2).every((s) => s.analyticalSpan === 8));
  p.objects.push(
    ...[0, 12].map((x, i) => ({
      id: "POST" + i,
      type: "post",
      level: 1,
      a: { x, y: 4 },
      section: "100x100",
      height: p.height - 0.25,
      elevation: 0,
    })),
  );
  r = calculateDesigner(p);
  assert.ok(r.floorPlatform.supports.some((s) => s.id === "BEAM" && s.kind === "explicitBeam"));
  assert.ok(r.floorPlatform.spans.filter((s) => s.level === 2).every((s) => s.analyticalSpan <= 4 + 1e-7));
});

test("load passing above a lower door remains an unknown header path with opening IDs", () => {
  const p = make();
  bearing(p, 1);
  p.openings = [
    { id: "B-DOOR", wallId: "L1-B", floor: 1, offset: 4, width: 1.2, height: 2.1, sill: 0, type: "door" },
  ];
  const r = calculateDesigner(p),
    c = r.floorPlatform.checks.find((c) => c.id === "floor-bearing-openings-L2");
  assert.ok(c);
  assert.equal(c.status, "unverified");
  assert.deepEqual(c.sourceWallOpeningIds, ["B-DOOR"]);
  assert.ok(c.memberIds.length);
  assert.ok(r.floorPlatform.spans.filter((s) => s.level === 2).every((s) => s.analyticalSpan <= 4 + 1e-7));
});

test("floor physical boards, load row, stock schedule and pile equilibrium count each board once", () => {
  const p = makeL(),
    r = calculateDesigner(p),
    floor = r.timber.instances.filter((b) => b.category === "floor"),
    cutting = calculateCutting(p, r),
    ids = cutting.stocks.flatMap((s) => s.pieces.map((q) => q.sourceId));
  assert.equal(new Set(r.timber.instances.map((b) => b.id)).size, r.timber.instances.length);
  near(r.timber.totals.floor.mass, sum(floor.map((b) => b.mass)));
  near(r.timber.totals.floor.volume, sum(floor.map((b) => b.volume)));
  near(
    r.loads.rows.find((q) => q.id === "timber-floor").characteristic,
    (sum(floor.map((b) => b.mass)) * 9.80665) / 1000,
  );
  for (const b of floor) assert.equal(ids.filter((id) => id === b.id).length, 1, b.id);
  near(r.foundation.reactionSum, r.loads.totalDesign);
  near(r.foundation.balanceError, 0);
  for (const l of r.floorPlatform.levels)
    near(
      l.quantities.mass,
      sum(r.floorPlatform.instances.filter((b) => b.level === l.index).map((b) => b.mass)),
    );
});

test("rotating axes swaps support geometry, rims and transverse blocking consistently", () => {
  const p = makeL(),
    a = calculateDesigner(p);
  for (const w of p.walls) {
    w.a = { x: w.a.y, y: w.a.x };
    w.b = { x: w.b.y, y: w.b.x };
  }
  for (const v of p.voids) for (const q of v.polygon) [q.x, q.y] = [q.y, q.x];
  p.floor.axis = "x";
  const b = calculateDesigner(p);
  near(a.floorPlatform.quantities.rimLength, b.floorPlatform.quantities.rimLength);
  near(a.floorPlatform.quantities.joistLength, b.floorPlatform.quantities.joistLength);
  near(a.floorPlatform.quantities.blockingLength, b.floorPlatform.quantities.blockingLength);
  near(a.floorPlatform.quantities.mass, b.floorPlatform.quantities.mass);
  assert.equal(
    b.floorPlatform.checks.some((c) => c.status === "fail"),
    false,
  );
});

test("malformed standalone input returns an explicit input failure without NaN", () => {
  const r = buildFloorPlatform(
    { floor: { section: "bad", spacing: 0.6 }, material: { density: 500 } },
    { geometry: { levels: [] } },
  );
  assert.equal(r.status, "fail");
  assert.equal(r.instances.length, 0);
  assert.ok(r.checks.some((c) => c.status === "fail"));
});

test("roof gravity reactions route to real bearings, preserve unequal A/B and transverse row widths", () => {
  const p = make(rect(0, 0, 8, 4), 1);
  p.roof.type = "mono";
  p.loads.roofDead = 0;
  p.loads.snow = 0;
  const base = calculateDesigner(p),
    rafters = [1, 7].map((x, i) => ({
      id: "ROOF" + i,
      zoneId: "Z",
      role: "rafter",
      b: 50,
      h: 150,
      start: [x, 3, -0.6],
      end: [x, 5.1, 4],
      bearingStart: [x, 3.273913, 0],
      bearingEnd: [x, 5.1, 4],
      supportStart: [x, 3.273913, 0],
      supportEnd: [x, 5.1, 4],
      supportLowStation: 0.6,
      supportHighStation: 4.6,
      tributaryWidth: i ? 3 : 1,
      crossAxis: [1, 0, 0],
    })),
    roof = {
      instances: rafters,
      area: 40,
      projectedArea: 36.8,
      snowEffectiveArea: 0,
      gableArea: 0,
      zones: [
        {
          id: "Z",
          effectiveFraming: "rafters",
          analysisApplicable: true,
          ridgeAngle: 0,
          bounds: { minU: 0, maxU: 8 },
          surfaceArea: 40,
          snowEffectiveArea: 0,
          rafterAnalysis: {
            reactions: { serviceVerticalA: 6.5, serviceVerticalB: 3.5, verticalA: 8, verticalB: 4 },
          },
        },
      ],
      checks: [],
      assumptions: [],
      warnings: [],
      status: "unverified",
    };
  const r = calculateDesigner(p, { roofModel: roof }),
    W = r.timber.totals.roof.weight * p.loads.gammaG,
    previous = new Map(base.piles.map((q) => [q.id, q])),
    delta = r.piles.map((q) => ({ x: q.x, y: q.y, P: q.reaction - previous.get(q.id).reaction }));
  near(sum(delta.map((q) => q.P)), W);
  near(sum(delta.map((q) => q.P * q.y)), W * (0.65 * 0 + 0.35 * 4));
  near(sum(delta.map((q) => q.P * q.x)), W * (0.25 * 1 + 0.75 * 7));
  for (const b of r.timber.instances.filter((b) => b.role === "rafter")) {
    assert.ok(b.bearingStart && b.bearingEnd);
    assert.equal(b.bearingStart[2], 0);
    assert.equal(b.bearingEnd[2], 4);
    assert.ok([1, 3].includes(b.tributaryWidth));
  }
  near(r.foundation.balanceError, 0);
});

test("collinear thickness changes retain distinct exterior faces and explicit stepped rim joints", () => {
  const p = make(rect(0, 0, 12, 8), 1),
    north = p.walls.find((w) => w.id === "L1-W0");
  p.walls = p.walls.filter((w) => w !== north);
  p.walls.push(
    { ...north, id: "N150", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, section: "48x150" },
    { ...north, id: "N198", a: { x: 6, y: 0 }, b: { x: 12, y: 0 }, section: "48x198" },
  );
  const r = calculateDesigner(p),
    l = r.floorPlatform.levels[0],
    a = l.rimSegments.find((s) => s.wallId === "N150"),
    b = l.rimSegments.find((s) => s.wallId === "N198");
  assert.ok(a && b);
  near(a.outerStart.y, -0.075);
  near(b.outerStart.y, -0.099);
  near(a.outwardOffset, 0.051);
  near(b.outwardOffset, 0.075);
  assert.ok(l.outerPolygon.some((q) => Math.abs(q.x - 6) < 1e-7 && Math.abs(q.y + 0.075) < 1e-7));
  assert.ok(l.outerPolygon.some((q) => Math.abs(q.x - 6) < 1e-7 && Math.abs(q.y + 0.099) < 1e-7));
  assert.ok(
    r.floorPlatform.checks.some((c) => c.id === "floor-thickness-steps-L1" && c.status === "unverified"),
  );
  const boards = physical(r).map((b) => ({ ...b, poly: meshPlan(b) }));
  for (let i = 0; i < boards.length; i++)
    for (let j = 0; j < i; j++)
      assert.ok(overlap(boards[i].poly, boards[j].poly) < 1e-6, boards[i].id + " / " + boards[j].id);
});

test("a narrower lower frame gives partial band contact rather than a false complete bearing pass", () => {
  const p = make();
  for (const w of p.walls.filter((w) => w.level === 1)) w.section = "48x150";
  const r = calculateDesigner(p),
    upper = r.floorPlatform.levels.find((l) => l.index === 2);
  assert.ok(upper.rimSegments.some((s) => s.bearing.status === "unverified" && s.bearing.coverageRatio < 1));
  assert.equal(r.floorPlatform.checks.find((c) => c.id === "floor-rim-bearing-L2").status, "unverified");
  assert.ok(upper.rimSegments.every((s) => s.bearing.cornerContactVerified === false));
});

test("a collapsed concave offset is rejected and exposes incomplete platform quantities", () => {
  const p = make(
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 4.105, y: 6 },
      { x: 4.105, y: 1 },
      { x: 3.895, y: 1 },
      { x: 3.895, y: 6 },
      { x: 0, y: 6 },
    ],
    1,
  );
  for (const w of p.walls) w.section = "48x300";
  const r = calculateDesigner(p);
  assert.equal(r.geometry.platformAreaComplete, false);
  assert.equal(r.geometry.platformContours[0].valid, false);
  assert.equal(r.geometry.platformContours[0].grossArea, null);
  assert.ok(r.floorPlatform.checks.some((c) => c.id === "floor-contour-L1" && c.status === "fail"));
  assert.equal(r.floorPlatform.instances.length, 0);
  assert.equal(r.loads.complete, false);
  assert.ok(r.loads.missingLoads.some((s) => s.includes("платформы")));
});

test("physical end consoles stay integral and blocking respects the physical row length at exact step multiples", () => {
  const p = make(rect(0, 0, 8, 4.8));
  const r = calculateDesigner(p);
  for (const j of r.floorPlatform.instances.filter((b) => b.role === "joist")) {
    assert.ok(j.analyticalSpan > 1e-7);
    assert.ok(j.geometricUnbracedLength <= 1.2 + 1e-7);
  }
  for (const l of r.floorPlatform.levels)
    assert.equal(r.floorPlatform.checks.find((c) => c.id === "floor-blocking-L" + l.index).status, "pass");
  const upper = r.floorPlatform.instances.filter((b) => b.role === "joist" && b.level === 2);
  assert.ok(upper.every((j) => j.physicalOverhangStart > 0 && j.physicalOverhangEnd > 0));
  assert.ok(upper.every((j) => j.length > j.analyticalSpan));
});

test("offset edges that only touch nonadjacent edges are invalid rather than a zero-width deck passage", () => {
  const p = make(
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 4.15, y: 6 },
      { x: 4.15, y: 1 },
      { x: 3.85, y: 1 },
      { x: 3.85, y: 6 },
      { x: 0, y: 6 },
    ],
    1,
  );
  for (const w of p.walls) w.section = "48x300";
  const r = calculateDesigner(p);
  assert.equal(r.geometry.platformAreaComplete, false);
  assert.equal(r.geometry.platformContours[0].valid, false);
  assert.ok(r.floorPlatform.checks.some((c) => c.status === "fail"));
});

test("edge-joist support traces distinguish the crossing grid axis from physical contact with a longitudinal grillage", () => {
  const p = make(rect(0, 0, 8, 4), 1),
    r = calculateDesigner(p),
    j = r.floorPlatform.instances.find(
      (b) =>
        b.role === "joist" &&
        b.edgeJoist &&
        [b.supportStart, b.supportEnd].some((s) => !s.sourceDirectContact),
    ),
    supports = [j?.supportStart, j?.supportEnd].filter(
      (s) => s?.contactBeamIds?.length && !s.sourceDirectContact,
    );
  assert.ok(j && supports.length);
  for (const s of supports) {
    assert.equal(s.analyticalSourceId, s.sourceId);
    assert.ok(!s.contactBeamIds.includes(s.sourceId));
    assert.equal(s.nodeTransferVerified, false);
    assert.ok(
      s.contactBeamIds.every((id) =>
        r.grillageModel.instances.some((b) => b.beamId === id && s.contactBoardIds.includes(b.id)),
      ),
    );
    assert.ok(s.sourceIdMeaning.includes("analytical"));
  }
  assert.ok(
    r.floorPlatform.checks.some(
      (c) => c.id === "floor-grillage-node-transfer-L1" && c.status === "unverified",
    ),
  );
});

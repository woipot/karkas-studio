import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesignerProject, calculateDesigner } from "./designer-engine.js";
import { calculateRoofZones } from "./roof-zones.js";
import { calculateRafter, solveUniformOverhangBeam } from "./rafters.js";
import { calculateCutting } from "./cutting.js";
import { cutGeometry } from "./board-geometry.js";
const clone = (x) => JSON.parse(JSON.stringify(x)),
  near = (a, b, t = 1e-6) =>
    assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} != ${b}`),
  sum = (a) => a.reduce((s, x) => s + x, 0),
  dot = (a, b) => sum(a.map((v, i) => v * b[i])),
  sub = (a, b) => a.map((v, i) => v - b[i]),
  unit = (a) => a.map((v) => v / Math.hypot(...a)),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function vertices(b) {
  const d = unit(sub(b.end, b.start)),
    w = b.crossAxis,
    x = unit(w.map((v, i) => v - dot(w, d) * d[i])),
    z = cross(x, d),
    mid = b.start.map((v, i) => (v + b.end[i]) / 2),
    g = cutGeometry(b),
    p = g.getAttribute("position"),
    a = [];
  for (let i = 0; i < p.count; i++)
    a.push(mid.map((v, j) => v + x[j] * p.getX(i) + d[j] * p.getY(i) + z[j] * p.getZ(i)));
  g.dispose();
  return a;
}
function project(overhangs = { low: 0.6, high: 0, start: 0.35, end: 0.45 }) {
  const p = clone(defaultDesignerProject),
    P = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 4 },
      { x: 0, y: 4 },
    ];
  p.walls = P.map((a, i) => ({
    id: "w" + i,
    a,
    b: P[(i + 1) % 4],
    kind: "exterior",
    section: "75x198",
    studStep: 0.6,
    level: 1,
  }));
  p.foundation.grillage = { ...p.foundation.grillage, section: "75x248", plies: 4, capSize: 350 };
  p.openings = [];
  p.auxiliaryTimber = { enabled: true, roofBattens: "50x100", roofAboveRafterGap: 0.075 };
  p.roof.wallFraming = "continuous";
  p.roof.zones = [
    {
      id: "z",
      name: "Test mono",
      polygon: P,
      shape: "mono",
      ridgeAngle: 0,
      pitchLeft: 25,
      pitchRight: 25,
      levelIndex: 1,
      elevation: null,
      spacing: 0.5,
      chordSection: "75x248",
      webSection: "48x98",
      framing: "rafters",
      overhangs,
    },
  ];
  return p;
}
function calculate(p) {
  const base = calculateDesigner(p),
    roof = calculateRoofZones(p, base),
    r = calculateDesigner(p, { roofModel: roof });
  return { base, roof, r, z: roof.zones[0], cut: calculateCutting(p, r) };
}
function twoSlopes() {
  const p = project(),
    P = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 4 },
      { x: 8, y: 4 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ];
  p.walls = P.map((a, i) => ({
    id: "L" + i,
    a,
    b: P[(i + 1) % 6],
    kind: "exterior",
    section: "75x198",
    studStep: 0.6,
    level: 1,
  }));
  p.walls.push({
    id: "ridge",
    a: { x: 0, y: 4 },
    b: { x: 8, y: 4 },
    kind: "bearing",
    section: "75x198",
    studStep: 0.6,
    level: 1,
  });
  const base = p.roof.zones[0];
  p.roof.zones = [
    {
      ...clone(base),
      id: "N",
      polygon: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 4 },
        { x: 0, y: 4 },
      ],
      overhangs: { low: 0.6, high: 0, start: 0.35, end: 0.45 },
    },
    {
      ...clone(base),
      id: "S",
      polygon: [
        { x: 0, y: 4 },
        { x: 8, y: 4 },
        { x: 8, y: 8 },
        { x: 0, y: 8 },
      ],
      ridgeAngle: 180,
      overhangs: { low: 0.4, high: 0, start: 0.35, end: 0.35 },
    },
  ];
  return p;
}

test("independent 1kN/m beam with symmetric 1m consoles: RA/RB3, M−.5/+1.5, centre7mm and free-end−4.625mm", () => {
  const b = solveUniformOverhangBeam({
    length: 6,
    supportA: 1,
    supportB: 5,
    qService: 1,
    qDesign: 1,
    E: 10000,
    I: (50 * 200 ** 3) / 12,
  });
  near(b.reactionA, 3);
  near(b.reactionB, 3);
  near(b.momentNegative, -0.5);
  near(b.momentPositive, 1.5);
  near(b.maxDeflection, 7);
  near(b.at(3).deflection, 7);
  near(b.at(0).deflection, -4.625);
  near(b.at(1).deflection, 0);
  near(b.at(5).deflection, 0);
});
test("free-tip point load with one-metre backspan retains negative reaction and has exact2mm tip displacement", () => {
  const b = solveUniformOverhangBeam({
    length: 2,
    supportA: 1,
    supportB: 2,
    qService: 0,
    qDesign: 0,
    E: 10000,
    I: (50 * 200 ** 3) / 12,
    pointLoads: [{ s: 0, service: 1, design: 1 }],
  });
  near(b.reactionA, 2);
  near(b.reactionB, -1);
  near(b.at(1).moment, -1);
  near(b.at(0).deflection, 2);
  near(b.totalDesign, 1);
});
test("inclined overhang beam uses real bearing stations, signed hogging, asymmetric reactions and zero vertical support displacement", () => {
  const a = calculateRafter({
    horizontalSpan: 4,
    pitch: 25,
    b: 75,
    h: 248,
    overhangLow: 0.6,
    overhangHigh: 0.2,
  });
  near(a.slopeLength, 4.8 / Math.cos((25 * Math.PI) / 180));
  near(a.mass, a.volume * a.density);
  near(a.reactions.verticalA + a.reactions.verticalB, a.loads.totalDesign);
  assert.ok(a.reactions.verticalA > a.reactions.verticalB);
  assert.ok(a.momentNegative < 0);
  assert.ok(a.diagrams.some((x) => x.horizontal < 0 && x.M < 0));
  for (const station of [a.supportLowStation, a.supportHighStation])
    near(a.diagrams.find((x) => Math.abs(x.s - station) < 1e-8).verticalDeflection, 0);
  assert.equal(a.maxSpan, null);
});
test("excessive unbalanced cantilever never clamps uplift or approves an unsupported hold-down", () => {
  const a = calculateRafter({ horizontalSpan: 0.5, pitch: 10, overhangLow: 2, b: 75, h: 248 });
  assert.ok(a.reactions.verticalB < 0);
  assert.equal(a.capacityPass, false);
  assert.equal(a.checks.find((x) => x.id === "rafter-overhang-uplift").status, "fail");
  near(a.reactions.verticalA + a.reactions.verticalB, a.loads.totalDesign);
});
test("four independent horizontal eaves change cover area while bearing polygon, wall profiles and support lines stay fixed", () => {
  const p = project(),
    a = calculate(project({ low: 0, high: 0, start: 0, end: 0 })),
    b = calculate(p);
  near(b.roof.projectedArea, 8.8 * 4.6);
  near(b.roof.area, (8.8 * 4.6) / Math.cos((25 * Math.PI) / 180));
  near(b.z.bounds.length, 8);
  near(b.z.bounds.span, 4);
  assert.deepEqual(b.z.polygon, a.z.polygon);
  near(b.r.geometry.area, a.r.geometry.area);
  near(b.r.geometry.totalFloorArea, a.r.geometry.totalFloorArea);
  assert.deepEqual(
    b.roof.wallProfiles.map((x) => x.topSamples),
    a.roof.wallProfiles.map((x) => x.topSamples),
  );
  for (const raw of b.roof.instances.filter((x) => x.role === "rafter")) {
    near(raw.start[2], -0.6);
    near(raw.bearingStart[2], 0);
    near(raw.bearingEnd[2], 4);
    near(raw.end[2], 4);
    near(raw.length, 4.6 / Math.cos((25 * Math.PI) / 180));
    assert.ok(raw.cutLength > raw.length);
    assert.equal(raw.requireSingleStock, true);
  }
  assert.ok(b.z.rafterSupports.every((s) => Math.abs(s.axis[2]) < 1e-6 || Math.abs(s.axis[2] - 4) < 1e-6));
  near(sum(b.z.rafterRowLoads.map((x) => x.tributaryWidth)), 8.8);
  assert.ok(b.z.analysisSpacing > b.z.actualSpacing);
});
test("actual geometry and all stock blanks remain inside the requested cover, with thermal service rows inside bearing limits", () => {
  const p = project(),
    { roof, r, z, cut } = calculate(p);
  for (const board of [
    ...roof.instances.filter((x) => x.role === "rafter"),
    ...r.auxiliaryTimber.instances.filter((x) => x.category === "roof"),
  ])
    for (const v of vertices(board)) {
      assert.ok(v[0] >= z.coverBounds.minU - 1e-6 && v[0] <= z.coverBounds.maxU + 1e-6, board.id);
      assert.ok(v[2] >= z.coverBounds.minV - 1e-6 && v[2] <= z.coverBounds.maxV + 1e-6, board.id);
      if (["roofInternalBatten", "roofServiceBatten"].includes(board.role))
        assert.ok(v[2] >= -1e-6 && v[2] <= 4 + 1e-6, board.id);
    }
  assert.equal(cut.overlength.length, 0);
  assert.equal(cut.invalid.length, 0);
  assert.equal(cut.summary.pieces, r.timber.instances.length);
  assert.ok(cut.stocks.every((s) => s.consumed <= 6 + 1e-7));
});
test("side cover is carried by real two-support lookout boards and real verge boards, with butt faces instead of colliding boxes", () => {
  const p = project(),
    { r } = calculate(p),
    aux = r.auxiliaryTimber.instances,
    verges = aux.filter((x) => x.role === "roofVergeBoard"),
    lookouts = aux.filter((x) => x.structuralLookout && x.role === "roofBatten");
  assert.equal(verges.length, 2);
  assert.ok(lookouts.length > 10);
  assert.ok(lookouts.filter((x) => x.isLookout).every((x) => x.supportRafterIds.length >= 2));
  assert.ok(verges.every((x) => x.supportedBy === "cantilever-roof-battens"));
  const leftFace = -0.35 + 0.05,
    rightFace = 8.45 - 0.05;
  for (const board of lookouts) {
    near(board.b, 50);
    for (const v of vertices(board)) assert.ok(v[0] >= leftFace - 1e-6 && v[0] <= rightFace + 1e-6);
  }
  assert.ok(
    r.auxiliaryTimber.checks.filter((x) => x.id.includes("-lookout-")).every((x) => x.status === "pass"),
  );
});
test("lookout strength follows its flat weak axis and thickness increase improves actual biaxial checks", () => {
  const thin = project();
  thin.auxiliaryTimber.roofBattens = "25x100";
  const a = calculate(thin),
    b = calculate(project()),
    weak = a.r.auxiliaryTimber.checks.filter((x) => x.id.includes("-lookout-")),
    strong = b.r.auxiliaryTimber.checks.filter((x) => x.id.includes("-lookout-"));
  assert.ok(weak.some((x) => x.status === "fail"));
  assert.ok(strong.every((x) => x.status === "pass"));
  assert.ok(Math.max(...weak.map((x) => x.value)) > Math.max(...strong.map((x) => x.value)) * 2);
  assert.ok(strong.every((x) => x.backspan >= x.projection));
});
test("larger roof mass, layers and snow enter global loads once and drainage reaches the eave outside the wall footprint", () => {
  const p = project(),
    a = calculate(project({ low: 0, high: 0, start: 0, end: 0 })),
    b = calculate(p);
  assert.ok(b.r.timber.mass > a.r.timber.mass);
  const delta =
    (((b.r.timber.mass - a.r.timber.mass) * 9.80665) / 1000) * p.loads.gammaG +
    (b.roof.area - a.roof.area) * p.loads.roofDead * p.loads.gammaG +
    (b.roof.snowEffectiveArea - a.roof.snowEffectiveArea) * p.loads.snow * p.loads.gammaQ;
  near(b.r.loads.totalDesign - a.r.loads.totalDesign, delta);
  near(b.r.foundation.reactionSum, b.r.loads.totalDesign);
  near(b.roof.drainage.quantities.totalResolvedArea, b.roof.projectedArea);
  near(b.roof.drainage.quantities.unresolvedArea, 0);
  assert.ok(b.roof.drainage.downpipes.every((d) => d.start[2] < 0));
});
test("requested asymmetric L-house eaves keep the common crest intact including outer verge ends", () => {
  const { roof, r, cut } = calculate(twoSlopes());
  near(roof.projectedArea, 12.8 * 4.6 + 8.7 * 4.4);
  near(roof.drainage.quantities.totalResolvedArea, roof.projectedArea);
  assert.equal(
    roof.checks.some((c) => c.status === "fail"),
    false,
  );
  const joint = roof.coverRidgeJoints[0];
  near(Math.min(joint.start[0], joint.end[0]), -0.35);
  near(Math.max(joint.start[0], joint.end[0]), 8.35);
  assert.equal(joint.connectionVerified, false);
  for (const board of r.auxiliaryTimber.instances.filter(
    (x) => x.role === "roofVergeBoard" && x.coverJointId,
  )) {
    assert.equal(board.rafterJointId, undefined);
    const sign = board.zoneId === "N" ? 1 : -1;
    for (const v of vertices(board)) assert.ok(sign * (v[2] - 4) < 1e-6);
    near(board.end[2], 4);
  }
  assert.equal(cut.overlength.length, 0);
  assert.equal(cut.summary.pieces, r.timber.instances.length);
});
test("nonzero overhangs reject unsupported shapes, missing real battens, crossing covers and shared-high extensions explicitly", () => {
  const base = calculateDesigner(project({ low: 0, high: 0, start: 0, end: 0 }));
  for (const modify of [
    (p) => (p.roof.zones[0].shape = "gable"),
    (p) => p.roof.zones[0].polygon.splice(2, 1),
    (p) => (p.auxiliaryTimber.enabled = false),
    (p) => (p.roof.zones[0].overhangs.low = NaN),
    (p) => (p.roof.zones[0].overhangs.start = 2.1),
  ]) {
    const p = project();
    modify(p);
    const roof = calculateRoofZones(p, base);
    assert.equal(roof.status, "fail");
    assert.equal(roof.complete, false);
    assert.ok(roof.checks.some((c) => c.status === "fail"));
  }
  const p = twoSlopes(),
    b = calculateDesigner(p);
  p.roof.zones[0].overhangs.high = 0.2;
  const crossed = calculateRoofZones(p, b);
  assert.equal(crossed.complete, false);
  assert.ok(crossed.checks.some((c) => c.status === "fail" && /ridge-overhang|cover-overlap/.test(c.id)));
});
test("zero defaults and a 90-degree plan rotation preserve bearing analysis and independent local eave meaning", () => {
  const p = project({ low: 0, high: 0, start: 0, end: 0 }),
    a = calculate(p);
  delete p.roof.zones[0].overhangs;
  const b = calculate(p);
  near(a.roof.area, b.roof.area);
  near(a.roof.mass, b.roof.mass);
  near(a.z.rafterAnalysis.deflection, b.z.rafterAnalysis.deflection);
  const q = project(),
    rotate = (p) => ({ x: -p.y, y: p.x });
  q.walls = q.walls.map((w) => ({ ...w, a: rotate(w.a), b: rotate(w.b) }));
  q.roof.zones[0].polygon = q.roof.zones[0].polygon.map(rotate);
  q.roof.zones[0].ridgeAngle = 90;
  const rotated = calculate(q),
    normal = calculate(project());
  near(rotated.roof.area, normal.roof.area);
  near(rotated.roof.mass, normal.roof.mass);
  near(rotated.r.auxiliaryTimber.quantities.mass, normal.r.auxiliaryTimber.quantities.mass);
  near(rotated.z.overhangBasis.u[1], 1);
  near(rotated.z.overhangBasis.v[0], -1);
});

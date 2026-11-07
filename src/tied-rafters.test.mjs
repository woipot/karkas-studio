import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { calculateTiedRafters } from "./tied-rafters.js";
import { cutGeometry } from "./board-geometry.js";
import { defaultDesignerProject, calculateDesigner } from "./designer-engine.js";
import { evaluateHouse } from "./house-engine.js";
const sum = (a) => a.reduce((s, x) => s + x, 0),
  G = 9.80665,
  near = (a, b, t = 1e-6) =>
    assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} != ${b}`),
  cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  area = (p) =>
    Math.abs(sum(p.map((a, i) => a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y))) / 2;
function intersect(A, B) {
  let p = A;
  for (let i = 0; i < B.length && p.length; i++) {
    const a = B[i],
      b = B[(i + 1) % B.length],
      o = [];
    for (let j = 0; j < p.length; j++) {
      const q = p[j],
        r = p[(j + 1) % p.length],
        f = cross(a, b, q),
        g = cross(a, b, r);
      if (f >= 0) o.push(q);
      if (f >= 0 !== g >= 0) {
        const t = f / (f - g);
        o.push({ x: q.x + (r.x - q.x) * t, y: q.y + (r.y - q.y) * t });
      }
    }
    p = o;
  }
  return p.length >= 3 ? area(p) : 0;
}
function triangles(p) {
  return THREE.ShapeUtils.triangulateShape(
    p.map((q) => new THREE.Vector2(q.x, q.y)),
    [],
  ).map((ids) => {
    const q = ids.map((i) => p[i]);
    return cross(...q) < 0 ? q.reverse() : q;
  });
}
function volume(b) {
  const g = cutGeometry(b),
    p = g.attributes.position;
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)],
      c = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
      d = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    v +=
      (a[0] * (c[1] * d[2] - c[2] * d[1]) +
        a[1] * (c[2] * d[0] - c[0] * d[2]) +
        a[2] * (c[0] * d[1] - c[1] * d[0])) /
      6;
  }
  g.dispose();
  return Math.abs(v);
}
function fixture() {
  const p = structuredClone(defaultDesignerProject),
    poly = [
      { x: 0.075, y: 0.075 },
      { x: 7.925, y: 0.075 },
      { x: 7.925, y: 5.925 },
      { x: 0.075, y: 5.925 },
    ];
  p.height = 3.1;
  p.levels = [{ id: "L1", name: "Первый этаж", index: 1, height: 3.1 }];
  p.walls = poly.map((a, i) => ({
    id: "W" + i,
    a,
    b: poly[(i + 1) % 4],
    kind: "exterior",
    level: 1,
    section: "75x150",
    studStep: 0.6,
  }));
  p.openings = [];
  p.bracing.method = "none";
  p.floor.section = "50x200";
  p.foundation = {
    spacing: 1.8,
    capacity: 80,
    grillage: { section: "50x200", plies: 3, capSize: 250, girderSpacing: 2 },
  };
  p.auxiliaryTimber = {
    enabled: true,
    roofInterior: false,
    roofCounter: "50x50",
    roofBattens: "50x100",
    ceilingBattens: true,
    ceilingSection: "50x50",
    roofAboveRafterGap: 0,
  };
  p.roof = {
    type: "king",
    shape: "gable",
    pitch: 25,
    spacing: 1,
    chordSection: "75x200",
    webSection: "50x100",
    framing: "tiedRafters",
    ceilingDrop: 0.3,
    kneeRun: 0.8,
    collarHeightRatio: 0.75,
    ceilingDead: 0.18,
    snowMu: 1,
    overhangs: { low: 0.52, high: 0.42, start: 0.42, end: 0.42 },
  };
  p.loads = {
    ...p.loads,
    floorDead: 0.7,
    live: 1.5,
    roofDead: 0.42,
    wallDead: 0.3,
    openingDead: 0.3,
    snow: 1.5,
    wind: 0.3,
    gammaG: 1.1,
    gammaQ: 1.4,
  };
  p.material = {
    ...p.material,
    E: 10000,
    Emin: 7400,
    Fb: 13,
    Ft: 8,
    Fc: 13,
    Fv: 1.6,
    density: 450,
    studRestraint: 3.1,
  };
  return p;
}

test("user reference is a bending frame with continuous rafters, lower tie, collar and inset knees, not heel stubs", () => {
  const r = calculateTiedRafters({ chordSection: "75x200", Emin: 7400 });
  assert.equal(r.stable, true);
  assert.equal(r.boards.length, 6);
  assert.equal(r.boards.filter((b) => b.role === "topChord").length, 2);
  assert.equal(r.boards.filter((b) => b.role === "bottomChord").length, 1);
  assert.equal(r.boards.filter((b) => b.role === "kneePost").length, 2);
  assert.equal(r.boards.filter((b) => b.role === "collarTie").length, 1);
  assert.ok(!r.nodes.some((n) => n.id === "HA" || n.id === "HB"));
  assert.ok(r.elements.filter((e) => e.frameMemberId.startsWith("RAFTER")).every((e) => e.kind !== "truss"));
  assert.ok(r.members.filter((m) => m.role === "topChord").every((m) => m.maxMoment > 0));
  assert.ok(r.members.find((m) => m.role === "collarTie").localOwnWeightBending);
  assert.equal(r.certified, false);
  assert.ok(r.checks.some((c) => c.status === "unverified"));
});

test("asymmetric tails, actual net timber and flat ceiling preserve frame forces and moment", () => {
  const r = calculateTiedRafters({ chordSection: "75x200", Emin: 7400, ceilingSpacing: 0.7 }),
    p = r.input,
    L = p.span + p.overhangLow + p.overhangHigh,
    roofD = (p.roofDead * p.spacing * L) / Math.cos((p.pitch * Math.PI) / 180),
    ceilD = p.ceilingDead * 0.7 * p.span,
    snow = p.snow * p.mu * p.spacing * L,
    wood = (sum(r.boards.map((b) => b.mass)) * G) / 1000,
    expected = (roofD + ceilD + wood) * p.gammaG + snow * p.gammaQ,
    center = (p.span + p.overhangHigh - p.overhangLow) / 2,
    M =
      (roofD * p.gammaG + snow * p.gammaQ) * center +
      (ceilD * p.gammaG * p.span) / 2 +
      sum(r.boards.map((b) => ((b.mass * G) / 1000) * p.gammaG * b.massCenter.x));
  near(sum(r.design.reactions.map((x) => x.fy)), expected);
  near(sum(r.design.reactions.map((x) => x.fy * r.nodes.find((n) => n.id === x.node).x + x.mz)), M);
  near(r.loads.ceilingDead, ceilD);
  near(r.design.equilibrium.fy, 0);
  near(r.design.equilibrium.moment, 0);
});

test("actual concave birdsmouth/scarf/knee/collar profiles have zero overlap and true mesh net volume", () => {
  const r = calculateTiedRafters({ chordSection: "75x200" }),
    b = r.boards.map((b) => ({ ...b, triangles: triangles(b.polygon) }));
  for (let i = 0; i < b.length; i++) {
    near(volume(b[i]), b[i].volume, 1e-7);
    near(b[i].mass, b[i].volume * 450);
    assert.ok(b[i].cutLength <= 6 + 1e-7);
    for (let j = 0; j < i; j++)
      near(sum(b[i].triangles.flatMap((a) => b[j].triangles.map((c) => intersect(a, c)))), 0, 1e-8);
  }
  const low = b[0],
    seat = low.polygon.filter((q) => Math.abs(q.y) < 1e-8);
  assert.ok(seat.some((q) => Math.abs(q.x + 0.075) < 1e-8));
  assert.ok(seat.some((q) => Math.abs(q.x) < 1e-8));
  const tie = b.find((b) => b.role === "bottomChord");
  near(tie.cutLength, 5.85);
  assert.equal(low.cutStart.scheme, "butt");
  assert.equal(low.shape.type, "rafterSeats");
});

test("loads remain fixed while insufficient thin rafters fail necessary buckling and seat screens", () => {
  const thin = calculateTiedRafters({ chordSection: "50x150", Emin: 7400 }),
    large = calculateTiedRafters({ chordSection: "75x200", Emin: 7400 }),
    heavy = calculateTiedRafters({ chordSection: "75x200", Emin: 7400, snow: 2.25 });
  assert.equal(thin.status, "fail");
  // SP 64 beam-column (Mд = M/ξ) replaces the ideal Euler screen; Euler is reference only.
  assert.ok(thin.members.some((m) => m.role === "topChord" && m.strengthInteraction > 1));
  assert.equal(large.status, "unverified");
  // B11: the birdsmouth seat (hef = 168 of 200 mm) reduces shear by EN 1995 kv; at 1.5x snow
  // the 75x200 rafter now fails that seat shear while bending/stability still pass.
  const seat = heavy.members.find((m) => m.role === "topChord"),
    alpha = seat.minimumSeatSectionHeightMM / 200,
    kv =
      5 /
      (Math.sqrt(200) *
        (Math.sqrt(alpha * (1 - alpha)) + 0.8 * (75 / 200) * Math.sqrt(1 / alpha - alpha ** 2)));
  near(seat.notchShear.kv, kv);
  assert.equal(heavy.status, "fail");
  assert.ok(seat.notchShear.utilization > 1 && seat.strengthInteraction < 1);
  assert.ok(
    heavy.members.find((m) => m.role === "topChord").maxAxial >
      large.members.find((m) => m.role === "topChord").maxAxial,
  );
  near(sum(large.boards.map((b) => b.mass)), sum(heavy.boards.map((b) => b.mass)));
  assert.equal(large.input.Fb, thin.input.Fb);
});

test("full pipeline counts physical frame/ceiling mass once and routes true bearings with exact gravity balance", () => {
  const p = fixture(),
    r = evaluateHouse(p),
    z = r.result.roofModel.zones[0],
    physical = r.result.timber.instances.filter((b) => b.tiedRafters),
    ids = r.cutting.stocks.flatMap((s) => s.pieces.map((p) => p.sourceId));
  assert.equal(z.effectiveFraming, "tiedRafters");
  assert.equal(z.frameRows.length, 9);
  assert.equal(physical.length, 54);
  assert.ok(r.result.timber.instances.some((b) => b.role === "ceilingHanger"));
  assert.ok(r.result.timber.instances.some((b) => b.role === "ceilingLedger"));
  near(z.bottomChordBottomY - z.ceilingDatumY, 0.3);
  near(z.ceilingInsulationTopY - z.ceilingDatumY, 0.2);
  for (const b of physical) {
    assert.equal(ids.filter((id) => id === b.id).length, 1);
    assert.ok(b.massCenter.every(Number.isFinite));
    near(b.volume, b.shapeNetVolume);
    near(b.mass, b.volume * 450);
  }
  near(
    sum(z.frameRows.map((row) => row.loads.totalDesign)),
    r.result.loads.roofWeight * p.loads.gammaG + r.result.loads.snow * p.loads.gammaQ,
  );
  near(
    sum(z.frameRows.map((row) => sum(row.reactions.map((r) => r.fy)))),
    sum(z.frameRows.map((row) => row.loads.totalDesign)),
  );
  near(r.result.foundation.balanceError, 0);
  near(r.result.loads.totalDesign, sum(r.result.piles.map((p) => p.reaction)));
  const route = r.result.loads.roofSupportRouting[0],
    ceil = p.roof.ceilingDead * z.bearingArea,
    top = p.loads.roofDead * z.surfaceArea - ceil,
    externalSnow = p.loads.snow * z.snowEffectiveArea,
    cv = (z.coverBounds.minV + z.coverBounds.maxV) / 2,
    cu = (z.coverBounds.minU + z.coverBounds.maxU) / 2;
  let mx = ((top + ceil) * p.loads.gammaG + externalSnow * p.loads.gammaQ) * cu,
    mv =
      (top * cv + (ceil * (z.bounds.minV + z.bounds.maxV)) / 2) * p.loads.gammaG +
      externalSnow * cv * p.loads.gammaQ;
  for (const b of r.result.timber.instances.filter((b) => b.category === "roof")) {
    const center = b.massCenter ?? b.start.map((x, i) => (x + b.end[i]) / 2),
      W = ((b.mass * G) / 1000) * p.loads.gammaG;
    mx += W * center[0];
    mv += W * center[2];
  }
  near(sum(route.rows.map((r) => r.designA * r.bearingStart[0] + r.designB * r.bearingEnd[0])), mx);
  near(sum(route.rows.map((r) => r.designA * r.bearingStart[2] + r.designB * r.bearingEnd[2])), mv);
  assert.ok(r.result.roofModel.checks.every((c) => c.status !== "fail"));
});

test("fixed snow cases preserve tied-frame topology, profiles, real ceiling and installed mass", () => {
  const p = fixture();
  p.snowDesign = {
    cases: [
      { id: "base", name: "Base", zoneFactors: { "roof-level-1-1": 1 } },
      { id: "heavy", name: "Heavy", zoneFactors: { "roof-level-1-1": 1.5 } },
    ],
  };
  const r = evaluateHouse(p),
    cases = r.result.snowAssessment.cases;
  for (const c of cases) {
    near(c.timberMass, r.result.timber.mass);
    near(c.timberVolume, r.result.timber.volume);
    assert.equal(c.boardCount, r.result.timber.boardCount);
    assert.equal(c.sectionsFixed, true);
    assert.equal(c.frames.length, 1);
    assert.equal(c.frames[0].members.length, 6);
  }
  // Base snow passes; the 1.5x case may fail only the birdsmouth seat shear of the rafters (B11).
  assert.equal(cases[0].failures.filter((c) => c.id.includes("frame-")).length, 0);
  assert.ok(cases[1].failures.filter((c) => c.id.includes("frame-")).every((c) => /topChord/.test(c.id)));
  assert.ok(cases[1].snowCharacteristic > cases[0].snowCharacteristic);
});

test("invalid frame geometry/input reports explicit errors, and core validates new roof controls", () => {
  for (const change of [
    (q) => (q.kneeRun = 0.1),
    (q) => (q.ceilingDrop = NaN),
    (q) => (q.collarHeightRatio = 0.99),
    (q) => (q.chordSection = "wrong"),
    (q) => (q.overhangLow = 0.01),
    (q) => (q.Emin = NaN),
    (q) => {
      q.wallDepthLow = 0.6;
      q.pitch = 50;
    },
  ]) {
    const p = {};
    change(p);
    const r = calculateTiedRafters(p);
    assert.equal(r.stable, false);
    assert.ok(r.errors.length);
  }
  const p = fixture();
  p.roof.kneeRun = 0.1;
  assert.throws(() => calculateDesigner(p), { name: "DesignerValidationError" });
});

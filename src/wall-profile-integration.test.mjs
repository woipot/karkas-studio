import test from "node:test";
import assert from "node:assert/strict";
import { calculateDesigner, defaultDesignerProject } from "./designer-engine.js";
import { calculateRoofZones } from "./roof-zones.js";
import { calculateCutting } from "./cutting.js";
import { checkDesignerMembers } from "./designer-mechanics.js";
import { memberLoadProject } from "./load-profile.js";
import { deriveWallProfiles } from "./wall-profiles.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, t = 1e-6) =>
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} ≠ ${b}`);
function project(span = 4, pitch = 25) {
  const p = clone(defaultDesignerProject),
    points = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: span },
      { x: 0, y: span },
    ];
  p.openings = [];
  p.walls = points.map((a, i) => ({
    id: "w" + i,
    a,
    b: points[(i + 1) % 4],
    kind: "exterior",
    level: 1,
    section: "50x150",
    studStep: 0.6,
  }));
  p.roof.wallFraming = "continuous";
  p.roof.zones = [
    {
      id: "mono",
      name: "Непрерывные стены под односкатной крышей",
      polygon: points,
      shape: "mono",
      ridgeAngle: 180,
      pitchLeft: pitch,
      pitchRight: pitch,
      levelIndex: 1,
      elevation: null,
      trussType: "mono",
      spacing: 0.6,
      chordSection: "50x200",
      webSection: "50x100",
      framing: "rafters",
      deflectionRatio: 300,
    },
  ];
  return p;
}
function calculate(p) {
  const base = calculateDesigner(p),
    roof = calculateRoofZones(p, base),
    result = calculateDesigner(p, { roofModel: roof });
  return { p, base, roof, result, cutting: calculateCutting(p, result) };
}
const profiles = (r) => r.geometry.wallProfiles ?? [];

test("unequal eave reactions reach the correct high and low bearing walls without moving walls to the cover outline", () => {
  const p = project(),
    base = calculateDesigner(p),
    roof = calculateRoofZones(p, base),
    zone = roof.zones[0];
  zone.rafterAnalysis.reactions = { verticalA: 9, verticalB: 3, serviceVerticalA: 6, serviceVerticalB: 2 };
  zone.bearingPolygon = structuredClone(zone.polygon);
  zone.bearingBounds = structuredClone(zone.bounds);
  zone.coverPolygon = [
    { x: -0.4, y: -0.2 },
    { x: 6.3, y: -0.2 },
    { x: 6.3, y: 4.6 },
    { x: -0.4, y: 4.6 },
  ];
  const r = deriveWallProfiles(p, base, roof),
    high = r.find((w) => w.wallId === "w0"),
    low = r.find((w) => w.wallId === "w2"),
    spacing = zone.actualSpacing || zone.spacing;
  near(high.roofReactionLine.design, 3 / spacing);
  near(low.roofReactionLine.design, 9 / spacing);
  near(high.roofReactionLine.service, 2 / spacing);
  near(low.roofReactionLine.service, 6 / spacing);
  near(high.highTop - low.highTop, 4 * Math.tan((25 * Math.PI) / 180));
});
const profileFor = (r, id) => profiles(r).find((p) => p.wallId === id && p.level === 1);
function topAt(profile, wall, board) {
  const dx = wall.b.x - wall.a.x,
    dz = wall.b.y - wall.a.y,
    L = Math.hypot(dx, dz),
    s = ((board.start[0] - wall.a.x) * dx + (board.start[2] - wall.a.y) * dz) / L;
  if (Array.isArray(profile.topSamples) && profile.topSamples.length) {
    const points = [...profile.topSamples].sort((a, b) => a.s - b.s);
    if (s <= points[0].s) return points[0].topY;
    for (let i = 1; i < points.length; i++)
      if (s <= points[i].s) {
        const a = points[i - 1],
          b = points[i],
          t = (s - a.s) / (b.s - a.s);
        return a.topY + (b.topY - a.topY) * t;
      }
    return points.at(-1).topY;
  }
  return profile.topAtA + (profile.topAtB - profile.topAtA) * Math.max(0, Math.min(1, s / L));
}

test("four-metre mono high wall uses continuous full-height existing studs and corners within 6m", () => {
  const { p, base, roof, result, cutting } = calculate(project()),
    profile = profileFor(result, "w0");
  assert.ok(profile);
  assert.equal(profile.mode, "continuous");
  near(profile.baseY, base.geometry.levels[0].wallBaseY);
  near(profile.highTop - profile.baseY, 2.8 + 4 * Math.tan((25 * Math.PI) / 180));
  near(profile.topAtA, profile.topAtB);
  const studs = result.timber.instances.filter(
    (b) => b.category === "walls" && b.wallId === "w0" && b.role === "stud",
  );
  assert.ok(studs.length > 0);
  for (const b of studs) {
    near(b.start[1], profile.baseY + 0.05);
    near(b.end[1], profile.highTop - 0.1);
    assert.ok(b.length > 4.4 && b.length < 4.7);
    assert.ok(b.cutLength <= 6 + 1e-7);
    assert.equal(b.partIndex, undefined);
    assert.equal(
      result.splices.some((s) => s.memberId === b.memberId),
      false,
    );
  }
  const corner = result.timber.instances.filter((b) => b.role === "corner" && b.cornerId === "j_0_0");
  assert.ok(corner.length);
  for (const b of corner) {
    near(b.start[1], profile.baseY + 0.05);
    near(b.end[1], profile.highTop - 0.1);
    assert.ok(b.length > 4.4);
  }
  assert.equal(
    roof.instances.some((b) => b.wallId === "w0" && ["rafterSupport", "rafterPlate"].includes(b.role)),
    false,
  );
  assert.equal(cutting.overlength.length, 0);
  assert.equal(cutting.invalid.length, 0);
});

test("continuous high wall has no intermediate top plate left at the old 2.8m joint", () => {
  const { base, result } = calculate(project()),
    oldTop = base.geometry.levels[0].topY,
    profile = profileFor(result, "w0");
  const plates = result.timber.instances.filter((b) => b.role === "plate" && b.wallId === "w0");
  assert.ok(plates.length >= 3);
  for (const b of plates) {
    const oldJoint = [oldTop - 0.075, oldTop - 0.025].some(
      (y) => Math.abs(b.start[1] - y) < 1e-6 && Math.abs(b.end[1] - y) < 1e-6,
    );
    assert.equal(oldJoint, false);
  }
  assert.ok(plates.some((b) => Math.abs(b.start[1] - (profile.highTop - 0.025)) < 1e-6));
});

test("raked side walls have individually full-height studs and sloping top plates", () => {
  const { p, result } = calculate(project());
  for (const id of ["w1", "w3"]) {
    const profile = profileFor(result, id),
      wall = p.walls.find((w) => w.id === id);
    assert.ok(profile);
    assert.equal(profile.mode, "continuous");
    assert.ok(Math.abs(profile.topAtA - profile.topAtB) > 1.8);
    const slope = (profile.topAtB - profile.topAtA) / Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y),
      normalThicknessAtStation = 0.1 * Math.sqrt(1 + slope * slope);
    const studs = result.timber.instances.filter((b) => b.role === "stud" && b.wallId === id);
    assert.ok(studs.length);
    for (const b of studs) {
      near(b.start[1], profile.baseY + 0.05);
      near(b.end[1], topAt(profile, wall, b) - normalThicknessAtStation);
      assert.equal(b.partIndex, undefined);
    }
    const plates = result.timber.instances.filter(
      (b) => b.role === "plate" && b.wallId === id && Math.abs(b.start[1] - b.end[1]) > 0.1,
    );
    assert.ok(plates.length >= 2);
    for (const b of plates) near(Math.abs(b.end[1] - b.start[1]), Math.abs(profile.topAtB - profile.topAtA));
  }
});

test("opening heights are preserved while kings and upper cripples reach the raised wall profile", () => {
  const p = project();
  p.openings = [
    { id: "window", wallId: "w0", offset: 2, width: 1.5, height: 1.4, sill: 0.8, type: "window", floor: 1 },
  ];
  const { base, result } = calculate(p),
    profile = profileFor(result, "w0");
  const before = base.timber.instances.filter((b) => b.wallId === "w0"),
    after = result.timber.instances.filter((b) => b.wallId === "w0");
  for (const role of ["header", "sill", "jack"]) {
    const a = before.filter((b) => b.role === role),
      b = after.filter((b) => b.role === role);
    assert.equal(b.length, a.length);
    for (let i = 0; i < a.length; i++) {
      near(a[i].start[1], b[i].start[1]);
      near(a[i].end[1], b[i].end[1]);
    }
  }
  const kings = after.filter((b) => b.role === "king");
  assert.equal(kings.length, 2);
  for (const b of kings) near(b.end[1], profile.highTop - 0.1);
  const upper = after.filter((b) => b.role === "cripple" && b.start[1] > profile.baseY + 0.8 + 1.4);
  assert.ok(upper.length);
  for (const b of upper) near(b.end[1], profile.highTop - 0.1);
});

test("profiled wall mass, stock quantities, wall layers and pile reactions stay consistent without duplicate gable fill", () => {
  const { p, base, roof, result, cutting } = calculate(project());
  near(
    result.timber.mass,
    result.timber.instances.reduce((s, b) => s + b.mass, 0),
  );
  near(result.timber.totals.roof.mass, roof.mass);
  near(result.foundation.reactionSum, result.loads.totalDesign);
  near(
    result.loads.rows.reduce((s, r) => s + r.design, 0),
    result.loads.totalDesign,
  );
  assert.equal(cutting.summary.pieces, result.timber.instances.length);
  assert.ok(cutting.stocks.every((s) => s.consumed <= 6 + 1e-7));
  let profileArea = 0;
  for (const w of p.walls) {
    const profile = profileFor(result, w.id),
      length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    profileArea += length * (profile ? (profile.topAtA + profile.topAtB) / 2 - profile.baseY : p.height);
  }
  near(result.geometry.grossWallArea, profileArea + roof.gableArea);
  const flatArea = p.walls.reduce((s, w) => s + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * p.height, 0),
    rise = 4 * Math.tan((25 * Math.PI) / 180),
    originalClosure = (6 + 4) * rise;
  assert.ok(
    result.geometry.grossWallArea <= flatArea + originalClosure + 1e-5,
    "Raised wall fill must not be counted again as a second full gable closure",
  );
  assert.ok(result.timber.totals.walls.mass > base.timber.totals.walls.mass);
});

test("forced continuous walls above 6m remain whole and explicitly unplaceable, never silently spliced", () => {
  const { roof, result, cutting } = calculate(project(8, 45)),
    profile = profileFor(result, "w0") ?? roof.wallProfiles?.find((p) => p.wallId === "w0");
  assert.ok(profile);
  assert.equal(profile.mode, "continuous");
  assert.equal(profile.stockFits, false);
  assert.ok(roof.checks.some((c) => c.status === "fail"));
  const verticals = result.timber.instances.filter(
    (b) =>
      ["stud", "king", "corner"].includes(b.role) &&
      Math.abs(b.start[0] - b.end[0]) < 1e-7 &&
      Math.abs(b.start[2] - b.end[2]) < 1e-7,
  );
  assert.ok(verticals.some((b) => b.cutLength > 6 + 1e-7));
  assert.ok(cutting.overlength.some((b) => verticals.some((v) => v.id === b.sourceId)));
  const memberIds = new Set(verticals.map((b) => b.memberId));
  assert.equal(
    result.splices.some((s) => memberIds.has(s.memberId)),
    false,
  );
  assert.equal(cutting.summary.complete, false);
});
function autoEightMetreMono() {
  const p = project(),
    points = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 4 },
      { x: 0, y: 4 },
    ];
  p.walls = p.walls.map((w, i) => ({ ...w, a: points[i], b: points[(i + 1) % 4] }));
  Object.assign(p.roof, { wallFraming: "auto" });
  Object.assign(p.roof.zones[0], { polygon: points, framing: "auto", chordSection: "50x150" });
  p.material.studRestraint = 2.8;
  return p;
}
test("actual full-height wall checks replace the obsolete global representative compression failure", () => {
  const p = autoEightMetreMono(),
    { result } = calculate(p),
    m = checkDesignerMembers(memberLoadProject(p), result),
    actual = result.fullHeightWalls.walls.flatMap((w) => w.studs.map((s) => ({ ...s, wallId: w.wallId })));
  assert.ok(actual.length);
  assert.equal(result.fullHeightWalls.capacityPass, true);
  assert.equal(m.stud.measured, true);
  const source = actual.find((s) => s.id === m.stud.id && s.wallId === m.stud.wallId);
  assert.ok(source);
  near(m.stud.force, source.force);
  near(m.stud.capacity, source.compressionCapacity);
  near(m.stud.unbracedLength, source.length);
  near(Math.max(...actual.map((s) => s.length)), 2.8 + 4 * Math.tan((25 * Math.PI) / 180) - 0.15);
  const compression = m.checks.find((c) => c.id === "designerStudCompression");
  assert.ok(compression);
  assert.notEqual(compression.status, "fail");
  near(compression.value, source.force);
  assert.ok(compression.value < compression.limit);
  const panelPressure =
      (((p.bracing?.thickness ?? 12) / 1000) * (p.bracing?.sheetDensity ?? 650) * 9.80665) / 1000,
    wallPressure = p.loads.wallDead + panelPressure,
    expectedWallWeight = wallPressure * source.tributaryWidth * source.length;
  near(source.wallWeight, expectedWallWeight);
  near(
    source.force,
    source.roofForceDesign + (source.timberWeight + expectedWallWeight) * memberLoadProject(p).loads.gammaG,
  );
  p.material.studRestraint = 0.2;
  const repeated = calculate(p).result,
    short = checkDesignerMembers(memberLoadProject(p), repeated);
  assert.equal(short.stud.measured, true);
  near(short.stud.unbracedLength, m.stud.unbracedLength);
  near(short.stud.capacity, m.stud.capacity);
  near(short.stud.force, m.stud.force);
});
test("higher wind fails the actual full-height wall checks without resurrecting the obsolete axial approximation", () => {
  const p = autoEightMetreMono();
  p.loads.wind = 5;
  const { result } = calculate(p),
    m = checkDesignerMembers(memberLoadProject(p), result);
  assert.equal(m.stud.measured, true);
  assert.equal(result.fullHeightWalls.status, "fail");
  assert.equal(result.fullHeightWalls.capacityPass, false);
  assert.ok(
    result.fullHeightWalls.checks.some(
      (c) => c.status === "fail" && /full-wall-(bending|interaction|deflection)/.test(c.id),
    ),
  );
  const actual = result.fullHeightWalls.walls.flatMap((w) => w.studs),
    source = actual.find((s) => s.id === m.stud.id);
  assert.ok(source);
  near(m.stud.force, source.force);
  near(m.stud.capacity, source.compressionCapacity);
  near(m.stud.unbracedLength, source.length);
});

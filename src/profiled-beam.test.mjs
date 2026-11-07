import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildProfiledBeam, openingGap } from "./profiled-beam.js";
import { beamSection, profiledBeamSections, wallFrameSection } from "./profiled-beam-catalog.js";
import { beamWindScreen, checkBeamBearing } from "./profiled-beam-mechanics.js";
import { calculateDesigner, defaultDesignerProject, validateDesignerProject } from "./designer-engine.js";
import { generateHouse } from "./house-generator.js";
import { evaluateHouse, engineCatalog } from "./house-engine.js";
import { calculateCutting } from "./cutting.js";
import { calculateEstimate } from "./estimate-engine.js";
import { memberInsight } from "./member-insight.js";
import { defaultWizardForm, wizardToGeneratorSpec } from "./wizard-spec.js";
import { profiledBeamSchema } from "../mcp/project-features.mjs";
import { cutGeometry } from "./board-geometry.js";
import { partGeometryKey, buildFabricationGroups } from "./fabrication-groups.js";
const close = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const clone = (x) => structuredClone(x);
const wall = (id = "w", length = 4) => ({
  id,
  kind: "exterior",
  system: "profiledBeam",
  a: { x: 0, y: 0 },
  b: { x: length, y: 0 },
  beam: { section: "145x145" },
});
const build = (walls = [wall()], openings = []) =>
  buildProfiledBeam({ walls, openings, material: { density: 500 } }, [{ index: 1, height: 3, wallBaseY: 1 }]);
const volume = (m) =>
  m.instances.filter((b) => b.role === "beamCourse").reduce((s, b) => s + b.shapeNetVolume, 0);
const generated = () =>
  generateHouse({
    width: 6,
    depth: 4,
    levels: [{ height: 3 }],
    wallSystem: "profiledBeam",
    beamSection: "145x145",
    rooms: [],
  });
// Shared immutable report avoids repeating the engine's cutting optimization in each assertion.
const report = evaluateHouse(generated().project);

test("catalog: eight oriented market envelopes, explicit 6 m stock, safe invalid values", () => {
  assert.equal(profiledBeamSections.length, 8);
  assert.equal(beamSection("90x140").b, 90);
  assert.equal(beamSection("140x90"), undefined);
  assert.equal(beamSection(12), undefined);
  assert.ok(profiledBeamSections.every((s) => s.stockLength === 6));
  assert.equal(engineCatalog().profiledBeam.sections.length, 8);
});
test("3 m / 145 mm = 20 full courses + 100 mm ripped top; volume 4×3×.145=1.74 m3", () => {
  const m = build();
  assert.equal(m.walls[0].courseCount, 21);
  close(m.instances.at(-1).courseHeight, 0.1);
  close(volume(m), 1.74);
  close(volume(m) * 500, 870);
  // Blank purchases keep all 21 original 145 mm sections, including the ripped top.
  close(
    m.instances.reduce((s, b) => s + b.shapeGrossVolume, 0),
    21 * 4 * 0.145 * 0.145,
  );
});
test("working height is an explicit input: ceil(3000/135)=23, top 30 mm", () => {
  const w = wall();
  w.beam.courseHeight = 0.135;
  const m = build([w]);
  assert.equal(m.walls[0].courseCount, 23);
  close(m.instances.at(-1).courseHeight, 0.03);
  close(volume(m), 1.74);
});
test("dowels: 20 interfaces × 4 stations = 80; alternate station patterns and no bottom-interface duplication", () => {
  const m = build();
  assert.equal(m.dowels.length, 80);
  assert.ok(m.dowels.every((d) => d.course >= 2));
  const first = m.dowels.filter((d) => d.course === 2).map((d) => d.station),
    second = m.dowels.filter((d) => d.course === 3).map((d) => d.station);
  assert.deepEqual(first, [0.6, 1.8, 3, 3.4]);
  assert.deepEqual(second, [0.6, 1.2, 2.4, 3.4]);
});
test("12 m: joints at 6 m / 5 and 11 m; every neighboring-course splice >= 1 m; dowels either side", () => {
  const m = build([wall("long", 12)]),
    rows = m.walls[0].courses;
  assert.deepEqual(rows[0].splices, [6]);
  assert.deepEqual(rows[1].splices, [5, 11]);
  for (let i = 1; i < rows.length; i++)
    for (const x of rows[i].splices)
      for (const y of rows[i - 1].splices) assert.ok(Math.abs(x - y) >= 1 - 1e-8);
  for (const x of rows[1].splices)
    for (const s of [x - 0.145 / 2, x + 0.145 / 2])
      assert.ok(m.dowels.some((d) => d.course === 2 && Math.abs(d.station - s) < 1e-6));
  assert.ok(m.instances.every((b) => b.shapeCutLength <= 6 + 1e-8));
});
test("settlement assumption: 3000×6%=180 mm natural; 3000×3%=90 mm kiln-dried", () => {
  close(build().walls[0].settlementMM, 180);
  const w = wall();
  w.beam.moisture = "kilnDried";
  close(build([w]).walls[0].settlementMM, 90);
  close(openingGap(2.35, "natural"), 0.1645);
  close(openingGap(1, "kilnDried"), 0.05);
});
test("opening has real casing, a rounded-up settlement gap, and a continuous top course", () => {
  const m = build(
    [wall()],
    [{ id: "win", wallId: "w", offset: 1, width: 1, height: 1.4, sill: 0.7, type: "window" }],
  );
  const o = m.walls[0].openings[0];
  close(o.requiredGap, 2.15 * 0.07);
  assert.ok(o.actualGap >= o.requiredGap);
  assert.equal(m.instances.filter((b) => b.role === "beamCasing").length, 4);
  assert.equal(m.walls[0].courses.at(-1).partIds.length, 1);
  assert.ok(volume(m) < 1.74);
});
test("bottom under a 20 kN beam end: 20000/(145×100)=1.379310 MPa; /1.8=.766284", () => {
  const c = checkBeamBearing({ force: 20, width: 145, bearingLength: 100 });
  close(c.area, 14500);
  close(c.stress, 20000 / 14500);
  close(c.utilization, 0.7662835249042146);
  assert.ok(checkBeamBearing({ force: 30, width: 145, bearingLength: 100 }).utilization > 1);
});
test("wind: independent .145 m course, 4 m span, .3 kPa; M=.087 kNm, sigma=.171226 MPa", () => {
  const c = beamWindScreen({ pressure: 0.3, span: 4, width: 145, height: 145, E: 10000, Fb: 13 });
  close(c.moment, 0.087);
  close(c.stress, 0.087e6 / ((145 * 145 ** 2) / 6));
  // 5qL^4/(384EI), q=.3×.145=.0435 N/mm; no stack action or dowel restraint.
  close(c.deflection, (5 * 0.0435 * 4000 ** 4) / (384 * 10000 * ((145 * 145 ** 3) / 12)));
});
for (const type of ["warmCorner", "lap", "dovetail", "overhang"])
  test(`corner ${type}: no duplicated corner volume; complementary geometry`, () => {
    const walls = generated().project.walls;
    for (const w of walls) w.beam.cornerJoint = type;
    const m = build(walls);
    const expected = 20 * 0.145 * 3 + (type === "overhang" ? 8 * 0.3 * 0.145 * 3 : 0);
    close(volume(m), expected);
    assert.ok(m.instances.every((b) => b.beamJointCuts.length === 2));
    // Closed triangular mesh volume independently checks the generated shape, not a copy of its metadata.
    let meshVolume = 0;
    for (const b of m.instances) {
      const g = cutGeometry({ ...b, length: b.shapeCutLength });
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const a = [p.getX(i), p.getY(i), p.getZ(i)],
          v = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
          z = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
        meshVolume +=
          (a[0] * (v[1] * z[2] - v[2] * z[1]) +
            a[1] * (v[2] * z[0] - v[0] * z[2]) +
            a[2] * (v[0] * z[1] - v[1] * z[0])) /
          6;
      }
      g.dispose();
    }
    close(Math.abs(meshVolume), expected, 1e-5);
  });
test("full load path: courses 8.7 m3/4350 kg; timber + jute once, pile reactions balance", () => {
  close(report.result.profiledBeam.volume, 8.7);
  close(report.result.profiledBeam.mass, 4350);
  const row = report.result.loads.rows.find((r) => r.id === "timber-walls"),
    mass = report.result.timber.instances
      .filter((b) => b.category === "walls")
      .reduce((s, b) => s + b.mass, 0);
  close(row.characteristic, (mass * 9.80665) / 1000);
  close(
    report.result.loads.rows.find((r) => r.id === "beam-jute").characteristic,
    (report.result.profiledBeam.juteMass * 9.80665) / 1000,
  );
  close(report.result.foundation.balanceError, 0);
  assert.ok(report.result.loads.roofSupportRouting.length);
  assert.ok(report.result.timber.instances.every((b) => b.category !== "walls" || b.role.startsWith("beam")));
  close(report.result.geometry.totalPlatformArea, 6.145 * 4.145);
  close(report.result.loads.wallWeight, report.result.geometry.gableArea * 0.5);
});
test("cutting and estimate: profiled timber never shares stock/price with a same-size frame board", () => {
  const a = report.result.timber.instances.find((b) => b.role === "beamCourse"),
    b = { ...a, id: "ordinary", role: "customBeam", profile: undefined, moisture: undefined };
  const result = { timber: { instances: [a, b] } };
  const cutting = calculateCutting({}, result);
  assert.equal(cutting.groups.length, 2);
  assert.notEqual(partGeometryKey(a), partGeometryKey(b));
  const finnish = { ...a, id: "finnish", profile: "finnish" };
  assert.notEqual(partGeometryKey(a), partGeometryKey(finnish));
  const three = { timber: { instances: [a, b, finnish] } },
    threeCut = calculateCutting({}, three);
  assert.equal(threeCut.groups.length, 3);
  assert.equal(buildFabricationGroups({ result: three, cutting: threeCut }).patternGroups.length, 3);
  const e = calculateEstimate({ prices: { profiledBeamM3: 40000, timberM3: 20000 } }, result, cutting);
  const timber = e.rows.filter((r) => r.category === "timber");
  assert.equal(timber.length, 2);
  assert.deepEqual(timber.map((r) => r.unitPrice).sort(), [20000, 40000]);
  for (const g of cutting.groups) close(g.purchasedVolume, g.boards * 6 * 0.145 * 0.145);
});
test("procurement includes jute and dowels, no frame wall insulation, physical course member insight", () => {
  const e = report.estimate;
  assert.equal(e.rows.find((r) => r.id === "beam-dowels").quantity, report.result.profiledBeam.dowelCount);
  close(e.rows.find((r) => r.id === "beam-jute").quantity, report.result.profiledBeam.juteLength);
  close(e.rows.find((r) => r.id === "insulation").netQuantity, report.result.geometry.gableArea);
  const b = report.result.timber.instances.find((b) => b.role === "beamCourse"),
    m = memberInsight(report, b.id);
  assert.equal(m.analysis.source, "profiledBeam");
  assert.ok(m.cutting.stockId);
  assert.ok(m.checks.some((c) => c.id.includes("settlement")));
});
test("mixed house: beam outside + frame bearing/partition inside; no beam sheathing", () => {
  const p = generated().project;
  p.walls.push({
    id: "inner",
    a: { x: 1, y: 2 },
    b: { x: 5, y: 2 },
    kind: "partition",
    section: "50x100",
    studStep: 0.6,
    level: 1,
  });
  const r = calculateDesigner(p);
  assert.ok(r.timber.instances.some((b) => b.wallId === "inner" && b.role === "stud"));
  assert.ok(r.profiledBeam.walls.length === 4);
  assert.ok(r.bracingModel.panels.every((q) => q.wallId === "inner"));
});
test("MCP config and core reject explicit invalid fields, require section, accept legacy frame defaults", () => {
  for (const beam of [
    { section: "145x145", unknown: 1 },
    { section: "145x145", moisture: "dry" },
    { section: "145x145", dowelSpacing: 0 },
    { section: "150x150" },
  ])
    assert.equal(profiledBeamSchema.safeParse(beam).success, false);
  for (const beam of [
    { section: "150x150" },
    { section: "145x145", dowelSpacing: NaN },
    { section: "145x145", courseHeight: 0.2 },
    { section: "145x145", unknown: true },
  ]) {
    const p = generated().project;
    p.walls[0].beam = beam;
    assert.equal(validateDesignerProject(p).valid, false);
  }
  assert.equal(validateDesignerProject(clone(defaultDesignerProject)).valid, true);
  const w = wall();
  close(wallFrameSection(w, (s) => ({ h: Number(s.split("x")[1]) / 1000 })).h, 0.145);
});
test("wizard forwards requested beam system and explicit section", () => {
  const f = { ...defaultWizardForm(), wallSystem: "profiledBeam", beamSection: "90x140" };
  const s = wizardToGeneratorSpec(f);
  assert.equal(s.wallSystem, "profiledBeam");
  assert.equal(s.beamSection, "90x140");
  assert.throws(() => generateHouse({ wallSystem: "profiledBeam" }), /beamSection/);
});
test("existing published Orion and example projects still evaluate", async () => {
  for (const filename of ["public/projects/orion/project.json", "public/engine-report.json"]) {
    const raw = JSON.parse(await readFile(filename, "utf8"));
    const r = evaluateHouse(raw.project ?? raw);
    assert.ok(r.summary.boards > 0);
    assert.equal(r.result.profiledBeam.walls.length, 0);
  }
});

test("beam input needs no frame section fields; mono extension remains actual frame timber", () => {
  const p = generateHouse({
    width: 6,
    depth: 4,
    levels: [{ height: 3 }],
    wallSystem: "profiledBeam",
    beamSection: "145x145",
    rooms: [],
    roof: { shape: "mono", pitch: 15, framing: "rafters" },
  }).project;
  for (const w of p.walls) {
    delete w.section;
    delete w.studStep;
  }
  const r = evaluateHouse(p);
  assert.equal(r.result.profiledBeam.walls.length, 4);
  assert.ok(r.result.timber.instances.some((b) => b.role === "rafterSupport"));
  close(r.result.foundation.balanceError, 0);
});
test("90×140 uses 90 mm wall thickness in floor contours, not 140 mm course height", () => {
  const p = generateHouse({
    width: 6,
    depth: 4,
    wallSystem: "profiledBeam",
    beamSection: "90x140",
    levels: [{ height: 3 }],
    rooms: [],
  }).project;
  const r = calculateDesigner(p);
  close(r.geometry.totalPlatformArea, 6.09 * 4.09);
  close(r.profiledBeam.volume, 20 * 0.09 * 3);
  assert.equal(r.profiledBeam.walls[0].courseCount, 22);
});
test("lintel hand calculation: 17th course, 1.1 m clear, q=.483467845×1.1 kN/m; M=qL²/8", () => {
  const p = generated().project;
  p.roof.type = "none";
  delete p.roof.zones;
  p.openings = [
    {
      id: "win",
      wallId: p.walls[0].id,
      offset: 1,
      width: 1,
      height: 1.5,
      sill: 0.6,
      type: "window",
      floor: 1,
    },
  ];
  const r = calculateDesigner(p),
    w = r.profiledBeam.walls[0],
    lin = w.lintels[0];
  assert.ok(lin.boardId);
  assert.equal(w.courses.find((c) => c.partIds.includes(lin.boardId)).course, 17);
  // 0.145 m × (3−16×0.145) m × 500 kg/m3 × g = .483467845 kN/m.
  const service = (0.145 * (3 - 16 * 0.145) * 500 * 9.80665) / 1000;
  close(service, 0.483467845);
  close(lin.analysis.moment, (service * 1.1 * 1.1 ** 2) / 8);
  close(lin.analysis.reactions.designA, (service * 1.1 * 1.1) / 2);
});
test("unsupported beam T-junction is rejected before any double-volume geometry", () => {
  const p = generated().project;
  p.walls.push({ ...wall("T", 2), a: { x: 3, y: 0 }, b: { x: 3, y: 2 }, kind: "bearing", level: 1 });
  assert.equal(validateDesignerProject(p).valid, false);
  assert.throws(() => calculateDesigner(p), /Т\/X/);
});
test("two storeys: 6 m high beam stack has 360 mm total adopted settlement and balanced reactions", () => {
  const p = generateHouse({
    width: 6,
    depth: 4,
    levels: [{ height: 3 }, { height: 3 }],
    wallSystem: "profiledBeam",
    beamSection: "145x145",
    rooms: [],
    stair: false,
  }).project;
  const r = calculateDesigner(p);
  assert.equal(r.profiledBeam.walls.length, 8);
  close(r.profiledBeam.walls.reduce((s, w) => s + w.settlementMM, 0) / 4, 360);
  close(r.foundation.balanceError, 0);
  assert.ok(r.profiledBeam.walls.filter((w) => w.level === 1).every((w) => w.topReactions.length));
});

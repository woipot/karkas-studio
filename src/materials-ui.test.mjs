import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultWizardForm,
  wizardToGeneratorSpec,
  validateWizardForm,
  wizardSheetChange,
  wizardSheetProducts,
} from "./wizard-spec.js";
import { generateHouse } from "./house-generator.js";
import { evaluateHouse } from "./house-engine.js";
import { memberStatus } from "./member-status.js";
import { memberInsight } from "./member-insight.js";
import { sheetMapData, sheetPanelInfo, sheetFormat, sheetMapURL, SHEETS_PER_PAGE } from "./materials-data.js";
import { materialDemoForm, buildMaterialDemo } from "./material-demos.js";
import { calculateInsulation } from "./insulation.js";
import { solid, volume } from "./insulation-solid.js";
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("wizard materials are mapped purely: both sides, catalog format, floor/roof and insulation metres", () => {
  const form = {
    ...defaultWizardForm(),
    sheathing: {
      walls: { product: "plywood-fsf-1525x1525", thickness: 6.5, side: "both" },
      floors: { product: "osb3", thickness: 18 },
      roof: { product: "osb3-2800x1250", thickness: 12 },
    },
    insulation: {
      walls: { thickness: 0.15, product: "wool-50" },
      floor: { thickness: 0.2, product: "wool-100" },
      roof: { product: "wool-100", boundary: "slopes" },
    },
  };
  const before = structuredClone(form),
    spec = wizardToGeneratorSpec(form);
  assert.deepEqual(spec.sheathing, form.sheathing);
  assert.deepEqual(spec.insulation, form.insulation);
  spec.sheathing.walls.side = "interior";
  spec.insulation.floor.thickness = 0.1;
  assert.deepEqual(form, before);
  const { project } = generateHouse(wizardToGeneratorSpec(form));
  assert.deepEqual(project.sheathing, before.sheathing);
  assert.deepEqual(project.insulation, before.insulation);
});
test("wizard old saved forms keep no new sheet or insulation override", () => {
  const form = defaultWizardForm();
  delete form.sheathing;
  delete form.insulation;
  const spec = wizardToGeneratorSpec(form);
  assert.equal(spec.sheathing, undefined);
  assert.equal(spec.insulation, undefined);
});
test("wizard rejects invalid catalog thickness, wall side and insulation at materials step", () => {
  for (const patch of [
    { sheathing: { walls: { product: "osb3", thickness: 99, side: "exterior" } } },
    { sheathing: { walls: { product: "osb3", thickness: 12, side: "outside" } } },
    { insulation: { floor: { thickness: -0.2 } } },
    { beamMoisture: "dry" },
  ]) {
    const form = { ...defaultWizardForm(), ...patch };
    assert.equal(validateWizardForm(form).errors[0].step, "materials");
    assert.throws(() => wizardToGeneratorSpec(form), { name: "WizardValidationError" });
  }
});
test("catalog switching preserves valid thickness, removes disabled layer and never adds UI keys to project", () => {
  const wall = wizardSheetChange(undefined, { material: "osb3" }, "walls");
  assert.deepEqual(wall, { product: "osb3", thickness: 12, side: "exterior" });
  assert.deepEqual(wizardSheetChange(wall, { material: "plywood-fsf" }, "walls"), {
    product: "plywood-fsf",
    thickness: 12,
    side: "exterior",
  });
  assert.equal(wizardSheetChange(wall, { material: "none" }, "walls"), null);
  const changed = wizardSheetChange(
    { product: "osb3", thickness: 22 },
    { material: "plywood-fsf" },
    "floors",
  );
  assert.equal(changed.thickness, 21);
  assert.ok(wizardSheetProducts("plywood-fsf").every((p) => p.thicknesses.includes(changed.thickness)));
});
test("wizard forwards beam profile/moisture/corner to each external wall", () => {
  const form = {
    ...defaultWizardForm(),
    rooms: [],
    wallSystem: "profiledBeam",
    beamSection: "90x140",
    beamProfile: "finnish",
    beamMoisture: "kilnDried",
    beamCornerJoint: "lap",
  };
  const { project } = generateHouse(wizardToGeneratorSpec(form));
  for (const wall of project.walls.filter((w) => w.kind === "exterior"))
    assert.deepEqual(wall.beam, {
      section: "90x140",
      profile: "finnish",
      moisture: "kilnDried",
      cornerJoint: "lap",
    });
});
test("generator default beam section is explicit in project, input spec is unchanged", () => {
  const spec = { wallSystem: "profiledBeam", width: 4, depth: 5 };
  const implicit = generateHouse(spec),
    explicit = generateHouse({ ...spec, beamSection: "145x145" });
  assert.deepEqual(implicit, explicit);
  assert.equal(spec.beamSection, undefined);
  assert.equal(implicit.project.walls[0].beam.section, "145x145");
  // Hand stock reference A = 145*145 mm² = 0.021025 m².
  near((145 * 145) / 1e6, 0.021025);
  for (const patch of [
    { beamSection: null },
    { beamProfile: "unknown" },
    { beamMoisture: "dry" },
    { beamCornerJoint: "bad" },
  ])
    assert.throws(() => generateHouse({ ...spec, ...patch }));
});
test("finite unverified utilization has normal tones, including overload", () => {
  for (const [u, tone] of [
    [0, "ok"],
    [0.4, "ok"],
    [0.9, "warn"],
    [1.2, "fail"],
  ]) {
    const status = memberStatus({ utilization: u, status: "unverified" });
    assert.equal(status.tone, tone);
    assert.equal(status.reference, false);
    near(status.percent, u * 100);
    assert.match(status.label, /узлы\/крепёж не подтверждены/);
  }
});
test("only missing/nonfinite utilization or explicit unloaded flag is muted", () => {
  for (const u of [null, undefined, NaN, Infinity])
    assert.equal(memberStatus({ utilization: u, status: "unverified" }).tone, "muted");
  assert.equal(memberStatus({ utilization: 0.6, status: "pass", unloaded: true }).percent, null);
  assert.equal(memberStatus({ utilization: 0.5, status: "fail" }).tone, "fail");
});
test("sheet map uses authoritative purchase IDs, preserving rotation/kerf/offcuts and net waste", () => {
  // One 2.5×1.25 sheet: net 2.5m², waste .3125m² and reusable .3125m² => 10% waste.
  const stock = {
    id: "purchase",
    width: 2.5,
    height: 1.25,
    pieces: [
      {
        id: "part",
        x: 0.1,
        y: 0.2,
        width: 2,
        height: 1,
        sourceWidth: 1,
        sourceHeight: 2,
        rotated: true,
        panelIds: ["p"],
      },
    ],
    cuts: [{ width: 0.003 }],
    remnants: [{ width: 0.5, height: 0.625 }],
  };
  const model = {
    panels: [{ id: "p", stockSheetId: "installation", purchaseSheetId: "purchase", layoutPartId: "part" }],
    purchases: [{ stocks: [{ id: "wrong" }] }],
    cutting: {
      stocks: [stock],
      summary: { sheets: 1, lowerBound: 1, purchasedArea: 3.125, wasteArea: 0.3125, complete: true },
    },
  };
  const data = sheetMapData(model),
    info = sheetPanelInfo(model, "p");
  assert.equal(data.count, 1);
  assert.equal(data.lowerBound, 1);
  near(data.wastePercent, 10);
  assert.equal(info.stock, stock);
  assert.equal(info.piece, stock.pieces[0]);
  assert.equal(info.stockIndex, 0);
  assert.equal(data.stocks[0].pieces[0].rotated, true);
  assert.equal(data.stocks[0].cuts[0].width, 0.003);
  assert.equal(data.stocks[0].remnants.length, 1);
  assert.equal(sheetPanelInfo(model, "missing"), null);
});
test("sheet shaping handles absent maps and fallback purchases without fabricated utilization", () => {
  assert.deepEqual(sheetMapData().stocks, []);
  assert.equal(sheetMapData().lowerBound, null);
  assert.equal(sheetMapData().wastePercent, null);
  const stock = { id: "a" };
  assert.deepEqual(sheetMapData({ purchases: [{ stocks: [stock] }] }).stocks, [stock]);
  assert.equal(sheetFormat("osb3-2440x1220"), "2440 × 1220");
  assert.equal(sheetFormat("legacy", 2.5, 1.25), "2500 × 1250");
  const url = new URL(sheetMapURL("a"), "http://localhost");
  assert.equal(url.searchParams.get("sheet"), "a");
  assert.equal(url.searchParams.get("tab"), "materials");
  assert.equal(url.hash, "#sheet-cutting");
  assert.equal(SHEETS_PER_PAGE, 6);
});
test("net insulation render geometry excludes opening and real timber with independent volume", () => {
  const wall = {
    id: "w",
    a: { x: 0, y: 0 },
    b: { x: 4, y: 0 },
    kind: "exterior",
    section: "50x150",
    level: 1,
  };
  const project = {
    walls: [wall],
    openings: [{ wallId: "w", offset: 1, width: 1, height: 1, sill: 1 }],
    loads: { wallDead: 0.5 },
    insulation: { floor: { enabled: false }, roof: { enabled: false } },
  };
  const result = {
    walls: [wall],
    geometry: { closed: true, levels: [{ index: 1, height: 3, wallBaseY: 0, closed: false }] },
    timber: {
      instances: [
        { id: "stud", b: 50, h: 150, length: 3, start: [0.5, 0, 0], end: [0.5, 3, 0], crossAxis: [1, 0, 0] },
      ],
    },
  };
  const plain = calculateInsulation(project, result),
    visual = calculateInsulation(project, result, { includeGeometry: true });
  // 4*3*.15 - 1*1*.15 - .05*.15*3 = 1.6275 m³; no duplicate mass.
  near(visual.assemblies[0].netVolume, 1.6275);
  near(
    visual.assemblies[0].netCells.reduce((s, faces) => s + volume(solid(faces)), 0),
    1.6275,
  );
  assert.deepEqual(visual.totals, plain.totals);
  assert.equal(plain.assemblies[0].netCells, undefined);
});
for (const demo of ["beam", "frame-osb"])
  test(`browser demo ${demo} evaluates, sheet stock links resolve and counters agree`, () => {
    const { project, planning } = buildMaterialDemo(demo);
    const report = evaluateHouse(project, planning),
      model = report.result.sheetModel,
      map = sheetMapData(model);
    assert.equal(
      map.count,
      model.purchases.reduce((n, p) => n + p.count, 0),
    );
    assert.equal(map.count, map.stocks.length);
    assert.equal(map.complete, true);
    assert.ok(model.panels.every((p) => sheetPanelInfo(model, p.id).stock));
    assert.ok(model.surfaces.some((s) => s.kind === "floors"));
    assert.ok(model.surfaces.some((s) => s.kind === "roof"));
    if (demo === "frame-osb") assert.ok(model.surfaces.some((s) => s.kind === "walls"));
    else {
      const board = report.result.timber.instances.find((b) => b.role === "beamCourse");
      const insight = memberInsight(report, board.id);
      const settlement = insight.analysis.rows.find((r) => r.label.startsWith("Доля усадки"));
      // Full 145 mm course × 6% = 8.7 mm; whole 2.8 m wall × 6% = 168 mm.
      near(settlement.value, 8.7);
      near(report.result.profiledBeam.walls[0].settlementMM, 168);
      const topCourse = report.result.timber.instances
        .filter((b) => b.wallId === board.wallId && b.role === "beamCourse")
        .sort((a, b) => b.course - a.course)[0];
      // Cropped twentieth course: 2800 - 19*145 = 45 mm; 45*.06 = 2.7 mm.
      near(
        memberInsight(report, topCourse.id).analysis.rows.find((r) => r.label.startsWith("Доля усадки"))
          .value,
        2.7,
      );
      assert.ok(insight.analysis.rows.some((r) => r.label.startsWith("Стыки венца")));
      assert.ok(insight.analysis.rows.some((r) => r.label.startsWith("Нагелей")));
    }
  });

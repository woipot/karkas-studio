import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifySection, gostWidths, projectSections, resolveDressedProject } from "./lumber-standards.js";
import { timberSections, sectionMassPerMeter } from "./catalog.js";
import { defaultDesignerProject, validateDesignerProject, calculateDesigner } from "./designer-engine.js";
import { generateHouse } from "./house-generator.js";
import { evaluateHouse, modelHash } from "./house-engine.js";
import { annexDefaults } from "./annexes.js";
import { calculateRoofZones } from "./roof-zones.js";
import { checkDesignerMembers } from "./designer-mechanics.js";

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);

test("GOST clause 2 table has 16 thickness rows and 106 allowed pairs, including boundary exclusions", () => {
  // Independent transcription of row counts: 4+5+7+7×9+8+6+5+4+3+1 = 106.
  assert.equal(Object.keys(gostWidths).length, 16);
  assert.equal(Object.values(gostWidths).flat().length, 106);
  for (const id of ["16x150", "19x175", "22x225", "25x275", "44x275", "100x275", "125x250", "250x250"])
    assert.equal(classifySection(id).gost, true, id);
  for (const id of ["16x175", "19x200", "22x250", "50x50", "125x275", "200x275", "250x275"])
    assert.equal(classifySection(id).gost, false, id);
  assert.equal(classifySection("150×50").gost, true);
  assert.equal(classifySection(" 45 х 145 мм ").market, "common");
  assert.equal(classifySection("50x300").gost, true); // Clause 4, export, not clause 2 table.
  assert.equal(classifySection("50x300").market, "rare");
});

test("market classification distinguishes documented products, unverified sizes and invalid labels", () => {
  for (const id of [
    "20x100",
    "20x145",
    "45x45",
    "45x145",
    "45x195",
    "45x240",
    "50x50",
    "48x98",
    "48x148",
    "48x198",
  ])
    assert.equal(classifySection(id).market, "common", id);
  for (const id of ["45x200", "45x250", "43x95", "48x200"])
    assert.equal(classifySection(id).market, "rare", id);
  assert.equal(classifySection("unknown").market, "none");
  assert.equal(classifySection("0x150").market, "none");
  for (const s of timberSections) assert.deepEqual(s.standard, classifySection(s.id));
});

test("non-table sections warn without blocking valid projects; dressed flag is boolean", () => {
  const p = structuredClone(defaultDesignerProject);
  p.walls[0].section = "45x145";
  let v = validateDesignerProject(p);
  assert.equal(v.valid, true);
  assert.ok(v.warnings.some((w) => w.includes("walls.0.section") && w.includes("45x145")));
  p.walls[0].section = "43x95";
  v = validateDesignerProject(p);
  assert.equal(v.valid, true);
  assert.ok(v.warnings.some((w) => w.includes("серийная продажа не подтверждена")));
  p.material.dressed = "true";
  assert.equal(validateDesignerProject(p).valid, false);
});

test("default generator input and physical output use only GOST or documented common sizes", () => {
  for (const spec of [{}, { width: 4, depth: 3, roof: { shape: "mono", framing: "auto" } }]) {
    const { project } = generateHouse(spec);
    const r = evaluateHouse(project);
    for (const { id } of projectSections(project)) {
      const s = classifySection(id);
      assert.ok(s.gost || s.market === "common", id);
    }
    for (const b of r.result.timber.instances) {
      const s = classifySection(`${b.b}x${b.h}`);
      assert.ok(s.gost || s.market === "common", `${b.role}: ${b.b}x${b.h}`);
    }
  }
});

test("supplier profile is opt-in, idempotent, preserves orientation, prices and imported finished shapes", () => {
  const p = {
    material: { dressed: true },
    floor: { section: "50x250" },
    walls: [{ section: "50x150" }, { section: "45x145" }, { section: "40x150" }],
    objects: [{ section: "150x50" }],
    roof: { sourceModel: { members: [{ section: "50x150", shape: { depth: 150 } }] } },
    prices: { sectionPrices: { "50x150": 123 } },
  };
  const r = resolveDressedProject(p);
  assert.equal(r.floor.section, "45x240");
  assert.deepEqual(
    r.walls.map((w) => w.section),
    ["45x145", "45x145", "40x150"],
  );
  assert.equal(r.objects[0].section, "145x45");
  assert.deepEqual(r.roof.sourceModel, p.roof.sourceModel);
  assert.deepEqual(r.prices, p.prices);
  assert.deepEqual(resolveDressedProject(r), r);
  assert.equal(p.floor.section, "50x250");
  assert.equal(annexDefaults({ material: { dressed: true } }).roof.battenSection, "45x95");
  near(sectionMassPerMeter("45x145", 500), 3.2625); // 0.045×0.145×500 kg/m.
});

test("dressed mechanics, timber load rows, pile equilibrium and procurement share actual dimensions", () => {
  const p = generateHouse({ width: 4, depth: 3, roof: { shape: "mono", framing: "rafters" } }).project;
  p.material.dressed = true;
  p.objects = [
    { id: "reference", type: "beam", a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, section: "50x150", elevation: 2 },
  ];
  const before = structuredClone(p),
    r = evaluateHouse(p),
    d = r.result;
  assert.deepEqual(p, before);
  assert.deepEqual(r.project.material, p.material);
  assert.equal(r.project.floor.section, "50x250");
  assert.equal(r.engine.hash, modelHash({ project: r.project, planning: {} }));
  assert.equal(d.project.floor.section, "45x240");
  const beam = d.timber.instances.find((b) => b.objectId === "reference");
  assert.ok(beam);
  // Hand calculation: a 2 m beam, A=45×145=6525 mm²; V=0.01305 m³; m=6.525 kg at 500 kg/m³.
  near(beam.volume, 0.01305);
  near(beam.mass, 6.525);
  const timberRows = d.loads.rows.filter((row) => row.id.startsWith("timber-"));
  near(
    timberRows.reduce((s, row) => s + row.characteristic, 0),
    (d.timber.mass * 9.80665) / 1000,
  );
  near(d.loads.timberWeight, (d.timber.mass * 9.80665) / 1000);
  near(
    d.piles.reduce((s, pile) => s + pile.reaction, 0),
    d.loads.totalDesign,
    1e-6,
  );
  const m = checkDesignerMembers(p, d);
  assert.ok(m.joist);
  // Rectangle mechanics: I=45×240³/12=51,840,000 mm⁴; W=45×240²/6=432,000 mm³.
  const joist = m.joist;
  near(joist.b, 45);
  near(joist.h, 240);
  near(joist.I, 51840000);
  near(joist.Z, 432000);
  assert.ok(r.cutting.groups.some((g) => g.b === 45 && g.h === 240));
  assert.ok(r.estimate.rows.some((row) => row.id.includes("45x240")));
  assert.ok(d.assumptions.some((a) => a.includes("50×150→45×145")));
  const base = calculateDesigner(p),
    roof = calculateRoofZones(p, base);
  assert.ok(roof.zones.every((z) => z.chordSection === "45x195"));
});

test("legacy default dimensions remain unchanged when dressed is omitted or false", () => {
  const p = generateHouse({ width: 4, depth: 3 }).project;
  const a = calculateDesigner(p);
  p.material.dressed = false;
  const b = calculateDesigner(p);
  near(a.timber.volume, b.timber.volume);
  near(a.loads.totalDesign, b.loads.totalDesign);
  assert.equal(a.project.floor.section, "50x250");
});

test("published Orion and engine-report revision inputs still evaluate", async () => {
  for (const file of ["../public/projects/orion/project.json", "../public/engine-report.json"]) {
    const data = JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
    const r = evaluateHouse(data.project ?? data);
    assert.ok(r.summary.boards > 0);
    assert.ok(Number.isFinite(r.summary.timberMass));
  }
});

test("MCP strict material schema accepts dressed=true and preserves revision input", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { Client } = await import("@modelcontextprotocol/client");
  const { StdioClientTransport } = await import("@modelcontextprotocol/client/stdio");
  const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-lumber-"));
  const client = new Client({ name: "lumber-audit", version: "1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../mcp/server.mjs", import.meta.url))],
    env: { ...process.env, KARKAS_DATA_DIR: dataDir },
    stderr: "pipe",
  });
  t.after(async () => {
    await client.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  await client.connect(transport);
  const generated = await client.callTool({
    name: "karkas_generate",
    arguments: { width: 4, depth: 3, material: { dressed: true } },
  });
  assert.notEqual(generated.isError, true);
  const stored = await client.callTool({
    name: "karkas_get_project",
    arguments: { project_id: generated.structuredContent.project_id },
  });
  assert.equal(stored.structuredContent.project.material.dressed, true);
  assert.equal(stored.structuredContent.project.floor.section, "50x250");
  const invalid = await client.callTool({
    name: "karkas_generate",
    arguments: { width: 4, depth: 3, material: { dressed: "true" } },
  });
  assert.equal(invalid.isError, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash as nodeCreateHash } from "node:crypto";
import {
  defaultWizardForm,
  validateWizardForm,
  wizardToGeneratorSpec,
  footprintArea,
  budgetVerdict,
  readSiteLoads,
} from "./wizard-spec.js";
import { buildFromWizard, runEngineTask } from "./engine-tasks.js";
import { projectFileJSON, parseProjectFile, projectFileName } from "./project-file.js";
import { loadSiteLoads, loadSolutions, normalizeFixes, normalizeOptimization } from "./optional-modules.js";
import { createHash as shimCreateHash } from "./browser-shims/node-crypto.js";
import { evaluateHouse, createHouseEngine } from "./house-engine.js";
import { validateDesignerProject } from "./designer-engine.js";

const form = (patch = {}) => ({ ...defaultWizardForm(), ...patch });

test("default wizard form maps to a valid generated project", () => {
  const f = form();
  assert.deepEqual(validateWizardForm(f).errors, []);
  const spec = wizardToGeneratorSpec(f);
  assert.equal(spec.template, "rectangle");
  assert.equal(spec.width, 9);
  assert.equal(spec.depth, 7);
  assert.deepEqual(spec.levels, [{ height: 2.8 }]);
  assert.deepEqual(spec.loads, { snow: 1.5, wind: 0.3 });
  assert.deepEqual(spec.roof, { shape: "gable", pitch: 25, ridgeAngle: 0 });
  assert.equal(spec.rooms.length, 2);
  const { project, planning } = buildFromWizard(f);
  assert.equal(validateDesignerProject(project).valid, true);
  assert.equal(project.floors, 1);
  assert.equal(project.loads.snow, 1.5);
  assert.equal(project.roof.shape, "gable");
  assert.equal(planning.rooms.filter((r) => r.kind !== "corridor").length, 2);
  const report = evaluateHouse(project, planning);
  assert.ok(report.result.timber.instances.length > 100);
  assert.ok(report.estimate.total > 0);
  assert.equal(report.summary.rooms, 2);
});

test("two floors, hip roof, rooms on level 2 and site loads reach the project", () => {
  const f = form({
    name: "  Дом у реки ",
    width: "10",
    depth: 8,
    floors: 2,
    heights: [3, 2.7],
    rooms: [
      { name: "Гостиная", area: 20, level: 1 },
      { name: "Спальня", area: 12, level: 2 },
    ],
    snow: 2.1,
    wind: "0,38",
    roofShape: "hip",
    pitch: 30,
    ridgeAxis: "y",
  });
  const spec = wizardToGeneratorSpec(f);
  assert.equal(spec.name, "Дом у реки");
  assert.equal(spec.width, 10);
  assert.equal(spec.loads.wind, 0.38);
  assert.equal(spec.roof.ridgeAngle, 90);
  const { project, planning } = buildFromWizard(f);
  assert.equal(project.floors, 2);
  assert.deepEqual(
    project.levels.map((l) => l.height),
    [3, 2.7],
  );
  assert.equal(project.loads.snow, 2.1);
  assert.equal(project.roof.shape, "hip");
  assert.equal(project.roof.pitch, 30);
  assert.ok(planning.rooms.some((r) => r.name === "Спальня" && r.level === 2));
});

test("L-shape footprint drops the room program with a warning", () => {
  const f = form({ shape: "l-shape", width: 10, depth: 9, wingWidth: 5, wingDepth: 4 });
  assert.equal(footprintArea(f), 10 * 9 - 5 * 5);
  const { errors, warnings } = validateWizardForm(f);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.step === "rooms"));
  const spec = wizardToGeneratorSpec(f);
  assert.equal(spec.template, "l-shape");
  assert.equal(spec.rooms, undefined);
  const { project } = buildFromWizard(f);
  assert.equal(project.walls.filter((w) => w.level === 1 && w.kind === "exterior").length, 6);
});

test("invalid forms are rejected with the step to fix", () => {
  const steps = (patch) => validateWizardForm(form(patch)).errors.map((e) => e.step);
  assert.deepEqual(steps({ width: 1 }), ["size"]);
  assert.deepEqual(steps({ name: " " }), ["size"]);
  assert.deepEqual(steps({ floors: 3 }), ["floors"]);
  assert.deepEqual(steps({ heights: [6, 2.6] }), ["floors"]);
  assert.deepEqual(steps({ rooms: [{ name: "Спальня", area: 10, level: 2 }] }), ["rooms"]);
  assert.deepEqual(steps({ rooms: [{ name: "", area: 0 }] }), ["rooms", "rooms"]);
  assert.deepEqual(steps({ snow: -1 }), ["site"]);
  assert.deepEqual(steps({ pitch: 75 }), ["roof"]);
  assert.deepEqual(steps({ budget: -5 }), ["budget"]);
  assert.deepEqual(steps({ shape: "l-shape", wingWidth: 8.5 }), ["size"]);
  assert.throws(
    () => wizardToGeneratorSpec(form({ width: 1 })),
    (e) => e.errors?.[0]?.field === "width",
  );
});

test("budget verdict compares the estimate with the optional budget", () => {
  const report = { estimate: { total: 1200 } };
  assert.equal(budgetVerdict(form({ budget: null }), report), null);
  assert.deepEqual(budgetVerdict(form({ budget: 1000 }), report), {
    budget: 1000,
    total: 1200,
    delta: 200,
    over: true,
    ratio: 1.2,
  });
  assert.equal(budgetVerdict(form({ budget: 2000 }), report).over, false);
});

test("site-loads results are read from common shapes", () => {
  assert.equal(readSiteLoads(null), null);
  assert.equal(readSiteLoads({ city: "X" }), null);
  assert.deepEqual(readSiteLoads({ snow: 2.5, wind: 0.3 }).snow, 2.5);
  const r = readSiteLoads({ city: "Ногинск", snow: { value: 1.5 }, windKPa: 0.23, snowRegion: "III" });
  assert.equal(r.snow, 1.5);
  assert.equal(r.wind, 0.23);
  assert.match(r.note, /Ногинск · снеговой район III/);
});

test("project file export is karkas_import_project-compatible and round-trips", async () => {
  const { project, planning } = buildFromWizard(form());
  const text = projectFileJSON(project);
  assert.deepEqual(Object.keys(JSON.parse(text)), ["project"]);
  assert.equal(projectFileName(project), "Мой-каркасный-дом.project.json");
  const back = parseProjectFile(text);
  assert.equal(back.kind, "project");
  assert.deepEqual(back.project, project);
  assert.equal(parseProjectFile(JSON.stringify(project)).kind, "bare");
  const report = evaluateHouse(project, planning);
  const fromReport = parseProjectFile(JSON.stringify(report));
  assert.equal(fromReport.kind, "report");
  assert.deepEqual(fromReport.planning, planning);
  assert.throws(() => parseProjectFile("{"), /JSON/);
  assert.throws(() => parseProjectFile('{"walls":1}'), /нет проекта/);
  // The MCP import path (engine.create) accepts exactly this file content.
  const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-wizard-import-"));
  try {
    const engine = createHouseEngine({ dataDir });
    const created = await engine.create(JSON.parse(text).project);
    assert.equal(created.revision, 1);
    assert.match(created.project_id, /^house-/);
    assert.equal(created.summary.name, project.name);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("engine tasks used by the Web Worker: wizard, evaluate, patch", async () => {
  const { report, spec } = await runEngineTask("wizard", { form: form() });
  assert.equal(spec.width, 9);
  assert.ok(report.engine.hash);
  const again = await runEngineTask("evaluate", { project: report.project, planning: report.sourcePlanning });
  assert.equal(again.report.engine.hash, report.engine.hash);
  const patched = await runEngineTask("patch", {
    project: report.project,
    planning: report.sourcePlanning,
    operations: [{ op: "replace", path: "/roof/pitch", value: 30 }],
  });
  assert.equal(patched.report.project.roof.pitch, 30);
  assert.notEqual(patched.report.engine.hash, report.engine.hash);
  await assert.rejects(() => runEngineTask("nope"), /Неизвестная задача/);
});

test("optional modules: absent modules resolve to null, present ones to functions", async () => {
  const siteLoads = await loadSiteLoads(),
    solutions = await loadSolutions();
  if (existsSync(new URL("./site-loads.js", import.meta.url))) assert.equal(typeof siteLoads, "function");
  else assert.equal(siteLoads, null);
  if (existsSync(new URL("./solutions.js", import.meta.url))) assert.ok(solutions);
  else {
    assert.equal(solutions, null);
    assert.deepEqual(await runEngineTask("capabilities"), { proposeFixes: false, optimize: false });
  }
  const fixes = normalizeFixes([
    { title: "A", operations: [{ op: "replace", path: "/roof/pitch", value: 30 }] },
    { title: "без изменений" },
  ]);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].id, "fix-1");
  assert.equal(normalizeFixes({ fixes: [{ label: "B", patch: [{ op: "add", path: "/x" }] }] })[0].title, "B");
  assert.equal(normalizeOptimization(null), null);
  assert.equal(normalizeOptimization({ walls: [] }).project.walls.length, 0);
  assert.equal(normalizeOptimization({ operations: [{}], summary: "s" }).notes[0], "s");
});

test("browser SHA-256 shim matches node:crypto (engine hash parity)", () => {
  for (const s of [
    "",
    "abc",
    "я".repeat(1000),
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(64),
    "z".repeat(70000),
  ])
    assert.equal(
      shimCreateHash("sha256").update(s).digest("hex"),
      nodeCreateHash("sha256").update(s).digest("hex"),
    );
});

import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { calculateDesigner, validateDesignerProject, defaultDesignerProject } from "./designer-engine.js";
import { calculateRoofZones } from "./roof-zones.js";
import { calculateCutting } from "./cutting.js";
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("./estimate.jsx", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  external: ["react"],
});
const reactURL = new URL("../node_modules/react/index.js", import.meta.url).href;
const moduleSource = compiled.outputFiles[0].text.replace(
  /from "react"/g,
  "from " + JSON.stringify(reactURL),
);
const { calculateEstimate, defaultPrices } = await import(
  "data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64")
);
const near = (a, b, t = 1e-6) =>
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} ≠ ${b}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
function project(framing = "auto", section = "50x150") {
  const p = clone(defaultDesignerProject);
  p.openings = [];
  const points = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 0, y: 4 },
  ];
  p.walls = points.map((a, i) => ({
    id: "w" + i,
    a,
    b: points[(i + 1) % 4],
    kind: "exterior",
    level: 1,
    section: "50x150",
    studStep: 0.6,
  }));
  // This suite retains the explicit stacked-support mode. Continuous wall
  // profiles have their own integration suite and different wall quantities.
  p.roof.wallFraming = "stacked";
  p.roof.zones = [
    {
      id: "mono",
      name: "Четыре метра по горизонтали",
      polygon: points,
      shape: "mono",
      ridgeAngle: 180,
      pitchLeft: 25,
      pitchRight: 25,
      levelIndex: 1,
      elevation: null,
      trussType: "mono",
      spacing: 0.6,
      chordSection: section,
      webSection: "50x100",
      framing,
      deflectionRatio: 300,
    },
  ];
  p.prices = {
    ...Object.fromEntries(
      Object.keys(defaultPrices)
        .filter((k) => k !== "sectionPrices")
        .map((k) => [k, 0]),
    ),
    timberM3: 1000,
    sectionPrices: {},
  };
  return p;
}
function calculate(p) {
  const base = calculateDesigner(p),
    roof = calculateRoofZones(p, base),
    result = calculateDesigner(p, { roofModel: roof }),
    cutting = calculateCutting(p, result),
    estimate = calculateEstimate(p, result, cutting);
  return { p, base, roof, result, zone: roof.zones[0], cutting, estimate };
}

test("four-metre mono AUTO uses actual 4/cos rafters with explicit supports, no truss web or bottom chord", () => {
  const { zone, roof, result } = calculate(project());
  assert.equal(zone.effectiveFraming, "rafters");
  assert.equal(zone.selectedSection, "50x200");
  assert.equal(zone.requestedSection, "50x150");
  assert.equal(zone.rafterAnalysis.capacityPass, true);
  near(zone.rafterAnalysis.horizontalSpan, 4);
  near(zone.rafterAnalysis.slopeLength, 4 / Math.cos((25 * Math.PI) / 180));
  assert.ok(zone.actualSpacing <= 0.6 + 1e-7);
  const rafters = roof.instances.filter((b) => b.zoneId === zone.id && b.role === "rafter");
  assert.equal(rafters.length, 11);
  for (const b of rafters) {
    near(b.length, 4 / Math.cos((25 * Math.PI) / 180));
    assert.equal(b.b, 50);
    assert.equal(b.h, 200);
  }
  assert.equal(
    roof.instances.some((b) => b.role === "web" || b.role === "bottom"),
    false,
  );
  assert.ok(roof.instances.some((b) => b.role === "rafterSupport"));
  assert.ok(roof.instances.some((b) => b.role === "rafterPlate"));
  assert.ok(zone.rafterSupports.every((s) => s.verified === false));
  assert.ok(roof.checks.some((c) => c.status === "unverified"));
  near(
    roof.mass,
    roof.instances.reduce((s, b) => s + b.mass, 0),
  );
  near(result.timber.totals.roof.mass, roof.mass);
  near(result.foundation.reactionSum, result.loads.totalDesign);
});

test("manual four-metre 50×150 rafters retain the user geometry and expose failed checks", () => {
  const { zone, roof } = calculate(project("rafters", "50x150"));
  assert.equal(zone.effectiveFraming, "rafters");
  assert.equal(zone.selectedSection, "50x150");
  assert.equal(zone.rafterAnalysis.capacityPass, false);
  assert.equal(zone.rafterAnalysis.status, "fail");
  assert.ok(roof.checks.some((c) => c.id.includes("rafter-") && c.status === "fail"));
  assert.equal(
    roof.instances.some((b) => b.role === "web" || b.role === "bottom"),
    false,
  );
});

test("snow changes the same four-metre framing decision through capacity, not a span threshold", () => {
  const normal = calculate(project("rafters", "50x250"));
  assert.equal(normal.zone.rafterAnalysis.capacityPass, true);
  const heavy = project("rafters", "50x250");
  heavy.loads.snow = 15;
  const manual = calculate(heavy);
  near(manual.zone.rafterAnalysis.horizontalSpan, 4);
  assert.equal(manual.zone.rafterAnalysis.capacityPass, false);
  assert.equal(manual.zone.effectiveFraming, "rafters");
  assert.ok(manual.roof.checks.some((c) => c.status === "fail"));
  heavy.roof.zones[0].framing = "auto";
  const automatic = calculate(heavy);
  assert.equal(automatic.zone.effectiveFraming, "truss");
  assert.ok(automatic.zone.framingReason.length > 0);
  assert.ok(automatic.roof.instances.some((b) => b.role === "web" || b.role === "bottom"));
});

test("changing trusses to standalone rafters changes actual mass, cut map and procurement estimate once", () => {
  const r = calculate(project("auto")),
    t = calculate(project("truss"));
  assert.equal(t.zone.effectiveFraming, "truss");
  assert.ok(t.roof.instances.some((b) => b.role === "web"));
  assert.ok(Math.abs(r.roof.mass - t.roof.mass) > 1e-4);
  assert.ok(Math.abs(r.cutting.summary.usedVolume - t.cutting.summary.usedVolume) > 1e-6);
  assert.ok(Math.abs(r.estimate.total - t.estimate.total) > 1e-6);
  for (const v of [r, t]) {
    assert.equal(v.cutting.overlength.length, 0);
    assert.equal(v.cutting.invalid.length, 0);
    assert.equal(v.cutting.summary.pieces, v.result.timber.instances.length);
    assert.ok(v.cutting.stocks.every((s) => s.consumed <= 6 + 1e-7));
    near(v.estimate.procurementTimberVolume, v.cutting.summary.purchasedVolume);
    near(v.estimate.total, v.cutting.summary.purchasedVolume * 1000);
    near(v.result.timber.totals.roof.mass, v.roof.mass);
    near(v.result.foundation.reactionSum, v.result.loads.totalDesign);
  }
});

test("timber density changes installed rafter/support weight, preserving the same physical cut geometry", () => {
  const p = project("rafters", "50x200"),
    a = calculate(p);
  p.material.density = 1000;
  const b = calculate(p);
  assert.equal(a.zone.effectiveFraming, b.zone.effectiveFraming);
  near(b.roof.mass, 2 * a.roof.mass);
  near(b.result.timber.mass, 2 * a.result.timber.mass);
  near(a.cutting.summary.usedVolume, b.cutting.summary.usedVolume);
  near(a.estimate.total, b.estimate.total);
  near(
    b.result.loads.totalDesign - a.result.loads.totalDesign,
    (((b.result.timber.mass - a.result.timber.mass) * 9.80665) / 1000) * p.loads.gammaG,
  );
});

test("framing import rejects unknown modes and nonfinite deflection inputs before setting project state", () => {
  for (const corrupt of [
    (p) => {
      p.roof.zones[0].framing = "magic";
    },
    (p) => {
      p.roof.framing = "magic";
    },
    (p) => {
      p.roof.zones[0].deflectionRatio = Infinity;
    },
    (p) => {
      p.roof.deflectionRatio = -1;
    },
  ]) {
    const p = project();
    corrupt(p);
    assert.equal(validateDesignerProject(p).valid, false);
    assert.throws(() => calculateDesigner(p), { name: "DesignerValidationError" });
  }
});

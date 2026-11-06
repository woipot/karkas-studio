import { fileURLToPath } from "node:url";
import { loadFactors } from "./load-profile.js";
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { defaultDesignerProject, calculateDesigner, validateDesignerProject } from "./designer-engine.js";
import { normalizeDesignerState } from "./designer-state.js";
import { calculateCutting } from "./cutting.js";
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("./estimate.jsx", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  external: ["react"],
});
const reactURL = new URL("../node_modules/react/index.js", import.meta.url).href,
  source = compiled.outputFiles[0].text.replace(/from "react"/g, "from " + JSON.stringify(reactURL));
const { calculateEstimate, defaultPrices } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, t = 1e-6) =>
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} ≠ ${b}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function project(length = 8, width = 4) {
  const p = clone(defaultDesignerProject),
    points = [
      { x: 0, y: 0 },
      { x: length, y: 0 },
      { x: length, y: width },
      { x: 0, y: width },
    ];
  p.walls = points.map((a, i) => ({
    id: "w" + i,
    a,
    b: points[(i + 1) % 4],
    level: 1,
    kind: "exterior",
    section: "50x150",
    studStep: 0.6,
  }));
  p.openings = [];
  p.roof.type = "none";
  p.bracing = { ...p.bracing, method: "none" };
  p.foundation = {
    spacing: 2,
    capacity: 40,
    grillage: { section: "50x200", plies: 3, deflectionRatio: 300, capSize: 250 },
  };
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
  const r = calculateDesigner(p),
    cutting = calculateCutting(p, r);
  return { p, r, g: r.grillageModel, cutting, estimate: calculateEstimate(p, r, cutting) };
}

test("pile cap → three-ply grillage → joists → platform have one consistent vertical datum", () => {
  const { p, r, g } = calculate(project());
  assert.ok(g);
  const sectionH = Number(p.foundation.grillage.section.split("x")[1]) / 1000;
  near(g.beamBottomY, g.pileHeadY);
  near(g.topY, g.beamBottomY + sectionH);
  const level = r.geometry.levels[0];
  near(level.baseY, g.topY);
  near(level.wallBaseY, g.topY + r.timber.platformHeight);
  near(level.topY, level.wallBaseY + p.height);
  const foundation = r.timber.instances.filter((b) => b.category === "foundation");
  assert.ok(foundation.length);
  for (const b of foundation) {
    assert.equal(b.role, "grillagePly");
    assert.equal(b.b, 50);
    assert.equal(b.h, 200);
    near(b.start[1] - b.h / 2000, g.beamBottomY);
    near(b.end[1] + b.h / 2000, g.topY);
    assert.ok(b.cutLength <= 6 + 1e-7);
  }
  for (const b of r.timber.instances.filter((b) => b.role === "joist" && b.level === 1))
    near(b.start[1] - b.h / 2000, g.topY);
  assert.ok(r.piles.every((q) => Math.abs(q.capTopY - g.pileHeadY) < 1e-7));
});

test("changing grillage depth shifts the entire building once, not once per storey", () => {
  const p = project();
  p.floors = 2;
  p.levels = [
    { id: "l1", index: 1, name: "Первый", height: 2.8 },
    { id: "l2", index: 2, name: "Второй", height: 2.6 },
  ];
  p.walls.push(...p.walls.map((w) => ({ ...clone(w), id: w.id + "-L2", level: 2 })));
  const a = calculate(p);
  p.foundation.grillage.section = "50x250";
  const b = calculate(p);
  near(b.r.timber.platformHeight, a.r.timber.platformHeight);
  for (let i = 0; i < 2; i++) {
    near(b.r.geometry.levels[i].baseY - a.r.geometry.levels[i].baseY, 0.05);
    near(b.r.geometry.levels[i].wallBaseY - a.r.geometry.levels[i].wallBaseY, 0.05);
    near(b.r.geometry.levels[i].topY - a.r.geometry.levels[i].topY, 0.05);
  }
  near(b.r.geometry.levels[1].baseY, b.r.geometry.levels[0].topY);
  near(b.g.pileHeadY, a.g.pileHeadY);
});

test("foundation timber is counted once in its category, full load rows, stock map and procurement estimate", () => {
  const { r, g, cutting, estimate } = calculate(project());
  const pieces = r.timber.instances.filter((b) => b.category === "foundation"),
    mass = pieces.reduce((s, b) => s + b.mass, 0),
    volume = pieces.reduce((s, b) => s + b.volume, 0);
  assert.ok(mass > 0);
  near(r.timber.totals.foundation.mass, mass);
  near(r.timber.totals.foundation.volume, volume);
  near(r.timber.totals.foundation.weight, (mass * 9.80665) / 1000);
  const rows = r.loads.rows.filter((q) => q.id === "timber-foundation");
  assert.equal(rows.length, 1);
  near(rows[0].characteristic, (mass * 9.80665) / 1000);
  near(
    r.loads.rows.reduce((s, q) => s + q.design, 0),
    r.loads.totalDesign,
  );
  near(
    r.loads.rows.reduce((s, q) => s + q.characteristic, 0),
    r.loads.totalCharacteristic,
  );
  assert.equal(cutting.invalid.length, 0);
  assert.equal(cutting.overlength.length, 0);
  assert.equal(cutting.summary.pieces, r.timber.instances.length);
  const ids = new Set(cutting.stocks.flatMap((s) => s.pieces.map((q) => q.sourceId)));
  for (const b of pieces) assert.ok(ids.has(b.id));
  near(estimate.procurementTimberVolume, cutting.summary.purchasedVolume);
  near(estimate.total, cutting.summary.purchasedVolume * 1000);
  near(r.foundation.reactionSum, r.loads.totalDesign);
  near(
    r.timber.mass,
    r.timber.instances.reduce((s, b) => s + b.mass, 0),
  );
});

test("increasing plies adds only actual foundation self-weight once to the house load", () => {
  const p = project(),
    a = calculate(p);
  p.foundation.grillage.plies = 4;
  const b = calculate(p);
  assert.ok(b.r.timber.totals.foundation.mass > a.r.timber.totals.foundation.mass);
  near(
    b.r.timber.mass - a.r.timber.mass,
    b.r.timber.totals.foundation.mass - a.r.timber.totals.foundation.mass,
  );
  const weight = ((b.r.timber.totals.foundation.mass - a.r.timber.totals.foundation.mass) * 9.80665) / 1000;
  near(b.r.loads.totalCharacteristic - a.r.loads.totalCharacteristic, weight);
  near(b.r.loads.totalDesign - a.r.loads.totalDesign, weight * loadFactors(p.loads).timber);
  near(b.r.foundation.reactionSum - a.r.foundation.reactionSum, weight * loadFactors(p.loads).timber);
});

test("every load reaches real span-end piles and reconstructs all pile reactions", () => {
  const { p, r, g } = calculate(project(10, 7));
  assert.ok(g.spans.length > 0);
  near(g.unassignedDesign, 0);
  near(g.unassignedCharacteristic, 0);
  const pileMap = new Map(r.piles.map((q) => [q.id, q])),
    totals = new Map(r.piles.map((q) => [q.id, { design: 0, service: 0 }]));
  for (const s of g.spans) {
    const a = pileMap.get(s.startPileId),
      b = pileMap.get(s.endPileId);
    assert.ok(a && b);
    near(distance(s.start, a), 0);
    near(distance(s.end, b), 0);
    near(s.length, distance(s.start, s.end));
    near(
      s.reactionStart + s.reactionEnd,
      s.pointLoads.reduce((sum, q) => sum + q.design, 0),
    );
    near(
      s.check.serviceStart + s.check.serviceEnd,
      s.pointLoads.reduce((sum, q) => sum + q.characteristic, 0),
    );
    totals.get(a.id).design += s.reactionStart;
    totals.get(b.id).design += s.reactionEnd;
    totals.get(a.id).service += s.check.serviceStart;
    totals.get(b.id).service += s.check.serviceEnd;
  }
  for (const q of r.piles) {
    near(q.reaction, totals.get(q.id).design);
    near(q.reactionCharacteristic, totals.get(q.id).service);
    assert.ok(q.beamIds?.length > 0);
  }
  near(
    g.spans.reduce((sum, s) => sum + s.designTotal, 0),
    r.loads.totalDesign,
  );
  near(r.foundation.reactionSum, r.loads.totalDesign);
  assert.ok(g.loadChecks.some((c) => c.id === "grillage-ply-connections" && c.status === "unverified"));
});

test("irregular spacing cannot manufacture an unsupported stock splice at the six-metre mark", () => {
  const p = project(10, 7);
  p.foundation.spacing = 4;
  const { r, g, cutting } = calculate(p);
  assert.ok(g.joints.length > 0);
  assert.ok(g.instances.every((b) => b.cutLength <= 6 + 1e-7));
  assert.equal(cutting.overlength.length, 0);
  assert.equal(
    r.splices.some((j) => j.role === "grillagePly"),
    false,
  );
  for (const beam of g.beams) {
    for (const s of beam.stations) {
      const pile = g.piles.find((q) => q.id === s.pileId);
      assert.ok(pile);
      near(distance(s.point, pile), 0);
    }
    const pieces = g.instances.filter((b) => b.beamId === beam.id);
    assert.ok(pieces.length);
    for (const piece of pieces) {
      assert.equal(piece.requireSingleStock, true);
      assert.ok(piece.stationEnd > piece.stationStart);
      assert.ok(piece.plyIndex >= 0 && piece.plyIndex < p.foundation.grillage.plies);
      near(piece.length, Math.hypot(...piece.end.map((v, i) => v - piece.start[i])));
    }
  }
  assert.ok(g.joints.some((j) => j.type === "splice"));
  for (const joint of g.joints) {
    const pile = g.piles.find((q) => q.id === joint.pileId);
    assert.ok(pile);
    near(distance(joint.point, pile), 0);
    assert.equal(joint.supported, true);
    assert.equal(joint.connectionVerified, false);
    if (joint.type !== "splice") continue;
    const beam = g.beams.find((b) => b.id === joint.beamId);
    assert.ok(beam);
    assert.ok(Number.isFinite(joint.station));
    const support = beam.stations.find(
      (s) => s.pileId === joint.pileId && Math.abs(s.station - joint.station) < 1e-6,
    );
    assert.ok(support, "Stock joints must coincide with real pile stations");
  }
});

test("old and partial foundation settings acquire nested grillage defaults without corrupting user values", () => {
  const old = project();
  delete old.foundation.grillage;
  const migrated = normalizeDesignerState(old);
  assert.equal(validateDesignerProject(migrated).valid, true);
  assert.deepEqual(migrated.foundation.grillage, {
    section: "50x200",
    plies: 3,
    deflectionRatio: 300,
    capSize: 250,
  });
  const a = calculate(migrated);
  assert.ok(a.r.timber.totals.foundation.mass > 0);
  near(a.r.geometry.levels[0].baseY, a.g.topY);
  const partial = project();
  partial.foundation.grillage = { plies: 4 };
  const normalized = normalizeDesignerState(partial);
  assert.equal(normalized.foundation.grillage.plies, 4);
  assert.equal(normalized.foundation.grillage.section, "50x200");
  assert.equal(normalized.foundation.grillage.deflectionRatio, 300);
  assert.equal(normalized.foundation.grillage.capSize, 250);
  assert.equal(validateDesignerProject(normalized).valid, true);
});

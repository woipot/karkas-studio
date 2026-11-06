import test from "node:test";
import assert from "node:assert/strict";
import {
  snowShapeMu,
  snowMu,
  snowBasis,
  unbalancedSnow,
  windK,
  loadFactors,
  basicCombinations,
  combineDesign,
  governingCombination,
  gableRoofWindCoefficients,
  roofHorizontalCoefficient,
  memberLoadProject,
} from "./load-profile.js";
import { generateHouse } from "./house-generator.js";
import { evaluateHouse } from "./house-engine.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
// Load-path tests pin the classic layout (ridge along x, joists along y, no generated bearing
// spine) so the hand calculations stay valid; generator choices are tested in house-generator tests.
const house = (spec) => {
  const { project, planning } = generateHouse({
    ...spec,
    roof: { ridgeAngle: 0, ...spec.roof },
    floor: { axis: "y", ...spec.floor },
    structure: { bearingWalls: false, ...spec.structure },
  });
  return evaluateHouse(project, planning).result;
};
const pile = (r, x, y) => r.piles.find((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);

test("SP 20 App. B scheme B.1: µ = 1 up to 30°, 0 from 60°, linear between; explicit µ wins", () => {
  for (const a of [0, 10, 25, 30]) near(snowShapeMu(a), 1);
  near(snowShapeMu(45), 0.5);
  near(snowShapeMu(40), 20 / 30);
  near(snowShapeMu(60), 0);
  near(snowShapeMu(70), 0);
  near(snowMu(45, 0.8), 0.8);
  near(snowMu(45, undefined), 0.5);
  const s = snowBasis({ snow: 2, snowCe: 0.85, snowCt: 0.9 });
  near(s.base, 2 * 0.85 * 0.9);
  near(snowBasis({ snow: 1.5 }).base, 1.5);
});

test("unbalanced variant 2: 1,25µ / 0,75µ within 20°…30°, none outside", () => {
  const u = unbalancedSnow(25, 25);
  assert.equal(u.cases.length, 2);
  near(u.cases[0].muLeft, 1.25);
  near(u.cases[0].muRight, 0.75);
  near(u.cases[1].muLeft, 0.75);
  near(u.cases[1].muRight, 1.25);
  assert.equal(unbalancedSnow(15, 15), null);
  assert.equal(unbalancedSnow(35, 35), null);
  near(unbalancedSnow(25, 25, { override: 0.8 }).cases[0].muLeft, 1.25 * 0.8);
});

test("wind k(ze) per SP 20 table 11.2 with linear interpolation", () => {
  near(windK(3, "B"), 0.5);
  near(windK(5, "B"), 0.5);
  near(windK(7.5, "B"), 0.575);
  near(windK(10, "B"), 0.65);
  near(windK(15, "A"), 1.125);
  near(windK(20, "C"), 0.55);
  near(windK(5, "A"), 0.75);
  near(windK(30, "C"), 0.675);
  // roof slope field zones at 25°: windward pressure 0,2 + 10/15·0,2, leeward −0,4
  const c = gableRoofWindCoefficients(25);
  near(c.windwardPressure, 0.2 + (0.2 * 10) / 15);
  near(c.leeward, -0.4);
  near(roofHorizontalCoefficient(25), 0.2 + (0.2 * 10) / 15 + 0.4);
});

test("partial factors by load kind and explicit gammaG/gammaQ overrides", () => {
  const f = loadFactors({ live: 1.5 });
  near(f.timber, 1.1);
  near(f.layers, 1.2);
  near(f.live, 1.3);
  near(f.snow, 1.4);
  near(f.wind, 1.4);
  near(f.favourable, 0.9);
  near(loadFactors({ live: 2 }).live, 1.2);
  const o = loadFactors({ live: 1.5, gammaG: 1.35, gammaQ: 1.5 });
  near(o.timber, 1.35);
  near(o.layers, 1.35);
  near(o.live, 1.5);
  near(o.snow, 1.5);
  const m = memberLoadProject({ loads: { wind: 0.3, live: 1.5 } }, { k: 0.6 });
  near(m.loads.gammaG, 1.2);
  near(m.loads.gammaQ, 1.4);
  near(m.loads.wind, 0.18);
});

test("basic combinations: ψ 1,0 leading / 0,9 second, envelope by leading action", () => {
  const f = loadFactors({ live: 1.5 }),
    combos = basicCombinations(["snow", "live"], f);
  assert.deepEqual(
    combos.map((c) => c.id),
    ["snow-leading", "live-leading"],
  );
  near(combos[0].psi.snow, 1);
  near(combos[0].psi.live, 0.9);
  const components = { timber: 10, layers: 10, live: 100, snow: 100 };
  // hand: 10·1,1 + 10·1,2 + 100·1,4 + 0,9·100·1,3 = 280
  near(combineDesign(components, f, combos[0]), 11 + 12 + 140 + 117);
  // hand: 23 + 130 + 0,9·140 = 279
  near(combineDesign(components, f, combos[1]), 23 + 130 + 126);
  assert.equal(governingCombination(components, f).governing.id, "snow-leading");
  const three = basicCombinations(["snow", "live", "wind"], f);
  near(three[0].psi.wind, 0.7);
});

test("A1: truss roof reactions go to the eave walls, not around the whole perimeter", () => {
  const r = house({ width: 8, depth: 10 });
  // Sg·µ·plan area = 1,5·1·80 (no overhangs)
  near(r.loads.snow, 1.5 * 1 * 80, 1e-6);
  assert.equal(r.loads.roofSupportRouting.length, 1);
  const route = r.loads.roofSupportRouting[0];
  assert.ok(
    route.rows.every((q) => Math.abs(q.bearingStart[2]) < 1e-6 && Math.abs(q.bearingEnd[2] - 10) < 1e-6),
  );
  const A = route.rows.reduce((s, q) => s + q.characteristicA, 0),
    B = route.rows.reduce((s, q) => s + q.characteristicB, 0);
  // symmetric truss, no overhang: half of (layers + wood + snow) on each eave line
  near(A, (route.dead + route.snow) / 2, 1e-6);
  near(B, (route.dead + route.snow) / 2, 1e-6);
  assert.equal(
    r.checks.some((c) => c.id === "roof-load-path-fallback"),
    false,
  );
  const eave = pile(r, 4, 0),
    gable = pile(r, 0, 4);
  assert.ok(eave.reactionEnvelope > 3 * gable.reactionEnvelope);
  // Audit hand calculation with the legacy factors and µ = 0,8 (A1): eave pile 21,3 → 35,5 kN,
  // gable pile 23,7 → 12,4 kN. ψ = 0,9 on the second action leaves ~1 kN difference.
  const legacy = house({ width: 8, depth: 10, loads: { gammaG: 1.1, gammaQ: 1.4 }, roof: { snowMu: 0.8 } });
  near(pile(legacy, 4, 0).reactionEnvelope, 35.5, 1.5);
  near(pile(legacy, 0, 4).reactionEnvelope, 12.4, 0.5);
  near(legacy.foundation.balanceError, 0, 1e-6);
});

test("unbalanced snow governs fink webs; reaction shift matches the 0,5625 lever hand calculation", () => {
  const r = house({ width: 8, depth: 10 }),
    z = r.roofModel.zones[0],
    t = z.analysis;
  assert.ok(t.snowCases.length === 3);
  const webs = t.bars.filter((b) => b.role === "web" && b.snowCase !== "symmetric");
  assert.ok(webs.length > 0, "an unbalanced case governs at least one web");
  for (const b of webs) assert.ok(b.utilization > b.utilizationByCase.symmetric);
  assert.notEqual(z.snowCaseSummary.governing, "symmetric");
  const check = r.checks.find((c) => c.id === `roof-${z.id}-snow-cases`);
  assert.ok(check && check.governingCase === z.snowCaseSummary.governing);
  // R_A(unbalanced-left) − R_A(symmetric) = s·sp·S·γQ·(1,25·3/8 + 0,75/8 − 1/2)
  const input = t.input,
    RA = (id) => t.reactionsByCase[id].find((q) => q.node === "A").y,
    snowDesign = input.snow * input.spacing * input.span * input.gammaQ;
  near(RA("unbalanced-left") - RA("symmetric"), snowDesign * (1.25 * 0.375 + 0.75 * 0.125 - 0.5), 1e-6);
  near(input.deflectionLimit, z.deflectionRatio);
});

test("A2: upper floor joists deliver half the storey to each bearing wall; 2-storey eave pile fails capacity", () => {
  const one = house({ width: 8, depth: 10 }),
    two = house({ width: 8, depth: 10, levels: [{ height: 2.8 }, { height: 2.8 }] });
  const l2 = two.loads.floorRouting.levels.find((l) => l.level === 2);
  assert.equal(l2.method, "joist-reactions");
  const half = (l2.dead + l2.live) / 2;
  near(l2.supportTotals["lowerWall:GEN-L1-W1"], half, 1e-6);
  near(l2.supportTotals["lowerWall:GEN-L1-W3"], half, 1e-6);
  // 1st floor: joists along y rest on the cross beams only; the parallel edge beam gets none
  const l1 = two.loads.floorRouting.levels.find((l) => l.level === 1);
  assert.equal(
    Object.keys(l1.supportTotals).some((k) => k === "grillage:GB001"),
    false,
  );
  near(
    Object.values(l1.supportTotals).reduce((s, v) => s + v, 0),
    l1.dead + l1.live,
    1e-6,
  );
  const P1 = pile(one, 4, 0).reactionEnvelope,
    P2 = pile(two, 4, 0).reactionEnvelope;
  // hand estimate (legacy factors in the audit: ~58 kN; profile adds µ=1, γf 1,2/1,3)
  assert.ok(P2 > 1.6 * P1);
  assert.ok(P2 > two.project.foundation.capacity);
  assert.equal(two.checks.find((c) => c.id === "pileCapacity").status, "fail");
  assert.equal(two.checks.find((c) => c.id === "floor-load-path").status, "pass");
});

test("vertical balance closes exactly for every combination and plan shape", () => {
  for (const spec of [
    { width: 8, depth: 10 },
    { width: 10, depth: 8, levels: [{ height: 2.8 }, { height: 2.8 }] },
    { template: "l-shape", width: 10, depth: 8 },
  ]) {
    const r = house(spec);
    near(r.foundation.balanceError, 0, 1e-6);
    for (const c of r.foundation.combinations) {
      const total = r.loads.combinations.find((q) => q.id === c.id).totalDesign;
      near(c.reactionSum, total, 1e-6);
    }
    near(
      r.loads.rows.reduce((s, q) => s + q.design, 0),
      r.loads.totalDesign,
      1e-6,
    );
  }
});

test("wind: w0·k(ze)·(0,8+0,5) on walls plus ONE gable or the roof projection per direction", () => {
  const r = house({ width: 8, depth: 10 }),
    w = r.loads.windPressure,
    level = r.geometry.levels[0],
    H = level.topY - level.baseY,
    rise = 5 * Math.tan((25 * Math.PI) / 180);
  assert.ok(w.ze > 5 && w.ze < 10);
  near(w.k, 0.5 + (0.15 * (w.ze - 5)) / 5);
  near(w.wm, 0.3 * w.k);
  // ridge along x: gables face x; wind along y sees the roof slopes in projection
  near(r.loads.windForceX, w.wm * 1.3 * (10 * H + (10 * rise) / 2), 1e-6);
  near(r.loads.windForceY, w.wm * (1.3 * 8 * H + roofHorizontalCoefficient(25) * 8 * rise), 1e-6);
  near(r.loads.windDesignX, 1.4 * r.loads.windForceX);
  // the old value counted both gables in both directions
  assert.ok(r.loads.windForceX < w.wm * 1.3 * (10 * H + 2 * ((10 * rise) / 2)));
  // bracing demand of a wall along x: 1,4 · storey force along x shared by the two parallel walls
  const line = r.bracingModel.wallLines.find((q) => q.wallId === "GEN-L1-W1" && q.level === 1);
  near(line.demandShear, (1.4 * r.loads.windStoreys[0].forceX) / 2, 1e-9);
});

test("wind uplift of truss heels: warning with the anchor force once suction beats 0,9·G", () => {
  const calm = house({ width: 8, depth: 10 }),
    storm = house({ width: 8, depth: 10, loads: { wind: 1.2, roofDead: 0.15 } }),
    id = "wind-uplift-" + calm.roofModel.zones[0].id;
  assert.equal(calm.checks.find((c) => c.id === id).status, "pass");
  const c = storm.checks.find((q) => q.id === id);
  assert.equal(c.status, "warning");
  assert.ok(c.value > 0);
  assert.match(c.note, /кН/);
});

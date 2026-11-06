import test from "node:test";
import assert from "node:assert/strict";
import { calculate, validateProject, defaultProject } from "./engine.js";
const near = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("default model valid; tributary areas and vertical reactions balance", () => {
  const r = calculate();
  assert.equal(r.validation.valid, true);
  near(
    r.piles.reduce((s, p) => s + p.tributaryArea, 0),
    96,
  );
  near(r.foundation.reactionSum, r.loads.totalDesign);
  near(r.foundation.characteristicSum, r.loads.totalCharacteristic);
  near(
    r.loads.rows.reduce((s, x) => s + x.characteristic, 0),
    r.loads.totalCharacteristic,
  );
});
test("symmetric house has symmetric reactions; area allocation is not uniform per pile", () => {
  const r = calculate({ openings: [] });
  for (const a of r.piles) {
    const b = r.piles.find((b) => Math.abs(b.x - (12 - a.x)) < 1e-8 && Math.abs(b.y - (8 - a.y)) < 1e-8);
    near(a.reaction, b.reaction);
  }
  assert.ok(r.foundation.maxReaction > r.foundation.minReaction * 1.1);
});
test("hand-check simple beam at 4m; q=1kN/m gives M=2kNm and 10mm deflection", () => {
  // 25 lines × (8−2×.05)m + 24m rim boards, section .05×.2m. Subtract known
  // timber pressure from the extra layers so total dead pressure is .5kPa.
  const timberPressure = ((25 * 7.9 + 24) * 0.05 * 0.2 * 500 * 9.80665) / 1000 / 96;
  const r = calculate({
    floorDead: 0.5 - timberPressure,
    liveLoad: 1.5,
    joistStep: 0.5,
    joistB: 50,
    joistH: 200,
    E: 10000,
    gammaG: 1,
    gammaQ: 1,
  });
  near(r.joist.moment, 2);
  near(r.joist.stress, 6);
  near(r.joist.deflection, 10);
});
test("doubling beam span quadruples moment, multiplies deflection by sixteen", () => {
  const a = calculate({ joistSpan: 2 }),
    b = calculate({ joistSpan: 4 });
  near(b.joist.moment / a.joist.moment, 4);
  near(b.joist.deflection / a.joist.deflection, 16);
});
test("snow slope endpoints and roof actual area correct", () => {
  near(calculate({ roofPitch: 30 }).loads.mu, 0.8);
  near(calculate({ roofPitch: 45 }).loads.mu, 0.4);
  near(calculate({ roofPitch: 60 }).loads.mu, 0);
  near(calculate({ roofPitch: 60 }).geometry.roofArea, 192);
});
test("larger capacity leaves forces unchanged and halves utilization", () => {
  const a = calculate({ pileCapacity: 40 }),
    b = calculate({ pileCapacity: 80 });
  near(a.foundation.maxReaction, b.foundation.maxReaction);
  near(a.foundation.utilization / 2, b.foundation.utilization);
});
test("overload is reported, not hidden or clipped", () => {
  const r = calculate({ pileCapacity: 1, joistH: 100, joistSpan: 8 });
  assert.equal(r.status, "fail");
  assert.ok(r.foundation.utilization > 1);
  assert.ok(r.joist.utilization > 1);
});
test("openings replace wall weight; local reaction changes preserve balance", () => {
  const a = calculate({ openings: [] });
  const b = calculate({
    openings: [{ id: "x", wall: "north", offset: 1, width: 2, height: 2, sill: 0.5, type: "window" }],
  });
  near(
    a.loads.dead - a.timber.weight - (b.loads.dead - b.timber.weight),
    4 * (defaultProject.wallDead - defaultProject.openingDead),
  );
  near(b.foundation.reactionSum, b.loads.totalDesign);
});
test("geometry rejects overlapping, out-of-bounds and nonexistent-floor openings", () => {
  const o = { id: "a", wall: "north", offset: 1, width: 2, height: 1.5, sill: 0.8, type: "window" };
  assert.equal(validateProject({ openings: [o, { ...o, id: "b", offset: 2 }] }).valid, false);
  assert.equal(validateProject({ openings: [{ ...o, offset: 11 }] }).valid, false);
  assert.equal(validateProject({ openings: [{ ...o, floor: 2 }] }).valid, false);
  assert.equal(validateProject({ openings: [{ ...o, sill: 2 }] }).valid, false);
});
test("nonfinite, strings and invalid fractions rejected", () => {
  for (const p of [
    { length: NaN },
    { snow: Infinity },
    { wind: -1 },
    { floors: 1.5 },
    { joistB: "50" },
    { pileSpacing: 0 },
    { openings: null },
  ])
    assert.equal(validateProject(p).valid, false);
  assert.throws(() => calculate({ length: 0 }), { name: "ProjectValidationError" });
});
test("irregular dimensions and added center row maintain maximum spacing and equilibrium", () => {
  const r = calculate({ length: 11.3, width: 7.2, pileSpacing: 2.1, floors: 2 });
  assert.ok(r.foundation.actualSpacingX <= 2.1 + 1e-8);
  assert.ok(r.foundation.actualSpacingY <= 2.1 + 1e-8);
  assert.ok(r.foundation.ys.includes(3.6));
  near(r.foundation.reactionSum, r.loads.totalDesign);
});
test("wind is independent horizontal load, not silently added to gravity", () => {
  const a = calculate({ wind: 0 }),
    b = calculate({ wind: 1 });
  near(a.loads.totalDesign, b.loads.totalDesign);
  assert.ok(b.loads.windForceX > 0);
  assert.ok(b.loads.windForceY > 0);
});
test("without internal wall no center wall weight; still equilibrates", () => {
  const r = calculate({ internalBearing: false, width: 7, pileSpacing: 2 });
  near(r.loads.innerWallWeight, 0);
  near(r.foundation.reactionSum, r.loads.totalDesign);
});
test("independent beam span does not shrink the material required for the geometric floor", () => {
  const a = calculate(),
    b = calculate({ joistSpan: 0.5 });
  near(a.bom.joistLength, 21 * 7.9);
  near(a.bom.joistLength, b.bom.joistLength);
  near(a.bom.joistVolume, b.bom.joistVolume);
  assert.ok(b.validation.warnings.some((w) => w.includes("отличается")));
  const noCenter = calculate({ internalBearing: false, joistSpan: 8 });
  near(noCenter.bom.joistLength, a.bom.joistLength);
  near(noCenter.bom.joistCount, a.bom.joistCount / 2);
});

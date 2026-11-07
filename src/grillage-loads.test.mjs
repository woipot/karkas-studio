import test from "node:test";
import assert from "node:assert/strict";
import { solveGrillagePointLoads, analyzeGrillageLoads } from "./grillage-loads.js";
const near = (a, b, t = 1e-7) => assert.ok(Math.abs(a - b) < t, `${a} ≠ ${b}`);
const parameters = { length: 4, b: 50, h: 200, plies: 3, E: 10000, Fb: 13, Fv: 1.5, deflectionRatio: 300 };
test("point load at midspan: analytical PL/4 moment and PL³/48EI deflection", () => {
  const P = 12,
    L = 4,
    r = solveGrillagePointLoads({ ...parameters, loads: [{ at: 2, design: P, characteristic: P }] });
  near(r.reactionStart, 6);
  near(r.reactionEnd, 6);
  near(r.maxMoment, (P * L) / 4);
  const I = (3 * 0.05 * 0.2 ** 3) / 12,
    EI = 10000 * 1000 * I;
  near(r.deflection, ((P * L ** 3) / (48 * EI)) * 1000);
  near(r.I, (3 * 50 * 200 ** 3) / 12);
  assert.equal(r.partial, true);
});
test("asymmetric load reactions satisfy both force and moment equilibrium", () => {
  const r = solveGrillagePointLoads({
    ...parameters,
    loads: [
      { at: 1, design: 20, characteristic: 10 },
      { at: 3, design: 4, characteristic: 2 },
    ],
  });
  near(r.reactionStart + r.reactionEnd, 24);
  near(r.reactionEnd * 4, 20 * 1 + 4 * 3);
  near(r.serviceStart + r.serviceEnd, 12);
  assert.ok(r.deflection > 0);
});
test("loads directly over supports create reactions without fictitious span bending", () => {
  const r = solveGrillagePointLoads({
    ...parameters,
    loads: [
      { at: 0, design: 20, characteristic: 15 },
      { at: 4, design: 30, characteristic: 25 },
    ],
  });
  near(r.reactionStart, 20);
  near(r.reactionEnd, 30);
  near(r.maxMoment, 0);
  near(r.maxShear, 0);
  near(r.deflection, 0);
});
test("uniform line load quadrature approaches 5qL⁴/384EI and qL²/8", () => {
  const q = 4,
    L = 4,
    n = 200,
    r = solveGrillagePointLoads({
      ...parameters,
      loads: Array.from({ length: n }, (_, i) => ({
        at: (L * (i + 0.5)) / n,
        design: (q * L) / n,
        characteristic: (q * L) / n,
      })),
    });
  const I = (3 * 0.05 * 0.2 ** 3) / 12,
    delta = ((5 * q * L ** 4) / (384 * 10000 * 1000 * I)) * 1000;
  near(r.maxMoment, (q * L * L) / 8, 1e-6);
  near(r.deflection, delta, 0.001);
});
test("load routing sends each force through a real span and into its two piles", () => {
  const model = {
    piles: [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 4, y: 0 },
    ],
    spans: [
      {
        id: "S",
        beamId: "G",
        start: { x: 0, y: 0 },
        end: { x: 4, y: 0 },
        startPileId: "A",
        endPileId: "B",
        length: 4,
      },
    ],
    quantities: {},
  };
  const p = {
    foundation: { grillage: { section: "50x200", plies: 3, deflectionRatio: 300 } },
    material: { E: 10000, Fb: 13, Fv: 1.5 },
  };
  const r = analyzeGrillageLoads(p, model, [
    { point: { x: 1, y: 0.5 }, design: 20, characteristic: 10, area: 4 },
  ]);
  near(r.piles[0].reaction, 15);
  near(r.piles[1].reaction, 5);
  near(r.balanceError, 0);
  near(
    r.piles.reduce((a, b) => a + b.tributaryArea, 0),
    4,
  );
  assert.ok(r.loadChecks.some((c) => c.status === "unverified"));
});

test("round-off negatives (−1e-17) from load splitting are treated as zero, real negatives still fail", () => {
  const base = { length: 2, b: 50, h: 200, plies: 3, E: 10000, Fb: 13 };
  const r = solveGrillagePointLoads({
    ...base,
    loads: [{ at: 1, design: -3e-17, characteristic: -2.9e-17 }],
  });
  assert.ok(Number.isFinite(r.maxMoment ?? r.check?.maxMoment ?? 0));
  assert.throws(() =>
    solveGrillagePointLoads({ ...base, loads: [{ at: 1, design: -0.5, characteristic: -0.4 }] }),
  );
});

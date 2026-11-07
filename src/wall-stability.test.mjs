import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFullHeightWall,
  checkFullHeightWalls,
  evaluateWallSectionCandidates,
} from "./wall-stability.js";
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const input = () => ({
  studs: [{ id: "s", length: 5.4, b: 50, h: 150, tributaryWidth: 0.6 }],
  roofReactionLine: { design: 5, service: 4 },
  wind: 0.3,
});

test("Euler uses the complete actual height, never the former 2.8m storey or hidden stud restraint", () => {
  const p = input(),
    a = checkFullHeightWall({ ...p, material: { studRestraint: 2.8 }, studRestraint: 2.8 }),
    b = checkFullHeightWall({ ...p, studs: [{ ...p.studs[0], length: 2.7 }] });
  near(a.worst.unbracedWeakLength, 5.4);
  near(a.worst.unbracedStrongLength, 5.4);
  near(a.worst.eulerWeak, b.worst.eulerWeak / 4);
  near(a.worst.eulerStrong, b.worst.eulerStrong / 4);
  near(a.worst.eulerWeak, (Math.PI ** 2 * 10000 * ((150 * 50 ** 3) / 12)) / 5400 ** 2 / 1000);
  near(a.worst.eulerStrong / a.worst.eulerWeak, 9);
});
test("bottom axial load adds roof reaction, real wall layers and timber mass exactly once", () => {
  const r = checkFullHeightWall(input()),
    s = r.worst;
  near(s.timberMass, 0.05 * 0.15 * 5.4 * 500);
  near(s.wallWeight, 0.5 * 0.6 * 5.4);
  near(s.force, 5 * 0.6 + ((s.timberMass * 9.80665) / 1000 + s.wallWeight) * 1.1);
  near(s.serviceForce, 4 * 0.6 + s.timberWeight + s.wallWeight);
});
test("independent 3m wind beam: q=.12kN/m gives M=.189kNm design, stress1.008MPa, first-order deflection.9mm", () => {
  const r = checkFullHeightWall({
      studs: [{ id: "w", length: 3, b: 50, h: 150, tributaryWidth: 0.6 }],
      roofReactionLine: 0,
      wallDead: 0,
      wind: 0.2,
    }),
    s = r.worst;
  near(s.windLineService, 0.12);
  near(s.windLineDesign, 0.168);
  near(s.windMoment, 0.189);
  near(s.windStressFirstOrder, 1.008);
  near(s.windDeflectionFirstOrder, 0.9);
  assert.ok(s.windDeflection > s.windDeflectionFirstOrder);
  assert.ok(s.windStress > s.windStressFirstOrder);
});
test("full-height 50x150 can fail while a larger same-width section passes the shown private checks", () => {
  // Weak axis restrained by sheathing fasteners at 300 mm; the strong axis has the full 5.4 m.
  const braced = () => ({ ...input(), weakAxisRestraint: 0.3 }),
    a = checkFullHeightWall(braced()),
    b = checkFullHeightWall({ ...braced(), studs: [{ ...input().studs[0], h: 200 }] });
  // 50x150: λ = 5400/(150/√12) = 124.7 > 120 (СНиП II-25-80 табл. 14) → fails on slenderness.
  near(a.worst.lambda, 5400 / (150 / Math.sqrt(12)), 1e-6);
  assert.ok(a.worst.slendernessUtilization > 1);
  // Unrestrained, even 50x200 is far beyond λmax about the 50 mm axis.
  assert.equal(
    checkFullHeightWall({ ...input(), studs: [{ ...input().studs[0], h: 200 }] }).capacityPass,
    false,
  );
  assert.equal(a.capacityPass, false);
  assert.equal(a.status, "fail");
  assert.equal(b.capacityPass, true);
  assert.equal(b.status, "unverified");
  assert.equal(b.worst.b, 50);
  assert.equal(b.worst.h, 200);
  const candidates = evaluateWallSectionCandidates(braced());
  assert.equal(candidates.recommended.section, "50x200");
});
test("strong-axis moment amplification is 1/ξ with ξ = 1 − N/(φ·Rc·A) (СП 64) and fails at instability", () => {
  const r = checkFullHeightWall(input()),
    s = r.worst,
    lambda = 5400 / (150 / Math.sqrt(12)),
    phi = 3000 / lambda ** 2,
    xi = 1 - (s.force * 1000) / (phi * 12 * 50 * 150);
  near(s.phiStrong, phi);
  near(s.xi, xi);
  near(s.amplification, 1 / xi);
  near(s.windStress, s.windStressFirstOrder * s.amplification);
  // Strength interaction ф. (28): N/(A·Rc) + Mд/(W·Rи).
  near(s.strengthInteraction, (s.force * 1000) / (7500 * 12) + s.windStress / 13);
  const fail = checkFullHeightWall({ ...input(), roofReactionLine: { design: 1000, service: 1000 } });
  assert.equal(fail.status, "fail");
  assert.equal(fail.capacityPass, false);
  assert.equal(fail.worst.amplification, Infinity);
});
test("Emin changes stability while mean E still controls first-order bending stiffness", () => {
  const a = checkFullHeightWall(input()),
    b = checkFullHeightWall({ ...input(), Emin: 5000 });
  near(b.worst.eulerWeak, a.worst.eulerWeak / 2);
  near(b.worst.eulerStrong, a.worst.eulerStrong / 2);
  near(b.worst.windDeflectionFirstOrder, a.worst.windDeflectionFirstOrder);
  assert.ok(b.worst.windDeflection > a.worst.windDeflection);
});
test("compression capacity is φ·Rc·A about the governing axis, never above Rc·A", () => {
  const r = checkFullHeightWall({ ...input(), Fc: 0.2, studs: [{ ...input().studs[0], length: 1 }] }),
    s = r.worst,
    lambda = 1000 / (50 / Math.sqrt(12)),
    phi = 1 - 0.8 * (lambda / 100) ** 2;
  assert.ok(lambda < 70);
  near(s.phi, phi);
  near(s.compressionCapacity, (phi * 0.2 * 50 * 150) / 1000);
  assert.ok(s.compressionCapacity <= (0.2 * 50 * 150) / 1000);
  // Sheathing on the face restrains the weak axis: the strong axis then governs.
  const braced = checkFullHeightWall({
      ...input(),
      weakAxisRestraint: 0.3,
      studs: [{ ...input().studs[0], length: 2.65 }],
    }).worst,
    strong = 2650 / (150 / Math.sqrt(12));
  near(braced.lambda, strong);
  near(braced.compressionCapacity, ((1 - 0.8 * (strong / 100) ** 2) * 12 * 7500) / 1000);
  near(braced.compressionCapacity, 63.03, 0.05);
});
test("stock fit checks the long-point blank including a top miter, not only axis length", () => {
  const r = checkFullHeightWall({
    studs: [{ id: "cut", length: 5.95, b: 50, h: 200, cutEnd: { scheme: "miter", angle: 45 } }],
    roofReactionLine: 0,
    wallDead: 0,
  });
  near(r.worst.cutLength, 6.05);
  assert.equal(r.stockFits, false);
  assert.equal(r.capacityPass, false);
  assert.equal(r.checks.find((c) => c.id === "full-wall-stock").status, "fail");
});
test("wrapper joins stock pieces back to the complete continuous logical stud and rejects over-6m assembly", () => {
  const p = {
    height: 2.8,
    walls: [{ id: "w", studStep: 0.6 }],
    material: { E: 10000, Fc: 12, Ft: 8, Fb: 13, Fv: 1.5, density: 500, studRestraint: 2.8 },
    loads: { wind: 0, gammaG: 1.1, gammaQ: 1.4, wallDead: 0 },
  };
  const a = { role: "stud", wallId: "w", level: 1, memberId: "full", b: 50, h: 200 };
  const r = {
    timber: {
      instances: [
        { ...a, id: "p1", start: [0, 0, 0], end: [0, 6, 0], partIndex: 0 },
        { ...a, id: "p2", start: [0, 5.6, 0], end: [0, 6.4, 0], partIndex: 1 },
      ],
    },
  };
  const roof = {
      wallProfiles: [
        { wallId: "w", level: 1, mode: "continuous", roofReactionLine: { design: 0, service: 0 } },
      ],
    },
    m = checkFullHeightWalls(p, r, roof);
  near(m.walls[0].worst.length, 6.4);
  near(m.walls[0].worst.cutLength, 6.4);
  assert.equal(m.walls[0].stockFits, false);
  assert.equal(m.status, "fail");
});
test("missing roof reaction cannot approve a loadbearing full-height wall and stacked walls stay unverified", () => {
  const r = checkFullHeightWall({
    studs: [{ id: "s", length: 3, b: 50, h: 200 }],
    wallDead: 0,
    weakAxisRestraint: 0.3,
  });
  assert.equal(r.capacityPass, false);
  assert.equal(r.status, "unverified");
  assert.equal(r.checks.find((c) => c.id === "full-wall-load-path").status, "unverified");
  const m = checkFullHeightWalls(
    { walls: [] },
    { timber: { instances: [] } },
    { wallProfiles: [{ wallId: "w", level: 1, mode: "stacked" }] },
  );
  assert.equal(m.capacityPass, false);
  assert.equal(m.status, "unverified");
});
test("wind deflection ratio is explicit and not silently switched by wall height", () => {
  const a = checkFullHeightWall({ ...input(), deflectionRatio: 200 }),
    b = checkFullHeightWall({ ...input(), deflectionRatio: 300 });
  near(a.worst.deflectionAllowed, 5400 / 200);
  near(b.worst.deflectionAllowed, 5400 / 300);
  near(b.worst.deflectionUtilization, a.worst.deflectionUtilization * 1.5);
});
test("uplift is treated as tension without a fictitious compression amplification", () => {
  const r = checkFullHeightWall({
      studs: [{ id: "up", length: 3, b: 50, h: 150, roofForceDesign: -10, roofForceService: -8 }],
      wallDead: 0,
      wind: 0,
    }),
    s = r.worst;
  assert.ok(s.force < 0);
  near(s.compressionForce, 0);
  assert.ok(s.tensionForce > 0);
  near(s.amplification, 1);
  near(s.tensionUtilization, s.tensionForce / s.tensionCapacity);
});
test("malformed dimensions, stiffness, loads and cut metadata produce explicit validation failures", () => {
  for (const patch of [
    { studs: [] },
    { E: NaN },
    { Emin: 20000 },
    { wind: Infinity },
    { stockLength: 8 },
    { spacing: 0 },
    { roofReactionLine: { design: NaN } },
    { studs: [{ id: "x", length: 4, b: 50, h: 150, cutEnd: { scheme: "miter", angle: NaN } }] },
  ]) {
    const r = checkFullHeightWall({ ...input(), ...patch });
    assert.equal(r.status, "fail");
    assert.ok(r.errors.length > 0);
    assert.equal(r.capacityPass, false);
  }
});

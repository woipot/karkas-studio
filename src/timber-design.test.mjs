import test from "node:test";
import assert from "node:assert/strict";
import {
  axialCompression,
  bearingPerpendicular,
  bucklingCoefficient,
  compressionBending,
  finalDeflection,
  floorFrequency,
  lambdaLimit,
  notchedShear,
  resolveTimberMaterial,
  slenderness,
} from "./timber-design.js";
import { buildTruss } from "./trusses.js";
import { checkDesignerMembers } from "./designer-mechanics.js";
import { calculateDesigner, defaultDesignerProject } from "./designer-engine.js";
import { generateHouse } from "./house-generator.js";
import { evaluateHouse } from "./house-engine.js";
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("φ: parabolic branch λ ≤ 70, hyperbolic branch λ > 70 and near-continuity at λ = 70 (СП 64)", () => {
  near(bucklingCoefficient(0), 1);
  near(bucklingCoefficient(50), 1 - 0.8 * 0.25);
  near(bucklingCoefficient(100), 0.3);
  near(bucklingCoefficient(185), 3000 / 185 ** 2);
  const below = bucklingCoefficient(70),
    above = bucklingCoefficient(70 + 1e-9);
  near(below, 0.608);
  near(above, 3000 / 4900, 1e-6);
  // The standard's two branches meet within 0.7 % at λ = 70.
  assert.ok(Math.abs(above - below) / below < 0.007);
  for (let l = 1; l < 200; l++) assert.ok(bucklingCoefficient(l) <= bucklingCoefficient(l - 1) + 0.005);
});

test("reference: truss web 50x100, λ = 185, N = −5.44 kN → capacity ≈ 5.27 kN, u ≈ 1.03, λmax 150 fails", () => {
  const i = 50 / Math.sqrt(12),
    length = (185 * i) / 1000,
    r = axialCompression({ N: 5.44, b: 50, h: 100, l0Strong: length, l0Weak: length, Fc: 12, kind: "web" });
  near(r.lambda, 185, 1e-9);
  near(r.capacity, ((3000 / 185 ** 2) * 12 * 5000) / 1000);
  near(r.capacity, 5.26, 0.02);
  near(r.utilization, 1.03, 0.01);
  assert.ok(r.utilization > 1);
  assert.equal(r.lambdaLimit, 150);
  assert.ok(r.slendernessUtilization > 1);
});

test("reference: stud 50x150, l = 2.65 m, strong axis λ ≈ 61 → ≈ 63 kN; weak axis is checked with its own l0", () => {
  const strong = axialCompression({
    N: 10,
    b: 50,
    h: 150,
    l0Strong: 2.65,
    l0Weak: 0.3,
    Fc: 12,
    kind: "column",
  });
  near(strong.lambdaStrong, 2650 / (150 / Math.sqrt(12)));
  near(strong.lambdaStrong, 61.2, 0.05);
  assert.equal(strong.governingAxis, "strong");
  near(strong.capacity, ((1 - 0.8 * (strong.lambdaStrong / 100) ** 2) * 12 * 7500) / 1000);
  near(strong.capacity, 63.0, 0.1);
  const weak = axialCompression({
    N: 10,
    b: 50,
    h: 150,
    l0Strong: 2.65,
    l0Weak: 2.65,
    Fc: 12,
    kind: "column",
  });
  assert.equal(weak.governingAxis, "weak");
  near(weak.capacity, ((3000 / weak.lambdaWeak ** 2) * 12 * 7500) / 1000);
  assert.ok(weak.slendernessUtilization > 1);
});

test("λmax per SNiP II-25-80 table 14: chords/columns/support struts 120, other web 150, bracing 200", () => {
  assert.equal(lambdaLimit("chord"), 120);
  assert.equal(lambdaLimit("column"), 120);
  assert.equal(lambdaLimit("supportStrut"), 120);
  assert.equal(lambdaLimit("web"), 150);
  assert.equal(lambdaLimit("bracing"), 200);
  near(slenderness(1, 100), 1000 / (100 / Math.sqrt(12)));
});

test("compression + bending: Mд = M/ξ, ξ = 1 − N/(φ·Rc·A) about the bending plane, plus out-of-plane term", () => {
  const N = 20,
    M = 1.5,
    r = compressionBending({ N, M, b: 50, h: 200, l0Bending: 3, l0Weak: 0.6, Fc: 12, Fb: 13 }),
    A = 10000,
    W = (50 * 200 ** 2) / 6,
    lambda = 3000 / (200 / Math.sqrt(12)),
    phi = lambda <= 70 ? 1 - 0.8 * (lambda / 100) ** 2 : 3000 / lambda ** 2,
    xi = 1 - (N * 1000) / (phi * 12 * A),
    Md = M / xi;
  near(r.xi, xi);
  near(r.Md, Md);
  near(r.strengthUtilization, (N * 1000) / (A * 12) + (Md * 1e6) / (W * 13));
  const lambdaY = 600 / (50 / Math.sqrt(12)),
    phiY = 1 - 0.8 * (lambdaY / 100) ** 2,
    phiM = ((140 * 50 ** 2) / (600 * 200)) * 1.13;
  near(r.phiM, phiM);
  near(r.outOfPlaneUtilization, (N * 1000) / (phiY * 12 * A) + ((Md * 1e6) / (phiM * 13 * W)) ** 2);
  // N → φ·Rc·A drives ξ → 0 and the amplified moment to infinity.
  const unstable = compressionBending({
    N: 400,
    M,
    b: 50,
    h: 200,
    l0Bending: 3,
    l0Weak: 0.6,
    Fc: 12,
    Fb: 13,
  });
  assert.ok(unstable.xi <= 0);
  assert.equal(unstable.utilization, Infinity);
  // Without axial force the strength term reduces to M/(W·Rи).
  near(
    compressionBending({ N: 0, M, b: 50, h: 200, l0Bending: 3, l0Weak: 0.6, Fc: 12, Fb: 13 })
      .strengthUtilization,
    (M * 1e6) / (W * 13),
  );
});

test("bearing across the grain: 2-storey reference stud 54.9 kN on a 50x150 plate → 7.3 MPa vs 3.0, u ≈ 2.4", () => {
  const r = bearingPerpendicular({ F: 54.9, b: 150, l: 50 });
  near(r.area, 7500);
  near(r.stress, 7.32);
  near(r.limit, 3);
  near(r.utilization, 2.44);
  // Optional local bearing over part of the length: Rс90(1 + 8/(lсм + 1.2)), lсм = 5 cm.
  const partial = bearingPerpendicular({ F: 54.9, b: 150, l: 50, partialLength: true });
  near(partial.limit, 1.8 * (1 + 8 / (5 + 1.2)));
  assert.ok(partial.limit > 3 && partial.utilization > 1);
});

test("creep: w_fin = w_G(1+kdef) + w_Q(1+ψ2·kdef), kdef 0.6 and ψ2 0.3 by default", () => {
  const r = finalDeflection({ wG: 4, wQ: 6 });
  near(r.instantaneous, 10);
  near(r.final, 4 * 1.6 + 6 * (1 + 0.3 * 0.6));
  near(finalDeflection({ wG: 4, wQ: 6, kdef: 0.8, psi2: 0 }).final, 4 * 1.8 + 6);
});

test("vibration reference: 50x250 @600, L = 5 m → f1 ≈ 7.7 Hz (EN 1995-1-1 7.3.3), below 8 Hz", () => {
  const EI = (10000e6 * ((50 * 250 ** 3) / 12) * 1e-12) / 0.6,
    mass = 72,
    r = floorFrequency({ span: 5, E: 10000, b: 50, h: 250, spacing: 0.6, mass });
  near(r.EI, EI, 1e-6);
  near(r.frequency, (Math.PI / (2 * 25)) * Math.sqrt(EI / mass));
  near(r.frequency, 7.7, 0.05);
  assert.ok(r.frequency < r.limit);
});

test("notched support shear: kv per EN 1995-1-1 6.5.2 and kv = 1 without a notch", () => {
  near(notchedShear({ V: 5, b: 50, h: 200, hef: 200, Fv: 1.5 }).kv, 1);
  const r = notchedShear({ V: 5, b: 50, h: 200, hef: 160, x: 50, Fv: 1.5 }),
    alpha = 0.8,
    kv =
      5 /
      (Math.sqrt(200) *
        (Math.sqrt(alpha * (1 - alpha)) + 0.8 * (50 / 200) * Math.sqrt(1 / alpha - alpha ** 2)));
  near(r.kv, Math.min(1, kv));
  near(r.stress, (1.5 * 5000) / (50 * 160));
  near(r.utilization, r.stress / (r.kv * 1.5));
});

test("material basis: design values are validated; characteristic-looking input and unverified grades warn", () => {
  const base = resolveTimberMaterial({});
  assert.deepEqual(
    [base.values.Fb, base.values.Fc, base.values.Ft, base.values.Fv, base.values.Fc90],
    [13, 12, 8, 1.5, 3],
  );
  assert.equal(base.check.status, "pass");
  assert.equal(resolveTimberMaterial({ grade: "2" }).check.status, "pass");
  assert.equal(resolveTimberMaterial({ grade: "3" }).check.status, "warning");
  assert.equal(resolveTimberMaterial({ grade: "5" }).check.status, "fail");
  const c24 = resolveTimberMaterial({ Fb: 24, Fc: 21, Ft: 14.5 });
  assert.equal(c24.check.status, "warning");
  assert.match(c24.check.note, /характеристические/);
  assert.equal(resolveTimberMaterial({ Fc90: -1 }).check.status, "fail");
});

test("truss compression bars use φ with λmax; chords are restrained out of plane by battens", () => {
  const t = buildTruss();
  for (const b of t.bars.filter((b) => b.force < 0)) {
    const outOfPlane = b.role === "web" ? b.length : Math.min(b.length, 0.6),
      lambda = Math.max(
        (b.length * 1000) / (b.h / Math.sqrt(12)),
        (outOfPlane * 1000) / (b.b / Math.sqrt(12)),
      );
    near(b.lambda, lambda, 1e-9);
    assert.ok(t.checks.some((c) => c.id === `${b.id}-slenderness`));
  }
  // A slender web fails its λmax even when the axial utilization is modest.
  const slim = buildTruss({ webB: 25, webH: 50 });
  assert.ok(slim.checks.some((c) => c.id.endsWith("-slenderness") && c.status === "fail"));
});

test("default house: joists get creep, vibration and bearing checks; studs and heels get bearing checks", () => {
  const p = { ...JSON.parse(JSON.stringify(defaultDesignerProject)), openings: [] },
    m = checkDesignerMembers(p, calculateDesigner(p)),
    ids = new Set(m.checks.map((c) => c.id));
  for (const id of [
    "designerJoistFinalDeflection",
    "designerFloorVibration",
    "designerJoistBearing",
    "designerStudPlateBearing",
    "designerStudSlenderness",
    "material-design-basis",
  ])
    assert.ok(ids.has(id), id);
  const vib = m.checks.find((c) => c.id === "designerFloorVibration");
  assert.ok(["pass", "warning"].includes(vib.status));
  const fin = m.checks.find((c) => c.id === "designerJoistFinalDeflection");
  assert.ok(fin.value > fin.instantaneous);
  const plate = m.checks.find((c) => c.id === "designerStudPlateBearing");
  near(plate.value, (m.stud.force * 1000) / (m.stud.b * m.stud.h), 1e-9);
});

test("generated one-storey 10x8 house does not fail stud compression spuriously (sheathing restraint)", () => {
  const { project, planning } = generateHouse({ width: 10, depth: 8 }),
    r = evaluateHouse(project, planning),
    stud = r.result.checks.find((c) => c.id === "designerStudCompression");
  assert.notEqual(stud.status, "fail");
  assert.equal(stud.weakAxisRestraint, "sheathing");
  assert.ok(stud.utilization < 0.5);
  assert.ok(r.result.checks.some((c) => c.id === "designerGrillagePileBearing"));
  assert.ok(r.result.checks.some((c) => c.id === "designerRoofHeelBearing"));
  // A5: chord bending is checked for a gable truss without eaves.
  assert.ok(r.result.checks.some((c) => /physical-TOP-low$/.test(c.id) && c.status !== "unverified"));
});

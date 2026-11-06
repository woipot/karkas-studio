import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSourceRoof } from "./source-roof-mechanics.js";
import { memberInsight } from "./member-insight.js";

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
const board = (id, role, start, end, b, h, crossAxis, extra = {}) => ({
  id,
  role,
  name: role,
  b,
  h,
  start,
  end,
  crossAxis,
  mass: 0,
  ...extra,
});

test("flat rafter on two plates: reactions qL/2 and M = q·l²/8 − q·a²/2 (hand calculation)", () => {
  // Rafter 50×200 along z, 4 m, axis at y = 3; plates 150 wide × 50 deep at z = 0.1 and 3.9.
  const rafter = board("R1", "rafter", [0, 3, 0], [0, 3, 4], 50, 200, [1, 0, 0], {
    category: "roof",
    zoneId: "Z",
  });
  const plate = (id, z) => board(id, "plate", [-1, 2.875, z], [1, 2.875, z], 150, 50, [0, 0, 1]);
  const p = { loads: { roofDead: 0.5, snow: 1.5 }, roof: { spacing: 0.6 }, material: { E: 10000 } };
  const r = {
    roofModel: { sourceImported: true },
    timber: { instances: [rafter, plate("P1", 0.1), plate("P2", 3.9)] },
  };
  const a = analyzeSourceRoof(p, r),
    m = a.members.R1;
  // SP 20 profile: layers γ 1.2, snow γ 1.4, µ(0°) = 1 → q = 0.5·0.6·1.2 + 1.5·0.6·1.4 = 1.62 kN/m
  near(m.lineLoadDesign, 1.62, 1e-9);
  assert.deepEqual(m.supports.sort(), ["P1", "P2"]);
  for (const q of m.reactions) near(q.design, (1.62 * 4) / 2, 1e-6);
  near(m.maxMoment, (1.62 * 3.8 ** 2) / 8 - (1.62 * 0.1 ** 2) / 2, 1e-3);
  near(a.deliveredDesign, 1.62 * 4, 1e-6);
  near(a.balanceError, 0, 1e-9);
});

test("stud between plates carries the top plate reaction and is checked with φ and λ", () => {
  const rafter = board("R1", "rafter", [0, 3, 0], [0, 3, 4], 50, 200, [1, 0, 0], {
    category: "roof",
    zoneId: "Z",
  });
  // Plate 1 (main) at z = 0.1; plate 2 is a roof plate at z = 3.9 standing on a 1.2 m roof stud,
  // which rests on a main beam.
  const mainPlate = board("P1", "plate", [-1, 2.875, 0.1], [1, 2.875, 0.1], 150, 50, [0, 0, 1]);
  const roofPlate = board(
    "TP",
    "roofSupportPlate",
    [-0.3, 2.875, 3.9],
    [0.3, 2.875, 3.9],
    150,
    50,
    [0, 0, 1],
    {
      category: "roof",
      zoneId: "Z",
    },
  );
  const stud = board("S1", "roofSupportStud", [0, 1.65, 3.9], [0, 2.85, 3.9], 50, 150, [1, 0, 0], {
    category: "roof",
    zoneId: "Z",
  });
  const beam = board("B1", "beam", [-1, 1.55, 3.9], [1, 1.55, 3.9], 150, 200, [0, 0, 1]);
  const p = { loads: { roofDead: 0.5, snow: 1.5 }, roof: { spacing: 0.6 }, material: { E: 10000 } };
  const r = {
    roofModel: { sourceImported: true },
    timber: { instances: [rafter, mainPlate, roofPlate, stud, beam] },
  };
  const a = analyzeSourceRoof(p, r),
    s = a.members.S1;
  assert.equal(s.kind, "axial");
  near(s.N, (1.62 * 4) / 2, 1e-3);
  // λ = 1200 / (50/√12) = 83.1 → φ = 3000/λ² (СП 64, λ > 70)
  near(s.lambda, 1200 / (50 / Math.sqrt(12)), 1e-6);
  near(s.phi, 3000 / s.lambda ** 2, 1e-9);
  assert.equal(s.status, "pass");
  near(a.balanceError, 0, 1e-9);
});

test("Orion: knee-wall studs and built-up interior post get real forces; load path balances", () => {
  const report = JSON.parse(
    readFileSync(new URL("../public/projects/orion/engine-report.json", import.meta.url)),
  );
  const a = analyzeSourceRoof(report.project, report.result);
  near(a.balanceError, 0, 1e-6);
  const studs = Object.values(a.members).filter((m) => m.role === "roofSupportStud");
  assert.equal(studs.length, 44);
  assert.ok(studs.filter((m) => m.N > 1).length >= 30, "knee-wall studs carry rafter reactions");
  const post = Object.values(a.members).find((m) => m.role === "interiorPost" && m.packIds);
  assert.equal(post.packIds.length, 3, "three plies act as one post");
  assert.ok(post.N > 10);
  const insight = memberInsight(report, studs[0].id);
  assert.equal(insight.analysis.source, "sourceRoof");
});

test("Orion: wall studs take actual roof reactions; the representative stud is superseded", () => {
  const report = JSON.parse(
    readFileSync(new URL("../public/projects/orion/engine-report.json", import.meta.url)),
  );
  const r = report.result,
    ws = r.sourceRoofMechanics.wallStuds.studs;
  assert.ok(ws.length > 100);
  // The equivalent line load put ~35 kN on every stud; real reactions are a fraction of it.
  const max = Math.max(...ws.map((q) => q.N));
  assert.ok(max < 20, `max stud force ${max}`);
  const delivered = r.sourceRoofMechanics.delivered
    .filter((d) => d.wallId && d.point)
    .reduce((t, d) => t + d.design, 0);
  const assigned = ws.reduce((t, q) => t + q.roofDesign, 0);
  near(assigned, delivered, 1e-6);
  const rep = r.checks.find((c) => c.id === "designerStudCompression");
  assert.equal(rep.supersededBy, "source-roof-wall-studs");
  assert.notEqual(rep.status, "fail");
  const stud = memberInsight(report, ws[0].id);
  assert.equal(stud.analysis.source, "wallStud");
});

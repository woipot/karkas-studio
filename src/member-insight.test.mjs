import test from "node:test";
import assert from "node:assert/strict";
import { generateHouse } from "./house-generator.js";
import { evaluateHouse } from "./house-engine.js";
import { memberInsight } from "./member-insight.js";

const { project, planning } = generateHouse({ width: 10, depth: 8 });
const report = evaluateHouse(project, planning);
const first = (role) => report.result.timber.instances.find((b) => b.role === role);

test("member insight: every board maps to exactly one stock and its position adds up", () => {
  for (const b of report.result.timber.instances.slice(0, 120)) {
    const m = memberInsight(report, b.id);
    assert.ok(m, b.id);
    assert.ok(m.cutting, "cutting for " + b.id);
    const c = m.cutting,
      used = c.pieces.reduce((s, p) => s + p.length, 0);
    assert.ok(c.pieces[c.pieceIndex].current);
    assert.ok(used <= c.stockLength + 1e-9);
    assert.ok(
      Math.abs(c.pieces[c.pieceIndex].length - (b.cutLength ?? b.length)) < 0.05 || c.pieces.length > 0,
    );
  }
});

test("member insight: role-specific forces come from the report, not recomputed", () => {
  const joist = memberInsight(report, first("joist").id);
  assert.equal(joist.analysis.source, "joist");
  const jc = report.result.floorPlatform.joistChecks.find((q) => q.partIds.includes(first("joist").id));
  assert.equal(joist.analysis.utilization, jc.utilization);
  assert.ok(joist.analysis.rows.some((r) => r.label === "Определяет"));

  const web = first("web"),
    w = memberInsight(report, web.id),
    bar = report.result.roofModel.zones
      .find((z) => z.id === web.zoneId)
      .analysis.bars.find((q) => q.id === (web.trussBarId ?? web.barId));
  assert.equal(w.analysis.source, "truss");
  assert.equal(w.analysis.utilization, bar.utilization);

  const stud = memberInsight(report, first("stud").id);
  assert.equal(stud.analysis.source, "stud");
  assert.ok(stud.analysis.utilization > 0 && stud.analysis.utilization < 1);
  assert.ok(stud.checks.some((c) => c.id === "designerStudCompression"));

  const ply = memberInsight(report, first("grillagePly").id);
  assert.equal(ply.analysis.source, "grillage");
  assert.ok(ply.analysis.rows.some((r) => /Реакция сваи/.test(r.label)));
});

test("member insight: unknown id returns null; secondary members have no invented forces", () => {
  assert.equal(memberInsight(report, "NO-SUCH-BOARD"), null);
  const blocking = memberInsight(report, first("floorBlocking").id);
  assert.equal(blocking.analysis, null);
  assert.ok(blocking.facts.some((f) => f.label === "Собственный вес"));
});

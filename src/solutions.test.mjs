import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHouseEngine, evaluateHouse, applyProjectPatch } from "./house-engine.js";
import { generateHouse } from "./house-generator.js";
import { proposeFixes, optimize, planningAfterPatch } from "./solutions.js";
import { evaluationMetrics, compareMetrics, checkExcess, checkSeverity } from "./check-metrics.js";

const root = fileURLToPath(new URL("../", import.meta.url));
// Assertions are properties (fails decrease, fixes verified, determinism), not
// exact numbers: load and resistance formulas are allowed to evolve.
const undersizedFloor = {
  name: "Тест: лаги 50×150 над пролётом 5 м",
  width: 8,
  depth: 5,
  levels: [{ height: 2.8 }, { height: 2.7 }],
  floor: { section: "50x150" },
};
const undersizedRafters = {
  name: "Тест: стропила 50×150 над 6 м",
  width: 8,
  depth: 6,
  roof: { shape: "mono", pitch: 15, framing: "rafters" },
  sections: { roof: "50x150" },
};
const failedIds = (report) => report.result.checks.filter((c) => c.status === "fail").map((c) => c.id);

test("check metrics: excess is lexicographic-friendly and bounded for count checks", () => {
  assert.equal(checkExcess({ status: "pass", utilization: 0.5 }), 0);
  assert.ok(Math.abs(checkExcess({ status: "fail", utilization: 6 }) - 5) < 1e-12);
  assert.ok(
    checkExcess({ status: "fail", utilization: 1.05 }) < checkExcess({ status: "fail", utilization: 6 }),
  );
  const many = checkExcess({ status: "fail", value: 20, limit: 0 }),
    few = checkExcess({ status: "fail", value: 2, limit: 0 });
  assert.ok(few < many && many < 1);
  assert.equal(checkExcess({ status: "fail" }), 0.5);
  assert.ok(
    checkSeverity({ status: "fail", utilization: 1.2 }) >
      checkSeverity({ status: "warning", utilization: 0.95 }),
  );
  const a = { failedChecks: 1, excessUtilization: 0.05, unplaced: 0, estimateTotal: 9e9 },
    b = { failedChecks: 1, excessUtilization: 5, unplaced: 0, estimateTotal: 1 };
  assert.ok(compareMetrics(a, b) < 0, "u 1.05 must beat u 6.0 regardless of cost");
  assert.ok(compareMetrics({ ...b, failedChecks: 0 }, a) < 0, "fewer failed checks first");
});

test("planning metadata goes stale only for geometry edits", () => {
  const planning = { checks: [{ id: "x" }], warnings: [] };
  assert.equal(
    planningAfterPatch(planning, [{ op: "replace", path: "/floor/section", value: "50x200" }]),
    planning,
  );
  const stale = planningAfterPatch(planning, [{ op: "replace", path: "/walls/0/section", value: "50x200" }]);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.checks, []);
});

test("proposeFixes returns verified patches for an undersized floor", { timeout: 120000 }, () => {
  const { project, planning } = generateHouse(undersizedFloor);
  const report = evaluateHouse(project, planning),
    before = failedIds(report);
  const joist = report.result.checks.find((c) => /^designerJoist/.test(c.id) && c.status === "fail");
  assert.ok(joist, "50×150 joists over a 5 m upper-floor span must fail a joist check: " + before.join(","));
  const out = proposeFixes(report.project, report, { planning, maxEvaluations: 14 });
  assert.ok(out.evaluations <= 14);
  assert.ok(out.targets.some((t) => t.checkId === joist.id && t.group === "floor"));
  assert.ok(out.fixes.length > 0, JSON.stringify(out.rejected));
  assert.ok(Array.isArray(out.byCheck[joist.id]) && out.byCheck[joist.id].length > 0);
  for (const f of out.fixes) {
    assert.equal(f.verified, true);
    assert.ok(typeof f.title === "string" && /[а-яё]/i.test(f.title), "Russian title");
    assert.ok(Array.isArray(f.patch) && f.patch.length > 0);
    assert.ok(f.after.severity < f.before.severity, `${f.title} must reduce target severity`);
    assert.ok(Number.isFinite(f.costDelta));
    assert.ok(Array.isArray(f.newFailedChecks) && Array.isArray(f.sideEffects));
  }
  // Sorted: target fixed first, then without new failures.
  const rank = (f) => (f.fixesTarget ? 0 : 2) + (f.newFailedChecks.length ? 1 : 0);
  for (let i = 1; i < out.fixes.length; i++) assert.ok(rank(out.fixes[i - 1]) <= rank(out.fixes[i]));
  const floorFix = out.fixes.find((f) => f.improvedCheckIds.includes(joist.id) && f.fixesTarget);
  assert.ok(
    floorFix,
    "at least one floor patch must clear the joist check: " + JSON.stringify(out.fixes.map((f) => f.title)),
  );
  // Independent re-verification of the reported after-state.
  const patched = applyProjectPatch(report.project, floorFix.patch),
    again = evaluateHouse(patched, planningAfterPatch(planning, floorFix.patch)),
    target = again.result.checks.find((c) => c.id === floorFix.targetCheckId);
  assert.notEqual(target?.status, "fail");
  assert.deepEqual(evaluationMetrics(again).failedChecks, floorFix.metrics.failedChecks);
  assert.deepEqual(
    failedIds(again).filter((id) => !before.includes(id)),
    floorFix.newFailedChecks,
  );
});

test("proposeFixes respects keep paths and an evaluation budget", { timeout: 60000 }, () => {
  const { project, planning } = generateHouse(undersizedRafters);
  const report = evaluateHouse(project, planning);
  const out = proposeFixes(report.project, report, {
    planning,
    maxEvaluations: 2,
    keep: ["/roof/framing"],
  });
  assert.ok(out.evaluations <= 2);
  for (const f of out.fixes) assert.ok(f.patch.every((o) => !o.path.startsWith("/roof/framing")));
});

test(
  "optimize removes all failed checks deterministically and returns a replayable patch",
  { timeout: 240000 },
  () => {
    for (const spec of [undersizedRafters, undersizedFloor]) {
      const { project, planning } = generateHouse(spec);
      const report = evaluateHouse(project, planning),
        baseline = evaluationMetrics(report);
      assert.ok(baseline.failedChecks > 0, spec.name);
      const res = optimize(report.project, { planning, evaluation: report, maxEvaluations: 30 });
      assert.ok(res.evaluations <= 30);
      assert.equal(res.verified, true);
      assert.ok(res.final.failedChecks < baseline.failedChecks, spec.name + ": failed checks must decrease");
      assert.equal(res.final.failedChecks, 0, spec.name + ": " + JSON.stringify(res.remainingFailed));
      assert.equal(res.status, "solved");
      assert.ok(res.trace.length > 0 && res.patch.length > 0);
      // Every step improves the safety objective or, in the cost phase, keeps it and lowers cost.
      for (const s of res.trace) {
        if (s.phase === "repair") assert.ok(compareMetrics(s.after, s.before) < 0, s.title);
        else {
          assert.ok(s.after.failedChecks <= s.before.failedChecks);
          assert.ok(s.after.estimateTotal < s.before.estimateTotal);
        }
      }
      // The combined patch replays to the reported final state.
      const p = applyProjectPatch(report.project, res.patch),
        replay = evaluationMetrics(evaluateHouse(p, planningAfterPatch(planning, res.patch)));
      assert.equal(replay.failedChecks, res.final.failedChecks);
      assert.ok(Math.abs(replay.estimateTotal - res.final.estimateTotal) < 0.01);
      if (spec === undersizedRafters) {
        const twice = optimize(report.project, { planning, evaluation: report, maxEvaluations: 30 });
        assert.deepEqual(twice.patch, res.patch, "deterministic");
        assert.deepEqual(
          twice.trace.map((s) => s.title),
          res.trace.map((s) => s.title),
        );
        // keep: the optimizer may not touch a protected path.
        const kept = optimize(report.project, {
          planning,
          evaluation: report,
          maxEvaluations: 12,
          keep: ["/roof/framing", "/foundation"],
        });
        assert.ok(
          kept.patch.every((o) => !o.path.startsWith("/roof/framing") && !o.path.startsWith("/foundation")),
        );
      }
    }
  },
);

test(
  "compare_variants ranks by excess utilization before cost when failed counts tie",
  { timeout: 120000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-solutions-compare-"));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const engine = createHouseEngine({ dataDir }),
      created = await engine.generate(undersizedFloor);
    const out = await engine.variants(created.project_id, 1, [
      // Cheap, barely helps.
      { name: "spacing", operations: [{ op: "replace", path: "/floor/spacing", value: 0.55 }] },
      // Costlier, cuts the overload a lot but leaves the same failed count.
      { name: "deeper", operations: [{ op: "replace", path: "/floor/section", value: "50x200" }] },
    ]);
    assert.deepEqual(out.rankingCriteria, ["failedChecks", "excessUtilization", "unplaced", "estimateTotal"]);
    for (const v of out.variants) {
      assert.ok(Number.isFinite(v.maxUtilization));
      assert.ok(Number.isFinite(v.excessUtilization));
      assert.ok(Number.isFinite(v.score), "legacy score field retained");
    }
    const [first, second] = out.ranking.map((i) => out.variants[i]);
    assert.ok(compareMetrics(first.metrics, second.metrics) <= 0);
    if (first.summary.failedChecks === second.summary.failedChecks)
      assert.ok(first.excessUtilization <= second.excessUtilization);
    const deeper = out.variants[1],
      spacing = out.variants[0];
    if (
      deeper.summary.failedChecks === spacing.summary.failedChecks &&
      deeper.excessUtilization < spacing.excessUtilization
    )
      assert.equal(out.selectedIndex, 1, "lower excess wins although it costs more");
    assert.ok(out.baselineMetrics.excessUtilization >= 0);
  },
);

test(
  "MCP stdio: propose_fixes, analyze fixes preview and optimize with apply",
  { timeout: 180000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-solutions-mcp-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "mcp/server.mjs")],
      cwd: root,
      env: { ...process.env, KARKAS_DATA_DIR: dataDir },
      stderr: "pipe",
    });
    const client = new Client({ name: "karkas-solutions-qa", version: "1.0.0" }, { capabilities: {} });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    t.after(async () => {
      try {
        await client.close();
      } finally {
        await transport.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((x) => x.name);
    for (const name of ["karkas_propose_fixes", "karkas_optimize", "karkas_analyze"])
      assert.ok(names.includes(name), name);
    async function call(name, args = {}, errorCode) {
      const response = await client.callTool({ name: "karkas_" + name, arguments: args }, undefined, {
        timeout: 170000,
      });
      const data = response.structuredContent;
      assert.ok(data && typeof data === "object", `${name}: ${stderr}`);
      if (errorCode) {
        assert.equal(response.isError, true);
        assert.equal(data.error?.code, errorCode);
        return data;
      }
      assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(data.error)}; ${stderr}`);
      return data;
    }
    const catalog = await call("catalog");
    assert.ok(catalog.additionalTools.includes("karkas_propose_fixes"));
    assert.ok(catalog.solutions?.optimize);
    const { project_id, revision } = await call("generate", undersizedRafters);
    assert.equal(revision, 1);
    const plain = await call("analyze", { project_id });
    assert.ok(plain.failed.length > 0);
    assert.equal(plain.fixes, undefined, "preview is opt-in");
    const preview = await call("analyze", { project_id, fixes: true, fix_evaluations: 3 });
    assert.ok(preview.fixes.evaluations <= 3);
    assert.ok(Object.values(preview.fixes.byCheck).some((list) => list.length > 0));
    for (const list of Object.values(preview.fixes.byCheck)) assert.ok(list.length <= 3);
    const fixes = await call("propose_fixes", { project_id, options: { maxEvaluations: 6 } });
    assert.equal(fixes.revision, 1);
    assert.ok(fixes.fixes.length > 0 && fixes.fixes.every((f) => f.verified));
    // Proposals never write a revision.
    assert.equal((await call("get_project", { project_id })).revision, 1);
    // Applying the top proposal through the existing patch mechanism works.
    const top = fixes.fixes[0];
    await call("optimize", { project_id, expected_revision: 2, apply: true }, "REVISION_CONFLICT");
    const optimized = await call("optimize", {
      project_id,
      expected_revision: 1,
      goals: { keep: ["/name"] },
      apply: true,
      max_evaluations: 20,
    });
    assert.equal(optimized.verified, true);
    assert.ok(optimized.final.failedChecks < optimized.baseline.failedChecks);
    assert.equal(optimized.applied.revision, 2);
    const current = await call("get_project", { project_id });
    assert.equal(current.revision, 2);
    const analyzed = await call("analyze", { project_id, revision: 2 });
    assert.equal(analyzed.summary.failedChecks, optimized.final.failedChecks);
    const stale = await call(
      "apply_patch",
      { project_id, expected_revision: 1, operations: top.patch },
      "REVISION_CONFLICT",
    );
    assert.equal(stale.error.retryable, true);
  },
);

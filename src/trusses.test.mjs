import test from "node:test";
import assert from "node:assert/strict";
import { buildTruss, solvePlanarTruss, trussTypes } from "./trusses.js";
const near = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const sum = (a) => a.reduce((s, x) => s + x, 0);

test("hand-calculated 4×2m triangular truss: reactions, forces, displacement", () => {
  const nodes = [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 4, y: 0 },
    { id: "C", x: 2, y: 2 },
  ];
  const bars = [
    { nodeA: "A", nodeB: "C" },
    { nodeA: "C", nodeB: "B" },
    { nodeA: "A", nodeB: "B" },
  ].map((b) => ({ ...b, b: 50, h: 100, E: 10000 }));
  const r = solvePlanarTruss(
    nodes,
    bars,
    [{ node: "C", fy: -10 }],
    [
      { node: "A", x: true, y: true },
      { node: "B", y: true },
    ],
  );
  near(r.reactions[0].y, 5);
  near(r.reactions[1].y, 5);
  near(r.reactions[0].x, 0);
  near(r.forces[0], -5 * Math.SQRT2);
  near(r.forces[1], -5 * Math.SQRT2);
  near(r.forces[2], 5);
  near(r.u[2] * 1000, 0.4);
  near(r.u[4] * 1000, 0.2);
  near(r.u[5] * 1000, -(0.2 + 0.4 * Math.SQRT2));
});
test("untriangulated rectangular mechanism is rejected, not stabilized artificially", () => {
  const nodes = [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 4, y: 0 },
    { id: "C", x: 4, y: 2 },
    { id: "D", x: 0, y: 2 },
  ];
  const bars = [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
    ["D", "A"],
  ].map(([nodeA, nodeB]) => ({ nodeA, nodeB, b: 50, h: 100, E: 10000 }));
  assert.throws(
    () =>
      solvePlanarTruss(
        nodes,
        bars,
        [{ node: "C", fy: -10 }],
        [
          { node: "A", x: true, y: true },
          { node: "B", y: true },
        ],
      ),
    /Сингулярная/,
  );
});
test("all four topologies are triangulated, stable and geometrically distinct", () => {
  const trusses = trussTypes.map((t) => buildTruss({ type: t.id }));
  for (const t of trusses) {
    assert.equal(t.stable, true);
    assert.equal(t.errors.length, 0);
    near(t.analysis.staticDeterminacy, 0);
    assert.ok(t.bars.some((b) => b.role === "top"));
    assert.ok(t.bars.some((b) => b.role === "bottom"));
    assert.ok(t.bars.some((b) => b.role === "web"));
  }
  assert.equal(new Set(trusses.map((t) => t.totals.volume.toFixed(6))).size, 4);
  assert.equal(new Set(trusses.map((t) => JSON.stringify(t.nodes))).size, 4);
  assert.deepEqual(
    trusses.map((t) => t.bars.length),
    [9, 13, 11, 11],
  );
});
test("node loads include roof actual area, snow projection, and every bar mass exactly once", () => {
  for (const { id } of trussTypes) {
    const t = buildTruss({ type: id });
    near(t.loads.roofDead, 0.5 * t.loads.roofArea);
    near(t.loads.snow, 1.5 * 0.8 * 8 * 0.6);
    near(t.loads.timber, (t.totals.mass * 9.80665) / 1000);
    near(t.loads.totalCharacteristic, t.loads.roofDead + t.loads.snow + t.loads.timber);
    near(t.loads.totalDesign, (t.loads.roofDead + t.loads.timber) * 1.1 + t.loads.snow * 1.4);
    near(t.totals.volume, sum(t.bars.map((b) => ((b.b * b.h) / 1e6) * b.length)));
    near(t.totals.mass, t.totals.volume * 500);
  }
});
test("global forces/moments and free-joint equilibrium balance for each topology", () => {
  for (const { id } of trussTypes) {
    const t = buildTruss({ type: id });
    near(sum(t.reactions.map((r) => r.y)), t.loads.totalDesign);
    near(t.analysis.balanceX, 0);
    near(t.analysis.balanceMoment, 0);
    assert.ok(t.analysis.residual < 1e-8);
    const residual = new Map(t.nodes.map((n) => [n.id, { x: 0, y: 0 }]));
    const map = new Map(t.nodes.map((n) => [n.id, n]));
    for (const bar of t.bars) {
      const a = map.get(bar.nodeA),
        b = map.get(bar.nodeB),
        cx = (b.x - a.x) / bar.length,
        cy = (b.y - a.y) / bar.length;
      residual.get(bar.nodeA).x += bar.force * cx;
      residual.get(bar.nodeA).y += bar.force * cy;
      residual.get(bar.nodeB).x -= bar.force * cx;
      residual.get(bar.nodeB).y -= bar.force * cy;
    }
    for (const load of t.loads.nodal) residual.get(load.node).y += load.fyDesign;
    for (const r of t.reactions) {
      residual.get(r.node).x += r.x;
      residual.get(r.node).y += r.y;
    }
    for (const r of residual.values()) {
      near(r.x, 0);
      near(r.y, 0);
    }
  }
});
test("symmetric pitched trusses have symmetric reactions and vertical deformation", () => {
  for (const type of ["king", "queen", "fink"]) {
    const t = buildTruss({ type }),
      disp = new Map(t.displacements.map((d) => [d.node, d]));
    near(t.reactions[0].y, t.reactions[1].y);
    for (const a of t.nodes) {
      const b = t.nodes.find((n) => Math.abs(n.x - (8 - a.x)) < 1e-8 && Math.abs(n.y - a.y) < 1e-8);
      assert.ok(b);
      near(disp.get(a.id).y, disp.get(b.id).y);
    }
  }
});
test("linear scaling: doubled loads double forces and movements", () => {
  const a = buildTruss(),
    b = buildTruss({ roofDead: 1, snow: 3, timberDensity: 1000 });
  for (let i = 0; i < a.bars.length; i++) near(b.bars[i].force, a.bars[i].force * 2);
  for (let i = 0; i < a.nodes.length; i++) {
    near(b.displacements[i].x, a.displacements[i].x * 2);
    near(b.displacements[i].y, a.displacements[i].y * 2);
  }
});
test("doubling E halves movement and doubles ideal Euler limit, not determinate forces", () => {
  const a = buildTruss(),
    b = buildTruss({ E: 20000 });
  for (let i = 0; i < a.bars.length; i++) {
    near(b.bars[i].force, a.bars[i].force);
    near(b.bars[i].euler, a.bars[i].euler * 2);
  }
  for (let i = 0; i < a.nodes.length; i++) near(b.displacements[i].y, a.displacements[i].y / 2);
});
test("member stress and Euler use declared sections and full unbraced length", () => {
  const t = buildTruss();
  for (const b of t.bars) {
    near(b.stress, (b.force * 1000) / (b.b * b.h));
    near(
      b.euler,
      (Math.PI ** 2 * 10000 * Math.max(b.b, b.h) * Math.min(b.b, b.h) ** 3) /
        12 /
        (b.length * 1000) ** 2 /
        1000,
    );
    assert.ok(b.compressionCapacity <= (12 * b.b * b.h) / 1000 + 1e-8);
    assert.ok(b.compressionCapacity <= b.euler + 1e-8);
  }
  assert.equal(t.status, "warning");
  assert.ok(t.checks.some((c) => c.id === "connections" && c.status === "unverified"));
});
test("weak or highly loaded members fail transparently while retaining finite analysis", () => {
  const t = buildTruss({ chordB: 25, chordH: 50, webB: 25, webH: 50, snow: 8, spacing: 1.2 });
  assert.equal(t.stable, true);
  assert.equal(t.status, "fail");
  assert.ok(t.bars.some((b) => b.utilization > 1));
  assert.ok(t.bars.every((b) => Number.isFinite(b.force)));
  assert.ok(t.errors.length === 0);
});
test("invalid types, nonfinite values, zero rise and malformed bar input are errors", () => {
  for (const p of [
    { type: "unknown" },
    { span: "8" },
    { rise: 0 },
    { E: NaN },
    { chordB: 0 },
    { timberDensity: -1 },
  ]) {
    const t = buildTruss(p);
    assert.equal(t.status, "fail");
    assert.equal(t.stable, false);
    assert.ok(t.errors.length > 0);
  }
  assert.throws(
    () =>
      solvePlanarTruss(
        [
          { id: "A", x: 0, y: 0 },
          { id: "B", x: 0, y: 0 },
        ],
        [{ nodeA: "A", nodeB: "B", b: 50, h: 100, E: 10000 }],
        [],
        [],
      ),
    /Нулевая длина/,
  );
});

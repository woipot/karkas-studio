import test from "node:test";
import assert from "node:assert/strict";
import { annexDefaults, validateAnnexes, buildAnnexes } from "./annexes.js";
import { calculateDesigner, defaultDesignerProject, validateDesignerProject } from "./designer-engine.js";
import { calculateCutting } from "./cutting.js";
import { checkDesignerMembers } from "./designer-mechanics.js";
import { memberLoadProject } from "./load-profile.js";
import { cutGeometry } from "./board-geometry.js";
const sum = (a) => a.reduce((s, x) => s + x, 0),
  G = 9.80665,
  near = (a, b, t = 1e-6) =>
    assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} != ${b}`);
function fixture(kind = "coveredTerrace") {
  const p = structuredClone(defaultDesignerProject);
  p.roof.type = "none";
  p.bracing.method = "none";
  p.openings = [{ id: "door", wallId: "w-north", offset: 2, width: 1, height: 2.1, sill: 0, type: "door" }];
  p.annexes = [{ id: "A", kind, attachedWallId: "w-north", offset: 1, width: 4, depth: 2.5 }];
  return p;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot = (a, b) => sum(a.map((x, i) => x * b[i])),
  norm = (a) => Math.hypot(...a),
  sub = (a, b) => a.map((x, i) => x - b[i]),
  unit = (a) => a.map((x) => x / norm(a));
function shape(b) {
  const g = cutGeometry(b),
    p = g.attributes.position,
    y = unit(sub(b.end, b.start));
  let x = unit(b.crossAxis);
  x = unit(
    sub(
      x,
      y.map((v) => v * dot(x, y)),
    ),
  );
  const z = cross(x, y),
    center = b.start.map((v, i) => (v + b.end[i]) / 2),
    vertices = [];
  for (let i = 0; i < p.count; i++)
    vertices.push(center.map((v, j) => v + x[j] * p.getX(i) + y[j] * p.getY(i) + z[j] * p.getZ(i)));
  g.dispose();
  const directions = [],
    normals = [];
  const unique = (list, v) => {
    if (norm(v) < 1e-8) return;
    v = unit(v);
    if (!list.some((q) => Math.abs(dot(q, v)) > 1 - 1e-7)) list.push(v);
  };
  for (let i = 0; i < vertices.length; i += 3) {
    const a = vertices[i],
      b = vertices[i + 1],
      c = vertices[i + 2],
      ab = sub(b, a),
      ac = sub(c, a);
    unique(normals, cross(ab, ac));
    unique(directions, ab);
    unique(directions, ac);
    unique(directions, sub(c, b));
  }
  return { vertices, directions, normals };
}
function intersects(A, B, tol = 2e-6) {
  const axes = [
    ...A.normals,
    ...B.normals,
    ...A.directions.flatMap((a) => B.directions.map((b) => cross(a, b))),
  ];
  for (let axis of axes) {
    if (norm(axis) < 1e-8) continue;
    axis = unit(axis);
    const a = A.vertices.map((v) => dot(v, axis)),
      b = B.vertices.map((v) => dot(v, axis));
    if (Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b)) < tol)
      return false;
  }
  return true;
}

test("defaults expose all three kinds and strict nested data validation rejects corrupt imports", () => {
  const p = fixture(),
    d = annexDefaults(p);
  near(d.loads.live, 2.5);
  assert.equal(validateAnnexes(p).valid, true);
  for (const alter of [
    (q) => (q.annexes = null),
    (q) => (q.annexes = [null]),
    (q) => (q.annexes[0].kind = "heatedRoom"),
    (q) => (q.annexes[0].width = NaN),
    (q) => (q.annexes[0].foundation = { spacing: Infinity }),
    (q) => (q.annexes[0].floor = { weird: 1 }),
    (q) => (q.annexes[0].roof = { overhangs: { high: 0.5 } }),
    (q) => (q.annexes[0].attachedWallId = "absent"),
    (q) => q.annexes.push({ ...q.annexes[0] }),
  ]) {
    const q = structuredClone(p);
    alter(q);
    assert.equal(validateDesignerProject(q).valid, false);
    assert.throws(() => calculateDesigner(q), { name: "DesignerValidationError" });
  }
  assert.equal(
    validateAnnexes({
      ...p,
      annexes: Array.from({ length: 11 }, (_, i) => ({ ...p.annexes[0], id: "A" + i })),
    }).valid,
    false,
  );
});

for (const kind of ["openTerrace", "coveredTerrace", "glazedVeranda"])
  test(kind + " has real independent timber/piles and exact loads/stock accounting", () => {
    const p = fixture(kind),
      r = calculateDesigner(p),
      a = r.annexes.items[0],
      pieces = r.timber.instances.filter((b) => b.annexId === "A"),
      cut = calculateCutting(p, r);
    assert.ok(pieces.length > 25);
    assert.ok(a.foundation.piles.length >= 4);
    assert.equal(r.checks.filter((c) => c.status === "fail").length, 0);
    near(
      a.loads.totalDesign,
      a.foundation.piles.reduce((s, p) => s + p.reaction, 0),
    );
    near(
      r.loads.totalDesign,
      r.piles.reduce((s, p) => s + p.reaction, 0),
    );
    near(
      r.loads.totalDesign,
      r.loads.rows.reduce((s, q) => s + q.design, 0),
    );
    near(sum(pieces.map((b) => b.mass)), a.quantities.woodMass);
    near(sum(r.timber.instances.map((b) => b.mass)), r.timber.mass);
    for (const b of pieces) {
      near(b.length, norm(sub(b.end, b.start)));
      assert.ok(b.cutLength <= 6 + 1e-7);
      assert.ok(b.requireSingleStock);
    }
    const ids = cut.stocks.flatMap((s) => s.pieces.map((p) => p.sourceId));
    for (const b of pieces) assert.equal(ids.filter((id) => id === b.id).length, 1, b.id);
    assert.ok(a.checks.some((c) => c.status === "unverified"));
    assert.equal(a.certified, false);
  });

test("attaching any variant leaves house axes, platform areas, roof inputs and house pile reactions unchanged", () => {
  const p = fixture(),
    without = { ...p, annexes: [] },
    house = calculateDesigner(without),
    r = calculateDesigner(p);
  assert.deepEqual(r.geometry.polygon, house.geometry.polygon);
  near(r.geometry.totalFloorArea, house.geometry.totalFloorArea);
  near(r.geometry.totalPlatformArea, house.geometry.totalPlatformArea);
  assert.deepEqual(r.housePiles, house.piles);
  assert.deepEqual(r.houseLoads, house.loads);
  assert.deepEqual(r.houseTimberTotals, house.timber.totals);
  assert.ok(r.geometry.compositeBounds.minY < r.geometry.bounds.minY);
  near(r.annexes.quantities.floorArea, 10);
  const m = checkDesignerMembers(memberLoadProject(p), r),
    m0 = checkDesignerMembers(memberLoadProject(without), house);
  near(m.joist.floorWoodPressure, m0.joist.floorWoodPressure);
  near(m.joist.moment, m0.joist.moment);
});

test("open deck carries snow on its exposed floor; covered roofs carry projected snow without duplicate deck snow", () => {
  const p = fixture("openTerrace");
  p.annexes[0].loads = { snow: 3, deckSnowFactor: 1.2, snowMu: 0.7 };
  const a = calculateDesigner(p).annexes.items[0];
  near(a.loads.snow, 10 * 3 * 1.2);
  assert.equal(a.roof.surfaces.length, 0);
  p.annexes[0].kind = "coveredTerrace";
  const b = calculateDesigner(p).annexes.items[0];
  near(b.loads.snow, b.quantities.roofProjectedArea * 3 * 0.7);
  assert.ok(b.roof.surfaces.length);
  assert.ok(b.checks.some((c) => c.id.endsWith("weather-load-cases") && c.status === "unverified"));
});

test("density modifies actual wood once while glazing and user layer weights stay independent", () => {
  const p = fixture("glazedVeranda"),
    a = calculateDesigner(p).annexes.items[0];
  p.material.density *= 2;
  const b = calculateDesigner(p).annexes.items[0];
  near(b.quantities.woodMass, 2 * a.quantities.woodMass);
  near(b.quantities.glazingMass, a.quantities.glazingMass);
  near(b.loads.dead - a.loads.dead, (a.quantities.woodMass * G) / 1000);
  near(
    b.loads.totalDesign - a.loads.totalDesign,
    ((a.quantities.woodMass * G) / 1000) * a.input.loads.gammaG,
  );
});

test("every roof post stands above its own pile and explicit bearing row; roof slopes away from the house", () => {
  const p = fixture(),
    a = calculateDesigner(p).annexes.items[0],
    piles = new Map(a.foundation.piles.map((p) => [p.id, p]));
  for (const b of a.roof.posts) {
    const pile = piles.get(b.supportedPileId);
    assert.ok(pile);
    near(b.start[0], pile.x);
    near(b.start[2], pile.y);
    assert.ok(
      a.instances.some(
        (x) =>
          x.role === "annexPostBearingBlock" &&
          Math.abs(x.start[1] + x.h / 2000 - (a.deckTopY - a.input.floor.deckThickness)) < 1e-7,
      ),
    );
    assert.equal(b.cutEnd.scheme, "miter");
  }
  const surf = a.roof.surfaces[0],
    [A, , C] = surf.points;
  assert.ok(A[1] > C[1]);
  for (const d of a.roof.downpipes) {
    near(d.end[1], 0);
    assert.ok(d.length > 0);
  }
  assert.ok(a.roof.analysis.valid);
  near(a.roof.analysis.reactions.horizontalA, 0);
});

test("arbitrarily rotated attachment uses the real wall direction and outward side", () => {
  const p = fixture("openTerrace"),
    r = calculateDesigner(p),
    A = r.annexes.items[0],
    theta = 0.41,
    rotate = (q) => ({
      x: q.x * Math.cos(theta) - q.y * Math.sin(theta),
      y: q.x * Math.sin(theta) + q.y * Math.cos(theta),
    });
  for (const w of p.walls) {
    w.a = rotate(w.a);
    w.b = rotate(w.b);
  }
  const B = calculateDesigner(p).annexes.items[0];
  near(A.quantities.woodMass, B.quantities.woodMass);
  near(A.loads.totalDesign, B.loads.totalDesign);
  for (let i = 0; i < A.polygon.length; i++) {
    const q = rotate(A.polygon[i]);
    near(q.x, B.polygon[i].x);
    near(q.y, B.polygon[i].y);
  }
  assert.ok(B.foundation.piles.every((p) => p.annexId === "A"));
});

test("access and house-window collision diagnostics do not fabricate a door or roof ledger", () => {
  const p = fixture();
  p.openings = [];
  let a = calculateDesigner(p).annexes.items[0];
  assert.equal(a.access.status, "missing");
  assert.ok(a.checks.some((c) => c.id.endsWith("house-access") && c.status === "fail"));
  p.openings = [
    { id: "window", wallId: "w-north", offset: 2, width: 1, height: 1.5, sill: 0.8, type: "window" },
  ];
  p.annexes[0].roof = { lowEaveHeight: 1.8, pitch: 2 };
  a = calculateDesigner(p).annexes.items[0];
  assert.ok(a.checks.some((c) => c.id.includes("roof-over-opening") && c.status === "fail"));
  assert.equal(
    a.instances.some((b) => b.role.includes("Ledger")),
    false,
  );
});

test("glazed veranda has an actual door of the requested height plus transom, and explicit cold-envelope/wind limits", () => {
  const a = calculateDesigner(fixture("glazedVeranda")).annexes.items[0],
    door = a.glazing.find((g) => g.kind === "door");
  assert.ok(door);
  near(
    Math.max(...door.polygon.map((p) => p[1])) - Math.min(...door.polygon.map((p) => p[1])),
    a.input.glazing.doorHeight,
  );
  assert.ok(a.glazing.some((p) => p.id.includes("transom")));
  assert.ok(a.glazing.every((g) => g.mass > 0 && g.windForce > 0 && g.verified === false));
  near(a.quantities.glazingMass, ((sum(a.glazing.map((g) => g.area)) * a.input.glazing.dead) / G) * 1000);
  assert.ok(a.checks.some((c) => c.id.endsWith("unheated-envelope") && c.status === "unverified"));
});

test("physical boards of a covered terrace and glazed veranda have no positive-volume mesh collisions", () => {
  for (const kind of ["coveredTerrace", "glazedVeranda"]) {
    const a = calculateDesigner(fixture(kind)).annexes.items[0],
      boards = a.instances.map((b) => ({ b, shape: shape(b) })),
      hits = [];
    for (let i = 0; i < boards.length; i++)
      for (let j = 0; j < i; j++)
        if (intersects(boards[i].shape, boards[j].shape)) hits.push(boards[i].b.id + " / " + boards[j].b.id);
    assert.deepEqual(hits, [], kind);
  }
});

test("excessive structural span/stock cannot be hidden by generic half-laps", () => {
  const p = fixture("coveredTerrace");
  p.annexes[0].depth = 7;
  p.annexes[0].roof = { section: "48x148", pitch: 25 };
  const a = calculateDesigner(p).annexes.items[0];
  assert.ok(a.checks.some((c) => c.id.endsWith("stock") && c.status === "fail"));
  assert.ok(a.checks.some((c) => c.id.endsWith("rafter-capacity") && c.status === "fail"));
  assert.ok(a.instances.filter((b) => b.role === "annexRafter").every((b) => b.requireSingleStock));
});

test("roof covers of adjacent independent annexes cannot silently overlap", () => {
  const p = fixture("coveredTerrace");
  p.openings = [
    { id: "D1", wallId: "w-north", offset: 1, width: 0.9, height: 2.1, sill: 0, type: "door" },
    { id: "D2", wallId: "w-north", offset: 5, width: 0.9, height: 2.1, sill: 0, type: "door" },
  ];
  p.annexes = [
    { id: "A", kind: "coveredTerrace", attachedWallId: "w-north", offset: 0, width: 4, depth: 2.5 },
    { id: "B", kind: "coveredTerrace", attachedWallId: "w-north", offset: 4, width: 4, depth: 2.5 },
  ];
  const r = calculateDesigner(p);
  assert.ok(r.annexes.checks.some((c) => c.id.startsWith("annex-roof-overlap") && c.status === "fail"));
  assert.equal(r.annexes.loads.complete, false);
});

test("standalone invalid material is reported before numerical solvers can produce NaN", () => {
  const p = fixture();
  p.material.E = 0;
  const r = buildAnnexes(p, {});
  assert.equal(r.status, "fail");
  assert.equal(r.instances.length, 0);
  assert.ok(r.checks.some((c) => c.id === "material.E"));
});

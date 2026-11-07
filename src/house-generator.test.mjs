import test from "node:test";
import assert from "node:assert/strict";
import { generateHouse, generateHouseOptions, HouseGenerationError } from "./house-generator.js";
import { validateDesignerProject, calculateDesigner } from "./designer-engine.js";
import { calculateRoofZones } from "./roof-zones.js";

const near = (a, b, t = 1e-7) => assert.ok(Math.abs(a - b) < t, `${a} ≠ ${b}`);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = (p) =>
  Math.abs(p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0)) / 2;
const roomProgram = [
  { name: "Спальня", area: 12 },
  { name: "Кухня", area: 14 },
  { name: "Гостиная", area: 18 },
  { name: "Санузел", area: 4 },
];
function overlapRect(a, b) {
  const bounds = (p) => ({
      x0: Math.min(...p.map((q) => q.x)),
      x1: Math.max(...p.map((q) => q.x)),
      y0: Math.min(...p.map((q) => q.y)),
      y1: Math.max(...p.map((q) => q.y)),
    }),
    A = bounds(a),
    B = bounds(b);
  return (
    Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0)) *
    Math.max(0, Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0))
  );
}

test("default generation produces a deterministic valid project with independent explicit wall levels", () => {
  const a = generateHouse(),
    b = generateHouse();
  assert.deepEqual(a, b);
  assert.equal(validateDesignerProject(a.project).valid, true);
  assert.equal(a.project.walls.length, 4);
  assert.ok(a.project.walls.every((w) => w.level === 1));
  assert.deepEqual(a.project.openings, []);
  near(calculateDesigner(a.project).geometry.area, 48);
  assert.ok(a.planning.checks.some((c) => c.status === "unverified"));
  assert.ok(!Object.hasOwn(a.project.roof, "zones"));
});

test("rectangular room program has net areas, a clear 1.2 m corridor and real doors/windows", () => {
  const { project: p, planning } = generateHouse({ width: 12, depth: 8, rooms: roomProgram }),
    rooms = planning.rooms.filter((r) => r.kind === "room"),
    corridor = planning.rooms.find((r) => r.kind === "corridor");
  assert.equal(rooms.length, 4);
  near(corridor.dimensions.width, 1.2);
  near(corridor.area, (12 - 0.15) * 1.2);
  assert.ok(corridor.accessOpeningId);
  for (const room of rooms) {
    assert.ok(room.area >= room.targetArea - 1e-8);
    near(room.area, area(room.polygon));
    assert.ok(room.doorOpeningId);
    assert.ok(room.windowOpeningId);
    const door = p.openings.find((o) => o.id === room.doorOpeningId),
      window = p.openings.find((o) => o.id === room.windowOpeningId);
    assert.equal(door.type, "door");
    assert.equal(window.type, "window");
    assert.equal(p.walls.find((w) => w.id === door.wallId).kind, "partition");
    assert.equal(p.walls.find((w) => w.id === window.wallId).kind, "exterior");
    near(overlapRect(room.polygon, corridor.polygon), 0);
  }
  for (let i = 0; i < rooms.length; i++)
    for (let j = 0; j < i; j++) near(overlapRect(rooms[i].polygon, rooms[j].polygon), 0);
  assert.ok(planning.checks.filter((c) => c.id.endsWith("adjacency")).every((c) => c.status === "pass"));
  assert.equal(validateDesignerProject(p).valid, true);
});

test("the corridor rotates along the long Y direction without moving partitions outside the building", () => {
  const { project: p, planning } = generateHouse({ width: 8, depth: 12, rooms: roomProgram }),
    corridor = planning.rooms.find((r) => r.kind === "corridor");
  near(Math.max(...corridor.polygon.map((q) => q.x)) - Math.min(...corridor.polygon.map((q) => q.x)), 1.2);
  for (const w of p.walls)
    for (const q of [w.a, w.b])
      assert.ok(q.x >= -1e-8 && q.x <= 8 + 1e-8 && q.y >= -1e-8 && q.y <= 12 + 1e-8);
  assert.equal(validateDesignerProject(p).valid, true);
  near(calculateDesigner(p).geometry.area, 96);
});

test("room requirements enforce real net dimensions and oversized/contradictory programs are rejected", () => {
  assert.throws(
    () => generateHouse({ width: 8, depth: 6, rooms: [{ name: "Большая", area: 100 }] }),
    HouseGenerationError,
  );
  // The corridor strategy alone cannot host a 5 m deep room in a 6 m house...
  assert.throws(
    () => generateHouse({ strategy: "corridor", rooms: [{ name: "Широкая", area: 5, minDepth: 5 }] }),
    /поперечный размер/,
  );
  // ...but the generator no longer gives up: an alternative strategy fits the requirement.
  const wide = generateHouse({ rooms: [{ name: "Широкая", area: 5, minDepth: 5 }] });
  assert.notEqual(wide.planning.strategy, "corridor");
  assert.ok(wide.planning.rooms.find((r) => r.kind === "room").dimensions.depth >= 5 - 1e-9);
  const r = generateHouse({
    width: 12,
    depth: 8,
    rooms: [{ name: "Спальня", area: 12, minWidth: 3, minDepth: 3 }],
  });
  const room = r.planning.rooms.find((r) => r.kind === "room");
  assert.ok(room.dimensions.width >= 3 && room.dimensions.depth >= 3);
  assert.ok(r.planning.checks.some((c) => c.id.endsWith("width") && c.limit === 3 && c.status === "pass"));
});

test("L template preserves its real polygon and explicit small upper footprint", () => {
  const upper = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ],
    r = generateHouse({
      template: "l-shape",
      width: 10,
      depth: 8,
      wingWidth: 5,
      wingDepth: 4,
      levels: [{ height: 2.8 }, { height: 2.6, footprint: upper }],
    });
  const base = calculateDesigner(r.project);
  near(base.geometry.levels[0].area, 60);
  near(base.geometry.levels[1].area, 20);
  assert.equal(r.project.walls.filter((w) => w.level === 1).length, 6);
  assert.equal(r.project.walls.filter((w) => w.level === 2).length, 4);
  assert.equal(new Set(r.project.walls.map((w) => w.id)).size, 10);
  const roofs = calculateRoofZones(r.project, base);
  near(roofs.projectedArea, 60);
  assert.ok(roofs.zones.some((z) => z.levelIndex === 1));
  assert.ok(roofs.zones.some((z) => z.levelIndex === 2));
});

test("an omitted upper footprint inherits the explicit ground-floor contour", () => {
  const poly = [
      { x: 2, y: 3 },
      { x: 8, y: 3 },
      { x: 8, y: 7 },
      { x: 2, y: 7 },
    ],
    r = generateHouse({ levels: [{ height: 2.8, footprint: poly }, { height: 2.7 }] }),
    g = calculateDesigner(r.project).geometry;
  near(g.levels[0].area, 24);
  near(g.levels[1].area, 24);
  assert.deepEqual(r.planning.levels[0].polygon, r.planning.levels[1].polygon);
});

test("second light cuts only the requested upper floor and never silently intersects auto rooms", () => {
  const polygon = [
      { x: 2, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 3 },
      { x: 2, y: 3 },
    ],
    r = generateHouse({
      width: 10,
      depth: 8,
      levels: [{ height: 2.8 }, { height: 2.8 }],
      secondLight: { level: 2, polygon },
    }),
    g = calculateDesigner(r.project).geometry;
  near(g.levels[0].netFloorArea, 80);
  near(g.levels[1].netFloorArea, 74);
  assert.equal(r.project.voids[0].level, 2);
  assert.throws(
    () =>
      generateHouse({
        width: 10,
        depth: 8,
        levels: [{ height: 2.8 }, { height: 2.8 }],
        secondLight: {
          level: 2,
          polygon: [
            { x: 0, y: 3 },
            { x: 10, y: 3 },
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
        },
        rooms: [{ name: "Верхняя", area: 10, level: 2 }],
      }),
    /второй свет/,
  );
});

test("explicit bounds work inside an L footprint and shared partition segments are deduplicated", () => {
  const spec = {
      template: "l-shape",
      width: 10,
      depth: 8,
      wingWidth: 5,
      wingDepth: 4,
      rooms: [
        { name: "A", area: 10, bounds: { minX: 0, minY: 0, maxX: 5, maxY: 3 } },
        { name: "B", area: 10, bounds: { x: 0, y: 3, width: 5, depth: 3 } },
      ],
    },
    r = generateHouse(spec);
  assert.equal(r.planning.rooms.filter((r) => r.kind === "room").length, 2);
  assert.equal(validateDesignerProject(r.project).valid, true);
  assert.ok(r.planning.warnings.some((w) => w.includes("связь с коридором")));
  assert.throws(
    () =>
      generateHouse({
        ...spec,
        rooms: [{ name: "Вне", area: 2, bounds: { x: 6, y: 5, width: 2, depth: 2 } }],
      }),
    /выходит за реальный контур/,
  );
  // An L footprint no longer requires manual bounds: it is decomposed into wing rectangles.
  const auto = generateHouse({ template: "l-shape", rooms: [{ name: "Без bounds", area: 8 }] });
  assert.match(auto.planning.strategy, /^l-corridor/);
  assert.ok(auto.planning.rooms.find((r) => r.name === "Без bounds").doorOpeningId);
});

test("custom non-orthogonal footprint, material, roof and stock settings survive normalization", () => {
  const poly = [
      { x: 1, y: 1 },
      { x: 8, y: 2 },
      { x: 7, y: 7 },
      { x: 0, y: 5 },
    ],
    r = generateHouse({
      footprint: poly,
      sections: {
        walls: "50x200",
        floor: "50x300",
        roof: "50x250",
        roofWeb: "50x150",
        bracing: "25x150",
        grillage: "50x250",
      },
      roof: {
        shape: "mono",
        pitch: 18,
        pitchRight: 32,
        ridgeAngle: 90,
        framing: "rafters",
        wallFraming: "continuous",
      },
      material: { density: 480, E: 11000 },
      loads: { snow: 2.1 },
      foundation: { spacing: 1.8, grillage: { plies: 4 } },
      bracing: { method: "letIn" },
    });
  assert.equal(validateDesignerProject(r.project).valid, true);
  near(calculateDesigner(r.project).geometry.area, area(poly));
  assert.equal(r.project.floor.section, "50x300");
  assert.equal(r.project.roof.chordSection, "50x250");
  assert.equal(r.project.roof.pitchLeft, 18);
  assert.equal(r.project.roof.pitchRight, 32);
  assert.equal(r.project.roof.ridgeAngle, 90);
  assert.equal(r.project.foundation.grillage.plies, 4);
  assert.equal(r.project.foundation.grillage.section, "50x250");
  assert.equal(r.project.material.density, 480);
  assert.equal(r.project.loads.snow, 2.1);
  assert.equal(r.project.bracing.method, "letIn");
});

test("malformed polygons/nested values and invalid final engine parameters produce diagnostics", () => {
  for (const spec of [
    null,
    { roof: null },
    { material: [] },
    { foundation: { grillage: null } },
    {
      footprint: [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 4, y: 0 },
      ],
    },
    { roof: { framing: "magic" } },
    { sections: { walls: "150x50" } },
    { material: { E: -1 } },
    { rooms: Array.from({ length: 31 }, () => ({ name: "R", area: 1 })) },
  ])
    assert.throws(
      () => generateHouse(spec),
      (e) => e instanceof HouseGenerationError && e.errors.length > 0,
    );
});

test("generation does not mutate the specification or silently claim complete building approval", () => {
  const spec = { width: 12, depth: 8, rooms: roomProgram, foundation: { grillage: { plies: 4 } } },
    before = JSON.stringify(spec),
    r = generateHouse(spec);
  assert.equal(JSON.stringify(spec), before);
  assert.ok(
    r.planning.checks.some((c) => c.id === "generation-building-design" && c.status === "unverified"),
  );
  assert.ok(r.planning.checks.some((c) => c.id.endsWith("width") && c.status === "unverified"));
  assert.equal(r.project.cutting.stockLength, 6);
});

// ---------------------------------------------------------------------------
// Structure-aware generation
// ---------------------------------------------------------------------------
const twoStoreyProgram = [
  { name: "Кухня-гостиная", area: 20 },
  { name: "Санузел", area: 4 },
  { name: "Кабинет", area: 9 },
  { name: "Спальня 1", area: 12, level: 2 },
  { name: "Спальня 2", area: 12, level: 2 },
  { name: "Спальня 3", area: 10, level: 2 },
  { name: "Ванная", area: 5, level: 2 },
];
const onSegment = (q, a, b) =>
  Math.abs(cross(a, b, q)) < 1e-7 &&
  q.x >= Math.min(a.x, b.x) - 1e-7 &&
  q.x <= Math.max(a.x, b.x) + 1e-7 &&
  q.y >= Math.min(a.y, b.y) - 1e-7 &&
  q.y <= Math.max(a.y, b.y) + 1e-7;
const contains = (poly, inner) =>
  inner.every((q) => {
    let yes = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i],
        b = poly[j];
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) yes = !yes;
    }
    return yes;
  });

test("2-storey 10×9: bearing corridor walls keep upper joist spans under target and are stacked", () => {
  const { project: p, planning } = generateHouse({
    width: 10,
    depth: 9,
    levels: [{ height: 2.8 }, { height: 2.8 }],
    rooms: twoStoreyProgram,
  });
  assert.equal(validateDesignerProject(p).valid, true);
  assert.equal(p.floor.axis, "y", "joists span the short 9 m direction");
  const bearing = p.walls.filter((w) => w.kind === "bearing");
  assert.ok(bearing.length >= 2);
  assert.ok(bearing.every((w) => w.level === 1 && Math.abs(w.a.y - w.b.y) < 1e-9));
  // Every lower bearing line carries a stacked upper wall on the same axis.
  for (const b of bearing)
    assert.ok(
      p.walls.some((w) => w.level === 2 && onSegment(w.a, b.a, b.b) && onSegment(w.b, b.a, b.b)),
      `${b.id} has no stacked upper wall`,
    );
  assert.ok(planning.structure.stackedPartitionIds.length >= 2);
  assert.ok(planning.structure.maxJoistSpan <= planning.structure.maxJoistSpanTarget + 1e-9);
  assert.ok(planning.structure.maxJoistSpan < 4.5);
  // The engine sees the same real spans.
  const calculated = calculateDesigner(p);
  assert.ok(calculated.floorPlatform.quantities.maxSpan <= planning.structure.maxJoistSpanTarget + 1e-6);
  // A U-stair connects the floors through a framed opening.
  assert.equal(p.staircase.levelFrom, 1);
  assert.equal(p.staircase.levelTo, 2);
  const hole = p.voids.find((v) => v.id === p.staircase.voidId);
  assert.equal(hole.kind, "stair");
  assert.equal(hole.level, 2);
  assert.ok(planning.rooms.some((r) => r.kind === "stair" && r.level === 1));
  assert.ok(planning.rooms.some((r) => r.kind === "stair" && r.level === 2));
  const stairCheck = calculated.spatialLayout.checks.find((c) => c.id === "GEN-STAIR-fit");
  assert.equal(stairCheck.status, "pass");
});

test("structure-aware defaults: ridge and joists follow the short side, explicit values win", () => {
  const narrow = generateHouse({ width: 6, depth: 10 });
  assert.equal(narrow.project.roof.ridgeAngle, 90);
  assert.equal(narrow.planning.structure.trussSpan, 6);
  assert.equal(narrow.project.floor.axis, "x");
  const zones = calculateRoofZones(narrow.project, calculateDesigner(narrow.project)).zones;
  assert.ok(zones.length > 0 && zones.every((z) => z.ridgeAngle === 90));
  const wide = generateHouse({ width: 10, depth: 6 });
  assert.equal(wide.project.roof.ridgeAngle, 0);
  assert.equal(wide.project.floor.axis, "y");
  const forced = generateHouse({ width: 6, depth: 10, roof: { ridgeAngle: 0 }, floor: { axis: "y" } });
  assert.equal(forced.project.roof.ridgeAngle, 0);
  assert.equal(forced.project.floor.axis, "y");
  const steps = generateHouse({
    width: 8,
    depth: 6,
    studStep: 0.4,
    joistSpacing: 0.4,
    rooms: roomProgram.slice(0, 2),
  });
  assert.ok(steps.project.walls.every((w) => w.studStep === 0.4));
  assert.equal(steps.project.floor.spacing, 0.4);
  // A two-storey shell receives a bearing spine only where the upper floor needs it.
  const shell = generateHouse({ width: 10, depth: 9, levels: [{ height: 2.8 }, { height: 2.8 }] });
  assert.equal(shell.project.walls.filter((w) => w.kind === "bearing").length, 1);
  assert.ok(shell.planning.structure.maxJoistSpan <= shell.planning.structure.maxJoistSpanTarget);
  const off = generateHouse({
    width: 10,
    depth: 9,
    levels: [{ height: 2.8 }, { height: 2.8 }],
    structure: { bearingWalls: false },
  });
  assert.equal(off.project.walls.filter((w) => w.kind === "bearing").length, 0);
  assert.ok(off.planning.warnings.some((w) => w.includes("Пролёт лаг")));
});

test("L footprint with an automatic room program and two storeys needs no manual bounds", () => {
  const { project: p, planning } = generateHouse({
    template: "l-shape",
    width: 10,
    depth: 8,
    wingWidth: 5,
    wingDepth: 4,
    levels: [{ height: 2.8 }, { height: 2.8 }],
    rooms: [
      { name: "Гостиная", area: 12 },
      { name: "Кухня", area: 8 },
      { name: "Спальня", area: 10, level: 2 },
      { name: "Детская", area: 8, level: 2 },
    ],
  });
  assert.equal(validateDesignerProject(p).valid, true);
  assert.match(planning.strategy, /^l-corridor/);
  const rooms = planning.rooms.filter((r) => r.kind === "room");
  assert.equal(rooms.length, 4);
  for (const r of rooms) {
    assert.ok(r.doorOpeningId);
    assert.ok(r.area >= r.targetArea - 1e-8);
    const outline = p.walls.filter((w) => w.level === r.level && w.kind === "exterior").map((w) => w.a);
    assert.ok(contains(outline, r.polygon));
  }
  assert.ok(p.walls.some((w) => w.kind === "bearing" && w.level === 1));
});

test("misfit of one strategy falls back to another; a clear Russian error only when nothing fits", () => {
  // Too narrow for two room strips along a central corridor: another strategy takes over.
  const narrow = generateHouse({
    width: 10,
    depth: 4.5,
    rooms: [
      { name: "Спальня", area: 9 },
      { name: "Кабинет", area: 7 },
    ],
  });
  assert.notEqual(narrow.planning.strategy, "corridor");
  assert.ok(narrow.planning.rooms.filter((r) => r.kind === "room").every((r) => r.doorOpeningId));
  assert.throws(
    () =>
      generateHouse({ width: 10, depth: 4.5, strategy: "corridor", rooms: [{ name: "Спальня", area: 9 }] }),
    /слишком узок/,
  );
  const side = generateHouse({
    width: 10,
    depth: 4.5,
    strategy: "side-corridor",
    rooms: [{ name: "Спальня", area: 9 }],
  });
  assert.equal(side.planning.rooms.filter((r) => r.kind === "corridor").length, 1);
  assert.throws(
    () => generateHouse({ width: 6, depth: 5, rooms: [{ name: "Зал", area: 60 }] }),
    (e) => e instanceof HouseGenerationError && /ни одной стратегией/.test(e.message) && e.errors.length >= 2,
  );
});

test("generateHouseOptions returns distinct valid strategies with score components", () => {
  const out = generateHouseOptions(
    {
      width: 12,
      depth: 9,
      rooms: [
        { name: "Гостиная", area: 22 },
        { name: "Кухня", area: 10 },
        { name: "Спальня", area: 12 },
        { name: "Санузел", area: 5 },
      ],
    },
    { count: 6 },
  );
  assert.ok(out.options.length >= 3, JSON.stringify(out.rejected));
  assert.equal(new Set(out.options.map((o) => o.strategy)).size, out.options.length);
  const signatures = new Set(out.options.map((o) => JSON.stringify(o.project.walls.map((w) => [w.a, w.b]))));
  assert.equal(signatures.size, out.options.length);
  out.options.forEach((o, i) => {
    assert.equal(o.rank, i + 1);
    assert.equal(validateDesignerProject(o.project).valid, true);
    for (const k of [
      "totalWallLength",
      "circulationAreaPercent",
      "roomAreaErrorPercent",
      "roomsWithoutWindow",
      "minDaylightRatio",
    ])
      assert.ok(Number.isFinite(o.score[k]), `${o.strategy}.${k}`);
    assert.ok(Array.isArray(o.score.daylight) && o.score.daylight.length === 4);
    const rooms = o.planning.rooms.filter((r) => r.kind === "room");
    assert.equal(rooms.length, 4);
    for (let a = 0; a < rooms.length; a++)
      for (let b = 0; b < a; b++) near(overlapRect(rooms[a].polygon, rooms[b].polygon), 0);
  });
  assert.throws(() => generateHouseOptions({}, { count: 7 }), HouseGenerationError);
});

test("site table supplies snow/wind; explicit loads override and the origin is reported", () => {
  const r = generateHouse({ width: 8, depth: 6, site: { city: "москва" } });
  assert.equal(r.project.loads.snow, 1.45);
  assert.equal(r.project.loads.wind, 0.23);
  assert.equal(r.project.loads.terrain, "B");
  assert.equal(r.project.site.snowRegion, "III");
  assert.equal(r.project.site.windRegion, "I");
  assert.ok(r.project.site.source);
  assert.deepEqual(r.planning.site.applied, { snow: "site", wind: "site", terrain: "site" });
  const o = generateHouse({
    width: 8,
    depth: 6,
    site: { city: "Москва", terrain: "A" },
    loads: { snow: 2.4 },
  });
  assert.equal(o.project.loads.snow, 2.4);
  assert.equal(o.project.loads.terrain, "A");
  assert.equal(o.planning.site.applied.snow, "explicit");
  const unknown = generateHouse({ width: 8, depth: 6, site: { city: "Нигдебург" } });
  assert.equal(unknown.project.loads.snow, 1.5, "engine default kept");
  assert.ok(unknown.planning.warnings.some((w) => w.includes("не найден")));
});

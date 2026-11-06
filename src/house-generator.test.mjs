import test from "node:test";
import assert from "node:assert/strict";
import { generateHouse, HouseGenerationError } from "./house-generator.js";
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
  assert.throws(
    () => generateHouse({ rooms: [{ name: "Широкая", area: 5, minDepth: 5 }] }),
    /поперечный размер/,
  );
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
  assert.throws(
    () => generateHouse({ template: "l-shape", rooms: [{ name: "Без bounds", area: 8 }] }),
    /задайтеbounds/,
  );
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

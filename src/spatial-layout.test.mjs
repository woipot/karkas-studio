import test from "node:test";
import assert from "node:assert/strict";
import { buildSpatialLayout, validateSpatialLayoutInput } from "./spatial-layout.js";
import { cutGeometry } from "./board-geometry.js";
const rect = (x0, y0, x1, y1) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  near = (a, b, t = 1e-6) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < t, `${a} != ${b}`),
  sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0),
  dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0),
  sub = (a, b) => a.map((x, i) => x - b[i]),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit = (a) => a.map((x) => x / Math.hypot(...a));
function fixture() {
  const p = {
    floors: 2,
    material: { density: 450 },
    walls: [1, 2].flatMap((level) =>
      rect(0, 0, 8, 8).map((a, i, P) => ({
        id: `W${level}-${i}`,
        level,
        a,
        b: P[(i + 1) % 4],
        kind: "exterior",
        section: "75x198",
      })),
    ),
    openings: [],
    voids: [
      {
        id: "V",
        level: 2,
        kind: "doubleHeight",
        polygon: rect(0.6, 0.4, 6.2, 2.8),
        edgeSection: "48x248",
        edgePlies: 4,
      },
    ],
    roomSchedule: [{ id: "R", name: "Living", level: 1, polygon: rect(0.099, 0.099, 7.901, 3.901) }],
    staircase: {
      id: "S",
      voidId: "V",
      levelFrom: 1,
      levelTo: 2,
      kind: "u-turn",
      polygon: rect(2.904, 0.504, 6.104, 2.704),
      risers: 18,
      flightWidth: 1,
      flightGap: 0.2,
      landingLength: 1,
      tread: 0.275,
      exit: "east",
    },
    spatialLayout: { guardHeight: 1.1, maxGuardGap: 0.1, minGalleryWidth: 0.9, minStairClearWidth: 0.9 },
    doubleHeightSpaces: [
      {
        id: "D",
        voidId: "V",
        lowerRoomId: "R",
        galleryPaths: [
          { id: "E", polygon: rect(6.35, 0.4, 7.89, 3.88) },
          { id: "SOUTH", polygon: rect(0.6, 2.95, 6.35, 3.88) },
        ],
      },
    ],
  };
  return {
    p,
    input: {
      geometry: {
        levels: [
          { index: 1, wallBaseY: 1.251, topY: 4.051, polygon: rect(0, 0, 8, 8) },
          { index: 2, wallBaseY: 4.334, topY: 7.134, polygon: rect(0, 0, 8, 8) },
        ],
      },
      walls: p.walls,
      timber: { instances: [] },
    },
  };
}
function vertices(b) {
  const u = unit(sub(b.end, b.start)),
    w = unit(b.crossAxis.map((x, i) => x - dot(b.crossAxis, u) * u[i])),
    z = cross(w, u),
    mid = b.start.map((x, i) => (x + b.end[i]) / 2),
    g = cutGeometry(b),
    p = g.attributes.position,
    a = [];
  for (let i = 0; i < p.count; i++)
    a.push(mid.map((x, j) => x + w[j] * p.getX(i) + u[j] * p.getY(i) + z[j] * p.getZ(i)));
  g.dispose();
  return a;
}
const meshVolume = (v) =>
  Math.abs(
    sum(Array.from({ length: v.length / 3 }, (_, i) => dot(v[3 * i], cross(v[3 * i + 1], v[3 * i + 2])) / 6)),
  );
function convexOverlap(A, B) {
  const edges = (a) => {
      const out = [];
      for (let i = 0; i < a.length; i += 3)
        for (const [x, y] of [
          [i, i + 1],
          [i + 1, i + 2],
          [i + 2, i],
        ]) {
          const d = sub(a[y], a[x]);
          if (Math.hypot(...d) > 1e-8) out.push(unit(d));
        }
      return out;
    },
    normals = (a) => {
      const out = [];
      for (let i = 0; i < a.length; i += 3) {
        const d = cross(sub(a[i + 1], a[i]), sub(a[i + 2], a[i]));
        if (Math.hypot(...d) > 1e-8) out.push(unit(d));
      }
      return out;
    };
  for (let j = 0; j < 3; j++)
    if (
      Math.min(Math.max(...A.map((p) => p[j])), Math.max(...B.map((p) => p[j]))) -
        Math.max(Math.min(...A.map((p) => p[j])), Math.min(...B.map((p) => p[j]))) <
      1e-6
    )
      return false;
  const eA = edges(A),
    eB = edges(B),
    axes = [...normals(A), ...normals(B)];
  for (const a of eA)
    for (const b of eB) {
      const c = cross(a, b);
      if (Math.hypot(...c) > 1e-6) axes.push(unit(c));
    }
  for (const n of axes) {
    const a = A.map((p) => dot(p, n)),
      b = B.map((p) => dot(p, n));
    if (Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b)) < 1e-6)
      return false;
  }
  return true;
}

test("legacy projects stay disabled; malformed spatial input is rejected without mutation or coercion", () => {
  assert.equal(buildSpatialLayout({ staircase: { legacy: true } }).enabled, false);
  assert.deepEqual(
    validateSpatialLayoutInput(null).map((e) => e.field),
    ["project"],
  );
  for (const mutate of [
    (p) => (p.spatialLayout.guardHeight = NaN),
    (p) => (p.doubleHeightSpaces[0].galleryPaths = null),
    (p) => (p.staircase.exit = "diagonal"),
    (p) => (p.staircase.risers = 17),
    (p) => (p.voids[0].edgePlies = 1.5),
    (p) => (p.voids[0].edgePlies = 7),
    (p) => (p.spatialLayout.guardHight = 1.1),
    (p) => (p.doubleHeightSpaces[0].galleryPath = []),
    (p) => (p.doubleHeightSpaces[0].galleryPaths[0].widht = 1),
    (p) => (p.voids = {}),
    (p) => (p.voids = [null]),
    (p) => (p.doubleHeightSpaces[0].daylightOpeningIds = ["X", "X"]),
    (p) => (p.staircase.postSection = "75x100"),
    (p) => (p.staircase.flightGap = 0.1),
  ]) {
    const { p } = fixture();
    mutate(p);
    assert.ok(validateSpatialLayoutInput(p).length);
    assert.equal(buildSpatialLayout(p).status, "fail");
  }
  assert.ok(validateSpatialLayoutInput({ doubleHeightSpaces: null }).length);
  assert.equal(buildSpatialLayout({ doubleHeightSpaces: null }).status, "fail");
  assert.deepEqual(validateSpatialLayoutInput({ doubleHeightSpaces: [] }), []);
});
test("one void links a living room, two real gallery paths and an eighteen-riser U stair at actual level elevations", () => {
  const { p, input } = fixture(),
    r = buildSpatialLayout(p, input);
  assert.equal(
    r.checks.some((c) => c.status === "fail"),
    false,
  );
  const s = r.staircases[0];
  near(s.rise, 3.083);
  near(s.riser, 3.083 / 18);
  assert.equal(s.risers, 18);
  assert.equal(s.treads.length, 16);
  near(s.landingHeight, 1.251 + 3.083 / 2);
  near(s.actualClearWidth, 0.925);
  assert.equal(r.doubleHeightSpaces[0].voidId, "V");
  assert.deepEqual(
    r.galleries.map((g) => g.id),
    ["E", "SOUTH"],
  );
  near(r.galleries[0].width, 1.519);
  near(r.galleries[1].width, 0.909);
  assert.ok(r.guards.some((g) => g.kind === "flightGuard"));
  assert.ok(r.guards.some((g) => g.kind === "levelGuard"));
  assert.equal(JSON.stringify(r), JSON.stringify(buildSpatialLayout(p, input)));
});
test("actual sawn stringers stay above the lower floor and their rendered volume equals the installed net takeoff", () => {
  const { p, input } = fixture(),
    r = buildSpatialLayout(p, input),
    stringers = r.instances.filter((b) => b.role === "stairStringer");
  assert.equal(stringers.length, 4);
  for (const b of stringers) {
    const v = vertices(b);
    near(meshVolume(v), b.shapeNetVolume, 1e-7);
    near(b.mass, b.volume * 450);
    assert.ok(Math.min(...v.map((p) => p[1])) >= 1.251 - 1e-6);
    assert.ok(b.volume < b.grossVolume);
    near(
      b.cutLength,
      Math.max(...b.shape.points.map((p) => p[0])) - Math.min(...b.shape.points.map((p) => p[0])),
    );
    assert.ok(b.shape.points.length > 16);
  }
});
test("ripped risers/deck threshold use full stock sections but never add the discarded strip to physical mass", () => {
  const { p, input } = fixture(),
    r = buildSpatialLayout(p, input),
    threshold = r.instances.find((b) => b.role === "stairExitThreshold");
  assert.equal(threshold.h, 198);
  assert.equal(threshold.b, 35);
  near(threshold.volume, 0.035 * 0.096);
  const v = vertices(threshold);
  near(Math.min(...v.map((p) => p[0])), 6.104);
  near(Math.max(...v.map((p) => p[0])), 6.2);
  near(Math.min(...v.map((p) => p[1])), 4.299);
  near(Math.max(...v.map((p) => p[1])), 4.334);
  near(meshVolume(v), threshold.volume, 1e-7);
  assert.equal(r.instances.filter((b) => b.role === "stairRiser").length, 18);
  for (const b of r.instances.filter((b) => b.shape)) {
    near(meshVolume(vertices(b)), b.volume, 1e-7);
    assert.ok(b.grossVolume >= b.volume - 1e-8);
  }
});
test("all physical wood is unique, finite, at most six metres and counted once", () => {
  const { p, input } = fixture(),
    r = buildSpatialLayout(p, input);
  assert.equal(new Set(r.instances.map((b) => b.id)).size, r.instances.length);
  for (const b of r.instances) {
    near(b.length, Math.hypot(...sub(b.end, b.start)));
    near(b.mass, b.volume * 450);
    assert.ok(b.cutLength <= 6);
    assert.equal(b.requireSingleStock, true);
    assert.equal(b.category, "spatial");
    assert.equal(b.connectionVerified, false);
  }
  near(
    r.quantities.mass,
    sum(r.instances, (b) => b.mass),
  );
  near(
    r.quantities.volume,
    sum(r.instances, (b) => b.volume),
  );
  near(r.quantities.weight, (r.quantities.mass * 9.80665) / 1000);
  assert.ok(r.checks.some((c) => c.id === "S-connections" && c.status === "unverified"));
  assert.ok(r.checks.some((c) => c.id === "S-headroom" && c.status === "unverified"));
});
test("narrow residual strips and disconnected routes never become useful gallery through a nominal area claim", () => {
  const { p, input } = fixture();
  p.doubleHeightSpaces[0].galleryPaths.push({ id: "WEST", polygon: rect(0.099, 0.2, 0.6, 2.8) });
  let r = buildSpatialLayout(p, input);
  assert.equal(r.galleries.find((g) => g.id === "WEST").status, "fail");
  p.doubleHeightSpaces[0].galleryPaths = [{ id: "ISLAND", polygon: rect(0.2, 5, 2, 7) }];
  r = buildSpatialLayout(p, input);
  assert.equal(r.checks.find((c) => c.id === "D-exit").status, "fail");
});
test("a wall partly crossing the upper void and a stair fitted only to framing axes fail explicitly", () => {
  const { p, input } = fixture();
  p.walls.push({
    id: "BAD",
    level: 2,
    a: { x: -20, y: 1 },
    b: { x: 1, y: 1 },
    kind: "partition",
    section: "48x98",
  });
  let r = buildSpatialLayout(p, input);
  assert.equal(r.checks.find((c) => c.id === "D-walls").status, "fail");
  p.walls.pop();
  p.staircase.polygon = rect(3, 0.6, 6.2, 2.8);
  r = buildSpatialLayout(p, input);
  assert.equal(r.checks.find((c) => c.id === "S-fit").status, "fail");
});
test("linked upper windows create actual glazing surfaces and no duplicate physical window mass", () => {
  const { p, input } = fixture();
  p.openings = [
    { id: "HIGH", wallId: "W2-0", floor: 2, type: "window", offset: 1, width: 2, height: 1, sill: 1.2 },
  ];
  p.doubleHeightSpaces[0].daylightOpeningIds = ["HIGH"];
  const a = buildSpatialLayout(p, input),
    b = buildSpatialLayout(
      { ...p, openings: [], doubleHeightSpaces: [{ ...p.doubleHeightSpaces[0], daylightOpeningIds: [] }] },
      input,
    ),
    glass = a.surfaces.filter((s) => s.kind === "daylightGlazing");
  assert.equal(glass.length, 1);
  near(a.quantities.daylightArea, 2);
  near(a.quantities.mass, b.quantities.mass);
  near(Math.min(...glass[0].points.map((p) => p[1])), 5.534);
  assert.equal(glass[0].existingOpening, true);
});
test("ordinary stair and guard pieces have no positive-volume intersections in the actual production mesh", () => {
  const { p, input } = fixture(),
    r = buildSpatialLayout(p, input),
    boards = r.instances.filter((b) => b.role !== "stairStringer").map((b) => ({ ...b, mesh: vertices(b) })),
    collisions = [];
  for (let i = 0; i < boards.length; i++)
    for (let j = 0; j < i; j++)
      if (convexOverlap(boards[i].mesh, boards[j].mesh)) collisions.push([boards[i].id, boards[j].id]);
  assert.deepEqual(collisions, []);
});
test("four orthogonal exit directions rotate actual members without changing quantities or floor-rise geometry", () => {
  const { p, input } = fixture(),
    base = buildSpatialLayout(p, input);
  for (const [exit, angle] of [
    ["north", -Math.PI / 2],
    ["west", Math.PI],
    ["south", Math.PI / 2],
  ]) {
    const q = structuredClone(p),
      data = structuredClone(input),
      rotate = (p) => ({
        x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
        y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
      });
    for (const w of q.walls) {
      w.a = rotate(w.a);
      w.b = rotate(w.b);
    }
    q.voids[0].polygon = q.voids[0].polygon.map(rotate);
    q.roomSchedule[0].polygon = q.roomSchedule[0].polygon.map(rotate);
    q.staircase.polygon = q.staircase.polygon.map(rotate);
    q.staircase.exit = exit;
    for (const g of q.doubleHeightSpaces[0].galleryPaths) g.polygon = g.polygon.map(rotate);
    for (const l of data.geometry.levels) l.polygon = l.polygon.map(rotate);
    data.walls = q.walls;
    const r = buildSpatialLayout(q, data);
    assert.equal(
      r.checks.some((c) => c.status === "fail"),
      false,
    );
    near(r.quantities.mass, base.quantities.mass);
    assert.equal(r.instances.length, base.instances.length);
    near(r.staircases[0].rise, base.staircases[0].rise);
  }
});
test("a narrow north strip cannot hide guard posts inside the upper exterior wall", () => {
  const { p, input } = fixture();
  p.voids[0].polygon = rect(0.6, 0.2, 6.2, 2.8);
  const r = buildSpatialLayout(p, input),
    c = r.checks.find((c) => c.id === "spatial-guard-wall-clearance");
  assert.equal(c.status, "fail");
  assert.ok(c.collisionPairs.some((p) => p.wallId === "W2-0"));
});

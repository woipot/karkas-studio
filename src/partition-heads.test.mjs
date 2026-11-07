import test from "node:test";
import assert from "node:assert/strict";
import { resolvePartitionHeads } from "./partition-heads.js";
const near = (a, b, t = 1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < t, `${a} != ${b}`);
const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
function fixture() {
  const polygon = rect(0.075, 0.075, 7.925, 5.925),
    p = {
      walls: [
        {
          id: "P",
          kind: "partition",
          level: 1,
          section: "48x98",
          a: { x: 2.2, y: 0.15 },
          b: { x: 2.2, y: 1.751 },
          height: 2.75,
          topAttachment: { target: "roofTieUnderside", gap: 0.02, mode: "sliding" },
        },
      ],
      auxiliaryTimber: { enabled: true, ceilingBattens: true, ceilingSection: "50x50" },
    },
    levels = [{ index: 1, wallBaseY: 1.155, topY: 4.255, height: 3.1, polygon }],
    roofModel = {
      zones: [{ id: "Z", levelIndex: 1, polygon, bearingPolygon: polygon, eave: 99, ceilingDatumY: 3.955 }],
      instances: [0.1125, 1.084375, 2.05625, 3.028125, 4, 4.971875, 5.94375, 6.915625, 7.8875].map(
        (x, i) => ({
          id: "T" + i,
          zoneId: "Z",
          floor: 1,
          role: "bottomChord",
          b: 50,
          h: 200,
          start: [x, 4.355, 0.05283],
          end: [x, 4.355, 5.94717],
          crossAxis: [1, 0, 0],
          physicalTruss: true,
          shape: {
            type: "rippedBoard",
            points: [
              [-2.925, 0.1],
              [2.925, 0.1],
              [2.4961, -0.1],
              [-2.4961, -0.1],
            ],
          },
        }),
      ),
    };
  return { p, levels, roofModel };
}
function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const run = (f) => resolvePartitionHeads(f.p, { levels: f.levels, roofModel: f.roofModel });

test("R11 dimensional example resolves tie underside4.255, top4.235, height3.08 without mutating source", () => {
  const f = fixture(),
    before = JSON.stringify(f);
  deepFreeze(f);
  const r = run(f),
    i = r.items[0];
  assert.equal(i.status, "resolved");
  near(i.targetY, 4.255);
  near(i.topY, 4.235);
  near(i.effectiveHeight, 3.08);
  near(r.walls[0].height, 3.08);
  assert.equal(JSON.stringify(f), before);
  assert.notEqual(r.walls[0], f.p.walls[0]);
  assert.equal(r.walls[0].kind, "partition");
  assert.equal(i.verticalBearing, false);
  assert.equal(i.connectionsVerified, false);
  assert.equal(i.gapBasis, "adopted");
  assert.equal(i.targetSourceMemberIds.length, 9);
  assert.equal(r.status, "unverified");
  assert.ok(i.checks.some((c) => c.id.endsWith("clearance") && c.status === "unverified"));
  assert.ok(i.checks.some((c) => c.id.endsWith("lateral") && c.status === "unverified"));
  assert.ok(i.checks.some((c) => c.id.endsWith("ceiling-coordination") && c.status === "unverified"));
});
test("ceiling binding references underside of batten, not its top or finished lining", () => {
  const f = fixture();
  f.p.walls[0].topAttachment.target = "ceilingFrameUnderside";
  f.p.auxiliaryTimber.ceilingSection = "25x100";
  const r = run(f),
    i = r.items[0];
  near(i.targetY, 3.955 - 0.025);
  near(i.topY, 3.91);
  near(i.effectiveHeight, 2.755);
  assert.equal(i.ceilingSection, "25x100");
  f.p.auxiliaryTimber.ceilingSection = "50x50";
  const j = run(f).items[0];
  near(j.targetY, 3.905);
  near(j.effectiveHeight, 2.73);
});
test("roof pending never fabricates height from zone bbox, eave or topY", () => {
  const f = fixture();
  delete f.p.walls[0].height;
  delete f.roofModel;
  const r = run(f);
  assert.equal(r.items[0].status, "pending");
  assert.equal(r.items[0].targetY, null);
  assert.equal(r.walls[0].height, undefined);
  assert.ok(r.checks.every((c) => c.status === "unverified"));
});
test("unsupported mono with no bottom chords remains pending despite declared bottom metadata", () => {
  const f = fixture();
  f.roofModel.zones[0].bottomChordBottomY = 4.255;
  f.roofModel.instances.forEach((b) => (b.role = "topChord"));
  const r = run(f);
  assert.equal(r.items[0].status, "pending");
  near(r.walls[0].height, 2.75);
  assert.equal(r.items[0].targetY, null);
});
test("entire wall footprint must be inside exact concave roof polygon, not bbox/endpoints/midpoint alone", () => {
  const f = fixture();
  f.levels[0].polygon = rect(0, 0, 8, 8);
  f.p.walls[0].a = { x: 0.5, y: 3.5 };
  f.p.walls[0].b = { x: 3.5, y: 3.5 };
  const U = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 3, y: 4 },
    { x: 3, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
  ];
  f.roofModel.zones[0].polygon = U;
  f.roofModel.zones[0].bearingPolygon = U;
  const r = run(f);
  assert.equal(r.items[0].status, "fail");
  assert.equal(r.items[0].targetY, null);
  near(r.walls[0].height, 2.75);
});
test("axis inside but wall width outside floor polygon is rejected", () => {
  const f = fixture();
  f.p.walls[0].a = { x: 0.09, y: 0.3 };
  f.p.walls[0].b = { x: 0.09, y: 2 };
  assert.equal(run(f).items[0].status, "fail");
});
test("zone level and optional explicitzoneId are authoritative; no nearest-zone fallback", () => {
  const f = fixture();
  f.roofModel.zones[0].levelIndex = 2;
  f.p.walls[0].topAttachment.zoneId = "Z";
  const r = run(f);
  assert.equal(r.items[0].status, "fail");
  assert.match(r.items[0].reason, /этаже/);
  f.roofModel.zones[0].levelIndex = 1;
  f.p.walls[0].topAttachment.zoneId = "unknown";
  assert.equal(run(f).items[0].status, "fail");
});
test("overlapping zones require explicit selection and never double-resolve a head", () => {
  const f = fixture();
  f.roofModel.zones.push({ ...structuredClone(f.roofModel.zones[0]), id: "Z2" });
  assert.equal(run(f).items[0].status, "pending");
  f.p.walls[0].topAttachment.zoneId = "Z";
  assert.equal(run(f).items[0].status, "resolved");
});
test("binding is nonbearing/sliding only, with finite adopted gap limits", () => {
  for (const change of [
    { kind: "bearing" },
    { topAttachment: null },
    { topAttachment: { target: "roofTieUnderside", mode: "rigid", gap: 0.02 } },
    { topAttachment: { target: "roofTieUnderside", mode: "sliding", gap: NaN } },
    { topAttachment: { target: "roofTieUnderside", mode: "sliding", gap: 0.001 } },
    { topAttachment: { target: "roofTieUnderside", mode: "sliding", gap: 0.101 } },
  ]) {
    const f = fixture();
    Object.assign(f.p.walls[0], change);
    assert.equal(run(f).items[0].status, "fail");
  }
  const f = fixture();
  delete f.p.walls[0].topAttachment.gap;
  near(run(f).items[0].gap, 0.02);
});
test("ceiling disabled or no physical roof ties gives unresolved ceiling target", () => {
  const f = fixture();
  f.p.walls[0].topAttachment.target = "ceilingFrameUnderside";
  f.p.auxiliaryTimber.ceilingBattens = false;
  assert.equal(run(f).items[0].status, "pending");
  f.p.auxiliaryTimber.ceilingBattens = true;
  f.roofModel.instances = [];
  assert.equal(run(f).items[0].status, "pending");
});
test("actual cut-profile lower face overrides nominal h; nonhorizontal underside is unsupported", () => {
  const f = fixture();
  f.levels[0].topY = 4.5;
  for (const b of f.roofModel.instances)
    b.shape.points = [
      [-2.925, 0.05],
      [2.925, 0.05],
      [2.4, -0.1],
      [-2.4, -0.1],
    ];
  const r = run(f);
  near(r.items[0].targetY, 4.305);
  near(r.items[0].topY, 4.285);
  for (const b of f.roofModel.instances)
    b.shape.points = [
      [-2.925, -0.1],
      [2.925, -0.1],
      [0, 0.1],
    ];
  assert.equal(run(f).items[0].status, "pending");
});
test("rotating actual tie axes in plan preserves physical lower datum and does not require X-alignment", () => {
  const f = fixture();
  for (const b of f.roofModel.instances) {
    b.start = [b.start[2], b.start[1], b.start[0]];
    b.end = [b.end[2], b.end[1], b.end[0]];
    b.crossAxis = [0, 0, -1];
  }
  const r = run(f);
  assert.equal(r.items[0].status, "resolved");
  near(r.items[0].targetY, 4.255);
});
test("manual partitions and other wall metadata remain unchanged; repeated multi-level wall binding is explicit unknown", () => {
  const f = fixture();
  delete f.p.walls[0].topAttachment;
  const r = run(f);
  assert.deepEqual(r.walls, f.p.walls);
  assert.equal(r.items.length, 0);
  f.p.walls[0].topAttachment = { target: "roofTieUnderside", mode: "sliding", gap: 0.02 };
  delete f.p.walls[0].level;
  f.levels.push({ ...structuredClone(f.levels[0]), index: 2 });
  assert.equal(run(f).items[0].status, "pending");
});

test("physical ties outside the zone or too short to reach the wall do not create a fictitious reference plane", () => {
  const f = fixture();
  for (const b of f.roofModel.instances) {
    b.start[0] += 100;
    b.end[0] += 100;
  }
  assert.equal(run(f).items[0].status, "pending");
  const g = fixture();
  for (const b of g.roofModel.instances) {
    delete b.shape;
    b.start[2] = 2;
    b.end[2] = 4;
  }
  assert.equal(run(g).items[0].status, "pending");
  const h = fixture();
  h.roofModel.instances = h.roofModel.instances.slice(0, 1);
  assert.equal(run(h).items[0].status, "pending");
});

test("target above the assigned storey cannot silently create another-storey wall", () => {
  const f = fixture();
  for (const b of f.roofModel.instances) {
    b.start[1] += 2;
    b.end[1] += 2;
  }
  const r = run(f);
  assert.equal(r.items[0].status, "fail");
  near(r.walls[0].height, 2.75);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildFloorOpenings } from "./floor-openings.js";
const near = (a, b, t = 1e-7) => assert.ok(Math.abs(a - b) < t, `${a} ≠ ${b}`);
const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
function fixture() {
  const polygon = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 4 },
      { x: 8, y: 4 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ],
    walls = polygon
      .map((a, i) => ({
        id: `wall-${i}`,
        a,
        b: polygon[(i + 1) % polygon.length],
        level: 1,
        kind: "exterior",
        section: "48x198",
      }))
      .concat([
        { id: "bearing", a: { x: 0, y: 4 }, b: { x: 8, y: 4 }, level: 1, kind: "bearing", section: "48x198" },
      ]);
  const p = {
      walls,
      floor: { axis: "y", section: "48x248", spacing: 0.6 },
      material: { density: 420, E: 11000, Fb: 14.77, Fv: 2.46 },
      loads: { floorDead: 0.6, live: 2, gammaG: 1.35, gammaQ: 1.5 },
      voids: [
        {
          id: "double-light",
          level: 2,
          kind: "doubleHeight",
          edgeSection: "75x248",
          polygon: rect(1, 1, 4.2, 4),
        },
      ],
    },
    base = {
      geometry: {
        levels: [
          { index: 1, closed: true, topY: 4.1, polygon },
          { index: 2, closed: true, baseY: 4.1, polygon },
        ],
      },
      walls,
    };
  return { p, base };
}
function body(b) {
  return {
    x0: Math.min(b.start[0], b.end[0]) - (Math.abs(b.crossAxis[0]) * b.b) / 2000,
    x1: Math.max(b.start[0], b.end[0]) + (Math.abs(b.crossAxis[0]) * b.b) / 2000,
    z0: Math.min(b.start[2], b.end[2]) - (Math.abs(b.crossAxis[2]) * b.b) / 2000,
    z1: Math.max(b.start[2], b.end[2]) + (Math.abs(b.crossAxis[2]) * b.b) / 2000,
  };
}
function finiteTree(x) {
  if (typeof x === "number") assert.ok(Number.isFinite(x));
  else if (Array.isArray(x)) x.forEach(finiteTree);
  else if (x && typeof x === "object") Object.values(x).forEach(finiteTree);
}

test("second-light trimmers extend to actual lower-floor walls, not merely the opening length", () => {
  const { p, base } = fixture(),
    r = buildFloorOpenings(p, base),
    o = r.openings[0];
  assert.equal(o.generated, true);
  assert.equal(o.replaceLegacy, true);
  assert.equal(r.instances.length, 4);
  for (const t of o.trimmers) {
    near(t.start[2], 0);
    near(t.end[2], 4);
    near(t.length, 4);
    near(t.analyticalSpan, 4);
    near(t.clearSpan, 4 - 0.198);
    assert.deepEqual(
      t.supports.map((s) => s.wallLevel),
      [1, 1],
    );
    assert.equal(t.supports[1].wallId, "bearing");
    assert.equal(t.requireSingleStock, true);
  }
  assert.ok(o.trimmers.every((t) => t.length > 3));
  assert.equal(r.status, "unverified");
});

test("headers meet trimmer faces and all four on-edge boards have non-overlapping volumes", () => {
  const { p, base } = fixture(),
    r = buildFloorOpenings(p, base),
    o = r.openings[0];
  for (const h of o.headers) {
    near(h.start[0], 1 + 0.075 / 2);
    near(h.end[0], 4.2 - 0.075 / 2);
    near(h.length, 3.2 - 0.075);
    near(h.clearSpan, h.length);
  }
  for (const b of r.instances) {
    near(b.start[1] + b.h / 2000, 4.1 + 0.248);
    near(b.end[1] - b.h / 2000, 4.1);
    assert.equal(b.category, "floor");
    assert.ok(["openingTrimmer", "openingHeader"].includes(b.role));
    near(b.volume, (b.b * b.h * b.length) / 1e6);
    near(b.mass, b.volume * 420);
  }
  for (let i = 0; i < r.instances.length; i++)
    for (let j = 0; j < i; j++) {
      const a = body(r.instances[i]),
        b = body(r.instances[j]);
      assert.ok(
        Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 1e-8 ||
          Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= 1e-8,
      );
    }
});

test("a header above the y4 bearing wall routes directly to that wall, not twice into the trimmers", () => {
  const { p, base } = fixture(),
    o = buildFloorOpenings(p, base).openings[0],
    onWall = o.headers.find((h) => h.supportMode === "continuousWall"),
    unsupported = o.headers.find((h) => h.supportMode === "trimmerFaces");
  assert.ok(onWall);
  assert.equal(onWall.supports[0].wallId, "bearing");
  assert.ok(onWall.directWallReaction.design > 0);
  assert.equal(onWall.check, undefined);
  for (const t of o.trimmers) {
    assert.equal(t.loads.headerReactions.length, 1);
    assert.equal(t.loads.headerReactions[0].sourceHeaderId, unsupported.id);
    near(t.loads.headerReactions[0].at, 1);
  }
  near(
    o.trimmers[0].loads.headerReactions[0].design + o.trimmers[1].loads.headerReactions[0].design,
    unsupported.loads.designLineLoad * unsupported.length,
  );
});

test("adjacent collinear bearing wall panels form one continuous support line", () => {
  const { p, base } = fixture();
  p.walls = p.walls
    .filter((w) => w.id !== "bearing")
    .concat([
      {
        id: "bearing-left",
        level: 1,
        kind: "bearing",
        section: "48x198",
        a: { x: 0, y: 4 },
        b: { x: 4, y: 4 },
      },
      {
        id: "bearing-right",
        level: 1,
        kind: "bearing",
        section: "48x198",
        a: { x: 4, y: 4 },
        b: { x: 8, y: 4 },
      },
    ]);
  base.walls = p.walls;
  const o = buildFloorOpenings(p, base).openings[0],
    h = o.headers.find((h) => h.supportMode === "continuousWall");
  assert.ok(h);
  assert.deepEqual(h.directWallReaction.wallIds, ["bearing-left", "bearing-right"]);
  near(
    h.directWallReaction.segments.reduce((s, q) => s + q.design, 0),
    h.directWallReaction.design,
  );
  assert.ok(o.trimmers.every((t) => t.loads.headerReactions.length === 1));
});

test("support above a lower door/window is explicitly unknown, without inventing failure or a verified header", () => {
  const { p, base } = fixture();
  p.openings = [
    {
      id: "lower-door",
      wallId: "bearing",
      floor: 1,
      offset: 0.6,
      width: 0.9,
      height: 2.1,
      type: "door",
      sill: 0,
    },
    {
      id: "lower-window",
      wallId: "wall-0",
      floor: 1,
      offset: 3.9,
      width: 0.6,
      height: 1.2,
      type: "window",
      sill: 0.8,
    },
  ];
  const r = buildFloorOpenings(p, base),
    o = r.openings[0];
  assert.equal(r.status, "unverified");
  assert.deepEqual(o.trimmers[0].sourceWallOpeningIds, ["lower-door"]);
  assert.deepEqual(o.trimmers[1].sourceWallOpeningIds, ["lower-window"]);
  assert.ok(r.checks.some((c) => c.id.includes("bearing-over-opening") && c.status === "unverified"));
  assert.ok(
    o.headers.find((h) => h.supportMode === "continuousWall").sourceWallOpeningIds.includes("lower-door"),
  );
  assert.ok(!r.checks.some((c) => c.status === "fail"));
});

test("private mechanics include header point reactions and actual timber self-weight", () => {
  const { p, base } = fixture(),
    o = buildFloorOpenings(p, base).openings[0],
    t = o.trimmers[0],
    h = o.headers[0];
  near(t.check.utilization, 0.779556831709476, 1e-8);
  near(h.check.utilization, 0.4747039756407379, 1e-8);
  near(h.check.reactionStart, 6.899644404864374, 1e-8);
  near(t.loads.ownWeightLine, (0.075 * 0.248 * 420 * 9.80665) / 1000);
  near(t.check.designTotal, t.loads.designLineLoad * t.analyticalSpan + t.loads.headerReactions[0].design);
  near(t.check.reactionStart + t.check.reactionEnd, t.check.designTotal);
  assert.ok(t.check.partial);
  assert.ok(o.checks.some((c) => c.id.endsWith("connections") && c.status === "unverified"));
});

test("the two polar axes swap consistently for joists along x", () => {
  const { p, base } = fixture(),
    swap = (q) => ({ x: q.y, y: q.x });
  p.floor.axis = "x";
  for (const w of p.walls) {
    w.a = swap(w.a);
    w.b = swap(w.b);
  }
  p.voids[0].polygon = p.voids[0].polygon.map(swap);
  for (const l of base.geometry.levels) l.polygon = l.polygon.map(swap);
  const o = buildFloorOpenings(p, base).openings[0];
  for (const t of o.trimmers) {
    near(t.start[0], 0);
    near(t.end[0], 4);
    near(t.check.utilization, 0.779556831709476, 1e-8);
    near(t.crossAxis[0], 0);
    near(t.crossAxis[1], 0);
    near(t.crossAxis[2], 1);
  }
  assert.ok(o.headers.some((h) => h.supportMode === "continuousWall"));
});

test("an upper bearing wall or lower partition cannot secretly shorten the span", () => {
  const { p, base } = fixture(),
    bearing = p.walls.find((w) => w.id === "bearing");
  bearing.level = 2;
  const r = buildFloorOpenings(p, base),
    o = r.openings[0];
  assert.ok(o.trimmers.every((t) => t.length === 8));
  assert.ok(o.trimmers.every((t) => t.supports.every((s) => s.wallId !== "bearing")));
  assert.equal(r.status, "fail");
  assert.ok(r.checks.some((c) => c.id.includes("stock") && c.status === "fail"));
  bearing.level = 1;
  bearing.kind = "partition";
  assert.ok(buildFloorOpenings(p, base).openings[0].trimmers.every((t) => t.length === 8));
});

test("missing lower exterior/bearing support produces a failure rather than invented posts", () => {
  const { p, base } = fixture();
  base.walls = p.walls.filter((w) => w.kind === "bearing");
  const r = buildFloorOpenings(p, base);
  assert.equal(r.instances.length, 0);
  assert.equal(r.openings[0].replaceLegacy, false);
  assert.equal(r.status, "fail");
  assert.ok(r.checks.some((c) => c.id.endsWith("supports") && c.status === "fail"));
});

test("arbitrary polygons are left for a separate support model, not fabricated rectangular framing", () => {
  const { p, base } = fixture();
  p.voids[0].polygon = [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 3, y: 3 },
  ];
  const r = buildFloorOpenings(p, base);
  assert.equal(r.instances.length, 0);
  assert.equal(r.openings[0].shape, "unsupported");
  assert.equal(r.openings[0].replaceLegacy, false);
  assert.equal(r.status, "unverified");
});

test("the separate stair opening gets supported framing without using stair-step metadata as a load", () => {
  const { p, base } = fixture();
  p.voids.push({
    id: "stair",
    level: 2,
    kind: "stair",
    edgeSection: "75x248",
    polygon: rect(5, 0.5, 7.2, 3.7),
    risers: 18,
    treads: 0.275,
  });
  const a = buildFloorOpenings(p, base);
  p.voids[1].risers = 999;
  const b = buildFloorOpenings(p, base);
  assert.equal(a.instances.length, 8);
  assert.deepEqual(a, b);
  assert.ok(a.openings.every((o) => o.generated));
  assert.ok(a.instances.every((b) => b.length <= 6));
  assert.ok(!a.checks.some((c) => c.status === "fail"));
});

test("deeper timber keeps the top datum and explicitly leaves bearing-seat details unverified", () => {
  const { p, base } = fixture();
  p.voids[0].edgeSection = "75x298";
  const r = buildFloorOpenings(p, base);
  for (const b of r.instances) near(b.start[1] + b.h / 2000, 4.348);
  assert.ok(r.checks.some((c) => c.id.endsWith("bearing-seat") && c.status === "unverified"));
});

test("input is not mutated and missing mechanical values yield geometry with unverified checks, never NaN", () => {
  const { p, base } = fixture(),
    before = JSON.stringify({ p, base });
  buildFloorOpenings(p, base);
  assert.equal(JSON.stringify({ p, base }), before);
  delete p.material.E;
  p.loads.live = NaN;
  const r = buildFloorOpenings(p, base);
  assert.equal(r.instances.length, 4);
  assert.ok(r.instances.every((b) => b.loads === null));
  finiteTree(r);
  assert.ok(r.checks.some((c) => c.id.endsWith("material") && c.status === "unverified"));
});

test("a four-board opening package contains sixteen physical standard boards and no overlapping or phantom solid members", () => {
  const { p, base } = fixture();
  p.voids[0].edgeSection = "48x248";
  p.voids[0].edgePlies = 4;
  const r = buildFloorOpenings(p, base),
    o = r.openings[0];
  assert.equal(r.instances.length, 16);
  assert.equal(o.frameWidth, 192);
  assert.equal(o.plies, 4);
  assert.ok(
    r.instances.every((b) => b.b === 48 && b.h === 248 && !b.analysisOnly && b.packageId && b.plyCount === 4),
  );
  const logical = [...o.trimmers, ...o.headers];
  assert.ok(logical.every((b) => b.analysisOnly && b.memberIds.length === 4));
  near(
    r.instances.reduce((s, b) => s + b.mass, 0),
    logical.reduce((s, b) => s + b.mass, 0),
  );
  for (const b of logical) {
    const pieces = r.instances.filter((p) => p.packageId === b.id);
    near(
      pieces.reduce((s, p) => s + p.volume, 0),
      b.volume,
    );
    assert.deepEqual(
      pieces.map((p) => p.plyIndex),
      [0, 1, 2, 3],
    );
  }
  for (let i = 0; i < r.instances.length; i++)
    for (let j = 0; j < i; j++) {
      const a = body(r.instances[i]),
        b = body(r.instances[j]);
      assert.ok(
        Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 1e-8 ||
          Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= 1e-8,
      );
    }
  near(o.headers[0].length, 3.2 - 0.192);
  assert.ok(r.checks.some((c) => c.id.endsWith("package-connections") && c.status === "unverified"));
});

test("parallel package stiffness uses the total physical width with explicit equal-sharing assumption", () => {
  const { p, base } = fixture();
  p.voids[0].edgeSection = "48x248";
  p.voids[0].edgePlies = 4;
  const packet = buildFloorOpenings(p, base);
  p.voids[0].edgeSection = "192x248";
  delete p.voids[0].edgePlies;
  const equivalent = buildFloorOpenings(p, base);
  for (let i = 0; i < 2; i++) {
    near(
      packet.openings[0].trimmers[i].check.utilization,
      equivalent.openings[0].trimmers[i].check.utilization,
    );
    near(
      packet.openings[0].headers[i].check?.utilization ?? 0,
      equivalent.openings[0].headers[i].check?.utilization ?? 0,
    );
  }
  assert.ok(packet.instances.every((b) => b.equalLoadSharingVerified === false));
});

test("invalid ply counts and unsupported polygon packages cannot fall back to a fake single contour board", () => {
  const { p, base } = fixture();
  for (const n of [0, 1.5, 7, null]) {
    p.voids[0].edgePlies = n;
    const r = buildFloorOpenings(p, base);
    assert.equal(r.instances.length, 0);
    assert.ok(r.checks.some((c) => c.id.endsWith("plies") && c.status === "fail"));
  }
  p.voids[0].edgePlies = 4;
  p.voids[0].polygon = [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 3, y: 3 },
  ];
  const r = buildFloorOpenings(p, base);
  assert.equal(r.instances.length, 0);
  assert.equal(r.openings[0].replaceLegacy, true);
  assert.equal(r.status, "fail");
});

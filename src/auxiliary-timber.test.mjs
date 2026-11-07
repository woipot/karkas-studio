import test from "node:test";
import assert from "node:assert/strict";
import { buildAuxiliaryTimber, AuxiliaryTimberInputError } from "./auxiliary-timber.js";
import { defaultDesignerProject } from "./designer-engine.js";
import { calculateCutting } from "./cutting.js";
import { cutGeometry } from "./board-geometry.js";
const near = (a, b, t = 1e-6) =>
    assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < t, `${a} ≠ ${b}`),
  clone = (x) => JSON.parse(JSON.stringify(x));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  sub = (a, b) => a.map((v, i) => v - b[i]),
  move = (a, d, t) => a.map((v, i) => v + d[i] * t);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit = (a) => a.map((v) => v / Math.hypot(...a));
function worldVertices(b) {
  const axis = unit(sub(b.end, b.start)),
    w = b.crossAxis,
    x = unit(w.map((v, i) => v - dot(w, axis) * axis[i])),
    z = cross(x, axis),
    mid = b.start.map((v, i) => (v + b.end[i]) / 2),
    g = cutGeometry(b),
    p = g.getAttribute("position"),
    out = [];
  for (let i = 0; i < p.count; i++)
    out.push(mid.map((v, j) => v + x[j] * p.getX(i) + axis[j] * p.getY(i) + z[j] * p.getZ(i)));
  g.dispose();
  return out;
}
function sectionAtZ(vertices, z) {
  const values = vertices.map((p) => ({ x: p[2], y: p[1] })).sort((a, b) => a.x - b.x || a.y - b.y),
    turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
    lower = [],
    upper = [];
  for (const p of values) {
    while (lower.length > 1 && turn(lower.at(-2), lower.at(-1), p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  for (const p of values.slice().reverse()) {
    while (upper.length > 1 && turn(upper.at(-2), upper.at(-1), p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  const polygon = lower.slice(0, -1).concat(upper.slice(0, -1)),
    hits = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (z >= Math.min(a.x, b.x) - 1e-8 && z <= Math.max(a.x, b.x) + 1e-8 && Math.abs(b.x - a.x) > 1e-10)
      hits.push(a.y + ((b.y - a.y) * (z - a.x)) / (b.x - a.x));
  }
  return [Math.min(...hits), Math.max(...hits)];
}
function fixture({ width = 12, span = 4, pitch = 25, angle = 0, count = Math.ceil(width / 0.6) } = {}) {
  const p = clone(defaultDesignerProject);
  p.walls = [];
  p.openings = [];
  p.auxiliaryTimber = { enabled: true };
  p.bracing = { ...p.bracing, sheetSide: "interior" };
  const alpha = (angle * Math.PI) / 180,
    theta = (pitch * Math.PI) / 180,
    c = [Math.cos(alpha), 0, Math.sin(alpha)],
    d = [-Math.sin(alpha) * Math.cos(theta), Math.sin(theta), Math.cos(alpha) * Math.cos(theta)],
    normal = [Math.sin(alpha) * Math.sin(theta), Math.cos(theta), -Math.cos(alpha) * Math.sin(theta)],
    length = span / Math.cos(theta),
    point = (u, v) => ({ x: c[0] * u - Math.sin(alpha) * v, y: c[2] * u + Math.cos(alpha) * v }),
    polygon = [point(0, 0), point(width, 0), point(width, span), point(0, span)];
  const rafters = Array.from({ length: count + 1 }, (_, i) => {
    const u = 0.025 + ((width - 0.05) * i) / count,
      start = [c[0] * u, 3, c[2] * u];
    return {
      id: "R" + i,
      zoneId: "z",
      role: "rafter",
      category: "roof",
      b: 50,
      h: 200,
      start,
      end: move(start, d, length),
      length,
      crossAxis: c,
      cutStart: { scheme: "butt", angle: 0 },
      cutEnd: { scheme: "butt", angle: 0 },
      level: 1,
    };
  });
  const roofModel = {
    zones: [
      {
        id: "z",
        name: "Проверочный скат",
        shape: "mono",
        effectiveFraming: "rafters",
        levelIndex: 1,
        polygon,
        surfaceArea: width * length,
      },
    ],
    instances: rafters,
  };
  return {
    p,
    result: {
      geometry: { polygon, levels: [{ index: 1, polygon, wallBaseY: 1.005 }] },
      walls: [],
      timber: { instances: [] },
      roofModel,
    },
    rafters,
    c,
    d,
    normal,
    length,
  };
}
function withWall() {
  const x = fixture();
  const w = {
    id: "w",
    level: 1,
    kind: "exterior",
    a: { x: 0, y: 0 },
    b: { x: 12, y: 0 },
    section: "50x150",
    studStep: 0.6,
  };
  x.p.walls = [w];
  x.result.walls = [w];
  x.p.openings = [
    { id: "win", wallId: "w", floor: 1, offset: 2, width: 1, sill: 1, height: 1, type: "window" },
  ];
  const board = (id, role, s, a = 1.055, b = 5.52) => ({
    id,
    wallId: "w",
    level: 1,
    role,
    b: 50,
    h: 150,
    start: [s, a, 0],
    end: [s, b, 0],
    crossAxis: [1, 0, 0],
    cutStart: { scheme: "butt", angle: 0 },
    cutEnd: { scheme: "butt", angle: 0 },
  });
  x.result.timber.instances = [
    board("main", "stud", 2.5),
    board("overlap", "king", 2.5, 1.5, 4),
    board("jamb", "king", 1),
    board("corner", "corner", 0.1),
  ];
  x.result.geometry.wallProfiles = [
    {
      wallId: "w",
      level: 1,
      mode: "continuous",
      section: "50x150",
      baseY: 1.005,
      topSamples: [
        { s: 0, topY: 5.67 },
        { s: 12, topY: 5.67 },
      ],
    },
  ];
  return x;
}

test("auxiliary timber is opt-in and disabled input emits no invented material or pressure", () => {
  const x = fixture();
  delete x.p.auxiliaryTimber;
  const r = buildAuxiliaryTimber(x.p, x.result);
  assert.equal(r.enabled, false);
  assert.deepEqual(r.instances, []);
  assert.deepEqual(r.roofExtraDeadByZone, {});
  assert.equal(r.quantities.mass, 0);
});
test("wall service rails follow full-height actual framing, deduplicate overlaps and leave the window clear", () => {
  const { p, result } = withWall(),
    r = buildAuxiliaryTimber(p, result),
    rails = r.instances.filter((b) => b.role === "wallServiceBatten");
  assert.equal(rails.length, 3);
  assert.equal(rails.filter((b) => Math.abs(b.start[0] - 2.5) < 1e-6).length, 2);
  assert.equal(
    rails.some((b) => b.sourceMemberIds.includes("corner")),
    false,
  );
  assert.ok(rails.some((b) => b.length > 4.4));
  for (const b of rails) {
    const crossesX = b.start[0] + b.b / 2000 > 2 && b.start[0] - b.b / 2000 < 3;
    if (crossesX) assert.ok(b.end[1] <= 2.005 + 1e-7 || b.start[1] >= 3.005 - 1e-7);
    assert.equal(b.requireSingleStock, true);
  }
  const clipped = rails.filter((b) => b.sourceMemberIds.includes("main"));
  assert.ok(clipped.every((b) => b.sourceMemberIds.includes("overlap")));
  near(
    clipped.reduce((s, b) => s + b.length, 0),
    5.52 - 1.055 - 1,
  );
});
test("the warm wall-service face starts exactly beyond interior OSB, independent of outline winding", () => {
  const x = withWall(),
    r = buildAuxiliaryTimber(x.p, x.result),
    rail = r.instances.find((b) => b.role === "wallServiceBatten");
  near(rail.start[2] - 0.045 / 2, 0.15 / 2 + 0.012);
  near(rail.end[2], rail.start[2]);
  x.result.geometry.levels[0].polygon.reverse();
  const reversed = buildAuxiliaryTimber(x.p, x.result).instances.find((b) => b.role === "wallServiceBatten");
  near(reversed.start[2], rail.start[2]);
  x.p.bracing.sheetSide = "exterior";
  const outsideOSB = buildAuxiliaryTimber(x.p, x.result).instances.find(
    (b) => b.role === "wallServiceBatten",
  );
  near(outsideOSB.start[2] - 0.045 / 2, 0.15 / 2);
});
test("counterbattens and warm service rails follow the true slope with the correct four layer-contact planes", () => {
  const x = fixture(),
    r = buildAuxiliaryTimber(x.p, x.result),
    first = x.rafters[0];
  const counter = r.instances.find(
      (b) => b.role === "roofCounterBatten" && b.sourceMemberIds.includes(first.id),
    ),
    service = r.instances.find((b) => b.role === "roofServiceBatten" && b.sourceMemberIds.includes(first.id));
  near(counter.length, 4 / Math.cos((25 * Math.PI) / 180));
  near(service.length, counter.length);
  near(dot(sub(counter.start, first.start), x.normal) - counter.h / 2000, 0.1);
  near(dot(sub(service.start, first.start), x.normal) + service.h / 2000, -0.1 - 0.148);
  const batten = r.instances.find((b) => b.role === "roofBatten"),
    internal = r.instances.find((b) => b.role === "roofInternalBatten");
  near(batten.normalOffset - batten.b / 2000, 0.1 + 0.05);
  near(internal.normalOffset + internal.h / 2000, -0.1);
  near(dot(batten.crossAxis, x.normal), 1);
  near(dot(internal.crossAxis, x.d), 1);
});
test("a 75mm continuous above-rafter layer moves only cold-side timber by the true roof normal", () => {
  const x = fixture(),
    base = buildAuxiliaryTimber(x.p, x.result);
  x.p.auxiliaryTimber.roofAboveRafterGap = 0.075;
  const elevated = buildAuxiliaryTimber(x.p, x.result),
    original = new Map(base.instances.map((b) => [b.id, b]));
  for (const b of elevated.instances) {
    const a = original.get(b.id),
      cold = ["roofCounterBatten", "roofBatten"].includes(b.role),
      shift = cold ? 0.075 : 0;
    for (const endpoint of ["start", "end"])
      for (let i = 0; i < 3; i++) near(b[endpoint][i] - a[endpoint][i], x.normal[i] * shift);
    near(b.mass, a.mass);
    near(b.cutLength, a.cutLength);
  }
  const counter = elevated.instances.find((b) => b.role === "roofCounterBatten"),
    batten = elevated.instances.find((b) => b.role === "roofBatten");
  near(counter.normalOffset - counter.h / 2000, 0.1 + 0.075);
  near(batten.normalOffset - batten.b / 2000, 0.1 + 0.075 + 0.05);
  near(elevated.roofExtraDeadByZone.z, base.roofExtraDeadByZone.z);
  assert.ok(
    elevated.checks.some((c) => c.id === "auxiliary-counter-through-insulation" && c.status === "unverified"),
  );
  for (const gap of [-0.001, 0.301, NaN, Infinity]) {
    x.p.auxiliaryTimber.roofAboveRafterGap = gap;
    assert.throws(() => buildAuxiliaryTimber(x.p, x.result), AuxiliaryTimberInputError);
  }
});
test("opposed ridge auxiliary meshes share a plumb plane without warm-rail or transverse-section overlap", () => {
  const x = fixture({ width: 12, count: 24 }),
    south = fixture({ width: 8, count: 16 }),
    z = south.result.roofModel.zones[0];
  z.id = "south";
  z.polygon = z.polygon.map((p) => ({ x: p.x, y: p.y + 4 }));
  for (const [i, b] of south.rafters.entries()) {
    b.id = "S" + i;
    b.zoneId = "south";
    b.start = [b.start[0], 3, 8];
    b.end = [b.end[0], 3 + 4 * Math.tan((25 * Math.PI) / 180), 4];
    b.crossAxis = [-1, 0, 0];
  }
  x.result.roofModel.zones.push(z);
  x.result.roofModel.instances.push(...south.rafters);
  x.p.auxiliaryTimber.roofAboveRafterGap = 0.075;
  const old = buildAuxiliaryTimber(x.p, x.result),
    northService = old.instances.find(
      (b) => b.role === "roofServiceBatten" && b.sourceMemberIds.includes("R0"),
    ),
    southService = old.instances.find(
      (b) => b.role === "roofServiceBatten" && b.sourceMemberIds.includes("S0"),
    );
  const crossing = (b) => {
    const t = (4 - b.start[2]) / (b.end[2] - b.start[2]);
    assert.ok(t > 0 && t < 1);
    return b.start[1] + t * (b.end[1] - b.start[1]);
  };
  near(crossing(northService), crossing(southService));
  const internal = (id) =>
      old.instances
        .filter((b) => b.zoneId === id && b.role === "roofInternalBatten")
        .sort((a, b) => b.slopeStation - a.slopeStation)[0],
    a = sectionAtZ(worldVertices(internal("z")), 4),
    b = sectionAtZ(worldVertices(internal("south")), 4);
  assert.ok(
    Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1e-5,
    "Original last transverse rows have positive intersecting section height",
  );
  for (const rafter of x.result.roofModel.instances) {
    if (rafter.zoneId === "z" && rafter.end[0] > 8) continue;
    const d = unit(sub(rafter.end, rafter.start)),
      N = unit([d[0], 0, d[2]]),
      depth = cross(rafter.crossAxis, d),
      ratio = dot(depth, N) / dot(d, N);
    rafter.rafterJointId = "ridge";
    rafter.endCutPlane = { point: [...rafter.end], normal: N };
    rafter.cutEnd = {
      scheme: "miter",
      angle: Math.abs((Math.atan(ratio) * 180) / Math.PI),
      tiltSign: Math.sign(ratio),
      plane: "depth",
      cutWidthMM: rafter.h,
    };
  }
  const fixed = buildAuxiliaryTimber(x.p, x.result);
  let trimmed = 0;
  for (const board of fixed.instances) {
    const parallel = ["roofCounterBatten", "roofServiceBatten"].includes(board.role);
    if (parallel && !board.rafterJointId) continue;
    if (!parallel && !["roofInternalBatten", "roofBatten"].includes(board.role)) continue;
    const sign = board.zoneId === "z" ? 1 : -1;
    for (const v of worldVertices(board))
      assert.ok(sign * (v[2] - 4) < 1e-6, `${board.id} crosses the shared ridge plane`);
    if (parallel) {
      trimmed++;
      near(board.end[2], 4);
      assert.equal(board.cutEnd.scheme, "miter");
      assert.equal(board.cutEnd.plane, "depth");
      assert.equal(board.cutEnd.cutWidthMM, board.h);
      assert.ok(board.cutLength > board.length);
    }
  }
  assert.ok(trimmed > 50);
  assert.ok(fixed.instances.every((b) => b.cutLength <= 6 + 1e-7));
  assert.equal(calculateCutting(x.p, { timber: { instances: fixed.instances } }).overlength.length, 0);
  near(
    fixed.quantities.mass,
    fixed.instances.reduce((s, b) => s + b.mass, 0),
  );
});
test("transverse boards form continuous rows with every stock joint on an actual rafter, never at an arbitrary six-metre station", () => {
  const x = fixture(),
    r = buildAuxiliaryTimber(x.p, x.result),
    map = new Map(x.rafters.map((b) => [b.id, b]));
  for (const role of ["roofBatten", "roofInternalBatten"]) {
    const rows = Map.groupBy(
      r.instances.filter((b) => b.role === role),
      (b) => b.slopeStation,
    );
    assert.ok(rows.size > 5);
    for (const parts of rows.values()) {
      assert.equal(parts.length, 2);
      for (const b of parts) {
        assert.ok(b.cutLength <= 6 + 1e-7);
        assert.equal(b.requireSingleStock, true);
        for (const [point, id] of [
          [b.start, b.startSupportRafterId],
          [b.end, b.endSupportRafterId],
        ]) {
          const source = map.get(id);
          assert.ok(source);
          near(dot(sub(point, source.start), x.c), 0);
          near(dot(sub(point, source.start), x.d), b.slopeStation);
          near(dot(sub(point, source.start), x.normal), b.normalOffset);
        }
      }
      near(Math.hypot(...sub(parts[0].end, parts[1].start)), 0);
      near(
        parts.reduce((s, b) => s + b.length, 0),
        11.95,
      );
      assert.equal(parts[0].supportedSpliceEnd, true);
      assert.equal(parts[1].supportedSpliceStart, true);
    }
  }
});
test("row pitches stay within the requested spacing measured on the sloped plane, with board widths inside its ends", () => {
  const x = fixture(),
    r = buildAuxiliaryTimber(x.p, x.result);
  for (const [role, step, width] of [
    ["roofBatten", 0.35, 0.1],
    ["roofInternalBatten", 0.6, 0.048],
  ]) {
    const stations = [...new Set(r.instances.filter((b) => b.role === role).map((b) => b.slopeStation))].sort(
      (a, b) => a - b,
    );
    near(stations[0], width / 2);
    near(stations.at(-1), x.length - width / 2);
    for (let i = 1; i < stations.length; i++) assert.ok(stations[i] - stations[i - 1] <= step + 1e-7);
  }
});
test("azimuth rotation preserves dimensions, stock support, mass and outward/inward placement", () => {
  const a = fixture(),
    b = fixture({ angle: 90 }),
    ra = buildAuxiliaryTimber(a.p, a.result),
    rb = buildAuxiliaryTimber(b.p, b.result);
  near(ra.quantities.volume, rb.quantities.volume);
  near(ra.quantities.mass, rb.quantities.mass);
  assert.equal(ra.instances.length, rb.instances.length);
  for (const board of rb.instances.filter((b) => b.role === "roofCounterBatten")) {
    const source = b.rafters.find((q) => q.id === board.sourceMemberIds[0]);
    near(dot(sub(board.start, source.start), b.normal), 0.125);
    near(board.length, b.length);
  }
});
test("all new physical boards have exact geometry/mass and enter one complete six-metre stock map", () => {
  const x = withWall(),
    r = buildAuxiliaryTimber(x.p, x.result);
  for (const b of r.instances) {
    near(b.length, Math.hypot(...sub(b.end, b.start)));
    near(b.volume, (b.b * b.h * b.length) / 1e6);
    near(b.mass, b.volume * x.p.material.density);
    assert.ok(b.cutLength <= 6 + 1e-7);
  }
  near(
    r.quantities.mass,
    r.instances.reduce((s, b) => s + b.mass, 0),
  );
  near(
    r.quantities.volume,
    r.instances.reduce((s, b) => s + b.volume, 0),
  );
  const cutting = calculateCutting(x.p, { timber: { instances: r.instances } });
  assert.equal(cutting.summary.pieces, r.instances.length);
  assert.equal(cutting.overlength.length, 0);
  assert.equal(cutting.invalid.length, 0);
  assert.ok(cutting.stocks.every((b) => b.consumed <= 6 + 1e-7));
});
test("supplementary roof dead pressure contains every roof auxiliary board once and excludes wall service rails", () => {
  const x = withWall(),
    r = buildAuxiliaryTimber(x.p, x.result),
    roofMass = r.instances.filter((b) => b.category === "roof").reduce((s, b) => s + b.mass, 0);
  near(r.quantities.roofMassByZone.z, roofMass);
  near(r.roofExtraDeadByZone.z, (roofMass * 9.80665) / 1000 / x.result.roofModel.zones[0].surfaceArea);
  assert.ok(r.quantities.mass > roofMass);
  x.p.material.density *= 2;
  const doubled = buildAuxiliaryTimber(x.p, x.result);
  near(doubled.roofExtraDeadByZone.z, 2 * r.roofExtraDeadByZone.z);
  near(doubled.quantities.mass, 2 * r.quantities.mass);
});
test("a missing supporting rafter cannot be replaced by an invented unsupported stock splice", () => {
  const x = fixture({ width: 8, count: 1 }),
    r = buildAuxiliaryTimber(x.p, x.result),
    long = r.instances.filter((b) => ["roofBatten", "roofInternalBatten"].includes(b.role));
  assert.ok(long.length > 0);
  assert.ok(long.every((b) => b.length > 6 && b.requireSingleStock));
  assert.equal(r.checks.find((c) => c.id === "auxiliary-stock").status, "fail");
  assert.ok(calculateCutting(x.p, { timber: { instances: r.instances } }).overlength.length > 0);
  assert.ok(long.every((b) => b.supportRafterIds.join(",") === "R0,R1"));
});
test("trusses and clipped nonrectangular roofs remain explicit unknowns instead of receiving rectangular fictitious timber", () => {
  const x = fixture();
  x.result.roofModel.zones[0].effectiveFraming = "truss";
  const a = buildAuxiliaryTimber(x.p, x.result);
  assert.equal(a.instances.length, 0);
  assert.deepEqual(a.roofExtraDeadByZone, {});
  assert.ok(a.checks.some((c) => c.status === "unverified"));
  x.result.roofModel.zones[0].effectiveFraming = "rafters";
  x.result.roofModel.zones[0].polygon.splice(2, 1);
  const b = buildAuxiliaryTimber(x.p, x.result);
  assert.equal(b.instances.length, 0);
  assert.deepEqual(b.quantities.skippedRoofZoneIds, ["z"]);
});
test("invalid dimensions/spacing fail explicitly and stable IDs never depend on unrelated framing entries", () => {
  const x = withWall(),
    snapshot = JSON.stringify(x),
    a = buildAuxiliaryTimber(x.p, x.result),
    b = buildAuxiliaryTimber(x.p, x.result);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(x), snapshot);
  assert.equal(new Set(a.instances.map((b) => b.id)).size, a.instances.length);
  x.result.timber.instances.push({
    id: "ignored",
    role: "corner",
    wallId: "w",
    level: 1,
    start: [1, 1, 0],
    end: [1, 3, 0],
  });
  assert.deepEqual(
    buildAuxiliaryTimber(x.p, x.result).instances.map((b) => b.id),
    a.instances.map((b) => b.id),
  );
  for (const change of [
    (p) => (p.auxiliaryTimber = null),
    (p) => (p.auxiliaryTimber.enabled = "yes"),
    (p) => (p.auxiliaryTimber.roofCounter = "bad"),
    (p) => (p.auxiliaryTimber.roofBattenStep = 0),
    (p) => (p.material.density = Infinity),
  ]) {
    const y = fixture();
    change(y.p);
    assert.throws(() => buildAuxiliaryTimber(y.p, y.result), AuxiliaryTimberInputError);
  }
});

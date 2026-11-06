import test from "node:test";
import assert from "node:assert/strict";
import { calculate, validateProject } from "./engine.js";
import { GRAVITY } from "./members.js";
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("every board has geometric volume/mass and an orthogonal cross-section axis", () => {
  const { timber: t } = calculate();
  assert.equal(new Set(t.instances.map((x) => x.id)).size, t.boardCount);
  for (const b of t.instances) {
    const v = b.end.map((x, i) => x - b.start[i]);
    const length = Math.hypot(...v);
    near(b.length, length);
    near(b.volume, ((b.b * b.h) / 1e6) * length);
    near(b.mass, b.volume * 500);
    near(sum(v.map((x, i) => x * b.crossAxis[i])), 0);
    near(Math.hypot(...b.crossAxis), 1);
  }
  near(t.volume, sum(t.instances.map((x) => x.volume)));
  near(t.mass, sum(t.instances.map((x) => x.mass)));
  near(t.mass, sum(t.schedule.map((x) => x.mass)));
  near(t.volume, sum(t.schedule.map((x) => x.volume)));
  assert.equal(sum(t.schedule.map((x) => x.count)), t.boardCount);
});
test("doubling density doubles only timber mass; added load reaches piles exactly once", () => {
  const a = calculate({ timberDensity: 400 }),
    b = calculate({ timberDensity: 800 });
  near(b.timber.mass, a.timber.mass * 2);
  near(b.timber.volume, a.timber.volume);
  near(b.loads.dead - a.loads.dead, a.timber.weight);
  near(b.loads.totalDesign - a.loads.totalDesign, a.timber.weight * 1.1);
  near(b.foundation.reactionSum - a.foundation.reactionSum, a.timber.weight * 1.1);
  near(
    sum(b.loads.rows.filter((r) => r.id.startsWith("timber-")).map((r) => r.characteristic)),
    b.timber.weight,
  );
  near(b.timber.weight, (b.timber.mass * GRAVITY) / 1000);
});
test("cutting stock changes plate count, preserves installed mass, flags indivisible overlengths", () => {
  const a = calculate({ stockLength: 6 }),
    b = calculate({ stockLength: 2 });
  near(a.timber.mass, b.timber.mass);
  near(a.timber.volume, b.timber.volume);
  assert.ok(
    b.timber.instances.filter((x) => x.role === "plate").length >
      a.timber.instances.filter((x) => x.role === "plate").length,
  );
  assert.ok(b.timber.instances.filter((x) => x.role === "plate").every((x) => x.length <= 2 + 1e-8));
  assert.ok(b.timber.overStock.some((x) => x.role === "joist"));
  assert.ok(a.timber.overStock.every((x) => x.length > 6));
});
test("corner alternatives replace ordinary corner studs and use 2/3/4 separate boards", () => {
  const a = calculate({ cornerType: "california2" }),
    b = calculate({ cornerType: "three3" }),
    c = calculate({ cornerType: "closed4" });
  assert.equal(a.timber.instances.filter((x) => x.role === "corner").length, 8);
  assert.equal(b.timber.instances.filter((x) => x.role === "corner").length, 12);
  assert.equal(c.timber.instances.filter((x) => x.role === "corner").length, 16);
  const boardVolume = 0.045 * 0.15 * (2.8 - 3 * 0.045);
  near(b.timber.volume - a.timber.volume, 4 * boardVolume);
  near(c.timber.volume - b.timber.volume, 4 * boardVolume);
  const nw = c.timber.instances.filter((x) => x.role === "corner" && x.corner === "wn");
  const rectangles = nw.map((x) => ({
    x: x.start[0],
    z: x.start[2],
    dx: x.crossAxis[0] ? x.b / 1000 : x.h / 1000,
    dz: x.crossAxis[2] ? x.b / 1000 : x.h / 1000,
  }));
  for (let i = 0; i < rectangles.length; i++)
    for (let j = 0; j < i; j++) {
      const a = rectangles[i],
        b = rectangles[j];
      assert.ok(
        Math.abs(a.x - b.x) >= (a.dx + b.dx) / 2 - 1e-8 || Math.abs(a.z - b.z) >= (a.dz + b.dz) / 2 - 1e-8,
        "corner boards overlap",
      );
    }
});
test("X bracing is in clear full-height bays, on opposite wall faces, and absent when no bay fits", () => {
  const r = calculate();
  assert.equal(r.timber.bracingBays.length, 4);
  for (const b of r.timber.bracingBays) {
    assert.equal(b.available, true);
    near(b.length, Math.hypot(b.width, b.height));
    assert.ok(
      r.project.openings
        .filter((o) => o.wall === b.wall)
        .every((o) => b.end <= o.offset || b.start >= o.offset + o.width),
    );
    const pair = r.timber.instances.filter((x) => x.role === "brace" && x.wall === b.wall);
    assert.equal(pair.length, 2);
    const axis = ["north", "south"].includes(b.wall) ? 2 : 0;
    assert.ok(Math.abs(pair[0].start[axis] - pair[1].start[axis]) > r.project.wallThickness);
  }
  const missing = calculate({
    openings: [
      { id: "large", wall: "north", offset: 0.4, width: 11.2, height: 1.4, sill: 0.8, type: "window" },
    ],
  });
  assert.ok(missing.members.bracing.missing.some((x) => x.wall === "north"));
  assert.ok(!missing.timber.instances.some((x) => x.role === "brace" && x.wall === "north"));
  assert.notEqual(missing.members.bracing.status, "pass");
});
test("Euler critical force follows 1/(KL)^2, stress capacity is bounded by FcA", () => {
  const a = calculate({ columnK: 1, studRestraint: 1.4 }),
    b = calculate({ columnK: 2, studRestraint: 1.4 }),
    c = calculate({ columnK: 1, studRestraint: 0.7 });
  near(b.members.stud.eulerWeak, a.members.stud.eulerWeak / 4);
  near(c.members.stud.eulerWeak, a.members.stud.eulerWeak * 4);
  near(a.members.stud.eulerWeak, (Math.PI ** 2 * 10000 * ((150 * 45 ** 3) / 12)) / 1400 ** 2 / 1000);
  assert.ok(a.members.stud.capacity <= a.members.stud.crushing);
  const weak = calculate({ compressionDesign: 0.5 });
  assert.equal(weak.members.stud.status, "fail");
  near(weak.members.stud.capacity, (0.5 * 45 * 150) / 1000);
});
test("tension and elastic extension from wind double with pressure and halve with E", () => {
  const a = calculate({ wind: 0.25 }),
    b = calculate({ wind: 0.5 }),
    c = calculate({ wind: 0.25, E: 20000 });
  near(b.members.tension.force, 2 * a.members.tension.force);
  near(b.members.tension.stress, 2 * a.members.tension.stress);
  near(b.members.tension.extension, 2 * a.members.tension.extension);
  near(c.members.tension.extension, a.members.tension.extension / 2);
  const t = a.members.tension;
  near(t.stress, (t.force * 1000) / (25 * 100));
  near(t.extension, (t.force * 1000 * t.length * 1000) / (10000 * 25 * 100));
  near(t.force, t.shear / (t.width / t.length));
  assert.ok(a.members.bracing.compression.compressionUtilization > 1);
  assert.notEqual(a.members.bracing.status, "pass"); // tension-only X; compression is not credited.
});
test("maximum beam span solves the stated stress/deflection/shear checks, not LTB", () => {
  const a = calculate(),
    limit = a.joist.maxSpan,
    b = calculate({ joistSpan: limit }),
    c = calculate({ joistSpan: limit * 1.05 });
  near(b.joist.utilization, 1);
  assert.ok(c.joist.utilization > 1);
  assert.equal(b.members.lateral.status, "unverified");
  assert.notEqual(b.status, "pass");
});
test("local rafter failures are reflected in checks and aggregate result", () => {
  const r = calculate({ rafterH: 100, snow: 5 });
  assert.ok(r.members.rafter.utilization > 1);
  assert.equal(r.status, "fail");
  assert.ok(r.checks.some((x) => x.id === "rafterBending" && x.status === "fail"));
  assert.equal(r.members.rafter.length, 8 / (2 * Math.cos((25 * Math.PI) / 180)));
});
test("strict validation rejects bad density, corners, booleans, K and obstructed headers", () => {
  for (const p of [
    { timberDensity: NaN },
    { timberDensity: "500" },
    { timberDensity: 0 },
    { bracing: 1 },
    { columnK: 0 },
    { cornerType: "california" },
    { cornerType: "closed4", wallThickness: 0.07 },
    { braceB: 120, braceH: 100 },
    { studB: 100, wallThickness: 0.07 },
  ])
    assert.equal(validateProject(p).valid, false, JSON.stringify(p));
  const o = { id: "h", wall: "north", offset: 1, width: 2, height: 2.6, sill: 0, type: "door" };
  assert.equal(validateProject({ openings: [o] }).valid, false);
  assert.equal(
    validateProject({
      openings: [
        { ...o, height: 0.6, sill: 0.3 },
        { ...o, id: "upper", height: 0.6, sill: 1.5 },
      ],
    }).valid,
    false,
  );
});
test("two-storey timber and loads remain balanced; upper openings have dedicated framing", () => {
  const r = calculate({
    floors: 2,
    openings: [
      { id: "up", wall: "north", offset: 2, width: 2, height: 1.5, sill: 0.8, type: "window", floor: 2 },
    ],
  });
  near(r.loads.totalDesign, r.foundation.reactionSum);
  near(r.loads.totalCharacteristic, r.foundation.characteristicSum);
  assert.ok(r.timber.instances.some((x) => x.role === "header" && x.floor === 2));
  assert.equal(r.timber.instances.filter((x) => x.role === "corner").length, 16);
  assert.equal(r.timber.bracingBays.length, 8);
});
test("moving equal-mass framing changes local pile reactions without changing total load", () => {
  const o = { id: "move", wall: "north", offset: 1.2, width: 1.8, height: 1.5, sill: 0.8, type: "window" };
  const a = calculate({ wallDead: 0, openingDead: 0, bracing: false, openings: [o] });
  const b = calculate({ wallDead: 0, openingDead: 0, bracing: false, openings: [{ ...o, offset: 6 }] });
  near(a.timber.mass, b.timber.mass);
  near(a.loads.totalDesign, b.loads.totalDesign);
  assert.ok(a.piles.some((p, i) => Math.abs(p.reaction - b.piles[i].reaction) > 0.01));
  near(a.foundation.reactionSum, b.foundation.reactionSum);
});
test("storey pitch includes floor depth; upper floor starts above the lower wall module", () => {
  const r = calculate({ floors: 2 }),
    p = r.project,
    t = p.joistH / 1000 + 0.035,
    pitch = p.height + t;
  near(r.geometry.storeyPitch, pitch);
  near(r.geometry.facadeHeight, 2 * p.height + t);
  const lowerTop = Math.max(
    ...r.timber.instances
      .filter((x) => x.role === "plate" && x.floor === 1)
      .map((x) => x.start[1] + x.b / 2000),
  );
  const upperBottom = Math.min(
    ...r.timber.instances
      .filter((x) => x.category === "floor" && x.floor === 2)
      .map((x) => x.start[1] - x.h / 2000),
  );
  near(lowerTop, upperBottom);
  near(upperBottom, 0.72 + pitch);
  const roofEave = Math.min(
    ...r.timber.instances.filter((x) => x.role === "rafter").flatMap((x) => [x.start[1], x.end[1]]),
  );
  near(roofEave, 0.72 + 2 * pitch);
  near(r.geometry.eaveHeight, 2 * pitch);
  near(r.loads.windForceY, p.wind * p.length * (2 * p.height + t));
});
test("corner and adjacent-opening clearances reject colliding framing positions", () => {
  const o = { id: "near", wall: "north", offset: 0.1, width: 1, height: 1.5, sill: 0.8, type: "window" };
  assert.equal(validateProject({ openings: [o] }).valid, false);
  assert.equal(validateProject({ openings: [{ ...o, offset: 0.34 }] }).valid, true);
  assert.equal(validateProject({ openings: [{ ...o, wall: "west", offset: 0.24 }] }).valid, false);
  assert.equal(validateProject({ openings: [{ ...o, wall: "west", offset: 0.25 }] }).valid, true);
  const a = { ...o, offset: 1 },
    b = { ...o, id: "second", offset: 2.17 };
  assert.equal(validateProject({ openings: [a, b] }).valid, false);
  assert.equal(validateProject({ openings: [a, { ...b, offset: 2.18 }] }).valid, true);
});
test("joist cut lengths meet rim faces without overlapping perimeter boards", () => {
  for (const internalBearing of [true, false]) {
    const r = calculate({ internalBearing }),
      edge = r.project.joistB / 1000;
    const joists = r.timber.instances.filter((x) => x.role === "joist");
    for (const b of joists) {
      assert.ok(b.start[2] >= edge - 1e-8);
      assert.ok(b.end[2] <= r.project.width - edge + 1e-8);
      assert.ok(b.start[0] - b.b / 2000 >= -1e-8);
      assert.ok(b.start[0] + b.b / 2000 <= r.project.length + 1e-8);
    }
    near(sum(joists.map((x) => x.length)), 21 * (8 - 2 * edge));
  }
});

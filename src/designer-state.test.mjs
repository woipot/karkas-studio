import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDesignerState } from "./designer-state.js";
import { defaultDesignerProject, calculateDesigner, validateDesignerProject } from "./designer-engine.js";
import { calculateRoofZones } from "./roof-zones.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
test("UI state migration turns repeated two-storey walls into independent IDs and maps upper openings", () => {
  const old = clone(defaultDesignerProject);
  delete old.levels;
  old.floors = 2;
  old.openings.push({ ...old.openings[0], id: "upper-old", floor: 2 });
  const p = normalizeDesignerState(old);
  assert.equal(p.levels.length, 2);
  assert.equal(p.walls.length, 10);
  assert.equal(new Set(p.walls.map((w) => w.id)).size, 10);
  const upper = p.openings.find((o) => o.id === "upper-old");
  assert.equal(p.walls.find((w) => w.id === upper.wallId).level, 2);
  assert.equal(p.prices.pileEach, 6500);
  assert.ok(validateDesignerProject(p).valid);
  const r = calculateDesigner(p);
  assert.equal(r.geometry.totalFloorArea, 192);
});
test("normalizing explicit levels twice neither duplicates walls nor loses roof zones and manual cuts", () => {
  const p = normalizeDesignerState(defaultDesignerProject);
  p.roof.zones = [];
  p.boardCuts.M1 = { start: { scheme: "miter", angle: 45 } };
  const q = normalizeDesignerState(normalizeDesignerState(p));
  assert.equal(q.walls.length, p.walls.length);
  assert.deepEqual(q.roof.zones, []);
  assert.deepEqual(q.boardCuts, p.boardCuts);
  assert.deepEqual(q.prices, p.prices);
});
test("second-light void reduces only upper floor quantities and leaves roof and downstairs area intact", () => {
  const p = normalizeDesignerState({ ...clone(defaultDesignerProject), floors: 2 });
  p.voids = [
    {
      id: "void",
      level: 2,
      kind: "doubleHeight",
      edgeSection: "50x250",
      polygon: [
        { x: 2, y: 1 },
        { x: 6, y: 1 },
        { x: 6, y: 3 },
        { x: 2, y: 3 },
      ],
    },
  ];
  const base = calculateDesigner(p),
    roof = calculateRoofZones(p, base),
    r = calculateDesigner(p, { roofModel: roof });
  assert.equal(r.geometry.levels[0].netFloorArea, 96);
  assert.equal(r.geometry.levels[1].netFloorArea, 88);
  assert.equal(r.geometry.totalFloorArea, 184);
  assert.ok(Math.abs(roof.projectedArea - 96) < 1e-6);
  assert.ok(
    r.timber.instances.some(
      (b) => ["voidHeader", "openingHeader", "openingTrimmer"].includes(b.role) && b.floor === 2,
    ),
  );
  assert.ok(Math.abs(r.foundation.balanceError) < 1e-6);
});

test("default implicit level definitions materialize as editable UI floors", () => {
  const p = normalizeDesignerState({ ...clone(defaultDesignerProject), levels: [] });
  assert.equal(p.levels.length, 1);
  assert.equal(p.levels[0].index, 1);
  assert.equal(p.levels[0].height, p.height);
  assert.ok(p.walls.every((w) => w.level === 1));
  assert.ok(validateDesignerProject(p).valid);
});

test("lower roof wings retain their floor tags when the roof model is merged on the highest floor", () => {
  const p = normalizeDesignerState({ ...clone(defaultDesignerProject), floors: 2 });
  p.openings = p.openings.filter((o) => o.floor === 1);
  for (const w of p.walls.filter((w) => w.level === 2)) {
    if (w.a.x === 12) w.a.x = 8;
    if (w.b.x === 12) w.b.x = 8;
  }
  const base = calculateDesigner(p),
    roof = calculateRoofZones(p, base),
    r = calculateDesigner(p, { roofModel: roof });
  const lowIds = new Set(roof.zones.filter((z) => z.levelIndex === 1).map((z) => z.id));
  assert.ok(lowIds.size > 0);
  const low = r.timber.instances.filter((b) => b.category === "roof" && lowIds.has(b.zoneId));
  assert.ok(low.length > 0);
  assert.ok(low.every((b) => b.floor === 1 && b.level === 1));
  assert.ok(Math.abs(r.foundation.balanceError) < 1e-6);
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDesignerState } from "./designer-state.js";
import { defaultDesignerProject, calculateDesigner } from "./designer-engine.js";
import { calculateRoofZones } from "./roof-zones.js";
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`),
  clone = (x) => JSON.parse(JSON.stringify(x));
function project(north = 1, south = 1) {
  const p = normalizeDesignerState(clone(defaultDesignerProject)),
    pts = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 4 },
      { x: 0, y: 4 },
    ];
  p.walls = pts.map((a, i) => ({
    id: "w" + i,
    level: 1,
    a,
    b: pts[(i + 1) % 4],
    kind: "exterior",
    section: "50x200",
    studStep: 0.6,
  }));
  p.walls.push({
    id: "bearing",
    level: 1,
    a: { x: 0, y: 2 },
    b: { x: 8, y: 2 },
    kind: "bearing",
    section: "75x200",
    studStep: 0.6,
  });
  p.openings = [];
  p.bracing.method = "none";
  p.loads.snow = 2.75;
  p.roof = {
    ...p.roof,
    type: "mono",
    framing: "rafters",
    zones: [
      {
        id: "N",
        name: "North",
        polygon: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 8, y: 2 },
          { x: 0, y: 2 },
        ],
        shape: "mono",
        ridgeAngle: 0,
        pitchLeft: 25,
        pitchRight: 25,
        levelIndex: 1,
        elevation: null,
        spacing: 0.6,
        chordSection: "50x200",
        webSection: "50x100",
        framing: "rafters",
        loadSnowFactor: north,
      },
      {
        id: "S",
        name: "South",
        polygon: [
          { x: 0, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 4 },
          { x: 0, y: 4 },
        ],
        shape: "mono",
        ridgeAngle: 180,
        pitchLeft: 25,
        pitchRight: 25,
        levelIndex: 1,
        elevation: null,
        spacing: 0.6,
        chordSection: "50x200",
        webSection: "50x100",
        framing: "rafters",
        loadSnowFactor: south,
      },
    ],
  };
  return p;
}
function calc(p, extra = {}) {
  const base = calculateDesigner(p),
    roof = calculateRoofZones(p, base, extra),
    r = calculateDesigner(p, { roofModel: roof });
  return { roof, r };
}
test("equal total asymmetric snow follows real rafter supports instead of an invariant perimeter allocation", () => {
  const a = calc(project()),
    b = calc(project(2, 0));
  near(a.r.loads.snow, b.r.loads.snow);
  near(a.r.loads.totalDesign, b.r.loads.totalDesign);
  const row = (r, y) => r.piles.filter((p) => Math.abs(p.y - y) < 1e-6).reduce((s, p) => s + p.reaction, 0);
  assert.ok(row(b.r, 0) > row(a.r, 0) + 10);
  assert.ok(row(b.r, 4) < row(a.r, 4) - 10);
  for (const r of [a.r, b.r])
    near(
      r.piles.reduce((s, p) => s + p.reaction, 0),
      r.loads.totalDesign,
    );
});
test("zone snow multiplier changes exact projected snow weight, not timber or slope area", () => {
  const a = calc(project()),
    b = calc(project(1.5, 1));
  near(b.r.loads.snow - a.r.loads.snow, 2.75 * 0.8 * 16 * 0.5);
  near(a.r.timber.mass, b.r.timber.mass);
  near(a.roof.area, b.roof.area);
});
test("secondary roof wood pressure affects local rafter checks without a second global roof-dead term", () => {
  const p = project(),
    a = calc(p),
    b = calc(p, { roofExtraDeadByZone: { N: 0.2, S: 0.1 } });
  near(b.roof.zones[0].extraRoofDead, 0.2);
  assert.ok(
    b.roof.zones[0].rafterAnalysis.lineLoadService > a.roof.zones[0].rafterAnalysis.lineLoadService ||
      b.roof.zones[0].rafterAnalysis.deflection > a.roof.zones[0].rafterAnalysis.deflection,
  );
  near(a.r.loads.roofWeight, b.r.loads.roofWeight);
  near(a.r.loads.totalDesign, b.r.loads.totalDesign);
});

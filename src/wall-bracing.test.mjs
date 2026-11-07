import test from "node:test";
import assert from "node:assert/strict";
import { buildWallBracing } from "./wall-bracing.js";

const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} ≠ ${b}`);
function fixture({ length = 6, height = 2.8, opening = false, profile = null } = {}) {
  const base = 1.005,
    wall = {
      id: "north",
      kind: "exterior",
      level: 1,
      a: { x: 0, y: 0 },
      b: { x: length, y: 0 },
      section: "50x150",
      studStep: 0.6,
    };
  const polygon = [
    { x: 0, y: 0 },
    { x: length, y: 0 },
    { x: length, y: 4 },
    { x: 0, y: 4 },
  ];
  const p = {
    height,
    floors: 1,
    walls: [wall],
    openings: opening
      ? [{ id: "window", wallId: "north", floor: 1, offset: 2.4, width: 1.2, height: 1.2, sill: 0.8 }]
      : [],
    material: { density: 500 },
    loads: { wind: 0.3, gammaQ: 1.4 },
    cutting: { stockLength: 6 },
    bracing: { method: "sheathing" },
  };
  const instances = [];
  const add = (id, role, a, z, b = 50, h = 150, crossAxis = [1, 0, 0]) => {
    const length = Math.hypot(...z.map((q, i) => q - a[i])),
      volume = (b * h * length) / 1e6;
    instances.push({
      id,
      role,
      wallId: "north",
      level: 1,
      b,
      h,
      length,
      volume,
      mass: volume * 500,
      start: a,
      end: z,
      crossAxis,
      cutStart: { scheme: "butt" },
      cutEnd: { scheme: "butt" },
    });
  };
  for (let i = 0; i <= Math.round(length / 0.6); i++) {
    const s = (length * i) / Math.round(length / 0.6);
    if (opening && s > 2.4 && s < 3.6) {
      add("stud-low-" + i, "cripple", [s, base + 0.05, 0], [s, base + 0.75, 0]);
      add("stud-high-" + i, "cripple", [s, base + 2.2, 0], [s, base + height - 0.1, 0]);
    } else add("stud-" + i, "stud", [s, base + 0.05, 0], [s, base + height - 0.1, 0]);
  }
  add("bottom", "plate", [0, base + 0.025, 0], [length, base + 0.025, 0], 50, 150, [0, 1, 0]);
  add(
    "top-a",
    "plate",
    [0, base + height - 0.025, 0],
    [length, base + height - 0.025, 0],
    50,
    150,
    [0, 1, 0],
  );
  add(
    "top-b",
    "plate",
    [0, base + height - 0.075, 0],
    [length, base + height - 0.075, 0],
    50,
    150,
    [0, 1, 0],
  );
  if (opening) {
    for (const [s, id] of [
      [2.325, "king-l"],
      [3.675, "king-r"],
      [2.375, "jack-l"],
      [3.625, "jack-r"],
    ])
      add(
        id,
        id.startsWith("king") ? "king" : "jack",
        [s, base + 0.05, 0],
        [s, base + (id.startsWith("king") ? height - 0.1 : 2), 0],
      );
    add("header", "header", [2.35, base + 2.1, 0], [3.65, base + 2.1, 0], 50, 200, [0, 0, 1]);
    add("sill", "sill", [2.4, base + 0.775, 0], [3.6, base + 0.775, 0], 50, 150, [0, 1, 0]);
  }
  const levels = [
    { index: 1, wallBaseY: base, topY: base + height, height, polygon, bounds: { width: length, height: 4 } },
  ];
  const result = {
    geometry: { polygon, bounds: { width: length, height: 4 }, levels },
    timber: { instances },
    roofModel: {
      wallProfiles: profile
        ? [
            {
              wallId: "north",
              level: 1,
              mode: "continuous",
              section: "50x200",
              topSamples: profile.map(([s, h]) => ({ s, topY: base + h })),
            },
          ]
        : [],
    },
  };
  return { p, result, base };
}

test("physical sheathing area excludes a window, sheet identity is not fragment identity", () => {
  const { p, result } = fixture({ opening: true }),
    m = buildWallBracing(p, result);
  near(m.quantities.sheetArea, 6 * 2.8 - 1.2 * 1.2);
  near(m.quantities.panelMass, m.quantities.sheetArea * 0.012 * 650);
  // Five 1.2×2.5 blanks need 5 sheets; five 1.2×0.3 top strips fit sheet 6:
  // 5×0.3 + 5×0.003 = 1.515 m, leaving 0.985×1.25 = 1.23125 m².
  // The 1.2×1.2 opening changes net mass, not the six rectangular stock blanks.
  assert.equal(m.quantities.sheets, 6);
  assert.equal(m.quantities.installationParts, 10);
  assert.equal(m.quantities.sheets, new Set(m.panels.map((x) => x.purchaseSheetId)).size);
  near(m.quantities.purchasedSheetArea, 18.75);
  near(m.quantities.reusableArea, 1.23125);
  near(m.quantities.wasteArea, 2.15875);
  assert.ok(m.panels.length > m.quantities.sheets);
  for (const panel of m.panels)
    for (const q of panel.localPolygon)
      assert.ok(!(q.x > 2.4 + 1e-7 && q.x < 3.6 - 1e-7 && q.y > 1.805 + 1e-7 && q.y < 3.005 - 1e-7));
  near(m.quantities.purchasedSheetArea, m.quantities.sheets * 1.25 * 2.5);
  near(
    m.quantities.wasteArea + m.quantities.reusableArea,
    m.quantities.purchasedSheetArea - m.quantities.sheetArea,
  );
});

test("real horizontal panel seams receive blocking cut between existing stud faces", () => {
  const { p, result } = fixture(),
    m = buildWallBracing(p, result),
    blocking = m.instances.filter((x) => x.role === "sheathingBlocking");
  assert.equal(blocking.length, 10);
  near(m.quantities.blockingLength, 5.5);
  for (const b of blocking) {
    near(b.length, 0.55);
    near(b.start[1], 3.505);
    assert.equal(b.category, "walls");
    assert.deepEqual(b.crossAxis, [0, 1, 0]);
  }
  assert.equal(m.wallLines[0].unsupportedEdges, 0);
  assert.ok(!m.instances.some((x) => x.role === "sheathingStud"));
});

test("missing outer edge framing is explicitly reported rather than visually approved", () => {
  const { p, result } = fixture();
  result.timber.instances = result.timber.instances.filter((b) => b.role !== "plate");
  const m = buildWallBracing(p, result);
  assert.ok(m.wallLines[0].unsupportedBoundarySegments > 0);
  assert.ok(m.warnings.some((x) => x.includes("без подтверждённого опирания")));
  assert.equal(m.status, "unverified");
});

test("raked wall panels follow the actual profile, upgraded section and collinear top samples", () => {
  const { p, result } = fixture({
      profile: [
        [0, 2.8],
        [1, 3],
        [2, 3.2],
        [3, 3.4],
        [4, 3.6],
        [5, 3.8],
        [6, 4],
      ],
    }),
    m = buildWallBracing(p, result);
  near(m.quantities.sheetArea, (6 * (2.8 + 4)) / 2);
  for (const panel of m.panels)
    for (const [x, y, z] of panel.polygon) {
      near(z, -0.106);
      assert.ok(y <= 1.005 + 2.8 + x * 0.2 + 1e-7);
    }
  for (const b of m.instances) assert.equal(b.h, 200);
  assert.ok(m.wallLines[0].demandShear >= 0.3 * 4 * 4 * 1.4 - 1e-8, "wind includes raised wall height");
});

test("a sequence of full-height braces covers the clear wall at 45–60°", () => {
  const { p, result } = fixture();
  p.bracing.method = "letIn";
  const m = buildWallBracing(p, result),
    b = m.braces[0];
  assert.ok(m.braces.length >= 2);
  assert.equal(m.panels.length, 0);
  assert.ok(m.wallLines[0].coveredLength > 5, "Diagonals span the clear wall rather than only its end");
  assert.ok(b.angle >= 45 && b.angle <= 60);
  near(b.start[1], 1.03);
  near(b.end[1], 3.78);
  near(b.start[2], -0.0625);
  near(b.end[2], -0.0625);
  assert.equal(b.requireSingleStock, true);
  assert.ok(b.cutLength <= 6);
  assert.equal(b.cutStart.tiltSign, -1);
  assert.equal(b.cutEnd.tiltSign, 1);
  assert.ok(m.warnings.some((x) => x.includes("406 мм")));
  assert.ok(m.checks.some((c) => c.note?.includes("обратное направление ветра")));
});

test("25 mm deep notches are calculated once per physical board, with exact volume", () => {
  const { p, result } = fixture();
  p.bracing.method = "letIn";
  const before = JSON.stringify(result),
    m = buildWallBracing(p, result);
  assert.equal(JSON.stringify(result), before, "original boards remain unchanged");
  assert.equal(m.notches.length, new Set(m.notches.map((n) => n.boardId)).size);
  assert.ok(m.notches.some((n) => n.boardId === "bottom"));
  assert.ok(m.notches.some((n) => n.boardId === "top-a"));
  for (const n of m.notches) {
    near(n.depth, 0.025);
    near(n.volume, n.intersectionArea * 0.025);
    assert.ok(n.volume > 0);
  }
  near(
    m.quantities.notchVolume,
    m.notches.reduce((s, n) => s + n.volume, 0),
  );
  const groove = m.notches.find((n) => n.shape === "verticalStudGroove");
  assert.ok(groove.station > 0);
  assert.ok(groove.length > 0.1);
  near(groove.length, 0.1 * Math.sqrt(1 + groove.slope ** 2));
  assert.ok((Math.atan(Math.abs(groove.slope)) * 180) / Math.PI >= 45);
  assert.equal(groove.normalSide, -1);
  assert.equal(groove.faceSign, -1);
});

test("stock fitting steepens a tall brace and never silently splices it", () => {
  const { p, result } = fixture({ length: 8, height: 4.665 });
  p.bracing.method = "letIn";
  const m = buildWallBracing(p, result),
    b = m.braces[0];
  assert.ok(b);
  assert.ok(b.angle > 50 && b.angle <= 60);
  assert.ok(b.cutLength <= 6 + 1e-8);
  assert.equal(b.requireSingleStock, true);
  near(b.cutLength, b.length + 0.1 / Math.tan((b.angle * Math.PI) / 180));
});

test("no invented short diagonal when wall height or narrow clear bay cannot fit full-height bracing", () => {
  for (const f of [fixture({ height: 5.5, length: 8 }), fixture({ height: 4.665, length: 2.4 })]) {
    f.p.bracing.method = "letIn";
    const m = buildWallBracing(f.p, f.result);
    assert.equal(m.braces.length, 0);
    assert.equal(m.status, "fail");
    assert.ok(m.checks.some((c) => c.id.endsWith("let-in-fit") && c.status === "fail"));
  }
});

test("existing splice cuts are not subtracted a second time from notch mass", () => {
  const { p, result } = fixture();
  p.bracing.method = "letIn";
  const stud = result.timber.instances.find((b) => b.id === "stud-1");
  stud.cutStart = { scheme: "halfLap" };
  const m = buildWallBracing(p, result),
    n = m.notches.find((n) => n.boardId === stud.id);
  assert.ok(n);
  assert.equal(n.volume, 0);
  assert.ok(n.grossIntersectionVolume > 0);
  assert.equal(n.requiresCutBoolean, true);
});

test("a rotated corner board uses its real normal depth and is not rendered as an ordinary stud groove", () => {
  const { p, result, base } = fixture();
  p.bracing.method = "letIn";
  result.timber.instances.push({
    id: "rotated-corner",
    role: "corner",
    wallIds: ["north"],
    level: 1,
    b: 50,
    h: 150,
    start: [0.6, base + 0.05, -0.05],
    end: [0.6, base + 2.7, -0.05],
    crossAxis: [0, 0, 1],
  });
  const n = buildWallBracing(p, result).notches.find((n) => n.boardId === "rotated-corner");
  assert.ok(n);
  near(n.depth, 0.025);
  assert.equal(n.shape, "polygon");
  near(n.localSlope, 0);
  assert.equal(n.station, undefined);
});

test("null shear capacity is unknown, and an entered insufficient capacity fails only its screen", () => {
  const { p, result } = fixture(),
    m = buildWallBracing(p, result);
  assert.equal(m.wallLines[0].capacity, null);
  assert.equal(m.wallLines[0].utilization, null);
  assert.equal(m.status, "unverified");
  p.bracing.designShear = 0.01;
  const weak = buildWallBracing(p, result);
  assert.equal(weak.status, "fail");
  assert.ok(weak.wallLines[0].utilization > 1);
  p.bracing.designShear = 100;
  const strong = buildWallBracing(p, result);
  assert.equal(strong.status, "unverified");
  assert.ok(strong.checks.some((x) => x.id.endsWith("load-path") && x.status === "unverified"));
});

test("none creates no panels, timber or notch removal and remains unverified", () => {
  const { p, result } = fixture();
  p.bracing.method = "none";
  const m = buildWallBracing(p, result);
  assert.deepEqual(m.instances, []);
  assert.deepEqual(m.panels, []);
  assert.deepEqual(m.notches, []);
  assert.equal(m.status, "unverified");
});

import test from "node:test";
import assert from "node:assert/strict";
import { calculateInsulation, insulationPacks, validateInsulation } from "./insulation.js";
import { boardSolids, volume } from "./insulation-solid.js";
import { evaluateHouse, applyProjectPatch } from "./house-engine.js";
import { defaultDesignerProject, validateDesignerProject } from "./designer-engine.js";
import { generateHouse } from "./house-generator.js";
import { calculateEstimate } from "./estimate-engine.js";
import { insulationSchema } from "../mcp/project-features.mjs";
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const board = (id, start, end, b = 50, h = 150, crossAxis = [1, 0, 0]) => ({
  id,
  start,
  end,
  b,
  h,
  crossAxis,
  length: Math.hypot(...end.map((v, i) => v - start[i])),
});
function wallFixture() {
  const wall = {
    id: "w",
    a: { x: 0, y: 0 },
    b: { x: 6, y: 0 },
    kind: "exterior",
    section: "50x150",
    level: 1,
  };
  const opening = { wallId: "w", offset: 2.4, width: 1.2, height: 1.2, sill: 0.8 };
  const project = {
    walls: [wall],
    openings: [opening],
    insulation: { floor: { enabled: false }, roof: { enabled: false } },
    loads: { wallDead: 0.5 },
  };
  const boards = [
    board("bottom", [0, 0.025, 0], [6, 0.025, 0], 50, 150, [0, 1, 0]),
    board("top1", [0, 2.725, 0], [6, 2.725, 0], 50, 150, [0, 1, 0]),
    board("top2", [0, 2.775, 0], [6, 2.775, 0], 50, 150, [0, 1, 0]),
  ];
  // Stud axes @600 mm, edges moved in by half-width; three stations cross window.
  for (let i = 0; i <= 10; i++) {
    const x = i === 0 ? 0.025 : i === 10 ? 5.975 : i * 0.6;
    if (i >= 4 && i <= 6) {
      boards.push(board(`lower${i}`, [x, 0.05, 0], [x, 0.75, 0]));
      boards.push(board(`upper${i}`, [x, 2.15, 0], [x, 2.7, 0]));
    } else boards.push(board(`stud${i}`, [x, 0.05, 0], [x, 2.7, 0]));
  }
  boards.push(board("sill", [2.375, 0.775, 0], [3.625, 0.775, 0], 50, 150, [0, 1, 0]));
  boards.push(board("header", [2.375, 2.075, 0], [3.625, 2.075, 0], 150, 150, [0, 0, 1]));
  return {
    project,
    result: {
      walls: [wall],
      geometry: { closed: true, levels: [{ index: 1, wallBaseY: 0, height: 2.8, closed: false }] },
      timber: { instances: boards },
    },
  };
}
test("6×2.8 wall, 150 mm, 600 mm studs, one 1.2×1.2 window: independent takeoff", () => {
  const { project, result } = wallFixture(),
    r = calculateInsulation(project, result),
    a = r.assemblies[0];
  // Gross 6×2.8×.15=2.52. Window 1.2²×.15=.216.
  // Timber: 3 plates ×6×.05×.15=.135;
  // 8 full studs ×2.65×.05×.15=.159;
  // 3 lower+upper cripples ×(.70+.55)×.05×.15=.028125;
  // sill 1.25×.05×.15=.009375; header 1.25×.15²=.028125.
  near(a.grossVolume, 2.52);
  near(a.openingVolume, 0.216);
  near(a.timberVolume, 0.359625);
  near(a.netVolume, 1.944375);
  near(a.mass, 68.053125);
  assert.equal(r.totals.packs[0].packs, 5);
});
test("floor 4×5, 200 mm: 9 joists at 600 mm, rims and blocking, hand calculation", () => {
  const boards = [];
  for (let i = 0; i < 9; i++)
    boards.push(board(`j${i}`, [0, 0.1, 0.1 + 0.6 * i], [4, 0.1, 0.1 + 0.6 * i], 50, 200, [0, 0, 1]));
  boards.push(
    board("rim0", [0.025, 0.1, 0], [0.025, 0.1, 5], 50, 200, [1, 0, 0]),
    board("rim1", [3.975, 0.1, 0], [3.975, 0.1, 5], 50, 200, [1, 0, 0]),
  );
  // Blocking in each clear bay (8 × .55m). Rims overlap joists: union must remove .009m³ once.
  for (let i = 0; i < 8; i++)
    boards.push(board(`b${i}`, [2, 0.1, 0.125 + 0.6 * i], [2, 0.1, 0.675 + 0.6 * i], 50, 200, [1, 0, 0]));
  const p = { floor: { section: "50x200" }, loads: { floorDead: 0.6 } },
    result = {
      walls: [],
      geometry: {
        closed: true,
        levels: [
          {
            index: 1,
            closed: true,
            platformBase: 0,
            polygon: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 5 },
              { x: 0, y: 5 },
            ],
          },
        ],
      },
      timber: { instances: boards },
    };
  const a = calculateInsulation(p, result).assemblies[0];
  // Gross=4; joists=.36; rims=.10; overlap=9×2×.05×.05×.2=.009; blocking=.044.
  near(a.grossVolume, 4);
  near(a.timberVolume, 0.495);
  near(a.netVolume, 3.505);
  near(a.mass, 122.675);
});
test("packs round once across assemblies; layer thickness and zero volume", () => {
  const rows = [
    { product: "wool-50", thickness: 0.15, netVolume: 0.432 },
    { product: "wool-50", thickness: 0.15, netVolume: 0.432 },
  ];
  assert.equal(insulationPacks(rows, 0)[0].packs, 2);
  assert.equal(insulationPacks(rows, 0.05)[0].packs, 3);
  near(insulationPacks(rows, 0.05)[0].requiredVolume, 0.9072);
  assert.equal(insulationPacks([{ product: "wool-100", thickness: 0.15, netVolume: 0.648 }], 0)[0].packs, 2);
  assert.deepEqual(insulationPacks([], 0), []);
});
test("duplicate boards, partial depth and an opening-crossing board are removed only once", () => {
  const { project, result } = wallFixture();
  project.insulation.walls = { thickness: 0.075 };
  result.timber.instances.push(...result.timber.instances.map((b) => ({ ...b, id: b.id + "copy" })));
  const a = calculateInsulation(project, result).assemblies[0];
  near(a.netVolume, 1.944375 / 2);
  result.timber.instances.push(board("through-window", [3, 0, 0], [3, 2.8, 0]));
  const b = calculateInsulation(project, result).assemblies[0];
  // Its existing upper/lower timber is already removed; all timber outside the opening was already removed.
  near(b.netVolume, a.netVolume);
  assert.ok(b.timberVolume + b.openingVolume < b.grossVolume);
});
test("physical profile volumes: butt, mitre, half-lap and layered profile", () => {
  const b = board("profile", [0, 0, 0], [0, 2, 0]);
  near(
    boardSolids(b).reduce((s, c) => s + volume(c), 0),
    0.015,
  );
  near(
    boardSolids({ ...b, cutStart: { scheme: "miter", angle: 30 } }).reduce((s, c) => s + volume(c), 0),
    0.015,
  );
  near(
    boardSolids({ ...b, cutStart: { scheme: "halfLap", lapLength: 0.4 } }).reduce((s, c) => s + volume(c), 0),
    0.0135,
    1e-6,
  );
  near(
    boardSolids({
      ...b,
      shape: {
        type: "layeredProfile",
        layers: [
          {
            from: -0.025,
            to: 0.025,
            points: [
              [-1, -0.075],
              [1, -0.075],
              [1, 0.075],
              [-1, 0.075],
            ],
          },
        ],
      },
    }).reduce((s, c) => s + volume(c), 0),
    0.015,
  );
});
test("load warning checks the existing layers without adding any force", () => {
  const { project, result } = wallFixture();
  project.loads.wallDead = 0;
  const r = calculateInsulation(project, result);
  assert.equal(r.checks[0].status, "warning");
  near(r.checks[0].value, (68.053125 * 9.80665) / 1000);
  assert.equal(project.loads.wallDead, 0);
});
test("strict validation rejects unknown, null, NaN, invalid product and boundary", () => {
  for (const insulation of [
    null,
    { wat: {} },
    { walls: { thickness: 0 } },
    { walls: { thickness: NaN } },
    { walls: { product: "bad" } },
    { roof: { boundary: "bad" } },
    { partitions: { enabled: "yes" } },
    { wasteFactor: -1 },
  ]) {
    const errors = [];
    validateInsulation({ insulation }, (...e) => errors.push(e));
    assert.ok(errors.length);
    assert.equal(insulationSchema.safeParse(insulation).success, false);
    assert.equal(
      validateDesignerProject({ ...structuredClone(defaultDesignerProject), insulation }).valid,
      false,
    );
  }
});
test("envelope scenarios are not extra material; explicit thickness wins and partitions are opt-in", () => {
  const { project, result } = wallFixture();
  project.envelope = {
    assemblies: [
      { appliesTo: "wall", layers: [{ name: "Минеральная вата", thickness: 0.1 }] },
      { appliesTo: "wall", layers: [{ name: "Минеральная вата", thickness: 0.2 }] },
    ],
  };
  near(calculateInsulation(project, result).assemblies[0].thickness, 0.1);
  project.insulation.walls = { thickness: 0.075, product: "wool-100" };
  near(calculateInsulation(project, result).assemblies[0].thickness, 0.075);
  result.walls[0].kind = "partition";
  assert.equal(calculateInsulation(project, result).assemblies.length, 0);
  project.insulation.partitions = {};
  assert.equal(calculateInsulation(project, result).assemblies.length, 1);
});
test("pack estimate replaces legacy wool allowances; retains row id and price key", () => {
  const { project, result } = wallFixture();
  result.insulation = calculateInsulation(project, result);
  project.prices = { insulationPack: 100, wastePercent: 90 };
  project.envelope = {
    costItems: [
      { id: "ceiling-insulation", name: "Минвата", basis: "groundFloor", rate: 10000 },
      { id: "air", name: "Мембрана", basis: "wall", rate: 10 },
    ],
  };
  result.geometry.netWallArea = 15.36;
  const e = calculateEstimate(project, result, {
      groups: [],
      stocks: [],
      overlength: [],
      summary: { complete: true },
    }),
    row = e.rows.find((r) => r.id === "insulation");
  assert.equal(row.unit, "уп.");
  assert.equal(row.quantity, 5);
  near(row.total, 500);
  assert.equal(row.editableKey, "insulationPack");
  assert.ok(!e.rows.some((r) => r.id === "envelope-ceiling-insulation"));
  assert.ok(e.rows.some((r) => r.id === "envelope-air"));
});
test("generated roof boundaries ceiling vs slopes, patches and unchanged load path", () => {
  const { project } = generateHouse({
    width: 4,
    depth: 5,
    roof: { shape: "gable", pitch: 25 },
    sections: { walls: "50x150", floor: "50x200", roof: "50x200" },
  });
  const r = evaluateHouse(project);
  assert.ok(r.result.insulation.assemblies.some((a) => a.id.includes("ceiling")));
  const p = applyProjectPatch(project, [
    {
      op: "add",
      path: "/insulation",
      value: { roof: { boundary: "slopes" }, partitions: {}, wasteFactor: 0 },
    },
  ]);
  const q = evaluateHouse(p);
  assert.ok(q.result.insulation.assemblies.some((a) => a.name.includes("скат")));
  near(q.result.loads.totalDesign, r.result.loads.totalDesign);
  assert.ok(q.estimate.rows.some((r) => r.unit === "уп."));
});

test("mono slope 3:4:5: overhangs excluded by vertical thermal footprint", () => {
  const project = {
    roof: { type: "mono" },
    floor: { section: "50x200" },
    insulation: { walls: { enabled: false }, floor: { enabled: false }, roof: { boundary: "slopes" } },
    loads: { roofDead: 0.5 },
  };
  // Surface y=4z/3, extended one metre beyond both bearing edges.
  const result = {
    walls: [],
    geometry: { closed: true, levels: [] },
    timber: { instances: [] },
    roofModel: {
      zones: [
        {
          id: "r",
          name: "Скат",
          polygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 3 },
            { x: 0, y: 3 },
          ],
          effectiveSection: "50x200",
          surfaceArea: 100 / 3,
          bearingArea: 12,
        },
      ],
      surfaces: [
        {
          id: "s",
          zoneId: "r",
          points: [
            [0, -4 / 3, -1],
            [4, -4 / 3, -1],
            [4, 16 / 3, 4],
            [0, 16 / 3, 4],
          ],
        },
      ],
    },
  };
  const r = calculateInsulation(project, result);
  // Bearing slope area=4×5=20m²; 20×.2=4m³, without the eaves.
  near(r.totals.grossVolume, 4);
  near(r.totals.netVolume, 4);
  near(r.totals.mass, 140);
  assert.equal(r.totals.packs[0].packs, 10);
  const angle = (Math.atan(4 / 3) * 180) / Math.PI;
  result.timber.instances = [
    {
      ...board("rafter", [2, 0, 0], [2, 4, 3], 50, 200),
      role: "rafter",
      zoneId: "r",
      cutStart: { scheme: "miter", angle, tiltSign: -1 },
      cutEnd: { scheme: "miter", angle, tiltSign: 1 },
    },
  ];
  const framed = calculateInsulation(project, result);
  // Full rafter depth lies in the cavity: 5×.05×.2=.05m³, even when
  // the legacy roof polygon follows its axis instead of its upper face.
  near(framed.totals.timberVolume, 0.05);
  near(framed.totals.netVolume, 3.95);
});

test("complete layer densities: hand-calculated 10mm lining plus 150mm insulation", () => {
  const { project, result } = wallFixture();
  project.envelope = {
    assemblies: [
      {
        appliesTo: "wall",
        layers: [
          { name: "Облицовка", thickness: 0.01, density: 1000 },
          { name: "Минвата", insulation: true, thickness: 0.15, density: 40 },
        ],
      },
    ],
  };
  const a = calculateInsulation(project, result).assemblies[0];
  // Net wall area=16.8−1.44=15.36m²; lining=153.6kg, insulation=1.944375×40=77.775kg.
  near(a.mass, 77.775);
  near(a.fullLayersLoad, ((153.6 + 77.775) * 9.80665) / 1000);
  project.envelope.assemblies[0].layers = [
    { name: "Минвата", thickness: 0.05, density: 40 },
    { name: "Минвата", thickness: 0.1 },
  ];
  // Only the unspecified layer uses 35kg/m³: mean=(.05×40+.10×35)/.15.
  near(calculateInsulation(project, result).assemblies[0].mass, 71.29375);
});

test("floor openings union excludes timber in the hole", () => {
  const p = { floor: { section: "50x200" }, loads: { floorDead: 0.6 } };
  const hole = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
  ];
  const r = calculateInsulation(p, {
    walls: [],
    geometry: {
      closed: true,
      levels: [
        {
          index: 1,
          closed: true,
          platformBase: 0,
          polygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 5 },
            { x: 0, y: 5 },
          ],
          voids: [{ polygon: hole }, { polygon: hole }],
        },
      ],
    },
    timber: { instances: [board("in-hole", [1.5, 0.1, 1], [1.5, 0.1, 2], 50, 200)] },
  });
  near(r.totals.grossVolume, 4);
  near(r.totals.openingVolume, 0.2);
  near(r.totals.netVolume, 3.8);
  near(r.totals.timberVolume, 0);
});

test("imported ceiling: actual joist depth/datum and missing optional source id", () => {
  const p = {
    roof: { sourceModel: {} },
    floor: { section: "50x200" },
    insulation: { floor: { enabled: false } },
    loads: { roofDead: 0.5 },
  };
  const polygon = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 5 },
    { x: 0, y: 5 },
  ];
  const result = {
    walls: [],
    geometry: { closed: true, levels: [{ index: 1, closed: true, polygon, area: 20, topY: 3.2 }] },
    timber: {
      instances: [
        { ...board("ceiling", [0, 3.1, 2.5], [4, 3.1, 2.5], 50, 200, [0, 0, 1]), role: "ceilingJoist" },
      ],
    },
    roofModel: {
      zones: [],
      area: 20,
      surfaces: [
        {
          id: "import",
          zoneId: "SOURCE-ROOF",
          points: [
            [0, 3.2, 0],
            [4, 3.2, 0],
            [4, 3.2, 5],
            [0, 3.2, 5],
          ],
        },
      ],
    },
  };
  const r = calculateInsulation(p, result),
    a = r.assemblies[0];
  near(a.cavityDepth, 0.2);
  near(a.grossVolume, 4);
  near(a.timberVolume, 0.04);
  near(a.netVolume, 3.96);
  near(a.mass, 138.6);
  assert.equal(a.id, "SOURCE-ROOF-ceiling");
  assert.equal(r.complete, true);
  p.roof.thermalBoundary = "slopes";
  p.insulation.roof = { thickness: 0.2 };
  assert.ok(calculateInsulation(p, result).assemblies.every((a) => a.name.includes("скат")));
});

test(
  "real MCP: strict insulation input, generated fields, pack estimate and report topic",
  { timeout: 20000 },
  async (t) => {
    const { mkdtemp, rm } = await import("node:fs/promises"),
      { tmpdir } = await import("node:os"),
      path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { Client } = await import("@modelcontextprotocol/client"),
      { StdioClientTransport } = await import("@modelcontextprotocol/client/stdio");
    const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-insulation-mcp-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../mcp/server.mjs", import.meta.url))],
      env: { ...process.env, KARKAS_DATA_DIR: dataDir },
      stderr: "pipe",
    });
    const client = new Client({ name: "insulation-test", version: "1" }, { capabilities: {} });
    t.after(async () => {
      await client.close();
      await transport.close();
      await rm(dataDir, { recursive: true, force: true });
    });
    await client.connect(transport);
    const call = (name, args) => client.callTool({ name: "karkas_" + name, arguments: args });
    const insulation = {
      walls: { thickness: 0.15, product: "wool-100" },
      roof: { boundary: "ceiling" },
      wasteFactor: 0,
    };
    const generated = await call("generate", { width: 4, depth: 5, insulation });
    assert.notEqual(generated.isError, true);
    const project_id = generated.structuredContent.project_id;
    const saved = await call("get_project", { project_id });
    assert.deepEqual(saved.structuredContent.project.insulation, insulation);
    const r = await call("report", { project_id, topic: "insulation" });
    assert.notEqual(r.isError, true);
    assert.ok(r.structuredContent.data.totals.netVolume > 0);
    assert.ok(r.structuredContent.data.totals.packs.length);
    const catalog = await call("catalog", {});
    assert.equal(catalog.structuredContent.insulationProducts.length, 2);
    const estimate = await call("report", { project_id, topic: "estimate" });
    assert.ok(estimate.structuredContent.items.some((r) => r.id === "insulation" && r.unit === "уп."));
    const bad = await call("generate", { width: 4, depth: 5, insulation: { walls: { surprise: 1 } } });
    assert.equal(bad.isError, true);
    const imported = await call("import_project", {
      project: { ...saved.structuredContent.project, insulation: { walls: { thickness: -1 } } },
    });
    assert.equal(imported.isError, true);
  },
);

test("warm roof: two 4m gables with 2m rise, 150mm, 1.2m³ by hand", () => {
  const walls = [
    { id: "left", kind: "exterior", level: 1, section: "50x150", a: { x: 0, y: 0 }, b: { x: 0, y: 4 } },
    { id: "right", kind: "exterior", level: 1, section: "50x150", a: { x: 6, y: 0 }, b: { x: 6, y: 4 } },
  ];
  const polygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 0, y: 4 },
  ];
  const project = {
    walls,
    roof: {},
    insulation: { roof: { boundary: "slopes" } },
    loads: { wallDead: 0.5, roofDead: 0.5 },
  };
  const result = {
    walls,
    geometry: { closed: true, levels: [{ index: 1, closed: false, polygon, wallBaseY: 0, height: 2.8 }] },
    timber: { instances: [] },
    roofModel: {
      zones: [
        {
          id: "r",
          name: "Крыша",
          levelIndex: 1,
          polygon,
          effectiveSection: "50x200",
          bearingArea: 24,
          surfaceArea: 26.04 * Math.SQRT2,
        },
      ],
      surfaces: [
        {
          id: "l",
          zoneId: "r",
          points: [
            [-0.1, 2.7, -0.1],
            [6.1, 2.7, -0.1],
            [6.1, 4.8, 2],
            [-0.1, 4.8, 2],
          ],
        },
        {
          id: "h",
          zoneId: "r",
          points: [
            [-0.1, 4.8, 2],
            [6.1, 4.8, 2],
            [6.1, 2.7, 4.1],
            [-0.1, 2.7, 4.1],
          ],
        },
      ],
    },
  };
  const r = calculateInsulation(project, result),
    gables = r.assemblies.filter((a) => a.name.startsWith("Фронтон"));
  assert.equal(gables.length, 2);
  near(
    gables.reduce((s, a) => s + a.netVolume, 0),
    2 * ((4 * 2) / 2) * 0.15,
  );
  // Main walls are each 4×2.8×.15=1.68m³; no gable overlaps or duplicate roof cells.
  near(
    r.assemblies.filter((a) => a.id.endsWith("L1")).reduce((s, a) => s + a.netVolume, 0),
    3.36,
  );
});

test("continuous tall frame with cold attic: insulation stops at the nominal wall top", () => {
  const { project, result } = wallFixture();
  result.geometry.wallProfiles = [
    {
      wallId: "w",
      level: 1,
      zoneIds: ["r"],
      mode: "continuous",
      baseY: 0,
      section: "50x150",
      topSamples: [
        { s: 0, topY: 3.8 },
        { s: 6, topY: 5.8 },
      ],
    },
  ];
  result.roofModel = {
    zones: [
      {
        id: "r",
        effectiveFraming: "truss",
        polygon: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 4 },
          { x: 0, y: 4 },
        ],
        effectiveSection: "50x150",
        eave: 2.8,
        surfaceArea: 30,
        bearingArea: 24,
      },
    ],
  };
  // Roof disabled for procurement, but its cold-attic geometry still defines the wall boundary.
  near(calculateInsulation(project, result).assemblies[0].grossVolume, 2.52);
});

test("standalone estimate computes from physical frame; legacy 150mm price conversion", () => {
  const { project, result } = wallFixture();
  project.prices = { insulationM2: 900, wastePercent: 90 };
  const e = calculateEstimate(project, result, {
      groups: [],
      stocks: [],
      overlength: [],
      summary: { complete: true },
    }),
    a = e.rows.find((r) => r.id === "insulation");
  // 5 packs ×(.432/.15×900) = 12960; general wastePercent must not apply again.
  near(a.unitPrice, 2592);
  near(a.total, 12960);
  assert.equal(a.quantity, 5);
});

test("insulation table renders Russian takeoff, aggregate purchase and load warning", async () => {
  const { build } = await import("esbuild"),
    { createElement } = await import("react"),
    { renderToStaticMarkup } = await import("react-dom/server");
  const { fileURLToPath } = await import("node:url");
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./insulation-table.jsx", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    external: ["react"],
  });
  const code = compiled.outputFiles[0].text.replace(
    /from "react"/g,
    "from " + JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href),
  );
  const { default: Table } = await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
  const { project, result } = wallFixture();
  project.loads.wallDead = 0;
  const html = renderToStaticMarkup(
    createElement(Table, { insulation: calculateInsulation(project, result) }),
  );
  assert.match(html, /Чистый объём/);
  assert.match(html, /Брутто, м³/);
  assert.match(html, /Древесина, м³/);
  assert.match(html, /5 уп\./);
  assert.match(html, /Нагрузка слоёв ниже расчётного веса/);
});

test("actual exterior wall faces cover the full corner ring without axis gaps", () => {
  const { project } = generateHouse({ width: 6, depth: 4 });
  const r = evaluateHouse(project).result;
  r.timber.instances = [];
  project.insulation = { floor: { enabled: false }, roof: { enabled: false } };
  const insulation = calculateInsulation(project, r);
  // Outer 6.15×4.15 less inner 5.85×3.85 = 3.0m²; height 2.8 → 8.4m³.
  // Four overlapping axis strips would lose 4×(.075²)×2.8=.063m³ at corners.
  near(insulation.totals.grossVolume, 8.4);
});

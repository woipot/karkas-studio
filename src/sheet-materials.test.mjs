import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { sheetProducts, resolveSheet, parseSheetProduct } from "./sheet-catalog.js";
import { layoutSheetSurface, checkSheetDeck, sheetBoundarySegments } from "./sheet-layout.js";
import { buildWallBracing, sheetPolygons } from "./wall-bracing.js";
import { calculateDesigner, defaultDesignerProject, validateDesignerProject } from "./designer-engine.js";
import { evaluateHouse, engineCatalog } from "./house-engine.js";
import { generateHouse } from "./house-generator.js";
import { calculateEstimate } from "./estimate-engine.js";
import { sheathingSchema } from "../mcp/project-features.mjs";
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const sum = (a) => a.reduce((s, v) => s + v, 0);
function project() {
  const p = structuredClone(defaultDesignerProject),
    points = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 5 },
      { x: 0, y: 5 },
    ];
  p.walls = points.map((a, i) => ({
    id: `w${i}`,
    a,
    b: points[(i + 1) % 4],
    kind: "exterior",
    section: "50x150",
    studStep: 0.6,
    level: 1,
  }));
  p.openings = [];
  p.bracing.method = "none";
  p.roof.type = "none";
  p.floor.axis = "y";
  p.floor.spacing = 0.6;
  return p;
}
const floorOptions = () => ({
  id: "floor",
  kind: "floors",
  level: 1,
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 5 },
      { x: 0, y: 5 },
    ],
  ],
  supports: [0, 0.6, 1.2, 1.8, 2.4, 3, 3.6, 4].map((x) => ({
    id: `j${x}`,
    a: { x, y: 0 },
    b: { x, y: 5 },
    width: 0.05,
  })),
  toWorld: (q) => [q.x, 0, q.y],
  product: "osb3-2500x1250",
  thickness: 18,
});

test("market formats and thickness parsing never round 1500 to 1525 or invent a product", () => {
  assert.deepEqual(
    sheetProducts.filter((p) => p.material === "osb3").map((p) => [p.length, p.width]),
    [
      [2.5, 1.25],
      [2.44, 1.22],
      [2.8, 1.25],
    ],
  );
  near(parseSheetProduct("plywood-fk-1525x1525-6.5").thickness, 6.5);
  near(resolveSheet({ product: "osb3-2500x1250-12", thickness: 12 }).density, 620);
  near(resolveSheet({ product: "osb3-2500x1250", thickness: 22 }).density, 600);
  assert.equal(parseSheetProduct("plywood-fk-1500x1500-12"), null);
  assert.equal(resolveSheet({ product: "osb3-2500x1250-12", thickness: 18 }), null);
  assert.equal(parseSheetProduct("osb3-2500x1250-21"), null);
  assert.equal(engineCatalog().sheetProducts.length, 7);
});

test("sheathing core and strict MCP schemas reject missing side, unknown keys, products and thicknesses", () => {
  const valid = {
    walls: { product: "plywood-fk-1525x1525", thickness: 6.5, side: "interior" },
    floors: { product: "osb3-2500x1250", thickness: 22 },
  };
  assert.ok(sheathingSchema.safeParse(valid).success);
  assert.ok(validateDesignerProject({ ...project(), sheathing: valid }).valid);
  for (const sheathing of [
    null,
    [],
    { floors: { product: "osb3-2500x1250", thickness: 21 } },
    { walls: { product: "osb3-2500x1250", thickness: 12 } },
    { floors: { product: "osb3-2500x1250", thickness: 12, side: "both" } },
    { ceiling: { product: "osb3-2500x1250", thickness: 12 } },
    { walls: { ...valid.walls, side: "outside" } },
  ]) {
    assert.equal(sheathingSchema.safeParse(sheathing).success, false);
    assert.equal(validateDesignerProject({ ...project(), sheathing }).valid, false);
  }
});

test("6×2.8 wall minus 1.5×1.5 window: five tall blanks + five reusable strip blanks = 6 purchased sheets", () => {
  const wall = {
    id: "wall",
    kind: "exterior",
    section: "50x150",
    level: 1,
    a: { x: 0, y: 0 },
    b: { x: 6, y: 0 },
  };
  const p = {
    walls: [wall],
    openings: [{ id: "window", wallId: "wall", floor: 1, offset: 2.25, width: 1.5, height: 1.5, sill: 0.8 }],
    material: { density: 500 },
    bracing: { method: "sheathing", sheetWidth: 1.25, sheetHeight: 2.5, thickness: 12, sheetDensity: 620 },
  };
  const timber = {
    instances: Array.from({ length: 11 }, (_, i) => ({
      id: `stud${i}`,
      wallId: "wall",
      level: 1,
      b: 50,
      h: 150,
      crossAxis: [1, 0, 0],
      start: [i * 0.6, 0, 0],
      end: [i * 0.6, 2.8, 0],
    })),
  };
  const r = buildWallBracing(p, {
    geometry: { levels: [{ index: 1, wallBaseY: 0, topY: 2.8, height: 2.8 }] },
    timber,
  });
  // Five 1.2×2.5 blanks need five sheets. Five 1.2×0.3 strips fit one more
  // sheet: 5×0.3 + 5×0.003 = 1.515 < 2.5 m, with a 0.985×1.25 remnant.
  // 6×2.8−1.5²=14.55 m²; ×0.012×620=108.252 kg.
  assert.equal(r.quantities.sheets, 6);
  near(r.quantities.sheetArea, 14.55);
  near(r.quantities.panelMass, 108.252);
  near(r.quantities.purchasedSheetArea, 18.75);
  near(r.quantities.wasteArea, 2.96875);
  near(r.quantities.reusableArea, 1.23125);
  assert.ok(r.instances.some((b) => b.role === "sheathingBlocking"));
  assert.ok(r.checks.find((c) => c.id === "wall-1-sheet-edges").unverifiedIds.length);
  for (const p of r.panels)
    near(
      sheetPolygons.area(
        sheetPolygons.intersect(p.localPolygon, sheetPolygons.rectangle(2.25, 0.8, 3.75, 2.3)),
      ),
      0,
    );
});

test("4×5 deck @600: alternating 2/3 sheets per 1.25 m row, end joints on actual joists", () => {
  const r = layoutSheetSurface(floorOptions());
  // Ten installed blanks, seven purchased sheets: four 2.4 m blanks,
  // two 1.6 m blanks, one sheet for both 1.2 m blanks; 0.4 m blanks use offcuts.
  assert.deepEqual(
    [1, 2, 3, 4].map((i) => r.sheets.filter((s) => s.row === i).length),
    [2, 3, 2, 3],
  );
  assert.equal(r.purchaseCount, 7);
  assert.equal(r.fullCount, 0);
  assert.equal(r.cutCount, 7);
  near(r.area, 20);
  near(r.mass, 223.2);
  near(r.unusedPercent, (100 * 1.875) / 21.875);
  near(r.cutting.reusableArea, 1.12125);
  near(r.cutting.wasteArea, 0.75375);
  assert.equal(r.lowerBound, 7);
  const ends = r.seams.filter((e) => Math.abs(e.a.x - e.b.x) < 1e-8);
  assert.ok(ends.length);
  assert.ok(ends.every((e) => e.status === "pass" && e.supportIds.length));
  assert.ok(r.seams.some((e) => e.status === "unverified")); // Long edges still need blocking.
});

test("stair hole is removed from polygons and self-weight, including partial stock tiles", () => {
  const options = floorOptions(),
    hole = sheetPolygons.rectangle(0.5, 0.5, 1.5, 1.5);
  const r = layoutSheetSurface({ ...options, holes: [hole] });
  near(r.area, 19);
  near(r.mass, 212.04);
  assert.equal(r.purchaseCount, 7);
  for (const p of r.panels) near(sheetPolygons.area(sheetPolygons.intersect(p.localPolygon, hole)), 0);
});

test("no framing cannot yield supported seams or pass", () => {
  const r = layoutSheetSurface({ ...floorOptions(), supports: [] });
  assert.ok(r.seams.length);
  assert.ok(r.seams.every((e) => e.status === "unverified" && e.stockSheetId));
  assert.ok(r.framing.parts.every((p) => p.spanCount === null));
});

test("two-span 18 mm OSB strip L=600 mm: M=0.108 kNm/m, stress=2 MPa, w=0.825314 mm", () => {
  const r = checkSheetDeck({ thickness: 18, span: 0.6, live: 2, E: 3500 });
  near(r.moment, 0.108);
  near(r.stress, 2);
  // Independent integrated beam curve, x/L=(1+sqrt(33))/16:
  // EI*w=q*(2*x^4−3*L*x^3+L^3*x)/48; q=2000 N/m, I=0.018³/12 m⁴.
  const L = 0.6,
    x = (L * (1 + Math.sqrt(33))) / 16;
  const hand =
    ((2000 * (2 * x ** 4 - 3 * L * x ** 3 + L ** 3 * x)) / 48 / ((3500e6 * 0.018 ** 3) / 12)) * 1000;
  near(hand, 0.825313768507235);
  near(r.deflection, hand);
  assert.equal(r.status, "unverified"); // Manufacturer test minima are not design resistance.
  assert.equal(checkSheetDeck({ thickness: 18, span: 0.6, live: 2 }).deflection, null);
  assert.equal(checkSheetDeck({ thickness: 18, span: 0.6, live: 2, designBending: 1 }).status, "fail");
});

test("explicit floor replaces 35 mm geometry; its net mass enters dead load and pile reactions exactly once", () => {
  const p = project();
  p.floor.wallSupportFraming = true;
  const before = calculateDesigner(p);
  p.sheathing = { floors: { product: "osb3-2500x1250", thickness: 18 } };
  const r = calculateDesigner(p);
  // Axis rectangle 4×5; outer rim boundaries are +75 mm on every side.
  // 4.15×5.15=21.3725 m²; ×0.018×620=238.5171 kg; ×g/1000=2.339053718715 kN.
  near(r.geometry.totalPlatformArea, 21.3725);
  near(r.sheetModel.mass, 238.5171);
  near(r.loads.dead - before.loads.dead, 2.339053718715);
  near(r.timber.mass, before.timber.mass);
  near(
    r.loads.rows.find((r) => r.id === "floor-layers").characteristic,
    before.loads.rows.find((r) => r.id === "floor-layers").characteristic,
  );
  near(r.foundation.characteristicSum, r.loads.totalCharacteristic);
  near(r.foundation.reactionSum, r.loads.totalDesign);
  near(r.loads.floorRouting.levels[0].sheetDead, 2.339053718715);
  near(before.geometry.levels[0].wallBaseY - r.geometry.levels[0].wallBaseY, 0.017);
  near(r.floorPlatform.wallSupports[0].deckThickness, 0.018);
  assert.ok(r.assumptions.some((a) => a.includes("floorDead") && a.includes("БЕЗ")));
});

test("floor sheet load reaches joist mechanics and opening headers as well as global reactions", () => {
  const p = project();
  p.floors = 2;
  p.levels = [
    { id: "l1", name: "Первый", index: 1, height: 2.8 },
    { id: "l2", name: "Второй", index: 2, height: 2.8 },
  ];
  p.walls = p.walls.flatMap((w) => [w, { ...w, id: `${w.id}-L2`, level: 2 }]);
  p.voids = [
    {
      id: "stair",
      kind: "stair",
      edgeSection: "50x250",
      level: 2,
      polygon: sheetPolygons.rectangle(1, 1, 2, 3),
    },
  ];
  const a = evaluateHouse(p);
  p.sheathing = { floors: { product: "osb3-2500x1250", thickness: 18 } };
  const b = evaluateHouse(p);
  const ha = a.result.floorOpenings.openings[0],
    hb = b.result.floorOpenings.openings[0];
  assert.ok(ha && hb);
  assert.equal(ha.headers.length, 2);
  const headerA = ha.headers[0],
    headerB = hb.headers[0];
  // (21.3725−2)/(20−2) × 0.018×620×g/1000 = deck pressure on the axial tributary strip.
  near(headerB.loads.floorDead - headerA.loads.floorDead, ((19.3725 / 18) * 0.018 * 620 * 9.80665) / 1000);
  assert.ok(b.result.sheetModel.pressureByLevel[2] > 0);
  near(b.result.sheetModel.surfaces.find((s) => s.kind === "floors" && s.level === 2).area, 19.3725);
  near(b.result.foundation.characteristicSum, b.result.loads.totalCharacteristic);
});

test("both wall faces double physical panels, pool cutting offcuts, share physical blocking, and exclude legacy wall estimate row", () => {
  const p = project();
  p.sheathing = { walls: { product: "osb3-2500x1250", thickness: 12, side: "exterior" } };
  const a = calculateDesigner(p),
    ea = calculateEstimate(p, a);
  p.sheathing.walls.side = "both";
  const b = calculateDesigner(p),
    eb = calculateEstimate(p, b);
  near(b.sheetModel.mass, 2 * a.sheetModel.mass);
  near(b.sheetModel.area, 2 * a.sheetModel.area);
  assert.ok(b.sheetModel.purchaseCount <= 2 * a.sheetModel.purchaseCount);
  assert.ok(b.sheetModel.purchaseCount >= Math.ceil(b.sheetModel.area / 3.125));
  near(b.timber.mass, a.timber.mass);
  assert.ok(!eb.rows.some((r) => r.id === "structural-panels"));
  assert.ok(
    eb.rows.find((r) => r.id === "sheet-osb3-2500x1250-12").quantity <=
      2 * ea.rows.find((r) => r.id === "sheet-osb3-2500x1250-12").quantity,
  );
  assert.equal(new Set(b.sheetModel.panels.map((p) => p.id)).size, b.sheetModel.panels.length);
});

test("procurement uses count × explicit sheet price with no duplicate floor sheathing or second waste factor", () => {
  const p = project();
  p.sheathing = { floors: { product: "osb3-2500x1250", thickness: 18 } };
  p.prices = { sheetPrices: { "osb3-2500x1250-18": 100 }, wastePercent: 50 };
  const r = calculateDesigner(p),
    e = calculateEstimate(p, r),
    purchase = r.sheetModel.purchases[0];
  const row = e.rows.find((r) => r.id === "sheet-osb3-2500x1250-18");
  near(row.total, purchase.count * 100);
  near(row.quantity, purchase.count);
  near(row.wasteQuantity, 0);
  near(e.rows.find((r) => r.id === "sheathing").quantity, 50.4 * 1.5); // 18 m perimeter × 2.8 m wall height; walls only: no floor deck here.
  p.prices.sheetPrices = { "invented-12": 100 };
  assert.equal(validateDesignerProject(p).valid, false);
});

test("generated roof sheets have true slope area and add mass once; rafter analysis receives extra pressure", () => {
  const spec = {
    width: 6,
    depth: 4,
    levels: [{ height: 2.8 }],
    roof: { shape: "mono", pitch: 15, framing: "rafters" },
    rooms: [],
  };
  const p = generateHouse(spec).project;
  p.bracing.method = "none";
  const a = evaluateHouse(p);
  p.sheathing = { roof: { product: "osb3-2500x1250", thickness: 12 } };
  const b = evaluateHouse(p),
    model = b.result.sheetModel;
  near(model.area, b.result.roofModel.area);
  near(model.mass, model.area * 0.012 * 620);
  near(b.result.loads.roofSheetWeight, (model.mass * 9.80665) / 1000);
  near(
    b.result.loads.dead - a.result.loads.dead,
    (model.mass * 9.80665) / 1000 + ((b.result.timber.mass - a.result.timber.mass) * 9.80665) / 1000,
  );
  near(b.result.foundation.characteristicSum, b.result.loads.totalCharacteristic);
  for (const zone of b.result.roofModel.zones) near(zone.extraRoofDead, 0.072961476);
  assert.ok(model.surfaces.every((s) => s.kind === "roof" && s.seams.length));
});

test("legacy bracing maps without changing material density, mass, dimensions or estimate method", () => {
  const p = project();
  p.bracing.method = "sheathing";
  p.bracing.sheetWidth = 1.22;
  p.bracing.sheetHeight = 2.44;
  p.bracing.sheetDensity = 650;
  const r = calculateDesigner(p),
    e = calculateEstimate(p, r);
  near(r.sheetModel.mass, r.bracingModel.quantities.panelMass);
  near(r.sheetModel.mass, r.sheetModel.area * 0.012 * 650);
  assert.equal(r.sheetModel.purchases[0].product, "legacy-wall-sheet");
  assert.ok(e.rows.some((r) => r.id === "structural-panels"));
  assert.ok(!e.rows.some((r) => r.id.startsWith("sheet-")));
});

test("selected roof with no roof geometry stays incomplete, not a zero-mass complete estimate", () => {
  const p = project();
  p.sheathing = { roof: { product: "osb3-2500x1250", thickness: 12 } };
  const r = calculateDesigner(p);
  assert.equal(r.sheetModel.complete, false);
  assert.equal(r.loads.complete, false);
  assert.equal(calculateEstimate(p, r).complete, false);
  assert.ok(r.checks.some((c) => c.id === "sheet-roof-missing" && c.status === "unverified"));
});

test("published Orion and engine-report projects still evaluate; imported roof accepts sheet geometry", async () => {
  for (const file of ["../public/projects/orion/project.json", "../public/engine-report.json"]) {
    const data = JSON.parse(await readFile(new URL(file, import.meta.url), "utf8")),
      p = data.project ?? data;
    assert.ok(evaluateHouse(p).result.loads);
    if (file.includes("orion")) {
      p.sheathing = { roof: { product: "osb3-2500x1250", thickness: 12 } };
      const r = evaluateHouse(p).result;
      assert.ok(r.sheetModel.mass > 0);
      near(r.sheetModel.mass, r.sheetModel.area * 0.012 * 620);
      near(r.foundation.characteristicSum, r.loads.totalCharacteristic, 1e-5);
      assert.ok(r.sourceRoofMechanics);
    }
  }
});

test("sheet outlines remove the triangulation diagonal of one stock sheet", () => {
  const polygons = [
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ],
  ];
  const panels = polygons.map((localPolygon, i) => ({
    id: `part-${i}`,
    stockSheetId: "one",
    localPolygon,
    polygon: localPolygon.map((q) => [q.x, 0, q.y]),
  }));
  const edges = sheetBoundarySegments(panels);
  assert.equal(edges.length, 4);
  near(sum(edges.map((e) => Math.hypot(...e.b.map((v, i) => v - e.a[i])))), 6);
});

test("real MCP generates, reports and atomically patches sheet fields without a preview socket", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-sheet-mcp-"));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "mcp/server.mjs")],
    cwd: root,
    env: { ...process.env, KARKAS_DATA_DIR: dataDir },
    stderr: "pipe",
  });
  const client = new Client({ name: "sheet-qa", version: "1.0.0" }, { capabilities: {} });
  t.after(async () => {
    await client.close();
    await transport.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  await client.connect(transport);
  async function call(name, args) {
    const response = await client.callTool({ name: "karkas_" + name, arguments: args });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    return response.structuredContent;
  }
  const created = await call("generate", {
    width: 4,
    depth: 5,
    levels: [{ height: 2.8 }],
    sheathing: { floors: { product: "osb3", thickness: 18 }, cutting: { kerf: 3, minReusable: 0.3 } },
  });
  const project_id = created.project_id;
  const sheets = await call("report", { project_id, topic: "sheets" });
  near(sum(sheets.data.surfaces.filter((s) => s.kind === "floors").map((s) => s.mass)), 238.5171);
  assert.equal(sheets.data.surfaces.find((s) => s.kind === "floors").alternatives.length, 3);
  assert.ok(sheets.data.cutting.summary.sheets >= sheets.data.cutting.summary.lowerBound);
  near(sheets.data.cutting.summary.balanceError, 0);
  assert.equal((await call("get_project", { project_id })).project.sheathing.floors.product, "osb3");
  const invalid = await client.callTool({
    name: "karkas_apply_patch",
    arguments: {
      project_id,
      expected_revision: 1,
      operations: [{ op: "replace", path: "/sheathing/floors/thickness", value: 21 }],
    },
  });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.error.code, "INVALID_PROJECT");
  assert.equal((await call("get_project", { project_id })).revision, 1);
  const updated = await call("apply_patch", {
    project_id,
    expected_revision: 1,
    operations: [{ op: "replace", path: "/sheathing/floors/thickness", value: 9 }],
  });
  assert.equal(updated.revision, 2);
  const after = await call("report", { project_id, topic: "sheets" });
  near(sum(after.data.surfaces.filter((s) => s.kind === "floors").map((s) => s.mass)), 119.25855);
});

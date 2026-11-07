import test from "node:test";
import assert from "node:assert/strict";
import { cutSheetParts, sheetPartsFromPanels } from "./sheet-cutting.js";
import { layoutSheetSurface, buildSheetBracing, buildSheetModel } from "./sheet-layout.js";
import { sheetProducts, resolveSheet, validateSheathing } from "./sheet-catalog.js";
import { sheathingSchema } from "../mcp/project-features.mjs";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const stock = () => resolveSheet({ product: "osb3-2500x1250", thickness: 12 });
const part = (id, width, height, extra = {}) => ({
  id,
  width,
  height,
  area: width * height,
  canRotate: false,
  ...extra,
});
function wallCase(product, prices) {
  const w = { id: "w", kind: "exterior", section: "50x150", level: 1, a: { x: 0, y: 0 }, b: { x: 6, y: 0 } };
  const project = {
    walls: [w],
    openings: [{ id: "window", wallId: "w", floor: 1, offset: 2.25, width: 1.5, height: 1.5, sill: 0.8 }],
    material: { density: 500 },
    prices,
    bracing: { method: "sheathing", sheetWidth: 1.25, sheetHeight: 2.5, thickness: 12, sheetDensity: 620 },
    sheathing: { walls: { product, thickness: 12, side: "exterior" } },
  };
  const context = {
    geometry: { levels: [{ index: 1, wallBaseY: 0, topY: 2.8, height: 2.8 }] },
    timber: {
      instances: Array.from({ length: 11 }, (_, i) => ({
        id: `s${i}`,
        wallId: "w",
        level: 1,
        b: 50,
        h: 150,
        crossAxis: [1, 0, 0],
        start: [i * 0.6, 0, 0],
        end: [i * 0.6, 2.8, 0],
      })),
    },
  };
  const bracingModel = buildSheetBracing(project, context);
  return { project, context, bracingModel, model: buildSheetModel(project, { ...context, bracingModel }) };
}
function floorCase(product = "osb3-2500x1250", extra = {}) {
  return layoutSheetSurface({
    id: "floor",
    kind: "floors",
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
      role: "joist",
      a: { x, y: 0 },
      b: { x, y: 5 },
      width: 0.05,
    })),
    toWorld: (q) => [q.x, 0, q.y],
    product,
    thickness: 12,
    ...extra,
  });
}
function verifyMap(plan) {
  assert.ok(plan.complete);
  assert.equal(plan.unplaced.length, 0);
  assert.equal(new Set(plan.stocks.map((s) => s.id)).size, plan.stocks.length);
  for (const s of plan.stocks) {
    // Every full-length guillotine split partitions one parent rectangle into
    // a blank, saw rectangles and child rectangles, with no lost area.
    const nodes = new Map([
      ...s.cutTree.map((n) => [n.id, n.rect]),
      ...s.remnants.map((r) => [r.id, r]),
      ...s.scrap.map((r) => [r.id, r]),
    ]);
    for (const node of s.cutTree) {
      const p = s.pieces.find((p) => p.id === node.partId),
        cuts = node.cuts.map((id) => s.cuts.find((c) => c.id === id));
      near(
        node.rect.width * node.rect.height,
        p.blankArea +
          sum(cuts.map((c) => c.area)) +
          sum(
            node.children.map((id) => {
              const r = nodes.get(id);
              assert.ok(r);
              return r.width * r.height;
            }),
          ),
      );
    }
    const rects = [...s.pieces, ...s.cuts, ...s.scrap, ...s.remnants];
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      assert.ok(
        r.x >= -1e-8 && r.y >= -1e-8 && r.x + r.width <= s.width + 1e-8 && r.y + r.height <= s.height + 1e-8,
      );
      for (const q of rects.slice(0, i)) {
        const dx = Math.min(r.x + r.width, q.x + q.width) - Math.max(r.x, q.x),
          dy = Math.min(r.y + r.height, q.y + q.height) - Math.max(r.y, q.y);
        assert.ok(dx <= 1e-8 || dy <= 1e-8, "Пересекающиеся детали/пропилы/остатки");
      }
    }
    near(s.width * s.height, s.area + s.wasteArea + s.reusableArea);
    for (const r of s.remnants)
      assert.ok(r.width + 1e-8 >= plan.minReusable && r.height + 1e-8 >= plan.minReusable);
  }
  near(plan.purchasedArea, plan.area + plan.wasteArea + plan.reusableArea);
  near(plan.balanceError, 0);
}

test("6×2.8 wall: 2500 format needs 6 sheets; 2800 format needs 5, with one net mass", () => {
  const a = wallCase("osb3-2500x1250"),
    b = wallCase("osb3-2800x1250");
  const x = a.model.purchases[0],
    y = b.model.purchases[0];
  // 5 tall 1.2×2.5 blanks + 5 strips 1.2×0.3. The strips use one sheet:
  // 5×0.3+5×0.003=1.515 <2.5; remnant 0.985×1.25=1.23125 m².
  assert.equal(x.count, 6);
  assert.equal(x.lowerBound, 5);
  near(x.purchasedArea, 18.75);
  near(x.reusableArea, 1.23125);
  near(x.wasteArea, 2.96875);
  // 2800×1250: five 1.2×2.8 blanks; 5×3.5=17.5 m² bought, 2.95 m² waste.
  assert.equal(y.count, 5);
  assert.equal(y.lowerBound, 5);
  near(y.purchasedArea, 17.5);
  near(y.wasteArea, 2.95);
  near(x.mass, 108.252);
  near(y.mass, 108.252);
  assert.equal(a.bracingModel.quantities.sheets, 6);
  assert.equal(b.bracingModel.quantities.sheets, 5);
  verifyMap(x);
  verifyMap(y);
});

test("4×5 floor: eight stock sheets, no slivers, 3 mm cuts, preserved main axis and an actual bay stagger", () => {
  const r = floorCase(),
    c = r.cutting;
  // Rows of 2.4+1.6 and 1.8+2.2 m (stagger one bay). The greedy 1.2+2.4+0.4 m row would save a
  // sheet with 0.4 m slivers; sheathing is a diaphragm, so every piece stays ≥ half a sheet.
  // Eight blanks, none pair up on one 2.5 m sheet (1.6+2.2, 1.8+2.2 … > 2.5), so eight sheets.
  assert.equal(c.count, 8);
  assert.equal(c.lowerBound, 7);
  near(c.purchasedArea, 25);
  near(c.area, 20);
  near(c.kerfArea, 0.03);
  near(c.wasteArea, 1.015);
  near(c.reusableArea, 3.985);
  assert.ok(r.sheets.every((s) => s.bounds.end - s.bounds.x >= 1.25 - 1e-9));
  assert.ok(c.stocks.flatMap((s) => s.pieces).every((p) => !p.rotated));
  assert.equal(r.framing.jointStatus, "pass");
  assert.equal(r.framing.staggerStatus, "pass");
  assert.ok(r.framing.offsets.every((o) => o.steps >= 1));
  assert.deepEqual(
    r.framing.rows.map((r) => r.joints),
    [[2.4], [1.8], [2.4], [1.8]],
  );
  for (const p of r.sheets.filter((p) => !p.bounds.x || p.bounds.end < 4))
    near(p.bounds.end / 0.6, Math.round(p.bounds.end / 0.6));
  verifyMap(c);
});

test("guillotine packing is deterministic under reordering input details", () => {
  const parts = floorCase().parts;
  const a = cutSheetParts(parts, stock()),
    b = cutSheetParts([...parts].reverse(), stock());
  assert.deepEqual(a, b);
  verifyMap(a);
});

test("kerf prevents an impossible fit; reusable threshold and zero-kerf override are explicit", () => {
  const halves = [part("a", 1.25, 1.25), part("b", 1.25, 1.25)];
  assert.equal(cutSheetParts(halves, stock()).count, 2); // 2×1.25 + 0.003 >2.5.
  assert.equal(cutSheetParts(halves, stock(), { kerf: 0 }).count, 1);
  const parts = [
    part("wall", 1.8, 1.25, { surfaceId: "wall", kind: "walls" }),
    part("floor", 0.6, 1.25, { surfaceId: "floor", kind: "floors" }),
  ];
  const reused = cutSheetParts(parts, stock());
  assert.equal(reused.count, 1);
  verifyMap(reused);
  assert.equal(cutSheetParts(parts, stock(), { minReusable: 0.8 }).count, 2);
});

test("wall rotation may fit a tall blank; a locked floor/roof major axis never rotates", () => {
  const wall = cutSheetParts([part("w", 1.2, 2.4, { canRotate: true, kind: "walls" })], stock());
  assert.equal(wall.count, 1);
  assert.equal(wall.stocks[0].pieces[0].rotated, true);
  const locked = cutSheetParts([part("f", 1.2, 2.4, { kind: "floors", canRotate: true })], stock());
  assert.equal(locked.complete, false);
  assert.deepEqual(locked.unplaced, ["f"]);
  verifyMap(wall);
});

test("auto format chooses minimum sheet cost, reports all formats, and respects an explicit format", () => {
  const auto = wallCase("osb3").model.surfaces[0];
  assert.equal(auto.product, "osb3-2800x1250");
  assert.equal(auto.alternatives.length, 3);
  assert.deepEqual(
    auto.alternatives.map((a) => [a.product, a.count, a.cost]),
    [
      ["osb3-2800x1250", 5, 8400],
      ["osb3-2440x1220", 6, 8574],
      ["osb3-2500x1250", 6, 9000],
    ],
  );
  // A cheap 2500 sheet does not buy a horizontal joint in the wall: the full-height 2800 sheet
  // stays first; price still orders the formats that need a joint.
  const changed = wallCase("osb3", { sheetPrices: { "osb3-2500x1250-12": 100 } }).model.surfaces[0];
  assert.equal(changed.product, "osb3-2800x1250");
  assert.deepEqual(
    changed.alternatives.map((a) => a.product),
    ["osb3-2800x1250", "osb3-2500x1250", "osb3-2440x1220"],
  );
  assert.equal(changed.alternatives[1].cost, 600);
  assert.equal(wallCase("osb3-2500x1250").model.surfaces[0].alternatives.length, 1);
  // 4×5 floor without slivers: 2500 sheets, 2.4+1.6 / 1.8+2.2 m rows, eight sheets.
  const floor = floorCase("osb3");
  assert.equal(floor.product, "osb3-2500x1250");
  assert.equal(floor.alternatives[0].cost, 12000);
});

test("global cutting shares offcuts across surfaces but preserves part IDs and orientation", () => {
  // Buying these two surfaces separately needs 2 sheets, jointly 1:
  // 1.8 + 0.003 + 0.6 + 0.003 = 2.406 <2.5 m, full width 1.25 m.
  const parts = [
    part("wall-a", 1.8, 1.25, { surfaceId: "wall", kind: "walls", canRotate: true }),
    part("floor-a", 0.6, 1.25, { surfaceId: "floor", kind: "floors" }),
  ];
  const joint = cutSheetParts(parts, stock());
  assert.equal(joint.count, 1);
  assert.equal(sum(parts.map((p) => cutSheetParts([p], stock()).count)), 2);
  assert.deepEqual(
    new Set(joint.stocks.flatMap((s) => s.pieces.map((p) => p.id))),
    new Set(parts.map((p) => p.id)),
  );
  assert.equal(joint.stocks[0].pieces.find((p) => p.id === "floor-a").rotated, false);
  verifyMap(joint);
});

test("blank machining waste includes opening cutouts without changing net physical area", () => {
  const r = wallCase("osb3-2500x1250").model.purchases[0];
  near(sum(r.stocks.map((s) => s.cutoutWasteArea)), 2.25);
  near(sum(r.stocks.flatMap((s) => s.pieces).map((p) => p.blankArea)), 16.8);
  near(r.area, 14.55);
  verifyMap(r);
});

test("strict core and MCP accept material-only products and cutting options, reject malformed defaults", () => {
  for (const product of ["osb3", "plywood-fk", "plywood-fsf"]) {
    const p = { walls: { product, thickness: 12, side: "exterior" }, cutting: { kerf: 3, minReusable: 0.3 } };
    assert.equal(validateSheathing(p).length, 0);
    assert.ok(sheathingSchema.safeParse(p).success);
  }
  for (const cutting of [
    null,
    [],
    { kerf: -1 },
    { kerf: NaN },
    { minReusable: -0.1 },
    { minReusable: "0.3" },
    { minimum: 0.3 },
  ]) {
    assert.ok(validateSheathing({ cutting }).length);
    assert.equal(sheathingSchema.safeParse({ cutting }).success, false);
  }
  for (const invalid of [
    [part("bad", NaN, 1)],
    [part("bad", 1, 0)],
    [part("same", 1, 1), part("same", 1, 1)],
  ])
    assert.throws(() => cutSheetParts(invalid, stock()), /Раскрой листов/);
  for (const product of sheetProducts)
    assert.ok(product.propertiesBasis.includes(product.material === "osb3" ? "EN 300" : "ГОСТ 3916.1"));
});

test("coincident floor joints fail the actual-bay stagger check", () => {
  const r = floorCase("osb3-2500x1250", { stagger: false });
  assert.equal(r.framing.staggerStatus, "fail");
  assert.ok(r.framing.failStaggerIds.length);
  assert.ok(r.framing.offsets.some((o) => o.steps === 0));
});

test("house 10×8 chooses one automatic format per material/thickness from whole-house cutting", async () => {
  const { generateHouse } = await import("./house-generator.js");
  const { evaluateHouse } = await import("./house-engine.js");
  // Generator defaults: one 2.8 m storey, 25° gable; no rooms/openings.
  const p = generateHouse({ width: 10, depth: 8 }).project;
  p.sheathing = {
    walls: { product: "osb3", thickness: 12, side: "exterior" },
    floors: { product: "osb3", thickness: 18 },
    roof: { product: "osb3", thickness: 12 },
  };
  const original = structuredClone(p.sheathing);
  const report = evaluateHouse(p),
    model = report.result.sheetModel;
  assert.deepEqual(p.sheathing, original);
  assert.ok(model.surfaces.some((s) => s.kind === "roof"));
  const selection = model.formatSelections.find((g) => g.material === "osb3" && g.thickness === 12);
  assert.equal(new Set(model.surfaces.filter((s) => s.thickness === 12).map((s) => s.product)).size, 1);
  assert.equal(report.estimate.rows.filter((r) => /^sheet-osb3-.*-12$/.test(r.id)).length, 1);
  // Independent full-house evaluations with all 12 mm surfaces fixed to each candidate.
  for (const alt of selection.alternatives) {
    const fixed = structuredClone(p);
    fixed.sheathing.walls.product = fixed.sheathing.roof.product = alt.product;
    const reference = evaluateHouse(fixed);
    const row = reference.estimate.rows.find((r) => /^sheet-osb3-.*-12$/.test(r.id));
    assert.equal(alt.count, row.quantity);
    assert.equal(alt.cost, row.total);
    near(
      alt.wastePercent,
      reference.result.sheetModel.purchases.find((r) => r.thickness === 12).wastePercent,
    );
  }
  // Walls first avoid horizontal joints (full-height sheets), then the cheapest cutting.
  const jointless = Math.min(...selection.alternatives.map((a) => a.horizontalJoints));
  assert.equal(selection.alternatives[0].horizontalJoints, jointless);
  assert.equal(
    selection.alternatives[0].cost,
    Math.min(...selection.alternatives.filter((a) => a.horizontalJoints === jointless).map((a) => a.cost)),
  );
  const row = report.estimate.rows.find((r) => /^sheet-osb3-.*-12$/.test(r.id));
  // 2.8 m storey: 2800×1250 sheets cover the wall height in one piece (no horizontal joint);
  // 71 sheets × illustrative 1680 RUB/sheet = 119280 RUB (2440×1220 would be cheaper but jointed).
  assert.equal(row.id, "sheet-osb3-2800x1250-12");
  assert.equal(row.quantity, 71);
  assert.equal(row.total, 71 * 1680);
  for (const surface of model.surfaces) assert.equal(surface.alternatives.length, 3);
});

test("explicit surface format stays fixed while automatic choice includes its shared cutting pool", async () => {
  const { generateHouse } = await import("./house-generator.js");
  const { evaluateHouse } = await import("./house-engine.js");
  const p = generateHouse({ width: 10, depth: 8 }).project;
  p.sheathing = {
    walls: { product: "osb3-2500x1250", thickness: 12, side: "exterior" },
    roof: { product: "osb3", thickness: 12 },
  };
  const model = evaluateHouse(p).result.sheetModel;
  assert.ok(model.surfaces.filter((s) => s.kind === "walls").every((s) => s.product === "osb3-2500x1250"));
  const selection = model.formatSelections[0];
  assert.deepEqual(selection.kinds, ["roof"]);
  const best = selection.alternatives[0];
  assert.equal(
    best.count,
    model.purchases.reduce((n, r) => n + r.count, 0),
  );
  assert.ok(model.surfaces.filter((s) => s.kind === "roof").every((s) => s.product === best.product));
  p.sheathing.roof.product = "osb3-2800x1250";
  const fixed = evaluateHouse(p);
  assert.equal(fixed.estimate.rows.filter((r) => /^sheet-osb3-.*-12$/.test(r.id)).length, 2);
});

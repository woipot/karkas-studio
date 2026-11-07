import test from "node:test";
import assert from "node:assert/strict";
import { humanLabel, sheetPieceGeometry, groupSheetStocks } from "./materials-data.js";
import {
  defaultWizardForm,
  wizardToGeneratorSpec,
  wizardSheathingDefaults,
  wizardWallSystemChange,
  wizardJoistSpacingChange,
} from "./wizard-spec.js";
import { buildMaterialDemo } from "./material-demos.js";
import { runEngineTask } from "./engine-tasks.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const rectangle = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const project = { walls: [{ id: "GEN-L1-W1" }, { id: "GEN-L1-W2" }] };
const model = {
  surfaces: [
    { id: "roof-roof-level-1-1-6", kind: "roof" },
    { id: "roof-roof-level-1-1-7", kind: "roof" },
  ],
  panels: [
    {
      id: "wall-panel",
      wallId: "GEN-L1-W1",
      sheetSide: "exterior",
      sheetColumn: 3,
      layoutPartId: "SHEET-GEN-L1-W1-1-3-1",
    },
  ],
};

test("human product and purchase-sheet labels contain readable formats and global numbers", () => {
  assert.equal(humanLabel("osb3-2500x1250"), "ОСП-3 2500×1250");
  assert.equal(humanLabel("osb3-2440x1220-12", { type: "product" }), "ОСП-3 2440×1220");
  assert.equal(humanLabel({ product: "plywood-fsf-1525x1525" }, { type: "product" }), "Фанера ФСФ 1525×1525");
  assert.equal(
    humanLabel(
      { id: "CUT-hidden", product: "osb3-2440x1220", thickness: 12 },
      { type: "stock", index: 6, total: 46 },
    ),
    "Лист 7 из 46 · ОСП-3 2440×1220 · 12 мм",
  );
});
test("human floor, roof and wall labels resolve placement metadata without exposing identifiers", () => {
  assert.equal(humanLabel("floor-L1-R1-C1", { model }), "Пол 1 этажа · ряд 1 · лист 1");
  assert.equal(humanLabel("floor-L2-R3-C4", { model }), "Пол 2 этажа · ряд 3 · лист 4");
  assert.equal(humanLabel("roof-roof-level-1-1-7-R2-C3", { model }), "Кровля, скат 2 · ряд 2 · лист 3");
  assert.equal(
    humanLabel({ id: "roof-roof-level-1-1-6-R2-C3", surfaceId: model.surfaces[0].id }, { model }),
    "Кровля, скат 1 · ряд 2 · лист 3",
  );
  assert.equal(
    humanLabel({ id: "roof-roof-level-1-1-7-R1-C2", surfaceId: model.surfaces[1].id }, { model }),
    "Кровля, скат 2 · ряд 1 · лист 2",
  );
  assert.equal(humanLabel(model.panels[0], { project, model }), "Стена Ст-01 · снаружи · колонка 3");
  assert.equal(
    humanLabel({ ...model.panels[0], sheetSide: "interior", wallId: "GEN-L1-W2" }, { project }),
    "Стена Ст-02 · изнутри · колонка 3",
  );
  assert.equal(humanLabel({ wallId: "Ст-19" }, { type: "wall" }), "Стена Ст-19");
  assert.equal(humanLabel("unknown-machine-id", { project, model }), "Листовая деталь");
});
test("insulation assemblies share wall labels and have no raw zone IDs", () => {
  assert.equal(
    humanLabel({ id: "GEN-L1-W1-L1", type: "walls" }, { type: "assembly", project }),
    "Стена Ст-01 · этаж 1",
  );
  assert.equal(
    humanLabel({ id: "roof-machine-ceiling", type: "roof", name: "Кровля · потолок" }, { type: "assembly" }),
    "Потолок",
  );
});
test("triangulated rectangle has four perimeter edges, no internal diagonal and zero cutout waste", () => {
  const poly = rectangle(0, 0, 2, 1);
  const result = sheetPieceGeometry({
    x: 0,
    y: 0,
    width: 2,
    height: 1,
    polygons: [
      [poly[0], poly[1], poly[2]],
      [poly[0], poly[2], poly[3]],
    ],
  });
  assert.equal(result.edges.length, 4);
  assert.ok(result.edges.every(({ a, b }) => Math.abs(a.x - b.x) < 1e-7 || Math.abs(a.y - b.y) < 1e-7));
  near(result.cutoutArea, 0);
});
test("partially shared triangle edges disappear, while a real slope and cutout area remain", () => {
  const piece = {
    x: 0,
    y: 0,
    width: 2,
    height: 1,
    polygons: [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 0.5 },
      ],
      [
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 1, y: 0.5 },
      ],
      [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
        { x: 0, y: 1 },
      ],
    ],
  };
  assert.equal(sheetPieceGeometry(piece).edges.length, 4);
  // One triangle in a 2×1 blank: 1 m² installed + 1 m² cutout waste.
  const triangle = sheetPieceGeometry({
    ...piece,
    polygons: [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 1 },
      ],
    ],
  });
  assert.equal(triangle.edges.length, 3);
  near(triangle.cutoutArea, 1);
  assert.ok(triangle.edges.some(({ a, b }) => a.x !== b.x && a.y !== b.y));
});
test("window hole has an inner contour and is classified as cutout waste, not a reusable remnant", () => {
  // Unit square minus central 0.5×0.5 hole: 0.75 m² net, 0.25 m² cutout.
  const g = sheetPieceGeometry({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    polygons: [
      rectangle(0, 0, 1, 0.25),
      rectangle(0, 0.75, 1, 0.25),
      rectangle(0, 0.25, 0.25, 0.5),
      rectangle(0.75, 0.25, 0.25, 0.5),
    ],
  });
  near(g.cutoutArea, 0.25);
  assert.equal(g.edges.length, 8);
});
function stock(id, { whole = false, polygons, kerf = 0.003, product = "osb3-2500x1250" } = {}) {
  const width = whole ? 2.5 : 2;
  return {
    id,
    product,
    thickness: 12,
    width: 2.5,
    height: 1.25,
    area: width * 1.25,
    pieces: [
      {
        id: `part-${id}`,
        x: 0,
        y: 0,
        width,
        height: 1.25,
        area: width * 1.25,
        polygons: polygons ?? [rectangle(0, 0, width, 1.25)],
        rotated: false,
      },
    ],
    cuts: whole ? [] : [{ x: 2, y: 0, width: kerf, height: 1.25 }],
    remnants: whole ? [] : [{ x: 2 + kerf, y: 0, width: 0.5 - kerf, height: 1.25 }],
    scrap: [],
  };
}
test("identical schemes ignore piece IDs and triangulation; all whole sheets form one last group", () => {
  const q = rectangle(0, 0, 2, 1.25);
  const stocks = [
    stock("whole-1", { whole: true }),
    stock("cut-1"),
    stock("whole-2", { whole: true }),
    stock("cut-2", {
      polygons: [
        [q[0], q[1], q[2]],
        [q[0], q[2], q[3]],
      ],
    }),
  ];
  const before = structuredClone(stocks),
    groups = groupSheetStocks({ cutting: { stocks } });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Схема А");
  assert.equal(groups[0].stocks.length, 2);
  assert.equal(groups[0].full, false);
  assert.equal(groups[1].label, "Целые листы без раскроя");
  assert.equal(groups[1].stocks.length, 2);
  assert.equal(groups.flatMap((g) => g.stocks).length, 4);
  assert.deepEqual(stocks, before);
});
test("different kerfs, formats and physical contours never collapse into one scheme", () => {
  const stocks = [
    stock("a"),
    stock("b", { kerf: 0.004 }),
    stock("c", { product: "osb3-2440x1220" }),
    stock("d", {
      polygons: [
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 1.25 },
        ],
      ],
    }),
  ];
  assert.equal(groupSheetStocks({ cutting: { stocks } }).length, 4);
  assert.ok(groupSheetStocks({ cutting: { stocks } }).every((g) => !g.full));
  assert.deepEqual(groupSheetStocks(), []);
});
test("28 genuine whole sheets share one card after cut schemes; pagination counts groups", () => {
  const stocks = [
    ...Array.from({ length: 28 }, (_, i) => stock(`full-${i}`, { whole: true })),
    ...Array.from({ length: 4 }, (_, i) => stock(`cut-${i}`)),
  ];
  const groups = groupSheetStocks({ cutting: { stocks } });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].stocks.length, 4);
  assert.equal(groups[1].stocks.length, 28);
  assert.equal(Math.ceil(groups.length / 6), 1);
  assert.equal(groups[1].full, true);
});
test("wizard starts with OSB walls 12 outside, floor 22 at 600, roof disabled; beam walls are bare", () => {
  const form = defaultWizardForm(),
    spec = wizardToGeneratorSpec(form);
  assert.deepEqual(form.sheathing, {
    walls: { product: "osb3", thickness: 12, side: "exterior" },
    floors: { product: "osb3", thickness: 22 },
  });
  assert.equal(spec.joistSpacing, 0.6);
  assert.equal(spec.sheathing.roof, undefined);
  assert.equal(defaultWizardForm({ wallSystem: "profiledBeam" }).sheathing.walls, undefined);
  // Accepted initial choices, not proof of deck strength: 600 mm → 22 mm, ≤400 mm → 18 mm.
  assert.equal(wizardSheathingDefaults("frame", 0.4).floors.thickness, 18);
  assert.equal(wizardSheathingDefaults("frame", 0.3).floors.thickness, 18);
  assert.equal(wizardSheathingDefaults("frame", 0.6).floors.thickness, 22);
});
test("switching system/joist pitch updates defaults, keeps user choices and never mutates the form", () => {
  const form = defaultWizardForm(),
    before = structuredClone(form);
  const tighter = { ...form, ...wizardJoistSpacingChange(form, 0.4) };
  assert.equal(tighter.sheathing.floors.thickness, 18);
  assert.equal(wizardToGeneratorSpec(tighter).joistSpacing, 0.4);
  assert.equal(wizardJoistSpacingChange(tighter, 0.6).sheathing.floors.thickness, 22);
  const custom = {
    ...form,
    sheathing: { floors: { product: "osb3", thickness: 15 }, roof: { product: "osb3", thickness: 12 } },
  };
  assert.equal(wizardJoistSpacingChange(custom, 0.4).sheathing.floors.thickness, 15);
  const beam = { ...form, ...wizardWallSystemChange(form, "profiledBeam") };
  assert.equal(beam.sheathing.walls, undefined);
  assert.deepEqual(wizardWallSystemChange(beam, "frame").sheathing.walls, form.sheathing.walls);
  assert.deepEqual(form, before);
});
test("beam demo has a door, three windows, actual casing and settlement gaps from the engine", async () => {
  const { project } = buildMaterialDemo("beam");
  assert.equal(project.openings.filter((o) => o.type === "door").length, 1);
  assert.equal(project.openings.filter((o) => o.type === "window").length, 3);
  const { report } = await runEngineTask("demo", { demo: "beam" });
  assert.equal(report.result.timber.instances.filter((b) => b.role === "beamCasing").length, 15);
  const openings = report.result.profiledBeam.walls.flatMap((w) => w.openings);
  assert.equal(openings.length, 4);
  assert.ok(openings.every((o) => o.actualGap >= o.requiredGap));
  // Demo hand reference: 3 windows ×4 casing boards + door ×3 =15; wall shrinkage 2800×.06=168 mm.
  near(report.result.profiledBeam.walls[0].settlementMM, 168);
  assert.ok(report.result.assumptions.some((a) => a.includes("0,9×2,1")));
});

// Example: 6×10 frame house with let-in braces (customer brief). Run: node scripts/example-house-6x10.mjs
import { writeFileSync } from "node:fs";
import { generateHouse } from "../src/house-generator.js";
import { evaluateHouse } from "../src/house-engine.js";
import { exportPlanSVG } from "../src/house-exports.js";
const R = (x1, y1, x2, y2) => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];
const fx = (id, kind, label, poly, frontEdge) => ({ id, kind, label, polygon: poly, frontEdge });
const { project: p } = generateHouse({
  name: "Дом 6×10 · каркас с укосинами",
  width: 10,
  depth: 6,
  structure: { bearingWalls: false },
  bracing: { method: "letIn" },
});
const part = (id, a, b) => ({ id, level: 1, a, b, kind: "partition", section: "50x100", studStep: 0.6 });
// Layout (plan, y down): bedroom x 0–2.8; central column x 2.8–5.8 with bathroom + tech room on top
// (both entered from the hall) and the warm hall at the bottom; kitchen-living x 5.8–10.
p.walls.push(
  part("P-BED", { x: 2.8, y: 0.075 }, { x: 2.8, y: 5.925 }),
  part("P-KL", { x: 5.8, y: 0.075 }, { x: 5.8, y: 5.925 }),
  part("P-HALL", { x: 2.85, y: 2.6 }, { x: 5.75, y: 2.6 }),
  part("P-BATH", { x: 4.35, y: 0.075 }, { x: 4.35, y: 2.55 }),
);
const op = (id, wallId, type, offset, width, height, sill) => ({
  id,
  wallId,
  type,
  offset,
  width,
  height,
  sill,
  level: 1,
  floor: 1,
});
p.openings = [
  op("D-ENTRY", "GEN-L1-W3", "door", 10 - 4.8, 1.0, 2.1, 0), // x 3.8–4.8, bottom long side
  op("W-BED", "GEN-L1-W3", "window", 10 - 2.1, 1.4, 1.4, 0.8), // bedroom window, bottom side
  op("W-LIVING", "GEN-L1-W3", "window", 10 - 9.0, 1.8, 1.5, 0.7), // living window, bottom side
  op("W-LIVING-END", "GEN-L1-W2", "window", 2.2, 1.6, 1.4, 0.8), // gable end
  op("W-KITCHEN", "GEN-L1-W1", "window", 7.0, 1.2, 1.0, 1.1), // over the sink
  op("W-BATH", "GEN-L1-W1", "window", 3.85, 0.4, 0.6, 1.5), // small bathroom window above the basin
  op("W-TECH", "GEN-L1-W1", "window", 4.9, 0.6, 0.6, 1.5),
  op("D-BED", "P-BED", "door", 2.8 - 0.075, 0.9, 2.1, 0), // y 2.8–3.7 from the hall
  op("D-LIVING", "P-KL", "door", 2.8 - 0.075, 1.1, 2.1, 0), // y 2.8–3.9 hall → kitchen-living
  op("D-BATH", "P-HALL", "door", 3.2 - 2.85, 0.7, 2.1, 0), // x 3.2–3.9 from the hall
  op("D-TECH", "P-HALL", "door", 4.75 - 2.85, 0.75, 2.1, 0), // x 4.75–5.5 from the hall
];
p.roomSchedule = [
  {
    id: "BED",
    name: "Спальня",
    kind: "room",
    level: 1,
    polygon: R(0.075, 0.075, 2.75, 5.925),
    labelPoint: { x: 1.4, y: 4.6 },
    fixtures: [
      fx("BED-WARDROBE", "wardrobe", "Шкаф 600 мм · 2,4 м", R(0.2, 0.075, 2.6, 0.675), 2),
      fx(
        "BED-160",
        "bed",
        "Кровать 1600×2000",
        [
          { x: 0.075, y: 1.9 },
          { x: 2.075, y: 1.9 },
          { x: 2.075, y: 3.5 },
          { x: 0.075, y: 3.5 },
        ],
        1,
      ),
    ],
  },
  {
    id: "ENTRY",
    name: "Тёплая прихожая",
    kind: "room",
    level: 1,
    polygon: R(2.85, 2.65, 5.75, 5.925),
    labelPoint: { x: 4.4, y: 3.8 },
    planLabel: "Прихожая",
    fixtures: [
      fx(
        "ENTRY-SOFA",
        "sofa",
        "Банкетка/софа 1600",
        [
          { x: 2.85, y: 5.8 },
          { x: 2.85, y: 4.2 },
          { x: 3.65, y: 4.2 },
          { x: 3.65, y: 5.8 },
        ],
        2,
      ),
      fx("ENTRY-CLOSET", "wardrobe", "Шкаф 450 мм", R(5.3, 4.4, 5.75, 5.8), 3),
    ],
  },
  {
    id: "BATH",
    name: "Санузел с душем",
    kind: "room",
    level: 1,
    polygon: R(2.85, 0.075, 4.3, 2.55),
    labelPoint: { x: 3.57, y: 2.15 },
    planLabel: "С/у",
    fixtures: [
      fx("SHOWER", "shower", "Душ 900×900", R(2.85, 0.075, 3.75, 0.975), 2),
      fx("WC", "wc", "WC", R(2.85, 1.25, 3.5, 1.65), 1),
      fx("WASHBASIN", "washbasin", "Раковина", R(3.8, 1.15, 4.3, 1.75), 3),
    ],
  },
  {
    id: "TECH",
    name: "Техпомещение",
    kind: "room",
    level: 1,
    polygon: R(4.4, 0.075, 5.75, 2.55),
    labelPoint: { x: 4.9, y: 2.15 },
    planLabel: "Тех.",
    fixtures: [
      fx("TECH-EQ", "utilityEquipment", "Котёл / бойлер / щит", R(4.45, 0.075, 5.7, 0.675), 2),
      fx("WASHER", "washer", "Стиралка", R(5.1, 1.0, 5.75, 1.6), 3),
    ],
  },
  {
    id: "LIVING",
    name: "Кухня-гостиная",
    kind: "room",
    level: 1,
    polygon: R(5.85, 0.075, 9.925, 5.925),
    labelPoint: { x: 7.6, y: 3.0 },
    fixtures: [
      fx("FRIDGE", "fridge", "Холодильник", R(5.85, 0.075, 6.5, 0.725), 2),
      fx("KITCHEN-RUN", "kitchenRun", "Столешница", R(6.5, 0.075, 9.3, 0.675), 2),
      fx("SINK", "sink", "Мойка", R(7.3, 0.075, 8.0, 0.675), 2),
      fx("HOB", "hob", "Плита", R(8.6, 0.075, 9.2, 0.675), 2),
      fx("TABLE", "table", "Обеденный стол", R(7.1, 2.0, 8.5, 2.9), 0),
      fx(
        "SOFA",
        "sofa",
        "Диван",
        [
          { x: 9.925, y: 4.0 },
          { x: 9.925, y: 5.8 },
          { x: 9.0, y: 5.8 },
          { x: 9.0, y: 4.0 },
        ],
        2,
      ),
    ],
  },
];
// Roof overhangs protect the walls from rain: 500 mm at the eaves (long walls, low/high sides of the
// slopes), 400 mm at the gables (start/end). Plan-projection distances from the wall axes.
// Long support struts of the trusses (1.87 m) get one continuous lateral brace at mid-length
// (продольная связь раскосов через все фермы): out-of-plane l0 = 0.95 m.
p.roof = { ...p.roof, overhangs: { low: 0.5, high: 0.5, start: 0.4, end: 0.4 }, webRestraint: 0.95 };
// Gable overhangs are carried by real outlookers of the roof battens: counter-battens 50×50,
// battens 50×100 @350 mm (metal tile), façade service battens 45×45 for the ventilated gap.
p.auxiliaryTimber = {
  enabled: true,
  wallService: "45x45",
  roofCounter: "50x50",
  roofBattens: "50x100",
  roofInternal: "48x148",
  roofService: "45x45",
  roofBattenStep: 0.35,
  roofInternalStep: 0.6,
  roofAboveRafterGap: 0,
  roofInterior: false,
  ceilingBattens: false,
};
// Small covered porch centred on the entrance door (x 3.8–4.8 → porch x 2.8–5.8), shared grillage.
p.annexes = [
  {
    id: "PORCH",
    name: "Крытая веранда у входа · 3 × 1,8 м",
    kind: "coveredTerrace",
    attachedWallId: "GEN-L1-W3",
    offset: 10 - 5.8, // W3 runs from x = 10 to x = 0
    width: 3,
    depth: 1.8,
    gap: 0.075,
    foundation: {
      spacing: 3,
      capacity: 40,
      edgeInset: 0.3,
      grillage: { section: "50x200", plies: 3, capSize: 250, deflectionRatio: 300 },
      mode: "shared",
    },
    floor: { section: "50x200", spacing: 0.5, deckThickness: 0.028, blockingStep: 1.2 },
    roof: {
      pitch: 10,
      lowEaveHeight: 2.2, // high side 2.2 + 1.8·tan10° ≈ 2.52 m stays under the main eave (wall top 2.8 m)
      section: "50x150",
      spacing: 0.6,
      beamSection: "100x200",
      beamPlies: 1,
      postSection: "100x100",
      battenSection: "50x100",
      battenStep: 0.6,
      overhangs: { low: 0.3, high: 0, start: 0.2, end: 0.2 },
    },
    // SP 20.13330 табл. 8.3: террасы/балконы 2,0 кПа; снег и ветер — как у дома.
    loads: { floorDead: 0.25, live: 2.0, roofDead: 0.3, snow: 1.5, wind: 0.3, snowMu: 1, deckSnowFactor: 1 },
  },
];
// Sheets: OSB-3 12 mm on the outside of the walls (wind barrier / stiffness in addition to the let-in braces),
// moisture-resistant birch plywood ФСФ 21 mm floor deck on joists @600 mm. No continuous roof deck
// (needed only under soft roofing).
p.sheathing = {
  walls: { product: "osb3", thickness: 12, side: "exterior" },
  floors: { product: "plywood-fsf", thickness: 21 },
};
// Let-in braces give no weak-axis restraint: one row of horizontal blocking (ригели) at mid-height.
p.material = { ...p.material, studRestraint: 1.35 };
p.site = {
  country: "RU",
  planView: { yAxis: "down", entranceAt: "bottom", bedroomAt: "left" },
  assumptions: [
    "Пример по описанию заказчика: дом 6×10 м, каркас 50×150 с врезными укосинами 25×100. Вход и спальня — по нижней длинной стороне плана. Санузел с душем и техпомещение — с входом из прихожей, мокрые зоны рядом; вентиляция санузла, трапы и уклоны не проектировались. Мебель — геометрические резервы, не нагрузки.",
    "Стойки раскреплены из плоскости горизонтальными ригелями-распорками на середине высоты (шаг 1,35 м): при врезных укосинах без обшивки без них гибкость стойки 2,65 м превышает предел СП 64 (λ 184 > 120).",
  ],
};
const t = Date.now();
const rep = evaluateHouse(p, {});
console.log(
  "ms",
  Date.now() - t,
  "status",
  rep.summary.status,
  "fails",
  rep.summary.failedChecks,
  "rooms",
  rep.summary.rooms,
  "area",
  rep.summary.area,
  "₽",
  rep.summary.estimateTotal,
);
console.log(
  "FAILS:",
  rep.result.checks
    .filter((c) => c.status === "fail")
    .map((c) => c.id + " " + (c.utilization?.toFixed?.(2) ?? "") + " " + (c.label ?? ""))
    .join("\n"),
);
console.log(
  "rooms:",
  (rep.planning?.rooms ?? rep.result.planning?.rooms ?? [])
    .map((r) => r.name + " " + r.area?.toFixed?.(1))
    .join(", "),
);
console.log("bracing roles:", rep.result.timber.instances.filter((b) => /brace/i.test(b.role)).length);
rep.engine = { ...rep.engine, projectId: "house-6x10-letin", revision: 1 };
const dir = new URL("../public/projects/house-6x10/", import.meta.url);
writeFileSync(new URL("engine-report.json", dir), JSON.stringify(rep) + "\n");
writeFileSync(new URL("plan.svg", dir), exportPlanSVG(rep));

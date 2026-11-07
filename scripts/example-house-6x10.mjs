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
p.walls.push(
  part("P-BED", { x: 3.1, y: 0.075 }, { x: 3.1, y: 5.925 }),
  part("P-KL", { x: 5.8, y: 0.075 }, { x: 5.8, y: 5.925 }),
  part("P-TECH", { x: 3.15, y: 2.6 }, { x: 5.75, y: 2.6 }),
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
  op("D-ENTRY", "GEN-L1-W3", "door", 10 - 5.0, 1.0, 2.1, 0), // x 4.0–5.0, bottom long side
  op("W-BED", "GEN-L1-W3", "window", 10 - 2.3, 1.4, 1.4, 0.8), // bedroom window, bottom side
  op("W-LIVING", "GEN-L1-W3", "window", 10 - 9.0, 1.8, 1.5, 0.7), // living window, bottom side
  op("W-LIVING-END", "GEN-L1-W2", "window", 2.2, 1.6, 1.4, 0.8), // gable end
  op("W-KITCHEN", "GEN-L1-W1", "window", 7.0, 1.2, 1.0, 1.1), // over the sink
  op("W-TECH", "GEN-L1-W1", "window", 4.2, 0.6, 0.6, 1.5),
  op("D-BED", "P-BED", "door", 2.8 - 0.075, 0.9, 2.1, 0), // y 2.8–3.7 from the hall
  op("D-LIVING", "P-KL", "door", 2.8 - 0.075, 1.1, 2.1, 0), // y 2.8–3.9 hall → kitchen-living
  op("D-TECH", "P-TECH", "door", 4.1 - 3.15, 0.8, 2.1, 0), // x 4.1–4.9 from the hall
];
p.roomSchedule = [
  {
    id: "BED",
    name: "Спальня",
    kind: "room",
    level: 1,
    polygon: R(0.075, 0.075, 3.05, 5.925),
    labelPoint: { x: 1.55, y: 4.6 },
    fixtures: [
      fx("BED-WARDROBE", "wardrobe", "Шкаф 600 мм · 2,7 м", R(0.2, 0.075, 2.9, 0.675), 2),
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
    polygon: R(3.15, 2.65, 5.75, 5.925),
    labelPoint: { x: 4.45, y: 3.9 },
    planLabel: "Прихожая",
    fixtures: [
      fx(
        "ENTRY-SOFA",
        "sofa",
        "Банкетка/софа 1600",
        [
          { x: 3.15, y: 5.8 },
          { x: 3.15, y: 4.2 },
          { x: 3.95, y: 4.2 },
          { x: 3.95, y: 5.8 },
        ],
        2,
      ),
      fx("ENTRY-CLOSET", "wardrobe", "Шкаф 450 мм", R(5.3, 4.4, 5.75, 5.8), 3),
    ],
  },
  {
    id: "TECH",
    name: "Техпомещение",
    kind: "room",
    level: 1,
    polygon: R(3.15, 0.075, 5.75, 2.55),
    labelPoint: { x: 4.45, y: 1.3 },
    fixtures: [fx("TECH-EQ", "utilityEquipment", "Котёл / бойлер / щит", R(3.2, 0.1, 4.6, 0.7), 2)],
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
// Let-in braces give no weak-axis restraint: one row of horizontal blocking (ригели) at mid-height.
p.material = { ...p.material, studRestraint: 1.35 };
p.site = {
  country: "RU",
  planView: { yAxis: "down", entranceAt: "bottom", bedroomAt: "left" },
  assumptions: [
    "Пример по описанию заказчика: дом 6×10 м, каркас 50×150 с врезными укосинами 25×100. Вход и спальня — по нижней длинной стороне плана. Мебель — геометрические резервы, не нагрузки.",
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

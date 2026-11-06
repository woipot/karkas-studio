import test from "node:test";
import assert from "node:assert/strict";
import { calculateCutting, cuttingToPrintHTML } from "./cutting.js";
import { buildFabricationGroups } from "./fabrication-groups.js";
import { defaultDesignerProject } from "./designer-engine.js";

test("twenty identical boards print one part drawing and one repeated stock pattern with complete placement references", () => {
  const instances = Array.from({ length: 20 }, (_, i) => ({
    id: "piece-" + i,
    name: "Стойка",
    category: "walls",
    role: "stud",
    wallId: "wall-" + (i % 2),
    floor: 1,
    b: 50,
    h: 150,
    length: 1,
    cutLength: 1,
    volume: 0.0075,
    mass: 3.75,
    start: [i, 0, 0],
    end: [i, 1, 0],
    crossAxis: [1, 0, 0],
    cutStart: { scheme: "butt", angle: 0 },
    cutEnd: { scheme: "butt", angle: 0 },
  }));
  const result = { timber: { instances } },
    cutting = calculateCutting(defaultDesignerProject, result),
    fabrication = buildFabricationGroups({ result, cutting });
  assert.equal(fabrication.partGroups.length, 1);
  assert.equal(fabrication.patternGroups.length, 1);
  assert.equal(fabrication.patternGroups[0].count, 4);
  const html = cuttingToPrintHTML(cutting, "Тест <схем>", fabrication);
  assert.equal((html.match(/class="card"/g) ?? []).length, 1);
  assert.equal((html.match(/class="card part"/g) ?? []).length, 1);
  assert.ok(html.includes("× 20"));
  assert.ok(html.includes("× 4"));
  assert.ok(html.includes("wall-0"));
  assert.ok(html.includes("wall-1"));
  for (const board of instances) assert.ok(html.includes(board.id));
  for (const stock of cutting.stocks) assert.ok(html.includes(stock.id));
  assert.ok(html.includes("Тест &lt;схем&gt;"));
  assert.equal(html.includes("Тест <схем>"), false);
});

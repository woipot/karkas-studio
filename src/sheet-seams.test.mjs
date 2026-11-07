import test from "node:test";
import assert from "node:assert/strict";
import { sheetRun, narrowPieces, MIN_STRIP } from "./sheet-seams.js";
import { buildSheetBracing } from "./sheet-layout.js";
const pieces = (xs) => xs.slice(1).map((x, i) => x - xs[i]);
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);

test("floor run 6.15 m of 1.22 m rows: no 50 mm strip, the remainder is balanced with the first row", () => {
  const xs = sheetRun(0, 6.15, 1.22, { minPiece: MIN_STRIP }),
    p = pieces(xs);
  assert.equal(p.length, 6);
  near(p[0], 0.635);
  near(p.at(-1), 0.635);
  assert.ok(p.slice(1, -1).every((q) => Math.abs(q - 1.22) < 1e-9));
});

test("an exact or harmless remainder keeps full sheets first; the remainder is merged when it fits", () => {
  assert.deepEqual(
    pieces(sheetRun(0, 4.88, 1.22)).map((q) => +q.toFixed(3)),
    [1.22, 1.22, 1.22, 1.22],
  );
  // 2.8 m wall, 2.5 m sheet: a 0.3 m top band is a nailable strip, not a sliver.
  assert.deepEqual(
    pieces(sheetRun(0, 2.8, 2.5, { minPiece: MIN_STRIP })).map((q) => +q.toFixed(3)),
    [2.5, 0.3],
  );
  // Staggered row: 0.61 + 2.44×2 + 0.05 → 0.66 + 2.44×2 (one piece fewer, no strip).
  const xs = sheetRun(0, 5.54, 2.44, { first: 1.22 });
  assert.ok(pieces(xs).every((q) => q >= 1.22 - 1e-9));
});

test("seams stay on studs and staggered end joints avoid the previous row", () => {
  const studs = Array.from({ length: 12 }, (_, i) => i * 0.6),
    row1 = sheetRun(0, 6.6, 2.5, { stations: studs, minGap: 1e-7 }),
    row2 = sheetRun(0, 6.6, 2.5, { stations: studs, minGap: 1e-7, first: 1.25, avoid: row1.slice(1, -1) });
  for (const x of [...row1, ...row2].slice(1, -1))
    assert.ok(
      studs.some((s) => Math.abs(s - x) < 1e-9),
      `seam ${x} off stud`,
    );
  assert.ok(row2.slice(1, -1).every((x) => row1.slice(1, -1).every((y) => Math.abs(x - y) > 1e-3)));
  assert.ok(pieces(row1).every((q) => q >= 1.25 - 1e-9));
  assert.ok(pieces(row2).every((q) => q >= 1.25 - 1e-9));
});

test("wall OSB: full-height sheets, an unavoidable narrow column is excluded from racking length (EN 1995 9.2.4.2(3))", () => {
  // 6.6 m wall, studs @600: 11 bays, 1250 sheets take two bays → one 0.6 m column is unavoidable.
  const w = {
    id: "w",
    kind: "exterior",
    section: "50x150",
    level: 1,
    a: { x: 0, y: 0 },
    b: { x: 6.6, y: 0 },
  };
  const project = {
    walls: [w],
    openings: [],
    material: { density: 500 },
    bracing: { method: "sheathing", designShear: 5 },
    sheathing: { walls: { product: "osb3-2800x1250", thickness: 12, side: "exterior" } },
  };
  const context = {
    geometry: { levels: [{ index: 1, wallBaseY: 0, topY: 2.8, height: 2.8 }] },
    timber: {
      instances: Array.from({ length: 12 }, (_, i) => ({
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
  const m = buildSheetBracing(project, context),
    line = m.wallLines[0];
  assert.ok(
    m.panels.every((p) => p.sheetRow === 1),
    "one full-height row",
  );
  assert.equal(line.narrowSheetColumns.length, 1);
  near(line.narrowSheetColumns[0].width, 0.6, 1e-6);
  const [col] = line.narrowSheetColumns,
    overlap = line.clearIntervals.reduce(
      (s, [a, b]) => s + Math.max(0, Math.min(b, col.to) - Math.max(a, col.from)),
      0,
    ),
    clear = line.clearIntervals.reduce((s, [a, b]) => s + b - a, 0);
  assert.ok(overlap > 0.2);
  near(line.availableLength, clear - overlap, 1e-6);
  near(line.capacity, 5 * line.availableLength, 1e-9);
  assert.equal(narrowPieces([0, 1.2, 1.8], 0.7).length, 1);
});

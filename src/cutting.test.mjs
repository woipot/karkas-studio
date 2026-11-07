import test from "node:test";
import assert from "node:assert/strict";
import { calculateCutting, cuttingRowsToCSV, cuttingToPrintHTML } from "./cutting.js";
import { timberSections, parseSection, sectionById, sectionMassPerMeter } from "./catalog.js";

const piece = (id, length, b = 50, h = 150, extra = {}) => ({
  id,
  name: `Деталь ${id}`,
  length,
  b,
  h,
  ...extra,
});
const cut = (pieces, kerf = 3) => calculateCutting({ cutting: { kerf } }, { timber: { instances: pieces } });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);

test("catalog includes requested assortment and preserves section orientation", () => {
  for (const id of [
    "20x100",
    "25x100",
    "25x150",
    "40x100",
    "40x150",
    "40x200",
    "50x50",
    "50x100",
    "50x150",
    "50x200",
    "50x250",
    "100x100",
    "100x150",
    "150x150",
    "200x200",
  ])
    assert.ok(sectionById(id), id);
  assert.deepEqual(parseSection("100 на 20"), { b: 100, h: 20 });
  assert.deepEqual(parseSection("20 × 100 мм"), { b: 20, h: 100 });
  assert.equal(parseSection("0x100"), null);
  assert.equal(parseSection("hello"), null);
  near(sectionMassPerMeter("20x100", 500), 1);
  assert.equal(new Set(timberSections.map((s) => s.id)).size, timberSections.length);
});

test("kerf between pieces is exact, and a full 6 m piece fits without end kerf", () => {
  const exact = cut([piece("a", 3), piece("b", 2.997)]);
  assert.equal(exact.summary.boards, 1);
  near(exact.stocks[0].remainder, 0);
  near(exact.stocks[0].kerfWaste, 0.003);
  assert.equal(cut([piece("a", 3), piece("b", 3)]).summary.boards, 2);
  const full = cut([piece("full", 6)]);
  assert.equal(full.summary.boards, 1);
  near(full.stocks[0].kerfWaste, 0);
  near(full.stocks[0].remainder, 0);
});

test("uses gross cutLength including splice overlap and blocks uncuttable blanks", () => {
  const r = cut([
    piece("a", 2.8, 50, 150, {
      cutLength: 3.2,
      cutStart: { scheme: "halfLap", lapLength: 0.4, jointId: "j1" },
    }),
    piece("b", 2.8, 50, 150, {
      cutLength: 3.2,
      cutEnd: { scheme: "halfLap", lapLength: 0.4, jointId: "j1" },
    }),
    piece("long", 7),
  ]);
  assert.equal(r.summary.boards, 2);
  assert.equal(r.overlength.length, 1);
  assert.equal(r.summary.complete, false);
  assert.equal(r.summary.optimal, false);
  near(r.summary.usedVolume, 6.4 * 0.05 * 0.15);
  assert.equal(r.summary.spliceCount, 1);
  assert.equal(r.stocks[0].pieces[0].length, 3.2);
  assert.equal(r.stocks[0].pieces[0].endStart.scheme, "halfLap");
});

test("corner half-lap recesses do not become fictitious longitudinal splices", () => {
  const r = cut([piece("corner", 2, 50, 150, { cutStart: { scheme: "halfLap", recessDepth: 0.025 } })]);
  assert.equal(r.summary.spliceCount, 0);
  assert.equal(r.summary.spliceCountExact, true);
  const explicit = calculateCutting(
    {},
    { timber: { instances: [piece("a", 2)] }, splices: [{ id: "j1" }, { id: "j1" }, { id: "j2" }] },
  );
  assert.equal(explicit.summary.spliceCount, 2);
});

test("section rotation combines procurement without mixing different sections", () => {
  const r = cut([piece("a", 2, 20, 100), piece("b", 3, 100, 20), piece("c", 2, 50, 50)]);
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups.find((g) => g.section === "20x100").boards, 1);
  near(r.summary.purchasedVolume, 6 * 0.02 * 0.1 + 6 * 0.05 * 0.05);
});

test("packing assigns every valid detail once, with no collisions and balanced volume", () => {
  const input = Array.from({ length: 48 }, (_, i) =>
    piece(`d${i}`, 0.23 + (i % 13) * 0.397, i % 3 ? 50 : 25, 150),
  );
  const r = cut(input),
    seen = [];
  for (const s of r.stocks) {
    assert.equal(s.length, 6);
    let end = 0;
    for (let i = 0; i < s.pieces.length; i++) {
      const p = s.pieces[i];
      seen.push(p.id);
      assert.ok(p.cutStart >= end - 1e-8);
      near(p.cutEnd - p.cutStart, p.length);
      if (i) near(p.cutStart - end, 0.003);
      end = p.cutEnd;
    }
    near(end + s.remainder, 6);
    near(s.used + s.kerfWaste + s.remainder, 6);
  }
  assert.deepEqual(seen.sort(), input.map((p) => p.id).sort());
  near(r.summary.purchasedVolume, r.summary.usedVolume + r.summary.wasteVolume);
  near(r.summary.wasteVolume, r.summary.kerfVolume + r.stocks.reduce((s, b) => s + b.remainderVolume, 0));
  assert.ok(r.summary.boards >= r.summary.lowerBound);
});

function oracle(lengths, kerf) {
  const values = lengths.map((x) => x + kerf).sort((a, b) => b - a),
    cap = 6 + kerf;
  let best = values.length;
  const bins = [];
  function visit(i) {
    if (i === values.length) {
      best = Math.min(best, bins.length);
      return;
    }
    const seen = new Set();
    for (let j = 0; j < bins.length; j++) {
      if (seen.has(bins[j]) || bins[j] + values[i] > cap + 1e-8) continue;
      seen.add(bins[j]);
      bins[j] += values[i];
      visit(i + 1);
      bins[j] -= values[i];
    }
    if (bins.length + 1 < best) {
      bins.push(values[i]);
      visit(i + 1);
      bins.pop();
    }
  }
  visit(0);
  return best;
}

test("small cases agree with independent exhaustive bin-count oracle", () => {
  const cases = [
    [3.6, 3, 1.8, 1.2, 1.2, 1.2],
    [4, 3.2, 2.7, 2, 1.6, 1.2, 0.8, 0.4],
    [5.9, 5.9, 0.097, 0.097, 2.99, 2.99],
    [2.1, 2.1, 2.1, 1.8, 1.8, 1.8, 1.4, 1.4],
  ];
  for (const lengths of cases) {
    const r = cut(lengths.map((l, i) => piece(String(i), l)));
    assert.equal(r.summary.boards, oracle(lengths, 0.003));
    assert.equal(r.summary.optimal, true);
  }
});

test("CSV includes all stock detail IDs and print HTML escapes model names", () => {
  const r = cut([piece("a", 2), piece("b", 3)]),
    csv = cuttingRowsToCSV(r, 'Проект; "Тест"');
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Проект; ""Тест"""'));
  assert.ok(csv.includes('"a"'));
  assert.ok(csv.includes('"b"'));
  assert.ok(csv.includes("\r\n"));
  const html = cuttingToPrintHTML(r, "<script>alert(1)</script>");
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("S0001"));
});

test("empty and invalid inputs cannot manufacture a purchasable cut list", () => {
  assert.equal(cut([]).summary.boards, 0);
  const r = cut([piece("bad", NaN), piece("bad2", -1), piece("long", 6.01)]);
  assert.equal(r.invalid.length, 2);
  assert.equal(r.overlength.length, 1);
  assert.equal(r.summary.boards, 0);
  assert.equal(r.summary.complete, false);
});

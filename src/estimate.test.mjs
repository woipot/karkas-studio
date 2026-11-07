import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Compile the JSX authoring module in memory; tests exercise its pure exports.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("./estimate.jsx", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  external: ["react"],
});
const reactURL = new URL("../node_modules/react/index.js", import.meta.url).href;
const source = compiled.outputFiles[0].text.replace(/from "react"/g, "from " + JSON.stringify(reactURL));
const { calculateEstimate, defaultPrices, estimateRowsToCSV } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`);
const zeroPrices = Object.fromEntries(
  Object.keys(defaultPrices)
    .filter((k) => k !== "sectionPrices")
    .map((k) => [k, 0]),
);
const project = {
  height: 2.8,
  floors: 1,
  timberDensity: 500,
  openings: [],
  cutting: { kerf: 3 },
  prices: { ...zeroPrices, timberM3: 1000, laborPercent: 20, contingencyPercent: 10, wastePercent: 80 },
};
const result = {
  geometry: { area: 0, netWallArea: 0, roofArea: 0, totalFloorArea: 0 },
  piles: [],
  timber: {
    instances: [
      { id: "a", b: 50, h: 150, length: 1, cutLength: 1, volume: 0.0075 },
      { id: "b", b: 50, h: 150, length: 1, cutLength: 1, volume: 0.0075 },
    ],
  },
};

test("procures full 6 m stocks from cutting; no second percentage waste on timber", () => {
  const e = calculateEstimate(project, result),
    row = e.rows.find((r) => r.id === "timber-50x150");
  near(row.netQuantity, 0.015);
  near(row.quantity, 0.045);
  near(row.total, 45);
  near(e.materialTotal, 45);
  near(e.laborTotal, 9);
  near(e.reserve, 5.4);
  near(e.total, 59.4);
  near(e.procurementTimberVolume, 0.045);
  assert.equal(e.cutting.summary.boards, 1);
  near(e.waste.timberVolume, 0.03);
  assert.equal(e.complete, true);
});

test("section override is used and zero price is a valid editable choice", () => {
  const e = calculateEstimate(
    { ...project, prices: { ...project.prices, sectionPrices: { "50x150": 2000 } } },
    result,
  );
  near(e.materialTotal, 90);
  near(e.total, 118.8);
  const free = calculateEstimate(
    { ...project, prices: { ...zeroPrices, sectionPrices: { "50x150": 0 } } },
    result,
  );
  near(free.total, 0);
});

test("uses gross cutting length rather than reduced net volume of a joint", () => {
  const r = {
    ...result,
    timber: { instances: [{ id: "lap", b: 50, h: 150, length: 3, cutLength: 3.4, volume: 0.018 }] },
  };
  const e = calculateEstimate(project, r);
  near(e.netTimberVolume, 3.4 * 0.05 * 0.15);
  near(e.procurementTimberVolume, 6 * 0.05 * 0.15);
});

test("unplaced long pieces make the estimate explicitly incomplete", () => {
  const e = calculateEstimate(project, {
    ...result,
    timber: { instances: [{ id: "too-long", b: 50, h: 150, length: 7, volume: 0.0525 }] },
  });
  assert.equal(e.complete, false);
  assert.equal(e.cutting.overlength.length, 1);
  near(e.procurementTimberVolume, 0);
  assert.match(e.rows[0].note, /Не размещено/);
});

test("derived wall geometry counts exterior walls and subtracts actual openings", () => {
  const p = {
    ...project,
    openings: [
      { type: "window", width: 2, height: 1.5 },
      { type: "door", width: 1, height: 2 },
    ],
    prices: { ...zeroPrices, sheathingM2: 10, insulationM2: 20, windowsM2: 100, doorsEach: 200 },
  };
  const r = {
    geometry: { area: 10, totalFloorArea: 10, roofArea: 12 },
    walls: [
      { kind: "exterior", length: 5, openingArea: 5 },
      { kind: "bearing", length: 4, openingArea: 0 },
    ],
    timber: { instances: [] },
    piles: [],
  };
  const e = calculateEstimate(p, r),
    get = (id) => e.rows.find((x) => x.id === id);
  near(get("insulation").quantity, 9);
  near(get("sheathing").quantity, 19);
  near(get("windows").quantity, 3);
  near(get("doors").quantity, 1);
});

test("CSV quotes text, includes units and uses real line breaks", () => {
  const csv = estimateRowsToCSV(calculateEstimate(project, result), 'Дом; "Лес"');
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Дом; ""Лес"""'));
  assert.ok(csv.includes('"м³"'));
  assert.ok(csv.includes("\r\n"));
});

// Drainage quantities are geometric takeoffs and must remain editable in the estimate.
test("prices roof drainage separately from cover and does not purchase it as timber", () => {
  const p = {
    ...project,
    prices: { ...zeroPrices, gutterM: 100, downpipeM: 200, flashingM: 300, valleyM: 400, wastePercent: 10 },
  };
  const r = {
    ...result,
    roofModel: {
      drainage: {
        quantities: {
          gutterLength: 12,
          downpipeLength: 8,
          flashingLength: 6,
          valleyLength: 3,
          downpipeCount: 2,
        },
      },
    },
  };
  const e = calculateEstimate(p, r),
    get = (id) => e.rows.find((x) => x.id === id);
  near(get("roof-gutters").quantity, 13.2);
  near(get("roof-downpipes").total, 1760);
  near(get("roof-flashing").netQuantity, 6);
  near(get("roof-valleys").total, 1320);
  near(e.materialTotal, 6380);
  near(e.procurementTimberVolume, 0.045);
  assert.match(get("roof-downpipes").note, /2 шт/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { calculateEstimate } from "./estimate-engine.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("floor sheathing and envelope layer procurement use physical platform area, preserving axial planning area", () => {
  const project = {
    floors: 2,
    openings: [],
    prices: { wastePercent: 0, sheathingM2: 10, laborPercent: 0, contingencyPercent: 0 },
    envelope: {
      costItems: [
        { id: "ground", name: "Ground deck", basis: "groundFloor", rate: 20 },
        { id: "floors", name: "All decks", basis: "allFloors", rate: 30 },
      ],
    },
  };
  const geometry = {
    closed: true,
    totalFloorArea: 145.68,
    totalPlatformArea: 153.678408,
    netWallArea: 0,
    levels: [
      { area: 80, platformNetArea: 83.999204 },
      { area: 80, platformNetArea: 69.679204 },
    ],
  };
  const result = {
    geometry,
    timber: { instances: [] },
    piles: [],
    bracingModel: { method: "sheathing", quantities: {} },
  };
  const e = calculateEstimate(project, result),
    row = (id) => e.rows.find((r) => r.id === id);
  near(row("sheathing").netQuantity, 153.678408);
  near(row("envelope-ground").netQuantity, 83.999204);
  near(row("envelope-floors").netQuantity, 153.678408);
  near(geometry.totalFloorArea, 145.68);
});

test("legacy results without physical platform metadata retain their original estimate basis", () => {
  const project = {
    floors: 1,
    openings: [],
    prices: { wastePercent: 0 },
    envelope: { costItems: [{ id: "ground", name: "Ground deck", basis: "groundFloor", rate: 1 }] },
  };
  const e = calculateEstimate(project, {
    geometry: { area: 80, totalFloorArea: 72, netWallArea: 0, levels: [{ area: 80 }] },
    timber: { instances: [] },
    piles: [],
  });
  near(e.rows.find((r) => r.id === "sheathing").netQuantity, 72);
  near(e.rows.find((r) => r.id === "envelope-ground").netQuantity, 80);
});

test("an invalid physical platform makes procurement explicitly incomplete", () => {
  const e = calculateEstimate(
    { floors: 1, openings: [] },
    {
      geometry: {
        closed: true,
        area: 20,
        totalFloorArea: 20,
        totalPlatformArea: 0,
        platformAreaComplete: false,
      },
      timber: { instances: [] },
      piles: [],
    },
  );
  assert.equal(e.complete, false);
});

test("annex procurement adds actual roofing, glass and drainage once without extending main envelope or duplicating deck timber and piles", () => {
  const p = {
    floors: 1,
    openings: [],
    prices: {
      wastePercent: 0,
      pileEach: 100,
      roofM2: 10,
      windowsM2: 20,
      gutterM: 30,
      downpipeM: 40,
      flashingM: 50,
    },
    envelope: { costItems: [{ id: "floor", name: "House floor layer", basis: "allFloors", rate: 1 }] },
  };
  const result = {
    geometry: { closed: true, totalFloorArea: 20, totalPlatformArea: 21, roofArea: 22, netWallArea: 30 },
    timber: { instances: [] },
    piles: Array.from({ length: 12 }, (_, id) => ({ id })),
    annexes: {
      items: [
        { id: "OPEN", quantities: { floorArea: 8, roofArea: 0, glazingArea: 0 } },
        {
          id: "COVER",
          name: "Covered",
          quantities: { floorArea: 10, roofArea: 12, gutterLength: 4, downpipeLength: 3, flashingLength: 4 },
        },
        {
          id: "GLASS",
          quantities: {
            floorArea: 6,
            roofArea: 7,
            glazingArea: 14,
            gutterLength: 3,
            downpipeLength: 2,
            flashingLength: 3,
          },
        },
      ],
    },
  };
  const e = calculateEstimate(p, result),
    row = (id) => e.rows.find((r) => r.id === id);
  near(row("roof").netQuantity, 22);
  near(row("sheathing").netQuantity, 51);
  near(row("envelope-floor").netQuantity, 21);
  near(row("piles").quantity, 12);
  near(row("piles").total, 1200);
  near(row("annex-COVER-roof").quantity, 12);
  near(row("annex-GLASS-glazing").quantity, 14);
  near(row("annex-GLASS-glazing").total, 280);
  assert.ok(!e.rows.some((r) => r.id.startsWith("annex-OPEN-")));
  assert.ok(!e.rows.some((r) => /annex.*(deck|pile|insulation)/.test(r.id)));
  assert.ok(e.rows.filter((r) => r.id.startsWith("annex-")).every((r) => r.annexId === r.id.split("-")[1]));
});

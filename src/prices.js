import { sheetProducts } from "./sheet-catalog.js";
// Editable demonstration inputs, not market quotes.
export const defaultPrices = Object.freeze({
  timberM3: 34000,
  sheathingM2: 600,
  bracingSheetM2: 600,
  insulationM2: 900,
  roofM2: 1200,
  gutterM: 900,
  downpipeM: 1100,
  flashingM: 650,
  valleyM: 800,
  pileEach: 6500,
  windowsM2: 14000,
  doorsEach: 18000,
  fastenersM3: 4500,
  laborPercent: 35,
  wastePercent: 10,
  contingencyPercent: 10,
  sectionPrices: Object.freeze({}),
});

// Illustrative RUB/sheet inputs, not verified market prices or normative constants.
// Reference budget: OSB 2500×1250×12 = 1500 RUB, plywood = 2500 RUB per same
// volume; linear scaling is solely a replaceable estimating assumption.
export const defaultSheetPrices = Object.fromEntries(
  sheetProducts.flatMap((p) =>
    p.thicknesses.map((t) => [
      `${p.id}-${t}`,
      Math.round(((((p.material === "osb3" ? 1500 : 2500) * p.width * p.length) / 3.125) * t) / 12),
    ]),
  ),
);

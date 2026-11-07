// Formats/thicknesses: Kalevala assortment, Kronospan OSB-3; plywood GOST
// 3916.1-2018 §3.2 tables 1/2 and SVEZA Regular Interior/Exterior assortment.
export const sheetSources = {
  osb: "https://kalevalaosb.ru/en/products/sorts/",
  kronospan: "https://kronospan.com/en_BG/products/view/kronobuild/osb/osb-3/-699/",
  plywood: "https://sveza.ru/upload/iblock/745/wgvcamm8j1ehaw2h0y5zar5lgtcgcsc8.pdf",
  fk: "https://sveza.com/products/sveza-fk/",
  plywoodStandard: "https://mfzavod.com/upload/iblock/e57/e5720e20bf7676ad2c70ca7434990174.pdf",
  stiffness: "https://kalevalaosb.ru/products/ecodom/",
  osbStandard: "https://kronospan.com/public/files/downloads/kronobuild/kronobuild-en.pdf",
  plywoodStiffness: "https://sveza.ru/upload/iblock/c9f/2nqif28d74v9c0di24mvxy3r6j17unyd.pdf",
};
const osbThicknesses = [9, 12, 15, 18, 22];
const plywoodThicknesses = [6.5, 9, 12, 15, 18, 21];
export const sheetProducts = [
  ...[
    [2500, 1250],
    [2440, 1220],
    [2800, 1250],
  ].map(([l, w]) => ({
    id: `osb3-${l}x${w}`,
    material: "osb3",
    name: "ОСП-3",
    width: w / 1000,
    length: l / 1000,
    thicknesses: osbThicknesses,
    // Kalevala transport table: 620 kg/m³ for 9–18 mm, 600 for 22 mm.
    // 620 is a declared nominal mass assumption, not a guaranteed batch density.
    density: 620,
    densityByThickness: { 22: 600 },
    // EN 300 OSB/3, EN 310 test minima, manufacturer table in sheetSources.osbStandard:
    // major-axis E >= 3500 MPa. This is NOT EN 12369-1 design/mean stiffness;
    // used as a conditional screening value. Duration/moisture factors unverified.
    E: 3500,
    propertiesBasis:
      "EN 300, ОСП/3: минимум испытания EN 310; условное E=3500 МПа, не расчётное E по EN 12369-1.",
    propertiesStatus: "unverified",
    designBending: null,
    source: l === 2440 ? sheetSources.kronospan : sheetSources.osb,
  })),
  ...["plywood-fk", "plywood-fsf"].flatMap((material) =>
    (material === "plywood-fk"
      ? [[1525, 1525]]
      : [
          [1525, 1525],
          [2440, 1220],
          [2500, 1250],
        ]
    ).map(([l, w]) => ({
      id: `${material}-${l}x${w}`,
      material,
      name: material === "plywood-fk" ? "Фанера ФК" : "Фанера ФСФ",
      width: w / 1000,
      length: l / 1000,
      thicknesses: plywoodThicknesses,
      // SVEZA catalogue: 640–700 kg/m³; upper bound adopted for mass.
      density: 700,
      // GOST 3916.1-2018 table 5: longitudinal E >= 7000 MPa is a test
      // requirement agreed with the supplier (SVEZA test protocol linked above).
      // No confirmed layup/grain direction or SP 64 design resistance: keep null.
      E: null,
      propertiesBasis:
        "ГОСТ 3916.1-2018, табл. 5; расчётные E/R по СП 64 для конкретного пакета не подтверждены.",
      propertiesStatus: "unverified",
      designBending: null,
      source: material === "plywood-fk" ? sheetSources.fk : sheetSources.plywood,
    })),
  ),
];
export function parseSheetProduct(id) {
  if (typeof id !== "string") return null;
  const direct = sheetProducts.find((p) => p.id === id);
  if (direct) return { ...direct };
  const m = id.match(/^(.*)-(\d+(?:\.\d+)?)$/);
  const p = m && sheetProducts.find((p) => p.id === m[1]);
  return p && p.thicknesses.includes(+m[2]) ? { ...p, thickness: +m[2] } : null;
}
export function resolveSheet(spec) {
  const p = parseSheetProduct(spec?.product) ?? sheetProducts.find((p) => p.material === spec?.product);
  if (
    !p ||
    !p.thicknesses.includes(spec?.thickness) ||
    (p.thickness !== undefined && p.thickness !== spec.thickness)
  )
    return null;
  return { ...p, thickness: spec.thickness, density: p.densityByThickness?.[spec.thickness] ?? p.density };
}
export function sheetCandidates(spec) {
  const exact = parseSheetProduct(spec?.product);
  if (exact) {
    const p = resolveSheet(spec);
    return p ? [p] : [];
  }
  return sheetProducts
    .filter((p) => p.material === spec?.product && p.thicknesses.includes(spec?.thickness))
    .map((p) => resolveSheet({ ...spec, product: p.id }));
}
export function validateSheathing(value) {
  const errors = [];
  if (value === undefined) return errors;
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!object(value)) return [{ field: "sheathing", message: "Обшивка: требуется объект." }];
  for (const key of Object.keys(value)) {
    const s = value[key];
    if (key === "cutting") {
      if (
        !object(s) ||
        Object.keys(s).some((k) => !["kerf", "minReusable"].includes(k)) ||
        Object.values(s).some((v) => !Number.isFinite(v) || v < 0)
      )
        errors.push({
          field: "sheathing.cutting",
          message: "Раскрой листов: неотрицательные пропил kerf (мм) и minReusable (м).",
        });
      continue;
    }
    if (
      !["walls", "floors", "roof"].includes(key) ||
      !object(s) ||
      !resolveSheet(s) ||
      Object.keys(s).some(
        (k) => !["product", "thickness", ...(key === "walls" ? ["side"] : [])].includes(k),
      ) ||
      (key === "walls" && !["interior", "exterior", "both"].includes(s.side))
    )
      errors.push({
        field: `sheathing.${key}`,
        message: "Обшивка: выберите каталоговый продукт, допустимую толщину и сторону стен.",
      });
  }
  return errors;
}
// Legacy 35 mm is the historical platform offset, not a new material assumption.
export const floorDeckThickness = (p) => (p.sheathing?.floors ? p.sheathing.floors.thickness / 1000 : 0.035);

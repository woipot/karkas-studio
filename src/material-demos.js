import { defaultWizardForm, wizardToGeneratorSpec } from "./wizard-spec.js";
import { generateHouse } from "./house-generator.js";

export function materialDemoForm(demo) {
  if (!["beam", "frame-osb"].includes(demo)) throw Error("Неизвестный демонстрационный проект.");
  return {
    ...defaultWizardForm({ wallSystem: demo === "beam" ? "profiledBeam" : "frame" }),
    name: demo === "beam" ? "Брус 145×145 · ОСП" : "Каркас · ОСП стен, пола и кровли",
    // Editable demonstration geometry from the task, not a standard house size.
    width: 6,
    depth: 5,
    rooms: [],
    wallSystem: demo === "beam" ? "profiledBeam" : "frame",
    sheathing: {
      ...(demo === "frame-osb" ? { walls: { product: "osb3", thickness: 12, side: "exterior" } } : {}),
      floors: { product: "osb3", thickness: 22 },
      roof: { product: "osb3", thickness: 12 },
    },
    insulation: {
      walls: { product: "wool-50" },
      floor: { product: "wool-100" },
      roof: { product: "wool-100", boundary: "ceiling" },
    },
  };
}

export function buildMaterialDemo(demo) {
  const spec = wizardToGeneratorSpec(materialDemoForm(demo));
  const { project, planning } = generateHouse(spec);
  if (demo === "beam") {
    // Explicit demonstration opening dimensions in metres, not code requirements
    // or a supplier's approved casing design; included in the demo report assumptions.
    project.openings = [
      {
        id: "DEMO-DOOR",
        wallId: project.walls[0].id,
        floor: 1,
        offset: 1,
        width: 0.9,
        height: 2.1,
        sill: 0,
        type: "door",
      },
      ...project.walls
        .slice(1, 4)
        .map((w, i) => ({
          id: `DEMO-WINDOW-${i + 1}`,
          wallId: w.id,
          floor: 1,
          offset: 1.5,
          width: 1.2,
          height: 1.2,
          sill: 0.8,
          type: "window",
        })),
    ];
    planning.assumptions.push(
      "Демо бруса: дверь 0,9×2,1 м, три окна 1,2×1,2 м с подоконником 0,8 м — иллюстративные размеры, не нормативный подбор. Обсада и усадочные зазоры построены существующим ядром.",
    );
  }
  return { spec, project, planning };
}

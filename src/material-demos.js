import { defaultWizardForm, wizardToGeneratorSpec } from "./wizard-spec.js";
import { generateHouse } from "./house-generator.js";

export function materialDemoForm(demo) {
  if (!["beam", "frame-osb", "frame-plywood"].includes(demo))
    throw Error("Неизвестный демонстрационный проект.");
  return {
    ...defaultWizardForm({ wallSystem: demo === "beam" ? "profiledBeam" : "frame" }),
    name:
      demo === "beam"
        ? "Брус 145×145 · ОСП"
        : demo === "frame-plywood"
          ? "Каркас · пол ФСФ 21 мм, стены ОСП 12 мм"
          : "Каркас · ОСП стен, пола и кровли",
    // Editable demonstration geometry from the task, not a standard house size.
    width: 6,
    depth: 5,
    rooms: [],
    wallSystem: demo === "beam" ? "profiledBeam" : "frame",
    sheathing: {
      ...(demo !== "beam" ? { walls: { product: "osb3", thickness: 12, side: "exterior" } } : {}),
      // Explicit illustrative demo selection, not a SP 64 minimum thickness.
      floors:
        demo === "frame-plywood"
          ? { product: "plywood-fsf-2500x1250", thickness: 21 }
          : { product: "osb3", thickness: 22 },
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
  if (demo === "frame-plywood")
    planning.assumptions.push(
      "Демо фанеры: пол ФСФ 2500×1250×21 мм, стены ОСП 12 мм, кровля ОСП 12 мм — иллюстративный выбор для просмотра текстур, не нормативный подбор. Геометрия, масса, раскрой и смета рассчитаны существующим ядром. Кровля при открытии демо скрыта только в 3D для осмотра пола; её расчётный учёт сохранён.",
    );
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
      ...project.walls.slice(1, 4).map((w, i) => ({
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

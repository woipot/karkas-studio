import { buildMaterialDemo } from "./material-demos.js";
// Engine tasks shared by the Web Worker (browser) and node tests.
import { generateHouse } from "./house-generator.js";
import { evaluateHouse, applyProjectPatch } from "./house-engine.js";
import { wizardToGeneratorSpec } from "./wizard-spec.js";
import { loadSolutions, normalizeFixes, normalizeOptimization } from "./optional-modules.js";

const clone = (x) => JSON.parse(JSON.stringify(x));

export function buildFromWizard(form) {
  const spec = wizardToGeneratorSpec(form),
    { project, planning } = generateHouse(spec);
  return { spec, project, planning };
}

function evaluate(project, planning = {}) {
  // JSON round-trip strips anything structured-clone could choke on.
  return clone(evaluateHouse(project, planning));
}

export async function runEngineTask(type, payload = {}) {
  switch (type) {
    case "demo": {
      const { spec, project, planning } = buildMaterialDemo(payload.demo);
      const report = evaluate(project, planning);
      report.result.assumptions.push(...planning.assumptions);
      if (payload.demo === "beam")
        report.result.assumptions.push(
          "Демо бруса: каркас и обшивка фронтонов над стенами отсутствуют в геометрии. Ядро не строит этот узел автоматически; закрытые фронтоны требуют отдельной доработки.",
        );
      return { spec, report };
    }
    case "wizard": {
      const { spec, project, planning } = buildFromWizard(payload.form);
      const report = evaluate(project, planning);
      report.result.assumptions.push(
        "Мастер: исходный выбор по заданию — ОСП-3 стен 12 мм снаружи, настил пола 22 мм при шаге лаг более 400 мм / 18 мм при шаге до 400 мм включительно; сплошная кровля отключена до выбора покрытия, брусовые стены без листовой обшивки. Это редактируемые исходные значения, не подтверждённые расчётные минимумы. Если начальная толщина отсутствует в каталоге другого продукта, предлагается его максимальная толщина; достаточность не подтверждена. Фактический выбор записан в проекте; прежние сохранённые проекты автоматически не изменяются.",
      );
      return { spec, report };
    }
    case "evaluate":
      return { report: evaluate(payload.project, payload.planning ?? {}) };
    case "patch": {
      const project = applyProjectPatch(payload.project, payload.operations);
      return { report: evaluate(project, payload.planning ?? {}) };
    }
    case "capabilities": {
      const s = await loadSolutions();
      return { proposeFixes: !!s?.proposeFixes, optimize: !!s?.optimize };
    }
    case "proposeFixes": {
      const s = await loadSolutions();
      if (!s?.proposeFixes) return { fixes: [] };
      return {
        fixes: clone(
          normalizeFixes(
            await s.proposeFixes(payload.project, payload.report, { planning: payload.planning ?? {} }),
          ),
        ),
      };
    }
    case "optimize": {
      const s = await loadSolutions();
      if (!s?.optimize) throw Error("Модуль оптимизации недоступен в этой сборке.");
      const planning = payload.planning ?? {};
      const o = normalizeOptimization(
        await s.optimize(payload.project, { planning, evaluation: payload.report ?? undefined }),
      );
      if (!o) throw Error("Оптимизация не предложила изменений.");
      const project = o.project ?? applyProjectPatch(payload.project, o.operations),
        nextPlanning =
          o.operations && s.planningAfterPatch ? s.planningAfterPatch(planning, o.operations) : planning;
      return { report: evaluate(project, nextPlanning), notes: o.notes };
    }
    default:
      throw Error(`Неизвестная задача движка: ${type}`);
  }
}

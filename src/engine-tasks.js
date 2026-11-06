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
    case "wizard": {
      const { spec, project, planning } = buildFromWizard(payload.form);
      return { spec, report: evaluate(project, planning) };
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
      return { fixes: clone(normalizeFixes(await s.proposeFixes(payload.project, payload.report))) };
    }
    case "optimize": {
      const s = await loadSolutions();
      if (!s?.optimize) throw Error("Модуль оптимизации недоступен в этой сборке.");
      const o = normalizeOptimization(await s.optimize(payload.project));
      if (!o) throw Error("Оптимизация не предложила изменений.");
      const project = o.project ?? applyProjectPatch(payload.project, o.operations);
      return { report: evaluate(project, payload.planning ?? {}), notes: o.notes };
    }
    default:
      throw Error(`Неизвестная задача движка: ${type}`);
  }
}

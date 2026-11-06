// Adapters for optional engine add-ons that may or may not exist in this build:
//   ./site-loads.js  → export function siteLoads({ city })
//   ./solutions.js   → export function proposeFixes(project, evaluation), optimize(project)
// Under Vite, import.meta.glob() resolves to {} when the file is missing, so the
// build never breaks. Under plain Node (tests) a non-literal dynamic import is used.

let viteSiteLoads = null,
  viteSolutions = null;
try {
  viteSiteLoads = import.meta.glob("./site-loads.js");
  viteSolutions = import.meta.glob("./solutions.js");
} catch {
  // Not running under Vite.
}

async function loadOptional(globbed, file) {
  try {
    if (globbed) {
      const load = globbed[file];
      return load ? await load() : null;
    }
    const url = new URL(file, import.meta.url).href;
    return await import(/* @vite-ignore */ url);
  } catch (e) {
    if (globbed) console.warn(`Не удалось загрузить ${file}:`, e);
    return null;
  }
}

// Resolves to siteLoads(…) or null when the module is not part of this build.
export async function loadSiteLoads() {
  const m = await loadOptional(viteSiteLoads, "./site-loads.js");
  const fn = m?.siteLoads ?? m?.default?.siteLoads ?? (typeof m?.default === "function" ? m.default : null);
  return typeof fn === "function" ? fn : null;
}

// Resolves to {proposeFixes, optimize} (either may be null) or null when absent.
export async function loadSolutions() {
  const m = await loadOptional(viteSolutions, "./solutions.js");
  if (!m) return null;
  const proposeFixes = m.proposeFixes ?? m.default?.proposeFixes,
    optimize = m.optimize ?? m.default?.optimize;
  if (typeof proposeFixes !== "function" && typeof optimize !== "function") return null;
  return {
    proposeFixes: typeof proposeFixes === "function" ? proposeFixes : null,
    optimize: typeof optimize === "function" ? optimize : null,
  };
}

// Normalises whatever proposeFixes returns into [{id, title, description, operations, project}].
export function normalizeFixes(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.fixes) ? raw.fixes : [];
  return list
    .filter((f) => f && typeof f === "object")
    .map((f, i) => {
      const operations = f.operations ?? f.patch ?? f.ops ?? null;
      return {
        id: String(f.id ?? `fix-${i + 1}`),
        title: String(f.title ?? f.label ?? f.summary ?? f.name ?? f.description ?? `Исправление ${i + 1}`),
        description: [f.description, f.rationale, f.reason, f.effect, f.impact]
          .filter((x) => typeof x === "string" && x !== f.title)
          .join(" "),
        checks: Array.isArray(f.checks) ? f.checks.map(String) : f.checkId ? [String(f.checkId)] : [],
        cost: typeof f.cost === "number" ? f.cost : typeof f.costDelta === "number" ? f.costDelta : null,
        operations: Array.isArray(operations) && operations.length ? operations : null,
        project:
          f.project && typeof f.project === "object" && Array.isArray(f.project.walls) ? f.project : null,
      };
    })
    .filter((f) => f.operations || f.project);
}

// optimize(project) may return a project, {project}, or {operations}.
export function normalizeOptimization(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.walls)) return { project: raw, operations: null, notes: [] };
  const notes = [raw.summary, raw.description, ...(Array.isArray(raw.notes) ? raw.notes : [])].filter(
    (x) => typeof x === "string",
  );
  if (raw.project && Array.isArray(raw.project.walls))
    return { project: raw.project, operations: null, notes };
  const operations = raw.operations ?? raw.patch;
  if (Array.isArray(operations) && operations.length) return { project: null, operations, notes };
  return null;
}

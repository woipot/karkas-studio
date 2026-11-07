// Project JSON file format for the web UI.
// Export is exactly the argument object of the MCP tool karkas_import_project:
//   { "project": { ...schema version 2 project... } }
// Import accepts that shape, a bare project object, a full engine report
// (engine-report.json / «JSON отчёта») or the editor's localStorage record.

export function projectFileJSON(project) {
  if (!project || typeof project !== "object" || !Array.isArray(project.walls))
    throw Error("Нет проекта для экспорта.");
  return JSON.stringify({ project }, null, 2);
}

export function projectFileName(project, suffix = "project") {
  const base =
    String(project?.name ?? "karkas")
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "karkas";
  return `${base}.${suffix}.json`;
}

// Returns {project, planning, report|null, kind}.
export function parseProjectFile(text) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw Error("Файл не является корректным JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Ожидается JSON-объект проекта.");
  const isProject = (p) => p && typeof p === "object" && Array.isArray(p.walls);
  if (isProject(data.project) && data.result && data.engine)
    return {
      kind: "report",
      project: data.project,
      planning: data.sourcePlanning ?? data.planning ?? {},
      report: data,
    };
  if (isProject(data.project))
    return { kind: "project", project: data.project, planning: data.planning ?? {}, report: null };
  if (isProject(data)) return { kind: "bare", project: data, planning: {}, report: null };
  throw Error('В файле нет проекта: ожидается {"project": {...}} со списком стен walls.');
}

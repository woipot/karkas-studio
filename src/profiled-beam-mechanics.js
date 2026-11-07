import { bearingPerpendicular, designDefaults } from "./timber-design.js";
import { loadFactors } from "./load-profile.js";
import { solveFloorWallBeam } from "./floor-wall-loads.js";
// Standard gravity, ISO 80000-3; same conversion as designer-engine.js.
const G = 9.80665,
  EPS = 1e-7;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
/** SP64.13330.2017 §6.1, table 3 item 3: sigma=N/A; use full-area cross-grain resistance
 * (existing Fc90Full design basis), even at local seats: no unjustified enhancement.
 * Vertical loading of horizontal courses is ACROSS grain, never Fc along grain. */
export function checkBeamBearing({ force, width, bearingLength, Fc90 = designDefaults.Fc90Full }) {
  return {
    ...bearingPerpendicular({ F: force, b: width, l: bearingLength, Fc90 }),
    method: "СП 64.13330.2017 п. 6.1, табл. 3 п. 3: σ=N/A ≤ Rс90; заданное расчётное R",
  };
}
/** Conservative independent-course bending, no composite stack stiffness or dowel credit.
 * SP64.13330.2017 §7.9, elastic M/W and simple-beam deflection; L/200 is an
 * adopted screening limit, NOT a verified wall deflection requirement from SP20. */
export function beamWindScreen({ pressure, span, width, height, E, Fb }) {
  const q = (pressure * height) / 1000,
    moment = (q * span ** 2) / 8,
    W = (height * width ** 2) / 6,
    I = (height * width ** 3) / 12,
    stress = (moment * 1e6) / W,
    deflection = (5 * q * (span * 1000) ** 4) / (384 * E * I),
    limit = (span * 1000) / 200;
  return {
    pressure,
    span,
    lineLoad: q,
    moment,
    stress,
    deflection,
    limit,
    utilization: Math.max(stress / Fb, deflection / limit),
  };
}
export function analyzeProfiledBeam(p, result, model, samples = []) {
  if (!model.walls.length) return model;
  const factors = loadFactors(p.loads),
    boards = result.timber.instances,
    byId = new Map(boards.map((b) => [b.id, b])),
    wallMap = new Map(p.walls.map((w) => [w.id, w]));
  for (const wall of model.walls) {
    const w = wallMap.get(wall.wallId),
      L = wall.length,
      ux = (w.b.x - w.a.x) / L,
      uy = (w.b.y - w.a.y) / L,
      station = (q) => (q.x - w.a.x) * ux + (q.y - w.a.y) * uy,
      on = (q) =>
        Math.abs(-(q.x - w.a.x) * uy + (q.y - w.a.y) * ux) < EPS &&
        station(q) >= -EPS &&
        station(q) <= L + EPS,
      own = boards.filter((b) => b.wallId === w.id && (b.level ?? b.floor) === wall.level),
      selfWeight = ((sum(own.map((b) => b.mass)) + wall.juteMass) * G) / 1000,
      topSamples = samples.filter((s) => {
        if (!on(s.point)) return false;
        if (s.roofZoneId || s.roofFallback) return true;
        if (s.floorLevel) return s.floorLevel > wall.level;
        const b = byId.get(s.boardId ?? s.sourceBoardId);
        return b && b.category !== "foundation" && (b.level ?? b.floor) > wall.level;
      }),
      // Equal split only at an exact intersection; a force may never enter twice.
      share = (s) =>
        1 /
        Math.max(
          1,
          p.walls
            .filter((q) => q.kind !== "partition" && (q.level ?? 1) === wall.level)
            .filter((q) => {
              const len = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y),
                t =
                  ((s.point.x - q.a.x) * (q.b.x - q.a.x) + (s.point.y - q.a.y) * (q.b.y - q.a.y)) / len ** 2;
              return (
                t >= -EPS &&
                t <= 1 + EPS &&
                Math.hypot(s.point.x - q.a.x - t * (q.b.x - q.a.x), s.point.y - q.a.y - t * (q.b.y - q.a.y)) <
                  EPS
              );
            }).length,
        ),
      reactions = topSamples.map((s) => ({
        station: station(s.point),
        design: s.design * share(s),
        service: s.characteristic * share(s),
        roof: !!s.roofZoneId,
      })),
      axial = sum(reactions.map((s) => s.design)) + selfWeight * factors.timber,
      solidLength =
        L - sum(wall.openings.filter((o) => o.roughBottom <= EPS).map((o) => o.roughTo - o.roughFrom)),
      bearing = checkBeamBearing({
        force: axial,
        width: wall.width * 1000,
        bearingLength: Math.max(EPS, solidLength) * 1000,
        Fc90: p.material.Fc90Full ?? designDefaults.Fc90Full,
      });
    wall.selfWeight = selfWeight;
    wall.topReactions = reactions;
    wall.designCompression = axial;
    wall.bottomBearing = bearing;
    const check = (suffix, label, u, note, extra = {}) =>
      model.checks.push({
        id: `beam-${w.id}-L${wall.level}-${suffix}`,
        wallId: w.id,
        level: wall.level,
        label,
        status: u > 1 ? "fail" : "unverified",
        utilization: u,
        note,
        ...extra,
      });
    check(
      "compression",
      "Брус: сжатие стены и смятие нижнего венца",
      bearing.utilization,
      "Вертикальная сила поперёк волокон: N/(b·l) по СП 64, п. 6.1, табл. 3 п. 3, R=material.Fc90Full. Проверено среднее давление по цельным простенкам; площадь контакта профиля, устойчивость простенков и путь через платформу не подтверждены.",
      { value: bearing.stress, limit: bearing.limit, unit: "МПа" },
    );
    // A roof/floor seat conservatively carries its force to the bottom without spreading.
    // Seat length = physical roof chord/joist width, not an arbitrary 100 mm default.
    const concentrated = reactions
      .filter((r) => r.roof || r.design > 0)
      .map((r) => {
        const source = r.roof ? p.roof.chordSection : p.floor.section,
          match = source?.match(/^(\d+)[x×]/),
          seat = match ? Number(match[1]) : null;
        if (!seat) return { station: r.station, status: "unverified" };
        return {
          station: r.station,
          seat,
          ...checkBeamBearing({
            force: r.design + (selfWeight * factors.timber * seat) / (L * 1000),
            width: wall.width * 1000,
            bearingLength: seat,
            Fc90: p.material.Fc90Full ?? designDefaults.Fc90Full,
          }),
        };
      });
    wall.concentratedBearing = concentrated;
    if (concentrated.some((r) => Number.isFinite(r.utilization)))
      check(
        "seats",
        "Брус: смятие под концами балок и в нижних венцах",
        Math.max(...concentrated.map((r) => r.utilization ?? 0)),
        "Без распределения сосредоточенной силы по высоте; площадь опоры — ширина исходного пояса/лаги × толщина стены. Вырезы и реальный контакт профиля требуют проверки.",
      );
    const supports = [
        0,
        L,
        ...p.walls
          .filter((q) => q.id !== w.id && q.kind !== "partition" && (q.level ?? 1) === wall.level)
          .flatMap((q) => [q.a, q.b])
          .filter(on)
          .map(station),
      ].sort((a, b) => a - b),
      spans = supports.slice(1).map((s, i) => s - supports[i]),
      // Longitudinal butt splice has ZERO verified moment capacity: no bending pass across it.
      spliced = wall.courses.some((c) => c.splices.length),
      wind = beamWindScreen({
        pressure: (result.loads?.windPressure?.wm ?? p.loads.wind) * factors.wind,
        span: Math.max(...spans),
        width: wall.width * 1000,
        height: wall.courseHeight * 1000,
        E: p.material.E,
        Fb: p.material.Fb,
      });
    wall.wind = { ...wind, spliced };
    check(
      "wind",
      "Брус: изгиб отдельных венцов от ветра",
      wind.utilization,
      "СП 64 п. 7.9: каждый венец — отдельная горизонтальная балка между углами/пересечениями, без составной жёсткости и без опоры на нагель. L/200 — принятый ориентир. Работа углов, пересечений, нагелей и пространственная устойчивость не подтверждены." +
        (spliced
          ? " Есть стыки: передача изгиба через них не подтверждена, расчёт цельного пролёта справочный."
          : ""),
    );
    wall.lintels = [];
    for (const o of wall.openings) {
      const course = wall.courses.find((c) => c.bottom >= o.roughTop - EPS),
        clear = o.roughTo - o.roughFrom,
        continuous = course?.partIds
          .map((id) => byId.get(id))
          .find(
            (b) =>
              b &&
              station({ x: b.start[0], y: b.start[2] }) <= o.roughFrom - wall.width + EPS &&
              station({ x: b.end[0], y: b.end[2] }) >= o.roughTo + wall.width - EPS,
          ),
        // Full rectangular column above the lintel is a conservative self-weight bound.
        weightAbove =
          (wall.width * Math.max(0, wall.height - (course?.bottom ?? wall.height)) * p.material.density * G) /
          1000,
        points = reactions
          .filter((r) => r.station >= o.roughFrom && r.station <= o.roughTo)
          .map((r) => ({ type: "point", at: r.station - o.roughFrom, service: r.service, design: r.design })),
        lin = course
          ? solveFloorWallBeam({
              length: clear,
              b: wall.width * 1000,
              h: (course.top - course.bottom) * 1000,
              E: p.material.E,
              Fb: p.material.Fb,
              Fv: p.material.Fv ?? designDefaults.Fv,
              uniformService: weightAbove,
              uniformDesign: weightAbove * factors.timber,
              loads: points,
            })
          : null;
      wall.lintels.push({ openingId: o.id, boardId: continuous?.id, span: clear, analysis: lin });
      const u = lin?.utilization ?? null;
      model.checks.push({
        id: `beam-lintel-${w.id}-L${wall.level}-${o.id}`,
        wallId: w.id,
        openingId: o.id,
        label: "Брус: венец-перемычка над обсадой",
        status: !continuous ? "fail" : u > 1 ? "fail" : "unverified",
        utilization: u,
        note: "Один цельный венец без составной работы; фактические опорные реакции кровли/перекрытий в проёме и вес вышележащих венцов. Нужен запас длины по толщине стены с каждой стороны. Смятие у простенков, скалывание и контакт профиля отдельно не подтверждены.",
      });
    }
    model.checks.push({
      id: `beam-settlement-${w.id}-L${wall.level}`,
      wallId: w.id,
      label: "Брус: усадка и скользящие примыкания",
      status: "unverified",
      value: wall.settlementMM,
      unit: "мм",
      note: `Допущение: усадка ${(wall.settlementRatio * 100).toFixed(0)}% = ${wall.settlementMM.toFixed(0)} мм. Компенсация у лестниц, стоек и каркасных перегородок не меньше этой величины; для нескольких этажей суммировать. Скользящие крепления, домкраты, обсада и скользящие стропильные узлы не подтверждены.`,
    });
  }
  model.volume = sum(boards.filter((b) => b.role === "beamCourse").map((b) => b.volume));
  model.mass = sum(boards.filter((b) => b.role === "beamCourse").map((b) => b.mass));
  model.dowelCount = model.dowels.length;
  model.assumptions.push(
    "Брус: частные расчёты используют material.E/Fb/Fv/Fc90Full существующего профиля СП 64 (Fc90Full=1,8 МПа по умолчанию — прежнее округлённое расчётное R, не табличное RA=2,7 МПа; срок нагрузки и условия эксплуатации отдельно не сверены); вертикальное сжатие венцов поперёк волокон (Fc вдоль волокон здесь неприменим). Площади контакта зубьев, влажностные коэффициенты, местные посты/объекты и устойчивость простенков не подтверждены. Ветер: независимые горизонтальные венцы, без составной работы нагелей; L/200 — допущение, не сверенный нормативный предел стены.",
  );
  return model;
}

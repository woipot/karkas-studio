/** Non-bearing partition head datums. Metres in plan/height; section inputs mm.
 * This resolves geometry only. It neither creates bearings nor certifies clips. */
const EPS = 1e-7,
  finite = Number.isFinite;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const clone = (x) => structuredClone(x);
const vec = (a, b) => a.map((x, i) => x - b[i]),
  dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0),
  cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const L = Math.hypot(...v);
  return L > EPS ? v.map((x) => x / L) : null;
};
const section = (s) => {
  const m = typeof s === "string" && s.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/);
  return m && +m[1] > 0 && +m[2] >= +m[1] ? { b: +m[1], h: +m[2] } : null;
};
const point = (q) => object(q) && finite(q.x) && finite(q.y);
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  cross = (a, b) => a.x * b.y - a.y * b.x;
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function validPolygon(p) {
  return (
    Array.isArray(p) &&
    p.length >= 3 &&
    p.every(point) &&
    Math.abs(p.reduce((s, a, i) => s + cross(a, p[(i + 1) % p.length]), 0)) > EPS
  );
}
function onSegment(p, a, b) {
  const d = subtract(b, a),
    L = Math.hypot(d.x, d.y);
  return (
    L > EPS &&
    Math.abs(cross(d, subtract(p, a))) <= EPS * L &&
    (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y) <= EPS
  );
}
function inside(p, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j],
      b = poly[i];
    if (onSegment(p, a, b)) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
/** Test every interval of a wall edge, not merely its endpoints or bbox. */
function segmentStations(a, b, poly) {
  const d = subtract(b, a),
    L2 = d.x * d.x + d.y * d.y,
    ts = [0, 1];
  if (L2 < EPS * EPS) return [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i],
      z = poly[(i + 1) % poly.length],
      e = subtract(z, c),
      r = subtract(c, a),
      D = cross(d, e);
    if (Math.abs(D) > EPS) {
      const t = cross(r, e) / D,
        u = cross(r, d) / D;
      if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) ts.push(Math.max(0, Math.min(1, t)));
    } else if (Math.abs(cross(r, d)) < EPS) {
      for (const q of [c, z]) {
        const t = ((q.x - a.x) * d.x + (q.y - a.y) * d.y) / L2;
        if (t > 0 && t < 1) ts.push(t);
      }
    }
  }
  ts.sort((x, y) => x - y);
  return ts;
}
function segmentInside(a, b, poly) {
  const ts = segmentStations(a, b, poly);
  return (
    ts.every((t) => inside(interpolate(a, b, t), poly)) &&
    ts.slice(1).every((t, i) => inside(interpolate(a, b, (t + ts[i]) / 2), poly))
  );
}
function segmentOverlaps(a, b, poly) {
  const ts = segmentStations(a, b, poly);
  return ts.slice(1).some((t, i) => t - ts[i] > EPS && inside(interpolate(a, b, (t + ts[i]) / 2), poly));
}
function footprint(w) {
  const s = section(w.section);
  if (!point(w.a) || !point(w.b) || !s) return null;
  const dx = w.b.x - w.a.x,
    dy = w.b.y - w.a.y,
    L = Math.hypot(dx, dy);
  if (L < EPS) return null;
  const n = { x: ((-dy / L) * s.h) / 2000, y: ((dx / L) * s.h) / 2000 };
  return [
    { x: w.a.x + n.x, y: w.a.y + n.y },
    { x: w.b.x + n.x, y: w.b.y + n.y },
    { x: w.b.x - n.x, y: w.b.y - n.y },
    { x: w.a.x - n.x, y: w.a.y - n.y },
  ];
}
const contained = (polygon, outer) =>
  validPolygon(outer) && polygon.every((a, i) => segmentInside(a, polygon[(i + 1) % polygon.length], outer));

/** Read the actual lower horizontal face, including a pre-cut board profile. */
function lowerTieFace(b) {
  if (
    !["bottomChord", "bottom"].includes(b.role) ||
    !b.id ||
    !Array.isArray(b.start) ||
    !Array.isArray(b.end) ||
    !Array.isArray(b.crossAxis) ||
    ![...b.start, ...b.end, ...b.crossAxis, b.b, b.h].every(finite) ||
    b.b <= 0 ||
    b.h <= 0
  )
    return null;
  const axis = unit(vec(b.end, b.start));
  if (!axis || Math.abs(axis[1]) > EPS) return null;
  const width = unit(b.crossAxis.map((v, i) => v - dot(b.crossAxis, axis) * axis[i]));
  if (!width || Math.abs(width[1]) > EPS) return null;
  const depth = cross3(width, axis);
  if (Math.abs(Math.abs(depth[1]) - 1) > EPS) return null;
  const center = b.start.map((v, i) => (v + b.end[i]) / 2),
    centerY = center[1],
    profile = b.shape?.points;
  if (profile !== undefined) {
    if (
      !Array.isArray(profile) ||
      profile.length < 3 ||
      profile.some((q) => !Array.isArray(q) || q.length !== 2 || !q.every(finite))
    )
      return null;
    const y = profile.map((q) => centerY + depth[1] * q[1]),
      minimum = Math.min(...y),
      hasFlat = profile.some(
        (q, i) =>
          Math.abs(y[i] - minimum) < EPS &&
          Math.abs(y[(i + 1) % y.length] - minimum) < EPS &&
          Math.abs(q[0] - profile[(i + 1) % profile.length][0]) > EPS,
      );
    const lo = Math.min(...profile.map((q) => q[0])),
      hi = Math.max(...profile.map((q) => q[0]));
    return hasFlat && finite(minimum)
      ? {
          id: b.id,
          y: minimum,
          profile: true,
          axis,
          start: center.map((v, i) => v + axis[i] * lo),
          end: center.map((v, i) => v + axis[i] * hi),
          b: b.b,
        }
      : null;
  }
  return { id: b.id, y: centerY - b.h / 2000, profile: false, axis, start: b.start, end: b.end, b: b.b };
}

export const partitionHeadSources = [
  {
    title: "СП31-105-2002 §7.1.1 — separate bearing walls and non-bearing partitions",
    url: "https://nav.tn.ru/cloud/iblock/575/5758b532d5835635a5e080955a0ae25d/SP-31_105_2002-Proektirovanie-i-stroitelstvo-energoeffektivnykh-odnokvartirnykh-zhilykh-domov-s-derevyannym-karkasom.pdf",
  },
  {
    title: "WoodWorks — non-bearing partition vertical movement and lateral restraint",
    url: "https://www.woodworks.org/resources/detailing-non-bearing-wood-partition-walls-below-floor-or-roof-framing/",
  },
  {
    title: "MiTek2024 — roof truss installation, internal non-bearing walls pp5–6",
    url: "https://www.mitek.com.au/wp-content/uploads/2024/07/20240611-Roof-Truss-Installation-Manual_WEB.pdf",
  },
];

/**
 * Returns effective cloned walls. A pending/malformed binding never invents a
 * height and never changes source input. Supply actual roofModel.instances.
 */
export function resolvePartitionHeads(project, { levels = [], roofModel } = {}) {
  const out = {
    walls: clone(project.walls ?? []),
    items: [],
    checks: [],
    assumptions: [],
    warnings: [],
    sources: clone(partitionHeadSources),
    status: "unverified",
    certified: false,
  };
  for (const wall of out.walls) {
    if (wall.topAttachment === undefined) continue;
    const binding = wall.topAttachment,
      item = {
        wallId: wall.id,
        level: wall.level ?? null,
        target: binding?.target ?? null,
        targetY: null,
        topY: null,
        effectiveHeight: null,
        targetSourceMemberIds: [],
        verticalBearing: false,
        gapBasis: "adopted",
        connectionsVerified: false,
        status: "unverified",
        checks: [],
      };
    out.items.push(item);
    const check = (suffix, label, status, note, extra = {}) => {
      const c = {
        id: `partition-head-${wall.id}-${suffix}`,
        wallId: wall.id,
        level: item.level,
        label,
        status,
        note,
        ...extra,
      };
      item.checks.push(c);
      out.checks.push(c);
      return c;
    };
    const reject = (suffix, note, status = "fail") => {
      item.status = status === "fail" ? "fail" : "pending";
      item.reason = note;
      check(suffix, "Привязка верха ненесущей перегородки", status, note);
      out.warnings.push(`${wall.id}: ${note}`);
    };
    if (wall.kind !== "partition") {
      reject(
        "kind",
        "topAttachment допускается только у ненесущей перегородки; вертикальная опора крыши не назначается.",
      );
      continue;
    }
    if (
      !object(binding) ||
      !["roofTieUnderside", "ceilingFrameUnderside"].includes(binding.target) ||
      binding.mode !== "sliding" ||
      (binding.zoneId !== undefined && (typeof binding.zoneId !== "string" || !binding.zoneId.trim()))
    ) {
      reject(
        "input",
        "Нужны target roofTieUnderside/ceilingFrameUnderside и mode sliding; zoneId — непустая строка.",
      );
      continue;
    }
    const gap = binding.gap ?? 0.02;
    item.gap = gap;
    if (!finite(gap) || gap < 0.005 || gap > 0.1) {
      reject(
        "gap-input",
        "Зазор должен быть конечным числом0.005…0.1м; это диапазон модели, а не нормативный минимум.",
      );
      continue;
    }
    const body = footprint(wall);
    if (!body) {
      reject("wall-geometry", "Не заданы корректные ось и сечение перегородки.");
      continue;
    }
    const candidates = levels.filter((l) => wall.level === undefined || l.index === wall.level);
    if (candidates.length !== 1) {
      reject(
        "level",
        "Привязке нужен один явно определённый этаж; повторяемую стену следует разделить по этажам.",
        "unverified",
      );
      continue;
    }
    const level = candidates[0];
    item.level = level.index;
    if (!finite(level.wallBaseY) || !validPolygon(level.polygon)) {
      reject(
        "level-geometry",
        "У этажа нет фактического замкнутого контура или отметки wallBaseY.",
        "unverified",
      );
      continue;
    }
    if (!contained(body, level.polygon)) {
      reject("outside-level", "Сечение перегородки выходит за фактический полигон этажа.");
      continue;
    }
    if (!roofModel || !Array.isArray(roofModel.zones) || !roofModel.zones.length) {
      reject("roof-pending", "Кровельная модель ещё не рассчитана; исходная высота сохранена.", "unverified");
      continue;
    }
    let zones = roofModel.zones.filter((z) => z && z.levelIndex === level.index);
    if (binding.zoneId !== undefined) {
      zones = zones.filter((z) => z.id === binding.zoneId);
      if (!zones.length) {
        reject("zone", "Указанная зона не найдена на этаже перегородки.");
        continue;
      }
    }
    zones = zones.filter((z) => contained(body, z.bearingPolygon ?? z.polygon));
    if (zones.length !== 1) {
      reject(
        "zone-containment",
        zones.length
          ? "Несколько зон покрывают перегородку: задайте zoneId; ближайшая зона не выбирается."
          : "Весь фактический контур перегородки не покрыт одной кровельной зоной.",
        zones.length ? "unverified" : "fail",
      );
      continue;
    }
    const zone = zones[0];
    item.zoneId = zone.id;
    let ties = (roofModel.instances ?? [])
      .filter((b) => b.zoneId === zone.id && (b.floor ?? b.level ?? level.index) === level.index)
      .map(lowerTieFace)
      .filter(Boolean)
      .filter((b) =>
        segmentOverlaps(
          { x: b.start[0], y: b.start[2] },
          { x: b.end[0], y: b.end[2] },
          zone.bearingPolygon ?? zone.polygon,
        ),
      );
    if (!ties.length) {
      reject(
        "tie-pending",
        "В зоне нет реальных горизонтальных нижних затяжек с плоской нижней гранью. Отметка eave или габарит зоны не заменяют доску.",
        "unverified",
      );
      continue;
    }
    const reference = ties[0].axis,
      planAxis = { x: reference[0], y: reference[2] },
      normal = { x: -planAxis.y, y: planAxis.x },
      projection = (q, v) => q.x * v.x + q.y * v.y,
      wallV = body.map((q) => projection(q, planAxis)),
      wallU = body.map((q) => projection(q, normal));
    ties = ties.filter(
      (b) =>
        Math.abs(dot(b.axis, reference)) > 1 - EPS &&
        Math.min(
          projection({ x: b.start[0], y: b.start[2] }, planAxis),
          projection({ x: b.end[0], y: b.end[2] }, planAxis),
        ) <=
          Math.min(...wallV) + EPS &&
        Math.max(
          projection({ x: b.start[0], y: b.start[2] }, planAxis),
          projection({ x: b.end[0], y: b.end[2] }, planAxis),
        ) >=
          Math.max(...wallV) - EPS,
    );
    if (
      !ties.length ||
      Math.min(...ties.map((b) => projection({ x: b.start[0], y: b.start[2] }, normal) - b.b / 2000)) >
        Math.min(...wallU) + EPS ||
      Math.max(...ties.map((b) => projection({ x: b.start[0], y: b.start[2] }, normal) + b.b / 2000)) <
        Math.max(...wallU) - EPS
    ) {
      reject(
        "tie-plan-coverage",
        "Реальные нижние пояса не охватывают положение и длину перегородки; плоскость кровли не продлевается к отсутствующим опорам.",
        "unverified",
      );
      continue;
    }
    item.targetSourceMemberIds = ties.map((b) => b.id);
    const tieUnder = Math.min(...ties.map((b) => b.y)),
      spread = Math.max(...ties.map((b) => b.y)) - tieUnder;
    item.roofTieUndersideY = tieUnder;
    let targetY = tieUnder;
    if (binding.target === "ceilingFrameUnderside") {
      const aux = project.auxiliaryTimber ?? {},
        sec = section(aux.ceilingSection ?? "45x45");
      if (aux.enabled !== true || aux.ceilingBattens !== true || !sec || !finite(zone.ceilingDatumY)) {
        reject(
          "ceiling-pending",
          "Нужны включённый реальный потолочный каркас, сечение реек и ceilingDatumY кровельной зоны.",
          "unverified",
        );
        continue;
      }
      targetY = zone.ceilingDatumY - sec.b / 1000;
      item.ceilingDatumY = zone.ceilingDatumY;
      item.ceilingSection = aux.ceilingSection ?? "45x45";
      item.targetBasis =
        "ceilingDatumY minus actual ceiling batten vertical thickness b; generated ceiling geometry must be checked later";
    } else
      item.targetBasis =
        "Minimum actual horizontal lower face of physical bottom chords, including supplied cut profiles; no eave/bbox fallback";
    const topY = targetY - gap,
      height = topY - level.wallBaseY;
    if (
      ![targetY, topY, height].every(finite) ||
      height <= 0 ||
      (finite(level.topY) && topY > level.topY + EPS)
    ) {
      reject("height", "Верх перегородки не попадает в допустимый вертикальный интервал назначенного этажа.");
      continue;
    }
    wall.height = height;
    item.targetY = targetY;
    item.topY = topY;
    item.effectiveHeight = height;
    item.status = "resolved";
    item.referenceSpread = spread;
    check(
      "geometry",
      "Отметка верха перегородки",
      "pass",
      "Определена только геометрическая отметка; источник и полигон кровли действительные.",
      { value: height, unit: "м", targetY, topY, memberIds: item.targetSourceMemberIds, partial: true },
    );
    check(
      "clearance",
      "Зазор: относительный прогиб, ползучесть и допуски",
      "unverified",
      "Принятый зазор не подтверждён расчётом относительных перемещений крыши/пола, ползучести, усушки, вспучивания и монтажных допусков.",
      { value: gap, unit: "м", gapBasis: "adopted" },
    );
    check(
      "lateral",
      "Скользящий верх и поперечины между затяжками",
      "unverified",
      "Нужны реальные связи для горизонтального закрепления и вертикального хода. Список затяжек задаёт опорную систему-источник, но не доказывает прямое касание стены каждой доски; при параллельных стенах требуются отдельные поперечины. Крепёж не рассчитан.",
      { memberIds: item.targetSourceMemberIds, verticalBearing: false, connectionsVerified: false },
    );
    check(
      "ceiling-coordination",
      "Проход стены через потолочный каркас и утепление",
      "unverified",
      "После привязки необходимо проверить весь фактический потолочный каркас/подвесы на пересечения, реальные опоры новых фрагментов, пароизоляцию, герметизацию, акустику и огнестойкость. Рейки и подвесы этим модулем не вырезаются.",
    );
    if (spread > EPS)
      check(
        "different-datums",
        "Разные отметки нижних граней затяжек",
        "unverified",
        "Использована самая низкая действительная грань; у остальных затяжек зазор больше. Узел переменной высоты требует отдельной деталировки.",
        { value: spread, unit: "м" },
      );
  }
  out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  if (out.items.length)
    out.assumptions = [
      "topAttachment изменяет только эффективную копию высоты ненесущей перегородки. Исходный project не меняется; kind partition и отсутствие вертикального опирания крыши сохраняются.",
      "Нижняя грань затяжки определяется по реальным горизонтальным доскам и готовым профилям. Полный контур стены должен лежать в настоящих полигонах этажа и одной кровельной зоны. Габаритный прямоугольник или ближайшая зона не используются.",
      "Зазор20мм по умолчанию принят для геометрии, не сертифицирован. Для движения вниз нужен запас относительно прогиба крыши минус перемещение основания стены с учётом длительных эффектов и допусков; движение вверх требует отдельного хода скользящего узла.",
      "Положение потолочных реек определяется от ceilingDatumY по их вертикальной толщине b. Эта привязка не проверяет крепёж и не делает перегородку несущей; обрешётка, подвесы, утепление и отделка требуют согласованной фактической геометрии.",
    ];
  return out;
}

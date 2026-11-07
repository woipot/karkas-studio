import { wallProfileTop } from "./wall-profiles.js";
/** Explicit concept-stage support geometry for standalone rafters.
 * Coordinates [X,Y,Z] in metres; sections mm; mass kg. No connection design.
 */
const EPS = 1e-7,
  PLAN_TOL = 0.035,
  HEIGHT_TOL = 0.005;
const finite = Number.isFinite;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const parse = (s) => {
  const m = typeof s === "string" && s.replaceAll(" ", "").match(/^(\d{2,3})[x×](\d{2,3})$/);
  if (!m) return null;
  const b = +m[1],
    h = +m[2];
  return b >= 15 && h >= b && h <= 600 ? { b, h } : null;
};
const xyz = (p) => Array.isArray(p) && p.length === 3 && p.every(finite);
const round = (x) => Math.round(x * 1e6) / 1e6;
const hash = (value) => {
  let n = 2166136261;
  for (const c of value) {
    n ^= c.charCodeAt(0);
    n = Math.imul(n, 16777619);
  }
  return (n >>> 0).toString(36);
};
function wallParameter(q, w) {
  const v = sub(w.b, w.a),
    L = dist(w.a, w.b);
  return L > EPS ? dot(sub(q, w.a), v) / L : NaN;
}
function onWall(q, w, padding = PLAN_TOL) {
  const L = dist(w.a, w.b);
  if (L < EPS) return false;
  const s = wallParameter(q, w),
    v = sub(w.b, w.a);
  return (
    s >= -padding && s <= L + padding && Math.abs((q.x - w.a.x) * v.y - (q.y - w.a.y) * v.x) / L <= padding
  );
}
function intervalsMinus(intervals, exclusions) {
  let out = intervals;
  for (const [a, b] of exclusions) {
    const next = [];
    for (const [x, y] of out) {
      if (b <= x + EPS || a >= y - EPS) next.push([x, y]);
      else {
        if (a > x + EPS) next.push([x, Math.min(y, a)]);
        if (b < y - EPS) next.push([Math.max(x, b), y]);
      }
    }
    out = next;
  }
  return out;
}
function wallRecords(project, base) {
  const levels = base?.geometry?.levels ?? [],
    out = [];
  for (const w of project.walls ?? []) {
    if (!w?.a || !w?.b || w.kind === "partition") continue;
    const section = parse(w.section);
    if (!section) continue;
    const applicable = w.level === undefined ? levels : levels.filter((l) => l.index === w.level);
    for (const l of applicable) {
      const bottom = l.wallBaseY ?? l.elevation,
        top = l.topY ?? bottom + l.height;
      if (finite(bottom) && finite(top))
        out.push({
          ...w,
          section,
          level: l.index,
          bottom,
          top,
          profile: base?.wallProfiles?.find(
            (p) => p.wallId === w.id && p.level === l.index && p.mode === "continuous",
          ),
        });
    }
  }
  return out;
}

/**
 * rawRafters are UNSPLIT sloping boards, not stock pieces or truss bars.
 * Added boards remain unsplit; designer-engine owns six-metre stock joints.
 */
export function buildRafterSupports(project, base, zone, rawRafters) {
  const result = {
    instances: [],
    checks: [],
    warnings: [],
    assumptions: [],
    supports: [],
    status: "unverified",
    verified: false,
  };
  const zoneId = zone?.id ?? "roof-zone",
    density = finite(project?.material?.density) ? project.material.density : 500;
  const walls = wallRecords(project, base),
    objects = (base?.timber?.instances ?? []).filter((b) => b.category === "objects");
  const ledgerSection = parse(zone?.supportSection ?? "50x200");
  const check = (id, label, status, note, extra = {}) =>
    result.checks.push({ id: `${zoneId}-${id}`, zoneId, label, status, note, ...extra });
  if (!zone || !Array.isArray(rawRafters) || !rawRafters.length) {
    check("rafter-support-input", "Опоры стропил", "fail", "Не передана геометрия стропил.");
    result.status = "fail";
    return result;
  }
  if (!ledgerSection) {
    check("rafter-support-section", "Сечение опорной доски", "fail", "Некорректное сечение опорной доски.");
    result.status = "fail";
    return result;
  }
  const groups = new Map(),
    openingConflicts = [],
    unsupported = [];
  const wallLabel = (wall) => {
    const index =
      (project.walls ?? [])
        .filter((w) => w.level === undefined || w.level === wall.level)
        .findIndex((w) => w.id === wall.id) + 1;
    return `стены ${index} · ${wall.level} этаж`;
  };
  function add(name, role, b, h, start, end, extra = {}) {
    const length = Math.hypot(...end.map((v, i) => v - start[i]));
    if (length < EPS) return;
    const volume = (b * h * length) / 1e6;
    result.instances.push({
      id: `${zoneId}-${role}-${hash(JSON.stringify([start.map(round), end.map(round), extra.wallId]))}`,
      name,
      category: "roof",
      role,
      b,
      h,
      section: `${b} × ${h}`,
      length,
      volume,
      mass: volume * density,
      start,
      end,
      crossAxis: [1, 0, 0],
      zoneId,
      level: extra.level ?? zone.levelIndex ?? 1,
      floor: extra.level ?? zone.levelIndex ?? 1,
      cutStart: { scheme: "butt", angle: 0 },
      cutEnd: { scheme: "butt", angle: 0 },
      supportGeometry: true,
      ...extra,
    });
  }
  function openingAt(w, s, y, breadth) {
    return (project.openings ?? []).find(
      (o) =>
        o.wallId === w.id &&
        (o.floor ?? w.level ?? 1) === w.level &&
        s > o.offset - breadth / 2000 - EPS &&
        s < o.offset + o.width + breadth / 2000 + EPS &&
        y > w.bottom + o.sill - EPS &&
        y < w.bottom + o.sill + o.height + EPS,
    );
  }
  function existingObject(q, y) {
    for (const b of objects) {
      if (!xyz(b.start) || !xyz(b.end)) continue;
      if (b.role === "post") {
        const radius = Math.max(b.b ?? 0, b.h ?? 0) / 2000 + PLAN_TOL;
        const related = objects.filter(
          (v) => v.role === "post" && (b.objectId ? v.objectId === b.objectId : v.memberId === b.memberId),
        );
        const actualTop = Math.max(...related.flatMap((v) => [v.start[1], v.end[1]]));
        if (Math.hypot(q.x - b.end[0], q.y - b.end[2]) <= radius && Math.abs(actualTop - y) <= HEIGHT_TOL)
          return { mode: "existingPost", objectId: b.objectId, memberId: b.memberId };
      }
      if (b.role === "customBeam") {
        const w = { a: { x: b.start[0], y: b.start[2] }, b: { x: b.end[0], y: b.end[2] } };
        const top = (b.start[1] + b.end[1]) / 2 + (b.h ?? 0) / 2000;
        if (onWall(q, w, Math.max(PLAN_TOL, (b.b ?? 0) / 2000)) && Math.abs(top - y) <= HEIGHT_TOL)
          return { mode: "existingBeam", objectId: b.objectId, memberId: b.memberId };
      }
    }
    return null;
  }
  for (const [i, rafter] of rawRafters.entries()) {
    if (
      !xyz(rafter?.start) ||
      !xyz(rafter?.end) ||
      !finite(rafter.h) ||
      !finite(rafter.b) ||
      rafter.h <= 0 ||
      rafter.b <= 0
    ) {
      unsupported.push({ rafterId: rafter?.id ?? i, reason: "Некорректная геометрия стропила." });
      continue;
    }
    const L = Math.hypot(...rafter.end.map((v, j) => v - rafter.start[j])),
      horizontal = Math.hypot(rafter.end[0] - rafter.start[0], rafter.end[2] - rafter.start[2]);
    if (L < EPS || horizontal < EPS) {
      unsupported.push({ rafterId: rafter.id ?? i, reason: "Нулевая горизонтальная длина стропила." });
      continue;
    }
    const first = rafter.bearingStart ?? rafter.supportStart ?? rafter.start,
      last = rafter.bearingEnd ?? rafter.supportEnd ?? rafter.end;
    const low = first[1] <= last[1] ? first : last,
      high = low === first ? last : first,
      depthProjection = ((rafter.h / 2000) * L) / horizontal;
    const planDirection = {
      x: (rafter.end[0] - rafter.start[0]) / horizontal,
      y: (rafter.end[2] - rafter.start[2]) / horizontal,
    };
    const alignment = (w) => {
      const d = sub(w.b, w.a),
        length = dist(w.a, w.b);
      return Math.abs(dot(d, planDirection) / length);
    };
    for (const [end, axis] of [
      ["low", low],
      ["high", high],
    ]) {
      const q = { x: axis[0], y: axis[2] },
        bearingY = axis[1] - depthProjection,
        s = {
          id: `${zoneId}-seat-${i}-${end}`,
          zoneId,
          rafterId: rafter.id ?? `rafter-${i}`,
          end,
          axis: [...axis],
          axisY: axis[1],
          bearingY,
          contactY: bearingY,
          mode: "unsupported",
          verified: false,
          status: "unverified",
        };
      const explicit = existingObject(q, bearingY);
      if (explicit) {
        Object.assign(s, explicit);
        result.supports.push(s);
        continue;
      }
      const matches = walls
        .map((w) => (w.profile ? { ...w, top: wallProfileTop(w.profile, wallParameter(q, w)) } : w))
        .filter((w) => onWall(q, w) && w.bottom <= axis[1] + HEIGHT_TOL)
        .sort((a, b) =>
          Math.abs(b.top - a.top) > HEIGHT_TOL
            ? b.top - a.top
            : alignment(a) - alignment(b) || a.id.localeCompare(b.id),
        );
      const covering = matches.find(
          (w) => w.top >= bearingY - HEIGHT_TOL && w.bottom <= bearingY + HEIGHT_TOL,
        ),
        below = matches.find((w) => w.top < bearingY - HEIGHT_TOL);
      // Existing wall top at the rafter axis is an intended eave seat. The
      // necessary birdsmouth / bearing cut is explicitly left unverified.
      const axisSeat = matches.find(
        (w) => Math.abs(w.top - bearingY) <= HEIGHT_TOL || Math.abs(w.top - axis[1]) <= HEIGHT_TOL,
      );
      if (axisSeat) {
        Object.assign(s, {
          mode: "wallBearing",
          wallId: axisSeat.id,
          wallLevel: axisSeat.level,
          level: axisSeat.level,
          seatDepthRequired: Math.max(0, axisSeat.top - bearingY),
          note: "Нижняя плоскость стропила совпадает с верхом стены. Опирание, смятие и анкеры требуют проверки.",
        });
        result.supports.push(s);
        continue;
      }
      const wall = covering ?? below;
      if (!wall) {
        s.status = "fail";
        s.note =
          "Под расчётной точкой опирания стропила нет заданной несущей стены, балки или стойки; новая скрытая опора не создаётся.";
        unsupported.push(s);
        result.supports.push(s);
        continue;
      }
      if (
        !covering &&
        wall.system !== "profiledBeam" &&
        Array.isArray(base.wallProfiles) &&
        (project.roof?.wallFraming ?? "auto") !== "stacked"
      ) {
        s.status = "fail";
        s.note =
          "Цельная стена здесь не сформирована: разрежьте стену по границе ската или задайте отдельную опору. Автоматическая составная надстройка отключена.";
        unsupported.push(s);
        result.supports.push(s);
        continue;
      }
      const offset = wallParameter(q, wall),
        opening = covering ? openingAt(wall, offset, bearingY, rafter.b) : null;
      if (opening) {
        Object.assign(s, {
          mode: "openingConflict",
          wallId: wall.id,
          wallLevel: wall.level,
          openingId: opening.id,
          status: "fail",
          note: "Опорная линия стропила попадает в оконный или дверной проём.",
        });
        openingConflicts.push(s);
        result.supports.push(s);
        continue;
      }
      const mode = covering ? "ledger" : "wallExtension";
      Object.assign(s, { mode, wallId: wall.id, wallLevel: wall.level, level: wall.level });
      const key = [wall.id, wall.level, mode, round(bearingY)].join("|");
      if (!groups.has(key)) groups.set(key, { wall, mode, bearingY, seats: [] });
      groups.get(key).seats.push({ s, offset, rafter });
      result.supports.push(s);
    }
  }
  for (const group of groups.values()) {
    const { wall, mode, bearingY, seats } = group,
      L = dist(wall.a, wall.b),
      u = { x: (wall.b.x - wall.a.x) / L, y: (wall.b.y - wall.a.y) / L },
      normal = { x: -u.y, y: u.x },
      at = (s, y) => [wall.a.x + u.x * s, y, wall.a.y + u.y * s];
    const first = Math.max(0, Math.min(...seats.map((q) => q.offset - q.rafter.b / 2000))),
      last = Math.min(L, Math.max(...seats.map((q) => q.offset + q.rafter.b / 2000)));
    if (last - first < EPS) continue;
    if (mode === "ledger") {
      // Do not draw a continuous board through a window. Even if no rafter axis
      // lands on it, the ledger itself needs a designed span/jamb connection.
      const exclusions = (project.openings ?? [])
        .filter(
          (o) =>
            o.wallId === wall.id &&
            (o.floor ?? wall.level ?? 1) === wall.level &&
            bearingY > wall.bottom + o.sill - EPS &&
            bearingY - ledgerSection.h / 1000 < wall.bottom + o.sill + o.height + EPS,
        )
        .map((o) => [o.offset, o.offset + o.width]);
      const spans = intervalsMinus([[first, last]], exclusions);
      for (const [a, b] of spans)
        add(
          "Опорная доска стропил у стены",
          "rafterLedger",
          ledgerSection.b,
          ledgerSection.h,
          at(a, bearingY - ledgerSection.h / 2000),
          at(b, bearingY - ledgerSection.h / 2000),
          {
            wallId: wall.id,
            level: wall.level,
            crossAxis: [normal.x, 0, normal.y],
            connectionVerified: false,
            reason: "ledger-to-existing-wall",
          },
        );
      if (exclusions.some(([a, b]) => a < last - EPS && b > first + EPS)) {
        openingConflicts.push({
          wallId: wall.id,
          reason: "Опорная доска пересекает проём; автоматическая доска прервана, перемычка не назначена.",
        });
      }
      result.warnings.push(
        `Опорная доска у ${wallLabel(wall)} включена в массу и раскрой. Крепление к стойкам, опирание, эксцентриситет и передача усилий через стену не рассчитаны.`,
      );
    } else {
      const section = wall.section,
        B = section.b / 1000,
        top = bearingY - B;
      add(
        "Верхняя обвязка надстройки под стропила",
        "rafterPlate",
        section.b,
        section.h,
        at(first, bearingY - B / 2),
        at(last, bearingY - B / 2),
        {
          wallId: wall.id,
          level: wall.level,
          crossAxis: [0, 1, 0],
          connectionVerified: false,
          reason: "high-wall-extension",
        },
      );
      const n = Math.max(1, Math.ceil((last - first) / (wall.studStep ?? 0.6)));
      for (let i = 0; i <= n; i++) {
        const offset = first + ((last - first) * i) / n;
        if (top > wall.top + 0.01)
          add(
            "Стойка надстройки под высокий карниз",
            "rafterSupport",
            section.b,
            section.h,
            at(offset, wall.top),
            at(offset, top),
            {
              wallId: wall.id,
              level: wall.level,
              crossAxis: [u.x, 0, u.y],
              connectionVerified: false,
              reason: "high-wall-extension",
            },
          );
      }
      result.warnings.push(
        `Надстройка ${wallLabel(wall)}: стойки и верхний пояс включены в массу и раскрой. Их устойчивость, привязка к нижним стойкам, стыки и закрепление не рассчитаны.`,
      );
    }
  }
  check(
    "rafter-support-missing",
    "Наличие расчётных стеновых опор стропил",
    unsupported.length ? "fail" : "warning",
    unsupported.length
      ? "Есть расчётные опорные точки без заданной опоры. Отдельные стойки не добавляются автоматически."
      : "Найдены геометрические опорные линии; свободные консольные концы не считаются опорами. Это не проверка несущей способности.",
    { missingCount: unsupported.length },
  );
  check(
    "rafter-support-openings",
    "Опоры стропил и проёмы стен",
    openingConflicts.length ? "fail" : "warning",
    openingConflicts.length
      ? "Опора или опорная доска пересекает проём. Нужна отдельная балка с заданными опорами либо перенос проёма."
      : "На принятой опорной высоте пересечений с проёмами не обнаружено.",
    { conflictCount: openingConflicts.length },
  );
  check(
    "rafter-support-connections",
    "Соединения и передача усилий опор",
    "unverified",
    "Ledger, надстройки стен, опорные запилы, смятие, отрыв, анкеры и передача нагрузки до фундамента требуют отдельного расчёта.",
  );
  result.assumptions = [
    "Это геометрия опор, не расчёт крепежа или пространственной устойчивости. Все supports.verified=false.",
    "bearingY=ось стропила−половина высоты доски/cos(уклона). Новая опорная доска расположена под нижней кромкой; примыкание к плоскости стены и узел запила требуют рабочего чертежа.",
    "Если существующая стена заканчивается ниже высокой опоры, стойки надстройки и пояс добавляются явно и входят в массу. Новые стойки на свободной внутренней линии без стены не изобретаются.",
    "Существующая высокая стена позволяет только предположить крепление ledger к её стойкам. Окна и двери на этой высоте блокируют автоматическое опирание и прерывают опорную доску.",
    "Все добавленные опорные доски имеют category roof и отдельные роли rafterLedger/rafterSupport/rafterPlate; это не решётка фермы и не нижний пояс.",
  ];
  result.status = result.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
  return result;
}

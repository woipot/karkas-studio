import {
  beamSection,
  beamProfiles,
  beamMoistures,
  beamCornerJoints,
  beamSettlementRatios,
  isBeamWall,
  resolveBeam,
} from "./profiled-beam-catalog.js";
// Geometry tolerances, not engineering capacities; coordinates in metres.
const EPS = 1e-7;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Adopted construction dimensions, NOT manufacturer-certified tooling:
// 0.30 m remainder, thirds for the schematic warm-corner/dovetail tongue, 50 mm casing.
// No universal dimensions verified; these are reported and connections remain unverified.
const OVERHANG = 0.3,
  CASING = 0.05;
// Adopted 0.5 kg/m2 full-width compressed jute, manufacturer example:
// https://www.jute-master.ru/dzhut-150-mm-7-8-kupit. Strip thickness is included in course pitch.
const JUTE_AREA_MASS = 0.5;
// Adopted minimum adjacent-course splice offset: owner brief, 1 m; not claimed as SP64 clause.
const STAGGER = 1;
// Casing supplier recommends 5–7% allowance for fresh solid timber:
// https://oknakg.ru/content/articles/ustanovka-okon-dom/zamerobsady.pdf
// Use 7% of casing head elevation; dry use 3% (Archzavod, catalog source), minimum 50 mm assumed.
export const openingGap = (head, moisture) => Math.max(0.05, head * (moisture === "natural" ? 0.07 : 0.03));
export function beamOpeningEnvelope(o, moisture) {
  const gap = openingGap((o.sill ?? 0) + o.height + CASING, moisture);
  return {
    ...o,
    roughFrom: o.offset - CASING,
    roughTo: o.offset + o.width + CASING,
    roughBottom: Math.max(0, (o.sill ?? 0) - CASING),
    roughTop: (o.sill ?? 0) + o.height + CASING + gap,
    requiredGap: gap,
  };
}
export function validateBeamWalls(p, error) {
  for (const [i, w] of (Array.isArray(p.walls) ? p.walls : []).entries()) {
    if (!w || typeof w !== "object" || Array.isArray(w)) continue;
    if (w.system !== undefined && !["frame", "profiledBeam"].includes(w.system))
      error(`walls.${i}.system`, "Система стены: frame или profiledBeam.");
    if (!isBeamWall(w)) {
      if (w.beam !== undefined)
        error(`walls.${i}.beam`, "Параметры бруса разрешены только для profiledBeam.");
      continue;
    }
    const f = `walls.${i}.beam`,
      b = w.beam;
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      error(f, "Нужен объект beam с сечением из каталога.");
      continue;
    }
    for (const k of Object.keys(b))
      if (
        !["section", "profile", "moisture", "cornerJoint", "dowelSpacing", "jute", "courseHeight"].includes(k)
      )
        error(f + "." + k, "Неизвестный параметр бруса.");
    const s = beamSection(b.section);
    if (!s) error(f + ".section", "Выберите сечение профилированного бруса из каталога.");
    for (const [k, catalog] of [
      ["profile", beamProfiles],
      ["moisture", beamMoistures],
      ["cornerJoint", beamCornerJoints],
    ])
      if (b[k] !== undefined && !Object.hasOwn(catalog, b[k]))
        error(f + "." + k, "Неизвестное значение параметра бруса.");
    if (
      b.dowelSpacing !== undefined &&
      (!Number.isFinite(b.dowelSpacing) || b.dowelSpacing < 1 || b.dowelSpacing > 1.5)
    )
      error(f + ".dowelSpacing", "Шаг нагелей: 1–1,5 м.");
    if (b.jute !== undefined && typeof b.jute !== "boolean") error(f + ".jute", "jute: логическое значение.");
    if (
      b.courseHeight !== undefined &&
      (!Number.isFinite(b.courseHeight) ||
        b.courseHeight <= 0 ||
        b.courseHeight > (s?.h ?? 0) / 1000 ||
        b.courseHeight < (s?.h ?? 0) / 2000)
    )
      error(f + ".courseHeight", "Рабочая высота венца: от половины до полной высоты сечения, м.");
    if (w.kind === "partition")
      error(f, "Брусовая стена должна быть exterior или bearing; лёгкие перегородки задаются frame.");
  }
  const beams = (Array.isArray(p.walls) ? p.walls : []).filter(
    (w) => isBeamWall(w) && beamSection(w.beam?.section) && w.a && w.b,
  );
  for (let i = 0; i < beams.length; i++)
    for (let j = 0; j < i; j++) {
      const a = beams[i],
        b = beams[j];
      if (a.level !== undefined && b.level !== undefined && a.level !== b.level) continue;
      const shared = [a.a, a.b].some((q) => [b.a, b.b].some((r) => distance(q, r) < EPS));
      const dx = a.b.x - a.a.x,
        dy = a.b.y - a.a.y,
        ex = b.b.x - b.a.x,
        ey = b.b.y - b.a.y,
        det = dx * ey - dy * ex;
      if (Math.abs(det) > EPS) {
        const t = ((b.a.x - a.a.x) * ey - (b.a.y - a.a.y) * ex) / det,
          u = ((b.a.x - a.a.x) * dy - (b.a.y - a.a.y) * dx) / det;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS && !shared)
          error(
            "walls",
            "Т/X-пересечения брусовых стен пока не поддержаны: требуется отдельная модель узла.",
          );
      }
      if (!shared) continue;
      const u = [a.b.x - a.a.x, a.b.y - a.a.y],
        v = [b.b.x - b.a.x, b.b.y - b.a.y];
      if (Math.abs(u[0] * v[0] + u[1] * v[1]) > EPS)
        error("walls", "Углы брусовых стен пока должны быть прямыми.");
      if (
        Math.abs(resolveBeam(a).courseHeight - resolveBeam(b).courseHeight) > EPS ||
        resolveBeam(a).cornerJoint !== resolveBeam(b).cornerJoint
      )
        error("walls", "Сопряжённым брусовым стенам нужны одинаковые рабочая высота венца и тип угла.");
    }
}
const area = (p) =>
  Math.abs(sum(p.map((a, i) => a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1]))) / 2;
/** Clip a convex polygon by a linear half-plane f(x,y)>=0. */
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      fa = f(...a),
      fb = f(...b);
    if (fa >= -EPS) out.push(a);
    if ((fa < -EPS && fb > EPS) || (fa > EPS && fb < -EPS)) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
function rect(x0, x1, y0, y1) {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}
/** Exact non-overlapping rectangular envelopes; teeth/clearance await a supplier drawing.
 * Joint footprints are complementary: lap removes opposite half-heights; warmCorner
 * uses a stepped tongue, dovetail a tapered tongue. Profiles are conceptual, not CNC. */
function footprintLayers(ctx, from, to, height, course, joints) {
  let pieces = [{ points: rect(from, to, -ctx.width / 2, ctx.width / 2), from: -height / 2, to: height / 2 }];
  for (const joint of joints) {
    const station = ctx.station(joint.point),
      lo = station - joint.otherWidth / 2,
      hi = station + joint.otherWidth / 2,
      next = [];
    for (const piece of pieces) {
      const left = clip(piece.points, (s) => lo - s),
        right = clip(piece.points, (s) => s - hi);
      for (const points of [left, right])
        if (points.length >= 3 && area(points) > EPS * EPS) next.push({ ...piece, points });
      const inside = clip(
        clip(piece.points, (s) => s - lo),
        (s) => hi - s,
      );
      if (inside.length < 3 || area(inside) < EPS * EPS) continue;
      const host = joint.host,
        ownHost = ctx.wall.id === host.wall.id;
      if (["lap", "overhang"].includes(ctx.beam.cornerJoint)) {
        const lower = ownHost !== !!(course % 2);
        next.push({ points: inside, from: lower ? -height / 2 : 0, to: lower ? 0 : height / 2 });
      } else {
        // Work in the host's (s,t) plane so both walls remove exactly the same volume.
        const toHost = ([s, t]) => {
            const q = ctx.world(s, t);
            return [host.station(q), host.transverse(q)];
          },
          fromHost = ([s, t]) => {
            const q = host.world(s, t);
            return [ctx.station(q), ctx.transverse(q)];
          },
          hp = inside.map(toHost),
          hs = host.station(joint.point),
          half = joint.guest.width / 2,
          sign = joint.guestSide,
          ownership = ownHost ? -sign : sign;
        for (const [a, b] of [
          [-half, -half / 3],
          [-half / 3, half / 3],
          [half / 3, half],
        ]) {
          let points = clip(
            clip(hp, (s) => s - hs - a),
            (s) => hs + b - s,
          );
          // Alternating host tongue; thirds are an explicit tooling assumption.
          const protrusion = ((course % 2 ? -1 : 1) * host.width) / 6;
          const boundary = (s) =>
            ctx.beam.cornerJoint === "dovetail" && a === -half / 3
              ? protrusion * (1 + (s - hs) / half)
              : a === -half / 3
                ? protrusion
                : 0;
          points = clip(points, (s, t) => ownership * (t - boundary(s)));
          if (points.length >= 3 && area(points) > EPS * EPS)
            next.push({ ...piece, points: points.map(fromHost) });
        }
      }
    }
    pieces = next;
  }
  return pieces;
}
/** Partition into <=6 m pieces; odd courses start 1 m earlier. No splice inside a lintel. */
function splitRun(a, b, course, forbidden = []) {
  const cuts = [a];
  let at = a;
  while (b - at > 6 + EPS) {
    let end = at + 6 - (cuts.length === 1 && course % 2 ? STAGGER : 0);
    while (forbidden.some(([x, y]) => end > x - EPS && end < y + EPS)) end -= STAGGER;
    if (end <= at + EPS)
      throw new Error("Стык бруса невозможно разместить вне перемычки: измените проём или длину стены.");
    cuts.push(end);
    at = end;
  }
  cuts.push(b);
  return cuts.slice(1).map((x, i) => [cuts[i], x]);
}
export function buildProfiledBeam(p, levels) {
  const out = {
    instances: [],
    walls: [],
    splices: [],
    dowels: [],
    juteLength: 0,
    checks: [],
    assumptions: [],
  };
  for (const level of levels) {
    const contexts = (p.walls ?? [])
      .filter((w) => isBeamWall(w) && (w.level === undefined || w.level === level.index))
      .map((w) => {
        const beam = resolveBeam(w),
          length = distance(w.a, w.b),
          ux = (w.b.x - w.a.x) / length,
          uy = (w.b.y - w.a.y) / length;
        return {
          wall: w,
          beam,
          length,
          width: beam.b / 1000,
          world: (s, t = 0) => ({ x: w.a.x + ux * s - uy * t, y: w.a.y + uy * s + ux * t }),
          station: (q) => (q.x - w.a.x) * ux + (q.y - w.a.y) * uy,
          transverse: (q) => -(q.x - w.a.x) * uy + (q.y - w.a.y) * ux,
          normal: [-uy, 0, ux],
        };
      });
    const joints = [];
    for (let i = 0; i < contexts.length; i++)
      for (let j = 0; j < i; j++) {
        const a = contexts[i],
          b = contexts[j],
          point = [a.wall.a, a.wall.b].find((q) => [b.wall.a, b.wall.b].some((r) => distance(q, r) < EPS));
        if (!point) continue;
        const host = a.wall.id < b.wall.id ? a : b,
          guest = host === a ? b : a,
          inner = distance(point, guest.wall.a) < EPS ? guest.wall.b : guest.wall.a;
        joints.push({ point, host, guest, guestSide: Math.sign(host.transverse(inner)) });
      }
    for (const ctx of contexts) {
      const { wall: w, beam: b, length: L, width: W } = ctx,
        H = w.height ?? level.height,
        pitch = b.courseHeight,
        count = Math.ceil((H - EPS) / pitch),
        ownJoints = joints
          .filter((j) => j.host === ctx || j.guest === ctx)
          .map((j) => ({ ...j, otherWidth: (j.host === ctx ? j.guest : j.host).width })),
        extension = (end) => {
          const j = ownJoints.find((j) => Math.abs(ctx.station(j.point) - end) < EPS);
          return j ? (b.cornerJoint === "overhang" ? OVERHANG + j.otherWidth / 2 : j.otherWidth / 2) : 0;
        },
        start = -extension(0),
        end = L + extension(L),
        openings = (p.openings ?? [])
          .filter((o) => o.wallId === w.id && (o.floor ?? w.level ?? 1) === level.index)
          .map((o) => beamOpeningEnvelope(o, b.moisture)),
        rows = [],
        juteStart = out.juteLength;
      for (const o of openings)
        if (o.roughFrom < 0 || o.roughTo > L || o.roughTop > H - pitch + EPS)
          out.checks.push({
            id: `beam-opening-fit-${w.id}-${o.id}`,
            wallId: w.id,
            label: "Брус: обсада и верхний венец у проёма",
            status: "fail",
            note: "Обсада с усадочным зазором не помещается: оставьте цельный верхний венец и простенки.",
          });
      for (let course = 0; course < count; course++) {
        const bottom = course * pitch,
          height = Math.min(pitch, H - bottom),
          y = level.wallBaseY + bottom + height / 2,
          removed = openings
            .filter((o) => o.roughBottom < bottom + height - EPS && o.roughTop > bottom + EPS)
            .map((o) => [o.roughFrom, o.roughTo])
            .sort((a, b) => a[0] - b[0]);
        let runs = [[start, end]];
        for (const [a, z] of removed)
          runs = runs.flatMap(([x, y]) =>
            z <= x || a >= y
              ? [[x, y]]
              : [
                  [x, Math.min(a, y)],
                  [Math.max(z, x), y],
                ].filter(([s, t]) => t - s > EPS),
          );
        const row = { course: course + 1, bottom, top: bottom + height, partIds: [], splices: [] };
        for (const [a, z] of runs) {
          const forbidden = openings
            .filter((o) => bottom >= o.roughTop - EPS && bottom < o.roughTop + pitch)
            .map((o) => [o.roughFrom - W, o.roughTo + W]);
          const parts = splitRun(a, z, course, [
            ...forbidden,
            ...(rows.at(-1)?.splices ?? []).map((s) => [s - STAGGER + 10 * EPS, s + STAGGER - 10 * EPS]),
          ]);
          for (const [x, t] of parts) {
            const polygons = footprintLayers(ctx, x, t, height, course, ownJoints),
              len = t - x,
              center = (x + t) / 2,
              layers = polygons.map((q) => ({
                from: q.from,
                to: q.to,
                points: q.points.map(([s, v]) => [s - center, v]),
              })),
              volume = sum(polygons.map((q) => area(q.points) * (q.to - q.from))),
              at = (s) => {
                const q = ctx.world(s);
                return [q.x, y, q.y];
              },
              id = `PB-${w.id}-L${level.index}-C${course + 1}-P${row.partIds.length + 1}`;
            out.instances.push({
              id,
              name:
                course === 0
                  ? "Окладной венец"
                  : course === count - 1
                    ? "Верхний венец"
                    : "Венец брусовой стены",
              role: "beamCourse",
              category: "walls",
              wallId: w.id,
              level: level.index,
              floor: level.index,
              b: b.b,
              h: b.h,
              start: at(x),
              end: at(t),
              crossAxis: ctx.normal,
              requireSingleStock: true,
              course: course + 1,
              courseHeight: height,
              profile: b.profile,
              moisture: b.moisture,
              cornerJoint: b.cornerJoint,
              overhangLength: b.cornerJoint === "overhang" ? OVERHANG : 0,
              shape: { type: "layeredProfile", plane: "width", layers },
              shapeNetVolume: volume,
              shapeGrossVolume: (b.b * b.h * len) / 1e6,
              shapeCutLength: len,
              cutStart: { scheme: "butt", angle: 0 },
              cutEnd: { scheme: "butt", angle: 0 },
              beamJointCuts: ownJoints.map((j) => ({
                type: b.cornerJoint,
                station: ctx.station(j.point) - x,
                otherWidth: j.otherWidth,
                verified: false,
              })),
            });
            row.partIds.push(id);
          }
          for (const [, s] of parts.slice(0, -1)) {
            row.splices.push(s);
            out.splices.push({
              id: `PBS-${w.id}-L${level.index}-C${course + 1}-${s}`,
              wallId: w.id,
              level: level.index,
              course: course + 1,
              station: s,
              scheme: "butt",
              partIds: row.partIds.slice(-parts.length),
              status: "unverified",
            });
          }
        }
        // One dowel per interface location; paired dowels either side of each longitudinal splice.
        if (course > 0)
          for (const [a, z] of runs) {
            const positions = [];
            const margin = Math.min(b.dowelSpacing / 2, (z - a) / 2),
              phase = course % 2 ? 0 : b.dowelSpacing / 2;
            positions.push(a + margin, z - margin);
            for (let s = a + margin + phase; s < z - margin - EPS; s += b.dowelSpacing) positions.push(s);
            for (const s of row.splices.filter((s) => s > a && s < z)) positions.push(s - W / 2, s + W / 2);
            const previous = rows.at(-1),
              prevBoards = out.instances.filter((q) => previous.partIds.includes(q.id));
            for (const s of [...new Set(positions.map((s) => Number(s.toFixed(6))))].sort((a, b) => a - b)) {
              if (s <= a + EPS || s >= z - EPS) continue;
              const q = ctx.world(s),
                supported = prevBoards.some((qb) => {
                  const x = ctx.station({ x: qb.start[0], y: qb.start[2] }),
                    z = ctx.station({ x: qb.end[0], y: qb.end[2] });
                  return s > x + EPS && s < z - EPS;
                });
              if (supported)
                out.dowels.push({
                  wallId: w.id,
                  level: level.index,
                  course: course + 1,
                  station: s,
                  point: [q.x, level.wallBaseY + bottom, q.y],
                });
            }
          }
        // One strip per actual horizontal interface, including the first waterproofed course.
        if (b.jute) out.juteLength += sum(runs.map(([a, z]) => z - a));
        rows.push(row);
      }
      // Casing is physical timber, counted once with the same material density as all other boards.
      for (const o of openings) {
        const low = level.wallBaseY + (o.sill ?? 0),
          top = low + o.height;
        const at = (s, y) => {
          const q = ctx.world(s);
          return [q.x, y, q.y];
        };
        const add = (suffix, a, z, bb, hh, crossAxis) =>
          out.instances.push({
            id: `PBC-${w.id}-${level.index}-${o.id}-${suffix}`,
            name: "Обсада проёма",
            category: "walls",
            role: "beamCasing",
            wallId: w.id,
            openingId: o.id,
            level: level.index,
            floor: level.index,
            b: bb,
            h: hh,
            start: a,
            end: z,
            crossAxis,
            requireSingleStock: true,
          });
        add(
          "left",
          at(o.offset - CASING / 2, low),
          at(o.offset - CASING / 2, top),
          b.b,
          CASING * 1000,
          ctx.normal,
        );
        add(
          "right",
          at(o.offset + o.width + CASING / 2, low),
          at(o.offset + o.width + CASING / 2, top),
          b.b,
          CASING * 1000,
          ctx.normal,
        );
        add(
          "head",
          at(o.offset - CASING, top + CASING / 2),
          at(o.offset + o.width + CASING, top + CASING / 2),
          b.b,
          CASING * 1000,
          ctx.normal,
        );
        if (o.type !== "door")
          add(
            "sill",
            at(o.offset - CASING, low - CASING / 2),
            at(o.offset + o.width + CASING, low - CASING / 2),
            b.b,
            CASING * 1000,
            ctx.normal,
          );
        o.actualGap = Math.ceil((o.roughTop - EPS) / pitch) * pitch - ((o.sill ?? 0) + o.height + CASING);
      }
      out.walls.push({
        wallId: w.id,
        level: level.index,
        height: H,
        width: W,
        length: L,
        juteLength: out.juteLength - juteStart,
        juteMass: (out.juteLength - juteStart) * W * JUTE_AREA_MASS,
        courseCount: count,
        courseHeight: pitch,
        courses: rows,
        openings,
        settlementRatio: beamSettlementRatios[b.moisture],
        settlementMM: H * beamSettlementRatios[b.moisture] * 1000,
        jointGapMM: H * beamSettlementRatios[b.moisture] * 1000,
      });
    }
  }
  out.juteMass = sum(out.walls.map((w) => w.juteMass));
  if (out.walls.length)
    out.assumptions.push(
      "Брус: для каркасной надстройки section=50×150 и studStep=0,6 м при отсутствии полей — прежние значения генератора. Мастер предлагает 145×145 мм как пример из каталога; сечение передаётся явно. Без system — каркас; beam.profile=comb, moisture=natural, cornerJoint=warmCorner, dowelSpacing=1,2 м, jute=true по умолчанию. Шаг принят в диапазоне 1–1,5 м (pilomaterials.ru/blog/sposoby-krepleniya-brusa/); нагели по каждому межвенцовому шву, со сдвигом половины шага и парами у стыков. Диаметр, сверление и прочность не подтверждены.",
      "Брус: beam.section задаётся обязательно; рабочая высота beam.courseHeight по умолчанию равна высоте сечения — допущение до чертежа поставщика. Зубья шип-паз не выдумываются: масса и изгиб по прямоугольному эквиваленту, ослабление профилем и фактическая площадь контакта не подтверждены. Верхний венец подрезан до проектной высоты; закупка по полному сечению.",
      "Брус: окладной венец на платформе над ростверком с проектной гидроизоляцией (толщина/масса отсечки не заданы). Нагрузки идут существующим путём стен/платформы на ростверк. Крепление и местное продавливание настила не подтверждены. Фронтоны и подъём односкатной стены остаются каркасными.",
      "Брус: разбежка стыков не менее 1 м принята по заданию; стык на двух нагелях не является подтверждённым изгибным соединением. Углы — комплементарная концептуальная выборка; тёплый угол/ласточкин хвост по третям сечения, остаток 300 мм и обсада 50 мм — допущения без чертежа изготовителя, не размеры для ЧПУ.",
      "Брус: усадка естественной влажности 6% высоты (принято из диапазона 4–6% отраслевой практики), сухого цельного бруса 3% (arhzavod.ru/info/articles/tablitsy-sdviga-skatov/). Это допущения, не нормативная гарантия и не усадка клеёного бруса. Над обсадой 7% отметки верха обсады для сырого / 3% для сухого, минимум 50 мм; источник 5–7%: oknakg.ru/content/articles/ustanovka-okon-dom/zamerobsady.pdf; округление выреза вверх до венца.",
      "Брус: джут учтён в массе по 0,5 кг/м² на полную ширину стены (допущение по ленте ДжутМастер: jute-master.ru/dzhut-150-mm-7-8-kupit); сжатая толщина входит в рабочий шаг венца. Нагели заменяют высверленную древесину внутри прямоугольного эквивалента, без повторного добавления массы; плотность принята той же, что у бруса. Реальные диаметр, плотность берёзы, масса металлического крепежа и гидроизоляции не подтверждены. Плотность бруса берётся из material.density, без отдельного повторного веса стен. Поставщик должен подтвердить влажность 12–18% и фактическую геометрию сечения (200×200 может быть размером заготовки).",
    );
  return out;
}

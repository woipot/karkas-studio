/** Imported physical roof geometry. No inferred frame, supports or connection capacity. */
const EPS = 1e-7,
  finite = Number.isFinite,
  object = (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  clone = (v) => structuredClone(v);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  sub = (a, b) => a.map((v, i) => v - b[i]),
  cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit = (v) => {
    const L = Math.hypot(...v);
    return finite(L) && L > EPS ? v.map((x) => x / L) : null;
  };
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  signed = (P) =>
    P.reduce((s, a, i) => s + a[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * a[1], 0) / 2;
const string = (v, n = 160) => typeof v === "string" && v.trim().length > 0 && v.length <= n;
const xyz = (q) =>
  Array.isArray(q) &&
  q.length === 3 &&
  q.every(finite) &&
  Math.abs(q[0]) <= 40 &&
  q[1] >= 0 &&
  q[1] <= 40 &&
  Math.abs(q[2]) <= 40;
const section = (v) => {
  const m = typeof v === "string" && v.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/);
  return m && +m[1] >= 15 && +m[1] <= 300 && +m[2] >= +m[1] && +m[2] <= 600 ? { b: +m[1], h: +m[2] } : null;
};
function touch(a, b, c, d) {
  const ca = cross(a, b, c),
    da = cross(a, b, d),
    ac = cross(c, d, a),
    bc = cross(c, d, b),
    on = (q, x, z) =>
      Math.abs(cross(x, z, q)) < EPS &&
      q[0] >= Math.min(x[0], z[0]) - EPS &&
      q[0] <= Math.max(x[0], z[0]) + EPS &&
      q[1] >= Math.min(x[1], z[1]) - EPS &&
      q[1] <= Math.max(x[1], z[1]) + EPS;
  return (ca * da < 0 && ac * bc < 0) || on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b);
}
function simple(P) {
  if (P.length < 3 || Math.abs(signed(P)) < EPS) return false;
  for (let i = 0; i < P.length; i++) {
    if (Math.hypot(...sub(P[i], P[(i + 1) % P.length])) < EPS) return false;
    for (let j = 0; j < i; j++)
      if (
        i - j !== 1 &&
        i - j !== P.length - 1 &&
        touch(P[i], P[(i + 1) % P.length], P[j], P[(j + 1) % P.length])
      )
        return false;
  }
  return true;
}
function triangles(input) {
  const P = signed(input) < 0 ? [...input].reverse() : [...input],
    ids = P.map((_, i) => i),
    out = [];
  while (ids.length > 3) {
    let found = false;
    for (let j = 0; j < ids.length; j++) {
      const a = ids[(j + ids.length - 1) % ids.length],
        b = ids[j],
        c = ids[(j + 1) % ids.length];
      if (cross(P[a], P[b], P[c]) <= EPS) continue;
      if (
        ids.some(
          (k) =>
            k !== a &&
            k !== b &&
            k !== c &&
            cross(P[a], P[b], P[k]) >= -EPS &&
            cross(P[b], P[c], P[k]) >= -EPS &&
            cross(P[c], P[a], P[k]) >= -EPS,
        )
      )
        continue;
      out.push([P[a], P[b], P[c]]);
      ids.splice(j, 1);
      found = true;
      break;
    }
    if (!found) throw Error("Полигон не триангулируется.");
  }
  out.push(ids.map((i) => P[i]));
  return out;
}
function triangleOverlap(A, B) {
  let P = A;
  for (let i = 0; i < 3 && P.length; i++) {
    const a = B[i],
      b = B[(i + 1) % 3],
      next = [];
    for (let j = 0; j < P.length; j++) {
      const q = P[j],
        z = P[(j + 1) % P.length],
        f = cross(a, b, q),
        g = cross(a, b, z);
      if (f >= -EPS) next.push(q);
      if (f >= -EPS !== g >= -EPS) {
        const t = f / (f - g);
        next.push([q[0] + (z[0] - q[0]) * t, q[1] + (z[1] - q[1]) * t]);
      }
    }
    P = next;
  }
  return P.length >= 3 ? Math.abs(signed(P)) : 0;
}
function centroid(P) {
  const A = signed(P);
  return [0, 1].map(
    (k) =>
      P.reduce((s, a, i) => {
        const b = P[(i + 1) % P.length],
          c = a[0] * b[1] - b[0] * a[1];
        return s + (a[k] + b[k]) * c;
      }, 0) /
      (6 * A),
  );
}
export const sourceRoofLimits = Object.freeze({
  maxMembers: 5000,
  maxSurfaces: 1000,
  maxPoints: 64,
  maxCoordinate: 40,
  maxMemberLength: 40,
});
/** Strict, pure validation; normalized geometry is returned only if all records are valid. */
export function validateSourceRoofModel(model, { floors = 1, density = 500, snowMu } = {}) {
  const errors = [],
    members = [],
    surfaces = [],
    error = (field, message) => errors.push({ field: "roof.sourceModel" + field, message }),
    keys = (x, allowed, f) => {
      for (const k of Object.keys(x))
        if (!allowed.includes(k)) error(f + "." + k, "Неизвестное поле импорта.");
    };
  if (!object(model)) {
    error("", "Нужен объект физических досок и скатов.");
    return { valid: false, errors, members, surfaces };
  }
  keys(model, ["id", "source", "members", "surfaces", "assumptions", "missingItems"], "");
  if (model.id !== undefined && !string(model.id, 100)) error(".id", "ID до 100 символов.");
  if (
    !object(model.source) ||
    !string(model.source.title) ||
    !Array.isArray(model.source.pageRefs) ||
    !model.source.pageRefs.length ||
    model.source.pageRefs.length > 100 ||
    !model.source.pageRefs.every((v) => Number.isInteger(v) && v > 0 && v <= 100000)
  )
    error(".source", "Нужны название источника и номера страниц pageRefs.");
  else {
    keys(model.source, ["title", "pageRefs", "sha256", "fileName", "note", "url"], ".source");
    for (const k of ["fileName", "note", "url"])
      if (model.source[k] !== undefined && !string(model.source[k], 2000))
        error(".source." + k, "Некорректный текст источника.");
    if (model.source.sha256 !== undefined && !/^[a-f\d]{64}$/i.test(model.source.sha256))
      error(".source.sha256", "SHA256: 64 шестнадцатеричных символа.");
  }
  for (const k of ["assumptions", "missingItems"])
    if (
      model[k] !== undefined &&
      (!Array.isArray(model[k]) || model[k].length > 100 || !model[k].every((v) => string(v, 2000)))
    )
      error("." + k, "Массив до 100 непустых строк.");
  if (!Number.isInteger(floors) || floors < 1 || floors > 10) error("", "Invalid floor count.");
  if (!finite(density) || density < 100 || density > 1500)
    error("", "Нужна конечная плотность древесины100…1500кг/м³.");
  if (snowMu !== undefined && (!finite(snowMu) || snowMu < 0 || snowMu > 3))
    error("", "Ручной snowMu должен быть0…3.");
  if (!Array.isArray(model.members) || !model.members.length || model.members.length > 5000)
    error(".members", "Массив 1…5000 физических досок.");
  if (!Array.isArray(model.surfaces) || !model.surfaces.length || model.surfaces.length > 1000)
    error(".surfaces", "Массив 1…1000 неперекрывающихся скатов.");
  if (errors.length) return { valid: false, errors, members: [], surfaces: [] };
  const ids = new Set(),
    zoneId = model.id ?? "SOURCE-ROOF";
  for (const [i, m] of model.members.entries()) {
    const f = ".members." + i,
      startErrors = errors.length;
    if (!object(m)) {
      error(f, "Доска должна быть объектом.");
      continue;
    }
    keys(
      m,
      [
        "id",
        "name",
        "role",
        "section",
        "start",
        "end",
        "crossAxis",
        "cutStart",
        "cutEnd",
        "shape",
        "blankLength",
        "sourceMark",
        "sourcePage",
        "note",
        "level",
        "floor",
        "zoneId",
      ],
      f,
    );
    if (!string(m.id, 100) || ids.has(m.id)) error(f + ".id", "Уникальный непустой ID до 100 символов.");
    ids.add(m.id);
    if (!string(m.name) || !string(m.role, 80)) error(f, "Нужны name и role.");
    for (const k of ["sourceMark", "note", "zoneId"])
      if (m[k] !== undefined && !string(m[k], 500)) error(f + "." + k, "Некорректный текст.");
    if (m.sourcePage !== undefined && (!Number.isInteger(m.sourcePage) || m.sourcePage <= 0))
      error(f + ".sourcePage", "Положительный номер страницы.");
    const sec = section(m.section),
      level = m.level ?? m.floor ?? 1;
    if (!sec) error(f + ".section", "Сечение b×h в мм: 15≤b≤300, b≤h≤600.");
    if (
      !Number.isInteger(level) ||
      level < 1 ||
      level > floors ||
      (m.level !== undefined && m.floor !== undefined && m.level !== m.floor)
    )
      error(f + ".level", "Этаж импорта должен существовать.");
    if (!xyz(m.start) || !xyz(m.end)) error(f, "start/end: [X,Y,Z] в м; |X|/|Z|≤40, 0≤Y≤40.");
    if (
      !Array.isArray(m.crossAxis) ||
      m.crossAxis.length !== 3 ||
      !m.crossAxis.every(finite) ||
      Math.hypot(...m.crossAxis) < EPS
    )
      error(f + ".crossAxis", "Нужен ненулевой конечный вектор ширины доски.");
    if (errors.length > startErrors) continue;
    const delta = sub(m.end, m.start),
      L = Math.hypot(...delta),
      d = unit(delta);
    if (!d || L < 0.005 || L > 40) {
      error(f, "Осевая длина: 0.005…40 м.");
      continue;
    }
    const x = unit(m.crossAxis.map((v, k) => v - dot(m.crossAxis, d) * d[k]));
    if (!x) {
      error(f + ".crossAxis", "Вектор ширины параллелен оси.");
      continue;
    }
    const z = cross3(x, d),
      center = m.start.map((v, k) => (v + m.end[k]) / 2);
    function cut(raw, k) {
      const c = raw ?? { scheme: "butt", angle: 0 };
      if (!object(c) || !["butt", "miter"].includes(c.scheme)) {
        error(f + "." + k, "Поддержаны butt или miter; стыки не создаются автоматически.");
        return null;
      }
      keys(c, ["scheme", "plane", "angle", "tiltSign", "cutWidthMM"], f + "." + k);
      const angle = c.angle ?? 0,
        plane = c.plane ?? "depth",
        width = plane === "width" ? sec.b : sec.h;
      if (
        !finite(angle) ||
        angle < 0 ||
        angle > 75 ||
        !["depth", "width"].includes(plane) ||
        (c.tiltSign !== undefined && ![1, -1].includes(c.tiltSign)) ||
        (c.cutWidthMM !== undefined && (!finite(c.cutWidthMM) || Math.abs(c.cutWidthMM - width) > EPS)) ||
        (c.scheme === "butt" && angle !== 0)
      ) {
        error(
          f + "." + k,
          "Конечный угол 0…75°, plane depth/width, tiltSign ±1; cutWidthMM равен реальному сечению.",
        );
        return null;
      }
      return c.scheme === "butt"
        ? { scheme: "butt", angle: 0 }
        : { scheme: "miter", angle, plane, tiltSign: c.tiltSign ?? 1, cutWidthMM: width };
    }
    const cs = cut(m.cutStart, "cutStart"),
      ce = cut(m.cutEnd, "cutEnd");
    if (errors.length > startErrors || !cs || !ce) continue;
    let volume = (sec.b * sec.h * L) / 1e6,
      blank =
        L +
        [cs, ce].reduce(
          (s, c) =>
            s + (c.scheme === "miter" ? (c.cutWidthMM / 2000) * Math.tan((c.angle * Math.PI) / 180) : 0),
          0,
        ),
      cg = [...center],
      shape;
    const shift = (c, w, v) =>
      c.scheme === "miter"
        ? (c.plane === "width" ? w : v) * Math.tan((c.angle * Math.PI) / 180) * (c.tiltSign ?? 1)
        : 0;
    for (const w of [-sec.b / 2000, sec.b / 2000])
      for (const v of [-sec.h / 2000, sec.h / 2000])
        if (L + (ce.plane === "width" ? shift(ce, w, v) : -shift(ce, w, v)) - shift(cs, w, v) <= EPS)
          error(f, "Торцевые запилы пересекаются в короткой доске.");
    let shapeVertices;
    if (m.shape !== undefined) {
      const S = m.shape,
        plane = S?.plane ?? "depth",
        width = plane === "width" ? sec.b : sec.h,
        thickness = plane === "width" ? sec.h : sec.b;
      const layered = S?.type === "layeredProfile",
        layers = layered ? S.layers : [{ from: -thickness / 2000, to: thickness / 2000, points: S?.points }];
      if (
        !object(S) ||
        !["rafterSeats", "rippedBoard", "layeredProfile"].includes(S.type) ||
        !["depth", "width"].includes(plane) ||
        !Array.isArray(layers) ||
        !layers.length ||
        layers.length > 32
      ) {
        error(
          f + ".shape",
          "Готовый профиль: rafterSeats/rippedBoard или layeredProfile; plane depth/width, до32слоёв.",
        );
        continue;
      }
      keys(S, layered ? ["type", "plane", "layers"] : ["type", "plane", "points"], f + ".shape");
      if (cs.scheme !== "butt" || ce.scheme !== "butt") {
        error(f + ".shape", "У готового профиля торцы butt, чтобы не выполнять запил дважды.");
        continue;
      }
      let count = 0;
      const valid = layers.every((layer, j) => {
        if (!object(layer)) return false;
        if (layered) keys(layer, ["from", "to", "points"], f + ".shape.layers." + j);
        const P = layer.points;
        count += P?.length ?? 0;
        return (
          finite(layer.from) &&
          finite(layer.to) &&
          layer.to - layer.from > EPS &&
          layer.from >= -thickness / 2000 - EPS &&
          layer.to <= thickness / 2000 + EPS &&
          Array.isArray(P) &&
          P.length >= 3 &&
          P.length <= 64 &&
          P.every(
            (q) =>
              Array.isArray(q) &&
              q.length === 2 &&
              q.every(finite) &&
              Math.abs(q[0]) <= L / 2 + 2 &&
              Math.abs(q[1]) <= width / 2000 + EPS,
          ) &&
          simple(P)
        );
      });
      if (!valid || count > 256) {
        error(
          f + ".shape",
          "Простые профили по3…64точки [s,face] в м; до256точек всего. Слои должны лежать внутри реального сечения.",
        );
        continue;
      }
      let work = 0,
        overlap = false;
      for (let i = 0; i < layers.length && !overlap; i++)
        for (let j = 0; j < i && !overlap; j++) {
          const A = layers[i],
            B = layers[j];
          if (Math.min(A.to, B.to) - Math.max(A.from, B.from) <= EPS) continue;
          let area = 0;
          for (const a of triangles(A.points))
            for (const b of triangles(B.points)) {
              if (++work > 25000) {
                overlap = true;
                break;
              }
              area += triangleOverlap(a, b);
            }
          if (area > 1e-9) overlap = true;
        }
      if (overlap) {
        error(
          f + ".shape",
          "Слои профиля пересекаются либо проверка слишком сложна: древесину нельзя считать дважды.",
        );
        continue;
      }
      const range = layers.flatMap((l) => l.points.map((q) => q[0]));
      blank = Math.max(...range) - Math.min(...range);
      volume = 0;
      cg = [0, 0, 0];
      shapeVertices = [];
      for (const layer of layers) {
        const P = layer.points,
          C = centroid(P),
          v = Math.abs(signed(P)) * (layer.to - layer.from),
          face = plane === "width" ? x : z,
          extrude = plane === "width" ? z : x;
        volume += v;
        for (let k = 0; k < 3; k++)
          cg[k] +=
            v * (center[k] + d[k] * C[0] + face[k] * C[1] + (extrude[k] * (layer.from + layer.to)) / 2);
        for (const [s, w] of P)
          for (const e of [layer.from, layer.to])
            shapeVertices.push(center.map((c, k) => c + d[k] * s + face[k] * w + extrude[k] * e));
      }
      cg = cg.map((v) => v / volume);
      shape = clone(S);
    }
    if (m.blankLength !== undefined) {
      if (!finite(m.blankLength) || m.blankLength <= 0 || m.blankLength > 40 || m.blankLength < blank - EPS) {
        error(
          f + ".blankLength",
          "Заготовка в метрах должна быть конечной, не меньше габарита готовой детали и не больше40м.",
        );
        continue;
      }
      blank = m.blankLength;
    }
    if (
      !finite(blank) ||
      blank <= 0 ||
      blank > 40 ||
      !finite(volume) ||
      volume <= 0 ||
      !cg.every(finite) ||
      volume > (sec.b * sec.h * blank) / 1e6 + EPS
    ) {
      error(f, "Недопустимый габарит профиля, объём/масса или длина заготовки.");
      continue;
    }
    if (shapeVertices) {
      if (shapeVertices.some((q) => !xyz(q)))
        error(f, "Физический габарит профиля вышел за пределы40м или Y<0.");
    } else {
      const local =
        shape?.points ??
        [-1, 1].flatMap((end) => [-1, 1].map((side) => [(end * L) / 2, (side * sec.h) / 2000]));
      for (const [s, v] of local)
        for (const w of [-sec.b / 2000, sec.b / 2000]) {
          const end = s < 0 ? cs : ce,
            axis =
              s +
              (shape
                ? 0
                : s < 0
                  ? shift(cs, w, v)
                  : ce.plane === "width"
                    ? shift(ce, w, v)
                    : -shift(ce, w, v)),
            q = center.map((c, k) => c + x[k] * w + d[k] * axis + z[k] * v);
          if (!xyz(q)) error(f, "Физический габарит доски вышел за пределы 40 м или Y<0.");
        }
    }
    if (errors.length > startErrors) continue;
    members.push({
      ...clone(m),
      b: sec.b,
      h: sec.h,
      length: L,
      cutLength: blank,
      actualCutLength: blank,
      volume,
      netVolume: volume,
      grossVolume: (sec.b * sec.h * blank) / 1e6,
      mass: volume * density,
      massCenter: cg,
      category: "roof",
      zoneId: m.zoneId ?? zoneId,
      level,
      floor: level,
      cutStart: cs,
      cutEnd: ce,
      shape,
      shapeNetVolume: volume,
      shapeGrossVolume: (sec.b * sec.h * blank) / 1e6,
      shapeCutLength: blank,
      requireSingleStock: true,
      sourceImported: true,
      connectionVerified: false,
    });
  }
  const surfaceIds = new Set();
  let pointCount = 0;
  for (const [i, s] of model.surfaces.entries()) {
    const f = ".surfaces." + i,
      startErrors = errors.length;
    if (!object(s)) {
      error(f, "Скат должен быть объектом.");
      continue;
    }
    keys(s, ["id", "kind", "points", "zoneId", "snowMu", "sourcePage", "sourceMark", "annexIds"], f);
    if (!string(s.id, 100) || surfaceIds.has(s.id)) error(f + ".id", "Нужен уникальный ID ската.");
    surfaceIds.add(s.id);
    if (!string(s.kind, 80)) error(f + ".kind", "Нужен kind ската.");
    if (!Array.isArray(s.points) || s.points.length < 3 || s.points.length > 64 || !s.points.every(xyz)) {
      error(f + ".points", "Плоский скат: 3…64 точки [X,Y,Z] в м, в пределах 40 м.");
      continue;
    }
    pointCount += s.points.length;
    if (pointCount > 12000) {
      error(f + ".points", "Слишком много вершин скатов (максимум 12000).");
      break;
    }
    const plan = s.points.map((q) => [q[0], q[2]]);
    if (!simple(plan)) {
      error(f + ".points", "План ската должен быть простым невырожденным полигоном.");
      continue;
    }
    const N = s.points.reduce(
        (n, q, j) => {
          const c = cross3(q, s.points[(j + 1) % s.points.length]);
          return n.map((v, k) => v + c[k] / 2);
        },
        [0, 0, 0],
      ),
      A = Math.hypot(...N),
      n = unit(N),
      projection = Math.abs(N[1]);
    if (!n || projection < 0.0001 || s.points.some((q) => Math.abs(dot(sub(q, s.points[0]), n)) > 1e-6)) {
      error(f + ".points", "Скат должен быть плоским, с ненулевой горизонтальной проекцией.");
      continue;
    }
    const pitch = (Math.acos(Math.min(1, Math.abs(n[1]))) * 180) / Math.PI,
      coef = s.snowMu ?? snowMu ?? (pitch <= 30 ? 0.8 : Math.max(0, (0.8 * (60 - pitch)) / 30));
    if (!finite(coef) || coef < 0 || coef > 3) error(f + ".snowMu", "Коэффициент снега должен быть 0…3.");
    if (s.sourcePage !== undefined && (!Number.isInteger(s.sourcePage) || s.sourcePage <= 0))
      error(f + ".sourcePage", "Positive source page required.");
    if (s.sourceMark !== undefined && !string(s.sourceMark, 500))
      error(f + ".sourceMark", "Invalid source mark.");
    if (s.zoneId !== undefined && !string(s.zoneId, 100)) error(f + ".zoneId", "Некорректный zoneId.");
    if (
      s.annexIds !== undefined &&
      (!Array.isArray(s.annexIds) || s.annexIds.length > 10 || !s.annexIds.every((v) => string(v, 80)))
    )
      error(f + ".annexIds", "До 10 явных ID покрытых платформ.");
    if (errors.length > startErrors) continue;
    surfaces.push({
      ...clone(s),
      zoneId: s.zoneId ?? zoneId,
      area: A,
      projectedArea: projection,
      pitch,
      snowMu: coef,
      snowCoefficientBasis:
        s.snowMu !== undefined
          ? "explicit-surface"
          : snowMu !== undefined
            ? "explicit-project"
            : "adopted-legacy-shape",
      snowEffectiveArea: projection * coef,
      _triangles: triangles(plan),
      _bounds: [
        Math.min(...plan.map((q) => q[0])),
        Math.max(...plan.map((q) => q[0])),
        Math.min(...plan.map((q) => q[1])),
        Math.max(...plan.map((q) => q[1])),
      ],
    });
  }
  let work = 0,
    stop = false;
  for (let i = 0; i < surfaces.length && !stop; i++)
    for (let j = 0; j < i && !stop; j++) {
      const A = surfaces[i],
        B = surfaces[j],
        a = A._bounds,
        b = B._bounds;
      if (
        Math.min(a[1], b[1]) - Math.max(a[0], b[0]) <= EPS ||
        Math.min(a[3], b[3]) - Math.max(a[2], b[2]) <= EPS
      )
        continue;
      let overlap = 0;
      for (const ta of A._triangles)
        for (const tb of B._triangles) {
          if (++work > 100000) {
            error(".surfaces", "Слишком сложная проверка перекрытий скатов.");
            stop = true;
            break;
          }
          overlap += triangleOverlap(ta, tb);
        }
      if (overlap > 1e-6) {
        error(
          ".surfaces",
          `Скаты ${A.id}/${B.id} дважды покрывают ${overlap.toFixed(6)} м² плана; снег и площадь нельзя учитывать дважды.`,
        );
        stop = true;
      }
    }
  return {
    valid: !errors.length,
    errors,
    members: errors.length ? [] : members,
    surfaces: errors.length ? [] : surfaces.map(({ _triangles, _bounds, ...s }) => s),
  };
}

export function calculateSourceRoof(project) {
  const model = project.roof?.sourceModel,
    V = validateSourceRoofModel(model, {
      floors: project.floors ?? 1,
      density: project.material?.density ?? 500,
      snowMu: project.roof?.snowMu,
    }),
    out = {
      sourceMode: true,
      sourceImported: true,
      zones: [],
      instances: [],
      surfaces: [],
      ridges: [],
      valleys: [],
      area: 0,
      projectedArea: 0,
      snowEffectiveArea: 0,
      gableArea: 0,
      mass: 0,
      volume: 0,
      checks: [],
      warnings: [],
      assumptions: [],
      sources: [],
      status: "unverified",
      complete: false,
      certified: false,
      structurallyVerified: false,
    };
  if (project.roof?.type === "none" || project.roof?.zones !== undefined) {
    V.valid = false;
    V.errors.push({
      field: "roof.sourceModel",
      message: "Source import replaces native roof: type must not be none and roof.zones must be absent.",
    });
  }
  if (!V.valid) {
    out.status = "fail";
    out.checks = [
      {
        id: "source-roof-input",
        label: "Геометрия импортированной крыши",
        status: "fail",
        note: V.errors.map((e) => e.field + ": " + e.message).join("; "),
      },
    ];
    out.errors = V.errors;
    return out;
  }
  out.source = clone(model.source);
  out.missingItems = clone(model.missingItems ?? []);
  out.instances = V.members;
  out.surfaces = V.surfaces;
  out.area = V.surfaces.reduce((a, s) => a + s.area, 0);
  out.projectedArea = V.surfaces.reduce((a, s) => a + s.projectedArea, 0);
  out.snowEffectiveArea = V.surfaces.reduce((a, s) => a + s.snowEffectiveArea, 0);
  out.mass = V.members.reduce((a, b) => a + b.mass, 0);
  out.volume = V.members.reduce((a, b) => a + b.volume, 0);
  out.complete = true;
  out.geometryComplete = true;
  out.fidelityVerified = false;
  const over = V.members.filter((b) => b.cutLength > 6 + EPS);
  out.checks = [
    {
      id: "source-roof-geometry",
      label: "Импортированные доски и скаты",
      status: "pass",
      partial: true,
      note: "Проверены конечная геометрия, плоскости, площади и отсутствие двойного покрытия плана. Это не подтверждение исходного проекта.",
    },
    {
      id: "source-roof-stock",
      label: "Импорт: цельные заготовки до6м",
      status: over.length ? "fail" : "pass",
      value: over.length,
      limit: 0,
      memberIds: over.map((b) => b.id),
      note: "Длинные детали не разбиваются на вымышленные стыки: requireSingleStock=true.",
    },
    ...["strength", "load-path", "connections", "fidelity"].map((k) => ({
      id: "source-roof-" + k,
      label: {
        strength: "Импорт: прочность и прогибы",
        "load-path": "Импорт: опоры и передача усилий",
        connections: "Импорт: запилы и соединения",
        fidelity: "Импорт: полнота исходной конструкции",
      }[k],
      status: "unverified",
      note: "Импортированная геометрия не является проверенной силовой схемой. Стены, подкосы, прогоны, опорные запилы, крепёж, материалы и полнота спецификации требуют независимого проекта.",
    })),
  ];
  if (out.missingItems.length) {
    out.warnings.push("Не импортированы позиции источника: " + out.missingItems.join("; "));
    out.checks.push({
      id: "source-roof-missing-items",
      label: "Неполная спецификация исходной крыши",
      status: "unverified",
      missingItems: out.missingItems,
      note: "Масса и закупка отсутствующих позиций не включены. Импортированная древесина — только переданные members.",
    });
  }
  out.assumptions = [
    "sourceModel полностью заменяет автоматическую геометрию крыши; фермы/подкосы/опоры и дополнительные доски не создаются автоматически. Прочность и распределение кровельных реакций по опорам не рассчитаны.",
    "Масса — нетто-масса переданных физических досок. Ось start/end отделена от длины заготовки; припуски miter учтены, готовые профили не запиливаются повторно. Шестиметровая заготовка не создаёт опору.",
    "Снег учтён один раз по неперекрывающимся горизонтальным проекциям всех переданных скатов, включая покрытые части террас. Для платформ под общей крышей отдельный deckSnowFactor=0 является явным условием покрытия; дождь, заносы, сход снега и распределение по реальным опорам не определены.",
    "Глобальная предварительная передача веса на ростверк не подтверждает действительные опоры импортированной крыши и не заменяет расчёт подкосных стен, прогонов, потолочных балок или узлов.",
    ...(model.assumptions ?? []),
  ];
  out.status = over.length ? "fail" : "unverified";
  return out;
}

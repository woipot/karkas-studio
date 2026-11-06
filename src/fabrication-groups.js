/** Fabrication identity, not structural equivalence. Coordinates are metres. */
export const fabricationTolerance = 1e-6;
const q = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.round(n / fabricationTolerance) * fabricationTolerance
    : n;
const canonical = (x) =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : q(x);
const json = (x) => JSON.stringify(canonical(x));
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return l > 1e-10 ? a.map((x) => x / l) : null;
};
const vector = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
const sourceId = (k) => /(^id$|Id$|Ids$)/.test(k);
function boardFrame(m) {
  if (!vector(m.start) || !vector(m.end)) return null;
  const u = norm(sub(m.end, m.start));
  if (!u) return null;
  let b = vector(m.crossAxis) ? m.crossAxis : [1, 0, 0];
  b = norm(b.map((x, i) => x - dot(b, u) * u[i]));
  if (!b) b = norm(cross([0, 0, 1], u));
  if (!b) return null;
  const h = norm(cross(b, u));
  return {
    point: (p) => {
      const v = sub(p, m.start);
      return [dot(v, u), dot(v, b), dot(v, h)].map(q);
    },
    direction: (p) => [dot(p, u), dot(p, b), dot(p, h)].map(q),
  };
}
function polygonKey(points) {
  if (points.length < 2) return points;
  const options = [];
  for (const sequence of [points, [...points].reverse()])
    for (let i = 0; i < sequence.length; i++) options.push([...sequence.slice(i), ...sequence.slice(0, i)]);
  return options.sort((a, b) => json(a).localeCompare(json(b)))[0];
}
function machining(value, frame, key = "") {
  if (value === null || typeof value !== "object") return q(value);
  if (Array.isArray(value)) {
    if (key === "polygon" && value.every(vector))
      return polygonKey(value.map((p) => (frame ? frame.point(p) : p)));
    if (vector(value) && /(position|point|origin|vertex|^start$|^end$)/i.test(key))
      return frame ? frame.point(value) : value;
    if (vector(value) && /(normal|direction|axis)/i.test(key)) return frame ? frame.direction(value) : value;
    return value.map((x) => machining(x, frame, key));
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((k) => !sourceId(k))
      .sort()
      .map((k) => [k, machining(value[k], frame, k)]),
  );
}
export function partGeometry(member) {
  const frame = boardFrame(member),
    notches = member.notches ?? [];
  const shape = {
    b: member.b,
    h: member.h,
    axisLength: member.length,
    cutLength: member.cutLength ?? member.actualCutLength ?? member.length,
    cutStart: machining(member.cutStart ?? { scheme: "butt", angle: 0 }, frame),
    cutEnd: machining(member.cutEnd ?? { scheme: "butt", angle: 0 }, frame),
    notches: notches.map((n) => machining(n, frame)).sort((a, b) => json(a).localeCompare(json(b))),
  };
  // Preserve new machining attributes automatically; IDs and world placement
  // are never used to merge a shape with different saw planes or grooves.
  for (const key of Object.keys(member).sort())
    if (
      /(cut|notch|machining|groove|holes|slots|bevel|taper|shape)/i.test(key) &&
      !["cutStart", "cutEnd", "cutLength", "actualCutLength", "notches"].includes(key) &&
      !sourceId(key)
    )
      shape[key] = machining(member[key], frame, key);
  if (notches.length && !frame) shape.unresolvedFrame = member.id;
  if (
    member.requiresCutBoolean ||
    notches.some((n) => n.requiresCutBoolean || (n.localPolygon && !n.polygon))
  )
    shape.unresolvedMachining = member.id;
  return canonical(shape);
}
export const partGeometryKey = (member) => json(partGeometry(member));
const application = (m) => ({
  level: m.floor ?? m.level ?? null,
  wallId: m.wallId ?? null,
  wallIds: m.wallIds ?? [],
  zoneId: m.zoneId ?? null,
  beamId: m.beamId ?? null,
  voidId: m.voidId ?? null,
  objectId: m.objectId ?? null,
  annexId: m.annexId ?? null,
  rimEdge: m.rimEdge ?? null,
  role: m.role ?? null,
  name: m.name ?? null,
});
export function buildFabricationGroups(report = {}) {
  const members = report.result?.timber?.instances ?? [],
    stocks = report.cutting?.stocks ?? [];
  const partGroups = [],
    patternGroups = [],
    partToGroup = {},
    stockToPattern = {},
    physicalRows = [];
  const shapes = new Map(),
    patterns = new Map(),
    rowsById = new Map();
  for (const m of members) {
    const key = partGeometryKey(m);
    let group = shapes.get(key);
    if (!group) {
      const geometry = partGeometry(m);
      group = {
        id: `FG${String(partGroups.length + 1).padStart(3, "0")}`,
        count: 0,
        b: m.b,
        h: m.h,
        section: `${m.b}x${m.h}`,
        axisLength: m.length,
        cutLength: m.cutLength ?? m.actualCutLength ?? m.length,
        geometry,
        physicalIds: [],
        applications: [],
      };
      shapes.set(key, group);
      partGroups.push(group);
    }
    group.count++;
    group.physicalIds.push(m.id);
    partToGroup[m.id] = group.id;
    const app = application(m),
      appKey = json(app);
    let usage = group.applications.find((a) => a._key === appKey);
    if (!usage) {
      usage = { ...app, count: 0, physicalIds: [], _key: appKey };
      group.applications.push(usage);
    }
    usage.count++;
    usage.physicalIds.push(m.id);
    const supportMemberIds = [
      ...new Set((m.supports ?? []).flatMap((s) => s.memberIds ?? (s.memberId ? [s.memberId] : []))),
    ];
    const sourceMemberIds = [
      ...new Set([
        ...(m.sourceMemberIds ?? []),
        ...(m.sourceMemberId ? [m.sourceMemberId] : []),
        ...(m.memberId && m.memberId !== m.id ? [m.memberId] : []),
      ]),
    ];
    const row = {
      physicalId: m.id,
      partGroupId: group.id,
      ...app,
      start: Array.isArray(m.start) ? [...m.start] : (m.start ?? null),
      end: Array.isArray(m.end) ? [...m.end] : (m.end ?? null),
      supportStartContactIds: [
        ...new Set(m.supportStart?.contactBeamIds ?? m.supportStart?.contactSourceIds ?? []),
      ],
      supportEndContactIds: [
        ...new Set(m.supportEnd?.contactBeamIds ?? m.supportEnd?.contactSourceIds ?? []),
      ],
      supportStartMeaning: m.supportStart?.sourceIdMeaning ?? null,
      supportEndMeaning: m.supportEnd?.sourceIdMeaning ?? null,
      staircaseId: m.staircaseId ?? null,
      guardId: m.guardId ?? null,
      packageId: m.packageId ?? null,
      plyIndex: m.plyIndex ?? null,
      plyCount: m.plyCount ?? m.plies ?? null,
      blockingStation: m.blockingStation ?? null,
      supportStartId: m.supportStart?.sourceId ?? null,
      supportEndId: m.supportEnd?.sourceId ?? null,
      supportMemberIds,
      sourceMemberIds,
      stockId: null,
      patternGroupId: null,
      cutStart: null,
      cutEnd: null,
      cutLength: group.cutLength,
    };
    physicalRows.push(row);
    rowsById.set(m.id, row);
  }
  for (const g of partGroups) for (const a of g.applications) delete a._key;
  for (const stock of stocks) {
    const pieces = (stock.pieces ?? []).map((p) => ({
      partGroupId: partToGroup[p.sourceId] ?? partToGroup[p.id] ?? null,
      physicalId: p.sourceId ?? p.id,
      start: p.cutStart ?? p.start,
      end: p.cutEnd ?? p.end,
      length: p.length,
    }));
    const identity = {
      section: stock.section ?? `${stock.b}x${stock.h}`,
      b: stock.b,
      h: stock.h,
      length: stock.length,
      kerf: stock.kerf ?? report.cutting?.kerf ?? null,
      kerfMM: stock.kerfMM ?? report.cutting?.kerfMM ?? null,
      pieces: pieces.map(({ physicalId, ...p }) => p),
      used: stock.used,
      consumed: stock.consumed,
      kerfWaste: stock.kerfWaste,
      remainder: stock.remainder,
      reusable: stock.reusable,
    };
    // An unknown source is deliberately unique, never a false reusable pattern.
    if (pieces.some((p) => !p.partGroupId)) identity.unresolvedStock = stock.id;
    const key = json(identity);
    let group = patterns.get(key);
    if (!group) {
      group = {
        id: `FP${String(patternGroups.length + 1).padStart(3, "0")}`,
        count: 0,
        stockIds: [],
        ...identity,
      };
      patterns.set(key, group);
      patternGroups.push(group);
    }
    group.count++;
    group.stockIds.push(stock.id);
    stockToPattern[stock.id] = group.id;
    for (const p of pieces) {
      const row = rowsById.get(p.physicalId);
      if (row)
        Object.assign(row, { stockId: stock.id, patternGroupId: group.id, cutStart: p.start, cutEnd: p.end });
    }
  }
  return {
    version: "1.0",
    tolerance: {
      lengthM: fabricationTolerance,
      sectionMM: fabricationTolerance,
      meaning: "Canonical numerical identity, not a fabrication allowance.",
    },
    partGroups,
    patternGroups,
    partToGroup,
    stockToPattern,
    physicalRows,
    summary: {
      physicalParts: members.length,
      partGroups: partGroups.length,
      stockBoards: stocks.length,
      patternGroups: patternGroups.length,
      unmappedParts: physicalRows.filter((x) => !x.stockId).length,
    },
    assumptions: [
      "Группы совпадают по номинальному сечению, осевой/заготовочной длине, обоим торцам и локальной геометрии выборок. Мировое положение и ID исключены из геометрического ключа.",
      "Ориентация плоскости, знаки наклона, сторона/длина нахлёста и зеркальные локальные выборки сохраняются. Неразрешённые выборки не объединяются.",
      "Повторная карта означает одинаковые ordered FG и позиции на исходной доске, пропил и остаток. Это группировка уже найденного раскроя, не новая оптимизация.",
      "Точный перечень физических ID, конструкций и исходных досок сохраняется в JSON и внешних CSV.",
    ],
  };
}
function csv(rows) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            const safe = typeof v === "string" && /^\s*[=+@-]/.test(v) ? "'" + v : v;
            return '"' + String(safe ?? "").replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export function fabricationPartsToCSV(fabrication) {
  return csv([
    [
      "physical_id",
      "part_group",
      "level",
      "wall_id",
      "wall_ids",
      "roof_zone_id",
      "grillage_beam_id",
      "void_id",
      "object_id",
      "role",
      "stock_id",
      "pattern_group",
      "start_m",
      "end_m",
      "blank_length_m",
      "start_x_m",
      "start_y_m",
      "start_z_m",
      "end_x_m",
      "end_y_m",
      "end_z_m",
      "rim_edge",
      "blocking_station_m",
      "support_start_id",
      "support_end_id",
      "support_member_ids",
      "source_member_ids",
      "support_start_contact_ids",
      "support_end_contact_ids",
      "support_start_id_meaning",
      "support_end_id_meaning",
      "annex_id",
      "staircase_id",
      "guard_id",
      "package_id",
      "ply_index",
      "ply_count",
    ],
    ...(fabrication.physicalRows ?? []).map((r) => [
      r.physicalId,
      r.partGroupId,
      r.level,
      r.wallId,
      (r.wallIds ?? []).join("|"),
      r.zoneId,
      r.beamId,
      r.voidId,
      r.objectId,
      r.role,
      r.stockId,
      r.patternGroupId,
      r.cutStart,
      r.cutEnd,
      r.cutLength,
      r.start?.[0],
      r.start?.[1],
      r.start?.[2],
      r.end?.[0],
      r.end?.[1],
      r.end?.[2],
      r.rimEdge,
      r.blockingStation,
      r.supportStartId,
      r.supportEndId,
      (r.supportMemberIds ?? []).join("|"),
      (r.sourceMemberIds ?? []).join("|"),
      (r.supportStartContactIds ?? []).join("|"),
      (r.supportEndContactIds ?? []).join("|"),
      r.supportStartMeaning,
      r.supportEndMeaning,
      r.annexId,
      r.staircaseId,
      r.guardId,
      r.packageId,
      r.plyIndex,
      r.plyCount,
    ]),
  ]);
}
export function fabricationStocksToCSV(fabrication) {
  return csv([
    [
      "stock_id",
      "pattern_group",
      "section",
      "stock_length_m",
      "ordered_part_groups",
      "starts_m",
      "ends_m",
      "kerf_waste_m",
      "remainder_m",
    ],
    ...(fabrication.patternGroups ?? []).flatMap((g) =>
      g.stockIds.map((id) => [
        id,
        g.id,
        g.section,
        g.length,
        g.pieces.map((p) => p.partGroupId).join("|"),
        g.pieces.map((p) => p.start).join("|"),
        g.pieces.map((p) => p.end).join("|"),
        g.kerfWaste,
        g.remainder,
      ]),
    ),
  ]);
}
export default buildFabricationGroups;

import { parseSection } from "./catalog.js";
import { isBeamWall } from "./profiled-beam-catalog.js";
import {
  boardSolids,
  slab,
  volume,
  subtractAll,
  timberInside,
  intersect,
  surfaceNormal,
  clip,
} from "./insulation-solid.js";

// Illustrative procurement formats, not a certified product specification.
// 1200×600×100 / 6 slabs / 0.432 m³: ROCKWOOL SCANDIC brochure,
// https://cdn21vek.by/img/galleries/1014/147/800x600x50_rockwool_5da80a7cdf954.pdf
// The corresponding 50 mm / 12 slabs format is illustrative, NOT verified as a SCANDIC SKU.
// Density 35 is the midpoint of manufacturer LIGHT BATTS 30–40 kg/m³ (ГОСТ EN 1602-2011):
// https://rvul.ru/vse-produkty/layt-batts/ . It is an assumption, not batch test data.
export const insulationProducts = Object.freeze([
  {
    id: "wool-50",
    name: "Минвата 1200×600×50 · пример",
    length: 1.2,
    width: 0.6,
    thickness: 0.05,
    slabs: 12,
    packVolume: 0.432,
    density: 35,
    illustrative: true,
  },
  {
    id: "wool-100",
    name: "Минвата 1200×600×100 · пример",
    length: 1.2,
    width: 0.6,
    thickness: 0.1,
    slabs: 6,
    packVolume: 0.432,
    density: 35,
    illustrative: true,
  },
]);
// Project assumptions, not normative coefficients: 5% cutting waste; no installed
// compression (1.0). Transport compression never reduces installed material volume.
const DEFAULT_WASTE = 0.05;
const sum = (a) => a.reduce((s, n) => s + n, 0);
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const TYPES = ["walls", "floor", "roof", "partitions"];
// Validation bounds are software input limits, not prescribed construction thicknesses.
export function validateInsulation(project, error) {
  const p = project.insulation;
  if (
    project.roof?.thermalBoundary !== undefined &&
    !["ceiling", "slopes"].includes(project.roof.thermalBoundary)
  )
    error("roof.thermalBoundary", "Тепловая граница: ceiling или slopes.");
  for (const [i, z] of (Array.isArray(project.roof?.zones) ? project.roof.zones : []).entries()) {
    if (z?.thermalBoundary !== undefined && !["ceiling", "slopes"].includes(z.thermalBoundary))
      error(`roof.zones.${i}.thermalBoundary`, "Тепловая граница: ceiling или slopes.");
  }
  for (const [i, a] of (Array.isArray(project.envelope?.assemblies)
    ? project.envelope.assemblies
    : []
  ).entries()) {
    for (const [j, l] of (Array.isArray(a?.layers) ? a.layers : []).entries()) {
      if (!object(l)) continue;
      const path = `envelope.assemblies.${i}.layers.${j}`;
      if (l.insulation !== undefined && typeof l.insulation !== "boolean")
        error(path + ".insulation", "Признак утеплителя: логическое значение.");
      if (l.density !== undefined && (!Number.isFinite(l.density) || l.density < 0))
        error(path + ".density", "Плотность слоя: конечное неотрицательное число кг/м³.");
    }
  }
  if (p === undefined) return;
  if (!object(p)) return error("insulation", "Утепление: требуется объект.");
  for (const k of Object.keys(p)) {
    if (k === "wasteFactor") {
      if (!Number.isFinite(p[k]) || p[k] < 0 || p[k] > 1)
        error("insulation.wasteFactor", "Запас утеплителя: доля от 0 до 1.");
    } else if (!TYPES.includes(k)) error("insulation." + k, "Неизвестное поле утепления.");
    else {
      const a = p[k],
        path = "insulation." + k;
      if (!object(a)) {
        error(path, "Узел утепления: требуется объект.");
        continue;
      }
      for (const key of Object.keys(a)) {
        if (!["enabled", "thickness", "product", ...(k === "roof" ? ["boundary"] : [])].includes(key))
          error(path + "." + key, "Неизвестный параметр утепления.");
        else if (key === "enabled" && typeof a[key] !== "boolean")
          error(path + ".enabled", "Включение утепления: логическое значение.");
        else if (key === "thickness" && (!Number.isFinite(a[key]) || a[key] <= 0 || a[key] > 1))
          error(path + ".thickness", "Толщина утепления: больше 0, не более 1 м.");
        else if (key === "product" && !insulationProducts.some((p) => p.id === a[key]))
          error(path + ".product", "Неизвестный продукт утепления.");
        else if (key === "boundary" && !["ceiling", "slopes"].includes(a[key]))
          error(path + ".boundary", "Тепловая граница: ceiling или slopes.");
      }
    }
  }
}
export function insulationPacks(rows, wasteFactor = DEFAULT_WASTE) {
  return insulationProducts
    .map((p) => {
      const matching = rows.filter((r) => r.product === p.id),
        netVolume = sum(matching.map((r) => r.netVolume));
      // Full slab layers, with excess thickness treated as trimming waste.
      // The dimensionless epsilon only removes floating-point rounding at integer boundaries.
      const layeredVolume = sum(
        matching.map(
          (r) => (r.netVolume * Math.ceil(r.thickness / p.thickness - 1e-9) * p.thickness) / r.thickness,
        ),
      );
      const requiredVolume = layeredVolume * (1 + wasteFactor),
        packs = Math.ceil(requiredVolume / p.packVolume - 1e-9);
      return {
        product: p.id,
        name: p.name,
        netVolume,
        layeredVolume,
        requiredVolume,
        packVolume: p.packVolume,
        slabsPerPack: p.slabs,
        packs,
        purchasedVolume: packs * p.packVolume,
        surplusVolume: packs * p.packVolume - netVolume,
      };
    })
    .filter((p) => p.netVolume > 0);
}
function envelopeFor(project, type) {
  const names = {
    walls: ["wall", "walls"],
    floor: ["groundFloor", "floor"],
    roof: ["roof", "ceiling"],
    partitions: ["partition", "partitions"],
  };
  return project.envelope?.assemblies?.find((a) => names[type].includes(a.appliesTo));
}
const isInsulation = (l) =>
  l.insulation ?? /минеральн.*ват|минват|утепл|mineral wool|insulation/i.test(l.name ?? "");
function envelopeThickness(a) {
  // Explicit layer flags take priority. Existing projects name their insulation
  // layers in Russian; do not mistake framingLayerIds (which may include air) for insulation.
  const layers = a?.layers?.filter((l) => isInsulation(l)) ?? [];
  return layers.length ? sum(layers.map((l) => l.thickness)) : undefined;
}
function thermalBoundary(project, zone, envelope) {
  return (
    project.insulation?.roof?.boundary ??
    zone.thermalBoundary ??
    project.roof?.thermalBoundary ??
    (envelope?.id === "ceiling" || envelope?.appliesTo === "ceiling"
      ? "ceiling"
      : (zone.sourceBoundary ??
        (["truss", "tiedRafters"].includes(zone.effectiveFraming) ? "ceiling" : "slopes")))
  );
}
export function calculateInsulation(project, result, { includeGeometry = false } = {}) {
  const errors = [];
  validateInsulation(project, (field, message) => errors.push({ field, message }));
  if (errors.length) throw Error(errors.map((e) => e.message).join("\n"));
  const assemblies = [],
    checks = [],
    assumptions = [
      "Утепление: каркасные стены и пол первого этажа над проветриваемым подпольем включены; стены из профилированного бруса (сплошная древесина) в полостной объём не входят; межэтажные перекрытия исключены. Перегородки — только при явном insulation.partitions (кроме enabled:false). Пристройки не утепляются автоматически.",
      "Толщина: insulation → первый подходящий envelope.assemblies (слои insulation:true или с названием минваты/утеплителя) → глубина полости. Повторные сценарии влажности не добавляют материал. Стены: слой по центру сечения; пол: от верха лаг вниз; потолок: от потолочного datum вверх, иначе по нижнему поясу; скаты: от верхней грани реальных стропил внутрь по нормали; если стропил нет — от заданной поверхности кровли. Это геометрические допущения, не теплотехнический подбор.",
      "Наружные стены используют физические wallFootprint и угловые границы platformContours; если их нет в старом отчёте — полосу вдоль оси стены. Профильные вырезы читаются из общей cutGeometry с её численной точностью; неописанная обработка досок не восстанавливается.",
      "Продукт по умолчанию wool-50: иллюстративная минвата 1200×600×50, 12 плит, 0,432 м³/уп.; wool-100: 1200×600×100, 6 плит, 0,432 м³/уп. Формат 100 мм — по брошюре ROCKWOOL СКАНДИК; формат 50 мм не подтверждён как артикул производителя. Уточните поставку.",
      "Плотность: заданные layers[].density утеплителя (средняя по толщине), иначе по умолчанию 35 кг/м³ — середина диапазона ЛАЙТ БАТТС 30–40 кг/м³ по данным производителя (ГОСТ EN 1602-2011): https://rvul.ru/vse-produkty/layt-batts/ . Масса считается по установленному чистому объёму, без упаковок и отходов.",
      `Запас утеплителя ${100 * (project.insulation?.wasteFactor ?? DEFAULT_WASTE)}%: явная доля или иллюстративные 5%, норматив не установлен. Сжатие при монтаже не принято (коэффициент 1); транспортная компрессия не уменьшает объём. Закупка полными слоями выбранной толщины плит и округление общих упаковок вверх один раз на продукт; раскрой плит не оптимизирован.`,
      "Смета: цена упаковки prices.insulationPack; без неё — прежняя insulationM2 × объём упаковки / 0,15 м. Толщина 150 мм — условная база стандартного проекта, не норматив и не рыночная котировка. К упаковкам не применяется дополнительный prices.wastePercent.",
      "Масса утеплителя уже входит в заданные wallDead/floorDead/roofDead; повторно в нагрузки не добавляется. Явная потолочная доля ceilingDead проверяется отдельно от общей roofDead. Сравнение с массой утеплителя — нижняя граница; полные слои проверяются только при заданной layers[].density. Достаточность общей нагрузки не подтверждает локальную передачу или состав всех слоёв.",
    ];
  let complete = result.geometry?.closed !== false;
  const boards = (result.timber?.instances ?? []).filter((b) => b.start && b.end && !b.annexId);
  const boardCells = boards.map((b) => boardSolids(b));
  const occupied = [];
  const roofEnvelope = envelopeFor(project, "roof");
  const nativeZones = result.roofModel?.zones ?? [];
  function add({
    id,
    name,
    type,
    depth,
    points,
    normal,
    from,
    holes = [],
    zoneId,
    loadAreaRatio = 1,
    assignedLayerPressure,
    cells,
  }) {
    if (project.insulation?.[type]?.enabled === false) return;
    const envelope = envelopeFor(project, type),
      explicit = project.insulation?.[type];
    const thickness = explicit?.thickness ?? envelopeThickness(envelope) ?? depth;
    if (!(thickness > 0)) {
      complete = false;
      return;
    }
    const product = explicit?.product ?? "wool-50";
    const start = typeof from === "function" ? from(thickness) : (from ?? -thickness / 2);
    // Assembly junctions and roof ridges cannot own the same material twice.
    const region = typeof cells === "function" ? cells(thickness) : cells;
    const grossCells = subtractAll(region ?? slab(points, normal, start, start + thickness), occupied);
    occupied.push(...grossCells);
    const grossVolume = sum(grossCells.map(volume));
    const cavities = subtractAll(
      grossCells,
      holes.flatMap((h) => slab(h, normal, start, start + thickness)),
    );
    const openingVolume = grossVolume - sum(cavities.map(volume));
    const timberVolume = timberInside(cavities, boardCells),
      netVolume = Math.max(0, grossVolume - openingVolume - timberVolume);
    const insulationLayers = envelope?.layers?.filter(isInsulation) ?? [];
    const productDensity = insulationProducts.find((p) => p.id === product).density;
    const density = insulationLayers.length
      ? sum(insulationLayers.map((l) => l.thickness * (l.density ?? productDensity))) /
        sum(insulationLayers.map((l) => l.thickness))
      : productDensity;
    const mass = density * netVolume;
    const area = (grossVolume - openingVolume) / thickness;
    const pressureKey = type === "floor" ? "floorDead" : type === "roof" ? "roofDead" : "wallDead";
    const assumedLoad = Math.min(
      (project.loads?.[pressureKey] ?? 0) * area * loadAreaRatio,
      assignedLayerPressure === undefined ? Infinity : assignedLayerPressure * area,
    );
    // Conventional gravity: ГОСТ 8.417-2024, table Г.1, 1 kgf = 9.80665 N exactly.
    // СП 20.13330.2016 §7: weight from density and geometry; SI N → kN.
    const insulationLoad = (mass * 9.80665) / 1000;
    const layers = envelope?.layers ?? [],
      fullLayersKnown =
        layers.length > 0 && layers.every((l) => Number.isFinite(l.density) && l.density >= 0);
    const fullLayersLoad = fullLayersKnown
      ? (layers.reduce(
          (s, l) =>
            s +
            (isInsulation(l)
              ? ((netVolume * l.thickness) / (envelopeThickness(envelope) || thickness)) * l.density
              : area * l.thickness * l.density),
          0,
        ) *
          9.80665) /
        1000
      : null;
    const requiredLoad = Math.max(insulationLoad, fullLayersLoad ?? 0);
    checks.push({
      id: "insulation-load-" + id,
      label: name + ": масса утеплителя и нагрузка слоёв",
      status: assumedLoad + 1e-8 < requiredLoad ? "warning" : "unverified",
      value: requiredLoad,
      limit: assumedLoad,
      unit: "кН",
      note: fullLayersKnown
        ? "Сравнение с плотностями заданных слоёв; масса повторно не добавлена."
        : "Плотности всех слоёв не заданы: проверена только нижняя граница по утеплителю. Масса повторно не добавлена.",
    });
    assemblies.push({
      id,
      name,
      type,
      zoneId,
      thickness,
      cavityDepth: depth,
      product,
      density,
      grossVolume,
      openingVolume,
      timberVolume,
      netVolume,
      mass,
      insulationLoad,
      assumedLayerLoad: assumedLoad,
      fullLayersLoad,
      packs: insulationPacks([{ product, thickness, netVolume }], project.insulation?.wasteFactor),
      // On-demand viewer geometry uses the same cavities and actual cut timber. No new load or purchase.
      ...(includeGeometry ? { netCells: subtractAll(cavities, boardCells.flat()).map((c) => c.faces) } : {}),
    });
  }
  for (const w of result.walls ?? project.walls ?? []) {
    const type = w.kind === "exterior" ? "walls" : "partitions";
    if (type === "partitions" && !project.insulation?.partitions) continue;
    // Profiled-beam walls are solid timber: no framed cavity to fill. External/internal insulation
    // of a beam wall is a separate layer and is not generated automatically.
    const source = (project.walls ?? []).find((q) => q.id === w.id) ?? w;
    if (isBeamWall(source)) continue;
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
      ux = (w.b.x - w.a.x) / L,
      uz = (w.b.y - w.a.y) / L;
    for (const level of result.geometry?.levels ?? []) {
      if (w.level !== undefined && w.level !== level.index) continue;
      const base = level.wallBaseY,
        height = w.height ?? level.height;
      const point = (s, y) => [w.a.x + ux * s, y, w.a.y + uz * s];
      let profile = result.geometry.wallProfiles?.find(
        (p) => p.wallId === w.id && p.level === level.index && p.mode === "continuous",
      );
      if (profile) {
        const wallZones = nativeZones.filter((z) => profile.zoneIds?.includes(z.id));
        const cold = wallZones.filter((z) => thermalBoundary(project, z, roofEnvelope) === "ceiling");
        if (cold.length && cold.length === wallZones.length)
          profile = {
            ...profile,
            topSamples: profile.topSamples.map((q) => ({ ...q, topY: Math.min(q.topY, base + height) })),
          };
        else if (cold.length) {
          complete = false;
          assumptions.push(
            `Стена ${w.id}: разные тепловые границы в примыкающих зонах; утепление верхней части требует разделения стены по зонам.`,
          );
        }
      }
      const points = profile
        ? [
            point(0, profile.baseY),
            point(L, profile.baseY),
            ...[...profile.topSamples].reverse().map((s) => point(s.s, s.topY)),
          ]
        : [point(0, base), point(L, base), point(L, base + height), point(0, base + height)];
      const holes = (project.openings ?? [])
        .filter((o) => o.wallId === w.id && (o.floor ?? w.level ?? 1) === level.index)
        .map((o) => {
          const bottom = base + (o.sill ?? 0);
          return [
            point(o.offset, bottom),
            point(o.offset + o.width, bottom),
            point(o.offset + o.width, bottom + o.height),
            point(o.offset, bottom + o.height),
          ];
        });
      const segments =
        w.kind === "exterior"
          ? result.geometry.platformContours
              ?.find((c) => c.index === level.index && c.valid)
              ?.rimSegments.filter((s) => s.wallId === w.id)
          : [];
      const physicalLayer = segments?.length
        ? (thickness) =>
            segments.flatMap((segment) => {
              // The physical wall-face mitres assign each corner to one wall, including
              // the part outside the wall axes. Scale the strip about its centreline
              // when insulation thickness differs from the structural wall depth.
              const [a, b, c, d] = segment.wallFootprint;
              const middle = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
              const m0 = middle(a, d),
                m1 = middle(b, c),
                scale = thickness / segment.wallDepth;
              const footprint = [a, b, c, d].map((p, i) => {
                const m = i === 0 || i === 3 ? m0 : m1;
                return [m.x + (p.x - m.x) * scale, base, m.y + (p.y - m.y) * scale];
              });
              if (!profile) return slab(footprint, [0, 1, 0], 0, height);
              const station = (p) => (p[0] - w.a.x) * ux + (p[2] - w.a.y) * uz;
              const lo = Math.min(...footprint.map(station)),
                hi = Math.max(...footprint.map(station)),
                samples = profile.topSamples;
              const extrapolate = (s, a, b) => ({
                s,
                topY: a.topY + ((s - a.s) * (b.topY - a.topY)) / (b.s - a.s),
              });
              const tops = [
                extrapolate(lo, samples[0], samples[1]),
                ...samples.filter((q) => q.s > lo && q.s < hi),
                extrapolate(hi, samples.at(-2), samples.at(-1)),
              ];
              const section = [
                point(lo, base),
                point(hi, base),
                ...tops.reverse().map((q) => point(q.s, q.topY)),
              ];
              const strip = slab(section, [-uz, 0, ux], -thickness / 2, thickness / 2);
              return slab(footprint, [0, 1, 0], 0, Math.max(...tops.map((q) => q.topY)) - base).flatMap((c) =>
                strip.map((s) => intersect(c, s)).filter(Boolean),
              );
            })
        : undefined;
      add({
        id: `${w.id}-L${level.index}`,
        name: `${type === "walls" ? "Стена" : "Перегородка"} ${w.id} · этаж ${level.index}`,
        type,
        depth: parseSection(profile?.section ?? w.section).h / 1000,
        points,
        normal: [-uz, 0, ux],
        holes,
        cells: physicalLayer,
      });
    }
  }
  const ground = result.geometry?.levels?.find((l) => l.index === 1);
  if (ground?.closed) {
    const depth = parseSection(project.floor.section).h / 1000,
      top = ground.platformBase + depth;
    add({
      id: "floor-L1",
      name: "Пол над подпольем",
      type: "floor",
      depth,
      points: (ground.platformPolygon ?? ground.polygon).map((p) => [p.x, top, p.y]),
      normal: [0, 1, 0],
      from: (t) => -t,
      holes: (ground.voids ?? []).map((v) => v.polygon.map((p) => [p.x, top, p.y])),
    });
  }
  let zones = nativeZones;
  if (project.roof?.sourceModel && !zones.length) {
    const ceiling = boards.filter((b) => b.role === "ceilingJoist"),
      rafter = boards.find((b) => b.role === "rafter");
    const top = result.geometry?.levels?.filter((l) => l.closed).at(-1),
      member = ceiling[0] ?? rafter;
    if (top && member) {
      zones = [
        {
          id: project.roof.sourceModel.id ?? "SOURCE-ROOF",
          name: "Импортированная кровля",
          polygon: top.polygon,
          bearingPolygon: top.polygon,
          bearingArea: top.area,
          surfaceArea: result.roofModel.area,
          levelIndex: top.index,
          eave: top.topY,
          effectiveSection: `${member.b}x${member.h}`,
          sourceBoundary: ceiling.length ? "ceiling" : "slopes",
          source: true,
        },
      ];
      assumptions.push(
        "Импортированная кровля: граница принята по фактическим ceilingJoist (потолок), иначе по скатам; площадь ограничена замкнутым контуром верхнего этажа. Толщина полости — сечение соответствующей доски. Утепление наружных свесов и холодных крылец исключено.",
      );
      if (
        ceiling.some(
          (b) =>
            Math.abs(b.start[1] - ceiling[0].start[1]) > 1e-7 ||
            Math.abs(b.end[1] - b.start[1]) > 1e-7 ||
            b.h !== ceiling[0].h,
        )
      ) {
        complete = false;
        assumptions.push(
          "Импорт: потолочные балки имеют разные высоты/сечения; единая плоскость и толщина потолочного утепления требуют задания зон.",
        );
      }
    } else complete = false;
  }
  for (const z of zones) {
    if (project.insulation?.roof?.enabled === false) continue;
    const boundary = thermalBoundary(project, z, roofEnvelope);
    assumptions.push(
      `${z.name ?? z.id}: тепловая граница ${boundary === "ceiling" ? "потолок" : "скаты"}, задана явно либо принята по envelope/схеме кровли.`,
    );
    const depth =
      z.source && boundary === "slopes"
        ? boards.find((b) => b.role === "rafter")?.h / 1000
        : parseSection(z.effectiveSection ?? z.chordSection)?.h / 1000;
    if (boundary === "ceiling") {
      const bottom = boards.filter(
        (b) => (z.source || b.zoneId === z.id) && ["bottom", "bottomChord", "ceilingJoist"].includes(b.role),
      );
      const ceilingDepth = bottom[0]?.h / 1000 || depth;
      const y =
        z.ceilingDatumY ?? (bottom.length ? Math.min(...bottom.map((b) => b.start[1] - b.h / 2000)) : z.eave);
      add({
        id: z.id + "-ceiling",
        zoneId: z.id,
        loadAreaRatio: z.surfaceArea / z.bearingArea,
        assignedLayerPressure: z.ceilingDead ?? project.roof?.ceilingDead,
        name: (z.name ?? z.id) + " · потолок",
        type: "roof",
        depth: ceilingDepth,
        points: (z.bearingPolygon ?? z.polygon).map((p) => [p.x, y, p.y]),
        normal: [0, 1, 0],
        from: 0,
      });
    } else {
      // Warm roof gables are part of the thermal envelope. Intersect their wall
      // prisms with the vertical space below actual roof surfaces, once per face.
      for (const w of result.walls ?? project.walls ?? []) {
        if (
          w.kind !== "exterior" ||
          (w.level ?? 1) !== (z.levelIndex ?? result.geometry.levels.at(-1)?.index)
        )
          continue;
        const level = result.geometry.levels.find((l) => l.index === (w.level ?? 1));
        if (!level || result.geometry.wallProfiles?.some((p) => p.wallId === w.id && p.mode === "continuous"))
          continue;
        const base = level.wallBaseY + (w.height ?? level.height),
          L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        const ux = (w.b.x - w.a.x) / L,
          uz = (w.b.y - w.a.y) / L,
          normal = [-uz, 0, ux];
        const depth = parseSection(w.section).h / 1000,
          thickness =
            project.insulation?.walls?.thickness ?? envelopeThickness(envelopeFor(project, "walls")) ?? depth;
        const gableCells = [];
        let gablePoints;
        for (const face of result.roofModel.surfaces.filter((s) => s.zoneId === z.id)) {
          const high = Math.max(...face.points.map((p) => p[1]));
          if (high <= base) continue;
          const points = [
            [w.a.x, base, w.a.y],
            [w.b.x, base, w.b.y],
            [w.b.x, high, w.b.y],
            [w.a.x, high, w.a.y],
          ];
          const wall = slab(points, normal, -thickness / 2, thickness / 2);
          const under = slab(face.points, [0, 1, 0], base - high, 0);
          const cells = wall.flatMap((s) => under.map((c) => intersect(s, c)).filter(Boolean));
          for (const cell of cells) gableCells.push(...subtractAll([cell], gableCells));
          gablePoints = points;
        }
        if (gableCells.length)
          add({
            id: `${w.id}-gable-${z.id}`,
            name: `Фронтон ${w.id} · ${z.name ?? z.id}`,
            type: "walls",
            depth,
            points: gablePoints,
            normal,
            cells: gableCells,
          });
      }
      const plan = (z.bearingPolygon ?? z.polygon).map((p) => [p.x, 0, p.y]);
      const columns = slab(plan, [0, 1, 0], -1000, 1000); // Coordinate domain of the project, not a physical height.
      const slopeCells = [];
      const thickness = project.insulation?.roof?.thickness ?? envelopeThickness(roofEnvelope) ?? depth;
      for (const face of result.roofModel.surfaces.filter((s) => s.zoneId === z.id)) {
        const normal = surfaceNormal(face.points);
        if (!normal || !(thickness > 0)) {
          complete = false;
          continue;
        }
        const dot = (p) => normal.reduce((s, n, i) => s + n * p[i], 0);
        const candidates = boards
          .flatMap((b, i) => {
            if (b.zoneId !== z.id || !["rafter", "top", "topChord"].includes(b.role)) return [];
            const length = Math.hypot(...b.end.map((v, j) => v - b.start[j]));
            if (Math.abs(dot(b.end) - dot(b.start)) > length * 1e-7) return [];
            const vertices = boardCells[i].flatMap((c) => c.faces.flat());
            return vertices.length
              ? [
                  {
                    distance: Math.abs((dot(b.start) + dot(b.end)) / 2 - dot(face.points[0])),
                    top: Math.max(...vertices.map(dot)),
                  },
                ]
              : [];
          })
          .sort((a, b) => a.distance - b.distance);
        // Legacy roof surfaces may follow rafter axes. Locate the real upper
        // timber face; use the supplied roof plane only when no rafter exists.
        const top = candidates[0]?.top ?? dot(face.points[0]);
        const faceColumns = slab(
          face.points.map((p) => [p[0], 0, p[2]]),
          [0, 1, 0],
          -1000,
          1000,
        );
        const layer = faceColumns
          .flatMap((s) => columns.map((c) => intersect(s, c)).filter(Boolean))
          .map((c) => clip(clip(c, { n: normal, d: top }), { n: normal.map((v) => -v), d: thickness - top }))
          .filter(Boolean);
        // Vertical eave/ridge boundaries cut parallel layer planes, avoiding
        // fictitious wedges at the ends of a normal-extruded finite polygon.
        for (const cell of layer) slopeCells.push(...subtractAll([cell], slopeCells));
      }
      if (slopeCells.length)
        add({
          id: z.id + "-slopes",
          zoneId: z.id,
          name: (z.name ?? z.id) + " · скаты",
          type: "roof",
          depth,
          points: plan,
          normal: [0, 1, 0],
          cells: slopeCells,
        });
    }
  }

  if (!complete)
    checks.push({
      id: "insulation-geometry",
      label: "Полнота геометрии утепления",
      status: "unverified",
      note: "Незамкнутый контур или импортированная кровля: показана учтённая часть.",
    });
  const totals = Object.fromEntries(
    ["grossVolume", "openingVolume", "timberVolume", "netVolume", "mass"].map((k) => [
      k,
      sum(assemblies.map((a) => a[k])),
    ]),
  );
  totals.packs = insulationPacks(assemblies, project.insulation?.wasteFactor);
  return { assemblies, totals, complete, checks, assumptions };
}

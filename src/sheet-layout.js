import { cutSheetParts, sheetPartsFromPanels, sheetCuttingOptions } from "./sheet-cutting.js";
import { defaultSheetPrices } from "./prices.js";
import { resolveSheet, sheetCandidates, sheetSources, floorDeckThickness } from "./sheet-catalog.js";
import { sheetPolygons, buildWallBracing } from "./wall-bracing.js";
import { loadFactors } from "./load-profile.js";
const { clean, area, triangulate, intersect, subtract, rectangle } = sheetPolygons;
// Numerical geometry tolerance, not a construction or bearing allowance.
const EPS = 1e-7;
// Conventional standard gravity (GOST 8.417 SI units), kg to kN.
const G = 9.80665;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
const minus = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((v) => v / Math.hypot(...a));
const unique = (a) => a.sort((a, b) => a - b).filter((v, i, s) => !i || v - s[i - 1] > EPS);
const inside = (q, p) =>
  area(p) > EPS &&
  Math.abs(
    sum(
      p.map((a, i) => {
        const b = p[(i + 1) % p.length];
        return Math.abs((a.x - q.x) * (b.y - q.y) - (b.x - q.x) * (a.y - q.y)) / 2;
      }),
    ) - area(p),
  ) < EPS;
function supported(q, supports) {
  return supports
    .filter((s) => {
      const dx = s.b.x - s.a.x,
        dy = s.b.y - s.a.y,
        L = Math.hypot(dx, dy);
      if (L < EPS) return false;
      const t = ((q.x - s.a.x) * dx + (q.y - s.a.y) * dy) / (L * L);
      return (
        t >= -EPS &&
        t <= 1 + EPS &&
        Math.abs((q.x - s.a.x) * dy - (q.y - s.a.y) * dx) / L <= s.width / 2 + EPS
      );
    })
    .map((s) => s.id);
}
const sheetPrice = (project, stock) =>
  project.prices?.sheetPrices?.[`${stock.id}-${stock.thickness}`] ??
  defaultSheetPrices[`${stock.id}-${stock.thickness}`];
function alternative(layout, stock, project) {
  return {
    product: stock.id,
    thickness: stock.thickness,
    count: layout.count,
    lowerBound: layout.lowerBound,
    wastePercent: layout.wastePercent,
    unusedPercent: layout.unusedPercent,
    purchasedArea: layout.purchasedArea,
    reusableArea: layout.reusableArea,
    unitPrice: sheetPrice(project, stock),
    cost: layout.count * sheetPrice(project, stock),
    complete: layout.complete,
  };
}
const rankFormats = (a, b) =>
  Number(b.complete) - Number(a.complete) ||
  a.cost - b.cost ||
  a.count - b.count ||
  a.unusedPercent - b.unusedPercent ||
  a.product.localeCompare(b.product, "en");
export function layoutSheetSurface(options) {
  const project = options.project ?? {},
    candidates = sheetCandidates(options);
  if (!candidates.length) throw Error("Неизвестный листовой материал или толщина.");
  const choices = candidates
    .map((stock) => {
      const surface = layoutFixedSurface({ ...options, product: stock.id });
      const parts = sheetPartsFromPanels(surface.panels, {
        kind: surface.kind,
        product: stock.id,
        thickness: stock.thickness,
      });
      const cutting = cutSheetParts(parts, stock, sheetCuttingOptions(project));
      return { surface, stock, cutting, alternative: alternative(cutting, stock, project) };
    })
    .sort((a, b) => rankFormats(a.alternative, b.alternative));
  const { surface, cutting } = choices[0];
  return {
    ...surface,
    sheets: surface.sheets,
    parts: sheetPartsFromPanels(surface.panels, surface),
    cutting,
    purchaseCount: cutting.count,
    lowerBound: cutting.lowerBound,
    purchasedArea: cutting.purchasedArea,
    wastePercent: cutting.wastePercent,
    unusedPercent: cutting.unusedPercent,
    reusableArea: cutting.reusableArea,
    fullCount: cutting.stocks.filter(
      (s) => s.pieces.length === 1 && Math.abs(s.area - s.width * s.height) < EPS,
    ).length,
    cutCount: cutting.stocks.filter(
      (s) => !(s.pieces.length === 1 && Math.abs(s.area - s.width * s.height) < EPS),
    ).length,
    alternatives: choices.map((c) => c.alternative),
    selectionBasis:
      "Минимум стоимости отдельной поверхности; общий раскрой дома выполняется после выбора форматов.",
  };
}
/** Installation geometry only. Procurement is computed separately by cutSheetParts. */
function layoutFixedSurface({
  id,
  kind,
  polygons,
  holes = [],
  supports = [],
  toWorld,
  product,
  thickness,
  stagger = true,
  level,
  zoneId,
}) {
  const stock = resolveSheet({ product, thickness });
  if (!stock) throw Error("Неизвестный листовой материал или толщина.");
  const frames = polygons.map(clean),
    triangles = frames.flatMap(triangulate);
  const vertices = frames.flat(),
    x0 = Math.min(...vertices.map((q) => q.x)),
    x1 = Math.max(...vertices.map((q) => q.x)),
    y0 = Math.min(...vertices.map((q) => q.y)),
    y1 = Math.max(...vertices.map((q) => q.y));
  const stations = unique(
    supports
      .filter(
        (s) =>
          Math.abs(s.a.x - s.b.x) < EPS && (kind !== "floors" || s.role === undefined || s.role === "joist"),
      )
      .map((s) => (s.a.x + s.b.x) / 2),
  );
  const sheets = [],
    panels = [],
    seams = [];
  let row = 0;
  for (let y = y0; y < y1 - EPS; y += stock.width) {
    const top = Math.min(y1, y + stock.width);
    let x = x0,
      col = 0;
    while (x < x1 - EPS) {
      // Stagger on a real framing axis nearest (and below) half a stock length.
      const reach = stagger && row % 2 && col === 0 ? stock.length / 2 : stock.length;
      const target = Math.min(x1, x + reach);
      const snap = stations.filter((s) => s > x + EPS && s <= target + EPS).at(-1);
      const end = target >= x1 - EPS ? x1 : (snap ?? target);
      const tile = rectangle(x, y, end, top);
      let pieces = triangles.map((t) => intersect(t, tile)).filter((p) => p.length >= 3 && area(p) > EPS);
      for (const hole of holes) pieces = pieces.flatMap((p) => subtract(p, clean(hole)));
      if (pieces.length) {
        const stockSheetId = `${id}-R${row + 1}-C${col + 1}`,
          A = sum(pieces.map(area));
        const item = {
          id: stockSheetId,
          product: stock.id,
          thickness,
          area: A,
          full: Math.abs(A - stock.width * stock.length) < EPS,
          row: row + 1,
          column: col + 1,
          bounds: { x, y, end, top },
          panelIds: [],
        };
        for (const poly of pieces) {
          const panel = {
            id: `${stockSheetId}-P${item.panelIds.length + 1}`,
            stockSheetId,
            surfaceId: id,
            surfaceKind: kind,
            level,
            zoneId,
            product: stock.id,
            material: stock.material,
            thickness,
            area: area(poly),
            mass: ((area(poly) * thickness) / 1000) * stock.density,
            localPolygon: poly,
            polygon: poly.map(toWorld),
          };
          item.panelIds.push(panel.id);
          panels.push(panel);
        }
        sheets.push(item);
        // Test exposed boundaries of the stock tile and hole cuts; triangulation edges are ignored.
        for (const poly of pieces)
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i],
              b = poly[(i + 1) % poly.length],
              d = { x: b.x - a.x, y: b.y - a.y },
              L = Math.hypot(d.x, d.y);
            if (L < EPS) continue;
            const missing = [],
              supportIds = new Set();
            // Numerical sampling resolution: not a normative bearing/fastener pitch.
            const steps = Math.max(1, Math.ceil(L / 0.1));
            for (let j = 0; j < steps; j++) {
              const q = { x: a.x + (d.x * (j + 0.5)) / steps, y: a.y + (d.y * (j + 0.5)) / steps };
              const outside = { x: q.x + (d.y / L) * EPS * 10, y: q.y - (d.x / L) * EPS * 10 };
              if (pieces.some((other) => other !== poly && inside(outside, other))) continue;
              const ids = supported(q, supports);
              ids.forEach((id) => supportIds.add(id));
              if (!ids.length) missing.push(q);
            }
            if (missing.length || supportIds.size)
              seams.push({
                id: `${stockSheetId}-E${seams.length + 1}`,
                stockSheetId,
                a,
                b,
                supportIds: [...supportIds],
                status: missing.length ? "unverified" : "pass",
              });
          }
      }
      x = end;
      col++;
    }
    row++;
  }
  const netArea = sum(panels.map((p) => p.area)),
    purchasedArea = sheets.length * stock.width * stock.length;
  const framing = kind === "floors" ? checkFloorSheetJoints(sheets, stations, x0, x1) : undefined;
  return {
    id,
    kind,
    level,
    zoneId,
    framing,
    product: stock.id,
    thickness,
    sheets,
    panels,
    seams,
    fullCount: sheets.filter((s) => s.full).length,
    cutCount: sheets.filter((s) => !s.full).length,
    purchaseCount: sheets.length,
    area: netArea,
    mass: sum(panels.map((p) => p.mass)),
    purchasedArea,
    wastePercent: purchasedArea ? (1 - netArea / purchasedArea) * 100 : 0,
  };
}
/** Check in actual axis intervals: a trimmed perimeter bay need not equal the
 * nominal interior spacing. Distinct indices guarantee >= one actual bay of stagger.
 */
function checkFloorSheetJoints(parts, stations, x0, x1) {
  const rows = [...new Set(parts.map((p) => p.row))]
    .sort((a, b) => a - b)
    .map((row) => ({
      row,
      joints: unique(
        parts
          .filter((p) => p.row === row)
          .flatMap((p) => [p.bounds.x, p.bounds.end])
          .filter((x) => x > x0 + EPS && x < x1 - EPS),
      ),
    }));
  const index = (x) => stations.findIndex((s) => Math.abs(s - x) < EPS),
    missing = [],
    coincidences = [],
    offsets = [];
  for (const row of rows)
    for (const joint of row.joints) {
      if (index(joint) < 0) missing.push(`R${row.row}-X${joint}`);
      const prev = rows.find((r) => r.row === row.row - 1);
      if (prev?.joints.length) {
        const closest = [...prev.joints].sort(
          (a, b) => Math.abs(a - joint) - Math.abs(b - joint) || a - b,
        )[0];
        const steps =
          index(joint) >= 0 && index(closest) >= 0 ? Math.abs(index(joint) - index(closest)) : null;
        offsets.push({
          row: row.row,
          joint,
          previousJoint: closest,
          offset: Math.abs(joint - closest),
          steps,
        });
        if (Math.abs(joint - closest) < EPS) coincidences.push(`R${row.row}-X${joint}`);
      }
    }
  return {
    majorAxis: "acrossJoists",
    rotationAllowed: false,
    stations,
    actualSpacings: stations.slice(1).map((s, i) => s - stations[i]),
    rows,
    offsets,
    jointStatus: missing.length || !stations.length ? "unverified" : "pass",
    unverifiedJointIds: missing,
    staggerStatus: coincidences.length ? "fail" : missing.length || !stations.length ? "unverified" : "pass",
    failStaggerIds: coincidences,
    parts: parts.map((p) => ({
      partId: p.id,
      from: p.bounds.x,
      to: p.bounds.end,
      spanCount: stations.length
        ? Math.max(0, stations.filter((s) => s >= p.bounds.x - EPS && s <= p.bounds.end + EPS).length - 1)
        : null,
      perimeterTrim: Math.abs(p.bounds.x - x0) < EPS || Math.abs(p.bounds.end - x1) < EPS,
    })),
  };
}
/** Exact two-equal-span Euler–Bernoulli strip under UDL: M_support=qL²/8;
 * w_max=(39+55√33)qL⁴/(65536EI). Derived from EI w''''=q, w(0)=w(L)=0,
 * M(0)=0, w'(L)=0. No characteristic test strength is promoted to design resistance.
 */
export function checkSheetDeck({
  thickness,
  span,
  live,
  dead = 0,
  E,
  designBending,
  factors = loadFactors({ live }),
}) {
  if (!(span > 0) || !(thickness > 0) || !Number.isFinite(span) || !Number.isFinite(thickness))
    return {
      span: null,
      thickness,
      moment: null,
      stress: null,
      deflection: null,
      status: "unverified",
      note: "Нет подтверждённого пролёта или толщины настила.",
    };
  const t = thickness / 1000,
    q = live + dead,
    qd = live * factors.live + dead * factors.layers;
  const moment = (qd * span ** 2) / 8,
    stress = (moment * 6) / t ** 2 / 1000;
  const deflection = E
    ? ((((39 + 55 * Math.sqrt(33)) / 65536) * q * span ** 4) / ((E * 1000 * t ** 3) / 12)) * 1000
    : null;
  return {
    span,
    thickness,
    moment,
    stress,
    deflection,
    E,
    designBending,
    status: designBending && stress > designBending ? "fail" : "unverified",
    note: "Двухпролётная полоса 1 м, равномерная нагрузка; расчётное сопротивление, ползучесть, сосредоточенная нагрузка, фактическая непрерывность и предельный прогиб требуют подтверждения.",
  };
}
/** Select each wall surface independently, retaining its corresponding real backing geometry. */
export function buildSheetBracing(project, context) {
  if (!project.sheathing?.walls) return buildWallBracing(project, { ...context, skipSheetCutting: true });
  const spec = project.sheathing.walls,
    options = sheetCuttingOptions(project);
  const candidates = sheetCandidates(spec).map((stock) => {
    const p = {
      ...project,
      bracing: {
        ...project.bracing,
        method: "sheathing",
        sheetWidth: stock.width,
        sheetHeight: stock.length,
        thickness: stock.thickness,
        sheetDensity: stock.density,
        sheetSide: spec.side === "interior" ? "interior" : "exterior",
      },
    };
    const model = buildWallBracing(p, { ...context, skipSheetCutting: true });
    for (const panel of model.panels) Object.assign(panel, { product: stock.id, material: stock.material });
    return { stock, model };
  });
  if (!candidates.length) throw Error("Неизвестный листовой материал или толщина стен.");
  const out = {
    ...candidates[0].model,
    panels: [],
    instances: [],
    checks: [],
    warnings: [],
    wallLines: [],
    formatSelections: [],
  };
  for (const wall of candidates[0].model.wallLines) {
    const variants = candidates
      .map((c) => {
        const panels = c.model.panels.filter((p) => p.wallId === wall.wallId && p.level === wall.level);
        let parts = sheetPartsFromPanels(panels, {
          kind: "walls",
          product: c.stock.id,
          thickness: spec.thickness,
        });
        if (spec.side === "both")
          parts = parts.concat(parts.map((p) => ({ ...p, id: `${p.id}-IN`, batchId: "walls-interior" })));
        const cutting = cutSheetParts(parts, c.stock, options);
        return { ...c, panels, alternative: alternative(cutting, c.stock, project) };
      })
      .sort((a, b) => rankFormats(a.alternative, b.alternative));
    const best = variants[0],
      prefix = `${wall.wallId}-${wall.level}`;
    const owned = (b) => b.wallId === wall.wallId && b.level === wall.level;
    const panelIds = new Map(best.panels.map((p, i) => [p.id, `PANEL-${prefix}-${i + 1}`]));
    const panels = best.panels.map((p) => ({ ...p, id: panelIds.get(p.id) }));
    out.panels.push(...panels);
    out.instances.push(...best.model.instances.filter(owned));
    out.checks.push(
      ...best.model.checks
        .filter((c) => c.id.startsWith(`${prefix}-`))
        .map((c) => ({
          ...c,
          unverifiedIds: c.unverifiedIds?.map((id) =>
            id.replace(/^PANEL-\d+/, (old) => panelIds.get(old) ?? old),
          ),
        })),
    );
    out.wallLines.push(best.model.wallLines.find(owned));
    out.warnings.push(
      ...best.model.warnings.filter((w) => w.startsWith(`${wall.wallId} · ${wall.level} этаж`)),
    );
    out.formatSelections.push({
      wallId: wall.wallId,
      level: wall.level,
      product: best.stock.id,
      alternatives: variants.map((v) => v.alternative),
    });
  }
  // Let-in braces + sheet cladding is a common combination: the brace sits flush in notches cut
  // into the studs and the sheet goes over it. Keep the braces (geometry, notches, checks) instead of
  // silently replacing the chosen bracing scheme by the sheets.
  if (project.bracing?.method === "letIn") {
    const braced = buildWallBracing(project, { ...context, skipSheetCutting: true });
    out.letInBraces = true;
    out.braces = braced.braces ?? [];
    out.notches = braced.notches ?? [];
    out.instances.push(...braced.instances.filter((b) => b.role === "letInBrace"));
    out.checks.push(...braced.checks.filter((c) => /let-in/.test(c.id)));
    out.warnings.push(...(braced.warnings ?? []).filter((w) => /укосин|раскос/i.test(w)));
    out.assumptions = [
      ...(out.assumptions ?? []),
      "Схема жёсткости — врезные укосины; листы обшивки выполняют роль ветрозащиты и дополнительной жёсткости и ложатся поверх укосин, утопленных в пропилы стоек.",
    ];
  }
  out.quantities = {
    ...out.quantities,
    sheetArea: sum(out.panels.map((p) => p.area)),
    panelMass: sum(out.panels.map((p) => p.mass)),
    blockingLength: sum(out.instances.filter((b) => b.role === "sheathingBlocking").map((b) => b.length)),
  };
  return out;
}
/** Choose one automatic format per material/thickness using the entire house cutting pool. */
export function buildHouseSheets(project, context) {
  const kinds = ["walls", "floors", "roof"];
  const groups = new Map();
  for (const kind of kinds) {
    const spec = project.sheathing?.[kind];
    if (!spec) continue;
    const stock = resolveSheet(spec);
    if (spec.product !== stock.material) continue; // Explicit catalogue formats remain fixed.
    const key = `${stock.material}-${stock.thickness}`;
    if (!groups.has(key))
      groups.set(key, { material: stock.material, thickness: stock.thickness, kinds: [] });
    groups.get(key).kinds.push(kind);
  }
  const build = (p) => {
    const bracingModel = buildSheetBracing(p, context);
    return { bracingModel, sheetModel: buildSheetModel(p, { ...context, bracingModel }) };
  };
  if (!groups.size) return build(project);
  const selected = { ...project, sheathing: { ...project.sheathing } };
  const formatSelections = [];
  const surfaceAlternatives = new Map();
  for (const group of groups.values()) {
    const variants = sheetCandidates({ product: group.material, thickness: group.thickness })
      .map((stock) => {
        const candidate = { ...selected, sheathing: { ...selected.sheathing } };
        for (const kind of group.kinds)
          candidate.sheathing[kind] = { ...candidate.sheathing[kind], product: stock.id };
        const { sheetModel } = build(candidate);
        // Include explicitly fixed surfaces of the same pair: their offcuts may join this pool.
        const rows = sheetModel.purchases.filter(
          (r) => r.thickness === group.thickness && resolveSheet(r)?.material === group.material,
        );
        const purchasedArea = sum(rows.map((r) => r.purchasedArea));
        const area = sum(rows.map((r) => r.area));
        for (const surface of sheetModel.surfaces.filter((s) => group.kinds.includes(s.kind))) {
          if (!surfaceAlternatives.has(surface.id)) surfaceAlternatives.set(surface.id, []);
          surfaceAlternatives.get(surface.id).push(
            alternative(
              {
                ...surface,
                count: surface.standalonePurchaseCount,
                complete: rows.every((r) => r.complete),
              },
              stock,
              project,
            ),
          );
        }
        return {
          product: stock.id,
          thickness: group.thickness,
          count: sum(rows.map((r) => r.count)),
          lowerBound: sum(rows.map((r) => r.lowerBound)),
          purchasedArea,
          reusableArea: sum(rows.map((r) => r.reusableArea)),
          wastePercent: purchasedArea ? (sum(rows.map((r) => r.wasteArea)) / purchasedArea) * 100 : 0,
          unusedPercent: purchasedArea ? (1 - area / purchasedArea) * 100 : 0,
          cost: sum(rows.map((r) => r.count * sheetPrice(project, resolveSheet(r)))),
          complete: rows.every((r) => r.complete),
          purchases: rows.map((r) => ({ product: r.product, count: r.count })),
        };
      })
      .sort(rankFormats);
    const best = variants[0];
    for (const kind of group.kinds)
      selected.sheathing[kind] = { ...selected.sheathing[kind], product: best.product };
    formatSelections.push({ ...group, product: best.product, alternatives: variants });
  }
  const result = build(selected);
  result.sheetModel.formatSelections = formatSelections;
  for (const surface of result.sheetModel.surfaces) {
    if (!surfaceAlternatives.has(surface.id)) continue;
    surface.alternatives = surfaceAlternatives.get(surface.id).sort(rankFormats);
    surface.selectionBasis =
      "Формат выбран по минимальной стоимости общего раскроя дома для материала и толщины; альтернативы поверхности справочные и не суммируются.";
  }
  result.sheetModel.assumptions.push(
    "Автоматический формат един для пары материал/толщина во всём доме; выбран минимум стоимости общего гильотинного раскроя среди доступных форматов. Явные форматы поверхностей фиксированы. Альтернативы поверхностей справочные, их закупки не суммируются.",
  );
  return result;
}
export function buildSheetModel(project, { geometry, floorPlatform, roofModel, bracingModel }) {
  const surfaces = [],
    checks = [],
    assumptions = [];
  const wallStock = resolveSheet(project.sheathing?.walls);
  const panels = bracingModel.panels;
  for (const panel of panels) {
    panel.surfaceKind = "walls";
    panel.surfaceId = `walls-${panel.wallId}-${panel.level}-${panel.sheetSide}`;
    if (wallStock && !panel.product)
      Object.assign(panel, { product: wallStock.id, material: wallStock.material });
  }
  if (wallStock && project.sheathing.walls.side === "both") {
    // Same cuts on opposite faces share backing, but require independent purchased sheets.
    for (const panel of [...panels]) {
      const w = project.walls.find((w) => w.id === panel.wallId),
        u = unit([w.b.x - w.a.x, 0, w.b.y - w.a.y]),
        n = [-u[2], 0, u[0]];
      panels.push({
        ...panel,
        id: `${panel.id}-IN`,
        stockSheetId: `${panel.stockSheetId}-IN`,
        sheetSide: "interior",
        surfaceId: `walls-${panel.wallId}-${panel.level}-interior`,
        polygon: panel.polygon.map((q) => {
          const dist = dot(minus(q, [w.a.x, 0, w.a.y]), n);
          return q.map((v, i) => v - 2 * dist * n[i]);
        }),
      });
    }
    bracingModel.quantities.panelMass *= 2;
    for (const k of ["sheetArea", "sheets", "purchasedSheetArea", "wasteArea"])
      bracingModel.quantities[k] *= 2;
  }
  const groups = new Map();
  for (const panel of panels) {
    if (!groups.has(panel.surfaceId)) groups.set(panel.surfaceId, []);
    groups.get(panel.surfaceId).push(panel);
  }
  for (const [id, ps] of groups) {
    const stocks = new Map();
    for (const p of ps) {
      const s = stocks.get(p.stockSheetId) ?? { id: p.stockSheetId, area: 0, panelIds: [] };
      s.area += p.area;
      s.panelIds.push(p.id);
      stocks.set(p.stockSheetId, s);
    }
    const groupStock = ps[0].product
      ? resolveSheet({ product: ps[0].product, thickness: ps[0].thickness })
      : null;
    const W = groupStock?.width ?? project.bracing.sheetWidth,
      L = groupStock?.length ?? project.bracing.sheetHeight;
    const sheets = [...stocks.values()].map((s) => ({ ...s, full: Math.abs(s.area - W * L) < EPS }));
    const A = sum(ps.map((p) => p.area)),
      purchasedArea = sheets.length * W * L;
    surfaces.push({
      id,
      kind: "walls",
      wallId: ps[0].wallId,
      level: ps[0].level,
      product: groupStock?.id ?? "legacy-wall-sheet",
      thickness: ps[0].thickness,
      sheets,
      seams: (
        bracingModel.checks.find((c) => c.id === `${ps[0].wallId}-${ps[0].level}-sheet-edges`)
          ?.unverifiedIds ?? []
      ).map((id) => ({ id, status: "unverified" })),
      panels: ps,
      area: A,
      mass: sum(ps.map((p) => p.mass)),
      purchaseCount: sheets.length,
      fullCount: sheets.filter((s) => s.full).length,
      cutCount: sheets.filter((s) => !s.full).length,
      purchasedArea,
      wastePercent: (1 - A / purchasedArea) * 100,
      alternatives:
        bracingModel.formatSelections?.find((s) => s.wallId === ps[0].wallId && s.level === ps[0].level)
          ?.alternatives ?? [],
    });
  }
  if (project.sheathing?.floors)
    for (const level of geometry.levels.filter((l) => l.closed && l.platformPolygon)) {
      const across = project.floor.axis !== "x",
        at = (q) => (across ? { x: q.x, y: q.y } : { x: q.y, y: q.x });
      const toWorld = (q) =>
        across
          ? [q.x, level.wallBaseY - floorDeckThickness(project) / 2, q.y]
          : [q.y, level.wallBaseY - floorDeckThickness(project) / 2, q.x];
      const supports = floorPlatform.instances
        .filter((b) => b.level === level.index)
        .map((b) => ({
          id: b.id,
          role: b.role,
          a: at({ x: b.start[0], y: b.start[2] }),
          b: at({ x: b.end[0], y: b.end[2] }),
          width: b.b / 1000,
        }));
      const s = layoutSheetSurface({
        id: `floor-L${level.index}`,
        kind: "floors",
        level: level.index,
        polygons: [level.platformPolygon.map(at)],
        holes: level.voids.map((v) => v.polygon.map(at)),
        supports,
        toWorld,
        project,
        ...project.sheathing.floors,
      });
      surfaces.push(s);
      const stock = resolveSheet({ product: s.product, thickness: s.thickness }),
        js = unique(
          supports.filter((s) => s.role === "joist" && Math.abs(s.a.x - s.b.x) < EPS).map((s) => s.a.x),
        );
      const span = Math.max(0, ...js.slice(1).map((x, i) => x - js[i]));
      checks.push({
        id: `${s.id}-thickness`,
        label: `Настил ${level.index} этажа: толщина`,
        ...checkSheetDeck({
          thickness: stock.thickness,
          span,
          live: project.loads.live,
          dead: project.loads.floorDead + ((stock.thickness / 1000) * stock.density * G) / 1000,
          E: stock.E,
          designBending: stock.designBending,
          factors: loadFactors(project.loads),
        }),
        propertiesBasis: stock.propertiesBasis,
        propertiesStatus: stock.propertiesStatus,
        sources:
          stock.material === "osb3"
            ? [sheetSources.osbStandard, sheetSources.stiffness]
            : [sheetSources.plywoodStandard, sheetSources.plywoodStiffness],
        source:
          stock.material === "osb3"
            ? "EN 300 / EN 12369-1; испытательное E не заменяет расчётное"
            : "ГОСТ 3916.1-2018 / СП 64; расчётные свойства пакета неизвестны",
      });
    }
  if (project.sheathing?.roof && roofModel) {
    const faces = new Map();
    for (const f of roofModel.surfaces ?? []) {
      const a = f.points[0],
        n = unit(cross(minus(f.points[1], a), minus(f.points[2], a)));
      if (n[1] < 0) for (let i = 0; i < 3; i++) n[i] *= -1;
      const key = JSON.stringify([f.zoneId, ...n.map((v) => +v.toFixed(6)), +dot(n, a).toFixed(6)]);
      if (!faces.has(key)) faces.set(key, { zoneId: f.zoneId, n, a, polygons: [] });
      faces.get(key).polygons.push(f.points);
    }
    for (const f of faces.values()) {
      const U = Math.hypot(f.n[0], f.n[2]) > EPS ? unit([f.n[2], 0, -f.n[0]]) : [1, 0, 0],
        V = unit(cross(f.n, U));
      const local = (q) => ({ x: dot(minus(q, f.a), U), y: dot(minus(q, f.a), V) });
      const toWorld = (q) =>
        f.a.map((v, i) => v + q.x * U[i] + q.y * V[i] + (f.n[i] * project.sheathing.roof.thickness) / 2000);
      const supports = (roofModel.instances ?? [])
        .filter(
          (b) =>
            b.zoneId === f.zoneId &&
            Math.abs(dot(minus(b.start, f.a), f.n)) < b.h / 1000 + EPS &&
            Math.abs(dot(minus(b.end, f.a), f.n)) < b.h / 1000 + EPS,
        )
        .map((b) => ({ id: b.id, a: local(b.start), b: local(b.end), width: b.b / 1000 }));
      surfaces.push(
        layoutSheetSurface({
          id: `roof-${f.zoneId}-${surfaces.length + 1}`,
          kind: "roof",
          zoneId: f.zoneId,
          polygons: f.polygons.map((p) => p.map(local)),
          supports,
          toWorld,
          project,
          ...project.sheathing.roof,
        }),
      );
    }
  }
  for (const s of surfaces.filter((s) => s.kind !== "walls")) {
    const missing = s.seams.filter((e) => e.status !== "pass");
    if (s.framing)
      checks.push(
        {
          id: `${s.id}-joist-joints`,
          label: "Настил: торцевые стыки по фактическим осям лаг",
          status: s.framing.jointStatus,
          unverifiedIds: s.framing.unverifiedJointIds,
          note: "Внутренние границы деталей проверены по реальным осям лаг; крайние доборы следуют фактической краевой опоре, включая укороченный крайний шаг.",
        },
        {
          id: `${s.id}-stagger`,
          label: "Настил: разбежка торцевых швов не менее одного шага лаг",
          status: s.framing.staggerStatus,
          failIds: s.framing.failStaggerIds,
          offsets: s.framing.offsets,
          note: "Разность индексов фактических осей соседних рядов должна быть не менее одного. Совпадающие стыки недопустимы.",
        },
      );
    checks.push({
      id: `${s.id}-seams`,
      label: `${s.kind === "roof" ? "Кровля" : "Перекрытие"}: опирание кромок ${s.id}`,
      status: "unverified",
      unverifiedIds: missing.map((e) => e.id),
      value: missing.length,
      limit: 0,
      note: missing.length
        ? "Кромки без подтверждённой опоры: нужен блокинг/краевая доска. Их древесина автоматически не добавлена."
        : "Геометрия опор подтверждена; крепёж и передача усилий требуют проверки.",
    });
  }
  const purchases = new Map(),
    cuttingGroups = [];
  for (const s of surfaces) {
    s.parts ??= sheetPartsFromPanels(s.panels, { kind: s.kind, product: s.product, thickness: s.thickness });
    const key = `${s.product}-${s.thickness}`;
    if (!purchases.has(key))
      purchases.set(key, { id: key, product: s.product, thickness: s.thickness, parts: [], surfaces: [] });
    purchases.get(key).parts.push(...s.parts);
    purchases.get(key).surfaces.push(s);
  }
  for (const row of purchases.values()) {
    {
      const stock =
        row.product === "legacy-wall-sheet"
          ? {
              id: row.product,
              width: project.bracing.sheetWidth,
              length: project.bracing.sheetHeight,
              thickness: row.thickness,
            }
          : resolveSheet(row);
      const cutting = cutSheetParts(row.parts, stock, sheetCuttingOptions(project));
      const assignment = new Map(
        cutting.stocks.flatMap((s) => s.pieces.map((p) => [p.id, { sheetId: s.id, piece: p }])),
      );
      for (const s of row.surfaces) {
        const local = s.cutting ?? cutSheetParts(s.parts, stock, sheetCuttingOptions(project));
        Object.assign(s, {
          standalonePurchaseCount: local.count,
          standaloneCost: stock.id === "legacy-wall-sheet" ? null : local.count * sheetPrice(project, stock),
          purchaseCount: local.count,
          lowerBound: local.lowerBound,
          purchasedArea: local.purchasedArea,
          wastePercent: local.wastePercent,
          unusedPercent: local.unusedPercent,
          reusableArea: local.reusableArea,
          fullCount: local.stocks.filter(
            (s) => s.pieces.length === 1 && Math.abs(s.area - s.width * s.height) < EPS,
          ).length,
        });
        s.cutCount = s.purchaseCount - s.fullCount;
        delete s.cutting; // Global cutting.stocks is the authoritative house map.
        s.parts = s.parts.map((p) => ({ ...p, purchaseSheetId: assignment.get(p.id)?.sheetId }));
        s.purchaseSheetIds = [...new Set(s.parts.map((p) => p.purchaseSheetId).filter(Boolean))];
        for (const p of s.panels) {
          p.layoutPartId ??= p.stockSheetId;
          p.purchaseSheetId = assignment.get(p.layoutPartId)?.sheetId;
        }
      }
      Object.assign(row, {
        ...cutting,
        id: row.id,
        product: stock.id,
        thickness: stock.thickness,
        mass: sum(row.surfaces.map((s) => s.mass)),
        fullCount: cutting.stocks.filter(
          (s) => s.pieces.length === 1 && Math.abs(s.area - s.width * s.height) < EPS,
        ).length,
      });
      row.cutCount = row.count - row.fullCount;
      cuttingGroups.push(cutting);
    }
    row.unusedPercent = row.purchasedArea ? (1 - row.area / row.purchasedArea) * 100 : 0;
    row.wastePercent ??= row.unusedPercent;
    delete row.parts;
    delete row.surfaces;
  }
  if (bracingModel.method === "sheathing") {
    const stocks = cuttingGroups
      .flatMap((g) => g.stocks)
      .filter((s) => s.pieces.some((p) => p.kind === "walls"));
    bracingModel.quantities.installationParts = surfaces
      .filter((s) => s.kind === "walls")
      .reduce((n, s) => n + s.parts.length, 0);
    bracingModel.quantities.sheets = stocks.length;
    bracingModel.quantities.purchasedSheetArea = sum(stocks.map((s) => s.width * s.height));
    bracingModel.quantities.wasteArea = sum(stocks.map((s) => s.wasteArea));
    bracingModel.quantities.reusableArea = sum(stocks.map((s) => s.reusableArea));
    bracingModel.sheetCutting = { stocks, count: stocks.length };
    bracingModel.assumptions = bracingModel.assumptions.filter(
      (a) => !a.includes("без повторного использования остатков"),
    );
  }
  const all = surfaces.flatMap((s) => s.panels),
    pressureByLevel = {};
  for (const s of surfaces.filter((s) => s.kind === "floors")) {
    const l = geometry.levels.find((l) => l.index === s.level);
    pressureByLevel[s.level] = (s.mass * G) / 1000 / l.platformNetArea;
  }
  const roofExtraDeadByZone = {};
  for (const s of surfaces.filter((s) => s.kind === "roof"))
    roofExtraDeadByZone[s.zoneId] = (roofExtraDeadByZone[s.zoneId] ?? 0) + (s.mass * G) / 1000;
  for (const key of Object.keys(roofExtraDeadByZone)) {
    const zone = roofModel.zones.find((z) => z.id === key);
    if (zone) roofExtraDeadByZone[key] /= zone.surfaceArea;
    else delete roofExtraDeadByZone[key]; // Imported roof checks read sheet pressure directly.
  }
  if (project.sheathing)
    assumptions.push(
      `Листы: монтажная сетка отделена от закупки; общий гильотинный раскрой по продукту и толщине для всего дома. Пропил ${sheetCuttingOptions(project).kerf} мм; минимальный сохраняемый прямоугольный остаток ${sheetCuttingOptions(project).minReusable}×${sheetCuttingOptions(project).minReusable} м — допущения задания, не паспорт пилы. Эвристика не доказывает оптимум; приведена нижняя граница по площади.`,
      "При sheathing.floors floorDead задаёт только остальные слои БЕЗ выбранного листового настила. Номинальный настил 35 мм заменён выбранной толщиной; отдельной массы у прежнего 35-мм изображения не было. wallDead/roofDead также должны исключать выбранные листы.",
      "Плотность для массы: ОСП 620 кг/м³ (22 мм: 600), по таблице загрузки Калевала; фанера 700 кг/м³ — верхняя граница диапазона 640–700 СВЕЗА. Требуется паспорт партии. ОСП: условное E=3500 МПа вдоль главной оси — минимум испытания EN 300/EN 310 (Калевала/Kronospan), не расчётное или среднее E по EN 12369-1; расчётное сопротивление не назначено. Фанера: испытательное требование ГОСТ 3916.1-2018 табл. 5 не заменяет расчётные E/R по СП 64 для конкретного пакета — они неизвестны.",
      "Пропил учитывается в карте закупки; монтажные зазоры в установленной геометрии не вычтены. Прямоугольные остатки переиспользуются по всему дому; вырезы проёмов и косые обрезки внутри заготовок считаются отходом обработки, их пригодность для гильотинного переиспользования не предполагается. Пол/крыша сохраняют главную ось поперёк лаг/стропил, поворот при раскрое запрещён. Крепёж, диафрагмы и блокинг неподдержанных кромок не подтверждены.",
    );
  if (
    (project.sheathing?.walls?.product.startsWith("plywood-fk") &&
      project.sheathing.walls.side !== "interior") ||
    project.sheathing?.roof?.product.startsWith("plywood-fk")
  )
    checks.push({
      id: "sheet-fk-moisture",
      label: "Фанера ФК: влажность эксплуатации",
      status: "unverified",
      note: "ФК для внутренних сухих условий (СВЕЗА Interior); наружное применение требует подтверждения защиты и режима влажности.",
    });
  if (project.sheathing?.roof) {
    if (!surfaces.some((s) => s.kind === "roof"))
      checks.push({
        id: "sheet-roof-missing",
        label: "Листовой настил кровли",
        status: "unverified",
        note: "Геометрия скатов не сформирована; масса и закупка кровельного настила не определены.",
      });
    assumptions.push(
      "Масса листов кровли входит отдельными образцами в свайное поле; распределение листов через конкретные стропила/стены не подтверждено. Расчёт стропил учитывает добавочное давление по зоне.",
    );
  }
  const complete =
    Object.keys(project.sheathing ?? {})
      .filter((kind) => kind !== "cutting")
      .every((kind) => surfaces.some((s) => s.kind === kind)) && cuttingGroups.every((g) => g.complete);
  return {
    complete,
    sources: sheetSources,
    surfaces,
    panels: all,
    purchases: [...purchases.values()],
    cutting: {
      groups: cuttingGroups,
      stocks: cuttingGroups.flatMap((g) => g.stocks),
      lowerBound: sum(cuttingGroups.map((g) => g.lowerBound)),
      count: sum(cuttingGroups.map((g) => g.count)),
      complete: cuttingGroups.every((g) => g.complete),
      optimal: false,
      summary: {
        sheets: sum(cuttingGroups.map((g) => g.count)),
        parts: sum(cuttingGroups.map((g) => g.stocks.reduce((n, s) => n + s.pieces.length, 0))),
        lowerBound: sum(cuttingGroups.map((g) => g.lowerBound)),
        netArea: sum(cuttingGroups.map((g) => g.area)),
        purchasedArea: sum(cuttingGroups.map((g) => g.purchasedArea)),
        wasteArea: sum(cuttingGroups.map((g) => g.wasteArea)),
        reusableArea: sum(cuttingGroups.map((g) => g.reusableArea)),
        kerfArea: sum(cuttingGroups.map((g) => g.kerfArea)),
        balanceError: sum(cuttingGroups.map((g) => g.balanceError)),
        complete: cuttingGroups.every((g) => g.complete),
        optimal: false,
      },
    },
    checks: [
      ...checks,
      ...cuttingGroups
        .filter((g) => !g.complete)
        .map((g) => ({
          id: `${g.product}-${g.thickness}-cutting`,
          label: "Листовой раскрой: детали не помещаются в выбранный формат",
          status: "fail",
          failIds: g.unplaced,
        })),
    ],
    assumptions,
    pressureByLevel,
    roofExtraDeadByZone,
    area: sum(all.map((p) => p.area)),
    mass: sum(all.map((p) => p.mass)),
    purchaseCount: sum([...purchases.values()].map((p) => p.count)),
  };
}

/** Exposed stock-sheet boundaries only; polygon boolean/triangulation cuts are not sheet joints. */
export function sheetBoundarySegments(panels) {
  const groups = new Map(),
    edges = [];
  for (const p of panels) {
    const id = p.stockSheetId ?? p.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(p);
  }
  for (const group of groups.values())
    for (const p of group) {
      const poly = p.localPolygon;
      if (!poly) continue;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          dx = b.x - a.x,
          dy = b.y - a.y,
          L = Math.hypot(dx, dy);
        if (L < EPS) continue;
        const ts = unique([
          0,
          1,
          ...group
            .flatMap((q) => q.localPolygon)
            .filter((q) => Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / L < EPS)
            .map((q) => ((q.x - a.x) * dx + (q.y - a.y) * dy) / (L * L))
            .filter((t) => t > 0 && t < 1),
        ]);
        for (let j = 1; j < ts.length; j++) {
          const mid = (ts[j - 1] + ts[j]) / 2,
            outside = { x: a.x + dx * mid + (dy / L) * EPS * 10, y: a.y + dy * mid - (dx / L) * EPS * 10 };
          if (group.some((q) => q !== p && inside(outside, q.localPolygon))) continue;
          const from = p.polygon[i],
            to = p.polygon[(i + 1) % poly.length];
          edges.push({
            stockSheetId: p.stockSheetId,
            a: from.map((v, k) => v + (to[k] - v) * ts[j - 1]),
            b: from.map((v, k) => v + (to[k] - v) * ts[j]),
          });
        }
      }
    }
  return edges;
}

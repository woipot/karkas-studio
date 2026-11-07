import { sheetProducts } from "./sheet-catalog.js";

export const sheetProductName = (id) => sheetProducts.find((p) => p.id === id)?.name ?? "Прежняя обшивка";
export function sheetFormat(product, width, height) {
  const p = sheetProducts.find((p) => p.id === product);
  return p
    ? `${p.length * 1000} × ${p.width * 1000}`
    : width && height
      ? `${width * 1000} × ${height * 1000}`
      : "—";
}
// Purchase IDs, never installation stockSheetId, own the procurement map.
export function sheetMapData(model = {}) {
  const stocks = model.cutting?.stocks ?? model.purchases?.flatMap((p) => p.stocks ?? []) ?? [];
  const summary = model.cutting?.summary;
  return {
    stocks,
    count:
      summary?.sheets ??
      model.cutting?.count ??
      model.purchaseCount ??
      (stocks.length || model.purchases?.reduce((n, p) => n + (p.count ?? 0), 0) || 0),
    lowerBound: summary?.lowerBound ?? model.cutting?.lowerBound ?? null,
    wastePercent: summary?.purchasedArea ? (summary.wasteArea / summary.purchasedArea) * 100 : null,
    complete: summary?.complete ?? model.cutting?.complete ?? false,
  };
}
export function sheetPanelInfo(model, id) {
  const panel = model?.panels?.find((p) => p.id === id);
  if (!panel) return null;
  const stocks = sheetMapData(model).stocks;
  const stock = stocks.find((s) => s.id === panel.purchaseSheetId);
  const piece = stock?.pieces.find((p) => p.panelIds?.includes(id) || p.id === panel.layoutPartId);
  return { panel, stock, piece, stockIndex: stock ? stocks.indexOf(stock) : null };
}
// UI pagination only; no construction dimension or engineering limit.
export const SHEETS_PER_PAGE = 6;
export function sheetMapURL(stockId) {
  const url = new URL(typeof window === "undefined" ? "http://localhost/" : window.location.href);
  url.searchParams.set("tab", "materials");
  url.searchParams.set("sheet", stockId);
  url.hash = "sheet-cutting";
  return url.pathname + url.search + url.hash;
}

/** Pure public labels; identifiers remain available separately for diagnostics. */
export function humanLabel(value, { type, project = {}, model = {}, index, total } = {}) {
  const item =
    typeof value === "string"
      ? (sheetMapData(model).stocks.find((s) => s.id === value) ?? { id: value })
      : (value ?? {});
  const id = item.id ?? "";
  if (type === "assembly") {
    if (["walls", "partitions"].includes(item.type)) {
      const wall = project.walls?.find((w) => item.id === `${w.id}-L${item.id.match(/-L(\d+)$/)?.[1]}`);
      return `${humanLabel(wall ?? {}, { type: "wall", project })} · этаж ${item.id.match(/-L(\d+)$/)?.[1] ?? 1}`;
    }
    return item.type === "floor"
      ? "Пол над подпольем"
      : item.name?.includes("потолок")
        ? "Потолок"
        : "Скаты кровли";
  }
  if (type === "product" || (!type && sheetProducts.some((p) => id === p.id || id.startsWith(`${p.id}-`)))) {
    const product = item.product ?? id;
    const entry = sheetProducts.find((p) => p.id === product || product.startsWith(`${p.id}-`));
    return entry ? `${entry.name} ${sheetFormat(entry.id).replaceAll(" ", "")}` : sheetProductName(product);
  }
  if (type === "wall") {
    const wallId = item.wallId ?? id;
    const wall = project.walls?.find((w) => w.id === wallId);
    if (!wall && !/^Ст[-.]?\s*\d+/i.test(wallId)) return "Стена";
    const humanId = /^Ст[-.]?\s*\d+/i.test(wallId)
      ? wallId
      : `Ст-${String(Math.max(0, project.walls?.indexOf(wall) ?? -1) + 1).padStart(2, "0")}`;
    return `Стена ${wall?.name || humanId}`;
  }
  const stocks = sheetMapData(model).stocks;
  if (type === "stock" || item.pieces || id.startsWith("CUT-")) {
    const position = index ?? stocks.findIndex((s) => s.id === id);
    const count = total ?? stocks.length;
    return `${position >= 0 ? `Лист ${position + 1}${count ? ` из ${count}` : ""}` : "Закупочный лист"} · ${humanLabel(item, { type: "product" })} · ${item.thickness ?? "—"} мм`;
  }
  const panel = model.panels?.find(
    (p) => p.id === id || item.panelIds?.includes(p.id) || p.layoutPartId === id,
  );
  const partId = panel?.layoutPartId ?? panel?.stockSheetId ?? id;
  const surfaceId =
    item.surfaceId ?? panel?.surfaceId ?? model.surfaces?.find((s) => id.startsWith(`${s.id}-R`))?.id;
  const surface = model.surfaces?.find((s) => s.id === surfaceId);
  const kind =
    item.surfaceKind ??
    item.kind ??
    panel?.surfaceKind ??
    surface?.kind ??
    (partId.startsWith("floor-") ? "floors" : partId.startsWith("roof-") ? "roof" : "walls");
  const level =
    item.level ?? panel?.level ?? surface?.level ?? Number(partId.match(/(?:floor-L|level-)(\d+)/)?.[1] ?? 1);
  const cell = partId.match(/-R(\d+)-C(\d+)/);
  if (kind === "floors") return `Пол ${level} этажа${cell ? ` · ряд ${cell[1]} · лист ${cell[2]}` : ""}`;
  if (kind === "roof") {
    const surfaces = (model.surfaces ?? []).filter((s) => s.kind === "roof");
    const slope =
      Math.max(
        0,
        surfaces.findIndex((s) => s.id === surfaceId),
      ) + 1;
    return `Кровля, скат ${slope}${cell ? ` · ряд ${cell[1]} · лист ${cell[2]}` : ""}`;
  }
  const wallId = item.wallId ?? panel?.wallId ?? surface?.wallId;
  if (!wallId && !partId.startsWith("SHEET-")) return "Листовая деталь";
  const side =
    item.sheetSide ??
    panel?.sheetSide ??
    (/-interior$|-IN$/.test(surfaceId ?? partId) ? "interior" : "exterior");
  const column = item.sheetColumn ?? panel?.sheetColumn ?? partId.match(/-(\d+)-(\d+)(?:-IN)?$/)?.[1];
  return `${humanLabel({ wallId }, { type: "wall", project })} · ${side === "interior" ? "изнутри" : "снаружи"}${column ? ` · колонка ${column}` : ""}`;
}

// Numerical display tolerance in metres; never used for engineering geometry or procurement.
const LABEL_EPS = 1e-7;
const pointKey = (p) => `${Math.round(p.x / LABEL_EPS)},${Math.round(p.y / LABEL_EPS)}`;
const polygonArea = (poly) =>
  Math.abs(
    poly.reduce((s, a, i) => {
      const b = poly[(i + 1) % poly.length];
      return s + a.x * b.y - b.x * a.y;
    }, 0),
  ) / 2;
/** Split shared triangulation edges and remove them, retaining only the physical perimeter. */
export function sheetPieceGeometry(piece) {
  const { x = 0, y = 0, width, height } = piece;
  const polygons = piece.polygons?.length
    ? piece.polygons
    : [
        [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ],
      ];
  const vertices = polygons.flat(),
    segments = new Map();
  for (const poly of polygons)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length2 = dx * dx + dy * dy;
      if (length2 < LABEL_EPS ** 2) continue;
      const stations = [
        0,
        1,
        ...vertices
          .filter((p) => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) < LABEL_EPS * Math.sqrt(length2))
          .map((p) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)
          .filter((t) => t > LABEL_EPS && t < 1 - LABEL_EPS),
      ].sort((a, b) => a - b);
      for (let j = 1; j < stations.length; j++) {
        if (stations[j] - stations[j - 1] < LABEL_EPS) continue;
        const at = (t) => ({ x: a.x + t * dx, y: a.y + t * dy });
        const from = at(stations[j - 1]),
          to = at(stations[j]);
        const key = [pointKey(from), pointKey(to)].sort().join(";");
        const segment = segments.get(key) ?? { a: from, b: to, count: 0 };
        segment.count++;
        segments.set(key, segment);
      }
    }
  const area = polygons.reduce((s, p) => s + polygonArea(p), 0);
  return {
    polygons,
    edges: mergeOutline([...segments.values()].filter((s) => s.count === 1)),
    cutoutArea: Math.max(0, width * height - area),
  };
}

// Coalesce collinear perimeter segments so triangulation choices do not split identical schemes.
function mergeOutline(input) {
  const edges = input.map(({ a, b }) => ({ a, b }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        for (const [common, other] of [
          [edges[i].a, edges[i].b],
          [edges[i].b, edges[i].a],
        ]) {
          const end =
            pointKey(common) === pointKey(edges[j].a)
              ? edges[j].b
              : pointKey(common) === pointKey(edges[j].b)
                ? edges[j].a
                : null;
          if (!end) continue;
          const u = { x: other.x - common.x, y: other.y - common.y },
            v = { x: end.x - common.x, y: end.y - common.y };
          if (
            Math.abs(u.x * v.y - u.y * v.x) > LABEL_EPS * (Math.hypot(u.x, u.y) + Math.hypot(v.x, v.y)) ||
            u.x * v.x + u.y * v.y >= 0
          )
            continue;
          edges[i] = { a: other, b: end };
          edges.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  return edges;
}

export function groupSheetStocks(model = {}) {
  const stocks = sheetMapData(model).stocks,
    groups = new Map(),
    full = [];
  const number = (v) => Math.round(v / LABEL_EPS);
  const rect = (r) => [r.x, r.y, r.width, r.height].map(number);
  const sorted = (items) => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const stock of stocks) {
    const whole =
      stock.pieces.length === 1 &&
      !stock.cuts?.length &&
      Math.abs(stock.pieces[0].x ?? 0) < LABEL_EPS &&
      Math.abs(stock.pieces[0].y ?? 0) < LABEL_EPS &&
      Math.abs((stock.area ?? stock.pieces[0].area ?? 0) - stock.width * stock.height) < LABEL_EPS &&
      Math.abs(stock.pieces[0].width - stock.width) < LABEL_EPS &&
      Math.abs(stock.pieces[0].height - stock.height) < LABEL_EPS;
    if (whole) {
      full.push(stock);
      continue;
    }
    const key = JSON.stringify([
      stock.product,
      stock.thickness,
      number(stock.width),
      number(stock.height),
      sorted(
        stock.pieces.map((p) => [
          rect(p),
          !!p.rotated,
          sorted(sheetPieceGeometry(p).edges.map((e) => [pointKey(e.a), pointKey(e.b)].sort())),
        ]),
      ),
      sorted((stock.cuts ?? []).map(rect)),
      sorted((stock.remnants ?? []).map(rect)),
      sorted((stock.scrap ?? []).map(rect)),
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(stock);
  }
  const alphabet = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ";
  const letter = (i) =>
    i < alphabet.length
      ? alphabet[i]
      : `${letter(Math.floor(i / alphabet.length) - 1)}${alphabet[i % alphabet.length]}`;
  const out = [...groups.values()].map((stocks, i) => ({
    id: `scheme-${i + 1}`,
    label: `Схема ${letter(i)}`,
    stocks,
    full: false,
  }));
  if (full.length)
    out.push({ id: "whole-sheets", label: "Целые листы без раскроя", stocks: full, full: true });
  return out;
}

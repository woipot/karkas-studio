// Defaults explicitly requested for this task: 3 mm saw kerf and a square
// reusable offcut at least 0.3×0.3 m. These are site planning assumptions,
// not verified blade/manufacturer data or normative construction tolerances.
export const sheetCuttingDefaults = Object.freeze({ kerf: 3, minReusable: 0.3 });
// Floating-point geometry tolerance, not a fabrication allowance.
const EPS = 1e-8;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const compareId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function sheetCuttingOptions(project = {}) {
  return { ...sheetCuttingDefaults, ...project.sheathing?.cutting };
}
/** Installation tiles are rectangular cutting blanks. Their polygons may include
 * opening/rake trims: those trims are counted as machining waste, not as another
 * physical panel or as automatically recoverable rectangular stock.
 * Local X follows the sheet's major axis for floors/roofs; walls may rotate.
 */
export function sheetPartsFromPanels(panels, { kind, product, thickness }) {
  const groups = new Map();
  for (const panel of panels) {
    const id = panel.layoutPartId ?? panel.stockSheetId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(panel);
  }
  return [...groups]
    .sort(([a], [b]) => compareId(a, b))
    .map(([id, ps]) => {
      const points = ps.flatMap((p) => p.localPolygon),
        x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      const width = Math.max(...points.map((p) => p.x)) - x,
        height = Math.max(...points.map((p) => p.y)) - y;
      return {
        id,
        product,
        thickness,
        surfaceId: ps[0].surfaceId,
        batchId: kind === "walls" ? `walls-${ps[0].sheetSide ?? "exterior"}` : kind,
        kind,
        width,
        height,
        area: sum(ps.map((p) => p.area)),
        canRotate: kind === "walls",
        panelIds: ps.map((p) => p.id),
        polygons: ps.map((p) => p.localPolygon.map((q) => ({ x: q.x - x, y: q.y - y }))),
        localOrigin: { x, y },
      };
    });
}
const rectArea = (r) => r.width * r.height;
function split(rect, width, height, kerf, vertical) {
  const dx = Math.max(0, rect.width - width),
    dy = Math.max(0, rect.height - height),
    kx = Math.min(kerf, dx),
    ky = Math.min(kerf, dy),
    free = [],
    cuts = [];
  const add = (x, y, width, height) => {
    if (width > EPS && height > EPS) free.push({ x, y, width, height });
  };
  const cut = (axis, x, y, width, height) => {
    if (width > EPS && height > EPS) cuts.push({ axis, x, y, width, height, area: width * height });
  };
  if (vertical) {
    cut("x", rect.x + width, rect.y, kx, rect.height);
    add(rect.x + width + kx, rect.y, dx - kx, rect.height);
    cut("y", rect.x, rect.y + height, width, ky);
    add(rect.x, rect.y + height + ky, width, dy - ky);
  } else {
    cut("y", rect.x, rect.y + height, rect.width, ky);
    add(rect.x, rect.y + height + ky, rect.width, dy - ky);
    cut("x", rect.x + width, rect.y, kx, height);
    add(rect.x + width + kx, rect.y, dx - kx, height);
  }
  return { free, cuts };
}
function run(parts, stock, { kerf, minReusable }, order, splitMode) {
  const sheets = [],
    unplaced = [],
    k = kerf / 1000;
  let node = 0;
  for (const part of [...parts].sort(order)) {
    const orientations = [{ width: part.width, height: part.height, rotated: false }];
    const canRotate = part.canRotate && part.kind !== "floors" && part.kind !== "roof";
    if (canRotate && Math.abs(part.width - part.height) > EPS)
      orientations.push({ width: part.height, height: part.width, rotated: true });
    let best;
    function search(sheet, index) {
      const rect = sheet.free[index];
      for (const o of orientations) {
        if (o.width > rect.width + EPS || o.height > rect.height + EPS) continue;
        for (const vertical of [true, false]) {
          const divided = split(rect, o.width, o.height, k, vertical);
          const reusable = divided.free.filter(
            (r) => r.width + EPS >= minReusable && r.height + EPS >= minReusable,
          );
          const score = [
            rectArea(rect) - o.width * o.height,
            splitMode === 0 ? -Math.max(0, ...reusable.map(rectArea)) : sum(divided.cuts.map((c) => c.area)),
            sheet.index,
            index,
            o.rotated ? 1 : 0,
            vertical ? 0 : 1,
          ];
          if (
            !best ||
            score.some(
              (v, i) =>
                Math.abs(v - best.score[i]) > EPS &&
                score.slice(0, i).every((a, j) => Math.abs(a - best.score[j]) <= EPS) &&
                v < best.score[i],
            )
          )
            best = { sheet, index, rect, o, divided, score };
        }
      }
    }
    for (const sheet of sheets) for (let i = 0; i < sheet.free.length; i++) search(sheet, i);
    if (!best) {
      if (!orientations.some((o) => o.width <= stock.length + EPS && o.height <= stock.width + EPS)) {
        unplaced.push(part.id);
        continue;
      }
      const sheet = {
        id: `CUT-${stock.id}-${stock.thickness}-${sheets.length + 1}`,
        index: sheets.length,
        product: stock.id,
        thickness: stock.thickness,
        width: stock.length,
        height: stock.width,
        pieces: [],
        cuts: [],
        free: [{ id: `N${++node}`, x: 0, y: 0, width: stock.length, height: stock.width }],
        scrap: [],
        cutTree: [],
      };
      sheets.push(sheet);
      search(sheet, 0);
    }
    const { sheet, index, rect, o, divided } = best;
    const piece = {
      ...part,
      canRotate: Boolean(canRotate),
      x: rect.x,
      y: rect.y,
      width: o.width,
      height: o.height,
      rotated: o.rotated,
      sourceWidth: part.width,
      sourceHeight: part.height,
      blankArea: o.width * o.height,
      // Translation/rotation maps polygons into the stock sheet's local plane.
      polygons: part.polygons?.map((poly) =>
        poly.map((q) =>
          o.rotated
            ? { x: rect.x + part.height - q.y, y: rect.y + q.x }
            : { x: rect.x + q.x, y: rect.y + q.y },
        ),
      ),
      parentNodeId: rect.id,
    };
    sheet.pieces.push(piece);
    sheet.free.splice(index, 1);
    const children = divided.free.map((r) => ({ ...r, id: `N${++node}` }));
    for (const r of children) {
      if (r.width + EPS >= minReusable && r.height + EPS >= minReusable) sheet.free.push(r);
      else sheet.scrap.push(r);
    }
    const cuts = divided.cuts.map((c, i) => ({
      ...c,
      id: `${sheet.id}-K${sheet.cuts.length + i + 1}`,
      parentNodeId: rect.id,
    }));
    sheet.cuts.push(...cuts);
    sheet.cutTree.push({
      id: rect.id,
      rect: { ...rect },
      partId: part.id,
      splitOrder: best.score.at(-1) === 0 ? "x-y" : "y-x",
      cuts: cuts.map((c) => c.id),
      children: children.map((r) => r.id),
    });
  }
  return { sheets, unplaced };
}
/** Deterministic guillotine best-fit decreasing, trying two orderings and two
 * cut directions. A feasible heuristic; area lower bound is not a proof of optimality.
 * Stock X = major axis (length), stock Y = width. Dimensions m, kerf input mm.
 */
export function cutSheetParts(parts, stock, options = {}, partition = true) {
  if (
    !stock ||
    !Number.isFinite(stock.width) ||
    !Number.isFinite(stock.length) ||
    stock.width <= 0 ||
    stock.length <= 0 ||
    !Array.isArray(parts)
  )
    throw Error("Раскрой листов: нужны положительные конечные размеры листа и массив деталей.");
  const ids = new Set();
  for (const p of parts) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      ids.has(p.id) ||
      ![p.width, p.height, p.area].every(Number.isFinite) ||
      p.width <= 0 ||
      p.height <= 0 ||
      p.area < 0 ||
      p.area > p.width * p.height + EPS
    )
      throw Error("Раскрой листов: некорректные размеры, площадь или повторяющийся ID детали.");
    ids.add(p.id);
  }
  const settings = { ...sheetCuttingDefaults, ...options };
  if (
    !Number.isFinite(settings.kerf) ||
    settings.kerf < 0 ||
    !Number.isFinite(settings.minReusable) ||
    settings.minReusable < 0
  )
    throw Error(
      "Раскрой листов: пропил и минимальный остаток должны быть конечными неотрицательными числами.",
    );
  const idOrder = (a, b) => compareId(a.id, b.id);
  const orders = [
    (a, b) =>
      Math.max(b.width, b.height) - Math.max(a.width, a.height) || rectArea(b) - rectArea(a) || idOrder(a, b),
    (a, b) =>
      rectArea(b) - rectArea(a) || Math.max(b.width, b.height) - Math.max(a.width, a.height) || idOrder(a, b),
  ];
  let best;
  for (const order of orders)
    for (const mode of [0, 1]) {
      const r = run(parts, stock, settings, order, mode),
        score = [r.unplaced.length, r.sheets.length, -sum(r.sheets.flatMap((s) => s.free).map(rectArea))];
      if (
        !best ||
        score[0] < best.score[0] ||
        (score[0] === best.score[0] &&
          (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2] - EPS)))
      )
        best = { ...r, score };
    }
  // Keep the feasible sum of independent surface plans as an upper bound:
  // global offcut reuse must never require more sheets than separate purchases.
  if (partition)
    for (const grouping of [(p) => p.surfaceId ?? "surface", (p) => p.batchId ?? p.kind ?? "batch"]) {
      const grouped = new Map();
      for (const p of parts) {
        const key = grouping(p);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(p);
      }
      if (grouped.size <= 1) continue;
      const separate = [...grouped]
        .sort(([a], [b]) => compareId(a, b))
        .map(([, ps]) => cutSheetParts(ps, stock, settings, false));
      const count = sum(separate.map((g) => g.count)),
        reusable = sum(separate.map((g) => g.reusableArea));
      if (
        separate.every((g) => g.complete) &&
        (best.unplaced.length ||
          count < best.sheets.length ||
          (count === best.sheets.length &&
            reusable > sum(best.sheets.flatMap((s) => s.free).map(rectArea)) + EPS))
      ) {
        best.sheets = separate.flatMap((g) => g.stocks.map((s) => ({ ...s, free: s.remnants })));
        best.unplaced = [];
      }
    }
  // Reindex sheets and cut IDs after combining independent feasible plans.
  best.sheets = best.sheets.map((s, i) => {
    const id = `CUT-${stock.id}-${stock.thickness}-${i + 1}`;
    const cuts = new Map(s.cuts.map((c, j) => [c.id, `${id}-K${j + 1}`]));
    return {
      ...s,
      id,
      cuts: s.cuts.map((c) => ({ ...c, id: cuts.get(c.id) })),
      cutTree: s.cutTree.map((n) => ({ ...n, cuts: n.cuts.map((k) => cuts.get(k)) })),
    };
  });
  const stocks = best.sheets.map(({ free, scrap, index, ...s }) => {
    const area = sum(s.pieces.map((p) => p.area)),
      blankArea = sum(s.pieces.map((p) => p.blankArea)),
      kerfArea = sum(s.cuts.map((c) => c.area)),
      reusableArea = sum(free.map(rectArea)),
      cutoutWasteArea = Math.max(0, blankArea - area),
      scrapArea = sum(scrap.map(rectArea));
    return {
      ...s,
      area,
      blankArea,
      kerfArea,
      cutoutWasteArea,
      scrapArea,
      reusableArea,
      wasteArea: kerfArea + cutoutWasteArea + scrapArea,
      remnants: free.map((r) => ({ ...r, reusable: true, area: rectArea(r) })),
      scrap,
    };
  });
  const area = sum(stocks.map((s) => s.area)),
    purchasedArea = stocks.length * stock.width * stock.length,
    wasteArea = sum(stocks.map((s) => s.wasteArea)),
    reusableArea = sum(stocks.map((s) => s.reusableArea));
  return {
    product: stock.id,
    thickness: stock.thickness,
    stocks,
    unplaced: best.unplaced,
    complete: !best.unplaced.length,
    count: stocks.length,
    lowerBound: Math.max(0, Math.ceil((sum(parts.map((p) => p.area)) - EPS) / (stock.width * stock.length))),
    blankLowerBound: Math.max(0, Math.ceil((sum(parts.map(rectArea)) - EPS) / (stock.width * stock.length))),
    area,
    purchasedArea,
    wasteArea,
    reusableArea,
    kerfArea: sum(stocks.map((s) => s.kerfArea)),
    wastePercent: purchasedArea ? (wasteArea / purchasedArea) * 100 : 0,
    unusedPercent: purchasedArea ? ((purchasedArea - area) / purchasedArea) * 100 : 0,
    optimal: false,
    kerf: settings.kerf,
    minReusable: settings.minReusable,
    balanceError: purchasedArea - area - wasteArea - reusableArea,
  };
}

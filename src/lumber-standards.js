/** Size membership is independent of grade, strength and stock availability. */
export const GOST_SOURCE = "https://files.stroyinf.ru/Data2/1/4294852/4294852213.pdf";
export const PLANED_SOURCE = "https://www.veles-les.ru/catalog/doska-stroganaya/";
const SAWN_SOURCE = "https://www.veles-les.ru/catalog/doska-i-brus-obreznye/";
const FINNISH_SOURCE = "https://liperin.fi/collections/mitallistettu-puutavara";

// GOST 24454-80, clause 2, table (2007 edition), mm; nominal at 20% moisture (clause 5).
export const gostWidths = Object.freeze(
  Object.fromEntries(
    Object.entries({
      16: [75, 100, 125, 150],
      19: [75, 100, 125, 150, 175],
      22: [75, 100, 125, 150, 175, 200, 225],
      25: [75, 100, 125, 150, 175, 200, 225, 250, 275],
      32: [75, 100, 125, 150, 175, 200, 225, 250, 275],
      40: [75, 100, 125, 150, 175, 200, 225, 250, 275],
      44: [75, 100, 125, 150, 175, 200, 225, 250, 275],
      50: [75, 100, 125, 150, 175, 200, 225, 250, 275],
      60: [75, 100, 125, 150, 175, 200, 225, 250, 275],
      75: [75, 100, 125, 150, 175, 200, 225, 250, 275],
      100: [100, 125, 150, 175, 200, 225, 250, 275],
      125: [125, 150, 175, 200, 225, 250],
      150: [150, 175, 200, 225, 250],
      175: [175, 200, 225, 250],
      200: [200, 225, 250],
      250: [250],
    }).map(([t, widths]) => [t, Object.freeze(widths)]),
  ),
);

// GOST 24454-80, clause 4: special/export sections, not the clause 2 table.
const special = new Set([
  "63x160",
  "90x90",
  "90x125",
  "50x300",
  "63x300",
  "75x300",
  "100x300",
  "40x180",
  "70x150",
  "400x400",
  "360x360",
  "200x400",
  "180x350",
  "150x300",
  "300x300",
  "200x240",
  "220x260",
]);
// Supplier catalogues above, checked 2026-11-07. 'Common' is a documented product range,
// not a guarantee of stock or structural grading. Unlisted valid sizes remain 'rare'.
const commonSawn = new Set([
  "25x50",
  "25x100",
  "25x150",
  "25x200",
  "40x100",
  "40x150",
  "40x200",
  "50x50",
  "50x100",
  "50x150",
  "50x200",
  "50x250",
  "100x100",
  "100x150",
  "100x200",
  "150x150",
  "150x200",
  "200x200",
]);
const commonPlaned = new Set([
  "20x95",
  "20x140",
  "20x145",
  "35x140",
  "45x45",
  "45x90",
  "45x95",
  "45x140",
  "45x145",
  "45x190",
  "45x195",
  "45x240",
]);
const commonFinnish = new Set(["48x48", "48x73", "48x98", "48x123", "48x148", "48x173", "48x198", "48x223"]);
const BOARD20_SOURCE = "https://mosbrustorg.ru/14-doska-stroganaya-20x100.html";
const RARE45_SOURCE =
  "https://pilomaterialkiev.com/ua/p/doska-obreznaya-sosna-ooo-sahpays-45kh200-mm-4-5-m-svezhepilennaya-sunrise-1004261";
const BOARD45_SOURCE = "https://bazatajga.ru/doska_strogannaya_suhaya.php";

function dimensions(id) {
  const m =
    typeof id === "string" &&
    id.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:[xх×*]|на)\s*(\d+(?:[.,]\d+)?)\s*(?:мм)?\s*$/i);
  if (!m) return null;
  const a = Number(m[1].replace(",", ".")),
    b = Number(m[2].replace(",", "."));
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0
    ? { b: a, h: b, id: `${Math.min(a, b)}x${Math.max(a, b)}` }
    : null;
}

export function classifySection(id) {
  const s = dimensions(id);
  if (!s)
    return { gost: false, market: "none", note: "Некорректное обозначение сечения.", source: GOST_SOURCE };
  const [t, w] = s.id.split("x").map(Number);
  const table = gostWidths[t]?.includes(w) ?? false;
  const gost = table || special.has(s.id);
  const source = commonSawn.has(s.id)
    ? SAWN_SOURCE
    : commonPlaned.has(s.id)
      ? PLANED_SOURCE
      : commonFinnish.has(s.id)
        ? FINNISH_SOURCE
        : s.id === "20x100"
          ? BOARD20_SOURCE
          : s.id === "45x150"
            ? BOARD45_SOURCE
            : s.id === "45x200"
              ? RARE45_SOURCE
              : GOST_SOURCE;
  const market = source !== GOST_SOURCE && source !== RARE45_SOURCE ? "common" : "rare";
  const note = table
    ? "ГОСТ 24454-80, п. 2, таблица номинальных размеров."
    : special.has(s.id)
      ? "ГОСТ 24454-80, п. 4: специальное назначение/экспорт; условия поставки уточняются."
      : s.id === "45x200"
        ? "Вне таблицы ГОСТ 24454-80; есть региональное предложение свежепилёной доски, массовая доступность не проверена. Не заменять строганым 45×195 без пересчёта."
        : market === "common"
          ? "Вне основной таблицы ГОСТ 24454-80; размер продаётся. Фактические размеры и сорт уточняются у поставщика."
          : "Вне таблицы ГОСТ 24454-80; серийная продажа не подтверждена. Возможен заказ по примечанию к п. 2; это не доказательство отсутствия изделия.";
  return { gost, market, note, source };
}

// Veles-Les gives these exact raw → finished pairs. This is a supplier profile,
// not a universal shrinkage allowance under GOST 6782.1 (GOST 24454-80 clause 5).
export const dressedSections = Object.freeze({
  "50x100": "45x95",
  "50x150": "45x145",
  "50x200": "45x195",
  "50x250": "45x240",
});

const sectionKey = (key) =>
  /section$/i.test(key) ||
  ["wallService", "roofCounter", "roofBattens", "roofInternal", "roofService"].includes(key);

/** Visit section fields only: prices, labels and imported manufacturing geometry are not nominal sizes. */
export function projectSections(project) {
  const found = [];
  function visit(value, path = "") {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const field = path ? `${path}.${key}` : key;
      if (key === "prices" || key === "site") continue;
      if (sectionKey(key) && typeof child === "string") found.push({ field, id: child });
      else visit(child, field);
    }
  }
  visit(project);
  return found;
}

/** Resolve before geometry, weight, mechanics, cutting and procurement. Never mutate revision inputs. */
export function resolveDressedProject(project) {
  if (project.material?.dressed !== true) return project;
  function visit(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(visit);
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        // Source-model shapes/cuts already specify finished geometry, including their actual section.
        if (key === "sourceModel" || key === "prices" || key === "site") return [key, child];
        if (sectionKey(key) && typeof child === "string") {
          const s = dimensions(child),
            replacement = s && dressedSections[s.id];
          if (replacement) {
            const [b, h] = replacement.split("x");
            return [key, s.b <= s.h ? replacement : `${h}x${b}`];
          }
        }
        return [key, visit(child)];
      }),
    );
  }
  return visit(project);
}

export function lumberAssumptions(project) {
  const base =
    "material.dressed по умолчанию false: введённые размеры считаются расчётными; усушка автоматически не назначается (ГОСТ 24454-80, п. 5). Сечение не подтверждает сорт по ГОСТ 8486-86, п. 2.2, или сопротивления по СП 64.";
  if (project.material?.dressed !== true) return [base];
  return [
    `material.dressed=true: профиль поставщика ${PLANED_SOURCE}; 50×100→45×95, 50×150→45×145, 50×200→45×195, 50×250→45×240 мм. Размеры используются в геометрии, массе, механике, раскрое и смете; цена за м³ готового изделия. Это допущение, требующее подтверждения партии.`,
    "Остальные сечения и импортированная геометрия roof.sourceModel считаются уже фактическими и не уменьшаются. Универсальная величина усушки/строжки не проверена; задайте фактическое сечение явно.",
  ];
}

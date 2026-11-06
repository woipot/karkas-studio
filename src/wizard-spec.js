// Pure mapping «Новый дом» wizard form → generateHouse() spec. No React, no DOM:
// shared by the wizard component, the engine Web Worker and node tests.

export const roofShapes = [
  ["gable", "Двускатная"],
  ["hip", "Вальмовая (четырёхскатная)"],
  ["mono", "Односкатная"],
];
export const footprintShapes = [
  ["rectangle", "Прямоугольник"],
  ["l-shape", "Г-образный"],
];
// Ground snow / wind pressure defaults match defaultDesignerProject.loads.
export const DEFAULT_SNOW = 1.5;
export const DEFAULT_WIND = 0.3;

export function defaultWizardForm() {
  return {
    name: "Мой каркасный дом",
    shape: "rectangle",
    width: 9,
    depth: 7,
    wingWidth: 4,
    wingDepth: 3,
    floors: 1,
    heights: [2.8, 2.6],
    rooms: [
      { name: "Гостиная-кухня", area: 18, level: 1 },
      { name: "Спальня", area: 10, level: 1 },
    ],
    city: "",
    snow: DEFAULT_SNOW,
    wind: DEFAULT_WIND,
    loadsSource: "default",
    roofShape: "gable",
    pitch: 25,
    ridgeAxis: "auto",
    budget: null,
  };
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const toNumber = (v) => (typeof v === "string" ? Number(v.replace(",", ".").trim()) : v);
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function footprintArea(form) {
  const W = toNumber(form.width),
    D = toNumber(form.depth);
  if (!finite(W) || !finite(D)) return null;
  if (form.shape !== "l-shape") return W * D;
  const ww = toNumber(form.wingWidth),
    wd = toNumber(form.wingDepth);
  if (!finite(ww) || !finite(wd)) return null;
  // Outline (0,0)→(W,0)→(W,wd)→(ww,wd)→(ww,D)→(0,D): full rectangle minus the cut corner.
  return W * D - (W - ww) * (D - wd);
}

// Returns {errors: [{step, field, message}], warnings: [{step, message}]}.
export function validateWizardForm(form) {
  const errors = [],
    warnings = [];
  const err = (step, field, message) => errors.push({ step, field, message });
  const range = (step, field, value, lo, hi, label, unit = "м") => {
    const n = toNumber(value);
    if (!finite(n) || n < lo || n > hi) err(step, field, `${label}: от ${lo} до ${hi} ${unit}.`);
    return n;
  };
  if (typeof form.name !== "string" || !form.name.trim()) err("size", "name", "Введите название дома.");
  else if (form.name.length > 160) err("size", "name", "Название не длиннее 160 символов.");
  if (!["rectangle", "l-shape"].includes(form.shape)) err("size", "shape", "Выберите форму контура.");
  const W = range("size", "width", form.width, 2, 60, "Ширина"),
    D = range("size", "depth", form.depth, 2, 60, "Глубина");
  if (form.shape === "l-shape" && finite(W) && finite(D)) {
    const ww = range("size", "wingWidth", form.wingWidth, 1, 50, "Ширина крыла"),
      wd = range("size", "wingDepth", form.wingDepth, 1, 50, "Глубина выреза");
    if (finite(ww) && ww > W - 1)
      err("size", "wingWidth", "Ширина крыла должна быть хотя бы на 1 м меньше ширины.");
    if (finite(wd) && wd > D - 1)
      err("size", "wingDepth", "Глубина выреза должна быть хотя бы на 1 м меньше глубины.");
  }
  const floors = toNumber(form.floors);
  if (![1, 2].includes(floors)) err("floors", "floors", "Поддерживаются один или два этажа.");
  for (let i = 0; i < (floors === 2 ? 2 : 1); i++)
    range("floors", `heights.${i}`, form.heights?.[i], 2, 5, `Высота ${i + 1} этажа`);
  const rooms = Array.isArray(form.rooms) ? form.rooms : [];
  if (rooms.length > 30) err("rooms", "rooms", "Не более 30 комнат.");
  const perLevel = [0, 0];
  rooms.forEach((r, i) => {
    if (typeof r.name !== "string" || !r.name.trim())
      err("rooms", `rooms.${i}.name`, `Комната ${i + 1}: введите название.`);
    const a = toNumber(r.area);
    if (!finite(a) || a < 1 || a > 500)
      err("rooms", `rooms.${i}.area`, `Комната ${i + 1}: площадь от 1 до 500 м².`);
    const level = toNumber(r.level ?? 1);
    if (level !== 1 && !(level === 2 && floors === 2))
      err("rooms", `rooms.${i}.level`, `Комната ${i + 1}: этаж ${level} отсутствует в доме.`);
    else if (finite(a)) perLevel[level - 1] += a;
  });
  const area = footprintArea(form);
  if (rooms.length && form.shape === "l-shape")
    warnings.push({
      step: "rooms",
      message:
        "Для Г-образного контура автоматическая раскладка комнат пока не поддерживается: будет построена оболочка без перегородок.",
    });
  else if (finite(area))
    perLevel.forEach((sum, i) => {
      if (sum > area * 0.55)
        warnings.push({
          step: "rooms",
          message: `Комнаты ${i + 1} этажа (${round(sum, 1)} м²) занимают больше 55 % площади по осям (${round(area, 1)} м²): с учётом стен и коридора 1,2 м раскладка может не поместиться — генератор сообщит об этом при расчёте.`,
        });
    });
  range("site", "snow", form.snow, 0, 20, "Снеговая нагрузка", "кПа");
  range("site", "wind", form.wind, 0, 5, "Ветровое давление", "кПа");
  if (!["mono", "gable", "hip"].includes(form.roofShape)) err("roof", "roofShape", "Выберите форму крыши.");
  range("roof", "pitch", form.pitch, 2, 60, "Уклон", "°");
  if (form.budget !== null && form.budget !== undefined && form.budget !== "") {
    const b = toNumber(form.budget);
    if (!finite(b) || b <= 0) err("budget", "budget", "Бюджет — положительное число рублей или пусто.");
  }
  return { errors, warnings };
}

// Wizard form → generateHouse(spec). Throws Error with .errors when the form is invalid.
export function wizardToGeneratorSpec(form) {
  const { errors } = validateWizardForm(form);
  if (errors.length) {
    const e = new Error(errors[0].message);
    e.name = "WizardValidationError";
    e.errors = errors;
    throw e;
  }
  const floors = toNumber(form.floors),
    spec = {
      name: form.name.trim(),
      template: form.shape,
      width: round(toNumber(form.width)),
      depth: round(toNumber(form.depth)),
      levels: form.heights.slice(0, floors).map((h) => ({ height: round(toNumber(h)) })),
      loads: { snow: round(toNumber(form.snow)), wind: round(toNumber(form.wind)) },
      roof: {
        shape: form.roofShape,
        pitch: round(toNumber(form.pitch), 2),
        // "auto": the generator puts the ridge along the long side (trusses span the short one).
        ...(form.ridgeAxis === "x" || form.ridgeAxis === "y"
          ? { ridgeAngle: form.ridgeAxis === "y" ? 90 : 0 }
          : {}),
      },
    };
  if (form.shape === "l-shape") {
    spec.wingWidth = round(toNumber(form.wingWidth));
    spec.wingDepth = round(toNumber(form.wingDepth));
  }
  const rooms = (form.rooms ?? []).map((r) => ({
    name: r.name.trim(),
    area: round(toNumber(r.area), 2),
    level: toNumber(r.level ?? 1),
  }));
  if (rooms.length && form.shape !== "l-shape") spec.rooms = rooms;
  return spec;
}

export function budgetVerdict(form, report) {
  const budget = toNumber(form?.budget),
    total = report?.estimate?.total;
  if (!finite(budget) || budget <= 0 || !finite(total)) return null;
  return { budget, total, delta: total - budget, over: total > budget, ratio: total / budget };
}

// Accepts the shapes a site-loads module may reasonably return and extracts kPa values.
export function readSiteLoads(result) {
  const pick = (...vals) => {
    for (const v of vals) {
      const n = finite(v) ? v : finite(v?.value) ? v.value : finite(v?.kPa) ? v.kPa : null;
      if (n !== null) return n;
    }
    return null;
  };
  if (!result || typeof result !== "object") return null;
  const snow = pick(result.snow, result.snowKPa, result.snowLoad, result.sg, result.loads?.snow),
    wind = pick(result.wind, result.windKPa, result.windPressure, result.w0, result.loads?.wind);
  if (snow === null && wind === null) return null;
  const label = (prefix, v) => (typeof v === "string" || typeof v === "number" ? `${prefix}${v}` : null);
  return {
    snow,
    wind,
    note:
      [
        label("", result.city ?? result.name),
        label("снеговой район ", result.snowRegion ?? result.snowDistrict),
        label("ветровой район ", result.windRegion ?? result.windDistrict),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    source: typeof result.source === "string" ? result.source : null,
  };
}

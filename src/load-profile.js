/**
 * Code profile for actions (loads) and their combinations.
 *
 * Pure functions only: no project geometry is mutated here. Every rule is
 * data-driven through LOAD_PROFILES so a second profile (EN 1990/1991) can be
 * added without touching the engine call sites.
 *
 * Units: pressures kPa, heights m, angles degrees, forces kN.
 *
 * Profile "SP20-2016" — СП 20.13330.2016 «Нагрузки и воздействия»:
 *  - snow: S0 = ce·ct·µ·Sg (п. 10.1), loads.snow = Sg (нормативный вес снегового покрова);
 *    µ for single/gable slopes: прил. Б, схема Б.1/Б.2 (µ=1 при α≤30°, µ=0 при α≥60°,
 *    linear between);
 *  - unbalanced snow on gable roofs: прил. Б.2, вариант 2. The coefficients 0,75µ / 1,25µ
 *    and the range 20°≤α≤30° are taken from СНиП 2.01.07-85 прил. 3 схема 1 (кept in СП 20
 *    прил. Б). They could not be verified against the current printed edition in this
 *    build and are reported as an assumption;
 *  - wind: wm = w0·k(ze)·c (п. 11.1.3), k(ze) per table 11.2 (linear interpolation),
 *    ze = h for h ≤ d (п. 11.1.5), walls c = +0,8 / −0,5 (прил. В.1.2, табл. В.1),
 *    roof slopes by zones F–J (прил. В.1.2, табл. В.2; the zone values below follow the
 *    EN 1991-1-4 table 7.4a layout that СП 20 adopted and must be checked against the
 *    edition in force);
 *  - partial factors γf: timber self-weight 1,1 and factory layers 1,2 (табл. 7.1), live
 *    1,3 for q<2,0 kPa else 1,2 (п. 8.2.2), snow 1,4 (п. 10.12), wind 1,4 (п. 11.1.12);
 *    favourable permanent 0,9 (п. 7.2);
 *  - basic combinations (п. 6.2, 6.4): permanent + temporary with ψt1=1,0 for the
 *    leading, ψt2=0,9 for the second and ψt3=0,7 for the others.
 */

export const DEFAULT_LOAD_PROFILE = "SP20-2016";
export const TERRAIN_TYPES = ["A", "B", "C"];

const finite = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++)
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1],
        [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  return table.at(-1)[1];
}

/** СП 20.13330.2016 табл. 11.2: k(ze) for terrain A, B, C. */
const SP20_WIND_K = {
  heights: [5, 10, 20, 40, 60, 80, 100, 150, 200, 250, 300, 350, 480],
  A: [0.75, 1.0, 1.25, 1.5, 1.7, 1.85, 2.0, 2.25, 2.45, 2.65, 2.75, 2.75, 2.75],
  B: [0.5, 0.65, 0.85, 1.1, 1.3, 1.45, 1.6, 1.9, 2.1, 2.3, 2.5, 2.75, 2.75],
  C: [0.4, 0.4, 0.55, 0.8, 1.0, 1.15, 1.25, 1.55, 1.8, 2.0, 2.2, 2.35, 2.75],
};

/**
 * Gable (duopitch) roof external coefficients, field zones (прил. В.1.2, табл. В.2).
 * θ=0: wind normal to the ridge, H = windward slope field, I = leeward slope field,
 * F/G = windward eave edge zones. θ=90: wind parallel to the ridge, H = slope field
 * beyond e/2 from the gable, F/G = gable-end strip.
 * Pairs [pitch, suction (≤0), pressure (≥0)].
 */
const GABLE_ROOF_C = {
  theta0: {
    F: [
      [5, -1.7, 0],
      [15, -0.9, 0.2],
      [30, -0.5, 0.7],
      [45, 0, 0.7],
      [60, 0, 0.7],
      [75, 0, 0.8],
    ],
    H: [
      [5, -0.6, 0],
      [15, -0.3, 0.2],
      [30, -0.2, 0.4],
      [45, 0, 0.6],
      [60, 0, 0.7],
      [75, 0, 0.8],
    ],
    I: [
      [5, -0.6, 0],
      [15, -0.4, 0],
      [30, -0.4, 0],
      [45, -0.2, 0],
      [60, -0.2, 0],
      [75, -0.2, 0],
    ],
  },
  theta90: {
    F: [
      [5, -1.6, 0],
      [15, -1.3, 0],
      [30, -1.1, 0],
      [45, -1.1, 0],
      [60, -1.1, 0],
      [75, -1.1, 0],
    ],
    H: [
      [5, -0.7, 0],
      [15, -0.6, 0],
      [30, -0.8, 0],
      [45, -0.9, 0],
      [60, -0.8, 0],
      [75, -0.8, 0],
    ],
  },
};

export const LOAD_PROFILES = {
  "SP20-2016": {
    id: "SP20-2016",
    label: "СП 20.13330.2016",
    snow: {
      // прил. Б, схема Б.1: µ=1 при α≤30°, 0 при α≥60°
      muFlatLimit: 30,
      muZeroLimit: 60,
      muFlat: 1,
      // прил. Б.2, вариант 2 (см. комментарий модуля)
      unbalanced: { min: 20, max: 30, low: 0.75, high: 1.25, verified: false },
      clause: "СП 20.13330.2016 п. 10.1, прил. Б (схемы Б.1, Б.2)",
    },
    wind: {
      kTable: SP20_WIND_K,
      wallWindward: 0.8,
      wallLeeward: -0.5,
      // внутреннее давление для отрыва кровли, принято неблагоприятное +0,2
      internalPressure: 0.2,
      roof: GABLE_ROOF_C,
      clause: "СП 20.13330.2016 п. 11.1.3–11.1.5, табл. 11.2, прил. В.1.2",
    },
    factors: {
      timber: 1.1, // табл. 7.1, деревянные конструкции
      layers: 1.2, // табл. 7.1, изоляционные/отделочные слои заводского изготовления
      liveLow: 1.3, // п. 8.2.2, q < 2,0 кПа
      liveHigh: 1.2, // п. 8.2.2, q ≥ 2,0 кПа
      liveThreshold: 2.0,
      snow: 1.4, // п. 10.12
      wind: 1.4, // п. 11.1.12
      favourable: 0.9, // п. 7.2, постоянная нагрузка, уменьшающая усилие
    },
    psi: [1.0, 0.9, 0.7], // п. 6.4, ψt1, ψt2, ψt3…
    combinationClause: "СП 20.13330.2016 п. 6.2, 6.4",
  },
};

export function loadProfile(loads = {}) {
  return LOAD_PROFILES[loads?.code ?? DEFAULT_LOAD_PROFILE] ?? LOAD_PROFILES[DEFAULT_LOAD_PROFILE];
}

/** µ for a single slope of angle alpha (прил. Б, схема Б.1). */
export function snowShapeMu(alpha, profile = LOAD_PROFILES[DEFAULT_LOAD_PROFILE]) {
  const s = profile.snow;
  if (!finite(alpha)) return s.muFlat;
  if (alpha <= s.muFlatLimit) return s.muFlat;
  if (alpha >= s.muZeroLimit) return 0;
  return (s.muFlat * (s.muZeroLimit - alpha)) / (s.muZeroLimit - s.muFlatLimit);
}

/** µ with an explicit override (zone or project snowMu) taking priority. */
export function snowMu(alpha, override, profile) {
  return finite(override) ? override : snowShapeMu(alpha, profile);
}

/** Exposure factors and the basis S = ce·ct·Sg multiplied later by µ. */
export function snowBasis(loads = {}) {
  const Sg = finite(loads?.snow) ? loads.snow : 1.5,
    ce = finite(loads?.snowCe) ? loads.snowCe : 1,
    ct = finite(loads?.snowCt) ? loads.snowCt : 1;
  return { Sg, ce, ct, base: Sg * ce * ct };
}

/** Roof snow pressure S0 = ce·ct·µ·Sg for a slope of angle alpha. */
export function roofSnowLoad(loads, alpha, override) {
  const profile = loadProfile(loads);
  return snowBasis(loads).base * snowMu(alpha, override, profile);
}

/**
 * Unbalanced (variant 2) coefficients for a gable roof. Returns null when the
 * profile does not require the case for these slopes. With an explicit snowMu
 * the variant still applies to that µ.
 */
export function unbalancedSnow(pitchLeft, pitchRight, { override, profile } = {}) {
  profile ??= LOAD_PROFILES[DEFAULT_LOAD_PROFILE];
  const u = profile.snow.unbalanced,
    inRange = (a) => a >= u.min - 1e-9 && a <= u.max + 1e-9;
  if (!u || !inRange(pitchLeft) || !inRange(pitchRight)) return null;
  const muL = snowMu(pitchLeft, override, profile),
    muR = snowMu(pitchRight, override, profile);
  return {
    cases: [
      { id: "unbalanced-left", muLeft: u.high * muL, muRight: u.low * muR },
      { id: "unbalanced-right", muLeft: u.low * muL, muRight: u.high * muR },
    ],
    factors: { low: u.low, high: u.high },
    range: [u.min, u.max],
    verified: u.verified,
  };
}

export function windTerrain(loads = {}) {
  return TERRAIN_TYPES.includes(loads?.terrain) ? loads.terrain : "B";
}

/** k(ze), СП 20 табл. 11.2 with linear interpolation by height. */
export function windK(ze, terrain = "B", profile = LOAD_PROFILES[DEFAULT_LOAD_PROFILE]) {
  const t = profile.wind.kTable,
    row = t[TERRAIN_TYPES.includes(terrain) ? terrain : "B"];
  return interpolate(
    t.heights.map((h, i) => [h, row[i]]),
    Math.max(0, finite(ze) ? ze : 0),
  );
}

/** Mean wind pressure w0·k(ze) before the aerodynamic coefficient c. */
export function windPressure(loads, ze) {
  const profile = loadProfile(loads),
    w0 = finite(loads?.wind) ? loads.wind : 0;
  return { w0, ze, terrain: windTerrain(loads), k: windK(ze, windTerrain(loads), profile), profile };
}

function zoneValue(table, alpha, pick) {
  return interpolate(
    table.map((r) => [r[0], pick === "suction" ? r[1] : r[2]]),
    clamp(alpha, 5, 75),
  );
}

/** External roof coefficients for one gable slope pair (field zones). */
export function gableRoofWindCoefficients(alpha, profile = LOAD_PROFILES[DEFAULT_LOAD_PROFILE]) {
  const c = profile.wind.roof;
  return {
    alpha,
    windwardPressure: zoneValue(c.theta0.H, alpha, "pressure"),
    windwardSuction: zoneValue(c.theta0.H, alpha, "suction"),
    leeward: zoneValue(c.theta0.I, alpha, "suction"),
    parallelField: zoneValue(c.theta90.H, alpha, "suction"),
    parallelEdge: zoneValue(c.theta90.F, alpha, "suction"),
    windwardEdge: zoneValue(c.theta0.F, alpha, "suction"),
  };
}

/**
 * Horizontal resultant coefficient on the vertical projection of a gable roof:
 * windward pressure (if positive) pushes downwind, leeward suction pulls downwind.
 */
export function roofHorizontalCoefficient(alpha, profile) {
  const c = gableRoofWindCoefficients(alpha, profile);
  return Math.max(0, c.windwardPressure) - Math.min(0, c.leeward);
}

/** Net upward coefficient on the plan projection of each slope (suction + internal). */
export function roofUpliftCases(pitchLeft, pitchRight, profile = LOAD_PROFILES[DEFAULT_LOAD_PROFILE]) {
  const L = gableRoofWindCoefficients(pitchLeft, profile),
    R = gableRoofWindCoefficients(pitchRight, profile),
    ci = profile.wind.internalPressure;
  // Upward positive: -cpe + cpi (internal overpressure lifts the roof).
  return [
    { id: "wind-normal-left", left: -L.windwardSuction + ci, right: -R.leeward + ci },
    { id: "wind-normal-right", left: -L.leeward + ci, right: -R.windwardSuction + ci },
    { id: "wind-parallel", left: -L.parallelField + ci, right: -R.parallelField + ci },
  ];
}

/** Single-slope (mono / canopy) roof uplift coefficient, conservative field value. */
export function monoRoofUpliftCoefficient(alpha, { open = false } = {}, profile) {
  profile ??= LOAD_PROFILES[DEFAULT_LOAD_PROFILE];
  const c = gableRoofWindCoefficients(alpha, profile),
    ci = open ? 0.6 : profile.wind.internalPressure;
  return Math.max(-c.windwardSuction, -c.parallelField, -c.leeward) + ci;
}

/**
 * Partial safety factors. Explicit project gammaG/gammaQ remain accepted as
 * overrides: gammaG replaces every permanent factor, gammaQ every variable one.
 */
export function loadFactors(loads = {}) {
  const profile = loadProfile(loads),
    f = profile.factors,
    explicitG = finite(loads?.gammaG),
    explicitQ = finite(loads?.gammaQ),
    live = finite(loads?.live) && loads.live >= f.liveThreshold ? f.liveHigh : f.liveLow;
  const out = {
    profile: profile.id,
    timber: explicitG ? loads.gammaG : f.timber,
    layers: explicitG ? loads.gammaG : f.layers,
    live: explicitQ ? loads.gammaQ : live,
    snow: explicitQ ? loads.gammaQ : f.snow,
    wind: explicitQ ? loads.gammaQ : f.wind,
    favourable: f.favourable,
    psi: [...profile.psi],
    explicitG,
    explicitQ,
  };
  // Single equivalents for modules that still accept one γG/γQ pair: the
  // larger factor of each family, so they stay on the safe side.
  out.equivalentG = Math.max(out.timber, out.layers);
  out.equivalentQ = Math.max(out.live, out.snow, out.wind);
  return out;
}

/** Factor of one load kind: timber | layers | dead | live | snow | wind. */
export function kindFactor(factors, kind) {
  if (kind === "timber") return factors.timber;
  if (kind === "layers" || kind === "dead") return factors.layers;
  return factors[kind] ?? 1;
}

/**
 * Basic combinations (п. 6.2, 6.4): one combination per leading temporary action.
 * variables: list of action ids present (e.g. ["snow", "live"]). The order of the
 * non-leading actions follows the list order.
 */
export function basicCombinations(variables, factors) {
  const present = [...new Set(variables)];
  if (!present.length) return [{ id: "permanent", leading: null, psi: {} }];
  return present.map((lead) => {
    const others = present.filter((v) => v !== lead),
      psi = { [lead]: factors.psi[0] };
    others.forEach((v, i) => (psi[v] = factors.psi[Math.min(i + 1, factors.psi.length - 1)]));
    return { id: lead + "-leading", leading: lead, psi };
  });
}

/** Design value of characteristic components {kind: kN} in a combination. */
export function combineDesign(components, factors, combination) {
  let total = 0;
  for (const [kind, value] of Object.entries(components)) {
    if (!value) continue;
    const psi = ["live", "snow", "wind"].includes(kind) ? (combination.psi[kind] ?? 0) : 1;
    total += value * kindFactor(factors, kind) * psi;
  }
  return total;
}

/** Governing combination by maximum total design value. */
export function governingCombination(components, factors) {
  const variables = ["snow", "live"].filter((k) => (components[k] ?? 0) > 0);
  const combos = basicCombinations(variables, factors).map((c) => ({
    ...c,
    total: combineDesign(components, factors, c),
  }));
  return { combinations: combos, governing: combos.reduce((a, b) => (b.total > a.total ? b : a)) };
}

/**
 * Horizontal wind resultants of a building for both plan axes.
 * levels: [{index, bounds:{width,height}, height}] with wall-frame heights;
 * zones: roof zones with {shape, ridgeAngle, bounds:{length, span}, rise, pitchLeft, pitchRight, levelIndex}.
 * Returns characteristic forces (kN) per storey (shear entering the walls of that storey).
 */
export function windStoreyForces({ loads, levels = [], zones = [], ze, gableFallback = null }) {
  const { w0, k, terrain, profile } = windPressure(loads, ze),
    w = w0 * k,
    cw = profile.wind.wallWindward - profile.wind.wallLeeward;
  const roof = { x: 0, y: 0, gableX: 0, gableY: 0, roofX: 0, roofY: 0 };
  for (const z of zones) {
    const theta = ((z.ridgeAngle ?? 0) * Math.PI) / 180,
      ux = Math.abs(Math.cos(theta)),
      uy = Math.abs(Math.sin(theta)),
      L = z.bounds?.length ?? 0,
      S = z.bounds?.span ?? 0,
      rise = z.rise ?? 0;
    if (!(rise > 0)) continue;
    // One gable (or mono side triangle) is projected per direction along the ridge.
    const gable = (S * rise) / 2;
    roof.gableX += gable * ux;
    roof.gableY += gable * uy;
    if (z.shape === "gable") {
      const c = roofHorizontalCoefficient(Math.max(z.pitchLeft ?? 0, z.pitchRight ?? 0), profile),
        a = L * rise;
      // ridge-normal projection: v = (-sin, cos)
      roof.roofX += a * uy * (c / cw);
      roof.roofY += a * ux * (c / cw);
    }
  }
  if (!zones.length && gableFallback) {
    roof.gableX += gableFallback.x ?? 0;
    roof.gableY += gableFallback.y ?? 0;
  }
  const sorted = [...levels].sort((a, b) => a.index - b.index),
    storeys = sorted.map((l) => {
      const above = sorted.filter((q) => q.index >= l.index),
        wallX = above.reduce((s, q) => s + (q.bounds?.height ?? 0) * (q.height ?? 0), 0),
        wallY = above.reduce((s, q) => s + (q.bounds?.width ?? 0) * (q.height ?? 0), 0),
        areaX = wallX + roof.gableX + roof.roofX,
        areaY = wallY + roof.gableY + roof.roofY;
      return {
        level: l.index,
        areaX,
        areaY,
        forceX: w * cw * areaX,
        forceY: w * cw * areaY,
      };
    });
  return {
    w0,
    k,
    ze,
    terrain,
    pressure: w,
    coefficient: cw,
    roofAreas: roof,
    storeys,
    forceX: storeys[0]?.forceX ?? 0,
    forceY: storeys[0]?.forceY ?? 0,
  };
}

/** Russian assumption text describing the profile actually applied. */
export function profileAssumptions(loads = {}) {
  const profile = loadProfile(loads),
    f = loadFactors(loads),
    s = snowBasis(loads),
    u = profile.snow.unbalanced;
  return [
    `Профиль норм ${profile.label}: снег S0 = ce·ct·µ·Sg (п. 10.1), Sg = ${s.Sg} кПа, ce = ${s.ce}, ct = ${s.ct}; µ = 1 при α ≤ 30°, 0 при α ≥ 60°, линейно между (прил. Б, схема Б.1). Явный snowMu зоны или проекта имеет приоритет.`,
    `Несимметричный снег двускатных покрытий (прил. Б.2, вариант 2): ${u.low}µ / ${u.high}µ при ${u.min}° ≤ α ≤ ${u.max}°. Коэффициенты и диапазон приняты по схеме 1 СНиП 2.01.07-85, сохранённой в прил. Б СП 20; сверка с действующей редакцией СП в этой сборке не выполнена.`,
    `Ветер wm = w0·k(ze)·c (п. 11.1.3): w0 = ${finite(loads?.wind) ? loads.wind : 0} кПа, тип местности ${windTerrain(loads)}, k(ze) по табл. 11.2 с линейной интерполяцией, ze = высота здания (п. 11.1.5); стены c = +0,8 / −0,5, скаты — по зонам F–J прил. В.1.2 (значения требуют сверки с редакцией СП), внутреннее давление +0,2 при проверке отрыва.`,
    f.explicitG || f.explicitQ
      ? `Коэффициенты надёжности заданы явно (loads.gammaG/gammaQ): постоянные γf = ${f.layers}, временные γf = ${f.snow}. Коэффициенты сочетаний ψ применяются по ${profile.combinationClause}.`
      : `Коэффициенты надёжности γf по видам нагрузок: древесина ${f.timber}, слои заводского изготовления ${f.layers} (табл. 7.1), полезная ${f.live} (п. 8.2.2), снег ${f.snow} (п. 10.12), ветер ${f.wind} (п. 11.1.12); благоприятная постоянная ${f.favourable}.`,
    `Основные сочетания (${profile.combinationClause}): постоянные + временные, ψ = 1,0 для основной, 0,9 для второй, 0,7 для остальных; каждая временная нагрузка поочерёдно принята основной, принята огибающая. Для отрыва — 0,9·G + 1,4·W. Прогибы проверяются по нормативным (нефакторизованным) нагрузкам.`,
  ];
}

/**
 * Project view for member modules that still read a single loads.gammaG /
 * loads.gammaQ pair and a raw loads.wind pressure (designer-mechanics,
 * wall-stability). gammaG/gammaQ become the larger factors of each family
 * (safe side) and wind becomes w0·k(ze), i.e. the pressure for c = 1,0, which
 * equals +0,8 external plus 0,2 internal on a stud wall.
 */
export function memberLoadProject(p, windInfo = null) {
  const f = loadFactors(p?.loads ?? {}),
    k = finite(windInfo?.k) ? windInfo.k : windK(5, windTerrain(p?.loads), loadProfile(p?.loads));
  return {
    ...p,
    loads: {
      ...p.loads,
      gammaG: f.equivalentG,
      gammaQ: f.equivalentQ,
      wind: (finite(p?.loads?.wind) ? p.loads.wind : 0) * k,
      windBasic: p?.loads?.wind,
      windK: k,
    },
  };
}

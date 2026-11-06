/**
 * Pure timber member/connection-bearing formulas of the default design profile
 * "СП 64.13330.2017 Деревянные конструкции" (актуализированная редакция СНиП II-25-80).
 *
 * Units: lengths m (l0, spans) or mm (b, h, bearing lengths) as named; forces kN;
 * moments kN·m; stresses MPa; masses kg/m²; frequencies Hz.
 *
 * Clause numbers: the formulas below are those of СНиП II-25-80, retained in
 * СП 64.13330.2017 section 7 ("Расчёт элементов деревянных конструкций"). Where the
 * 2017 edition renumbered clauses/tables and the text could not be re-checked
 * here, the СНиП II-25-80 number is quoted explicitly ("СНиП п. …") so the
 * reference stays traceable. Checks that СП 64 does not contain (creep factor
 * kdef, floor vibration, notch shear factor kv) are labelled as EN 1995-1-1.
 *
 * Material values Fb/Fc/Ft/Fv/Fc90 are DESIGN resistances R (расчётные
 * сопротивления), i.e. they already include the long-term strength factor m_дл
 * and are used directly: N/(φ·Rc·A) ≤ 1. Characteristic values such as C24
 * fm,k = 24 MPa must NOT be entered.
 */
const finite = (x) => typeof x === "number" && Number.isFinite(x);

export const designProfile = Object.freeze({
  id: "SP64-2017",
  title: "СП 64.13330.2017 (СНиП II-25-80), сосна/ель, нормальная влажность",
});

/** Design resistances, MPa, used when the project gives none. They equal the
 * former engine defaults and correspond approximately to pine/spruce grade 2
 * design values (СНиП II-25-80 табл. 3 / СП 64.13330.2017 R_A·m_дл).
 * Fc90 = 3.0 MPa: local bearing across the grain in support parts of structures
 * and nodal abutments (СНиП II-25-80 табл. 3 п. 4а, "смятие поперёк волокон местное
 * в опорных частях конструкций, лобовых врубках и узловых примыканиях"). */
export const designDefaults = Object.freeze({
  Fb: 13,
  Fc: 12,
  Ft: 8,
  Fv: 1.5,
  Fc90: 3,
  /** Compression/bearing across the grain over the whole area, MPa (СНиП табл. 3 п. 3).
   * Only the base value of the optional partial-length formula. */
  Fc90Full: 1.8,
});

/** λmax, СНиП II-25-80 табл. 14 (предельная гибкость элементов), retained in СП 64.13330.2017. */
export const lambdaLimits = Object.freeze({
  /** Сжатые пояса, опорные раскосы и опорные стойки ферм, колонны. */
  chord: 120,
  column: 120,
  supportStrut: 120,
  /** Прочие сжатые элементы ферм и других сквозных конструкций. */
  web: 150,
  /** Сжатые элементы связей. */
  bracing: 200,
});
export function lambdaLimit(kind) {
  return lambdaLimits[kind] ?? lambdaLimits.web;
}

/** Radius of gyration of a rectangle about the axis perpendicular to `d`, mm. */
export const radiusOfGyration = (d) => d / Math.sqrt(12);

/** λ = l0 / r, СНиП п. 4.4 ф. (9); l0 = l·μ0 with μ0 = 1 for pinned ends. */
export function slenderness(l0, d) {
  return (l0 * 1000) / radiusOfGyration(d);
}

/** Buckling coefficient φ, СНиП II-25-80 п. 4.3 ф. (7)–(8) / СП 64.13330.2017 п. 7.3:
 * λ ≤ 70: φ = 1 − a(λ/100)², a = 0.8 (wood); λ > 70: φ = A/λ², A = 3000 (wood).
 * The two branches meet within 0.7 % at λ = 70 (0.608 vs 0.612), as in the standard. */
export function bucklingCoefficient(lambda) {
  if (!finite(lambda) || lambda < 0) return NaN;
  return lambda <= 70 ? 1 - 0.8 * (lambda / 100) ** 2 : 3000 / lambda ** 2;
}

/**
 * Centrally compressed member, СНиП II-25-80 п. 4.2 ф. (5)–(6): N/(φ·Rc·Aрасч) ≤ 1,
 * checked about BOTH axes with their own effective lengths.
 * b = dimension in the direction of "weak" buckling, h = "strong" dimension, mm.
 * l0Strong: effective length for buckling about the strong axis (deflection along h), m.
 * l0Weak: effective length for buckling about the weak axis (deflection along b), m.
 * N: compression, kN (sign ignored). kind selects λmax.
 */
export function axialCompression({ N = 0, b, h, l0Strong, l0Weak, Fc, kind = "web", Anet }) {
  const A = b * h,
    Ar = finite(Anet) && Anet > 0 ? Anet : A,
    lambdaStrong = slenderness(l0Strong, h),
    lambdaWeak = slenderness(l0Weak, b),
    phiStrong = bucklingCoefficient(lambdaStrong),
    phiWeak = bucklingCoefficient(lambdaWeak),
    phi = Math.min(phiStrong, phiWeak),
    lambda = Math.max(lambdaStrong, lambdaWeak),
    limit = lambdaLimit(kind),
    crushing = (Fc * Ar) / 1000,
    capacity = Math.min(crushing, (phi * Fc * A) / 1000),
    force = Math.abs(N);
  return {
    method: "СП 64.13330.2017 / СНиП II-25-80 п. 4.2–4.3: N/(φ·Rc·A) ≤ 1",
    A,
    lambdaStrong,
    lambdaWeak,
    lambda,
    phiStrong,
    phiWeak,
    phi,
    governingAxis: phiWeak <= phiStrong ? "weak" : "strong",
    lambdaLimit: limit,
    slendernessUtilization: lambda / limit,
    crushing,
    capacity,
    utilization: capacity > 0 ? force / capacity : Infinity,
  };
}

/**
 * Compression with bending in the strong-axis plane, СНиП II-25-80 п. 4.17–4.18:
 *  strength ф. (28): N/Aрасч + Mд/Wрасч ≤ Rc, written dimensionless with Rc/Rи:
 *    N/(A·Fc) + Mд/(W·Fb) ≤ 1, Mд = M/ξ, ξ = 1 − N/(φ·Rc·Aбр) ф. (30),
 *    φ about the bending plane (strong axis, l0Bending);
 *  out-of-plane stability ф. (33): N/(φy·Rc·Aбр) + (Mд/(φм·Rи·Wбр))ⁿ ≤ 1,
 *    φy about the weak axis (l0Weak), φм = 140·b²/(lp·h)·kф ф. (23) with
 *    kф = 1.13 (parabolic moment of a uniformly loaded simple span, СНиП прил. 4
 *    табл. 2), capped at 1 (conservative); n = 2 without restraint of the
 *    tension edge, n = 1 with it.
 * The parabolic/sinusoidal moment of a hinged member is assumed (no kн correction).
 * N ≥ 0 compression kN, M kN·m (design, magnitude).
 */
export function compressionBending({
  N = 0,
  M = 0,
  b,
  h,
  l0Bending,
  l0Weak,
  lp,
  Fc,
  Fb,
  kind = "chord",
  tensionEdgeRestrained = false,
  kf = 1.13,
}) {
  const A = b * h,
    W = (b * h * h) / 6,
    force = Math.max(0, N),
    moment = Math.abs(M),
    axial = axialCompression({ N: force, b, h, l0Strong: l0Bending, l0Weak, Fc, kind }),
    xi = 1 - (force * 1000) / (axial.phiStrong * Fc * A),
    Md = xi > 0 ? moment / xi : Infinity,
    strength = (force * 1000) / (A * Fc) + (Md * 1e6) / (W * Fb),
    lpm = finite(lp) && lp > 0 ? lp : l0Weak,
    phiM = Math.min(1, ((140 * b * b) / (lpm * 1000 * h)) * kf),
    n = tensionEdgeRestrained ? 1 : 2,
    outOfPlane = (force * 1000) / (axial.phiWeak * Fc * A) + ((Md * 1e6) / (phiM * Fb * W)) ** n;
  return {
    method: "СНиП II-25-80 п. 4.17–4.18 (СП 64.13330.2017 разд. 7): Mд = M/ξ",
    ...axial,
    W,
    N: force,
    M: moment,
    xi,
    Md,
    bendingStress: (Md * 1e6) / W,
    axialStress: (force * 1000) / A,
    strengthUtilization: strength,
    phiM,
    lp: lpm,
    exponent: n,
    outOfPlaneUtilization: outOfPlane,
    utilization: Math.max(strength, outOfPlane),
  };
}

/**
 * Bearing (смятие) perpendicular to the grain. F kN, b mm (width), l mm (bearing
 * length along the grain of the loaded member). Limit Fc90 (default 3.0 MPa,
 * local bearing in support parts, СНиП табл. 3 п. 4а).
 * Optional partialLength: local bearing over part of the member length with
 * unloaded lengths ≥ bearing length and ≥ thickness, СНиП II-25-80 п. 3.1
 * прим. ф. (2) (retained in СП 64.13330.2017):
 *   Rсм90 = Rс90·(1 + 8/(lсм + 1.2)), lсм in cm, Rс90 = Fc90Full (1.8 MPa).
 */
export function bearingPerpendicular({
  F = 0,
  b,
  l,
  Fc90 = designDefaults.Fc90,
  partialLength = false,
  Fc90Full = designDefaults.Fc90Full,
}) {
  const area = b * l,
    stress = area > 0 ? (Math.abs(F) * 1000) / area : Infinity,
    partialLimit = Fc90Full * (1 + 8 / (l / 10 + 1.2)),
    limit = partialLength ? partialLimit : Fc90;
  return {
    method: partialLength
      ? "СНиП II-25-80 ф. (2): Rсм90 = Rс90(1 + 8/(lсм + 1.2))"
      : "σсм90 = F/(b·l) ≤ Rсм90 (СНиП табл. 3 п. 4а)",
    force: Math.abs(F),
    area,
    bearingLength: l,
    width: b,
    stress,
    limit,
    partialLength,
    utilization: limit > 0 ? stress / limit : Infinity,
  };
}

/** Creep/final deflection, EN 1995-1-1 §2.2.3 ф. (2.3)–(2.4) with kdef (табл. 3.2:
 * 0.6 solid timber, service class 1; 0.8 class 2): w_fin = w_G(1+kdef) + w_Q(1+ψ2·kdef).
 * СП 64.13330.2017 has no explicit kdef; this is the documented substitute. */
export const creepDefaults = Object.freeze({ kdef: 0.6, psi2: 0.3, finalDeflectionRatio: 250 });
export function finalDeflection({ wG = 0, wQ = 0, kdef = creepDefaults.kdef, psi2 = creepDefaults.psi2 }) {
  return {
    method: "EN 1995-1-1 2.2.3: w_fin = w_G(1+kdef) + w_Q(1+ψ2·kdef)",
    instantaneous: wG + wQ,
    creepG: wG * kdef,
    creepQ: wQ * psi2 * kdef,
    final: wG * (1 + kdef) + wQ * (1 + psi2 * kdef),
    kdef,
    psi2,
  };
}

/** Fundamental frequency of a simply supported floor, EN 1995-1-1 §7.3.3 ф. (7.5):
 * f1 = π/(2L²)·√((EI)_l / m), (EI)_l in N·m²/m (per metre width), m in kg/m².
 * СП 64.13330.2017 has no vibration criterion: recommended check, f1 ≥ 8 Hz → warning. */
export function floorFrequency({ span, E, b, h, spacing, mass }) {
  const EI = (E * 1e6 * ((b * h ** 3) / 12) * 1e-12) / spacing;
  return {
    method: "EN 1995-1-1 7.3.3 ф. (7.5)",
    EI,
    mass,
    frequency: (Math.PI / (2 * span * span)) * Math.sqrt(EI / mass),
    limit: 8,
  };
}

/** Shear at a notched support on the supported side (birdsmouth), EN 1995-1-1 §6.5.2
 * ф. (6.62): τ = 1.5V/(b·hef) ≤ kv·fv,
 * kv = min(1, kn(1 + 1.1 i^1.5/√h) / (√h (√(α(1−α)) + 0.8 (x/h)√(1/α − α²)))),
 * kn = 5 (solid timber), α = hef/h, x = reaction-to-notch-corner distance (mm),
 * i = notch slope (0 for a square seat). СП 64 gives no explicit factor here. */
export function notchedShear({ V, b, h, hef, x = 0, i = 0, Fv, kn = 5 }) {
  const alpha = Math.min(1, hef / h);
  const kv =
    alpha >= 1
      ? 1
      : Math.min(
          1,
          (kn * (1 + (1.1 * i ** 1.5) / Math.sqrt(h))) /
            (Math.sqrt(h) *
              (Math.sqrt(alpha * (1 - alpha)) + 0.8 * (x / h) * Math.sqrt(1 / alpha - alpha ** 2))),
        );
  const stress = (1.5 * Math.abs(V) * 1000) / (b * hef);
  return {
    method: "EN 1995-1-1 6.5.2: τ = 1.5V/(b·hef) ≤ kv·fv",
    alpha,
    kv,
    stress,
    limit: kv * Fv,
    utilization: stress / (kv * Fv),
  };
}

/** Validate/describe the material basis. Returns {values, warnings, errors, check}. */
export function resolveTimberMaterial(material = {}) {
  const m = material ?? {},
    errors = [],
    warnings = [];
  const values = {
    Fb: m.Fb ?? designDefaults.Fb,
    Fc: m.Fc ?? designDefaults.Fc,
    Ft: m.Ft ?? designDefaults.Ft,
    Fv: m.Fv ?? designDefaults.Fv,
    Fc90: m.Fc90 ?? designDefaults.Fc90,
    Fc90Full: m.Fc90Full ?? designDefaults.Fc90Full,
  };
  for (const [k, v] of Object.entries(values))
    if (!finite(v) || v <= 0 || v > 60) errors.push(`material.${k}: расчётное сопротивление 0…60 МПа.`);
  if (m.grade !== undefined && !["1", "2", "3"].includes(String(m.grade)))
    errors.push('material.grade: "1", "2" или "3" (сосна/ель).');
  let gradeNote = null;
  if (m.grade !== undefined && String(m.grade) === "2")
    gradeNote =
      "Сорт 2: используются расчётные значения по умолчанию Fb 13 / Fc 12 / Ft 8 / Fv 1.5 / Fc90 3.0 МПа (≈ сосна/ель 2 сорта с m_дл, СНиП II-25-80 табл. 3 / СП 64.13330.2017).";
  else if (m.grade !== undefined && ["1", "3"].includes(String(m.grade)))
    warnings.push(
      `Сорт ${m.grade}: табличные расчётные сопротивления СП 64.13330.2017 (R_A·m_дл) в движке не сверены и автоматически не подставляются. Используются введённые/по умолчанию Fb/Fc/Ft/Fv/Fc90 — задайте их явно по таблице сорта.`,
    );
  if (values.Fb > 20 || values.Fc > 18 || values.Ft > 14)
    warnings.push(
      "Fb/Fc/Ft выше типичных расчётных сопротивлений цельной хвойной древесины по СП 64 (≈13–14 МПа): возможно, введены характеристические значения (например C24 fm,k = 24 МПа). Нужны РАСЧЁТНЫЕ значения с m_дл.",
    );
  return {
    values,
    grade: m.grade === undefined ? null : String(m.grade),
    gradeNote,
    errors,
    warnings,
    check: {
      id: "material-design-basis",
      label: "Материал: расчётные сопротивления по СП 64.13330.2017",
      status: errors.length ? "fail" : warnings.length ? "warning" : "pass",
      value: values.Fb,
      limit: 20,
      unit: "МПа",
      note: [
        "Fb/Fc/Ft/Fv/Fc90 — расчётные сопротивления R с уже учтённым m_дл, не характеристические.",
        gradeNote,
        ...warnings,
        ...errors,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

export const timberDesignAssumptions = [
  "Профиль норм по умолчанию — СП 64.13330.2017 (СНиП II-25-80). material.Fb/Fc/Ft/Fv/Fc90 — РАСЧЁТНЫЕ сопротивления R, уже включающие коэффициент длительной прочности m_дл (по умолчанию 13/12/8/1.5/3.0 МПа ≈ сосна/ель 2 сорта). Не вводите характеристические значения (например C24 fm,k = 24 МПа): запас будет занижен примерно вдвое.",
  "Сжатые элементы: N/(φ·Rc·A) ≤ 1 по обеим осям со своими расчётными длинами, φ = 1 − 0.8(λ/100)² при λ ≤ 70 и φ = 3000/λ² при λ > 70; предельная гибкость 120 (пояса, колонны, стойки, опорные элементы), 150 (прочие элементы решётки), 200 (связи) по СНиП II-25-80 табл. 14. Идеальный Euler больше не используется как несущая способность.",
  "Сжато-изгибаемые элементы: N/(A·Rc) + Mд/(W·Rи) ≤ 1, Mд = M/ξ, ξ = 1 − N/(φ·Rc·A), φ в плоскости изгиба; устойчивость из плоскости N/(φy·Rc·A) + (Mд/(φм·Rи·W))² ≤ 1 (СНиП II-25-80 п. 4.17–4.18).",
  "Смятие поперёк волокон: σ = F/(b·l) ≤ Rсм90 = material.Fc90 (по умолчанию 3.0 МПа, опорные части и узловые примыкания). material.Fc90PartialLength = true включает формулу местного смятия на части длины Rс90(1 + 8/(lсм + 1.2)) для обвязки под стойкой.",
];

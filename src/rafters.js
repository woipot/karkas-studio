/** Sloping simply supported timber beam under uniform VERTICAL gravity loads.
 * Geometry m; b/h mm; E and strengths MPa; line loads kN/m, deflection mm.
 */
const G = 9.80665;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const rafterDefaults = {
  horizontalSpan: 4,
  pitch: 25,
  b: 50,
  h: 150,
  spacing: 0.6,
  roofDead: 0.5,
  snow: 1.5,
  mu: 0.8,
  E: 10000,
  Fb: 13,
  Fv: 1.5,
  Ft: 8,
  Fc: 12,
  density: 500,
  gammaG: 1.1,
  gammaQ: 1.4,
  deflectionRatio: 300,
  overhangLow: 0,
  overhangHigh: 0,
};
export const defaultRafterSections = [
  "40x150",
  "45x150",
  "50x150",
  "40x200",
  "45x200",
  "50x200",
  "45x250",
  "50x250",
];
export const rafterSources = [
  {
    title: "AWC · Tutorial: horizontal rafter span, loads and bearing",
    url: "https://awc.org/resource-hub/span-table-tutorial/",
  },
  {
    title: "AWC · 2024 Span Tables, Appendix A beam equations",
    url: "https://web-media.awc.org/wp-content/uploads/2023/11/17210157/AWC_STJR2024_20231127_AWCWebsite.pdf",
  },
  {
    title: "University of Illinois · Axial loading",
    url: "https://mechref.engr.illinois.edu/sol/axial.html",
  },
];
const assumptions = [
  "Отдельная стропильная доска, не ферма: постоянное прямоугольное сечение, две шарнирные опоры без промежуточных опор и консолей, равномерная вертикальная нагрузка. Расчёт малых упругих перемещений первого порядка.",
  "horizontalSpan — горизонтальный пролёт между расчётными опорами, а L=horizontalSpan/cos(α) — длина по скату. Фактические длины опирания, запилы и стыки должны задаваться отдельно; шестиметровая заготовка не создаёт опору.",
  "Вес слоёв roofDead задан на фактическую площадь ската БЕЗ стропильной древесины: qD=roofDead×spacing+ρ×b×h×g. Снег snow×μ задан на горизонтальную проекцию: qS=snow×μ×spacing×cos(α). Все q сначала действуют вертикально на единицу длины по скату.",
  "Поперечная составляющая q⊥=qvertical×cos(α); продольная составляющая вниз по скату q∥=qvertical×sin(α). Вертикальные реакции обеих опор qvertical×L/2, глобальный горизонтальный распор в этой идеальной схеме равен нулю.",
  "При вертикальных реакциях продольная сила переменна: N(s)=q∥×(s−L/2). Сжатие у нижней опоры, растяжение у верхней; максимум |N|=q∥L/2. Схема не описывает пару стропил с распорным коньком или неизвестным защемлением.",
  "Проверка взаимодействия — прозрачный предварительный линейный критерий |σN|/Fc,t + |σM|/Fb по совпадающим сечениям N(s),M(s), а не полный нормативный расчёт деревянного изгибаемо-сжатого элемента.",
  "Прогиб мгновенный от полной эксплуатационной нагрузки, без ползучести и податливости опор. Вертикальный прогиб включает нормальный изгиб и осевую деформацию. Введённый предел — horizontalSpan/deflectionRatio; он не выбран автоматически по нормам или виду потолка.",
  "Смятие на опорах, длина/возможность опирания, наклонная площадка, вырезы, крепёж, устойчивость из плоскости и раскрепление сжатой кромки не проверены. Ветер, отрыв, заносы и несимметричные случаи снега не входят в эту модель.",
  "capacityPass относится только к показанным расчётам напряжения и прогиба. Он не подтверждает безопасность крыши. Если пределы превышены, возможны большее сечение, меньший шаг, реальная промежуточная опора или отдельная ферма; ферма не назначается обязательной по одному значению пролёта.",
];

export function calculateRafter(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return {
      valid: false,
      status: "fail",
      capacityPass: false,
      errors: ["Параметры стропильной доски должны быть объектом."],
      warnings: [],
      checks: [],
      assumptions: [...assumptions],
      sources: rafterSources,
    };
  const p = {
    ...rafterDefaults,
    ...input,
    horizontalSpan: input.horizontalSpan ?? input.span ?? rafterDefaults.horizontalSpan,
    density: input.density ?? input.timberDensity ?? rafterDefaults.density,
    Fb: input.Fb ?? input.bendingDesign ?? rafterDefaults.Fb,
    Fv: input.Fv ?? input.shearDesign ?? rafterDefaults.Fv,
    Ft: input.Ft ?? input.tensionDesign ?? rafterDefaults.Ft,
    Fc: input.Fc ?? input.compressionDesign ?? rafterDefaults.Fc,
  };
  const errors = [],
    warnings = [];
  const bounds = {
    horizontalSpan: [0.1, 60],
    b: [15, 300],
    h: [40, 1000],
    spacing: [0.1, 3],
    roofDead: [0, 30],
    snow: [0, 30],
    mu: [0, 3],
    E: [1000, 50000],
    Fb: [0.1, 100],
    Fv: [0.1, 30],
    Ft: [0.1, 100],
    Fc: [0.1, 100],
    density: [100, 1500],
    gammaG: [1, 2],
    gammaQ: [1, 3],
    deflectionRatio: [100, 600],
  };
  for (const [k, [a, b]] of Object.entries(bounds))
    if (!finite(p[k]) || p[k] < a || p[k] > b) errors.push(`${k}: требуется число от ${a} до ${b}.`);
  for (const key of ["overhangLow", "overhangHigh"])
    if (!finite(p[key]) || p[key] < 0 || p[key] > 2) errors.push(`${key}: горизонтальный свес от0 до2м.`);
  if (p.h < p.b) errors.push("Высота h должна быть не меньше ширины b: задана сильная ось изгиба.");
  if (input.rise !== undefined) {
    if (!finite(input.rise) || input.rise < 0)
      errors.push("rise: требуется конечный неотрицательный перепад.");
    else {
      p.pitch = (Math.atan2(input.rise, p.horizontalSpan) * 180) / Math.PI;
      if (input.pitch !== undefined && finite(input.pitch) && Math.abs(p.pitch - input.pitch) > 0.05)
        warnings.push("Перепад rise имеет приоритет над pitch; угол рассчитан из фактической геометрии.");
    }
  }
  if (!finite(p.pitch) || p.pitch < 0 || p.pitch > 70)
    errors.push("Уклон: задайте угол 0…70° или соответствующий перепад rise.");
  const result = {
    input: p,
    errors,
    warnings,
    valid: errors.length === 0,
    status: "fail",
    capacityPass: false,
    checks: [],
    assumptions: [...assumptions],
    sources: rafterSources,
  };
  if (errors.length) return result;
  const alpha = (p.pitch * Math.PI) / 180,
    c = Math.cos(alpha),
    s = Math.sin(alpha),
    A = p.b * p.h,
    I = (p.b * p.h ** 3) / 12,
    Z = (p.b * p.h ** 2) / 6;
  const timberAxis = (((p.density * A) / 1e6) * G) / 1000,
    roofDeadAxis = p.roofDead * p.spacing,
    snowAxis = p.snow * p.mu * p.spacing * c;
  const deadAxis = roofDeadAxis + timberAxis,
    qV = deadAxis + snowAxis,
    qVD = deadAxis * p.gammaG + snowAxis * p.gammaQ;
  const qN = qV * c,
    qND = qVD * c,
    qA = qV * s,
    qAD = qVD * s;
  if (p.overhangLow > 0 || p.overhangHigh > 0)
    return calculateOverhangRafter(p, result, {
      c,
      s,
      A,
      I,
      Z,
      timberAxis,
      roofDeadAxis,
      snowAxis,
      deadAxis,
      qV,
      qVD,
      qN,
      qND,
      qA,
      qAD,
    });
  function interaction(L, F) {
    const C = (qND * L ** 2) / (2 * Z * p.Fb),
      D = (qAD * L) / (A * F),
      x = C > 0 ? clamp((1 - D / C) / 2, 0, 0.5) : 0;
    return {
      utilization: C * x * (1 - x) + D * (0.5 - x),
      fraction: x,
      moment: (qND * L ** 2 * x * (1 - x)) / 2 / 1e6,
      axial: (qAD * L * (0.5 - x)) / 1000,
    };
  }
  function evaluate(span) {
    const L = (span / c) * 1000,
      M = (qND * L ** 2) / 8 / 1e6,
      V = (qND * L) / 2 / 1000,
      N = (qAD * L) / 2 / 1000;
    const stress = (M * 1e6) / Z,
      shearStress = (1.5 * V * 1000) / A,
      normalDeflection = (5 * qN * L ** 4) / (384 * p.E * I),
      axialDisplacement = (qA * L ** 2) / (8 * p.E * A),
      verticalDeflection = normalDeflection * c + axialDisplacement * s;
    const compression = interaction(L, p.Fc),
      tension = interaction(L, p.Ft),
      interactionUtilization = Math.max(compression.utilization, tension.utilization);
    const bendingUtilization = stress / p.Fb,
      shearUtilization = shearStress / p.Fv,
      compressionUtilization = (N * 1000) / (A * p.Fc),
      tensionUtilization = (N * 1000) / (A * p.Ft),
      deflectionAllowed = (span * 1000) / p.deflectionRatio,
      deflectionUtilization = verticalDeflection / deflectionAllowed;
    const utilization = Math.max(
      bendingUtilization,
      shearUtilization,
      compressionUtilization,
      tensionUtilization,
      interactionUtilization,
      deflectionUtilization,
    );
    return {
      slopeLength: L / 1000,
      moment: M,
      shear: V,
      axialMax: N,
      stress,
      shearStress,
      normalDeflection,
      verticalDeflection,
      axialDisplacement,
      deflectionAllowed,
      normalDeflectionAllowed: L / p.deflectionRatio,
      bendingUtilization,
      shearUtilization,
      compressionUtilization,
      tensionUtilization,
      interactionUtilization,
      deflectionUtilization,
      utilization,
      compressionInteraction: compression,
      tensionInteraction: tension,
    };
  }
  const e = evaluate(p.horizontalSpan),
    L = e.slopeLength,
    vertical = (qVD * L) / 2;
  let lo = 0,
    hi = Math.max(1, p.horizontalSpan);
  while (evaluate(hi).utilization <= 1 && hi < 1000) hi *= 2;
  for (let i = 0; i < 65; i++) {
    const mid = (lo + hi) / 2;
    if (evaluate(mid).utilization <= 1) lo = mid;
    else hi = mid;
  }
  const maxSpan = lo,
    reactions = {
      verticalA: vertical,
      verticalB: vertical,
      horizontalA: 0,
      horizontalB: 0,
      normalA: vertical * c,
      normalB: vertical * c,
      axialA: vertical * s,
      axialB: vertical * s,
      serviceVerticalA: (qV * L) / 2,
      serviceVerticalB: (qV * L) / 2,
    };
  const loads = {
    roofDeadAxis,
    timberAxis,
    snowAxis,
    deadAxis,
    verticalService: qV,
    verticalDesign: qVD,
    normalService: qN,
    normalDesign: qND,
    axialService: qA,
    axialDesign: qAD,
    signedAxialService: -qA,
    signedAxialDesign: -qAD,
    totalService: qV * L,
    totalDesign: qVD * L,
    roofLayersWeight: roofDeadAxis * L,
    timberWeight: timberAxis * L,
    snowWeight: snowAxis * L,
  };
  const checks = [
    {
      id: "rafter-bending",
      label: "Изгиб стропильной доски",
      value: e.stress,
      limit: p.Fb,
      unit: "МПа",
      utilization: e.bendingUtilization,
    },
    {
      id: "rafter-shear",
      label: "Сдвиг стропильной доски",
      value: e.shearStress,
      limit: p.Fv,
      unit: "МПа",
      utilization: e.shearUtilization,
    },
    {
      id: "rafter-compression",
      label: "Продольное сжатие",
      value: (e.axialMax * 1000) / A,
      limit: p.Fc,
      unit: "МПа",
      utilization: e.compressionUtilization,
    },
    {
      id: "rafter-tension",
      label: "Продольное растяжение",
      value: (e.axialMax * 1000) / A,
      limit: p.Ft,
      unit: "МПа",
      utilization: e.tensionUtilization,
    },
    {
      id: "rafter-interaction",
      label: "Изгиб с продольной силой · предварительный критерий",
      value: e.interactionUtilization,
      limit: 1,
      unit: "доля",
      utilization: e.interactionUtilization,
    },
    {
      id: "rafter-deflection",
      label: `Вертикальный прогиб · горизонтальный пролёт / ${p.deflectionRatio}`,
      value: e.verticalDeflection,
      limit: e.deflectionAllowed,
      unit: "мм",
      utilization: e.deflectionUtilization,
    },
  ].map((check) => ({ ...check, status: check.utilization > 1 ? "fail" : "pass" }));
  checks.push(
    {
      id: "rafter-bearing",
      label: "Реальные опоры, опорная площадка и крепёж",
      status: "unverified",
      note: "Наличие опор и их смятие не задано. Доска не считается опёртой только по совпадению координат.",
    },
    {
      id: "rafter-lateral",
      label: "Боковая устойчивость и раскрепление",
      status: "unverified",
      note: "Устойчивость из плоскости и закрепление сжатой кромки не проверены.",
    },
    { id: "rafter-wind", label: "Ветер, отрыв и особые снеговые случаи", status: "unverified" },
  );
  const capacityPass = e.utilization <= 1;
  const diagrams = Array.from({ length: 17 }, (_, i) => {
    const x = i / 16,
      l = L * 1000,
      station = x * l,
      normal = (qN * station * (l ** 3 - 2 * l * station ** 2 + station ** 3)) / (24 * p.E * I),
      u = (qA * (station ** 2 - l * station)) / (2 * p.E * A);
    return {
      fraction: x,
      s: station / 1000,
      horizontal: p.horizontalSpan * x,
      N: (qAD * (station - l / 2)) / 1000,
      V: (qND * (l / 2 - station)) / 1000,
      M: (qND * station * (l - station)) / 2 / 1e6,
      normalDeflection: normal,
      verticalDeflection: normal * c - u * s,
      axialDisplacement: u,
    };
  });
  return {
    ...result,
    ...e,
    valid: true,
    status: capacityPass ? "warning" : "fail",
    capacityPass,
    horizontalSpan: p.horizontalSpan,
    span: p.horizontalSpan,
    rise: p.horizontalSpan * Math.tan(alpha),
    pitch: p.pitch,
    b: p.b,
    h: p.h,
    section: `${p.b}x${p.h}`,
    spacing: p.spacing,
    E: p.E,
    Fb: p.Fb,
    Fv: p.Fv,
    Ft: p.Ft,
    Fc: p.Fc,
    density: p.density,
    deflectionRatio: p.deflectionRatio,
    A,
    I,
    Z,
    loads,
    reactions,
    maxSpan,
    maxSlopeLength: maxSpan / c,
    maxSpanBasis:
      "Горизонтальный пролёт при фиксированном уклоне, сечении, шаге и заданных свойствах; без подтверждения опор и LTB.",
    deflectionBasis: "Вертикальное перемещение / (горизонтальный пролёт ÷ deflectionRatio)",
    deflection: e.verticalDeflection,
    lineLoadService: qN,
    lineLoadDesign: qND,
    axial: {
      left: -e.axialMax,
      right: e.axialMax,
      maxCompression: e.axialMax,
      maxTension: e.axialMax,
      serviceMidShortening: e.axialDisplacement,
    },
    bending: { stress: e.stress, limit: p.Fb, utilization: e.bendingUtilization },
    shearCheck: { stress: e.shearStress, limit: p.Fv, utilization: e.shearUtilization },
    interaction: {
      compression: { ...e.compressionInteraction, location: e.compressionInteraction.fraction * L },
      tension: { ...e.tensionInteraction, location: (1 - e.tensionInteraction.fraction) * L },
      utilization: e.interactionUtilization,
      note: "Линейный предварительный критерий по совпадающим сечениям, без нормативной кривой устойчивости.",
    },
    mass: ((p.density * A) / 1e6) * L,
    volume: (A / 1e6) * L,
    checks,
    diagrams,
    recommendations: capacityPass
      ? []
      : [
          "Увеличить высоту или ширину сечения с повторным расчётом.",
          "Уменьшить фактический шаг стропил с повторным расчётом.",
          "Предусмотреть реальную промежуточную опору и проверить новый путь передачи нагрузки.",
          "Сравнить отдельную ферму как вариант конструктивной схемы.",
        ],
  };
}

const uniqueStations = (xs) =>
  xs.sort((a, b) => a - b).filter((v, i, a) => !i || Math.abs(v - a[i - 1]) > 1e-9);
function quadraticRoots(A, B, C) {
  if (Math.abs(A) < 1e-14) return Math.abs(B) > 1e-14 ? [-C / B] : [];
  const D = B * B - 4 * A * C;
  return D >= -1e-12
    ? [(-B - Math.sqrt(Math.max(0, D))) / (2 * A), (-B + Math.sqrt(Math.max(0, D))) / (2 * A)]
    : [];
}

/** Uniformly loaded elastic beam, with two actual supports inside its ends.
 * m, kN/m, E MPa, I mm4. Signed reactions/moments are never clamped.
 */
export function solveUniformOverhangBeam({
  length: L,
  supportA: a,
  supportB: b,
  qService: qS,
  qDesign: qD,
  E,
  I,
  pointLoads = [],
}) {
  if (
    ![L, a, b, qS, qD, E, I].every(finite) ||
    L <= 0 ||
    a < 0 ||
    b > L ||
    b - a <= 1e-8 ||
    qS < 0 ||
    qD < 0 ||
    E <= 0 ||
    I <= 0
  )
    throw new Error("Некорректная балка с консолями.");
  if (
    !Array.isArray(pointLoads) ||
    pointLoads.some(
      (q) =>
        !q ||
        ![q.s, q.service, q.design].every(finite) ||
        q.s < 0 ||
        q.s > L ||
        q.service < 0 ||
        q.design < 0,
    )
  )
    throw new Error("Некорректная сосредоточенная нагрузка.");
  const totalD = qD * L + pointLoads.reduce((s, q) => s + q.design, 0),
    totalS = qS * L + pointLoads.reduce((s, q) => s + q.service, 0),
    RB = (qD * L * (L / 2 - a) + pointLoads.reduce((s, q) => s + q.design * (q.s - a), 0)) / (b - a),
    RA = totalD - RB,
    sRB = (qS * L * (L / 2 - a) + pointLoads.reduce((s, q) => s + q.service * (q.s - a), 0)) / (b - a),
    sRA = totalS - sRB,
    EI = E * I * 1e-9;
  const F = (x) =>
      (sRA * Math.max(0, x - a) ** 3) / 6 +
      (sRB * Math.max(0, x - b) ** 3) / 6 -
      (qS * x ** 4) / 24 -
      pointLoads.reduce((s, q) => s + (q.service * Math.max(0, x - q.s) ** 3) / 6, 0),
    C1 = (F(a) - F(b)) / (b - a),
    C2 = -F(a) - C1 * a;
  const at = (x, side = "right") => {
    const H = (t) => (x > t || (x === t && side === "right") ? 1 : 0);
    return {
      s: x,
      moment:
        RA * Math.max(0, x - a) +
        RB * Math.max(0, x - b) -
        (qD * x * x) / 2 -
        pointLoads.reduce((s, q) => s + q.design * Math.max(0, x - q.s), 0),
      shear: RA * H(a) + RB * H(b) - qD * x - pointLoads.reduce((s, q) => s + q.design * H(q.s), 0),
      deflection: (-(F(x) + C1 * x + C2) / EI) * 1000,
      slope:
        (-(
          (sRA * Math.max(0, x - a) ** 2) / 2 +
          (sRB * Math.max(0, x - b) ** 2) / 2 -
          (qS * x ** 3) / 6 -
          pointLoads.reduce((s, q) => s + (q.service * Math.max(0, x - q.s) ** 2) / 2, 0) +
          C1
        ) /
          EI) *
        1000,
    };
  };
  const edges = uniqueStations([0, a, b, L, ...pointLoads.map((q) => q.s)]),
    momentStations = [...edges],
    deflectionStations = [...edges],
    momentRoots = [];
  for (let i = 1; i < edges.length; i++) {
    const lo = edges[i - 1],
      hi = edges[i],
      mid = (lo + hi) / 2,
      active = pointLoads.filter((q) => q.s < mid),
      rd = (mid > a ? RA : 0) + (mid > b ? RB : 0) - active.reduce((s, q) => s + q.design, 0),
      rs = (mid > a ? sRA : 0) + (mid > b ? sRB : 0) - active.reduce((s, q) => s + q.service, 0),
      constant =
        -(mid > a ? RA * a : 0) - (mid > b ? RB * b : 0) + active.reduce((s, q) => s + q.design * q.s, 0),
      sConstant =
        -(mid > a ? sRA * a : 0) - (mid > b ? sRB * b : 0) + active.reduce((s, q) => s + q.service * q.s, 0);
    if (qD > 0) {
      const v = rd / qD;
      if (v > lo && v < hi) momentStations.push(v);
      for (const x of quadraticRoots(-qD / 2, rd, constant)) if (x > lo && x < hi) momentRoots.push(x);
    }
    const monotone = uniqueStations([
      lo,
      hi,
      ...quadraticRoots(-qS / 2, rs, sConstant).filter((x) => x > lo && x < hi),
    ]);
    for (let j = 1; j < monotone.length; j++) {
      let x = monotone[j - 1],
        y = monotone[j],
        fx = at(x).slope,
        fy = at(y).slope;
      if (Math.abs(fx) < 1e-9) deflectionStations.push(x);
      if (Math.abs(fy) < 1e-9) deflectionStations.push(y);
      if (fx * fy >= 0) continue;
      for (let k = 0; k < 60; k++) {
        const m = (x + y) / 2,
          fm = at(m).slope;
        if (fx * fm <= 0) y = m;
        else {
          x = m;
          fx = fm;
        }
      }
      deflectionStations.push((x + y) / 2);
    }
  }
  const moments = momentStations.map((x) => at(x)),
    deflections = deflectionStations.map((x) => at(x)),
    worst = deflections.reduce((x, y) => (Math.abs(x.deflection) > Math.abs(y.deflection) ? x : y)),
    out = {
      reactionA: RA,
      reactionB: RB,
      serviceReactionA: sRA,
      serviceReactionB: sRB,
      totalDesign: totalD,
      totalService: totalS,
      momentPositive: Math.max(0, ...moments.map((q) => q.moment)),
      momentNegative: Math.min(0, ...moments.map((q) => q.moment)),
      maxMoment: Math.max(...moments.map((q) => Math.abs(q.moment))),
      maxShear: Math.max(...edges.flatMap((x) => [Math.abs(at(x, "left").shear), Math.abs(at(x).shear)])),
      maxDeflection: Math.abs(worst.deflection),
      deflectionStation: worst.s,
      stations: uniqueStations([...momentStations, ...deflectionStations]),
      momentRoots: uniqueStations(momentRoots),
      supportA: a,
      supportB: b,
      length: L,
    };
  Object.defineProperty(out, "at", { value: at, enumerable: false });
  return out;
}

function calculateOverhangRafter(p, result, k) {
  const { c, s, A, I, Z, qV, qVD, qN, qND, qA, qAD } = k,
    L = (p.horizontalSpan + p.overhangLow + p.overhangHigh) / c,
    a = p.overhangLow / c,
    b = (p.overhangLow + p.horizontalSpan) / c,
    span = b - a;
  const normal = solveUniformOverhangBeam({
      length: L,
      supportA: a,
      supportB: b,
      qService: qN,
      qDesign: qND,
      E: p.E,
      I,
    }),
    vertical = solveUniformOverhangBeam({
      length: L,
      supportA: a,
      supportB: b,
      qService: qV,
      qDesign: qVD,
      E: p.E,
      I,
    });
  const H = (x, pos, side) => (x > pos || (x === pos && side !== "left") ? 1 : 0),
    N = (x, side = "right") =>
      qAD * x - s * (vertical.reactionA * H(x, a, side) + vertical.reactionB * H(x, b, side)),
    EA = (p.E * A) / 1000;
  const rawU = (x) =>
      ((qA * x * x) / 2 -
        s *
          (vertical.serviceReactionA * Math.max(0, x - a) + vertical.serviceReactionB * Math.max(0, x - b))) /
      EA,
    uA = rawU(a),
    uB = rawU(b) - uA,
    u = (x) => rawU(x) - uA - (uB * (x - a)) / span;
  const axialPoints = [0, a, b, L];
  for (const [lo, hi] of [
    [0, a],
    [a, b],
    [b, L],
  ]) {
    if (hi <= lo) continue;
    const mid = (lo + hi) / 2,
      offset = s * ((mid > a ? vertical.serviceReactionA : 0) + (mid > b ? vertical.serviceReactionB : 0));
    if (qA > 0) {
      const x = ((EA * uB) / span + offset) / qA;
      if (x > lo && x < hi) axialPoints.push(x);
    }
  }
  const axialDeflection = Math.max(...axialPoints.map((x) => Math.abs(u(x)))) * 1000,
    verticalAt = (x) => normal.at(x).deflection * c - u(x) * 1000 * s,
    verticalDeflection = normal.maxDeflection * c + axialDeflection * s;
  const edges = uniqueStations([0, a, b, L]),
    candidates = [...edges, ...normal.stations, ...normal.momentRoots];
  for (let i = 1; i < edges.length; i++) {
    const lo = edges[i - 1],
      hi = edges[i],
      mid = (lo + hi) / 2,
      offset = s * ((mid > a ? vertical.reactionA : 0) + (mid > b ? vertical.reactionB : 0));
    if (qAD > 0) {
      const zero = offset / qAD;
      if (zero > lo && zero < hi) candidates.push(zero);
    }
  }
  const intervals = uniqueStations([...candidates]);
  for (let i = 1; i < intervals.length; i++) {
    const lo = intervals[i - 1],
      hi = intervals[i],
      mid = (lo + hi) / 2,
      n = N(mid),
      m = normal.at(mid).moment,
      signM = Math.sign(m),
      signN = Math.sign(n);
    if (!signM || !signN || qND === 0) continue;
    const F = n < 0 ? p.Fc : p.Ft,
      reaction = (mid > a ? normal.reactionA : 0) + (mid > b ? normal.reactionB : 0),
      target = (-signN * qAD * 1000 * Z * p.Fb) / (A * F * signM * 1e6),
      x = (reaction - target) / qND;
    if (x > lo && x < hi) candidates.push(x);
  }
  const states = candidates.flatMap((x) =>
      ["left", "right"].map((side) => {
        const n = N(x, side),
          m = normal.at(x).moment,
          bend = (Math.abs(m) * 1e6) / Z / p.Fb;
        return {
          s: x,
          N: n,
          M: m,
          bend,
          compression: bend + (Math.max(0, -n) * 1000) / A / p.Fc,
          tension: bend + (Math.max(0, n) * 1000) / A / p.Ft,
        };
      }),
    ),
    comp = states.reduce((x, y) => (x.compression > y.compression ? x : y)),
    tens = states.reduce((x, y) => (x.tension > y.tension ? x : y)),
    maxCompression = Math.max(0, ...states.map((x) => -x.N)),
    maxTension = Math.max(0, ...states.map((x) => x.N));
  const stress = (normal.maxMoment * 1e6) / Z,
    shearStress = (1.5 * normal.maxShear * 1000) / A,
    deflectionAllowed = (p.horizontalSpan * 1000) / p.deflectionRatio,
    lowDeflection = Math.abs(verticalAt(0)),
    highDeflection = Math.abs(verticalAt(L)),
    lowLimit = (p.overhangLow * 2000) / p.deflectionRatio,
    highLimit = (p.overhangHigh * 2000) / p.deflectionRatio;
  const bendingUtilization = stress / p.Fb,
    shearUtilization = shearStress / p.Fv,
    compressionUtilization = (maxCompression * 1000) / A / p.Fc,
    tensionUtilization = (maxTension * 1000) / A / p.Ft,
    interactionUtilization = Math.max(comp.compression, tens.tension),
    deflectionUtilization = verticalDeflection / deflectionAllowed,
    lowUtil = p.overhangLow ? lowDeflection / lowLimit : 0,
    highUtil = p.overhangHigh ? highDeflection / highLimit : 0,
    uplift = vertical.reactionA < -1e-8 || vertical.reactionB < -1e-8;
  const utilization = Math.max(
      bendingUtilization,
      shearUtilization,
      compressionUtilization,
      tensionUtilization,
      interactionUtilization,
      deflectionUtilization,
      lowUtil,
      highUtil,
    ),
    checks = [
      [
        "rafter-bending",
        "Изгиб, включая отрицательный момент на консолях",
        stress,
        p.Fb,
        bendingUtilization,
        "МПа",
      ],
      ["rafter-shear", "Сдвиг стропильной доски", shearStress, p.Fv, shearUtilization, "МПа"],
      [
        "rafter-compression",
        "Продольное сжатие",
        (maxCompression * 1000) / A,
        p.Fc,
        compressionUtilization,
        "МПа",
      ],
      ["rafter-tension", "Продольное растяжение", (maxTension * 1000) / A, p.Ft, tensionUtilization, "МПа"],
      [
        "rafter-interaction",
        "Изгиб с продольной силой · предварительный критерий",
        interactionUtilization,
        1,
        interactionUtilization,
        "доля",
      ],
      [
        "rafter-deflection",
        "Вертикальный прогиб · консервативная сумма компонент",
        verticalDeflection,
        deflectionAllowed,
        deflectionUtilization,
        "мм",
      ],
    ].map(([id, label, value, limit, utilization, unit]) => ({
      id,
      label,
      value,
      limit,
      utilization,
      unit,
      status: utilization > 1 ? "fail" : "pass",
    }));
  for (const [end, overhang, value, limit, u] of [
    ["low", p.overhangLow, lowDeflection, lowLimit, lowUtil],
    ["high", p.overhangHigh, highDeflection, highLimit, highUtil],
  ])
    if (overhang > 0)
      checks.push({
        id: "rafter-overhang-" + end,
        label: "Прогиб свободного конца " + end,
        value,
        limit,
        unit: "мм",
        utilization: u,
        status: u > 1 ? "fail" : "pass",
        note: "Частный критерий 2×горизонтальный свес / deflectionRatio.",
      });
  checks.push(
    {
      id: "rafter-overhang-uplift",
      label: "Знак реакций реальных опор",
      status: uplift ? "fail" : "pass",
      note: uplift
        ? "Есть отрыв: схема без рассчитанного удерживающего узла не принята."
        : "Вертикальные реакции приложены в прежних стеновых опорах; свободные концы не считаются опорами.",
    },
    { id: "rafter-bearing", label: "Опирание, запилы и крепёж консолей", status: "unverified" },
    { id: "rafter-lateral", label: "Боковая устойчивость и раскрепление", status: "unverified" },
    { id: "rafter-wind", label: "Ветер и отрыв", status: "unverified" },
  );
  const loads = {
    roofDeadAxis: k.roofDeadAxis,
    timberAxis: k.timberAxis,
    snowAxis: k.snowAxis,
    deadAxis: k.deadAxis,
    verticalService: qV,
    verticalDesign: qVD,
    normalService: qN,
    normalDesign: qND,
    axialService: qA,
    axialDesign: qAD,
    totalService: qV * L,
    totalDesign: qVD * L,
    roofLayersWeight: k.roofDeadAxis * L,
    timberWeight: k.timberAxis * L,
    snowWeight: k.snowAxis * L,
  };
  const reactions = {
    verticalA: vertical.reactionA,
    verticalB: vertical.reactionB,
    serviceVerticalA: vertical.serviceReactionA,
    serviceVerticalB: vertical.serviceReactionB,
    horizontalA: 0,
    horizontalB: 0,
    normalA: normal.reactionA,
    normalB: normal.reactionB,
    axialA: vertical.reactionA * s,
    axialB: vertical.reactionB * s,
  };
  const diagrams = uniqueStations([
      ...Array.from({ length: 33 }, (_, i) => (L * i) / 32),
      ...normal.stations,
      a,
      b,
    ]).map((x) => ({
      fraction: x / L,
      s: x,
      horizontal: x * c - p.overhangLow,
      N: N(x),
      V: normal.at(x).shear,
      M: normal.at(x).moment,
      normalDeflection: normal.at(x).deflection,
      verticalDeflection: verticalAt(x),
      axialDisplacement: u(x) * 1000,
    })),
    capacityPass = utilization <= 1 && !uplift;
  return {
    ...result,
    valid: true,
    status: capacityPass ? "warning" : "fail",
    capacityPass,
    assumptions: [
      ...assumptions
        .slice(1)
        .filter(
          (x) =>
            !x.startsWith("При вертикальных реакциях") &&
            !x.startsWith("Поперечная составляющая") &&
            !x.startsWith("horizontalSpan"),
        ),
      "horizontalSpan — расстояние между стеновыми опорами; полная длина по скату (horizontalSpan+overhangLow+overhangHigh)/cos(α). Свесы введены в горизонтальной проекции.",
      "Балка имеет два реальных стеновых опирания внутри полной доски; равномерная нагрузка действует и на консоли. Реакции и отрицательные моменты определены из равновесия без фиктивных карнизных опор.",
      "Поперечная нагрузка q⊥=qvertical×cos(α), продольная q∥=qvertical×sin(α). Вертикальные реакции неравны при несимметричных свесах; их сумма равна полной нагрузке доски.",
      "Прогиб получен интегрированием EI·v″=M с вертикальной совместностью на опорах. Проверка максимума использует консервативную сумму максимумов нормальной и осевой компонент относительно хорды опор; эпюра показывает совпадающие вертикальные перемещения.",
      "Обратный поиск максимального пролёта с неизменными консолями не выполняется: зависимость может быть немонотонной.",
    ],
    horizontalSpan: p.horizontalSpan,
    span: p.horizontalSpan,
    rise: p.horizontalSpan * Math.tan((p.pitch * Math.PI) / 180),
    pitch: p.pitch,
    b: p.b,
    h: p.h,
    section: `${p.b}x${p.h}`,
    spacing: p.spacing,
    E: p.E,
    Fb: p.Fb,
    Fv: p.Fv,
    Ft: p.Ft,
    Fc: p.Fc,
    density: p.density,
    deflectionRatio: p.deflectionRatio,
    A,
    I,
    Z,
    slopeLength: L,
    overhangLow: p.overhangLow,
    overhangHigh: p.overhangHigh,
    supportLowStation: a,
    supportHighStation: b,
    moment: normal.maxMoment,
    momentNegative: normal.momentNegative,
    momentPositive: normal.momentPositive,
    shear: normal.maxShear,
    axialMax: Math.max(maxCompression, maxTension),
    stress,
    shearStress,
    normalDeflection: normal.maxDeflection,
    verticalDeflection,
    axialDisplacement: axialDeflection,
    deflection: verticalDeflection,
    deflectionAllowed,
    deflectionUtilization,
    bendingUtilization,
    shearUtilization,
    compressionUtilization,
    tensionUtilization,
    interactionUtilization,
    utilization,
    loads,
    reactions,
    maxSpan: null,
    maxSlopeLength: null,
    maxSpanBasis: "Для фиксированных консолей не задан монотонный обратный поиск.",
    deflectionBasis: "Консервативная сумма компонент / горизонтальный опорный пролёт",
    axial: { left: N(a), right: N(b, "left"), maxCompression, maxTension },
    bending: { stress, limit: p.Fb, utilization: bendingUtilization },
    shearCheck: { stress: shearStress, limit: p.Fv, utilization: shearUtilization },
    interaction: {
      compression: { utilization: comp.compression, location: comp.s },
      tension: { utilization: tens.tension, location: tens.s },
      utilization: interactionUtilization,
    },
    mass: ((p.density * A) / 1e6) * L,
    volume: (A / 1e6) * L,
    checks,
    diagrams,
    recommendations: capacityPass
      ? []
      : ["Проверить большее сечение, меньший шаг или меньший свес с сохранением реальных нагрузок."],
  };
}

/** Catalog screening, not a prescription or an automatic truss requirement. */
export function evaluateRafterCandidates(input = {}, catalog = defaultRafterSections) {
  const candidates = [];
  for (const item of Array.isArray(catalog) ? catalog : []) {
    let b, h, id;
    if (typeof item === "string") {
      const m = item.match(/^(\d+)\s*[x×]\s*(\d+)$/);
      if (!m) continue;
      b = +m[1];
      h = +m[2];
      id = item;
    } else if (item && typeof item === "object") {
      ({ b, h } = item);
      id = item.id ?? `${b}x${h}`;
    } else continue;
    const analysis = calculateRafter({ ...input, b, h });
    if (!analysis.valid) continue;
    candidates.push({
      id,
      b,
      h,
      section: `${b}x${h}`,
      area: b * h,
      volume: analysis.volume,
      mass: analysis.mass,
      capacityPass: analysis.capacityPass,
      utilization: analysis.utilization,
      analysis,
    });
  }
  candidates.sort(
    (a, b) => Number(b.capacityPass) - Number(a.capacityPass) || a.area - b.area || a.h - b.h || a.b - b.b,
  );
  const acceptable = candidates.filter((c) => c.capacityPass);
  return {
    candidates,
    acceptable,
    recommended: acceptable[0] ?? null,
    anyAcceptable: acceptable.length > 0,
    status: acceptable.length ? "unverified" : "no-candidate",
    note: "Проверены только перечисленные сечения при введённых нагрузках и свойствах. Нет подходящего сечения — не доказательство необходимости фермы: доступны меньший шаг, другая древесина и промежуточная опора.",
  };
}
export const evaluateCandidateCatalog = evaluateRafterCandidates;

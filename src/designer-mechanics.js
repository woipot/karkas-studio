/** Preliminary member checks for Designer. No hidden stiffness credit for splices. */
import { solveFloorWallBeam } from "./floor-wall-loads.js";
import {
  axialCompression,
  bearingPerpendicular,
  creepDefaults,
  finalDeflection,
  floorFrequency,
  resolveTimberMaterial,
  timberDesignAssumptions,
} from "./timber-design.js";
const sum = (a) => a.reduce((s, x) => s + x, 0);
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const dist = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const section = (s) => {
  const m = typeof s === "string" && s.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/);
  return m ? { b: +m[1], h: +m[2] } : null;
};
const safeStatus = (u) => (!finite(u) ? "unverified" : u > 1 ? "fail" : "pass");

/** Join physical stock pieces back into their original straight logical member. */
export function logicalMembers(instances, role) {
  const groups = new Map();
  for (const b of instances.filter(
    (b) => b.role === role && Array.isArray(b.start) && Array.isArray(b.end),
  )) {
    const id = b.memberId ?? b.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(b);
  }
  return [...groups].map(([id, parts]) => {
    const first = parts.find((b) => dist(b.start, b.end) > 1e-8) || parts[0],
      L = dist(first.start, first.end),
      u = first.end.map((x, i) => (x - first.start[i]) / L);
    const points = parts.flatMap((b) => [b.start, b.end]),
      projections = points.map((p) => sum(p.map((x, i) => (x - first.start[i]) * u[i]))),
      min = Math.min(...projections),
      max = Math.max(...projections);
    return {
      id,
      parts,
      start: first.start.map((x, i) => x + u[i] * min),
      end: first.start.map((x, i) => x + u[i] * max),
      length: max - min,
      b: first.b,
      h: first.h,
      mass: sum(parts.map((b) => b.mass ?? 0)),
      spliced: parts.length > 1,
      wallId: first.wallId,
      floor: first.floor,
      analyticalSpan: first.analyticalSpan,
      supportStart: first.supportStart,
      supportEnd: first.supportEnd,
      supportStatus: first.supportStatus,
      actualSpacing: first.actualSpacing,
      tributaryWidth: first.tributaryWidth,
      platformSpanId: first.platformSpanId,
      physicalOverhangStart: first.physicalOverhangStart,
      physicalOverhangEnd: first.physicalOverhangEnd,
      edgeJoist: first.edgeJoist,
      supportBearingScreen: first.supportBearingScreen,
      geometricUnbracedLength: first.geometricUnbracedLength,
      wallLoads: [
        ...new Map(parts.flatMap((b) => b.wallLoads ?? []).map((q, i) => [q.id ?? `${i}`, q])).values(),
      ],
      wallLoadsComplete: parts.every((b) => b.wallLoadsComplete !== false),
      wallLoadUnknownWallIds: [...new Set(parts.flatMap((b) => b.wallLoadUnknownWallIds ?? []))],
    };
  });
}

export function checkDesignerMembers(p, r) {
  const assumptions = [
    "Частные проверки элементов — предварительные модели, не нормативный расчёт дома. Пространственная устойчивость, крепёж, ростверк, грунт и передача усилий через реальные узлы не подтверждены.",
    "Балки: каждая логическая длина объединяет ВСЕ физические части с одинаковым memberId. Шестиметровая заготовка или стык не создаёт опору и не уменьшает расчётный пролёт. Линии реальных несущих стен разделяют пролёты в геометрическом ядре.",
    "Балки — шарнирно опёртые; равномерная нагрузка пола суммируется с частичными распределёнными и сосредоточенными нагрузками перегородок в фактических координатах. Вес слоёв по физической площади платформы приведён к осевой площади, фактическая древесина учтена один раз, полезная нагрузка принята по осевой площади; для одного UDL изгиб qL²/8 и прогиб 5qL⁴/(384EI), для смешанных нагрузок точное кусочно-полиномиальное решение Macaulay, предел полного мгновенного прогиба L/300, сдвиг 1,5V/A. Ползучесть, вибрации, местная нагрузка и LTB не проверены.",
    "Стойка — представительная консервативная оценка: крыша, верхние перекрытия и стены сведены к двум линиям по короткой стороне габаритного прямоугольника. Грузовая ширина учитывает половину соседнего проёма. Фактические усилия каждого простенка и перемычек не определены.",
    "Сжатие стойки по СП 64.13330.2017 / СНиП II-25-80 п. 4.2–4.3: N/(φ·Rc·A) ≤ 1 по обеим осям, λ ≤ 120. Сильная ось (из плоскости стены) — полная длина стойки × K. Слабая ось (в плоскости стены) раскреплена несущей обшивкой, если на этой стене в модели есть листы sheathing: расчётная длина — шаг гвоздей в поле листа bracing.fieldNailSpacing (по умолчанию 300 мм; блокинг между стойками в модели не задан). Без обшивки слабая ось — полная длина или явно меньший material.studRestraint. material.studSheathingRestraint = false отключает учёт обшивки. Несовершенства и эксцентриситет не учтены.",
    "У проёма грузовая ширина (половина проёма + шаг) делится на фактическое число коренных и подперемычечных стоек у этой кромки проёма в модели каркаса (обычно 2). Работа перемычки и узлов не проверена.",
    "X-связи: в каждом направлении работает одна растянутая диагональ; сжатая диагональ показана диагностически, её сопротивление не засчитывается. Сила ветра поделена максимум на две имеющиеся параллельные наружные стены; жёсткость диафрагм, узлов и анкеров не проверена.",
    "Древесина из единой ведомости учитывается в весе перекрытия. В расчёте балки используется полное номинальное сечение идеального неразрезного элемента; наращивание не подтверждает ни передачу силы, ни жёсткость этого элемента.",
  ];
  const modernBracing = r.bracingModel;
  if (modernBracing) {
    const i = assumptions.findIndex((a) => a.startsWith("X-"));
    if (i >= 0) assumptions.splice(i, 1);
  }
  const checks = [],
    allInstances = r?.timber?.instances ?? [],
    instances = allInstances.filter((b) => !b.annexId),
    hasAnnex = allInstances.some((b) => b.annexId),
    memberLoads = hasAnnex ? (r.houseLoads ?? r.loads) : r.loads,
    houseTotals = hasAnnex
      ? (r.houseTimberTotals ??
        Object.fromEntries(
          ["floor", "walls", "bracing"].map((k) => [
            k,
            {
              weight:
                (sum(instances.filter((b) => b.category === k).map((b) => b.mass ?? 0)) * 9.80665) / 1000,
            },
          ]),
        ))
      : r.timber?.totals,
    area = r?.geometry?.area,
    F = p.floors ?? 1,
    E = p.material?.E,
    Fb = p.material?.Fb,
    Ft = p.material?.Ft,
    Fc = p.material?.Fc,
    Fv = p.material?.Fv ?? 1.5,
    K = p.material?.columnK ?? 1;
  if (
    ![E, Fb, Ft, Fc, Fv, K].every((x) => finite(x) && x > 0) ||
    (p.material.studRestraint !== undefined &&
      (!finite(p.material.studRestraint) || p.material.studRestraint <= 0)) ||
    !finite(p.loads?.gammaG) ||
    !finite(p.loads?.gammaQ)
  )
    return {
      joist: null,
      stud: null,
      bracing: null,
      checks: [
        {
          id: "memberInputs",
          label: "Материал и коэффициенты элементов",
          status: "unverified",
          note: "Нужны положительные E, Fb, Ft, Fc, Fv, K и заданная длина раскрепления.",
        },
      ],
      assumptions,
      status: "unverified",
    };
  const gammaG = p.loads.gammaG,
    gammaQ = p.loads.gammaQ,
    wallMap = new Map((p.walls ?? []).map((w) => [w.id, w]));
  const hasArea = finite(area) && area > 0;
  const levels = r?.geometry?.levels ?? [],
    netFloorArea = finite(r?.geometry?.totalFloorArea) ? r.geometry.totalFloorArea : area * F;
  const floorWoodPressure =
    hasArea && netFloorArea > 0 ? (houseTotals?.floor?.weight ?? 0) / netFloorArea : 0;
  const spacing = p.floor?.spacing ?? 0.6;
  const floorPressureFor = (m) => {
    const level = levels.find((l) => l.index === m.floor);
    return level && level.netFloorArea > 0
      ? (sum(instances.filter((b) => b.category === "floor" && b.floor === m.floor).map((b) => b.mass ?? 0)) *
          9.80665) /
          1000 /
          level.netFloorArea
      : floorWoodPressure;
  };
  const floorDeadPressureFor = (m) => {
    const l = levels.find((l) => l.index === m.floor);
    return (
      (p.loads.floorDead ?? 0) *
      (l?.netFloorArea > 0 && finite(l.platformNetArea) ? l.platformNetArea / l.netFloorArea : 1)
    );
  };
  const joists = hasArea
    ? logicalMembers(instances, "joist")
        .filter((m) => m.length > 0 && m.b > 0 && m.h > 0)
        .map((m) => {
          const span = finite(m.analyticalSpan) ? m.analyticalSpan : m.length,
            tributaryWidth = m.tributaryWidth ?? m.actualSpacing ?? spacing,
            woodPressure = floorPressureFor(m),
            floorDeadPressure = floorDeadPressureFor(m);
          const lineService = (floorDeadPressure + woodPressure + (p.loads.live ?? 0)) * tributaryWidth,
            lineDesign =
              ((floorDeadPressure + woodPressure) * gammaG + (p.loads.live ?? 0) * gammaQ) * tributaryWidth;
          if (m.supportStatus && m.supportStatus !== "pass")
            return {
              ...m,
              span,
              floorDeadPressure,
              floorWoodPressure: woodPressure,
              lineLoadService: lineService,
              lineLoadDesign: lineDesign,
              utilization: null,
              status: "unverified",
              numericChecksApplicable: false,
              note: "Не подтверждены обе геометрические опоры; шарнирная модель не выдаётся за проверку этого элемента.",
            };
          if (m.wallLoadsComplete === false)
            return {
              ...m,
              span,
              floorDeadPressure,
              floorWoodPressure: woodPressure,
              lineLoadService: lineService,
              lineLoadDesign: lineDesign,
              utilization: null,
              status: "unverified",
              numericChecksApplicable: false,
              note: "Не весь собственный вес перегородок имеет замкнутый путь через реальные лаги к ростверку. Полная численная проверка этой лаги не объявляется выполненной.",
            };
          if (m.wallLoads.length) {
            const solved = solveFloorWallBeam({
              length: span,
              b: m.b,
              h: m.h,
              E,
              Fb,
              Fv,
              deflectionRatio: 300,
              uniformService: lineService,
              uniformDesign: lineDesign,
              loads: m.wallLoads,
            });
            if (!solved.valid)
              return {
                ...m,
                span,
                floorDeadPressure,
                floorWoodPressure: woodPressure,
                lineLoadService: lineService,
                lineLoadDesign: lineDesign,
                utilization: null,
                status: "unverified",
                numericChecksApplicable: false,
                loadErrors: solved.errors,
                note: "Нагрузки перегородки не согласованы с реальным пролётом; численная проверка не применена.",
              };
            return {
              ...m,
              span,
              I: solved.I,
              Z: solved.Z,
              floorDeadPressure,
              floorWoodPressure: woodPressure,
              lineLoadService: lineService,
              lineLoadDesign: lineDesign,
              moment: solved.moment,
              shear: solved.shear,
              stress: solved.bendingStress,
              deflection: solved.deflection,
              deflectionAllowed: solved.deflectionLimit,
              shearStress: solved.shearStress,
              bendingUtilization: solved.bendingUtilization,
              deflectionUtilization: solved.deflectionUtilization,
              shearUtilization: solved.shearUtilization,
              maxSpanBending: null,
              maxSpanDeflection: null,
              maxSpanShear: null,
              maxSpan: null,
              utilization: solved.utilization,
              status: solved.status,
              numericChecksApplicable: true,
              reactions: solved.reactions,
              loadTotalService: solved.service.total,
              loadTotalDesign: solved.design.total,
              loadBasis: solved.basis,
              loadScope:
                "Floor UDL plus own weight of explicitly routed non-bearing partitions; roof/bearing reactions excluded.",
              wallLoaded: true,
            };
          }
          const I = (m.b * m.h ** 3) / 12,
            Z = (m.b * m.h ** 2) / 6,
            L = span * 1000,
            M = (lineDesign * span ** 2) / 8,
            V = (lineDesign * span) / 2;
          const stress = (M * 1e6) / Z,
            deflection = (5 * lineService * L ** 4) / (384 * E * I),
            deflectionAllowed = L / 300,
            shearStress = (1.5 * V * 1000) / (m.b * m.h);
          const bendingUtilization = stress / Fb,
            deflectionUtilization = deflection / deflectionAllowed,
            shearUtilization = shearStress / Fv;
          const maxSpanBending = lineDesign > 0 ? Math.sqrt((8 * Fb * Z) / (lineDesign * 1e6)) : Infinity;
          const maxSpanDeflection =
            lineService > 0 ? Math.cbrt((384 * E * I) / (5 * lineService * 300)) / 1000 : Infinity;
          const maxSpanShear = lineDesign > 0 ? (2 * Fv * m.b * m.h) / (1.5 * lineDesign) / 1000 : Infinity;
          const utilization = Math.max(bendingUtilization, deflectionUtilization, shearUtilization);
          return {
            ...m,
            span,
            I,
            Z,
            floorDeadPressure,
            floorWoodPressure: woodPressure,
            lineLoadService: lineService,
            lineLoadDesign: lineDesign,
            moment: M,
            shear: V,
            stress,
            deflection,
            deflectionAllowed,
            shearStress,
            bendingUtilization,
            deflectionUtilization,
            shearUtilization,
            maxSpanBending,
            maxSpanDeflection,
            maxSpanShear,
            maxSpan: Math.min(maxSpanBending, maxSpanDeflection, maxSpanShear),
            utilization,
            status: safeStatus(utilization),
            numericChecksApplicable: true,
          };
        })
    : [];
  // B8 creep, B9 vibration and B1 support bearing for every numerically checked joist.
  const kdef = p.material.kdef ?? creepDefaults.kdef,
    psi2 = p.loads.psi2 ?? creepDefaults.psi2,
    finalRatio = p.material.finalDeflectionRatio ?? creepDefaults.finalDeflectionRatio,
    Fc90 = p.material.Fc90 ?? 3,
    partialBearing = p.material.Fc90PartialLength === true;
  for (const m of joists) {
    if (!m.numericChecksApplicable) continue;
    const L = m.span * 1000,
      tributary = m.tributaryWidth ?? m.actualSpacing ?? spacing,
      wQ = (5 * (p.loads.live ?? 0) * tributary * L ** 4) / (384 * E * m.I),
      wG = Math.max(0, m.deflection - wQ),
      creep = finalDeflection({ wG, wQ, kdef, psi2 });
    m.creep = { ...creep, limit: L / finalRatio, ratio: finalRatio };
    m.finalDeflection = creep.final;
    m.finalDeflectionAllowed = L / finalRatio;
    m.finalDeflectionUtilization = creep.final / (L / finalRatio);
    if (!m.edgeJoist && m.span > 0) {
      const mass = ((m.floorDeadPressure + m.floorWoodPressure) * 1000) / 9.80665;
      m.vibration = floorFrequency({
        span: m.span,
        E,
        b: m.b,
        h: m.h,
        spacing: m.actualSpacing ?? spacing,
        mass,
      });
    }
    const reactions = m.reactions
        ? [m.reactions.designA, m.reactions.designB]
        : [(m.lineLoadDesign * m.span) / 2, (m.lineLoadDesign * m.span) / 2],
      ends = [
        [m.supportStart, m.physicalOverhangStart ?? 0],
        [m.supportEnd, m.physicalOverhangEnd ?? 0],
      ];
    m.bearing = ends.map(([support, overhang], i) => {
      const half = support?.halfBearing;
      if (!finite(half) || half <= 0) return null;
      const length = Math.min(2 * half, half + Math.max(0, overhang)) * 1000;
      return {
        end: i ? "end" : "start",
        supportKind: support.kind,
        supportId: support.sourceId,
        ...bearingPerpendicular({ F: reactions[i], b: m.b, l: length, Fc90 }),
      };
    });
  }
  const numericJoists = joists.filter((j) => j.numericChecksApplicable),
    unknownJoists = joists.filter((j) => !j.numericChecksApplicable);
  const worstJoist = numericJoists.length
    ? numericJoists.reduce((a, b) => (a.utilization > b.utilization ? a : b))
    : joists[0];
  const joist = worstJoist
    ? {
        ...worstJoist,
        members: joists,
        logicalCount: joists.length,
        stockPieces: joists.reduce((s, m) => s + m.parts.length, 0),
        note: "Расчётная длина — между действительными опорами; физические торцы по граням обвязки, блокинг и стыки не сокращают этот пролёт.",
      }
    : null;
  if (joist?.numericChecksApplicable)
    checks.push(
      {
        id: "designerJoistBending",
        label: "Балки: изгиб худшего пролёта",
        value: joist.stress,
        limit: Fb,
        unit: "МПа",
        utilization: joist.bendingUtilization,
        status: safeStatus(joist.bendingUtilization),
      },
      {
        id: "designerJoistDeflection",
        label: "Балки: мгновенный прогиб",
        value: joist.deflection,
        limit: joist.deflectionAllowed,
        unit: "мм",
        utilization: joist.deflectionUtilization,
        status: safeStatus(joist.deflectionUtilization),
      },
      {
        id: "designerJoistShear",
        label: "Балки: сдвиг",
        value: joist.shearStress,
        limit: Fv,
        unit: "МПа",
        utilization: joist.shearUtilization,
        status: safeStatus(joist.shearUtilization),
      },
    );
  if (joist?.numericChecksApplicable) {
    const worstFinal = numericJoists.reduce((a, b) =>
        a.finalDeflectionUtilization > b.finalDeflectionUtilization ? a : b,
      ),
      vibrating = numericJoists.filter((m) => m.vibration),
      worstVibration = vibrating.length
        ? vibrating.reduce((a, b) => (a.vibration.frequency < b.vibration.frequency ? a : b))
        : null,
      bearings = numericJoists.flatMap((m) =>
        (m.bearing ?? []).filter(Boolean).map((q) => ({ ...q, memberId: m.id })),
      ),
      worstBearing = bearings.length
        ? bearings.reduce((a, b) => (a.utilization > b.utilization ? a : b))
        : null;
    checks.push({
      id: "designerJoistFinalDeflection",
      label: `Балки: конечный прогиб с ползучестью · L/${finalRatio}`,
      value: worstFinal.finalDeflection,
      limit: worstFinal.finalDeflectionAllowed,
      unit: "мм",
      utilization: worstFinal.finalDeflectionUtilization,
      status: safeStatus(worstFinal.finalDeflectionUtilization),
      memberId: worstFinal.id,
      kdef,
      psi2,
      instantaneous: worstFinal.deflection,
      note: "w_fin = w_G(1+kdef) + w_Q(1+ψ2·kdef) по EN 1995-1-1 2.2.3 (kdef 0.6 — класс эксплуатации 1, цельная древесина; ψ2 0.3 — жилые помещения). СП 64 не задаёт kdef явно; material.kdef, material.finalDeflectionRatio и loads.psi2 настраиваются.",
    });
    if (worstVibration)
      checks.push({
        id: "designerFloorVibration",
        label: "Перекрытие: собственная частота f1 ≥ 8 Гц (рекомендация EN 1995-1-1 7.3)",
        value: worstVibration.vibration.frequency,
        limit: 8,
        unit: "Гц",
        frequencyRatio: worstVibration.vibration.frequency / 8,
        status: worstVibration.vibration.frequency < 8 ? "warning" : "pass",
        memberId: worstVibration.id,
        note: "f1 = π/(2L²)·√((EI)_l/m), m — постоянная масса перекрытия. В СП 64.13330.2017 критерия нет: это рекомендуемая проверка EN 1995-1-1 7.3.3, при f1 < 8 Гц — предупреждение, требуется расчёт на вибрацию.",
      });
    if (worstBearing)
      checks.push({
        id: "designerJoistBearing",
        label: "Балки: смятие поперёк волокон на опоре",
        value: worstBearing.stress,
        limit: worstBearing.limit,
        unit: "МПа",
        utilization: worstBearing.utilization,
        status: safeStatus(worstBearing.utilization),
        memberId: worstBearing.memberId,
        supportId: worstBearing.supportId,
        bearingLength: worstBearing.bearingLength,
        note: "Опорная реакция лаги на площадке b × (фактическая длина опирания по геометрии платформы) против Rсм90 = material.Fc90 (СНиП II-25-80 табл. 3 п. 4а, сохранено в СП 64.13330.2017).",
      });
  } else
    checks.push({
      id: "designerJoists",
      label: "Балки перекрытия",
      status: "unverified",
      note: "Нет замкнутой площади или пролётов с двумя подтверждёнными геометрическими опорами.",
    });
  if (unknownJoists.length)
    checks.push({
      id: "designerJoistSupports",
      label: "Лаги без подтверждённой опорной схемы",
      status: "unverified",
      value: unknownJoists.length,
      unit: "шт.",
      memberIds: unknownJoists.map((m) => m.id),
      note: "Частные шарнирные проверки этих элементов не выполняются. Требуется реальная опора и рабочий узел передачи нагрузки.",
    });
  const incompleteWalls = joists.filter((m) => m.wallLoadsComplete === false);
  if (incompleteWalls.length)
    checks.push({
      id: "designerJoistWallLoadPath",
      label: "Неполные нагрузки перегородок на лаги",
      status: "unverified",
      memberIds: incompleteWalls.map((m) => m.id),
      wallIds: [...new Set(incompleteWalls.flatMap((m) => m.wallLoadUnknownWallIds))],
      note: "Неполные нагрузки не заменяются проверкой одного равномерного пола.",
    });
  const consoleJoists = joists.filter(
    (m) => (m.physicalOverhangStart ?? 0) > 1e-7 || (m.physicalOverhangEnd ?? 0) > 1e-7,
  );
  if (consoleJoists.length)
    checks.push({
      id: "floorJoistEndConsoles",
      label: "Концы лаг за осями опирания",
      status: "unverified",
      value: consoleJoists.length,
      unit: "шт.",
      memberIds: consoleJoists.flatMap((m) => m.parts.map((b) => b.id)),
      logicalMemberIds: consoleJoists.map((m) => m.id),
      note: "Наружная обвязка не создаёт новую опору. Площадь постоянной нагрузки всей платформы приведена к осевой площади для частной шарнирной проверки; местные консоли, опорное смятие, эксцентриситет и передача усилий через настил/обвязку не рассчитаны.",
    });
  // C(a): structural sheathing nailed to the stud faces restrains the weak (in-wall-plane)
  // axis; the effective length is the field fastener spacing of the sheets.
  const sheathingRestraint = (wallId, level) =>
    p.material.studSheathingRestraint !== false &&
    r.bracingModel?.method === "sheathing" &&
    (r.bracingModel.panels ?? []).some(
      (q) => q.wallId === wallId && (level === undefined || q.level === undefined || q.level === level),
    )
      ? (p.bracing?.fieldNailSpacing ?? 300) / 1000
      : null;
  // C(b): number of king + jack studs actually framed at one edge of an opening.
  const openingEdgeStuds = (w, o, side, b) => {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
      u = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len },
      B = b / 1000,
      edgeS = side < 0 ? o.offset : o.offset + o.width,
      centre = edgeS + side * B;
    const count = allInstances.filter((q) => {
      if (!["king", "jack"].includes(q.role) || q.wallId !== w.id || !Array.isArray(q.start)) return false;
      const sPos = (q.start[0] - w.a.x) * u.x + (q.start[2] - w.a.y) * u.y;
      return Math.abs(sPos - centre) < 1.6 * B;
    }).length;
    return Math.max(1, count);
  };
  const measuredWalls = (r.fullHeightWalls?.walls ?? []).filter(
      (w) => w.mode === "continuous" && w.studs?.length,
    ),
    measuredIds = new Set(measuredWalls.map((w) => w.wallId));
  const bearingWalls = (p.walls ?? []).filter((w) => w.kind !== "partition" && !measuredIds.has(w.id)),
    bounds = r?.geometry?.bounds ?? {};
  const supportLength = Math.min(bounds.width ?? 0, bounds.height ?? 0);
  let stud = null;
  if (hasArea && memberLoads && supportLength > 0 && bearingWalls.length) {
    const roofDesign = (memberLoads.roofWeight ?? 0) * gammaG + (memberLoads.snow ?? 0) * gammaQ;
    const upperArea = levels.length
      ? sum(levels.slice(1).map((l) => (l.closed ? (l.netFloorArea ?? l.area ?? 0) : 0)))
      : area * Math.max(0, F - 1);
    const upperDeadArea = levels.length
      ? sum(levels.slice(1).map((l) => (l.closed ? (l.platformNetArea ?? l.netFloorArea ?? l.area ?? 0) : 0)))
      : upperArea;
    const upperFloor =
      (upperDeadArea * (p.loads.floorDead ?? 0) + upperArea * floorWoodPressure) * gammaG +
      upperArea * (p.loads.live ?? 0) * gammaQ;
    const wallLayers = (memberLoads.rows ?? [])
      .filter((row) =>
        [
          "wall-layers",
          "inner-layers",
          "openings",
          "walls-layers",
          "wallLayers",
          "opening-layers",
          "openings-layers",
        ].includes(row.id),
      )
      .reduce((s, row) => s + (row.characteristic ?? 0), 0);
    const wallWeight = (houseTotals?.walls?.weight ?? 0) + (houseTotals?.bracing?.weight ?? 0) + wallLayers;
    const line = (roofDesign + upperFloor + wallWeight * gammaG) / (2 * supportLength);
    const studs = bearingWalls
      .map((w) => {
        const profile = r.geometry?.wallProfiles?.find((q) => q.wallId === w.id && q.mode === "continuous"),
          sec = section(profile?.section ?? w.section);
        if (!sec) return null;
        const A = sec.b * sec.h,
          Iweak = (sec.h * sec.b ** 3) / 12,
          Istrong = (sec.b * sec.h ** 3) / 12,
          length = profile
            ? profile.studMaxLength
            : Math.max(p.height, ...levels.map((l) => l.height ?? p.height)) - (3 * sec.b) / 1000;
        const restraint =
          !profile && finite(p.material.studRestraint) && p.material.studRestraint > 0
            ? p.material.studRestraint
            : length;
        const sheathing = sheathingRestraint(w.id, w.level ?? w.floor),
          weakLength = Math.min(length, restraint, sheathing ?? Infinity),
          openings = (p.openings ?? []).filter((o) => o.wallId === w.id);
        const step = w.studStep ?? 0.6,
          edges = openings.flatMap((o) =>
            [-1, 1].map((side) => {
              const count = openingEdgeStuds(w, o, side, sec.b);
              return { openingId: o.id, side, tributary: o.width / 2 + step, studCount: count };
            }),
          ),
          edge = edges.reduce(
            (a, e) => (!a || e.tributary / e.studCount > a.tributary / a.studCount ? e : a),
            null,
          ),
          tributaryWidth = Math.max(step, edge ? edge.tributary / edge.studCount : 0),
          force = line * tributaryWidth;
        const eulerWeak = (Math.PI ** 2 * E * Iweak) / (K * weakLength * 1000) ** 2 / 1000,
          eulerStrong = (Math.PI ** 2 * E * Istrong) / (K * length * 1000) ** 2 / 1000,
          euler = Math.min(eulerWeak, eulerStrong),
          buckling = axialCompression({
            N: force,
            b: sec.b,
            h: sec.h,
            l0Strong: K * length,
            l0Weak: K * weakLength,
            Fc,
            kind: "column",
          }),
          crushing = buckling.crushing,
          capacity = buckling.capacity,
          slender = buckling.lambda > buckling.lambdaLimit;
        return {
          wallId: w.id,
          b: sec.b,
          h: sec.h,
          area: A,
          length,
          unbracedLength: weakLength,
          strongLength: length,
          weakAxisRestraint: sheathing !== null && weakLength === sheathing ? "sheathing" : "unbraced",
          sheathingFastenerSpacing: sheathing,
          K,
          force,
          stress: (force * 1000) / A,
          Iweak,
          Istrong,
          eulerWeak,
          eulerStrong,
          euler,
          idealEulerReferenceOnly: true,
          lambdaStrong: buckling.lambdaStrong,
          lambdaWeak: buckling.lambdaWeak,
          lambda: buckling.lambda,
          lambdaLimit: buckling.lambdaLimit,
          phi: buckling.phi,
          phiStrong: buckling.phiStrong,
          phiWeak: buckling.phiWeak,
          crushing,
          capacity,
          tributaryWidth,
          openingEdge: edge,
          shortening: (force * 1000 * length * 1000) / (E * A),
          maxUnbracedLength:
            force > 0 ? (Math.PI * Math.sqrt((E * Iweak) / (force * 1000))) / K / 1000 : Infinity,
          utilization: force / capacity,
          status: force > capacity || slender ? "fail" : "warning",
        };
      })
      .filter(Boolean);
    if (studs.length)
      stud = {
        ...studs.reduce((a, b) => (a.utilization > b.utilization ? a : b)),
        walls: studs,
        equivalentLineLoad: line,
        supportLength,
        note: "Представительная стойка по консервативной эквивалентной погонной нагрузке, а не решение каждого простенка.",
      };
  }
  if (measuredWalls.length) {
    const actual = measuredWalls.flatMap((w) =>
        w.studs.map((s) => ({
          ...s,
          wallId: w.wallId,
          area: s.A,
          capacity: s.force >= 0 ? s.compressionCapacity : s.tensionCapacity,
          stress: (s.force * 1000) / s.A,
          unbracedLength: s.unbracedWeakLength ?? s.length,
          strongLength: s.length,
          shortening: (s.force * 1000 * s.length * 1000) / (E * s.A),
          utilization: Math.max(s.compressionUtilization, s.tensionUtilization),
          status: s.compressionUtilization > 1 || s.tensionUtilization > 1 ? "fail" : "unverified",
          measured: true,
        })),
      ),
      worst = actual.reduce((a, b) => (a.utilization > b.utilization ? a : b));
    if (!stud || worst.utilization > stud.utilization)
      stud = {
        ...worst,
        walls: actual,
        note: "Фактическая стойка полной высоты, реакция кровли и собственный вес стены. Распределение по габаритному прямоугольнику для неё не применяется.",
      };
  }
  if (stud)
    checks.push({
      id: "designerStudCompression",
      label: stud.measured
        ? "Фактическая цельная стойка: сжатие / устойчивость φ (СП 64)"
        : "Представительная стойка: сжатие / устойчивость φ (СП 64)",
      value: stud.force,
      limit: stud.capacity,
      unit: "кН",
      utilization: stud.utilization,
      status: stud.status,
      phi: stud.phi,
      lambda: stud.lambda,
      weakAxisRestraint: stud.weakAxisRestraint,
    });
  if (stud && finite(stud.lambda))
    checks.push({
      id: "designerStudSlenderness",
      label: "Стойка: предельная гибкость λ ≤ 120 (СНиП II-25-80 табл. 14)",
      value: stud.lambda,
      limit: stud.lambdaLimit ?? 120,
      unit: "",
      utilization: stud.lambda / (stud.lambdaLimit ?? 120),
      status: stud.lambda > (stud.lambdaLimit ?? 120) ? "fail" : "pass",
    });
  else
    checks.push({
      id: "designerStuds",
      label: "Сжатие стоек",
      status: "unverified",
      note: "Путь вертикальной нагрузки не задан для открытой или неполной модели.",
    });
  // B1: stud end on the bottom plate (plate loaded across its grain over the stud thickness).
  const studForces = [
    ...(stud?.walls ?? []).map((q) => ({
      wallId: q.wallId,
      id: q.id,
      force: q.measured ? q.compressionForce : q.force,
      b: q.b,
      h: q.h,
    })),
  ].filter((q) => finite(q.force) && q.force > 0 && q.b > 0 && q.h > 0);
  if (studForces.length) {
    const rows = studForces.map((q) => ({
        ...q,
        ...bearingPerpendicular({ F: q.force, b: q.h, l: q.b, Fc90, partialLength: partialBearing }),
      })),
      worst = rows.reduce((a, b) => (a.utilization > b.utilization ? a : b));
    checks.push({
      id: "designerStudPlateBearing",
      label: "Стойка на нижней обвязке: смятие поперёк волокон",
      value: worst.stress,
      limit: worst.limit,
      unit: "МПа",
      utilization: worst.utilization,
      status: safeStatus(worst.utilization),
      wallId: worst.wallId,
      force: worst.force,
      area: worst.area,
      note: partialBearing
        ? "σ = N/(b·h) против Rсм90 на части длины Rс90(1 + 8/(lсм + 1.2)) (СНиП II-25-80 ф. (2)); lсм — толщина стойки вдоль волокон обвязки."
        : "σ = N/(b·h) против Rсм90 = material.Fc90 (по умолчанию 3.0 МПа, СНиП II-25-80 табл. 3 п. 4а / СП 64.13330.2017). Увеличение для местного смятия на части длины включается material.Fc90PartialLength = true.",
    });
    if (stud) stud.plateBearing = worst;
  }
  // B1: truss / rafter heel on the wall top plate.
  const plateDepth = Math.min(
    ...(p.walls ?? [])
      .filter((w) => w.kind !== "partition")
      .map((w) => section(w.section)?.h)
      .filter((h) => finite(h) && h > 0),
  );
  const heels = finite(plateDepth)
    ? (r.roofModel?.zones ?? []).flatMap((z) => {
        if (z.effectiveFraming === "truss" && z.analysis?.stable && z.analysisApplicable !== false)
          return z.analysis.reactions.map((q) => ({
            zoneId: z.id,
            kind: "truss",
            force: Math.abs(q.y),
            b: z.analysis.input.chordB,
          }));
        const ra = z.rafterAnalysis?.reactions;
        if (z.effectiveFraming === "rafters" && ra)
          return [ra.verticalA, ra.verticalB]
            .filter(finite)
            .map((F) => ({ zoneId: z.id, kind: "rafter", force: Math.abs(F), b: z.rafterAnalysis.input?.b }));
        return [];
      })
    : [];
  const heelRows = heels
    .filter((q) => finite(q.b) && q.b > 0)
    .map((q) => ({
      ...q,
      ...bearingPerpendicular({ F: q.force, b: plateDepth, l: q.b, Fc90, partialLength: partialBearing }),
    }));
  if (heelRows.length) {
    const worst = heelRows.reduce((a, b) => (a.utilization > b.utilization ? a : b));
    checks.push({
      id: "designerRoofHeelBearing",
      label: "Опора фермы/стропила на верхней обвязке: смятие поперёк волокон",
      value: worst.stress,
      limit: worst.limit,
      unit: "МПа",
      utilization: worst.utilization,
      status: safeStatus(worst.utilization),
      zoneId: worst.zoneId,
      force: worst.force,
      area: worst.area,
      note: "Опорная реакция одной фермы/стропила на площадке (ширина пояса) × (глубина обвязки, минимальная из несущих стен). Rсм90 = material.Fc90. Крепёж и анкеровка от отрыва не проверены.",
    });
  }
  // B1: grillage on the pile cap. Only one beam is credited as lying directly on the cap
  // (laps/stacked plies at crossings are not credited); the contact length is the cap
  // size for a passing beam and half the cap plus half the beam width at a beam end.
  const grillageBeams = new Map((r.grillageModel?.beams ?? []).map((q) => [q.id, q]));
  const pileRows = (r.piles ?? [])
    .filter((q) => finite(q.reaction) && q.reaction > 0 && finite(q.capSize) && q.capSize > 0)
    .map((pile) => {
      const contacts = (pile.stationRefs ?? [])
          .map((ref) => {
            const beam = grillageBeams.get(ref.beamId);
            if (!beam) return null;
            const width =
                finite(beam.bMM) && finite(beam.plies) ? beam.bMM * beam.plies : (beam.width ?? 0) * 1000,
              atEnd = ref.station < 1e-6 || ref.station > beam.length - 1e-6,
              length = atEnd ? Math.min(pile.capSize, pile.capSize / 2 + width / 2) : pile.capSize;
            return { beamId: beam.id, width: Math.min(width, pile.capSize), length };
          })
          .filter((q) => q && q.width > 0),
        best = contacts.reduce((a, b) => (!a || b.width * b.length > a.width * a.length ? b : a), null);
      return best
        ? {
            pileId: pile.id,
            beamId: best.beamId,
            ...bearingPerpendicular({ F: pile.reaction, b: best.width, l: best.length, Fc90 }),
          }
        : null;
    })
    .filter(Boolean);
  if (pileRows.length) {
    const worst = pileRows.reduce((a, b) => (a.utilization > b.utilization ? a : b));
    checks.push({
      id: "designerGrillagePileBearing",
      label: "Ростверк на оголовке сваи: смятие поперёк волокон",
      value: worst.stress,
      limit: worst.limit,
      unit: "МПа",
      utilization: worst.utilization,
      status: safeStatus(worst.utilization),
      pileId: worst.pileId,
      beamId: worst.beamId,
      force: worst.force,
      area: worst.area,
      note: "Реакция сваи на площади контакта одной балки ростверка с оголовком (ширина пакета × длина опирания в пределах оголовка). Rсм90 = material.Fc90. Нахлёсты и опирание второй балки не засчитаны.",
    });
  }
  const floorT = (section(p.floor?.section)?.h ?? 250) / 1000 + 0.035,
    facadeH =
      (levels.length ? sum(levels.map((l) => l.height ?? p.height)) : F * p.height) +
      Math.max(0, F - 1) * floorT;
  const forceX = hasArea ? (p.loads.wind ?? 0) * (bounds.height ?? 0) * facadeH : 0,
    forceY = hasArea ? (p.loads.wind ?? 0) * (bounds.width ?? 0) * facadeH : 0;
  const bays = modernBracing
    ? []
    : hasArea
      ? (r.timber?.braceBays ?? []).filter((b) => b.available && wallMap.get(b.wallId)?.kind === "exterior")
      : [];
  const braceMembers = logicalMembers(instances, "brace");
  const braced = bays
    .map((bay) => {
      const w = wallMap.get(bay.wallId),
        len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
        ux = (w.b.x - w.a.x) / len,
        uy = (w.b.y - w.a.y) / len;
      const parallelCount = bays
        .filter((q) => q.floor === bay.floor)
        .filter((q) => {
          const v = wallMap.get(q.wallId),
            vl = Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y);
          return Math.abs((ux * (v.b.x - v.a.x)) / vl + (uy * (v.b.y - v.a.y)) / vl) > 0.99;
        }).length;
      const share = Math.max(1, Math.min(2, parallelCount)),
        accumulation = (F - (bay.floor ?? 1) + 1) / F;
      const shear = (Math.max(forceX * Math.abs(ux), forceY * Math.abs(uy)) * gammaQ * accumulation) / share;
      const board = braceMembers.find((m) => m.wallId === bay.wallId && m.floor === bay.floor),
        b = board?.b ?? 25,
        h = board?.h ?? 100,
        length = board?.length ?? bay.length;
      const cosine = bay.width / length,
        force = shear / cosine,
        A = b * h,
        Imin = (Math.max(b, h) * Math.min(b, h) ** 3) / 12,
        euler = (Math.PI ** 2 * E * Imin) / (length * 1000) ** 2 / 1000;
      // СП 64 φ with λmax 200 for compressed bracing members (СНиП II-25-80 табл. 14).
      const braceBuckling = axialCompression({
          N: force,
          b: Math.min(b, h),
          h: Math.max(b, h),
          l0Strong: length,
          l0Weak: length,
          Fc,
          kind: "bracing",
        }),
        tensionCapacity = (Ft * A) / 1000,
        compressionCapacity = braceBuckling.capacity,
        extension = (force * 1000 * length * 1000) / (E * A);
      return {
        ...bay,
        b,
        h,
        length,
        force,
        shear,
        area: A,
        stress: (force * 1000) / A,
        extension,
        drift: extension / cosine,
        euler,
        idealEulerReferenceOnly: true,
        lambda: braceBuckling.lambda,
        lambdaLimit: braceBuckling.lambdaLimit,
        phi: braceBuckling.phi,
        tensionCapacity,
        compressionCapacity,
        tensionUtilization: force / tensionCapacity,
        compressionUtilization: force / compressionCapacity,
        maxCompressionLength:
          force > 0 ? (Math.PI * Math.sqrt((E * Imin) / (force * 1000))) / 1000 : Infinity,
      };
    })
    .filter((b) => finite(b.force) && finite(b.length) && b.length > 0);
  const tension = braced.length
    ? braced.reduce((a, b) => (a.tensionUtilization > b.tensionUtilization ? a : b))
    : null;
  const compression = braced.length
    ? braced.reduce((a, b) => (a.compressionUtilization > b.compressionUtilization ? a : b))
    : null;
  const missing = (r.timber?.braceBays ?? []).filter(
    (b) => !b.available && wallMap.get(b.wallId)?.kind === "exterior",
  );
  const bracing = {
    bays: braced,
    tension,
    compression,
    missing,
    windForceX: forceX,
    windForceY: forceY,
    status: tension?.tensionUtilization > 1 ? "fail" : "unverified",
    note: "Работа растянутой диагонали; крепёж, диафрагмы, анкеры и устойчивость из плоскости не подтверждены.",
  };
  if (tension)
    checks.push({
      id: "designerBraceTension",
      label: "Укосина: осевое растяжение",
      value: tension.stress,
      limit: Ft,
      unit: "МПа",
      utilization: tension.tensionUtilization,
      status: safeStatus(tension.tensionUtilization),
    });
  checks.push({
    id: "designerMemberSystem",
    label: "Стыки, местные узлы и пространственная работа",
    status: "unverified",
    note: "Частные проверки не подтверждают передачу усилий через физические стыки, опорные узлы и диафрагмы.",
  });
  if (levels.some((l) => (l.voidArea ?? 0) > 0)) {
    checks.push({
      id: "designerVoidLoadPath",
      label: "Обрамление второго света и проёмов перекрытия",
      status: "unverified",
      note: "Обрезка балки у проёма не подтверждает её опирание. Несущая способность обрамления, подвесов и передача нагрузки на соседние балки требуют отдельной модели.",
    });
    assumptions.push(
      "Средний вес древесины перекрытия делится на фактическую сумму netFloorArea всех этажей. Для второго света пролёты обрезанных балок показаны геометрически; опирание на обрамление и усиление проёмов не подтверждены.",
    );
  }
  if (levels.length > 1)
    assumptions.push(
      "Этажи имеют независимую геометрию. Представительная стойка использует суммарную площадь верхних перекрытий и максимальную высоту стен, но не рассчитывает каждый вертикальный путь нагрузки между несовпадающими этажами.",
    );
  const materialBasis = resolveTimberMaterial(p.material);
  checks.push(materialBasis.check);
  assumptions.push(...timberDesignAssumptions);
  return {
    joist,
    stud,
    materialBasis,
    bracing: modernBracing
      ? { ...modernBracing, tension: null, compression: null, missing: [], bays: [] }
      : bracing,
    checks,
    assumptions,
    status: checks.some((c) => c.status === "fail") ? "fail" : "unverified",
  };
}

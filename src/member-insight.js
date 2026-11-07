import { humanLabel } from "./materials-data.js";
/**
 * Member insight: everything the report knows about one physical board, gathered for the
 * viewer's side panel. Pure function over an evaluateHouse() report; no recalculation.
 *
 * Returns { board, facts, cutting, analysis, checks } where
 *  - cutting: the 6 m stock the part is cut from, its position, neighbours, offcut and groups;
 *  - analysis: role-specific internal forces / utilization (joist, truss bar, tied-rafter frame
 *    member, rafter, grillage beam, stud) with the loads that produce them;
 *  - checks: report checks that reference this board, its wall, beam or roof zone.
 */

const G = 9.80665;
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const row = (label, value, unit = "", digits = 2) => ({ label, value, unit, digits });
const governing = (parts) => {
  const best = maxBy(
    parts.filter(([, v]) => finite(v)),
    ([, v]) => v,
  );
  return best ? { label: "Определяет", text: `${best[0]} · ${Math.round(best[1] * 100)}%` } : null;
};
// Slenderness λ/λmax is a geometric limit of СП 64, not a share of the load: it is reported as
// its own row and fails the member only when exceeded; "Загрузка" is strength only.
const slendernessRow = (lambda, limit) => {
  if (!finite(lambda) || !finite(limit) || limit <= 0) return null;
  const ratio = lambda / limit;
  return {
    label: "Гибкость λ / предел СП 64",
    text: `${Math.round(lambda)} из ${Math.round(limit)}${ratio > 1 ? " — превышена" : ""}`,
    ratio,
  };
};
const strengthStatus = (u, slender, base) =>
  base === "unverified"
    ? "unverified"
    : (finite(u) && u > 1) || (slender && slender.ratio > 1)
      ? "fail"
      : "pass";
const maxBy = (list, f) => list.reduce((a, b) => (a === null || f(b) > f(a) ? b : a), null);

export const roleLabels = {
  beamCourse: "Венец профилированного бруса",
  beamCasing: "Обсада проёма",
  joist: "Лага перекрытия",
  rimJoist: "Обвязочная (краевая) балка",
  floorBlocking: "Блокинг между лагами",
  wallTransferBlocking: "Опорная вставка под стеной",
  stud: "Стойка стены",
  king: "Стойка у проёма (king)",
  jack: "Опорная стойка перемычки (jack)",
  cripple: "Укороченная стойка",
  corner: "Угловая стойка",
  plate: "Обвязка стены",
  header: "Перемычка проёма",
  sill: "Подоконный ригель",
  top: "Верхний пояс фермы",
  bottom: "Нижний пояс фермы",
  web: "Решётка фермы",
  rafter: "Стропило",
  topChord: "Стропило рамы",
  bottomChord: "Затяжка рамы",
  collarTie: "Ригель рамы",
  kneePost: "Стойка рамы",
  grillagePly: "Доска пакетного ростверка",
  letInBrace: "Врезной раскос",
  sheathingBlocking: "Блокинг под кромки листов",
};

const STUD_ROLES = new Set(["stud", "king", "jack", "cripple", "corner"]);
const TRUSS_ROLES = new Set(["top", "bottom", "web"]);

function cuttingInsight(report, board) {
  const stocks = report.cutting?.stocks ?? [];
  for (const stock of stocks) {
    const index = stock.pieces.findIndex((p) => p.id === board.id || p.sourceId === board.id);
    if (index < 0) continue;
    const kerf = report.cutting?.kerf ?? (report.cutting?.kerfMM ?? 0) / 1000;
    let offset = 0;
    const pieces = stock.pieces.map((p, i) => {
      const item = {
        id: p.id,
        name: p.name ?? p.source?.name ?? "Деталь",
        length: p.length,
        offset,
        current: i === index,
      };
      offset += p.length + kerf;
      return item;
    });
    const fab = report.fabrication ?? {},
      partGroupId = fab.partToGroup?.[board.id] ?? null,
      patternGroupId = fab.stockToPattern?.[stock.id] ?? null,
      partGroup = (fab.partGroups ?? []).find((g) => g.id === partGroupId) ?? null,
      patternGroup = (fab.patternGroups ?? []).find((g) => g.id === patternGroupId) ?? null;
    return {
      stockId: stock.id,
      section: stock.section,
      stockLength: stock.length,
      pieceIndex: index,
      pieces,
      used: stock.used ?? null,
      kerfWaste: stock.kerfWaste ?? null,
      remainder: stock.remainder ?? null,
      reusable: stock.reusable ?? null,
      kerf,
      partGroupId,
      partGroupCount: partGroup?.count ?? partGroup?.physicalIds?.length ?? null,
      patternGroupId,
      patternCount: patternGroup?.count ?? patternGroup?.stockIds?.length ?? null,
      cutStart: board.cutStart?.scheme ?? null,
      cutEnd: board.cutEnd?.scheme ?? null,
    };
  }
  return null;
}

function joistAnalysis(r, board) {
  const j = (r.floorPlatform?.joistChecks ?? []).find((q) => q.partIds?.includes(board.id));
  if (!j) return null;
  const support = (s) => (s ? [s.kind, s.analyticalSourceId ?? s.sourceId].filter(Boolean).join(" · ") : "—");
  return {
    source: "joist",
    title: "Лага: изгиб, срез, прогиб",
    status: j.status,
    utilization: j.utilization,
    rows: [
      governing([
        ["изгиб", j.bendingUtilization],
        ["прогиб", j.deflectionUtilization],
        ["прогиб с ползучестью", j.finalDeflectionUtilization],
        ["срез", j.shearUtilization],
      ]),
      row("Расчётный пролёт", j.span ?? j.analyticalSpan, "м", 3),
      row("Грузовая ширина", j.tributaryWidth ?? j.actualSpacing, "м", 3),
      row("Нагрузка расчётная", j.lineLoadDesign, "кН/м"),
      row("Нагрузка нормативная", j.lineLoadService, "кН/м"),
      row("Перегородки сверху", j.wallLoads?.length ?? 0, "шт.", 0),
      row("Момент M", j.moment, "кН·м"),
      row("Поперечная сила Q", j.shear, "кН"),
      row("Напряжение изгиба σ", j.stress, "МПа"),
      row("Загрузка по изгибу", j.bendingUtilization, "", 2),
      row("Прогиб мгновенный", j.deflection, "мм", 1),
      row("Предел прогиба", j.deflectionAllowed, "мм", 1),
      ...(finite(j.finalDeflection)
        ? [
            row("Прогиб с ползучестью", j.finalDeflection, "мм", 1),
            row("Предел", j.finalDeflectionAllowed, "мм", 1),
          ]
        : []),
      row("Загрузка по срезу", j.shearUtilization, "", 2),
      { label: "Опора в начале", text: support(j.supportStart) },
      { label: "Опора в конце", text: support(j.supportEnd) },
    ],
  };
}

function trussAnalysis(r, board) {
  const zone = (r.roofModel?.zones ?? []).find((z) => z.id === board.zoneId);
  const bar = zone?.analysis?.bars?.find((b) => b.id === (board.trussBarId ?? board.barId));
  if (!bar) return null;
  const caseLabel = {
    symmetric: "равномерный",
    "unbalanced-left": "несимметричный (лево)",
    "unbalanced-right": "несимметричный (право)",
  };
  return {
    source: "truss",
    title: `Стержень фермы ${bar.id}`,
    status: bar.status,
    utilization: bar.utilization,
    rows: [
      {
        label: "Работа",
        text: bar.forceType === "compression" ? "Сжатие" : bar.forceType === "tension" ? "Растяжение" : "—",
      },
      row("Усилие N расчётное", bar.force, "кН"),
      row("Усилие N нормативное", bar.forceCharacteristic, "кН"),
      row("Напряжение", bar.stress, "МПа"),
      row("Гибкость λ", bar.lambda, "", 0),
      row("Предельная гибкость", bar.lambdaLimit, "", 0),
      row("Коэффициент φ", bar.phi, "", 3),
      row("Несущая способность", bar.capacity, "кН"),
      { label: "Определяющий снег", text: caseLabel[bar.snowCase] ?? bar.snowCase ?? "—" },
      row("Шаг ферм", zone.actualSpacing ?? zone.spacing, "м", 3),
    ],
  };
}

function frameAnalysis(r, board) {
  const zone = (r.roofModel?.zones ?? []).find((z) => z.id === board.zoneId);
  const m = zone?.frameAnalysis?.members?.find((q) => q.id === board.frameMemberId);
  if (!m) return null;
  const u = Math.max(
    ...[m.interaction, m.shearUtilization, m.axialUtilization, m.compressionStabilityUtilization].filter(
      finite,
    ),
    0,
  );
  const slender = slendernessRow(m.lambda, m.lambdaLimit);
  return {
    source: "frame",
    title: `Элемент рамы ${m.id}`,
    status: strengthStatus(u, slender),
    utilization: u,
    slenderness: slender,
    rows: [
      governing([
        ["изгиб со сжатием", m.interaction],
        ["срез у запила", m.notchShear?.utilization],
        ["срез", m.notchShear ? null : m.shearUtilization],
        ["устойчивость", m.compressionStabilityUtilization],
      ]),
      slender,
      row("Момент max", m.maxMoment, "кН·м"),
      row("Поперечная сила max", m.maxShear, "кН"),
      row("Сжатие max", m.maxCompression, "кН"),
      row("Растяжение max", m.maxTension, "кН"),
      row("Напряжение изгиба", m.bendingStress, "МПа"),
      row("Касательное напряжение", m.shearStress, "МПа"),
      ...(m.notchShear ? [row("Срез у запила (kv)", m.notchShear.utilization, "", 2)] : []),
      row("Взаимодействие N+M", m.interaction, "", 2),
      row("Гибкость λ", m.lambda, "", 0),
      row("Коэффициент ξ", m.xi, "", 3),
      row("Прогиб", m.deflectionMM, "мм", 1),
      row("Предел прогиба", m.limitMM, "мм", 1),
    ],
  };
}

function rafterAnalysis(r, board) {
  const zone = (r.roofModel?.zones ?? []).find((z) => z.id === board.zoneId);
  const a = zone?.rafterAnalysis;
  if (!a || !a.valid) return null;
  return {
    source: "rafter",
    title: "Стропило: изгиб со сжатием",
    status: a.status,
    utilization: a.utilization,
    rows: [
      governing([
        ["изгиб", a.bendingUtilization],
        ["изгиб со сжатием", a.interactionUtilization],
        ["срез", a.shearUtilization],
        ["прогиб", a.deflectionUtilization],
        ["прогиб с ползучестью", a.finalDeflectionUtilization],
      ]),
      row("Пролёт по горизонтали", a.horizontalSpan ?? a.span, "м", 3),
      row("Уклон", a.pitch, "°", 1),
      row("Шаг стропил", a.input?.spacing, "м", 3),
      row("Нагрузка расчётная", a.lineLoadDesign, "кН/м"),
      row("Момент M", a.moment, "кН·м"),
      row("Поперечная сила Q", a.shear, "кН"),
      row("Продольная сила N", a.axialMax, "кН"),
      row("Напряжение изгиба", a.stress, "МПа"),
      row("Загрузка изгиб+сжатие", a.interactionUtilization, "", 2),
      row("Прогиб", a.normalDeflection, "мм", 1),
      row("Предел прогиба", a.normalDeflectionAllowed ?? a.deflectionAllowed, "мм", 1),
    ],
  };
}

function grillageAnalysis(r, board) {
  const spans = (r.grillageModel?.spans ?? []).filter(
    (s) =>
      s.beamId === board.beamId &&
      s.stationEnd > (board.stationStart ?? -Infinity) + 1e-6 &&
      s.stationStart < (board.stationEnd ?? Infinity) - 1e-6,
  );
  if (!spans.length) return null;
  const worst = maxBy(spans, (s) => s.check?.utilization ?? 0);
  const pile = (id) => (r.piles ?? []).find((q) => q.id === id);
  const piles = [...new Set(spans.flatMap((s) => [s.startPileId, s.endPileId]))].map(pile).filter(Boolean);
  return {
    source: "grillage",
    title: `Ростверк ${board.beamId}: пролёты под доской`,
    status: worst.check?.status,
    utilization: worst.check?.utilization,
    rows: [
      row("Пролётов под доской", spans.length, "шт.", 0),
      row("Пакет", worst.plies, "сл.", 0),
      { label: "Худший пролёт", text: `${worst.id} · ${(worst.length ?? 0).toFixed(2)} м` },
      row("Нагрузка на пролёт", worst.designTotal, "кН"),
      row("Момент max", worst.check?.maxMoment, "кН·м"),
      row("Поперечная сила max", worst.check?.maxShear, "кН"),
      row("Напряжение изгиба", worst.check?.bendingStress, "МПа"),
      row("Прогиб", worst.check?.deflection, "мм", 1),
      row("Предел прогиба", worst.check?.deflectionLimit, "мм", 1),
      ...piles.map((q) => row(`Реакция сваи ${q.id}`, q.reactionEnvelope ?? q.reaction, "кН")),
    ],
  };
}

function wallStudFromRoofPath(r, board) {
  const ws = r.sourceRoofMechanics?.wallStuds;
  if (!ws?.studs?.length) return null;
  const s = ws.studs.find((q) => q.id === board.id);
  if (!s)
    return {
      source: "wallStud",
      title: "Стойка стены: нагрузка от кровли",
      status: "pass",
      utilization: null,
      rows: [{ label: "Реакции кровли", text: "на эту стойку не приходят" }],
      note:
        board.role === "cripple"
          ? "Укороченная стойка под подоконником/над перемычкой: вертикальную нагрузку от кровли не несёт."
          : "По фактическому пути нагрузки реакции кровли уходят на соседние стойки; эта несёт собственный вес стены.",
    };
  const slenderWS = slendernessRow(s.lambda, s.lambdaLimit),
    uWS = Math.max(s.compressionUtilization ?? 0, s.bearingUtilization ?? 0);
  return {
    source: "wallStud",
    title: "Стойка стены: сжатие от фактических реакций кровли",
    status: strengthStatus(uWS, slenderWS),
    utilization: uWS,
    slenderness: slenderWS,
    rows: [
      governing([
        ["устойчивость φ", s.compressionUtilization],
        ["смятие обвязки", s.bearingUtilization],
      ]),
      slenderWS,
      row("Сжимающее усилие N", s.N, "кН"),
      row("в т.ч. от кровли", s.roofDesign, "кН"),
      row("Реакций сверху", s.roofReactions, "шт.", 0),
      row("Грузовая ширина", s.tributaryWidth, "м", 3),
      row("Длина", s.length, "м", 3),
      row("Раскрепление слабой оси", s.weakAxisLength, "м", 2),
      row("Гибкость λ", s.lambda, "", 0),
      row("Коэффициент φ", s.phi, "", 3),
      row("Несущая способность φ·Rc·A", s.capacity, "кН"),
      row("Смятие нижней обвязки σ", s.bearingStress, "МПа"),
      row("Rсм90", s.bearingLimit, "МПа"),
    ],
    note: "Каждая реакция досок кровли передаётся на ближайшую несущую стойку под обвязкой.",
  };
}

function studAnalysis(r, board) {
  const walls = r.studMechanics?.walls ?? [];
  const s =
    walls.find((q) => q.id === board.id) ?? walls.find((q) => q.wallId === board.wallId && !q.measured);
  if (!s) return null;
  return {
    source: "stud",
    title: s.measured ? "Стойка: фактическое сжатие" : "Стойка: сжатие и устойчивость (представительная)",
    status: s.status,
    utilization: s.utilization,
    rows: [
      row("Сжимающее усилие N", s.force, "кН"),
      row("Грузовая ширина", s.tributaryWidth, "м", 3),
      row("Длина", s.length, "м", 3),
      {
        label: "Раскрепление слабой оси",
        text: s.weakAxisRestraint === "sheathing" ? `обшивкой, шаг ${s.unbracedLength} м` : "не раскреплена",
      },
      row("Гибкость λ", s.lambda, "", 0),
      row("Предельная гибкость", s.lambdaLimit, "", 0),
      row("Коэффициент φ", s.phi, "", 3),
      row("Несущая способность φ·Rc·A", s.capacity, "кН"),
    ],
    note: s.measured ? null : r.studMechanics?.note,
  };
}

function plateAnalysis(r, board) {
  const ws = r.sourceRoofMechanics?.wallStuds?.studs?.filter((q) => q.wallId === board.wallId);
  if (ws?.length) {
    const w = ws.reduce((a, q) => (q.bearingUtilization > a.bearingUtilization ? q : a));
    return {
      source: "plate",
      title: "Обвязка: смятие поперёк волокон под самой нагруженной стойкой стены",
      status: w.bearingUtilization > 1 ? "fail" : "pass",
      utilization: w.bearingUtilization,
      rows: [
        row("Усилие от стойки", w.N, "кН"),
        { label: "Стойка", text: w.id },
        row("Напряжение смятия σ", w.bearingStress, "МПа"),
        row("Rсм90", w.bearingLimit, "МПа"),
      ],
      note: "Усилия стоек — по фактическим реакциям кровли на эту стену.",
    };
  }
  const s = (r.studMechanics?.walls ?? []).find((q) => q.wallId === board.wallId && !q.measured);
  if (!s || !finite(s.force)) return null;
  const Fc90 = r.project?.material?.Fc90 ?? 3,
    sigma = (s.force * 1000) / (s.b * s.h);
  return {
    source: "plate",
    title: "Обвязка: смятие поперёк волокон под стойкой",
    status: sigma > Fc90 ? "fail" : "pass",
    utilization: sigma / Fc90,
    rows: [
      row("Усилие от стойки", s.force, "кН"),
      { label: "Площадка смятия", text: `${s.b} × ${s.h} мм` },
      row("Напряжение смятия σ", sigma, "МПа"),
      row("Rсм90", Fc90, "МПа"),
      row("Шаг стоек (грузовая ширина)", s.tributaryWidth, "м", 3),
    ],
    note: "Нижняя обвязка воспринимает усилие стойки поперёк волокон (СП 64, Rсм90).",
  };
}

// Engine checks that describe a member type as a whole (representative checks without ids).
const ROLE_CHECKS = [
  [STUD_ROLES, /^designerStud/],
  [new Set(["plate"]), /^designerStudPlateBearing$|^source-roof-wall-plate-bearing$/],
  [STUD_ROLES, /^source-roof-wall-studs$/],
  [new Set(["joist"]), /^designerJoist|^designerFloorVibration$|^floor-(supports|stock|blocking)-L/],
  [new Set(["grillagePly"]), /^grillage-|^pileCapacity$|^designerGrillagePileBearing$/],
  [new Set(["top", "bottom", "web", "rafter", "topChord"]), /^designerRoofHeelBearing$/],
];

function sourceRoofAnalysis(r, board) {
  const m = r.sourceRoofMechanics?.members?.[board.id];
  if (!m) return null;
  const nameOf = (id) => {
    const b = r.timber?.instances?.find((q) => q.id === id);
    return b ? `${roleLabels[b.role] ?? b.name ?? b.role} ${id}` : id;
  };
  const path = [
    { label: "Нагрузку передают", text: m.from?.length ? `${m.from.length} элем.` : "—" },
    {
      label: "Опирается на",
      text: m.supports?.length
        ? m.supports.slice(0, 3).map(nameOf).join("; ") +
          (m.supports.length > 3 ? ` и ещё ${m.supports.length - 3}` : "")
        : "опора не найдена",
    },
  ];
  if (m.kind === "axial") {
    const slenderAx = slendernessRow(m.lambda, m.lambdaLimit),
      uAx = Math.max(m.compressionUtilization ?? 0, m.bearingUtilization ?? 0);
    return {
      source: "sourceRoof",
      title: "Сжатый элемент кровли: усилие по пути нагрузки",
      status: strengthStatus(uAx, slenderAx, m.status),
      utilization: uAx,
      slenderness: slenderAx,
      rows: [
        governing([
          ["устойчивость φ", m.compressionUtilization],
          ["смятие опоры", m.bearingUtilization],
        ]),
        slenderAx,
        row("Сжимающее усилие N", m.N, "кН"),
        row("N нормативное", m.Ncharacteristic, "кН"),
        row("Длина", m.length, "м", 3),
        row("Гибкость λ", m.lambda, "", 0),
        row("Предельная гибкость", m.lambdaLimit, "", 0),
        row("Коэффициент φ", m.phi, "", 3),
        row("Несущая способность φ·Rc·A", m.capacity, "кН"),
        ...(m.bearingStress !== undefined
          ? [row("Смятие опоры σ", m.bearingStress, "МПа"), row("Rсм90", m.bearingLimit, "МПа")]
          : []),
        ...(m.horizontalThrust > 0.01 ? [row("Горизонтальная составляющая", m.horizontalThrust, "кН")] : []),
        ...path,
      ],
      note: m.note,
    };
  }
  return {
    source: "sourceRoof",
    title: m.passThrough
      ? "Элемент кровли: работает вместе с нижней доской"
      : "Элемент кровли: неразрезная балка по фактическим опорам",
    status: m.status,
    utilization: m.utilization,
    rows: [
      governing([
        ["изгиб", m.bendingUtilization],
        ["срез", m.shearUtilization],
        ["прогиб", m.deflectionUtilization],
      ]),
      ...(m.tributaryWidth ? [row("Грузовая ширина", m.tributaryWidth, "м", 3)] : []),
      row("Равномерная нагрузка расчётная", m.lineLoadDesign, "кН/м"),
      row("Сосредоточенных нагрузок", m.pointLoads ?? 0, "шт.", 0),
      row("Опор", m.supportCount ?? m.supports?.length ?? 0, "шт.", 0),
      row("Определяющий пролёт", m.governingSpan, "м", 2),
      row("Момент max", m.maxMoment, "кН·м"),
      row("Поперечная сила max", m.maxShear, "кН"),
      row("Напряжение изгиба", m.bendingStress, "МПа"),
      row("Прогиб", m.deflection, "мм", 1),
      row("Предел прогиба", m.deflectionLimit, "мм", 1),
      ...(m.reactions ?? []).slice(0, 4).map((q) => row(`Реакция → ${nameOf(q.support)}`, q.design, "кН")),
      ...path,
    ],
    note: m.note,
  };
}

function beamCourseAnalysis(r, board) {
  const w = r.profiledBeam?.walls.find((w) => w.wallId === board.wallId && w.level === board.level);
  if (!w) return null;
  return {
    source: "profiledBeam",
    title: "Брусовая стена: венец и усадка",
    status: "unverified",
    utilization: w.bottomBearing?.utilization,
    rows: [
      row("Венец", board.course, "", 0),
      row("Всего венцов", w.courseCount, "", 0),
      {
        label: "Стыки венца от начала стены, м",
        text:
          w.courses
            .find((c) => c.course === board.course)
            ?.splices.map((s) => s.toLocaleString("ru-RU", { maximumFractionDigits: 3 }))
            .join("; ") || "Нет",
      },
      row(
        "Нагелей по венцу стены",
        r.profiledBeam.dowels.filter(
          (d) => d.wallId === board.wallId && d.level === board.level && d.course === board.course,
        ).length,
        "шт.",
        0,
      ),
      // Settlement ratio is the existing engine supplier assumption; do not divide a cropped top course equally.
      row(
        "Доля усадки этого венца · допущение",
        ((w.courses.find((c) => c.course === board.course)?.top ?? 0) -
          (w.courses.find((c) => c.course === board.course)?.bottom ?? 0)) *
          w.settlementRatio *
          1000,
        "мм",
        2,
      ),
      row("Рабочая высота", w.courseHeight * 1000, "мм", 0),
      row("Масса венцов дома", r.profiledBeam.mass, "кг", 1),
      row("Сила у основания стены", w.designCompression, "кН"),
      row("Смятие нижнего венца", w.bottomBearing?.stress, "МПа", 3),
      row("Усадка стены · допущение", w.settlementMM, "мм", 0),
      row("Изгиб от ветра", w.wind?.stress, "МПа"),
    ],
    note: "Углы, нагели, площадь контакта профиля и скользящие примыкания не подтверждены. Чистый объём учитывает показанные выборки; закупка — полное сечение по карте 6 м.",
  };
}
function relatedChecks(r, board) {
  const keys = [board.id, board.memberId].filter(Boolean);
  const roleRules = ROLE_CHECKS.filter(([roles]) => roles.has(board.role)).map(([, re]) => re);
  const out = [];
  for (const c of r.checks ?? []) {
    const byScope =
      roleRules.some((re) => re.test(c.id)) ||
      (board.wallId && c.wallId === board.wallId) ||
      (board.zoneId && c.zoneId === board.zoneId) ||
      (board.beamId && c.beamId === board.beamId);
    let byId = false;
    if (!byScope && /^source-roof-members-/.test(c.id)) {
      const ids = [...(c.failIds ?? []), ...(c.unverifiedIds ?? []), c.worstId];
      if (ids.includes(board.id) || r.sourceRoofMechanics?.members?.[board.id]) {
        const m = r.sourceRoofMechanics?.members?.[board.id];
        const mine =
          m &&
          ((c.id.endsWith("axial") && m.kind === "axial") ||
            (c.id.endsWith("rafters") && /rafter/i.test(m.role)) ||
            (c.id.endsWith("beams") && m.kind === "beam" && !/rafter/i.test(m.role)));
        if (mine)
          out.push({
            id: c.id,
            label: c.label,
            status: m.status,
            utilization: finite(m.utilization) ? m.utilization : null,
            direct: true,
          });
      }
      continue;
    }
    if (!byScope) {
      const s = JSON.stringify(c);
      byId = keys.some((k) => s.includes(`"${k}"`));
    }
    if (byScope || byId)
      out.push({
        id: c.id,
        label: c.label,
        status: c.status,
        utilization: finite(c.utilization) ? c.utilization : null,
        direct: byId,
      });
  }
  const rank = { fail: 0, warning: 1, unverified: 2, pass: 3 };
  return out.sort(
    (a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || (b.utilization ?? 0) - (a.utilization ?? 0),
  );
}

export function memberInsight(report, id) {
  const r = report?.result;
  const board = r?.timber?.instances?.find((b) => b.id === id);
  if (!board) return null;
  const role = board.role;
  const analysis =
    (role === "beamCourse" && beamCourseAnalysis(r, board)) ||
    sourceRoofAnalysis(r, board) ||
    (role === "joist" && joistAnalysis(r, board)) ||
    (TRUSS_ROLES.has(role) && trussAnalysis(r, board)) ||
    (board.frameMemberId && frameAnalysis(r, board)) ||
    (role === "rafter" && rafterAnalysis(r, board)) ||
    (role === "grillagePly" && grillageAnalysis(r, board)) ||
    (STUD_ROLES.has(role) && (wallStudFromRoofPath(r, board) ?? studAnalysis(r, board))) ||
    (role === "plate" && board.platePosition !== "top" && plateAnalysis(r, board)) ||
    null;
  if (analysis) analysis.rows = analysis.rows.filter(Boolean);
  const facts = [
    { label: "Назначение", text: roleLabels[role] ?? board.name ?? role },
    { label: "Сечение", text: `${board.b} × ${board.h} мм` },
    row("Длина по оси", board.length, "м", 3),
    row("Длина заготовки", board.actualCutLength ?? board.cutLength ?? board.length, "м", 3),
    row("Масса", board.mass, "кг", 1),
    row("Собственный вес", finite(board.mass) ? (board.mass * G) / 1000 : null, "кН", 3),
    ...((board.level ?? board.floor) ? [row("Этаж", board.level ?? board.floor, "", 0)] : []),
    ...(board.wallId
      ? [
          {
            label: "Стена",
            text: humanLabel(
              { wallId: board.wallId },
              { type: "wall", project: r.project ?? report.project },
            ),
          },
        ]
      : []),
    ...(board.zoneId ? [{ label: "Зона кровли", text: board.zoneId }] : []),
    ...(board.beamId ? [{ label: "Балка ростверка", text: board.beamId }] : []),
  ];
  return {
    board: { id: board.id, name: board.name, role, b: board.b, h: board.h },
    facts,
    cutting: cuttingInsight(report, board),
    analysis,
    checks: relatedChecks(r, board),
  };
}

import { loadFactors, loadProfile, windK, windTerrain } from "./load-profile.js";
import { checkFullHeightWall } from "./wall-stability.js";
import { timberSections, parseSection } from "./catalog.js";
const EPS = 1e-6,
  dot = (a, b) => a.x * b.x + a.y * b.y,
  dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (q, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j],
      dx = b.x - a.x,
      dy = b.y - a.y,
      cross = (q.x - a.x) * dy - (q.y - a.y) * dx;
    if (
      Math.abs(cross) < 1e-6 &&
      q.x >= Math.min(a.x, b.x) - EPS &&
      q.x <= Math.max(a.x, b.x) + EPS &&
      q.y >= Math.min(a.y, b.y) - EPS &&
      q.y <= Math.max(a.y, b.y) + EPS
    )
      return true;
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
const unique = (a) => a.sort((a, b) => a - b).filter((q, i, p) => !i || Math.abs(q - p[i - 1]) > EPS);
export function wallProfileTop(profile, s) {
  const p = profile?.topSamples ?? [];
  if (!p.length) return profile?.highTop;
  const x = Math.max(0, Math.min(profile.length, s));
  for (let i = 1; i < p.length; i++)
    if (x <= p[i].s + EPS) {
      const a = p[i - 1],
        b = p[i];
      return a.topY + ((b.topY - a.topY) * (x - a.s)) / (b.s - a.s || 1);
    }
  return p.at(-1).topY;
}
export function deriveWallProfiles(project, base, roof) {
  const profiles = [],
    mode = project.roof?.wallFraming ?? "auto";
  for (const level of base.geometry?.levels ?? [])
    for (const wall of project.walls ?? []) {
      if ((wall.level !== undefined && wall.level !== level.index) || wall.kind === "partition") continue;
      const length = dist(wall.a, wall.b),
        u = { x: (wall.b.x - wall.a.x) / length, y: (wall.b.y - wall.a.y) / length },
        ranges = [];
      for (const zone of roof.zones ?? []) {
        if (zone.shape !== "mono" || zone.effectiveFraming !== "rafters" || zone.levelIndex !== level.index)
          continue;
        const t = (zone.ridgeAngle * Math.PI) / 180,
          c = Math.cos(t),
          s = Math.sin(t),
          bearingBounds = zone.bearingBounds ?? zone.bounds,
          bearingPolygon = zone.bearingPolygon ?? zone.polygon,
          height = (q) =>
            zone.eave +
            Math.tan((zone.pitchLeft * Math.PI) / 180) * (-q.x * s + q.y * c - bearingBounds.minV);
        for (let i = 0; i < bearingPolygon.length; i++) {
          const a = bearingPolygon[i],
            b = bearingPolygon[(i + 1) % bearingPolygon.length];
          const cross = (q) => (q.x - wall.a.x) * u.y - (q.y - wall.a.y) * u.x;
          if (Math.abs(cross(a)) > EPS || Math.abs(cross(b)) > EPS) continue;
          const pa = dot({ x: a.x - wall.a.x, y: a.y - wall.a.y }, u),
            pb = dot({ x: b.x - wall.a.x, y: b.y - wall.a.y }, u),
            from = Math.max(0, Math.min(pa, pb)),
            to = Math.min(length, Math.max(pa, pb));
          if (to - from > EPS) ranges.push({ from, to, zone, height });
        }
      }
      if (!ranges.length) continue;
      const times = unique([0, length, ...ranges.flatMap((r) => [r.from, r.to])]),
        samples = [],
        covered = [];
      let conflict = false;
      for (let i = 1; i < times.length; i++) {
        const a = times[i - 1],
          b = times[i],
          mid = (a + b) / 2,
          own = ranges.filter((r) => mid >= r.from - EPS && mid <= r.to + EPS);
        if (!own.length) continue;
        covered.push(b - a);
        for (const x of [a, b]) {
          const q = { x: wall.a.x + u.x * x, y: wall.a.y + u.y * x },
            ys = own.map((r) => r.height(q));
          if (Math.max(...ys) - Math.min(...ys) > 0.01) conflict = true;
          const topY = Math.max(...ys);
          const old = samples.find((s) => Math.abs(s.s - x) < EPS);
          if (old && Math.abs(old.topY - topY) > 0.01) conflict = true;
          else if (!old) samples.push({ s: x, topY });
        }
      }
      samples.sort((a, b) => a.s - b.s);
      const coverage = covered.reduce((a, b) => a + b, 0),
        whole = coverage >= length - EPS;
      const highTop = Math.max(level.topY, ...samples.map((s) => s.topY)),
        lowTop = Math.min(...samples.map((s) => s.topY));
      const profile = {
        wallId: wall.id,
        level: level.index,
        length,
        baseY: level.wallBaseY,
        nominalTopY: level.topY,
        seamY: level.topY,
        topSamples: samples,
        topAtA: samples[0]?.topY ?? level.topY,
        topAtB: samples.at(-1)?.topY ?? level.topY,
        lowTop,
        highTop,
        zoneIds: [...new Set(ranges.map((r) => r.zone.id))],
        requestedSection: wall.section,
        section: wall.section,
        mode: mode === "stacked" ? "stacked" : "continuous",
        reason:
          "Цельные стойки от нижней обвязки до верхней линии стены; промежуточного стыка на высоте этажа нет.",
      };
      if (!whole || conflict || lowTop < level.topY - 0.01) {
        profile.mode = "blocked";
        profile.reason = !whole
          ? "Скат покрывает только часть этой стены. Разделите стену на панели по границам кровли; автоматическая надстройка не назначена."
          : conflict
            ? "Соседние скаты задают разные высоты стены. Нужен отдельный узел сопряжения."
            : "Скат ниже заданной высоты стены. Исправьте отметку кровли или высоту стены.";
      }
      const hitsUpper = (base.geometry?.levels ?? [])
        .filter((l) => l.index > level.index && l.closed)
        .some((l) =>
          samples.some(
            (sample) =>
              sample.topY > level.topY + 0.01 &&
              inside({ x: wall.a.x + u.x * sample.s, y: wall.a.y + u.y * sample.s }, l.polygon),
          ),
        );
      if (hitsUpper && profile.mode !== "stacked") {
        profile.mode = "blocked";
        profile.reason =
          "Подъём стены пересекает межэтажную платформу или угловой пакет верхнего этажа. Нужна отдельная панель и узел сопряжения; дублирующая стойка не создаётся.";
      }
      const reaction = { design: 0, service: 0 };
      for (const r of ranges) {
        const z = r.zone,
          a = z.rafterAnalysis;
        if (!a) continue;
        const theta = (z.ridgeAngle * Math.PI) / 180,
          factor = Math.abs(u.x * Math.cos(theta) + u.y * Math.sin(theta)),
          share = (r.to - r.from) / length,
          mid = (r.from + r.to) / 2,
          point = { x: wall.a.x + u.x * mid, y: wall.a.y + u.y * mid },
          v = -point.x * Math.sin(theta) + point.y * Math.cos(theta),
          bounds = z.bearingBounds ?? z.bounds,
          end = v > (bounds.minV + bounds.maxV) / 2 ? "B" : "A";
        reaction.design +=
          ((a.reactions?.["vertical" + end] ?? 0) / (z.actualSpacing || z.spacing)) * factor * share;
        reaction.service +=
          ((a.reactions?.["serviceVertical" + end] ?? 0) / (z.actualSpacing || z.spacing)) * factor * share;
      }
      profile.roofReactionLine = reaction;
      const requested = parseSection(wall.section),
        B = requested.b / 1000,
        n = Math.max(1, Math.ceil((length - EPS) / wall.studStep));
      const trial = (section) =>
        checkFullHeightWall({
          wallId: wall.id,
          level: level.index,
          studs: Array.from({ length: n + 1 }, (_, i) => ({
            id: "trial-" + i,
            b: section.b,
            h: section.h,
            length: Math.max(
              0.01,
              wallProfileTop(profile, (length * i) / n) - profile.baseY - (3 * section.b) / 1000,
            ),
            tributaryWidth: wall.studStep,
          })),
          roofReactionLine: reaction,
          // w0·k(ze) at the wall top, c = 0,8 + 0,2 (СП 20.13330.2016 п. 11.1.3).
          wind:
            (project.loads?.wind ?? 0) *
            windK(
              Math.max(...profile.topSamples.map((q) => q.topY)),
              windTerrain(project.loads),
              loadProfile(project.loads),
            ),
          gammaG: loadFactors(project.loads ?? {}).equivalentG,
          gammaQ: loadFactors(project.loads ?? {}).equivalentQ,
          E: project.material?.E ?? 10000,
          Emin: project.material?.Emin,
          Fc: project.material?.Fc ?? 12,
          Ft: project.material?.Ft ?? 8,
          Fb: project.material?.Fb ?? 13,
          Fv: project.material?.Fv ?? 1.5,
          density: project.material?.density ?? 500,
          wallDead:
            (project.loads?.wallDead ?? 0.5) +
            ((project.bracing?.method ?? "sheathing") === "sheathing"
              ? (((project.bracing?.thickness ?? 12) / 1000) *
                  (project.bracing?.sheetDensity ?? 650) *
                  9.80665) /
                1000
              : 0),
          deflectionRatio: project.material?.wallDeflectionRatio ?? 200,
          K: project.material?.columnK ?? 1,
        });
      profile.trial = trial(requested);
      if (mode === "auto" && profile.mode === "continuous" && !profile.trial.capacityPass) {
        for (const candidate of timberSections
          .filter((s) => s.category === "board" && s.b === requested.b && s.h > requested.h && s.h <= 250)
          .sort((a, b) => a.h - b.h)) {
          const result = trial(candidate);
          if (result.capacityPass) {
            profile.section = candidate.id;
            profile.trial = result;
            profile.reason = `Автоподбор цельной стены: ${wall.section.replace("x", " × ")} → ${candidate.id.replace("x", " × ")} мм по полной высоте стойки, ветру и нагрузке кровли.`;
            break;
          }
        }
      }
      const chosen = parseSection(profile.section);
      profile.studMaxLength = highTop - profile.baseY - (3 * chosen.b) / 1000;
      profile.stockFits = profile.studMaxLength <= 6 + EPS;
      profile.capacityPass = profile.trial.capacityPass;
      if (profile.mode === "stacked")
        profile.reason =
          "Составная стена выбрана явно. Горизонтальный силовой стык, раскрепление и соединения не подтверждены.";
      else if (profile.mode === "continuous" && !profile.stockFits)
        profile.reason =
          "Цельная стойка длиннее 6 м. Автоматическое наращивание не применяется; нужна другая конструктивная схема.";
      else if (profile.mode === "continuous" && !profile.capacityPass)
        profile.reason =
          "Цельная стена показана, но частные проверки полной стойки превышены. Измените сечение, шаг или расчётную схему.";
      profiles.push(profile);
    }
  return profiles;
}

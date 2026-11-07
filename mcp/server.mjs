#!/usr/bin/env node
import {
  annexSchema,
  doubleHeightConfigurationSchema,
  profiledWallFeaturesSchema,
} from "./project-features.mjs";
import { analyzeEnvelope } from "../src/hygrothermal.js";
import { compareFoundationOptions } from "../src/foundation-options.js";
import { createReadOnlyPreview } from "./preview.mjs";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import * as z from "zod/v4";
import { createHouseEngine, engineCatalog, ENGINE_VERSION } from "../src/house-engine.js";
import { EngineError } from "../src/house-engine.js";
import { proposeFixes, optimize } from "../src/solutions.js";
import { siteLoads, SNOW_REGIONS, WIND_REGIONS } from "../src/site-loads.js";
import { LAYOUT_STRATEGIES } from "../src/house-generator.js";
const num = (a, b) => z.number().finite().min(a).max(b);
const point = z.object({ x: num(-1000, 1000), y: num(-1000, 1000) }).strict();
const polygon = z.array(point).min(3).max(100);
const section = z
  .string()
  .regex(/^\d{2,3}[x×]\d{2,3}$/)
  .describe("Номинальное сечение b×h мм, например 50x200. Проверка прочности выполняется отдельно.");
const overhangs = z
  .object({
    low: num(0, 2).optional(),
    high: num(0, 2).optional(),
    start: num(0, 2).optional(),
    end: num(0, 2).optional(),
  })
  .strict()
  .describe(
    "Horizontal projection in metres. U=(cos azimuth,sin azimuth): start=minU, end=maxU; V=(-sin azimuth,cos azimuth): low=minV, high=maxV. Wall bearings stay on the original polygon. Nonzero overhangs require rectangular mono rafters or symmetric gable trusses with raised heels. Side wings require auxiliaryTimber.",
  );
const loads = z
  .object({
    floorDead: num(0, 20).optional(),
    live: num(0, 20).optional(),
    roofDead: num(0, 20).optional(),
    wallDead: num(0, 20).optional(),
    openingDead: num(0, 20).optional(),
    snow: num(0, 20).optional(),
    wind: num(0, 5).optional(),
    terrain: z.enum(["A", "B", "C"]).optional().describe("Тип местности СП 20 п.11.1.6; по умолчанию B."),
    snowCe: num(0.1, 2).optional().describe("Коэффициент сноса снега ce (СП 20 п.10.5), по умолчанию 1."),
    snowCt: num(0.1, 2).optional().describe("Термический коэффициент ct (СП 20 п.10.10), по умолчанию 1."),
    code: z.enum(["SP20-2016"]).optional().describe("Профиль норм нагрузок; по умолчанию SP20-2016."),
    psi2: num(0, 1).optional().describe("Доля длительной части полезной нагрузки для ползучести."),
    gammaG: num(1, 3).optional(),
    gammaQ: num(1, 3).optional(),
  })
  .strict();
const material = z
  .object({
    density: num(100, 1500).optional(),
    E: num(1000, 30000).optional(),
    Emin: num(500, 30000).optional(),
    Fb: num(1, 60).optional(),
    Ft: num(0.5, 60).optional(),
    Fc: num(0.5, 80).optional(),
    Fv: num(0.1, 20).optional(),
    studRestraint: num(0.2, 8).optional(),
    columnK: num(0.5, 2).optional(),
    Fc90Full: num(0.1, 20)
      .optional()
      .describe(
        "Расчётное Rс90 по всей площади, МПа; прежнее допущение 1,8, подтвердить с коэффициентами СП64.",
      ),
    Fc90: num(0.5, 20).optional().describe("Расчётное Rсм90, МПа (по умолчанию 3.0)."),
    Fc90PartialLength: z.boolean().optional(),
    grade: z.enum(["1", "2", "3"]).optional(),
    kdef: num(0, 3).optional(),
    finalDeflectionRatio: num(100, 600).optional(),
    wallDeflectionRatio: num(100, 600).optional(),
    studSheathingRestraint: z.boolean().optional(),
  })
  .strict()
  .describe("Расчётные сопротивления СП 64 с учётом m_дл (не характеристические значения вроде C24).");
const patch = z
  .object({
    op: z.enum(["add", "replace", "remove"]),
    path: z
      .string()
      .min(2)
      .max(300)
      .describe("RFC6901 JSON Pointer in project; e.g. /roof/zones/0/shape or /walls/0/section"),
    value: z.unknown().optional(),
  })
  .strict();
const id = z.string().regex(/^house-[a-f0-9-]{36}$/),
  revision = z.number().int().positive();
const ref = { project_id: id, revision: revision.optional() };
const siteSchema = z
  .object({
    city: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe("Город/населённый пункт России (справочная таблица СП 20)."),
    snowRegion: z.enum(Object.keys(SNOW_REGIONS)).optional(),
    windRegion: z.enum(Object.keys(WIND_REGIONS)).optional(),
    terrain: z.enum(["A", "B", "C"]).optional(),
  })
  .strict()
  .describe(
    "Площадка → нормативные Sg/w0 по СП 20.13330.2016 и справочная глубина промерзания. Явные регионы важнее города; явные loads важнее площадки.",
  );
const generationSchema = z
  .object({
    name: z.string().max(160).optional(),
    wallSystem: z
      .enum(["frame", "profiledBeam"])
      .optional()
      .describe("Система наружных стен; по умолчанию frame."),
    beamSection: z
      .enum(["90x140", "140x140", "140x190", "145x145", "145x195", "190x190", "195x195", "200x200"])
      .optional()
      .describe("Обязательно для profiledBeam; ширина × высота, мм. Рабочую высоту подтвердить."),
    strategy: z
      .enum(Object.keys(LAYOUT_STRATEGIES))
      .optional()
      .describe("Стратегия планировки; без неё генератор перебирает стратегии до первой подходящей."),
    site: siteSchema.optional(),
    studStep: num(0.2, 1.2).optional().describe("Шаг стоек всех стен, м (по умолчанию 0.6)."),
    joistSpacing: num(0.2, 1.2).optional().describe("Шаг лаг перекрытий, м (по умолчанию 0.6)."),
    stair: z.boolean().optional().describe("false — не создавать автоматическую U-лестницу для двух этажей."),
    structure: z
      .object({
        maxJoistSpan: num(1.5, 12).optional().describe("Целевой максимальный пролёт лаг, м."),
        bearingWalls: z.boolean().optional().describe("false — не назначать несущие внутренние стены."),
      })
      .strict()
      .optional(),
    template: z.enum(["rectangle", "l-shape"]).optional(),
    width: num(2, 60).optional(),
    depth: num(2, 60).optional(),
    wingWidth: num(1, 50).optional(),
    wingDepth: num(1, 50).optional(),
    footprint: polygon.optional(),
    levels: z
      .array(z.object({ height: num(2, 5), footprint: polygon.optional() }).strict())
      .min(1)
      .max(2)
      .optional(),
    secondLight: z
      .object({ level: z.literal(2), polygon })
      .strict()
      .optional(),
    sections: z
      .object({
        walls: section.optional(),
        floor: section.optional(),
        roof: section.optional(),
        roofWeb: section.optional(),
        bracing: section.optional(),
        grillage: section.optional(),
      })
      .strict()
      .optional(),
    roof: z
      .object({
        shape: z.enum(["mono", "gable", "hip"]).optional(),
        pitch: num(2, 60).optional(),
        pitchRight: num(2, 60).optional(),
        ridgeAngle: num(0, 359.9).optional(),
        framing: z.enum(["auto", "rafters", "truss", "tiedRafters"]).optional(),
        wallFraming: z.enum(["auto", "continuous", "stacked"]).optional(),
        heelClearance: num(0, 1).optional(),
        ceilingDrop: num(0, 1).optional(),
        kneeRun: num(0.4, 1).optional(),
        collarHeightRatio: num(0.4, 0.9).optional(),
        tieSection: section.optional(),
        kneeSection: section.optional(),
        collarSection: section.optional(),
        collarConnection: z.enum(["inPlane", "faceLap"]).optional(),
        collarEndInset: num(0, 0.2).optional(),
        snowMu: num(0, 3).optional(),
        ceilingDead: num(0, 5).optional(),
        overhangs: overhangs.optional(),
      })
      .strict()
      .optional(),
    floor: z
      .object({
        section: section.optional(),
        spacing: num(0.2, 1.2).optional(),
        axis: z.enum(["x", "y"]).optional(),
        rimSection: section.nullable().optional(),
        blocking: z.boolean().optional(),
        blockingSection: section.nullable().optional(),
        blockingStep: num(0.3, 3).optional(),
        wallSupportFraming: z.boolean().optional(),
      })
      .strict()
      .optional(),
    loads: loads.optional(),
    material: material.optional(),
    foundation: z
      .object({
        spacing: num(0.5, 6).optional(),
        capacity: num(1, 1000).optional(),
        grillage: z
          .object({
            section: section.optional(),
            plies: z.number().int().min(2).max(6).optional(),
            deflectionRatio: num(100, 600).optional(),
            capSize: num(100, 1000).optional(),
            girderSpacing: num(0.5, 6).optional(),
            crossTies: z
              .object({
                spacing: num(0.5, 6),
                positions: z.array(num(-1000, 1000)).max(200).optional(),
                pileSpacing: num(0.5, 6).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    bracing: z
      .object({
        method: z.enum(["sheathing", "letIn", "none"]).optional(),
        section: section.optional(),
        designShear: num(0, 100).nullable().optional(),
        sheetSide: z.enum(["interior", "exterior"]).optional(),
      })
      .strict()
      .optional(),
    annexes: z.array(annexSchema).max(10).optional(),
    rooms: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            area: num(1, 500),
            level: z.number().int().min(1).max(2).optional(),
            minWidth: num(0.5, 15).optional(),
            minDepth: num(0.5, 15).optional(),
            bounds: z
              .object({
                minX: num(-1000, 1000),
                minY: num(-1000, 1000),
                maxX: num(-1000, 1000),
                maxY: num(-1000, 1000),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict();
// --- SOLUTIONS: verified fix proposals and bounded optimizer -------------
const jsonPointer = z.string().min(1).max(300).regex(/^\//);
const fixOptions = z
  .object({
    includeWarnings: z.boolean().optional(),
    warningThreshold: num(0.5, 1).optional(),
    maxEvaluations: z.number().int().min(1).max(60).optional(),
    perGroup: z.number().int().min(1).max(8).optional(),
    perCheck: z.number().int().min(1).max(5).optional(),
    checkIds: z.array(z.string().max(200)).max(100).optional(),
    keep: z.array(jsonPointer).max(50).optional(),
    allowAssumptions: z.boolean().optional(),
  })
  .strict();
const solutionsGuide = {
  tools: ["karkas_propose_fixes", "karkas_optimize"],
  proposeFixes:
    "For each failed (optionally near-limit) check: rule-table candidates per member group (floor joists: deeper section, spacing, joist axis, bearing line; studs: section, studStep, restraint; tall walls; rafters/trusses: section, spacing, framing/type; piles: spacing, plies, capacity; grillage: plies/section; bracing: sheathing). Each patch is applied to a copy and the whole house re-evaluated; only patches that lower the target utilization are returned, with before/after, new failed checks, cost delta and side effects.",
  optimize:
    "Deterministic coordinate descent: failed checks first, then sum of max(0,u-1), unplaced parts, cost; then one-step cheaper members while nothing new fails. goals.keep lists JSON pointers that must not change. apply=true commits the combined patch as a new revision via expected_revision.",
  kinds:
    "structural = physical member change; assumption = adopted value that must be confirmed (pile capacity, stud restraint). optimize excludes assumptions unless goals.allowAssumptions.",
};
const catalogWithSolutions = () => {
  const c = engineCatalog();
  return {
    ...c,
    solutions: solutionsGuide,
    additionalTools: [...(c.additionalTools ?? []), ...solutionsGuide.tools],
    workflow: (c.workflow ?? []).flatMap((step) =>
      step === "karkas_compare_variants"
        ? ["karkas_propose_fixes", "karkas_optimize(expected_revision, apply)", step]
        : [step],
    ),
  };
};
const summarizeFix = (f) => ({
  id: f.id,
  title: f.title,
  kind: f.kind,
  patch: f.patch,
  fixesTarget: f.fixesTarget,
  before: f.before.utilization ?? f.before.status,
  after: f.after.utilization ?? f.after.status,
  newFailedChecks: f.newFailedChecks,
  costDelta: f.costDelta,
});
export function createMcpServer({ engine = createHouseEngine() } = {}) {
  const preview = createReadOnlyPreview(engine);
  const server = new McpServer(
    { name: "karkas-engine", version: ENGINE_VERSION },
    {
      instructions:
        "A deterministic timber-frame house engine. Use the catalog first, generate/import a project, inspect failed AND unverified checks, get verified fixes with karkas_propose_fixes / karkas_optimize, apply transactional revisions, compare variants, export. Geometry and partial checks do not certify building safety. Never change material strength/density or loads merely to hide failures. All physical timber enters weight, 6 m cutting and procurement once.",
    },
  );
  const register = (name, description, schema, handler, readOnly = true) =>
    server.registerTool(
      name,
      {
        title: name,
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          idempotentHint: readOnly,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const out = await handler(args);
          return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
        } catch (e) {
          const out = {
            error: {
              code: e.code ?? "ENGINE_ERROR",
              message: e.message,
              details: e.details ?? e.errors ?? e.validation?.errors ?? null,
              retryable: ["REVISION_CONFLICT", "BUSY"].includes(e.code),
            },
          };
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(out) }],
            structuredContent: out,
          };
        }
      },
    );
  register(
    "karkas_catalog",
    "Материалы, единицы, схемы, ограничения, образец полного проекта и последовательность инструментов.",
    z.object({}).strict(),
    () => catalogWithSolutions(),
  );
  register(
    "karkas_generate",
    "Создать версионированный дом из размерного контура и программы помещений. Поддерживаются 1–2 этажа, L-план, второй свет, зоны крыш, пакетный ростверк. Генератор учитывает конструкцию: лаги и фермы по короткому пролёту, несущие стены коридора/хребта под перекрытием, U-лестница для двух этажей, несколько стратегий планировки. site:{city|snowRegion|windRegion|terrain} задаёт снег/ветер по СП 20; явные loads важнее, ответ site.fromSite показывает, что взято из таблицы. Возвращает ID, ревизию и итог расчёта, а не вымышленное одобрение.",
    generationSchema,
    (args) => engine.generate(args),
    false,
  );
  register(
    "karkas_generate_options",
    "Сгенерировать до count (≤6) различных стратегий планировки по одной спецификации и рассчитать каждую ядром без записи проекта. Возвращает ранжированную таблицу: невыполненные проверки, максимальное и суммарное превышение использования, смета, площади, пролёт лаг, длина стен, доля коммуникаций, ошибка площадей, окна. Сохраните выбранный вариант через karkas_generate с его strategy.",
    generationSchema.extend({ count: z.number().int().min(1).max(6).default(4) }),
    ({ count, ...spec }) => engine.generateOptions(spec, count),
  );
  register(
    "karkas_site_loads",
    "Площадка → нормативные нагрузки: город России или явные снеговой/ветровой районы → Sg (кПа, СП 20.13330.2016 табл. 10.1 / прил. К), w0 (кПа, табл. 11.1), тип местности, справочная нормативная глубина промерзания для суглинков (СП 22.13330.2016 п.5.5.3). Таблица городов справочная — уточняйте по картам СП 20 прил. Е и изысканиям.",
    siteSchema,
    (a) => {
      const r = siteLoads(a);
      return {
        loads: { snow: r.snow, wind: r.wind, terrain: r.terrain },
        site: r.site,
        frostDepth: r.frostDepth,
        snowRegion: r.snowRegion,
        windRegion: r.windRegion,
        matched: r.matched,
        fromTable: r.fromTable,
        basis: r.basis,
        warnings: r.warnings,
        sources: r.sources,
        note: r.note,
      };
    },
  );
  register(
    "karkas_import_project",
    "Импортировать полный проект schema version=2, включая произвольные стены, проёмы, объекты, этажи и зоны. Вход валидируется; расчёты выполняются до сохранения.",
    z
      .object({ project: z.object({ walls: z.array(profiledWallFeaturesSchema).max(300) }).passthrough() })
      .strict(),
    (a) => engine.create(a.project),
    false,
  );
  register(
    "karkas_list_projects",
    "Список сохранённых проектов и текущих ревизий.",
    z.object({}).strict(),
    () => engine.list(),
  );
  register(
    "karkas_get_project",
    "Получить редактируемые нейросетью исходные данные и точную ревизию. Старые ревизии доступны и неизменяемы.",
    z.object(ref).strict(),
    (a) => engine.get(a.project_id, a.revision),
  );
  register(
    "karkas_apply_patch",
    "Атомарно изменить проект RFC6902 add/replace/remove. Все операции применяются вместе, затем выполняются валидация и перерасчёт. expected_revision обязателен: старый клиент получит REVISION_CONFLICT. Для конкретных досок меняйте сечения стены/лаг/зоны/укосин/ростверка отдельно. Для авто-подбора крыши framing=auto; для точного сечения framing=rafters.",
    z
      .object({ project_id: id, expected_revision: revision, operations: z.array(patch).min(1).max(500) })
      .strict(),
    (a) => engine.patch(a.project_id, a.expected_revision, a.operations),
    false,
  );
  register(
    "karkas_add_annex",
    "Добавить пристройку к реальной наружной стене: openTerrace без крыши, coveredTerrace с крышей либо glazedVeranda с неотапливаемым остеклением. Все физические доски, общие либо независимые опоры, нагрузки, раскрой6м и смета пересчитываются транзакционно. Входы/двери дома, примыкания, снеговой мешок и грунт проверяются отдельно.",
    z.object({ project_id: id, expected_revision: revision, annex: annexSchema }).strict(),
    (a) => engine.addAnnex(a.project_id, a.expected_revision, a.annex),
    false,
  );
  register(
    "karkas_update_annex",
    "Изменить размеры, расположение, тип, сечения или нагрузки существующей пристройки по ID. Вложенные параметры объединяются, геометрия и смета пересчитываются. ID неизменен; новая ревизия создаётся только при валидной транзакции.",
    z
      .object({
        project_id: id,
        expected_revision: revision,
        annex_id: z.string().min(1).max(120),
        changes: annexSchema
          .partial()
          .omit({ id: true })
          .refine((v) => Object.keys(v).length > 0),
      })
      .strict(),
    (a) => engine.updateAnnex(a.project_id, a.expected_revision, a.annex_id, a.changes),
    false,
  );
  register(
    "karkas_remove_annex",
    "Удалить пристройку по ID вместе с её производной геометрией, древесиной, опорами, нагрузками и закупкой; исходные стены и проёмы дома сохраняются.",
    z.object({ project_id: id, expected_revision: revision, annex_id: z.string().min(1).max(120) }).strict(),
    (a) => engine.removeAnnex(a.project_id, a.expected_revision, a.annex_id),
    false,
  );
  register(
    "karkas_set_second_light",
    "Задать связанное двухсветное пространство: один проём, нижнее помещение, маршруты галереи, окна верхнего света и лестница внутри проёма. replaceVoidIds позволяет атомарно объединить прежние раздельные отверстия. Реальная лестница, ограждения, материалы и частные пространственные проверки пересчитываются.",
    z
      .object({ project_id: id, expected_revision: revision, configuration: doubleHeightConfigurationSchema })
      .strict(),
    (a) => engine.configureDoubleHeight(a.project_id, a.expected_revision, a.configuration),
    false,
  );
  register(
    "karkas_analyze",
    "Пересчитать точную ревизию: древесина и плотность, нагрузки, стропила/фермы, высокие стены, ростверк/реакции свай, раскрой6м и смета. Для деталей вызовите karkas_report. fixes=true добавляет короткий список проверенных исправлений (до3 на проваленную проверку, не более fix_evaluations пересчётов); полный разбор — karkas_propose_fixes.",
    z
      .object({
        ...ref,
        fixes: z.boolean().optional(),
        fix_evaluations: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    async (a) => {
      const report = await engine.analyze(a.project_id, a.revision);
      const out = {
        project_id: a.project_id,
        revision: report.engine.revision,
        hash: report.engine.hash,
        summary: report.summary,
        failed: report.result.checks.filter((c) => c.status === "fail"),
        unverifiedCount: report.result.checks.filter((c) => c.status === "unverified").length,
      };
      if (a.fixes && out.failed.length) {
        const record = await engine.get(a.project_id, report.engine.revision),
          proposal = proposeFixes(record.project, report, {
            planning: record.planning,
            maxEvaluations: a.fix_evaluations ?? 6,
            perGroup: 2,
            perCheck: 3,
          }),
          byId = new Map(proposal.fixes.map((f) => [f.id, f]));
        out.fixes = {
          byCheck: Object.fromEntries(
            Object.entries(proposal.byCheck).map(([k, ids]) => [
              k,
              ids.map((i) => summarizeFix(byId.get(i))),
            ]),
          ),
          evaluations: proposal.evaluations,
          budgetExhausted: proposal.budgetExhausted,
          next: "Примените patch через karkas_apply_patch(expected_revision) или вызовите karkas_optimize.",
        };
      }
      return out;
    },
  );
  register(
    "karkas_report",
    "Структурированный отчёт по подсистеме. Массивы имеют pagination (max100). members содержит физические доски, запилы, координаты, массу, слой пакета. Проверки можно фильтровать по status.",
    z
      .object({
        ...ref,
        topic: z
          .enum([
            "summary",
            "geometry",
            "loads",
            "foundation",
            "roof",
            "bracing",
            "rooms",
            "checks",
            "members",
            "cutting",
            "estimate",
            "assumptions",
            "snow",
            "envelope",
            "foundation_selection",
            "floor_platform",
            "partition_heads",
            "profiled_beam",
            "fabrication_parts",
            "fabrication_patterns",
            "annexes",
            "spatial_layout",
          ])
          .default("summary"),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        category: z
          .enum(["foundation", "walls", "floor", "roof", "bracing", "objects", "spatial"])
          .optional(),
        wallId: z.string().optional(),
        annexId: z.string().optional(),
        beamId: z.string().optional(),
        memberIds: z.array(z.string()).min(1).max(100).optional(),
        level: z.number().int().min(1).max(2).optional(),
        status: z.enum(["pass", "fail", "warning", "unverified"]).optional(),
      })
      .strict(),
    (a) => engine.report(a.project_id, a.revision, a),
  );
  register(
    "karkas_compare_variants",
    "Сравнить до12 наборов изменений без записи проекта. Сначала учитываются невыполненные частные проверки, затем примерная стоимость закупки. Не меняет исходник и не объявляет глобальный оптимум.",
    z
      .object({
        ...ref,
        variants: z
          .array(z.object({ name: z.string().max(100), operations: z.array(patch).min(1).max(100) }).strict())
          .min(1)
          .max(12),
      })
      .strict(),
    (a) => engine.variants(a.project_id, a.revision, a.variants),
  );
  register(
    "karkas_propose_fixes",
    "Предложить проверенные исправления для проваленных (и по желанию близких к пределу) проверок. Для каждой группы элементов (лаги, стойки, высокие стены, стропила/фермы, сваи, ростверк, раскрепление) строятся JSON Patch по таблице правил; каждый применяется к копии и весь дом пересчитывается. Возвращаются только снижающие загрузку цели: title, patch, before/after, newFailedChecks, costDelta, sideEffects. Проект не меняется; выбранный patch примените через karkas_apply_patch.",
    z.object({ ...ref, options: fixOptions.optional() }).strict(),
    async (a) => {
      const record = await engine.get(a.project_id, a.revision),
        report = await engine.analyze(a.project_id, record.revision);
      return {
        project_id: a.project_id,
        revision: record.revision,
        hash: report.engine.hash,
        ...proposeFixes(record.project, report, { ...a.options, planning: record.planning }),
        next: "Примените выбранный patch через karkas_apply_patch с expected_revision; для комбинации исправлений используйте karkas_optimize.",
      };
    },
  );
  register(
    "karkas_optimize",
    "Детерминированный поиск (покоординатный спуск) по группам элементов: сначала убрать проваленные проверки, затем сумму превышений u>1, недоразмещённые детали и стоимость; затем удешевление на шаг, пока ничего не проваливается. goals.keep — JSON Pointer, которые нельзя менять; goals.maxCost — ориентир стоимости. apply=true создаёт новую ревизию тем же механизмом patch с проверкой expected_revision. Не глобальный оптимум и не сертификация.",
    z
      .object({
        project_id: id,
        expected_revision: revision,
        goals: z
          .object({
            maxCost: num(0, 1e12).optional(),
            keep: z.array(jsonPointer).max(50).optional(),
            allowAssumptions: z.boolean().optional(),
          })
          .strict()
          .optional(),
        apply: z.boolean().default(false),
        max_evaluations: z.number().int().min(1).max(120).optional(),
      })
      .strict(),
    async (a) => {
      const record = await engine.get(a.project_id);
      if (record.revision !== a.expected_revision)
        throw new EngineError("REVISION_CONFLICT", "Проект изменился: прочитайте актуальную ревизию.", {
          expected: a.expected_revision,
          actual: record.revision,
        });
      const report = await engine.analyze(a.project_id, record.revision),
        result = optimize(record.project, {
          planning: record.planning,
          evaluation: report,
          maxEvaluations: a.max_evaluations ?? 30,
          maxCost: a.goals?.maxCost,
          keep: a.goals?.keep,
          allowAssumptions: a.goals?.allowAssumptions ?? false,
        });
      const out = { project_id: a.project_id, revision: record.revision, ...result, applied: null };
      if (a.apply && result.patch.length && result.verified) {
        const committed = await engine.patch(a.project_id, a.expected_revision, result.patch);
        out.applied = { revision: committed.revision, hash: committed.hash, summary: committed.summary };
      }
      return out;
    },
    false,
  );
  register(
    "karkas_compare_foundations",
    "Сравнить ЖБ-забивные, стальныеRR/RD и винтовые сваи по фактическим реакциям и условиям установки. Без изысканий все рекомендации условные; тип не задаёт геонесущую способность.",
    z
      .object({
        ...ref,
        site: z
          .object({
            soilProfile: z
              .enum(["unknown", "soft-over-bearing", "dense-granular", "shallow-bedrock"])
              .optional(),
            vibrationSensitive: z.boolean().optional(),
            boulders: z.boolean().optional(),
            largeRigAccess: z.boolean().optional(),
            geotechnicalVerified: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    async (a) => {
      const report = await engine.analyze(a.project_id, a.revision);
      return {
        project_id: a.project_id,
        revision: report.engine.revision,
        ...compareFoundationOptions(
          report.project,
          report.result,
          a.site ?? report.project.site?.foundation ?? {},
        ),
      };
    },
  );
  register(
    "karkas_check_envelope",
    "Стационарный расчёт R/U, точки росы, профиля температуры/давления пара и риска конденсации внутри слоёв. Годовой режим, воздух и2Dмостики не подтверждаются этим screen.",
    z
      .object({
        project_id: id.optional(),
        revision: revision.optional(),
        assembly: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    async (a) => {
      if (a.assembly) return analyzeEnvelope(a.assembly);
      if (!a.project_id) throw new Error("Нужны assembly или project_id.");
      const report = await engine.analyze(a.project_id, a.revision);
      return { project_id: a.project_id, revision: report.engine.revision, envelope: report.result.envelope };
    },
  );
  register(
    "karkas_snow_cases",
    "Снеговая огибающая по фиксированным сечениям: равномерный, несимметричные и явно заданные сценарии. Возвращает реальные реакции/проверки; местные заносы без геометрии не выдумываются.",
    z.object(ref).strict(),
    async (a) => {
      const report = await engine.analyze(a.project_id, a.revision);
      return { project_id: a.project_id, revision: report.engine.revision, ...report.result.snowAssessment };
    },
  );
  register(
    "karkas_preview",
    "Открыть локальный read-only веб-просмотр конкретной ревизии. На странице нет редактирования; все изменения выполняет нейросеть через MCP. URL доступен пока сервер запущен.",
    z.object(ref).strict(),
    (a) => preview(a.project_id, a.revision),
  );
  register(
    "karkas_export",
    "Выпустить артефакты конкретной ревизии: полный JSON, проект, планыSVG, доскиCSV, раскройCSV/HTML, сметаCSV, модельOBJ и альбом КР PDF. Возвращает абсолютные пути, размеры и SHA256.",
    z
      .object({
        ...ref,
        formats: z
          .array(
            z.enum([
              "report_json",
              "project_json",
              "plan_svg",
              "boards_csv",
              "cutting_csv",
              "estimate_csv",
              "cutting_html",
              "model_obj",
              "structural_pdf",
              "fabrication_parts_csv",
              "fabrication_stocks_csv",
            ]),
          )
          .min(1)
          .max(11)
          .optional(),
      })
      .strict(),
    (a) => engine.export(a.project_id, a.revision, a.formats),
    false,
  );
  server.registerResource(
    "engine-capabilities",
    "karkas://engine/capabilities",
    { title: "КАРКАС ENGINE — возможности и единицы", mimeType: "application/json" },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(catalogWithSolutions()) },
      ],
    }),
  );
  server.registerPrompt(
    "design_frame_house",
    {
      description: "Дисциплинированный цикл проектирования дома через расчётные инструменты.",
      argsSchema: z.object({ brief: z.string().min(1).max(12000) }),
    },
    ({ brief }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Спроектируй дом через КАРКАС ENGINE. Задание: ${brief}\n1. Прочитай karkas_catalog. Уточняй недостающие критические исходные данные; свои допущения перечисли.\n2. Создай геометрию/помещения через karkas_generate или импортируй явный проект. Для второго света используй karkas_set_second_light: один проём, нижнее помещение, реальная лестница, проходы галереи и верхние окна. Пристройки добавляй через karkas_add_annex (openTerrace, coveredTerrace, glazedVeranda). Не изображай вычисления словами.\n3. Проверь нагрузки, roof, foundation, annexes, spatial_layout, checks, members и 6 м cutting. Не скрывай failed/unverified. Не подменяй свойства материала или нагрузки ради pass.\n4. Для проваленных проверок вызови karkas_propose_fixes (или karkas_analyze с fixes=true): движок сам предложит проверенные patch с before/after, новыми отказами и разницей стоимости. Для комбинации исправлений с минимальной стоимостью — karkas_optimize (goals.keep для неизменяемых путей; apply=true создаёт ревизию с expected_revision). Допущения kind=assumption (несущая способность свай, раскрепление стоек) не применяй без подтверждения. Ручные альтернативы сравни через compare_variants, затем примени выбранный patch с expected_revision.\n5. Выпусти report_json, plan_svg, boards_csv, cutting_html, estimate_csv, model_obj. Укажи ревизию, расчётные допущения, нерешённые соединения/грунт/нормативные сочетания. Человеческого редактора нет; изменения выполняются только инструментами.`,
          },
        },
      ],
    }),
  );
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  serveStdio(() => createMcpServer(), {
    onerror: (e) => process.stderr.write(`karkas-engine: ${e.message}\n`),
  });

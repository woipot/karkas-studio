import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { calculateEstimate, estimateRowsToCSV, defaultPrices } from "./estimate-engine.js";
import { defaultDesignerProject } from "./designer-engine.js";

const execute = promisify(execFile),
  root = fileURLToPath(new URL("../", import.meta.url));
const bundledPython =
  "/Users/woipot/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const pdfInspection = String.raw`
import json,sys
from pypdf import PdfReader
reader=PdfReader(sys.argv[1])
texts=[page.extract_text() or '' for page in reader.pages]
embedded=False
for page in reader.pages:
    resources=page.get('/Resources')
    resources=resources.get_object() if resources else {}
    fonts=resources.get('/Font',{})
    fonts=fonts.get_object() if hasattr(fonts,'get_object') else fonts
    for ref in fonts.values():
        font=ref.get_object()
        descriptor=font.get('/FontDescriptor')
        if descriptor:
            descriptor=descriptor.get_object()
            embedded=embedded or any(key in descriptor for key in ['/FontFile','/FontFile2','/FontFile3'])
print(json.dumps({'pages':len(reader.pages),'sizes':[[float(p.mediabox.width),float(p.mediabox.height)] for p in reader.pages],'texts':texts,'embeddedFont':embedded},ensure_ascii=False))
`;

test("EUR procurement preserves explicit zero section prices and exports euro units without RUB labels", () => {
  const p = structuredClone(defaultDesignerProject);
  p.prices = {
    ...Object.fromEntries(
      Object.keys(defaultPrices)
        .filter((k) => k !== "sectionPrices")
        .map((k) => [k, 0]),
    ),
    currency: "EUR",
    timberM3: 900,
    pileEach: 120.5,
    sectionPrices: { "50x150": 0 },
  };
  const result = {
    geometry: { closed: true, area: 10, totalFloorArea: 10, netWallArea: 20, roofArea: 12 },
    piles: [{}, {}],
    timber: {
      instances: [
        {
          id: "eur-board",
          category: "walls",
          role: "stud",
          b: 50,
          h: 150,
          length: 2,
          cutLength: 2,
          volume: 0.015,
          mass: 7.5,
          start: [0, 0, 0],
          end: [0, 2, 0],
        },
      ],
    },
  };
  const estimate = calculateEstimate(p, result);
  assert.equal(estimate.currency, "EUR");
  assert.ok(estimate.procurementTimberVolume > 0);
  const timber = estimate.rows.find((r) => r.sectionId === "50x150");
  assert.equal(timber.unitPrice, 0);
  assert.equal(timber.total, 0);
  assert.equal(estimate.total, 241);
  const csv = estimateRowsToCSV(estimate, "Тест евро");
  assert.ok(csv.includes("€"));
  assert.equal(csv.includes("₽"), false);
  assert.ok(csv.includes("241"));
  assert.ok(csv.includes("Тест евро"));
  p.prices.pileEach = 0;
  const zero = calculateEstimate(p, result);
  assert.equal(zero.total, 0);
  assert.ok(zero.rows.every((r) => r.total === 0));
  assert.ok(estimateRowsToCSV(zero).includes("€"));
});

test(
  "real MCP exports the complete Cyrillic A3 structural album for a two-storey L-house with second light",
  { timeout: 180000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-structural-pdf-")),
      python =
        process.env.KARKAS_PYTHON ||
        (await access(bundledPython).then(
          () => bundledPython,
          () => "python3",
        ));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(root, "mcp/server.mjs")],
        cwd: root,
        env: { ...process.env, KARKAS_DATA_DIR: dataDir, KARKAS_PYTHON: python },
        stderr: "pipe",
      }),
      client = new Client({ name: "karkas-structural-export-qa", version: "1.0.0" });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    t.after(async () => {
      try {
        await client.close();
      } finally {
        await transport.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    });
    await client.connect(transport);
    async function call(name, args) {
      const response = await client.callTool({ name: "karkas_" + name, arguments: args }, { timeout: 90000 });
      assert.notEqual(
        response.isError,
        true,
        `${name}: ${JSON.stringify(response.structuredContent)}\n${stderr}`,
      );
      assert.ok(response.structuredContent);
      return response.structuredContent;
    }
    const name = "QA Г-образный дом со вторым светом",
      generated = await call("generate", {
        name,
        template: "l-shape",
        width: 12,
        depth: 9,
        wingWidth: 8,
        wingDepth: 5,
        levels: [
          { height: 2.8 },
          {
            height: 2.6,
            footprint: [
              { x: 0, y: 0 },
              { x: 8, y: 0 },
              { x: 8, y: 5 },
              { x: 0, y: 5 },
            ],
          },
        ],
        secondLight: {
          level: 2,
          polygon: [
            { x: 2, y: 1 },
            { x: 4, y: 1 },
            { x: 4, y: 4 },
            { x: 2, y: 4 },
          ],
        },
        roof: { shape: "gable", pitch: 25, framing: "auto" },
        sections: { walls: "50x150", floor: "50x250", roof: "50x200", grillage: "50x200" },
        foundation: { spacing: 2, capacity: 40, grillage: { plies: 3 } },
        bracing: { method: "sheathing" },
      });
    assert.equal(generated.revision, 1);
    assert.equal(generated.summary.certified, false);
    const exported = await call("export", {
      project_id: generated.project_id,
      revision: 1,
      formats: ["report_json", "structural_pdf", "fabrication_parts_csv", "fabrication_stocks_csv"],
    });
    assert.equal(exported.revision, 1);
    assert.equal(exported.hash, generated.hash);
    const pdf = exported.artifacts.find((a) => a.format === "structural_pdf"),
      json = exported.artifacts.find((a) => a.format === "report_json");
    assert.ok(pdf);
    assert.ok(json);
    assert.match(pdf.path, /\.pdf$/i);
    for (const artifact of exported.artifacts) {
      const relative = path.relative(dataDir, artifact.path);
      assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));
      const bytes = await readFile(artifact.path);
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
    }
    const bytes = await readFile(pdf.path);
    assert.ok(bytes.length > 20000, "An entire construction album must contain more than an empty PDF shell");
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    const report = JSON.parse(await readFile(json.path, "utf8"));
    assert.equal(report.engine.projectId, generated.project_id);
    assert.equal(report.engine.revision, 1);
    assert.equal(report.engine.hash, generated.hash);
    const geometry = report.result.geometry;
    assert.equal(geometry.levels.length, 2);
    // The generated L1 bearing spine T-joins the exterior wall; collinear junction vertices are not corners.
    const corners = geometry.levels[0].polygon.filter((q, i, p) => {
      const a = p[(i + p.length - 1) % p.length],
        b = p[(i + 1) % p.length];
      return Math.abs((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) > 1e-9;
    });
    assert.equal(corners.length, 6);
    assert.equal(geometry.levels[0].area, 92);
    assert.equal(geometry.levels[1].voidArea, 6);
    assert.equal(geometry.levels[1].netFloorArea, 34);
    assert.equal(geometry.totalFloorArea, 126);
    assert.ok(
      geometry.levels.every((l) => l.platformPolygon?.length >= 3),
      "Physical platform faces must be available separately from wall axes",
    );
    const { stdout } = await execute(python, ["-c", pdfInspection, pdf.path], {
        maxBuffer: 24 * 1024 * 1024,
        timeout: 90000,
      }),
      inspection = JSON.parse(stdout),
      text = inspection.texts.join("\n"),
      compact = text.replace(/\s+/g, "");
    assert.ok(
      inspection.pages >= 10,
      `Expected a multipage drawing/specification/cutting album, got ${inspection.pages} pages`,
    );
    assert.ok(
      inspection.texts.every((s) => s.trim().length > 30),
      "No pages may be an empty drawing shell",
    );
    assert.equal(inspection.embeddedFont, true, "Cyrillic font must be embedded");
    for (const [width, height] of inspection.sizes) {
      assert.ok(
        Math.abs(width - 1190.551) < 2 && Math.abs(height - 841.89) < 2,
        `Expected landscape A3, got ${width} × ${height} pt`,
      );
    }
    assert.ok((text.match(/[А-Яа-яЁё]/g) || []).length > 100, "Cyrillic labels must extract as Unicode text");
    assert.equal(text.includes("\uFFFD"), false);
    assert.ok(compact.includes(name.replace(/\s+/g, "")));
    assert.ok(compact.includes(generated.hash), "The full revision hash must be printed in the album");
    for (const heading of [
      "КР · расчётная проработка",
      "НЕ РАБОЧАЯ ДОКУМЕНТАЦИЯ",
      "Свайное поле",
      "Ростверк",
      "Полная карта раскроя 6 м",
    ])
      assert.ok(compact.includes(heading.replace(/\s+/g, "")), `Missing album section: ${heading}`);
    for (const heading of [
      "Платформа, каркас и ростверк · наружные грани",
      "Над ростверком",
      "Над нижней стеной",
      "Смещение оси rim",
      "Надбалочный слой по отметкам",
    ])
      assert.ok(
        compact.includes(heading.replace(/\s+/g, "")),
        `Missing platform alignment detail: ${heading}`,
      );
    const stocks = report.cutting.stocks,
      boards = report.result.timber.instances;
    assert.ok(stocks.length > 20);
    assert.ok(boards.length > 100);
    const fabrication = report.fabrication;
    assert.ok(fabrication);
    assert.equal(
      fabrication.partGroups.reduce((s, g) => s + g.count, 0),
      boards.length,
    );
    assert.equal(
      fabrication.patternGroups.reduce((s, g) => s + g.count, 0),
      stocks.length,
    );
    for (const group of [...fabrication.partGroups, ...fabrication.patternGroups])
      assert.ok(compact.includes(group.id), "Missing grouped fabrication mark " + group.id);
    const partsCSV = await readFile(
        exported.artifacts.find((a) => a.format === "fabrication_parts_csv").path,
        "utf8",
      ),
      stocksCSV = await readFile(
        exported.artifacts.find((a) => a.format === "fabrication_stocks_csv").path,
        "utf8",
      );
    for (const board of boards)
      assert.ok(partsCSV.includes(board.id), "Missing exact physical part mapping " + board.id);
    for (const stock of stocks)
      assert.ok(stocksCSV.includes(stock.id), "Missing exact stock mapping " + stock.id);
    assert.equal(
      (await call("get_project", { project_id: generated.project_id })).revision,
      1,
      "Export must preserve the source revision",
    );
    t.diagnostic(
      `Verified ${inspection.pages} A3 pages, ${stocks.length} stock IDs, ${boards.length} physical member IDs, ${pdf.bytes} PDF bytes and SHA256 ${pdf.sha256}`,
    );
  },
);

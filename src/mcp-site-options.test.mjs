import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = fileURLToPath(new URL("../", import.meta.url));

test(
  "real MCP stdio: site loads, site-driven generation and evaluated layout options",
  { timeout: 120000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "karkas-mcp-site-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "mcp/server.mjs")],
      cwd: root,
      env: { ...process.env, KARKAS_DATA_DIR: dataDir },
      stderr: "pipe",
    });
    const client = new Client({ name: "karkas-site-qa", version: "1.0.0" }, { capabilities: {} });
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
    const names = (await client.listTools()).tools.map((x) => x.name);
    for (const name of ["karkas_site_loads", "karkas_generate_options", "karkas_generate"])
      assert.ok(names.includes(name), name);
    async function call(name, args = {}, isError = false) {
      const response = await client.callTool(
        { name: "karkas_" + name, arguments: args },
        { timeout: 110000 },
      );
      const data = response.structuredContent;
      assert.ok(data && typeof data === "object", `${name}: no structuredContent; ${stderr}`);
      assert.equal(response.isError === true, isError, `${name}: ${JSON.stringify(data.error)}; ${stderr}`);
      return data;
    }
    const moscow = await call("site_loads", { city: "Москва" });
    assert.equal(moscow.snowRegion, "III");
    assert.equal(moscow.windRegion, "I");
    assert.equal(moscow.loads.wind, 0.23);
    assert.equal(moscow.loads.snow, 1.45);
    const unknown = await call("site_loads", { city: "Атлантида" });
    assert.equal(unknown.matched, false);
    assert.ok(unknown.warnings.length > 0);
    const invalid = await client.callTool({ name: "karkas_site_loads", arguments: { snowRegion: "IX" } });
    assert.equal(invalid.isError, true);

    const generated = await call("generate", {
      width: 8,
      depth: 6,
      site: { city: "Ногинск" },
      loads: { wind: 0.3 },
    });
    assert.equal(generated.revision, 1);
    assert.deepEqual(generated.site.fromSite.sort(), ["snow", "terrain"]);
    assert.equal(generated.site.loads.snow, 1.5);
    assert.equal(generated.site.loads.wind, 0.3);
    const stored = await call("get_project", { project_id: generated.project_id });
    assert.equal(stored.project.site.city, "Ногинск");
    assert.equal(stored.project.site.snowRegion, "III");

    const options = await call("generate_options", {
      width: 10,
      depth: 8,
      rooms: [
        { name: "Гостиная", area: 18 },
        { name: "Кухня", area: 9 },
        { name: "Спальня", area: 12 },
        { name: "Санузел", area: 4 },
      ],
      count: 3,
    });
    assert.ok(options.options.length >= 2 && options.options.length <= 3);
    options.options.forEach((o, i) => {
      assert.equal(o.rank, i + 1);
      assert.ok(Number.isInteger(o.failedChecks));
      assert.ok(Number.isFinite(o.estimateTotal));
      assert.ok(o.layout.totalWallLength > 0);
    });
    for (let i = 1; i < options.options.length; i++)
      assert.ok(options.options[i - 1].failedChecks <= options.options[i].failedChecks);
    assert.equal((await call("list_projects")).projects.length, 1, "options are not persisted");
    const chosen = await call("generate", {
      width: 10,
      depth: 8,
      rooms: [
        { name: "Гостиная", area: 18 },
        { name: "Кухня", area: 9 },
        { name: "Спальня", area: 12 },
        { name: "Санузел", area: 4 },
      ],
      strategy: options.selectedStrategy,
    });
    assert.equal(chosen.strategy, options.selectedStrategy);
    assert.equal(chosen.hash, options.options[0].hash);
  },
);

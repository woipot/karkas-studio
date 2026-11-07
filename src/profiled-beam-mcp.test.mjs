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
  "real MCP: beam generation, strict import, report, transactional moisture update and members",
  { timeout: 60000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "karkas-profiled-beam-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "mcp/server.mjs")],
      cwd: root,
      env: { ...process.env, KARKAS_DATA_DIR: dir },
      stderr: "pipe",
    });
    const client = new Client({ name: "profiled-beam-test", version: "1.0.0" }, { capabilities: {} });
    t.after(async () => {
      try {
        await client.close();
      } finally {
        await transport.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
    await client.connect(transport);
    async function call(name, args) {
      const r = await client.callTool({ name: "karkas_" + name, arguments: args });
      assert.ok(!r.isError, JSON.stringify(r));
      return r.structuredContent;
    }
    const g = await call("generate", {
      width: 6,
      depth: 4,
      levels: [{ height: 3 }],
      wallSystem: "profiledBeam",
      // Missing beamSection exercises the generator's documented 145×145 task default.
      beamProfile: "doubleTongue",
      beamMoisture: "natural",
      beamCornerJoint: "lap",
      material: { Fc90Full: 1.8 },
      rooms: [],
    });
    const ref = { project_id: g.project_id };
    const r = await call("report", { ...ref, topic: "profiled_beam" });
    assert.equal(r.data.walls.length, 4);
    assert.equal(r.data.walls[0].courseCount, 21);
    assert.equal(r.data.walls[0].settlementMM, 180);
    const stored = await call("get_project", ref);
    assert.equal(stored.project.walls[0].beam.section, "145x145");
    assert.equal(stored.project.walls[0].beam.profile, "doubleTongue");
    assert.equal(stored.project.walls[0].beam.moisture, "natural");
    assert.equal(stored.project.walls[0].beam.cornerJoint, "lap");
    const badProfile = await client.callTool({
      name: "karkas_generate",
      arguments: { wallSystem: "profiledBeam", beamProfile: "unknown" },
    });
    assert.equal(badProfile.isError, true);
    const members = await call("report", {
      ...ref,
      topic: "members",
      wallId: stored.project.walls[0].id,
      limit: 100,
    });
    assert.ok(members.items.some((b) => b.role === "beamCourse"));
    const invalid = await client.callTool({
      name: "karkas_import_project",
      arguments: {
        project: {
          ...stored.project,
          walls: stored.project.walls.map((w, i) =>
            i ? w : { ...w, beam: { ...w.beam, accidentalField: 1 } },
          ),
        },
      },
    });
    assert.equal(invalid.isError, true);
    await call("apply_patch", {
      ...ref,
      expected_revision: 1,
      operations: [{ op: "add", path: "/walls/0/beam/moisture", value: "kilnDried" }],
    });
    const updated = await call("report", { ...ref, topic: "profiled_beam" });
    assert.equal(updated.data.walls[0].settlementMM, 90);
  },
);

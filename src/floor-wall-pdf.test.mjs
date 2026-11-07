import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundled = "/Users/woipot/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const python = process.env.KARKAS_PYTHON || (existsSync(bundled) ? bundled : "python3");
function inspect(input, body) {
  const code =
    String.raw`
import json,runpy,sys
m=runpy.run_path('scripts/structural-album.py');m['register_fonts']();a=m['Album'].__new__(m['Album']);d=json.load(sys.stdin)
a.r=d['result'];a.members=a.r['timber']['instances'];a.levels=d['levels'];a.g={'polygon':a.levels[0]['polygon']};a.p={'walls':d['walls']}
a.wall_map={str(w['id']):w for w in d['walls']};a.wall_names={str(w['id']):'Стена '+str(i+1).zfill(2) for i,w in enumerate(d['walls'])};a.marks=d['marks']
` + body;
  return JSON.parse(
    execFileSync(python, ["-c", code], { cwd: root, input: JSON.stringify(input), encoding: "utf8" }),
  );
}
function fixture() {
  const joist = (id, x) => ({
    id,
    category: "floor",
    role: "joist",
    floor: 1,
    b: 50,
    h: 200,
    start: [x, 1.02, 0],
    end: [x, 1.02, 4],
    crossAxis: [-1, 0, 0],
  });
  const block = (id, y) => ({
    id,
    category: "floor",
    role: "wallTransferBlocking",
    floor: 1,
    b: 50,
    h: 200,
    start: [1.825, 1.02, y],
    end: [2.175, 1.02, y],
    crossAxis: [0, 0, 1],
  });
  const members = [
    joist("L", 1.8),
    joist("R", 2.2),
    joist("P1", 0.975),
    joist("P2", 1.025),
    block("B1", 1.975),
    block("B2", 2.025),
    {
      id: "parallel-plate",
      category: "walls",
      wallId: "P",
      role: "plate",
      platePosition: "bottom",
      b: 48,
      h: 98,
      start: [1, 1.179, 0.2],
      end: [1, 1.179, 3.8],
      crossAxis: [0, 1, 0],
    },
    {
      id: "parallel-stud",
      category: "walls",
      wallId: "P",
      role: "stud",
      b: 48,
      h: 98,
      start: [1, 1.203, 2],
      end: [1, 3.8, 2],
      crossAxis: [0, 0, 1],
    },
    {
      id: "cross-plate",
      category: "walls",
      wallId: "T",
      role: "plate",
      platePosition: "bottom",
      b: 48,
      h: 98,
      start: [0.2, 1.179, 2],
      end: [3.8, 1.179, 2],
      crossAxis: [0, 1, 0],
    },
  ];
  const record = (wallId, orientation, boardIds, joistIds, transferBoardIds, footprint) => ({
    wallId,
    level: 1,
    kind: "partition",
    orientation,
    boardIds,
    joistIds,
    transferBoardIds,
    footprint,
    wallDepth: 98,
    coverageRatio: 1,
    geometryComplete: true,
    framingTopY: 1.12,
    wallBaseY: 1.155,
    deckThickness: 0.035,
    layerBasis: {
      thickness: 0.035,
      material: null,
      structuralVerified: false,
      massBasis: "included in supplied floorDead; no extra self weight",
    },
  });
  return {
    walls: [
      { id: "P", a: { x: 1, y: 0.2 }, b: { x: 1, y: 3.8 } },
      { id: "T", a: { x: 0.2, y: 2 }, b: { x: 3.8, y: 2 } },
    ],
    levels: [
      {
        index: 1,
        polygon: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
        voids: [],
      },
    ],
    marks: Object.fromEntries(
      members.map((b) => [b.id, b.id.startsWith("B") ? "FG-B" : b.category === "floor" ? "FG-J" : "FG-W"]),
    ),
    result: {
      timber: { instances: members },
      floorPlatform: {
        wallSupports: [
          record(
            "P",
            "parallel",
            ["P1", "P2"],
            ["P1", "P2"],
            [],
            [
              { x: 0.951, y: 0.2 },
              { x: 1.049, y: 0.2 },
              { x: 1.049, y: 3.8 },
              { x: 0.951, y: 3.8 },
            ],
          ),
          record(
            "T",
            "perpendicular",
            ["L", "R", "B1", "B2"],
            ["L", "R"],
            ["B1", "B2"],
            [
              { x: 0.2, y: 1.951 },
              { x: 3.8, y: 1.951 },
              { x: 3.8, y: 2.049 },
              { x: 0.2, y: 2.049 },
            ],
          ),
        ],
      },
    },
  };
}

test("wall-support nodes resolve exact physical IDs and retain the conditional35mm layer without adding timber", () => {
  const data = fixture();
  const out = inspect(
    data,
    String.raw`
before=json.dumps(a.members,sort_keys=True);nodes=a.wall_support_nodes(a.wall_support_records(a.levels[0]));sections=[a.wall_support_section(n) for n in nodes]
print(json.dumps({'nodes':[{'wallId':n['wall']['id'],'orientation':n['support']['orientation'],'ids':[b['id'] for b in n['members']]} for n in nodes],'sections':[{'floorIds':[r['member']['id'] for r in s['records'] if r['member'].get('category')=='floor'],'gap':s['wallBaseY']-s['framingTopY'],'basis':s['layerBasis'],'intervals':s['deckIntervals']} for s in sections],'unchanged':before==json.dumps(a.members,sort_keys=True)}))
`,
  );
  assert.deepEqual(
    out.nodes.map((n) => n.orientation),
    ["parallel", "perpendicular"],
  );
  assert.deepEqual(out.nodes[0].ids, ["P1", "P2"]);
  assert.deepEqual(out.nodes[1].ids, ["L", "R", "B1", "B2"]);
  assert.deepEqual(out.sections[0].floorIds, ["P1", "P2"]);
  assert.ok(out.sections[1].floorIds.includes("B1"));
  assert.ok(!out.sections[1].floorIds.includes("B2"));
  for (const s of out.sections) {
    assert.ok(Math.abs(s.gap - 0.035) < 1e-10);
    assert.equal(s.basis.material, null);
    assert.equal(s.basis.structuralVerified, false);
    assert.ok(s.intervals.length);
  }
  assert.equal(out.unchanged, true);
});

test("missing metadata never creates guessed wall support nodes, sections, or force rows", () => {
  const data = fixture();
  data.result.floorPlatform.wallSupports = [];
  const out = inspect(
    data,
    String.raw`print(json.dumps({'nodes':a.wall_support_nodes(a.wall_support_records(a.levels[0])),'loads':a.wall_load_rows({}),'transfers':a.wall_transfer_rows({}),'joist':a.floor_joist_control()}))`,
  );
  assert.deepEqual(out, { nodes: [], loads: [], transfers: [], joist: null });
});

test("support schedule groups by real FG but flags a missing canonical ID instead of substituting boards", () => {
  const data = fixture();
  data.result.floorPlatform.wallSupports[0].boardIds.push("missing");
  const rows = inspect(
    data,
    String.raw`print(json.dumps([a.wall_support_row(r) for r in a.wall_support_records(a.levels[0])],ensure_ascii=False))`,
  );
  assert.equal(rows[0][0], "Стена 01\nПерегородка");
  assert.ok(rows[0][2].includes("FG-J ×2"));
  assert.ok(rows[0][2].includes("Не сопоставлено IDs: 1"));
  assert.ok(rows[1][2].includes("FG-B ×2"));
});

test("partition and transfer tables preserve units, group force envelopes and leave unknown values blank", () => {
  const data = fixture();
  data.transfers = {
    walls: [
      {
        wallId: "P",
        orientation: "parallel",
        woodWeight: 1.23456,
        layerWeight: 2,
        expected: { force: 3.23456 },
        actual: { force: 3.23456 },
        balance: { force: 0 },
        status: "routed",
      },
    ],
    transferMembers: [
      {
        boardId: "B1",
        wallIds: ["T"],
        moment: 0.02,
        shear: 0.4,
        deflection: 0.1,
        deflectionLimit: 1,
        utilization: 0.2,
        status: "pass",
      },
      {
        boardId: "B2",
        wallIds: ["T"],
        moment: 0.04,
        shear: 0.3,
        deflection: 0.2,
        deflectionLimit: 2,
        utilization: 0.3,
        status: "pass",
      },
      { boardId: "unknown", wallIds: ["P"] },
    ],
  };
  const out = inspect(
    data,
    String.raw`print(json.dumps({'walls':a.wall_load_rows(d['transfers']),'boards':a.wall_transfer_rows(d['transfers'])},ensure_ascii=False))`,
  );
  assert.equal(out.walls[0][2], "1,2346 / 2,0000");
  assert.equal(out.walls[0][3], "3,2346 / 3,2346");
  const group = out.boards.find((row) => row[0] === "FG-B ×2");
  assert.equal(group[2], "B2");
  assert.equal(group[3], "0,0400");
  assert.equal(group[4], "0,4000");
  assert.equal(group[6], "0,3000");
  const unknown = out.boards.find((row) => row[0] === "unknown ×1");
  assert.equal(unknown[3], "-");
  assert.equal(unknown[5], "- / -");
  assert.equal(unknown[7], "Не проверено");
});

test("joist control selects the supplied maximum applicable utilization and never promotes an unverified member", () => {
  const data = fixture();
  data.result.floorPlatform.joistChecks = [
    { id: "J1", partIds: ["P1"], numericChecksApplicable: true, utilization: 0.5 },
    { id: "J2", partIds: ["P2"], numericChecksApplicable: true, utilization: 0.7 },
    { id: "J3", partIds: ["L"], numericChecksApplicable: false, utilization: 9 },
  ];
  const out = inspect(data, String.raw`print(json.dumps(a.floor_joist_control()))`);
  assert.equal(out.record.id, "J2");
  assert.deepEqual(out.marks, ["FG-J"]);
  assert.equal(out.numericCount, 2);
  assert.equal(out.unknownCount, 1);
});

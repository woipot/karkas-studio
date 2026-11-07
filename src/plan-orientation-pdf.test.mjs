import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
const root = fileURLToPath(new URL("../", import.meta.url));
const bundled = "/Users/woipot/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const python = process.env.KARKAS_PYTHON || (existsSync(bundled) ? bundled : "python3");
function inspect(project) {
  return JSON.parse(
    execFileSync(
      python,
      [
        "-c",
        String.raw`
import runpy,json,sys
m=runpy.run_path('scripts/structural-album.py'); a=m['Album'].__new__(m['Album']); a.p=json.load(sys.stdin)
points=[(0,0),(6,10),(1,9),(4,9),(3,12)]; box=(40,80,600,700)
fn,s=a.plan_transform(points,box,30); legacy,ls=m['transform'](points,box,30)
print(json.dumps({'mapped':[fn(p)for p in points],'legacy':[legacy(p)for p in points],'scale':s,'legacyScale':ls,'project':a.p}))
`,
      ],
      { cwd: root, input: JSON.stringify(project), encoding: "utf8" },
    ),
  );
}
test("screen-plan Y direction puts the lower entrance below rear rooms while preserving left/right, scale and source data", () => {
  const p = { site: { planView: { yAxis: "down" } }, walls: [], mass: 123 };
  const q = inspect(p);
  assert.ok(q.mapped[1][1] < q.mapped[0][1]);
  assert.ok(q.mapped[4][1] < q.mapped[1][1]);
  assert.ok(q.mapped[2][0] < q.mapped[3][0]);
  assert.equal(q.scale, q.legacyScale);
  q.mapped.forEach((v, i) => {
    assert.equal(v[0], q.legacy[i][0]);
    assert.ok(Math.abs(v[1] + q.legacy[i][1] - 860) < 1e-9);
  });
  assert.deepEqual(q.project, p);
});
test("legacy PDF plan and ordinary height transforms retain their original Y-up mapping", () => {
  const q = inspect({});
  assert.deepEqual(q.mapped, q.legacy);
  assert.ok(q.legacy[1][1] > q.legacy[0][1]);
});

function floorDimensions(axis, yDown) {
  return JSON.parse(
    execFileSync(
      python,
      [
        "-c",
        String.raw`
import runpy,json,sys
m=runpy.run_path('scripts/structural-album.py'); axis,down=json.load(sys.stdin);a=m['Album'].__new__(m['Album'])
a.p={'site':{'planView':{'yAxis':'down'}}} if down else {};poly=[(0,0),(6,0),(6,10),(0,10)]
a.members=[{'id':'J'+str(i),'category':'floor','role':'joist','start':[0,1,i+1]if axis=='x'else[i+1,1,0],'end':[6,1,i+1]if axis=='x'else[i+1,1,5.85]}for i in range(3)]
s={'memberId':'J0','start':[.075,1,1]if axis=='x'else[1,1,.075],'end':[3,1,1]if axis=='x'else[1,1,3],'analyticalSpan':2.925}
a.r={'floorPlatform':{'spans':[s]}};a.marks={};a.wall_names={};a.platform_polygon=lambda level:poly
fn,scale=a.plan_transform(poly,(40,145,775,m['H']-265),69)
a.technical_base=lambda *args,**kwargs:(fn,scale);a.projected_member=lambda board,projection:[projection(board['start']),projection(board['end'])]
a.technical_schedule=lambda *args,**kwargs:300;a.note=lambda *args,**kwargs:None
calls=[];g=a.draw_floorframing.__func__.__globals__
g['line']=lambda *args,**kwargs:None;g['polygon']=lambda *args,**kwargs:None;g['text']=lambda *args,**kwargs:args[3]-10
g['dimension']=lambda c,A,B,offset,label:calls.append({'a':A,'b':B,'offset':offset,'label':label})
a.draw_floorframing(object(),{'index':1},0)
print(json.dumps({'calls':calls,'bounds':m['bounds']([fn(p)for p in poly]),'page':[m['W'],m['H']]}))
`,
      ],
      { cwd: root, input: JSON.stringify([axis, yDown]), encoding: "utf8" },
    ),
  );
}
for (const axis of ["x", "y"])
  for (const down of [false, true])
    test(`floor dimensions stay outside timber and inside the page for joists ${axis}, Y ${down ? "down" : "up"}`, () => {
      const q = floorDimensions(axis, down);
      assert.equal(q.calls.length, 3);
      for (const d of q.calls) {
        const dx = d.b[0] - d.a[0],
          dy = d.b[1] - d.a[1],
          L = Math.hypot(dx, dy),
          normal = [-dy / L, dx / L];
        const points = [d.a, d.b].map((p) => p.map((v, i) => v + normal[i] * d.offset));
        for (const [x, y] of points) {
          assert.ok(x > 20 && x < q.page[0] - 20 && y > 100 && y < q.page[1] - 100, JSON.stringify(d));
        }
        const span = d.label.includes("опорные оси"),
          right = span ? axis === "y" : axis === "x";
        for (const p of points)
          assert.ok(right ? p[0] > q.bounds[2] + 20 : p[1] > q.bounds[3] + 20, JSON.stringify(d));
      }
      assert.equal(q.calls.filter((d) => d.label.includes("опорные оси")).length, 1);
    });

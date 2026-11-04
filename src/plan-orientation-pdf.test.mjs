import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundled='/Users/woipot/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const python=process.env.KARKAS_PYTHON||(existsSync(bundled)?bundled:'python3');
function inspect(project){return JSON.parse(execFileSync(python,['-c',String.raw`
import runpy,json,sys
m=runpy.run_path('scripts/structural-album.py'); a=m['Album'].__new__(m['Album']); a.p=json.load(sys.stdin)
points=[(0,0),(6,10),(1,9),(4,9),(3,12)]; box=(40,80,600,700)
fn,s=a.plan_transform(points,box,30); legacy,ls=m['transform'](points,box,30)
print(json.dumps({'mapped':[fn(p)for p in points],'legacy':[legacy(p)for p in points],'scale':s,'legacyScale':ls,'project':a.p}))
`],{cwd:root,input:JSON.stringify(project),encoding:'utf8'}));}
test('screen-plan Y direction puts the lower entrance below rear rooms while preserving left/right, scale and source data',()=>{
 const p={site:{planView:{yAxis:'down'}},walls:[],mass:123};const q=inspect(p);
 assert.ok(q.mapped[1][1]<q.mapped[0][1]);assert.ok(q.mapped[4][1]<q.mapped[1][1]);
 assert.ok(q.mapped[2][0]<q.mapped[3][0]);assert.equal(q.scale,q.legacyScale);
 q.mapped.forEach((v,i)=>{assert.equal(v[0],q.legacy[i][0]);assert.ok(Math.abs(v[1]+q.legacy[i][1]-860)<1e-9);});
 assert.deepEqual(q.project,p);
});
test('legacy PDF plan and ordinary height transforms retain their original Y-up mapping',()=>{
 const q=inspect({});assert.deepEqual(q.mapped,q.legacy);assert.ok(q.legacy[1][1]>q.legacy[0][1]);
});

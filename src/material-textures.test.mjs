import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  TEXTURE_SIZE,
  textureResolution,
  osbChips,
  seededRandom,
  drawMaterialTexture,
  textureFamilies,
  textureMetres,
  materialFamily,
  plywoodPlyCount,
  sheetMetricUVs,
  insulationMetricUVs,
  createMaterialTextureCache,
  acquireMaterialTextures,
} from "./material-textures.js";
import { fitExteriorCamera } from "./designer-camera.js";
import { sheetSeamVertices } from "./sheet-render-geometry.js";
import { buildMaterialDemo } from "./material-demos.js";
import { evaluateHouse } from "./house-engine.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

// Tiny canvas-like context: no DOM, native canvas package or raster snapshots.
function mockContext(record = false) {
  const hash = createHash("sha256");
  let operations = 0;
  const commands = [];
  const ctx = new Proxy(
    {},
    {
      get(_, name) {
        return (...args) => {
          operations++;
          hash.update(JSON.stringify([name, ...args]));
          if (record) commands.push([name, ...args]);
        };
      },
      set(_, name, value) {
        hash.update(JSON.stringify([name, value]));
        return true;
      },
    },
  );
  return { ctx, digest: () => hash.digest("hex"), operations: () => operations, commands };
}

function mockCanvasFactory() {
  const canvases = [];
  return {
    canvases,
    createCanvas(size) {
      const mock = mockContext();
      const canvas = {
        width: size,
        height: size,
        getContext: () => mock.ctx,
        toDataURL: () => `data:image/png;base64,${mock.digest()}`,
      };
      canvases.push(canvas);
      return canvas;
    },
  };
}

test("seeded PRNG has an independent integer reference and no global randomness", () => {
  const random = seededRandom(1);
  // (1×1664525+1013904223) mod 2^32 = 1015568748.
  near(random(), 1015568748 / 4294967296);
});

for (const family of textureFamilies) {
  test(`${family}: canvas commands are deterministic and independent of canvas state`, () => {
    const a = mockContext(),
      b = mockContext();
    drawMaterialTexture(a.ctx, family, 512, 123);
    drawMaterialTexture(b.ctx, family, 512, 123);
    assert.equal(a.digest(), b.digest());
    assert.ok(a.operations() > 0);
    if (family !== "plywood-edge") {
      const c = mockContext(),
        d = mockContext();
      drawMaterialTexture(c.ctx, family, 512, 123);
      drawMaterialTexture(d.ctx, family, 512, 124);
      assert.notEqual(c.digest(), d.digest());
    }
  });
}

test("OSB wraps wide flakes by exactly one 0.75 m tile without rescaling", () => {
  const mock = mockContext(true);
  drawMaterialTexture(mock.ctx, "osb3", 1024, 10000);
  const polygons = [];
  let points = [];
  for (const command of mock.commands) {
    if (command[0] === "beginPath") points = [];
    if (command[0] === "moveTo" || command[0] === "lineTo") points.push(command.slice(1));
    if (command[0] === "closePath" && points.length === 9) polygons.push(points);
  }
  const wrapped = polygons.find(
    (p) => Math.abs(p[0][0] - polygons[0][0][0] - 1024) < 1e-8 && p[0][1] === polygons[0][0][1],
  );
  assert.ok(wrapped);
  polygons[0].forEach(([x, y], i) => {
    near(wrapped[i][0] - x, 1024);
    near(wrapped[i][1] - y, 0);
  });
});

test("OSB paints at least 1000 broad flakes per m², every flake 15–35 × 50–150 mm", () => {
  const chips = osbChips(731),
    [tileU, tileV] = textureMetres("osb3");
  // 600/(0.75×0.75) = 1066⅔ flakes/m²; threshold 1000 is an artistic
  // acceptance target. Measure polygon extents, not just declared metadata.
  near(chips.length / (tileU * tileV), 3200 / 3);
  assert.ok(chips.length / (tileU * tileV) >= 1000);
  assert.equal(new Set(chips.map((c) => c.tone)).size, 6);
  for (const [i, chip] of chips.entries()) {
    const width = Math.max(...chip.points.map((q) => q[1])) - Math.min(...chip.points.map((q) => q[1]));
    const length = Math.max(...chip.points.map((q) => q[0])) - Math.min(...chip.points.map((q) => q[0]));
    assert.ok(width >= 0.015 && width <= 0.035);
    assert.ok(length >= 0.05 && length <= 0.15);
    const deviation = chip.angle - (i % 8 === 0 ? Math.PI / 2 : 0);
    assert.ok(Math.abs(deviation) <= Math.PI / 6);
  }
});

test("CanvasTexture uses sRGB for every family, OSB has 1024 px per 750 mm", () => {
  const factory = mockCanvasFactory(),
    cache = createMaterialTextureCache(factory);
  for (const family of textureFamilies) {
    const texture = cache.getTexture(family);
    assert.ok(texture instanceof THREE.CanvasTexture);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(texture.image.width, textureResolution(family));
  }
  const osb = cache.getTexture("osb3");
  assert.equal(osb.image.width, 1024);
  near(750 / osb.image.width, 0.732421875); // mm/px
  near(osb.repeat.x, 4 / 3);
  near(osb.repeat.y, 4 / 3);
  assert.equal(cache.memoryBytes(), 5592404 + 4 * 1398100);
  cache.dispose();
});

test("sheet seam is 2.5 mm wide on both visible faces, never buried in the sheet", () => {
  const panel = {
    stockSheetId: "A",
    thickness: 12,
    polygon: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ],
  };
  const seam = sheetSeamVertices([panel], [{ stockSheetId: "A", a: [0, 0, 0], b: [1, 0, 0] }]);
  assert.equal(seam.positions.length, 36);
  assert.equal(seam.lines.length, 12);
  // Half of 12 mm + 0.15 mm render offset = 6.15 mm, both faces.
  for (let i = 2; i < seam.positions.length; i += 3) near(Math.abs(seam.positions[i]), 0.00615);
  const ys = seam.positions.filter((_, i) => i % 3 === 1);
  near(Math.max(...ys) - Math.min(...ys), 0.0025);
  near(seam.lines[2], -0.00615);
  near(seam.lines[8], 0.00615);
});

test("initial camera fits the whole 6×5×3 m house from outside at desktop/mobile aspect", () => {
  const points = [-3, 3].flatMap((x) =>
    [0, 3].flatMap((y) => [-2.5, 2.5].map((z) => new THREE.Vector3(x, y, z))),
  );
  const bounds = new THREE.Box3().setFromPoints(points);
  for (const aspect of [1080 / 580, 390 / 400, 0, NaN]) {
    const fit = fitExteriorCamera(points, aspect, new THREE.Vector3(1, 1.3, 1.05));
    const camera = new THREE.PerspectiveCamera(
      35,
      Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
      0.05,
      300,
    );
    camera.position.copy(fit.position);
    camera.lookAt(fit.target);
    camera.updateMatrixWorld();
    assert.equal(bounds.containsPoint(camera.position), false);
    // Enclosing sphere radius = sqrt(6²+3²+5²)/2 = sqrt(70)/2 m.
    assert.ok(camera.position.distanceTo(fit.target) > Math.sqrt(70) / 2);
    for (const point of points) {
      const projected = point.clone().project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
      assert.ok(projected.z > -1 && projected.z < 1);
    }
    near(fit.target.y, 1.5);
  }
});

test("plywood edge visual count is odd, thickness-dependent and explicitly approximate", () => {
  // 21/1.5=14; nearest odd tie rounds upward to 15. 6.5/1.5≈4.33 → 5.
  for (const [thickness, plies] of [
    [6.5, 5],
    [9, 7],
    [12, 9],
    [15, 11],
    [18, 13],
    [21, 15],
  ])
    assert.equal(plywoodPlyCount(thickness), plies);
  for (const invalid of [0, -1, NaN, Infinity]) assert.throws(() => plywoodPlyCount(invalid));
});

test("rotated 3–4–5 wall: metric UVs follow purchased long axis, not clipped panel edges", () => {
  const panel = {
    surfaceKind: "walls",
    localPolygon: [
      { x: 2, y: 1 },
      { x: 3.25, y: 1 },
      { x: 3.25, y: 3.5 },
      { x: 2, y: 3.5 },
    ],
    polygon: [
      [11.2, 1, 21.6],
      [11.95, 1, 22.6],
      [11.95, 3.5, 22.6],
      [11.2, 3.5, 21.6],
    ],
  };
  const piece = { localOrigin: { x: 2, y: 1 }, x: 0.1, y: 0.2, sourceHeight: 2.5, rotated: true };
  const uv = sheetMetricUVs(panel, piece);
  // At the purchase origin: U=0.1+2.5=2.6; at the top: U=0.1.
  near(uv[0][0], 2.6);
  near(uv[3][0], 0.1);
  near(uv[3][1] - uv[0][1], 0);
  near(uv[1][1] - uv[0][1], 1.25);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    near(
      Math.hypot(...panel.polygon[i].map((v, k) => v - panel.polygon[j][k])),
      Math.hypot(uv[i][0] - uv[j][0], uv[i][1] - uv[j][1]),
    );
  }
  piece.rotated = false;
  const unrotated = sheetMetricUVs(panel, piece);
  near(unrotated[1][0] - unrotated[0][0], 1.25);
  near(unrotated[3][1] - unrotated[0][1], 2.5);
});

test("legacy sloping plane UV fallback preserves the 3–4–5 slope length", () => {
  const uv = sheetMetricUVs({
    polygonXYZ: [
      [0, 0, 0],
      [0, 3, 4],
      [2, 3, 4],
    ],
  });
  near(uv[1][0] - uv[0][0], 5);
  near(Math.hypot(uv[2][0] - uv[1][0], uv[2][1] - uv[1][1]), 2);
});

test("wool dominant-face projection preserves 1200×600 mm joint spacing on all box faces", () => {
  for (const face of [
    [
      [2, 3, 4],
      [3.2, 3, 4],
      [3.2, 3.6, 4],
    ],
    [
      [2, 3, 4],
      [2, 3, 5.2],
      [2, 3.6, 5.2],
    ],
    [
      [2, 3, 4],
      [3.2, 3, 4],
      [3.2, 3, 4.6],
    ],
  ]) {
    const uv = insulationMetricUVs(face),
      [u, v] = textureMetres("wool");
    near(Math.abs(uv[1][0] - uv[0][0]) / u, 1);
    near(Math.abs(uv[2][1] - uv[1][1]) / v, 1);
  }
});

test("cache shares materials/maps, keeps texture on selection/xray and disposes each resource once", () => {
  const factory = mockCanvasFactory();
  const cache = createMaterialTextureCache(factory);
  assert.equal(cache.memoryBytes(), 0);
  cache.setAnisotropy(16);
  const material = cache.getMaterial("osb3"),
    selected = cache.getMaterial("osb3", true);
  assert.ok(material instanceof THREE.MeshStandardMaterial);
  assert.equal(cache.getMaterial("osb3"), material);
  assert.equal(cache.getMaterial("osb3", true), selected);
  assert.equal(selected.map, material.map);
  assert.equal(material.map, material.bumpMap);
  assert.equal(material.map.anisotropy, 16);
  assert.equal(material.map.wrapS, THREE.RepeatWrapping);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.map.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(material.transparent, false);
  assert.equal(material.opacity, 1);
  assert.equal(material.depthWrite, true);
  assert.ok(selected.emissiveIntensity > 0 && selected.emissive.getHex() !== 0);
  cache.setSheetTransparency(true);
  assert.equal(cache.getMaterial("osb3"), material);
  for (const m of [material, selected]) {
    assert.equal(m.opacity, 0.6);
    assert.equal(m.transparent, true);
    assert.equal(m.depthWrite, false);
  }
  const xrayWool = cache.getMaterial("wool");
  assert.equal(xrayWool.opacity, 0.75);
  cache.setSheetTransparency(false);
  assert.equal(xrayWool.opacity, 0.62);
  assert.equal(material.opacity, 1);
  assert.equal(selected.depthWrite, true);
  const wool = cache.getMaterial("wool");
  assert.equal(wool.opacity, 0.62);
  assert.equal(wool.depthWrite, false);
  assert.equal(factory.canvases.length, 2);
  assert.equal(cache.getPatternImage("osb3"), cache.getPatternImage("osb3"));
  assert.equal(factory.canvases.length, 2);
  // RGBA8 full mip chains: OSB 1024²=5,592,404 B; wool 512²=1,398,100 B.
  assert.equal(cache.memoryBytes(), 5592404 + 1398100);
  let materialDisposed = 0,
    textureDisposed = 0;
  for (const m of [material, selected, wool]) m.addEventListener("dispose", () => materialDisposed++);
  for (const m of [material, wool]) m.map.addEventListener("dispose", () => textureDisposed++);
  cache.dispose();
  cache.dispose();
  assert.equal(materialDisposed, 3);
  assert.equal(textureDisposed, 2);
  assert.equal(cache.memoryBytes(), 0);
  assert.notEqual(cache.getMaterial("osb3"), material);
  cache.dispose();
});

test("module cache survives one view unmount and is released by the final owner", () => {
  const originalDocument = globalThis.document;
  const factory = mockCanvasFactory();
  globalThis.document = { createElement: () => factory.createCanvas(TEXTURE_SIZE) };
  const a = acquireMaterialTextures(),
    b = acquireMaterialTextures();
  try {
    assert.equal(a.cache, b.cache);
    const material = a.cache.getMaterial("plywood-fk");
    let disposed = 0;
    material.map.addEventListener("dispose", () => disposed++);
    a.release();
    a.release();
    assert.equal(disposed, 0);
    assert.equal(b.cache.getMaterial("plywood-fk"), material);
    b.release();
    assert.equal(disposed, 1);
    assert.equal(b.cache.memoryBytes(), 0);
  } finally {
    a.release();
    b.release();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("plywood demo uses existing physical/load/cutting path and metric UVs for every sheet", () => {
  const { project, planning } = buildMaterialDemo("frame-plywood");
  assert.equal(project.sheathing.floors.product, "plywood-fsf-2500x1250");
  assert.equal(project.sheathing.floors.thickness, 21);
  assert.equal(project.sheathing.walls.thickness, 12);
  assert.ok(planning.assumptions.some((s) => s.includes("ФСФ")));
  const report = evaluateHouse(project, planning),
    model = report.result.sheetModel;
  const pieces = new Map(
    model.cutting.stocks.flatMap((s) => s.pieces).flatMap((p) => p.panelIds.map((id) => [id, p])),
  );
  for (const panel of model.panels) {
    assert.ok(pieces.has(panel.id));
    const uv = sheetMetricUVs(panel, pieces.get(panel.id));
    for (let i = 0; i < uv.length; i++) {
      const j = (i + 1) % uv.length;
      near(
        Math.hypot(...panel.polygon[i].map((v, k) => v - panel.polygon[j][k])),
        Math.hypot(uv[i][0] - uv[j][0], uv[i][1] - uv[j][1]),
      );
    }
  }
  const floor = model.panels.filter((p) => p.surfaceKind === "floors");
  assert.ok(floor.length > 0);
  for (const panel of floor) {
    // Catalog density 700 kg/m³ × 0.021 m = 14.7 kg/m², exactly once.
    near(panel.mass / panel.area, 14.7);
    assert.equal(materialFamily(panel.product), "plywood-fsf");
  }
  assert.equal(model.cutting.complete, true);
  const plywoodPurchase = model.purchases.find((p) => p.product === project.sheathing.floors.product);
  assert.ok(plywoodPurchase.count > 0);
});

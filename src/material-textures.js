import * as THREE from "three";

// Rendering choices from the texture review, not GOST/SP material properties:
// OSB chips 50–150 × 15–35 mm; 1024 px per 0.75 m, other tiles 512 px.
// Colours, contrast, roughness, opacity and relief are artistic approximations.
// No density, load, cutting or price is inferred from these display settings.
export const TEXTURE_SIZE = 512;
export const textureResolution = (family) => (family === "osb3" ? 1024 : TEXTURE_SIZE);
export const textureFamilies = ["osb3", "plywood-fk", "plywood-fsf", "wool", "plywood-edge"];
export const textureMetres = (family) =>
  family === "osb3" ? [0.75, 0.75] : family === "wool" ? [1.2, 0.6] : [1, 1];
// Wool spacing follows the existing illustrative 1200×600 mm catalogue in
// insulation.js (ROCKWOOL SCANDIC brochure cited there), not a new slab layout.
export const materialTextureAssumptions = [
  "Текстуры: художественный рисунок; ОСП — 1024×1024 на 0,75×0,75 м (0,732 мм/пиксель), 600 щепок 50–150×15–35 мм на тайл; фанера — 512×512 на 1×1 м, минвата — 512×512 на 1,2×0,6 м по иллюстративному каталогу. Швы минваты условные, не карта монтажа.",
  "Отображение: листы непрозрачные, шероховатость 0,85; «Листы: прозрачно» — 0,6; минвата — 0,62 либо 0,75 при прозрачных листах. Рельеф 0,35 мм — визуальная настройка. Нейтральные множители цвета ОСП 0,65, фанеры 0,48, минваты 0,7 и торца 0,58 компенсируют яркий свет только для этих материалов; общее освещение сохранено.",
  "Тёмные швы листов шириной 2,5 мм и минимальная экранная линия — только отображение кромок, не физический монтажный зазор. Отступ 0,15 мм предотвращает конфликт глубины и не меняет геометрию расчёта.",
  "Камера общего вида: подгонка по видимым габаритам с визуальным запасом 15%, снаружи описанной сферы; при открытой кровле над фанерным полом взгляд сверху круче для осмотра настила. Повторная подгонка после изменения размеров окна не меняет проект.",
  "Торец фанеры: ближайшее нечётное число слоёв при условных 1,5 мм/слой (не менее трёх); пакет производителя не подтверждён. Цвет ФСФ условно теплее ФК; рисунок сучков и заплаток не подтверждает сорт II/III.",
];

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Approximation requested for visual edges only; actual veneer layup must be
// obtained from the supplier. This MUST NOT enter SP 64 stiffness/strength checks.
export function plywoodPlyCount(thicknessMM) {
  if (!Number.isFinite(thicknessMM) || thicknessMM <= 0) throw Error("Некорректная толщина фанеры.");
  return Math.max(3, 2 * Math.round((thicknessMM / 1.5 - 1) / 2) + 1);
}

export function materialFamily(product = "osb3") {
  if (product.startsWith("plywood-fsf")) return "plywood-fsf";
  if (product.startsWith("plywood-fk")) return "plywood-fk";
  if (product.startsWith("wool")) return "wool";
  return "osb3"; // Legacy structural sheets were the viewer's OSB stand-in.
}

function path(ctx, points, fill, stroke, width) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const q of points.slice(1)) ctx.lineTo(...q);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

// Paint every boundary-crossing feature on neighbouring tiles too. Keeping the
// same feature parameters for every copy makes all generators periodic.
function wrapped(draw, x, y, width, height) {
  // All features below fit within this visual padding; skip off-canvas copies.
  const padding = Math.max(width, height) * 0.16;
  const xs = [x],
    ys = [y];
  if (x < padding) xs.push(x + width);
  if (x > width - padding) xs.push(x - width);
  if (y < padding) ys.push(y + height);
  if (y > height - padding) ys.push(y - height);
  for (const a of xs) for (const b of ys) draw(a, b);
}

function ellipse(ctx, x, y, rx, ry, fill, stroke, width) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Metric chip geometry is separate from painting so its real scale and density
 * can be checked without a browser. Density is an artistic review target, not a
 * manufacturer specification. A 0.75² m² tile has 600 chips (1066.67 per m²).
 */
export function osbChips(seed = 731) {
  const random = seededRandom(seed),
    [metres] = textureMetres("osb3");
  return Array.from({ length: 600 }, (_, i) => {
    const x = random() * metres,
      y = random() * metres,
      length = 0.05 + random() * 0.1,
      width = 0.015 + random() * 0.02,
      angle = ((random() - 0.5) * Math.PI) / 3 + (i % 8 === 0 ? Math.PI / 2 : 0),
      tone = Math.floor(random() * 6),
      // Wide, flat flakes with asymmetric torn ends. Both transverse extremes
      // remain exactly ±width/2; no hairline stroke stands in for a chip.
      points = [
        [-length / 2, -width * (0.28 + random() * 0.16)],
        [-length * 0.29, -width / 2],
        [length * 0.31, -width * (0.36 + random() * 0.14)],
        [length / 2, -width * 0.24],
        [length * (0.37 + random() * 0.09), width * 0.04],
        [length * 0.46, width * 0.3],
        [length * 0.16, width / 2],
        [-length * 0.36, width * (0.3 + random() * 0.16)],
        [-length * 0.43, width * 0.12],
      ];
    return { x, y, length, width, angle, tone, points };
  });
}

export function drawOSB(ctx, size = textureResolution("osb3"), seed = 731) {
  const tones = ["#e6cc91", "#d8b46b", "#c69a4b", "#b27e32", "#986326", "#e2bd78"],
    [metres] = textureMetres("osb3"),
    scale = size / metres;
  ctx.fillStyle = "#b48643";
  ctx.fillRect(0, 0, size, size);
  for (const chip of osbChips(seed)) {
    const c = Math.cos(chip.angle),
      s = Math.sin(chip.angle);
    wrapped(
      (a, b) => {
        const points = chip.points.map(([u, v]) => [
          a + (u * c - v * s) * scale,
          b + (u * s + v * c) * scale,
        ]);
        // Offset silhouette gives a shallow overlap shadow, not a fibre outline.
        path(
          ctx,
          points.map(([u, v]) => [u + scale * 0.0012, v + scale * 0.0014]),
          "#59391655",
        );
        path(ctx, points, tones[chip.tone], "#67451f99", scale * 0.0007);
        path(
          ctx,
          [
            points[0],
            points[1],
            points[2],
            [points[2][0] + s * scale * 0.002, points[2][1] - c * scale * 0.002],
            [points[0][0] + s * scale * 0.002, points[0][1] - c * scale * 0.002],
          ],
          "#fff0c92d",
        );
      },
      chip.x * scale,
      chip.y * scale,
      size,
      size,
    );
  }
  surfaceNoise(ctx, seededRandom(seed ^ 0x5a71), size, 3000, "#6e52221b", "#fff2d524");
}

function surfaceNoise(ctx, random, size, count, dark, light) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = i % 2 ? dark : light;
    ctx.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 1);
  }
}

export function drawPlywood(ctx, size = TEXTURE_SIZE, seed = 829, fsf = false) {
  const random = seededRandom(seed);
  ctx.fillStyle = fsf ? "#cdb07c" : "#e3cfa3";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 180; i++) {
    const y = random() * size,
      amplitude = (0.0015 + random() * 0.005) * size,
      phase = random() * Math.PI * 2;
    ctx.strokeStyle = i % 4 ? "#88602f70" : "#fff0c888";
    ctx.lineWidth = size * (0.0008 + random() * 0.0015);
    for (const dy of [-size, 0, size]) {
      ctx.beginPath();
      for (let j = 0; j <= 64; j++) {
        const x = (j * size) / 64,
          v = y + dy + amplitude * Math.sin((j * Math.PI) / 32 + phase);
        if (j) ctx.lineTo(x, v);
        else ctx.moveTo(x, v);
      }
      ctx.stroke();
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = random() * size,
      y = random() * size,
      rx = (0.024 + random() * 0.022) * size,
      ry = (0.008 + random() * 0.01) * size;
    wrapped(
      (a, b) => {
        if (i % 3 === 0) {
          ellipse(ctx, a, b, rx * 1.7, ry * 1.6, fsf ? "#e0c395" : "#eddbb5", "#80592dbb", size * 0.0015);
          for (let k = -2; k <= 2; k++) {
            ctx.beginPath();
            ctx.moveTo(a - rx * 1.2, b + k * ry * 0.35);
            ctx.lineTo(a + rx * 1.2, b + k * ry * 0.35);
            ctx.strokeStyle = "#92652b70";
            ctx.stroke();
          }
        } else {
          for (let k = 4; k >= 1; k--)
            ellipse(ctx, a, b, (rx * k) / 3, (ry * k) / 3, "#a876343b", "#795027a0", size * 0.0013);
        }
      },
      x,
      y,
      size,
      size,
    );
  }
  surfaceNoise(ctx, random, size, 1200, "#926e3020", "#fffbed40");
}

export function drawWool(ctx, size = TEXTURE_SIZE, seed = 937) {
  const random = seededRandom(seed),
    tones = ["#d2cd9c", "#9b9e69", "#e0d9ae", "#b8b77f", "#7c8556", "#aaa973"];
  ctx.fillStyle = "#bebc87";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 8500; i++) {
    const x = random() * size,
      y = random() * size,
      angle = random() * Math.PI * 2,
      length = 0.004 + random() * 0.024,
      dx = (Math.cos(angle) * length * size) / 1.2,
      dy = (Math.sin(angle) * length * size) / 0.6,
      tone = tones[Math.floor(random() * tones.length)];
    wrapped(
      (a, b) => {
        ctx.beginPath();
        ctx.moveTo(a, b);
        ctx.lineTo(a + dx, b + dy);
        ctx.strokeStyle = tone;
        ctx.lineWidth = size * 0.002;
        ctx.stroke();
      },
      x,
      y,
      size,
      size,
    );
  }
  surfaceNoise(ctx, random, size, 1800, "#3d492ac0", "#e4dfb980");
  // Soft joint: nested translucent strokes centred on the periodic boundaries.
  for (const width of [0.016, 0.008, 0.003]) {
    ctx.strokeStyle = "#535d3980";
    for (const edge of [0, size]) {
      ctx.lineWidth = (width * size) / 1.2;
      ctx.beginPath();
      ctx.moveTo(edge, 0);
      ctx.lineTo(edge, size);
      ctx.stroke();
      ctx.lineWidth = (width * size) / 0.6;
      ctx.beginPath();
      ctx.moveTo(0, edge);
      ctx.lineTo(size, edge);
      ctx.stroke();
    }
  }
}

export function drawMaterialTexture(ctx, family, size = textureResolution(family), seed) {
  if (family === "osb3") return drawOSB(ctx, size, seed);
  if (family === "plywood-fk" || family === "plywood-fsf")
    return drawPlywood(ctx, size, seed, family === "plywood-fsf");
  if (family === "wool") return drawWool(ctx, size, seed);
  if (family !== "plywood-edge") throw Error("Неизвестная текстура материала.");
  ctx.fillStyle = "#e5d2ae";
  ctx.fillRect(0, 0, size, size / 2);
  ctx.fillStyle = "#9f7d4f";
  ctx.fillRect(0, size / 2, size, size / 2);
}

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => v.map((x) => x / Math.hypot(...v));

/** U is the purchased sheet's long axis, V its short axis, both in metres.
 * The cutting placement, not the bounding box of a clipped triangle, determines
 * grain direction. localPolygon already uses an orthonormal metric surface basis.
 */
export function sheetMetricUVs(panel, piece) {
  const polygon = panel.polygon ?? panel.polygonXYZ;
  if (panel.localPolygon?.length === polygon.length) {
    return panel.localPolygon.map((q) => {
      if (piece) {
        const x = q.x - piece.localOrigin.x,
          y = q.y - piece.localOrigin.y;
        return piece.rotated ? [piece.x + piece.sourceHeight - y, piece.y + x] : [piece.x + x, piece.y + y];
      }
      return panel.surfaceKind === "walls" || panel.wallId ? [q.y, q.x] : [q.x, q.y];
    });
  }
  // Legacy polygons without local coordinates: orthonormal in-plane projection,
  // never world-axis projection (which would shrink a sloping roof's grain).
  const origin = polygon[0],
    u = unit(sub(polygon[1], origin)),
    normal = unit(cross(u, sub(polygon[2], origin))),
    v = unit(cross(normal, u));
  return polygon.map((q) => [dot(sub(q, origin), u), dot(sub(q, origin), v)]);
}

/** Dominant-axis per-face projection; no texture stretching across cell faces. */
export function insulationMetricUVs(face) {
  const n = cross(sub(face[1], face[0]), sub(face[2], face[0])).map(Math.abs),
    axis = n.indexOf(Math.max(...n));
  return face.map((q) => (axis === 0 ? [q[2], q[1]] : axis === 1 ? [q[0], q[2]] : [q[0], q[1]]));
}

function browserCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  return canvas;
}

/** Injectable canvas factory keeps cache/lifecycle tests independent of a DOM. */
export function createMaterialTextureCache({ createCanvas = browserCanvas } = {}) {
  const textures = new Map(),
    materials = new Map(),
    images = new Map();
  let anisotropy = 1,
    transparentSheets = false;
  function getTexture(family) {
    if (!textures.has(family)) {
      const size = textureResolution(family),
        canvas = createCanvas(size);
      // Canvas 2D and PNG data URLs use sRGB; WebGL explicitly matches it below.
      drawMaterialTexture(canvas.getContext("2d", { colorSpace: "srgb" }), family, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.name = `Процедурная текстура · ${family}`;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      const [tileU, tileV] = textureMetres(family);
      // UVs stay in metres. Repeat converts metres to tile coordinates once.
      if (family !== "wool" && family !== "plywood-edge") texture.repeat.set(1 / tileU, 1 / tileV);
      texture.anisotropy = anisotropy;
      texture.userData.proceduralTexture = true;
      textures.set(family, texture);
    }
    return textures.get(family);
  }
  function getMaterial(family, selected = false) {
    const key = `${family}:${selected}`;
    if (!materials.has(key)) {
      const material = selected
        ? getMaterial(family).clone()
        : new THREE.MeshStandardMaterial({
            map: getTexture(family),
            bumpMap: family === "plywood-edge" ? null : getTexture(family),
            bumpScale: 0.00035,
            roughness: family === "wool" ? 1 : 0.85,
            side: THREE.DoubleSide,
          });
      if (!selected)
        material.color.setScalar(
          family === "osb3"
            ? 0.65
            : family.startsWith("plywood-") && family !== "plywood-edge"
              ? 0.48
              : family === "wool"
                ? 0.7
                : 0.58,
        );
      material.userData.proceduralTexture = true;
      material.userData.family = family;
      if (selected) {
        material.emissive.set("#b46b28");
        material.emissiveIntensity = 0.35;
      }
      materials.set(key, material);
      setOpacity(material);
    }
    return materials.get(key);
  }
  function setOpacity(material) {
    const wool = material.userData.family === "wool",
      transparent = wool || transparentSheets;
    if (material.transparent !== transparent) material.needsUpdate = true;
    material.transparent = transparent;
    material.opacity = wool ? (transparentSheets ? 0.75 : 0.62) : transparentSheets ? 0.6 : 1;
    material.depthWrite = !transparent;
  }
  return {
    getTexture,
    getMaterial,
    setSheetTransparency(value) {
      transparentSheets = !!value;
      materials.forEach(setOpacity);
    },
    setAnisotropy(value) {
      anisotropy = value;
      textures.forEach((texture) => {
        if (texture.anisotropy !== value) {
          texture.anisotropy = value;
          texture.needsUpdate = true;
        }
      });
    },
    getPatternImage(family) {
      if (!images.has(family)) images.set(family, getTexture(family).image.toDataURL("image/png"));
      return images.get(family);
    },
    // RGBA8 + the complete mip chain; excludes driver padding and JS canvases.
    memoryBytes() {
      return [...textures.keys()].reduce((bytes, family) => {
        const size = textureResolution(family),
          levels = Math.log2(size) + 1;
        return bytes + (size ** 2 * 4 * (1 - 0.25 ** levels)) / 0.75;
      }, 0);
    },
    dispose() {
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      materials.clear();
      textures.clear();
      images.clear();
      transparentSheets = false;
    },
  };
}

const sharedCache = createMaterialTextureCache();
let owners = 0;
export function acquireMaterialTextures() {
  owners++;
  let released = false;
  return {
    cache: sharedCache,
    release() {
      if (released) return;
      released = true;
      if (--owners === 0) sharedCache.dispose();
    },
  };
}

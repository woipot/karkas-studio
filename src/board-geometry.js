import * as THREE from "three";
function profileLayersGeometry(layers, plane) {
  const values = [];
  for (const layer of layers) {
    const shape = new THREE.Shape(layer.points.map((p) => new THREE.Vector2(...p))),
      g = new THREE.ExtrudeGeometry(shape, { depth: layer.to - layer.from, bevelEnabled: false, steps: 1 }),
      p = g.getAttribute("position");
    for (let i = 0; i < p.count; i += 3)
      for (const j of plane === "width" ? [0, 2, 1] : [0, 1, 2]) {
        const k = i + j,
          s = p.getX(k),
          v = p.getY(k),
          e = p.getZ(k) + layer.from;
        values.push(...(plane === "width" ? [v, s, e] : [e, s, v]));
      }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  geo.computeVertexNormals();
  return geo;
}
export function cutGeometry(board) {
  const b = board.b / 1000,
    h = board.h / 1000,
    L = board.length,
    cs = board.cutStart || {},
    ce = board.cutEnd || {};
  if (board.shape?.type === "layeredProfile")
    return profileLayersGeometry(board.shape.layers, board.shape.plane ?? "depth");
  if (board.shape?.plane === "width" && board.shape.points)
    return profileLayersGeometry([{ from: -h / 2, to: h / 2, points: board.shape.points }], "width");
  const isLap = (c) => ["halfLap", "half-lap", "scarf"].includes(c.scheme) && c.lapLength > 0;
  const grooves = (board.notches ?? [])
    .filter(
      (n) =>
        n.shape === "verticalStudGroove" &&
        !n.requiresCutBoolean &&
        Number.isFinite(n.station) &&
        n.length > 0 &&
        n.depth > 0,
    )
    .map((n) => ({ ...n, from: n.station - n.length / 2, to: n.station + n.length / 2 }));
  const xs = [0, L];
  if (isLap(cs)) xs.push(cs.lapLength - 0.00001, cs.lapLength);
  if (isLap(ce)) xs.push(L - ce.lapLength, L - ce.lapLength + 0.00001);
  for (const n of grooves) xs.push(n.from - 0.00001, n.from, n.to, n.to + 0.00001);
  const cuts = [...new Set(xs.map((x) => Math.max(0, Math.min(L, x))))].sort((a, b) => a - b);
  function bounds(x) {
    let low = -h / 2,
      high = h / 2;
    for (const [cut, start] of [
      [cs, true],
      [ce, false],
    ]) {
      if (!isLap(cut)) continue;
      const from = start ? x : L - x;
      if (from >= cut.lapLength) continue;
      const top = cut.lapSide === "top";
      if (cut.scheme === "scarf") {
        if (top) high = -h / 2 + (h * from) / cut.lapLength;
        else low = h / 2 - (h * from) / cut.lapLength;
      } else {
        if (top) high = 0;
        else low = 0;
      }
    }
    for (const n of grooves)
      if (x >= n.from && x <= n.to) {
        if (n.faceSign > 0) high = Math.min(high, h / 2 - n.depth);
        else low = Math.max(low, -h / 2 + n.depth);
      }
    return [low, high];
  }
  const profile =
    ["stairStringer", "rafterSeats", "rippedBoard"].includes(board.shape?.type) &&
    Array.isArray(board.shape.points)
      ? board.shape.points
      : null;
  let points = profile ?? [
    ...cuts.map((x) => [x - L / 2, bounds(x)[0]]),
    ...[...cuts].reverse().map((x) => [x - L / 2, bounds(x)[1]]),
  ];
  points = points.map(([s, z]) => {
    if (cs.scheme === "miter" && cs.plane !== "width" && Math.abs(s + L / 2) < 1e-5)
      s += z * Math.tan(((cs.angle || 0) * Math.PI) / 180) * (cs.tiltSign ?? 1);
    if (ce.scheme === "miter" && ce.plane !== "width" && Math.abs(s - L / 2) < 1e-5)
      s -= z * Math.tan(((ce.angle || 0) * Math.PI) / 180) * (ce.tiltSign ?? 1);
    return new THREE.Vector2(s, z);
  });
  const shape = new THREE.Shape(points),
    geo = new THREE.ExtrudeGeometry(shape, { depth: b, bevelEnabled: false, steps: 1 }),
    pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let a = pos.getX(i);
    const d = pos.getY(i),
      c = pos.getZ(i),
      x = c - b / 2;
    if (ce.scheme === "miter" && ce.plane === "width" && Math.abs(a - L / 2) < 1e-5)
      a += x * Math.tan(((ce.angle || 0) * Math.PI) / 180) * (ce.tiltSign ?? 1);
    if (cs.scheme === "miter" && cs.plane === "width" && Math.abs(a + L / 2) < 1e-5)
      a += x * Math.tan(((cs.angle || 0) * Math.PI) / 180) * (cs.tiltSign ?? 1);
    for (const n of grooves)
      if (Math.abs(a + L / 2 - n.from) < 0.00003 || Math.abs(a + L / 2 - n.to) < 0.00003)
        a += (n.localSlope ?? n.slope ?? 0) * x;
    pos.setXYZ(i, x, a, d);
  }
  geo.computeVertexNormals();
  return geo;
}

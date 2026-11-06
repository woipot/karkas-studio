import { solveUniformOverhangBeam } from "./rafters.js";
/** Physical, single-plane raised-heel truss boards. Local x=span, y=up, m.
 * FEM panel nodes do not create physical splices in the continuous chords.
 * Joint profiles are geometric cuts, never a gusset/connection certification. */
const EPS = 1e-8,
  dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  dot = (a, b) => a.x * b.x + a.y * b.y;
const area = (p) =>
  Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0)) /
  2;
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      fa = f(a),
      fb = f(b);
    if (fa >= -EPS) out.push(a);
    if (fa >= -EPS !== fb >= -EPS) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
export function physicalTrussBoards(truss) {
  const p = truss.input ?? {},
    nodes = truss.nodes ?? [],
    bars = truss.bars ?? [],
    map = new Map(nodes.map((n) => [n.id, n])),
    A = map.get("A"),
    B = map.get("B"),
    R = map.get("R"),
    HA = map.get("HA") ?? A,
    HB = map.get("HB") ?? B;
  if (!A || !B || !R || p.type === "mono")
    throw new Error("Physical pitched truss requires A/B/R and a non-mono topology.");
  const leftSlope = (R.y - HA.y) / (R.x - HA.x),
    rightSlope = (R.y - HB.y) / (HB.x - R.x),
    left = { x: HA.x - (p.overhangLow ?? 0), y: HA.y - leftSlope * (p.overhangLow ?? 0) },
    right = { x: HB.x + (p.overhangHigh ?? 0), y: HB.y - rightSlope * (p.overhangHigh ?? 0) };
  const chordLines = [
      { a: A, b: B, role: "bottomChord" },
      { a: HA, b: R, role: "topChord", side: "low" },
      { a: HB, b: R, role: "topChord", side: "high" },
    ],
    out = [];
  const add = (id, role, a, b, section, extra = {}) => {
    const length = dist(a, b),
      volume = (section.b * section.h * length) / 1e6,
      board = {
        id,
        role,
        start: { ...a },
        end: { ...b },
        length,
        b: section.b,
        h: section.h,
        volume,
        mass: volume * p.timberDensity,
        requireSingleStock: true,
        cutStart: { scheme: "butt", angle: 0 },
        cutEnd: { scheme: "butt", angle: 0 },
        ...extra,
      };
    out.push(board);
    return board;
  };
  add(
    "BOTTOM",
    "bottomChord",
    A,
    B,
    { b: p.chordB, h: p.chordH },
    { sourceBarIds: bars.filter((b) => b.role === "bottom").map((b) => b.id) },
  );
  for (const [side, start, heel, slope] of [
    ["low", left, HA, leftSlope],
    ["high", right, HB, rightSlope],
  ]) {
    const angle = (Math.atan(slope) * 180) / Math.PI;
    add(
      "TOP-" + side,
      "topChord",
      start,
      R,
      { b: p.chordB, h: p.chordH },
      {
        side,
        bearingStart: { ...heel },
        bearingEnd: { ...R },
        sourceBarIds: bars
          .filter(
            (b) =>
              b.role === "top" && (map.get(b.nodeA).x + map.get(b.nodeB).x) / 2 < R.x === (side === "low"),
          )
          .map((b) => b.id),
        cutStart: { scheme: "miter", plane: "depth", angle, tiltSign: -1 },
        cutEnd: { scheme: "miter", plane: "depth", angle, tiltSign: 1 },
      },
    );
  }
  const webs = bars.filter((b) => b.role === "web");
  for (const web of webs) {
    const a = map.get(web.nodeA),
      b = map.get(web.nodeB),
      L = dist(a, b),
      d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L },
      z = { x: d.y, y: -d.x },
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      world = (q) => ({ x: mid.x + d.x * q[0] + z.x * q[1], y: mid.y + d.y * q[0] + z.y * q[1] }),
      half = web.h / 2000;
    let poly = [
      [-L / 2, -half],
      [L / 2, -half],
      [L / 2, half],
      [-L / 2, half],
    ];
    for (const [nodeId, node, other] of [
      [web.nodeA, a, b],
      [web.nodeB, b, a],
    ]) {
      for (const chord of chordLines) {
        const C = dist(chord.a, chord.b),
          cd = { x: (chord.b.x - chord.a.x) / C, y: (chord.b.y - chord.a.y) / C },
          normal = { x: -cd.y, y: cd.x },
          offset = (q) => dot({ x: q.x - chord.a.x, y: q.y - chord.a.y }, normal),
          along = dot({ x: node.x - chord.a.x, y: node.y - chord.a.y }, cd);
        if (Math.abs(offset(node)) > EPS || along < -EPS || along > C + EPS) continue;
        const sign = Math.sign(offset(mid));
        if (!sign) throw new Error("Web is collinear with a chord at the joint.");
        poly = clip(poly, (q) => sign * offset(world(q)) - p.chordH / 2000);
      }
      const own = { x: (other.x - node.x) / L, y: (other.y - node.y) / L };
      for (const neighbor of webs.filter(
        (w) => w.id !== web.id && (w.nodeA === nodeId || w.nodeB === nodeId),
      )) {
        const far = map.get(neighbor.nodeA === nodeId ? neighbor.nodeB : neighbor.nodeA),
          D = dist(node, far),
          ray = { x: (far.x - node.x) / D, y: (far.y - node.y) / D },
          N = { x: own.x - ray.x, y: own.y - ray.y };
        poly = clip(poly, (q) => dot({ x: world(q).x - node.x, y: world(q).y - node.y }, N));
      }
    }
    const A = area(poly),
      cutLength = poly.length ? Math.max(...poly.map((q) => q[0])) - Math.min(...poly.map((q) => q[0])) : 0;
    if (A < 1e-8 || cutLength < 0.005)
      throw new Error("Joint cuts consume a web; change truss height, section or joint layout.");
    const volume = (A * web.b) / 1000;
    add("WEB-" + web.id, "web", a, b, web, {
      sourceBarIds: [web.id],
      shape: { type: "rippedBoard", points: poly },
      shapeNetVolume: volume,
      shapeGrossVolume: (cutLength * web.b * web.h) / 1e6,
      shapeCutLength: cutLength,
      volume,
      mass: volume * p.timberDensity,
      cutLength,
      connectionVerified: false,
    });
  }
  return out;
}

/** Local gravity bending screen of the continuous upper chords and their tails.
 * Pin-jointed FEM axial forces are combined transparently with local bending.
 * It does not supply plate stiffness, rotational restraint or lateral stability. */

export function checkPhysicalTrussChords(truss, { Fb = 13, Fv = 1.5, Ft = 8, Fc = 12, E = 10000 } = {}) {
  const p = truss.input,
    map = new Map(truss.nodes.map((n) => [n.id, n])),
    physical = truss.physicalReference ?? physicalTrussBoards(truss),
    chords = physical.filter((b) => b.role === "topChord"),
    results = [];
  for (const chord of chords) {
    const bars = truss.bars.filter((b) => chord.sourceBarIds.includes(b.id)),
      cos = Math.abs(chord.end.x - chord.start.x) / chord.length,
      sine = Math.sqrt(1 - cos * cos),
      tail = truss.tails?.find((t) => t.side === chord.side),
      Le = tail?.slopeLength ?? 0,
      L1 = chord.side === "low" ? bars[0].length : bars.at(-1).length,
      I = (chord.b * chord.h ** 3) / 12,
      Z = (chord.b * chord.h ** 2) / 6,
      A = chord.b * chord.h,
      localMu = chord.side === "low" ? (p.muLeft ?? p.mu) : (p.muRight ?? p.mu),
      dead = p.roofDead * p.spacing + (((chord.b * chord.h) / 1e6) * p.timberDensity * 9.80665) / 1000,
      snow = p.snow * localMu * p.spacing * cos,
      qService = (dead + snow) * cos,
      qDesign = (dead * p.gammaG + snow * p.gammaQ) * cos,
      sol = solveUniformOverhangBeam({
        length: Le + L1,
        supportA: Le,
        supportB: Le + L1,
        qService,
        qDesign,
        E,
        I,
      }),
      panelM = Math.max(...bars.map((b) => (qDesign * b.length * b.length) / 8)),
      maxMoment = Math.max(sol.maxMoment, panelM),
      force = bars.reduce((a, b) => (Math.abs(a) > Math.abs(b.force) ? a : b.force), 0),
      axialStress = (Math.abs(force) * 1000) / A,
      bendingStress = (maxMoment * 1e6) / Z,
      interaction = axialStress / (force < 0 ? Fc : Ft) + bendingStress / Fb,
      shearStress = (1.5 * Math.max(sol.maxShear, ...bars.map((b) => (qDesign * b.length) / 2)) * 1000) / A,
      localDeflection = Math.max(
        sol.maxDeflection,
        ...bars.map((b) => (5 * qService * (b.length * 1000) ** 4) / (384 * E * I)),
      ),
      nodeDeflection = Math.max(...truss.displacements.map((d) => Math.abs(d.y))),
      deflection = localDeflection * cos + nodeDeflection,
      deflectionLimit = (p.span * 1000) / (p.deflectionLimit ?? 300),
      tailDeflection = Le > 0 ? Math.abs(sol.at(0).deflection) * cos + nodeDeflection : 0,
      tailLimit = Le > 0 ? (2 * tail.horizontal * 1000) / (p.deflectionLimit ?? 300) : null,
      utilization = Math.max(
        interaction,
        shearStress / Fv,
        deflection / deflectionLimit,
        tailLimit ? tailDeflection / tailLimit : 0,
      );
    results.push({
      id: chord.id,
      side: chord.side,
      length: chord.length,
      unbracedLength: chord.length,
      tailLength: Le,
      tailHorizontal: tail?.horizontal ?? 0,
      qService,
      qDesign,
      force,
      axialStress,
      bendingStress,
      shearStress,
      interaction,
      maxMoment,
      deflection,
      deflectionLimit,
      tailDeflection,
      tailLimit,
      utilization,
      status: utilization > 1 ? "fail" : "pass",
      partial: true,
      certified: false,
      assumption:
        "Local simple upper panel with end cantilever plus FEM node displacement; joint rotation, full frame bending and lateral stability are not certified.",
    });
  }
  const bottom = physical.find((b) => b.role === "bottomChord"),
    bottomBars = truss.bars.filter((b) => b.role === "bottom"),
    qService =
      (p.ceilingDead ?? 0) * (p.ceilingSpacing ?? p.spacing) +
      (((bottom.b * bottom.h) / 1e6) * p.timberDensity * 9.80665) / 1000,
    qDesign = qService * p.gammaG,
    I = (bottom.b * bottom.h ** 3) / 12,
    Z = (bottom.b * bottom.h ** 2) / 6,
    A = bottom.b * bottom.h,
    maxMoment = Math.max(...bottomBars.map((b) => (qDesign * b.length * b.length) / 8)),
    maxForce = bottomBars.reduce((a, b) => (Math.abs(a) > Math.abs(b.force) ? a : b.force), 0),
    axialStress = (Math.abs(maxForce) * 1000) / A,
    bendingStress = (maxMoment * 1e6) / Z,
    interaction = axialStress / (maxForce < 0 ? Fc : Ft) + bendingStress / Fb,
    shearStress = (1.5 * Math.max(...bottomBars.map((b) => (qDesign * b.length) / 2)) * 1000) / A,
    deflection =
      Math.max(...bottomBars.map((b) => (5 * qService * (b.length * 1000) ** 4) / (384 * E * I))) +
      Math.max(...truss.displacements.filter((d) => map.get(d.node).y === 0).map((d) => Math.abs(d.y))),
    deflectionLimit = (p.span * 1000) / (p.deflectionLimit ?? 300),
    utilization = Math.max(interaction, shearStress / Fv, deflection / deflectionLimit);
  results.push({
    id: bottom.id,
    side: "bottom",
    length: bottom.length,
    unbracedLength: bottom.length,
    qService,
    qDesign,
    force: maxForce,
    axialStress,
    bendingStress,
    shearStress,
    interaction,
    maxMoment,
    deflection,
    deflectionLimit,
    utilization,
    status: utilization > 1 ? "fail" : "pass",
    partial: true,
    certified: false,
    assumption:
      "Ceiling pressure and own weight between actual truss panel nodes; FEM node deformation added. Connections and full beam-column stability remain unverified.",
  });
  return {
    members: results,
    checks: [
      ...results.map((r) => ({
        id: "physical-" + r.id,
        label:
          r.side === "bottom"
            ? "Нижний пояс: потолочная нагрузка/осевая сила/изгиб/срез/прогиб"
            : "Верхний пояс и свес: местный изгиб/осевая сила/срез/прогиб",
        status: r.status,
        value: r.utilization,
        limit: 1,
        partial: true,
      })),
      {
        id: "physical-chord-stability",
        label: "Неразрезные пояса: раскрепление и узлы",
        status: "unverified",
        note: "Физический пояс не разрезан по FEM-панелям. Устойчивость по его действительной длине, вращения узлов, пластины и передача момента хвостов требуют расчёта.",
      },
    ],
    certified: false,
  };
}

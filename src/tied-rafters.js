import { solveFrame2D } from "./planar-frame.js";
const EPS = 1e-8,
  G = 9.80665,
  sum = (a) => a.reduce((s, x) => s + x, 0),
  finite = Number.isFinite;
const section = (s, f) => {
  const m = String(s ?? f).match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (!m) throw Error("Некорректное сечение стропильной рамы.");
  return { b: +m[1], h: +m[2] };
};
const clip = (p, f) => {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length],
      fa = f(a),
      fb = f(b);
    if (fa >= -EPS) out.push(a);
    if (fa >= -EPS !== fb >= -EPS) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
};
function polygonInfo(poly) {
  let A = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      q = a.x * b.y - b.x * a.y;
    A += q;
    x += (a.x + b.x) * q;
    y += (a.y + b.y) * q;
  }
  if (Math.abs(A) < EPS) throw Error("Подрезка поглощает деталь стропильной рамы.");
  return { area: Math.abs(A) / 2, centroid: { x: x / (3 * A), y: y / (3 * A) } };
}
const length = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
/** One actual timber tied-rafter frame. Local x across span, y above wall top(m).
 * Continuous rafters have beam EI; the collar/knees are pinned axial members.
 * Actual seat/scarf profiles never certify gussets or rotational restraint. */
export function calculateTiedRafters(input = {}) {
  const p = {
      span: 5.85,
      pitch: 25,
      chordSection: "50x150",
      webSection: "50x100",
      spacing: 1,
      ceilingSpacing: null,
      kneeRun: 0.8,
      collarHeightRatio: 0.75,
      collarConnection: "inPlane",
      collarEndInset: 0.025,
      ceilingDrop: 0.3,
      wallDepthLow: 0.15,
      wallDepthHigh: 0.15,
      overhangLow: 0.52,
      overhangHigh: 0.42,
      roofDead: 0.4,
      ceilingDead: 0.2,
      snow: 1.5,
      mu: 1,
      gammaG: 1.1,
      gammaQ: 1.4,
      E: 10000,
      Fb: 13,
      Ft: 8,
      Fc: 13,
      Fv: 1.6,
      density: 450,
      deflectionRatio: 300,
      ...input,
    },
    out = {
      input: p,
      nodes: [],
      elements: [],
      boards: [],
      members: [],
      connections: [],
      checks: [],
      errors: [],
      status: "fail",
      stable: false,
      certified: false,
      assumptions: [],
      sources: [
        {
          title: "TU Delft · 2D frame beam elements",
          url: "https://teachbooks.tudelft.nl/computational-modelling/structural_linear/space_frame.html",
        },
        {
          title: "AWC · Collar tie and rafter tie have different functions",
          url: "https://awc.org/faq/what-is-the-difference-between-a-collar-tie-and-a-rafter-tie/",
        },
        {
          title: "SBCA · Roof truss heels and physical joints",
          url: "https://www.sbcacomponents.com/roof-trusses",
        },
      ],
    };
  try {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw Error("Параметры стропильной рамы должны быть объектом.");
    if (!["inPlane", "faceLap"].includes(p.collarConnection))
      throw Error("collarConnection: inPlane или faceLap.");
    if (!finite(p.collarEndInset) || p.collarEndInset < 0 || p.collarEndInset > 0.2)
      throw Error("collarEndInset: конечный горизонтальный отступ0…0,2м.");
    if (p.Emin !== undefined && (!finite(p.Emin) || p.Emin < 1000 || p.Emin > 30000))
      throw Error("Emin: конечное число1000…30000МПа.");
    for (const [k, lo, hi] of [
      ["span", 1, 15],
      ["pitch", 10, 50],
      ["spacing", 0.001, 3],
      ["kneeRun", 0.4, 1],
      ["collarHeightRatio", 0.4, 0.9],
      ["ceilingDrop", 0, 1],
      ["wallDepthLow", 0.05, 0.6],
      ["wallDepthHigh", 0.05, 0.6],
      ["overhangLow", 0, 2],
      ["overhangHigh", 0, 2],
      ["roofDead", 0, 15],
      ["ceilingDead", 0, 15],
      ["snow", 0, 15],
      ["mu", 0, 3],
      ["gammaG", 1, 2],
      ["gammaQ", 1, 3],
      ["E", 1000, 30000],
      ["Fb", 0.1, 100],
      ["Ft", 0.1, 100],
      ["Fc", 0.1, 100],
      ["Fv", 0.1, 30],
      ["density", 100, 1500],
      ["deflectionRatio", 150, 600],
    ])
      if (!finite(p[k]) || p[k] < lo || p[k] > hi) throw Error(k + ": значение вне допустимого диапазона.");
    const top = section(p.chordSection),
      tie = section(p.tieSection, p.chordSection),
      knee = section(p.kneeSection, p.webSection),
      collar = section(p.collarSection, p.webSection);
    for (const q of [top, tie, knee, collar])
      if (q.b < 25 || q.b > 300 || q.h < q.b || q.h > 600)
        throw Error("Недопустимое сечение стропильной рамы.");
    const angle = (p.pitch * Math.PI) / 180,
      c = Math.cos(angle),
      t = Math.tan(angle),
      S = p.span,
      R = S / 2,
      H = R * t,
      topAxis = top.h / 2000 / c,
      tieAxis = tie.h / 2000,
      heelX = (tieAxis - topAxis) / t,
      collarX = R * p.collarHeightRatio,
      kneeX = p.kneeRun,
      ceilW = p.ceilingSpacing ?? p.spacing;
    if (!finite(ceilW) || ceilW < 0 || ceilW > 3) throw Error("ceilingSpacing:0…3м.");
    if (top.h / 1000 - (Math.sin(angle) * Math.max(p.wallDepthLow, p.wallDepthHigh)) / 2 <= 0.005)
      throw Error("Опорный запил поглощает сечение стропила. Измените сечение или геометрию опирания.");
    if (kneeX >= collarX - 0.15) throw Error("Внутренняя стойка должна располагаться перед верхним ригелем.");
    if (p.overhangLow < p.wallDepthLow / 2 - EPS || p.overhangHigh < p.wallDepthHigh / 2 - EPS)
      throw Error("Карниз должен закрывать внешнюю половину опорной стены для указанного запила.");
    const roofY = (x) => topAxis + t * Math.min(x, S - x),
      bearingX = [-p.wallDepthLow / 4, S + p.wallDepthHigh / 4];
    const addBoard = (id, role, a, b, sec, poly) => {
      const L = length(a, b),
        dx = (b.x - a.x) / L,
        dy = (b.y - a.y) / L,
        widthSign = role === "topChord" && dx < 0 ? -1 : 1,
        z = { x: widthSign * dy, y: -widthSign * dx },
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        local = poly.map((q) => [
          (q.x - mid.x) * dx + (q.y - mid.y) * dy,
          (q.x - mid.x) * z.x + (q.y - mid.y) * z.y,
        ]),
        info = polygonInfo(poly),
        cutLength = Math.max(...local.map((q) => q[0])) - Math.min(...local.map((q) => q[0])),
        volume = (info.area * sec.b) / 1000,
        board = {
          id,
          role,
          b: sec.b,
          h: sec.h,
          start: a,
          end: b,
          length: L,
          widthSign,
          polygon: poly,
          shape: { type: role === "topChord" ? "rafterSeats" : "rippedBoard", points: local },
          shapeNetVolume: volume,
          shapeGrossVolume: (cutLength * sec.b * sec.h) / 1e6,
          shapeCutLength: cutLength,
          volume,
          mass: volume * p.density,
          massCenter: info.centroid,
          cutLength,
          cutStart: { scheme: "butt", angle: 0 },
          cutEnd: { scheme: "butt", angle: 0 },
          requireSingleStock: true,
          frameMemberId: id,
          connectionVerified: false,
        };
      out.boards.push(board);
      return board;
    };
    const left = [
      { x: -p.overhangLow, y: -p.overhangLow * t },
      { x: -p.wallDepthLow / 2, y: (-p.wallDepthLow / 2) * t },
      { x: -p.wallDepthLow / 2, y: 0 },
      { x: 0, y: 0 },
      { x: R, y: H },
      { x: R, y: H + top.h / 1000 / c },
      { x: -p.overhangLow, y: -p.overhangLow * t + top.h / 1000 / c },
    ];
    addBoard(
      "RAFTER-LOW",
      "topChord",
      { x: -p.overhangLow, y: roofY(-p.overhangLow) },
      { x: R, y: roofY(R) },
      top,
      left,
    );
    const highLocal = [
      { x: -p.overhangHigh, y: -p.overhangHigh * t },
      { x: -p.wallDepthHigh / 2, y: (-p.wallDepthHigh / 2) * t },
      { x: -p.wallDepthHigh / 2, y: 0 },
      { x: 0, y: 0 },
      { x: R, y: H },
      { x: R, y: H + top.h / 1000 / c },
      { x: -p.overhangHigh, y: -p.overhangHigh * t + top.h / 1000 / c },
    ];
    addBoard(
      "RAFTER-HIGH",
      "topChord",
      { x: S + p.overhangHigh, y: roofY(S + p.overhangHigh) },
      { x: R, y: roofY(R) },
      top,
      highLocal.map((q) => ({ x: S - q.x, y: q.y })).reverse(),
    );
    const tieA = { x: Math.min(heelX, 0), y: tieAxis },
      tieB = { x: S - Math.min(heelX, 0), y: tieAxis };
    let tiePoly = [
      { x: tieA.x, y: 0 },
      { x: tieB.x, y: 0 },
      { x: tieB.x, y: tie.h / 1000 },
      { x: tieA.x, y: tie.h / 1000 },
    ];
    tiePoly = clip(
      clip(
        clip(
          clip(tiePoly, (q) => q.x),
          (q) => S - q.x,
        ),
        (q) => t * q.x - q.y,
      ),
      (q) => t * (S - q.x) - q.y,
    );
    const tieBoard = addBoard("LOWER-TIE", "bottomChord", tieA, tieB, tie, tiePoly);
    const nodes = [],
      elements = [],
      node = (id, x, y) => {
        const existing = nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 1e-7);
        if (existing) return existing.id;
        nodes.push({ id, x, y });
        return id;
      };
    const jointA = node("HEEL-LOW", heelX, tieAxis),
      jointB = node("HEEL-HIGH", S - heelX, tieAxis),
      supportA = node("BEARING-LOW", bearingX[0], roofY(bearingX[0])),
      supportB = node("BEARING-HIGH", bearingX[1], roofY(bearingX[1])),
      ridge = node("RIDGE", R, roofY(R)),
      ka = node("KNEE-LOW-TOP", kneeX, roofY(kneeX)),
      kb = node("KNEE-HIGH-TOP", S - kneeX, roofY(S - kneeX)),
      ta = node("KNEE-LOW-TIE", kneeX, tieAxis),
      tb = node("KNEE-HIGH-TIE", S - kneeX, tieAxis),
      ca = node("COLLAR-LOW", collarX, roofY(collarX)),
      cb = node("COLLAR-HIGH", S - collarX, roofY(S - collarX));
    const members = new Map(out.boards.map((b) => [b.id, b])),
      addElement = (id, a, b, sec, memberId, extra = {}) => {
        const A = nodes.find((n) => n.id === a),
          B = nodes.find((n) => n.id === b);
        if (length(A, B) < 1e-5) throw Error("Совпадающие узлы опоры/соединения: измените сечение или узел.");
        const board = members.get(memberId),
          self = (board.mass * G) / 1000 / board.length;
        elements.push({
          id,
          nodeA: a,
          nodeB: b,
          b: sec.b,
          h: sec.h,
          E: p.E,
          frameMemberId: memberId,
          qx: 0,
          qy: -self,
          ...extra,
        });
      };
    for (const [side, board] of [
      ["LOW", out.boards[0]],
      ["HIGH", out.boards[1]],
    ]) {
      const low = side === "LOW",
        free = node("EAVE-" + side, board.start.x, board.start.y),
        ids = [
          free,
          low ? jointA : jointB,
          low ? supportA : supportB,
          low ? ka : kb,
          low ? ca : cb,
          ridge,
        ].sort((a, b) => {
          const A = nodes.find((n) => n.id === a),
            B = nodes.find((n) => n.id === b);
          return low ? A.x - B.x : B.x - A.x;
        }),
        unique = [...new Set(ids)];
      for (let i = 1; i < unique.length; i++)
        addElement("R-" + side + "-" + i, unique[i - 1], unique[i], top, board.id, {
          qy: -(
            (board.mass * G) / 1000 / board.length +
            p.roofDead * p.spacing +
            p.snow * p.mu * p.spacing * c
          ),
          releaseB: i === unique.length - 1,
        });
    }
    const tieIds = [jointA, ta, tb, jointB];
    for (let i = 1; i < tieIds.length; i++)
      addElement("T-" + i, tieIds[i - 1], tieIds[i], tie, tieBoard.id, {
        qy: -((tieBoard.mass * G) / 1000 / tieBoard.length + p.ceilingDead * ceilW),
        releaseA: i === 1,
        releaseB: i === tieIds.length - 1,
      });
    for (const [id, bottomId, topId, x] of [
      ["KNEE-LOW", ta, ka, kneeX],
      ["KNEE-HIGH", tb, kb, S - kneeX],
    ]) {
      const a = { x, y: tieAxis },
        b = { x, y: roofY(x) },
        half = knee.h / 2000;
      let poly = [
        { x: x - half, y: a.y },
        { x: x + half, y: a.y },
        { x: x + half, y: b.y },
        { x: x - half, y: b.y },
      ];
      poly = clip(poly, (q) => q.y - tie.h / 1000);
      poly = clip(
        clip(poly, (q) => t * q.x - q.y),
        (q) => t * (S - q.x) - q.y,
      );
      const board = addBoard(id, "kneePost", a, b, knee, poly);
      members.set(id, board);
      addElement(id, bottomId, topId, knee, id, { kind: "truss" });
    }
    {
      const A = nodes.find((n) => n.id === ca),
        B = nodes.find((n) => n.id === cb),
        half = collar.h / 2000,
        faceLap = p.collarConnection === "faceLap";
      let start = A,
        end = B,
        poly;
      if (faceLap) {
        // End positions keep the UPPER outer corner below the rafter top face.
        // The side-lapped board remains a true untrimmed rectangular blank.
        const x = collarX - (topAxis - half) / t + p.collarEndInset;
        if (x < 0 || x >= collarX - EPS || S - 2 * x <= EPS)
          throw Error("Накладной ригель: отступ/высота не оставляют нахлёста под аналитическим узлом.");
        start = { x, y: A.y };
        end = { x: S - x, y: B.y };
        poly = [
          { x: start.x, y: A.y - half },
          { x: end.x, y: B.y - half },
          { x: end.x, y: B.y + half },
          { x: start.x, y: A.y + half },
        ];
      } else {
        poly = [
          { x: A.x, y: A.y - half },
          { x: B.x, y: B.y - half },
          { x: B.x, y: B.y + half },
          { x: A.x, y: A.y + half },
        ];
        poly = clip(
          clip(poly, (q) => t * q.x - q.y),
          (q) => t * (S - q.x) - q.y,
        );
      }
      const board = addBoard("UPPER-COLLAR", "collarTie", start, end, collar, poly);
      if (faceLap) {
        const e = (top.b + collar.b) / 2000;
        board.collarConnection = "faceLap";
        board.outOfPlaneOffset = e;
        board.connectionIds = ["COLLAR-LOW-LAP", "COLLAR-HIGH-LAP"];
        for (const [id, rafterId, high] of [
          ["COLLAR-LOW-LAP", "RAFTER-LOW", false],
          ["COLLAR-HIGH-LAP", "RAFTER-HIGH", true],
        ]) {
          // This upper joint lies beyond the seat notches. These half-planes are
          // exactly the unnotched broad face of its actual continuous rafter.
          let contact = clip(
            clip(poly, (q) => (high ? q.x - R : R - q.x)),
            (q) => (high ? S + p.overhangHigh - q.x : q.x + p.overhangLow),
          );
          contact = clip(
            clip(contact, (q) => q.y - t * (high ? S - q.x : q.x)),
            (q) => t * (high ? S - q.x : q.x) + top.h / 1000 / c - q.y,
          );
          const info = polygonInfo(contact);
          if (info.area <= EPS)
            throw Error("Накладной ригель не имеет положительной площади контакта со стропилом.");
          out.connections.push({
            id,
            members: [board.id, rafterId],
            connection: "faceLap",
            contactPolygonXY: contact,
            contactAreaM2: info.area,
            outOfPlaneOffset: e,
            eccentricityM: e,
            fastenersVerified: false,
            status: "unverified",
            coordinateSystem:
              "Local frame x=horizontal span, y=above wall top; side offset along positive ridge U.",
          });
        }
      }
      members.set(board.id, board);
      addElement(board.id, ca, cb, collar, board.id, { kind: "truss" });
    }
    const supports = [
        { node: supportA, ux: true, uy: true },
        { node: supportB, uy: true },
      ],
      modelLengths = new Map();
    for (const e of elements) {
      const a = nodes.find((n) => n.id === e.nodeA),
        b = nodes.find((n) => n.id === e.nodeB);
      modelLengths.set(e.frameMemberId, (modelLengths.get(e.frameMemberId) ?? 0) + length(a, b));
    }
    const lineComponents = (e) => {
      const b = members.get(e.frameMemberId),
        self = (b.mass * G) / 1000 / modelLengths.get(b.id),
        roof = b.role === "topChord" ? p.roofDead * p.spacing : 0,
        snow = b.role === "topChord" ? p.snow * p.mu * p.spacing * c : 0,
        ceiling = b.role === "bottomChord" ? (p.ceilingDead * ceilW * S) / modelLengths.get(b.id) : 0;
      return { dead: self + roof + ceiling, snow };
    };
    for (const e of elements) {
      const q = lineComponents(e);
      e.qy = -(q.dead + q.snow);
    }
    const designElements = elements.map((e) => {
      const q = lineComponents(e);
      return { ...e, qy: -(q.dead * p.gammaG + q.snow * p.gammaQ) };
    });
    // Members with clipped profiles use their true net mass. A small end couple
    // makes the uniformly allocated net weight match its actual centroid exactly.
    function massCorrections(gamma) {
      const loads = [];
      for (const b of out.boards) {
        const ids = elements.filter((e) => e.frameMemberId === b.id),
          a = nodes.find((n) => n.id === ids[0]?.nodeA),
          z = nodes.find((n) => n.id === ids.at(-1)?.nodeB);
        if (!a || !z) continue;
        const W = ((b.mass * G) / 1000) * gamma,
          m = -W * (b.massCenter.x - (a.x + z.x) / 2);
        if (Math.abs(m) > 1e-10) loads.push({ node: a.id, mz: m });
      }
      return loads;
    }
    const design = solveFrame2D({
        nodes,
        elements: designElements,
        supports,
        nodalLoads: massCorrections(p.gammaG),
      }),
      service = solveFrame2D({ nodes, elements, supports, nodalLoads: massCorrections(1) });
    out.nodes = nodes;
    out.elements = designElements;
    out.supports = supports;
    out.design = design;
    out.service = service;
    if (!design.stable || !service.stable) throw Error([...design.errors, ...service.errors].join("; "));
    for (const b of out.boards) {
      const d = design.elementResults.filter(
          (e) => elements.find((t) => t.id === e.id)?.frameMemberId === b.id,
        ),
        s = service.elementResults.filter((e) => elements.find((t) => t.id === e.id)?.frameMemberId === b.id),
        minHeight =
          b.role === "topChord"
            ? b.h - Math.sin(angle) * (b.id.endsWith("LOW") ? p.wallDepthLow : p.wallDepthHigh) * 500
            : b.h,
        A = b.b * minHeight,
        W = (b.b * minHeight * minHeight) / 6,
        I = (b.b * minHeight ** 3) / 12;
      const selfService = (b.mass * G) / 1000 / Math.max(b.cutLength, 0.01),
        localMoment = b.role === "collarTie" ? (selfService * p.gammaG * b.cutLength ** 2) / 8 : 0,
        localShear = b.role === "collarTie" ? (selfService * p.gammaG * b.cutLength) / 2 : 0,
        localDeflection =
          b.role === "collarTie" ? (5 * selfService * (b.cutLength * 1000) ** 4) / (384 * p.E * I) : 0;
      const maxMoment = Math.max(localMoment, ...d.map((e) => e.maxMoment)),
        maxShear = Math.max(localShear, ...d.map((e) => e.maxShear)),
        maxAxial = Math.max(0, ...d.map((e) => e.maxAxial)),
        maxTension = Math.max(0, ...d.map((e) => e.maxTension)),
        maxCompression = Math.max(0, ...d.map((e) => e.maxCompression)),
        axialUtilization = Math.max((maxTension * 1000) / (A * p.Ft), (maxCompression * 1000) / (A * p.Fc)),
        bendingStress = (maxMoment * 1e6) / W,
        interaction = axialUtilization + bendingStress / p.Fb,
        shearStress = (1.5 * maxShear * 1000) / A,
        deflectionMM = Math.max(0, ...s.map((e) => e.maxVerticalDeflection)) * 1000 + localDeflection,
        limitMM = (S * 1000) / p.deflectionRatio,
        euler =
          (Math.PI ** 2 * (p.Emin ?? p.E) * Math.max(b.b, minHeight) * Math.min(b.b, minHeight) ** 3) /
          12 /
          (b.length * 1000) ** 2 /
          1000,
        utilization = Math.max(
          interaction,
          shearStress / p.Fv,
          deflectionMM / limitMM,
          maxCompression / euler,
        );
      out.members.push({
        id: b.id,
        role: b.role,
        b: b.b,
        h: b.h,
        length: b.length,
        cutLength: b.cutLength,
        maxMoment,
        maxShear,
        maxAxial,
        maxN: maxAxial,
        maxTension,
        maxCompression,
        idealEuler: euler,
        idealEulerUtilization: maxCompression / euler,
        interaction,
        axialUtilization,
        bendingStress,
        shearStress,
        deflectionMM,
        limitMM,
        utilization,
        status: utilization > 1 ? "fail" : "pass",
        minimumSeatSectionHeightMM: minHeight,
        sectionLossVerified: false,
        elementIds: d.map((e) => e.id),
        localOwnWeightBending: localMoment > 0,
        sectionScreen:
          "Conservative envelope max(N/Ft,Fc)+maxM/Fb and maxV on minimum rafter seat section. Tie/collar gusset transfer and scarf-end net sections are unverified.",
      });
    }
    if (out.connections.length) {
      const member = out.members.find((m) => m.id === "UPPER-COLLAR");
      for (const connection of out.connections) {
        connection.demandKN = member.maxAxial;
        connection.forceType = member.maxCompression >= member.maxTension ? "compression" : "tension";
        connection.axisOffsetMomentScaleKNm = connection.demandKN * connection.eccentricityM;
        connection.scope =
          "N*e magnitude only. The two end force transfers have opposite senses. This is not a3D member moment/stress solution or a fastener resistance check.";
      }
      out.checks.push({
        id: "frame-collar-face-lap",
        label: "Накладной ригель: боковой эксцентриситет и крепёж",
        status: "unverified",
        connectionIds: out.connections.map((j) => j.id),
        eccentricityM: out.connections[0].eccentricityM,
        demandKN: member.maxAxial,
        axisOffsetMomentScaleKNm: Math.max(...out.connections.map((j) => j.axisOffsetMomentScaleKNm)),
        note: "Ригель установлен с одной стороны к широким граням стропил. В2D осевые узлы сохранены; N×e показывает только масштаб внеплоскостного воздействия. Податливость, гвозди/болты, расщепление, боковой изгиб, кручение и распределение усилий между крепежами не рассчитаны.",
      });
      out.sources.push({
        title: "FAO · Single-lap and double-lap timber connections",
        url: "https://www.fao.org/4/s1250e/S1250E0f.htm",
      });
    }
    for (const role of ["topChord", "bottomChord", "kneePost", "collarTie"]) {
      const mm = out.members.filter((m) => m.role === role),
        worst = mm.reduce((a, b) => (!a || b.utilization > a.utilization ? b : a), null);
      if (worst)
        out.checks.push({
          id: "frame-" + role,
          label: "Стропильная рама: " + role,
          status: mm.some((m) => m.status === "fail") ? "fail" : "pass",
          value: worst.utilization,
          limit: 1,
          memberIds: mm.filter((m) => m.status === "fail").map((m) => m.id),
          worstMemberId: worst.id,
          partial: true,
        });
    }
    const insulationClearance = p.ceilingDrop - 0.2 - (Math.max(p.wallDepthLow, p.wallDepthHigh) / 2) * t;
    out.checks.push({
      id: "frame-insulation-space",
      label: "Место для200ммутепления над подвесным потолком",
      status: insulationClearance < -EPS ? "fail" : "pass",
      value: insulationClearance,
      limit: 0,
      unit: "м",
      note: "Консервативный геометрический зазор до неподрезанной нижней грани стропила на наружной грани стены. Не подтверждает достаточный расход вентиляции, ветроотбойник или влажностный режим.",
    });
    const over = out.boards.filter((b) => b.cutLength > 6 + EPS);
    out.checks.push({
      id: "frame-stock",
      label: "Цельные детали стропильной рамы до6м",
      status: over.length ? "fail" : "pass",
      value: over.length,
      limit: 0,
      memberIds: over.map((b) => b.id),
    });
    out.checks.push({
      id: "frame-connections",
      label: "Рама: узлы, врубки и пространственная устойчивость",
      status: "unverified",
      note: "В плоскости непрерывных стропил учтены EA/EI и изгиб. Коньковый и торцевые узлы затяжки приняты шарнирными; ригель/внутренние стойки осевыми. Пластины, смятие75ммопор, концентрация напряжений в запилах, устойчивость из плоскости, ветровой отрыв и жёсткость реальных соединений не подтверждены.",
    });
    out.stable = true;
    out.status = out.checks.some((c) => c.status === "fail") ? "fail" : "unverified";
    out.geometry = {
      rise: H,
      topAxisAtWall: topAxis,
      bottomAxis: tieAxis,
      bearingX,
      seatLengthLow: p.wallDepthLow / 2,
      seatLengthHigh: p.wallDepthHigh / 2,
      tieTaperLength: tie.h / 1000 / t,
      roofSurfaceLift: top.h / 1000 / c,
      ceilingDatum: -p.ceilingDrop,
      ceilingInsulationTop: -p.ceilingDrop + 0.2,
      minimumInsulationClearance: insulationClearance,
    };
    out.loads = {
      timber: (sum(out.boards.map((b) => b.mass)) * G) / 1000,
      roofDead: (p.roofDead * p.spacing * (S + p.overhangLow + p.overhangHigh)) / c,
      ceilingDead: p.ceilingDead * ceilW * S,
      snow: p.snow * p.mu * p.spacing * (S + p.overhangLow + p.overhangHigh),
    };
    out.assumptions = [
      "Стропильная рама с нижней затяжкой, верхним ригелем и двумя внутренними вертикальными стойками. Малые упругие перемещения, EA/EI непрерывных стропил и затяжки; настоящая равномерная вертикальная нагрузка на балочные элементы.",
      "Ригель не заменяет нижнюю затяжку против распора. Коньковый и концевые узлы затяжки шарнирные; внутренние стойки/ригель осевые. Податливость и прочность соединений не подобраны.",
      p.collarConnection === "faceLap"
        ? "Наружная половина толщины стены образует реальную горизонтальную площадку birdsmouth. Затяжка и стойки обрезаны до граней стропил; накладной ригель имеет прямые90°торцы и контактирует широкими боковыми гранями. Масса каждой детали учитывается один раз. Опорный запил, местные ослабления и крепёж требуют отдельной проверки."
        : "Наружная половина толщины стены образует реальную горизонтальную площадку birdsmouth. Затяжка/ригель/стойки обрезаны до граней стропил, масса нетто учитывается один раз. Опорный запил, местные ослабления и крепёж требуют отдельной проверки.",
      "Собственный нетто-вес каждого физического элемента равномерно разложен по его аналитической оси с поправочной парой по истинному центру массы. Это не точная модель напряжений в геометрии запила.",
      `Теоретические оси поясов пересекаются в идеальном узле; уравнения не моделируют конечную площадь накладок. Верхний пояс${top.b}×${top.h}, затяжка${tie.b}×${tie.h}мм: смещение теоретического узла от физического конца скошенной затяжки${(Math.abs(heelX - Math.min(...tiePoly.map((q) => q.x))) * 1000).toFixed(1)}мм. Перенос усилия, эксцентриситет и ослабленный конец не подтверждены.`,
      "Предел прогиба принят пользователем; ползучесть, пространственная устойчивость и все нормативные сочетания не подтверждены.",
    ];
    if (p.collarConnection === "faceLap")
      out.assumptions.push(
        "Накладной ригель имеет прямоугольный профиль и прямые90°торцы; его концы укорочены горизонтальным collarEndInset, чтобы верхние углы не выходили над верхними гранями скатов. Площадь контакта относится к широким боковым граням, а не к гвоздям. Реальная масса увеличенной доски и её собственный вес учтены один раз. Внеплоскостное смещение не добавляет жёсткость в2D-модель. Одиночный нахлёст эксцентричен; двойной нахлёст является отдельной конструкцией и автоматически не назначается.",
      );
  } catch (e) {
    out.errors.push(e.message);
    out.checks.push({
      id: "frame-input",
      label: "Геометрия и расчёт стропильной рамы",
      status: "fail",
      note: e.message,
    });
  }
  return out;
}

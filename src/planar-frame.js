/** Linear 2D Euler–Bernoulli frame. Geometry m, sections mm, E MPa,
 * loads kN/m and kN/kNm, translations m, rotations rad. This numerical
 * solution does not verify timber connections, stability or code compliance. */
const finite = (x) => typeof x === "number" && Number.isFinite(x),
  sum = (a) => a.reduce((s, x) => s + x, 0);
const zeros = (n, m = n) => Array.from({ length: n }, () => Array(m).fill(0));
const mv = (A, x) => A.map((r) => sum(r.map((v, i) => v * x[i])));
const transpose = (A) => A[0].map((_, i) => A.map((r) => r[i]));
const mm = (A, B) => A.map((r) => B[0].map((_, j) => sum(r.map((v, i) => v * B[i][j]))));
const unique = (a) => [...a].sort((a, b) => a - b).filter((v, i, s) => !i || Math.abs(v - s[i - 1]) > 1e-9);
function linear(A, b, tolerance = 1e-11) {
  const n = b.length,
    M = A.map((r, i) => [...r, b[i]]);
  let minPivot = Infinity,
    maxPivot = 0;
  for (let k = 0; k < n; k++) {
    let row = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[row][k])) row = i;
    const pivot = Math.abs(M[row][k]);
    if (!finite(pivot) || pivot < tolerance)
      throw Error("Singular stiffness: translational/rotational mechanism or insufficient supports.");
    minPivot = Math.min(minPivot, pivot);
    maxPivot = Math.max(maxPivot, pivot);
    [M[k], M[row]] = [M[row], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      M[i][k] = 0;
      for (let j = k + 1; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--)
    x[i] = (M[i][n] - sum(M[i].slice(i + 1, n).map((v, j) => v * x[i + 1 + j]))) / M[i][i];
  return { x, pivotRatio: n ? minPivot / maxPivot : 1 };
}
function inverse(A) {
  return transpose(
    A.map(
      (_, i) =>
        linear(
          A,
          A.map((_, j) => (i === j ? 1 : 0)),
          1e-20,
        ).x,
    ),
  );
}
function roots(coeff, L) {
  // Work on t=s/L: derivative-root partitions isolate every real root without
  // relying on a plotting grid or a cubic formula near multiple roots.
  const polynomial = coeff.map((v, i) => v * L ** i),
    scale = Math.max(...polynomial.map(Math.abs));
  if (scale === 0) return [];
  const recurse = (p) => {
    const scale = Math.max(...p.map(Math.abs));
    while (p.length > 1 && Math.abs(p.at(-1)) < scale * 1e-14) p.pop();
    if (p.length === 1) return [];
    const at = (t) => p.reduceRight((v, c) => v * t + c, 0),
      critical = p.length > 2 ? recurse(p.slice(1).map((v, i) => v * (i + 1))) : [],
      edges = unique([0, ...critical, 1]),
      out = [];
    for (const t of edges) if (Math.abs(at(t)) < scale * 1e-11) out.push(t);
    for (let i = 1; i < edges.length; i++) {
      let a = edges[i - 1],
        b = edges[i],
        fa = at(a),
        fb = at(b);
      if (fa * fb >= 0) continue;
      for (let j = 0; j < 60; j++) {
        const m = (a + b) / 2,
          fm = at(m);
        if (fa * fm <= 0) {
          b = m;
          fb = fm;
        } else {
          a = m;
          fa = fm;
        }
      }
      out.push((a + b) / 2);
    }
    return unique(out).filter((t) => t >= 0 && t <= 1);
  };
  return recurse(polynomial).map((t) => t * L);
}
function condense(K, f, released) {
  if (!released.length) return { K, f, recover: (d) => d };
  const keep = [0, 1, 2, 3, 4, 5].filter((i) => !released.includes(i)),
    R = K.filter((_, i) => released.includes(i)).map((row) => released.map((j) => row[j])),
    inv = inverse(R),
    Kt = keep.map((i) => released.map((j) => K[i][j])),
    Kr = released.map((i) => keep.map((j) => K[i][j])),
    fr = released.map((i) => f[i]),
    reduction = mm(mm(Kt, inv), Kr),
    load = mv(mm(Kt, inv), fr),
    C = zeros(6),
    F = Array(6).fill(0);
  keep.forEach((i, a) => {
    F[i] = f[i] - load[a];
    keep.forEach((j, b) => (C[i][j] = K[i][j] - reduction[a][b]));
  });
  // A beam released at both ends has exactly zero transverse nodal stiffness.
  // Floating-point subtraction must not turn its free rigid-body rotation
  // into a tiny artificial spring that hides a genuine translation mechanism.
  if (released.length === 2) for (const i of [1, 4]) for (let j = 0; j < 6; j++) C[i][j] = C[j][i] = 0;
  return {
    K: C,
    f: F,
    recover: (d) => {
      const v = mv(
          inv,
          fr.map((q, i) => q - sum(Kr[i].map((k, j) => k * d[keep[j]]))),
        ),
        copy = [...d];
      released.forEach((id, i) => (copy[id] = v[i]));
      return copy;
    },
  };
}

export function solveFrame2D(input = {}) {
  const errors = [],
    warnings = [],
    fail = (message) => errors.push(message);
  const failed = () => ({
    stable: false,
    status: "fail",
    certified: false,
    errors,
    warnings,
    elementResults: [],
    reactions: [],
    displacements: [],
    equilibrium: null,
  });
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("Expected a frame input object.");
    return failed();
  }
  const nodes = input.nodes,
    elements = input.elements,
    supports = input.supports === undefined ? [] : input.supports,
    nodalLoads = input.nodalLoads === undefined ? [] : input.nodalLoads;
  if (
    !Array.isArray(nodes) ||
    !nodes.length ||
    nodes.length > 200 ||
    !Array.isArray(elements) ||
    !elements.length ||
    elements.length > 600 ||
    !Array.isArray(supports) ||
    !Array.isArray(nodalLoads)
  ) {
    fail("Expected nonempty nodes/elements (maximum200/600) and support/load arrays.");
    return failed();
  }
  const ids = new Map();
  for (const [i, n] of nodes.entries()) {
    if (!n || typeof n.id !== "string" || !n.id || ids.has(n.id) || !finite(n.x) || !finite(n.y))
      fail("Invalid or duplicate node at " + i);
    else ids.set(n.id, i);
  }
  const elementIds = new Set();
  for (const [i, e] of elements.entries()) {
    if (!e || typeof e.id !== "string" || !e.id || elementIds.has(e.id)) {
      fail("Invalid or duplicate element at " + i);
      continue;
    }
    elementIds.add(e.id);
    if (!ids.has(e.nodeA) || !ids.has(e.nodeB) || e.nodeA === e.nodeB) fail("Invalid nodes on " + e.id);
    for (const key of ["b", "h", "E"])
      if (!finite(e[key]) || e[key] <= 0) fail("Positive finite " + key + " required on " + e.id);
    for (const key of ["qx", "qy"])
      if (e[key] !== undefined && !finite(e[key])) fail("Finite " + key + " required on " + e.id);
    for (const key of ["releaseA", "releaseB"])
      if (e[key] !== undefined && typeof e[key] !== "boolean")
        fail("Boolean " + key + " required on " + e.id);
    if (e.kind !== undefined && !["beam", "frame", "truss"].includes(e.kind))
      fail("Element kind must be beam/frame/truss.");
  }
  for (const q of supports) {
    if (!q || !ids.has(q.node)) {
      fail("Support references an unknown node.");
      continue;
    }
    for (const key of ["ux", "uy", "rz"])
      if (q[key] !== undefined && typeof q[key] !== "boolean") fail("Support " + key + " must be boolean.");
  }
  for (const q of nodalLoads) {
    if (!q || !ids.has(q.node)) {
      fail("Load references an unknown node.");
      continue;
    }
    for (const key of ["fx", "fy", "mz"])
      if (q[key] !== undefined && !finite(q[key])) fail("Load " + key + " must be finite.");
  }
  if (errors.length) return failed();
  const nd = nodes.length * 3,
    K = zeros(nd),
    F = Array(nd).fill(0),
    models = [];
  let externalFx = 0,
    externalFy = 0,
    externalMoment = 0;
  try {
    for (const e of elements) {
      const a = nodes[ids.get(e.nodeA)],
        b = nodes[ids.get(e.nodeB)],
        L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-8) throw Error("Zero-length element " + e.id);
      const c = (b.x - a.x) / L,
        s = (b.y - a.y) / L,
        EA = (e.E * e.b * e.h) / 1000,
        EI = (e.E * e.b * e.h ** 3) / 12e9,
        qx = c * (e.qx ?? 0) + s * (e.qy ?? 0),
        qy = -s * (e.qx ?? 0) + c * (e.qy ?? 0),
        truss = e.kind === "truss",
        local = zeros(6),
        f = [
          (qx * L) / 2,
          (qy * L) / 2,
          truss ? 0 : (qy * L * L) / 12,
          (qx * L) / 2,
          (qy * L) / 2,
          truss ? 0 : (-qy * L * L) / 12,
        ];
      if (![L, c, s, EA, EI, qx, qy, ...f].every(finite) || EA <= 0 || EI <= 0)
        throw Error("Nonfinite/underflow element properties or loading on " + e.id);
      local[0][0] = local[3][3] = EA / L;
      local[0][3] = local[3][0] = -EA / L;
      if (!truss) {
        const d = [1, 2, 4, 5],
          B = [
            [12, 6 * L, -12, 6 * L],
            [6 * L, 4 * L * L, -6 * L, 2 * L * L],
            [-12, -6 * L, 12, -6 * L],
            [6 * L, 2 * L * L, -6 * L, 4 * L * L],
          ];
        d.forEach((i, x) => d.forEach((j, y) => (local[i][j] = (B[x][y] * EI) / L ** 3)));
      } else if (Math.abs(qy) > 1e-12)
        warnings.push(
          `${e.id}: transverse distributed load on axial-only member lumped at its nodes; local bending is unverified.`,
        );
      const releases = truss ? [] : [...(e.releaseA ? [2] : []), ...(e.releaseB ? [5] : [])],
        C = condense(local, f, releases),
        T = [
          [c, s, 0, 0, 0, 0],
          [-s, c, 0, 0, 0, 0],
          [0, 0, 1, 0, 0, 0],
          [0, 0, 0, c, s, 0],
          [0, 0, 0, -s, c, 0],
          [0, 0, 0, 0, 0, 1],
        ],
        kg = mm(mm(transpose(T), C.K), T),
        fg = mv(transpose(T), C.f),
        dof = [
          3 * ids.get(a.id),
          3 * ids.get(a.id) + 1,
          3 * ids.get(a.id) + 2,
          3 * ids.get(b.id),
          3 * ids.get(b.id) + 1,
          3 * ids.get(b.id) + 2,
        ];
      dof.forEach((i, x) => {
        F[i] += fg[x];
        dof.forEach((j, y) => (K[i][j] += kg[x][y]));
      });
      models.push({ e, a, b, L, c, s, EA, EI, qx, qy, truss, local, f, T, dof, C });
      externalFx += (e.qx ?? 0) * L;
      externalFy += (e.qy ?? 0) * L;
      externalMoment += (((a.x + b.x) / 2) * (e.qy ?? 0) - ((a.y + b.y) / 2) * (e.qx ?? 0)) * L;
    }
    for (const q of nodalLoads) {
      const i = ids.get(q.node),
        n = nodes[i];
      F[3 * i] += q.fx ?? 0;
      F[3 * i + 1] += q.fy ?? 0;
      F[3 * i + 2] += q.mz ?? 0;
      externalFx += q.fx ?? 0;
      externalFy += q.fy ?? 0;
      externalMoment += n.x * (q.fy ?? 0) - n.y * (q.fx ?? 0) + (q.mz ?? 0);
    }
    if (
      !F.every(finite) ||
      !K.every((row) => row.every(finite)) ||
      ![externalFx, externalFy, externalMoment].every(finite)
    )
      throw Error("Nonfinite assembled stiffness/loading.");
    const fixed = new Set();
    for (const q of supports) {
      const i = ids.get(q.node);
      ["ux", "uy", "rz"].forEach((key, j) => {
        if (q[key]) fixed.add(3 * i + j);
      });
    }
    const ignoredRotations = [],
      free = [];
    for (let i = 0; i < nd; i++) {
      if (fixed.has(i)) continue;
      if (i % 3 === 2 && K[i].every((v) => Math.abs(v) < 1e-18)) {
        if (Math.abs(F[i]) > 1e-12)
          throw Error("Unattached nodal rotation carries a moment at " + nodes[Math.floor(i / 3)].id);
        ignoredRotations.push(nodes[Math.floor(i / 3)].id);
        continue;
      }
      if (!finite(K[i][i]) || K[i][i] <= 0)
        throw Error("Unrestrained translation/rotation at " + nodes[Math.floor(i / 3)].id);
      free.push(i);
    }
    const scale = free.map((i) => Math.sqrt(K[i][i])),
      A = free.map((i, a) => free.map((j, b) => K[i][j] / scale[a] / scale[b])),
      rhs = free.map((i, a) => F[i] / scale[a]),
      solution = linear(A, rhs),
      u = Array(nd).fill(0);
    free.forEach((id, i) => (u[id] = solution.x[i] / scale[i]));
    if (!u.every(finite)) throw Error("Nonfinite displacement.");
    const residual = mv(K, u).map((v, i) => v - F[i]),
      reactions = nodes.map((n, i) => ({
        node: n.id,
        fx: fixed.has(3 * i) ? residual[3 * i] : 0,
        fy: fixed.has(3 * i + 1) ? residual[3 * i + 1] : 0,
        mz: fixed.has(3 * i + 2) ? residual[3 * i + 2] : 0,
      })),
      displacements = nodes.map((n, i) => ({ node: n.id, ux: u[3 * i], uy: u[3 * i + 1], rz: u[3 * i + 2] }));
    if (
      !residual.every(finite) ||
      free.some((i) => Math.abs(residual[i]) > 1e-7 * Math.max(1, ...F.map(Math.abs)))
    )
      throw Error("Numerical equilibrium residual is too large.");
    const elementResults = models.map((m) => {
      const { e, L, c, s, EA, EI, qx, qy, truss } = m,
        d = m.C.recover(
          mv(
            m.T,
            m.dof.map((i) => u[i]),
          ),
        ),
        end = mv(m.local, d).map((v, i) => v - m.f[i]),
        N0 = -end[0],
        M0 = -end[2],
        V0 = end[1];
      const at = (x) => {
        x = Math.max(0, Math.min(L, x));
        const axial = d[0] + (N0 * x - (qx * x * x) / 2) / EA,
          normal = truss
            ? d[1] + ((d[4] - d[1]) * x) / L
            : d[1] + d[2] * x + ((M0 * x * x) / 2 + (V0 * x ** 3) / 6 + (qy * x ** 4) / 24) / EI,
          rotation = truss ? null : d[2] + (M0 * x + (V0 * x * x) / 2 + (qy * x ** 3) / 6) / EI;
        return {
          s: x,
          N: N0 - qx * x,
          V: truss ? 0 : V0 + qy * x,
          M: truss ? 0 : M0 + V0 * x + (qy * x * x) / 2,
          axialDisplacement: axial,
          normalDisplacement: normal,
          chordRelativeDeflection: normal - (d[1] + ((d[4] - d[1]) * x) / L),
          ux: c * axial - s * normal,
          uy: s * axial + c * normal,
          rotation,
        };
      };
      const verticalDerivative = truss
          ? [(s * N0) / EA + (c * (d[4] - d[1])) / L, (-s * qx) / EA]
          : [
              (s * N0) / EA + c * d[2],
              (-s * qx) / EA + (c * M0) / EI,
              (c * V0) / (2 * EI),
              (c * qy) / (6 * EI),
            ],
        relativeDerivative = truss ? [0] : [d[2] - (d[4] - d[1]) / L, M0 / EI, V0 / (2 * EI), qy / (6 * EI)],
        stations = unique([
          0,
          L,
          ...roots(verticalDerivative, L),
          ...roots(relativeDerivative, L),
          ...(!truss && Math.abs(qy) > 1e-14 && -V0 / qy > 0 && -V0 / qy < L ? [-V0 / qy] : []),
          ...Array.from({ length: 33 }, (_, i) => (L * i) / 32),
        ]),
        states = stations.map(at),
        max = (key) => Math.max(...states.map((q) => Math.abs(q[key]))),
        maxVerticalDeflection = max("uy"),
        maxTransverseDeflection = max("chordRelativeDeflection");
      if (
        !end.every(finite) ||
        !states.every((state) => Object.values(state).every((v) => v === null || finite(v)))
      )
        throw Error("Nonfinite recovered element response on " + e.id);
      return {
        id: e.id,
        nodeA: e.nodeA,
        nodeB: e.nodeB,
        kind: truss ? "truss" : "frame",
        length: L,
        EA,
        EI,
        qx,
        qy,
        releaseA: !!e.releaseA,
        releaseB: !!e.releaseB,
        ends: { a: { N: at(0).N, V: at(0).V, M: at(0).M }, b: { N: at(L).N, V: at(L).V, M: at(L).M } },
        endForces: { a: { N: end[0], V: end[1], M: end[2] }, b: { N: end[3], V: end[4], M: end[5] } },
        maxMoment: max("M"),
        maxShear: max("V"),
        maxAxial: max("N"),
        maxTension: Math.max(0, ...states.map((q) => q.N)),
        maxCompression: Math.max(0, ...states.map((q) => -q.N)),
        maxDeflection: maxVerticalDeflection,
        maxVerticalDeflection,
        maxTransverseDeflection,
        deflection: maxVerticalDeflection,
        deflectionMM: maxVerticalDeflection * 1000,
        stations: states,
        at,
        localDisplacements: d,
        transverseLoadUnverified: truss && Math.abs(qy) > 1e-12,
      };
    });
    const equilibrium = {
      fx: externalFx + sum(reactions.map((q) => q.fx)),
      fy: externalFy + sum(reactions.map((q) => q.fy)),
      moment:
        externalMoment +
        sum(
          reactions.map((q) => {
            const n = nodes[ids.get(q.node)];
            return n.x * q.fy - n.y * q.fx + q.mz;
          }),
        ),
    };
    return {
      stable: true,
      status: "solved",
      certified: false,
      errors,
      warnings,
      elementResults,
      reactions,
      displacements,
      equilibrium,
      ignoredRotations,
      pivotRatio: solution.pivotRatio,
      units: {
        length: "m",
        translation: "m",
        rotation: "rad",
        force: "kN",
        moment: "kNm",
        distributedLoad: "kN/m",
      },
      assumptions: [
        "Linear small-displacement Euler–Bernoulli elements; shear deformation, P–Delta, buckling, connection slip and out-of-plane response are not solved.",
        "Unreleased beam nodes share rotation; this is appropriate within one continuous physical board, not evidence that a nailed connection is rigid.",
        "Element end-moment releases are statically condensed with consistent distributed loads, then local rotations and end forces are recovered.",
        "maxDeflection is absolute global vertical translation in metres; maxTransverseDeflection is local transverse displacement relative to the element end chord.",
      ],
    };
  } catch (error) {
    fail(error.message);
    return failed();
  }
}
export const solvePlanarFrame = solveFrame2D;

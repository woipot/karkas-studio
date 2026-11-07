/**
 * Member mechanics of an imported (source) roof: rafters, support plates, knee-wall studs,
 * struts, ceiling joists, beams and posts that came from a drawing as explicit boards.
 *
 * The load path is derived from physical contact of the boards (who rests on whom):
 *  1. rafters carry roof layers (per slope area) and snow S0 = ce·ct·µ(α)·Sg (per plan area)
 *     over their tributary width; ceiling joists carry ceiling layers + attic live load;
 *  2. every horizontal / inclined member is solved as a continuous beam on the members found
 *     below it (solveFrame2D, pinned + rollers, vertical reactions only);
 *  3. reactions go down as point loads; studs, posts and struts are axial members checked to
 *     SP 64 (φ, λ) and their bearing on the member below (Rсм90);
 *  4. whatever reaches the main house model (walls, platform) is reported as delivered there.
 *
 * Geometry: [x, y, z] with y vertical. Loads kN, kN/m; stresses MPa; sections mm.
 * Connections (nails, notches, laps) are NOT verified — only members.
 */
import { solveFrame2D } from "./planar-frame.js";
import { axialCompression, bearingPerpendicular, resolveTimberMaterial } from "./timber-design.js";
import { loadFactors, roofSnowLoad } from "./load-profile.js";

const G = 9.80665;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const sub = (a, b) => a.map((v, i) => v - b[i]),
  add = (a, b) => a.map((v, i) => v + b[i]),
  mul = (a, k) => a.map((v) => v * k),
  dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm = (a) => Math.hypot(...a),
  unit = (a) => mul(a, 1 / (norm(a) || 1));

const AXIAL_ROLE = /stud|post|knee|strut|column|hanger/i;
const RAFTER_ROLE = /rafter/i;
const CEILING_ROLE = /^ceilingJoist$/;
const CONTACT_TOL = 0.02; // m: boards closer than this are in contact
const CLUSTER = 0.2; // m: supports closer along a member act as one support line

function frameOf(b) {
  const d = sub(b.end, b.start),
    L = norm(d),
    u = unit(d);
  let w = b.crossAxis ? unit(b.crossAxis) : Math.abs(u[1]) > 0.9 ? [1, 0, 0] : unit(cross([0, 1, 0], u));
  w = unit(sub(w, mul(u, dot(w, u))));
  const n = cross(u, w);
  const lo = b.start.map((v, i) => Math.min(v, b.end[i])),
    hi = b.start.map((v, i) => Math.max(v, b.end[i])),
    pad = Math.max(b.b, b.h) / 1000;
  return {
    board: b,
    P: b.start,
    u,
    L,
    w,
    n,
    b: b.b / 1000,
    h: b.h / 1000,
    lo: lo.map((v) => v - pad),
    hi: hi.map((v) => v + pad),
  };
}

function closest(A, B) {
  const r0 = sub(A.P, B.P),
    k = dot(A.u, B.u),
    c = dot(A.u, r0),
    f = dot(B.u, r0),
    den = 1 - k * k;
  let s = den > 1e-9 ? (k * f - c) / den : 0;
  s = Math.max(0, Math.min(A.L, s));
  let t = Math.max(0, Math.min(B.L, k * s + f));
  s = Math.max(0, Math.min(A.L, dot(sub(add(B.P, mul(B.u, t)), A.P), A.u)));
  t = Math.max(0, Math.min(B.L, dot(sub(add(A.P, mul(A.u, s)), B.P), B.u)));
  return { s, t, pa: add(A.P, mul(A.u, s)), pb: add(B.P, mul(B.u, t)) };
}
const extent = (F, d) => Math.abs(dot(d, F.w)) * F.b + Math.abs(dot(d, F.n)) * F.h;
const boxesNear = (A, B) =>
  A.lo.every((v, i) => v <= B.hi[i] + CONTACT_TOL && A.hi[i] >= B.lo[i] - CONTACT_TOL);

/** Overlap of two parallel members along A (stacked plates, beam on plate). */
function parallelOverlap(A, B) {
  if (Math.abs(dot(A.u, B.u)) < 0.995) return null;
  const tB = [dot(sub(B.P, A.P), A.u), dot(sub(add(B.P, mul(B.u, B.L)), A.P), A.u)].sort((a, b) => a - b),
    a = Math.max(0, tB[0]),
    z = Math.min(A.L, tB[1]);
  return z - a > 0.05 ? { a, z } : null;
}

function contact(A, B, tol = CONTACT_TOL) {
  if (!boxesNear(A, B)) return null;
  const c = closest(A, B),
    dv = sub(c.pa, c.pb),
    dist = norm(dv),
    d = dist > 1e-9 ? mul(dv, 1 / dist) : [0, 1, 0],
    gap = dist - (extent(A, d) + extent(B, d)) / 2;
  if (gap >= tol) return null;
  return { ...c, gap, overlap: parallelOverlap(A, B) };
}

const isAxial = (F) => AXIAL_ROLE.test(F.board.role ?? "") || Math.abs(F.u[1]) > 0.6;

/** Tributary width of a surface member from its parallel neighbours of the same family. */
function tributaryWidths(frames, family, fallback) {
  const list = frames.filter((F) => family.test(F.board.role ?? ""));
  const out = new Map();
  const downhill = (F) => {
    const h = unit([F.u[0], 0, F.u[2]]);
    return Math.abs(F.u[1]) > 0.05 && F.u[1] > 0 ? mul(h, -1) : h;
  };
  for (const F of list) {
    const uh = downhill(F),
      across = unit(cross([0, 1, 0], uh)),
      mid = add(F.P, mul(F.u, F.L / 2)),
      c0 = dot(mid, across),
      a0 = [dot(F.board.start, uh), dot(F.board.end, uh)].sort((a, b) => a - b);
    let left = Infinity,
      right = Infinity;
    for (const Q of list) {
      if (Q === F) continue;
      const uq = downhill(Q),
        flat = Math.abs(F.u[1]) <= 0.05 && Math.abs(Q.u[1]) <= 0.05;
      if ((flat ? Math.abs(dot(uq, uh)) : dot(uq, uh)) < 0.98) continue;
      const aq = [dot(Q.board.start, uh), dot(Q.board.end, uh)].sort((a, b) => a - b);
      if (Math.min(a0[1], aq[1]) - Math.max(a0[0], aq[0]) < 0.3) continue;
      const dc = dot(add(Q.P, mul(Q.u, Q.L / 2)), across) - c0;
      // Boards closer than 0.15 m side by side are laps/sisters on the same line, not the next rafter.
      if (dc > 0.15 && dc < right) right = dc;
      if (dc < -0.15 && -dc < left) left = -dc;
    }
    const sides = [left, right].filter((v) => v < 1.6);
    out.set(
      F.board.id,
      sides.length === 2 ? (sides[0] + sides[1]) / 2 : sides.length ? sides[0] / 2 : fallback,
    );
  }
  return out;
}

function solveBeam(F, supportsAt, loadsAt, uniform, widthForStiffness = F.board.b) {
  // Plane of the member: x = horizontal distance along it, y = elevation.
  const hl = Math.hypot(F.u[0], F.u[2]),
    pos = (s) => ({ x: s * hl, y: s * F.u[1] });
  const stations = [0, F.L, ...supportsAt, ...loadsAt.map((q) => q.s)]
    .map((s) => Math.max(0, Math.min(F.L, s)))
    .sort((a, b) => a - b)
    .filter((s, i, a) => !i || s - a[i - 1] > 1e-3);
  const id = (s) => "N" + stations.findIndex((q) => Math.abs(q - s) <= 1e-3 + 1e-9);
  const nodes = stations.map((s, i) => ({ id: "N" + i, ...pos(s) }));
  const solve = (key) => {
    const elements = stations.slice(1).map((s, i) => ({
      id: "E" + i,
      nodeA: "N" + i,
      nodeB: "N" + (i + 1),
      b: widthForStiffness,
      h: F.board.h,
      E: uniform.E,
      qy: -uniform[key],
    }));
    const supports = supportsAt.map((s, i) => ({ node: id(s), ux: i === 0, uy: true }));
    const nodalLoads = loadsAt.map((q) => ({ node: id(q.s), fy: -q[key] }));
    return solveFrame2D({ nodes, elements, supports, nodalLoads });
  };
  const design = solve("design"),
    service = solve("service");
  if (!design.stable || !service.stable) return null;
  const reaction = (r, s) => r.reactions.find((q) => q.node === id(s))?.fy ?? 0;
  const res = design.elementResults;
  const spans = supportsAt.slice(1).map((s, i) => s - supportsAt[i]),
    overhangs = [supportsAt[0], F.L - supportsAt.at(-1)],
    governingSpan = Math.max(...spans.map((s) => s * hl), ...overhangs.map((o) => 2 * o * hl), 0);
  const deflection = Math.max(0, ...service.displacements.map((d) => Math.abs(d.uy))) * 1000;
  return {
    reactions: supportsAt.map((s) => ({ s, design: reaction(design, s), service: reaction(service, s) })),
    maxMoment: Math.max(0, ...res.map((e) => Math.abs(e.maxMoment ?? 0))),
    maxShear: Math.max(0, ...res.map((e) => Math.abs(e.maxShear ?? 0))),
    maxAxial: Math.max(0, ...res.map((e) => Math.abs(e.maxAxial ?? 0))),
    deflection,
    governingSpan,
  };
}

const WALL_CARRIERS = /^(stud|king|jack|corner)$/;

/**
 * Per-stud axial forces in the main walls from the roof reactions actually delivered to them.
 * A reaction on a wall's top plate (or directly on a stud) goes to the nearest carrying stud
 * of that wall (the top plate spans stud to stud); cripples under sills carry no roof load.
 */
function wallStudForces(p, r, others, delivered, f, mat) {
  const walls = new Map((p.walls ?? []).map((w) => [w.id, w])),
    byWall = new Map();
  for (const b of others) {
    if (!b.wallId || !WALL_CARRIERS.test(b.role ?? "") || !walls.has(b.wallId)) continue;
    if (!byWall.has(b.wallId)) byWall.set(b.wallId, []);
    byWall.get(b.wallId).push(b);
  }
  const along = (w, x, z) => {
    const dx = w.b.x - w.a.x,
      dy = w.b.y - w.a.y,
      L = Math.hypot(dx, dy) || 1;
    return ((x - w.a.x) * dx + (z - w.a.y) * dy) / L;
  };
  const posOf = (w, b) => along(w, b.start[0], b.start[2]);
  // A reaction on the top plate between two carrying studs is shared by the lever rule (the
  // plate spans stud to stud); a reaction delivered straight onto a stud stays on it.
  const forces = new Map(),
    add = (b, design, service) => {
      const e = forces.get(b.id) ?? { design: 0, service: 0, count: 0 };
      e.design += design;
      e.service += service;
      e.count++;
      forces.set(b.id, e);
    };
  for (const d of delivered) {
    if (!d.wallId || !d.point || !byWall.has(d.wallId)) continue;
    const w = walls.get(d.wallId),
      s0 = along(w, d.point[0], d.point[2]),
      list = byWall.get(d.wallId),
      direct = list.find((b) => b.id === d.to);
    if (direct) {
      add(direct, d.design, d.service);
      continue;
    }
    const left = list.filter((b) => posOf(w, b) <= s0).sort((a, b) => posOf(w, b) - posOf(w, a))[0],
      right = list.filter((b) => posOf(w, b) > s0).sort((a, b) => posOf(w, a) - posOf(w, b))[0];
    if (left && right) {
      const l = posOf(w, left),
        r0 = posOf(w, right),
        kR = (s0 - l) / (r0 - l);
      add(left, d.design * (1 - kR), d.service * (1 - kR));
      add(right, d.design * kR, d.service * kR);
    } else add(left ?? right, d.design, d.service);
  }
  // King + jack pairs and doubled studs nailed side by side work as one built-up post:
  // the roof load on the group is shared by area.
  for (const [wallId, list] of byWall) {
    const w = walls.get(wallId),
      sorted = [...list].sort((a, b) => posOf(w, a) - posOf(w, b)),
      groups = [];
    for (const b of sorted) {
      const g = groups.at(-1);
      if (g && posOf(w, b) - posOf(w, g.at(-1)) <= (g.at(-1).b + b.b) / 2000 + 0.01) g.push(b);
      else groups.push([b]);
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      const total = g.reduce(
          (t, b) => {
            const e = forces.get(b.id);
            return {
              design: t.design + (e?.design ?? 0),
              service: t.service + (e?.service ?? 0),
              count: t.count + (e?.count ?? 0),
            };
          },
          { design: 0, service: 0, count: 0 },
        ),
        area = g.reduce((t, b) => t + b.b * b.h, 0);
      if (!total.count) continue;
      for (const b of g)
        forces.set(b.id, {
          design: (total.design * b.b * b.h) / area,
          service: (total.service * b.b * b.h) / area,
          count: total.count,
          group: g.map((q) => q.id),
        });
    }
  }
  const studs = [];
  for (const [wallId, list] of byWall) {
    const w = walls.get(wallId),
      pos = list.map((b) => posOf(w, b)).sort((a, b) => a - b);
    for (const b of list) {
      const e = forces.get(b.id);
      if (!e) continue;
      const s0 = posOf(w, b),
        i = pos.indexOf(s0),
        trib = ((pos[i + 1] ?? s0) - (pos[i - 1] ?? s0)) / 2 || (w.studStep ?? 0.6),
        L = Math.hypot(...b.end.map((v, k) => v - b.start[k])),
        restraint = p.material?.studRestraint,
        weak = finite(restraint) && restraint > 0 ? Math.min(L, restraint) : L,
        layers = (p.loads?.wallDead ?? 0) * L * trib,
        self = ((b.mass ?? 0) * G) / 1000,
        N = e.design + layers * f.layers + self * f.timber,
        comp = axialCompression({ N, b: b.b, h: b.h, l0Strong: L, l0Weak: weak, Fc: mat.Fc, kind: "column" }),
        bearing = bearingPerpendicular({ F: N, b: b.b, l: b.h, Fc90: mat.Fc90 });
      studs.push({
        id: b.id,
        wallId,
        role: b.role,
        N,
        Ncharacteristic: e.service + layers + self,
        roofReactions: e.count,
        groupIds: e.group ?? null,
        roofDesign: e.design,
        tributaryWidth: trib,
        length: L,
        weakAxisLength: weak,
        lambda: comp.lambda,
        lambdaLimit: comp.lambdaLimit,
        phi: comp.phi,
        capacity: comp.capacity,
        compressionUtilization: comp.utilization,
        slendernessUtilization: comp.slendernessUtilization,
        bearingStress: bearing.stress,
        bearingLimit: bearing.limit,
        bearingUtilization: bearing.utilization,
        utilization: Math.max(comp.utilization, comp.slendernessUtilization),
      });
    }
  }
  return {
    studs,
    method: "Реакции кровли → ближайшая несущая стойка стены (обвязка работает между стойками).",
  };
}

export function analyzeSourceRoof(p, r) {
  const roof = r?.roofModel;
  if (!roof?.sourceImported) return null;
  const instances = r.timber?.instances ?? [];
  const zoneIds = new Set(instances.filter((b) => b.zoneId && b.category === "roof").map((b) => b.zoneId));
  const analysed = instances.filter(
    (b) => zoneIds.has(b.zoneId) && Array.isArray(b.start) && Array.isArray(b.end),
  );
  if (!analysed.length) return null;
  const mat = resolveTimberMaterial(p.material ?? {}).values,
    E = p.material?.E ?? 10000,
    f = loadFactors(p.loads ?? {}),
    psiSecond = f.psi?.[1] ?? 0.9;
  // Sheet pressure is added only to member checks here; global mass is already
  // carried by sheetModel -> structuralPanels -> pileField (GOST 8.417 gravity).
  const sheetArea = sum((r.sheetModel?.surfaces ?? []).filter((s) => s.kind === "roof").map((s) => s.area));
  const sheetMass = sum((r.sheetModel?.surfaces ?? []).filter((s) => s.kind === "roof").map((s) => s.mass));
  const roofDead = (p.loads?.roofDead ?? 0.5) + (sheetArea > 0 ? (sheetMass * G) / 1000 / sheetArea : 0),
    ceilingDead = p.loads?.ceilingDead ?? p.roof?.ceilingDead ?? 0.3,
    atticLive = p.loads?.atticLive ?? 0.7,
    spacingFallback = p.roof?.spacing ?? 0.6;
  // Built-up packs: parallel boards of one role touching side by side over ≥80 % of their length
  // act as one member with the summed width (СП 64: составные элементы без учёта податливости связей).
  const raw = analysed.map(frameOf),
    parent = new Map(raw.map((F) => [F.board.id, F.board.id])),
    root = (id) => (parent.get(id) === id ? id : root(parent.get(id)));
  for (let i = 0; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) {
      const A = raw[i],
        B = raw[j];
      if (A.board.role !== B.board.role || A.board.h !== B.board.h || !boxesNear(A, B)) continue;
      const ov = parallelOverlap(A, B);
      if (!ov || ov.z - ov.a < 0.8 * Math.min(A.L, B.L)) continue;
      const d = sub(B.P, A.P),
        side = Math.abs(dot(d, A.w)),
        offset = Math.abs(dot(d, A.n));
      if (Math.abs(side - (A.b + B.b) / 2) < 0.012 && offset < 0.012)
        parent.set(root(B.board.id), root(A.board.id));
    }
  const packs = new Map();
  for (const F of raw) {
    const r0 = root(F.board.id);
    if (!packs.has(r0)) packs.set(r0, []);
    packs.get(r0).push(F);
  }
  const plyOf = new Map(),
    frames = new Map();
  for (const [rep, plies] of packs) {
    for (const F of plies) plyOf.set(F.board.id, rep);
    if (plies.length === 1) {
      frames.set(rep, plies[0]);
      continue;
    }
    const first = plies.find((F) => F.board.id === rep),
      P = mul(
        plies.reduce((t, F) => add(t, F.P), [0, 0, 0]),
        1 / plies.length,
      ),
      bSum = plies.reduce((t, F) => t + F.board.b, 0),
      board = {
        ...first.board,
        b: bSum,
        mass: plies.reduce((t, F) => t + (F.board.mass ?? 0), 0),
        start: P,
        end: add(P, mul(first.u, first.L)),
        packIds: plies.map((F) => F.board.id),
      };
    frames.set(rep, frameOf(board));
  }
  const others = instances.filter((b) => !plyOf.has(b.id) && Array.isArray(b.start) && Array.isArray(b.end));
  const otherFrames = others.map(frameOf);
  const all = [...frames.values()];
  const rafterTrib = tributaryWidths(all, RAFTER_ROLE, spacingFallback),
    ceilingTrib = tributaryWidths(all, CEILING_ROLE, spacingFallback);

  // Candidate supports: members whose contact point is below this member's contact point.
  const supportsOf = new Map();
  for (const A of all) {
    const axial = isAxial(A),
      lowEnd = A.board.start[1] <= A.board.end[1] ? 0 : A.L,
      list = [];
    for (const B of [...all, ...otherFrames]) {
      if (B === A) continue;
      if (RAFTER_ROLE.test(A.board.role) && RAFTER_ROLE.test(B.board.role)) continue;
      const c = contact(A, B, axial ? 0.06 : CONTACT_TOL);
      // Support must not be above: allow a quarter of the member depth for modelling datum noise
      // (e.g. a ceiling joist modelled at the level of the wall top plate it bears on).
      if (!c || c.pb[1] > c.pa[1] + (axial ? 0.005 : 0.25 * A.h)) continue;
      if (axial && Math.abs(c.s - lowEnd) > 0.15) continue; // axial members rest on their lower end
      if (isAxial(B) && Math.abs(c.t - (B.board.start[1] >= B.board.end[1] ? 0 : B.L)) > 0.15) continue; // only an axial member's top end supports
      list.push({
        id: B.board.id,
        s: c.s,
        t: c.t,
        y: c.pb[1],
        point: c.pb,
        main: !frames.has(B.board.id),
        axial: isAxial(B),
        vertical: Math.abs(B.u[1]) > 0.9,
        overlap: !isAxial(A) && !isAxial(B) ? c.overlap : null,
      });
    }
    supportsOf.set(A.board.id, list);
  }
  // Break mutual support pairs: keep the edge pointing to the lower member.
  for (const [a, list] of supportsOf)
    for (const q of [...list]) {
      const back = supportsOf.get(q.id)?.find((x) => x.id === a);
      if (!back) continue;
      const A = frames.get(a),
        B = frames.get(q.id);
      const ya = Math.min(A.board.start[1], A.board.end[1]),
        yb = Math.min(B.board.start[1], B.board.end[1]);
      if (ya < yb - 1e-6 || (Math.abs(ya - yb) <= 1e-6 && a < q.id)) list.splice(list.indexOf(q), 1);
    }
  // Choose one support per cluster along a beam: prefer beams over axial members, highest first.
  const chosen = new Map();
  for (const [a, list] of supportsOf) {
    const F = frames.get(a);
    if (isAxial(F)) {
      const beams = list.filter((q) => !q.axial);
      chosen.set(
        a,
        (beams.length ? beams : list).map((q) => ({ ...q, share: 1 / (beams.length || list.length) })),
      );
      continue;
    }
    // Lying on one or several parallel members (stacked plates, plate on a wall top plate made of
    // 6 m pieces): if they cover ≥80 % of the length, the member works with them and forwards
    // every load to the piece directly underneath.
    const parallels = list.filter((q) => q.overlap),
      covered = parallels
        .map((q) => [q.overlap.a, q.overlap.z])
        .sort((x, y) => x[0] - y[0])
        .reduce((acc, [a0, z0]) => {
          const last = acc.at(-1);
          if (last && a0 <= last[1]) last[1] = Math.max(last[1], z0);
          else acc.push([a0, z0]);
          return acc;
        }, [])
        .reduce((t, [a0, z0]) => t + z0 - a0, 0);
    if (parallels.length && covered >= 0.8 * F.L) {
      const top = Math.max(...parallels.map((q) => q.y));
      chosen.set(
        a,
        parallels.filter((q) => q.y >= top - 0.06).map((q) => ({ ...q, share: 1, passThrough: true })),
      );
      continue;
    }
    const sorted = [...list].sort((x, y) => x.s - y.s),
      clusters = [];
    for (const q of sorted) {
      const c = clusters.at(-1);
      if (c && q.s - c.at(-1).s < CLUSTER) c.push(q);
      else clusters.push([q]);
    }
    chosen.set(
      a,
      clusters.map((c) => {
        const beams = c.filter((q) => !q.axial),
          verticals = c.filter((q) => q.axial && q.vertical),
          pick = (beams.length ? beams : verticals.length ? verticals : c).sort((x, y) => y.y - x.y)[0];
        return { ...pick, s: c.reduce((s, q) => s + q.s, 0) / c.length, share: 1 };
      }),
    );
  }
  // Topological order: a member is solved after everything resting on it.
  const restingOn = new Map(all.map((F) => [F.board.id, 0]));
  for (const list of chosen.values())
    for (const q of list) if (!q.main) restingOn.set(q.id, (restingOn.get(q.id) ?? 0) + 1);
  const queue = all.filter((F) => !restingOn.get(F.board.id)).map((F) => F.board.id),
    order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const q of chosen.get(id) ?? [])
      if (!q.main) {
        restingOn.set(q.id, restingOn.get(q.id) - 1);
        if (restingOn.get(q.id) === 0) queue.push(q.id);
      }
  }
  const cyclic = all.map((F) => F.board.id).filter((id) => !order.includes(id));

  const incoming = new Map(all.map((F) => [F.board.id, []])),
    members = {},
    delivered = [],
    unresolved = [];
  // Members lying on a beam over its length work together with it (non-composite): bending and
  // shear are shared in proportion to EI.
  const stackedOn = new Map();
  let appliedDesign = 0;
  const push = (fromId, q, design, service) => {
    if (q.main) {
      const target = others.find((b) => b.id === q.id);
      delivered.push({
        from: fromId,
        to: q.id,
        role: target?.role,
        wallId: target?.wallId ?? null,
        point: q.point ?? null,
        design,
        service,
      });
    } else incoming.get(q.id).push({ from: fromId, t: q.t, design, service });
  };
  for (const id of order) {
    const F = frames.get(id),
      b = F.board,
      supports = chosen.get(id) ?? [],
      self = ((b.mass ?? 0) * G) / 1000,
      inLoads = incoming.get(id),
      base = {
        id,
        role: b.role,
        name: b.name,
        supports: supports.map((q) => q.id),
        from: inLoads.map((q) => q.from),
      };
    if (isAxial(F)) {
      appliedDesign += self * f.timber;
      const Vd = inLoads.reduce((s, q) => s + q.design, 0) + self * f.timber,
        Vs = inLoads.reduce((s, q) => s + q.service, 0) + self,
        sin = Math.max(0.2, Math.abs(F.u[1])),
        N = Vd / sin;
      const restraint = p.material?.studRestraint;
      const comp = axialCompression({
        N,
        b: b.b,
        h: b.h,
        l0Strong: F.L,
        l0Weak: finite(restraint) && restraint > 0 && /stud/i.test(b.role) ? Math.min(F.L, restraint) : F.L,
        Fc: mat.Fc,
        kind: "column",
      });
      const bearing = bearingPerpendicular({ F: N * sin, b: b.b, l: b.h, Fc90: mat.Fc90 });
      const u = Math.max(
        comp.utilization,
        comp.slendernessUtilization,
        supports.some((q) => !q.axial) ? bearing.utilization : 0,
      );
      members[id] = {
        ...base,
        kind: "axial",
        N,
        Ncharacteristic: Vs / sin,
        incomingCount: inLoads.length,
        length: F.L,
        lambda: comp.lambda,
        lambdaLimit: comp.lambdaLimit,
        phi: comp.phi,
        capacity: comp.capacity,
        compressionUtilization: comp.utilization,
        slendernessUtilization: comp.slendernessUtilization,
        bearingStress: bearing.stress,
        bearingLimit: bearing.limit,
        bearingUtilization: supports.some((q) => !q.axial) ? bearing.utilization : null,
        horizontalThrust: sin < 0.98 ? (Vd * Math.hypot(F.u[0], F.u[2])) / sin : 0,
        utilization: u,
        packIds: b.packIds ?? null,
        status: !supports.length || !inLoads.length ? "unverified" : u > 1 ? "fail" : "pass",
        note: !supports.length
          ? "Нижняя опора не найдена по контактам досок."
          : !inLoads.length
            ? "По контактному пути нагрузка на элемент не приходит: работает как связь/подкос или опирание не распознано. Гибкость показана справочно."
            : b.packIds
              ? `Пакет из ${b.packIds.length} досок, сечение ${b.b}×${b.h} мм как цельное (податливость связей не учтена).`
              : null,
      };
      if (supports.length) for (const q of supports) push(id, q, Vd * q.share, Vs * q.share);
      else unresolved.push({ id, design: Vd, service: Vs });
      continue;
    }
    // Beam-type member
    const isRafter = RAFTER_ROLE.test(b.role),
      isCeiling = CEILING_ROLE.test(b.role),
      cos = Math.hypot(F.u[0], F.u[2]),
      alpha = (Math.acos(Math.min(1, cos)) * 180) / Math.PI,
      selfLine = self / F.L;
    let layers = 0,
      snow = 0,
      live = 0,
      trib = null;
    if (isRafter) {
      trib = rafterTrib.get(id);
      layers = roofDead * trib;
      snow = roofSnowLoad(p.loads ?? {}, alpha, p.roof?.snowMu) * trib * cos; // per slope length
    } else if (isCeiling) {
      trib = ceilingTrib.get(id);
      layers = ceilingDead * trib;
      live = atticLive * trib;
    }
    const uniform = {
      E,
      design:
        selfLine * f.timber + layers * f.layers + snow * f.snow + live * f.live * (snow ? psiSecond : 1),
      service: selfLine + layers + snow + live,
    };
    const loadsAt = inLoads.map((q) => ({
      s: Math.max(0, Math.min(F.L, q.t)),
      design: q.design,
      service: q.service,
    }));
    appliedDesign += uniform.design * F.L;
    if (supports.length && supports.every((q) => q.passThrough)) {
      // Lies on parallel member(s): forward each load to the piece directly underneath.
      const under = (st) =>
        supports.find((q) => st >= q.overlap.a - 1e-6 && st <= q.overlap.z + 1e-6) ??
        supports.reduce((x, y) =>
          Math.min(Math.abs(st - y.overlap.a), Math.abs(st - y.overlap.z)) <
          Math.min(Math.abs(st - x.overlap.a), Math.abs(st - x.overlap.z))
            ? y
            : x,
        );
      const frameOfId = (sid) => frames.get(sid) ?? otherFrames.find((q) => q.board.id === sid),
        forward = (st, d, sv) => {
          const S = under(st),
            B = frameOfId(S.id),
            pt = add(F.P, mul(F.u, st)),
            t = B ? Math.max(0, Math.min(B.L, dot(sub(pt, B.P), B.u))) : 0;
          push(id, { ...S, t, point: B ? add(B.P, mul(B.u, t)) : pt }, d, sv);
        },
        n = Math.max(2, Math.ceil(F.L / 0.3));
      for (const q of supports)
        if (frames.has(q.id)) {
          if (!stackedOn.has(q.id)) stackedOn.set(q.id, []);
          stackedOn.get(q.id).push(F);
        }
      for (const q of loadsAt) forward(q.s, q.design, q.service);
      for (let i = 0; i < n; i++)
        forward(((i + 0.5) * F.L) / n, (uniform.design * F.L) / n, (uniform.service * F.L) / n);
      const S = supports[0];
      members[id] = {
        ...base,
        kind: "beam",
        passThrough: true,
        status: "pass",
        utilization: null,
        lineLoadDesign: uniform.design,
        pointLoads: loadsAt.length,
        note: `Лежит по всей длине на ${supports.map((q) => q.id).join(", ")} и работает вместе с ними: нагрузка передана вниз в месте приложения.`,
      };
      continue;
    }
    const supportsAt = supports.map((q) => q.s);
    const hasLoad = uniform.design > 0 || loadsAt.length;
    const Iown = b.b * b.h ** 3,
      Isum = Iown + (stackedOn.get(id) ?? []).reduce((t, Q) => t + Q.board.b * Q.board.h ** 3, 0),
      share = Iown / Isum;
    const solved =
      supportsAt.length >= 2 ? solveBeam(F, supportsAt, loadsAt, uniform, (b.b * Isum) / Iown) : null;
    if (!solved) {
      members[id] = {
        ...base,
        kind: "beam",
        tributaryWidth: trib,
        lineLoadDesign: uniform.design,
        status: "unverified",
        utilization: null,
        note:
          supportsAt.length < 2
            ? `Найдено опор: ${supportsAt.length}. Для расчёта нужны две и более (или консоль с заделкой).`
            : "Система опор неустойчива для плоской модели.",
      };
      // Pass the total down so the load path is not lost.
      const totalD = uniform.design * F.L + loadsAt.reduce((s, q) => s + q.design, 0),
        totalS = uniform.service * F.L + loadsAt.reduce((s, q) => s + q.service, 0);
      if (hasLoad && supports.length)
        for (const q of supports) push(id, q, totalD / supports.length, totalS / supports.length);
      else if (hasLoad) unresolved.push({ id, design: totalD, service: totalS });
      continue;
    }
    const W = (b.b * b.h ** 2) / 6,
      A = b.b * b.h,
      sigma = (solved.maxMoment * share * 1e6) / W,
      tau = (1.5 * solved.maxShear * share * 1000) / A,
      axial = (solved.maxAxial * 1000) / A,
      ratio = isRafter ? 200 : 250,
      limit = (solved.governingSpan * 1000) / ratio;
    const bendingU = sigma / mat.Fb + (isRafter ? axial / mat.Fc : 0),
      shearU = tau / mat.Fv,
      deflU = limit > 0 ? solved.deflection / limit : 0,
      u = Math.max(bendingU, shearU, deflU);
    members[id] = {
      ...base,
      kind: "beam",
      tributaryWidth: trib,
      pitch: alpha,
      lineLoadDesign: uniform.design,
      lineLoadService: uniform.service,
      pointLoads: loadsAt.length,
      supportCount: supportsAt.length,
      governingSpan: solved.governingSpan,
      maxMoment: solved.maxMoment,
      maxShear: solved.maxShear,
      maxAxial: solved.maxAxial,
      bendingStress: sigma,
      shearStress: tau,
      deflection: solved.deflection,
      deflectionLimit: limit,
      deflectionRatio: ratio,
      bendingUtilization: bendingU,
      shearUtilization: shearU,
      deflectionUtilization: deflU,
      utilization: u,
      status: u > 1 ? "fail" : "pass",
      packIds: b.packIds ?? null,
      stackedIds: (stackedOn.get(id) ?? []).map((Q) => Q.board.id),
      momentShare: share,
      note:
        [
          share < 1
            ? `Работает совместно с лежащими на нём ${(stackedOn.get(id) ?? []).map((Q) => Q.board.id).join(", ")}: доля изгиба и среза ${Math.round(share * 100)}% по жёсткости EI.`
            : null,
          b.packIds ? `Пакет из ${b.packIds.length} досок, сечение ${b.b}×${b.h} мм как цельное.` : null,
          solved.reactions.some((q) => q.design < -1e-6)
            ? "Отрицательная реакция на опоре: элемент работает консолью и отрывается от опоры — проверьте схему по КР."
            : null,
          inLoads.some((q) => frames.get(q.from) && parallelOverlap(F, frames.get(q.from)))
            ? "Стык внахлёст принят шарнирным (крепёж не рассчитан)."
            : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
      reactions: solved.reactions.map((q, i) => ({
        support: supports[i].id,
        design: q.design,
        service: q.service,
      })),
    };
    solved.reactions.forEach((q, i) => push(id, supports[i], q.design, q.service));
  }
  for (const id of cyclic)
    members[id] = {
      id,
      role: frames.get(id).board.role,
      name: frames.get(id).board.name,
      kind: isAxial(frames.get(id)) ? "axial" : "beam",
      status: "unverified",
      utilization: null,
      note: "Взаимное опирание (цикл контактов): путь нагрузки не определён.",
    };

  for (const [ply, rep] of plyOf)
    if (ply !== rep && members[rep]) members[ply] = { ...members[rep], id: ply, packOf: rep };

  // Checks grouped by member family.
  const groups = [
    ["rafters", "Стропила импортированной кровли: изгиб, срез, прогиб", (m) => RAFTER_ROLE.test(m.role)],
    ["axial", "Стойки, подкосы и столбы кровли: сжатие φ, гибкость, смятие", (m) => m.kind === "axial"],
    [
      "beams",
      "Обвязки, прогоны и балки кровли/чердака: изгиб, срез, прогиб",
      (m) => m.kind === "beam" && !RAFTER_ROLE.test(m.role),
    ],
  ];
  const wallStuds = wallStudForces(p, r, others, delivered, f, mat);
  const list = Object.values(members);
  const deliveredDesign = delivered.reduce((t, q) => t + q.design, 0),
    unresolvedDesign = unresolved.reduce((t, q) => t + q.design, 0);
  const checks = groups
    .map(([key, label, test]) => {
      const g = list.filter(test),
        computed = g.filter((m) => finite(m.utilization) && m.status !== "unverified");
      if (!g.length) return null;
      const worst = computed.reduce((a, m) => (!a || m.utilization > a.utilization ? m : a), null),
        failIds = computed.filter((m) => m.status === "fail").map((m) => m.id),
        unverified = g.filter((m) => m.status === "unverified").map((m) => m.id);
      return {
        id: `source-roof-members-${key}`,
        label,
        status: failIds.length ? "fail" : unverified.length ? "unverified" : "pass",
        value: worst?.utilization ?? null,
        utilization: worst?.utilization ?? null,
        limit: 1,
        unit: "коэф.",
        failIds,
        unverifiedIds: unverified,
        worstId: worst?.id ?? null,
        note: `Рассчитано ${computed.length} из ${g.length}. Путь нагрузки построен по физическим контактам досок; узлы и крепёж не проверены.${unverified.length ? ` Без расчёта: ${unverified.length} (нет опор или цикл).` : ""}`,
      };
    })
    .filter(Boolean);
  const balanceOk =
    Math.abs(appliedDesign - deliveredDesign - unresolvedDesign) <= 1e-6 * Math.max(1, appliedDesign);
  if (wallStuds.studs.length) {
    const worst = wallStuds.studs.reduce((a, q) => (q.utilization > a.utilization ? q : a));
    const worstBearing = wallStuds.studs.reduce((a, q) =>
      q.bearingUtilization > a.bearingUtilization ? q : a,
    );
    checks.push(
      {
        id: "source-roof-wall-studs",
        label: "Стойки стен под кровлей по чертежу: сжатие φ от фактических реакций",
        status: worst.utilization > 1 ? "fail" : "pass",
        value: worst.N,
        limit: worst.capacity,
        utilization: worst.utilization,
        unit: "кН",
        worstId: worst.id,
        failIds: wallStuds.studs.filter((q) => q.utilization > 1).map((q) => q.id),
        note: `Каждая стойка получает реакции досок кровли, опёртых на обвязку над ней (ближайшая несущая стойка), и вес стены с грузовой ширины. Худшая: ${worst.id} (${worst.wallId}), N = ${worst.N.toFixed(1)} кН.`,
      },
      {
        id: "source-roof-wall-plate-bearing",
        label: "Нижняя обвязка под стойками стен: смятие поперёк волокон от фактических усилий",
        status: worstBearing.bearingUtilization > 1 ? "fail" : "pass",
        value: worstBearing.bearingStress,
        limit: worstBearing.bearingLimit,
        utilization: worstBearing.bearingUtilization,
        unit: "МПа",
        worstId: worstBearing.id,
        failIds: wallStuds.studs.filter((q) => q.bearingUtilization > 1).map((q) => q.id),
      },
    );
  }
  checks.push({
    id: "source-roof-load-path-balance",
    label: "Кровля по чертежу: баланс пути нагрузки",
    status: !balanceOk ? "fail" : unresolvedDesign > 0.01 ? "unverified" : "pass",
    value: deliveredDesign,
    limit: appliedDesign,
    unit: "кН",
    note: `Приложено ${appliedDesign.toFixed(1)} кН (расч.), передано на основной каркас ${deliveredDesign.toFixed(1)} кН, без найденной опоры ${unresolvedDesign.toFixed(1)} кН (${unresolved.length} элем.).`,
  });
  return {
    method:
      "Контактный путь нагрузки: стропила → обвязки/прогоны → стойки/подкосы → балки → основной каркас. Неразрезные балки — плоская модель solveFrame2D, вертикальные реакции; сжатые элементы — СП 64 (φ, λ), смятие Rсм90.",
    assumptions: [
      `Нагрузки: слои кровли ${roofDead} кПа по скату, снег S0 = ce·ct·µ(α)·Sg по плану, чердак: слои ${ceilingDead} кПа + полезная ${atticLive} кПа (СП 20 табл. 8.3), коэффициенты γf профиля ${f.profile}.`,
      "Опоры определяются по контакту досок (зазор < 20 мм), ближайшие вдоль элемента объединяются в одну линию опирания; предпочтение — горизонтальному элементу (обвязке) перед стойкой.",
      "Распор наклонных подкосов и стропил на обвязки не передаётся в основную модель — показан как горизонтальная составляющая.",
    ],
    members,
    wallStuds,
    delivered,
    unresolved,
    deliveredDesign,
    unresolvedDesign,
    appliedDesign,
    balanceError: appliedDesign - deliveredDesign - unresolvedDesign,
    checks,
  };
}

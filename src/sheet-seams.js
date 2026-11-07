// Seam placement for one run of sheets (a wall length, a wall height, a floor row…).
//
// Sheet sheathing is a structural diaphragm, not a cladding to be pieced together from
// leftovers: every installed piece should be as large as the stock allows. Greedy
// "full sheet, full sheet, …, whatever is left" leaves slivers at the end of the run
// (a 50 mm floor strip, a 0.3 m wall top band). Slivers carry almost no shear: EN 1995-1-1
// 9.2.4.2(3) ignores wall panels narrower than h/4, and edge nailing of a strip a few
// centimetres wide splits it. Here the end remainder is instead merged into, or balanced
// with, the first piece so that no piece is smaller than `minPiece` when that is possible.

// Narrowest strip worth installing: two rows of edge nails (2 × 10d + spacing) and the same
// 0.3 m threshold as a reusable offcut (sheet-cutting.js). A planning rule, not a code value.
export const MIN_STRIP = 0.3;
// Numerical tolerance, not a construction allowance.
const EPS = 1e-7;

/**
 * @param {number} a run start
 * @param {number} b run end
 * @param {number} module stock dimension along the run (sheet width or length)
 * @param {object} [o]
 * @param {number[]} [o.stations] framing axes a seam may land on (studs, joists), sorted or not
 * @param {number} [o.window] a seam snaps to the furthest station in [target − window, target];
 *   Infinity: a seam must land on a station whenever one exists after the previous seam + minGap
 * @param {number} [o.first] preferred first piece (module, or module/2 for a staggered row)
 * @param {number} [o.minPiece] smallest acceptable piece (default module/2)
 * @param {number} [o.minGap] a seam never snaps closer than this to the previous one
 * @param {number[]} [o.avoid] seams of the adjacent row: staggered end joints must not line up with them
 * @param {number[][]} [o.soft] intervals (openings) where an unavoidable narrow piece does no harm
 * @returns {number[]} breakpoints [a, …, b]
 */
export function sheetRun(a, b, module, o = {}) {
  const stations = [...new Set(o.stations ?? [])].sort((x, y) => x - y),
    window = o.window ?? Infinity,
    first = Math.min(o.first ?? module, module),
    minPiece = Math.min(o.minPiece ?? module / 2, b - a),
    minGap = o.minGap ?? 0.25,
    avoid = o.avoid ?? [];
  if (!(b - a > EPS)) return [a, b];
  if (stations.length && window === Infinity)
    return stationRun(a, b, module, { stations, first, minPiece, minGap, avoid, soft: o.soft ?? [] });
  const snap = (from, target) =>
    stations.filter((s) => s > from + minGap && s <= target + EPS && s >= target - window - EPS).at(-1) ??
    target;
  const greedy = (x1) => {
    const xs = [a, x1];
    while (xs.at(-1) < b - EPS && xs.length < 1000) {
      const from = xs.at(-1),
        target = Math.min(b, from + module);
      xs.push(target >= b - EPS ? b : snap(from, target));
    }
    return xs;
  };
  const start = (len) => (a + len >= b - EPS ? b : snap(a, a + len));
  const base = greedy(start(first)),
    rem = base.at(-1) - base.at(-2),
    lead = base[1] - a;
  // Candidate first seams: the preferred one, the remainder merged into the first piece,
  // the remainder balanced with it, and every framing axis within one module.
  const firsts = new Set([base[1]]);
  for (const len of [lead + rem, (lead + rem) / 2, (lead + rem + module) / 2])
    if (len > minGap && len <= module + EPS) firsts.add(start(len));
  for (const s of stations) if (s > a + minGap && s <= a + module + EPS) firsts.add(s);
  const score = (xs) => {
    const pieces = xs.slice(1).map((x, i) => x - xs[i]),
      slivers = pieces.filter((p) => p < minPiece - EPS).length,
      full = pieces.filter((p) => p >= module - 1e-3).length,
      aligned = xs.slice(1, -1).filter((x) => avoid.some((q) => Math.abs(q - x) < 1e-3)).length;
    return [
      aligned,
      slivers,
      slivers ? -Math.min(...pieces) : 0,
      pieces.length,
      -full,
      Math.abs(xs[1] - a - first),
    ];
  };
  const better = (s, t) => {
    for (let i = 0; i < s.length; i++) if (Math.abs(s[i] - t[i]) > 1e-9) return s[i] < t[i];
    return false;
  };
  let best = base,
    bestScore = score(base);
  for (const x1 of firsts) {
    if (!(x1 > a + EPS) || x1 > b + EPS) continue;
    const xs = greedy(x1),
      s = score(xs);
    // A run must never contain a piece longer than the stock.
    if (xs.slice(1).some((x, i) => x - xs[i] > module + EPS)) continue;
    if (better(s, bestScore)) [best, bestScore] = [xs, s];
  }
  return best;
}

/**
 * Seams that must land on framing axes: exact shortest path over the axes (O(n²), n ≈ 20–100).
 * Lexicographic cost, summed over pieces: end joints lined up with the adjacent row, slivers,
 * sliver length outside `soft` intervals (openings, where the sheet is cut out anyway, so a
 * narrow column there costs no racking), number of pieces, cut pieces, first-piece deviation.
 * Where no axis is reachable within one module the seam falls at the full module (it then
 * gets a backing stud, as before).
 */
function stationRun(a, b, module, { stations, first, minPiece, minGap, avoid, soft }) {
  const nodes = [a, ...stations.filter((s) => s > a + EPS && s < b - EPS), b];
  // Fallback nodes: a full module after any node that cannot otherwise reach a further one.
  for (let i = 0; i < nodes.length - 1; i++) {
    const x = nodes[i];
    if (!nodes.some((y) => y > x + minGap && y <= x + module + EPS)) {
      const y = Math.min(b, x + module);
      if (!nodes.some((q) => Math.abs(q - y) < EPS)) nodes.splice(i + 1, 0, y);
    }
  }
  const covered = (x0, x1) =>
    soft.reduce((s, [c, d]) => s + Math.max(0, Math.min(d, x1) - Math.max(c, x0)), 0);
  const pieceCost = (x0, x1) => {
    const len = x1 - x0,
      sliver = len < minPiece - EPS;
    return [
      x1 < b - EPS && avoid.some((q) => Math.abs(q - x1) < 1e-3) ? 1 : 0,
      sliver ? 1 : 0,
      sliver ? Math.max(0, len - covered(x0, x1)) : 0,
      1,
      len < module - 1e-3 ? 1 : 0,
      x0 <= a + EPS ? Math.abs(len - first) : 0,
    ];
  };
  const add = (s, t) => s.map((v, i) => v + t[i]),
    less = (s, t) => {
      for (let i = 0; i < s.length; i++) if (Math.abs(s[i] - t[i]) > 1e-9) return s[i] < t[i];
      return false;
    };
  const cost = nodes.map(() => null),
    prev = nodes.map(() => -1);
  cost[0] = [0, 0, 0, 0, 0, 0];
  for (let j = 1; j < nodes.length; j++)
    for (let i = j - 1; i >= 0 && nodes[j] - nodes[i] <= module + EPS; i--) {
      if (!cost[i] || (nodes[j] - nodes[i] <= minGap && j < nodes.length - 1)) continue;
      const c = add(cost[i], pieceCost(nodes[i], nodes[j]));
      if (!cost[j] || less(c, cost[j])) [cost[j], prev[j]] = [c, i];
    }
  const xs = [];
  for (let j = nodes.length - 1; j >= 0; j = prev[j]) {
    xs.unshift(nodes[j]);
    if (j === 0) break;
    if (prev[j] < 0) return [a, b]; // unreachable: cannot happen with the fallback nodes
  }
  return xs;
}

/** Pieces of a run shorter than `limit` (for reporting and racking exclusions). */
export function narrowPieces(xs, limit) {
  return xs
    .slice(1)
    .map((x, i) => ({ from: xs[i], to: x, length: x - xs[i] }))
    .filter((p) => p.length < limit - EPS);
}

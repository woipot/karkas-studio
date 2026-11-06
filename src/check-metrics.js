/**
 * Formula-agnostic metrics over the engine's check list. Everything here reads
 * only the public check shape {id, status, utilization?, value?, limit?}, so it
 * keeps working when load or resistance formulas change elsewhere.
 */
const finite = Number.isFinite;
const EPS = 1e-9;

/** Utilization of one check, or null when the check carries no numeric ratio. */
export function checkUtilization(c) {
  if (!c || typeof c !== "object") return null;
  if (finite(c.utilization)) return c.utilization;
  // Some failed checks report only value/limit; derive a ratio for those.
  if (c.status === "fail" && finite(c.value) && finite(c.limit) && c.limit > 0)
    return Math.abs(c.value) / c.limit;
  return null;
}

/**
 * Excess of a failed check above its limit. Ratio checks contribute u−1;
 * count-type checks (limit 0, e.g. "20 boards over stock") contribute a bounded
 * monotone share in (0,1); binary failures without numbers contribute 0.5.
 */
export function checkExcess(c) {
  if (c?.status !== "fail") return 0;
  const u = checkUtilization(c);
  if (u !== null && u > 1) return u - 1;
  if (finite(c.value) && finite(c.limit) && c.value > c.limit) return 1 - 1 / (1 + (c.value - c.limit));
  return 0.5;
}

/** Comparable "badness" of a check: ≥1 when failed, utilization (or 0) otherwise. */
export function checkSeverity(c) {
  if (!c) return 0;
  if (c.status === "fail") return 1 + checkExcess(c);
  const u = finite(c.utilization) ? c.utilization : null;
  return u === null ? 0 : u;
}

/** Map check id → check (duplicates keep the most severe occurrence). */
export function indexChecks(checks = []) {
  const map = new Map();
  for (const c of checks) {
    if (!c || typeof c.id !== "string") continue;
    const prior = map.get(c.id);
    if (!prior || checkSeverity(c) > checkSeverity(prior)) map.set(c.id, c);
  }
  return map;
}

/** Lexicographic objective inputs of one evaluated report. */
export function evaluationMetrics(report) {
  const checks = report?.result?.checks ?? [],
    summary = report?.summary ?? {};
  let failedChecks = 0,
    excess = 0,
    maxUtilization = null,
    maxUtilizationCheckId = null;
  for (const c of checks) {
    if (c?.status === "fail") {
      failedChecks++;
      excess += checkExcess(c);
    }
    const u = finite(c?.utilization) ? c.utilization : c?.status === "fail" ? checkUtilization(c) : null;
    if (u !== null && (maxUtilization === null || u > maxUtilization)) {
      maxUtilization = u;
      maxUtilizationCheckId = c.id;
    }
  }
  return {
    failedChecks,
    excessUtilization: Math.round(excess * 1e6) / 1e6,
    maxUtilization: maxUtilization === null ? null : Math.round(maxUtilization * 1e6) / 1e6,
    maxUtilizationCheckId,
    unplaced: summary.unplaced ?? 0,
    estimateTotal: summary.estimateTotal ?? 0,
  };
}

/** Comparator: failed count, Σ excess utilization, unplaced parts, cost. Negative = a is better. */
export function compareMetrics(a, b, { unplaced = true } = {}) {
  if (a.failedChecks !== b.failedChecks) return a.failedChecks - b.failedChecks;
  if (Math.abs(a.excessUtilization - b.excessUtilization) > 1e-6)
    return a.excessUtilization - b.excessUtilization;
  if (unplaced && a.unplaced !== b.unplaced) return a.unplaced - b.unplaced;
  if (Math.abs(a.estimateTotal - b.estimateTotal) > EPS) return a.estimateTotal - b.estimateTotal;
  return 0;
}

// Visual threshold inherited from the member panel; not a design acceptance limit.
export function memberStatus({ utilization, status, unloaded = false } = {}) {
  const reference = unloaded || !Number.isFinite(utilization);
  return {
    reference,
    tone: reference
      ? "muted"
      : status === "fail" || utilization > 1
        ? "fail"
        : utilization > 0.85
          ? "warn"
          : "ok",
    label: reference
      ? "Загрузка · справочно"
      : status === "unverified"
        ? "Загрузка · узлы/крепёж не подтверждены"
        : "Загрузка",
    percent: reference ? null : utilization * 100,
  };
}

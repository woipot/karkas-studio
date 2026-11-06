const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  sub = (a, b) => a.map((v, i) => v - b[i]),
  norm = (v) => Math.hypot(...v),
  unit = (v) => v.map((x) => x / norm(v)),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = 35.433125,
  originX = 168.88617928,
  originZ = 452.07176665 - 4.5 * scale;
const coord = (v, o) => Math.round(((v - o) / scale) * 1000) / 1000;
export function correctSourceRoofEdges(input, vectors) {
  if (input.site?.planCoordinates?.transform !== "engineY=9-sourceY")
    throw Error("Expected corrected R4 source orientation.");
  if (vectors.length !== 30) throw Error("Expected30 B-075 source rectangles.");
  const p = structuredClone(input),
    source = p.roof.sourceModel,
    old = source.members;
  if (old.some((b) => b.role === "rafter" && b.shape))
    throw Error("Expected unmachined Orion source rafters; do not apply the correction twice.");
  const basis = (b) => {
    const d = unit(sub(b.end, b.start)),
      x = unit(b.crossAxis),
      n = unit(cross(x, d));
    if (n[1] < 0.9) throw Error("Expected positive roof normal.");
    return { d, x, n, mid: b.start.map((v, i) => (v + b.end[i]) / 2) };
  };
  const corrected = old.map((b) => {
    if (b.role !== "rafter") return b;
    const { d, n } = basis(b),
      tilt = Math.sign(-n[2] / d[2]);
    return { ...b, cutStart: { ...b.cutStart, tiltSign: tilt }, cutEnd: { ...b.cutEnd, tiltSign: -tilt } };
  });
  const rafters = corrected.filter((b) => b.role === "rafter"),
    reference = (z) => rafters.find((b) => b.sourceMark === "Б-41" && b.start[2] > 4.5 === z > 4.5);
  const replaced = vectors.map((q, i) => {
    const xa = coord(q.x0, originX),
      xb = coord(q.x1, originX),
      z = 9 - coord((q.y0 + q.y1) / 2, originZ),
      r = reference(z),
      { n } = basis(r),
      top = dot(n, r.start) + 0.1;
    const topCenter = [(xa + xb) / 2, (top - n[2] * z) / n[1], z],
      center = topCenter.map((v, k) => v - 0.02 * n[k]);
    return {
      id: "В-075-" + String(i + 1).padStart(3, "0"),
      sourceMark: "В-075",
      sourcePage: 46,
      name: "В-075 · фронтонный вынос плашмя в пазах",
      role: "roofOutlooker",
      section: "40x150",
      start: [xa, center[1], center[2]],
      end: [xb, center[1], center[2]],
      crossAxis: n,
      level: 1,
      note: "Положение верхней грани снято с векторного листа45;40мм по нормали ската,150мм вдоль ската. Рабочий крепёж и прочность пазов не рассчитаны.",
    };
  });
  const contacts = [],
    slotsByRafter = new Map();
  const changed = corrected
    .filter((b) => b.role !== "roofOutlooker")
    .map((b) => {
      if (b.role !== "rafter") return b;
      const { d, n, mid } = basis(b),
        L = norm(sub(b.end, b.start)),
        h = 0.2,
        depth = 0.04,
        slots = [];
      const shift = (cut, v, start) =>
        cut?.scheme === "miter"
          ? (start ? 1 : -1) * v * Math.tan((cut.angle * Math.PI) / 180) * (cut.tiltSign ?? 1)
          : 0;
      const start = (v) => -L / 2 + shift(b.cutStart, v, true),
        end = (v) => L / 2 + shift(b.cutEnd, v, false);
      for (const o of replaced) {
        if (
          dot(o.crossAxis, n) < 1 - 1e-7 ||
          Math.min(b.start[0] + 0.02, o.end[0]) - Math.max(b.start[0] - 0.02, o.start[0]) < 1e-6
        )
          continue;
        const center = o.start.map((v, k) => (v + o.end[k]) / 2),
          s = dot(sub(center, mid), d),
          a = s - 0.075,
          z = s + 0.075;
        const floor = dot(sub(center, mid), n) - 0.02;
        if (z <= Math.min(start(h / 2), start(floor)) + 1e-7 || a >= Math.max(end(h / 2), end(floor)) - 1e-7)
          continue;
        if (Math.abs(floor - (h / 2 - depth)) > 1e-6)
          throw Error("Outlooker not flush with source rafter top.");
        const openStart = a < start(h / 2);
        if ((openStart && a > start(floor) + 1e-7) || z >= end(h / 2))
          throw Error("Unsupported clipped end slot.");
        slots.push({ a, z, floor, outlooker: o.id, openStart });
        contacts.push({
          rafter: b.id,
          outlooker: o.id,
          x: b.start[0],
          station: s + L / 2,
          length: 0.15,
          depth,
          openStart,
        });
      }
      if (!slots.length) return b;
      slots.sort((a, b) => a.a - b.a);
      for (let i = 1; i < slots.length; i++)
        if (slots[i].a <= slots[i - 1].z) throw Error("Overlapping source slots.");
      if ([b.cutStart, b.cutEnd].some((c) => c?.scheme === "miter" && c.plane === "width"))
        throw Error("Unexpected side mitre on source rafter.");
      const points = [
        [start(-h / 2), -h / 2],
        [end(-h / 2), -h / 2],
        [end(h / 2), h / 2],
      ];
      let open = false;
      for (const slot of [...slots].reverse()) {
        points.push([slot.z, h / 2], [slot.z, slot.floor]);
        if (slot.openStart) {
          points.push([start(slot.floor), slot.floor]);
          open = true;
          break;
        }
        points.push([slot.a, slot.floor], [slot.a, h / 2]);
      }
      if (!open) points.push([start(h / 2), h / 2]);
      slotsByRafter.set(b.id, slots);
      const blankLength = L + 0.2 * Math.tan((20 * Math.PI) / 180);
      return {
        ...b,
        blankLength,
        cutStart: { scheme: "butt", angle: 0 },
        cutEnd: { scheme: "butt", angle: 0 },
        shape: { type: "rafterSeats", points },
        note: "Отвесные торцы и верхние пазы150×40мм под В-075; у трёх Б-27 паз открыт в торец. Исходная заготовка сохранена. Прочность ослабленного сечения и крепёж не рассчитаны.",
      };
    });
  source.members = [...changed, ...replaced];
  source.source.note +=
    " Фронтонные свесы уточнены по листам45/46: В-075 плашмя, врезаны на40мм в крайние стропила; расстановка из векторного плана.";
  source.assumptions.push(
    "В-075 восстановлены как30досок40×150×1840мм плашмя по плоскости ската:14слева и16справа, включая2на северной террасе. Верхние пазы150×40мм сформированы реальными профилями крайних стропил. Геометрия, нетто-масса и раскрой учтены; прочность ослабленных сечений и рабочий крепёж не подтверждены.",
  );
  return { project: p, contacts, slotsByRafter: Object.fromEntries(slotsByRafter), outlookers: replaced };
}

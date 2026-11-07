// Display bands only: 2.5 mm is the review's requested optical seam width, not
// an installed sheet gap. The 0.15 mm surface offset prevents z-fighting and is
// not added to physical geometry, loads, cutting or procurement.
export function sheetSeamVertices(panels, segments, width = 0.0025) {
  const frames = new Map(),
    positions = [],
    lines = [];
  const minus = (a, b) => a.map((v, i) => v - b[i]),
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    unit = (v) => v.map((q) => q / Math.hypot(...v));
  for (const panel of panels) {
    const polygon = panel.polygon ?? panel.polygonXYZ;
    if (!polygon || polygon.length < 3) continue;
    frames.set(panel.stockSheetId ?? panel.id, {
      normal: unit(cross(minus(polygon[1], polygon[0]), minus(polygon[2], polygon[0]))),
      offset: panel.thickness / 2000 + 0.00015,
    });
  }
  for (const edge of segments) {
    const frame = frames.get(edge.stockSheetId);
    if (!frame) continue;
    const tangent = unit(minus(edge.b, edge.a)),
      across = unit(cross(frame.normal, tangent));
    for (const sign of [-1, 1]) {
      const a = edge.a.map((v, i) => v + frame.normal[i] * frame.offset * sign),
        b = edge.b.map((v, i) => v + frame.normal[i] * frame.offset * sign),
        corner = (q, side) => q.map((v, i) => v + (across[i] * width * side) / 2);
      const quad = [corner(a, -1), corner(b, -1), corner(b, 1), corner(a, 1)];
      for (const i of [0, 1, 2, 0, 2, 3]) positions.push(...quad[i]);
      // A one-pixel opaque line keeps subpixel metric bands legible at 5–8 m.
      lines.push(...a, ...b);
    }
  }
  return { positions, lines };
}

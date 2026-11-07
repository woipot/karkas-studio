import * as THREE from "three";

// Diagram geometry: routes are read directly from the drainage calculation.
export function addDrainageToScene(scene, roofModel, offsetX, offsetZ) {
  const model = roofModel?.drainage;
  if (!model) return;
  const point = (p) => new THREE.Vector3(p[0] - offsetX, p[1] + 0.045, p[2] - offsetZ);
  const pipeMaterial = new THREE.MeshStandardMaterial({ color: "#547f8b", metalness: 0.45, roughness: 0.45 });
  const flashingMaterial = new THREE.MeshStandardMaterial({
    color: "#839ca4",
    metalness: 0.5,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const badMaterial = new THREE.MeshStandardMaterial({ color: "#bb694d", roughness: 0.5 });
  function route(path, radius, material) {
    if (!Array.isArray(path) || path.length < 2) return;
    for (let i = 1; i < path.length; i++) {
      if (
        ![path[i - 1], path[i]].every((q) => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite))
      )
        continue;
      const a = point(path[i - 1]),
        b = point(path[i]),
        length = a.distanceTo(b);
      if (length < 0.001) continue;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      scene.add(mesh);
    }
  }
  for (const gutter of model.gutters ?? [])
    route(
      gutter.path ?? [gutter.start, gutter.end],
      0.065,
      gutter.status === "fail" ? badMaterial : pipeMaterial,
    );
  for (const pipe of model.downpipes ?? []) route(pipe.path ?? [pipe.start, pipe.end], 0.045, pipeMaterial);
  for (const edge of model.junctions ?? []) {
    if (edge.type !== "wall-abutment" || !edge.start || !edge.end) continue;
    const a = point(edge.start),
      b = point(edge.end),
      up = new THREE.Vector3(0, 0.22, 0),
      vertices = [];
    for (const q of [a, b, b.clone().add(up), a, b.clone().add(up), a.clone().add(up)])
      vertices.push(...q.toArray());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, edge.flowIntoWall ? badMaterial : flashingMaterial));
  }
  for (const arrow of model.arrows ?? []) {
    const path = arrow.path ?? [arrow.start, arrow.end];
    if (!path?.[0] || !path?.at(-1)) continue;
    const a = point(path[0]),
      b = point(path.at(-1)),
      delta = b.clone().sub(a),
      length = delta.length();
    if (length < 0.05) continue;
    const visibleLength = Math.min(length, 1.4),
      start = a.clone().addScaledVector(delta.clone().normalize(), Math.min(0.1, length * 0.1));
    scene.add(
      new THREE.ArrowHelper(
        delta.normalize(),
        start,
        visibleLength,
        arrow.resolved === false || arrow.status === "fail" ? "#bb6249" : "#287e9d",
        0.18,
        0.12,
      ),
    );
  }
}

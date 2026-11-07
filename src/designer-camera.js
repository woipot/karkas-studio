import * as THREE from "three";

/** Perspective fit in the camera's orthonormal basis. FOV, direction and the
 * 15% screen margin are viewing choices, not physical/engineering constants.
 * The enclosing sphere also guarantees an exterior camera for short/wide views.
 */
export function fitExteriorCamera(points, aspect, direction, fov = 35) {
  const bounds = new THREE.Box3().setFromPoints(points),
    target = bounds.getCenter(new THREE.Vector3()),
    radius = bounds.getSize(new THREE.Vector3()).length() / 2,
    forward = direction.clone().normalize(),
    right = new THREE.Vector3(0, 1, 0).cross(forward).normalize(),
    up = forward.clone().cross(right),
    tangent = Math.tan((fov * Math.PI) / 360),
    safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let distance = radius;
  for (const q of points) {
    const v = q.clone().sub(target);
    distance = Math.max(
      distance,
      v.dot(forward) +
        Math.max(Math.abs(v.dot(right)) / (tangent * safeAspect), Math.abs(v.dot(up)) / tangent),
    );
  }
  return { target, position: target.clone().addScaledVector(forward, distance * 1.15) };
}

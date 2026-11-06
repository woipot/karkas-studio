import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
export default function Model3D({ project: p, result: r, layers, section, selected, onSelect, resetKey }) {
  const host = useRef();
  const [failed, setFailed] = useState(false);
  const cameraState = useRef(null);
  useEffect(() => {
    let renderer, controls, raf, resize;
    const el = host.current;
    if (!el || !r.timber) return;
    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#edf0e9");
      scene.fog = new THREE.Fog("#edf0e9", 55, 140);
      const L = p.length,
        W = p.width,
        H = p.height,
        F = p.floors,
        base = 0.72,
        floorT = p.joistH / 1000 + 0.035,
        pitch = H + floorT,
        deckTop = base + floorT;
      const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.1, 220);
      const buildingTop = base + F * pitch + (W / 2) * Math.tan((p.roofPitch * Math.PI) / 180);
      const target = new THREE.Vector3(0, buildingTop * 0.48, 0),
        dir = new THREE.Vector3(1, 0.8, 1.1).normalize(),
        right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(),
        up = dir.clone().cross(right).normalize();
      const tanV = Math.tan((35 * Math.PI) / 360),
        tanH = tanV * camera.aspect;
      let distance = 0;
      for (const x of [-L / 2, L / 2])
        for (const y of [0, buildingTop])
          for (const z of [-W / 2, W / 2]) {
            const v = new THREE.Vector3(x, y, z).sub(target);
            distance = Math.max(
              distance,
              v.dot(dir) + Math.max(Math.abs(v.dot(right)) / tanH, Math.abs(v.dot(up)) / tanV),
            );
          }
      camera.position.copy(target).addScaledVector(dir, distance * 1.08);
      camera.lookAt(target);
      if (cameraState.current && resetKey === cameraState.current.key)
        camera.position.fromArray(cameraState.current.pos);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.4;
      el.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.copy(target);
      if (cameraState.current && resetKey === cameraState.current.key)
        controls.target.fromArray(cameraState.current.target);
      controls.minDistance = 4;
      controls.maxDistance = 130;
      controls.maxPolarAngle = Math.PI * 0.49;
      scene.add(new THREE.HemisphereLight("#ffffff", "#b1bfa4", 2.3));
      const light = new THREE.DirectionalLight("#fff5dc", 3);
      light.position.set(-7, 20, 9);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      Object.assign(light.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35 });
      light.shadow.bias = -0.0006;
      scene.add(light);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(250, 250),
        new THREE.MeshStandardMaterial({ color: "#e8ece3", roughness: 1 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.06;
      ground.receiveShadow = true;
      scene.add(ground);
      const grid = new THREE.GridHelper(160, 160, "#cbd2c4", "#dbe0d5");
      grid.position.y = -0.04;
      scene.add(grid);
      const objects = [];
      const unitGeometry = new THREE.BoxGeometry(1, 1, 1);
      const colors = { walls: "#bc975f", floor: "#bda577", roof: "#cdb17c", bracing: "#897c50" };
      for (const category of ["walls", "floor", "roof", "bracing"]) {
        const visible = {
          walls: layers.walls,
          floor: layers.floor,
          roof: layers.roof,
          bracing: layers.bracing,
        }[category];
        if (!visible) continue;
        const boards = r.timber.instances.filter((i) => i.category === category);
        if (!boards.length) continue;
        const mat = new THREE.MeshStandardMaterial({ color: colors[category], roughness: 0.8 });
        const mesh = new THREE.InstancedMesh(unitGeometry, mat, boards.length);
        const m4 = new THREE.Matrix4();
        const scale = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        boards.forEach((b, index) => {
          const a = new THREE.Vector3(...b.start),
            end = new THREE.Vector3(...b.end),
            dir = end.clone().sub(a).normalize();
          let cross = new THREE.Vector3(...(b.crossAxis || [1, 0, 0])).normalize();
          cross.addScaledVector(dir, -cross.dot(dir)).normalize();
          if (cross.length() < 0.5) cross = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
          const z = new THREE.Vector3().crossVectors(cross, dir).normalize();
          const rot = new THREE.Matrix4().makeBasis(cross, dir, z);
          quat.setFromRotationMatrix(rot);
          scale.set(b.b / 1000, b.length, b.h / 1000);
          const center = a.add(end).multiplyScalar(0.5);
          center.x -= L / 2;
          center.z -= W / 2;
          m4.compose(center, quat, scale);
          mesh.setMatrixAt(index, m4);
          mesh.setColorAt(
            index,
            new THREE.Color(selected?.type === "member" && selected.id === b.id ? "#dcff9c" : "#ffffff"),
          );
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { type: "boards", boards };
        objects.push(mesh);
        scene.add(mesh);
      }
      function box(x, y, z, b, h, d, mat, data) {
        const o = new THREE.Mesh(new THREE.BoxGeometry(b, h, d), mat);
        o.position.set(x, y, z);
        o.castShadow = true;
        o.receiveShadow = true;
        if (data) {
          o.userData = data;
          objects.push(o);
        }
        scene.add(o);
        return o;
      }
      const foundationMat = new THREE.MeshStandardMaterial({ color: "#586657", roughness: 0.85 });
      if (layers.piles) {
        for (const pile of r.piles) {
          const c = new THREE.Mesh(
            new THREE.CylinderGeometry(0.075, 0.075, base + 0.26, 10),
            section === "foundation"
              ? new THREE.MeshStandardMaterial({
                  color: pile.utilization > 1 ? "#c55d41" : pile.utilization > 0.75 ? "#c9a259" : "#78945f",
                  roughness: 0.8,
                })
              : foundationMat,
          );
          c.position.set(pile.x - L / 2, 0.24, pile.y - W / 2);
          c.castShadow = true;
          c.userData = { type: "pile", id: pile.id };
          objects.push(c);
          scene.add(c);
          box(pile.x - L / 2, base - 0.04, pile.y - W / 2, 0.21, 0.08, 0.21, foundationMat);
        }
      }
      if (layers.floor) {
        const deck = new THREE.MeshStandardMaterial({
          color: "#d3c6a2",
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        for (let f = 0; f < F; f++) {
          box(0, base + f * pitch + p.joistH / 1000 + 0.0175, 0, L, 0.035, W, deck);
          for (const z of [-W / 2, W / 2, ...(p.internalBearing ? [0] : [])])
            box(0, base - 0.12 + f * pitch, z, L, 0.2, 0.15, foundationMat);
        }
      }
      if (layers.openings && layers.walls) {
        const glass = new THREE.MeshPhysicalMaterial({
          color: "#79b6c0",
          transparent: true,
          opacity: 0.23,
          roughness: 0.2,
          metalness: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        for (const o of p.openings) {
          if (o.type !== "window") continue;
          const y = deckTop + ((o.floor ?? 1) - 1) * pitch + o.sill + o.height / 2,
            t = p.wallThickness;
          let x = 0,
            z = 0,
            b = o.width,
            d = 0.015;
          if (o.wall === "north") {
            x = o.offset + o.width / 2 - L / 2;
            z = -W / 2 + t / 2;
          }
          if (o.wall === "south") {
            x = o.offset + o.width / 2 - L / 2;
            z = W / 2 - t / 2;
          }
          if (o.wall === "west") {
            x = -L / 2 + t / 2;
            z = o.offset + o.width / 2 - W / 2;
            b = 0.015;
            d = o.width;
          }
          if (o.wall === "east") {
            x = L / 2 - t / 2;
            z = o.offset + o.width / 2 - W / 2;
            b = 0.015;
            d = o.width;
          }
          box(x, y, z, b, o.height, d, glass, { type: "opening", id: o.id });
        }
      }
      function dim(a, b, label) {
        const mat = new THREE.LineBasicMaterial({ color: "#7c8b70" });
        scene.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]),
            mat,
          ),
        );
        for (const c of [a, b])
          scene.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(c[0] - 0.1, c[1] - 0.1, c[2] - 0.1),
                new THREE.Vector3(c[0] + 0.1, c[1] + 0.1, c[2] + 0.1),
              ]),
              mat,
            ),
          );
        const can = document.createElement("canvas");
        can.width = 256;
        can.height = 64;
        const ctx = can.getContext("2d");
        ctx.fillStyle = "#edf0e9";
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = "#65765a";
        ctx.font = "500 30px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, 128, 43);
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(can), depthTest: false }),
        );
        sp.position.set((a[0] + b[0]) / 2, 0.12, (a[2] + b[2]) / 2);
        sp.scale.set(2.1, 0.525, 1);
        scene.add(sp);
      }
      if (layers.dimensions) {
        dim([-L / 2, 0.08, W / 2 + 1], [L / 2, 0.08, W / 2 + 1], `${L.toFixed(2)} м`);
        dim([L / 2 + 1, 0.08, -W / 2], [L / 2 + 1, 0.08, W / 2], `${W.toFixed(2)} м`);
      }
      let down = { x: 0, y: 0 };
      const pointerdown = (e) => (down = { x: e.clientX, y: e.clientY });
      const pointerup = (e) => {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect(),
          ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = ray.intersectObjects(objects)[0];
        if (hit) {
          if (hit.object.userData.type === "boards")
            onSelect({ type: "member", id: hit.object.userData.boards[hit.instanceId].id });
          else onSelect(hit.object.userData);
        }
      };
      renderer.domElement.addEventListener("pointerdown", pointerdown);
      renderer.domElement.addEventListener("pointerup", pointerup);
      resize = new ResizeObserver(() => {
        const w = el.clientWidth,
          h = el.clientHeight;
        if (w && h) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      });
      resize.observe(el);
      function animate() {
        raf = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();
      return () => {
        cameraState.current = {
          pos: camera.position.toArray(),
          target: controls.target.toArray(),
          key: resetKey,
        };
        cancelAnimationFrame(raf);
        resize.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          o.geometry?.dispose();
          if (o.material)
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              m.map?.dispose();
              m.dispose();
            }
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (e) {
      console.error("3D:", e);
      setFailed(true);
      renderer?.dispose();
      return () => {
        cancelAnimationFrame(raf);
        resize?.disconnect();
      };
    }
  }, [p, r, layers, section, selected, resetKey]);
  return (
    <div className="three-host" ref={host}>
      {failed && <div className="webgl-error">3D недоступно в этом браузере. Переключитесь на план.</div>}
    </div>
  );
}

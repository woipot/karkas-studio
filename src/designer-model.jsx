import { sheetBoundarySegments } from "./sheet-layout.js";
import { cutGeometry } from "./board-geometry.js";
import { addDrainageToScene } from "./roof-drainage-three.js";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
export default function DesignerModel({
  project: p,
  result: r,
  roofModel,
  selected,
  onSelect,
  layers,
  fitKey = 0,
  viewPreset = "structure",
}) {
  const host = useRef(),
    cameraMemory = useRef(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer, controls, raf, resize;
    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#edf1e7");
      const bounds = r.geometry.compositeBounds ?? r.geometry.bounds,
        bx = (bounds.minX + bounds.maxX) / 2 || 0,
        bz = (bounds.minY + bounds.maxY) / 2 || 0;
      const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.05, 300);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.4;
      el.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight("#ffffff", "#acb99c", 2.2));
      const sun = new THREE.DirectionalLight("#fff4dc", 3);
      sun.position.set(-8, 22, 12);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45 });
      sun.shadow.bias = -0.0006;
      scene.add(sun);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(250, 250),
        new THREE.MeshStandardMaterial({ color: "#e8eddf", roughness: 1 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.06;
      ground.receiveShadow = true;
      scene.add(ground);
      const grid = new THREE.GridHelper(160, 160, "#c5d0b8", "#d8e0ce");
      grid.position.y = -0.04;
      scene.add(grid);
      const materials = {
          foundation: new THREE.MeshStandardMaterial({ color: "#a98550", roughness: 0.85 }),
          walls: new THREE.MeshStandardMaterial({ color: "#c3a16b", roughness: 0.8 }),
          floor: new THREE.MeshStandardMaterial({ color: "#b4a079", roughness: 0.85 }),
          roof: new THREE.MeshStandardMaterial({ color: "#cbb17e", roughness: 0.8 }),
          bracing: new THREE.MeshStandardMaterial({ color: "#97834f", roughness: 0.8 }),
          objects: new THREE.MeshStandardMaterial({ color: "#a58a54", roughness: 0.8 }),
        },
        highlight = new THREE.MeshStandardMaterial({ color: "#c7e98a", roughness: 0.7 });
      const geometries = new Map(),
        clickable = [];
      let highest = 3;
      const points = [];
      const headItems = (r.partitionHeads?.items ?? []).filter((h) => Number.isFinite(h.topY));
      const frameZone = roofModel?.zones?.find((z) => z.tiedRafters),
        frameInspection = viewPreset === "roofFrame" && !!frameZone,
        frameRow = Math.floor((frameZone?.frameRows?.length ?? 1) / 2),
        floorInspection = viewPreset === "floorSupports",
        headInspection = viewPreset === "partitionHeads" && headItems.length > 0,
        edgeInspection = viewPreset === "roofEdge" && roofModel?.sourceMode,
        edgeX = Math.min(
          ...(roofModel?.instances ?? [])
            .filter((b) => b.role === "roofOutlooker")
            .map((b) => Math.min(b.start[0], b.end[0])),
        );
      const gableInspection = ["gableWest", "gableEast"].includes(viewPreset),
        gableId = viewPreset === "gableEast" ? "Ст-20" : "Ст-19",
        gableWall = p.walls.find((w) => w.id === (viewPreset === "gableEast" ? "Ст-01" : "Ст-03"));
      const cutaway = viewPreset === "secondLight",
        houseBounds = r.geometry.baseBounds ?? r.geometry.bounds,
        frontWalls = new Set(
          p.walls
            .filter(
              (w) =>
                w.kind === "exterior" &&
                ((Math.abs(w.a.y - houseBounds.minY) < 0.01 && Math.abs(w.b.y - houseBounds.minY) < 0.01) ||
                  (Math.abs(w.a.x - houseBounds.minX) < 0.01 && Math.abs(w.b.x - houseBounds.minX) < 0.01)),
            )
            .map((w) => w.id),
        );
      const cutawayMaterial = new THREE.MeshStandardMaterial({
          color: "#b9a68a",
          transparent: true,
          opacity: 0.055,
          depthWrite: false,
          roughness: 1,
        }),
        stairMaterial = new THREE.MeshStandardMaterial({ color: "#ba854c", roughness: 0.8 }),
        guardMaterial = new THREE.MeshStandardMaterial({ color: "#716b4a", roughness: 0.8 });
      const headTieMaterial = new THREE.MeshStandardMaterial({ color: "#789b9c", roughness: 0.85 });
      const wallSupportMaterial = new THREE.MeshStandardMaterial({ color: "#5f907b", roughness: 0.85 });
      for (const board of r.timber.instances) {
        if (
          gableInspection &&
          !(
            board.zoneId === "ORION-GABLE-" + gableId ||
            (board.category === "walls" && board.wallId === gableWall?.id && board.platePosition === "top") ||
            (board.category === "roof" &&
              board.role === "rafter" &&
              Math.abs(board.start[0] - (gableWall?.a.x ?? -99)) < 0.1)
          )
        )
          continue;
        if (
          edgeInspection &&
          !(
            board.category === "roof" &&
            ["rafter", "roofOutlooker"].includes(board.role) &&
            Math.max(board.start[0], board.end[0]) <= edgeX + 2
          )
        )
          continue;
        if (
          headInspection &&
          !(
            board.category === "walls" ||
            (board.category === "roof" && ["bottom", "bottomChord"].includes(board.role))
          )
        )
          continue;
        if (
          floorInspection &&
          !["floor", "foundation"].includes(board.category) &&
          !(board.category === "walls" && board.platePosition === "bottom")
        )
          continue;
        if (
          frameInspection &&
          !(board.tiedRafters && board.zoneId === frameZone.id && board.trussRow === frameRow)
        )
          continue;
        const ceiling = String(board.role ?? "").startsWith("ceiling"),
          stair = /^stair/.test(board.role ?? ""),
          guard = /^guard/.test(board.role ?? "") || !!board.guardId;
        if (
          layers[board.category] === false ||
          (board.annexId && layers.annexes === false) ||
          (stair && layers.stairs === false) ||
          (guard && layers.guards === false) ||
          (ceiling && layers.ceiling === false) ||
          (!ceiling &&
            layers.auxiliary === false &&
            /Batten$/.test(board.role ?? "") &&
            !board.structuralLookout)
        )
          continue;
        const a = new THREE.Vector3(...board.start),
          b = new THREE.Vector3(...board.end),
          dir = b.clone().sub(a).normalize();
        let x = new THREE.Vector3(...(board.crossAxis || [1, 0, 0]));
        x.addScaledVector(dir, -x.dot(dir)).normalize();
        if (x.length() < 0.1) x = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
        const z = new THREE.Vector3().crossVectors(x, dir).normalize(),
          basis = new THREE.Matrix4().makeBasis(x, dir, z);
        const key = JSON.stringify([
          board.b,
          board.h,
          board.length,
          board.cutStart,
          board.cutEnd,
          board.notches,
          board.shape,
        ]);
        if (!geometries.has(key)) geometries.set(key, cutGeometry(board));
        const active =
          (selected?.type === "member" && selected.id === board.id) ||
          (selected?.type === "wall" && selected.id === board.wallId) ||
          (selected?.type === "object" && selected.id === board.objectId);
        const faded =
          (headInspection &&
            board.category === "walls" &&
            p.walls.find((w) => w.id === board.wallId)?.kind === "exterior") ||
          (cutaway && !board.annexId && (frontWalls.has(board.wallId) || board.category === "roof"));
        const mesh = new THREE.Mesh(
          geometries.get(key),
          active
            ? highlight
            : gableInspection && board.role === "gableTopPlate"
              ? wallSupportMaterial
              : edgeInspection && board.role === "roofOutlooker"
                ? wallSupportMaterial
                : faded
                  ? cutawayMaterial
                  : stair
                    ? stairMaterial
                    : guard
                      ? guardMaterial
                      : headInspection && board.category === "roof"
                        ? headTieMaterial
                        : floorInspection &&
                            (board.wallSupportWallIds?.length || board.role === "wallTransferBlocking")
                          ? wallSupportMaterial
                          : materials[board.category] || materials.walls,
        );
        mesh.quaternion.setFromRotationMatrix(basis);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.position.x -= bx;
        mesh.position.z -= bz;
        mesh.castShadow = !faded;
        mesh.receiveShadow = true;
        mesh.userData = { type: "member", id: board.id };
        scene.add(mesh);
        clickable.push(mesh);
        highest = Math.max(highest, a.y, b.y);
        for (const pt of [a, b])
          points.push(
            new THREE.Vector3(
              pt.x - bx,
              headInspection ? Math.max(pt.y, Math.min(...headItems.map((h) => h.topY)) - 0.4) : pt.y,
              pt.z - bz,
            ),
          );
      }
      if (layers.sheathing && (r.sheetModel?.panels || r.bracingModel?.panels)) {
        let index = 0;
        const groupColors = new Map();
        const visiblePanels = (r.sheetModel?.panels ?? r.bracingModel.panels).filter((panel) => {
          const kind = panel.surfaceKind ?? "walls";
          return layers[kind === "floors" ? "floor" : kind] !== false;
        });
        for (const panel of visiblePanels) {
          const polygon = panel.polygon ?? panel.polygonXYZ ?? [];
          if (polygon.length < 3) continue;
          const verts = [];
          const a = new THREE.Vector3(...polygon[0]);
          const normal = new THREE.Vector3(...polygon[1])
            .sub(a)
            .cross(new THREE.Vector3(...polygon[2]).sub(a))
            .normalize();
          const half = panel.thickness / 2000;
          const put = (q, sign) =>
            verts.push(
              q[0] - bx + normal.x * half * sign,
              q[1] + normal.y * half * sign,
              q[2] - bz + normal.z * half * sign,
            );
          for (let j = 2; j < polygon.length; j++) {
            for (const q of [polygon[0], polygon[j - 1], polygon[j]]) put(q, 1);
            for (const q of [polygon[0], polygon[j], polygon[j - 1]]) put(q, -1);
          }
          for (let j = 0; j < polygon.length; j++) {
            const q = polygon[j],
              z = polygon[(j + 1) % polygon.length];
            put(q, 1);
            put(q, -1);
            put(z, -1);
            put(q, 1);
            put(z, -1);
            put(z, 1);
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
          geometry.computeVertexNormals();
          const sheetId = panel.stockSheetId ?? panel.id;
          if (!groupColors.has(sheetId)) groupColors.set(sheetId, index++);
          const material = new THREE.MeshStandardMaterial({
            color: groupColors.get(sheetId) % 2 ? "#b8ab89" : "#c7b995",
            transparent: true,
            opacity: 0.6,
            roughness: 1,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
        }
        const boundaryPoints = sheetBoundarySegments(visiblePanels)
          .flatMap((edge) => [edge.a, edge.b])
          .map((q) => new THREE.Vector3(q[0] - bx, q[1], q[2] - bz));
        const outlines = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(boundaryPoints),
          new THREE.LineBasicMaterial({ color: "#65573e", transparent: true, opacity: 0.65 }),
        );
        scene.add(outlines);
      }
      if (layers.piles !== false) {
        const mat = new THREE.MeshStandardMaterial({ color: "#607255", roughness: 0.8 });
        for (const pile of r.piles || []) {
          if (pile.annexId && layers.annexes === false) continue;
          const capTop = pile.capTopY ?? pile.headY ?? r.grillageModel?.pileHeadY ?? 0.72,
            capThickness = 0.018,
            pileBottom = -0.12,
            pileTop = capTop - capThickness;
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.075, 0.075, pileTop - pileBottom, 10),
            mat,
          );
          mesh.position.set(pile.x - bx, (pileTop + pileBottom) / 2, pile.y - bz);
          const capSize = (pile.capSize ?? p.foundation.grillage?.capSize ?? 250) / 1000,
            cap = new THREE.Mesh(new THREE.BoxGeometry(capSize, capThickness, capSize), mat);
          cap.position.set(pile.x - bx, capTop - capThickness / 2, pile.y - bz);
          cap.castShadow = true;
          cap.receiveShadow = true;
          scene.add(cap);
          mesh.castShadow = true;
          mesh.userData = { type: "pile", id: pile.id };
          points.push(new THREE.Vector3(pile.x - bx, -0.12, pile.y - bz));
          scene.add(mesh);
          clickable.push(mesh);
        }
      }
      if (layers.glass !== false && layers.walls !== false) {
        const glass = new THREE.MeshPhysicalMaterial({
          color: "#88c6cd",
          transparent: true,
          opacity: 0.2,
          roughness: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        for (const o of p.openings.filter((o) => o.type === "window")) {
          const w = p.walls.find((w) => w.id === o.wallId),
            L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y),
            u = new THREE.Vector3((w.b.x - w.a.x) / L, 0, (w.b.y - w.a.y) / L);
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), glass);
          const at = o.offset + o.width / 2;
          mesh.position.set(
            w.a.x + u.x * at - bx,
            (r.geometry.levels?.find((l) => l.index === (o.floor ?? w.level ?? 1))?.wallBaseY ??
              0.72 + r.timber.platformHeight) +
              o.sill +
              o.height / 2,
            w.a.y + u.z * at - bz,
          );
          mesh.rotation.y = -Math.atan2(u.z, u.x);
          mesh.userData = { type: "opening", id: o.id };
          scene.add(mesh);
          clickable.push(mesh);
        }
      }
      if (layers.floor !== false && r.geometry.closed) {
        const deckMaterial = new THREE.MeshStandardMaterial({
          color: "#d9c9a8",
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        for (const level of r.geometry.levels || [
          { closed: true, polygon: r.geometry.polygon, wallBaseY: 0.72 + r.timber.platformHeight, index: 1 },
        ]) {
          if (!level.closed || p.sheathing?.floors) continue;
          const shape = new THREE.Shape(
            (level.platformPolygon ?? level.polygon).map((pt) => new THREE.Vector2(pt.x - bx, -pt.y + bz)),
          );
          for (const hole of p.voids.filter((v) => v.level === level.index)) {
            const path = new THREE.Path(hole.polygon.map((pt) => new THREE.Vector2(pt.x - bx, -pt.y + bz)));
            shape.holes.push(path);
          }
          const deck = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false }),
            deckMaterial,
          );
          deck.rotation.x = -Math.PI / 2;
          deck.position.y = (level.wallBaseY ?? level.elevation) - 0.035;
          scene.add(deck);
        }
      }
      if (layers.roof !== false && layers.surfaces && roofModel) {
        for (const face of roofModel.surfaces) {
          const vertices = [];
          const origin = face.points[0];
          for (let i = 2; i < face.points.length; i++)
            for (const pt of [origin, face.points[i - 1], face.points[i]]) {
              vertices.push(pt[0] - bx, pt[1] + 0.012, pt[2] - bz);
              points.push(new THREE.Vector3(pt[0] - bx, pt[1], pt[2] - bz));
              highest = Math.max(highest, pt[1]);
            }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
          geo.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({
            color: face.kind?.includes("hip") ? "#b6cba1" : "#c4d2af",
            transparent: true,
            opacity: cutaway ? 0.045 : 0.22,
            side: THREE.DoubleSide,
            depthWrite: false,
            roughness: 0.8,
          });
          const surface = new THREE.Mesh(geo, mat);
          scene.add(surface);
        }
      }

      const actualSurface = (points, color, opacity = 0.2) => {
        if (!Array.isArray(points) || points.length < 3) return;
        const vertices = [];
        for (let i = 2; i < points.length; i++)
          for (const pt of [points[0], points[i - 1], points[i]])
            vertices.push(pt[0] - bx, pt[1], pt[2] - bz);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            roughness: 0.25,
          }),
        );
        scene.add(mesh);
        for (const pt of points) pointsForFit(pt);
      };
      const pointsForFit = (pt) => {
        points.push(new THREE.Vector3(pt[0] - bx, pt[1], pt[2] - bz));
        highest = Math.max(highest, pt[1]);
      };
      if (layers.annexes !== false)
        for (const annex of r.annexes?.items ?? []) {
          if (layers.floor !== false && annex.polygon?.length > 2 && Number.isFinite(annex.deckTopY))
            actualSurface(
              annex.polygon.map((q) => [q.x, annex.deckTopY, q.y]),
              "#c6b68f",
              0.2,
            );
          if (layers.roof !== false && layers.surfaces)
            for (const face of annex.roof?.surfaces ?? []) actualSurface(face.points, "#a4bc96", 0.3);
          if (layers.glass !== false)
            for (const glass of annex.glazing ?? [])
              actualSurface(glass.polygon ?? glass.points, "#87bdca", 0.22);
        }
      if (layers.space && cutaway)
        for (const space of r.spatialLayout?.doubleHeightSpaces ?? []) {
          const poly = space.polygon ?? [],
            bottom = space.baseY,
            top = space.topY;
          if (poly.length > 2 && Number.isFinite(bottom) && Number.isFinite(top)) {
            for (let i = 0; i < poly.length; i++) {
              const a = poly[i],
                b = poly[(i + 1) % poly.length],
                geo = new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(a.x - bx, bottom, a.y - bz),
                  new THREE.Vector3(a.x - bx, top, a.y - bz),
                  new THREE.Vector3(b.x - bx, top, b.y - bz),
                ]);
              scene.add(
                new THREE.Line(
                  geo,
                  new THREE.LineBasicMaterial({ color: "#c39457", transparent: true, opacity: 0.32 }),
                ),
              );
            }
          }
        }
      if (layers.roof !== false && layers.drainage !== false) addDrainageToScene(scene, roofModel, bx, bz);
      const focus = (p.voids ?? []).find((v) => v.kind === "doubleHeight"),
        focusPolygon = focus?.polygon ?? [],
        lowLevel = r.geometry.levels?.find((l) => l.index === (focus?.level ?? 2) - 1),
        highLevel = r.geometry.levels?.find((l) => l.index === (focus?.level ?? 2));
      const target =
          (frameInspection || floorInspection || headInspection || edgeInspection || gableInspection) &&
          points.length
            ? new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3())
            : cutaway && focusPolygon.length
              ? new THREE.Vector3(
                  focusPolygon.reduce((a, v) => a + v.x, 0) / focusPolygon.length - bx,
                  ((lowLevel?.wallBaseY ?? 1) + (highLevel?.topY ?? highest)) / 2,
                  focusPolygon.reduce((a, v) => a + v.y, 0) / focusPolygon.length - bz,
                )
              : new THREE.Vector3(0, highest * 0.48, 0),
        direction = new THREE.Vector3(
          ...(frameInspection
            ? [
                Math.cos((frameZone.ridgeAngle * Math.PI) / 180) -
                  (frameZone.collarConnection === "faceLap" ? 0.25 : 0) *
                    Math.sin((frameZone.ridgeAngle * Math.PI) / 180),
                0.18,
                Math.sin((frameZone.ridgeAngle * Math.PI) / 180) +
                  (frameZone.collarConnection === "faceLap" ? 0.25 : 0) *
                    Math.cos((frameZone.ridgeAngle * Math.PI) / 180),
              ]
            : gableInspection
              ? [viewPreset === "gableEast" ? 2 : -2, 0.45, 0.4]
              : edgeInspection
                ? [1, 0.55, 1.25]
                : headInspection
                  ? [0.6, 0.6, 1]
                  : floorInspection
                    ? [0.55, 1.5, 0.9]
                    : cutaway
                      ? [-0.8, 0.65, -1.2]
                      : [1, 0.8, 1.05]),
        ).normalize(),
        right = new THREE.Vector3(0, 1, 0).cross(direction).normalize(),
        up = direction.clone().cross(right),
        tanV = Math.tan((35 * Math.PI) / 360);
      let d =
        frameInspection || floorInspection || headInspection || edgeInspection || gableInspection ? 0.5 : 10;
      for (const q of points) {
        const v = q.clone().sub(target);
        d = Math.max(
          d,
          v.dot(direction) +
            Math.max(Math.abs(v.dot(right)) / (tanV * camera.aspect), Math.abs(v.dot(up)) / tanV),
        );
      }
      camera.position.copy(target).addScaledVector(direction, d * 1.1);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(target);
      controls.enableDamping = true;
      controls.minDistance = 3;
      controls.maxDistance = 130;
      controls.maxPolarAngle = Math.PI * 0.49;
      if (cameraMemory.current?.fitKey === fitKey && cameraMemory.current?.viewPreset === viewPreset) {
        camera.position.fromArray(cameraMemory.current.position);
        controls.target.fromArray(cameraMemory.current.target);
      }
      let down;
      renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
      renderer.domElement.addEventListener("pointerup", (e) => {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect(),
          ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            1 - ((e.clientY - rect.top) / rect.height) * 2,
          ),
          camera,
        );
        const hit = ray.intersectObjects(clickable)[0];
        if (hit) onSelect(hit.object.userData);
      });
      resize = new ResizeObserver(() => {
        if (el.clientWidth && el.clientHeight) {
          camera.aspect = el.clientWidth / el.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(el.clientWidth, el.clientHeight);
        }
      });
      resize.observe(el);
      function frame() {
        raf = requestAnimationFrame(frame);
        controls.update();
        renderer.render(scene, camera);
      }
      frame();
      return () => {
        cameraMemory.current = {
          fitKey,
          viewPreset,
          position: camera.position.toArray(),
          target: controls.target.toArray(),
        };
        cancelAnimationFrame(raf);
        resize.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          o.geometry?.dispose();
          if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (err) {
      console.error(err);
      setError(true);
      renderer?.dispose();
      return () => {
        cancelAnimationFrame(raf);
        resize?.disconnect();
      };
    }
  }, [p, r, roofModel, selected, layers, fitKey, viewPreset]);
  return (
    <div className="three-host" ref={host}>
      {error && <div className="webgl-error">Не удалось включить 3D. План и расчёты доступны.</div>}
    </div>
  );
}

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  type CatalogItem,
  type IsoDocument,
  type Vec3,
  getNode,
  getSpec,
  sub,
  mul,
  add,
  runResult,
  takeout,
  connected,
} from "../core/model";
import { valveOperatorOf } from "../core/iso/valve-conventions";
import { flangedJoints, nodeCode, nodeItem } from "../core/joints";
import { flange as standardFlange } from "../core/standards";
import { COMPONENT_TYPE_BY_CODE } from "../core/components";

/** Physical pipe and fitting envelopes for spatial review; dimensions remain governed by the piping model. */
export function mountPreview3d(container: HTMLElement, doc: IsoDocument, spool = ""): () => void {
  // three.js draws with WebGL 2; a browser or machine without it (acceleration off, some virtual machines) gets the
  // canvas review instead (preview-canvas.ts).
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) throw Object.assign(new Error("WebGL 2 is not available in this browser."), { name: "WebGLUnavailable" });
  probe.getExtension("WEBGL_lose_context")?.loseContext();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setClearColor(0xf2f5f8);
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x566472, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(1000, 2000, 1000);
  scene.add(sun);
  const group = new THREE.Group();
  scene.add(group);
  const metal = new THREE.MeshStandardMaterial({
    color: 0x778b9c,
    metalness: 0.55,
    roughness: 0.38,
    side: THREE.DoubleSide,
  });
  const fittingMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8c9d5,
    metalness: 0.6,
    roughness: 0.32,
    side: THREE.DoubleSide,
  });
  const warning = new THREE.MeshStandardMaterial({
    color: 0xf4aa45,
    roughness: 0.6,
  });
  const gasketMaterial = new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.8 });
  // What the line bolts to beyond the drawing (equipment, an existing flange): shown faint, it is not this spool's.
  const existingMaterial = new THREE.MeshStandardMaterial({ color: 0xc9d2d9, roughness: 0.7, transparent: true, opacity: 0.55 });
  const vector = (p: Vec3) => new THREE.Vector3(p[0], p[2], -p[1]);
  const mesh = (geometry: THREE.BufferGeometry, at: THREE.Vector3, material = fittingMaterial) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.copy(at);
    group.add(m);
    return m;
  };
  const cylinder = (a: THREE.Vector3, b: THREE.Vector3, r1: number, r2 = r1, material = fittingMaterial) => {
    const axis = b.clone().sub(a),
      length = axis.length();
    if (length < 0.001) return;
    const m = mesh(
      new THREE.CylinderGeometry(r2, r1, length, 24, 1, true),
      a.clone().add(b).multiplyScalar(0.5),
      material,
    );
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    return m;
  };
  /** A solid (capped) cylinder or cone from `a` to `b`: a fitting's body, a flange plate or hub, a gasket. */
  const solid = (a: THREE.Vector3, b: THREE.Vector3, r1: number, r2 = r1, material = fittingMaterial) => {
    const axis = b.clone().sub(a), length = axis.length();
    if (length < 0.001) return;
    const m = mesh(new THREE.CylinderGeometry(r2, r1, length, 32, 1, false), a.clone().add(b).multiplyScalar(0.5), material);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  };
  /**
   * A flange whose face is at `face`, its hub running back along `axis` (unit, away from the gasket) toward the pipe it
   * is welded to: the plate (its outside diameter and thickness), a raised face where it has one, and a weld-neck's
   * tapered hub or a slip-on's or socket's collar, down to the pipe.
   */
  const flange = (face: THREE.Vector3, axis: THREE.Vector3, code: string, row: CatalogItem | undefined, pipeR: number, nps?: number, rating?: string | number) => {
    const { od, t } = flangeSize(row, pipeR, nps, rating), item = row as (CatalogItem & { lengthThroughHub?: number }) | undefined, blind = /BL$|BLND/.test(code);
    const std = nps ? standardFlange(nps, rating ?? row?.rating) : undefined;
    const raised = /RF/.test(code) ? 1.6 : 0;
    if (raised) solid(face, face.clone().addScaledVector(axis, raised), Math.min(od / 2 * 0.62, pipeR * 1.7));
    const back = face.clone().addScaledVector(axis, raised), plate = back.clone().addScaledVector(axis, t);
    solid(back, plate, od / 2);
    if (blind) return;
    const weldNeck = /WN|MSS/.test(code);
    const hub = weldNeck ? Math.max(t * 1.2, (item?.lengthThroughHub ?? std?.wnLength ?? item?.takeout ?? t * 2.5) - t - raised)
      : Math.max(t * 0.45, (item?.lengthThroughHub ?? std?.soLength ?? t * 1.4) - t - raised);
    solid(plate, plate.clone().addScaledVector(axis, hub), Math.min(od / 2 * 0.8, pipeR * (weldNeck ? 1.45 : 1.3)), pipeR * (weldNeck ? 1.02 : 1.3));
  };
  /** A flange's outside diameter and thickness: its row's, else ASME B16.5's for its size and class, else in proportion. */
  function flangeSize(row: CatalogItem | undefined, pipeR: number, nps?: number, rating?: string | number) {
    const own = row as (CatalogItem & { flangeOd?: number }) | undefined, std = nps ? standardFlange(nps, rating ?? row?.rating) : undefined;
    return { od: own?.flangeOd ?? std?.od ?? pipeR * 4, t: row?.flangeThickness ?? std?.thickness ?? Math.max(10, pipeR * 0.45) };
  }
  /** A gasket between two faces, and the studs through both flanges of a bolted joint. */
  const gasket = (centre: THREE.Vector3, axis: THREE.Vector3, thickness: number, r: number) =>
    solid(centre.clone().addScaledVector(axis, -thickness / 2), centre.clone().addScaledVector(axis, thickness / 2), r, r, gasketMaterial);
  const runs = doc.runs.filter((r) => !spool || r.spool === spool);
  for (const r of runs.filter((r) => !r.connector)) {
    const a = getNode(doc, r.from),
      b = getNode(doc, r.to),
      result = runResult(doc, r),
      span = sub(b.position, a.position),
      norm = Math.hypot(...span);
    const size = getSpec(doc, r.specId).sizes.find((s) => s.nps === r.nps);
    if (!size || !norm || !Number.isFinite(result.cut) || result.cut <= 0) continue;
    const start = vector(add(a.position, mul(span, (result.takeouts[0] + result.gaps[0]) / norm))),
      end = vector(add(b.position, mul(span, -(result.takeouts[1] + result.gaps[1]) / norm)));
    cylinder(start, end, size.od / 2, size.od / 2, metal);
    cylinder(start, end, size.od / 2 - size.wall, size.od / 2 - size.wall, metal);
    for (const point of [start, end]) {
      const ring = mesh(new THREE.RingGeometry(size.od / 2 - size.wall, size.od / 2, 24), point, metal);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), end.clone().sub(start).normalize());
    }
  }
  // Bolted joints: each flange the joint has, back to back across its gasket, hubs running to their pipes.
  const jointNodes = new Set<string>();
  const joints = flangedJoints(doc).filter((j) => j.runIds.some((id) => runs.some((r) => r.id === id)));
  const pipeRadius = (r: (typeof runs)[number]) => (getSpec(doc, r.specId).sizes.find((s) => s.nps === r.nps)?.od ?? r.nps * 25.4 + 10) / 2;
  for (const j of joints) {
    const centre = vector(j.position), g = j.gasket?.thickness ?? 3;
    const sides = j.runIds.map((id) => runs.find((r) => r.id === id)).filter((r): r is (typeof runs)[number] => !!r);
    let gasketR = 0, gasketAxis: THREE.Vector3 | undefined;
    sides.forEach((r, i) => {
      const far = getNode(doc, r.from === j.nodeId ? r.to : r.from).position, axis = vector(far).sub(centre).normalize();
      if (!Number.isFinite(axis.x)) return;
      const f = j.flanges[i] ?? j.flanges[0];
      if (!f) return;
      gasketAxis ??= axis;
      const pipeR = pipeRadius(r), size = flangeSize(f.item, pipeR, j.nps, j.rating);
      flange(centre.clone().addScaledVector(axis, g / 2), axis, f.code, f.item, pipeR, j.nps, j.rating);
      gasketR = Math.max(gasketR, Math.min(size.od / 2 * 0.62, pipeR * 1.7));
      // Equipment, or an existing flange beyond the drawing: its plate across the gasket.
      if (j.kind === "equipment") solid(centre.clone().addScaledVector(axis, -g / 2), centre.clone().addScaledVector(axis, -g / 2 - size.t), size.od / 2, undefined, existingMaterial);
    });
    if (j.gasket && gasketR && gasketAxis) gasket(centre, gasketAxis, g, gasketR);
    if (getNode(doc, j.nodeId).kind === "flange") jointNodes.add(j.nodeId);
  }
  for (const n of doc.nodes.filter((n) => n.kind !== "end" && n.kind !== "weld" && !jointNodes.has(n.id))) {
    const edges = connected(doc, n.id).filter((r) => runs.includes(r)),
      host = edges[0] ?? runs.find((r) => r.id === n.associatedRunId);
    if (!host) continue;
    const size = getSpec(doc, host.specId).sizes.find((s) => s.nps === host.nps),
      radius = (size?.od ?? 50) / 2,
      center = vector(n.position);
    const ports = edges.map((r) => {
      const other = getNode(doc, r.from === n.id ? r.to : r.from),
        delta = sub(other.position, n.position),
        distance = Math.hypot(...delta),
        t = takeout(doc, n, r.id);
      return {
        r,
        t,
        point: vector(add(n.position, mul(delta, (t ?? radius) / (distance || 1)))),
        radius: (getSpec(doc, r.specId).sizes.find((s) => s.nps === r.nps)?.od ?? radius * 2) / 2,
      };
    });
    if (ports.some((p) => p.t == null)) {
      mesh(new THREE.SphereGeometry(radius * 1.2, 20, 12), center, warning);
      continue;
    }
    if (n.kind === "elbow90" || n.kind === "elbow45") {
      if (ports.length !== 2) continue;
      const a = ports[0].point,
        b = ports[1].point,
        ua = a.clone().sub(center).normalize(),
        ub = b.clone().sub(center).normalize();
      const included = Math.acos(THREE.MathUtils.clamp(ua.dot(ub), -1, 1)),
        bend = Math.PI - included,
        t = Math.min(ports[0].t!, ports[1].t!);
      if (bend > 0.001 && bend < Math.PI - 0.001 && Math.abs(ports[0].t! - ports[1].t!) < 0.1) {
        const radial = t / Math.tan(bend / 2),
          normal = new THREE.Vector3().crossVectors(ua, ub).normalize();
        const arcCenter = a.clone().add(new THREE.Vector3().crossVectors(normal, ua).multiplyScalar(radial));
        const start = a.clone().sub(arcCenter),
          finish = b.clone().sub(arcCenter),
          axis = new THREE.Vector3().crossVectors(start, finish).normalize();
        const angle = Math.acos(
          THREE.MathUtils.clamp(start.clone().normalize().dot(finish.clone().normalize()), -1, 1),
        );
        class Arc extends THREE.Curve<THREE.Vector3> {
          constructor() {
            super();
          }
          getPoint(fraction: number) {
            return start
              .clone()
              .applyAxisAngle(axis, angle * fraction)
              .add(arcCenter);
          }
        }
        mesh(new THREE.TubeGeometry(new Arc(), 32, radius, 24, false), new THREE.Vector3());
      } else
        mesh(
          new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, center, b), 32, radius, 24, false),
          new THREE.Vector3(),
        );
    } else if (n.kind === "tee" || n.kind === "olet") {
      for (const port of ports) cylinder(center, port.point, port.radius);
    } else if (n.kind === "reducer" && ports.length === 2) {
      cylinder(ports[0].point, ports[1].point, ports[0].radius, ports[1].radius);
    } else if (n.kind === "valve" && ports.length === 2) {
      const code = nodeCode(doc, n) ?? "", type = COMPONENT_TYPE_BY_CODE[code], item = nodeItem(doc, n);
      const axis = ports[1].point.clone().sub(ports[0].point).normalize();
      // Couplings and unions are sleeves the pipe screws or sockets into; they have no operator.
      if (/CPLG|UNION|NIPPLE|ADPT/.test(code)) {
        const into = item?.threadEngagement ?? item?.socketDepth ?? radius * 0.6;
        const reach = Math.max(...ports.map((p) => (p.t ?? 0) + into));
        solid(center.clone().addScaledVector(axis, -reach), center.clone().addScaledVector(axis, reach), radius * 1.22);
        if (/UNION/.test(code)) solid(center.clone().addScaledVector(axis, -radius * 0.45), center.clone().addScaledVector(axis, radius * 0.45), radius * 1.55);
        continue;
      }
      if (type?.endPrep === "FL") {
        // A flanged body: its own flanges at its faces, the gasket and mating flange beyond each (drawn with the joint).
        const g = joints.find((j) => j.nodeId === n.id)?.gasket?.thickness ?? 3;
        const ftf = item?.faceToFace;
        const faces = ports.map((p) => {
          const joint = joints.find((j) => j.nodeId === n.id && j.runIds.includes(p.r.id));
          const out = p.point.clone().sub(center).normalize();
          return joint ? vector(joint.position).addScaledVector(out, -g / 2) : center.clone().addScaledVector(out, ftf ? ftf / 2 : (p.t ?? radius));
        });
        const disc = type.symbol === "butterfly", od = flangeSize(item, radius, host.nps, item?.rating).od;
        if (disc) solid(faces[0], faces[1], od / 2 * 0.86);
        else {
          solid(faces[0], faces[1], radius * 1.35);
          for (const face of faces) {
            const inward = center.clone().sub(face).normalize(), t = Math.max(8, radius * 0.4);
            solid(face, face.clone().addScaledVector(inward, t), od / 2);
          }
        }
      } else cylinder(ports[0].point, ports[1].point, radius * 1.3);
      const up = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const stem = up.addScaledVector(axis, -up.dot(axis)).normalize(),
        tip = center.clone().addScaledVector(stem, radius * 4.5);
      // The operator the sheet draws (its own, its specification row's, else its type's).
      const operator = valveOperatorOf(doc, n);
      if (operator !== "none") cylinder(center, tip, radius * 0.12);
      if (operator === "handwheel") {
        const wheel = mesh(new THREE.TorusGeometry(radius * 1.6, radius * 0.15, 8, 28), tip);
        wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), stem);
      } else if (operator === "lever") cylinder(tip, tip.clone().addScaledVector(axis, radius * 3.5), radius * 0.15);
      else if (operator === "actuator" || operator === "box") {
        const body = mesh(operator === "box" ? new THREE.BoxGeometry(radius * 2.4, radius * 1.6, radius * 2.4) : new THREE.CylinderGeometry(radius * 1.4, radius * 1.4, radius * 1.6, 24), tip);
        body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), stem);
      }
    } else if (n.kind === "flange" && ports[0]) {
      // A flange in no bolted joint (a blind on its own, a flange with nothing bolted to it).
      const axis = ports[0].point.clone().sub(center).normalize();
      flange(center, axis, nodeCode(doc, n) ?? "", nodeItem(doc, n), ports[0].radius, host.nps, nodeItem(doc, n)?.rating);
    } else if (n.kind === "flange" || n.kind === "gasket") {
      const axis = (
        ports[0]?.point.clone().sub(center) ??
        vector(sub(getNode(doc, host.to).position, getNode(doc, host.from).position))
      ).normalize();
      const half = radius * (n.kind === "gasket" ? 0.05 : 0.25);
      cylinder(
        center.clone().addScaledVector(axis, -half),
        center.clone().addScaledVector(axis, half),
        radius * 1.9,
      );
    } else if (n.kind === "cap") {
      const axis = ports[0]?.point.clone().sub(center).normalize() ?? new THREE.Vector3(1, 0, 0);
      if (ports[0]) cylinder(ports[0].point, center, radius);
      const cap = mesh(new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), center);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.negate());
    } else if (n.kind === "support") {
      const support = mesh(
        new THREE.BoxGeometry(radius * 3, radius * 0.3, radius * 3),
        center.clone().add(new THREE.Vector3(0, -radius, 0)),
      );
      support.material = fittingMaterial;
    } else if (n.kind === "bolt") {
      mesh(
        new THREE.BoxGeometry(radius * 0.5, radius * 0.5, radius * 0.5),
        center.clone().add(new THREE.Vector3(0, radius * 1.5, 0)),
      );
    }
  }
  const bounds = new THREE.Box3().setFromObject(group),
    center = new THREE.Vector3(),
    size = new THREE.Vector3();
  if (!bounds.isEmpty()) {
    bounds.getCenter(center);
    bounds.getSize(size);
  }
  const span = Math.max(100, size.length()),
    camera = new THREE.PerspectiveCamera(42, 1, Math.max(0.1, span / 10000), span * 100);
  // Fit the bounding sphere inside the camera's narrower field of view, including portrait windows.
  const direction = new THREE.Vector3(.8, .6, .8).normalize();
  const fitDistance = (aspect: number) => {
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * aspect);
    return span / 2 / Math.sin(Math.min(vertical, horizontal)) * 1.15;
  };
  let fittedDistance = fitDistance(1);
  camera.position.copy(center).addScaledVector(direction, fittedDistance);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.update();
  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);
  const resize = () => {
    const w = Math.max(1, container.clientWidth),
      h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const offset = camera.position.clone().sub(controls.target), nextDistance = fitDistance(camera.aspect);
    camera.position.copy(controls.target).add(offset.multiplyScalar(nextDistance / fittedDistance));
    fittedDistance = nextDistance;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  return () => {
    observer.disconnect();
    controls.dispose();
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    metal.dispose();
    fittingMaterial.dispose();
    warning.dispose();
    gasketMaterial.dispose();
    existingMaterial.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

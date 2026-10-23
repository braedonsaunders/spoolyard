import { connected, getNode, getSpec, type IsoDocument, type Vec3 } from "../core/model";

/**
 * The 3D review without WebGL: the same pipes and fittings drawn shaded on a 2D canvas, orbited, panned and zoomed
 * like the WebGL view. It needs no graphics acceleration, so the review opens on any machine (a locked-down PC, a
 * virtual machine, a browser with acceleration turned off). Pipes are round-capped tubes of their outside diameter,
 * fittings balls and discs, painted back to front.
 */
interface Tube { a: Vec3; b: Vec3; r: number; colour: [number, number, number] }
interface Ball { at: Vec3; r: number; colour: [number, number, number]; disc?: Vec3 }

const PIPE: [number, number, number] = [119, 139, 156], FITTING: [number, number, number] = [150, 172, 188], VALVE: [number, number, number] = [92, 124, 150];

export function mountPreviewCanvas(container: HTMLElement, doc: IsoDocument, spool = ""): () => void {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";
  canvas.setAttribute("aria-label", "3D review (simplified)");
  container.append(canvas);
  const note = document.createElement("div");
  note.textContent = "Simplified 3D: this browser has no WebGL. Drag to orbit, right-drag or Shift-drag to pan, wheel to zoom, double-click to fit.";
  note.style.cssText = "position:absolute;left:12px;bottom:10px;font-size:11px;opacity:.6;pointer-events:none";
  container.append(note);
  const ctx = canvas.getContext("2d")!;

  const runs = doc.runs.filter((r) => !spool || r.spool === spool);
  const radius = (specId: string, nps: number) => (getSpec(doc, specId).sizes.find((s) => s.nps === nps)?.od ?? nps * 25.4 + 10) / 2;
  const tubes: Tube[] = [], balls: Ball[] = [];
  for (const r of runs) {
    if (r.connector) continue;
    tubes.push({ a: getNode(doc, r.from).position, b: getNode(doc, r.to).position, r: radius(r.specId, r.nps), colour: PIPE });
  }
  for (const n of doc.nodes) {
    if (n.kind === "end" || n.kind === "weld" || n.kind === "annotation") continue;
    const edges = connected(doc, n.id).filter((r) => runs.includes(r)), host = edges[0] ?? runs.find((r) => r.id === n.associatedRunId);
    if (!host) continue;
    const r = radius(host.specId, Math.max(...(edges.length ? edges : [host]).map((e) => e.nps)));
    const axis = (() => {
      const e = edges[0] ?? host, other = getNode(doc, e.from === n.id ? e.to : e.from).position;
      const v = other.map((x, i) => x - n.position[i]) as Vec3, l = Math.hypot(...v) || 1;
      return v.map((x) => x / l) as Vec3;
    })();
    if (n.kind === "valve") balls.push({ at: n.position, r: r * 1.5, colour: VALVE });
    else if (n.kind === "flange" || n.kind === "gasket") balls.push({ at: n.position, r: r * 1.9, colour: FITTING, disc: axis });
    else if (n.kind === "support") balls.push({ at: [n.position[0], n.position[1], n.position[2] - r * 1.2], r: r * 0.8, colour: FITTING });
    else balls.push({ at: n.position, r: r * 1.15, colour: FITTING });
  }

  // The model's extent, to fit it to the view.
  const points = [...tubes.flatMap((t) => [t.a, t.b]), ...balls.map((b) => b.at)];
  const lo = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
  const centre = points.length ? lo.map((v, i) => (v + hi[i]) / 2) as Vec3 : [0, 0, 0] as Vec3;
  const extent = points.length ? Math.max(200, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])) : 1000;
  const view = { yaw: -Math.PI / 4, pitch: 0.55, zoom: 1, pan: [0, 0] as [number, number] };
  const fit = () => { view.zoom = 1; view.pan = [0, 0]; };

  /** Screen point and depth (larger is nearer) of a plant point. */
  const project = (p: Vec3, w: number, h: number): [number, number, number] => {
    const x = p[0] - centre[0], y = p[1] - centre[1], z = p[2] - centre[2];
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const rx = x * cy - y * sy, ry = x * sy + y * cy;
    const sx = rx, up = z * cp - ry * sp, depth = -(z * sp + ry * cp);
    const s = (Math.min(w, h) / extent) * 0.85 * view.zoom;
    return [w / 2 + sx * s + view.pan[0], h / 2 - up * s + view.pan[1], depth];
  };
  const scaleOf = (w: number, h: number) => (Math.min(w, h) / extent) * 0.85 * view.zoom;
  const shade = (c: [number, number, number], k: number) => `rgb(${c.map((v) => Math.round(Math.min(255, v * k))).join(",")})`;

  const draw = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1), w = container.clientWidth || 1, h = container.clientHeight || 1;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = document.documentElement.classList.contains("dark") ? "#1d232a" : "#f2f5f8";
    ctx.fillRect(0, 0, w, h);
    const s = scaleOf(w, h);
    type Item = { depth: number; paint: () => void };
    const items: Item[] = [];
    for (const t of tubes) {
      const a = project(t.a, w, h), b = project(t.b, w, h), width = Math.max(1.5, t.r * 2 * s);
      // Lit by how square the pipe is to the view: a pipe seen end-on is darker.
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), along = Math.hypot(...t.b.map((v, i) => v - t.a[i])) * s || 1, k = 0.75 + 0.35 * Math.min(1, len / along);
      items.push({ depth: (a[2] + b[2]) / 2, paint: () => {
        ctx.lineCap = "round";
        ctx.strokeStyle = shade(t.colour, 0.55); ctx.lineWidth = width + 1.5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.strokeStyle = shade(t.colour, k); ctx.lineWidth = width; ctx.stroke();
        ctx.strokeStyle = shade(t.colour, k * 1.25); ctx.lineWidth = Math.max(1, width * 0.25);
        ctx.beginPath(); ctx.moveTo(a[0], a[1] - width * 0.18); ctx.lineTo(b[0], b[1] - width * 0.18); ctx.stroke();
      } });
    }
    for (const ball of balls) {
      const c = project(ball.at, w, h), r = Math.max(2, ball.r * s);
      items.push({ depth: c[2] + ball.r, paint: () => {
        if (ball.disc) {
          // A flange is a disc square to its pipe: an ellipse foreshortened by how the pipe faces the view.
          const tip = project(ball.at.map((v, i) => v + ball.disc![i] * ball.r) as Vec3, w, h), dx = tip[0] - c[0], dy = tip[1] - c[1];
          const angle = Math.atan2(dy, dx), squash = Math.min(1, Math.hypot(dx, dy) / r);
          ctx.beginPath(); ctx.ellipse(c[0], c[1], Math.max(1.5, r * Math.max(0.12, squash) * 0.35), r, angle, 0, Math.PI * 2);
        } else { ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); }
        const g = ctx.createRadialGradient(c[0] - r * 0.35, c[1] - r * 0.35, r * 0.1, c[0], c[1], r);
        g.addColorStop(0, shade(ball.colour, 1.3)); g.addColorStop(1, shade(ball.colour, 0.7));
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = shade(ball.colour, 0.5); ctx.lineWidth = 1; ctx.stroke();
      } });
    }
    items.sort((x, y) => x.depth - y.depth);
    for (const item of items) item.paint();
  };

  let frame = 0;
  const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
  let drag: { x: number; y: number; pan: boolean } | null = null;
  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
    canvas.style.cursor = "grabbing";
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) view.pan = [view.pan[0] + dx, view.pan[1] + dy];
    else { view.yaw -= dx * 0.008; view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + dy * 0.008)); }
    redraw();
  };
  const up = () => { drag = null; canvas.style.cursor = "grab"; };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect(), k = Math.exp(-e.deltaY * 0.0015);
    // Zoom about the pointer.
    const px = e.clientX - rect.left - rect.width / 2, py = e.clientY - rect.top - rect.height / 2;
    view.pan = [px - (px - view.pan[0]) * k, py - (py - view.pan[1]) * k];
    view.zoom *= k;
    redraw();
  };
  const menu = (e: Event) => e.preventDefault();
  const double = () => { fit(); redraw(); };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", menu);
  canvas.addEventListener("dblclick", double);
  const observer = new ResizeObserver(redraw);
  observer.observe(container);
  draw();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.remove();
    note.remove();
  };
}

import { memo, useMemo, useRef, type ReactElement } from "react";
import { arcPath, dashArray, letteringWeight, weightOf, type Primitive } from "../core/drawing";
import { LINE_SPACING, strokeTextPath } from "../core/stroke-font";
import { cn } from "./cn";
import { textBox, type TextPrimitive } from "./text-box";

type Role = "overall" | "cut";
/** Cap height of the sans lettering (Arial) as a fraction of its font size. */
const SANS_CAP_HEIGHT = 0.72;
/** Width of the invisible stroke that makes a thin pipe easy to click, in screen pixels (a non-scaling stroke). */
const PIPE_PICK_WIDTH = 14;
/** Smallest pick box for a length, so a short dimension can still be double-clicked. */
const MIN_LENGTH_PICK = 36;

const paths = new WeakMap<TextPrimitive, string>();
/** Stroke lettering is cached per primitive, so redrawing does not re-stroke the sheet. */
const cadPath = (p: TextPrimitive) => {
  let d = paths.get(p);
  if (d == null)
    paths.set(p, (d = strokeTextPath(p.text, { at: p.p, size: p.size, rotation: p.rotation, oblique: p.oblique, anchor: p.anchor, width: p.width })));
  return d;
};
/** Rotation (counter-clockwise on the page) and oblique (leaning right) about the text's anchor point. */
const textTransform = (p: TextPrimitive) =>
  p.rotation || p.oblique
    ? `translate(${p.p[0]} ${p.p[1]}) rotate(${-(p.rotation ?? 0)}) skewX(${-(p.oblique ?? 0)}) translate(${-p.p[0]} ${-p.p[1]})`
    : undefined;

/**
 * Keys that follow a primitive through redraws: its kind, layer, owner and label, numbered within those. Adding a
 * label to one pipe re-keys that pipe's ink only, rather than every primitive drawn after it.
 */
function primitiveKeys(primitives: Primitive[]): string[] {
  const seen = new Map<string, number>();
  return primitives.map((p) => {
    const base = `${p.type}:${p.layer}:${p.owner ?? ""}:${(p.type === "text" && p.label?.key) || ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return base + "#" + n;
  });
}

export interface SheetLayerProps {
  /** The primitives to draw, already filtered for the surface. */
  primitives: Primitive[];
  lettering?: "cad" | "sans";
  /** Stroke width of each layer on the drawing's paper (`Drawing.weights`), so the editor draws the printed pens. */
  weights?: Record<string, number>;
  /** Fill inside open circles: the paper, or the model-space canvas. */
  background: string;
  /** What is selected; its ink is drawn in the selection colour. */
  selection: ReadonlySet<string>;
  /** The pipe length being edited in place; its label hides under the input. */
  editing: { runId: string; role: Role } | null;
  onEditLength?: (runId: string, role: Role) => void;
  /** Ink of the paper label picked on its own, drawn in the label selection colour. */
  highlight?: ReadonlySet<Primitive>;
}
const NO_SELECTION: ReadonlySet<string> = new Set();

/** Whether two values are the same plain data (primitives are plain objects of numbers, strings and arrays). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>, keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) if (!same(x[k], y[k])) return false;
  return true;
}
/** A primitive's element as last drawn, with what it was drawn for. */
interface Drawn { p: Primitive; element: ReactElement; selected: boolean; lit: boolean; hidden: boolean }

/**
 * The drawing's primitives as the editor shows them, drawn the same way as the SVG, PDF and CAD exports.
 *
 * A redraw after an edit gives every primitive anew, mostly unchanged. Each primitive's element is kept with the
 * primitive it was drawn for, and given again while the new primitive is the same and it is selected, highlighted and
 * hidden alike, so React leaves its ink alone and only what changed is drawn again.
 */
export const SheetLayer = memo(function SheetLayer({ primitives, lettering, weights, background, selection = NO_SELECTION, editing, onEditLength, highlight }: SheetLayerProps) {
  const keys = useMemo(() => primitiveKeys(primitives), [primitives]);
  // The length editor opens through the latest handler, so a kept element never calls an old one.
  const editLength = useRef(onEditLength);
  editLength.current = onEditLength;
  const editable = !!onEditLength;
  // What every element is drawn with besides its own primitive; a change draws them all again.
  const setting = `${lettering}|${background}|${editable}|${weights ? Object.entries(weights).join(";") : ""}`;
  const kept = useRef<{ setting: string; drawn: Map<string, Drawn> }>({ setting, drawn: new Map() });
  if (kept.current.setting !== setting) kept.current = { setting, drawn: new Map() };
  let selected = false, lit = false;
  const layerClass = (p: Primitive, base: string, ...extra: Array<string | false>) =>
    cn(base, "iso-layer-" + p.layer.toLowerCase(), ...extra, selected && "selected", lit && "label-selected");
  const ink = (p: Primitive, cad: boolean) =>
    p.color ? (p.type === "text" ? (cad ? { stroke: p.color, fill: "none" } : { fill: p.color }) : { stroke: p.color, ...("fill" in p && p.fill ? { fill: p.color } : {}) }) : undefined;
  const text = (p: TextPrimitive, key: string, hidden: boolean) => {
    const cad = (p.lettering ?? lettering) === "cad";
    const transform = textTransform(p);
    const lines = p.text.split(/\r?\n/);
    const box = textBox(p);
    const style = { ...(hidden ? { visibility: "hidden" as const } : {}), ...ink(p, cad) };
    const glyphs = cad ? (
      <path data-owner={p.owner} data-length={p.role} data-text={p.text} d={cadPath(p)} strokeWidth={letteringWeight(weights)} className={layerClass(p, "iso-cad-text")} style={style} />
    ) : (
      <text data-owner={p.owner} data-length={p.role} x={p.p[0]} y={p.p[1]} fontSize={p.size / SANS_CAP_HEIGHT}
        textAnchor={p.anchor && p.anchor !== "start" ? p.anchor : undefined} transform={transform} className={layerClass(p, "iso-text")} style={style}>
        {lines.length > 1
          ? lines.map((line, i) => (
              <tspan key={i} x={p.p[0]} dy={i ? LINE_SPACING * p.size : undefined}>
                {line}
              </tspan>
            ))
          : p.text}
      </text>
    );
    return (
      <g key={key} data-label={p.label?.key}>
        {glyphs}
        {p.role && p.owner && !hidden ? (
          <rect data-owner={p.owner} data-length={p.role} x={box.left - 4} y={box.top} width={Math.max(MIN_LENGTH_PICK, box.width + 8)} height={box.height + 8}
            transform={transform} fill="transparent" className="iso-length-hit"
            onDoubleClick={editable ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              editLength.current?.(p.owner!, p.role!);
            } : undefined}>
            <title>{p.role === "cut" ? "Double-click to edit the cut length" : "Double-click to edit the centreline length"}</title>
          </rect>
        ) : (
          // Single-stroke lettering is too thin to click, so owned CAD text carries a box to pick it by.
          cad && p.owner && <rect data-owner={p.owner} x={box.left - 2} y={box.top - 2} width={box.width + 4} height={box.height + 4} transform={transform} fill="transparent" />
        )}
      </g>
    );
  };
  const draw = (p: Primitive, key: string, hidden: boolean): ReactElement => {
    if (p.type === "text") return text(p, key, hidden);
    if (p.type === "image")
      return <image key={key} data-owner={p.owner} href={p.href} x={p.p[0]} y={p.p[1]} width={p.width} height={p.height}
        preserveAspectRatio="xMidYMid meet" className={layerClass(p, "iso-image")} />;
    const weight = weightOf(p, weights), dashes = dashArray(p, weights);
    if (p.type === "line")
      return (
        <g key={key}>
          <line data-owner={p.owner} x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} className={layerClass(p, "iso-primitive")} style={ink(p, false)} strokeWidth={weight} strokeDasharray={dashes} />
          {p.layer === "PIPE" && p.owner && (
            // The pick band is screen pixels wide at any zoom, and capped square so a pipe only a few pixels long
            // on screen still has a target the size of a pick box.
            <line data-owner={p.owner} x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} stroke="transparent" strokeWidth={PIPE_PICK_WIDTH}
              strokeLinecap="square" vectorEffect="non-scaling-stroke" />
          )}
        </g>
      );
    if (p.type === "polyline") {
      const Shape = p.closed || p.fill ? "polygon" : "polyline";
      return <Shape key={key} data-owner={p.owner} points={p.points.map((q) => q.join(",")).join(" ")}
        className={layerClass(p, "iso-primitive", !!p.fill && "iso-fill")} style={ink(p, false)} strokeWidth={weight} strokeDasharray={dashes} strokeLinejoin="round" fill="none" />;
    }
    if (p.type === "arc")
      return <path key={key} data-owner={p.owner} d={arcPath(p)} className={layerClass(p, "iso-primitive")} style={ink(p, false)} strokeWidth={weight} strokeDasharray={dashes} fill="none" />;
    return <circle key={key} data-owner={p.owner} cx={p.p[0]} cy={p.p[1]} r={p.r} className={layerClass(p, "iso-primitive", !!p.fill && "iso-fill")}
      style={ink(p, false)} strokeWidth={weight} strokeDasharray={dashes} fill={background} />;
  };
  const drawn = new Map<string, Drawn>(), before = kept.current.drawn;
  const elements = primitives.map((p, i) => {
    const key = keys[i];
    selected = !!p.owner && selection.has(p.owner);
    lit = !!highlight?.has(p);
    const hidden = p.type === "text" && editing != null && editing.runId === p.owner && editing.role === p.role;
    const last = before.get(key);
    const entry = last && last.selected === selected && last.lit === lit && last.hidden === hidden && same(last.p, p)
      ? last : { p, element: draw(p, key, hidden), selected, lit, hidden };
    drawn.set(key, entry);
    return entry.element;
  });
  kept.current.drawn = drawn;
  return <g data-sheet-layer="">{elements}</g>;
});

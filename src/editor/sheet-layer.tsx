import { weightOf, type Primitive } from "../core/drawing";
import { CAD_STROKE_WIDTH, LINE_SPACING, measureText, strokeTextPath } from "../core/stroke-font";
import { cn } from "./cn";

type Text = Extract<Primitive, { type: "text" }>;
type Role = "overall" | "cut";

/** Filled shapes take their stroke colour; CAD lettering strokes in the colour the sans lettering fills with. */
const SHEET_CSS = `.iso-fill{fill:#263646}.iso-fill.iso-layer-dim{fill:#8ea4b4}.iso-fill.iso-layer-weld{fill:#0c6880}.iso-fill.iso-layer-bom{fill:#607180}.model-space .iso-fill{fill:var(--iso-ink)}.dark .model-space .iso-fill.iso-layer-bom{fill:#9bb6ca}.iso-fill.selected{fill:#008dbc}
.iso-cad-text{fill:none;stroke:#263646;stroke-linecap:round;stroke-linejoin:round}.iso-cad-text.iso-layer-dim{stroke:#31404c}.iso-cad-text.iso-layer-text{stroke:#6d7a86}.iso-cad-text.iso-layer-weld{stroke:#0c6880}.iso-cad-text.iso-layer-bom{stroke:#1c2b38}.model-space .iso-cad-text{stroke:var(--iso-ink)}.dark .model-space .iso-cad-text.iso-layer-weld{stroke:#63c9e5}.iso-cad-text.selected{stroke:#008dbc}`;

const paths = new WeakMap<Text, string>();
/** Stroke lettering is cached per primitive, so re-rendering for pointer moves does not re-stroke the sheet. */
const cadPath = (p: Text) => {
  let d = paths.get(p);
  if (d == null)
    paths.set(p, (d = strokeTextPath(p.text, { at: p.p, size: p.size, rotation: p.rotation, oblique: p.oblique, anchor: p.anchor, width: p.width })));
  return d;
};
/** Rotation (counter-clockwise on the page) and oblique (leaning right) about the text's anchor point. */
const textTransform = (p: Text) =>
  p.rotation || p.oblique
    ? `translate(${p.p[0]} ${p.p[1]}) rotate(${-(p.rotation ?? 0)}) skewX(${-(p.oblique ?? 0)}) translate(${-p.p[0]} ${-p.p[1]})`
    : undefined;

export interface SheetLayerProps {
  /** The primitives to draw, already filtered for the surface. */
  primitives: Primitive[];
  lettering?: "cad" | "sans";
  /** Fill inside open circles: the paper, or the model-space canvas. */
  background: string;
  selection: string;
  /** The pipe length being edited in place; its label hides under the input. */
  editing: { runId: string; role: Role } | null;
  onEditLength: (runId: string, role: Role) => void;
}

/** The drawing's primitives as the editor shows them, drawn the same way as the SVG, PDF and CAD exports. */
export function SheetLayer({ primitives, lettering, background, selection, editing, onEditLength }: SheetLayerProps) {
  const cad = lettering === "cad";
  const layerClass = (p: Primitive, base: string, ...extra: Array<string | false>) =>
    cn(base, "iso-layer-" + p.layer.toLowerCase(), ...extra, p.owner === selection && "selected");
  const text = (p: Text, key: number) => {
    const cad=(p.lettering ?? lettering)==='cad';
    const hidden = editing != null && editing.runId === p.owner && editing.role === p.role;
    const transform = textTransform(p);
    const lines = p.text.split(/\r?\n/);
    const width = cad ? measureText(p.text, p.size) : (Math.max(...lines.map((line) => line.length)) * p.size * 0.62) / 0.72,
      left = p.p[0] - width * (p.anchor === "middle" ? 0.5 : p.anchor === "end" ? 1 : 0);
    const glyphs = cad ? (
      <path
        data-owner={p.owner}
        data-length={p.role}
        data-text={p.text}
        d={cadPath(p)}
        strokeWidth={CAD_STROKE_WIDTH}
        className={layerClass(p, "iso-cad-text")}
        style={{...(hidden?{visibility:"hidden"}:{}),...(p.color?{stroke:cad?p.color:undefined,fill:cad?"none":p.color}:{})}}
      />
    ) : (
      <text
        data-owner={p.owner}
        data-length={p.role}
        x={p.p[0]}
        y={p.p[1]}
        fontSize={p.size / 0.72}
        textAnchor={p.anchor && p.anchor !== "start" ? p.anchor : undefined}
        transform={transform}
        className={layerClass(p, "iso-text")}
        style={{...(hidden?{visibility:"hidden"}:{}),...(p.color?{stroke:cad?p.color:undefined,fill:cad?"none":p.color}:{})}}
      >
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
      <g key={key} data-label={p.label?.key} data-label-x={p.label?.at[0]} data-label-y={p.label?.at[1]} data-label-spool={p.label?.spool}
        data-dimension-x={p.label?.dimension?.axis[0]} data-dimension-y={p.label?.dimension?.axis[1]} data-dimension-offset={p.label?.dimension?.offset}>
        {glyphs}
        {p.role && p.owner && !hidden ? (
          <rect
            data-owner={p.owner}
            data-length={p.role}
            x={left - 4}
            y={p.p[1] - p.size}
            width={Math.max(36, width + 8)}
            height={p.size + 8}
            transform={transform}
            fill="transparent"
            className="iso-length-hit"
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEditLength(p.owner!, p.role!);
            }}
          >
            <title>{p.role === "cut" ? "Double-click to edit the cut length" : "Double-click to edit the centreline length"}</title>
          </rect>
        ) : (
          // Single-stroke lettering is too thin to click, so owned CAD text carries a box to pick it by.
          cad &&
          p.owner && (
            <rect
              data-owner={p.owner}
              x={left - 2}
              y={p.p[1] - p.size - 2}
              width={width + 4}
              height={p.size + (lines.length - 1) * LINE_SPACING * p.size + 4}
              transform={transform}
              fill="transparent"
            />
          )
        )}
      </g>
    );
  };
  return (
    <g data-sheet-layer="">
      <style>{SHEET_CSS}</style>
      {primitives.map((p, i) => {
        if (p.type === "text") return text(p, i);
        if (p.type === "image")
          return (
            <image
              key={i}
              data-owner={p.owner}
              href={p.href}
              x={p.p[0]}
              y={p.p[1]}
              width={p.width}
              height={p.height}
              preserveAspectRatio="xMidYMid meet"
              className={layerClass(p, "iso-image")}
            />
          );
        const weight = weightOf(p);
        if (p.type === "line")
          return (
            <g key={i}>
              <line
                data-owner={p.owner}
                x1={p.a[0]}
                y1={p.a[1]}
                x2={p.b[0]}
                y2={p.b[1]}
                className={layerClass(p, "iso-primitive")}
                style={p.color?{stroke:p.color}:undefined}
                strokeWidth={weight}
              />
              {p.layer === "PIPE" && p.owner && (
                <line data-owner={p.owner} x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} stroke="transparent" strokeWidth={14} />
              )}
            </g>
          );
        if (p.type === "polyline") {
          const Shape = p.closed || p.fill ? "polygon" : "polyline";
          return (
            <Shape
              key={i}
              data-owner={p.owner}
              points={p.points.map((q) => q.join(",")).join(" ")}
              className={layerClass(p, "iso-primitive", !!p.fill && "iso-fill")}
              style={p.color?{stroke:p.color,...(p.fill?{fill:p.color}:{})}:undefined}
                strokeWidth={weight}
              strokeLinejoin="round"
              fill="none"
            />
          );
        }
        return (
          <circle
            key={i}
            data-owner={p.owner}
            cx={p.p[0]}
            cy={p.p[1]}
            r={p.r}
            className={layerClass(p, "iso-primitive", !!p.fill && "iso-fill")}
            style={p.color?{stroke:p.color,...(p.fill?{fill:p.color}:{})}:undefined}
                strokeWidth={weight}
            fill={background}
          />
        );
      })}
    </g>
  );
}

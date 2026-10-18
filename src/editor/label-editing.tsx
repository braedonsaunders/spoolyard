import { useMemo } from "react";
import type { Drawing, PaperLabel, Point } from "../core/drawing";
import { SheetLayer } from "./sheet-layer";
import { cn } from "./cn";

/** The paper label the Select tool has picked, apart from any pipe or component. */
export interface LabelSelection { key: string; spool: string }
/** A label, its leader bend or its dimension line being dragged on paper. */
export interface LabelDrag {
  /** The held-position key written on release: the label's own key, or `leader:<key>` for its bend. */
  key: string;
  spool: string;
  point: Point;
  at: Point;
  destination: Point;
  dimension?: { axis: Point; offset: number };
  /** The label being moved, whose ink is previewed. */
  label?: string;
  /** Dragging the leader bend rather than the label. */
  bend?: boolean;
  /** Whether the pointer has travelled far enough to move it, rather than only pick it. */
  moved?: boolean;
  /** The line of the picked callout pressed: picked instead if the press does not move. */
  drill?: LabelSelection;
}

const NONE: ReadonlySet<string> = new Set();
export const labelIndex = (drawing: Drawing) => new Map((drawing.labels ?? []).map((l) => [l.key, l] as [string, PaperLabel]));

/**
 * The label a press on `element` picks. A line of a callout picks its whole callout, unless Ctrl/⌘ is held (as for
 * AutoCAD sub-objects) or the callout, or another of its lines, is already picked: a second click drills in.
 */
export function pickLabel(index: Map<string, PaperLabel>, element: Element, current: string | undefined, sub: boolean, again: boolean): PaperLabel | undefined {
  const key = element.closest("[data-label]")?.getAttribute("data-label");
  const label = key ? index.get(key) : undefined;
  if (!label?.parent) return label;
  const parent = index.get(label.parent);
  if (!parent) return label;
  const selected = current ? index.get(current) : undefined;
  const inside = current === label.key || current === parent.key || selected?.parent === parent.key;
  return sub || (again && inside) ? label : top(index, parent);
}
/** The outermost callout a label is drawn with. */
const top = (index: Map<string, PaperLabel>, label: PaperLabel): PaperLabel => {
  let at = label;
  for (let i = 0; i < 8 && at.parent && index.has(at.parent); i++) at = index.get(at.parent)!;
  return at;
};

/** Where a leader's bend handle sits: its bend, else the middle of the leader. */
export const bendHandle = (label: PaperLabel): Point | undefined =>
  label.leader && (label.leader.bend ?? [(label.leader.from[0] + label.leader.to[0]) / 2, (label.leader.from[1] + label.leader.to[1]) / 2]);

const points = (outline: Point[]) => outline.map((p) => p.join(",")).join(" ");
/** An outline grown outward a little from its centre, so the hover box clears the lettering. */
const grow = (outline: Point[], by: number): Point[] => {
  const cx = outline.reduce((s, p) => s + p[0], 0) / (outline.length || 1), cy = outline.reduce((s, p) => s + p[1], 0) / (outline.length || 1);
  return outline.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / d) * by, y + ((y - cy) / d) * by];
  });
};

/**
 * The editor's layer over the paper labels: a pick area per label, the hover box, the picked label with its grips
 * (move, leader bend), held labels that overprint, and a preview while one is dragged. Never exported.
 */
export function LabelOverlay({ labels, index, hover, selected, drag, preview, active, pixel, lettering, weights }: {
  labels: PaperLabel[];
  index: Map<string, PaperLabel>;
  hover: string | null;
  selected: LabelSelection | null;
  drag: LabelDrag | null;
  preview: Point | null;
  /** Whether labels can be picked now: the Select tool on the iso paper sheet. */
  active: boolean;
  /** One screen pixel in sheet units, so grips keep their size at any zoom. */
  pixel: number;
  lettering?: "cad" | "sans";
  /** The drawing's pen widths, so a dragged label's preview is drawn with the sheet's pens. */
  weights?: Record<string, number>;
}) {
  const picked = selected ? index.get(selected.key) : undefined;
  const hovered = hover && hover !== selected?.key ? index.get(hover) : undefined;
  const moving = drag && preview && drag.label ? index.get(drag.label) : undefined;
  const grip = 4.5 * pixel;
  // Callouts first, then their lines, so a line's pick area sits on top of its callout's. A hover or a pick redraws
  // only its own outline, never every label's pick area.
  const hits = useMemo(() => [...labels].sort((a, b) => Number(!!a.parent) - Number(!!b.parent)).map((l) =>
    // Dimension lettering is picked by its own text, which also opens its length for editing.
    l.dimension ? null : (
      <polygon key={l.key} points={points(grow(l.outline, 1.5))} className="iso-label-hit" data-label={l.key} />
    ),
  ), [labels]);
  return (
    <g className={cn("iso-label-overlay", active && "active")} data-label-overlay="">
      {active && hits}
      {active && labels.filter((l) => l.displaced && l.key !== picked?.key).map((l) => (
        <polygon key={"displaced:" + l.key} points={points(grow(l.outline, 2))} className="iso-label-displaced" pointerEvents="none">
          <title>Moved label drawn clear of an overprint; Re-place keeps it here</title>
        </polygon>
      ))}
      {active && labels.filter((l) => l.overlapping && l.key !== picked?.key).map((l) => (
        <polygon key={"overlap:" + l.key} points={points(grow(l.outline, 2))} className="iso-label-overlap" pointerEvents="none">
          <title>Moved label overprints other lettering</title>
        </polygon>
      ))}
      {hovered && active && <polygon points={points(grow(hovered.outline, 2))} className="iso-label-hover" pointerEvents="none" />}
      {picked && (
        <g className="iso-label-selected" pointerEvents="none">
          {picked.parent && index.get(picked.parent) && <polygon points={points(grow(index.get(picked.parent)!.outline, 2.5))} className="iso-label-parent" />}
          <polygon points={points(grow(picked.outline, 2))} className="iso-label-outline" />
          <rect x={picked.at[0] - grip} y={picked.at[1] - grip} width={grip * 2} height={grip * 2} className="iso-label-grip" />
        </g>
      )}
      {picked && active && picked.leader && !drag && (() => {
        const at = bendHandle(picked)!;
        return (
          <rect data-leader-handle={picked.key} x={at[0] - grip} y={at[1] - grip} width={grip * 2} height={grip * 2}
            className={cn("iso-label-bend", picked.leader.held && "held")}>
            <title>Drag to bend the leader</title>
          </rect>
        );
      })()}
      {moving && drag && preview && (() => {
        if (drag.bend && moving.leader) {
          const { from, to } = moving.leader;
          return <polyline points={points([from, preview, to])} className="iso-label-rubber" pointerEvents="none" />;
        }
        const dx = preview[0] - drag.at[0], dy = preview[1] - drag.at[1];
        const leader = moving.leader, from: Point | undefined = leader && [leader.from[0] + dx, leader.from[1] + dy];
        return (
          <g pointerEvents="none" className="iso-label-ghost">
            <g transform={`translate(${dx} ${dy})`}>
              <SheetLayer primitives={moving.ink} lettering={lettering} weights={weights} background="transparent" selection={NONE} editing={null} />
            </g>
            {leader && from && <polyline points={points(leader.bend && leader.held ? [from, leader.bend, leader.to] : [from, leader.to])} className="iso-label-rubber" />}
          </g>
        );
      })()}
    </g>
  );
}

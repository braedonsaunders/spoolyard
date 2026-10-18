import { defaultBlockSpacing, defaultGrid, type GridPlane, type GridSettings } from "../core/grid";
import type { IsoDocument } from "../core/model";

/**
 * Drafting aids are the drafter's, not the drawing's: switching the grid, snap or ortho, choosing a routing plane or
 * a block length, or how the wheel behaves never changes the document, adds an undo step or leaves unsaved changes.
 * Grid, snap, ortho, object snaps and the wheel are remembered across sessions; the routing plane and block length
 * are per drawing session. Drawings saved before this keep their `grid` and open with it.
 */
export type ObjectSnap = "endpoint" | "midpoint" | "centre" | "nearest";
export const OBJECT_SNAPS: Array<{ id: ObjectSnap; label: string; hint: string }> = [
  { id: "endpoint", label: "Endpoint", hint: "Open ends, elbows and every connection" },
  { id: "midpoint", label: "Midpoint", hint: "Middle of a straight pipe" },
  { id: "centre", label: "Centre", hint: "Centre of a component on a pipe" },
  { id: "nearest", label: "Nearest", hint: "Nearest point on a pipe" },
];
export interface Drafting {
  grid: boolean;
  snap: boolean;
  ortho: boolean;
  plane: GridPlane;
  /** One isometric block, in millimetres of centreline. */
  spacing: number;
  /** The mouse wheel zooms (Shift or a sideways scroll pans), or pans (Ctrl or a pinch zooms). */
  wheel: "zoom" | "pan";
  osnap: boolean;
  snaps: Record<ObjectSnap, boolean>;
}
export const PLANES: Array<{ value: GridPlane; label: string; title: string }> = [
  { value: "xy", label: "Plan (E–N)", title: "Route on a level: East–West and North–South" },
  { value: "xz", label: "Elevation (E–Up)", title: "Route in an East–West elevation" },
  { value: "yz", label: "Elevation (N–Up)", title: "Route in a North–South elevation" },
];

const KEY = "spoolyard.drafting";
type Stored = Partial<Pick<Drafting, "grid" | "snap" | "ortho" | "wheel" | "osnap" | "snaps">>;
const read = (): Stored => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};
const DEFAULT_SNAPS: Record<ObjectSnap, boolean> = { endpoint: true, midpoint: true, centre: true, nearest: false };

/** The drafting aids a drawing opens with. */
export function initialDrafting(doc: Pick<IsoDocument, "grid" | "units">): Drafting {
  const stored = read(), grid = doc.grid ?? defaultGrid();
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    grid: bool(stored.grid, grid.visible),
    snap: bool(stored.snap, grid.snap),
    ortho: bool(stored.ortho, grid.ortho !== false),
    plane: grid.plane,
    spacing: doc.grid?.spacing ?? defaultBlockSpacing(doc.units),
    wheel: stored.wheel === "pan" ? "pan" : "zoom",
    osnap: bool(stored.osnap, true),
    snaps: { ...DEFAULT_SNAPS, ...(stored.snaps && typeof stored.snaps === "object" ? stored.snaps : {}) },
  };
}
/** Remembers the drafter's own preferences; the plane and block stay with the session. */
export function storeDrafting(d: Drafting) {
  const value: Stored = { grid: d.grid, snap: d.snap, ortho: d.ortho, wheel: d.wheel, osnap: d.osnap, snaps: d.snaps };
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode: the session keeps them */ }
}
/** The settings the grid and pick functions read. */
export const gridSettings = (d: Drafting): GridSettings => ({ visible: d.grid, snap: d.snap, spacing: d.spacing, plane: d.plane, ortho: d.ortho });

import { useEffect, useRef } from "react";
import { Grid3X3, Magnet, Move3d, Crosshair, SlidersHorizontal } from "lucide-react";
import type { IsoDocument } from "../core/model";
import { cn } from "./cn";
import { OBJECT_SNAPS, PLANES, type Drafting } from "./drafting";
import { LengthInput, Row, Segmented, Toggle } from "./inspector/kit";

/** Grid blocks offered for typing, in either unit system. */
const BLOCK_PRESETS = ["6 in", "12 in", "1 ft", "2 ft", "5 ft", "100 mm", "250 mm", "500 mm", "1 m"];

/**
 * The drafting aids along the status bar, as AutoCAD's: Grid (F7), Snap (F9), Ortho (F8) and Object snap (F3), the
 * routing plane and grid block, and the rest of the drafter's preferences behind the settings button. None of them
 * change the drawing.
 */
export function DraftingSettings({ drafting, units, onChange, open, onOpen, onError }: {
  drafting: Drafting; units: IsoDocument["units"]; onChange: (patch: Partial<Drafting>) => void;
  open: boolean; onOpen: (open: boolean) => void; onError: (message: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!panel.current?.parentElement?.contains(e.target as Node)) onOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onOpen(false); } };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, onOpen]);
  const aid = (key: "grid" | "snap" | "ortho" | "osnap", label: string, fn: string, Icon: typeof Grid3X3, title: string) => (
    <button type="button" className={cn("iso-aid", drafting[key] && "active")} aria-pressed={drafting[key]} title={`${title} (${fn})`} onClick={() => onChange({ [key]: !drafting[key] })}>
      <Icon size={13} /> {label}
    </button>
  );
  return (
    <span className="iso-drafting" role="group" aria-label="Drafting aids">
      {aid("grid", "Grid", "F7", Grid3X3, "Show the editing grid")}
      {aid("snap", "Snap", "F9", Magnet, "Picks step by whole grid blocks")}
      {aid("ortho", "Ortho", "F8", Move3d, "Route and drag along the plant axes")}
      {aid("osnap", "Osnap", "F3", Crosshair, "Snap to ends, midpoints and centres")}
      <select aria-label="Routing plane" value={drafting.plane} title={PLANES.find((p) => p.value === drafting.plane)?.title}
        onChange={(e) => onChange({ plane: e.target.value as Drafting["plane"] })}>
        {PLANES.map((p) => <option key={p.value} value={p.value} title={p.title}>{p.label}</option>)}
      </select>
      <span className="iso-drafting-block" title="One grid block of centreline length; Snap steps by it">
        Block
        <LengthInput aria="Grid block" mm={drafting.spacing} units={units} positive list="iso-block-presets" onError={onError}
          onCommit={(spacing) => { if (spacing) onChange({ spacing }); }} />
        <datalist id="iso-block-presets">{BLOCK_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
      </span>
      <span className="iso-drafting-more">
        <button type="button" className="iso-aid" aria-label="Drafting settings" aria-expanded={open} title="Drafting settings" onClick={() => onOpen(!open)}>
          <SlidersHorizontal size={13} />
        </button>
        {open && (
          <div ref={panel} className="iso-drafting-panel insp" role="dialog" aria-label="Drafting settings">
            <strong>Drafting settings</strong>
            <p className="insp-note">Your preferences in this browser. They never change the drawing.</p>
            <Row label="Mouse wheel" group hint="Ctrl/⌘ + wheel (a pinch) always zooms; Shift + wheel pans.">
              <Segmented aria="Mouse wheel" value={drafting.wheel} onChange={(wheel) => onChange({ wheel })}
                choices={[{ value: "zoom", label: "Zooms", title: "A mouse: the wheel zooms about the pointer" }, { value: "pan", label: "Pans", title: "A trackpad: two-finger scrolling pans" }]} />
            </Row>
            <Toggle label="Object snap" hint="F3" checked={drafting.osnap} onChange={(osnap) => onChange({ osnap })} />
            {OBJECT_SNAPS.map((s) => (
              <Toggle key={s.id} label={s.label} aria={`${s.label} snap`} hint={s.hint} checked={drafting.snaps[s.id]}
                onChange={(on) => onChange({ snaps: { ...drafting.snaps, [s.id]: on } })} />
            ))}
          </div>
        )}
      </span>
    </span>
  );
}

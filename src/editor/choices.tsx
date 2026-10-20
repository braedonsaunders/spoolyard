import { useId } from "react";
import type { Drawing } from "../core/drawing";
import type { EndPrep, IsoDocument } from "../core/model";
import { TextInput } from "./inspector/kit";
import type { LibrarySpecSummary } from "./library";
import { useSavedSpecs } from "./spec-library";

/**
 * Choices offered in more than one place, defined once so the ribbon, the properties and the menus use the same
 * words for the same thing.
 */
export const END_PREPS: Array<{ value: EndPrep; label: string }> = [
  { value: "BW", label: "Butt weld" },
  { value: "SW", label: "Socket weld" },
  { value: "THD", label: "Threaded" },
  { value: "FL", label: "Flanged" },
  { value: "PLAIN", label: "Plain end" },
];
export const endPrepName = (p: EndPrep) => END_PREPS.find((x) => x.value === p)?.label ?? p;

export const VIEWS: Array<{ value: Drawing["view"]; label: string }> = [
  { value: "iso", label: "Isometric" },
  { value: "plan", label: "Plan" },
  { value: "front", label: "Front elevation" },
  { value: "side", label: "Side elevation" },
];
export const SCALES: Array<{ value: "schematic" | "scale"; label: string; title: string }> = [
  { value: "schematic", label: "Not to scale (NTS)", title: "Production isometrics: every leg drafted on isometric paper so short pieces stay readable" },
  { value: "scale", label: "To scale", title: "Every leg drawn to its plant length" },
];
/** The words for a component's kind where it has no catalogue type. */
export const KIND_LABELS: Record<string, string> = {
  elbow90: "90° elbow",
  elbow45: "45° elbow",
  tee: "Tee",
  valve: "Valve",
  flange: "Flange",
  reducer: "Reducer",
  cap: "Cap",
  support: "Support",
  weld: "Weld",
  olet: "Olet",
  gasket: "Gasket",
  bolt: "Bolts",
  end: "Open end",
  annotation: "Note",
};

/** The drawing's specifications, and the standard library's to add, as one choice. */
export function SpecSelect({ doc, value, onChange, library, libraryError, busy, aria }: {
  doc: IsoDocument; value: string; onChange: (value: string) => void; library: LibrarySpecSummary[] | null;
  libraryError?: string; busy: string; aria: string;
}) {
  const own = useSavedSpecs().filter((l) => !doc.specs.some((s) => s.id === l.id));
  // A specification the drafter keeps in their library is offered from there, in place of the standard one it refines.
  const extra = (library ?? []).filter((l) => !doc.specs.some((s) => s.id === l.id) && !own.some((o) => o.id === l.id));
  return (
    <select aria-label={aria} value={value} disabled={!!busy} onChange={(e) => onChange(e.target.value)} title={libraryError || undefined}>
      {doc.specs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      {own.length > 0 && (
        <optgroup label="Add from my library">
          {own.map((l) => <option value={"saved:" + l.id} key={l.id}>{busy === "saved:" + l.id ? "Adding " + l.id + "…" : l.id + " · " + (l.service || l.material)}</option>)}
        </optgroup>
      )}
      {extra.length > 0 && (
        <optgroup label="Add from standard library">
          {extra.map((l) => <option value={"library:" + l.slug} key={l.slug}>{busy === l.slug ? "Adding " + l.id + "…" : l.id + " · " + l.service}</option>)}
        </optgroup>
      )}
      {libraryError && <option value="library:retry">Standard library unavailable · retry</option>}
    </select>
  );
}

/** A spool name: chosen from the drawing's spools or typed as a new one; committed on Enter or leaving the field. */
export function SpoolInput({ value, spools, onChange, aria }: { value: string; spools: string[]; onChange: (spool: string) => void; aria: string }) {
  const list = useId();
  return (
    <>
      <TextInput aria={aria} value={value} list={list} trim maxLength={120} onCommit={(v) => { if (!v) return false; onChange(v); }} />
      <datalist id={list}>{spools.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
}

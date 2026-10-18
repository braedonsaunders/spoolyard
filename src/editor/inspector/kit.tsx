import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { type IsoDocument } from "../../core/model";
import { editedLength, lengthInputValue, type LengthPrecision } from "../../core/format";
import { cn } from "../cn";
import { createStore, useStore, type Store } from "../store";
import type { PaperUnits } from "../paper";

/**
 * The inspector's building blocks. Every property is a labelled row in one of a few control shapes, every group a
 * collapsible section that remembers whether it was open, and the property filter reaches all of them, so the panel
 * reads the same for a pipe, a valve or an open end.
 */

const Query = createContext("");
export const InspectorQuery = Query.Provider;
const words = (q: string) => q.trim().toLowerCase().split(/\s+/).filter(Boolean);
/** Whether a row survives the property filter. */
export function useMatch(...terms: Array<string | undefined | false>) {
  const q = words(useContext(Query));
  if (!q.length) return true;
  const hay = terms.filter(Boolean).join(" ").toLowerCase();
  return q.every((w) => hay.includes(w));
}
export const useFiltering = () => !!words(useContext(Query)).length;

/**
 * Showing a property on request ("Edit cut length" in the drawing's menu, a missing takeout in the materials list):
 * the field registered under that name opens its section and tab, then takes focus. Fields register by their
 * accessible name and rows by their label, so nothing searches the page for them.
 */
export interface RevealRequest { name: string; seq: number; at: number }
export type RevealHub = Store<{ request: RevealRequest | null }>;
export const createRevealHub = (): RevealHub => createStore<{ request: RevealRequest | null }>({ request: null });
let revealSeq = 0;
/** Asks the inspector to show and focus the property called `name`. */
export const revealProperty = (hub: RevealHub, name: string) =>
  hub.set({ request: { name, seq: ++revealSeq, at: performance.now() } });
/** A request no field has answered within this long is dropped, so it cannot fire on a later selection. */
const REVEAL_TTL_MS = 1500;
const RevealContext = createContext<RevealHub | null>(null);
export const RevealProvider = RevealContext.Provider;
const SectionContext = createContext<{ open: () => void } | null>(null);
const PanelContext = createContext<{ show: () => void } | null>(null);
const idleHub = createRevealHub();
/** Registers a control under its names; returns the ref to put on the element that takes focus. */
export function useRevealTarget<T extends HTMLElement>(names: Array<string | undefined>, focusable?: (el: T) => HTMLElement | null): RefObject<T | null> {
  const hub = useContext(RevealContext), section = useContext(SectionContext), panel = useContext(PanelContext);
  const request = useStore(hub ?? idleHub, (s) => s.request);
  const ref = useRef<T | null>(null);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    if (!hub || !request || !names.includes(request.name)) return;
    // The first field to answer claims the request; a row and its input share a name.
    if (hub.get().request?.seq !== request.seq) return;
    hub.set({ request: null });
    if (performance.now() - request.at > REVEAL_TTL_MS) return;
    section?.open();
    panel?.show();
    setFocus(request.seq);
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!focus || !ref.current) return;
    const el = focusable ? focusable(ref.current) : ref.current;
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "nearest" });
    if (el instanceof HTMLInputElement && el.type !== "checkbox") el.select();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
const firstControl = (el: HTMLElement) => el.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button");

const OPEN_KEY = "spoolyard.inspector.sections";
const remembered = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};

/** A collapsible group. Its open state is kept per section across selections and sessions. */
export function Section({ id, title, summary, defaultOpen = false, children }: {
  id: string; title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const filtering = useFiltering();
  const [open, setOpen] = useState(() => remembered()[id] ?? defaultOpen);
  const shown = filtering || open;
  const toggle = () => {
    const next = !open, all = remembered();
    all[id] = next;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(all)); } catch { /* private mode */ }
  };
  const control = useRef({ open: () => undefined as void });
  control.current.open = () => { if (!open) toggle(); };
  return (
    <section className={cn("insp-section", shown && "is-open")} data-section={id}>
      <button type="button" className="insp-section-head" aria-expanded={shown} onClick={toggle} disabled={filtering}>
        <ChevronRight className="insp-chevron" size={13} aria-hidden />
        <span className="insp-section-title">{title}</span>
        {summary != null && summary !== "" && <span className="insp-section-summary">{summary}</span>}
      </button>
      <SectionContext.Provider value={control.current}>
        <div className="insp-section-body" hidden={!shown}>{children}</div>
      </SectionContext.Provider>
    </section>
  );
}

/** A labelled subgroup inside a section, for long sections such as offset drafting. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="insp-group">
      <div className="insp-group-title">{title}</div>
      {children}
    </div>
  );
}

/**
 * One property: label on the left, control on the right (stacked when the panel is narrow). A modified row shows a
 * dot, and a reset button when the value can return to automatic.
 */
export function Row({ label, keywords, hint, modified, onReset, group, stack, pair, children }: {
  label: string; keywords?: string; hint?: string; modified?: boolean; onReset?: () => void;
  /** Several controls (segmented buttons): a group, not a label wrapping one control. */
  group?: boolean; stack?: boolean;
  /** Two controls side by side under the columns of a `PairHead`, such as a pipe's start and end. */
  pair?: boolean; children: ReactNode;
}) {
  group ||= pair;
  const target = useRevealTarget<HTMLSpanElement>([label], firstControl);
  if (!useMatch(label, keywords, hint)) return null;
  const body = (
    <>
      <span className="insp-label" title={hint}>
        {label}
        {modified && <i className="insp-modified" title="Changed from automatic" />}
      </span>
      <span ref={target} className={cn("insp-control", pair && "is-pair")}>
        {children}
        {modified && onReset && (
          <button type="button" className="insp-reset" aria-label={`Reset ${label}`} title="Reset to automatic"
            onClick={(e) => { e.preventDefault(); onReset(); }}>
            <RotateCcw size={11} />
          </button>
        )}
      </span>
      {hint && <span className="insp-hint">{hint}</span>}
    </>
  );
  return group
    ? <div className={cn("insp-row", stack && "stack")} role="group" aria-label={label}>{body}</div>
    : <label className={cn("insp-row", stack && "stack")}>{body}</label>;
}

/** Column titles for the paired rows that follow. */
export function PairHead({ columns }: { columns: [string, string] }) {
  if (useFiltering()) return null;
  return (
    <div className="insp-row insp-pair-head" aria-hidden>
      <span />
      <span className="insp-control is-pair">{columns.map((c) => <span key={c}>{c}</span>)}</span>
    </div>
  );
}

/** A bare switch, for a paired row. */
export function Switch({ checked, onChange, aria }: { checked: boolean; onChange: (checked: boolean) => void; aria: string }) {
  return <span className="insp-switch"><input type="checkbox" role="switch" aria-label={aria} checked={checked} onChange={(e) => onChange(e.target.checked)} /></span>;
}

/** A yes/no property as a switch; the whole row is the target. */
export function Toggle({ label, checked, onChange, aria, keywords, hint }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; aria?: string; keywords?: string; hint?: string;
}) {
  const target = useRevealTarget<HTMLInputElement>([label, aria]);
  if (!useMatch(label, keywords, hint)) return null;
  return (
    <label className="insp-toggle" title={hint}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <input ref={target} type="checkbox" role="switch" aria-label={aria ?? label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export interface Choice<T extends string> { value: T; label: ReactNode; title?: string }
/** Two to four short, mutually exclusive choices, all visible at once. */
export function Segmented<T extends string>({ value, choices, onChange, aria }: {
  value: T; choices: Array<Choice<T>>; onChange: (value: T) => void; aria: string;
}) {
  return (
    <span className="insp-segmented" role="radiogroup" aria-label={aria}>
      {choices.map((c) => (
        <button type="button" role="radio" key={c.value} aria-checked={c.value === value} title={c.title}
          className={cn(c.value === value && "is-on")} onClick={() => c.value !== value && onChange(c.value)}>
          {c.label}
        </button>
      ))}
    </span>
  );
}

/** Explanatory text that only stays while the filter could be looking for it. */
export function Note({ children, tone, keywords }: { children: ReactNode; tone?: "warn"; keywords?: string }) {
  const filtering = useFiltering(), match = useMatch(keywords);
  if (filtering && (!keywords || !match)) return null;
  return <p className={cn("insp-note", tone && `is-${tone}`)}>{children}</p>;
}

/** Buttons that act on the selection, laid out in a row. */
export function Actions({ children, keywords }: { children: ReactNode; keywords?: string }) {
  const filtering = useFiltering(), match = useMatch(keywords);
  if (filtering && (!keywords || !match)) return null;
  return <div className="insp-actions">{children}</div>;
}

const editKeys = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, multiline?: boolean) => {
  if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) e.currentTarget.blur();
  if (e.key === "Escape") {
    // Esc puts the field back; it does not also clear the selection behind it.
    e.stopPropagation();
    e.currentTarget.value = e.currentTarget.defaultValue;
    e.currentTarget.blur();
  }
};

/** Text committed on blur or Enter, so typing is one undo step and the drawing redraws once; Escape restores it. */
export function TextInput({ value, onCommit, aria, placeholder, multiline, maxLength, trim, onError, list, title }: {
  value?: string; onCommit: (value: string) => void | boolean; aria: string; placeholder?: string; multiline?: boolean; maxLength?: number;
  /** Compare and commit the trimmed text. */
  trim?: boolean; onError?: (message: string) => void; list?: string; title?: string;
}) {
  const shown = value ?? "";
  const target = useRevealTarget<HTMLInputElement & HTMLTextAreaElement>([aria]);
  const props = {
    ref: target,
    "aria-label": aria,
    defaultValue: shown,
    placeholder,
    maxLength,
    title,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = trim ? e.target.value.trim() : e.target.value;
      if (next === (trim ? shown.trim() : shown)) return;
      if (maxLength != null && next.length > maxLength) {
        e.target.value = shown;
        onError?.(`${aria} is limited to ${maxLength} characters.`);
        return;
      }
      if (onCommit(next) === false) e.target.value = shown;
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => editKeys(e, multiline),
  };
  return multiline ? <textarea key={shown} rows={3} {...props} /> : <input key={shown} list={list} {...props} />;
}

/** A plain number; empty means automatic unless `required`. */
export function NumberInput({ value, onCommit, aria, min, max, placeholder, suffix, onError, required, integer, decimals = 4 }: {
  value?: number; onCommit: (value: number | undefined) => void | boolean; aria: string; min?: number; max?: number;
  placeholder?: string; suffix?: string; onError?: (message: string) => void; required?: boolean; integer?: boolean; decimals?: number;
}) {
  const shown = value == null || !Number.isFinite(value) ? "" : String(Math.round(value * 10 ** decimals) / 10 ** decimals);
  const target = useRevealTarget<HTMLInputElement>([aria]);
  return (
    <span className="insp-input-unit">
      <input ref={target} aria-label={aria} inputMode={integer ? "numeric" : "decimal"} key={shown} defaultValue={shown} placeholder={placeholder}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === shown) return;
          if (!raw) {
            if (required) {
              e.target.value = shown;
              onError?.(`Enter a number for ${aria.toLowerCase()}.`);
              return;
            }
            if (onCommit(undefined) === false) e.target.value = shown;
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || (min != null && n < min) || (max != null && n > max)) {
            e.target.value = shown;
            onError?.(`Enter ${integer ? "a whole number" : "a number"}${min != null ? ` from ${min}` : ""}${max != null ? ` to ${max}` : ""}.`);
            return;
          }
          if (onCommit(n) === false) e.target.value = shown;
        }}
        onKeyDown={(e) => editKeys(e)} />
      {suffix && <span className="insp-unit">{suffix}</span>}
    </span>
  );
}

const LENGTH_HELP = "Feet and inches or millimetres, for example 2' 3 1/2\", 12 in, or 100 mm.";
/** A length typed in the drawing's units (or any explicit unit); empty returns to the specification where allowed. */
export function LengthInput({ mm, units, aria, allowEmpty, placeholder, onCommit, onError, signed, positive, list, title, parse, precision = "drafting" }: {
  mm: number | undefined; units: IsoDocument["units"]; aria: string; allowEmpty?: boolean; placeholder?: string;
  onCommit: (mm: number | undefined) => void | boolean; onError: (message: string) => void;
  /** Reads what was typed (mm) where more than a plain length is accepted, e.g. a bend radius as "5D". */
  parse?: (raw: string) => number;
  /** Negative lengths are allowed (coordinates). */
  signed?: boolean;
  /** Zero is not allowed. */
  positive?: boolean;
  list?: string; title?: string;
  /** `fine` for small catalogue values (OD, wall, gaps, takeouts): decimal inches to 0.001″ unless an exact 1/16″. */
  precision?: LengthPrecision;
}) {
  const shown = mm == null || !Number.isFinite(mm) ? "" : lengthInputValue(mm, units, precision);
  const target = useRevealTarget<HTMLInputElement>([aria]);
  return (
    <input ref={target} aria-label={aria} title={title ?? LENGTH_HELP} key={shown + ":" + units} defaultValue={shown} list={list}
      placeholder={placeholder ?? (allowEmpty ? "From spec" : units === "imperial" ? '0"' : "0")}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === shown) return;
        try {
          if (!raw) {
            if (allowEmpty) onCommit(undefined);
            else e.target.value = shown;
            return;
          }
          const value = parse ? parse(raw) : editedLength(raw, mm, units, precision, signed);
          // Text that reads as the value already held commits nothing: a rounded readout never rewrites the model.
          if (value == null || (mm != null && Math.abs(value - mm) <= 0.001)) { e.target.value = shown; return; }
          if (!signed && !(value >= 0)) throw new Error("Enter a length of zero or more.");
          if (positive && !(value > 0)) throw new Error("Enter a length greater than zero.");
          if (onCommit(value) === false) e.target.value = shown;
        } catch (err) {
          e.target.value = shown;
          onError(err instanceof Error ? err.message : String(err));
        }
      }}
      onKeyDown={(e) => editKeys(e)} />
  );
}

/** A distance on the printed sheet, shown in paper millimetres or inches; commits sheet units. */
export function PaperInput({ sheet, paper, aria, onCommit, onError, allowEmpty, placeholder, min, max }: {
  sheet: number | undefined; paper: PaperUnits; aria: string; onCommit: (sheet: number | undefined) => void | boolean;
  onError: (message: string) => void; allowEmpty?: boolean; placeholder?: string;
  /** Limits in sheet units. */
  min?: number; max?: number;
}) {
  const value = sheet == null ? undefined : paper.length(sheet);
  return (
    <NumberInput aria={aria} value={value} decimals={paper.decimals} suffix={paper.unit} placeholder={placeholder ?? (allowEmpty ? "Automatic" : undefined)}
      required={!allowEmpty} onError={onError}
      min={min == null ? undefined : Number(paper.text(paper.length(min)))} max={max == null ? undefined : Number(paper.text(paper.length(max)))}
      onCommit={(v) => onCommit(v == null ? undefined : paper.sheet(v))} />
  );
}

/** A point on the printed sheet as X and Y from its lower-left corner; commits a sheet point. */
export function PaperPointInputs({ point, paper, aria, onCommit, onError }: {
  point: [number, number]; paper: PaperUnits; aria: string; onCommit: (sheet: [number, number]) => void | boolean; onError: (message: string) => void;
}) {
  const shown = paper.point(point);
  return (
    <>
      {([0, 1] as const).map((i) => (
        <NumberInput key={i} aria={`${aria} ${i ? "Y" : "X"}`} value={shown[i]} decimals={paper.decimals} suffix={paper.unit} required onError={onError}
          onCommit={(v) => {
            if (v == null) return false;
            const next: [number, number] = [...shown];
            next[i] = v;
            return onCommit(paper.fromPoint(next));
          }} />
      ))}
    </>
  );
}

/** A colour: previewed while the picker is open, committed once when it closes. */
export function ColorInput({ value, onCommit, aria }: { value: string; onCommit: (value: string) => void; aria: string }) {
  const [draft, setDraft] = useState(value);
  const ref = useRevealTarget<HTMLInputElement>([aria]);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React's onChange follows every movement of the picker; the native change event fires once it is closed.
    const change = () => { if (el.value !== value) onCommit(el.value); };
    el.addEventListener("change", change);
    return () => el.removeEventListener("change", change);
  }, [value, onCommit, ref]);
  return <input ref={ref} type="color" aria-label={aria} value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

/** The selection's key lengths, large and directly editable. */
export function Metrics({ children }: { children: ReactNode }) {
  return useFiltering() ? null : <div className="insp-metrics">{children}</div>;
}
export function Metric({ label, hint, modified, unit, children }: { label: string; hint?: string; modified?: boolean; unit?: string; children: ReactNode }) {
  return (
    <label className="insp-metric" title={hint}>
      <span>{label}{modified && <i className="insp-modified" title="Measured, not from the specification" />}</span>
      <span className="insp-metric-value">{children}{unit && <em>{unit}</em>}</span>
    </label>
  );
}

export type InspectorTab = "fabrication" | "annotation";
const Tab = createContext<InspectorTab>("fabrication");
const TabChooser = createContext<(tab: InspectorTab) => void>(() => undefined);
export const InspectorTabProvider = Tab.Provider;
export const InspectorTabChooser = TabChooser.Provider;
export const TAB_LABELS: Record<InspectorTab, string> = { fabrication: "Fabrication", annotation: "Annotation" };
/** What the selection is made of, and how the sheet draws it. Filtering searches both. */
export function Tabbed({ fabrication, annotation }: { fabrication: ReactNode; annotation: ReactNode }) {
  const tab = useContext(Tab), choose = useContext(TabChooser), filtering = useFiltering();
  const panels = useRef({ fabrication: { show: () => choose("fabrication") }, annotation: { show: () => choose("annotation") } });
  panels.current.fabrication.show = () => choose("fabrication");
  panels.current.annotation.show = () => choose("annotation");
  return (
    <>
      {(["fabrication", "annotation"] as const).map((t) => (
        <div key={t} role="tabpanel" id={`insp-panel-${t}`} aria-labelledby={`insp-tab-${t}`} data-tab={t}
          className="insp-panel" hidden={!filtering && tab !== t}>
          {filtering && <div className="insp-panel-title">{TAB_LABELS[t]}</div>}
          <PanelContext.Provider value={panels.current[t]}>{t === "fabrication" ? fabrication : annotation}</PanelContext.Provider>
        </div>
      ))}
    </>
  );
}

/** Shared choices, so every panel offers the same words for the same thing. */
export const tri = (v: boolean | undefined) => (v == null ? "" : String(v)) as "" | "true" | "false";
export const untri = (v: string) => (v === "" ? undefined : v === "true");

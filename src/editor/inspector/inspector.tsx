import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { AlertTriangle, CheckCircle2, ChevronUp, Info, Search, Trash2, X } from "lucide-react";
import { cn } from "../cn";
import { InspectorQuery, InspectorTabChooser, InspectorTabProvider, RevealProvider, TAB_LABELS, type InspectorTab, type RevealHub } from "./kit";
import "./inspector.css";

const TAB_KEY = "spoolyard.inspector.tab";
/**
 * A check as listed under the panel; one that names its subject can select it. Errors and warnings are fabrication
 * checks; notices say how the sheet was drafted (crowded, subdivided, a held end folded) and never block anything.
 */
export interface InspectorIssue { text: string; severity?: "error" | "warning" | "notice"; onSelect?: () => void }
/** Checks listed per group before "and N more". */
const CHECKS_SHOWN = 12;

export interface InspectorProps {
  ref?: Ref<HTMLElement>;
  hidden?: boolean;
  width?: number;
  /** Identity of what is shown: a glyph, a name and a line of context. */
  glyph?: ReactNode;
  title: string;
  subtitle?: string;
  /** Commands for the selection, beside its name. */
  actions?: ReactNode;
  onClose?: () => void;
  /** Deletes what is shown; labelled with what it is. */
  onDelete?: { label: string; action: () => void };
  /** Whether the content is split into Fabrication and Annotation tabs. */
  tabs?: boolean;
  /** Clears the property filter and tab-specific scroll whenever it changes. */
  subject: string;
  issues: InspectorIssue[];
  empty: boolean;
  /** Where the editor asks for a property to be shown and focused. */
  reveal: RevealHub;
  children: ReactNode;
}

/** The properties panel: a fixed identity header, tabs and a property filter, the selection's sections, and the checks. */
export function Inspector({ ref, hidden, width, glyph, title, subtitle, actions, onClose, onDelete, tabs, subject, issues, empty, reveal, children }: InspectorProps) {
  const own = useRef<HTMLElement | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<InspectorTab>(() => (localStorage.getItem(TAB_KEY) as InspectorTab) === "annotation" ? "annotation" : "fabrication");
  const [query, setQuery] = useState(""), [searching, setSearching] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const choose = (t: InspectorTab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ }
  };
  const closeSearch = () => { setQuery(""); setSearching(false); };
  useEffect(() => { setQuery(""); }, [subject]);
  useEffect(() => { if (searching) search.current?.focus(); }, [searching]);
  // A property asked for by name is never hidden by the filter.
  useEffect(() => reveal.subscribe(() => { if (reveal.get().request) closeSearch(); }), [reveal]);
  const bind = (el: HTMLElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLElement | null }).current = el;
  };
  const errors = issues.filter((i) => i.severity !== "warning" && i.severity !== "notice"), warnings = issues.filter((i) => i.severity === "warning");
  const notices = issues.filter((i) => i.severity === "notice");
  const count = (n: number, one: string, many = one + "s") => n ? `${n} ${n === 1 ? one : many}` : "";
  return (
    <aside ref={bind} className={cn("iso-inspector insp", hidden && "is-hidden")} style={{ width }} aria-label="Selection properties"
      onKeyDown={(e) => {
        const typing = (e.target as HTMLElement).closest("input, select, textarea");
        // A focused switch or choice button keeps Space, Delete and letter keys from reaching the drawing's shortcuts.
        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === " " || e.key === "Delete" || e.key === "Backspace" || e.key.length === 1)) e.stopPropagation();
        if (tabs && !typing && (e.key === "/" || (e.key === "f" && (e.metaKey || e.ctrlKey)))) { e.preventDefault(); setSearching(true); }
      }}>
      <header className="insp-header">
        <div className="insp-identity">
          {glyph && <span className="insp-glyph">{glyph}</span>}
          <span className="insp-name">
            <strong>{title}</strong>
            {subtitle && <small title={subtitle}>{subtitle}</small>}
          </span>
          {onDelete && <button type="button" className="insp-icon is-danger" aria-label={onDelete.label} title={`${onDelete.label} (Del)`} onClick={onDelete.action}><Trash2 size={14} /></button>}
          {onClose && <button type="button" className="insp-icon" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClose}><X size={14} /></button>}
        </div>
        {actions && <div className="insp-commands">{actions}</div>}
        {tabs && (
          <div className="insp-tabbar">
            {searching ? (
              <span className="insp-search">
                <Search size={13} aria-hidden />
                <input ref={search} type="search" aria-label="Find a property" placeholder="Find a property…" value={query}
                  onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeSearch(); } }} />
                <button type="button" className="insp-icon" aria-label="Close property search" onClick={closeSearch}><X size={13} /></button>
              </span>
            ) : (
              <>
                <span role="tablist" aria-label="Property groups" className="insp-tabs">
                  {(["fabrication", "annotation"] as const).map((t) => (
                    <button type="button" role="tab" key={t} id={`insp-tab-${t}`} aria-controls={`insp-panel-${t}`} aria-selected={tab === t}
                      className={cn(tab === t && "is-on")} onClick={() => choose(t)}
                      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); choose(t === "fabrication" ? "annotation" : "fabrication"); } }}>
                      {TAB_LABELS[t]}
                    </button>
                  ))}
                </span>
                <button type="button" className="insp-icon" aria-label="Find a property" title="Find a property (/)" onClick={() => setSearching(true)}><Search size={14} /></button>
              </>
            )}
          </div>
        )}
      </header>
      <RevealProvider value={reveal}>
        <InspectorTabChooser value={choose}>
          <InspectorTabProvider value={tab}>
            <InspectorQuery value={query}>
              <div className={cn("insp-body", query.trim() && "is-filtering")}>
                {children}
                {query.trim() && <p className="insp-no-match">No property matches “{query.trim()}”.</p>}
              </div>
            </InspectorQuery>
          </InspectorTabProvider>
        </InspectorTabChooser>
      </RevealProvider>
      <footer className={cn("insp-checks", errors.length ? "is-error" : warnings.length ? "is-warn" : empty ? "is-empty" : "is-ok")}>
        <button type="button" disabled={!issues.length} aria-expanded={issues.length ? checksOpen : undefined} onClick={() => setChecksOpen((v) => !v)}>
          {errors.length || warnings.length ? <AlertTriangle size={13} /> : notices.length ? <Info size={13} /> : <CheckCircle2 size={13} />}
          <span>
            {errors.length || warnings.length
              ? [count(errors.length, "error"), count(warnings.length, "warning"), count(notices.length, "drafting note")].filter(Boolean).join(" · ")
              : [empty ? "Nothing to check yet · draw a pipe" : "Ready for fabrication review", count(notices.length, "drafting note")].filter(Boolean).join(" · ")}
          </span>
          {!!issues.length && <ChevronUp size={13} className="insp-checks-chevron" />}
        </button>
        {checksOpen && !!issues.length && (
          <div className="insp-checks-list">
            {([["error", errors, "Errors · fix before cutting"], ["warning", warnings, "Warnings · confirm the assumption"], ["notice", notices, "Drafting notes · how this sheet was drawn"]] as const).map(([kind, list, title]) => list.length > 0 && (
              <section key={kind} className={`insp-checks-group is-${kind}`}>
                <h4>{title}</h4>
                <ul>
                  {list.slice(0, CHECKS_SHOWN).map((issue, i) => (
                    <li key={i}>{issue.onSelect ? <button type="button" className="insp-issue" onClick={issue.onSelect}>{issue.text}</button> : issue.text}</li>
                  ))}
                  {list.length > CHECKS_SHOWN && <li className="insp-more">and {list.length - CHECKS_SHOWN} more</li>}
                </ul>
              </section>
            ))}
          </div>
        )}
      </footer>
    </aside>
  );
}

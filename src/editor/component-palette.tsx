
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "./cn";
import { COMPONENT_CATEGORIES, COMPONENT_TYPES, type ComponentType } from "../core/components";
import type { CatalogItem, PipeSpec } from "../core/model";
import { ComponentGlyph } from "./component-glyph";
import { rowComponent } from "./spec-manager";

/** Bends and branches are created by routing; the palette inserts everything that sits on a straight pipe. */
export const insertable = (t: ComponentType) => !["pipe", "elbow90", "elbow45", "tee"].includes(t.kind) &&
  (t.ports === 2 || ['support', 'bolt', 'annotation'].includes(t.kind));

/** Every catalogue component, with the selected specification's rows for this size first. */
export function ComponentPalette({
  spec,
  nps,
  onInsert,
}: {
  spec: PipeSpec;
  nps: number;
  onInsert: (type: ComponentType, row?: CatalogItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const rowsByCode = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const f of spec.fittings)
      if (f.nps === nps) {
        const code = rowComponent(f)?.code;
        if (code) map.set(code, [...(map.get(code) ?? []), f]);
      }
    return map;
  }, [spec, nps]);
  const q = query.trim().toLowerCase();
  const groups = COMPONENT_CATEGORIES.map((c) => ({
    category: c,
    types: COMPONENT_TYPES.filter(
      (t) =>
        t.category === c.id &&
        insertable(t) &&
        (all || rowsByCode.has(t.code) || t.kind === "annotation") &&
        (!q || t.label.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)),
    ),
  })).filter((g) => g.types.length);
  return (
    <div className="iso-palette">
      <div className="iso-palette-search">
        <Search size={13} />
        <input aria-label="Find component" placeholder="Find component" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <label className="iso-check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Show components outside {spec.id} at {nps}″
      </label>
      {groups.map(({ category, types }) => (
        <div key={category.id} className="iso-palette-group">
          <span>{category.label}</span>
          {types.map((t) => {
            const rows = rowsByCode.get(t.code) ?? [];
            return rows.length > 1 ? (
              rows.map((row) => (
                <button key={row.id} title={row.description} onClick={() => onInsert(t, row)}>
                  <ComponentGlyph code={t.code} size={22} />
                  <span>
                    {t.label}
                    <small>
                      {[row.smallerNps ? nps + "×" + row.smallerNps + "″" : "", row.rating, row.schedule, row.description]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <button
                key={t.code}
                className={cn(!rows.length && t.kind !== "annotation" && "outside")}
                title={rows[0]?.description ?? t.description}
                onClick={() => onInsert(t, rows[0])}
              >
                <ComponentGlyph code={t.code} size={22} />
                <span>
                  {t.label}
                  <small>
                    {rows[0]
                      ? [rows[0].rating, rows[0].schedule, rows[0].description].filter(Boolean).join(" · ")
                      : t.kind === "annotation"
                        ? "Drawing symbol"
                        : "Not in specification · enter takeout"}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {!groups.length && <p className="iso-help">No components match.</p>}
    </div>
  );
}

/** The full component library: every type the catalogue knows, with its symbol and spec coverage. */
export function ComponentLibrary({ specs }: { specs: PipeSpec[] }) {
  const [query, setQuery] = useState("");
  const coverage = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of specs)
      for (const f of s.fittings) {
        const code = rowComponent(f)?.code;
        if (code) map.set(code, (map.get(code) ?? new Set()).add(s.id));
      }
    return map;
  }, [specs]);
  const q = query.trim().toLowerCase();
  return (
    <div className="iso-library">
      <div className="iso-library-head">
        <h2>Component library</h2>
        <span>{COMPONENT_TYPES.length} components and symbols</span>
        <div className="iso-palette-search">
          <Search size={13} />
          <input aria-label="Search library" placeholder="Search library" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {COMPONENT_CATEGORIES.map((c) => {
        const types = COMPONENT_TYPES.filter(
          (t) =>
            t.category === c.id &&
            (!q || [t.label, t.code, t.description].some((v) => v.toLowerCase().includes(q))),
        );
        if (!types.length) return null;
        return (
          <section key={c.id}>
            <h3>
              {c.label} <small>{types.length}</small>
            </h3>
            <div className="iso-library-grid">
              {types.map((t) => (
                <div key={t.code} className="iso-library-card" title={t.description}>
                  <ComponentGlyph code={t.code} size={58} />
                  <strong>{t.label}</strong>
                  <code>{t.code}</code>
                  <small>
                    {[t.endPrep, t.reducing ? "reducing" : "", t.ports ? t.ports + "-port" : ""].filter(Boolean).join(" · ")}
                  </small>
                  {coverage.get(t.code) && <em>In {[...coverage.get(t.code)!].join(", ")}</em>}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

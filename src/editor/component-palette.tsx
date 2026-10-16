
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "./cn";
import { COMPONENT_CATEGORIES, COMPONENT_TYPES, type ComponentType } from "../core/components";
import type { CatalogItem, PipeSpec } from "../core/model";
import { ComponentGlyph } from "./component-glyph";
import { rowComponent } from "./spec-manager";
import { standardRow } from "../core/standards";
import { specRating } from "../core/joints";
import { npsText } from "../core/format";
import { sized, sizeChoices, type SizeChoice } from "../core/component-position";

/** Bends, laterals and crosses are created by routing; the palette inserts what sits on a straight pipe, and tees. */
export const insertable = (t: ComponentType) => !["pipe", "elbow90", "elbow45", "gasket", "bolt"].includes(t.kind) &&
  (t.kind === "tee" ? t.ports === 3 && !/LAT$/.test(t.code) : t.ports === 2 || t.ports === 1 || ['support', 'annotation'].includes(t.kind));

/** A nominal size as drawn: 1/8″, 1 1/4″, 2 1/2″. */
export const inches = (nps: number) => npsText(nps) + "″";
/** What a size choice does on a pipe of `nps`: reduces or expands it, or the tee or olet branch it gives. */
export function sizeLabel(type: ComponentType, choice: SizeChoice, nps: number): string {
  if (type.kind === "reducer")
    return choice.to < nps ? `${inches(nps)} × ${inches(choice.to)} · reduces to ${inches(choice.to)}` : `${inches(choice.to)} × ${inches(nps)} · expands to ${inches(choice.to)}`;
  return `${inches(nps)} × ${inches(choice.to)}${type.kind === "olet" ? " branch" : choice.to === nps ? " equal" : ""}`;
}
/** Rows that would read the same in the palette are one choice. */
const rowKey = (f: CatalogItem) => JSON.stringify([f.smallerNps, f.rating, f.schedule, f.description, f.takeout]);

/** Every catalogue component, with the selected specification's rows for this size first. */
export function ComponentPalette({
  spec,
  nps,
  onInsert,
  armed,
}: {
  spec: PipeSpec;
  nps: number;
  onInsert: (type: ComponentType, row?: CatalogItem) => void;
  /** The component waiting for a pipe click, and the catalogue row it was chosen by. */
  armed?: { code: string; rowId?: string };
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const rowsByCode = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const f of spec.fittings)
      if (f.nps === nps) {
        const code = rowComponent(f)?.code, rows = map.get(code ?? "") ?? [];
        if (code && !rows.some((r) => rowKey(r) === rowKey(f))) map.set(code, [...rows, f]);
      }
    return map;
  }, [spec, nps]);
  // Reducers, tees and olets are one entry each; their size is chosen once the entry is picked.
  const choices = useMemo(() => new Map(COMPONENT_TYPES.filter((t) => sized(t) && insertable(t)).map((t) => [t.code, sizeChoices(spec, t, nps)])), [spec, nps]);
  const q = query.trim().toLowerCase();
  // Standard ASME components are always available at their standard dimensions.
  const standard = useMemo(() => new Set(COMPONENT_TYPES.filter(t => standardRow(t.code, nps, specRating(spec))).map(t => t.code)), [spec, nps]);
  const available = (t: ComponentType) => sized(t) ? !!choices.get(t.code)?.length : rowsByCode.has(t.code) || standard.has(t.code);
  const groups = COMPONENT_CATEGORIES.map((c) => ({
    category: c,
    types: COMPONENT_TYPES.filter(
      (t) =>
        t.category === c.id &&
        insertable(t) &&
        (all || available(t) || t.kind === "annotation" || t.kind === "support") &&
        (!q || t.label.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)),
    )
      // Catalogue codes that are the same component (two swage codes, two weld tags) are listed once.
      .filter((t, _, list) => {
        const same = list.filter((o) => o.label === t.label);
        return t === (same.find(available) ?? same[0]);
      }),
  })).filter((g) => g.types.length);
  const isArmed = (code: string, rowId?: string) => armed?.code === code && (rowId == null || armed.rowId === rowId);
  return (
    <div className="iso-palette">
      <div className="iso-palette-search">
        <Search size={13} />
        <input aria-label="Find component" placeholder="Find component" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <label className="iso-check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Show components outside {spec.id} at {inches(nps)}
      </label>
      {groups.map(({ category, types }) => (
        <div key={category.id} className="iso-palette-group">
          <span>{category.label}</span>
          {types.map((t) => {
            const rows = rowsByCode.get(t.code) ?? [], sizes = choices.get(t.code);
            if (sizes?.length) {
              const ends = [sizes[0], sizes.at(-1)!];
              return (
                <button key={t.code} title={t.description} className={cn(isArmed(t.code) && "armed")} onClick={() => onInsert(t)}>
                  <ComponentGlyph code={t.code} size={22} />
                  <span>
                    {t.label}
                    <small>
                      {t.kind === "reducer"
                        ? `${sizes.length} ${sizes.length === 1 ? "size" : "sizes"} · ${sizes.some((s) => s.to > nps) ? "reducing or expanding" : "reducing"}`
                        : sizes.length === 1
                          ? sizeLabel(t, sizes[0], nps)
                          : `${inches(nps)} × ${inches(Math.min(ends[0].to, ends[1].to))} to ${inches(Math.max(ends[0].to, ends[1].to))}${t.kind === "olet" ? " branch" : ""}`}
                    </small>
                  </span>
                </button>
              );
            }
            return rows.length > 1 ? (
              rows.map((row) => (
                <button
                  key={row.id}
                  title={row.description}
                  className={cn(isArmed(t.code, row.id) && "armed")}
                  onClick={() => onInsert(t, row)}
                >
                  <ComponentGlyph code={t.code} size={22} />
                  <span>
                    {t.label}
                    <small>
                      {[row.smallerNps ? inches(nps) + " × " + inches(row.smallerNps) : "", row.rating, row.schedule, row.description]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <button
                key={t.code}
                className={cn(!rows.length && !standard.has(t.code) && !["annotation", "support"].includes(t.kind) && "outside", isArmed(t.code) && "armed")}
                title={rows[0]?.description ?? t.description}
                onClick={() => onInsert(t, rows[0])}
              >
                <ComponentGlyph code={t.code} size={22} />
                <span>
                  {t.label}
                  <small>
                    {t.angle
                      ? "Angle body · click a 90° elbow"
                      : rows[0]
                      ? [rows[0].rating, rows[0].schedule, rows[0].description].filter(Boolean).join(" · ")
                      : t.kind === "annotation"
                        ? "Drawing symbol"
                        : standard.has(t.code)
                          ? "ASME standard dimensions"
                          : t.kind === "support" ? "Pipe support" : "Not in specification · enter takeout"}
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
export function ComponentLibrary({
  specs,
  onInsert,
}: {
  specs: PipeSpec[];
  onInsert?: (type: ComponentType) => void;
}) {
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
                  {insertable(t) ? (
                    <button type="button" className="iso-library-insert" onClick={() => onInsert?.(t)}>
                      Insert
                    </button>
                  ) : (
                    <small className="iso-library-note">Placed by routing</small>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

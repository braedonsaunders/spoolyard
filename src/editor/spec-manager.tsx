
import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, Copy, Download, FilePlus2, Loader2, Plus, Search, Trash2, Upload } from "lucide-react";
import { cn } from "./cn";
import { clone, getSpec, type CatalogItem, type IsoDocument, type PipeSpec } from "../core/model";
import { COMPONENT_CATEGORIES, COMPONENT_TYPES, type ComponentType } from "../core/components";
import { loadLibrarySpec, loadSpecIndex, namespaceSpec, uniqueSpecId, type LibrarySpecSummary } from "./library";
import { download } from "./download";
import { ComponentGlyph } from "./component-glyph";

type Commit = (edit: (d: IsoDocument) => void) => void;
const typeByCode = new Map(COMPONENT_TYPES.map((t) => [t.code, t]));
const GENERAL = "__general__",
  PIPE = "PIPE";

/** The component type behind a catalogue row; rows from older drawings fall back to their geometric kind. */
export function rowComponent(f: CatalogItem): ComponentType | undefined {
  return (f.component && typeByCode.get(f.component)) || COMPONENT_TYPES.find((t) => t.kind === f.kind);
}
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
const blankSpec = (doc: IsoDocument): PipeSpec => ({
  id: uniqueSpecId("SPEC", doc),
  name: "New specification",
  material: "Carbon steel",
  schedule: "STD",
  rating: "150#",
  service: "",
  revision: "0",
  parameters: {},
  rootGap: 3,
  density: 7850,
  pipeCostM: 0,
  pipeLaborHoursM: 0,
  weldHoursPerDiameterInch: 0,
  sizes: [{ nps: 2, od: 60.3, wall: 3.91, kgM: 5.44, schedule: "STD", description: "PIPE SMLS", material: "", shopField: "S" }],
  fittings: [],
});

export function SpecManager({
  doc,
  commit,
  onError,
  importSpecs,
}: {
  doc: IsoDocument;
  commit: Commit;
  onError: (message: string) => void;
  importSpecs: () => void;
}) {
  const [specId, setSpecId] = useState(doc.specs[0]?.id ?? "");
  const [component, setComponent] = useState(GENERAL);
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<LibrarySpecSummary[] | null>(null);
  const [adding, setAdding] = useState(false),
    [loading, setLoading] = useState("");
  const [picker, setPicker] = useState(false);
  const spec = doc.specs.find((s) => s.id === specId) ?? doc.specs[0];
  useEffect(() => {
    if (adding && !library)
      loadSpecIndex()
        .then(setLibrary)
        .catch((e) => onError(e.message));
  }, [adding, library, onError]);

  const groups = useMemo(() => {
    const byCode = new Map<string, CatalogItem[]>();
    for (const f of spec?.fittings ?? []) {
      const code = rowComponent(f)?.code ?? f.kind;
      byCode.set(code, [...(byCode.get(code) ?? []), f]);
    }
    const q = query.trim().toLowerCase();
    return COMPONENT_CATEGORIES.map((category) => ({
      category,
      items: [...byCode.entries()]
        .map(([code, rows]) => ({ type: typeByCode.get(code), code, rows }))
        .filter(({ type }) => (type?.category ?? "specialty") === category.id)
        .filter(({ type, code }) => !q || (type?.label ?? code).toLowerCase().includes(q) || code.toLowerCase().includes(q))
        .sort((a, b) => (a.type?.label ?? a.code).localeCompare(b.type?.label ?? b.code)),
    })).filter((g) => g.items.length);
  }, [spec, query]);

  if (!spec) return null;
  const edit = (change: (s: PipeSpec) => void) => commit((d) => change(getSpec(d, spec.id)));
  const rows = spec.fittings.filter((f) => (rowComponent(f)?.code ?? f.kind) === component);
  const type = typeByCode.get(component);
  const inUse = (id: string) => doc.runs.some((r) => r.specId === id);

  const addLibrary = async (slug: string) => {
    setLoading(slug);
    try {
      const next = await loadLibrarySpec(slug, doc);
      commit((d) => {
        d.specs.push(next);
      });
      setSpecId(next.id);
      setComponent(GENERAL);
      setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading("");
    }
  };
  const addRow = (code: string) => {
    const t = typeByCode.get(code)!;
    const nps = rows.at(-1)?.nps ?? spec.sizes[0]?.nps ?? 2;
    const row: CatalogItem = {
      id: spec.id + ":" + code + "-" + crypto.randomUUID().slice(0, 8),
      component: code,
      kind: t.kind === "pipe" || t.kind === "annotation" ? "support" : t.kind,
      nps,
      description: t.label.toUpperCase(),
      takeout: 0,
      takeoutMissing: true,
      rating: spec.rating,
      shopField: "S",
      material: "",
      source: "User defined",
    };
    edit((s) => {
      s.fittings.push(row);
    });
    setComponent(code);
    setPicker(false);
  };

  return (
    <div className="iso-specs">
      <aside className="iso-specs-list" aria-label="Specifications">
        <div className="iso-specs-heading">
          <strong>Specifications</strong>
          <button title="Add specification" aria-label="Add specification" onClick={() => setAdding((v) => !v)}>
            <Plus size={14} />
          </button>
        </div>
        {adding && (
          <div className="iso-specs-library">
            <button
              onClick={() => {
                const next = blankSpec(doc);
                commit((d) => {
                  d.specs.push(next);
                });
                setSpecId(next.id);
                setComponent(GENERAL);
                setAdding(false);
              }}
            >
              <FilePlus2 size={13} /> Blank specification
            </button>
            <button
              onClick={() => {
                const next = namespaceSpec(clone(spec), uniqueSpecId(spec.id + "-COPY", doc));
                next.name = spec.name + " (copy)";
                commit((d) => {
                  d.specs.push(next);
                });
                setSpecId(next.id);
                setAdding(false);
              }}
            >
              <Copy size={13} /> Duplicate {spec.id}
            </button>
            <button onClick={importSpecs}>
              <Upload size={13} /> Import JSON…
            </button>
            <span>Standard library</span>
            {!library ? (
              <p>
                <Loader2 size={12} className="animate-spin" /> Loading…
              </p>
            ) : (
              library.map((l) => (
                <button key={l.slug} disabled={!!loading} onClick={() => void addLibrary(l.slug)} title={l.service}>
                  {loading === l.slug ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />}
                  <span>
                    <b>{l.id}</b> {l.material} · {l.rating}
                    <small>
                      {l.service} · {l.rowCount} rows
                    </small>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        {doc.specs.map((s) => (
          <button
            key={s.id}
            className={cn("iso-spec-card", s.id === spec.id && "active")}
            onClick={() => {
              setSpecId(s.id);
              setComponent(GENERAL);
            }}
          >
            <b>{s.id}</b>
            <span>{s.name}</span>
            <small>
              {s.service || s.material} · {s.fittings.length + s.sizes.length} rows
              {inUse(s.id) ? " · in use" : ""}
            </small>
          </button>
        ))}
        <div className="iso-specs-footer">
          <button
            onClick={() =>
              download("piping-specifications.json", JSON.stringify(doc.specs, null, 2), "application/json")
            }
          >
            <Download size={13} /> Export all
          </button>
        </div>
      </aside>

      <nav className="iso-specs-components" aria-label="Components in specification">
        <label className="iso-specs-search">
          <Search size={13} />
          <input placeholder="Filter components" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className={cn(component === GENERAL && "active")} onClick={() => setComponent(GENERAL)}>
          General & parameters
        </button>
        <button className={cn(component === PIPE && "active")} onClick={() => setComponent(PIPE)}>
          <ComponentGlyph code={PIPE} />
          Pipe <small>{spec.sizes.length}</small>
        </button>
        {groups.map(({ category, items }) => (
          <div key={category.id}>
            <span>{category.label}</span>
            {items.map(({ code, type, rows }) => (
              <button key={code} className={cn(component === code && "active")} onClick={() => setComponent(code)}>
                <ComponentGlyph code={code} />
                {type?.label ?? code}
                <small>{rows.length}</small>
              </button>
            ))}
          </div>
        ))}
        <div className="iso-specs-add">
          <button onClick={() => setPicker((v) => !v)}>
            <Plus size={13} /> Add component <ChevronDown size={12} />
          </button>
          {picker && (
            <div className="iso-specs-picker">
              {COMPONENT_CATEGORIES.filter((c) => c.id !== "annotation" && c.id !== "pipe").map((c) => (
                <div key={c.id}>
                  <span>{c.label}</span>
                  {COMPONENT_TYPES.filter((t) => t.category === c.id).map((t) => (
                    <button key={t.code} onClick={() => addRow(t.code)}>
                      <ComponentGlyph code={t.code} />
                      {t.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </nav>

      <section className="iso-specs-detail">
        {component === GENERAL ? (
          <>
            <h2>
              {spec.id} · {spec.name}
            </h2>
            <div className="iso-specs-form">
              {(["name", "material", "service", "rating", "schedule", "revision"] as const).map((k) => (
                <label key={k} className="iso-field">
                  <span>{k}</span>
                  <input
                    aria-label={"Specification " + k}
                    value={spec[k] ?? ""}
                    onChange={(e) =>
                      edit((s) => {
                        s[k] = e.target.value;
                      })
                    }
                  />
                </label>
              ))}
              {(
                [
                  ["rootGap", "Butt-weld root gap (mm)"],
                  ["density", "Density (kg/m³)"],
                  ["pipeCostM", "Pipe cost per metre"],
                  ["pipeLaborHoursM", "Pipe labour h/m"],
                  ["weldHoursPerDiameterInch", "Weld hours per diameter-inch"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="iso-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    min="0"
                    value={spec[k]}
                    onChange={(e) =>
                      edit((s) => {
                        s[k] = Number(e.target.value);
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <h3>Parameters</h3>
            <table>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {Object.entries(spec.parameters ?? {}).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key.replace(/^.*\./, "")}</td>
                    <td>
                      <input
                        aria-label={key}
                        value={value}
                        onChange={(e) =>
                          edit((s) => {
                            s.parameters = { ...s.parameters, [key]: e.target.value };
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        aria-label={"Remove " + key}
                        onClick={() =>
                          edit((s) => {
                            const next = { ...s.parameters };
                            delete next[key];
                            s.parameters = next;
                          })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form
              className="iso-specs-inline"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget),
                  key = String(data.get("key") ?? "").trim();
                if (!key) return;
                edit((s) => {
                  s.parameters = { ...s.parameters, [key]: String(data.get("value") ?? "") };
                });
                e.currentTarget.reset();
              }}
            >
              <input name="key" placeholder="New parameter" aria-label="New parameter name" />
              <input name="value" placeholder="Value" aria-label="New parameter value" />
              <button type="submit">
                <Plus size={13} /> Add
              </button>
            </form>
            <div className="iso-specs-danger">
              <button
                disabled={doc.specs.length < 2 || inUse(spec.id)}
                title={inUse(spec.id) ? "Pipes in this drawing use this specification" : "Delete specification"}
                onClick={() => {
                  commit((d) => {
                    d.specs = d.specs.filter((s) => s.id !== spec.id);
                  });
                  setSpecId(doc.specs.find((s) => s.id !== spec.id)?.id ?? "");
                }}
              >
                <Trash2 size={13} /> Delete specification
              </button>
            </div>
          </>
        ) : component === PIPE ? (
          <>
            <h2>Pipe · {spec.id}</h2>
            <table>
              <thead>
                <tr>
                  {["NPS", "Schedule", "OD mm", "Wall mm", "kg/m", "Description", "Material", "Shop/field", ""].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {spec.sizes.map((z, i) => (
                  <tr key={z.nps + "-" + i}>
                    <td>
                      <NumberCell
                        value={z.nps}
                        label="NPS"
                        onChange={(v) =>
                          v &&
                          !spec.sizes.some((o, j) => j !== i && o.nps === v) &&
                          edit((s) => {
                            s.sizes[i].nps = v;
                          })
                        }
                      />
                    </td>
                    <td>
                      <TextCell value={z.schedule} label="Schedule" onChange={(v) => edit((s) => void (s.sizes[i].schedule = v))} />
                    </td>
                    {(["od", "wall", "kgM"] as const).map((k) => (
                      <td key={k}>
                        <NumberCell
                          value={z[k]}
                          label={k}
                          onChange={(v) => v && edit((s) => void (s.sizes[i][k] = v))}
                        />
                      </td>
                    ))}
                    <td>
                      <TextCell value={z.description} label="Description" onChange={(v) => edit((s) => void (s.sizes[i].description = v))} />
                    </td>
                    <td>
                      <TextCell value={z.material} label="Material" onChange={(v) => edit((s) => void (s.sizes[i].material = v))} />
                    </td>
                    <td>
                      <ShopField value={z.shopField} onChange={(v) => edit((s) => void (s.sizes[i].shopField = v))} />
                    </td>
                    <td>
                      <button
                        aria-label="Remove size"
                        disabled={spec.sizes.length < 2 || doc.runs.some((r) => r.specId === spec.id && r.nps === z.nps)}
                        onClick={() => edit((s) => void s.sizes.splice(i, 1))}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="iso-specs-addrow"
              onClick={() =>
                edit((s) => {
                  const last = s.sizes.at(-1)!;
                  let nps = Math.ceil(last.nps + 1);
                  while (s.sizes.some((z) => z.nps === nps)) nps++;
                  s.sizes.push({ ...last, nps });
                })
              }
            >
              <Plus size={13} /> Add size
            </button>
          </>
        ) : (
          <>
            <h2>
              <ComponentGlyph code={component} size={22} />
              {type?.label ?? component} · {spec.id}
              <small>{type?.description}</small>
            </h2>
            <table>
              <thead>
                <tr>
                  {[
                    "NPS",
                    ...(type?.reducing ? ["× NPS"] : []),
                    "Rating",
                    "Sch",
                    "S/F",
                    "Code",
                    "Description",
                    "Material",
                    "Manufacturer",
                    "Takeout mm",
                    ...(type?.kind === "tee" || type?.reducing ? ["Branch mm"] : []),
                    "Weight kg",
                    "Unit cost",
                    "",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const set = (change: (row: CatalogItem) => void) =>
                    edit((s) => change(s.fittings.find((x) => x.id === f.id)!));
                  return (
                    <tr key={f.id} className={cn(f.takeoutMissing && "missing")}>
                      <td>
                        <NumberCell value={f.nps} label="NPS" onChange={(v) => v && set((r) => void (r.nps = v))} />
                      </td>
                      {type?.reducing && (
                        <td>
                          <NumberCell
                            value={f.smallerNps}
                            label="Smaller NPS"
                            onChange={(v) => set((r) => void (r.smallerNps = v))}
                          />
                        </td>
                      )}
                      <td>
                        <TextCell value={f.rating} label="Rating" onChange={(v) => set((r) => void (r.rating = v))} />
                      </td>
                      <td>
                        <TextCell value={f.schedule} label="Schedule" onChange={(v) => set((r) => void (r.schedule = v))} />
                      </td>
                      <td>
                        <ShopField value={f.shopField} onChange={(v) => set((r) => void (r.shopField = v))} />
                      </td>
                      <td>
                        <TextCell value={f.partCode} label="Part code" onChange={(v) => set((r) => void (r.partCode = v))} />
                      </td>
                      <td className="wide">
                        <TextCell value={f.description} label="Description" onChange={(v) => set((r) => void (r.description = v))} />
                      </td>
                      <td className="mid">
                        <TextCell value={f.material} label="Material" onChange={(v) => set((r) => void (r.material = v))} />
                      </td>
                      <td className="mid">
                        <TextCell
                          value={f.manufacturer}
                          label="Manufacturer"
                          onChange={(v) => set((r) => void (r.manufacturer = v))}
                        />
                      </td>
                      <td>
                        <NumberCell
                          value={f.takeoutMissing ? undefined : f.takeout}
                          label="Takeout"
                          placeholder="—"
                          onChange={(v) =>
                            set((r) => {
                              r.takeout = v ?? 0;
                              r.takeoutMissing = v == null || undefined;
                            })
                          }
                        />
                      </td>
                      {(type?.kind === "tee" || type?.reducing) && (
                        <td>
                          <NumberCell
                            value={f.branchTakeout}
                            label="Branch takeout"
                            onChange={(v) => set((r) => void (r.branchTakeout = v))}
                          />
                        </td>
                      )}
                      <td>
                        <NumberCell value={f.weightKg} label="Weight" onChange={(v) => set((r) => void (r.weightKg = v))} />
                      </td>
                      <td>
                        <NumberCell value={f.unitCost} label="Unit cost" onChange={(v) => set((r) => void (r.unitCost = v))} />
                      </td>
                      <td className="iso-row-actions">
                        <button
                          aria-label="Duplicate row"
                          title="Duplicate row"
                          onClick={() =>
                            edit((s) => {
                              const i = s.fittings.findIndex((x) => x.id === f.id);
                              s.fittings.splice(i + 1, 0, {
                                ...clone(f),
                                id: s.id + ":" + (f.component ?? f.kind) + "-" + crypto.randomUUID().slice(0, 8),
                              });
                            })
                          }
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          aria-label="Remove row"
                          title={doc.nodes.some((n) => n.catalogId === f.id) ? "Used in this drawing" : "Remove row"}
                          disabled={doc.nodes.some((n) => n.catalogId === f.id)}
                          onClick={() => edit((s) => void (s.fittings = s.fittings.filter((x) => x.id !== f.id)))}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {type && (
              <button className="iso-specs-addrow" onClick={() => addRow(type.code)}>
                <Plus size={13} /> Add size row
              </button>
            )}
            {rows[0]?.source && <p className="iso-specs-source">Source: {rows[0].source}</p>}
          </>
        )}
      </section>
    </div>
  );
}

/** Inputs commit on blur so a typed value is one undo step and partial numbers never validate. */
function TextCell({ value, label, onChange }: { value?: string; label: string; onChange: (v: string) => void }) {
  return (
    <input
      key={value ?? ""}
      aria-label={label}
      defaultValue={value ?? ""}
      onBlur={(e) => e.target.value !== (value ?? "") && onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
function NumberCell({
  value,
  label,
  placeholder,
  onChange,
}: {
  value?: number;
  label: string;
  placeholder?: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <input
      key={String(value ?? "")}
      type="number"
      min="0"
      step="any"
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value ?? ""}
      onBlur={(e) => {
        const v = num(e.target.value);
        if (v !== value && (v == null || (Number.isFinite(v) && v >= 0))) onChange(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
function ShopField({ value, onChange }: { value?: "S" | "F"; onChange: (v: "S" | "F") => void }) {
  return (
    <select aria-label="Shop or field" value={value ?? "S"} onChange={(e) => onChange(e.target.value as "S" | "F")}>
      <option value="S">Shop</option>
      <option value="F">Field</option>
    </select>
  );
}


import { useEffect, useMemo, useState } from "react";
import { BookOpen, BookmarkCheck, BookmarkPlus, ChevronDown, Copy, Download, FilePlus2, Library, Loader2, Plus, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { cn } from "./cn";
import { clone, DEFAULT_SOCKET_GAP, getSpec, STARTER_ROOT_GAP, lengthInputValue, type CatalogItem, type IsoDocument, type PipeSpec } from "../core/model";
import { designValue, type SpecDesign, type SpecDesignField } from "../core/spec-design";
import { dnOf, npsOfDn, scheduleRanges, scheduleText, sizeFor, sizeHeader } from "../core/format";
import { COMPONENT_CATEGORIES, COMPONENT_TYPES, type ComponentType } from "../core/components";
import { loadLibrarySpec, loadSavedSpec, loadSpecIndex, namespaceSpec, uniqueSpecId, type LibrarySpecSummary } from "./library";
import { librarySpec, onSpecLibraryChange, specText, specLibrary, specLibraryChanged, type SavedSpecSummary } from "./spec-library";
import { download } from "./download";
import { ComponentGlyph } from "./component-glyph";
import { LengthInput, NumberInput, Row, Section, TextInput } from "./inspector/kit";

type Commit = (edit: (d: IsoDocument) => void) => void;
type Units = IsoDocument["units"];

/** Specifications store metric values (mm, kg, per metre); these show and accept them in the drawing's units. */
const KG_PER_LB = 0.45359237,
  M_PER_FT = 0.3048;
interface Measure {
  unit: string;
  decimals: number;
  show: (metric: number | undefined) => number | undefined;
  store: (shown: number) => number;
}
/** `factor` converts one displayed unit to the stored metric value. */
const measure = (unit: string, factor: number, decimals: number): Measure => ({
  unit,
  decimals,
  show: (metric) => (metric == null ? undefined : metric / factor),
  store: (shown) => shown * factor,
});
const massOf = (units: Units) => (units === "imperial" ? measure("lb", KG_PER_LB, 3) : measure("kg", 1, 3));
const linearMassOf = (units: Units) =>
  units === "imperial" ? measure("lb/ft", KG_PER_LB / M_PER_FT, 3) : measure("kg/m", 1, 3);
const densityOf = (units: Units) =>
  units === "imperial" ? measure("lb/ft³", KG_PER_LB / M_PER_FT ** 3, 2) : measure("kg/m³", 1, 1);
/** A rate per length of pipe (cost, labour hours): per foot is per metre × 0.3048. */
const perLengthOf = (units: Units, unit: string, decimals: number) =>
  units === "imperial" ? measure(`${unit}/ft`, 1 / M_PER_FT, decimals) : measure(`${unit}/m`, 1, decimals);

const typeByCode = new Map(COMPONENT_TYPES.map((t) => [t.code, t]));
const GENERAL = "__general__",
  PIPE = "PIPE";

/** Component types that share a name with another (two swage catalogues, C-SWAGE and C-SWG) are told apart by code. */
const SHARED_LABELS = new Set(COMPONENT_TYPES.map((t) => t.label).filter((label, i, all) => all.indexOf(label) !== i));
const typeLabel = (code: string, type = typeByCode.get(code)) =>
  !type ? code : SHARED_LABELS.has(type.label) ? `${type.label} (${type.code})` : type.label;
/** The component type behind a catalogue row; rows from older drawings fall back to their geometric kind. */
export function rowComponent(f: CatalogItem): ComponentType | undefined {
  return (f.component && typeByCode.get(f.component)) || COMPONENT_TYPES.find((t) => t.kind === f.kind);
}
const blankSpec = (doc: IsoDocument): PipeSpec => ({
  id: uniqueSpecId("SPEC", doc),
  name: "New specification",
  material: "Carbon steel",
  schedule: "STD",
  rating: "150#",
  service: "",
  revision: "0",
  parameters: {},
  rootGap: STARTER_ROOT_GAP,
  socketGap: 1.6,
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
  const [libraryError, setLibraryError] = useState(""),
    [libraryAttempt, setLibraryAttempt] = useState(0);
  const [adding, setAdding] = useState(false),
    [loading, setLoading] = useState("");
  const [picker, setPicker] = useState(false);
  const spec = doc.specs.find((s) => s.id === specId) ?? doc.specs[0];
  // The drafter's own library, and whether the specification shown is saved in it as it is now.
  const [saved, setSaved] = useState<SavedSpecSummary[] | null>(null),
    [savedError, setSavedError] = useState(""),
    [savedRevision, setSavedRevision] = useState(0),
    [savedCopy, setSavedCopy] = useState<string | null | undefined>(undefined),
    [saving, setSaving] = useState(false);
  useEffect(() => onSpecLibraryChange(() => setSavedRevision((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    specLibrary().list()
      .then((list) => { if (live) { setSaved(list); setSavedError(""); } })
      .catch((e) => live && setSavedError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [savedRevision]);
  useEffect(() => {
    let live = true;
    setSavedCopy(undefined);
    if (spec) specLibrary().get(spec.id).then((own) => live && setSavedCopy(own ? specText(own) : null)).catch(() => live && setSavedCopy(null));
    return () => { live = false; };
  }, [spec?.id, savedRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => {
    try { return spec ? specText(librarySpec(spec)) : ""; } catch { return ""; }
  }, [spec]);
  useEffect(() => {
    let live = true;
    loadSpecIndex()
      .then((index) => live && setLibrary(index))
      .catch((e) => live && setLibraryError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [libraryAttempt]);

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
        .sort((a, b) => typeLabel(a.code, a.type).localeCompare(typeLabel(b.code, b.type))),
    })).filter((g) => g.items.length);
  }, [spec, query]);

  if (!spec) return null;
  const edit = (change: (s: PipeSpec) => void) => commit((d) => change(getSpec(d, spec.id)));
  const rows = spec.fittings.filter((f) => (rowComponent(f)?.code ?? f.kind) === component);
  const type = typeByCode.get(component);
  const inUse = (id: string) => doc.runs.some((r) => r.specId === id);
  const units = doc.units,
    size = sizeHeader(doc);
  const mass = massOf(units),
    linearMass = linearMassOf(units),
    perLength = units === "imperial" ? "foot" : "metre";
  // Accessible names must tell rows apart; rows of one size are numbered.
  const rowSizes = rows.map((f) => sizeFor(doc, f.nps, f.smallerNps));
  const rowName = (i: number) =>
    rowSizes.filter((s) => s === rowSizes[i]).length > 1 ? `${rowSizes[i]} row ${i + 1}` : rowSizes[i];
  // Sizes are kept as NPS; a drawing in DN notation shows and takes them as DN (DN65, not 2.5). The notation is the
  // drawing's choice (Project profile), not its units: a metric drawing may well size its pipe in NPS.
  const sizeTitle = size === "DN"
    ? "Nominal diameter (DN), this drawing's size notation. Change it under Drawing setup › Project profile › Sizes written as."
    : "Nominal pipe size in inches (NPS), this drawing's size notation. For DN, choose it under Drawing setup › Project profile › Sizes written as.";
  const sizeNote = (
    <p className="iso-specs-note" title={sizeTitle}>
      Sizes in {size === "DN" ? "DN" : "NPS (inches)"}, as this drawing writes them
      {units === "mm" && size !== "DN" ? " · for DN, choose it under Drawing setup › Project profile › Sizes written as" : ""}.
    </p>
  );
  const shownSize = (nps: number | undefined) => (nps == null || size !== "DN" ? nps : dnOf(nps) ?? nps);
  /** What was typed in a size column as NPS; null (after saying why) when a DN has no standard NPS. */
  const readSize = (v: number | undefined): number | undefined | null => {
    if (v == null || size !== "DN") return v;
    const nps = npsOfDn(v);
    if (nps == null) onError(`DN${v} is not a standard nominal size. Enter a DN such as 15, 50 or 100.`);
    return nps ?? null;
  };
  /** Sizes must be positive; returning false puts the field back. */
  const positiveSize = (v: number | undefined) => {
    if (v != null && v > 0) return true;
    if (v != null) onError("Enter a size greater than zero.");
    return false;
  };

  /** Saves the specification shown to the drafter's library, replacing the copy kept under its id. */
  const saveToLibrary = async () => {
    setSaving(true);
    try {
      await specLibrary().put(spec);
      specLibraryChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const addSaved = async (id: string) => {
    setLoading("saved:" + id);
    try {
      const next = await loadSavedSpec(id, doc);
      commit((d) => {
        d.specs.push(next);
      });
      setSpecId(next.id);
      setComponent(GENERAL);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading("");
    }
  };
  /** Puts the library's copy in place of the drawing's (rows keep their ids, so placed components keep theirs). */
  const useSaved = async () => {
    try {
      const own = await specLibrary().get(spec.id);
      if (!own) return;
      commit((d) => {
        const i = d.specs.findIndex((s) => s.id === spec.id);
        if (i >= 0) d.specs[i] = namespaceSpec(clone(own), spec.id);
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const removeSaved = async (id: string) => {
    if (!window.confirm(`Remove specification ${id} from your library (${specLibrary().label})? Drawings that use it keep their own copy.`)) return;
    try {
      await specLibrary().remove(id);
      specLibraryChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const ownState = savedCopy === undefined ? "checking" : savedCopy === null ? "unsaved" : savedCopy === current ? "saved" : "changed";
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
              {s.service || s.material} · {scheduleRanges(s)} · {s.fittings.length + s.sizes.length} rows
              {inUse(s.id) ? " · in use" : ""}
            </small>
          </button>
        ))}
        <div className="iso-specs-library iso-specs-own" aria-label="My specification library">
          <span>My library · {specLibrary().label}</span>
          <div className="iso-specs-own-status">
            <small>
              {ownState === "saved" ? `${spec.id} is saved as it is here; new drawings start from it.`
                : ownState === "changed" ? `${spec.id} has changes not in your library.`
                  : ownState === "unsaved" ? `Save ${spec.id} to reuse your edits in new drawings.` : "Checking…"}
            </small>
            {ownState === "saved" ? (
              <button disabled title="Saved"><BookmarkCheck size={13} /> Saved</button>
            ) : (
              <button className="primary" disabled={saving || ownState === "checking"} onClick={() => void saveToLibrary()}
                title={`Keep ${spec.id} in your library (${specLibrary().label}), so new drawings and other drawings can use this version`}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />} {ownState === "changed" ? "Update library" : "Save to library"}
              </button>
            )}
            {ownState === "changed" && <button onClick={() => void useSaved()} title="Replace this drawing's copy with the one in your library"><RotateCcw size={13} /> Use library copy</button>}
          </div>
          {savedError ? <p role="alert">{savedError}</p> : !saved ? (
            <p><Loader2 size={12} className="animate-spin" /> Loading…</p>
          ) : !saved.length ? (
            <p>No specifications saved yet.</p>
          ) : (
            saved.map((l) => (
              <div key={l.id} className="iso-specs-own-row">
                <button disabled={!!loading || doc.specs.some((s) => s.id === l.id)} onClick={() => void addSaved(l.id)} title={l.name}>
                  {loading === "saved:" + l.id ? <Loader2 size={13} className="animate-spin" /> : <Library size={13} />}
                  <span>
                    <b>{l.id}</b> {l.material} · {l.rating}
                    <small>
                      {l.rowCount} rows · {doc.specs.some((s) => s.id === l.id) ? "in this drawing" : "add to drawing"} · saved {new Date(l.updatedAt).toLocaleDateString()}
                    </small>
                  </span>
                </button>
                <button aria-label={`Remove ${l.id} from my library`} title="Remove from my library" onClick={() => void removeSaved(l.id)}><Trash2 size={13} /></button>
              </div>
            ))
          )}
        </div>
        <div className="iso-specs-library">
          <span>Standard library</span>
          {libraryError ? (
            <div className="iso-specs-error" role="alert">
              <p>{libraryError}</p>
              <button
                onClick={() => {
                  setLibraryError("");
                  setLibraryAttempt((n) => n + 1);
                }}
              >
                <RotateCcw size={13} /> Retry
              </button>
            </div>
          ) : !library ? (
            <p>
              <Loader2 size={12} className="animate-spin" /> Loading…
            </p>
          ) : (
            library
              .filter((l) => !doc.specs.some((s) => s.id === l.id))
              .map((l) => (
                <button key={l.slug} disabled={!!loading} onClick={() => void addLibrary(l.slug)} title={l.service}>
                  {loading === l.slug ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />}
                  <span>
                    <b>{l.id}</b> {l.material} · {l.rating}
                    <small>
                      {l.service} · {l.rowCount} rows · add to drawing
                    </small>
                  </span>
                </button>
              ))
          )}
          {library && library.every((l) => doc.specs.some((s) => s.id === l.id)) && (
            <p>Every standard specification is in this drawing.</p>
          )}
        </div>
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
                {typeLabel(code, type)}
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
                      {typeLabel(t.code, t)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </nav>

      <section className="iso-specs-detail" key={spec.id}>
        {component === GENERAL ? (
          <>
            <h2>{spec.name.startsWith(spec.id + " ") ? spec.name : `${spec.id} · ${spec.name}`}</h2>
            <div className="iso-specs-form">
              {(["name", "material", "service", "rating", "schedule", "revision"] as const).map((k) => (
                <label key={k} className="iso-field" title={k === "schedule" ? `The specification's nominal schedule. Each pipe size is bought in its own schedule (Pipe): ${scheduleRanges(spec)}.` : undefined}>
                  <span>{k === "schedule" && scheduleRanges(spec) !== scheduleText(spec.schedule) ? `schedule · by size ${scheduleRanges(spec)}` : k}</span>
                  <TextInput
                    aria={"Specification " + k}
                    value={spec[k] ?? ""}
                    trim
                    onCommit={(v) => {
                      if (k === "name" && !v) {
                        onError("Enter a specification name.");
                        return false;
                      }
                      edit((s) => {
                        s[k] = v;
                      });
                    }}
                  />
                </label>
              ))}
              <label className="iso-field">
                <span>Butt-weld root gap</span>
                <LengthInput
                  aria="Butt-weld root gap"
                  mm={spec.rootGap}
                  units={units}
                  precision="fine"
                  onError={onError}
                  onCommit={(v) =>
                    v != null &&
                    edit((s) => {
                      s.rootGap = v;
                    })
                  }
                />
              </label>
              {(
                [
                  [
                    "socketGap",
                    "Socket-weld gap",
                    lengthInputValue(DEFAULT_SOCKET_GAP, units, "fine"),
                    'Empty allows 1/16" (1.6 mm) at each socket, with a fabrication warning.',
                  ],
                  ["minPipeLength", "Shortest pipe piece", lengthInputValue(50, units), "Empty uses 50 mm."],
                  [
                    "minWeldSpacing",
                    "Least weld spacing",
                    "1 D, at least 50 mm",
                    "Empty warns of welds closer than one pipe diameter, and never less than 50 mm.",
                  ],
                ] as const
              ).map(([k, label, placeholder, hint]) => (
                <label key={k} className="iso-field">
                  <span>{label}</span>
                  <LengthInput
                    aria={label}
                    mm={spec[k]}
                    units={units}
                    precision={k === "socketGap" ? "fine" : "drafting"}
                    allowEmpty
                    placeholder={placeholder}
                    onError={onError}
                    onCommit={(v) =>
                      edit((s) => {
                        // Unset is not zero: the core applies the standard allowance and review flags it.
                        if (v == null) delete s[k];
                        else s[k] = v;
                      })
                    }
                  />
                  <small className="iso-field-hint">{hint}</small>
                </label>
              ))}
              {(
                [
                  ["density", "Density", `Density (${densityOf(units).unit})`, densityOf(units)],
                  ["pipeCostM", "Pipe cost", `Pipe cost per ${perLength}`, perLengthOf(units, "", 2)],
                  ["pipeLaborHoursM", "Pipe labour", `Pipe labour hours per ${perLength}`, perLengthOf(units, "h", 4)],
                  ["weldHoursPerDiameterInch", "Weld hours per diameter-inch", "Weld hours per diameter-inch", measure("h", 1, 4)],
                ] as const
              ).map(([k, label, aria, m]) => (
                <label key={k} className="iso-field">
                  <span>{label}</span>
                  <NumberInput
                    aria={aria}
                    value={m.show(spec[k])}
                    decimals={m.decimals}
                    suffix={m.unit}
                    min={0}
                    required
                    onError={onError}
                    onCommit={(v) =>
                      v != null &&
                      edit((s) => {
                        s[k] = m.store(v);
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <DesignSection spec={spec} units={units} edit={edit} onError={onError} />
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
                      <TextInput
                        aria={`Value of ${key}`}
                        value={value}
                        onCommit={(v) =>
                          edit((s) => {
                            s.parameters = { ...s.parameters, [key]: v };
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
            {sizeNote}
            <table>
              <thead>
                <tr>
                  {[size, "Schedule", "OD", "Wall", "Weight / length", "Description", "Material", "Shop / field", ""].map(
                    (h) => (
                      <th key={h} title={h === size ? sizeTitle : undefined}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {spec.sizes.map((z, i) => {
                  const name = sizeFor(doc, z.nps);
                  return (
                    <tr key={z.nps + "-" + i}>
                      <td>
                        <NumberInput
                          aria={`${size} for ${name}`}
                          value={shownSize(z.nps)}
                          required
                          onError={onError}
                          onCommit={(typed) => {
                            const v = readSize(typed);
                            if (v === null || !positiveSize(v)) return false;
                            if (spec.sizes.some((o, j) => j !== i && o.nps === v)) {
                              onError(`${sizeFor(doc, v!)} is already in this specification.`);
                              return false;
                            }
                            edit((s) => {
                              s.sizes[i].nps = v!;
                            });
                          }}
                        />
                      </td>
                      <td>
                        <TextInput
                          aria={`Schedule for ${name}`}
                          value={z.schedule}
                          trim
                          onCommit={(v) => edit((s) => void (s.sizes[i].schedule = v))}
                        />
                      </td>
                      {(
                        [
                          ["od", "OD"],
                          ["wall", "Wall"],
                        ] as const
                      ).map(([k, label]) => (
                        <td key={k}>
                          <LengthInput
                            aria={`${label} for ${name}`}
                            mm={z[k]}
                            units={units}
                            precision="fine"
                            positive
                            onError={onError}
                            onCommit={(v) => v != null && edit((s) => void (s.sizes[i][k] = v))}
                          />
                        </td>
                      ))}
                      <td>
                        <NumberInput
                          aria={`Weight per length for ${name}`}
                          value={linearMass.show(z.kgM)}
                          decimals={linearMass.decimals}
                          suffix={linearMass.unit}
                          min={0}
                          required
                          onError={onError}
                          onCommit={(v) => v != null && edit((s) => void (s.sizes[i].kgM = linearMass.store(v)))}
                        />
                      </td>
                      <td>
                        <TextInput
                          aria={`Description for ${name}`}
                          value={z.description}
                          trim
                          onCommit={(v) => edit((s) => void (s.sizes[i].description = v))}
                        />
                      </td>
                      <td>
                        <TextInput
                          aria={`Material for ${name}`}
                          value={z.material}
                          trim
                          onCommit={(v) => edit((s) => void (s.sizes[i].material = v))}
                        />
                      </td>
                      <td>
                        <ShopField
                          aria={`Shop / field for ${name}`}
                          value={z.shopField}
                          onChange={(v) => edit((s) => void (s.sizes[i].shopField = v))}
                        />
                      </td>
                      <td>
                        <button
                          aria-label={`Remove ${name}`}
                          title="Remove size"
                          disabled={spec.sizes.length < 2 || doc.runs.some((r) => r.specId === spec.id && r.nps === z.nps)}
                          onClick={() => edit((s) => void s.sizes.splice(i, 1))}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
              {typeLabel(component, type)} · {spec.id}
              <small>{type?.description}</small>
            </h2>
            {sizeNote}
            <table>
              <thead>
                <tr>
                  {[
                    size,
                    ...(type?.reducing ? [`× ${size}`] : []),
                    "Rating",
                    "Schedule",
                    "Shop / field",
                    "Part code",
                    "Description",
                    "Material",
                    "Manufacturer",
                    "Takeout",
                    ...(type?.kind === "tee" || type?.reducing ? ["Branch takeout"] : []),
                    "Weight",
                    "Unit cost",
                    "",
                  ].map((h) => (
                    <th key={h} title={h === size || h === `× ${size}` ? sizeTitle : undefined}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((f, i) => {
                  const set = (change: (row: CatalogItem) => void) =>
                    edit((s) => change(s.fittings.find((x) => x.id === f.id)!));
                  const name = rowName(i);
                  const text = (label: string, value: string | undefined, assign: (r: CatalogItem, v: string) => void) => (
                    <TextInput aria={`${label} for ${name}`} value={value} trim onCommit={(v) => set((r) => assign(r, v))} />
                  );
                  return (
                    <tr key={f.id} className={cn(f.takeoutMissing && "missing")}>
                      <td>
                        <NumberInput
                          aria={`${size} for ${name}`}
                          value={shownSize(f.nps)}
                          required
                          onError={onError}
                          onCommit={(typed) => {
                            const v = readSize(typed);
                            if (v === null || !positiveSize(v)) return false;
                            set((r) => void (r.nps = v!));
                          }}
                        />
                      </td>
                      {type?.reducing && (
                        <td>
                          <NumberInput
                            aria={`Smaller ${size} for ${name}`}
                            value={shownSize(f.smallerNps)}
                            onError={onError}
                            onCommit={(typed) => {
                              const v = readSize(typed);
                              if (v === null || (v != null && !positiveSize(v))) return false;
                              set((r) => void (r.smallerNps = v));
                            }}
                          />
                        </td>
                      )}
                      <td>{text("Rating", f.rating, (r, v) => void (r.rating = v))}</td>
                      <td>{text("Schedule", f.schedule, (r, v) => void (r.schedule = v))}</td>
                      <td>
                        <ShopField
                          aria={`Shop / field for ${name}`}
                          value={f.shopField}
                          onChange={(v) => set((r) => void (r.shopField = v))}
                        />
                      </td>
                      <td>{text("Part code", f.partCode, (r, v) => void (r.partCode = v))}</td>
                      <td className="wide">{text("Description", f.description, (r, v) => void (r.description = v))}</td>
                      <td className="mid">{text("Material", f.material, (r, v) => void (r.material = v))}</td>
                      <td className="mid">{text("Manufacturer", f.manufacturer, (r, v) => void (r.manufacturer = v))}</td>
                      <td>
                        <LengthInput
                          aria={`Takeout for ${name}`}
                          mm={f.takeoutMissing ? undefined : f.takeout}
                          units={units}
                          precision="fine"
                          allowEmpty
                          placeholder="—"
                          onError={onError}
                          onCommit={(v) =>
                            set((r) => {
                              r.takeout = v ?? 0;
                              r.takeoutMissing = v == null || undefined;
                            })
                          }
                        />
                      </td>
                      {(type?.kind === "tee" || type?.reducing) && (
                        <td>
                          <LengthInput
                            aria={`Branch takeout for ${name}`}
                            mm={f.branchTakeout}
                            units={units}
                            precision="fine"
                            allowEmpty
                            placeholder="—"
                            onError={onError}
                            onCommit={(v) => set((r) => void (r.branchTakeout = v))}
                          />
                        </td>
                      )}
                      <td>
                        <NumberInput
                          aria={`Weight for ${name}`}
                          value={mass.show(f.weightKg)}
                          decimals={mass.decimals}
                          suffix={mass.unit}
                          min={0}
                          onError={onError}
                          onCommit={(v) => set((r) => void (r.weightKg = v == null ? undefined : mass.store(v)))}
                        />
                      </td>
                      <td>
                        <NumberInput
                          aria={`Unit cost for ${name}`}
                          value={f.unitCost}
                          decimals={2}
                          min={0}
                          onError={onError}
                          onCommit={(v) => set((r) => void (r.unitCost = v))}
                        />
                      </td>
                      <td className="iso-row-actions">
                        <button
                          aria-label={`Duplicate ${name}`}
                          title="Duplicate row"
                          onClick={() =>
                            edit((s) => {
                              const at = s.fittings.findIndex((x) => x.id === f.id);
                              s.fittings.splice(at + 1, 0, {
                                ...clone(f),
                                id: s.id + ":" + (f.component ?? f.kind) + "-" + crypto.randomUUID().slice(0, 8),
                              });
                            })
                          }
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          aria-label={`Remove ${name}`}
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

function ShopField({ value, onChange, aria }: { value?: "S" | "F"; onChange: (v: "S" | "F") => void; aria: string }) {
  return (
    <select aria-label={aria} value={value ?? "S"} onChange={(e) => onChange(e.target.value as "S" | "F")}>
      <option value="S">Shop</option>
      <option value="F">Field</option>
    </select>
  );
}

const NOT_SET = "Not set (assumed by the standards)";
type LengthField = "gasketThickness" | "nippleLength" | "slipOnSetBack" | "slipOnClearance";
type CountField = "lugBoltEngagement" | "lugBoltProjection";
type ChoiceField = Exclude<SpecDesignField, LengthField | CountField | "stubEndSchedule" | "oletSchedule">;
/** Mating flanges only: blinds, orifice sets and stub ends are not what a flanged port is bolted to. */
const MATING_FLANGES = COMPONENT_TYPES.filter((t) => t.kind === "flange" && t.code.startsWith("FLG-") && !t.code.endsWith("BL"));
const classes = (values: number[]) => values.map((v): [string, string] => [String(v), `Class ${v}`]);
const DESIGN_CHOICES: Array<{ field: ChoiceField; label: string; numeric?: boolean; options: Array<[string, string]> }> = [
  { field: "flangeClass", label: "Flange class", numeric: true, options: classes([150, 300, 600, 900, 1500, 2500]) },
  { field: "flangeFace", label: "Flange face", options: [["RF", "Raised face (RF)"], ["FF", "Flat face (FF)"]] },
  { field: "forgedClass", label: "Forged fitting class", numeric: true, options: classes([2000, 3000, 6000, 9000]) },
  { field: "boltType", label: "Bolting", options: [["stud", "Stud bolts"], ["machine", "Machine bolts"]] },
  { field: "ballValvePattern", label: "Ball valve pattern (B16.10)", options: [["long", "Long pattern"], ["short", "Short pattern"]] },
  {
    field: "plugValvePattern",
    label: "Plug valve pattern",
    options: [["short", "Short pattern"], ["regular", "Regular pattern"], ["venturi", "Venturi pattern"]],
  },
  { field: "butterflyBody", label: "Butterfly body", options: [["wafer", "Wafer"], ["lug", "Lug"], ["double-flanged", "Double-flanged"]] },
  { field: "butterflyCategory", label: "Butterfly category (API 609)", options: [["A", "A, concentric"], ["B", "B, offset seat"]] },
  { field: "defaultFlange", label: "Default mating flange", options: MATING_FLANGES.map((t) => [t.code, t.label]) },
];
const DESIGN_LENGTHS: Array<{ field: LengthField; label: string; below: number; unset?: string }> = [
  { field: "gasketThickness", label: "Gasket thickness", below: 50 },
  { field: "nippleLength", label: "Nipple length", below: 10000 },
  { field: "slipOnSetBack", label: "Slip-on set-back", below: 100, unset: "Lesser of pipe wall and 1/4 in (B31.3)" },
  { field: "slipOnClearance", label: "Slip-on extra clearance", below: 50, unset: "None" },
];
/** Lug bolting without a specification lug-bolt row (standards.ts `lugBolt`). */
const DESIGN_COUNTS: Array<{ field: CountField; label: string; min: number; max: number; integer?: boolean; suffix: string; unset: string }> = [
  { field: "lugBoltEngagement", label: "Lug-bolt engagement", min: 0.25, max: 5, suffix: "x dia.", unset: "1 x bolt diameter" },
  { field: "lugBoltProjection", label: "Lug-stud projection", min: 0, max: 20, integer: true, suffix: "threads", unset: "2 threads beyond the nut" },
];
const DESIGN_SCHEDULES: Array<{ field: "stubEndSchedule" | "oletSchedule"; label: string }> = [
  { field: "stubEndSchedule", label: "Stub-end wall" },
  { field: "oletSchedule", label: "Olet weight" },
];

/**
 * The specification's typed design parameters. An unset field shows what is in effect instead: a legacy free-form
 * parameter that maps to it, or the standards' assumption.
 */
function DesignSection({ spec, units, edit, onError }: {
  spec: PipeSpec; units: Units; edit: (change: (s: PipeSpec) => void) => void; onError: (message: string) => void;
}) {
  const set = <K extends SpecDesignField>(field: K, value: SpecDesign[K] | undefined) =>
    edit((s) => {
      const next: SpecDesign = { ...s.design };
      if (value == null || value === "") delete next[field];
      else next[field] = value;
      if (Object.keys(next).length) s.design = next;
      else delete s.design;
    });
  /** The value in effect when the typed field is unset, and where it comes from. */
  const inherited = <K extends SpecDesignField>(field: K): { value?: NonNullable<SpecDesign[K]>; hint?: string } => {
    if (spec.design?.[field] != null) return {};
    const found = designValue(spec, field);
    return { value: found.value, hint: found.source && `From ${found.source}` };
  };
  const count = Object.values(spec.design ?? {}).filter((v) => v != null && v !== "").length;
  return (
    <div className="insp iso-specs-design">
      <Section id="spec-design" title="Design" summary={count ? `${count} set` : "Not set"} defaultOpen>
        {DESIGN_CHOICES.map(({ field, label, numeric, options }) => {
          const own = spec.design?.[field], legacy = inherited(field);
          const shown = (v: unknown) => options.find(([o]) => o === String(v))?.[1] ?? String(v);
          return (
            <Row key={field} label={label} hint={legacy.hint} modified={own != null} onReset={() => set(field, undefined)}>
              <select
                aria-label={label}
                value={own == null ? "" : String(own)}
                onChange={(e) => {
                  const v = e.target.value;
                  set(field, (v === "" ? undefined : numeric ? Number(v) : v) as SpecDesign[typeof field]);
                }}
              >
                <option value="">{legacy.value != null ? `From parameter: ${shown(legacy.value)}` : NOT_SET}</option>
                {options.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </Row>
          );
        })}
        {DESIGN_LENGTHS.map(({ field, label, below, unset }) => {
          const legacy = inherited(field);
          return (
            <Row key={field} label={label} hint={legacy.hint} modified={spec.design?.[field] != null} onReset={() => set(field, undefined)}>
              <LengthInput
                aria={label}
                mm={spec.design?.[field]}
                units={units}
                precision={field !== "nippleLength" ? "fine" : "drafting"}
                allowEmpty
                positive
                placeholder={legacy.value != null ? lengthInputValue(legacy.value, units, field !== "nippleLength" ? "fine" : "drafting") : unset ?? NOT_SET}
                onError={onError}
                onCommit={(v) => {
                  if (v != null && v >= below) {
                    onError(`Enter a ${label.toLowerCase()} less than ${lengthInputValue(below, units)}.`);
                    return false;
                  }
                  set(field, v);
                }}
              />
            </Row>
          );
        })}
        {DESIGN_COUNTS.map(({ field, label, min, max, integer, suffix, unset }) => (
          <Row key={field} label={label} modified={spec.design?.[field] != null} onReset={() => set(field, undefined)}>
            <NumberInput aria={label} value={spec.design?.[field]} min={min} max={max} integer={integer} suffix={suffix} placeholder={unset}
              onError={onError} onCommit={(v) => set(field, v)} />
          </Row>
        ))}
        {DESIGN_SCHEDULES.map(({ field, label }) => {
          const own = spec.design?.[field], legacy = inherited(field);
          return (
            <Row key={field} label={label} hint={legacy.hint} modified={own != null} onReset={() => set(field, undefined)}>
              <TextInput
                aria={label}
                value={own}
                trim
                maxLength={20}
                placeholder={legacy.value ?? NOT_SET}
                onError={onError}
                onCommit={(v) => {
                  const next = v.toUpperCase();
                  // "xs" for "XS" changes nothing; put the field back rather than record an empty step.
                  if (next === (own ?? "")) return false;
                  set(field, next || undefined);
                }}
              />
            </Row>
          );
        })}
      </Section>
    </div>
  );
}

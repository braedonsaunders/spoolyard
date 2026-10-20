import { useEffect, useState } from "react";
import { clone, parseIsoJson, newIso, type PipeSpec } from "../core/model";

/**
 * The drafter's own specification library: specifications refined over time and reused by every new drawing, kept
 * apart from the drawings that embed copies of them. Where it is kept depends on where Spoolyard runs:
 *  - in the browser and the desktop app, on this device (IndexedDB, which the desktop app keeps in its profile);
 *  - embedded in a host such as BidWright, by the host (its organisation's library), when the host offers one.
 * A specification is keyed by its id: saving one under an id already in the library replaces it (a new revision).
 */
export interface SavedSpecSummary {
  id: string;
  name: string;
  material: string;
  service: string;
  rating: string;
  revision: string;
  rowCount: number;
  updatedAt: number;
}
export interface SpecLibraryStore {
  /** Where the library is kept, as the editor says it: "this device", "BidWright". */
  label: string;
  list(): Promise<SavedSpecSummary[]>;
  get(id: string): Promise<PipeSpec | undefined>;
  put(spec: PipeSpec): Promise<SavedSpecSummary>;
  remove(id: string): Promise<void>;
}

export function summaryOf(spec: PipeSpec, updatedAt = Date.now()): SavedSpecSummary {
  return {
    id: spec.id,
    name: spec.name,
    material: spec.material,
    service: spec.service ?? "",
    rating: spec.rating,
    revision: spec.revision ?? "",
    rowCount: spec.fittings.length + spec.sizes.length,
    updatedAt,
  };
}

/**
 * A specification as the library keeps it: validated as a drawing would read it, and with its catalogue ids
 * namespaced by its own id, so it embeds in any drawing as it is.
 */
export function librarySpec(spec: PipeSpec): PipeSpec {
  const doc = newIso();
  doc.specs = [clone(spec)];
  const checked = parseIsoJson(JSON.stringify(doc)).specs[0];
  const strip = (key: string) => key.replace(/^[^:/]*[:/]/, "");
  return { ...checked, fittings: checked.fittings.map((f) => ({ ...f, id: checked.id + ":" + strip(f.id) })) };
}

/** A specification as text that does not depend on key order (a host's database may reorder keys): to compare copies. */
export function specText(spec: PipeSpec): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(spec));
}

// --- On this device ------------------------------------------------------------------------------------------------
interface StoredSpec extends SavedSpecSummary { spec: PipeSpec }
const DB = "spoolyard-specifications";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("specs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The specification library on this device could not open."));
  });
async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    try {
      const transaction = db.transaction("specs", mode);
      const request = body(transaction.objectStore("specs"));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? request.error ?? new Error("The specification library on this device could not be saved."));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}
const strip = ({ spec: _spec, ...summary }: StoredSpec): SavedSpecSummary => summary;
export const deviceSpecLibrary: SpecLibraryStore = {
  label: "this device",
  list: async () => (await run<StoredSpec[]>("readonly", (s) => s.getAll())).map(strip).sort((a, b) => a.id.localeCompare(b.id)),
  get: async (id) => (await run<StoredSpec | undefined>("readonly", (s) => s.get(id)))?.spec,
  put: async (spec) => {
    const kept = librarySpec(spec), summary = summaryOf(kept);
    await run("readwrite", (s) => s.put({ ...summary, spec: kept }));
    return summary;
  },
  remove: (id) => run("readwrite", (s) => s.delete(id)).then(() => undefined),
};

// --- Kept by a host --------------------------------------------------------------------------------------------------
/**
 * A host that keeps the library (BidWright: its organisation's piping specifications) answers library requests:
 *   → host:  { source: "spoolyard", type: "spoolyard:library", id, op: "list" | "get" | "put" | "remove", specId?, spec? }
 *   ← host:  { source: "spoolyard-host", type: "spoolyard:library-result", id, ok, result?, error? }
 * and says so by sending { type: "spoolyard:capabilities", library: { label } } in answer to spoolyard:ready.
 */
export function hostSpecLibrary(post: (message: Record<string, unknown>) => void, label: string) {
  const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const ask = <T,>(op: string, extra: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        if (waiting.delete(id)) reject(new Error(`${label} did not answer. The specification library is unavailable; try again.`));
      }, 30000);
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      post({ type: "spoolyard:library", id, op, ...extra });
    });
  const store: SpecLibraryStore = {
    label,
    list: () => ask<SavedSpecSummary[]>("list"),
    get: (specId) => ask<PipeSpec | undefined>("get", { specId }),
    put: (spec) => {
      const kept = librarySpec(spec);
      return ask<SavedSpecSummary>("put", { spec: kept, summary: summaryOf(kept) });
    },
    remove: (specId) => ask<void>("remove", { specId }),
  };
  /** Settles a request with the host's answer; returns whether the message was one. */
  const settle = (data: { id?: string; ok?: boolean; result?: unknown; error?: string }) => {
    const waiter = waiting.get(data.id ?? "");
    if (!waiter) return false;
    waiting.delete(data.id!);
    clearTimeout(waiter.timer);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error || "The specification library could not be reached."));
    return true;
  };
  const dispose = () => {
    for (const w of waiting.values()) clearTimeout(w.timer);
    waiting.clear();
  };
  return { store, settle, dispose };
}

// --- The library in use ------------------------------------------------------------------------------------------------
let active: SpecLibraryStore = deviceSpecLibrary;
const listeners = new Set<() => void>();
/** The library this session uses: the host's when it keeps one, else this device's. */
export const specLibrary = () => active;
export function setSpecLibraryStore(store: SpecLibraryStore | null) {
  active = store ?? deviceSpecLibrary;
  for (const l of listeners) l();
}
/** Called when the library in use changes (a host announced its own), or a specification was saved or removed. */
export function onSpecLibraryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function specLibraryChanged() {
  for (const l of listeners) l();
}

/** The specifications in the drafter's library, kept current as it changes; empty while loading or unavailable. */
export function useSavedSpecs(): SavedSpecSummary[] {
  const [list, setList] = useState<SavedSpecSummary[]>([]), [revision, setRevision] = useState(0);
  useEffect(() => onSpecLibraryChange(() => setRevision((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    specLibrary().list().then((l) => live && setList(l)).catch(() => live && setList([]));
    return () => { live = false; };
  }, [revision]);
  return list;
}

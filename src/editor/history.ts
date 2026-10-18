/**
 * Undo and redo for the editor. Each entry keeps the document as it was before an edit and what was selected then,
 * so undo puts the selection back with the drawing. Consecutive edits made under the same key (arrow-key nudges of
 * one label, a colour picker being dragged, one field stepped repeatedly) within a short pause are one entry.
 */
export interface HistoryEntry<D, S> {
  doc: D;
  selection: S;
  key?: string;
  at: number;
}

/** Edits under one key closer together than this are one undo step. */
export const COALESCE_MS = 1200;
export const HISTORY_LIMIT = 100;

export class EditHistory<D, S> {
  private past: Array<HistoryEntry<D, S>> = [];
  private future: Array<HistoryEntry<D, S>> = [];
  constructor(private limit = HISTORY_LIMIT, private window = COALESCE_MS) {}

  get undoCount() { return this.past.length; }
  get redoCount() { return this.future.length; }

  /**
   * Records that `previous` (with `selection`) is being replaced. With a `key` equal to the last entry's and inside
   * the coalescing window, the earlier entry stands for both edits.
   */
  record(previous: D, selection: S, key?: string, now = Date.now()) {
    const last = this.past.at(-1);
    this.future = [];
    if (key && last && last.key === key && now - last.at <= this.window) {
      last.at = now;
      return;
    }
    this.past.push({ doc: previous, selection, key, at: now });
    if (this.past.length > this.limit) this.past.shift();
  }

  /** Ends any coalescing run, so the next keyed edit starts its own entry. */
  seal() {
    const last = this.past.at(-1);
    if (last) last.key = undefined;
  }

  /** Steps back (or forward), keeping `current` for the other direction; undefined when there is nothing to step to. */
  step(forward: boolean, current: D, selection: S): HistoryEntry<D, S> | undefined {
    const from = forward ? this.future : this.past, to = forward ? this.past : this.future;
    const next = from.pop();
    if (!next) return undefined;
    to.push({ doc: current, selection, at: 0 });
    // An edit after undo or redo is a step of its own, even under the key of the entry now on top.
    this.seal();
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}

const serialised = new WeakMap<object, string>();
/** A document's JSON, cached per object: documents are replaced, never mutated, once committed. */
export function serialise(doc: object): string {
  let text = serialised.get(doc);
  if (text == null) serialised.set(doc, (text = JSON.stringify(doc)));
  return text;
}
/** Records the JSON already made for a document, so it is not serialised again. */
export function remember(doc: object, text: string) {
  serialised.set(doc, text);
}

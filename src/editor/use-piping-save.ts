import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { IsoDocument } from "../core/model";
import { serialise } from "./history";
import { SaveQueue } from "./save-queue";

export type SaveStatus = "opening" | "saved" | "unsaved" | "saving" | "error";
/**
 * Where Save writes: the drawing's file on disk; this browser's drawing library (there is no file to write back to);
 * or the host application the editor is embedded in.
 */
export type SaveTarget = "disk" | "browser" | "host";
/** What writing the file came to: written, the Save As dialog closed, or (without file access) a download. */
export type FileSaveResult = "saved" | "cancelled" | "downloaded";
/** Pause after the last edit before a copy is kept. */
export const AUTOSAVE_MS = 700;

const commitField = () => flushSync(() => (document.activeElement as HTMLElement | null)?.blur());

/**
 * Saving. Edits are kept after a short pause through `autosave`. For a drawing with a file that is a recovery copy:
 * the file itself is written only by Save (Ctrl/⌘+S), never behind the drafter's back. Without a file (the browser
 * library, or a host) the autosave is the save. A freshly created drawing (`isNew`) is kept as soon as it opens.
 * Documents are serialised when a copy is written, not on every render.
 */
export function usePipingSave(doc: IsoDocument, ready: boolean, options: {
  autosave: (content: string) => Promise<void>;
  saveFile?: (content: string, saveAs: boolean) => Promise<FileSaveResult>;
  target: SaveTarget;
  isNew?: boolean;
  /** Opened from a recovery copy holding changes the file does not have. */
  unsavedOnOpen?: boolean;
}) {
  const { autosave, isNew = false, unsavedOnOpen = false } = options;
  const [status, setStatus] = useState<SaveStatus>("opening");
  const [error, setError] = useState("");
  const state = useRef({
    copy: new SaveQueue(autosave),
    /** What the file holds, once known; null when it holds less than the drawing (a recovered copy). */
    fileSaved: null as string | null,
    filing: null as Promise<void> | null,
    mounted: true,
    ready,
    doc,
    options,
  });
  const s = state.current;
  s.copy.write = autosave;
  s.ready = ready;
  s.doc = doc;
  s.options = options;
  const fileDirty = useCallback(() => {
    const { options, fileSaved, doc } = state.current;
    return options.target === "disk" && serialise(doc) !== fileSaved;
  }, []);
  const settle = useCallback(() => {
    const { copy, filing, doc, options, mounted } = state.current;
    if (!mounted) return;
    if (copy.saving || filing) return setStatus("saving");
    if (options.target === "disk") return setStatus(fileDirty() ? "unsaved" : "saved");
    setStatus(copy.dirty || serialise(doc) !== copy.saved ? "unsaved" : "saved");
  }, [fileDirty]);

  /** Writes the copy (recovery copy, browser library or host) now. */
  const flush = useCallback((): Promise<void> => {
    const { copy, ready } = state.current;
    if (!ready) return Promise.resolve();
    copy.content = serialise(state.current.doc);
    if (!copy.dirty) return copy.flush().then(settle);
    if (state.current.mounted) { setStatus("saving"); setError(""); }
    return copy.flush().then(settle, (e) => {
      if (state.current.mounted) {
        setStatus("error");
        setError(e instanceof Error ? `The drawing could not be kept: ${e.message}` : "The drawing could not be kept.");
      }
      throw e;
    });
  }, [settle]);

  const writeFile = useCallback(async (saveAs: boolean): Promise<FileSaveResult> => {
    const st = state.current, saveFile = st.options.saveFile;
    if (!saveFile) throw new Error("This drawing has no file to save to.");
    while (st.filing) await st.filing.catch(() => undefined);
    const content = serialise(st.doc);
    let result = "cancelled" as FileSaveResult;
    st.filing = (async () => { result = await saveFile(content, saveAs); })();
    setStatus("saving");
    setError("");
    try {
      await st.filing;
      if (result === "saved") st.fileSaved = content;
    } catch (e) {
      if (st.mounted) {
        setStatus("error");
        setError(e instanceof Error ? `Save failed: ${e.message}` : "Save failed.");
      }
      throw e;
    } finally {
      st.filing = null;
    }
    await flush().catch(() => undefined);
    settle();
    return result;
  }, [flush, settle]);

  /**
   * The host confirmed `content` after the write had been given up as failed (a late confirmation): it is kept, the
   * error is cleared, and the status says whether edits made since still wait to be kept.
   */
  const acknowledge = useCallback((content: string) => {
    const { copy, mounted } = state.current;
    // A newer write is under way; it reports for itself.
    if (!mounted || copy.saving) return;
    copy.saved = content;
    setError("");
    settle();
  }, [settle]);

  /** Save (Ctrl/⌘+S): to the file when there is one, else the copy. Fields being typed in are committed first. */
  const save = useCallback(async (): Promise<void> => {
    commitField();
    if (!state.current.ready) return;
    if (state.current.options.target === "disk") await writeFile(false);
    else await flush();
  }, [flush, writeFile]);
  /** Save As: always asks where (or downloads, where the browser cannot write files). */
  const saveAs = useCallback(async (): Promise<FileSaveResult> => {
    commitField();
    if (!state.current.ready) return "cancelled";
    return writeFile(true);
  }, [writeFile]);

  useEffect(() => {
    if (!ready) return;
    const { copy } = state.current, content = serialise(doc);
    if (!copy.saved) {
      // What was opened is what the copy and the file hold, unless it is a recovered copy of unsaved work.
      copy.saved = isNew ? " " : content;
      state.current.fileSaved = unsavedOnOpen || isNew ? null : content;
      if (!isNew) return settle();
    }
    if (content === copy.saved) return settle();
    setStatus("unsaved");
    const timer = setTimeout(() => void flush().catch(() => undefined), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [doc, ready, flush, settle, isNew, unsavedOnOpen, options.target]);

  useEffect(() => {
    state.current.mounted = true;
    const keep = () => void flush().catch(() => undefined);
    const hidden = () => { if (document.visibilityState === "hidden") { commitField(); keep(); } };
    const leaving = (e: BeforeUnloadEvent) => {
      commitField();
      const { copy, ready, doc } = state.current;
      if (!ready) return;
      // A browser drawing is safe once its copy is written; a file with unsaved changes asks first.
      const copyPending = copy.dirty || copy.saving || serialise(doc) !== copy.saved;
      if (copyPending) keep();
      // The desktop app asks before its window closes (Save, Don't save, Cancel); a prompt here would keep the window
      // open without a word once the drafter has chosen not to save.
      if ("spoolyardDesktop" in window) return;
      if (!copyPending && !fileDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void (e.shiftKey && state.current.options.saveFile ? saveAs() : save()).catch(() => undefined);
      }
    };
    window.addEventListener("online", keep);
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      state.current.mounted = false;
      keep();
      window.removeEventListener("online", keep);
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush, save, saveAs, fileDirty]);
  return { status, error, save, saveAs, flush, fileDirty, acknowledge };
}

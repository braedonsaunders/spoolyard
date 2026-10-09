import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { IsoDocument } from "../core/model";
import { SaveQueue } from "./save-queue";

/** Debounced autosave. A freshly created drawing (`isNew`) is saved as soon as it opens. */
export function usePipingSave(
  doc: IsoDocument,
  ready: boolean,
  onSave: (content: string) => Promise<void>,
  isNew = false,
) {
  const [status, setStatus] = useState<"opening" | "saved" | "unsaved" | "saving" | "error">("opening");
  const [error, setError] = useState("");
  const ref = useRef({ queue: new SaveQueue(onSave), mounted: true, ready });
  ref.current.queue.write = onSave;
  ref.current.ready = ready;
  if (ready) ref.current.queue.content = JSON.stringify(doc);
  const flush = useCallback((): Promise<void> => {
    const state = ref.current;
    if (!state.ready) return Promise.resolve();
    if (!state.queue.dirty) return state.queue.flush();
    if (state.mounted) { setStatus("saving"); setError(""); }
    return state.queue.flush().then(
      () => { if (state.mounted) setStatus(state.queue.dirty ? "unsaved" : "saved"); },
      (e) => {
        if (state.mounted) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Save failed");
        }
        throw e;
      },
    );
  }, []);
  useEffect(() => {
    if (!ready) return;
    const state = ref.current.queue;
    if (!state.saved) {
      state.saved = isNew ? " " : state.content;
      if (!isNew) {
        setStatus("saved");
        return;
      }
    }
    if (state.content === state.saved) { setStatus(state.saving ? "saving" : "saved"); return; }
    setStatus("unsaved");
    const timer = setTimeout(() => void flush().catch(() => undefined), 700);
    return () => clearTimeout(timer);
  }, [doc, ready, flush, isNew]);
  useEffect(() => {
    ref.current.mounted = true;
    const online = () => void flush().catch(() => undefined);
    const commitField = () => flushSync(() => (document.activeElement as HTMLElement | null)?.blur());
    const hidden = () => {
      if (document.visibilityState === "hidden") { commitField(); online(); }
    };
    const leaving = (e: BeforeUnloadEvent) => {
      commitField();
      if (!ref.current.ready || (!ref.current.queue.dirty && !ref.current.queue.saving)) return;
      online();
      e.preventDefault();
      e.returnValue = "";
    };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        commitField();
        void flush().catch(() => undefined);
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      ref.current.mounted = false;
      void flush().catch(() => undefined);
      window.removeEventListener("online", online);
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush]);
  return { status, error, save: flush };
}

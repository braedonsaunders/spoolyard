import { useCallback, useEffect, useRef, useState } from "react";
import type { IsoDocument } from "../core/model";

/** Debounced autosave. A freshly created drawing (`isNew`) is saved as soon as it opens. */
export function usePipingSave(
  doc: IsoDocument,
  ready: boolean,
  onSave: (content: string) => Promise<void>,
  isNew = false,
) {
  const [status, setStatus] = useState<"opening" | "saved" | "unsaved" | "saving" | "error">("opening");
  const [error, setError] = useState("");
  const ref = useRef({ content: "", saved: "", pending: "", running: false, mounted: true, onSave });
  ref.current.onSave = onSave;
  if (ready) ref.current.content = JSON.stringify(doc);
  const flush = useCallback(async () => {
    const state = ref.current;
    state.pending = state.content;
    if (state.running || !state.pending || state.pending === state.saved) return;
    state.running = true;
    try {
      while (state.pending && state.pending !== state.saved) {
        const value = state.pending;
        if (state.mounted) {
          setStatus("saving");
          setError("");
        }
        await state.onSave(value);
        state.saved = value;
      }
      if (state.mounted) setStatus("saved");
    } catch (e) {
      if (state.mounted) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Save failed");
      }
    } finally {
      state.running = false;
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    const state = ref.current;
    if (!state.saved) {
      state.saved = isNew ? " " : state.content;
      if (!isNew) {
        setStatus("saved");
        return;
      }
    }
    if (state.content === state.saved) return;
    setStatus("unsaved");
    const timer = setTimeout(() => void flush(), 700);
    return () => clearTimeout(timer);
  }, [doc, ready, flush, isNew]);
  useEffect(() => {
    ref.current.mounted = true;
    const online = () => void flush();
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("keydown", key);
    return () => {
      ref.current.mounted = false;
      void flush();
      window.removeEventListener("online", online);
      window.removeEventListener("keydown", key);
    };
  }, [flush]);
  return { status, error, save: flush };
}

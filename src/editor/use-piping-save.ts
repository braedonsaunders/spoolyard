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
  const ref = useRef({ content: "", saved: "", pending: "", inFlight: null as Promise<void> | null, mounted: true, onSave });
  ref.current.onSave = onSave;
  if (ready) ref.current.content = JSON.stringify(doc);
  const flush = useCallback((): Promise<void> => {
    const state = ref.current;
    state.pending = state.content;
    if (state.inFlight) return state.inFlight;
    if (!state.pending || state.pending === state.saved) return Promise.resolve();
    state.inFlight = Promise.resolve().then(async () => {
      try {
        while (state.pending && state.pending !== state.saved) {
          const value = state.pending;
          if (state.mounted) { setStatus("saving"); setError(""); }
          await state.onSave(value);
          state.saved = value;
        }
        if (state.mounted) setStatus("saved");
      } catch (e) {
        if (state.mounted) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Save failed");
        }
        throw e;
      } finally { state.inFlight = null; }
    });
    return state.inFlight;
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
    const timer = setTimeout(() => void flush().catch(() => undefined), 700);
    return () => clearTimeout(timer);
  }, [doc, ready, flush, isNew]);
  useEffect(() => {
    ref.current.mounted = true;
    const online = () => void flush().catch(() => undefined);
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        // Title-block fields commit on blur; let React publish that edit before serializing it.
        requestAnimationFrame(() => void flush().catch(() => undefined));
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("keydown", key);
    return () => {
      ref.current.mounted = false;
      void flush().catch(() => undefined);
      window.removeEventListener("online", online);
      window.removeEventListener("keydown", key);
    };
  }, [flush]);
  return { status, error, save: flush };
}

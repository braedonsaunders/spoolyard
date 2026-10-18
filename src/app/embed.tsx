import { useCallback, useEffect, useRef } from "react";
import { IsometricEditor, type EditorController, type SaveStatus } from "../editor/isometric-editor";

/**
 * Embedded mode, for hosts such as BidWright: `index.html?embed=1&file=<url>&name=<file name>&theme=dark`.
 * The host draws the single header; Spoolyard posts saves and status, and accepts save/theme commands.
 *   → host:  { source: "spoolyard", type: "spoolyard:ready" | "spoolyard:status" | "spoolyard:save", … }
 *   ← host:  { source: "spoolyard-host", type: "spoolyard:saved" | "spoolyard:save-failed" | "spoolyard:save-now" | "spoolyard:theme", … }
 * Messages are accepted only from the same origin.
 */
/** How long the host has to confirm a save before it is reported as failed. */
const HOST_SAVE_TIMEOUT_MS = 60000;

export function EmbeddedEditor({ params }: { params: URLSearchParams }) {
  const controller = useRef<EditorController | null>(null);
  const pending = useRef(new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  // The last save sent, and what it carried: a confirmation arriving after its timeout still counts if no newer save
  // has been sent since.
  const latest = useRef<{ id: string; content: string } | null>(null);
  const post = useCallback((message: Record<string, unknown>) => {
    window.parent?.postMessage({ source: "spoolyard", ...message }, window.location.origin);
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { source?: string; type?: string; id?: string; error?: string; theme?: string };
      if (data?.source !== "spoolyard-host") return;
      if (data.type === "spoolyard:saved" || data.type === "spoolyard:save-failed") {
        const waiter = pending.current.get(data.id ?? "");
        pending.current.delete(data.id ?? "");
        if (waiter) clearTimeout(waiter.timer);
        if (data.type === "spoolyard:saved") {
          if (waiter) waiter.resolve();
          // A late confirmation of the latest save: the editor stopped waiting and showed an error; it is saved after all.
          else if (data.id && latest.current?.id === data.id) controller.current?.acknowledge(latest.current.content);
        } else waiter?.reject(new Error(data.error || "Save failed"));
        if (data.id && latest.current?.id === data.id) latest.current = null;
      } else if (data.type === "spoolyard:save-now") void controller.current?.save().catch(() => undefined);
      else if (data.type === "spoolyard:theme") document.documentElement.classList.toggle("dark", data.theme === "dark");
    };
    window.addEventListener("message", listener);
    post({ type: "spoolyard:ready" });
    const waiting = pending.current;
    return () => {
      window.removeEventListener("message", listener);
      for (const w of waiting.values()) clearTimeout(w.timer);
      waiting.clear();
    };
  }, [post]);

  const onSave = useCallback(
    (content: string) =>
      new Promise<void>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          if (pending.current.delete(id)) reject(new Error("The host did not confirm the save."));
        }, HOST_SAVE_TIMEOUT_MS);
        pending.current.set(id, { resolve, reject, timer });
        latest.current = { id, content };
        post({ type: "spoolyard:save", id, content });
      }),
    [post],
  );
  const onStatus = useCallback((status: SaveStatus, error: string) => post({ type: "spoolyard:status", status, error }), [post]);

  return (
    <IsometricEditor
      fileUrl={params.get("file")}
      fileName={params.get("name") || "Untitled isometric.piping"}
      chrome="embedded"
      saveTarget="host"
      onSave={onSave}
      onStatus={onStatus}
      controller={controller}
    />
  );
}

import { useCallback, useEffect, useRef } from "react";
import { IsometricEditor, type EditorController, type SaveStatus } from "../editor/isometric-editor";

/**
 * Embedded mode, for hosts such as BidWright: `index.html?embed=1&file=<url>&name=<file name>&theme=dark`.
 * The host draws the single header; Spoolyard posts saves and status, and accepts save/theme commands.
 *   → host:  { source: "spoolyard", type: "spoolyard:ready" | "spoolyard:status" | "spoolyard:save", … }
 *   ← host:  { source: "spoolyard-host", type: "spoolyard:saved" | "spoolyard:save-failed" | "spoolyard:save-now" | "spoolyard:theme", … }
 * Messages are accepted only from the same origin.
 */
export function EmbeddedEditor({ params }: { params: URLSearchParams }) {
  const controller = useRef<EditorController | null>(null);
  const pending = useRef(new Map<string, { resolve: () => void; reject: (e: Error) => void }>());
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
        if (data.type === "spoolyard:saved") waiter?.resolve();
        else waiter?.reject(new Error(data.error || "Save failed"));
      } else if (data.type === "spoolyard:save-now") void controller.current?.save();
      else if (data.type === "spoolyard:theme") document.documentElement.classList.toggle("dark", data.theme === "dark");
    };
    window.addEventListener("message", listener);
    post({ type: "spoolyard:ready" });
    return () => window.removeEventListener("message", listener);
  }, [post]);

  const onSave = useCallback(
    (content: string) =>
      new Promise<void>((resolve, reject) => {
        const id = crypto.randomUUID();
        pending.current.set(id, { resolve, reject });
        post({ type: "spoolyard:save", id, content });
        setTimeout(() => {
          if (pending.current.delete(id)) reject(new Error("The host did not confirm the save."));
        }, 60000);
      }),
    [post],
  );
  const onStatus = useCallback((status: SaveStatus, error: string) => post({ type: "spoolyard:status", status, error }), [post]);

  return (
    <IsometricEditor
      fileUrl={params.get("file")}
      fileName={params.get("name") || "Untitled isometric.piping"}
      chrome="embedded"
      onSave={onSave}
      onStatus={onStatus}
      controller={controller}
    />
  );
}

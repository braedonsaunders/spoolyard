import { useEffect, useRef, type ReactNode } from "react";

export type DialogChoice = "ok" | "alt" | "cancel";
export interface DialogRequest {
  title: string;
  body: ReactNode;
  /** The button that goes ahead; omitted for a notice with only Close. */
  confirm?: { label: string; danger?: boolean };
  /** A second way to go ahead, such as Don't save. */
  alternative?: { label: string };
  cancelLabel?: string;
  done: (choice: DialogChoice) => void;
}

/** A modal question or notice: confirm before replacing a drawing, list what an import could not bring in. */
export function EditorDialog({ request }: { request: DialogRequest }) {
  const ref = useRef<HTMLDialogElement>(null), go = useRef<HTMLButtonElement>(null), answered = useRef(false);
  const answer = (choice: DialogChoice) => {
    if (answered.current) return;
    answered.current = true;
    ref.current?.close();
    request.done(choice);
  };
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement as HTMLElement | null;
    answered.current = false;
    dialog?.showModal();
    go.current?.focus();
    return () => previous?.focus();
  }, [request]);
  return (
    <dialog ref={ref} className="iso-dialog" aria-label={request.title} onCancel={(e) => { e.preventDefault(); answer("cancel"); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <header><strong>{request.title}</strong></header>
      <div className="iso-dialog-body">{request.body}</div>
      <footer>
        {request.alternative && <button type="button" className="iso-dialog-alt" onClick={() => answer("alt")}>{request.alternative.label}</button>}
        {request.confirm && <button type="button" onClick={() => answer("cancel")}>{request.cancelLabel ?? "Cancel"}</button>}
        <button ref={go} type="button" className={request.confirm?.danger ? "is-danger" : "iso-primary"} onClick={() => answer(request.confirm ? "ok" : "cancel")}>
          {request.confirm?.label ?? "Close"}
        </button>
      </footer>
    </dialog>
  );
}

/** Asks with a dialog and resolves with the choice. */
export const ask = (show: (r: DialogRequest | null) => void, request: Omit<DialogRequest, "done">) =>
  new Promise<DialogChoice>((resolve) => show({ ...request, done: (choice) => { show(null); resolve(choice); } }));

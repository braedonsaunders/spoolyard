import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Whether to show ⌘ and ⇧ (Apple) or Ctrl and Shift. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** A shortcut as this platform writes it: mod("Z") is ⌘Z on a Mac and Ctrl+Z elsewhere. */
export const mod = (key: string, shift = false) => (isMac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`);
export const KEYS = {
  undo: mod("Z"),
  redo: isMac ? mod("Z", true) : "Ctrl+Y",
  save: mod("S"),
  selectAll: mod("A"),
  copy: mod("C"),
  paste: mod("V"),
};

export const SHORTCUTS: Array<{ group: string; items: Array<[string, string]> }> = [
  { group: "Commands", items: [["V", "Select"], ["H", "Pan"], ["P", "Pipe"], ["I", "Insert component"], ["M", "Move selection"], ["C", "Copy selection"], ["D", "Measure distance"], ["Enter or Space", "Finish, or repeat the last command"], ["Esc", "Cancel the command, then clear the selection"], ["F2", "Type a command or a length"]] },
  { group: "Typing while a command waits for a point", items: [["1500", "That length the way the cursor points; −1500 the other way"], ["N 10'", "A direction and length: E W N S U D (the letters type, they are not shortcuts then)"], ["@0,1500,300", "A relative offset: E, N, EL"]] },
  { group: "Selection", items: [["Click", "Select one object"], ["Shift or Ctrl/⌘ + click", "Add or remove an object"], ["Drag left to right", "Window: what is wholly inside"], ["Drag right to left", "Crossing: what the box touches"], [KEYS.selectAll, "Select all"], ["Del", "Erase the selection"], [KEYS.copy + " / " + KEYS.paste, "Copy and paste pipe pieces"]] },
  { group: "Editing", items: [[KEYS.undo, "Undo"], [KEYS.redo, "Redo"], [KEYS.save, "Save"], ["Double-click a label", "Edit its text"], ["Double-click a length", "Edit the pipe length"], ["Arrow keys", "Nudge a picked label (Shift: more)"]] },
  { group: "View", items: [["Wheel", "Zoom about the pointer (or pan: Drafting settings)"], ["Shift + wheel", "Pan"], ["Middle or right drag, or Space + drag", "Pan"], ["Double middle-click", "Zoom extents"], ["+ / −", "Zoom in and out"], ["Z then E / W / P", "Zoom extents, window, previous (type in the command line)"]] },
  { group: "Drafting aids", items: [["F3", "Object snap"], ["F7", "Grid"], ["F8", "Ortho"], ["F9", "Snap"], ["F1 or ?", "This list"]] },
];

/** The keyboard and mouse reference. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog ref={ref} className="iso-dialog iso-shortcuts" aria-label="Keyboard shortcuts" onClose={onClose} onCancel={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <header>
        <strong>Keyboard and mouse</strong>
        <button type="button" className="iso-icon-button" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="iso-shortcuts-body">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3>{g.group}</h3>
            <dl>
              {g.items.map(([keys, what]) => (
                <div key={keys + what}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}

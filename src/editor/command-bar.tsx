import { useRef, useState, type Ref } from "react";
import { ChevronRight } from "lucide-react";
import { COMMANDS } from "./command-line";
import { cn } from "./cn";

export interface CommandOption { label: string; key?: string; action: () => void }

/**
 * The command line along the bottom of the drawing: it shows what the active command asks for and its options, and
 * takes typed lengths, directions, offsets and command names. Up and Down recall what was typed before.
 */
export function CommandBar({ prompt, options, message, onSubmit, onCancel, inputRef }: {
  prompt: string;
  options: CommandOption[];
  /** The last result or problem, shown until the next command. */
  message: { text: string; tone?: "error" } | null;
  /** Runs what was typed; returns a problem to show, if any. */
  onSubmit: (text: string) => string | void;
  onCancel: () => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const recall = useRef<{ items: string[]; at: number }>({ items: [], at: 0 });
  const submit = () => {
    const value = text.trim();
    if (value) recall.current = { items: [...recall.current.items.filter((v) => v !== value), value].slice(-30), at: 0 };
    const problem = onSubmit(value);
    setError(problem ?? "");
    if (!problem) setText("");
  };
  const shown = error ? { text: error, tone: "error" as const } : message;
  return (
    <div className="iso-command-bar" role="group" aria-label="Command line">
      <div className="iso-command-prompt" aria-live="polite">
        <ChevronRight size={13} aria-hidden />
        <span>{prompt}</span>
        {options.map((o) => (
          <button key={o.label} type="button" className="iso-command-option" onClick={o.action} title={o.key ? `${o.label} (${o.key})` : o.label}>
            {o.label}{o.key && <kbd>{o.key}</kbd>}
          </button>
        ))}
        {shown && <span className={cn("iso-command-message", shown.tone === "error" && "is-error")} role={shown.tone === "error" ? "alert" : undefined}>{shown.text}</span>}
      </div>
      <input ref={inputRef} className="iso-command-input" aria-label="Command or length" placeholder="Type a command, or a length while drawing (1500, N 10', @0,0,600)"
        list="iso-command-names" value={text} spellCheck={false} autoComplete="off"
        onChange={(e) => { setText(e.target.value); setError(""); }}
        onKeyDown={(e) => {
          // Function keys (F3 object snap, F7 grid, F8 ortho, F9 snap, F1 help) and Ctrl/⌘ combinations (Save) work
          // from the command line too; the editor leaves other keys typed in a field alone.
          if (/^F\d+$/.test(e.key) || e.ctrlKey || e.metaKey) return;
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") {
            e.preventDefault();
            if (text) { setText(""); setError(""); }
            else { onCancel(); e.currentTarget.blur(); }
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const r = recall.current;
            if (!r.items.length) return;
            e.preventDefault();
            r.at = Math.max(0, Math.min(r.items.length, r.at + (e.key === "ArrowUp" ? 1 : -1)));
            setText(r.at ? r.items[r.items.length - r.at] : "");
          }
        }} />
      <datalist id="iso-command-names">
        {COMMANDS.map((c) => <option key={c.id} value={c.names[0]}>{c.label}</option>)}
      </datalist>
    </div>
  );
}

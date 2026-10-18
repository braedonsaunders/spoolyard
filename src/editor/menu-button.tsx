import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface MenuButtonItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

/**
 * A toolbar button that opens a menu (WAI-ARIA menu button): Enter, Space or ArrowDown opens it on the first item,
 * ArrowUp on the last; arrows, Home and End move; Esc or Tab closes it and Esc returns focus to the button. A click
 * anywhere else closes it.
 */
export function MenuButton({ label, children, items, className, title }: {
  /** The accessible name of the button and its menu. */
  label: string;
  /** What the button shows. */
  children: ReactNode;
  items: MenuButtonItem[];
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  const enabled = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
  useEffect(() => {
    if (!open) return;
    const all = enabled();
    (open === "last" ? all.at(-1) : all[0])?.focus();
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", close);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const menuKeys = (e: KeyboardEvent) => {
    // The menu keeps its keys: the drawing's shortcuts do not run while it is open.
    e.stopPropagation();
    const all = enabled(), at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); close(); button.current?.focus(); }
    else if (e.key === "Tab") close();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
      all[next]?.focus();
    }
  };
  return (
    <div ref={root} className={className}>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={!!open} aria-controls={open ? id : undefined} title={title}
        onClick={() => setOpen((o) => (o ? false : "first"))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setOpen(e.key === "ArrowUp" ? "last" : "first"); }
          else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); }
        }}>
        {children}
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} onKeyDown={menuKeys}>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
              onClick={() => { close(); button.current?.focus(); item.action(); }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

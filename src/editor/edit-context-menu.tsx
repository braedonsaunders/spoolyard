import { useLayoutEffect, useRef, useState } from 'react';

export interface EditMenuItem {
  label: string;
  action: () => void;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** A longer explanation, shown as the item's tooltip. */
  title?: string;
}

/** Keyboard-operable, viewport-clamped editing menu, shared by paper and model space. */
export function EditContextMenu({ x, y, title, items, onClose }: {
  x: number; y: number; title: string; items: EditMenuItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const menu = ref.current!;
    const bounds = menu.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)) });
    const previous = document.activeElement as HTMLElement | null;
    // The first safe item takes focus: Enter on a menu just opened never erases or resets anything.
    (menu.querySelector<HTMLButtonElement>('button:not(:disabled):not(.danger)') ?? menu.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      if (menu.contains(document.activeElement) || document.activeElement === document.body) previous?.focus();
    };
  }, [x, y, onClose]);
  return <div ref={ref} className="iso-edit-menu" role="menu" aria-label={title + ' editing'} style={position}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }
    }}>
    <div className="iso-edit-menu-title">{title}</div>
    {items.map(item => <button type="button" key={item.label} role="menuitem" disabled={item.disabled}
      className={item.danger ? 'danger' : undefined} title={item.title} onClick={() => { onClose(); item.action(); }}>
      <span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
    </button>)}
  </div>;
}

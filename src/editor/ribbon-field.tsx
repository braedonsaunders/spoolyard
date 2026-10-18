import type { ReactNode } from "react";

/** A captioned control in the ribbon or a schedule's toolbar. */
export function RibbonField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="iso-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

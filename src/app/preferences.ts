/** Preferences are optional; restricted browser storage must not prevent opening drawings. */
export function getPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function setPreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Session preference still applies. */ }
}

/**
 * A page left open while Spoolyard is updated (the GitHub Pages site, BidWright's copy) still runs the old build. The
 * old build loads parts of itself on demand (PDF export, the 3D review, DWG), and once the update has replaced them
 * those files are gone: "Failed to fetch dynamically imported module". Vite reports each such failure; the page then
 * keeps the open drawing (every editor writes its copy) and reloads once onto the new build, which reopens it.
 */
export const UPDATE_RELOAD_EVENT = "spoolyard:update-reload";
/** What an editor adds to while the page gets ready to reload: the writes it started. */
export interface UpdateReloadDetail { pending: Array<Promise<unknown>> }

const KEY = "spoolyard:update-reloaded";
/** A reload within this long of the last one did not help: the failure is reported instead of reloading again. */
const LOOP_MS = 60_000;
/** The longest the open drawing's copy is waited for before the reload. */
const SAVE_WAIT_MS = 5_000;

/** Whether an error is a part of this build that could not be fetched (the build was replaced while open). */
export const isStaleBuild = (error: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    error instanceof Error ? error.message : String(error));

/** Keeps the open drawing and reloads onto the new build; false when it reloaded moments ago (not an update). */
export function reloadForUpdate(): boolean {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY) ?? 0); } catch { /* storage blocked: reload anyway */ }
  if (Date.now() - last < LOOP_MS) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* as above */ }
  const detail: UpdateReloadDetail = { pending: [] };
  window.dispatchEvent(new CustomEvent<UpdateReloadDetail>(UPDATE_RELOAD_EVENT, { detail }));
  const kept = Promise.allSettled(detail.pending);
  void Promise.race([kept, new Promise((r) => setTimeout(r, SAVE_WAIT_MS))]).then(() => location.reload());
  return true;
}

/** What the drafter is told while the page reloads onto an update, for a command that failed because of it. */
export const UPDATE_MESSAGE = "Spoolyard was updated while this page was open. Reloading onto the new version; your drawing is kept.";

/**
 * Listens for Vite's report of a part that would not load, and reloads onto the update. The failed command still
 * fails (its error says why, see `isStaleBuild`), rather than carrying on without the part.
 */
export function watchForUpdates() {
  window.addEventListener("vite:preloadError", () => { reloadForUpdate(); });
}

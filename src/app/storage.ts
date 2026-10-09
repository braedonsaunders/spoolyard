/** Drawings kept in this browser (or desktop profile) — the Spoolyard home screen's library. */
export interface StoredDrawing {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
}

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("spoolyard", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drawings", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = body(db.transaction("drawings", mode).objectStore("drawings"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const listDrawings = async () =>
  (await run<StoredDrawing[]>("readonly", (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const getDrawing = (id: string) => run<StoredDrawing | undefined>("readonly", (s) => s.get(id));
export const putDrawing = (drawing: StoredDrawing) => run("readwrite", (s) => s.put(drawing)).then(() => drawing);
export const deleteDrawing = (id: string) => run("readwrite", (s) => s.delete(id));

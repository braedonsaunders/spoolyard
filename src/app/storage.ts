/** Drawings kept in this browser (or desktop profile) — the Spoolyard home screen's library. */
export interface StoredDrawing {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  /** Native desktop location, retained when reopening a drawing from Recent. */
  path?: string;
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
    try {
      const transaction = db.transaction("drawings", mode);
      const request = body(transaction.objectStore("drawings"));
      // A successful request can still be rolled back by a failed transaction.
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? request.error ?? new Error("The drawing could not be saved on this device."));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export const listDrawings = async () =>
  (await run<StoredDrawing[]>("readonly", (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const getDrawing = (id: string) => run<StoredDrawing | undefined>("readonly", (s) => s.get(id));
export const putDrawing = (drawing: StoredDrawing) => run("readwrite", (s) => s.put(drawing)).then(() => drawing);
export const deleteDrawing = (id: string) => run("readwrite", (s) => s.delete(id));

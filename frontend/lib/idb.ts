/** Tiny IndexedDB key-value store (trips, photos). Falls back gracefully if storage is blocked. */
const DB = "karthikmap";
const STORES = ["trips", "photos", "measures"] as const;
export type Store = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => { resolve(r.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}
export const idbPut = <T extends { id: string }>(store: Store, v: T) => tx(store, "readwrite", (s) => s.put(v));
export const idbAll = <T>(store: Store) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>).catch(() => [] as T[]);
export const idbGet = <T>(store: Store, id: string) => tx<T | undefined>(store, "readonly", (s) => s.get(id) as IDBRequest<T | undefined>);
export const idbDelete = (store: Store, id: string) => tx(store, "readwrite", (s) => s.delete(id));

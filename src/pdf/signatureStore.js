// Optional on-device signature library (IndexedDB). Only written when the user explicitly
// saves a signature; nothing is ever uploaded. Same database name as earlier versions so
// existing saved signatures keep working.
const DB_NAME = 'pdf-editor-signatures-v1', STORE = 'signatures';

export function createSignatureStore() {
  let dbPromise = null;
  const db = () => (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbPromise = null; reject(r.error); };
  }));
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    all: async () => (await run('readonly', s => s.getAll())) || [],
    put: item => run('readwrite', s => s.put(item)),
    remove: id => run('readwrite', s => s.delete(id)),
  };
}

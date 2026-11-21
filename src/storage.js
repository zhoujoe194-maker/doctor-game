// Keep stable storage identifiers so the doctorgame rename preserves existing
// browser recordings, profiles and reports from the Sight prototype.
let database;
async function db() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    const r = indexedDB.open('sight-recordings', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('recordings', { keyPath: 'id' }); r.result.createObjectStore('chunks', { keyPath: ['id', 'index'] }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return database;
}
async function transaction(store, mode, action) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode), r = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(r?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('存储事务已中止'));
  });
}
const indices = new Map();
export const storage = {
  async begin(metadata) {
    if (window.doctorgame) return window.doctorgame.begin(metadata);
    const id = crypto.randomUUID(); indices.set(id, 0);
    await transaction('recordings', 'readwrite', s => s.put({ ...metadata, id, createdAt: new Date().toISOString(), status: 'recording' }));
    return id;
  },
  async append(id, blob) {
    if (window.doctorgame) return window.doctorgame.append(id, await blob.arrayBuffer());
    const index = indices.get(id) || 0;
    await transaction('chunks', 'readwrite', s => s.put({ id, index, blob })); indices.set(id, index + 1);
  },
  async finish(id, metadata) {
    if (window.doctorgame) return window.doctorgame.finish(id, metadata);
    const old = await transaction('recordings', 'readonly', s => s.get(id));
    const item = { ...old, ...metadata, id, status: metadata.incomplete ? 'incomplete' : 'ready' };
    await transaction('recordings', 'readwrite', s => s.put(item)); indices.delete(id); return item;
  },
  async list() {
    if (window.doctorgame) return window.doctorgame.list();
    return (await transaction('recordings', 'readonly', s => s.getAll())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async url(item) {
    if (window.doctorgame) return `doctorgame-video://capture/${item.id}`;
    const chunks = await transaction('chunks', 'readonly', s => s.getAll(IDBKeyRange.bound([item.id, 0], [item.id, Number.MAX_SAFE_INTEGER])));
    return URL.createObjectURL(new Blob(chunks.map(c => c.blob), { type: item.mimeType || 'video/webm' }));
  }
};
export function loadProfile(fallback) {
  try { return JSON.parse(localStorage.getItem('sight-profile')) || fallback; } catch { return fallback; }
}
// Distinguish a first visit (defaults shown) from a profile the player saved.
// Reads the existing identifier only; never migrates or rewrites stored data.
export function hasSavedProfile() { try { return Boolean(localStorage.getItem('sight-profile')); } catch { return false; } }
export function saveProfile(profile) { localStorage.setItem('sight-profile', JSON.stringify(profile)); }
export function saveReport(report) { localStorage.setItem(`sight-report-${report.id}`, JSON.stringify(report)); }
export function loadReport(id) { try { return JSON.parse(localStorage.getItem(`sight-report-${id}`)); } catch { return null; } }

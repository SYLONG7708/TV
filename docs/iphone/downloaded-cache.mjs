const ALLOWED = /(?:iphone-vod-catalog\.json|iphone-vod-latest\.json|live-channels\.json|vod-query\/manifest\.json|quantum-lzi\/manifest\.json|public-sources\.json|category-seeds\.json|korean-short-seeds\.json)$/;
export const downloadableMetadata = value => ALLOWED.test(String(value));
export function createDownloadedCache() {
  let database;
  const memory = new Map();
  async function db() {
    if (!database) database = new Promise(resolve => {
      try {
        const request = indexedDB.open('yingshi-downloaded-metadata-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('metadata');
        request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
    return database;
  }
  return {
    async remember(key, value) {
      if (!downloadableMetadata(key) || value === null || JSON.stringify(value).length > 8 * 1024 * 1024) return value;
      const record = { value, downloadedAt: Date.now() }; memory.set(key, record);
      const store = await db();
      if (store) try {
        const transaction = store.transaction('metadata', 'readwrite');
        transaction.objectStore('metadata').put(record, key);
        // Keep at most two revisions of the small startup files. Never cache
        // movie media or the multi-gigabyte search corpus in IndexedDB.
        const keys = transaction.objectStore('metadata').getAllKeys();
        keys.onsuccess = () => { if (keys.result.length > 20) for (const stale of keys.result.slice(0, keys.result.length - 20)) transaction.objectStore('metadata').delete(stale); };
      } catch {}
      return value;
    },
    async read(key) {
      if (!downloadableMetadata(key)) return null;
      if (memory.has(key)) return memory.get(key);
      const store = await db(); if (!store) return null;
      return new Promise(resolve => {
        try {
          const request = store.transaction('metadata').objectStore('metadata').get(key);
          request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    },
  };
}

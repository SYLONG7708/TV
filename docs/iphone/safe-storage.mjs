// Storage may be blocked by private mode, WebView policy or a full disk.
export function createSafeStorage(getStorage = () => window.localStorage) {
  const memory = new Map();
  return {
    getItem(key) { if (memory.has(key)) return memory.get(key); try { return getStorage().getItem(key); } catch { return null; } },
    setItem(key, value) { memory.set(key, String(value)); try { getStorage().setItem(key, String(value)); } catch {} },
    removeItem(key) { memory.set(key, null); try { getStorage().removeItem(key); } catch {} },
  };
}

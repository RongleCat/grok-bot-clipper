// Native Firefox storage.local is readable by content scripts. Keep persistent
// account data in the extension origin instead; this database is never exposed
// through a content-script RPC or web_accessible_resources.
export function createPrivateLocalStorage({
  indexedDB = globalThis.indexedDB,
  name = 'grok-bot-browser-private',
} = {}) {
  let opened;
  const database = () =>
    (opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('values', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opened = undefined;
        reject(request.error);
      };
    }));
  async function transaction(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('values', mode);
      let result;
      const request = action(tx.objectStore('values'));
      if (request)
        request.onsuccess = () => {
          result = request.result;
        };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error('STORAGE_ABORTED'));
    });
  }
  return {
    async get(keys = null) {
      const rows = await transaction('readonly', (store) => store.getAll());
      const values = new Map(rows.map((row) => [row.key, row.value]));
      const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      const names =
        keys == null
          ? [...values.keys()]
          : typeof keys === 'string'
            ? [keys]
            : Array.isArray(keys)
              ? keys
              : Object.keys(defaults);
      return Object.fromEntries(
        names
          .filter((key) => values.has(key) || Object.hasOwn(defaults, key))
          .map((key) => [key, values.has(key) ? values.get(key) : defaults[key]]),
      );
    },
    set(values) {
      return transaction('readwrite', (store) => {
        for (const [key, value] of Object.entries(values)) store.put({ key, value });
      });
    },
    remove(keys) {
      return transaction('readwrite', (store) => {
        for (const key of [keys].flat()) store.delete(key);
      });
    },
    clear() {
      return transaction('readwrite', (store) => store.clear());
    },
  };
}

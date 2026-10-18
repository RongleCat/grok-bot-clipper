const DB_NAME = 'grok-bot-browser';
let opened;
export function db() {
  return (opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      for (const n of ['materials', 'drafts', 'jobs', 'replies', 'meta'])
        if (!r.result.objectStoreNames.contains(n))
          r.result.createObjectStore(n, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function store(name, mode, action) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(name, mode),
      req = action(tx.objectStore(name));
    let value;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('STORAGE_ABORTED'));
  });
}
export const get = (n, id) => store(n, 'readonly', (s) => s.get(id));
export const all = (n) => store(n, 'readonly', (s) => s.getAll());
export const put = (n, row) => store(n, 'readwrite', (s) => s.put(row));
export const remove = (n, id) => store(n, 'readwrite', (s) => s.delete(id));
export async function prune(days) {
  const cutoff = Date.now() - days * 86400000;
  for (const n of ['materials', 'jobs', 'replies'])
    for (const row of await all(n))
      if (
        (row.updatedAt ?? row.createdAt ?? 0) < cutoff &&
        (n !== 'jobs' || ['accepted', 'failed', 'cancelled'].includes(row.state))
      )
        await remove(n, row.id);
}
export async function claimDraftJob(draftId, job) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(['drafts', 'jobs'], 'readwrite'),
      drafts = tx.objectStore('drafts'),
      jobs = tx.objectStore('jobs'),
      req = drafts.get(draftId);
    let result;
    req.onsuccess = () => {
      const draft = req.result;
      if (!draft || draft.accountId !== job.accountId) {
        tx.abort();
        return;
      }
      if (draft.jobId) {
        result = draft.jobId;
        return;
      }
      jobs.put(job);
      draft.jobId = job.id;
      draft.updatedAt = Date.now();
      drafts.put(draft);
      result = job.id;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('DRAFT_UNAVAILABLE'));
  });
}

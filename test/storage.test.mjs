import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { put, get } from '../src/core/db.js';
test('concurrent submissions of one draft create exactly one persistent job', async () => {
  const { claimDraftJob } = await import('../src/core/db.js');
  await put('drafts', { id: 'same-draft', accountId: 'a' });
  const a = { id: 'job-a', accountId: 'a', state: 'queued' },
    b = { id: 'job-b', accountId: 'a', state: 'queued' };
  const result = await Promise.all([
    claimDraftJob('same-draft', a),
    claimDraftJob('same-draft', b),
  ]);
  assert.equal(result[0], result[1]);
  assert.equal((await get('drafts', 'same-draft')).jobId, result[0]);
  assert.equal(Boolean(await get('jobs', 'job-a')) + Boolean(await get('jobs', 'job-b')), 1);
});

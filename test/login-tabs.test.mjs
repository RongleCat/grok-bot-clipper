import test from 'node:test';
import assert from 'node:assert/strict';
import { closeLoginTab } from '../src/core/login.js';
const flow = {
  tabId: 37,
  uuid: 'test-flow',
  loginUrl: 'https://cursor.com/loginDeepControl?uuid=test-flow',
};
test('successful auth cleanup closes only its recorded matching login tab', async () => {
  const removed = [];
  await closeLoginTab(
    { get: async (id) => ({ id, url: flow.loginUrl }), remove: async (id) => removed.push(id) },
    flow,
  );
  assert.deepEqual(removed, [37]);
});
test('auth cleanup leaves unrelated pages, other login flows and unrecorded tabs alone', async () => {
  for (const [url, record] of [
    ['https://example.com', flow],
    ['https://cursor.com/loginDeepControl?uuid=other', flow],
    [flow.loginUrl, { ...flow, tabId: undefined }],
  ]) {
    const removed = [];
    await closeLoginTab(
      { get: async () => ({ url }), remove: async (id) => removed.push(id) },
      record,
    );
    assert.deepEqual(removed, [], url);
  }
});
test('closing an already closed login tab does not fail authentication', async () => {
  await assert.doesNotReject(
    closeLoginTab(
      {
        get: async () => {
          throw Error('No tab');
        },
        remove: async () => {},
      },
      flow,
    ),
  );
});
test('the recorded auth tab still closes after an in-flow completion redirect drops its query', async () => {
  const removed = [];
  await closeLoginTab(
    {
      get: async () => ({ id: 37, url: 'https://cursor.com/loginDeepControl/success' }),
      remove: async (id) => removed.push(id),
    },
    flow,
  );
  assert.deepEqual(removed, [37]);
});

test('the flow-owned tab closes on a same-origin completion landing page outside the initial login path', async () => {
  const removed = [];
  await closeLoginTab(
    {
      get: async () => ({ id: 37, url: 'https://cursor.com/api/auth/callback' }),
      remove: async (id) => removed.push(id),
    },
    flow,
  );
  assert.deepEqual(removed, [37]);
});

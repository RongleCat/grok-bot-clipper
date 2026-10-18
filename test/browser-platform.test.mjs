import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createBrowserPlatform } from '../src/platform/browser.js';
import { createPrivateLocalStorage } from '../src/platform/storage.js';

test('Chrome keeps its original APIs, native sidebar options and trusted storage restrictions', async () => {
  const calls = [];
  const raw = {
    sidePanel: {
      open: (o) => {
        calls.push(o);
        return Promise.resolve();
      },
    },
    storage: {
      local: { setAccessLevel: async (o) => calls.push(o) },
      session: { setAccessLevel: async (o) => calls.push(o) },
    },
  };
  const p = createBrowserPlatform(raw);
  assert.equal(p.api, raw);
  const options = { windowId: 8 };
  await p.openSidePanel(options);
  assert.equal(calls[0], options);
  await p.protectStorage();
  assert.deepEqual(calls.slice(1), [
    { accessLevel: 'TRUSTED_CONTEXTS' },
    { accessLevel: 'TRUSTED_CONTEXTS' },
  ]);
  assert.equal(p.shortcutsURL, 'chrome://extensions/shortcuts');
});
test('Firefox uses browserAction and opens its sidebar synchronously in the user gesture', async () => {
  let opened = false;
  const raw = {
    browserAction: {},
    sidebarAction: {
      open() {
        opened = true;
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        set() {
          throw Error('Do not write native local storage');
        },
      },
      session: {},
    },
  };
  const p = createBrowserPlatform(raw, { firefox: true, indexedDB });
  const promise = p.openSidePanel({ windowId: 9 });
  assert.equal(opened, true);
  await promise;
  await p.protectStorage();
  assert.equal(p.api.action, raw.browserAction);
  assert.equal(p.api.storage.session, raw.storage.session);
  assert.notEqual(p.api.storage.local, raw.storage.local);
  assert.equal(p.shortcutsURL, 'about:addons');
});
test('Firefox private local storage persists only in extension-origin IndexedDB with atomic storage semantics', async () => {
  const name = 'private-storage-test';
  const first = createPrivateLocalStorage({ indexedDB, name });
  await first.set({
    credentials: { accessToken: 'synthetic-secret' },
    settings: { theme: 'dark' },
  });
  const second = createPrivateLocalStorage({ indexedDB, name });
  assert.deepEqual(await second.get('credentials'), {
    credentials: { accessToken: 'synthetic-secret' },
  });
  assert.deepEqual(await second.get({ missing: 'fallback', settings: null }), {
    missing: 'fallback',
    settings: { theme: 'dark' },
  });
  const copy = await second.get(null);
  copy.credentials.accessToken = 'changed';
  assert.equal((await first.get('credentials')).credentials.accessToken, 'synthetic-secret');
  await second.remove(['credentials']);
  assert.deepEqual(await first.get('credentials'), {});
  await first.clear();
  assert.deepEqual(await second.get(null), {});
});

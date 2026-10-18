import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
const event = () => ({ addListener() {} });
const session = {
  data: {},
  async get(keys) {
    if (typeof keys === 'string') keys = [keys];
    return Object.fromEntries(
      (keys ?? Object.keys(this.data))
        .filter((k) => k in this.data)
        .map((k) => [k, structuredClone(this.data[k])]),
    );
  },
  async set(values) {
    Object.assign(this.data, structuredClone(values));
  },
  async remove(keys) {
    for (const key of [keys].flat()) delete this.data[key];
  },
};
const nativeLocal = {
  data: {},
  get: async () => ({}),
  set: async () => {
    throw Error('Firefox native local must not receive credentials');
  },
};
const windows = [];
let sidebarError = false;
const runtime = {
  id: 'fixture',
  getURL: (p) => 'moz-extension://fixture/' + p,
  onMessage: event(),
  onConnect: event(),
  onInstalled: event(),
  onStartup: event(),
  sendMessage: async () => ({ ok: true }),
};
globalThis.browser = {
  runtime,
  storage: { local: nativeLocal, session },
  browserAction: { setTitle: async () => {}, setBadgeText: async () => {} },
  sidebarAction: {
    open: async () => {
      if (sidebarError) throw Error('Gesture required');
    },
  },
  contextMenus: { removeAll: async () => {}, create() {}, onClicked: event() },
  commands: { onCommand: event() },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: event() },
  tabs: { query: async () => [], onActivated: event(), onUpdated: event() },
  windows: { create: async (options) => windows.push(options) },
};
let source = await readFile('src/background.js', 'utf8');
source = source.replace(/^init\(\)\.catch\(\(\) => \{\}\);$/m, '');
source +=
  '\nexport {init,handle,openComposer,offscreen,api,authGeneration,archive,contextAllowed};';
const result = await build({
  stdin: { contents: source, resolveDir: process.cwd() + '/src' },
  bundle: true,
  format: 'esm',
  write: false,
  define: { __BROWSER_TARGET__: '"firefox"' },
});
const background = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const ui = { id: 'fixture', url: runtime.getURL('app.html') };
test('Firefox initializes and authenticates without Chrome offscreen, sidePanel or setAccessLevel APIs', async () => {
  await background.init();
  await background.api.storage.local.set({
    account: { id: 'a' },
    bots: [],
    settings: { defaultBotId: '' },
    credentials: { accessToken: 'persisted-synthetic' },
  });
  await session.set({ credentials: { accessToken: 'session-synthetic' } });
  assert.equal((await background.handle({ type: 'state' }, ui)).authenticated, true);
  assert.deepEqual(nativeLocal.data, {});
  assert.deepEqual(await background.offscreen({ action: 'jobs.status' }), []);
  assert.equal(windows.length, 0);
});
test('Firefox opens its native sidebar and falls back to an independent composer when the gesture expired', async () => {
  assert.deepEqual(await background.openComposer('draft', 8), { draftId: 'draft' });
  sidebarError = true;
  assert.deepEqual(await background.openComposer('draft', 8), {
    draftId: 'draft',
    surface: 'window',
  });
  assert.match(windows.at(-1).url, /view=compose&draft=draft/);
  sidebarError = false;
});

test('Firefox archives body text as safe HTML without Chrome pageCapture', async () => {
  const { put, get } = await import('../src/core/db.js');
  await put('materials', {
    id: 'ff-archive',
    title: 'Title',
    url: 'https://example.com/?token=secret',
    markdown: 'Body <script>alert(1)</script>',
    attachments: [],
    warnings: [],
  });
  await background.archive(99, 'ff-archive');
  const item = await get('materials', 'ff-archive');
  assert.equal(item.attachments[0].name, 'page.html');
  assert.equal(item.attachments[0].blob.type, 'text/html;charset=utf-8');
  const html = await item.attachments[0].blob.text();
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('secret'));
  assert.ok(html.includes('Body &lt;script&gt;'));
});

test('Firefox logout clears private persisted and session credentials and rejects old scopes', async () => {
  const scope = {
    generation: await background.authGeneration(),
    accountId: 'a',
    workspaceId: 'personal',
  };
  assert.equal(await background.contextAllowed(scope), true);
  await background.handle({ type: 'logout' }, ui);
  assert.deepEqual(await background.api.storage.local.get('credentials'), {});
  assert.deepEqual(await session.get('credentials'), {});
  assert.equal(await background.contextAllowed(scope), false);
  assert.deepEqual(nativeLocal.data, {});
});

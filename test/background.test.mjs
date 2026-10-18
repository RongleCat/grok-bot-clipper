import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
const event = () => ({ addListener() {} });
const area = () => ({
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
    for (const k of [keys].flat()) delete this.data[k];
  },
  async setAccessLevel() {},
});
const local = area(),
  session = area();
const removedTabs = [];
let activeId = 1,
  currentURL = 'https://fixture.example/page',
  captured = 0,
  changeDuringCapture = false;
const runtime = {
  id: 'fixture',
  getURL: (p) => 'chrome-extension://fixture/' + p,
  onMessage: event(),
  onConnect: event(),
  onInstalled: event(),
  onStartup: event(),
  sendMessage: async () => ({ ok: true, value: {} }),
};
globalThis.chrome = {
  runtime,
  storage: { local, session },
  contextMenus: { removeAll: async () => {}, create() {}, onClicked: event() },
  commands: { onCommand: event() },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: event() },
  offscreen: { hasDocument: async () => false },
  action: { setTitle: async () => {}, setBadgeText: async () => {} },
  tabs: {
    remove: async (id) => removedTabs.push(id),
    onActivated: event(),
    onUpdated: event(),
    query: async () => [{ id: activeId, windowId: 2, url: currentURL }],
    get: async (id) => ({ id, windowId: 2, url: currentURL }),
    captureVisibleTab: async () => {
      captured++;
      if (changeDuringCapture) activeId = 3;
      return 'data:image/png;base64,fixture';
    },
  },
};
let source = await readFile('src/background.js', 'utf8');
source = source.replace(/^init\(\)\.catch\(\(\) => \{\}\);$/m, '');
source +=
  '\nexport {authGeneration,contextAllowed,invalidateAuth,handle,captureVisible,pollLogin,openComposer};';
const compiled = await build({
  stdin: { contents: source, resolveDir: process.cwd() + '/src', sourcefile: 'background-test.js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
});
const worker = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const ui = { id: 'fixture', url: runtime.getURL('app.html') };
async function seed() {
  await local.set({
    account: { id: 'account-a' },
    bots: [],
    teams: [{ id: 42, name: 'Team' }],
    settings: { defaultBotId: 'old-bot', persistLogin: false },
  });
  await session.set({ credentials: { accessToken: 'synthetic-token' } });
  activeId = 1;
  currentURL = 'https://fixture.example/page';
  changeDuringCapture = false;
  captured = 0;
}
test('generation fencing rejects a delayed job after logout and after new login', async () => {
  await seed();
  const generation = await worker.authGeneration();
  const scope = { generation, accountId: 'account-a', workspaceId: 'personal' };
  assert.equal(await worker.contextAllowed(scope), true);
  await worker.handle({ type: 'logout' }, ui);
  assert.equal(await worker.contextAllowed(scope), false);
  await seed();
  assert.equal(await worker.contextAllowed(scope), false);
  assert.equal(
    await worker.contextAllowed({ ...scope, generation: await worker.authGeneration() }),
    true,
  );
});
test('team switch failure restores credentials, roster and default BOT atomically for users', async () => {
  await seed();
  const before = await worker.authGeneration();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error('fixture outage');
  };
  try {
    await assert.rejects(worker.handle({ type: 'team.select', teamId: '42' }, ui));
  } finally {
    globalThis.fetch = oldFetch;
  }
  assert.equal(session.data.credentials.selectedTeamId, undefined);
  assert.equal(local.data.settings.defaultBotId, 'old-bot');
  assert.deepEqual(local.data.teams, [{ id: 42, name: 'Team' }]);
  assert.notEqual(await worker.authGeneration(), before);
  assert.equal(
    await worker.contextAllowed({
      generation: await worker.authGeneration(),
      accountId: 'account-a',
      workspaceId: 'personal',
    }),
    true,
  );
});
test('capture verifies the tab after the final captured pixels and rejects switched pages', async () => {
  await seed();
  const tab = { id: 1, windowId: 2, url: currentURL };
  assert.equal(await worker.captureVisible(tab), 'data:image/png;base64,fixture');
  changeDuringCapture = true;
  await assert.rejects(worker.captureVisible(tab), /CAPTURE_TAB_CHANGED/);
  assert.equal(captured, 2);
});
test('capture rejects preexisting URL changes before invoking screenshot API', async () => {
  await seed();
  await assert.rejects(
    worker.captureVisible({ id: 1, windowId: 2, url: 'https://fixture.example/old' }),
    /CAPTURE_TAB_CHANGED/,
  );
  assert.equal(captured, 0);
});

test('login stores acquired credentials and closes its own auth tab even if roster refresh fails', async () => {
  await seed();
  removedTabs.length = 0;
  const flow = {
    uuid: 'integration-flow',
    verifier: 'synthetic-verifier',
    createdAt: Date.now(),
    tabId: 37,
    loginUrl: 'https://cursor.com/loginDeepControl?uuid=integration-flow',
  };
  currentURL = 'https://cursor.com/api/auth/callback';
  await session.set({ loginFlow: flow });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/auth/poll')
      return new Response(JSON.stringify({ accessToken: 'synthetic-acquired-token' }), {
        status: 200,
      });
    throw Error('synthetic roster offline');
  };
  try {
    await worker.pollLogin();
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(session.data.credentials.accessToken, 'synthetic-acquired-token');
  assert.equal(session.data.loginFlow, undefined);
  assert.deepEqual(removedTabs, [37]);
});
test('sidebar navigation preserves drafts as a destination and broadcasts on a separate UI channel', async () => {
  await seed();
  const messages = [];
  const originalSend = runtime.sendMessage;
  runtime.sendMessage = async (message) => messages.push(message);
  try {
    await worker.handle({ type: 'sidepanel.navigate', windowId: 2, view: 'drafts' }, ui);
  } finally {
    runtime.sendMessage = originalSend;
  }
  assert.equal(session.data['sidepanelView:2'], 'drafts');
  assert.equal(messages[0].type, 'ui.navigate');
  assert.equal(messages[0].target, 'ui');
  assert.equal(messages[0].view, 'drafts');
});

test('social share opens a standalone chooser with every saved BOT and no sidebar access', async () => {
  await seed();
  await local.set({
    bots: [
      { id: 'main', name: 'Main' },
      { id: 'a', name: 'Saved A' },
      { id: 'b', name: 'Saved B' },
    ],
    settings: { defaultBotId: 'main', favorites: ['b', 'a'], askBeforeSend: false },
  });
  const opened = [];
  globalThis.chrome.windows = { create: async (options) => opened.push(options) };
  globalThis.chrome.sidePanel = {
    open: async () => {
      throw Error('Sidebar must not be opened');
    },
  };
  const sender = {
    id: 'fixture',
    url: 'https://www.douyin.com/video/123',
    frameId: 0,
    tab: { id: 7, windowId: 2, url: 'https://www.douyin.com/video/123' },
  };
  const targets = await worker.handle({ type: 'social.targets' }, sender);
  assert.deepEqual(
    targets.favorites.map((b) => b.id),
    ['b', 'a'],
  );
  const result = await worker.handle(
    {
      type: 'social.capture',
      chooseBot: true,
      record: {
        platform: 'douyin',
        id: '123',
        url: sender.url,
        title: 'Video',
        text: 'Body',
        author: { name: 'Author' },
        tags: [],
        metrics: {},
        images: [],
        videos: [],
        captureSource: 'dom',
      },
    },
    sender,
  );
  assert.equal(result.pickerOpened, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].type, 'popup');
  const url = new URL(opened[0].url);
  assert.equal(url.pathname, '/share.html');
  const state = await worker.handle(
    { type: 'social.picker.state', id: url.searchParams.get('request') },
    ui,
  );
  assert.equal(state.bots.length, 3);
  assert.equal(state.post.title, 'Video');
});
test('editor falls back to a real popup window when Chrome rejects the sidebar gesture', async () => {
  await seed();
  const opened = [];
  globalThis.chrome.windows = { create: async (options) => opened.push(options) };
  globalThis.chrome.sidePanel = {
    open: async () => {
      throw Error('requires a user gesture');
    },
  };
  const result = await worker.openComposer('draft-fallback', 2);
  assert.equal(result.surface, 'window');
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0].url).pathname, '/app.html');
  assert.equal(new URL(opened[0].url).searchParams.get('draft'), 'draft-fallback');
  assert.equal(result.needsOpen, undefined);
});
test('fast authorization waits for its created tab id before completing login and closing the auth page', async () => {
  await seed();
  removedTabs.length = 0;
  await session.remove(['credentials', 'loginFlow']);
  const previousFetch = globalThis.fetch,
    previousCreate = globalThis.chrome.tabs.create;
  let finishCreate;
  const created = new Promise((resolve) => (finishCreate = resolve));
  globalThis.chrome.tabs.create = async ({ url }) => {
    currentURL = url;
    return created;
  };
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/auth/poll')
      return new Response(JSON.stringify({ accessToken: 'synthetic-fast-login' }), { status: 200 });
    throw Error('synthetic roster offline');
  };
  async function until(fn) {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error('Login condition timed out');
  }
  try {
    const starting = worker.handle({ type: 'login' }, ui);
    await until(() => session.data.loginFlow && typeof finishCreate === 'function');
    await worker.pollLogin();
    assert.ok(session.data.loginFlow, 'the flow must survive polling before tabs.create resolves');
    finishCreate({ id: 88 });
    await starting;
    await until(() => removedTabs.includes(88));
    assert.equal(session.data.credentials.accessToken, 'synthetic-fast-login');
    assert.deepEqual(removedTabs, [88]);
  } finally {
    finishCreate?.({ id: 88 });
    globalThis.fetch = previousFetch;
    globalThis.chrome.tabs.create = previousCreate;
  }
});

test('embedded social picker stays in the source tab and denies another extension frame', async () => {
  await seed();
  await local.set({ bots: [{ id: 'main', name: 'Main' }], settings: { defaultBotId: 'main' } });
  const opened = [];
  globalThis.chrome.windows = { create: async (options) => opened.push(options) };
  const sender = {
    id: 'fixture',
    url: 'https://x.com/a/status/123',
    frameId: 0,
    tab: { id: 7, windowId: 2 },
  };
  const result = await worker.handle(
    {
      type: 'social.capture',
      chooseBot: true,
      embedded: true,
      record: { platform: 'x', id: '123', url: sender.url, text: 'Post' },
    },
    sender,
  );
  assert.ok(result.pickerId);
  assert.equal(opened.length, 0);
  const frame = { id: 'fixture', url: runtime.getURL('share.html?embedded=1'), tab: { id: 7 } };
  assert.equal(
    (await worker.handle({ type: 'social.picker.state', id: result.pickerId }, frame)).bots.length,
    1,
  );
  await assert.rejects(
    worker.handle(
      { type: 'social.picker.state', id: result.pickerId },
      { ...frame, tab: { id: 8 } },
    ),
    /UNTRUSTED_SENDER/,
  );
});

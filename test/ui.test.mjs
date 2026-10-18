import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { indexedDB } from 'fake-indexeddb';
const code = (
  await build({
    entryPoints: ['src/ui/app.js'],
    bundle: true,
    format: 'esm',
    write: false,
    target: 'chrome120',
  })
).outputFiles[0].text;
const pause = () => new Promise((r) => setTimeout(r, 10));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await pause();
  }
  throw Error('UI condition timed out');
}
const defaults = {
  defaultBotId: 'one',
  favorites: [],
  actionBots: {},
  rules: [],
  askBeforeSend: false,
  includeSource: true,
  includeNearby: true,
  includePageContext: true,
  archiveMHTML: true,
  screenshotMode: 'region',
  maxTextBytes: 48000,
  maxAttachmentBytes: 134217728,
  maxScrollHeight: 16000,
  retentionDays: 7,
  theme: 'light',
  taskPreset: '',
  persistLogin: false,
};
async function ui(path = 'popup.html', seed, options = {}) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {
      url: 'https://extension.test/' + path,
      pretendToBeVisual: true,
      runScripts: 'outside-only',
    }),
    w = dom.window;
  const calls = [],
    listeners = [];
  let state = {
    authenticated: true,
    settings: structuredClone(defaults),
    account: { id: 'account-a', name: '验收账户' },
    bots: [
      { id: 'one', name: '研究员', avatarShape: 'blob', avatarColor: 'green' },
      { id: 'two', name: '开发员', avatarShape: 'hex', avatarColor: 'blue' },
    ],
    jobs: [],
    basket: [],
  };
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.indexedDB = indexedDB;
  w.structuredClone = structuredClone;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new w.Event('close'));
  };
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.chrome = {
    storage: {
      session: {
        get: async () => options.savedSideView || {},
        set: async (data) => calls.push({ type: 'storage.session.set', data }),
      },
    },
    runtime: {
      connect: () => ({
        postMessage() {},
        disconnect() {},
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
      }),
      getURL: (p) => 'https://extension.test/' + p,
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
      sendMessage: async (m) => {
        calls.push(m);
        const override = await options.onRequest?.(m);
        if (override) return override;
        if (m.type === 'state') return { ok: true, value: structuredClone(state) };
        if (m.type === 'capture.target')
          return { ok: true, value: { id: 4, windowId: 1, url: 'https://example.com' } };
        if (m.type === 'settings') {
          Object.assign(state.settings, m.patch);
          return { ok: true, value: structuredClone(state.settings) };
        }
        if (m.type === 'replies') return { ok: true, value: options.replies || [] };
        if (m.type === 'draft.send') {
          await options.onDraftSend?.();
          return { ok: true, value: { jobId: 'j1' } };
        }
        return { ok: true, value: {} };
      },
    },
    commands: { getAll: async () => options.shortcuts || [] },
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: { create: async () => {} },
    sidePanel: { open: async () => {} },
    permissions: { request: async () => true },
  };
  if (options.firefox) {
    w.browser = {
      ...w.chrome,
      browserAction: {},
      sidebarAction: {
        open() {
          calls.push({ type: 'firefox.sidebar.open' });
          return Promise.resolve();
        },
      },
      runtime: { ...w.chrome.runtime, getBrowserInfo: async () => ({ name: 'Firefox' }) },
    };
    delete w.browser.sidePanel;
    delete w.chrome;
  }
  if (seed) {
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('grok-bot-browser', 1);
      r.onupgradeneeded = () => {
        for (const n of ['materials', 'drafts', 'jobs', 'replies', 'meta'])
          r.result.createObjectStore(n, { keyPath: 'id' });
      };
      r.onsuccess = () => {
        const tx = r.result.transaction(['drafts', 'materials'], 'readwrite');
        for (const [name, row] of seed) tx.objectStore(name).put(row);
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }
  await w.eval('(async()=>{' + code + '})()');
  return {
    w,
    calls,
    listeners,
    setState: (next) => {
      state = { ...state, ...next };
    },
    close: () => {
      w.dispatchEvent(new w.Event('pagehide'));
      dom.window.close();
    },
  };
}
test('popup actions and searchable avatar picker are functional without decorative bot labels', async () => {
  const t = await ui();
  try {
    assert.ok(t.w.document.querySelector('[data-action="save-page"]'));
    t.w.document.querySelector('[data-action="pick-bot"]').click();
    await until(() => t.w.document.querySelectorAll('.bot-row').length === 2);
    assert.equal(t.w.document.querySelectorAll('.bot-row [data-avatar]').length, 2);
    const input = t.w.document.querySelector('#bot-search');
    input.value = '开发';
    input.dispatchEvent(new t.w.Event('input', { bubbles: true }));
    assert.equal(t.w.document.querySelectorAll('.bot-row').length, 1);
    assert.match(t.w.document.querySelector('.bot-choice').textContent, /开发员/);
    for (const query of ['kaifayuan', 'KFY', 'kai']) {
      input.value = query;
      input.dispatchEvent(new t.w.Event('input', { bubbles: true }));
      assert.equal(t.w.document.querySelectorAll('.bot-row').length, 1, query);
      assert.match(t.w.document.querySelector('.bot-choice').textContent, /开发员/);
    }
  } finally {
    t.close();
  }
});
test('IME confirmation Enter never sends; ordinary Enter sends exactly once', async () => {
  const d = {
    id: 'ime-draft',
    accountId: 'account-a',
    botId: 'one',
    itemIds: [],
    instruction: '',
    preset: '',
    createdAt: Date.now(),
  };
  const t = await ui('app.html?view=compose&draft=ime-draft', [['drafts', d]]);
  try {
    const field = t.w.document.querySelector('#instruction');
    assert.ok(field);
    field.value = '请总结材料';
    field.dispatchEvent(new t.w.Event('input', { bubbles: true }));
    field.dispatchEvent(
      new t.w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    await pause();
    assert.equal(t.calls.filter((m) => m.type === 'draft.send').length, 0);
    field.dispatchEvent(
      new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await until(() => t.calls.some((m) => m.type === 'draft.send'));
    assert.equal(t.calls.filter((m) => m.type === 'draft.send').length, 1);
  } finally {
    t.close();
  }
});
test('account change clears open compose UI', async () => {
  const d = {
    id: 'old-account-draft',
    accountId: 'account-a',
    botId: 'one',
    itemIds: [],
    instruction: 'account-a-private-draft',
    preset: '',
  };
  const t = await ui('app.html?view=compose&draft=old-account-draft', [['drafts', d]]);
  try {
    assert.match(t.w.document.querySelector('textarea').value, /account-a-private/);
    t.setState({ authenticated: false, account: undefined, bots: [] });
    for (const fn of t.listeners) fn({ type: 'state.changed' });
    await until(() => t.w.document.querySelector('[data-action="login"]'));
    assert.ok(!t.w.document.body.textContent.includes('account-a-private'));
  } finally {
    t.close();
  }
});

test('home exposes all capture tools directly in labeled groups', async () => {
  const t = await ui();
  try {
    for (const action of [
      'capture-region',
      'capture-viewport',
      'capture-full',
      'element',
      'video',
      'page-basket',
      'file',
      'tabs',
      'basket',
      'history',
    ])
      assert.ok(t.w.document.querySelector(`#panel [data-action="${action}"]`), action);
    assert.equal(t.w.document.querySelector('[data-action="more-capture"]'), null);
    assert.equal(t.w.document.querySelectorAll('.tool-group').length, 3);
  } finally {
    t.close();
  }
});
test('picker separates saved bots from the default and renders avatars at their container size', async () => {
  const t = await ui();
  try {
    t.w.document.querySelector('[data-action="pick-bot"]').click();
    await until(() => t.w.document.querySelector('.bot-choice'));
    assert.equal(t.w.document.querySelector('.bot-choice .avatar').dataset.size, '64');
    assert.equal(t.w.document.querySelector('.default-badge').textContent, '默认');
    const save = t.w.document.querySelector('[data-favorite="two"]');
    assert.equal(save.getAttribute('aria-pressed'), 'false');
    save.click();
    await until(
      () =>
        t.w.document.querySelector('[data-favorite="two"]').getAttribute('aria-pressed') === 'true',
    );
    assert.ok(t.calls.some((m) => m.type === 'settings' && m.patch.favorites.includes('two')));
  } finally {
    t.close();
  }
});
test('chat keeps the composer outside the transcript and sends IME-safe followups once', async () => {
  const t = await ui('sidepanel.html');
  try {
    assert.ok(t.w.document.querySelector('.topbar .bot-switch--compact'));
    assert.ok(t.w.document.querySelector('#panel #replies-list'));
    assert.equal(t.w.document.querySelector('#panel #followup'), null);
    const input = t.w.document.querySelector('.chat-composer #followup');
    input.value = '继续分析';
    input.dispatchEvent(new t.w.Event('input', { bubbles: true }));
    input.dispatchEvent(
      new t.w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    await pause();
    assert.equal(t.calls.filter((m) => m.type === 'draft.send').length, 0);
    input.dispatchEvent(
      new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await until(() => t.calls.some((m) => m.type === 'draft.send'));
    assert.equal(t.calls.filter((m) => m.type === 'draft.send').length, 1);
    assert.equal(input.value, '');
  } finally {
    t.close();
  }
});

test('chat renders Markdown and keeps one BOT selector in the toolbar', async () => {
  const t = await ui('sidepanel.html', undefined, {
    replies: [
      { text: '# 标题\n\n**重点**\n\n```js\nconst answer = 42;\n```', updatedAt: Date.now() },
    ],
  });
  try {
    assert.equal(t.w.document.querySelectorAll('.bot-switch').length, 1);
    assert.ok(t.w.document.querySelector('.topbar [data-action="pick-bot"]'));
    assert.equal(t.w.document.querySelector('.markdown h1').textContent, '标题');
    assert.equal(t.w.document.querySelector('.markdown strong').textContent, '重点');
    assert.ok(t.w.document.querySelector('.markdown .hljs-keyword'));
  } finally {
    t.close();
  }
});
test('settings groups retain controls, save changes and reject invalid limits', async () => {
  const t = await ui('app.html?view=settings');
  try {
    assert.equal(t.w.document.querySelectorAll('.settings-section').length, 6);
    for (const key of [
      'composerSurface',
      'taskPreset',
      'screenshotMode',
      'maxTextBytes',
      'maxAttachmentMB',
      'maxScrollHeight',
      'theme',
      'retentionDays',
    ])
      assert.ok(t.w.document.querySelector(`[data-setting="${key}"]`), key);
    const limit = t.w.document.querySelector('#file-limit');
    limit.value = '129';
    limit.dispatchEvent(new t.w.Event('change', { bubbles: true }));
    await pause();
    assert.equal(limit.getAttribute('aria-invalid'), 'true');
    assert.equal(t.calls.filter((m) => m.type === 'settings').length, 0);
    limit.value = '32';
    limit.dispatchEvent(new t.w.Event('change', { bubbles: true }));
    await pause();
    assert.equal(t.calls.find((m) => m.type === 'settings').patch.maxAttachmentBytes, 32 * 1048576);
    assert.equal(limit.getAttribute('aria-invalid'), 'false');
    assert.match(t.w.document.querySelector('#settings-save-state').textContent, /已自动保存/);
  } finally {
    t.close();
  }
});

test('settings opens BOT conversation locally without sending an unsupported sidebar request', async () => {
  const t = await ui('app.html?view=settings');
  try {
    t.w.document.querySelector('[data-action="replies"]').click();
    await until(() => t.w.document.querySelector('#followup'));
    assert.equal(t.w.document.body.dataset.view, 'replies');
    assert.equal(
      t.calls.some((m) => m.type === 'sidepanel.navigate'),
      false,
    );
  } finally {
    t.close();
  }
});
test('sidepanel restores the draft list and opening a draft never shows replies', async () => {
  const d = {
    id: 'restore-draft',
    accountId: 'account-a',
    botId: 'one',
    itemIds: [],
    instruction: '尚未发送的说明',
    preset: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const t = await ui('sidepanel.html', [['drafts', d]], {
    savedSideView: { 'sidepanelView:1': 'drafts', 'composerDraft:1': d.id },
  });
  try {
    assert.equal(t.w.document.body.dataset.view, 'drafts');
    assert.ok(t.w.document.querySelector(`[data-resume-draft="${d.id}"]`));
    t.w.document.querySelector(`[data-resume-draft="${d.id}"]`).click();
    await until(() => t.w.document.querySelector('#instruction'));
    assert.equal(t.w.document.querySelector('#instruction').value, d.instruction);
    assert.equal(t.w.document.querySelector('#followup'), null);
    assert.notEqual(
      t.w.document.querySelector('[data-action="resume-compose"] svg').outerHTML,
      t.w.document.querySelector('[data-action="preview-packet"] svg').outerHTML,
    );
  } finally {
    t.close();
  }
});
test('shortcuts use individually labeled readable keys and modifier icons', async () => {
  const t = await ui('app.html?view=settings', undefined, {
    shortcuts: [{ name: 'capture-region', shortcut: 'Command+Shift+7' }],
  });
  try {
    const keys = t.w.document.querySelector('.shortcut-keys');
    assert.ok(keys);
    assert.equal(keys.getAttribute('aria-label'), 'Command+Shift+7');
    assert.equal(keys.querySelectorAll('kbd').length, 3);
    assert.equal(keys.querySelectorAll('kbd svg').length, 2);
  } finally {
    t.close();
  }
});

test('sending a draft does not break or replace a conversation opened while the request is pending', async () => {
  let finish;
  const pending = new Promise((resolve) => (finish = resolve));
  const d = {
    id: 'pending-draft',
    accountId: 'account-a',
    botId: 'one',
    itemIds: [],
    instruction: 'send',
    preset: '',
    createdAt: Date.now(),
  };
  const t = await ui('app.html?view=compose&draft=pending-draft', [['drafts', d]], {
    onDraftSend: () => pending,
  });
  try {
    t.w.document.querySelector('[data-action="send"]').click();
    await until(() => t.calls.some((m) => m.type === 'draft.send'));
    t.w.document.querySelector('[data-action="replies"]').click();
    await until(() => t.w.document.querySelector('#followup'));
    finish();
    await pause();
    await pause();
    assert.equal(t.w.document.body.dataset.view, 'replies');
    assert.ok(t.w.document.querySelector('#followup'));
    assert.equal(t.calls.filter((m) => m.type === 'draft.send').length, 1);
  } finally {
    finish();
    t.close();
  }
});

test('picker RPC failures show the failing operation without an unhandled rejection', async () => {
  const t = await ui('popup.html', undefined, {
    onRequest: (m) => (m.type === 'settings' ? { ok: false, error: 'UNKNOWN_ACTION' } : undefined),
  });
  try {
    t.w.document.querySelector('[data-action="pick-bot"]').click();
    await until(() => t.w.document.querySelector('[data-favorite="two"]'));
    t.w.document.querySelector('[data-favorite="two"]').click();
    await until(() => t.w.document.querySelector('dialog[open] [data-dialog-status]'));
    assert.match(
      t.w.document.querySelector('dialog[open] [data-dialog-status]').textContent,
      /保存设置.*重新加载扩展/,
    );
    assert.equal(
      t.w.document.querySelector('[data-favorite="two"]').getAttribute('aria-pressed'),
      'false',
    );
  } finally {
    t.close();
  }
});
test('opening a popup draft handles a rejected background operation and leaves the draft available', async () => {
  const d = {
    id: 'rejected-open-draft',
    accountId: 'account-a',
    workspaceId: 'personal',
    botId: 'one',
    itemIds: [],
    instruction: 'Keep draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const t = await ui('popup.html?view=drafts', [['drafts', d]], {
    onRequest: (m) =>
      m.type === 'composer.open.saved' ? { ok: false, error: 'UNKNOWN_ACTION' } : undefined,
  });
  try {
    t.w.document.querySelector('[data-resume-draft="rejected-open-draft"]').click();
    await until(() => /打开草稿/.test(t.w.document.querySelector('#toast').textContent));
    assert.match(t.w.document.querySelector('#toast').textContent, /重新加载扩展/);
    assert.ok(t.w.document.querySelector('[data-resume-draft="rejected-open-draft"]'));
  } finally {
    t.close();
  }
});

test('BOT picker refresh keeps the dialog and search open across state notifications', async () => {
  let t, resolve;
  const pending = new Promise((r) => (resolve = r));
  t = await ui('popup.html', undefined, {
    onRequest: async (m) => {
      if (m.type !== 'bots.refresh') return;
      await pending;
      t.setState({
        bots: [
          { id: 'one', name: '研究员更新' },
          { id: 'three', name: '新 BOT' },
        ],
      });
      for (const fn of t.listeners) fn({ type: 'state.changed' });
      return { ok: true, value: {} };
    },
  });
  try {
    const d = t.w.document;
    d.querySelector('[data-action="pick-bot"]').click();
    const dialog = d.querySelector('dialog[open]');
    const refresh = dialog.querySelector('#refresh-picker-bots');
    assert.ok(refresh);
    dialog.querySelector('#bot-search').value = '研究';
    refresh.click();
    refresh.click();
    await until(() => refresh.disabled);
    assert.equal(t.calls.filter((c) => c.type === 'bots.refresh').length, 1);
    resolve();
    await until(() => !refresh.disabled);
    assert.equal(d.querySelector('dialog[open]'), dialog);
    assert.equal(dialog.querySelector('#bot-search').value, '研究');
    assert.match(dialog.querySelector('.bot-choice').textContent, /研究员更新/);
    dialog.querySelector('#bot-search').value = '';
    dialog.querySelector('#bot-search').dispatchEvent(new t.w.Event('input'));
    assert.ok(dialog.querySelector('[data-select-bot="three"]'));
    assert.equal(dialog.querySelector('[data-select-bot="two"]'), null);
  } finally {
    resolve();
    t.close();
  }
});

test('Firefox popup chooses BOTs and opens native chat without any chrome namespace', async () => {
  const t = await ui('popup.html', undefined, { firefox: true });
  try {
    const d = t.w.document;
    assert.ok(d.querySelector('[data-action="pick-bot"]'));
    d.querySelector('[data-action="pick-bot"]').click();
    await until(() => d.querySelectorAll('.bot-choice').length === 2);
    d.querySelector('[data-action="close-dialog"]').click();
    d.querySelector('[data-action="replies"]').click();
    await until(() => t.calls.some((c) => c.type === 'sidepanel.navigate'));
    assert.equal(t.calls.filter((c) => c.type === 'firefox.sidebar.open').length, 1);
  } finally {
    t.close();
  }
});
test('Firefox settings describe the body HTML archive rather than promising MHTML', async () => {
  const t = await ui('app.html?view=settings', undefined, { firefox: true });
  try {
    const d = t.w.document;
    assert.ok(d.querySelector('[data-toggle="archiveMHTML"]'));
    assert.match(d.querySelector('#panel').textContent, /HTML/);
    assert.doesNotMatch(d.querySelector('#panel').textContent, /MHTML/);
    assert.ok(d.querySelector('[data-action="shortcuts"]'));
  } finally {
    t.close();
  }
});

test('Firefox shortcut help never attempts to open privileged about URLs', async () => {
  let opened = 0;
  const t = await ui('app.html?view=settings', undefined, { firefox: true });
  t.w.browser.tabs.create = async () => {
    opened++;
    throw Error('Privileged URL');
  };
  try {
    t.w.document.querySelector('[data-action="shortcuts"]').click();
    await until(() => t.w.document.querySelector('dialog[open]'));
    assert.match(t.w.document.querySelector('dialog').textContent, /about:addons/);
    assert.match(t.w.document.querySelector('dialog').textContent, /管理扩展快捷键/);
    assert.equal(opened, 0);
  } finally {
    t.close();
  }
});

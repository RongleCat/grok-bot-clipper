import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
const code = (
  await build({
    entryPoints: ['src/ui/share.js'],
    bundle: true,
    format: 'esm',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
).outputFiles[0].text;
const pause = () => new Promise((r) => setTimeout(r, 15));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await pause();
  }
  throw Error('Share popup condition timed out');
}
async function setup(askBeforeSend, send, refresh, firefox = false, embedded = false) {
  let bots = [
    { id: 'main', name: 'Main' },
    { id: 'saved', name: 'Saved' },
    { id: 'other', name: 'Other' },
  ];
  const dom = new JSDOM('<div id="app"></div>', {
      url:
        'https://extension.test/share.html?request=req' +
        (embedded ? '&embedded=1&parentOrigin=https%3A%2F%2Fx.com' : ''),
      pretendToBeVisual: true,
      runScripts: 'outside-only',
    }),
    w = dom.window,
    calls = [];
  const frameMessages = [];
  w.parent.postMessage = (data, origin) => frameMessages.push({ data, origin });
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.chrome = {
    runtime: {
      sendMessage: async (message) => {
        calls.push(message);
        if (message.type === 'social.picker.state')
          return {
            ok: true,
            value: {
              bots,
              favorites: ['saved'],
              primaryId: 'main',
              selectedBotId: 'main',
              askBeforeSend,
              post: { title: 'Post', url: 'https://x.com/a/status/123' },
            },
          };
        if (message.type === 'bots.refresh') return refresh ? refresh() : { ok: true, value: {} };
        return send ? send(message) : { ok: true, value: { jobId: 'job' } };
      },
    },
    sidePanel: {
      open() {
        throw Error('Sidebar must not be used');
      },
    },
  };
  if (firefox) {
    w.browser = {
      ...w.chrome,
      runtime: { ...w.chrome.runtime, getBrowserInfo: async () => ({ name: 'Firefox' }) },
    };
    delete w.chrome;
  }
  await w.eval('(async()=>{' + code + '})()');
  return {
    w,
    calls,
    frameMessages,
    setBots(next) {
      bots = next;
    },
    close() {
      w.dispatchEvent(new w.Event('pagehide'));
      w.close();
    },
  };
}
test('standalone chooser lists all BOT groups, searches, confirms the selected BOT and avoids duplicate sends', async () => {
  let resolve;
  const waiting = new Promise((r) => (resolve = r));
  const t = await setup(true, () => waiting);
  try {
    const d = t.w.document;
    assert.equal(d.querySelectorAll('[data-bot]').length, 3);
    assert.deepEqual(
      [...d.querySelectorAll('h2')].map((n) => n.textContent),
      ['主 BOT', '收藏 BOT', '其他 BOT'],
    );
    const search = d.querySelector('#search');
    search.value = 'Other';
    search.dispatchEvent(new t.w.Event('input'));
    assert.equal(d.querySelectorAll('[data-bot]').length, 1);
    d.querySelector('[data-bot="other"]').click();
    d.querySelector('#instruction').value = 'Summarize';
    d.querySelector('#send').click();
    d.querySelector('#send').click();
    await until(() => t.calls.some((c) => c.type === 'social.picker.send'));
    const messages = t.calls.filter((c) => c.type === 'social.picker.send');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].botId, 'other');
    assert.equal(messages[0].instruction, 'Summarize');
    resolve({ ok: true, value: { jobId: 'job' } });
    await until(() => d.querySelector('#status').textContent.includes('已加入发送队列'));
    assert.equal(d.querySelector('#send').disabled, true);
  } finally {
    t.close();
  }
});
test('standalone chooser hides supplementary instructions when disabled and keeps errors visible for retry', async () => {
  const t = await setup(false, async () => ({ ok: false, error: 'BOT_UNAVAILABLE' }));
  try {
    const d = t.w.document;
    assert.equal(d.querySelector('#instruction'), null);
    d.querySelector('#send').click();
    await until(() => d.querySelector('#status').dataset.error === 'true');
    assert.match(d.querySelector('#status').textContent, /重新选择/);
    assert.equal(d.querySelector('#send').disabled, false);
  } finally {
    t.close();
  }
});

test('refresh fetches remote BOTs without losing search, instructions or a valid selection', async () => {
  let resolve;
  let pending = new Promise((r) => (resolve = r));
  const t = await setup(true, undefined, () => pending);
  try {
    const d = t.w.document;
    const refresh = d.querySelector('#refresh-bots');
    assert.ok(refresh, 'refresh control is available in the chooser');
    d.querySelector('#search').value = 'Main';
    d.querySelector('#instruction').value = 'Keep this instruction';
    refresh.click();
    refresh.click();
    assert.equal(d.querySelector('#send').disabled, true);
    assert.equal(t.calls.filter((c) => c.type === 'bots.refresh').length, 1);
    t.setBots([
      { id: 'main', name: 'Main renamed' },
      { id: 'new', name: 'New BOT' },
    ]);
    resolve({ ok: true, value: {} });
    await until(() => !refresh.disabled);
    assert.equal(d.querySelector('#search').value, 'Main');
    assert.equal(d.querySelector('#instruction').value, 'Keep this instruction');
    assert.equal(d.querySelector('[data-bot="main"]').getAttribute('aria-pressed'), 'true');
    assert.equal(d.querySelector('#send').disabled, false);
    t.setBots([{ id: 'new', name: 'New BOT' }]);
    refresh.click();
    await until(() => !refresh.disabled);
    assert.equal(d.querySelector('#send').disabled, true);
    assert.match(d.querySelector('#status').textContent, /重新选择/);
    d.querySelector('#search').value = '';
    d.querySelector('#search').dispatchEvent(new t.w.Event('input'));
    assert.equal(d.querySelectorAll('[data-bot]').length, 1);
    assert.ok(d.querySelector('[data-bot="new"]'));
  } finally {
    t.close();
  }
});
test('failed BOT refresh preserves the previous list and allows retry', async () => {
  const t = await setup(false, undefined, async () => ({ ok: false, error: 'NETWORK_ERROR' }));
  try {
    const d = t.w.document;
    const refresh = d.querySelector('#refresh-bots');
    assert.ok(refresh);
    refresh.click();
    await until(() => !refresh.disabled);
    assert.equal(d.querySelectorAll('[data-bot]').length, 3);
    assert.equal(d.querySelector('#send').disabled, false);
    assert.equal(d.querySelector('#status').dataset.error, 'true');
  } finally {
    t.close();
  }
});

test('Firefox independent BOT chooser renders and submits through browser.runtime', async () => {
  const t = await setup(false, undefined, undefined, true);
  try {
    const d = t.w.document;
    assert.equal(d.querySelectorAll('[data-bot]').length, 3);
    d.querySelector('#send').click();
    await until(() => d.querySelector('#status').textContent.includes('已加入发送队列'));
    assert.equal(t.calls.find((c) => c.type === 'social.picker.send').botId, 'main');
  } finally {
    t.close();
  }
});

test('embedded chooser shows only compact search and all BOTs, then sends on BOT click once', async () => {
  let resolve;
  const pending = new Promise((r) => (resolve = r));
  const t = await setup(false, () => pending, undefined, false, true);
  try {
    const d = t.w.document;
    assert.equal(d.querySelector('h1,.source'), null);
    assert.equal(d.querySelectorAll('[data-bot]').length, 3);
    assert.equal(d.querySelector('footer').hidden, true);
    const search = d.querySelector('#search');
    search.value = 'Other';
    search.dispatchEvent(new t.w.Event('input'));
    assert.equal(d.querySelectorAll('[data-bot]').length, 1);
    d.querySelector('[data-bot="other"]').click();
    d.querySelector('[data-bot="other"]').click();
    await until(() => t.calls.some((c) => c.type === 'social.picker.send'));
    assert.equal(t.calls.filter((c) => c.type === 'social.picker.send').length, 1);
    assert.equal(t.calls.find((c) => c.type === 'social.picker.send').botId, 'other');
    resolve({ ok: true, value: { jobId: 'job' } });
    await until(() => t.frameMessages.some((m) => m.data.type === 'queued'));
    assert.ok(t.frameMessages.every((m) => m.origin === 'https://x.com'));
  } finally {
    t.close();
  }
});

test('embedded Firefox chooser keeps optional instructions in a separate compact confirmation step', async () => {
  const t = await setup(true, undefined, undefined, true, true);
  try {
    const d = t.w.document;
    d.querySelector('[data-bot="other"]').click();
    assert.equal(d.querySelector('#bots').hidden, true);
    assert.equal(d.querySelector('footer').hidden, false);
    assert.equal(t.calls.filter((c) => c.type === 'social.picker.send').length, 0);
    d.querySelector('#instruction').value = 'Summarize';
    d.querySelector('#send').click();
    await until(() => t.calls.some((c) => c.type === 'social.picker.send'));
    assert.equal(t.calls.find((c) => c.type === 'social.picker.send').instruction, 'Summarize');
  } finally {
    t.close();
  }
});

test('embedded chooser matches BOT names by full pinyin, initials, exact name and prefix', async () => {
  const t = await setup(false, undefined, undefined, false, true);
  try {
    t.setBots([
      { id: 'long', name: '知识管理员助手' },
      { id: 'middle', name: '我的知识管理员' },
      { id: 'exact', name: '知识管理员' },
      { id: 'mixed', name: 'X调度员' },
    ]);
    const d = t.w.document;
    d.querySelector('#refresh-bots').click();
    await until(() => d.querySelector('[data-bot="exact"]'));
    const search = d.querySelector('#search');
    for (const query of ['知识管理员', '知识', 'zhishiguanliyuan', 'Z S G L Y']) {
      search.value = query;
      search.dispatchEvent(new t.w.Event('input'));
      assert.deepEqual(
        [...d.querySelectorAll('[data-bot]')].map((n) => n.dataset.bot),
        query === '知识' ? ['long', 'exact', 'middle'] : ['exact', 'long', 'middle'],
        query,
      );
    }
    search.value = 'xddy';
    search.dispatchEvent(new t.w.Event('input'));
    assert.equal(d.querySelector('[data-bot]')?.dataset.bot, 'mixed');
  } finally {
    t.close();
  }
});

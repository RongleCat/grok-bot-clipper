import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
const catalogs = Object.fromEntries(
  await Promise.all(
    ['en', 'zh_CN'].map(async (language) => [
      language,
      JSON.parse(await readFile(`src/i18n/locales/${language}.json`, 'utf8')),
    ]),
  ),
);
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await pause();
  }
  throw Error('Live chooser condition timed out');
}
async function setup(embedded) {
  const dom = new JSDOM('<div id="app"></div>', {
    url:
      'https://extension.test/share.html?request=req' +
      (embedded ? '&embedded=1&parentOrigin=https%3A%2F%2Fx.com' : ''),
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const w = dom.window,
    listeners = new Set(),
    calls = [];
  let language = 'zh_CN',
    finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.parent.postMessage = () => {};
  w.chrome = {
    i18n: { getUILanguage: () => language },
    runtime: {
      onMessage: {
        addListener(fn) {
          listeners.add(fn);
        },
        removeListener(fn) {
          listeners.delete(fn);
        },
      },
      sendMessage: async (message) => {
        calls.push(message);
        if (message.type === 'i18n.locale')
          return {
            ok: true,
            value: { language, resolvedLanguage: language, catalog: catalogs[language] },
          };
        if (message.type === 'social.picker.state')
          return {
            ok: true,
            value: {
              language,
              bots: [
                { id: 'main', name: 'Main' },
                { id: 'other', name: 'Other' },
              ],
              favorites: [],
              primaryId: 'main',
              selectedBotId: 'main',
              askBeforeSend: true,
              post: { title: 'Original title', url: 'https://x.com/a/status/1' },
            },
          };
        if (message.type === 'social.picker.send') return pending;
        return { ok: true, value: {} };
      },
    },
  };
  await w.eval('(async()=>{' + code + '})()');
  return {
    w,
    calls,
    finish,
    setLanguage(next) {
      language = next;
    },
    async change(next) {
      language = next;
      for (const fn of listeners) fn({ type: 'state.changed' });
      await until(() => w.document.documentElement.lang === next.replace('_', '-'));
      await pause();
    },
    close() {
      w.dispatchEvent(new w.Event('pagehide'));
      w.close();
    },
  };
}
for (const embedded of [false, true])
  test(`live language preserves ${embedded ? 'embedded instruction phase' : 'standalone draft'} and never unlocks an in-flight/queued send`, async () => {
    const t = await setup(embedded),
      d = t.w.document;
    try {
      d.querySelector('[data-bot="other"]').click();
      d.querySelector('#search').value = 'oth';
      d.querySelector('#instruction').value = '用户原文 "keep"';
      await t.change('en');
      assert.equal(d.querySelector('#search').placeholder, catalogs.en['搜索 BOT']);
      assert.equal(d.querySelector('#search').value, 'oth');
      assert.equal(d.querySelector('#instruction').value, '用户原文 "keep"');
      assert.equal(d.querySelector('[data-bot="other"]').getAttribute('aria-pressed'), 'true');
      if (embedded) {
        assert.equal(d.querySelector('footer').hidden, false);
        assert.equal(d.querySelector('#bots').hidden, true);
      }
      d.querySelector('#send').click();
      await until(() => t.calls.filter((c) => c.type === 'social.picker.send').length === 1);
      await t.change('zh_CN');
      assert.equal(d.querySelector('#send').disabled, true);
      assert.equal(d.querySelector('#instruction').value, '用户原文 "keep"');
      d.querySelector('#send').click();
      assert.equal(t.calls.filter((c) => c.type === 'social.picker.send').length, 1);
      t.finish({ ok: true, value: { jobId: 'accepted' } });
      await until(() => d.querySelector('#status').textContent.includes('已加入'));
      await t.change('en');
      assert.equal(d.querySelector('#send').disabled, true);
      assert.equal(d.querySelector('[data-bot="other"]').disabled, true);
      assert.equal(t.calls.filter((c) => c.type === 'social.picker.send').length, 1);
    } finally {
      t.finish({ ok: true, value: { jobId: 'accepted' } });
      t.close();
    }
  });

test('remote roster refresh also applies the latest language without resetting the draft', async () => {
  const t = await setup(false),
    d = t.w.document;
  try {
    d.querySelector('[data-bot="other"]').click();
    d.querySelector('#search').value = 'oth';
    d.querySelector('#instruction').value = '原始说明';
    t.setLanguage('en');
    d.querySelector('#refresh-bots').click();
    await until(() => d.querySelector('#search').placeholder === catalogs.en['搜索 BOT']);
    await until(() => !d.querySelector('#refresh-bots').disabled);
    assert.equal(d.querySelector('#search').value, 'oth');
    assert.equal(d.querySelector('#instruction').value, '原始说明');
    assert.equal(d.querySelector('[data-bot="other"]').getAttribute('aria-pressed'), 'true');
    assert.equal(t.calls.filter((c) => c.type === 'social.picker.send').length, 0);
  } finally {
    t.finish({ ok: true, value: { jobId: 'unused' } });
    t.close();
  }
});

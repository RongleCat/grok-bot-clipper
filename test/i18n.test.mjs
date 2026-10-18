import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLocale,
  t,
  setLocale,
  initI18n,
  getLocale,
  getCatalog,
  formatDate,
  onLocaleChange,
} from '../src/i18n/index.js';
import { supportedLocales } from '../src/i18n/locales.js';
test('locale resolution supports Chrome codes, browser aliases and safe English fallback', () => {
  for (const [value, expected] of [
    ['zh-Hans', 'zh_CN'],
    ['zh-HK', 'zh_TW'],
    ['zh-SG', 'zh_CN'],
    ['pt-PT', 'pt_PT'],
    ['pt', 'pt_BR'],
    ['es-MX', 'es_419'],
    ['nb-NO', 'no'],
    ['iw-IL', 'he'],
    ['xx-YY', 'en'],
    ['fr-CA', 'fr'],
  ])
    assert.equal(resolveLocale(value), expected, value);
  assert.equal(supportedLocales.length, 55);
});
test('explicit translations preserve placeholder values and language changes', () => {
  setLocale('zh_CN');
  assert.equal(t('发送给 {name}', { name: '<My Bot>' }), '发送给 <My Bot>');
  setLocale('en');
  assert.equal(t('发送给 {name}', { name: '<My Bot>' }), 'Send to <My Bot>');
  assert.equal(t('A key not present'), 'A key not present');
});
test('initialization loads chosen locale, document direction and safely notifies subscribers', async () => {
  const document = { documentElement: { lang: '', dir: '' } },
    events = [];
  const stop = onLocaleChange((l) => events.push(l));
  await initI18n({
    locale: 'ar',
    document,
    api: {
      runtime: {
        sendMessage: async () => ({
          ok: true,
          value: { language: 'ar', catalog: { '发送给 {name}': 'إرسال إلى {name}' } },
        }),
      },
    },
  });
  assert.equal(getLocale(), 'ar');
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(document.documentElement.lang, 'ar');
  assert.equal(t('发送给 {name}', { name: 'BOT' }), 'إرسال إلى BOT');
  assert.ok(events.includes('ar'));
  stop();
  setLocale('zh_CN');
});
test('formatting follows the chosen language without altering user strings', () => {
  setLocale('en');
  assert.match(formatDate('2026-10-18T01:00:00Z', { year: 'numeric' }), /2026/);
  assert.equal(formatDate('not-a-date'), 'not-a-date');
  assert.equal(getCatalog()['发送给 {name}'], 'Send to {name}');
  setLocale('zh_CN');
});

test('a slower old locale load cannot override a newer language choice', async () => {
  let resolveOld;
  const old = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const api = { runtime: { getURL: (p) => 'https://extension.test/' + p } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith('de.json')
      ? old
      : { ok: true, json: async () => ({ '发送给 {name}': 'Envoyer à {name}' }) };
  try {
    const loading = initI18n({ api, locale: 'de', document: null });
    await initI18n({ api, locale: 'fr', document: null });
    resolveOld({ ok: true, json: async () => ({ '发送给 {name}': 'An {name} senden' }) });
    await loading;
    assert.equal(getLocale(), 'fr');
  } finally {
    globalThis.fetch = originalFetch;
    setLocale('zh_CN');
  }
});

test('failed bundled locale loading falls back to English with matching document language', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error('offline');
  };
  const document = { documentElement: { lang: '', dir: '' } };
  try {
    await initI18n({ locale: 'sw', document, api: { runtime: { getURL: (p) => p } } });
    assert.equal(getLocale(), 'en');
    assert.equal(document.documentElement.lang, 'en');
  } finally {
    globalThis.fetch = originalFetch;
    setLocale('zh_CN');
  }
});

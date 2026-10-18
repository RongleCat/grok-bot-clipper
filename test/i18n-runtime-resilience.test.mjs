import test from 'node:test';
import assert from 'node:assert/strict';
import { initI18n, getLocale, t, setLocale } from '../src/i18n/index.js';

test('a slow previous locale load cannot overwrite a newer language selection', async () => {
  const originalFetch = globalThis.fetch;
  const pending = new Map();
  globalThis.fetch = (url) => new Promise((resolve) => pending.set(url, resolve));
  const api = { runtime: { getURL: (path) => path } };
  try {
    const older = initI18n({ locale: 'de', api, document: null });
    const latest = initI18n({ locale: 'fr', api, document: null });
    pending.get('locales/fr.json')({ ok: true, json: async () => ({ 发送: 'Envoyer' }) });
    await latest;
    assert.equal(getLocale(), 'fr');
    pending.get('locales/de.json')({ ok: true, json: async () => ({ 发送: 'Senden' }) });
    await older;
    assert.equal(getLocale(), 'fr');
    assert.equal(t('发送'), 'Envoyer');
  } finally {
    globalThis.fetch = originalFetch;
    setLocale('zh_CN');
  }
});

test('localized packet labels preserve user titles, instructions and captured body', async () => {
  const { packContext } = await import('../src/core/context.js');
  await initI18n({
    document: null,
    api: {
      runtime: {
        sendMessage: async () => ({
          ok: true,
          value: {
            language: 'en',
            resolvedLanguage: 'en',
            catalog: { '选择 BOT': 'Choose BOT', '来源：': 'Source: ', '采集时间：': 'Captured: ' },
          },
        }),
      },
    },
  });
  try {
    const packet = await packContext({
      instruction: '选择 BOT',
      items: [
        {
          id: 'item',
          title: '选择 BOT',
          kind: 'page',
          markdown: '选择 BOT\n用户原文',
          url: 'https://example.com',
          capturedAt: '2026-10-18T00:00:00Z',
        },
      ],
    });
    assert.ok(packet.text.startsWith('选择 BOT\n'));
    assert.match(packet.text, /# \[1\] 选择 BOT/);
    assert.match(packet.text, /选择 BOT\n用户原文/);
    assert.match(packet.text, /Source: https:\/\/example.com/);
    assert.doesNotMatch(packet.text, /Choose BOT/);
  } finally {
    setLocale('zh_CN');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkCatalogs, inspectSource } from '../scripts/check-i18n.mjs';
import { chromeMessages } from '../scripts/i18n-build.mjs';

test('catalog validation detects missing translations and mismatched variables', () => {
  assert.deepEqual(
    checkCatalogs({ en: { '你好 {name}': 'Hello {name}' }, de: { '你好 {name}': 'Hallo {name}' } }),
    [],
  );
  assert.match(
    checkCatalogs({ en: { '你好 {name}': 'Hello {name}' }, de: { '你好 {name}': 'Hallo' } }).join(
      '\n',
    ),
    /placeholder/,
  );
  assert.match(checkCatalogs({ en: { 你好: 'Hello' }, de: {} }).join('\n'), /missing/);
});
test('source audit distinguishes translated text from Chinese selectors and parsing regex', () => {
  assert.deepEqual(
    inspectSource(
      "button.textContent = t('选择 BOT'); const pattern = /分享/; document.querySelector('[title=分享]');",
    ),
    [],
  );
  assert.equal(inspectSource("button.textContent = '选择 BOT';").length, 1);
  assert.deepEqual(
    inspectSource("const label = '分享'; // i18n-exempt: native site recognition"),
    [],
  );
  assert.equal(inspectSource('const html = `<button>发送</button>`;').length, 1);
});
test('Chrome localization metadata uses stable keys and enforces store description length', () => {
  const catalog = {
    manifest_description: 'Capture web context for Grok Bot.',
    command_capture_region: 'Capture region',
    command_send_page: 'Send page',
    command_quick_command: 'Quick commands',
  };
  assert.equal(chromeMessages(catalog).manifest_description.message, catalog.manifest_description);
  assert.equal(chromeMessages(catalog).extension_name.message, 'Grok Bot Clipper');
  assert.throws(() => chromeMessages({ ...catalog, manifest_description: 'a'.repeat(133) }), /132/);
});
test('extension manifest declares localizable metadata', async () => {
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.description, '__MSG_manifest_description__');
  assert.equal(manifest.commands['capture-region'].description, '__MSG_command_capture_region__');
});

test('all shipped locales cover extension strings with matching placeholders', async () => {
  const { audit } = await import('../scripts/check-i18n.mjs');
  const errors = await audit();
  assert.deepEqual(errors, [], errors.slice(0, 30).join('\n'));
});

test('catalog audit catches untranslated Chinese while preserving Japanese and product names', () => {
  assert.match(
    checkCatalogs({ en: { '选择 BOT': 'Choose BOT' }, fr: { '选择 BOT': '选择 BOT' } }).join('\n'),
    /untranslated Chinese/,
  );
  assert.deepEqual(
    checkCatalogs({ en: { '选择 BOT': 'Choose BOT' }, ja: { '选择 BOT': 'BOT を選択' } }),
    [],
  );
});

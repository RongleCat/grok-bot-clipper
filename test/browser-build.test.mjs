import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { manifestFor, buildTarget } from '../scripts/targets.mjs';
const source = JSON.parse(await readFile('manifest.json', 'utf8'));
test('default Chrome manifest is preserved including native capture, sidePanel and offscreen', () => {
  assert.deepEqual(manifestFor(source, 'chrome'), source);
  assert.equal(buildTarget('chrome').outdir, 'dist');
  assert.equal(source.manifest_version, 3);
  for (const permission of ['pageCapture', 'sidePanel', 'offscreen'])
    assert.ok(source.permissions.includes(permission));
});
test('Firefox manifest has independent persistent document, sidebar, permissions and transmission consent', () => {
  const m = manifestFor(source, 'firefox');
  assert.equal(buildTarget('firefox').outdir, 'dist-firefox');
  assert.equal(m.manifest_version, 2);
  assert.deepEqual(m.background, { page: 'background.html', persistent: true });
  assert.equal(m.browser_action.default_popup, 'popup.html');
  assert.equal(m.sidebar_action.default_panel, 'sidepanel.html');
  for (const key of [
    'action',
    'side_panel',
    'minimum_chrome_version',
    'host_permissions',
    'optional_host_permissions',
  ])
    assert.equal(m[key], undefined);
  for (const permission of ['pageCapture', 'sidePanel', 'offscreen'])
    assert.ok(!m.permissions.includes(permission));
  assert.ok(m.permissions.includes('https://www.xiaohongshu.com/*'));
  assert.deepEqual(m.optional_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(m.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.ok(m.browser_specific_settings.gecko.id);
  assert.ok(
    m.browser_specific_settings.gecko.data_collection_permissions.required.includes(
      'websiteContent',
    ),
  );
  assert.equal(typeof m.content_security_policy, 'string');
  assert.ok(source.permissions.includes('offscreen'), 'source Chrome manifest must not be mutated');
  assert.equal(m.content_scripts[0].world, 'MAIN');
});
test('unknown build targets fail instead of overwriting Chrome output', () => {
  assert.throws(() => buildTarget('unknown'), /UNKNOWN_BUILD_TARGET/);
  assert.throws(() => manifestFor(source, 'unknown'), /UNKNOWN_BUILD_TARGET/);
});

test('embedded picker exposes only its HTML document and converts resources for Firefox MV2', () => {
  const chrome = manifestFor(source, 'chrome');
  assert.deepEqual(chrome.web_accessible_resources[0].resources, ['share.html']);
  assert.ok(chrome.web_accessible_resources[0].matches.includes('https://x.com/*'));
  assert.deepEqual(manifestFor(source, 'firefox').web_accessible_resources, ['share.html']);
});

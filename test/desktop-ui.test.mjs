import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderStill, toBody } from '../vendor/desktop-avatar/engine.js';
import { VALID_SHAPES } from '../src/sdk/avatar.js';

test('every supported identity is rendered by the extracted native still renderer', () => {
  for (const shape of VALID_SHAPES) {
    const svg = renderStill({ body: toBody(shape), ink: '#000000', size: 128 });
    assert.match(svg, /<svg/);
    assert.ok(svg.length > 1000);
    assert.ok(!svg.includes('NaN'));
  }
  assert.equal(toBody('blob'), 'sphere');
  assert.equal(toBody('flower'), 'starFlower');
});
test('all avatar callers use desktop engine and no fitted renderer remains', async () => {
  for (const file of ['src/ui/avatars.js', 'src/offscreen/tasks.js', 'scripts/build.mjs']) {
    const s = await readFile(file, 'utf8');
    assert.match(s, /desktop-avatar/);
    assert.doesNotMatch(s, /renderAvatarSvg|vendor\/avatar\/index/);
  }
});
test('popup has one scroll owner and picker has an independent full-height layout', async () => {
  const css = await readFile('public/style.css', 'utf8');
  assert.match(css, /\.popup\s*\{[^}]*height:\s*560px/s);
  assert.match(css, /\.popup\s+#panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /#bot-dialog\[open\]\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.bot-list\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /select\s*\{[^}]*appearance:\s*none/s);
  assert.match(css, /background-position:\s*right 14px center/);
  assert.match(css, /\.search-box input:focus-visible\s*\{[^}]*outline:\s*none/s);
  assert.doesNotMatch(css, /#f7f7f4|#49634f|#779681/);
});

test('native engine declaration hash is pinned to the recorded desktop extraction', async () => {
  const { createHash } = await import('node:crypto');
  const source = await readFile('vendor/desktop-avatar/engine.js');
  const provenance = JSON.parse(await readFile('vendor/desktop-avatar/provenance.json', 'utf8'));
  assert.equal(createHash('sha256').update(source).digest('hex'), provenance.engineSHA256);
  assert.equal(provenance.declarations, 657);
});

test('native expression runtime advances blink without any plugin pose implementation', async () => {
  const { createAvatarEngine } = await import('../vendor/desktop-avatar/engine.js');
  const engine = createAvatarEngine({ body: toBody('flower') });
  const before = JSON.stringify(engine.frame());
  engine.blink();
  engine.advance(0.07);
  assert.notEqual(JSON.stringify(engine.frame()), before);
});

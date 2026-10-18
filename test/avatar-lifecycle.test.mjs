import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['src/ui/avatars.js'],
  bundle: true,
  format: 'iife',
  globalName: 'AvatarRuntime',
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const wait = () => new Promise((r) => setTimeout(r, 15));
async function until(fn) {
  for (let i = 0; i < 70; i++) {
    if (fn()) return;
    await wait();
  }
  throw Error('Avatar condition timed out');
}
function setup(reduced = false) {
  const dom = new JSDOM('<div id="scope"><span data-avatar="b" data-size="48"></span></div>', {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    }),
    w = dom.window;
  const pointers = new Set(),
    add = w.addEventListener.bind(w),
    remove = w.removeEventListener.bind(w);
  w.addEventListener = (type, fn, ...args) => {
    if (type === 'pointermove') pointers.add(fn);
    return add(type, fn, ...args);
  };
  w.removeEventListener = (type, fn, ...args) => {
    if (type === 'pointermove') pointers.delete(fn);
    return remove(type, fn, ...args);
  };
  let listener;
  const media = {
    matches: reduced,
    addEventListener(type, fn) {
      listener = fn;
    },
  };
  w.matchMedia = () => media;
  w.eval(compiled.outputFiles[0].text);
  const runtime = w.AvatarRuntime,
    scope = w.document.querySelector('#scope');
  runtime.mountAvatars(scope, [{ id: 'b', avatarShape: 'flower', avatarColor: 'magenta' }]);
  return {
    w,
    scope,
    runtime,
    pointers,
    media,
    change(value) {
      media.matches = value;
      listener();
    },
    close() {
      w.dispatchEvent(new w.Event('pagehide'));
      w.close();
    },
  };
}
test('releasing a closed picker removes native pointer listeners immediately', async () => {
  const e = setup();
  try {
    await until(() => e.pointers.size === 1);
    assert.equal(typeof e.runtime.releaseAvatars, 'function');
    e.runtime.releaseAvatars(e.scope);
    assert.equal(e.pointers.size, 0);
  } finally {
    e.close();
  }
});
test('turning reduced motion off recreates a moving native avatar', async () => {
  const e = setup(true);
  try {
    await until(() => e.scope.querySelector('[data-avatar]').firstElementChild?.tagName === 'SPAN');
    assert.equal(e.pointers.size, 0);
    const original = e.scope.querySelector('[data-avatar]').firstElementChild;
    e.change(false);
    await until(() => e.scope.querySelector('[data-avatar]').firstElementChild !== original);
    await until(() => e.pointers.size === 1);
    const svg = e.scope.querySelector('svg');
    assert.ok(svg);
  } finally {
    e.close();
  }
});

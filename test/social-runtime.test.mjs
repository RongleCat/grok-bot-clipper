import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
const bundle = await build({
  entryPoints: ['src/social/ui-entry.js'],
  bundle: true,
  format: 'iife',
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});
async function until(fn) {
  for (let i = 0; i < 70; i++) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error('Social content runtime condition timed out');
}
test('packaged social entry mounts the native animated avatar in an isolated recipient and tears it down', async () => {
  const dom = new JSDOM(
    '<div class="note-container"><div id="detail-desc">Note</div></div><div class="share-modal"><div class="friends"><div><img src="a"><span>A</span></div><div><img src="b"><span>B</span></div></div><div class="share-menu"><button class="share-item">复制链接</button><button>扫码分享</button></div></div>',
    {
      url: 'https://www.xiaohongshu.com/explore/note1',
      pretendToBeVisual: true,
      runScripts: 'outside-only',
    },
  );
  const w = dom.window;
  const pointers = new Set();
  const add = w.addEventListener.bind(w),
    remove = w.removeEventListener.bind(w);
  w.addEventListener = (type, fn, ...rest) => {
    if (type === 'pointermove') pointers.add(fn);
    return add(type, fn, ...rest);
  };
  w.removeEventListener = (type, fn, ...rest) => {
    if (type === 'pointermove') pointers.delete(fn);
    return remove(type, fn, ...rest);
  };
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.getClientRects = () => [{ width: 240, height: 100 }];
  w.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        value: {
          authenticated: true,
          favorites: [
            { id: 'bot', name: 'Animated', avatarShape: 'flower', avatarColor: 'magenta' },
            {
              id: 'picture',
              name: 'Picture',
              avatar: { picture: { url: 'https://example.com/avatar.png' } },
            },
          ],
        },
      }),
    },
  };
  try {
    w.eval(bundle.outputFiles[0].text);
    await until(() => pointers.size === 1);
    const row = w.document.querySelector('[data-grok-bot="bot"]');
    const avatar = row.firstElementChild.shadowRoot;
    assert.ok(avatar.querySelector('[data-avatar="bot"] svg'));
    const picture = w.document.querySelector('[data-grok-bot="picture"]').firstElementChild
      .shadowRoot;
    await until(() => picture.querySelector('img'));
    assert.match(picture.querySelector('style').textContent, /object-fit:cover/);
    assert.equal(w.document.querySelectorAll('.share-menu > *').length, 2);
    w.document.querySelector('.share-modal').remove();
    await until(() => pointers.size === 0);
  } finally {
    w.dispatchEvent(new w.Event('pagehide'));
    w.close();
  }
});

test('packaged X sharing renders real animated avatars and loads recipients through runtime messaging', async () => {
  const dom = new JSDOM(
    '<article><a href="/a/status/123"><time>Now</time></a><div data-testid="tweetText">Post</div></article><div role="menu"><div role="menuitem" style="font:700 15px Arial"><span>复制链接</span></div></div>',
    { url: 'https://x.com/a/status/123', pretendToBeVisual: true, runScripts: 'outside-only' },
  );
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.getClientRects = () => [{ width: 240, height: 100 }];
  const calls = [];
  const add = w.EventTarget.prototype.addEventListener;
  w.EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === 'click' && typeof listener === 'function') {
      const handler = listener;
      listener = function (event) {
        return handler.call(
          this,
          new Proxy(event, {
            get(target, key) {
              if (key === 'isTrusted') return true;
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        );
      };
    }
    return add.call(this, type, listener, options);
  };
  w.chrome = {
    runtime: {
      sendMessage: async (message) => {
        calls.push(message);
        return {
          ok: true,
          value: {
            authenticated: true,
            primary: { id: 'main', name: 'Main', avatarShape: 'flower', avatarColor: 'magenta' },
            favorites: [{ id: 'saved', name: 'Saved', avatarShape: 'blob', avatarColor: 'blue' }],
          },
        };
      },
    },
  };
  try {
    w.eval(bundle.outputFiles[0].text);
    const entry = w.document.querySelector('[data-grok-social="entry"]');
    await until(() => entry?.firstElementChild.shadowRoot?.querySelector('svg'));
    entry.click();
    await until(() =>
      w.document
        .querySelector('[data-grok-social="panel"]')
        ?.textContent.includes('发送给其他 BOT'),
    );
    const panel = w.document.querySelector('[data-grok-social="panel"]');
    await until(
      () =>
        panel.querySelector('[data-avatar="main"]') ||
        panel
          .querySelector('[role="menuitem"]')
          ?.firstElementChild.shadowRoot?.querySelector('svg'),
    );
    const rows = panel.querySelectorAll('[role="menuitem"]');
    assert.match(rows[0].textContent, /Main/);
    assert.match(rows[1].textContent, /Saved/);
    await until(
      () =>
        rows[0].firstElementChild.shadowRoot.querySelector('svg') &&
        rows[1].firstElementChild.shadowRoot.querySelector('svg'),
    );
    assert.equal(calls[0].type, 'social.targets');
    await until(() => entry.firstElementChild.shadowRoot.querySelector('svg'));
    assert.ok(
      entry.firstElementChild.shadowRoot.querySelector(
        '[data-avatar="grok-social-black-blob"] svg',
      ),
    );
  } finally {
    w.dispatchEvent(new w.Event('pagehide'));
    w.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installSocialUI } from '../src/social/ui.js';
import { setLocale } from '../src/i18n/index.js';
const pause = () => new Promise((r) => setTimeout(r, 180));
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Social UI condition timed out');
}
function environment(body, url) {
  setLocale('zh_CN');
  const dom = new JSDOM('<!doctype html>' + body, { url, pretendToBeVisual: true });
  dom.window.chrome = {
    i18n: { getUILanguage: () => 'zh-CN' },
    runtime: {
      sendMessage: async () => ({
        ok: true,
        value: { language: 'zh_CN', resolvedLanguage: 'zh_CN' },
      }),
    },
  };
  dom.window.HTMLElement.prototype.getClientRects = () => [{ x: 0, y: 0, width: 240, height: 100 }];
  return dom;
}
test('WeChat action is idempotent and remains the last #meta_content child after rerender', async () => {
  const dom = environment(
    '<div id="meta_content"><span>作者</span><span>日期</span></div><div id="js_content">正文</div>',
    'https://mp.weixin.qq.com/s/article-id',
  );
  const stop = installSocialUI(dom.window, { rpc: async () => ({}), isTrusted: () => true });
  const meta = dom.window.document.querySelector('#meta_content');
  assert.equal(meta.lastElementChild.shadowRoot.querySelector('#name').textContent, '发送给 BOT');
  meta.append(dom.window.document.createElement('span'));
  await pause();
  assert.equal(meta.lastElementChild.shadowRoot.querySelector('#name').textContent, '发送给 BOT');
  assert.equal(meta.querySelectorAll('[data-grok-social="wechat"]').length, 1);
  stop();
  dom.window.close();
});
test('X menu inherits native action classes, lists primary/favorites and sends only the selected post', async () => {
  const dom = environment(
    '<article><a href="/author/status/123"><time>Now</time></a><div data-testid="tweetText">Selected</div><button id="share">Share</button></article>',
    'https://x.com/home',
  );
  const calls = [];
  const rpc = async (type, data) => {
    calls.push({ type, data });
    if (type === 'social.targets')
      return {
        authenticated: true,
        primary: { id: 'main', name: 'Main' },
        favorites: [{ id: 'saved', name: 'Saved' }],
      };
    return { jobId: 'queued' };
  };
  const stop = installSocialUI(dom.window, { rpc, isTrusted: () => true });
  dom.window.document
    .querySelector('#share')
    .dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  const menu = dom.window.document.createElement('div');
  menu.role = 'menu';
  menu.innerHTML =
    '<div role="menuitem" class="native-item" data-v-test><span>复制链接</span></div>';
  dom.window.document.body.append(menu);
  await pause();
  const entry = menu.querySelector('[data-grok-social="entry"]');
  assert.ok(entry);
  assert.equal(entry.className, 'native-item');
  assert.equal(entry.hasAttribute('data-v-test'), true);
  entry.click();
  await pause();
  const panel = dom.window.document.querySelector('[data-grok-social="panel"]');
  assert.match(panel.textContent, /Main（主 BOT）/);
  assert.match(panel.textContent, /Saved/);
  assert.match(panel.lastElementChild.textContent, /发送给其他 BOT/);
  [...panel.querySelectorAll('[role="menuitem"]')]
    .find((n) => n.textContent.includes('Saved'))
    .click();
  await pause();
  const capture = calls.find((c) => c.type === 'social.capture');
  assert.equal(capture.data.botId, 'saved');
  assert.equal(capture.data.record.id, '123');
  assert.equal(capture.data.record.text, 'Selected');
  stop();
  dom.window.close();
});
test('keyboard share activation replaces the previous pointer-selected post', async () => {
  const dom = environment(
    '<article><a href="/a/status/123"><time>Now</time></a><div data-testid="tweetText">A</div><button id="a">Share</button></article>' +
      '<article><a href="/b/status/456"><time>Now</time></a><div data-testid="tweetText">B</div><button id="b">Share</button></article>',
    'https://x.com/home',
  );
  let captured;
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    rpc: async (type, data) => {
      if (type === 'social.targets')
        return { authenticated: true, primary: { id: 'main', name: 'Main' }, favorites: [] };
      captured = data.record;
      return { jobId: 'queued' };
    },
  });
  const document = dom.window.document;
  document
    .querySelector('#a')
    .dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  document.querySelector('#b').focus();
  document
    .querySelector('#b')
    .dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = '<div role="menuitem">复制链接</div>';
  document.body.append(menu);
  await pause();
  menu.querySelector('[data-grok-social="entry"]').click();
  await pause();
  document.querySelector('[data-grok-social="panel"] [role="menuitem"]').click();
  await pause();
  assert.equal(captured.id, '456');
  assert.equal(captured.text, 'B');
  stop();
  dom.window.close();
});
for (const platform of ['xiaohongshu', 'douyin']) {
  test(`${platform} lists every BOT in the native friend area without widening the action toolbar`, async () => {
    const xhs = platform === 'xiaohongshu';
    const dom = environment(
      (xhs
        ? '<div class="note-container"><h1 id="detail-title">Note</h1><div id="detail-desc">Body</div></div>'
        : '<div data-e2e="video-detail"><div data-e2e="video-desc">Video body</div></div>') +
        '<div class="share-modal"><h2>分享' +
        (xhs ? '至' : '给朋友') +
        '</h2><div class="native-friends" style="display:' +
        (xhs ? 'grid;grid-template-columns:repeat(4,1fr)' : 'block') +
        '">' +
        '<div class="recipient"><img src="https://example.com/a.png"><span>Friend A</span>' +
        (xhs ? '' : '<button style="background:rgb(255,44,85)">分享</button>') +
        '</div>' +
        '<div class="recipient"><img src="https://example.com/b.png"><span>Friend B</span>' +
        (xhs ? '' : '<button>分享</button>') +
        '</div></div>' +
        '<div class="native-tools"><button class="share-item">复制链接</button><button>扫码分享</button></div></div>',
      xhs ? 'https://www.xiaohongshu.com/explore/note1' : 'https://www.douyin.com/video/123456',
    );
    const calls = [],
      mounted = [],
      released = [];
    const favorites = Array.from({ length: 55 }, (_, i) => ({
      id: 'saved' + i,
      name: 'BOT ' + i,
      avatarShape: 'flower',
      avatarColor: 'magenta',
    }));
    const stop = installSocialUI(dom.window, {
      isTrusted: () => true,
      avatars: {
        mount: (root, bots) => mounted.push(...bots),
        release: (root) => released.push(root),
      },
      rpc: async (type, data) => {
        calls.push({ type, data });
        if (type === 'social.targets')
          return { authenticated: true, primary: favorites[0], favorites };
        return { jobId: 'queued' };
      },
    });
    await pause();
    const document = dom.window.document;
    const nativeList = document.querySelector('.native-friends');
    const list = xhs ? nativeList : document.querySelector('[data-grok-social="bot-recipients"]');
    const bots = list.querySelectorAll('[data-grok-bot]');
    assert.equal(bots.length, 55);
    assert.equal(list.style.overflowY, 'auto');
    const chooser = list.querySelector('[data-grok-social="choose"]');
    assert.equal(chooser?.getAttribute('data-grok-social'), 'choose');
    assert.equal(chooser.previousElementSibling.dataset.grokBot, 'saved54');
    if (xhs) assert.match(chooser.nextElementSibling.textContent, /Friend A/);
    else {
      assert.equal(chooser.nextElementSibling, null);
      assert.equal(list.nextElementSibling, nativeList);
    }
    const symbol = chooser.firstElementChild.shadowRoot.querySelector('svg');
    assert.ok(symbol, 'chooser uses an official icon instead of a styled text plus');
    assert.equal(symbol.getAttribute('width'), xhs ? '24' : '20');
    assert.ok(symbol.querySelector('circle'), 'CirclePlus owns the circular geometry');
    assert.equal(chooser.firstElementChild.shadowRoot.querySelector('span').style.border, '');
    assert.equal(document.querySelector('.native-tools').children.length, 2);
    assert.equal(calls.filter((c) => c.type === 'social.capture').length, 0);
    assert.equal(mounted.length, 55);
    const selected = list.querySelector('[data-grok-bot="saved54"]');
    (xhs ? selected : selected.querySelector('button')).click();
    await until(() => calls.some((c) => c.type === 'social.capture'));
    const capture = calls.find((c) => c.type === 'social.capture');
    assert.equal(capture.data.botId, 'saved54');
    assert.equal(capture.data.record.id, xhs ? 'note1' : '123456');
    await pause();
    chooser.click();
    await until(() => calls.filter((c) => c.type === 'social.capture').length === 2);
    assert.equal(calls.filter((c) => c.type === 'social.capture').at(-1).data.chooseBot, true);
    document.querySelector('.share-modal').remove();
    await pause();
    assert.equal(released.length, 55);
    stop();
    dom.window.close();
  });
}
test('WeChat HTTP articles and a delayed author row receive the final author-row action', async () => {
  const dom = environment(
    '<div id="js_content">正文</div>',
    'http://mp.weixin.qq.com/s?__biz=abc%2B%2F%3D&mid=123&idx=1',
  );
  const stop = installSocialUI(dom.window, { rpc: async () => ({}), isTrusted: () => true });
  const meta = dom.window.document.createElement('div');
  meta.id = 'meta_content';
  meta.innerHTML = '<span>作者</span>';
  dom.window.document.body.prepend(meta);
  await pause();
  assert.equal(meta.lastElementChild.shadowRoot.querySelector('#name').textContent, '发送给 BOT');
  stop();
  dom.window.close();
});
test('a native recipient popup hidden without removal releases its avatars and rebuilds once reopened', async () => {
  const dom = environment(
    '<div class="note-container"><div id="detail-desc">Note</div></div><div class="share-modal"><div class="friends"><div><img src="a"><span>A</span></div><div><img src="b"><span>B</span></div></div><div class="share-menu"><button class="share-item">复制链接</button><button>扫码分享</button></div></div>',
    'https://www.xiaohongshu.com/explore/note1',
  );
  let mounted = 0,
    released = 0;
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () {
    return this.closest('[hidden]') ? [] : [{ width: 240, height: 100 }];
  };
  const stop = installSocialUI(w, {
    isTrusted: () => true,
    avatars: { mount: () => mounted++, release: () => released++ },
    rpc: async () => ({ authenticated: true, favorites: [{ id: 'b', name: 'BOT' }] }),
  });
  await pause();
  assert.equal(mounted, 1);
  const popup = w.document.querySelector('.share-modal');
  popup.hidden = true;
  await pause();
  assert.equal(released, 1);
  popup.hidden = false;
  await pause();
  assert.equal(mounted, 2);
  assert.equal(popup.querySelectorAll('[data-grok-bot]').length, 1);
  stop();
  w.close();
});
test('the reported WeChat URL keeps an isolated button after the author row is replaced', async () => {
  const dom = environment(
    '<style>button{display:none!important}</style><div id="meta_content"><span>作者</span></div><div id="js_content">正文</div>',
    'https://mp.weixin.qq.com/s/bg9SeWWoIcFqrXiVDSjHlQ',
  );
  const stop = installSocialUI(dom.window, { rpc: async () => ({}), isTrusted: () => true });
  const document = dom.window.document;
  const initial = document.querySelector('[data-grok-social="wechat"]');
  assert.ok(initial.shadowRoot.querySelector('#send'));
  document.querySelector('#meta_content').outerHTML =
    '<div id="meta_content"><span>新作者栏</span></div>';
  await pause();
  const last = document.querySelector('#meta_content').lastElementChild;
  assert.equal(last.shadowRoot.querySelector('#name').textContent, '发送给 BOT');
  assert.ok(last.shadowRoot.querySelector('button'));
  stop();
  dom.window.close();
});
for (const count of [0, 1]) {
  test(`BOT recipients remain available with ${count} native friends`, async () => {
    const dom = environment(
      `<div class="note-container"><div id="detail-desc">Note</div></div><div class="share-modal"><h2>分享至</h2><div class="friend-list">${count ? '<div><img src="a"><span>A</span></div>' : ''}</div><div class="native-tools"><button class="share-item">复制链接</button><button>扫码分享</button></div></div>`,
      'https://www.xiaohongshu.com/explore/note1',
    );
    const stop = installSocialUI(dom.window, {
      rpc: async () => ({ authenticated: true, favorites: [{ id: 'b', name: 'BOT' }] }),
    });
    await pause();
    assert.equal(
      dom.window.document.querySelector('.friend-list').querySelectorAll('[data-grok-bot]').length,
      1,
    );
    assert.equal(dom.window.document.querySelectorAll('[data-grok-social="choose"]').length, 1);
    assert.equal(dom.window.document.querySelector('.native-tools').children.length, 2);
    stop();
    dom.window.close();
  });
}
test('logged-out native share popups without a friend-list still offer the BOT chooser', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div class="share-panel"><h2>分享给朋友</h2><p>登录后分享</p><div class="native-tools"><button class="share-item">复制链接</button></div></div>',
    'https://www.douyin.com/video/123',
  );
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 24 });
  const stop = installSocialUI(dom.window, {
    rpc: async () => ({ authenticated: true, favorites: [{ id: 'b', name: 'BOT' }] }),
  });
  await pause();
  assert.equal(dom.window.document.querySelectorAll('[data-grok-bot]').length, 1);
  assert.ok(dom.window.document.querySelector('[data-grok-social="choose"]'));
  assert.notEqual(
    dom.window.document.querySelector('[data-grok-social="recipients"]').style.maxHeight,
    '24px',
  );
  assert.equal(dom.window.document.querySelector('.native-tools').children.length, 1);
  stop();
  dom.window.close();
});
test('an open Douyin recipient list follows the current video after SPA navigation', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Old video</div></div><div class="share-panel"><h2>分享给朋友</h2><div class="friends"><div><img src="a"><span>A</span></div><div><img src="b"><span>B</span></div></div><div class="native-tools"><button class="share-item">复制链接</button></div></div>',
    'https://www.douyin.com/video/123',
  );
  let capture;
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    rpc: async (type, data) => {
      if (type === 'social.targets')
        return { authenticated: true, favorites: [{ id: 'bot', name: 'BOT' }] };
      capture = data;
      return { jobId: 'queued' };
    },
  });
  await pause();
  const desc = dom.window.document.querySelector('[data-e2e="video-desc"]');
  desc.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  dom.window.history.pushState({}, '', '/video/456');
  desc.textContent = 'New video';
  await pause();
  dom.window.document.querySelector('[data-grok-bot="bot"] button').click();
  await until(() => capture);
  assert.equal(capture.record.id, '456');
  assert.equal(capture.record.text, 'New video');
  stop();
  dom.window.close();
});
test('nested Douyin recipient markup shows all BOTs with native label colors and a chooser immediately after BOTs', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div class="share-panel"><h2>分享给朋友</h2><div class="friends"><div class="friend-row"><div class="left"><div class="identity"><img src="a"><span style="color:rgb(230,230,235)">First</span></div></div><button style="color:white;background:rgb(255,44,85)">分享</button></div><div class="friend-row"><div class="left"><div class="identity"><img src="b"><span style="color:rgb(230,230,235)">Second</span></div></div><button>分享</button></div></div><div class="tools"><button class="share-item">复制链接</button></div></div>',
    'https://www.douyin.com/video/123',
  );
  const stop = installSocialUI(dom.window, {
    rpc: async () => ({
      authenticated: true,
      primary: { id: 'p', name: 'Primary' },
      favorites: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    }),
  });
  await pause();
  const d = dom.window.document,
    list = d.querySelector('[data-grok-social="bot-recipients"]');
  assert.equal(list.querySelectorAll(':scope > [data-grok-bot]').length, 3);
  assert.equal(list.querySelector('[data-grok-bot="a"]').style.color, 'rgb(230, 230, 235)');
  assert.equal(
    list.querySelector('[data-grok-social="choose"]').previousElementSibling.dataset.grokBot,
    'b',
  );
  assert.equal(d.querySelectorAll('.friend-row:not([data-grok-social])').length, 2);
  stop();
  dom.window.close();
});
test('WeChat shows the active BOT avatar/name and both split controls share the correct post', async () => {
  const dom = environment(
    '<div id="meta_content"><span>Author</span></div><h1 id="activity-name">Article</h1><div id="js_content">Body</div>',
    'https://mp.weixin.qq.com/s/bg9SeWWoIcFqrXiVDSjHlQ',
  );
  const calls = [],
    mounted = [];
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    avatars: { mount: (_root, bots) => mounted.push(...bots), release() {} },
    rpc: async (type, data) => {
      calls.push({ type, data });
      if (type === 'social.targets')
        return {
          authenticated: true,
          primary: { id: 'main', name: 'Main' },
          favorites: [{ id: 'saved', name: 'Saved' }],
        };
      return { jobId: 'job' };
    },
  });
  await pause();
  const host = dom.window.document.querySelector('[data-grok-social="wechat"]'),
    shadow = host.shadowRoot;
  assert.equal(shadow.querySelector('#name').textContent, '发送给 Main');
  assert.equal(shadow.querySelector('[data-avatar]').dataset.avatar, 'main');
  shadow.querySelector('#send').click();
  await pause();
  assert.equal(calls.find((c) => c.type === 'social.capture').data.botId, 'main');
  shadow.querySelector('#dropdown').click();
  await pause();
  const panel = dom.window.document.querySelector('[data-grok-social="panel"]');
  const menuRows = panel.querySelectorAll('[role="menuitem"]');
  assert.equal(
    menuRows[0].firstElementChild.shadowRoot.querySelector('[data-avatar]').dataset.avatar,
    'main',
  );
  assert.equal(
    menuRows[1].firstElementChild.shadowRoot.querySelector('[data-avatar]').dataset.avatar,
    'saved',
  );
  assert.match(menuRows[2].textContent, /发送给其他 BOT/);
  [...panel.querySelectorAll('[role="menuitem"]')]
    .find((n) => n.textContent.includes('Saved'))
    .click();
  await pause();
  assert.equal(shadow.querySelector('#name').textContent, '发送给 Saved');
  assert.equal(mounted.at(-1).id, 'saved');
  assert.equal(
    calls.filter((c) => c.type === 'social.capture').at(-1).data.record.id,
    'bg9SeWWoIcFqrXiVDSjHlQ',
  );
  stop();
  dom.window.close();
});
test('X BOT submenu opens beside the native menu and a repeated share click cannot enqueue twice', async () => {
  const dom = environment(
    '<article><a href="/a/status/123"><time>Now</time></a><div data-testid="tweetText">Post</div><button id="trigger">Share</button></article>',
    'https://x.com/home',
  );
  let resolve,
    captures = 0;
  const sending = new Promise((r) => (resolve = r));
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    rpc: async (type) => {
      if (type === 'social.targets')
        return { authenticated: true, primary: { id: 'main', name: 'Main' }, favorites: [] };
      captures++;
      return sending;
    },
  });
  const d = dom.window.document;
  d.querySelector('#trigger').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  const menu = d.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = '<div role="menuitem">复制链接</div>';
  menu.getBoundingClientRect = () => ({ left: 200, right: 400, top: 100, bottom: 300 });
  d.body.append(menu);
  await pause();
  const entry = menu.querySelector('[data-grok-social="entry"]');
  entry.getBoundingClientRect = () => ({ left: 200, right: 400, top: 140, bottom: 184 });
  entry.click();
  await pause();
  const panel = d.querySelector('[data-grok-social="panel"]');
  assert.equal(panel.style.left, '404px');
  assert.equal(panel.style.top, '140px');
  const target = panel.querySelector('[role="menuitem"]');
  target.click();
  target.click();
  await pause();
  assert.equal(captures, 1);
  resolve({ jobId: 'job' });
  await pause();
  assert.doesNotMatch(d.body.textContent, /材料已准备/);
  stop();
  dom.window.close();
});
test('sharing an XHS blob-player note requests fresh metadata before extracting its video', async () => {
  const dom = environment(
    '<div class="note-container"><h1 id="detail-title">Video</h1><div id="detail-desc">Body</div><video src="blob:https://www.xiaohongshu.com/local"></video></div><div class="share-modal"><div class="friends"><div><img src="a"><span>A</span></div><div><img src="b"><span>B</span></div></div><div class="share-menu"><button class="share-item">复制链接</button><button>扫码分享</button></div></div>',
    'https://www.xiaohongshu.com/discovery/item/notevideo',
  );
  const w = dom.window;
  let captured,
    freshRequests = 0;
  w.postMessage = (message) => {
    if (message.source === 'grok-social-request' && message.requestId) {
      freshRequests++;
      queueMicrotask(() => {
        const emit = (data) =>
          w.dispatchEvent(
            new w.MessageEvent('message', { source: w, origin: w.location.origin, data }),
          );
        emit({
          source: 'grok-social-record',
          version: 1,
          record: {
            platform: 'xiaohongshu',
            id: 'notevideo',
            url: w.location.href,
            title: 'Video',
            text: 'Full body',
            author: { name: 'A' },
            tags: [],
            metrics: {},
            images: [],
            videos: [{ url: 'https://sns-video-bd.xhscdn.com/fresh.mp4' }],
            hasVideo: true,
            captureSource: 'network',
          },
        });
        emit({ source: 'grok-social-ready', requestId: message.requestId });
      });
    }
  };
  const stop = installSocialUI(w, {
    isTrusted: () => true,
    rpc: async (type, data) => {
      if (type === 'social.targets')
        return { authenticated: true, primary: { id: 'main', name: 'Main' }, favorites: [] };
      captured = data.record;
      return { jobId: 'job' };
    },
  });
  await pause();
  w.document.querySelector('[data-grok-bot="main"]').click();
  await pause();
  assert.equal(freshRequests, 1);
  assert.equal(captured.videos[0].url, 'https://sns-video-bd.xhscdn.com/fresh.mp4');
  stop();
  w.close();
});

test('X uses native label typography and independent animated outer/recipient avatar scopes', async () => {
  const dom = environment(
    '<article><a href="/a/status/123"><time>Now</time></a><div data-testid="tweetText">Post</div></article><div role="menu"><div role="menuitem" style="font:400 13px Arial"><svg width="20" height="20"></svg><span style="font:700 15px Arial;letter-spacing:0.2px">复制链接</span></div></div>',
    'https://x.com/a/status/123',
  );
  const mounted = [],
    released = [];
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    avatars: {
      mount: (root, bots) => mounted.push({ root, bots }),
      release: (root) => released.push(root),
    },
    rpc: async (type) =>
      type === 'social.targets'
        ? {
            authenticated: true,
            primary: { id: 'main', name: 'Main' },
            favorites: [{ id: 'saved', name: 'Saved' }],
          }
        : { jobId: 'job' },
  });
  try {
    const d = dom.window.document,
      entry = d.querySelector('[data-grok-social="entry"]');
    assert.equal(entry.style.fontSize, '15px');
    assert.equal(entry.style.fontWeight, '700');
    const outer = mounted.find((m) => m.bots[0].avatar?.character?.baseHex === '#000000');
    assert.ok(outer, 'outer share entry uses animated black blob');
    entry.click();
    await pause();
    const panel = d.querySelector('[data-grok-social="panel"]');
    assert.equal(panel.querySelector('[role="menuitem"]').style.fontWeight, '700');
    assert.ok(mounted.some((m) => m.bots[0].id === 'main'));
    assert.ok(mounted.some((m) => m.bots[0].id === 'saved'));
    assert.match(panel.lastElementChild.textContent, /发送给其他 BOT/);
    d.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.ok(released.includes(mounted.find((m) => m.bots[0].id === 'main').root));
    assert.ok(!released.includes(outer.root));
    entry.click();
    await pause();
    const nativeMenu = entry.closest('[role="menu"]');
    nativeMenu.hidden = true;
    await pause();
    assert.equal(d.querySelector('[data-grok-social="panel"]'), null);
    assert.ok(released.includes(outer.root));
    nativeMenu.hidden = false;
    await pause();
    assert.equal(mounted.filter((m) => m.bots[0].id === 'grok-social-black-blob').length, 2);
    entry.click();
    await pause();
    assert.ok(d.querySelector('[data-grok-social="panel"]'));
    entry.closest('[role="menu"]').remove();
    await pause();
    assert.ok(released.includes(outer.root));
  } finally {
    stop();
    dom.window.close();
  }
});
test('Douyin hydrates BOT recipients when the share portal arrives before its copy-link toolbar', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div>',
    'https://www.douyin.com/video/123',
  );
  let reads = 0;
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    rpc: async (type) => {
      if (type === 'social.targets') {
        reads++;
        return {
          authenticated: true,
          primary: { id: 'main', name: 'Main' },
          favorites: [{ id: 'saved', name: 'Saved' }],
        };
      }
      throw Error('No send during hydration');
    },
  });
  try {
    const d = dom.window.document,
      popup = d.createElement('div');
    popup.setAttribute('data-e2e', 'video-share-panel');
    popup.innerHTML = '<h2>分享给朋友</h2><div class="friend-list"></div>';
    d.body.append(popup);
    await until(() => popup.querySelectorAll('[data-grok-bot]').length === 2);
    const list = popup.querySelector('.friend-list');
    list.replaceChildren();
    const tools = d.createElement('div');
    tools.innerHTML = '<button><span>复制</span><span>链接</span></button>';
    popup.append(tools);
    await until(() => popup.querySelectorAll('[data-grok-bot]').length === 2);
    assert.ok(popup.querySelector('[data-grok-social="choose"]'));
    assert.ok(reads <= 3, 'hydration does not create a request loop');
  } finally {
    stop();
    dom.window.close();
  }
});
test('Douyin recognizes a copy-link label created by a delayed text-only update', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div class="share-modal"><div class="share-menu"><button id="copy"></button><button>扫码分享</button></div></div>',
    'https://www.douyin.com/video/123',
  );
  const stop = installSocialUI(dom.window, {
    rpc: async () => ({
      authenticated: true,
      primary: { id: 'main', name: 'Main' },
      favorites: [],
    }),
  });
  try {
    await pause();
    const label = dom.window.document.createTextNode('Loading');
    dom.window.document.querySelector('#copy').append(label);
    await pause();
    label.data = '复制链接';
    await until(() => dom.window.document.querySelector('[data-grok-bot="main"]'));
  } finally {
    stop();
    dom.window.close();
  }
});

test('Douyin retries a transient target-loading failure without requiring the share menu to reopen', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div data-e2e="video-share-panel"><h2>分享给朋友</h2><div class="friend-list"></div><button class="share-item">复制链接</button></div>',
    'https://www.douyin.com/video/123',
  );
  let attempts = 0;
  const stop = installSocialUI(dom.window, {
    rpc: async () => {
      if (++attempts === 1) throw Error('Temporary startup');
      return { authenticated: true, primary: { id: 'main', name: 'Main' }, favorites: [] };
    },
  });
  try {
    await until(() => dom.window.document.querySelector('[data-grok-bot="main"]'));
    assert.equal(attempts, 2);
  } finally {
    stop();
    dom.window.close();
  }
});

test('Douyin target retries stop after two retries even if the site keeps mutating the popup', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div data-e2e="video-share-panel"><h2>分享给朋友</h2></div>',
    'https://www.douyin.com/video/123',
  );
  let attempts = 0;
  const stop = installSocialUI(dom.window, {
    rpc: async () => {
      attempts++;
      throw Error('Offline');
    },
  });
  try {
    await until(() => attempts >= 3);
    const popup = dom.window.document.querySelector('[data-e2e="video-share-panel"]');
    for (let i = 0; i < 4; i++) {
      popup.setAttribute('class', 'phase-' + i);
      await pause();
    }
    assert.equal(attempts, 3);
  } finally {
    stop();
    dom.window.close();
  }
});

test('Douyin moves BOTs above a late native friend list without leaving a duplicate fallback list', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div data-e2e="video-share-panel"><h2>分享给朋友</h2></div>',
    'https://www.douyin.com/video/123',
  );
  const stop = installSocialUI(dom.window, {
    rpc: async () => ({
      authenticated: true,
      primary: { id: 'main', name: 'Main' },
      favorites: [{ id: 'saved', name: 'Saved' }],
    }),
  });
  try {
    const d = dom.window.document,
      popup = d.querySelector('[data-e2e="video-share-panel"]');
    await until(() => popup.querySelectorAll('[data-grok-bot]').length === 2);
    assert.ok(popup.querySelector('[data-grok-social="recipients"]'));
    const list = d.createElement('div');
    list.className = 'friends';
    list.innerHTML =
      '<div><img src="a"><span>Friend A</span><button>分享</button></div><div><img src="b"><span>Friend B</span><button>分享</button></div>';
    popup.append(list);
    await until(
      () =>
        list.previousElementSibling?.dataset.grokSocial === 'bot-recipients' &&
        list.previousElementSibling.querySelectorAll('[data-grok-bot]').length === 2,
    );
    assert.equal(popup.querySelectorAll('[data-grok-bot]').length, 2);
    assert.equal(popup.querySelector('[data-grok-social="recipients"]'), null);
    assert.equal(list.querySelectorAll('img').length, 2);
  } finally {
    stop();
    dom.window.close();
  }
});

test('X target errors identify invalidated extension context and allow an explicit retry', async () => {
  const dom = environment(
    '<article><a href="/a/status/123"><time>Now</time></a></article><div role="menu"><div role="menuitem">复制链接</div></div>',
    'https://x.com/a/status/123',
  );
  let attempts = 0;
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    rpc: async () => {
      if (++attempts === 1) throw Error('Extension context invalidated.');
      return { authenticated: true, primary: { id: 'main', name: 'Main' }, favorites: [] };
    },
  });
  try {
    dom.window.document.querySelector('[data-grok-social="entry"]').click();
    await pause();
    const panel = dom.window.document.querySelector('[data-grok-social="panel"]');
    assert.match(panel.textContent, /EXTENSION_CONTEXT_INVALIDATED/);
    panel.querySelector('button').click();
    await pause();
    assert.match(
      dom.window.document.querySelector('[data-grok-social="panel"]').textContent,
      /Main/,
    );
    assert.equal(attempts, 2);
  } finally {
    stop();
    dom.window.close();
  }
});

test('X other-BOT chooser resolves the exact detail tweet when sharing starts from an already open native menu', async () => {
  const dom = environment(
    '<article><a href="/other/status/456"><time>Now</time></a><div data-testid="tweetText">Unrelated</div></article><article><a href="/a/status/123"><time>Now</time></a><div data-testid="tweetText">Selected post</div></article><div role="menu"><div role="menuitem">复制链接</div></div>',
    'https://x.com/a/status/123',
  );
  const calls = [];
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    rpc: async (type, extra) => {
      calls.push({ type, extra });
      if (type === 'social.targets') return { authenticated: true, favorites: [] };
      return { pickerOpened: true };
    },
  });
  try {
    dom.window.document.querySelector('[data-grok-social="entry"]').click();
    await pause();
    dom.window.document.querySelector('[data-grok-social="panel"]').lastElementChild.click();
    await pause();
    const capture = calls.find((call) => call.type === 'social.capture');
    assert.ok(capture, 'opens chooser with a captured record rather than a POST_NOT_LOADED toast');
    assert.equal(capture.extra.chooseBot, true);
    assert.equal(capture.extra.record.id, '123');
    assert.equal(capture.extra.record.text, 'Selected post');
    assert.equal(calls.filter((call) => call.type === 'social.capture').length, 1);
  } finally {
    stop();
    dom.window.close();
  }
});

test('X native menu pointer events do not replace a selected reply with the detail-page post', async () => {
  const dom = environment(
    '<article><a href="/a/status/123"><time>Now</time></a><div data-testid="tweetText">Detail post</div></article><article><a href="/reply/status/456"><time>Now</time></a><div data-testid="tweetText">Selected reply</div><button id="share-reply">Share</button></article><div role="menu"><div role="menuitem" id="native-item">复制链接</div></div>',
    'https://x.com/a/status/123',
  );
  let captured;
  const stop = installSocialUI(dom.window, {
    isTrusted: () => true,
    rpc: async (type, extra) => {
      if (type === 'social.targets') return { authenticated: true, favorites: [] };
      captured = extra.record;
      return { pickerOpened: true };
    },
  });
  try {
    const d = dom.window.document;
    d.querySelector('#share-reply').dispatchEvent(
      new dom.window.Event('pointerdown', { bubbles: true }),
    );
    await pause();
    d.querySelector('#native-item').dispatchEvent(
      new dom.window.Event('pointerdown', { bubbles: true }),
    );
    await pause();
    d.querySelector('[data-grok-social="entry"]').click();
    await pause();
    d.querySelector('[data-grok-social="panel"]').lastElementChild.click();
    await pause();
    assert.equal(captured?.id, '456');
    assert.equal(captured?.text, 'Selected reply');
  } finally {
    stop();
    dom.window.close();
  }
});

test('X chooser capture requests the embedded route and places the shared picker inside the current webpage', async () => {
  const dom = environment(
    '<article><a href="/a/status/123"><time>Now</time></a><div data-testid="tweetText">Post</div></article><div role="menu"><div role="menuitem">复制链接</div></div>',
    'https://x.com/a/status/123',
  );
  const w = dom.window,
    calls = [];
  w.chrome = {
    i18n: { getUILanguage: () => 'zh-CN' },
    runtime: { getURL: (path) => 'chrome-extension://test/' + path },
  };
  const stop = installSocialUI(w, {
    isTrusted: () => true,
    rpc: async (type, extra) => {
      calls.push({ type, extra });
      if (type === 'social.targets') return { authenticated: true, favorites: [] };
      return { pickerId: 'inline-request' };
    },
  });
  try {
    const d = w.document;
    d.querySelector('[data-grok-social="entry"]').click();
    await pause();
    d.querySelector('[data-grok-social="panel"]').lastElementChild.click();
    await pause();
    assert.equal(calls.find((c) => c.type === 'social.capture').extra.embedded, true);
    const host = d.querySelector('[data-grok-social="picker"]');
    assert.match(host.shadowRoot.querySelector('iframe').src, /request=inline-request&embedded=1/);
    d.body.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    assert.equal(host.isConnected, false);
    assert.equal(d.querySelectorAll('article').length, 1);
  } finally {
    stop();
    w.close();
  }
});

test('Douyin BOT rows do not inherit full-height flex or absolute positioning and stay visible at the top', async () => {
  const dom = environment(
    '<style>.native-row{position:absolute;height:100%;max-height:999px;transform:translateY(500px)}</style><div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div class="share-panel"><h2>分享给朋友</h2><div class="friends" style="display:flex;flex-direction:column;height:320px;overflow-y:auto"><div class="native-row"><img src="a"><span>A</span><button>分享</button></div><div class="native-row"><img src="b"><span>B</span><button>分享</button></div></div><div class="tools"><button>复制链接</button></div></div>',
    'https://www.douyin.com/video/123',
  );
  const d = dom.window.document,
    list = d.querySelector('.friends');
  list.scrollTop = 200;
  const stop = installSocialUI(dom.window, {
    rpc: async () => ({
      authenticated: true,
      primary: { id: 'main', name: 'Main' },
      favorites: [{ id: 'saved', name: 'Saved' }],
    }),
  });
  try {
    await pause();
    const group = d.querySelector('[data-grok-social="bot-recipients"]');
    const rows = group.querySelectorAll('[data-grok-bot]');
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.style.flexBasis, 'auto');
      assert.equal(row.style.position, 'relative');
      assert.equal(row.style.height, 'auto');
      assert.equal(row.style.transform, 'none');
    }
    assert.equal(list.scrollTop, 0);
    assert.equal(group.children[2].dataset.grokSocial, 'choose');
    assert.equal(group.nextElementSibling, list);
    assert.equal(list.children[0].className, 'native-row');
    assert.equal(list.children[0].getAttribute('style'), null);
  } finally {
    stop();
    dom.window.close();
  }
});

test('Douyin BOT buttons retain native horizontal insets and shrink the complete friend layout chain', async () => {
  const dom = environment(
    '<div data-e2e="video-detail"><div data-e2e="video-desc">Video</div></div><div class="share-panel"><div class="friend-shell" style="height:360px"><h2>分享给朋友</h2><div class="friends" style="height:320px;overflow-y:auto;padding:0 16px"><div><img src="a"><span>A</span><button>分享</button></div><div><img src="b"><span>B</span><button>分享</button></div></div></div><div class="tools"><button>复制链接</button></div></div>',
    'https://www.douyin.com/video/123',
  );
  const w = dom.window,
    d = w.document;
  const shell = d.querySelector('.friend-shell'),
    scroller = d.querySelector('.friends');
  const shellStyle = shell.getAttribute('style'),
    scrollStyle = scroller.getAttribute('style');
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const own = this.dataset.grokSocial;
    const height =
      own === 'bot-recipients'
        ? 100
        : this === shell
          ? parseFloat(this.style.height)
          : this === scroller
            ? parseFloat(this.style.height)
            : 40;
    const left = this.tagName === 'IMG' ? 16 : 0,
      right = this.tagName === 'BUTTON' && !own ? 304 : 320;
    return { x: left, y: 0, left, right, top: 0, bottom: height, width: right - left, height };
  };
  const stop = installSocialUI(w, {
    rpc: async () => ({
      authenticated: true,
      primary: { id: 'main', name: 'Main' },
      favorites: [],
    }),
  });
  try {
    await pause();
    const group = d.querySelector('[data-grok-social="bot-recipients"]');
    assert.equal(group.nextElementSibling, shell);
    const row = group.querySelector('[data-grok-bot]');
    assert.equal(row.style.paddingLeft, '16px');
    assert.equal(row.style.paddingRight, '16px');
    assert.equal(shell.style.height, '260px');
    assert.equal(scroller.style.height, '220px');
    shell.style.height = '360px';
    await pause();
    assert.equal(
      shell.style.height,
      '260px',
      'native late layout writes do not reopen a blank fixed-height gap',
    );
  } finally {
    stop();
    assert.equal(shell.getAttribute('style'), shellStyle);
    assert.equal(scroller.getAttribute('style'), scrollStyle);
    w.close();
  }
});

test('XHS chooser survives native pointer-down dismissal and immediately shows a cancelable loading panel', async () => {
  const dom = environment(
    '<div class="note-container"><div id="detail-desc">Note</div></div><div class="share-modal"><div class="friends"><div><img src="a"><span>A</span></div><div><img src="b"><span>B</span></div></div><div class="tools"><button>复制链接</button></div></div>',
    'https://www.xiaohongshu.com/explore/note1',
  );
  const w = dom.window,
    d = w.document,
    calls = [];
  w.chrome = {
    i18n: { getUILanguage: () => 'zh-CN' },
    runtime: { getURL: (path) => 'chrome-extension://test/' + path },
  };
  const stop = installSocialUI(w, {
    isTrusted: () => true,
    rpc: async (type, extra) => {
      calls.push({ type, extra });
      return type === 'social.targets'
        ? { authenticated: true, favorites: [] }
        : { pickerId: 'xhs-request' };
    },
  });
  try {
    await pause();
    for (const type of ['pointerdown', 'mousedown'])
      d.body.addEventListener(type, () => d.querySelector('.share-modal')?.remove());
    const chooser = d.querySelector('[data-grok-social="choose"]');
    chooser.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    chooser.dispatchEvent(new w.Event('mousedown', { bubbles: true }));
    assert.ok(chooser.isConnected, 'native popup must not dismiss before our click');
    chooser.click();
    assert.ok(
      d.querySelector('[data-grok-social="picker"]'),
      'show preparation UI before waiting for the snapshot',
    );
    await until(() =>
      d.querySelector('[data-grok-social="picker"]')?.shadowRoot.querySelector('iframe'),
    );
    assert.equal(calls.find((c) => c.type === 'social.capture').extra.chooseBot, true);
  } finally {
    stop();
    w.close();
  }
});

test('Douyin share refreshes exact-current player metadata before capture and never borrows a background video', async () => {
  const dom = environment(
    '<div data-e2e="feed-active-video" data-aweme-id="111"><div data-e2e="video-desc">Wrong</div><video src="https://v3.douyinvod.com/wrong.mp4"></video></div><div class="share-panel"><h2>分享给朋友</h2><div class="friends"><div><img src="a"><span>A</span></div><div><img src="b"><span>B</span></div></div><div class="tools"><button>复制链接</button></div></div>',
    'https://www.douyin.com/jingxuan?modal_id=7695664256984927515',
  );
  const w = dom.window;
  let captured,
    refreshed = 0;
  w.addEventListener('message', (e) => {
    if (e.data?.source !== 'grok-social-request' || !e.data.requestId) return;
    refreshed++;
    w.dispatchEvent(
      new w.MessageEvent('message', {
        source: w,
        origin: w.location.origin,
        data: {
          source: 'grok-social-record',
          version: 1,
          record: {
            platform: 'douyin',
            id: '7695664256984927515',
            url: 'https://www.douyin.com/video/7695664256984927515',
            text: 'Right',
            author: { name: 'Author' },
            metrics: { likes: 10 },
            images: [],
            videos: [{ url: 'https://v3.douyinvod.com/current.mp4' }],
            hasVideo: true,
            captureSource: 'network',
          },
        },
      }),
    );
    w.dispatchEvent(
      new w.MessageEvent('message', {
        source: w,
        origin: w.location.origin,
        data: { source: 'grok-social-ready', requestId: e.data.requestId },
      }),
    );
  });
  const stop = installSocialUI(w, {
    isTrusted: () => true,
    rpc: async (type, extra) => {
      if (type === 'social.targets')
        return { authenticated: true, primary: { id: 'main', name: 'Main' }, favorites: [] };
      captured = extra.record;
      return { jobId: 'job' };
    },
  });
  try {
    await pause();
    w.document.querySelector('[data-grok-bot="main"] button').click();
    await until(() => captured);
    assert.equal(refreshed, 1);
    assert.equal(captured.author.name, 'Author');
    assert.equal(captured.videos[0].url, 'https://v3.douyinvod.com/current.mp4');
    assert.equal(captured.captureSource, 'network');
  } finally {
    stop();
    w.close();
  }
});

test('WeChat entry uses native metadata vertical alignment, margins and text metrics', () => {
  const dom = environment(
    '<style>.rich_media_meta{display:inline-block;vertical-align:middle;margin:0 10px 10px 0;font:15px/20px sans-serif}</style><div id="meta_content"><span class="rich_media_meta">作者</span><span class="rich_media_meta">广东</span></div>',
    'https://mp.weixin.qq.com/s/article-id',
  );
  const stop = installSocialUI(dom.window, { rpc: async () => ({}), isTrusted: () => true });
  try {
    const host = dom.window.document.querySelector('[data-grok-social="wechat"]');
    assert.equal(host.style.marginBottom, '10px');
    assert.equal(host.style.verticalAlign, 'middle');
    assert.equal(host.style.fontSize, '15px');
    assert.equal(host.style.lineHeight, '20px');
  } finally {
    stop();
    dom.window.close();
  }
});

test('X submenu stays attached to its item after loading, viewport changes and parent movement', async () => {
  const dom = environment(
    '<article><a href="/a/status/123"><time>Now</time></a><button id="trigger">Share</button></article>',
    'https://x.com/home',
  );
  const w = dom.window,
    d = w.document;
  Object.defineProperty(w, 'innerWidth', { value: 1100, writable: true });
  Object.defineProperty(w, 'innerHeight', { value: 1000, writable: true });
  const originalRect = w.HTMLElement.prototype.getBoundingClientRect;
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.getAttribute('data-grok-social') === 'panel')
      return {
        width: 300,
        height: this.querySelectorAll('[role="menuitem"]').length === 1 ? 52 : 150,
      };
    return originalRect.call(this);
  };
  const stop = installSocialUI(w, {
    isTrusted: () => true,
    rpc: async () => ({
      authenticated: true,
      primary: { id: 'main', name: 'Main' },
      favorites: [{ id: 'saved', name: 'Saved' }],
    }),
  });
  try {
    d.querySelector('#trigger').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    const menu = d.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div role="menuitem">复制链接</div>';
    let left = 100,
      top = 800;
    menu.getBoundingClientRect = () => ({ left, right: left + 200, top: 200, bottom: top + 44 });
    d.body.append(menu);
    await pause();
    const entry = menu.querySelector('[data-grok-social="entry"]');
    entry.getBoundingClientRect = () => ({ left, right: left + 200, top, bottom: top + 44 });
    entry.click();
    await pause();
    const panel = d.querySelector('[data-grok-social="panel"]');
    assert.equal(panel.style.top, '800px', 'a short menu must not reserve the 420px maximum');
    assert.equal(panel.style.left, '304px');
    w.innerHeight = 900;
    w.dispatchEvent(new w.Event('resize'));
    assert.equal(panel.style.top, '694px', 'near bottom, align submenu and item bottoms');
    left = 700;
    top = 400;
    w.dispatchEvent(new w.Event('scroll'));
    assert.equal(panel.style.top, '400px');
    assert.equal(panel.style.left, '396px', 'flip next to the left edge of the parent menu');
    left = 100;
    top = 300;
    menu.style.transform = 'translateY(1px)';
    await pause();
    assert.equal(panel.style.top, '300px', 'follow parent menu layout changes');
    assert.equal(panel.style.left, '304px');
    entry.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    w.dispatchEvent(new w.Event('resize'));
    assert.equal(d.querySelector('[data-grok-social="panel"]'), null);
  } finally {
    stop();
    w.close();
  }
});

for (const [language, direction] of [
  ['en', 'ltr'],
  ['ar', 'rtl'],
])
  test(`localized ${language} website menus preserve native text, BOT names and host language`, async () => {
    const dom = environment(
      '<article><a href="/a/status/123"><time>Now</time></a></article><div role="menu"><div role="menuitem">复制链接</div></div>',
      'https://x.com/a/status/123',
    );
    const w = dom.window,
      d = w.document;
    d.documentElement.lang = 'zh-CN';
    d.documentElement.dir = 'ltr';
    const catalog = JSON.parse(
      await (
        await import('node:fs/promises')
      ).readFile(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8'),
    );
    w.chrome.i18n.getUILanguage = () => language;
    w.chrome.runtime.sendMessage = async () => ({
      ok: true,
      value: { language, resolvedLanguage: language, catalog },
    });
    await (await import('../src/i18n/index.js')).initI18n({ api: w.chrome, document: null });
    const stop = installSocialUI(w, {
      isTrusted: () => true,
      rpc: async () => ({
        authenticated: true,
        primary: { id: 'main', name: '用户的 BOT' },
        favorites: [],
      }),
    });
    try {
      d.querySelector('[data-grok-social="entry"]').click();
      await until(() =>
        d
          .querySelector('[data-grok-social="panel"]')
          ?.textContent.includes(catalog['发送给其他 BOT']),
      );
      assert.ok(d.querySelector('[data-grok-social="panel"]').textContent.includes('用户的 BOT'));
      assert.equal(d.querySelector('[data-grok-social="entry"]').dir, direction);
      assert.equal(d.querySelector('[data-grok-social="panel"]').dir, direction);
      assert.equal(d.querySelector('[role="menuitem"]').textContent, '复制链接');
      assert.equal(d.documentElement.lang, 'zh-CN');
      assert.equal(d.documentElement.dir, 'ltr');
    } finally {
      stop();
      w.close();
      setLocale('zh_CN');
    }
  });

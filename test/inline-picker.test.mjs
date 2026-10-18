import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEmbeddedPicker } from '../src/social/embedded-picker.js';

test('embedded picker stays within the webpage and accepts messages only from its own extension frame', () => {
  const dom = new JSDOM('<p>Original page</p>', { url: 'https://x.com/a/status/123' });
  const w = dom.window,
    queued = [];
  const picker = createEmbeddedPicker(w, {
    getURL: (path) => 'chrome-extension://test/' + path,
    onQueued: () => queued.push(true),
  });
  try {
    picker.open('request-1');
    const host = w.document.querySelector('[data-grok-social="picker"]');
    const frame = host.shadowRoot.querySelector('iframe');
    // JSDOM does not instantiate browsing contexts for shadow-tree iframes.
    if (!frame.contentWindow) Object.defineProperty(frame, 'contentWindow', { value: {} });
    assert.match(frame.src, /share.html\?request=request-1&embedded=1/);
    assert.equal(w.document.querySelector('p').textContent, 'Original page');
    const message = (source, origin, type, height) =>
      w.dispatchEvent(
        new w.MessageEvent('message', {
          source,
          origin,
          data: { source: 'grok-share-frame', id: 'request-1', type, height },
        }),
      );
    message(w, 'chrome-extension://test', 'close');
    message(frame.contentWindow, 'https://x.com', 'close');
    assert.ok(host.isConnected);
    message(frame.contentWindow, 'chrome-extension://test', 'resize', 99999);
    assert.ok(Number.parseInt(frame.style.height) <= 440);
    message(frame.contentWindow, 'chrome-extension://test', 'queued');
    assert.equal(queued.length, 1);
    assert.equal(host.isConnected, false);
    picker.open('request-2');
    picker.close();
    assert.equal(w.document.querySelector('[data-grok-social="picker"]'), null);
  } finally {
    picker.dispose();
    w.close();
  }
});

test('canceling preparation prevents a delayed capture from reopening the chooser', () => {
  const dom = new JSDOM('', { url: 'https://www.xiaohongshu.com/explore/note1' });
  const picker = createEmbeddedPicker(dom.window, {
    getURL: (path) => 'chrome-extension://test/' + path,
  });
  try {
    const pending = picker.prepare();
    assert.match(pending.shadowRoot.textContent, /正在读取帖子/);
    picker.close();
    picker.open('late-request', pending);
    assert.equal(dom.window.document.querySelector('[data-grok-social="picker"]'), null);
  } finally {
    picker.dispose();
    dom.window.close();
  }
});

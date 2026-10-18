import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createShareMenu } from '../src/social/menu.js';
test('shared X/WeChat menu actions have consistent typography and hover/focus feedback', () => {
  const dom = new JSDOM(
    '<div role="menu"><div id="native" style="font:700 15px Arial;padding:12px 16px;color:rgb(15,20,25)"><span>复制链接</span></div></div>',
  );
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  try {
    const x = createShareMenu(w, w.document.querySelector('#native')),
      wechat = createShareMenu(w);
    for (const menu of [x, wechat]) {
      const row = menu.action('发送给其他 BOT', 'plus');
      menu.panel.append(row);
      w.document.body.append(menu.panel);
      assert.equal(row.style.fontSize, '15px');
      assert.equal(row.style.fontWeight, '700');
      row.dispatchEvent(new w.Event('pointerenter'));
      assert.notEqual(row.style.background, 'transparent');
      row.dispatchEvent(new w.Event('pointerleave'));
      assert.equal(row.style.background, 'transparent');
      row.dispatchEvent(new w.Event('focus'));
      assert.notEqual(row.style.background, 'transparent');
      row.dispatchEvent(new w.Event('blur'));
      assert.equal(row.style.background, 'transparent');
    }
    assert.equal(x.panel.style.borderRadius, wechat.panel.style.borderRadius);
  } finally {
    w.close();
  }
});

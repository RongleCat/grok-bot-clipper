import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMarkdownRenderer } from '../src/ui/markdown.js';

function render(source) {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'https://extension.test/' });
  dom.window.document.querySelector('main').innerHTML = createMarkdownRenderer(dom.window)(source);
  return dom.window.document.querySelector('main');
}
test('renders GFM headings, nested lists, tasks, quotes, tables, links and fenced code', () => {
  const root = render(
    '# 标题\n\n**重点** 和 ~~删除~~\n\n> 引用\n\n- 第一项\n  - 子项\n- [x] 完成\n\n| 列 | 值 |\n| --- | --- |\n| A | B |\n\n```js\nconst value = "<hello>";\n```\n\n[文档](https://example.com)\n\n![示意图](https://example.com/image.png)',
  );
  assert.equal(root.querySelector('h1').textContent, '标题');
  for (const tag of [
    'strong',
    'del',
    'blockquote',
    'ul ul',
    'table th',
    'table td',
    'input[checked][disabled]',
    'pre code .hljs-keyword',
    'img',
  ])
    assert.ok(root.querySelector(tag), tag);
  assert.equal(root.querySelector('a').rel, 'noopener noreferrer');
  assert.equal(root.querySelector('pre code').textContent, 'const value = "<hello>";');
  assert.ok(root.querySelector('[data-copy-code]'));
});
test('removes scripts, unsafe URLs, event handlers and application action attributes', () => {
  const root = render(
    '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(1)">bad</a>\n\n<button data-action="logout">x</button><div style="position:fixed" data-copy-code>fake</div>\n\n[encoded](javascript&#58;alert(1))',
  );
  assert.equal(
    root.querySelector('script, button:not([data-copy-code]), [onerror], [data-action], [style]'),
    null,
  );
  assert.equal(root.querySelector('a[href^="javascript"]'), null);
  assert.equal(root.querySelector('[data-copy-code]'), null);
});
test('plain text and incomplete code fences render without executing HTML', () => {
  const root = render('第一行\n第二行\n\n```unknown-language\n<img onerror="bad()">');
  assert.match(root.textContent, /第一行/);
  assert.equal(root.querySelector('pre code').textContent, '<img onerror="bad()">');
  assert.equal(root.querySelector('pre img'), null);
});

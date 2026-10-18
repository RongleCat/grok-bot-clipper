import test from 'node:test';
import assert from 'node:assert/strict';
test('markdown controls follow the locale without translating BOT content', async () => {
  const { JSDOM } = await import('jsdom');
  const { initI18n, setLocale } = await import('../src/i18n/index.js');
  const { createMarkdownRenderer } = await import('../src/ui/markdown.js');
  const dom = new JSDOM('<!doctype html><main></main>');
  await initI18n({
    api: {
      runtime: {
        sendMessage: async () => ({
          ok: true,
          value: {
            language: 'en',
            resolvedLanguage: 'en',
            catalog: {
              文本: 'Text',
              复制: 'Copy',
              复制代码: 'Copy code',
              '表格，可横向滚动': 'Table, scroll horizontally',
            },
          },
        }),
      },
    },
    document: dom.window.document,
  });
  const render = createMarkdownRenderer(dom.window);
  const root = dom.window.document.querySelector('main');
  root.innerHTML = render('用户正文\n\n```\n用户代码\n```\n\n| 标题 |\n|---|\n| 内容 |');
  assert.equal(root.querySelector('[data-copy-code]').textContent, 'Copy');
  assert.equal(root.querySelector('[data-copy-code]').getAttribute('aria-label'), 'Copy code');
  assert.equal(
    root.querySelector('.table-scroll').getAttribute('aria-label'),
    'Table, scroll horizontally',
  );
  assert.equal(root.querySelector('pre code').textContent, '用户代码');
  assert.equal(root.querySelector('p').textContent, '用户正文');
  setLocale('zh_CN');
  root.innerHTML = render('```\nunchanged code\n```');
  assert.equal(root.querySelector('[data-copy-code]').textContent, '复制');
  assert.equal(root.querySelector('pre code').textContent, 'unchanged code');
  dom.window.close();
});

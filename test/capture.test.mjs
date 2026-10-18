import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
const compiled = await build({
  entryPoints: ['src/content/index.js'],
  bundle: true,
  format: 'iife',
  write: false,
});
function environment(body, firefox = false) {
  const dom = new JSDOM(
      `<html lang="zh"><head><title>上下文验收</title></head><body>${body}</body></html>`,
      {
        url: 'https://example.com/article?token=secret',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
      },
    ),
    w = dom.window;
  let listener;
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent;
    },
  });
  w.HTMLElement.prototype.getClientRects = function () {
    return [{ x: 0, y: 0, width: 400, height: 200 }];
  };
  w.chrome = {
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
      sendMessage: async () => ({ ok: true }),
    },
  };
  if (firefox) {
    w.browser = {
      ...w.chrome,
      runtime: { ...w.chrome.runtime, getBrowserInfo: async () => ({ name: 'Firefox' }) },
    };
    delete w.chrome;
  }
  w.eval(compiled.outputFiles[0].text);
  return {
    w,
    close: () => dom.window.close(),
    capture: (options) =>
      new Promise((resolve, reject) =>
        listener({ target: 'content', action: 'capture', options }, {}, (r) =>
          r.ok ? resolve(r.value) : reject(Error(r.error)),
        ),
      ),
  };
}
test('page capture keeps code/table, removes form values and hidden content', async () => {
  const e = environment(
    '<main><h1>证据</h1><p>明确来源的材料</p><input value="NEVER-INPUT"><textarea>NEVER-TEXTAREA</textarea><p hidden>NEVER-HIDDEN</p><pre><code class="language-js">const x = 42;</code></pre><table><tr><th>name</th></tr><tr><td>=CMD()</td></tr></table></main>',
  );
  try {
    const item = await e.capture({ kind: 'page' });
    assert.match(item.markdown, /const x = 42/);
    assert.ok(!item.markdown.includes('NEVER-'));
    assert.equal(item.tables.length, 1);
    assert.ok(item.tables[0].csv.includes("'=CMD()"));
    assert.ok(!item.url.includes('secret'));
  } finally {
    e.close();
  }
});
test('first image context capture locates source by srcUrl even before contextmenu listener existed', async () => {
  const e = environment(
    '<figure><img src="/figure.png" alt="研究图"><figcaption>图注证据</figcaption></figure>',
  );
  try {
    const item = await e.capture({ kind: 'image', srcUrl: 'https://example.com/figure.png' });
    assert.equal(item.image.alt, '研究图');
    assert.match(item.markdown, /图注证据/);
  } finally {
    e.close();
  }
});
test('selected code retains language and fenced whitespace', async () => {
  const e = environment(
    '<pre><code class="language-python">def hello():\n    return 42</code></pre>',
  );
  try {
    const node = e.w.document.querySelector('code').firstChild,
      range = e.w.document.createRange();
    range.selectNodeContents(node);
    e.w.getSelection().addRange(range);
    const item = await e.capture({ kind: 'selection' });
    assert.match(item.markdown, /```python\ndef hello\(\):\n    return 42/);
  } finally {
    e.close();
  }
});
test('page includes readable same-origin embedded frame context', async () => {
  const e = environment(
    '<main><p>主页面</p><iframe src="/embedded" title="嵌入资料"></iframe></main>',
  );
  try {
    const f = e.w.document.querySelector('iframe');
    f.contentDocument.open();
    f.contentDocument.write('<html><body><p>FRAME-CONTEXT-EVIDENCE</p></body></html>');
    f.contentDocument.close();
    const item = await e.capture({ kind: 'page' });
    assert.match(item.markdown, /FRAME-CONTEXT-EVIDENCE/);
  } finally {
    e.close();
  }
});
test('readability input excludes CSS-hidden material', async () => {
  const e = environment(
    '<style>.private{display:none}</style><article><h1>公开标题</h1><p>公开内容。'.repeat(30) +
      '</p><p class="private">NEVER-CAPTURE-CSS-HIDDEN</p></article>',
  );
  try {
    const item = await e.capture({ kind: 'page' });
    assert.ok(!item.markdown.includes('NEVER-CAPTURE-CSS-HIDDEN'));
  } finally {
    e.close();
  }
});
test('selecting a table itself exports its CSV', async () => {
  const e = environment('<table><tr><th>value</th></tr><tr><td>42</td></tr></table>');
  try {
    e.w.document
      .querySelector('table')
      .dispatchEvent(new e.w.MouseEvent('contextmenu', { bubbles: true }));
    const item = await e.capture({ kind: 'element' });
    assert.equal(item.tables.length, 1);
    assert.match(item.tables[0].csv, /42/);
  } finally {
    e.close();
  }
});

test('hidden structured tables and code never become separate attachments', async () => {
  const e = environment(
    '<main><h1>公开正文</h1><div style="visibility:hidden"><table><tr><td>NEVER-TABLE</td></tr></table><pre>NEVER-CODE</pre><h2>NEVER-HEADING</h2></div><table><tr><td>PUBLIC</td><td hidden>NEVER-CELL</td></tr></table><pre>public<span hidden>NEVER-SPAN</span></pre></main>',
  );
  try {
    const item = await e.capture({ kind: 'page' });
    assert.equal(item.tables.length, 1);
    assert.equal(item.codes.length, 1);
    assert.ok(!JSON.stringify(item).includes('NEVER-'));
  } finally {
    e.close();
  }
});

test('Firefox content capture works with browser.runtime only', async () => {
  const e = environment('<main><h1>Firefox</h1><p>Body retained</p></main>', true);
  try {
    const item = await e.capture({ kind: 'page' });
    assert.match(item.markdown, /Body retained/);
  } finally {
    e.close();
  }
});

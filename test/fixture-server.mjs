import { createServer } from 'node:http';
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>浏览器插件验收材料</title><meta name="author" content="Grok Bot Browser QA"><style>body{font:18px/1.8 system-ui;background:#f5f6f2;color:#25332b;margin:0}main{max-width:840px;margin:auto;padding:60px 40px}h1{font-size:36px}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #bbb}pre{background:#e3e9df;padding:20px;border-radius:10px}section{padding:35px 0;border-bottom:1px solid #ccd4c8}img{max-width:480px}nav{position:sticky;top:0;background:#fff;padding:12px 40px}button{padding:12px}</style></head><body><nav>浏览器插件验收材料</nav><main><article><h1>浏览器上下文采集验收</h1><p>这是一份公开性质的合成测试材料，不包含私人信息。选区、图片、表格、代码和网页归档应保留明确出处。</p><p id="selection">验收标记：GROK-BROWSER-CONTEXT-20261017。请只确认材料已收到，不执行其他操作。</p><figure><img src="/image.svg" alt="三种采集方式的示意图"><figcaption>截图、网页和选区均应携带出处。</figcaption></figure><h2>采集方式</h2><table><tr><th>材料</th><th>格式</th><th>来源</th></tr><tr><td>网页</td><td>Markdown + MHTML</td><td>当前标签页</td></tr><tr><td>截图</td><td>PNG</td><td>当前可见画面</td></tr></table><h2>代码</h2><pre><code class="language-js">const context = { source: location.href, complete: true };
console.log(context);</code></pre><p><a href="/second">第二份对比材料</a></p><input type="password" value="NEVER-CAPTURE-PASSWORD"><input type="text" value="NEVER-CAPTURE-INPUT"><p hidden>NEVER-CAPTURE-HIDDEN</p>${Array.from({ length: 8 }, (_, i) => `<section><h2>第 ${i + 1} 段资料</h2><p>这一段用于验证长页面滚动采集、正文提取和来源目录。材料编号 ${i + 1}。</p></section>`).join('')}</article></main></body></html>`;
createServer((req, res) => {
  if (req.url === '/image.svg') {
    res.setHeader('content-type', 'image/svg+xml');
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" rx="24" fill="#dce8d9"/><g fill="#4c6b50"><circle cx="120" cy="110" r="45"/><rect x="270" y="65" width="90" height="90" rx="18"/><path d="m500 60 55 95H445z"/></g><g fill="#fff"><circle cx="107" cy="106" r="6"/><circle cx="133" cy="106" r="6"/><circle cx="301" cy="106" r="6"/><circle cx="329" cy="106" r="6"/><circle cx="487" cy="117" r="6"/><circle cx="513" cy="117" r="6"/></g></svg>',
    );
  } else {
    res.setHeader('content-type', 'text/html;charset=utf-8');
    res.end(
      req.url === '/second'
        ? html
            .replaceAll('浏览器插件验收材料', '第二份对比材料')
            .replace('Markdown + MHTML', '完整正文与来源目录')
        : html,
    );
  }
}).listen(8788, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:8788'));

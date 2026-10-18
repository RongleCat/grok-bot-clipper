import { Marked } from 'marked';
import createDOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

// Render untrusted BOT output as content, never as extension controls.
export function createMarkdownRenderer(window) {
  const parser = new Marked({ gfm: true, breaks: false });
  const purify = createDOMPurify(window);
  return (source) => {
    const fragment = purify.sanitize(parser.parse(String(source ?? '')), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: [
        'p',
        'br',
        'hr',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'strong',
        'em',
        'del',
        's',
        'a',
        'img',
        'blockquote',
        'ul',
        'ol',
        'li',
        'input',
        'pre',
        'code',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'sup',
        'sub',
        'kbd',
        'div',
        'span',
        'details',
        'summary',
      ],
      ALLOWED_ATTR: [
        'href',
        'src',
        'alt',
        'title',
        'class',
        'type',
        'checked',
        'disabled',
        'start',
        'colspan',
        'rowspan',
        'align',
      ],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    for (const node of fragment.querySelectorAll('[class]')) {
      const language = node.tagName === 'CODE' && node.className.match(/\blanguage-([\w+-]+)/)?.[1];
      node.className = language ? `language-${language}` : '';
    }
    for (const link of fragment.querySelectorAll('a')) {
      const href = link.getAttribute('href') || '';
      if (!/^(https?:\/\/|mailto:|#)/i.test(href)) link.removeAttribute('href');
      if (/^(https?:\/\/|mailto:)/i.test(href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
    for (const img of fragment.querySelectorAll('img')) {
      if (
        !/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|avif);)/i.test(
          img.getAttribute('src') || '',
        )
      )
        img.removeAttribute('src');
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
    }
    for (const input of fragment.querySelectorAll('input')) {
      input.type = 'checkbox';
      input.disabled = true;
    }
    for (const code of fragment.querySelectorAll('pre > code')) {
      const language = code.className.match(/language-([\w+-]+)/)?.[1];
      const text = code.textContent.replace(/\n$/, '');
      code.textContent = text;
      if (language && hljs.getLanguage(language))
        code.innerHTML = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      code.classList.add('hljs');
      const wrapper = window.document.createElement('div');
      wrapper.className = 'code-block';
      const toolbar = window.document.createElement('div');
      toolbar.className = 'code-toolbar';
      const label = window.document.createElement('span');
      label.textContent = language || '文本';
      const copy = window.document.createElement('button');
      copy.type = 'button';
      copy.dataset.copyCode = '';
      copy.textContent = '复制';
      copy.setAttribute('aria-label', '复制代码');
      toolbar.append(label, copy);
      const pre = code.parentElement;
      pre.replaceWith(wrapper);
      wrapper.append(toolbar, pre);
    }
    for (const table of fragment.querySelectorAll('table')) {
      const wrapper = window.document.createElement('div');
      wrapper.className = 'table-scroll';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', '表格，可横向滚动');
      table.replaceWith(wrapper);
      wrapper.append(table);
    }
    const container = window.document.createElement('div');
    container.append(fragment);
    return container.innerHTML;
  };
}

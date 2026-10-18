import { escapeHTML } from '../ui/components.js';
import { t, initI18n, getLocale, supportedLocales } from '../i18n/index.js';
import { api } from '../platform/browser.js';
import { regionRect } from '../core/region.js';
import { icon } from '../ui/icons.js';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { cleanURL, toCSV } from '../core/context.js';
initI18n({ api, document: null }).catch(() => {});
if (!globalThis.__grokCapture) {
  globalThis.__grokCapture = true;
  let lastTarget = null,
    picker = null,
    scrollRestore = null;
  document.addEventListener(
    'contextmenu',
    (e) => {
      lastTarget = e.target;
    },
    true,
  );
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  td.addRule('table', {
    filter: 'table',
    replacement: (content, node) => '\n\n' + tableMarkdown(node) + '\n\n',
  });
  td.addRule('pre', {
    filter: 'pre',
    replacement: (content, node) => {
      const c = node.querySelector('code'),
        lang = (c?.className ?? '').match(/language-([\w+-]+)/)?.[1] ?? '';
      let fence = '```';
      while ((node.textContent ?? '').includes(fence)) fence += '`';
      return '\n\n' + fence + lang + '\n' + node.textContent + '\n' + fence + '\n\n';
    },
  });
  function rows(table) {
    return [...table.rows].map((r) => [...r.cells].map((c) => c.innerText.trim()));
  }
  function tableMarkdown(table) {
    const data = rows(table);
    if (!data.length) return '';
    const width = Math.max(...data.map((x) => x.length));
    const line = (r) =>
      '| ' +
      Array.from({ length: width }, (_, i) =>
        (r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>'),
      ).join(' | ') +
      ' |';
    return [line(data[0]), line(Array(width).fill('---')), ...data.slice(1).map(line)].join('\n');
  }
  function meta(name) {
    return document.querySelector(`meta[name="${name}"],meta[property="${name}"]`)?.content ?? '';
  }
  function strip(root) {
    for (const e of root.querySelectorAll(
      'script,style,noscript,input,textarea,select,[contenteditable],iframe,object,embed,[hidden],[aria-hidden="true"],#grok-capture-host',
    ))
      e.remove();
    for (const e of root.querySelectorAll('[href],[src]'))
      for (const a of ['href', 'src'])
        if (e.hasAttribute(a)) {
          try {
            const u = new URL(e.getAttribute(a), location.href);
            e.setAttribute(a, cleanURL(u.href));
          } catch {
            e.removeAttribute(a);
          }
        }
    return root;
  }
  function isVisible(element) {
    for (let e = element; e instanceof HTMLElement; e = e.parentElement) {
      const css = getComputedStyle(e);
      if (
        e.hidden ||
        css.display === 'none' ||
        css.visibility === 'hidden' ||
        css.visibility === 'collapse' ||
        e.matches('input,textarea,select,[contenteditable]')
      )
        return false;
    }
    return !!element.getClientRects().length;
  }
  function visibleClone(root) {
    const clone = root.cloneNode(true),
      orig = [root, ...root.querySelectorAll('*')],
      copy = [clone, ...clone.querySelectorAll('*')];
    for (let i = orig.length - 1; i >= 0; i--) {
      const e = orig[i];
      if (
        e instanceof HTMLElement &&
        copy[i] &&
        (getComputedStyle(e).display === 'none' ||
          getComputedStyle(e).visibility === 'hidden' ||
          getComputedStyle(e).visibility === 'collapse')
      )
        copy[i].remove();
    }
    return strip(clone);
  }
  function nearby(selection) {
    const node = selection?.anchorNode?.parentElement;
    return node?.closest('p,li,blockquote,section,article')?.innerText?.slice(0, 10000) ?? '';
  }
  function locator(selection) {
    const r = selection?.rangeCount ? selection.getRangeAt(0) : null;
    return r
      ? {
          quote: selection.toString(),
          prefix: r.startContainer.textContent?.slice(
            Math.max(0, r.startOffset - 80),
            r.startOffset,
          ),
          suffix: r.endContainer.textContent?.slice(r.endOffset, r.endOffset + 80),
        }
      : undefined;
  }
  async function capture(options = {}) {
    const selection = getSelection(),
      selected = selection?.toString() ?? '',
      kind = options.kind ?? 'page',
      warnings = [];
    const item = {
      id: crypto.randomUUID(),
      kind,
      title: document.title,
      url: cleanURL(location.href),
      canonical: cleanURL(document.querySelector('link[rel="canonical"]')?.href),
      author: meta('author') || meta('article:author'),
      publishedAt: meta('article:published_time'),
      description: meta('description') || meta('og:description'),
      language: document.documentElement.lang,
      capturedAt: new Date().toISOString(),
      createdAt: Date.now(),
      viewport: { width: innerWidth, height: innerHeight },
      warnings,
      attachments: [],
      frames: [...document.querySelectorAll('iframe')].map((f) => ({
        url: cleanURL(f.src),
        title: f.title,
      })),
      headings: [...document.querySelectorAll('h1,h2,h3')]
        .filter(isVisible)
        .map((e) => e.innerText)
        .slice(0, 200),
    };
    if (item.frames.length) warnings.push(t('嵌入框架内容仅在授权后单独采集；本材料保留框架出处'));
    if (kind === 'selection') {
      const text = options.selectionText || selected;
      item.selection = text;
      item.locator = locator(selection);
      item.markdown = text;
      const selectedCode = selection?.anchorNode?.parentElement?.closest('pre');
      if (selectedCode) {
        const language =
          (selectedCode.querySelector('code')?.className ?? '').match(/language-([\w+-]+)/)?.[1] ??
          '';
        let fence = '```';
        while (text.includes(fence)) fence += '`';
        item.markdown = fence + language + '\n' + text + '\n' + fence;
      }
      const near = options.includeNearby !== false ? nearby(selection) : '';
      if (near && near !== text) item.markdown += t('\n\n附近段落：\n') + near;
      if (options.includePageContext) {
        const main = document.querySelector('article,main,[role="main"]');
        if (main) item.pageContext = td.turndown(visibleClone(main));
      }
    } else if (kind === 'link') {
      const a =
        lastTarget?.closest('a') ?? [...document.links].find((a) => a.href === options.linkUrl);
      item.link = { url: cleanURL(options.linkUrl || a?.href), label: a?.innerText || '' };
      item.markdown = `[${item.link.label || item.link.url}](${item.link.url})`;
    } else if (kind === 'image') {
      const img =
        lastTarget?.closest('img') ??
        (lastTarget instanceof HTMLImageElement ? lastTarget : null) ??
        [...document.images].find(
          (i) => i.currentSrc === options.srcUrl || i.src === options.srcUrl,
        );
      item.image = {
        url: options.srcUrl || img?.currentSrc || img?.src || '',
        alt: img?.alt ?? '',
        width: img?.naturalWidth,
        height: img?.naturalHeight,
      };
      item.markdown = t('图片：{alt}\n原图：{url}', {
        alt: item.image.alt,
        url: cleanURL(item.image.url),
      });
      if (img) {
        const figure = img.closest('figure');
        if (figure?.querySelector('figcaption'))
          item.markdown += t('\n图注：') + figure.querySelector('figcaption').innerText;
      }
    } else {
      const target =
        kind === 'element'
          ? options.selector
            ? document.querySelector(options.selector)
            : lastTarget
          : document.body;
      if (!target) throw Error('ELEMENT_UNAVAILABLE');
      let root = visibleClone(target),
        article;
      if (kind === 'page') {
        const d = visibleClone(document);
        try {
          article = new Readability(d, { charThreshold: 80, keepClasses: true }).parse();
        } catch {
          warnings.push(t('正文识别失败，已提取可见页面'));
        }
      }
      if (article?.content) {
        item.markdown = td.turndown(article.content);
        item.author ||= article.byline;
        item.excerpt = article.excerpt;
      } else item.markdown = td.turndown(root);
      const tables = [
        ...(target.matches?.('table') ? [target] : []),
        ...target.querySelectorAll('table'),
      ].filter(isVisible);
      item.tables = tables.map((t, i) => ({
        name: `table-${i + 1}.csv`,
        csv: toCSV(rows(visibleClone(t))),
      }));
      item.codes = [...(target.matches?.('pre') ? [target] : []), ...target.querySelectorAll('pre')]
        .filter(isVisible)
        .map((e) => ({
          language: e.querySelector('code')?.className ?? '',
          text: visibleClone(e).textContent,
        }));
      if (kind === 'element') {
        const r = target.getBoundingClientRect();
        item.rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    const video = document.querySelector('video');
    if (video) {
      const bounds = video.getBoundingClientRect();
      item.videoRect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      item.video = {
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        source: cleanURL(video.currentSrc),
        page: cleanURL(location.href),
      };
      const tracks = [];
      for (const track of video.textTracks) {
        if (track.cues)
          tracks.push({
            language: track.language,
            label: track.label,
            cues: [...track.cues].map((c) => ({
              start: c.startTime,
              end: c.endTime,
              text: c.text,
            })),
          });
      }
      item.video.tracks = tracks;
      item.markdown += t('\n\n视频时间点：') + Math.floor(video.currentTime) + t(' 秒');
      if (tracks.length)
        item.markdown +=
          t('\n\n字幕：\n') +
          tracks.flatMap((t) => t.cues.map((c) => `[${c.start.toFixed(1)}s] ${c.text}`)).join('\n');
      else warnings.push(t('未读取到可访问字幕，仅包含时间点和页面内容'));
    }
    const audio = document.querySelector('audio');
    if (audio) {
      item.audio = {
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : null,
        source: cleanURL(audio.currentSrc),
      };
      item.markdown += '\n\nAudio time: ' + Math.floor(audio.currentTime) + 's';
    }
    if (kind === 'page') {
      let readable = 0;
      for (const frame of document.querySelectorAll('iframe')) {
        try {
          const body = frame.contentDocument?.body;
          if (body) {
            readable++;
            const clone = body.cloneNode(true);
            strip(clone);
            item.markdown +=
              t('\n\n## 嵌入页面：') +
              (frame.title || cleanURL(frame.src)) +
              '\n\n' +
              td.turndown(clone);
          }
        } catch {}
      }
      if (readable) warnings.push(t('已附带 {count} 个可读取嵌入页面的正文', { count: readable }));
    }
    if (document.querySelector('canvas')) warnings.push(t('Canvas 内容未转为文字，可额外采集截图'));
    if (item.markdown.length > 2000000) {
      item.markdown = item.markdown.slice(0, 2000000);
      warnings.push(t('页面文字超过 200 万字符的采集上限，后续内容未采集'));
    }
    return item;
  }
  function captureNotice(text) {
    if (/^[A-Z][A-Z0-9_]*$/.test(String(text || '')))
      text = t('操作失败（{code}），请重试', { code: text });
    document.getElementById('grok-capture-notice')?.remove();
    const host = document.createElement('div');
    host.id = 'grok-capture-notice';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<style>:host{all:initial;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647}div{padding:12px 16px;background:#202020;color:#fff;border-radius:10px;font:14px/1.5 system-ui}</style><div role="status"></div>';
    root.querySelector('div').dir =
      supportedLocales.find((locale) => locale.code === getLocale())?.dir || 'ltr';
    root.querySelector('div').textContent = text;
    document.documentElement.append(host);
    setTimeout(() => host.remove(), 4500);
  }
  function chooseRegion() {
    picker?.();
    const host = document.createElement('div');
    host.id = 'grok-region-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>:host{all:initial}.overlay{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;cursor:crosshair;touch-action:none;user-select:none;background:#0003}.overlay::backdrop{background:transparent}.box{position:fixed;display:none;border:1px solid white;box-shadow:0 0 0 99999px #0006;pointer-events:none}.hint{position:fixed;top:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:24px;background:white;color:#202020;font:14px/1.5 system-ui;pointer-events:none}</style><dialog class="overlay"><div class="box"></div><div class="hint">${icon('capture', 18)}${escapeHTML(t('拖动框选截图 · Esc 取消'))}</div></dialog>`;
    document.documentElement.append(host);
    root
      .querySelector('.hint')
      ?.setAttribute(
        'dir',
        supportedLocales.find((locale) => locale.code === getLocale())?.dir || 'ltr',
      );
    const overlay = root.querySelector('.overlay'),
      box = root.querySelector('.box');
    overlay.showModal();
    const viewport = { width: innerWidth, height: innerHeight, scrollX, scrollY };
    let start, rect, pointer;
    const cleanup = () => {
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('blur', cancel);
      overlay.close();
      host.remove();
      picker = null;
    };
    const cancel = () => {
      cleanup();
      api.runtime.sendMessage({ type: 'picker.cancel' }).catch(() => {});
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    };
    overlay.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pointer = e.pointerId;
      overlay.setPointerCapture(pointer);
      start = { x: e.clientX, y: e.clientY };
      overlay.style.background = 'transparent';
      root.querySelector('.hint').style.display = 'none';
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== pointer) return;
      rect = regionRect(start, { x: e.clientX, y: e.clientY }, viewport.width, viewport.height);
      Object.assign(box.style, {
        display: 'block',
        left: rect.x + 'px',
        top: rect.y + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
      });
    });
    overlay.addEventListener('pointercancel', cancel);
    overlay.addEventListener('pointerup', async (e) => {
      if (!start || e.pointerId !== pointer) return;
      rect = regionRect(start, { x: e.clientX, y: e.clientY }, viewport.width, viewport.height);
      if (rect.width < 4 || rect.height < 4) {
        cancel();
        return;
      }
      cleanup();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const result = await api.runtime.sendMessage({ type: 'capture.region', rect, viewport });
        if (!result?.ok) throw Error(result?.error || t('截图失败'));
        if (result.value?.jobId) captureNotice(t('截图已加入发送队列'));
      } catch (error) {
        captureNotice(error.message);
      }
    });
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', cancel);
    window.addEventListener('blur', cancel);
    picker = cleanup;
  }
  function chooseElement() {
    if (picker) return;
    const host = document.createElement('div');
    host.id = 'grok-capture-host';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>:host{all:initial}.box{position:fixed;pointer-events:none;border:2px solid #54765e;background:#54765e18;z-index:2147483647}.hint{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#242823;color:white;padding:12px 18px;border-radius:10px;font:14px system-ui;z-index:2147483647}</style><div class="box"></div><div class="hint">${escapeHTML(t('点击采集元素 · Esc 取消'))}</div>`;
    document.documentElement.append(host);
    const box = root.querySelector('.box');
    let current;
    const move = (e) => {
      current = e.target;
      if (current === host) return;
      const r = current.getBoundingClientRect();
      Object.assign(box.style, {
        left: r.x + 'px',
        top: r.y + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
      });
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      host.remove();
      picker = null;
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        api.runtime.sendMessage({ type: 'picker.cancel' }).catch(() => {});
      }
    };
    const click = async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      lastTarget = current ?? e.target;
      cleanup();
      try {
        const item = await capture({ kind: 'element' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await api.runtime.sendMessage({ type: 'capture.element', item });
      } catch (error) {
        await api.runtime.sendMessage({ type: 'capture.error', error: error.message });
      }
    };
    picker = cleanup;
    document.addEventListener('pointermove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.target !== 'content') return;
    (async () => {
      await initI18n({ api, document: null });
      switch (message.action) {
        case 'capture':
          return capture(message.options);
        case 'viewport':
          return { width: innerWidth, height: innerHeight, scrollX, scrollY };
        case 'region.picker':
          chooseRegion();
          return { ok: true };
        case 'picker':
          chooseElement();
          return { ok: true };
        case 'scroll.prepare':
          scrollRestore = {
            x: scrollX,
            y: scrollY,
            behavior: document.documentElement.style.scrollBehavior,
          };
          document.documentElement.style.scrollBehavior = 'auto';
          return {
            width: innerWidth,
            height: innerHeight,
            total: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
            x: scrollX,
            y: scrollY,
          };
        case 'scroll.to':
          scrollTo(0, message.y);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { y: scrollY, height: innerHeight };
        case 'scroll.restore':
          if (scrollRestore) {
            scrollTo(scrollRestore.x, scrollRestore.y);
            document.documentElement.style.scrollBehavior = scrollRestore.behavior;
          }
          return { ok: true };
        default:
          throw Error('UNKNOWN_CAPTURE_ACTION');
      }
    })().then(
      (value) => respond({ ok: true, value }),
      (error) => respond({ ok: false, error: error.message }),
    );
    return true;
  });
}

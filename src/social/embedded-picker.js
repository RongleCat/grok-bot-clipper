import { t, getLocale, supportedLocales } from '../i18n/index.js';
export function createEmbeddedPicker(window, { getURL, onQueued }) {
  let host, frame, requestId;
  const { document } = window;
  function close() {
    host?.remove();
    host = frame = requestId = null;
  }
  function fit(height = 300) {
    if (!frame) return;
    frame.style.height =
      Math.max(100, Math.min(Number(height) || 300, 440, window.innerHeight - 24)) + 'px';
  }
  function createHost() {
    host = document.createElement('div');
    host.setAttribute('data-grok-social', 'picker');
    host.setAttribute('popover', 'manual');
    host.dir = supportedLocales.find((locale) => locale.code === getLocale())?.dir || 'ltr';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{all:initial!important;display:block!important;position:fixed!important;inset:50% auto auto 50%!important;transform:translate(-50%,-50%)!important;margin:0!important;padding:0!important;width:min(360px,calc(100vw - 24px))!important;border:1px solid #8883!important;border-radius:12px!important;overflow:hidden!important;background:transparent!important;box-shadow:0 6px 24px #0002!important;z-index:2147483647!important}iframe{display:block;border:0;width:100%;background:transparent;color-scheme:normal}.loading{background:#fff;color:#202020}@media(prefers-color-scheme:dark){.loading{background:#202020;color:#eee}}';
    shadow.append(style);
    document.body.append(host);
    host.showPopover?.();
    return shadow;
  }
  function prepare() {
    close();
    const shadow = createHost();
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.style.cssText =
      'display:flex;align-items:center;gap:16px;padding:18px;font:14px/1.5 system-ui';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.textContent = t('正在读取帖子并打开 BOT…');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('取消');
    cancel.style.cssText =
      'flex:0 0 auto;border:0;background:transparent;color:inherit;padding:8px;font:inherit;cursor:pointer';
    cancel.onclick = close;
    loading.append(status, cancel);
    shadow.append(loading);
    return host;
  }
  function fail(message, pending) {
    if (host !== pending) return;
    const status = host.shadowRoot.querySelector('[role="status"]');
    if (status) status.textContent = message;
  }
  function open(id, pending) {
    if (pending && host !== pending) return;
    const sourceURL = getURL('share.html');
    close();
    requestId = id;
    const shadow = createHost();
    frame = document.createElement('iframe');
    frame.title = t('选择 BOT');
    frame.src =
      sourceURL +
      '?request=' +
      encodeURIComponent(id) +
      '&embedded=1&parentOrigin=' +
      encodeURIComponent(window.location.origin) +
      '&maxHeight=' +
      Math.max(100, Math.min(440, window.innerHeight - 24));
    shadow.append(frame);
    fit();
  }
  function message(event) {
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      event.origin !== getURL('').replace(/\/$/, '') ||
      event.data?.source !== 'grok-share-frame' ||
      event.data.id !== requestId
    )
      return;
    if (event.data.type === 'resize' && Number.isFinite(event.data.height)) fit(event.data.height);
    if (event.data.type === 'close') close();
    if (event.data.type === 'queued') {
      close();
      onQueued?.();
    }
  }
  function key(event) {
    if (event.key === 'Escape') close();
  }
  function outside(event) {
    if (host && !event.composedPath().includes(host)) close();
  }
  function resize() {
    if (frame) fit(parseInt(frame.style.height));
  }
  window.addEventListener('message', message);
  document.addEventListener('keydown', key);
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', resize);
  return {
    open,
    prepare,
    fail,
    close,
    dispose() {
      close();
      window.removeEventListener('message', message);
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', resize);
    },
  };
}

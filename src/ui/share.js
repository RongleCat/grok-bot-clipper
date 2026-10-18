import { api } from '../platform/browser.js';
import { escapeHTML as esc } from './components.js';
import { mountAvatars, releaseAvatars } from './avatars.js';
import { icon } from './icons.js';
import { searchBots } from './bot-search.js';
const params = new URLSearchParams(location.search);
const requestId = params.get('request');
const embedded = params.get('embedded') === '1';
const parentOrigin = params.get('parentOrigin');
if (embedded) {
  document.documentElement.dataset.embedded = 'true';
  document.documentElement.style.setProperty(
    '--picker-max-height',
    Math.max(100, Math.min(440, Number(params.get('maxHeight')) || 440)) + 'px',
  );
}
const root = document.querySelector('#app');
let model,
  selected = '',
  sending = false,
  refreshing = false,
  closeTimer,
  disposed = false;
const messages = {
  SOCIAL_VIDEO_ENCRYPTED: '仅获取到播放器加密视频，本次未发送。未找到可供 BOT 使用的原始视频文件',
  SOCIAL_VIDEO_NOT_CAPTURED:
    '未捕获到视频地址，本次未发送。请关闭窗口，刷新小红书页面并播放视频后重新分享',
  SOCIAL_VIDEO_DOWNLOAD_FAILED: '视频文件下载失败，本次未发送。请关闭窗口，刷新笔记后重新分享',
  SHARE_EXPIRED: '这次分享已过期，请回到原页面重新分享',
  ACCOUNT_CHANGED: '账户或团队已切换，请关闭窗口后重新分享',
  LOGIN_REQUIRED: '请先在扩展中登录',
  BOT_UNAVAILABLE: '这个 BOT 已不可用，请重新选择',
  INSTRUCTION_TOO_LARGE: '补充说明过长，请缩短后再试',
};
async function rpc(type, extra = {}) {
  const result = await api.runtime.sendMessage({ type, id: requestId, ...extra });
  if (!result?.ok) throw Error(result?.error || 'CONNECTION_FAILED');
  return result.value;
}
function notifyFrame(type, extra = {}) {
  if (!disposed && embedded && /^https?:\/\//.test(parentOrigin || ''))
    window.parent.postMessage(
      { source: 'grok-share-frame', id: requestId, type, ...extra },
      parentOrigin,
    );
}
function resizeFrame() {
  if (embedded && !disposed)
    requestAnimationFrame(
      () =>
        !disposed &&
        notifyFrame('resize', { height: Math.ceil(root.getBoundingClientRect().height) }),
    );
}
function closePicker() {
  if (embedded) notifyFrame('close');
  else window.close();
}
function showInstructions(show = true) {
  document.querySelector('#bots').hidden = show;
  document.querySelector('footer').hidden = !show;
  document.querySelector('.search').hidden = show;
  document.querySelector('#refresh-bots').hidden = show;
  if (show) {
    document.querySelector('#chosen-bot').textContent =
      model.bots.find((b) => b.id === selected)?.name || 'BOT';
    document.querySelector('#instruction')?.focus();
  } else document.querySelector('#search').focus();
  resizeFrame();
}
function status(message, error = false) {
  const el = document.querySelector('#status');
  el.textContent = message;
  el.dataset.error = error;
  resizeFrame();
}
function syncControls() {
  const busy = sending || refreshing || Boolean(model.jobId);
  document.querySelector('#send').disabled = busy || !selected;
  const refresh = document.querySelector('#refresh-bots');
  refresh.disabled = busy;
  refresh.setAttribute('aria-busy', String(refreshing));
  refresh.innerHTML = `${icon('refresh', 16)}${embedded ? '' : refreshing ? ' 刷新中…' : ' 刷新 BOT'}`;
  for (const card of document.querySelectorAll('[data-bot]')) card.disabled = busy;
}
async function refreshBots() {
  if (refreshing || sending || model.jobId) return;
  refreshing = true;
  syncControls();
  status('正在刷新 BOT…');
  try {
    // Fetch the remote roster before reading the validated share request again.
    await rpc('bots.refresh');
    const next = await rpc('social.picker.state');
    if (disposed) return;
    model = next;
    const removed = selected && !model.bots.some((b) => b.id === selected);
    if (removed) selected = '';
    renderBots();
    status(removed ? 'BOT 已刷新，原选中的 BOT 已不可用，请重新选择' : 'BOT 列表已刷新');
  } catch (error) {
    if (disposed) return;
    if (['ACCOUNT_CHANGED', 'LOGIN_REQUIRED', 'SHARE_EXPIRED'].includes(error.message))
      selected = '';
    status(messages[error.message] || '刷新失败，请重试：' + error.message, true);
  } finally {
    refreshing = false;
    if (!disposed) syncControls();
  }
}
function renderBots() {
  const bots = searchBots(model.bots, document.querySelector('#search').value);
  const groups = [
    ['主 BOT', bots.filter((b) => b.id === model.primaryId)],
    ['收藏 BOT', bots.filter((b) => b.id !== model.primaryId && model.favorites.includes(b.id))],
    ['其他 BOT', bots.filter((b) => b.id !== model.primaryId && !model.favorites.includes(b.id))],
  ];
  const list = document.querySelector('#bots');
  releaseAvatars(list);
  const card = (b) =>
    `<button type="button" class="bot-card" data-bot="${esc(b.id)}" aria-pressed="${b.id === selected}"><span data-avatar="${esc(b.id)}" data-size="${embedded ? 40 : 56}" class="avatar" aria-hidden="true"></span><span class="bot-name">${esc(b.name || 'BOT')}</span></button>`;
  list.innerHTML = embedded
    ? bots.length
      ? `<div class="bot-grid">${bots.map(card).join('')}</div>`
      : '<p class="empty">没有匹配的 BOT</p>'
    : groups
        .filter(([, rows]) => rows.length)
        .map(
          ([title, rows]) =>
            `<section><h2>${title}</h2><div class="bot-grid">${rows.map((b) => `<button type="button" class="bot-card" data-bot="${esc(b.id)}" aria-pressed="${b.id === selected}"><span data-avatar="${esc(b.id)}" data-size="56" class="avatar" aria-hidden="true"></span><span class="bot-name">${esc(b.name || 'BOT')}</span><span class="selection" aria-hidden="true">${icon('check', 14)}</span></button>`).join('')}</div></section>`,
        )
        .join('') || '<p class="empty">没有匹配的 BOT</p>';
  mountAvatars(list, bots);
  syncControls();
  resizeFrame();
}
async function submitSelection() {
  if (sending || refreshing || !selected || model.jobId) return;
  sending = true;
  syncControls();
  status('正在采集媒体并发送…');
  try {
    const result = await rpc('social.picker.send', {
      botId: selected,
      instruction: document.querySelector('#instruction')?.value || '',
    });
    if (disposed) return;
    if (!result?.jobId) throw Error('SEND_UNCONFIRMED');
    model.jobId = result.jobId;
    status(
      result.warnings?.length ? '已加入发送队列；缺失媒体的说明已附在正文中' : '已加入发送队列',
    );
    if (embedded) notifyFrame('queued');
    else closeTimer = setTimeout(closePicker, 1200);
  } catch (error) {
    if (!disposed) status(messages[error.message] || '发送失败：' + error.message, true);
  } finally {
    sending = false;
    if (!disposed) syncControls();
  }
}
async function load() {
  root.innerHTML = '<div class="loading" role="status">正在读取 BOT…</div>';
  try {
    if (!requestId) throw Error('SHARE_EXPIRED');
    model = await rpc('social.picker.state');
    if (disposed) return;
    document.documentElement.dataset.theme = model.theme || 'system';
    selected = model.selectedBotId;
    if (!model.bots.some((b) => b.id === selected)) selected = '';
    root.innerHTML = embedded
      ? `<div class="compact-toolbar"><label class="search">${icon('search', 16)}<input id="search" type="search" placeholder="搜索 BOT" autocomplete="off" aria-label="搜索 BOT"></label><button id="refresh-bots" class="icon" type="button" aria-label="刷新 BOT" title="刷新 BOT">${icon('refresh', 16)}</button><button id="close" class="icon" type="button" aria-label="关闭">${icon('close', 18)}</button></div><main id="bots" aria-label="BOT 列表"></main><footer hidden><button id="back" type="button" class="icon" aria-label="返回 BOT 列表">${icon('back', 16)}</button><strong id="chosen-bot"></strong>${model.askBeforeSend ? '<textarea id="instruction" placeholder="补充说明（可选）" aria-label="补充说明" rows="3"></textarea>' : ''}<button id="send" type="button" class="primary">发送</button></footer><div id="status" role="status" aria-live="polite"></div>`
      : `<header><div><h1>${model.askBeforeSend ? '发送给 BOT' : '选择 BOT'}</h1><p>选择接收这篇内容的 BOT</p></div><div class="header-actions"><button id="refresh-bots" class="secondary" type="button">${icon('refresh', 16)} 刷新 BOT</button><button id="close" class="icon" type="button" aria-label="关闭">${icon('close', 20)}</button></div></header><div class="source"><strong>${esc(model.post.title)}</strong><span>${esc(model.post.url)}</span></div><label class="search">${icon('search', 18)}<input id="search" type="search" placeholder="搜索 BOT" autocomplete="off" aria-label="搜索 BOT"></label><main id="bots" aria-label="BOT 列表"></main><footer>${model.askBeforeSend ? '<label class="instruction-label" for="instruction">补充说明</label><textarea id="instruction" placeholder="希望 BOT 如何处理这篇内容？" rows="3"></textarea>' : ''}<div id="status" role="status" aria-live="polite"></div><div class="footer-actions"><button id="cancel" class="secondary" type="button">取消</button><button id="send" class="primary" type="button">${icon('send', 16)} 发送</button></div></footer>`;
    document.querySelector('#refresh-bots').addEventListener('click', refreshBots);
    document.querySelector('#search').addEventListener('input', renderBots);
    for (const button of document.querySelectorAll('#close,#cancel')) button.onclick = closePicker;
    document.querySelector('#back')?.addEventListener('click', () => {
      if (!sending) showInstructions(false);
    });
    document.querySelector('#bots').addEventListener('click', (event) => {
      const card = event.target.closest('[data-bot]');
      if (!card || sending || refreshing || model.jobId) return;
      selected = card.dataset.bot;
      for (const node of document.querySelectorAll('[data-bot]'))
        node.setAttribute('aria-pressed', String(node.dataset.bot === selected));
      document.querySelector('#send').disabled = false;
      if (embedded) {
        if (model.askBeforeSend) showInstructions();
        else submitSelection();
      }
    });
    document.querySelector('#send').addEventListener('click', submitSelection);
    renderBots();
    if (model.jobId) status('这次分享已加入发送队列');
    document.querySelector('#search').focus();
    resizeFrame();
  } catch (error) {
    if (disposed) return;
    root.innerHTML = `<div class="loading"><p role="alert">${esc(messages[error.message] || '无法读取 BOT，请重新加载扩展后再试')}</p><button id="retry" class="secondary">重试</button></div>`;
    document.querySelector('#retry').onclick = load;
    resizeFrame();
  }
}
window.addEventListener('pagehide', () => {
  disposed = true;
  clearTimeout(closeTimer);
  releaseAvatars(root);
});
if (embedded) {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePicker();
  });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(resizeFrame);
    observer.observe(root);
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }
}
await load();

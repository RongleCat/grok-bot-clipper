import { escapeHTML } from '../ui/components.js';
import { t, initI18n, getLocale, supportedLocales } from '../i18n/index.js';
import { createShareMenu, anchorShareMenu, createMenuAction as styleAction } from './menu.js';
import { createEmbeddedPicker } from './embedded-picker.js';
import { recipientArea, recipientNode, isolateDouyinRecipients } from './recipients.js';
import { platformForURL, sanitizeRecord, mergeSocialRecord } from './records.js';
import { contextForShare, extractSocialDOM } from './dom.js';

const own = 'data-grok-social';
function visible(window, node) {
  if (!node?.isConnected || !node.getClientRects().length) return false;
  for (let element = node; element; element = element.parentElement) {
    const style = window.getComputedStyle(element);
    if (element.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
function nativeShare(window, platform) {
  const { document } = window;
  const walker = document.createTreeWalker(document.body, window.NodeFilter.SHOW_TEXT);
  let node,
    visited = 0;
  while ((node = walker.nextNode()) && visited++ < 30000) {
    if (!/^(复制链接|复制|链接|Copy\s*link|Copy|link)$/i.test(node.textContent.trim())) continue;
    let label = node.parentElement;
    for (
      let depth = 0;
      label && depth < 3 && !/^(复制链接|Copylink)$/i.test(label.textContent.replace(/\s/g, ''));
      depth++
    )
      label = label.parentElement;
    if (!label || !/^(复制链接|Copylink)$/i.test(label.textContent.replace(/\s/g, ''))) continue;
    if (!label || label.closest(`[${own}]`) || !visible(window, label)) continue;
    if (platform === 'x') {
      const menu = label.closest('[role="menu"]'),
        template = label.closest('[role="menuitem"]');
      if (menu && template) return { menu, template };
    } else {
      const template =
        label.closest('button,[role="menuitem"],.share-item,.share-option') || label.parentElement;
      let menu = template.parentElement;
      for (let depth = 0; menu && depth < 6; depth++, menu = menu.parentElement) {
        if (menu === document.body || menu.querySelector('video, #detail-desc, #js_content')) break;
        const rect = menu.getBoundingClientRect();
        if (
          menu.contains(template) &&
          (menu.matches(
            '[role="menu"],.share-container,.share-menu,.share-panel,.share-modal,.share-tooltip,[data-e2e="video-share-panel"]',
          ) ||
            (rect.width >= 120 &&
              rect.width <= 650 &&
              rect.height >= 35 &&
              rect.height <= 900 &&
              /分享|Share|扫码/.test(menu.textContent)))
        )
          return { menu, template };
      }
    }
  }
  if (platform === 'douyin') {
    for (const menu of [
      ...document.querySelectorAll(
        '[data-e2e="video-share-panel"],.share-modal,.share-panel,.share-tooltip,[role="dialog"]',
      ),
    ].slice(0, 30)) {
      if (
        !visible(window, menu) ||
        menu.querySelector('video') ||
        !/分享给朋友/.test(menu.textContent)
      )
        continue;
      return {
        menu,
        template: menu.querySelector('button,.share-item') || document.createElement('div'),
      };
    }
  }
  return null;
}
export function installSocialUI(
  window,
  { rpc, avatars, isTrusted = (event) => event.isTrusted } = {},
) {
  const platform = platformForURL(window.location.href);
  if (!platform) return () => {};
  const { document } = window,
    cache = new Map(),
    entryContexts = new WeakMap(),
    recipientLists = new Map(),
    wechatScopes = new Map(),
    recordWaiters = new Map(),
    menuAvatarScopes = new Map(),
    retryTimers = new Map(),
    retryCounts = new WeakMap(),
    failedRecipients = new Set();
  let current,
    timer,
    panel,
    panelAnchor,
    panelPosition,
    disposed = false,
    targetsCache,
    capturing = false,
    wechatBotId;
  const embeddedPicker = createEmbeddedPicker(window, {
    getURL: (path) => (window.browser?.runtime || window.chrome.runtime).getURL(path),
    onQueued: () => toast(t('已加入 BOT 发送队列')),
  });
  rpc ||= async (type, extra = {}) => {
    const response = await (window.browser?.runtime || window.chrome.runtime).sendMessage({
      type,
      ...extra,
    });
    if (!response?.ok) {
      const messages = {
        SOCIAL_VIDEO_ENCRYPTED:
          '仅获取到播放器加密视频，本次未发送。未找到可供 BOT 使用的原始视频文件', // i18n-exempt: stable source key translated at runtime, preserving live language changes
        SOCIAL_VIDEO_NOT_CAPTURED: '未捕获到视频地址，本次未发送。请刷新小红书页面并播放视频后重试', // i18n-exempt: stable source key translated at runtime, preserving live language changes
        SOCIAL_VIDEO_DOWNLOAD_FAILED: '视频文件下载失败，本次未发送。请刷新笔记后重试', // i18n-exempt: stable source key translated at runtime, preserving live language changes
      };
      throw Error(
        (messages[response?.error] ? t(messages[response?.error]) : '') ||
          response?.error ||
          'REQUEST_FAILED',
      );
    }
    return response.value;
  };
  const cleanups = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };
  function failureMessage(message) {
    return /^[A-Z][A-Z0-9_]*$/.test(String(message || ''))
      ? t('操作失败（{code}），请重试', { code: message })
      : String(message || t('操作失败'));
  }
  function toast(message) {
    message = failureMessage(message);
    document.querySelector(`[${own}="status"]`)?.remove();
    const status = document.createElement('div');
    status.setAttribute(own, 'status');
    status.role = 'status';
    status.dir = supportedLocales.find((locale) => locale.code === getLocale())?.dir || 'ltr';
    status.textContent = message;
    status.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:80vw;padding:10px 16px;border-radius:8px;background:#202020;color:white;font:13px/1.6 system-ui;box-shadow:0 3px 16px #0002';
    document.body.append(status);
    window.setTimeout(() => status.remove(), 5000);
  }
  function receive(event) {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !['grok-social-record', 'grok-social-ready'].includes(event.data?.source)
    )
      return;
    if (event.data.source === 'grok-social-ready') {
      recordWaiters.get(event.data.requestId)?.();
      return;
    }
    if (event.data.version !== 1) return;
    const record = sanitizeRecord(event.data.record);
    if (!record || record.platform !== platform) return;
    const merged = mergeSocialRecord(cache.get(record.id), record);
    cache.delete(record.id);
    cache.set(record.id, merged);
    while (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  listen(window, 'message', receive);
  window.postMessage({ source: 'grok-social-request', version: 1 }, window.location.origin);
  let snapshotSequence = 0;
  function refreshPostRecords() {
    return new Promise((resolve) => {
      const requestId = 'share-' + Date.now() + '-' + ++snapshotSequence;
      const done = () => {
        window.clearTimeout(timeout);
        recordWaiters.delete(requestId);
        resolve();
      };
      const timeout = window.setTimeout(done, 1000);
      recordWaiters.set(requestId, done);
      window.postMessage(
        { source: 'grok-social-request', version: 1, requestId },
        window.location.origin,
      );
    });
  }
  async function capture(botId, chooseBot, context) {
    if (capturing) return;
    capturing = true;
    let preparing;
    try {
      if (chooseBot) preparing = embeddedPicker.prepare();
      if (platform !== 'x') context = contextForShare(window, null);
      if (platform === 'xiaohongshu' || platform === 'douyin') {
        await refreshPostRecords();
        if (disposed) return;
        if (contextForShare(window, null).id !== context.id)
          throw Error(t('帖子已切换，请在当前作品重新分享'));
      }
      const record = extractSocialDOM(window, context, cache);
      if (!chooseBot) toast(t('正在采集并发送…'));
      const result = await rpc('social.capture', { record, botId, chooseBot, embedded: true });
      if (preparing && !result?.pickerId) embeddedPicker.close();
      if (result?.jobId)
        toast(
          result.warnings?.length
            ? t('已加入发送队列，缺失媒体的说明已附在正文中')
            : t('已加入 BOT 发送队列'),
        );
      else if (result?.pickerId) embeddedPicker.open(result.pickerId, preparing);
      else if (result?.pickerOpened) toast(t('已打开 BOT 选择窗口'));
      else throw Error(t('发送未确认，请重试'));
    } catch (error) {
      if (error.message === 'SOCIAL_POST_NOT_LOADED')
        error = Error(t('未找到这条帖子的完整内容，请关闭分享菜单，在原帖上重新点击分享。'));
      if (preparing) embeddedPicker.fail(failureMessage(error.message), preparing);
      throw error;
    } finally {
      capturing = false;
    }
  }
  function activate(node, callback) {
    const click = (event) => {
      if (!isTrusted(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      callback(event);
    };
    // Native share popups often dismiss on pointer-down before a subsequent click.
    for (const type of ['pointerdown', 'mousedown', 'touchstart'])
      node.addEventListener(
        type,
        (event) => {
          if (isTrusted(event)) event.stopPropagation();
        },
        { capture: true, passive: true },
      );
    node.addEventListener('click', click, true);
    node.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && isTrusted(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        callback(event);
      }
    });
  }
  function menuAvatar(row, bot) {
    const host = row.firstElementChild;
    if (menuAvatarScopes.has(host)) return;
    host.replaceChildren();
    host.style.width = '20px';
    host.style.height = '20px';
    const scope = host.shadowRoot || host.attachShadow({ mode: 'open' });
    scope.replaceChildren();
    const style = document.createElement('style');
    style.textContent =
      'img,svg{display:block;width:100%;height:100%;max-width:100%;max-height:100%}img{object-fit:cover;border-radius:50%}';
    const mark = document.createElement('span');
    mark.dataset.avatar = bot.id;
    mark.dataset.size = '20';
    mark.style.cssText =
      'display:flex;align-items:center;justify-content:center;width:20px;height:20px';
    scope.append(style, mark);
    menuAvatarScopes.set(host, scope);
    avatars?.mount(scope, [bot]);
  }
  function releaseMenuAvatars(container) {
    for (const [host, scope] of menuAvatarScopes)
      if (!visible(window, host) || container?.contains(host)) {
        avatars?.release(scope);
        menuAvatarScopes.delete(host);
      }
  }
  function closePanel() {
    panelPosition?.dispose();
    panelPosition = null;
    if (panel) releaseMenuAvatars(panel);
    panel?.remove();
    panel = null;
    panelAnchor = null;
  }
  async function openPanel(anchor, template, context) {
    closePanel();
    panelAnchor = anchor;
    const selected = { ...context };
    const menu = createShareMenu(window, template);
    panel = menu.panel;
    document.body.append(panel);
    panel.showPopover?.();
    const position = anchorShareMenu(window, panel, anchor, platform === 'x');
    panelPosition = position;
    const loading = menu.action(t('正在读取 BOT…'), 'refresh');
    panel.append(loading);
    position.update();
    const thisPanel = panel;
    let phase = 'targets';
    try {
      targetsCache = await rpc('social.targets');
      await initI18n({ api: window.browser || window.chrome, document: null });
      if (panel !== thisPanel || !thisPanel.isConnected) return;
      thisPanel.dir = supportedLocales.find((locale) => locale.code === getLocale())?.dir || 'ltr';
      phase = 'render';
      thisPanel.replaceChildren();
      if (!targetsCache.authenticated) {
        const login = menu.action(t('打开 Grok Bot 登录'), 'panel');
        activate(login, () => {
          closePanel();
          rpc('social.open').catch((error) => toast(error.message));
        });
        thisPanel.append(login);
        position.update();
        return;
      }
      const bots = [
        ...(targetsCache.primary ? [{ ...targetsCache.primary, isPrimary: true }] : []),
        ...targetsCache.favorites.filter((b) => b.id !== targetsCache.primary?.id),
      ];
      for (const bot of bots) {
        const row = menu.action(
          `${bot.name || 'BOT'}${bot.isPrimary ? t('（主 BOT）') : ''}`,
          bot.isPrimary ? 'send' : 'bookmark',
        );
        menuAvatar(row, bot);
        activate(row, () => {
          closePanel();
          if (platform === 'wechat') {
            wechatBotId = bot.id;
            const host = document.querySelector(`[${own}="wechat"]`);
            if (host) {
              const scope = host.shadowRoot;
              scope.querySelector('#name').textContent = t('发送给 {name}', { name: bot.name });
              const mark = scope.querySelector('#avatar');
              mark.dataset.avatar = bot.id;
              mark.dataset.size = '24';
              avatars?.mount(scope, [bot]);
              wechatScopes.set(host, scope);
            }
          }
          capture(bot.id, false, selected).catch((error) =>
            toast(
              error.message === 'SOCIAL_POST_NOT_LOADED'
                ? t('帖子尚未加载完整，请打开帖子后重试。')
                : error.message,
            ),
          );
        });
        thisPanel.append(row);
      }
      const divider = document.createElement('div');
      divider.style.cssText = 'height:1px;margin:4px 0;background:currentColor;opacity:.12';
      thisPanel.append(divider);
      const choose = menu.action(t('发送给其他 BOT'), 'plus');
      activate(choose, () => {
        closePanel();
        capture(undefined, true, selected).catch((error) => toast(error.message));
      });
      thisPanel.append(choose);
      position.update();
      thisPanel.focus({ preventScroll: true });
    } catch (error) {
      if (panel === thisPanel && thisPanel.isConnected) {
        const message = String(error?.message || '');
        const code = /context invalidated/i.test(message)
          ? 'EXTENSION_CONTEXT_INVALIDATED'
          : ['UNKNOWN_ACTION', 'UNTRUSTED_SENDER', 'REQUEST_FAILED'].includes(message)
            ? message
            : /receiving end|connection|message port/i.test(message)
              ? 'EXTENSION_CONNECTION_FAILED'
              : phase === 'render'
                ? 'BOT_MENU_RENDER_FAILED'
                : 'BOT_TARGETS_FAILED';
        const detail = document.createElement('div');
        detail.setAttribute('role', 'status');
        detail.textContent = t('无法读取 BOT（{code}）。{detail}', {
          code,
          detail:
            code === 'EXTENSION_CONTEXT_INVALIDATED'
              ? t('扩展已重载，请刷新当前 X 页面。')
              : t('请重试；若仍失败，请提供此错误代码。'),
        });
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = t('重试');
        retry.style.cssText =
          'margin-top:12px;padding:8px 12px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;cursor:pointer';
        activate(retry, () => openPanel(anchor, template, selected));
        thisPanel.replaceChildren(detail, retry);
        thisPanel.style.padding = '16px';
        position.update();
      }
    }
  }
  function clearRecipientList(list, entry) {
    for (const root of entry.avatarRoots) avatars?.release(root);
    for (const node of entry.nodes) node.remove();
    if (entry.originalStyle !== undefined) {
      if (entry.originalStyle === null) list.removeAttribute('style');
      else list.setAttribute('style', entry.originalStyle);
    }
    for (const { node, original } of entry.nativeStyles || []) {
      if (original === null) node.removeAttribute('style');
      else node.setAttribute('style', original);
    }
    if (entry.created) list.remove();
    recipientLists.delete(list);
  }
  function maintainNativeLayout(entry) {
    for (const { node, height } of entry.nativeStyles || []) {
      if (node.style.height !== height) node.style.height = height;
      if (node.style.maxHeight !== height) node.style.maxHeight = height;
      if (node.style.minHeight !== '0px') node.style.minHeight = '0px';
    }
  }
  function retryRecipients(owner, list, entry) {
    const count = retryCounts.get(owner) || 0;
    if (count >= 2 || retryTimers.has(owner)) return;
    retryCounts.set(owner, count + 1);
    retryTimers.set(
      owner,
      window.setTimeout(
        () => {
          retryTimers.delete(owner);
          if (disposed || !owner.isConnected || !visible(window, owner)) return;
          if (entry && recipientLists.get(list) === entry) clearRecipientList(list, entry);
          scan();
        },
        count ? 900 : 300,
      ),
    );
  }
  async function fillRecipients(share, context) {
    const owner =
      share.menu.closest(
        '[data-e2e="video-share-panel"],.share-modal,.share-panel,.share-tooltip,[role="dialog"]',
      ) || share.menu;
    if (retryTimers.has(owner) || failedRecipients.has(owner)) return;
    let area = recipientArea(window, share);
    if (!area) return;
    if (platform === 'douyin') area = isolateDouyinRecipients(window, area, owner);
    for (const [list, entry] of recipientLists)
      if (entry.owner === owner && list !== area.list) clearRecipientList(list, entry);
    const old = recipientLists.get(area.list);
    if (old) {
      old.context = context;
      maintainNativeLayout(old);
      return;
    }
    const entry = {
      context,
      nodes: [],
      avatarRoots: [],
      created: area.created,
      owner,
      nativeViewport: area.nativeViewport,
    };
    recipientLists.set(area.list, entry);
    try {
      const targets = await rpc('social.targets');
      if (disposed || !area.list.isConnected || recipientLists.get(area.list) !== entry) return;
      targetsCache = targets;
      await initI18n({ api: window.browser || window.chrome, document: null });
      if (disposed || !area.list.isConnected || recipientLists.get(area.list) !== entry) return;
      const bots = targets.authenticated
        ? [
            ...new Map(
              [...(targets.primary ? [targets.primary] : []), ...targets.favorites].map((bot) => [
                bot.id,
                bot,
              ]),
            ).values(),
          ]
        : [];
      const fragment = document.createDocumentFragment();
      for (const bot of [...bots, null]) {
        const { row, avatarRoot } = recipientNode(window, platform, area, bot, !bot, (node) => {
          activate(node, () => {
            if (!targets.authenticated) {
              rpc('social.open').catch((error) => toast(error.message));
              return;
            }
            capture(bot?.id, !bot, entry.context).catch((error) => toast(error.message));
          });
        });
        if (!targets.authenticated) row.setAttribute('aria-label', t('打开 Grok Bot 登录'));
        entry.nodes.push(row);
        if (avatarRoot) entry.avatarRoots.push(avatarRoot);
        if (platform === 'douyin' && !bot) {
          row.style.paddingTop = '8px';
          row.style.paddingBottom = '8px';
          row.style.borderTop = '1px solid #8883';
        }
        fragment.append(row);
      }
      // Keep all saved BOTs reachable inside the original popup footprint.
      entry.originalStyle = area.list.getAttribute('style');
      const listStyle = window.getComputedStyle(area.list);
      if (area.empty) {
        area.list.style.maxHeight = 'min(320px, 50vh)';
      } else if (listStyle.maxHeight === 'none' || !listStyle.maxHeight) {
        const height = area.list.getBoundingClientRect().height;
        area.list.style.maxHeight = height > 0 ? `${height}px` : '50vh';
      }
      if (
        platform === 'xiaohongshu' &&
        !['flex', 'grid', 'inline-flex', 'inline-grid'].includes(listStyle.display)
      ) {
        area.list.style.display = 'grid';
        area.list.style.gridTemplateColumns = 'repeat(4,minmax(0,1fr))';
      }
      area.list.style.overflowY = 'auto';
      area.list.prepend(fragment);
      area.list.scrollTop = 0;
      if (area.nativeViewport) {
        area.nativeViewport.scrollTop = 0;
        const addedHeight = area.list.offsetHeight || area.list.getBoundingClientRect().height;
        entry.nativeStyles = (area.nativeLayouts || [area.nativeViewport])
          .map((node) => ({
            node,
            original: node.getAttribute('style'),
            initialHeight: node.offsetHeight || node.getBoundingClientRect().height,
          }))
          .filter((row) => addedHeight > 0 && row.initialHeight > addedHeight + 96)
          .map((row) => ({ ...row, height: `${row.initialHeight - addedHeight}px` }));
        maintainNativeLayout(entry);
      }
      for (let i = 0; i < bots.length; i++) avatars?.mount(entry.avatarRoots[i], [bots[i]]);
      if (bots.length) {
        retryCounts.delete(owner);
        window.clearTimeout(retryTimers.get(owner));
        retryTimers.delete(owner);
      } else if (platform === 'douyin') retryRecipients(owner, area.list, entry);
    } catch {
      if (disposed || !area.list.isConnected || recipientLists.get(area.list) !== entry) return;
      clearRecipientList(area.list, entry);
      if (platform === 'douyin' && (retryCounts.get(owner) || 0) < 2) retryRecipients(owner);
      else {
        failedRecipients.add(owner);
        toast(t('无法读取 BOT，请关闭分享菜单后重试，或重新加载扩展和页面。'));
      }
    }
  }
  function scan() {
    timer = undefined;
    if (disposed || !document.body) return;
    if (panelAnchor && !visible(window, panelAnchor)) closePanel();
    panelPosition?.update();
    releaseMenuAvatars();
    for (const owner of failedRecipients)
      if (!owner.isConnected || !visible(window, owner)) {
        failedRecipients.delete(owner);
        retryCounts.delete(owner);
      }
    for (const [host, scope] of wechatScopes)
      if (!host.isConnected) {
        avatars?.release(scope);
        wechatScopes.delete(host);
      }
    for (const [list, entry] of recipientLists) {
      if (
        !list.isConnected ||
        (entry.nativeViewport && !entry.nativeViewport.isConnected) ||
        !visible(window, list) ||
        entry.nodes.some((node) => !node.isConnected)
      )
        clearRecipientList(list, entry);
    }
    if (platform === 'wechat') {
      const meta = document.querySelector('#meta_content');
      if (!meta) return;
      let host = meta.querySelector(`[${own}="wechat"]`);
      if (!host) {
        host = document.createElement('span');
        host.setAttribute(own, 'wechat');
        const nativeMeta =
          meta.querySelector('.rich_media_meta') ||
          [...meta.children].find((node) => !node.matches('script,style,[data-grok-social]'));
        const nativeStyle = window.getComputedStyle(nativeMeta || meta);
        Object.assign(host.style, {
          display: 'inline-flex',
          alignItems: 'center',
          verticalAlign: nativeStyle.verticalAlign || 'middle',
          marginInlineStart: '12px',
          marginTop: nativeStyle.marginTop || '0px',
          marginBottom: nativeStyle.marginBottom || '0px',
          fontSize: nativeStyle.fontSize || '14px',
          fontFamily: nativeStyle.fontFamily || 'system-ui',
          lineHeight: nativeStyle.lineHeight || '1.6',
        });
        host.dir = supportedLocales.find((locale) => locale.code === getLocale())?.dir || 'ltr';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>:host{display:inline-flex!important;visibility:visible!important;opacity:1!important}div{display:inline-flex;align-items:center;gap:4px;font:inherit}button{all:initial;display:inline-flex;align-items:center;gap:4px;color:#576b95;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #576b95}img,svg{max-width:100%;max-height:100%}img{width:100%;height:100%;object-fit:cover}button:last-child{padding:0 6px}#avatar{display:flex;width:24px;height:24px;align-items:center;justify-content:center}</style><div><button id="send" type="button"><span id="avatar" aria-hidden="true"></span><span id="name">${escapeHTML(t('发送给 BOT'))}</span></button><button id="dropdown" type="button" aria-label="${escapeHTML(t('选择其他 BOT'))}" aria-haspopup="menu">▾</button></div>`;
        activate(shadow.querySelector('#send'), () => {
          if (!wechatBotId) openPanel(host, null, contextForShare(window, host));
          else
            capture(wechatBotId, false, contextForShare(window, host)).catch((error) =>
              toast(error.message),
            );
        });
        activate(shadow.querySelector('#dropdown'), () =>
          openPanel(host, null, contextForShare(window, host)),
        );
        meta.append(host);
        rpc('social.targets')
          .then(async (targets) => {
            if (!host.isConnected || disposed) return;
            targetsCache = targets;
            await initI18n({ api: window.browser || window.chrome, document: null });
            if (!host.isConnected || disposed) return;
            shadow.querySelector('#name').textContent = t('发送给 BOT');
            shadow.querySelector('#dropdown').setAttribute('aria-label', t('选择其他 BOT'));
            const bots = [
              ...(targets.primary ? [targets.primary] : []),
              ...(targets.favorites || []),
            ];
            const selected = bots.find((b) => b.id === wechatBotId) || targets.primary;
            if (selected) {
              wechatBotId = selected.id;
              shadow.querySelector('#name').textContent = t('发送给 {name}', {
                name: selected.name,
              });
              const mark = shadow.querySelector('#avatar');
              mark.dataset.avatar = selected.id;
              mark.dataset.size = '24';
              avatars?.mount(shadow, [selected]);
              wechatScopes.set(host, shadow);
            }
          })
          .catch((error) => toast(error.message));
      }
      if (meta.lastElementChild !== host) meta.append(host);
      return;
    }
    const share = nativeShare(window, platform);
    if (!share) return;
    const context = platform === 'x' && current?.id ? current : contextForShare(window, null);
    if (!context.id) return;
    if (platform === 'xiaohongshu' || platform === 'douyin') {
      fillRecipients(share, context);
      return;
    }
    const existing = share.menu.querySelector(`[${own}="entry"]`);
    const shareAvatar = {
      id: 'grok-social-black-blob',
      avatar: { character: { shape: 'blob', baseHex: '#000000' } },
    };
    if (existing) {
      entryContexts.set(existing, context);
      menuAvatar(existing, shareAvatar);
      return;
    }
    const entry = styleAction(window, share.template, t('分享给 BOT'), 'send');
    menuAvatar(entry, shareAvatar);
    entry.setAttribute(own, 'entry');
    entry.setAttribute('aria-haspopup', 'menu');
    const caret = document.createElement('span');
    caret.textContent = entry.dir === 'rtl' ? '‹' : '›';
    caret.style.marginInlineStart = 'auto';
    entry.append(caret);
    entryContexts.set(entry, context);
    activate(entry, () => openPanel(entry, share.template, entryContexts.get(entry)));
    share.menu.append(entry);
  }
  function schedule() {
    if (timer === undefined) timer = window.setTimeout(scan, 120);
  }
  listen(
    document,
    'pointerdown',
    (event) => {
      if (event.target.closest?.(`[${own}]`)) return;
      closePanel();
      if (event.target.closest?.('[role="menu"]')) return;
      const context = contextForShare(window, event.target);
      if (context.id) current = context;
      schedule();
    },
    true,
  );
  listen(
    document,
    'focusin',
    (event) => {
      if (event.target.closest?.(`[${own}], [role="menu"]`)) return;
      current = contextForShare(window, event.target);
      schedule();
    },
    true,
  );
  listen(
    document,
    'keydown',
    (event) => {
      if (event.key === 'Escape') closePanel();
      if (
        ['Enter', ' '].includes(event.key) &&
        !event.target.closest?.(`[${own}], [role="menu"]`)
      ) {
        current = contextForShare(window, event.target);
        schedule();
      }
    },
    true,
  );
  listen(window, 'popstate', () => {
    current = null;
    embeddedPicker.close();
    closePanel();
    schedule();
  });
  const observer = new window.MutationObserver((changes) => {
    if (
      recipientLists.size ||
      changes.some(
        (change) =>
          (change.type === 'characterData' &&
            /复制链接|Copy\s*link|分享给朋友/.test(
              change.target.parentElement?.textContent || '',
            )) ||
          [...change.removedNodes].some(
            (node) =>
              node.nodeType === 1 && (node.hasAttribute?.(own) || node.querySelector?.(`[${own}]`)),
          ) ||
          (change.type === 'attributes' &&
            /复制链接|Copy link|分享给朋友/.test(change.target.textContent || '')) ||
          [...change.addedNodes].some(
            (node) =>
              ((node.nodeType === 3 &&
                /复制链接|Copy\s*link|分享给朋友/.test(node.textContent || '')) ||
                node.nodeType === 1) &&
              !node.parentElement?.closest?.(`[${own}]`) &&
              !node.closest?.(`[${own}]`) &&
              (platform === 'wechat' ||
                /复制链接|Copy link|分享至|分享给朋友/.test(node.textContent || '') ||
                node.matches?.('[role="menu"]')),
          ),
      )
    )
      schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });
  const runtime = (window.browser || window.chrome)?.runtime;
  const languageChanged = (message) => {
    if (message?.type !== 'state.changed') return;
    const previous = getLocale();
    initI18n({ api: window.browser || window.chrome, document: null })
      .then(() => {
        if (disposed || previous === getLocale()) return;
        closePanel();
        for (const [list, entry] of recipientLists) clearRecipientList(list, entry);
        for (const [host, scope] of wechatScopes) {
          avatars?.release(scope);
          host.remove();
        }
        wechatScopes.clear();
        for (const host of document.querySelectorAll(`[${own}="wechat"],[${own}="entry"]`))
          host.remove();
        schedule();
      })
      .catch(() => {});
  };
  runtime?.onMessage?.addListener(languageChanged);
  const dispose = () => {
    disposed = true;
    runtime?.onMessage?.removeListener?.(languageChanged);
    embeddedPicker.dispose();
    for (const done of [...recordWaiters.values()]) done();
    observer.disconnect();
    if (timer !== undefined) window.clearTimeout(timer);
    closePanel();
    for (const timer of retryTimers.values()) window.clearTimeout(timer);
    retryTimers.clear();
    failedRecipients.clear();
    releaseMenuAvatars(document);
    for (const [list, entry] of recipientLists) clearRecipientList(list, entry);
    for (const scope of wechatScopes.values()) avatars?.release(scope);
    wechatScopes.clear();
    for (const cleanup of cleanups) cleanup();
    for (const node of document.querySelectorAll(`[${own}]`)) node.remove();
  };
  listen(window, 'pagehide', dispose);
  scan();
  return dispose;
}

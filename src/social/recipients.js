import { icon } from '../ui/icons.js';
// Find repeated avatar/name recipients inside a bounded native share popup.
// The copy/download/QR toolbar is deliberately never used as a recipient list.
function emptyArea(window, list, created = false) {
  const template = window.document.createElement('div');
  const style = window.getComputedStyle(list);
  template.style.font = style.font;
  template.style.color = style.color;
  const image = window.document.createElement('img');
  image.style.width = '48px';
  return { list, template, image, created, empty: true };
}
export function recipientArea(window, share) {
  const { document } = window;
  let popup = share.menu,
    fallbackPopup,
    singleton;
  const injected = share.menu.parentElement?.querySelector('[data-grok-social="recipients"]');

  for (
    let depth = 0;
    popup && popup !== document.body && depth < 6;
    depth++, popup = popup.parentElement
  ) {
    if (popup.querySelector('video,#detail-desc,#js_content')) break;
    if (
      popup.matches(
        '[role="dialog"],.share-modal,.share-panel,.share-container,.share-tooltip,[data-e2e="video-share-panel"]',
      ) ||
      /分享给朋友|分享至/.test(popup.textContent)
    )
      fallbackPopup = popup;
    for (const img of popup.querySelectorAll('img')) {
      if (img.closest('[data-grok-social]')) continue;
      let item = img.parentElement;
      for (let level = 0; item && item !== popup && level < 5; level++, item = item.parentElement) {
        const list = item.parentElement;
        const siblings = [...list.children].filter((el) => !el.hasAttribute('data-grok-social'));
        const recipients = siblings.filter(
          (el) =>
            el.querySelectorAll('img').length === 1 &&
            el.textContent.trim() &&
            !/复制链接|扫码分享/.test(el.textContent),
        );
        if (recipients.length >= 2 && recipients.length >= siblings.length / 2) {
          return { list, template: recipients[0], image: recipients[0].querySelector('img') };
        }
        if (
          recipients.length === 1 &&
          /friend|recipient|user.*list|list.*user/i.test(list.className || '')
        ) {
          singleton = { list, template: recipients[0], image: recipients[0].querySelector('img') };
        }
      }
    }
  }
  if (singleton) return singleton;
  if (!fallbackPopup) return null;
  const empty = fallbackPopup.querySelector(
    '[class*="friend-list"],[class*="friends"],[class*="recipient-list"],[class*="user-list"],[class*="users-list"],[class*="userList"]',
  );
  if (empty && window.getComputedStyle(empty).display !== 'none') return emptyArea(window, empty);
  if (injected) return emptyArea(window, injected, true);
  const list = document.createElement('div');
  list.setAttribute('data-grok-social', 'recipients');
  const tile = /xiaohongshu\.com$/.test(window.location.hostname);
  list.style.cssText = tile
    ? 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:12px;box-sizing:border-box;width:100%;'
    : 'display:flex;flex-direction:column;gap:12px;padding:12px;box-sizing:border-box;width:100%;';
  let branch = share.template;
  while (branch.parentElement && branch.parentElement !== fallbackPopup)
    branch = branch.parentElement;
  fallbackPopup.insertBefore(list, branch.parentElement === fallbackPopup ? branch : null);
  return emptyArea(window, list, true);
}

// Keep injected rows outside native virtualized list coordinates.
export function isolateDouyinRecipients(window, area, owner) {
  if (area.created) return area;
  let scroller = area.list;
  let viewport = area.list;
  for (
    let parent = area.list.parentElement;
    parent && parent !== owner;
    parent = parent.parentElement
  ) {
    if (
      parent.querySelector('input,video') ||
      /复制链接|扫码分享|Copy\s*link/i.test(parent.textContent)
    )
      break;
    if (/auto|scroll/.test(window.getComputedStyle(parent).overflowY)) scroller = parent;
    viewport = parent;
  }
  const nativeLayouts = [];
  for (let node = scroller; node; node = node.parentElement) {
    nativeLayouts.push(node);
    if (node === viewport) break;
  }
  let list = viewport.previousElementSibling;
  if (list?.getAttribute('data-grok-social') !== 'bot-recipients') {
    list = window.document.createElement('div');
    list.setAttribute('data-grok-social', 'bot-recipients');
    list.style.cssText =
      'display:flex;flex-direction:column;flex:0 0 auto;position:relative;box-sizing:border-box;width:100%;max-height:min(200px,32vh);overflow-y:auto;overscroll-behavior:contain;';
    viewport.before(list);
  }
  return { ...area, list, created: true, nativeViewport: viewport, nativeLayouts };
}
export function recipientNode(window, platform, area, bot, choose, activate) {
  const { document } = window;
  const tile = platform === 'xiaohongshu';
  const row = document.createElement(tile || choose ? 'button' : 'div');
  if (row.tagName === 'BUTTON') row.type = 'button';
  row.setAttribute('data-grok-social', choose ? 'choose' : 'friend');
  if (bot) row.setAttribute('data-grok-bot', bot.id);
  const native = window.getComputedStyle(area.template);
  const walker = document.createTreeWalker(area.template, window.NodeFilter.SHOW_TEXT);
  let labelNode;
  while ((labelNode = walker.nextNode())) {
    if (
      labelNode.textContent.trim() &&
      !/^(分享|Share)$/.test(labelNode.textContent.trim()) &&
      !labelNode.parentElement.closest('button,[role="button"]')
    )
      break;
  }
  const labelStyle = labelNode ? window.getComputedStyle(labelNode.parentElement) : native;
  const labelColor = labelStyle.color || (tile ? '#333' : '#f2f2f4');
  const imageStyle = window.getComputedStyle(area.image);
  const measuredSize = parseFloat(imageStyle.width) || area.image.getBoundingClientRect().width;
  const size = Math.max(32, Math.min(64, measuredSize || (tile ? 48 : 40)));
  const cellWidth = area.template.getBoundingClientRect().width;
  const nativeRowHeight =
    area.template.offsetHeight || area.template.getBoundingClientRect().height;
  const rowMinHeight =
    nativeRowHeight >= 32 && nativeRowHeight <= 112 ? nativeRowHeight : size + 16;
  const listStyle = window.getComputedStyle(area.list);
  let insetLeft = parseFloat(native.paddingLeft) || 0;
  let insetRight = parseFloat(native.paddingRight) || 0;
  if (!tile) {
    const bounds = area.list.getBoundingClientRect();
    const imageBounds = area.image.getBoundingClientRect();
    const scale = area.list.offsetWidth > 0 ? bounds.width / area.list.offsetWidth : 1;
    const buttonBounds = area.template
      .querySelector('button,[role="button"]')
      ?.getBoundingClientRect();
    insetLeft =
      bounds.width > 0 && imageBounds.width > 0
        ? Math.max(12, (imageBounds.left - bounds.left) / (scale || 1))
        : Math.max(12, insetLeft);
    insetRight =
      bounds.width > 0 && buttonBounds?.width > 0
        ? Math.max(12, (bounds.right - buttonBounds.right) / (scale || 1))
        : Math.max(12, insetRight);
  }

  row.className = '';
  for (const attr of area.template.attributes)
    if (attr.name.startsWith('data-v-')) row.setAttribute(attr.name, attr.value);
  Object.assign(row.style, {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    flexDirection: tile ? 'column' : 'row',
    gap: tile ? '6px' : '12px',
    padding: native.padding || '8px',
    ...(!tile ? { paddingLeft: `${insetLeft}px`, paddingRight: `${insetRight}px` } : {}),
    pointerEvents: 'auto',
    margin: '0',
    border: '0',
    background: 'transparent',
    color: labelColor,
    font: native.font || '14px/1.5 system-ui',
    minWidth: '0',
    width: tile
      ? cellWidth
        ? `${cellWidth}px`
        : listStyle.display.includes('grid')
          ? '100%'
          : '25%'
      : '100%',
    flex: '0 0 auto',
    position: 'relative',
    inset: 'auto',
    transform: 'none',
    height: 'auto',
    maxHeight: 'none',
    minHeight: tile ? '0' : choose ? '40px' : `${rowMinHeight}px`,
    textAlign: tile ? 'center' : 'left',
    cursor: tile || choose ? 'pointer' : 'default',
  });
  const slotSize = size;
  const avatar = document.createElement('span');
  avatar.setAttribute('aria-hidden', 'true');
  avatar.style.cssText = `display:flex;align-items:center;justify-content:center;flex:0 0 ${slotSize}px;width:${slotSize}px;height:${slotSize}px;overflow:visible;`;
  const shadow = avatar.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent =
    'img,svg{display:block;max-width:100%;max-height:100%}img{width:100%;height:100%;object-fit:cover;border-radius:50%}';
  shadow.append(style);
  const mark = document.createElement('span');
  mark.style.cssText = `display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;`;
  shadow.append(mark);
  if (bot) {
    mark.dataset.avatar = bot.id;
    mark.dataset.size = size;
  } else {
    const iconSize = tile ? 24 : 20;
    const svg = new window.DOMParser().parseFromString(
      icon('circle-plus', iconSize).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
      'image/svg+xml',
    ).documentElement;
    mark.append(document.importNode(svg, true));
    mark.style.cssText = `display:flex;flex:0 0 ${iconSize}px;align-items:center;justify-content:center;box-sizing:border-box;width:${iconSize}px;height:${iconSize}px;`;
  }
  const name = document.createElement('span');
  name.textContent = choose ? '选择其他 BOT' : bot.name || 'BOT';
  name.title = name.textContent;
  name.style.cssText = tile
    ? 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.4;max-width:100%;min-height:2.8em;'
    : 'min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.append(avatar, name);
  if (tile || choose) {
    row.setAttribute('aria-label', choose ? '选择其他 BOT' : `分享给 ${bot.name || 'BOT'}`);
    activate(row);
  } else {
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = '分享';
    send.setAttribute('aria-label', `分享给 ${bot.name || 'BOT'}`);
    const nativeButton = area.template.querySelector('button,[role="button"]');
    const style = nativeButton && window.getComputedStyle(nativeButton);
    send.className = '';
    Object.assign(send.style, {
      flex: '0 0 auto',
      border: '0',
      borderRadius: style?.borderRadius || '8px',
      padding: style?.padding && style.padding !== '0px' ? style.padding : '6px 20px',
      background:
        style?.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
          ? style.backgroundColor
          : '#ff2c55',
      color: '#fff',
      font: style?.font || native.font || '14px system-ui',
      cursor: 'pointer',
    });
    activate(send);
    row.append(send);
  }
  return { row, avatarRoot: bot ? shadow : null };
}

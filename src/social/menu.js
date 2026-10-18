import { icon } from '../ui/icons.js';
const own = 'data-grok-social';
function nativeTextStyle(window, template) {
  if (!template) return null;
  const walker = window.document.createTreeWalker(template, window.NodeFilter.SHOW_TEXT);
  let text;
  while ((text = walker.nextNode()))
    if (text.textContent.trim() && !text.parentElement.closest('svg,[aria-hidden="true"]'))
      return window.getComputedStyle(text.parentElement);
  return window.getComputedStyle(template);
}
function menuColors(window, template) {
  let parent = template?.parentElement,
    background = '';
  for (let i = 0; parent && i < 6; i++, parent = parent.parentElement) {
    const bg = window.getComputedStyle(parent).backgroundColor;
    if (bg && !['rgba(0, 0, 0, 0)', 'transparent'].includes(bg)) {
      background = bg;
      break;
    }
  }
  const rgb = background.match(/[\d.]+/g);
  const dark = rgb
    ? rgb.slice(0, 3).reduce((a, v) => a + Number(v), 0) / 3 < 128
    : Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return { background, dark };
}
export function createMenuAction(
  window,
  template,
  label,
  glyph = 'send',
  { copyClass = true, dark } = {},
) {
  dark ??= menuColors(window, template).dark;
  const node = window.document.createElement(template?.tagName === 'BUTTON' ? 'button' : 'div');
  if (node.tagName === 'BUTTON') node.type = 'button';
  node.setAttribute(own, 'action');
  node.setAttribute('role', 'menuitem');
  node.tabIndex = 0;
  if (template && copyClass) {
    node.className = template.className;
    for (const attr of template.attributes)
      if (attr.name.startsWith('data-v-')) node.setAttribute(attr.name, attr.value);
  }
  const css = template ? window.getComputedStyle(template) : null;
  const type = nativeTextStyle(window, template) || css;
  const horizontal = template && css.display.includes('flex') && css.flexDirection === 'column';
  Object.assign(node.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    boxSizing: 'border-box',
    gap: '12px',
    padding: css?.padding && css.padding !== '0px' ? css.padding : '12px 16px',
    minHeight: '44px',
    cursor: 'pointer',
    font: type?.font || '700 15px/1.5 system-ui',
    fontSize: type?.fontSize || '15px',
    fontWeight: type?.fontWeight || '700',
    fontFamily: type?.fontFamily || 'system-ui',
    lineHeight: type?.lineHeight || '1.5',
    letterSpacing: type?.letterSpacing || 'normal',
    color: type?.color || css?.color || 'inherit',
    background: 'transparent',
    border: '0',
    whiteSpace: 'nowrap',
    width: horizontal ? 'auto' : '100%',
  });
  const symbol = window.document.createElement('span');
  symbol.innerHTML = icon(glyph, 20);
  symbol.setAttribute('aria-hidden', 'true');
  symbol.style.cssText = 'display:flex;flex:0 0 20px;align-items:center;justify-content:center';
  const text = window.document.createElement('span');
  text.textContent = label;
  text.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis';
  node.append(symbol, text);
  let hovered = false,
    focused = false;
  const paint = () => {
    node.style.background =
      hovered || focused ? (dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.04)') : 'transparent';
  };
  node.addEventListener('pointerenter', () => {
    hovered = true;
    paint();
  });
  node.addEventListener('pointerleave', () => {
    hovered = false;
    paint();
  });
  node.addEventListener('focus', () => {
    focused = true;
    paint();
  });
  node.addEventListener('blur', () => {
    focused = false;
    paint();
  });
  return node;
}

export function createShareMenu(window, template) {
  const panel = window.document.createElement('div');
  panel.setAttribute(own, 'panel');
  panel.setAttribute('role', 'menu');
  panel.tabIndex = -1;
  panel.style.outline = 'none';
  panel.setAttribute('aria-label', '分享给 BOT');
  panel.setAttribute('popover', 'manual');
  const { background, dark } = menuColors(window, template);
  Object.assign(panel.style, {
    position: 'fixed',
    inset: 'auto',
    margin: '0',
    width: 'max-content',
    minWidth: '240px',
    maxWidth: 'min(360px, calc(100vw - 24px))',
    maxHeight: 'min(420px, calc(100dvh - 32px))',
    overflowY: 'auto',
    padding: '4px 0',
    border: '0',
    borderRadius: '12px',
    background: background || (dark ? '#202020' : '#fff'),
    color: dark ? '#e7e9ea' : '#0f1419',
    font: '700 15px/1.5 system-ui',
    boxShadow: '0 0 12px #0003',
    zIndex: '2147483647',
  });
  return {
    panel,
    action: (label, glyph) =>
      createMenuAction(window, template, label, glyph, { copyClass: false, dark }),
  };
}

// Top-layer rendering avoids native menu clipping; placement follows its parent item.
export function anchorShareMenu(window, panel, anchor, sideways = false) {
  let disposed = false;
  const nativeMenu = anchor.closest('[role="menu"]');
  function update() {
    if (disposed || !panel.isConnected || !anchor.isConnected) return;
    const inset = 12,
      gap = 4;
    const width = Math.max(0, Math.min(300, window.innerWidth - inset * 2));
    panel.style.minWidth = '0';
    panel.style.width = width + 'px';
    const rect = anchor.getBoundingClientRect();
    const parent = nativeMenu?.getBoundingClientRect() || rect;
    const height = panel.getBoundingClientRect().height;
    let left = rect.left;
    let top = rect.bottom + gap;
    if (sideways) {
      left =
        parent.right + width + gap <= window.innerWidth - inset
          ? parent.right + gap
          : parent.left - width - gap;
      top = rect.top;
      if (top + height > window.innerHeight - inset) top = rect.bottom - height;
    } else if (top + height > window.innerHeight - inset) {
      top = rect.top - height - gap;
    }
    panel.style.left = Math.max(inset, Math.min(left, window.innerWidth - width - inset)) + 'px';
    panel.style.top = Math.max(inset, Math.min(top, window.innerHeight - height - inset)) + 'px';
  }
  window.addEventListener('resize', update);
  window.addEventListener('scroll', update, true);
  const observer = window.ResizeObserver ? new window.ResizeObserver(update) : null;
  for (const node of new Set([panel, anchor, nativeMenu].filter(Boolean))) observer?.observe(node);
  return {
    update,
    dispose() {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    },
  };
}

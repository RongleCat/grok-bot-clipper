import { postID } from './records.js';
const candidates =
  '[data-e2e="feed-active-video"],[data-e2e="feed-active-video-container"],[data-e2e="video-detail"],[data-e2e="feed-item"],[data-aweme-id],[data-video-id],[data-item-id]';
function elementID(node) {
  for (const name of ['data-aweme-id', 'data-video-id', 'data-item-id', 'data-id']) {
    const value = node.getAttribute(name);
    if (value && /^\d+$/.test(value)) return value;
  }
  const link = node.querySelector('a[href*="/video/"],a[href*="/note/"]');
  return link ? postID('douyin', link.href) : '';
}
export function douyinPostRoot(window, id) {
  const nodes = [...window.document.querySelectorAll(candidates)].slice(0, 200);
  for (const node of nodes) if (elementID(node) === id) return node;
  // A direct detail route can bind its unique detail container; a modal feed cannot.
  if (/\/(?:video|note)\//.test(new URL(window.location.href).pathname))
    return (
      nodes.find((node) => node.matches('[data-e2e="video-detail"]') && !elementID(node)) || null
    );
  return null;
}
export function douyinPlayerSnapshots(window, id) {
  if (!id) return [];
  const roots = [...window.document.querySelectorAll('video,' + candidates)].slice(0, 40);
  const seen = new WeakSet(),
    found = new Set();
  function inspect(props) {
    if (!props || typeof props !== 'object') return;
    for (const value of [
      props,
      ...['aweme', 'awemeInfo', 'awemeDetail', 'awemeData', 'videoInfo', 'item', 'data'].map(
        (key) => props[key],
      ),
    ])
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        String(value.aweme_id || value.awemeId || '') === id &&
        typeof value.desc === 'string'
      )
        found.add(value);
  }
  for (const root of roots) {
    let node = root;
    for (
      let level = 0;
      node && node !== window.document.body && level < 12;
      level++, node = node.parentElement
    ) {
      for (const key of Object.keys(node).filter((key) => /^__react(?:Props|Fiber)\$/.test(key))) {
        try {
          if (key.startsWith('__reactProps$')) {
            inspect(node[key]);
            continue;
          }
          let fiber = node[key];
          for (
            let depth = 0;
            fiber && depth < 20 && !seen.has(fiber);
            depth++, fiber = fiber.return
          ) {
            seen.add(fiber);
            inspect(fiber.memoizedProps);
          }
        } catch {}
      }
    }
  }
  return [...found].slice(0, 12);
}

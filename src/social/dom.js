import { douyinPostRoot } from './douyin.js';
import TurndownService from 'turndown';
import { platformForURL, postID, sanitizeRecord } from './records.js';
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
const value = (root, selector) => root?.querySelector(selector)?.textContent?.trim() || '';
function src(img) {
  return (
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.currentSrc ||
    img.src ||
    ''
  );
}
function images(root, selector) {
  return [
    ...new Map(
      [...root.querySelectorAll(selector)]
        .map((img) => ({ url: src(img), alt: img.alt || '' }))
        .filter((i) => i.url)
        .map((i) => [i.url, i]),
    ).values(),
  ];
}
function count(root, selector) {
  const node = root.querySelector(selector);
  if (!node) return undefined;
  const label = node.textContent.trim() || node.getAttribute('aria-label') || '';
  return label.match(/[\d][\d,.]*(?:万|亿|[kKmM])?\+?/)?.[0];
}
function xPostRoot(document, id) {
  if (!id) return null;
  for (const article of document.querySelectorAll('article[data-testid="tweet"],article')) {
    const link =
      article.querySelector('a[href*="/status/"] time')?.closest('a') ||
      article.querySelector('a[href*="/status/"]');
    if (link && postID('x', link.href) === id) return article;
  }
  return null;
}
export function contextForShare(window, target) {
  const platform = platformForURL(window.location.href);
  let root, id, url;
  if (platform === 'x') {
    root = target?.closest?.('article[data-testid="tweet"],article');
    const link =
      root?.querySelector('a[href*="/status/"] time')?.closest('a') ||
      root?.querySelector('a[href*="/status/"]');
    url = link?.href || window.location.href;
    id = postID(platform, url);
    root ||= xPostRoot(window.document, id);
  } else if (platform === 'xiaohongshu') {
    root = window.document.querySelector(
      '.note-detail-mask .note-container, .note-container, #noteContainer, [data-note-id]',
    );
    url = window.location.href;
    id = postID(platform, url);
  } else if (platform === 'douyin') {
    url = window.location.href;
    id = postID(platform, url);
    root = douyinPostRoot(window, id);
  } else if (platform === 'wechat') {
    root = window.document.querySelector('#js_content');
    url = window.location.href;
    id = postID(platform, url);
  }
  return { platform, root, id, url };
}
export function extractSocialDOM(window, context, cache = new Map()) {
  const { document } = window,
    { platform, id } = context;
  if (!platform || !id) throw Error('SOCIAL_POST_NOT_LOADED');
  let root = context.root || document;
  const fallback = {
    platform,
    id,
    url: context.url,
    title: '',
    text: '',
    author: { name: '', handle: '' },
    tags: [],
    metrics: {},
    images: [],
    videos: [],
    hasVideo: false,
    captureSource: 'dom',
  };
  if (platform === 'x') {
    root = context.root || xPostRoot(document, id);
    if (!root && !cache.has(id)) throw Error('SOCIAL_POST_NOT_LOADED');
    // A cached post without a matching article must not pick up neighboring DOM content.
    root ||= document.createElement('div');
    fallback.text = value(root, '[data-testid="tweetText"]');
    fallback.author.name = value(root, '[data-testid="User-Name"]');
    fallback.tags = [...root.querySelectorAll('a[href*="/hashtag/"]')].map((n) =>
      n.textContent.replace(/^#/, ''),
    );
    for (const [key, selector] of Object.entries({
      likes: '[data-testid="like"],[data-testid="unlike"]',
      comments: '[data-testid="reply"]',
      reposts: '[data-testid="retweet"],[data-testid="unretweet"]',
      bookmarks: '[data-testid="bookmark"],[data-testid="removeBookmark"]',
      views: 'a[href$="/analytics"]',
    }))
      fallback.metrics[key] = count(root, selector);
    fallback.images = images(root, '[data-testid="tweetPhoto"] img');
  } else if (platform === 'xiaohongshu') {
    fallback.title = value(root, '#detail-title, .note-title, h1');
    fallback.text = value(root, '#detail-desc, .note-text, .desc');
    fallback.author.name = value(
      root,
      '.author-wrapper .username, .author-wrapper .name, .author-container .username, .author-container .name',
    );
    fallback.tags = [...root.querySelectorAll('#detail-desc a, a.tag, a[href*="/search_result"]')]
      .map((n) => n.textContent)
      .filter((t) => t.startsWith('#'))
      .map((t) => t.slice(1));
    fallback.images = images(root, '.media-container img, .swiper-slide img, .note-slider img');
    for (const [key, selector] of Object.entries({
      likes: '.interact-container .like-wrapper .count',
      bookmarks: '.interact-container .collect-wrapper .count',
      comments: '.interact-container .chat-wrapper .count',
      shares: '.interact-container .share-wrapper .count',
    }))
      fallback.metrics[key] = count(root, selector);
    fallback.publishedAt = value(root, '.bottom-container .date, .note-content .date, .date');
  } else if (platform === 'douyin') {
    root = context.root || douyinPostRoot(window, id);
    if (!root && !cache.has(id)) throw Error('SOCIAL_POST_NOT_LOADED');
    root ||= document.createElement('div');
    // Metadata is preferred to scanning an entire recommendation feed or its comments.
    fallback.text =
      value(root, '[data-e2e="video-desc"], [data-e2e="aweme-desc"]') ||
      (new URL(window.location.href).pathname.startsWith('/video/')
        ? document.querySelector('meta[property="og:description"]')?.content
        : '') ||
      '';
    fallback.title = new URL(window.location.href).pathname.startsWith('/video/')
      ? document.querySelector('meta[property="og:title"]')?.content || ''
      : '';
    fallback.author.name = value(root, '[data-e2e="video-author-name"], [data-e2e="user-name"]');
    fallback.tags = [...root.querySelectorAll('[data-e2e="video-desc"] a')]
      .map((n) => n.textContent)
      .filter((t) => t.startsWith('#'))
      .map((t) => t.slice(1));
    for (const [key, selector] of Object.entries({
      likes: '[data-e2e="like-count"]',
      comments: '[data-e2e="comment-count"]',
      bookmarks: '[data-e2e="collect-count"]',
      shares: '[data-e2e="share-count"]',
    }))
      fallback.metrics[key] = count(root, selector);
  } else if (platform === 'wechat') {
    root = document.querySelector('#js_content');
    if (!root) throw Error('SOCIAL_POST_NOT_LOADED');
    fallback.title = value(document, '#activity-name');
    fallback.author.name = value(document, '#js_name');
    fallback.publishedAt = value(document, '#publish_time');
    const clone = root.cloneNode(true);
    for (const node of clone.querySelectorAll(
      'script,style,input,textarea,select,iframe,object,embed,[contenteditable]',
    ))
      node.remove();
    fallback.text = td.turndown(clone.innerHTML);
    fallback.images = images(root, 'img');
    fallback.metrics = {
      views: count(document, '#readNum, #read_num'),
      likes: count(document, '#likeNum, #like_num, #js_like_num'),
      shares: count(document, '#shareNum'),
      bookmarks: count(document, '#js_old_like_num'),
    };
  }
  const video = root.querySelector('video');
  fallback.hasVideo = Boolean(video);
  if (video) {
    const sources = [
      ...new Set(
        [
          video.currentSrc,
          video.src,
          ...[...video.querySelectorAll('source')].map((node) => node.src),
        ].filter((url) => /^https?:\/\//.test(url || '')),
      ),
    ];
    if (sources.length)
      fallback.videos = [{ url: sources[0], backupUrls: sources.slice(1, 9), mime: 'video/mp4' }];
  }
  const cached = cache.get(id);
  // A post id match is mandatory; never merge with the last API result from the feed.
  const merged = cached
    ? {
        ...fallback,
        ...cached,
        title: cached.title || fallback.title,
        text: cached.text || fallback.text,
        metrics: { ...fallback.metrics, ...cached.metrics },
        images: cached.images.length ? cached.images : fallback.images,
        videos: cached.videos.length ? cached.videos : fallback.videos,
        tags: cached.tags.length ? cached.tags : fallback.tags,
        hasVideo: cached.hasVideo || fallback.hasVideo,
        captureSource: 'network',
      }
    : fallback;
  const result = sanitizeRecord(merged);
  if (!result) throw Error('INVALID_SOCIAL_POST');
  return result;
}

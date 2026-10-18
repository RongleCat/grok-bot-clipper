const domains = {
  x: ['pbs.twimg.com', 'video.twimg.com'],
  xiaohongshu: ['xhscdn.com', 'xiaohongshu.com'],
  douyin: [
    'douyinvod.com',
    'douyin.com',
    'byteimg.com',
    'bytecdn.cn',
    'ibytedtos.com',
    'pstatp.com',
    'snssdk.com',
  ],
  wechat: ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'mp.weixin.qq.com'],
};
const text = (value, max = 200000) => (typeof value === 'string' ? value.slice(0, max) : '');
const list = (value) => (Array.isArray(value) ? value : []);
const hostMatches = (host, domain) => host === domain || host.endsWith('.' + domain);
export function platformForURL(value) {
  try {
    const u = new URL(value);
    if (
      u.hostname === 'mp.weixin.qq.com' &&
      /^\/s(?:\/|$)/.test(u.pathname) &&
      ['http:', 'https:'].includes(u.protocol)
    )
      return 'wechat';
    if (u.protocol !== 'https:') return null;
    if (['x.com', 'twitter.com'].some((d) => hostMatches(u.hostname, d))) return 'x';
    if (hostMatches(u.hostname, 'xiaohongshu.com')) return 'xiaohongshu';
    if (hostMatches(u.hostname, 'douyin.com')) return 'douyin';
  } catch {}
  return null;
}
export function mediaURLAllowed(platform, value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      (domains[platform] || []).some((d) => hostMatches(u.hostname, d))
    );
  } catch {
    return false;
  }
}
export function postID(platform, value) {
  try {
    const u = new URL(value);
    if (platformForURL(value) !== platform) return '';
    if (platform === 'x') return u.pathname.match(/\/status\/(\d+)/)?.[1] || '';
    if (platform === 'xiaohongshu')
      return u.pathname.match(/\/(?:explore|discovery\/item)\/([\w-]+)/)?.[1] || '';
    if (platform === 'douyin')
      return (
        u.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] || u.searchParams.get('modal_id') || ''
      );
    if (platform === 'wechat')
      return u.pathname.startsWith('/s/')
        ? u.pathname.slice(3)
        : [u.searchParams.get('__biz'), u.searchParams.get('mid'), u.searchParams.get('idx')]
            .filter(Boolean)
            .join(':');
  } catch {}
  return '';
}
function counts(values) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, v]) =>
        (typeof v === 'number' && Number.isFinite(v) && v >= 0) ||
        (typeof v === 'string' && /^[\d.,万亿kKmM+ ]{1,30}$/.test(v)),
    ),
  );
}
function canonical(platform, id, handle = '') {
  if (platform === 'x') return `https://x.com/${encodeURIComponent(handle || 'i')}/status/${id}`;
  if (platform === 'xiaohongshu') return `https://www.xiaohongshu.com/explore/${id}`;
  if (platform === 'douyin') return `https://www.douyin.com/video/${id}`;
  return '';
}
function bestVideo(variants) {
  return variants
    .filter(
      (v) =>
        v.url &&
        !/\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)/i.test(v.url) &&
        !/mpegurl|dash/i.test(v.mime || ''),
    )
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
    .slice(0, 1);
}
function normalizeX(n) {
  if (!n.legacy?.full_text || !/^\d+$/.test(String(n.rest_id || n.legacy.id_str || '')))
    return null;
  const legacy = n.legacy,
    user = n.core?.user_results?.result;
  const author = user?.legacy || user?.core || {};
  const id = String(n.rest_id || legacy.id_str),
    handle = author.screen_name || '';
  const media = list(legacy.extended_entities?.media || legacy.entities?.media);
  const videos = media
    .filter((m) => m.type === 'video' || m.type === 'animated_gif')
    .flatMap((m) =>
      bestVideo(
        list(m.video_info?.variants).map((v) => ({
          url: v.url,
          mime: v.content_type,
          bitrate: v.bitrate,
          mediaId: String(m.id_str || ''),
        })),
      ),
    );
  return {
    platform: 'x',
    id,
    url: canonical('x', id, handle),
    title: '',
    text: n.note_tweet?.note_tweet_results?.result?.text || legacy.full_text,
    author: { name: author.name || '', handle },
    tags: list(legacy.entities?.hashtags).map((t) => t.text),
    publishedAt: legacy.created_at || '',
    metrics: counts({
      likes: legacy.favorite_count,
      comments: legacy.reply_count,
      reposts: legacy.retweet_count,
      quotes: legacy.quote_count,
      bookmarks: legacy.bookmark_count,
      views: n.views?.count,
    }),
    images: media
      .filter((m) => m.type === 'photo')
      .map((m) => ({ url: m.media_url_https || m.media_url, alt: m.ext_alt_text || '' })),
    videos,
    hasVideo: media.some((m) => m.video_info),
  };
}
function mediaHTTPS(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\\u002[fF]/g, '/')
    .replace(/^http:/, 'https:')
    .replace(/^\/\//, 'https://');
}
function xhsVideos(video = {}) {
  video = video && typeof video === 'object' ? video : {};
  let v2 = video.mediaV2 || video.media_v2 || {};
  if (typeof v2 === 'string') {
    try {
      v2 = v2.length <= 200000 ? JSON.parse(v2) : {};
    } catch {
      v2 = {};
    }
  }
  v2 = v2?.video || v2 || {};
  const keys = [
    video.consumer?.originVideoKey,
    video.consumer?.origin_video_key,
    video.originVideoKey,
    video.origin_video_key,
    v2.consumer?.originVideoKey,
    v2.consumer?.origin_video_key,
  ];
  const original = keys
    .filter((k) => typeof k === 'string')
    .map((key) => {
      if (/^https?:|^\/\//.test(key)) return key;
      if (!/^[\w./-]{1,1000}$/.test(key) || key.split('/').includes('..')) return '';
      return 'https://sns-video-bd.xhscdn.com/' + key.replace(/^\/+/, '');
    });
  const streams = [video.media?.stream || video.stream || {}, v2.media?.stream || v2.stream || {}];
  const variants = streams
    .flatMap((stream) =>
      ['h264', 'h265', 'h266', 'av1', 'EF4', 'EF5', 'EF6', 'EF7'].flatMap((codec) =>
        list(stream[codec]),
      ),
    )
    .filter((v) => v && typeof v === 'object')
    .sort(
      (a, b) =>
        (b.videoBitrate || b.video_bitrate || b.avgBitrate || b.avg_bitrate || 0) -
        (a.videoBitrate || a.video_bitrate || a.avgBitrate || a.avg_bitrate || 0),
    );
  const candidates = [
    ...original,
    v2.opaque1?.hd_screencast_stream,
    v2.opaque1?.default_screencast_stream,
    ...variants.flatMap((v) => [
      v.masterUrl || v.master_url,
      ...list(v.backupUrls || v.backup_urls),
    ]),
    video.url,
  ];
  const urls = [
    ...new Set(
      candidates
        .map(mediaHTTPS)
        .filter(
          (url) => mediaURLAllowed('xiaohongshu', url) && !/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url),
        ),
    ),
  ];
  if (!urls.length) return [];
  return [
    {
      url: urls[0],
      backupUrls: urls.slice(1, 9),
      mime: 'video/mp4',
      mediaId: String(video.media?.videoId || video.media?.video_id || keys.find(Boolean) || ''),
    },
  ];
}
function normalizeXHS(raw) {
  const n = raw.note_card || raw.noteCard || raw.note || raw;
  const id = n.note_id || n.noteId || raw.note_id || raw.noteId || raw.id || n.id;
  if (!id || !n.user || !(n.desc || n.title || n.image_list || n.imageList)) return null;
  const stats = n.interact_info || n.interactInfo || {};
  return {
    platform: 'xiaohongshu',
    id: String(id),
    url: canonical('xiaohongshu', id),
    title: n.title || '',
    text: n.desc || '',
    author: {
      name: n.user.nickname || n.user.nickName || '',
      handle: n.user.user_id || n.user.userId || '',
    },
    publishedAt: n.time || n.last_update_time || n.lastUpdateTime || '',
    tags: list(n.tag_list || n.tagList).map((t) => t.name),
    metrics: counts({
      likes: stats.liked_count ?? stats.likedCount,
      bookmarks: stats.collected_count ?? stats.collectedCount,
      comments: stats.comment_count ?? stats.commentCount,
      shares: stats.share_count ?? stats.shareCount,
      views: stats.view_count ?? stats.viewCount,
    }),
    images: list(n.image_list || n.imageList).map((i) => ({
      url:
        i.url_default ||
        i.urlDefault ||
        i.url ||
        i.info_list?.find((v) => v.image_scene === 'WB_DFT')?.url ||
        i.infoList?.find((v) => v.imageScene === 'WB_DFT')?.url ||
        i.url_pre ||
        i.urlPre,
      alt: i.alt || '',
      mediaId: i.file_id || i.fileId || '',
    })),
    videos: xhsVideos(n.video),
    hasVideo: n.type === 'video' || Boolean(n.video),
  };
}
function normalizeDouyin(n) {
  const rawId = n.aweme_id || n.awemeId;
  if (!rawId || typeof n.desc !== 'string') return null;
  const id = String(rawId),
    stats = n.statistics || {},
    pageStats = n.stats || {},
    video = n.video,
    author = n.author || n.authorInfo || {};
  function urls(address) {
    if (typeof address === 'string') return [address];
    if (Array.isArray(address)) return address.flatMap(urls);
    if (!address || typeof address !== 'object') return [];
    return [
      ...list(address.url_list || address.urlList).flatMap((v) =>
        typeof v === 'string' ? [v] : urls(v),
      ),
      ...[address.src, address.url].filter((v) => typeof v === 'string'),
    ];
  }
  const variants = [];
  function add(address, bitrate = 0) {
    for (const url of urls(address))
      variants.push({ url, mime: 'video/mp4', bitrate, mediaId: address?.uri || '' });
  }
  for (const rate of list(video?.bit_rate || video?.bitRate))
    add(rate.play_addr || rate.playAddr, rate.bit_rate || rate.bitRate || 0);
  for (const address of [
    video?.play_addr,
    video?.playAddr,
    video?.download_addr,
    video?.downloadAddr,
    video?.playApi,
  ])
    add(address);
  const videos = bestVideo(variants.filter((v) => mediaURLAllowed('douyin', mediaHTTPS(v.url))));
  if (videos[0])
    videos[0] = {
      ...videos[0],
      backupUrls: [...new Set(variants.map((v) => v.url).filter((url) => url !== videos[0].url))],
    };
  return {
    platform: 'douyin',
    id,
    url: canonical('douyin', id),
    title: n.preview_title || n.previewTitle || '',
    text: n.desc,
    author: {
      name: author.nickname || author.nickName || '',
      handle:
        author.unique_id ||
        author.uniqueId ||
        author.short_id ||
        author.shortId ||
        author.uid ||
        '',
    },
    publishedAt: n.create_time || n.createTime || '',
    tags: list(n.text_extra || n.textExtra)
      .map((t) => t.hashtag_name || t.hashtagName)
      .filter(Boolean),
    metrics: counts({
      likes: stats.digg_count ?? stats.diggCount ?? pageStats.digg_count ?? pageStats.diggCount,
      comments:
        stats.comment_count ??
        stats.commentCount ??
        pageStats.comment_count ??
        pageStats.commentCount,
      shares:
        stats.share_count ?? stats.shareCount ?? pageStats.share_count ?? pageStats.shareCount,
      bookmarks:
        stats.collect_count ??
        stats.collectCount ??
        pageStats.collect_count ??
        pageStats.collectCount,
      views: stats.play_count ?? stats.playCount ?? pageStats.play_count ?? pageStats.playCount,
    }),
    images: list(n.images).map((i) => ({
      url: (i.url_list || i.urlList)?.at(-1),
      alt: i.desc || '',
    })),
    videos,
    hasVideo: Boolean(video) && !list(n.images).length,
  };
}
export function normalizeSocialPayload(platform, payload) {
  const result = new Map(),
    seen = new WeakSet();
  let visited = 0;
  const parse =
    platform === 'x'
      ? normalizeX
      : platform === 'xiaohongshu'
        ? normalizeXHS
        : platform === 'douyin'
          ? normalizeDouyin
          : () => null;
  function visit(value, depth) {
    if (
      !value ||
      typeof value !== 'object' ||
      depth > 22 ||
      ++visited > 25000 ||
      seen.has(value) ||
      result.size >= 100
    )
      return;
    seen.add(value);
    try {
      const record = parse(value);
      if (record) {
        // The wrapper carries the note id; do not replace a full record with an id-less child.
        const previous = result.get(record.id);
        if (['xiaohongshu', 'douyin'].includes(platform))
          result.set(record.id, mergeSocialRecord(previous, record));
        else if (!previous || JSON.stringify(record).length > JSON.stringify(previous).length)
          result.set(record.id, record);
      }
      for (const key in value) {
        if (visited >= 25000 || result.size >= 100) break;
        if (!Object.hasOwn(value, key)) continue;
        if (/password|token|cookie|authorization|private|direct_message|dm_/i.test(key)) continue;
        visit(value[key], depth + 1);
      }
    } catch {}
  }
  visit(payload, 0);
  return [...result.values()].map((r) => sanitizeRecord(r)).filter(Boolean);
}
export function sanitizeRecord(record) {
  if (!record || !domains[record.platform] || !/^[\w:=-]{1,240}$/.test(String(record.id || '')))
    return null;
  const platform = record.platform;
  const media = (entries, video = false) =>
    list(entries)
      .slice(0, video ? 8 : 100)
      .map((m) => {
        // Platform APIs sometimes return plain-http CDN URLs; download over TLS.
        const url = mediaHTTPS(m?.url);
        return { ...m, url };
      })
      .filter((m) => mediaURLAllowed(platform, m.url))
      .map((m) => ({
        url: text(m.url, 12000),
        alt: text(m.alt, 1000),
        mediaId: text(m.mediaId, 200),
        ...(video
          ? {
              mime: text(m.mime, 100),
              bitrate: Number(m.bitrate) || 0,
              backupUrls: [
                ...new Set(
                  list(m.backupUrls)
                    .slice(0, 8)
                    .map(mediaHTTPS)
                    .filter(
                      (url) =>
                        url !== m.url &&
                        mediaURLAllowed(platform, url) &&
                        !/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url),
                    ),
                ),
              ].map((url) => text(url, 12000)),
            }
          : {}),
      }));
  return {
    platform,
    id: String(record.id),
    url: text(record.url, 16000),
    title: text(record.title, 500),
    text: text(record.text),
    author: {
      name: text(record.author?.name, 300),
      handle: text(String(record.author?.handle || ''), 300),
    },
    publishedAt:
      typeof record.publishedAt === 'number' ? record.publishedAt : text(record.publishedAt, 100),
    tags: [
      ...new Set(
        list(record.tags)
          .map((t) => text(t, 100))
          .filter(Boolean),
      ),
    ].slice(0, 100),
    metrics: counts(record.metrics || {}),
    images: media(record.images),
    videos: media(record.videos, true),
    hasVideo: Boolean(record.hasVideo),
    captureSource: record.captureSource === 'network' ? 'network' : 'dom',
  };
}
export function mergeSocialRecord(previous, incoming) {
  const next = sanitizeRecord(incoming),
    prev = sanitizeRecord(previous);
  if (
    !prev ||
    !next ||
    !['xiaohongshu', 'douyin'].includes(next.platform) ||
    prev.platform !== next.platform ||
    prev.id !== next.id
  )
    return next;
  const videos = next.videos.length
    ? next.videos.map((v, i) => ({
        ...v,
        backupUrls: [
          ...(v.backupUrls || []),
          ...(prev.videos[i] ? [prev.videos[i].url, ...(prev.videos[i].backupUrls || [])] : []),
        ],
      }))
    : prev.videos;
  return sanitizeRecord({
    ...prev,
    ...next,
    title: next.title || prev.title,
    text: next.text.length >= prev.text.length ? next.text : prev.text,
    author: {
      name: next.author.name || prev.author.name,
      handle: next.author.handle || prev.author.handle,
    },
    publishedAt: next.publishedAt || prev.publishedAt,
    tags: next.tags.length ? next.tags : prev.tags,
    metrics: { ...prev.metrics, ...next.metrics },
    images: next.images.length >= prev.images.length ? next.images : prev.images,
    videos,
    hasVideo: prev.hasVideo || next.hasVideo,
    captureSource: prev.captureSource === 'network' ? 'network' : next.captureSource,
  });
}
export function validateSocialRecord(record, sourceURL) {
  const platform = platformForURL(sourceURL),
    clean = sanitizeRecord(record);
  if (
    !platform ||
    !clean ||
    clean.platform !== platform ||
    platformForURL(clean.url) !== platform ||
    postID(platform, clean.url) !== clean.id
  )
    throw Error('INVALID_SOCIAL_POST');
  if (!clean.text && !clean.title && !clean.images.length && !clean.videos.length)
    throw Error('SOCIAL_POST_NOT_LOADED');
  return clean;
}

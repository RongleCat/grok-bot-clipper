import { cleanURL, safeName } from '../core/context.js';
import { mediaURLAllowed } from './records.js';
const labels = {
  likes: '点赞',
  comments: '评论',
  reposts: '转帖',
  quotes: '引用',
  bookmarks: '收藏',
  shares: '分享',
  views: '浏览 / 播放',
};
export async function downloadSocialMedia(platform, url, maxBytes, { fetchImpl = fetch } = {}) {
  if (!mediaURLAllowed(platform, url)) throw Error('MEDIA_HOST_NOT_ALLOWED');
  // Browser manual redirects are opaque. Follow public CDN redirects without
  // credentials, then validate the final host before reading any response bytes.
  const response = await fetchImpl(url, {
    credentials: 'omit',
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (response.url && !mediaURLAllowed(platform, response.url)) {
    await response.body?.cancel();
    throw Error('MEDIA_REDIRECT_NOT_ALLOWED');
  }
  if (!response?.ok) throw Error('MEDIA_DOWNLOAD_HTTP_' + (response?.status || 0));
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (!range || Number(range[1]) !== 0 || Number(range[2]) + 1 !== Number(range[3])) {
      await response.body?.cancel();
      throw Error('MEDIA_PARTIAL_RESPONSE');
    }
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw Error('ATTACHMENT_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('MEDIA_EMPTY');
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw Error('ATTACHMENT_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!bytes) throw Error('MEDIA_EMPTY');
  return new Blob(chunks, {
    type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
  });
}
async function inspectMP4(blob) {
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
  const encrypted = new Set(['ef41', 'ef51', 'ef61', 'ef71', 'encv', 'enca']);
  let boxes = 0,
    hasMovie = false,
    hasData = false,
    hasVideoTrack = false;
  function header(bytes, offset, end) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let size = view.getUint32(offset),
      length = 8;
    if (size === 1) {
      if (offset + 16 > end) throw Error('NOT_A_COMPLETE_VIDEO_FILE');
      size = Number(view.getBigUint64(offset + 8));
      length = 16;
    } else if (!size) size = end - offset;
    if (!Number.isSafeInteger(size) || size < length) throw Error('NOT_A_COMPLETE_VIDEO_FILE');
    return { size, length, type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) };
  }
  function inspectBoxes(bytes, start, end, depth = 0) {
    if (depth > 12) throw Error('VIDEO_METADATA_TOO_COMPLEX');
    for (let offset = start; offset + 8 <= end;) {
      if (++boxes > 10000) throw Error('VIDEO_METADATA_TOO_COMPLEX');
      const box = header(bytes, offset, end);
      if (offset + box.size > end) throw Error('NOT_A_COMPLETE_VIDEO_FILE');
      if (encrypted.has(box.type)) throw Error('VIDEO_ENCRYPTED_FORMAT');
      if (
        box.type === 'hdlr' &&
        box.size >= box.length + 12 &&
        String.fromCharCode(
          ...bytes.subarray(offset + box.length + 8, offset + box.length + 12),
        ) === 'vide'
      )
        hasVideoTrack = true;
      if (containers.has(box.type))
        inspectBoxes(
          bytes,
          offset + box.length + (box.type === 'stsd' ? 8 : 0),
          offset + box.size,
          depth + 1,
        );
      offset += box.size;
    }
  }
  for (let offset = 0; offset < blob.size;) {
    if (offset + 8 > blob.size || ++boxes > 10000) throw Error('NOT_A_COMPLETE_VIDEO_FILE');
    const bytes = new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer());
    const box = header(bytes, 0, blob.size - offset);
    if (offset + box.size > blob.size) throw Error('NOT_A_COMPLETE_VIDEO_FILE');
    if (box.type === 'moov') {
      if (box.size > 8 * 1048576) throw Error('VIDEO_METADATA_TOO_COMPLEX');
      const movie = new Uint8Array(await blob.slice(offset, offset + box.size).arrayBuffer());
      inspectBoxes(movie, 0, movie.length);
      hasMovie = true;
    }
    if (box.type === 'mdat') hasData = true;
    offset += box.size;
  }
  if (!hasMovie || !hasData) throw Error('NOT_A_COMPLETE_VIDEO_FILE');
  if (!hasVideoTrack) throw Error('VIDEO_TRACK_MISSING');
}
async function videoFile(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    await inspectMP4(blob);
    return { ext: 'mp4', type: 'video/mp4' };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return { ext: 'webm', type: 'video/webm' };
  if (String.fromCharCode(...bytes.slice(0, 3)) === 'FLV')
    return { ext: 'flv', type: 'video/x-flv' };
  return null;
}
export async function assembleSocialMaterial(
  record,
  {
    maxAttachmentBytes = 128 * 1048576,
    download = (url, max) => downloadSocialMedia(record.platform, url, max),
  } = {},
) {
  const attachments = [],
    warnings = [],
    files = [],
    images = [...new Map(record.images.map((i) => [i.url, i])).values()];
  let total = 0;
  for (const [kind, entries] of [
    ['image', images],
    ['video', record.videos],
  ]) {
    for (let i = 0; i < entries.length; i++) {
      const media = entries[i];
      try {
        let blob, ext;
        if (kind === 'video') {
          let lastError;
          for (const url of [...new Set([media.url, ...(media.backupUrls || []).slice(0, 8)])]) {
            if (!mediaURLAllowed(record.platform, url)) continue;
            try {
              const candidate = await download(
                url,
                Math.min(maxAttachmentBytes, 512 * 1048576 - total),
              );
              const format = await videoFile(candidate);
              if (!format) throw Error('NOT_A_COMPLETE_VIDEO_FILE');
              blob = new Blob([candidate], { type: format.type });
              ext = format.ext;
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (!blob) throw lastError || Error('MEDIA_HOST_NOT_ALLOWED');
        } else {
          if (!mediaURLAllowed(record.platform, media.url)) throw Error('MEDIA_HOST_NOT_ALLOWED');
          blob = await download(media.url, Math.min(maxAttachmentBytes, 512 * 1048576 - total));
          ext = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/avif': 'avif',
            'image/heic': 'heic',
          }[blob.type];
          if (!ext) throw Error('NOT_AN_IMAGE_FILE');
        }
        if (!blob.size || blob.size > maxAttachmentBytes || total + blob.size > 512 * 1048576)
          throw Error('ATTACHMENT_TOO_LARGE');
        const name = `${kind}-${String(i + 1).padStart(2, '0')}-${safeName(record.title || record.id).slice(0, 60)}.${ext}`;
        attachments.push({ name, blob });
        total += blob.size;
        files.push({
          kind,
          index: i + 1,
          name,
          caption: media.alt || record.title || '',
          bytes: blob.size,
        });
      } catch (error) {
        warnings.push(
          `${kind === 'video' ? '视频' : '图片'} ${i + 1} 未能附加（${error.message}），已保留帖子出处。`,
        );
      }
    }
  }
  if (record.hasVideo && !files.some((f) => f.kind === 'video'))
    warnings.push(
      '未获取到可下载的完整视频文件。请刷新原页面并打开视频，再重新采集；仅有流媒体播放清单时不会冒充视频附件。',
    );
  if (record.captureSource !== 'network' && record.platform !== 'wechat')
    warnings.push(
      '帖子接口数据尚未捕获，当前内容来自页面；图片可能受懒加载影响，互动数据只包含页面公开显示的部分。',
    );
  const title =
    record.title || record.text.split('\n')[0].slice(0, 100) || `${record.platform} 帖子`;
  const metrics = Object.entries(record.metrics)
    .map(([key, value]) => `- ${labels[key] || key}：${value}`)
    .join('\n');
  const metadata = {
    platform: record.platform,
    postId: record.id,
    title,
    author: record.author,
    publishedAt: record.publishedAt || null,
    url: cleanURL(record.url),
    text: record.text,
    tags: record.tags,
    metrics: record.metrics,
    capturedAt: new Date().toISOString(),
    captureSource: record.captureSource,
    media: files,
    completeness: {
      expectedImages: images.length,
      attachedImages: files.filter((f) => f.kind === 'image').length,
      hasVideo: record.hasVideo,
      attachedVideos: files.filter((f) => f.kind === 'video').length,
    },
    warnings,
  };
  attachments.push({
    name: 'post-context.json',
    blob: new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }),
  });
  const markdown = [
    `# ${title}`,
    `平台：${record.platform}\n作者：${record.author.name || '未公开'}${record.author.handle ? ` (${record.author.handle})` : ''}\n发布时间：${record.publishedAt || '未公开'}\n来源：${cleanURL(record.url)}`,
    record.text,
    record.tags.length ? `## 标签\n\n${record.tags.map((t) => '#' + t).join(' ')}` : '',
    `## 互动数据（采集时快照）\n\n${metrics || '未获取到公开互动数据。'}\n\n未列出的数据表示未公开或未获取，不能视为 0。`,
    files.length
      ? `## 媒体附件\n\n${files.map((f) => `- ${f.name}${f.caption ? `：${f.caption}` : ''}`).join('\n')}`
      : '',
    warnings.length ? `## 缺失说明\n\n${warnings.map((w) => '- ' + w).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    kind: 'social',
    title,
    url: cleanURL(record.url),
    canonical: cleanURL(record.url),
    author: record.author.name,
    publishedAt: String(record.publishedAt || ''),
    capturedAt: metadata.capturedAt,
    createdAt: Date.now(),
    markdown,
    attachments,
    warnings,
    social: metadata,
  };
}

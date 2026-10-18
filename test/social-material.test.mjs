import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assembleSocialMaterial, downloadSocialMedia } from '../src/social/material.js';
const record = {
  platform: 'xiaohongshu',
  id: 'note1',
  url: 'https://www.xiaohongshu.com/explore/note1',
  title: '笔记',
  text: '正文',
  author: { name: '作者' },
  tags: ['标签'],
  metrics: { likes: 0, comments: '10' },
  images: [
    { url: 'https://sns-img-qc.xhscdn.com/one', alt: '第一张' },
    { url: 'https://sns-img-qc.xhscdn.com/two', alt: '第二张' },
  ],
  videos: [],
  hasVideo: false,
  captureSource: 'network',
};
test('material contains all note images, captions, text and structured interaction context', async () => {
  const item = await assembleSocialMaterial(record, {
    download: async () => new Blob(['image'], { type: 'image/png' }),
  });
  assert.equal(item.attachments.length, 3);
  assert.match(item.markdown, /点赞：0/);
  assert.match(item.markdown, /第一张/);
  const metadata = JSON.parse(await item.attachments.at(-1).blob.text());
  assert.equal(metadata.completeness.attachedImages, 2);
  assert.equal(metadata.metrics.comments, '10');
  assert.deepEqual(metadata.tags, ['标签']);
});
test('only a complete video file is attached; an HTML or playlist response is explicitly reported', async () => {
  const r = {
    ...record,
    platform: 'x',
    images: [],
    videos: [{ url: 'https://video.twimg.com/video.mp4' }],
    hasVideo: true,
  };
  const bad = await assembleSocialMaterial(r, {
    download: async () => new Blob(['#EXTM3U'], { type: 'video/mp4' }),
  });
  assert.equal(bad.attachments.filter((a) => a.blob.type === 'video/mp4').length, 0);
  assert.ok(bad.warnings.some((w) => w.includes('完整视频')));
  const mp4 = await readFile(new URL('./fixtures/social-video.mp4', import.meta.url));
  const good = await assembleSocialMaterial(r, {
    download: async () => new Blob([mp4], { type: 'application/octet-stream' }),
  });
  assert.equal(good.attachments[0].blob.type, 'video/mp4');
  assert.equal(good.social.completeness.attachedVideos, 1);
});
test('media downloader rejects redirects outside the platform CDN and enforces streaming limits', async () => {
  await assert.rejects(
    downloadSocialMedia('x', 'https://video.twimg.com/video.mp4', 20, {
      fetchImpl: async (_url, options) => {
        assert.equal(options.redirect, 'follow');
        assert.equal(options.credentials, 'omit');
        const response = new Response('private');
        Object.defineProperty(response, 'url', { value: 'http://127.0.0.1/private' });
        return response;
      },
    }),
    /REDIRECT/,
  );
  await assert.rejects(
    downloadSocialMedia('x', 'https://video.twimg.com/video.mp4', 2, {
      fetchImpl: async () => new Response('too big'),
    }),
    /TOO_LARGE/,
  );
});
test('browser-followed media redirects validate the final CDN and preserve the downloaded file', async () => {
  const blob = await downloadSocialMedia('douyin', 'https://www.douyin.com/aweme/v1/play/', 20, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'follow');
      const response = new Response('video bytes', { headers: { 'content-type': 'video/mp4' } });
      Object.defineProperty(response, 'url', { value: 'https://v3.douyinvod.com/video.mp4' });
      return response;
    },
  });
  assert.equal(await blob.text(), 'video bytes');
});
test('an unavailable video master falls back to its backup and attaches one verified complete file', async () => {
  const requested = [];
  const mp4 = await readFile(new URL('./fixtures/social-video.mp4', import.meta.url));
  const item = await assembleSocialMaterial(
    {
      ...record,
      images: [],
      hasVideo: true,
      videos: [
        {
          url: 'https://sns-video-bd.xhscdn.com/expired.mp4',
          backupUrls: ['https://sns-video-hw.xhscdn.com/valid.mp4'],
        },
      ],
    },
    {
      download: async (url) => {
        requested.push(url);
        if (url.includes('expired')) throw Error('MEDIA_DOWNLOAD_HTTP_403');
        return new Blob([mp4], { type: 'video/mp4' });
      },
    },
  );
  assert.equal(requested.length, 2);
  assert.equal(item.social.completeness.attachedVideos, 1);
  assert.equal(item.attachments.filter((a) => a.blob.type === 'video/mp4').length, 1);
  assert.equal(item.warnings.length, 0);
});
test('media downloader rejects partial range responses rather than attaching a video fragment', async () => {
  await assert.rejects(
    downloadSocialMedia('xiaohongshu', 'https://sns-video-bd.xhscdn.com/whole.mp4', 1000, {
      fetchImpl: async () =>
        new Response('fragment', { status: 206, headers: { 'content-range': 'bytes 0-7/1000' } }),
    }),
    /MEDIA_PARTIAL_RESPONSE/,
  );
});

test('an encrypted EF video is rejected and a playable original backup is used instead', async () => {
  const original = await readFile(new URL('./fixtures/social-video.mp4', import.meta.url));
  const encrypted = Buffer.from(original);
  const codec = encrypted.lastIndexOf('avc1');
  assert.ok(codec > 32);
  encrypted.write('ef41', codec, 'ascii');
  const r = {
    ...record,
    images: [],
    hasVideo: true,
    videos: [
      {
        url: 'https://sns-video-bd.xhscdn.com/encrypted.mp4',
        backupUrls: ['https://sns-video-bd.xhscdn.com/original.mp4'],
      },
    ],
  };
  const requested = [];
  const good = await assembleSocialMaterial(r, {
    download: async (url) => {
      requested.push(url);
      return new Blob([url.includes('encrypted') ? encrypted : original], { type: 'video/mp4' });
    },
  });
  assert.equal(requested.length, 2);
  assert.equal(good.social.completeness.attachedVideos, 1);
  assert.deepEqual(Buffer.from(await good.attachments[0].blob.arrayBuffer()), original);
  const bad = await assembleSocialMaterial(
    { ...r, videos: [{ url: r.videos[0].url }] },
    { download: async () => new Blob([encrypted], { type: 'video/mp4' }) },
  );
  assert.equal(bad.social.completeness.attachedVideos, 0);
  assert.ok(bad.warnings.some((w) => w.includes('VIDEO_ENCRYPTED_FORMAT')));
});

test('a truncated MP4 or header-only response cannot be counted as a complete video', async () => {
  const bytes = await readFile(new URL('./fixtures/social-video.mp4', import.meta.url));
  for (const partial of [bytes.subarray(0, 32), bytes.subarray(0, bytes.length - 20)]) {
    const item = await assembleSocialMaterial(
      {
        ...record,
        images: [],
        hasVideo: true,
        videos: [{ url: 'https://sns-video-bd.xhscdn.com/video.mp4' }],
      },
      { download: async () => new Blob([partial], { type: 'video/mp4' }) },
    );
    assert.equal(item.social.completeness.attachedVideos, 0);
    assert.ok(item.warnings.some((w) => w.includes('NOT_A_COMPLETE_VIDEO_FILE')));
  }
});

test('an audio-only MP4 response cannot stand in for the video context', async () => {
  const bytes = Buffer.from(
    await readFile(new URL('./fixtures/social-video.mp4', import.meta.url)),
  );
  const handler = bytes.indexOf('vide');
  assert.ok(handler > 32);
  bytes.write('soun', handler, 'ascii');
  const item = await assembleSocialMaterial(
    {
      ...record,
      images: [],
      hasVideo: true,
      videos: [{ url: 'https://sns-video-bd.xhscdn.com/video.mp4' }],
    },
    { download: async () => new Blob([bytes], { type: 'video/mp4' }) },
  );
  assert.equal(item.social.completeness.attachedVideos, 0);
  assert.ok(item.warnings.some((w) => w.includes('VIDEO_TRACK_MISSING')));
});

test('Douyin page stats reach both Markdown and structured context without inventing missing counts', async () => {
  const { normalizeSocialPayload } = await import('../src/social/records.js');
  const [r] = normalizeSocialPayload('douyin', {
    awemeId: '7695664256984927515',
    desc: 'Fixture post',
    stats: { diggCount: 1234, commentCount: 0, collectCount: 456, shareCount: 89 },
  });
  const item = await assembleSocialMaterial({ ...r, captureSource: 'network' });
  assert.match(item.markdown, /点赞：1234/);
  assert.match(item.markdown, /评论：0/);
  assert.match(item.markdown, /收藏：456/);
  assert.match(item.markdown, /分享：89/);
  assert.doesNotMatch(item.markdown, /未获取到公开互动数据/);
  const metadata = JSON.parse(await item.attachments.at(-1).blob.text());
  assert.deepEqual(metadata.metrics, { likes: 1234, comments: 0, bookmarks: 456, shares: 89 });
  assert.equal(metadata.metrics.views, undefined);
});

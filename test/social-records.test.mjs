import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSocialPayload,
  validateSocialRecord,
  platformForURL,
  mediaURLAllowed,
} from '../src/social/records.js';

test('X normalizes long text, exact engagement and the highest complete video variant', () => {
  const records = normalizeSocialPayload('x', {
    data: {
      result: {
        rest_id: '12345',
        legacy: {
          id_str: '12345',
          full_text: 'short',
          favorite_count: 0,
          reply_count: 2,
          extended_entities: {
            media: [
              {
                type: 'video',
                id_str: '77',
                media_url_https: 'https://pbs.twimg.com/media/test.jpg',
                video_info: {
                  variants: [
                    {
                      content_type: 'application/x-mpegURL',
                      url: 'https://video.twimg.com/a.m3u8',
                    },
                    {
                      content_type: 'video/mp4',
                      bitrate: 10,
                      url: 'https://video.twimg.com/low.mp4',
                    },
                    {
                      content_type: 'video/mp4',
                      bitrate: 20,
                      url: 'https://video.twimg.com/high.mp4',
                    },
                  ],
                },
              },
            ],
          },
        },
        note_tweet: { note_tweet_results: { result: { text: 'full long post #AI' } } },
        core: { user_results: { result: { legacy: { name: 'Author', screen_name: 'author' } } } },
        views: { count: '123456' },
      },
    },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, '12345');
  assert.equal(records[0].text, 'full long post #AI');
  assert.equal(records[0].metrics.likes, 0);
  assert.equal(records[0].metrics.views, '123456');
  assert.equal(records[0].videos[0].url, 'https://video.twimg.com/high.mp4');
});
test('Xiaohongshu collects every image in order and keeps exact counts without guessing missing views', () => {
  const records = normalizeSocialPayload('xiaohongshu', {
    data: {
      items: [
        {
          id: 'note123',
          note_card: {
            title: 'Note',
            desc: 'Body',
            user: { nickname: 'Author' },
            tag_list: [{ name: 'tag' }],
            interact_info: { liked_count: '1.2万', collected_count: '55', comment_count: '7' },
            image_list: [
              { url_default: 'http://sns-img-qc.xhscdn.com/one' },
              { url_default: 'https://sns-img-qc.xhscdn.com/two' },
            ],
          },
        },
      ],
    },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'note123');
  assert.equal(records[0].images.length, 2);
  assert.equal(records[0].images[0].url, 'https://sns-img-qc.xhscdn.com/one');
  assert.deepEqual(records[0].tags, ['tag']);
  assert.equal(records[0].metrics.likes, '1.2万');
  assert.equal(records[0].metrics.views, undefined);
});
test('Douyin keeps video, note images, hashtags and statistics tied to the aweme id', () => {
  const [record] = normalizeSocialPayload('douyin', {
    aweme_detail: {
      aweme_id: '123456789',
      desc: 'Caption',
      author: { nickname: 'Author' },
      statistics: { digg_count: 10, comment_count: 2, share_count: 3, collect_count: 4 },
      text_extra: [{ hashtag_name: 'topic' }],
      video: { play_addr: { uri: 'video-id', url_list: ['https://v3.douyinvod.com/video.mp4'] } },
    },
  });
  assert.equal(record.id, '123456789');
  assert.deepEqual(record.tags, ['topic']);
  assert.equal(record.metrics.shares, 3);
  assert.equal(record.videos[0].url, 'https://v3.douyinvod.com/video.mp4');
});
test('validation rejects unrelated post URLs and non-platform or internal media hosts', () => {
  assert.equal(platformForURL('https://mp.weixin.qq.com/s/test'), 'wechat');
  assert.equal(mediaURLAllowed('x', 'https://video.twimg.com/video.mp4'), true);
  for (const url of [
    'http://127.0.0.1/a.mp4',
    'https://video.twimg.com.evil.test/a.mp4',
    'https://example.com/a.mp4',
    'data:video/mp4;base64,abc',
  ])
    assert.equal(mediaURLAllowed('x', url), false, url);
  assert.throws(() =>
    validateSocialRecord(
      { platform: 'x', id: '123', url: 'https://x.com/a/status/456', text: 'x' },
      'https://x.com/home',
    ),
  );
});
test('traversal is bounded and circular or irrelevant private-message objects do not leak into records', () => {
  const payload = { message: { text: 'private' }, secret: 'not post data' };
  payload.self = payload;
  assert.deepEqual(normalizeSocialPayload('x', payload), []);
});
test('Xiaohongshu originVideoKey-only video notes produce a downloadable video instead of only a cover', () => {
  const [note] = normalizeSocialPayload('xiaohongshu', {
    id: 'notevideo',
    note_card: {
      type: 'video',
      title: 'Video',
      user: { nickname: 'A' },
      image_list: [{ url_default: 'https://sns-img-qc.xhscdn.com/cover' }],
      video: { consumer: { originVideoKey: 'pre_post/test-video-key' } },
    },
  });
  assert.equal(note.images.length, 1);
  assert.equal(note.videos.length, 1);
  assert.equal(note.videos[0].url, 'https://sns-video-bd.xhscdn.com/pre_post/test-video-key');
});
test('Xiaohongshu mediaV2 and direct streams retain safe fallback URLs as one logical video', () => {
  const [note] = normalizeSocialPayload('xiaohongshu', {
    id: 'notevideo',
    type: 'video',
    title: 'Video',
    user: { nickname: 'A' },
    video: {
      mediaV2: JSON.stringify({
        video: { opaque1: { hd_screencast_stream: 'https://sns-video-bd.xhscdn.com/hd.mp4' } },
      }),
      stream: {
        h264: [
          {
            masterUrl: 'http://sns-video-qc.xhscdn.com/main.mp4',
            backupUrls: [
              'https://sns-video-hw.xhscdn.com/backup.mp4',
              'https://evil.example/video.mp4',
            ],
            videoBitrate: 2000,
          },
        ],
      },
    },
  });
  assert.equal(note.videos.length, 1);
  assert.equal(note.videos[0].url, 'https://sns-video-bd.xhscdn.com/hd.mp4');
  assert.deepEqual(note.videos[0].backupUrls, [
    'https://sns-video-qc.xhscdn.com/main.mp4',
    'https://sns-video-hw.xhscdn.com/backup.mp4',
  ]);
});
test('nullable video fields and malformed stream entries do not discard an XHS note', () => {
  const [image] = normalizeSocialPayload('xiaohongshu', {
    id: 'image',
    title: 'Image',
    user: { nickname: 'A' },
    video: null,
    imageList: [{ urlDefault: 'https://sns-img-qc.xhscdn.com/image' }],
  });
  assert.equal(image.images.length, 1);
  assert.equal(image.videos.length, 0);
  const [video] = normalizeSocialPayload('xiaohongshu', {
    id: 'video',
    title: 'Video',
    type: 'video',
    user: { nickname: 'A' },
    video: {
      media: {
        stream: { h264: [null, { masterUrl: 'https://sns-video-bd.xhscdn.com/video.mp4' }] },
      },
    },
  });
  assert.equal(video.videos.length, 1);
});

test('current XHS EF stream keys in mediaV2 are recognized without losing plain stream fallbacks', () => {
  const [note] = normalizeSocialPayload('xiaohongshu', {
    id: 'notevideo',
    type: 'video',
    title: 'Video',
    user: { nickname: 'A' },
    video: {
      mediaV2: JSON.stringify({
        stream: {
          EF4: [
            {
              masterUrl: 'https://sns-video-bd.xhscdn.com/new.mp4',
              backupUrls: ['https://sns-video-hw.xhscdn.com/new.mp4'],
            },
          ],
          EF5: [{ master_url: 'https://sns-video-qc.xhscdn.com/hevc.mp4' }],
          EF7: [{ masterUrl: 'https://sns-video-qc.xhscdn.com/av1.mp4' }],
        },
      }),
    },
  });
  assert.equal(note.videos.length, 1);
  assert.equal(note.videos[0].url, 'https://sns-video-bd.xhscdn.com/new.mp4');
  assert.deepEqual(note.videos[0].backupUrls, [
    'https://sns-video-hw.xhscdn.com/new.mp4',
    'https://sns-video-qc.xhscdn.com/hevc.mp4',
    'https://sns-video-qc.xhscdn.com/av1.mp4',
  ]);
});

test('Douyin public player camelCase metadata preserves author, counts and backup video addresses', () => {
  const [r] = normalizeSocialPayload('douyin', {
    awemeInfo: {
      awemeId: '7695664256984927515',
      desc: 'Video #GitHub',
      authorInfo: { nickname: '公开作者', uniqueId: 'creator' },
      createTime: 1792250000,
      statistics: { diggCount: 10, commentCount: 2, shareCount: 3, collectCount: 4 },
      textExtra: [{ hashtagName: 'GitHub' }],
      video: {
        playAddr: {
          urlList: ['https://v3.douyinvod.com/whole.mp4', 'https://v9.douyinvod.com/whole.mp4'],
        },
      },
    },
  });
  assert.ok(r);
  assert.equal(r.author.name, '公开作者');
  assert.equal(r.metrics.likes, 10);
  assert.equal(r.tags[0], 'GitHub');
  assert.equal(r.videos[0].backupUrls[0], 'https://v9.douyinvod.com/whole.mp4');
});

test('Douyin summary responses preserve full same-post author and original video metadata', () => {
  const rows = normalizeSocialPayload('douyin', {
    items: [
      {
        aweme_id: '123',
        desc: 'Complete post',
        author: { nickname: 'Author' },
        stats: { diggCount: 0, commentCount: 2, shareCount: 3, collectCount: 4 },
        video: { play_addr: { url_list: ['https://v3.douyinvod.com/source.mp4'] } },
      },
      { aweme_id: '123', desc: 'Short' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].author.name, 'Author');
  assert.deepEqual(rows[0].metrics, { likes: 0, comments: 2, shares: 3, bookmarks: 4 });
  assert.equal(rows[0].videos[0].url, 'https://v3.douyinvod.com/source.mp4');
});

test('Douyin page stats container retains all interaction counts alongside partial statistics', () => {
  const [r] = normalizeSocialPayload('douyin', {
    awemeId: '7695664256984927515',
    desc: 'Vibe知识大赏｜GitHub',
    authorInfo: { nickname: 'Author' },
    stats: {
      diggCount: 1234,
      commentCount: 0,
      shareCount: 89,
      collectCount: 456,
      playCount: 10000,
    },
    statistics: { share_count: 90 },
  });
  assert.deepEqual(r.metrics, {
    likes: 1234,
    comments: 0,
    shares: 90,
    bookmarks: 456,
    views: 10000,
  });
  const [emptySibling] = normalizeSocialPayload('douyin', {
    awemeId: '123',
    desc: 'Post',
    stats: { diggCount: 0, commentCount: 2 },
    statistics: {},
  });
  assert.deepEqual(emptySibling.metrics, { likes: 0, comments: 2 });
});

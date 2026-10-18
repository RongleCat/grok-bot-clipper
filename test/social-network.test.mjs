import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installNetworkObserver, publicPostRequest } from '../src/social/network.js';

test('observer only inspects public post APIs, excluding private messages and foreign endpoints', () => {
  assert.equal(publicPostRequest('x', 'https://x.com/i/api/graphql/hash/TweetDetail'), true);
  assert.equal(publicPostRequest('x', 'https://x.com/i/api/graphql/hash/DmInbox'), false);
  assert.equal(publicPostRequest('x', 'https://example.com/i/api/graphql/hash/TweetDetail'), false);
  assert.equal(
    publicPostRequest('xiaohongshu', 'https://edith.xiaohongshu.com/api/sns/web/v1/feed'),
    true,
  );
  assert.equal(
    publicPostRequest('douyin', 'https://www.douyin.com/aweme/v1/web/aweme/detail/'),
    true,
  );
});
test('fetch interception preserves the original response and observes video download addresses without changing requests', async () => {
  const dom = new JSDOM('<!doctype html>', { url: 'https://x.com/home' }),
    w = dom.window;
  const payload = {
    data: {
      result: {
        rest_id: '123',
        legacy: {
          full_text: 'Post',
          extended_entities: {
            media: [
              {
                type: 'video',
                video_info: {
                  variants: [
                    { url: 'https://video.twimg.com/source.mp4', content_type: 'video/mp4' },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  const response = new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
  const calls = [],
    records = [];
  w.fetch = (...args) => {
    calls.push(args);
    return Promise.resolve(response);
  };
  w.postMessage = (message) => records.push(message);
  installNetworkObserver(w);
  const options = { credentials: 'include' };
  const returned = await w.fetch('https://x.com/i/api/graphql/hash/TweetDetail', options);
  assert.equal(returned, response);
  assert.equal(calls[0][1], options);
  assert.deepEqual(await returned.json(), payload);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(records[0].record.videos[0].url, 'https://video.twimg.com/source.mp4');
  assert.equal(records[0].record.captureSource, 'network');
  w.close();
});
test('a later cover-only response cannot erase the same note video, and a share request refreshes initial state', async () => {
  const dom = new JSDOM('<!doctype html>', {
      url: 'https://www.xiaohongshu.com/explore/notevideo',
    }),
    w = dom.window;
  const output = [];
  w.postMessage = (m) => output.push(m);
  let body = {
    id: 'notevideo',
    type: 'video',
    title: 'Video',
    user: { nickname: 'A' },
    video: { url: 'https://sns-video-bd.xhscdn.com/whole.mp4' },
  };
  w.fetch = async () => new Response(JSON.stringify(body));
  installNetworkObserver(w);
  await w.fetch('https://edith.xiaohongshu.com/api/sns/web/v1/feed');
  await new Promise((r) => setTimeout(r, 20));
  body = {
    id: 'notevideo',
    type: 'video',
    title: 'Video',
    user: { nickname: 'A' },
    image_list: [{ url_default: 'https://sns-img-qc.xhscdn.com/cover' }],
  };
  await w.fetch('https://edith.xiaohongshu.com/api/sns/web/v1/feed');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    output.filter((m) => m.source === 'grok-social-record').at(-1).record.videos[0].url,
    'https://sns-video-bd.xhscdn.com/whole.mp4',
  );
  w.__INITIAL_STATE__ = {
    note: {
      noteDetailMap: {
        notevideo: {
          note: { ...body, video: { url: 'https://sns-video-bd.xhscdn.com/refreshed.mp4' } },
        },
      },
    },
  };
  w.dispatchEvent(
    new w.MessageEvent('message', {
      source: w,
      origin: w.location.origin,
      data: { source: 'grok-social-request', version: 1, requestId: 'fresh' },
    }),
  );
  assert.equal(
    output.filter((m) => m.source === 'grok-social-record').at(-1).record.videos[0].url,
    'https://sns-video-bd.xhscdn.com/refreshed.mp4',
  );
  assert.equal(output.at(-1).source, 'grok-social-ready');
  assert.equal(output.at(-1).requestId, 'fresh');
  w.close();
});

test('sharing recovers the exact active note from live player props after its first request was missed', () => {
  const dom = new JSDOM('<div class="note-container"><video></video></div>', {
    url: 'https://www.xiaohongshu.com/explore/current',
  });
  const w = dom.window,
    output = [];
  w.postMessage = (m) => output.push(m);
  w.__INITIAL_STATE__ = { feed: { feeds: [] } };
  w.document.querySelector('video').__vueParentComponent = {
    props: {
      note: {
        noteId: 'other',
        title: 'Wrong',
        user: { nickname: 'B' },
        video: { url: 'https://sns-video-bd.xhscdn.com/wrong.mp4' },
      },
    },
    parent: {
      props: {
        noteId: 'current',
        note: {
          type: 'video',
          title: 'Current',
          user: { nickname: 'A' },
          video: {
            mediaV2: JSON.stringify({
              stream: { EF4: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/current.mp4' }] },
            }),
          },
        },
      },
    },
  };
  installNetworkObserver(w);
  w.dispatchEvent(
    new w.MessageEvent('message', {
      source: w,
      origin: w.location.origin,
      data: { source: 'grok-social-request', version: 1, requestId: 'active' },
    }),
  );
  const records = output.filter((m) => m.source === 'grok-social-record');
  assert.equal(records.length, 1);
  assert.equal(records[0].record.id, 'current');
  assert.equal(records[0].record.videos[0].url, 'https://sns-video-bd.xhscdn.com/current.mp4');
  assert.equal(output.at(-1).source, 'grok-social-ready');
  w.close();
});

test('Douyin share snapshot recovers exact-current public React player props after a missed initial request', () => {
  const dom = new JSDOM(
      '<script id="RENDER_DATA">%bad</script><div><video id="background"></video></div><div><video id="active"></video></div>',
      { url: 'https://www.douyin.com/jingxuan?modal_id=7695664256984927515' },
    ),
    w = dom.window,
    out = [];
  w.postMessage = (m) => out.push(m);
  w.document.querySelector('#background').__reactFiber$fixture = {
    memoizedProps: {
      awemeInfo: {
        awemeId: '111',
        desc: 'Wrong',
        authorInfo: { nickname: 'Wrong' },
        stats: { diggCount: 999999 },
      },
    },
  };
  w.document.querySelector('#active').__reactFiber$fixture = {
    memoizedProps: {},
    return: {
      memoizedProps: {
        awemeInfo: {
          awemeId: '7695664256984927515',
          desc: 'Right',
          stats: { diggCount: 1234, commentCount: 0, collectCount: 456, shareCount: 89 },
          authorInfo: { nickname: 'Author' },
          video: { playAddr: { urlList: ['https://v3.douyinvod.com/current.mp4'] } },
        },
      },
    },
  };
  installNetworkObserver(w);
  w.dispatchEvent(
    new w.MessageEvent('message', {
      source: w,
      origin: w.location.origin,
      data: { source: 'grok-social-request', version: 1, requestId: 'dy-current' },
    }),
  );
  const rows = out.filter((m) => m.source === 'grok-social-record');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record.id, '7695664256984927515');
  assert.equal(rows[0].record.author.name, 'Author');
  assert.deepEqual(rows[0].record.metrics, {
    likes: 1234,
    comments: 0,
    bookmarks: 456,
    shares: 89,
  });
  assert.equal(rows[0].record.videos[0].url, 'https://v3.douyinvod.com/current.mp4');
  w.close();
});

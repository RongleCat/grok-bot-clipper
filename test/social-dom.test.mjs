import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { contextForShare, extractSocialDOM } from '../src/social/dom.js';

test('X capture is scoped to the clicked tweet rather than neighboring posts', () => {
  const dom = new JSDOM(
    '<article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">Selected #one</div><button id="share">Share</button></article><article><a href="/b/status/456"><time>now</time></a><div data-testid="tweetText">Other post</div></article>',
    { url: 'https://x.com/home' },
  );
  const context = contextForShare(dom.window, dom.window.document.querySelector('#share'));
  const record = extractSocialDOM(dom.window, context);
  assert.equal(record.id, '123');
  assert.equal(record.text, 'Selected #one');
  dom.window.close();
});
test('a cached image note uses every original image, ignoring comments and lazy DOM thumbnails', () => {
  const dom = new JSDOM(
    '<div class="note-container"><h1 id="detail-title">Title</h1><div id="detail-desc">Body</div><div class="media-container"><img src="https://sns-img-qc.xhscdn.com/thumbnail"></div><div class="comments"><img src="https://sns-img-qc.xhscdn.com/comment"></div></div>',
    { url: 'https://www.xiaohongshu.com/explore/note1' },
  );
  const cached = {
    platform: 'xiaohongshu',
    id: 'note1',
    url: dom.window.location.href,
    title: 'Title',
    text: 'Full body',
    author: { name: 'A' },
    metrics: { likes: 123 },
    tags: ['tag'],
    images: [
      { url: 'https://sns-img-qc.xhscdn.com/one' },
      { url: 'https://sns-img-qc.xhscdn.com/two' },
    ],
    videos: [],
    captureSource: 'network',
  };
  const record = extractSocialDOM(
    dom.window,
    contextForShare(dom.window, null),
    new Map([
      ['note1', cached],
      ['wrong', { ...cached, id: 'wrong', text: 'wrong' }],
    ]),
  );
  assert.equal(record.images.length, 2);
  assert.equal(record.text, 'Full body');
  assert.equal(record.captureSource, 'network');
  dom.window.close();
});
test('a blob player still uses the note-scoped HTML source URL when one is available', () => {
  const dom = new JSDOM(
    '<div class="note-container"><h1 id="detail-title">Video</h1><video src="blob:https://www.xiaohongshu.com/local"><source src="https://sns-video-bd.xhscdn.com/whole.mp4"></video></div>',
    { url: 'https://www.xiaohongshu.com/explore/notevideo' },
  );
  const record = extractSocialDOM(dom.window, contextForShare(dom.window, null));
  assert.equal(record.videos[0].url, 'https://sns-video-bd.xhscdn.com/whole.mp4');
  dom.window.close();
});

test('Douyin modal capture resolves the matching post rather than a background active player', () => {
  const dom = new JSDOM(
    '<div data-e2e="feed-active-video" data-aweme-id="111"><div data-e2e="video-desc">Wrong</div><video src="https://v3.douyinvod.com/wrong.mp4"></video></div><div data-aweme-id="7695664256984927515"><div data-e2e="video-desc">Right</div><div data-e2e="video-author-name">Author</div><video src="https://v3.douyinvod.com/right.mp4"></video></div>',
    { url: 'https://www.douyin.com/jingxuan?modal_id=7695664256984927515' },
  );
  const r = extractSocialDOM(dom.window, contextForShare(dom.window, null));
  assert.equal(r.text, 'Right');
  assert.equal(r.author.name, 'Author');
  assert.equal(r.videos[0].url, 'https://v3.douyinvod.com/right.mp4');
  dom.window.close();
});
test('Douyin modal with no identified article never borrows document-wide video or author data', () => {
  const dom = new JSDOM(
    '<div data-e2e="feed-active-video" data-aweme-id="111"><div data-e2e="video-desc">Wrong</div><video src="https://v3.douyinvod.com/wrong.mp4"></video></div>',
    { url: 'https://www.douyin.com/jingxuan?modal_id=7695664256984927515' },
  );
  assert.throws(
    () => extractSocialDOM(dom.window, contextForShare(dom.window, null)),
    /SOCIAL_POST_NOT_LOADED/,
  );
  dom.window.close();
});

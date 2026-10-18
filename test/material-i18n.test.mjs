import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale, t } from '../src/i18n/index.js';
import { packContext } from '../src/core/context.js';
import { assembleSocialMaterial } from '../src/social/material.js';
import { bodyArchive } from '../src/platform/archive.js';

test('English generated social labels preserve source text and structured counts', async () => {
  setLocale('en');
  try {
    assert.doesNotMatch(t('平台：'), /\p{Script=Han}/u);
    const item = await assembleSocialMaterial({
      platform: 'douyin',
      id: '123',
      url: 'https://www.douyin.com/video/123',
      title: '作者的原始标题',
      text: '正文不应被翻译',
      author: { name: '原作者', handle: '' },
      publishedAt: '',
      tags: ['原标签'],
      metrics: { likes: 0, comments: 4 },
      images: [],
      videos: [],
      hasVideo: false,
      captureSource: 'network',
    });
    assert.ok(item.markdown.includes(t('平台：') + 'douyin'));
    assert.ok(item.markdown.includes(t('作者：') + '原作者'));
    assert.ok(item.markdown.includes(t('{label}：{value}', { label: t('点赞'), value: 0 })));
    assert.ok(item.markdown.includes('正文不应被翻译'));
    const context = JSON.parse(await item.attachments.at(-1).blob.text());
    assert.deepEqual(context.metrics, { likes: 0, comments: 4 });
    assert.equal(context.title, '作者的原始标题');
  } finally {
    setLocale('zh_CN');
  }
});

test('localized context envelopes and safe archives retain original user material', async () => {
  setLocale('en');
  try {
    const item = {
      id: 'source',
      title: '原始标题',
      markdown: '用户正文<script>原文</script>',
      kind: 'page',
      url: 'https://example.com/',
      capturedAt: '2026-10-18',
      attachments: [],
      warnings: [],
    };
    const packet = await packContext({
      items: [item],
      instruction: '用户自写说明',
      preset: 'summary',
    });
    assert.ok(packet.text.includes('用户自写说明'));
    assert.ok(packet.text.includes('用户正文<script>原文</script>'));
    assert.ok(packet.text.includes(t('来源：') + item.url));
    const html = await bodyArchive(item).blob.text();
    assert.match(html, /lang="en"/);
    assert.doesNotMatch(t('正文归档，不包含原网页布局和未加载的媒体。'), /\p{Script=Han}/u);
    assert.ok(html.includes(t('正文归档，不包含原网页布局和未加载的媒体。')));
    assert.ok(html.includes('&lt;script&gt;原文&lt;/script&gt;'));
  } finally {
    setLocale('zh_CN');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchBots } from '../src/ui/bot-search.js';
const bot = (name, id = name) => ({ id, name });
const names = (rows) => rows.map((b) => b.name);
test('literal, full pinyin and initials rank exact before prefix before substring', () => {
  const bots = ['我的知识管理员', '知识管理员助手', '知识管理员', 'Grok'].map((n) => bot(n));
  for (const q of ['知识管理员', 'zhishiguanliyuan', 'zsgly'])
    assert.deepEqual(names(searchBots(bots, q)), [
      '知识管理员',
      '知识管理员助手',
      '我的知识管理员',
    ]);
  assert.deepEqual(names(searchBots(bots, '知识')), [
    '知识管理员助手',
    '知识管理员',
    '我的知识管理员',
  ]);
});
test('normalizes mixed Latin/Chinese, full width, case, whitespace, tones and ü input', () => {
  const bots = ['X调度员', 'Webhook 测试员', '女助手', '重庆助手'].map((n) => bot(n));
  for (const q of ['ＸＤＤＹ', 'x diao du yuan', 'X调度'])
    assert.equal(searchBots(bots, q)[0]?.name, 'X调度员');
  assert.equal(searchBots(bots, 'WEBHOOK CSY')[0]?.name, 'Webhook 测试员');
  assert.equal(searchBots(bots, 'nüzhushou')[0]?.name, '女助手');
  assert.equal(searchBots(bots, 'nǚzhushou')[0]?.name, '女助手');
  assert.equal(searchBots(bots, 'nvzhushou')[0]?.name, '女助手');
  assert.equal(searchBots(bots, 'chóng qìng')[0]?.name, '重庆助手');
});
test('empty query preserves roster order and ties without mutating input', () => {
  const bots = [bot('知识乙'), bot('知识甲'), { id: 'unnamed' }];
  assert.deepEqual(searchBots(bots, '  '), bots);
  assert.deepEqual(searchBots(bots, '知识'), bots.slice(0, 2));
  assert.deepEqual(searchBots(bots, 'no-such-bot'), []);
  assert.deepEqual(searchBots(bots, '!'), []);
  assert.equal(bots[0].name, '知识乙');
});
test('renamed and refreshed BOTs never keep stale pronunciation keys', () => {
  const b = bot('知识管理员', 'same');
  assert.equal(searchBots([b], 'zsgly').length, 1);
  b.name = '网络管家';
  assert.equal(searchBots([b], 'zsgly').length, 0);
  assert.equal(searchBots([b], 'wlgj').length, 1);
  assert.equal(searchBots([bot('记忆管家', 'same')], 'jygj').length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialService } from '../src/social/service.js';
function setup(askBeforeSend = false, onSave, assemble) {
  const requests = new Map(),
    opened = [],
    submitted = [],
    saved = [];
  let scope = { accountId: 'a', workspaceId: 'personal', generation: 'g' };
  const bots = [
    { id: 'main', name: 'Main' },
    { id: 'saved', name: 'Saved' },
    { id: 'other', name: 'Other' },
  ];
  const service = createSocialService({
    settings: async () => ({
      defaultBotId: 'main',
      favorites: ['saved'],
      askBeforeSend,
      maxAttachmentBytes: 1000,
    }),
    bots: async () => bots,
    scope: async () => scope,
    allowed: async (saved) => JSON.stringify(saved) === JSON.stringify(scope),
    loadRequest: async (id) => requests.get(id),
    saveRequest: async (row) => requests.set(row.id, structuredClone(row)),
    openPopup: async (id) => opened.push(id),
    assemble:
      assemble ||
      (async () => ({ warnings: ['Some media missing'], attachments: [], markdown: 'Body' })),
    saveMaterial: async (item) => {
      saved.push(item);
      await onSave?.();
    },
    submit: async (items, options) => {
      submitted.push({ items, options });
      return { jobId: options.draftId || 'direct-job' };
    },
  });
  return {
    service,
    opened,
    submitted,
    saved,
    requests,
    changeScope(next) {
      scope = next;
    },
  };
}
const record = {
  platform: 'x',
  id: '123',
  url: 'https://x.com/a/status/123',
  text: 'Post',
  title: 'Post',
};
test('saved BOTs are exposed completely and a direct share sends despite material warnings', async () => {
  const t = setup();
  assert.equal((await t.service.targets()).favorites[0].id, 'saved');
  const result = await t.service.capture(record, { botId: 'saved', windowId: 1 });
  assert.ok(result.jobId);
  assert.equal(t.opened.length, 0);
  assert.equal(t.submitted.length, 1);
  assert.equal(t.submitted[0].options.sendNow, true);
  assert.equal(t.submitted[0].options.explicitBotId, 'saved');
});
test('full chooser opens an independent window before downloading and can send to any active BOT once', async () => {
  const t = setup();
  const result = await t.service.capture(record, { chooseBot: true, windowId: 1 });
  assert.equal(result.pickerOpened, true);
  assert.equal(t.saved.length, 0);
  assert.equal(t.opened.length, 1);
  const id = t.opened[0];
  const state = await t.service.pickerState(id);
  assert.equal(state.bots.length, 3);
  const sent = await t.service.pickerSend(id, 'other', 'My instruction');
  assert.ok(sent.jobId);
  assert.equal(t.submitted[0].options.instruction, 'My instruction');
  assert.equal(t.submitted[0].options.explicitBotId, 'other');
  const retried = await t.service.pickerSend(id, 'other', 'My instruction');
  assert.equal(retried.jobId, sent.jobId);
  assert.equal(t.submitted.length, 1);
});
test('supplementary instructions open the independent editor and never send without confirmation', async () => {
  const t = setup(true);
  await t.service.capture(record, { botId: 'saved', windowId: 1 });
  assert.equal(t.submitted.length, 0);
  assert.equal(t.opened.length, 1);
  const state = await t.service.pickerState(t.opened[0]);
  assert.equal(state.selectedBotId, 'saved');
  assert.equal(state.askBeforeSend, true);
});
test('picker requests reject switched accounts/workspaces and arbitrary direct targets', async () => {
  const t = setup();
  await assert.rejects(
    t.service.capture(record, { botId: 'other', windowId: 1 }),
    /BOT_UNAVAILABLE/,
  );
  await t.service.capture(record, { chooseBot: true, windowId: 1 });
  t.changeScope({ accountId: 'another', workspaceId: 'team', generation: 'new' });
  await assert.rejects(t.service.pickerState(t.opened[0]), /ACCOUNT_CHANGED/);
  await assert.rejects(t.service.pickerSend(t.opened[0], 'other', ''), /ACCOUNT_CHANGED/);
  assert.equal(t.submitted.length, 0);
});

test('a workspace switch during material save prevents submission under the new identity', async () => {
  const t = setup(false, () =>
    t.changeScope({ accountId: 'a', workspaceId: 'team', generation: 'new' }),
  );
  await assert.rejects(
    t.service.capture(record, { botId: 'saved', windowId: 1 }),
    /ACCOUNT_CHANGED/,
  );
  assert.equal(t.submitted.length, 0);
});

test('an XHS video share never submits only its cover when video capture or download failed', async () => {
  for (const [videos, error] of [
    [[], 'SOCIAL_VIDEO_NOT_CAPTURED'],
    [[{ url: 'https://sns-video-bd.xhscdn.com/video.mp4' }], 'SOCIAL_VIDEO_DOWNLOAD_FAILED'],
  ]) {
    const t = setup(false, undefined, async () => ({
      attachments: [],
      social: { completeness: { attachedVideos: 0 } },
      warnings: ['Video missing'],
    }));
    await assert.rejects(
      t.service.capture(
        { ...record, platform: 'xiaohongshu', hasVideo: true, videos },
        { botId: 'main' },
      ),
      new RegExp(error),
    );
    assert.equal(t.submitted.length, 0);
    assert.equal(t.saved.length, 0);
  }
});

test('an encrypted-only XHS source reports why the video cannot be sent', async () => {
  const t = setup(false, undefined, async () => ({
    attachments: [],
    social: { completeness: { attachedVideos: 0 } },
    warnings: ['视频 1 未能附加（VIDEO_ENCRYPTED_FORMAT）'],
  }));
  await assert.rejects(
    t.service.capture(
      {
        ...record,
        platform: 'xiaohongshu',
        hasVideo: true,
        videos: [{ url: 'https://sns-video-bd.xhscdn.com/video.mp4' }],
      },
      { botId: 'main' },
    ),
    /SOCIAL_VIDEO_ENCRYPTED/,
  );
  assert.equal(t.submitted.length, 0);
});

test('embedded chooser returns a request without opening windows and fences its originating tab', async () => {
  const t = setup();
  const result = await t.service.capture(record, {
    chooseBot: true,
    embedded: true,
    tabId: 7,
    windowId: 1,
  });
  assert.ok(result.pickerId);
  assert.equal(t.opened.length, 0);
  assert.equal(t.saved.length, 0);
  assert.equal((await t.service.pickerState(result.pickerId, 7)).bots.length, 3);
  await assert.rejects(t.service.pickerState(result.pickerId, 8), /UNTRUSTED_SENDER/);
  await assert.rejects(t.service.pickerState(result.pickerId), /UNTRUSTED_SENDER/);
  await assert.rejects(t.service.pickerSend(result.pickerId, 'other', '', 8), /UNTRUSTED_SENDER/);
  const sent = await t.service.pickerSend(result.pickerId, 'other', '', 7);
  assert.ok(sent.jobId);
  assert.equal((await t.service.pickerSend(result.pickerId, 'other', '', 7)).jobId, sent.jobId);
  assert.equal(t.submitted.length, 1);
});

test('embedded direct favorites preserve the instruction preference without opening a window', async () => {
  const t = setup(true);
  const result = await t.service.capture(record, { botId: 'saved', embedded: true, tabId: 7 });
  assert.ok(result.pickerId);
  assert.equal(t.opened.length, 0);
  assert.equal(t.submitted.length, 0);
  assert.equal((await t.service.pickerState(result.pickerId, 7)).askBeforeSend, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSocialPayload } from '../src/social/records.js';
import { assembleSocialMaterial, downloadSocialMedia } from '../src/social/material.js';
import { createSocialService } from '../src/social/service.js';
import { packContext } from '../src/core/context.js';
import { uploadAttachment } from '../src/sdk/upload.js';

test('XHS current-player metadata reaches a BOT upload with the entire playable video, not only the cover', async () => {
  // Self-generated 0.25-second H.264/AAC clip, verified using ffprobe.
  const bytes = await readFile(new URL('./fixtures/social-video.mp4', import.meta.url));
  const source = 'https://sns-video-bd.xhscdn.com/current.mp4';
  const [record] = normalizeSocialPayload('xiaohongshu', {
    id: 'current',
    title: 'Video note',
    type: 'video',
    user: { nickname: 'Author' },
    imageList: [{ urlDefault: 'https://sns-img-qc.xhscdn.com/cover' }],
    video: { mediaV2: JSON.stringify({ stream: { EF4: [{ masterUrl: source }] } }) },
  });
  record.captureSource = 'network';
  let uploaded,
    submitted = 0;
  const client = {
    rpc: async (_service, method) => {
      if (method === 'BeginGrokBotAttachmentUpload')
        return {
          ok: true,
          data: {
            mode: 2,
            uploadToken: 'upload',
            sessionExpiresAtMs: String(Date.now() + 600000),
            put: {
              url: 'https://bucket.s3.amazonaws.com/video',
              expiresAtMs: String(Date.now() + 600000),
              headers: {},
            },
          },
        };
      if (method === 'CompleteGrokBotAttachmentUpload')
        return { ok: true, data: { alias: 'store:video' } };
      throw Error(method);
    },
    fetch: async (_url, options) => {
      uploaded = Buffer.from(await options.body.arrayBuffer());
      return new Response('', { status: 200 });
    },
  };
  const service = createSocialService({
    scope: async () => ({ accountId: 'a' }),
    allowed: async () => true,
    bots: async () => [{ id: 'main' }],
    settings: async () => ({ defaultBotId: 'main', favorites: [], maxAttachmentBytes: 100000 }),
    assemble: (r, options) =>
      assembleSocialMaterial(r, {
        ...options,
        download: (url, max) =>
          downloadSocialMedia(r.platform, url, max, {
            fetchImpl: async (u) => {
              if (u === source)
                return new Response(bytes, {
                  headers: {
                    'content-type': 'application/octet-stream',
                    'content-length': String(bytes.length),
                  },
                });
              return new Response('cover', { headers: { 'content-type': 'image/webp' } });
            },
          }),
      }),
    saveMaterial: async () => {},
    submit: async (items, options) => {
      submitted++;
      assert.equal(options.sendNow, true);
      const packet = await packContext({ items });
      const video = packet.attachments.find((a) => a.blob.type === 'video/mp4');
      assert.ok(video, 'video survives context packing');
      assert.match(video.name, /\.mp4$/);
      assert.equal(items[0].social.completeness.attachedVideos, 1);
      assert.equal(await uploadAttachment(client, { ...video, botId: 'main' }), 'store:video');
      return { jobId: 'verified-video-upload' };
    },
  });
  assert.equal((await service.capture(record, { botId: 'main' })).jobId, 'verified-video-upload');
  assert.equal(submitted, 1);
  assert.deepEqual(uploaded, bytes, 'the uploaded attachment preserves every video byte');
});

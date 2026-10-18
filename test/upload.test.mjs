import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadAttachment } from '../src/sdk/upload.js';
test('single PUT only completes after successful bytes upload and never forwards account bearer', async () => {
  const calls = [];
  const c = {
    rpc: async (s, m, b) => {
      calls.push(m);
      if (m === 'BeginGrokBotAttachmentUpload')
        return {
          ok: true,
          data: {
            mode: 2,
            uploadToken: 'u',
            sessionExpiresAtMs: String(Date.now() + 600000),
            put: {
              url: 'https://bucket.s3.amazonaws.com/object?signature=x',
              expiresAtMs: String(Date.now() + 600000),
              headers: { 'content-length': '3' },
            },
          },
        };
      if (m === 'CompleteGrokBotAttachmentUpload')
        return { ok: true, data: { alias: 'store:file' } };
      throw Error(m);
    },
    fetch: async (u, o) => {
      calls.push('PUT');
      assert.equal(o.headers.get('authorization'), null);
      assert.equal(await o.body.text(), 'abc');
      return new Response('', { status: 200 });
    },
  };
  assert.equal(
    await uploadAttachment(c, { botId: 'b', name: 'a.txt', blob: new Blob(['abc']) }),
    'store:file',
  );
  assert.deepEqual(calls, [
    'BeginGrokBotAttachmentUpload',
    'PUT',
    'CompleteGrokBotAttachmentUpload',
  ]);
});
test('multipart uses real checksum schema and ordered blob slices', async () => {
  const parts = [];
  const c = {
    rpc: async (s, m, b) => {
      if (m === 'BeginGrokBotAttachmentUpload')
        return {
          ok: true,
          data: {
            mode: 'GROK_BOT_ATTACHMENT_UPLOAD_MODE_MULTIPART',
            uploadToken: 'u',
            sessionExpiresAtMs: Date.now() + 600000,
            partSizeBytes: '2',
            partCount: 2,
          },
        };
      if (m === 'PresignGrokBotAttachmentUploadParts') {
        assert.equal(typeof b.parts[0].checksumSha256, 'string');
        return {
          ok: true,
          data: {
            parts: [
              {
                partNumber: b.parts[0].partNumber,
                target: { url: 'https://bucket.s3.amazonaws.com/p' },
              },
            ],
          },
        };
      }
      return { ok: true, data: { alias: 'store:multi' } };
    },
    fetch: async (u, o) => {
      parts.push(await o.body.text());
      return new Response('');
    },
  };
  assert.equal(
    await uploadAttachment(c, { botId: 'b', name: 'a.txt', blob: new Blob(['abcd']) }),
    'store:multi',
  );
  assert.deepEqual(parts, ['ab', 'cd']);
});
test('failed PUT never sends completion', async () => {
  const methods = [];
  const c = {
    rpc: async (s, m) => {
      methods.push(m);
      return {
        ok: true,
        data: {
          mode: 2,
          uploadToken: 'u',
          sessionExpiresAtMs: Date.now() + 600000,
          put: { url: 'https://bucket.s3.amazonaws.com/p', expiresAtMs: Date.now() + 600000 },
        },
      };
    },
    fetch: async () => new Response('', { status: 403 }),
  };
  await assert.rejects(
    () => uploadAttachment(c, { botId: 'b', name: 'a.txt', blob: new Blob(['abc']) }),
    /UPLOAD_PUT_FAILED/,
  );
  assert.equal(methods.length, 1);
});
